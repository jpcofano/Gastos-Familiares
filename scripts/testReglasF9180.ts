// F9.180 §2 — test de firestore.rules en el EMULADOR (rules-unit-testing). No toca producción: corre
// contra el proyecto `demo-f9180` del emulador local.
//
//   firebase emulators:exec --only firestore --project demo-f9180 "npx tsx scripts/testReglasF9180.ts [lote.json]"
//
// `lote.json` es opcional: el batch real de GAL-VISA 2026-10 que arma `confirmarResumenTarjeta`, tal
// cual lo deja `npx tsx scripts/verificarF9180.ts --fixture lote.json` (no se commitea: tiene
// descripciones reales). Sin él corren solo los casos sintéticos.
//
// 1. Reglas VIEJAS (firestore.rules de BASE, leídas de git): el total en 0 de un admin se rechaza, y el
//    batch real también. Es lo que F9.179-pre evaluó a mano; acá lo dice el motor.
// 2. Reglas NUEVAS (el árbol de trabajo): los 5 casos del prompt, 3 de control, y el batch real entra
//    entero.
//
// Entre fases se vacía el emulador y se vuelve a sembrar, para que un create no caiga en `update`.
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch, serverTimestamp, Timestamp, type Firestore } from 'firebase/firestore';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';

const BASE = '8834356';
const PROYECTO = 'demo-f9180';
const LOTE = process.argv[2] ?? null;

type Resultado = 'OK' | 'RECHAZA' | 'ERROR';
let pasan = 0, fallan = 0;

async function caso(nombre: string, esperado: Resultado, accion: () => Promise<unknown>) {
  let obtenido: Resultado;
  let detalle = '';
  try {
    await accion();
    obtenido = 'OK';
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    obtenido = code === 'permission-denied' ? 'RECHAZA' : 'ERROR';
    if (obtenido === 'ERROR') detalle = ` (${code}: ${String((e as Error).message).slice(0, 120)})`;
  }
  const bien = obtenido === esperado;
  if (bien) pasan++; else fallan++;
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${nombre}: esperado ${esperado} → ${obtenido}${detalle}`);
}

// El movimiento-total USD en 0 tal como lo escribe confirmarResumenTarjeta después de F9.180 §3.
function totalEnCero(over: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    fecha: Timestamp.fromDate(new Date('2026-10-09T00:00:00-03:00')), mes: '2026-10',
    tipo: 'Gasto', subtipo: 'Tarjeta', origen: 'Tarjeta',
    descripcion: 'Resumen Visa 2026-10 (USD)', descripcionOriginal: null,
    monto: 0, moneda: 'USD', tcUsdArs: null,
    categoria: 'Tarjetas', subcategoria: 'Galicia', etiqueta: null, banco: 'Galicia', cuenta: null,
    tarjetaCodigo: 'GAL-VISA', tarjeta: 'Visa', persona: null, creadoPor: 'Juan',
    pagado: true, excluirDash: true, incluirResumenMes: true,
    resumenTarjetaId: 'resumen-de-prueba', itemEsperadoId: null,
    confirmadoPago: true, pagadoEn: serverTimestamp(),
    hashPdf: null, refStoragePdf: null, padreId: null, notas: null,
    creadoEn: serverTimestamp(), actualizadoEn: serverTimestamp(),
  };
  const out = { ...base, ...over };
  for (const [k, v] of Object.entries(out)) if (v === undefined) delete out[k];   // "ausente"
  return out;
}

// Una línea de consumo común, monto > 0.
function lineaNormal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return totalEnCero({
    descripcion: 'GOOGLE *CLOUD', monto: 0.29, categoria: 'Tecnología', subcategoria: null,
    persona: 'Juan', excluirDash: false, incluirResumenMes: false, confirmadoPago: false, pagadoEn: undefined,
    mes: '2026-08', ...over,
  });
}

type Lote = { resumenId: string; memberId: string; ops: Array<{ op: 'set' | 'update' | 'delete'; path: string; data: unknown }> };
const lote: Lote | null = LOTE ? JSON.parse(fs.readFileSync(LOTE, 'utf8')) as Lote : null;

// El fixture marca Timestamp y serverTimestamp(); acá vuelven a ser los del SDK.
function deser(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(deser);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.__ts === 'number') return Timestamp.fromMillis(o.__ts);
    if (o.__st === true) return serverTimestamp();
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, deser(x)]));
  }
  return v;
}

function commitLote(db: Firestore, l: Lote) {
  const b = writeBatch(db);
  for (const o of l.ops) {
    const ref = doc(db, o.path);
    if (o.op === 'set') b.set(ref, deser(o.data) as Record<string, unknown>);
    else if (o.op === 'update') b.update(ref, deser(o.data) as Record<string, unknown>);
    else b.delete(ref);
  }
  return b.commit();
}

async function sembrar(env: RulesTestEnvironment) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore() as unknown as Firestore;
    await setDoc(doc(db, 'autorizados/juan@test.com'), { rol: 'admin', memberId: lote?.memberId ?? 'Juan' });
    await setDoc(doc(db, 'autorizados/sofia@test.com'), { rol: 'dependiente', memberId: 'Sofía' });
    if (lote) await setDoc(doc(db, `resumenesTarjeta/${lote.resumenId}`), { estado: 'parseado' });
  });
}

async function fase(titulo: string, reglas: string, correr: (admin: Firestore, miembro: Firestore) => Promise<void>) {
  console.log(`\n=== ${titulo} ===`);
  const env = await initializeTestEnvironment({ projectId: PROYECTO, firestore: { rules: reglas } });
  await sembrar(env);
  const admin = env.authenticatedContext('uid-juan', { email: 'Juan@Test.com', email_verified: true }).firestore() as unknown as Firestore;
  const miembro = env.authenticatedContext('uid-sofia', { email: 'sofia@test.com', email_verified: true }).firestore() as unknown as Firestore;
  try { await correr(admin, miembro); } finally { await env.cleanup(); }
}

async function main() {
  console.log('F9.180 §2 — firestore.rules en el emulador (rules-unit-testing)');
  console.log(`emulador: ${process.env.FIRESTORE_EMULATOR_HOST ?? '(sin FIRESTORE_EMULATOR_HOST)'} · proyecto ${PROYECTO}` +
    ` · batch real: ${lote ? `${lote.ops.length} ops de ${lote.resumenId.slice(0, 8)}` : 'no (sin fixture)'}`);
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Correr con `firebase emulators:exec` (ver el encabezado).');

  const viejas = execFileSync('git', ['show', `${BASE}:firestore.rules`], { encoding: 'utf8' });
  const nuevas = fs.readFileSync('firestore.rules', 'utf8');

  await fase(`Reglas VIEJAS (${BASE})`, viejas, async (admin) => {
    await caso('admin + total en 0', 'RECHAZA', () => setDoc(doc(admin, 'movimientos/v1'), totalEnCero()));
    await caso('admin + línea normal monto > 0', 'OK', () => setDoc(doc(admin, 'movimientos/v5'), lineaNormal()));
    if (lote) await caso(`batch real de ${lote.resumenId.slice(0, 8)} (${lote.ops.length} ops)`, 'RECHAZA', () => commitLote(admin, lote));
  });

  await fase('Reglas NUEVAS (árbol de trabajo)', nuevas, async (admin, miembro) => {
    await caso('1. admin + total en 0', 'OK', () => setDoc(doc(admin, 'movimientos/n1'), totalEnCero()));
    await caso('2. admin + monto 0 con resumenTarjetaId null', 'RECHAZA', () => setDoc(doc(admin, 'movimientos/n2a'), totalEnCero({ resumenTarjetaId: null })));
    await caso('2. admin + monto 0 sin resumenTarjetaId (campo ausente)', 'RECHAZA', () => setDoc(doc(admin, 'movimientos/n2b'), totalEnCero({ resumenTarjetaId: undefined })));
    await caso('3. miembro no admin + total en 0 (persona y creadoPor propios)', 'RECHAZA',
      () => setDoc(doc(miembro, 'movimientos/n3'), totalEnCero({ creadoPor: 'Sofía', persona: 'Sofía' })));
    await caso('   control de 3: el mismo miembro con monto 10', 'OK',
      () => setDoc(doc(miembro, 'movimientos/n3c'), totalEnCero({ creadoPor: 'Sofía', persona: 'Sofía', monto: 10 })));
    await caso('4. admin + monto negativo (−14,40)', 'RECHAZA', () => setDoc(doc(admin, 'movimientos/n4'), totalEnCero({ monto: -14.4 })));
    await caso('5. admin + línea normal monto > 0', 'OK', () => setDoc(doc(admin, 'movimientos/n5'), lineaNormal()));
    await caso('   control: admin + monto 0 con categoría distinta de Tarjetas', 'RECHAZA',
      () => setDoc(doc(admin, 'movimientos/n6'), totalEnCero({ categoria: 'Supermercado' })));
    await caso('   control: admin + monto 0 con excluirDash false', 'RECHAZA',
      () => setDoc(doc(admin, 'movimientos/n7'), totalEnCero({ excluirDash: false })));
    if (lote) await caso(`batch real de ${lote.resumenId.slice(0, 8)} (${lote.ops.length} ops)`, 'OK', () => commitLote(admin, lote));
  });

  console.log(`\nresultado: ${pasan} OK, ${fallan} FALLA${fallan ? '' : ' — todo en verde'}`);
  if (fallan) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
