// F9.188 §1.3 — los movimientos-total de resumen que nacieron "Pagado" sin estarlo vuelven a deberse.
// Regla en docs/CLAUDE.md, "El movimiento-total de un resumen es una obligación (F9.188 §1)".
//
//   npx tsx scripts/ejecutarF9188s1.ts                 → DRY-RUN contra producción (no escribe nada)
//   npx tsx scripts/ejecutarF9188s1.ts --aplicar       → escribe (lo corre Juan)
//   npx tsx scripts/ejecutarF9188s1.ts --revertir      → deshace EXACTAMENTE esta corrección
//   npx tsx scripts/ejecutarF9188s1.ts --exportar F    → copia los movimientos de producción a F (solo lectura;
//                                                        F tiene datos reales: va al scratchpad, no se commitea)
//   firebase emulators:exec --only firestore --project demo-f9188 \
//     "npx tsx scripts/ejecutarF9188s1.ts --probar-emulador F"
//                                                      → siembra F en el emulador y prueba dry-run → aplicar →
//                                                        dry-run → revertir, comparando campo por campo
//
// Universo (la regla, no una lista): movimiento-total de resumen (categoria 'Tarjetas' + resumenTarjetaId)
// con pagado: true, sin confirmar (confirmadoPago !== true), monto > 0 y fecha efectiva >= hoy (ART).
// Los ya vencidos no se tocan: la plata ya salió. Los de monto 0 tampoco: están saldados (F9.180 §3).
// --aplicar se niega si aparece uno que no estaba en la medición de §0 (docs/F9.188.txt).
//
// Escribe pagado: false + corregidoPor + corregidoEn + actualizadoEn, y guarda el actualizadoEn
// anterior en actualizadoEnPrevio para que --revertir deje el documento exactamente como estaba.
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { crearSim } from './simConfirmarResumen';
import type { Movement } from '../src/types';

process.env.TZ = 'America/Argentina/Buenos_Aires';
const MARCA = 'F9.188-total-no-pagado';
// F9.188 §0.1 (i), medido el 2026-10-08: los 6 totales del 9/10.
const MEDIDOS = ['4v6zSQBh', '84tYO8zb', '8yrFcA81', 'GNjyjwBJ', 'OpPV0LNm', 'dHJfkxGz'];
const LOTE = 400;
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const APLICAR = process.argv.includes('--aplicar');
const REVERTIR = process.argv.includes('--revertir');
const EXPORTAR = arg('--exportar');
const PROBAR = arg('--probar-emulador');

// Con el emulador, el MISMO firebase-admin que el resto (raíz). FieldValue tiene que ser del mismo paquete.
const req = createRequire(process.cwd() + '/package.json');
const { initializeApp, cert, getApps } = req('firebase-admin/app') as typeof import('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = req('firebase-admin/firestore') as typeof import('firebase-admin/firestore');
type Firestore = import('firebase-admin/firestore').Firestore;
type Doc = import('firebase-admin/firestore').QueryDocumentSnapshot;

const h8 = (v: unknown) => (v ? String(v).slice(0, 8) : '-');
const corto = (v: unknown, n = 34) => { const t = String(v ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };
const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inicioDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// ── el universo y las dos escrituras ─────────────────────────────────────────────────────────────
function modulos(db: Firestore) {
  const sim = crearSim(db);
  const OB = sim.cargar<typeof import('../src/datos/obligaciones')>('src/datos/obligaciones.ts');
  const MOV = sim.cargar<{ docAMovimiento: (id: string, d: FirebaseFirestore.DocumentData) => Movement }>('src/datos/movimientos.ts');
  return { OB, MOV };
}

async function universo(db: Firestore, hoy: Date): Promise<Array<{ doc: Doc; mov: Movement; vence: Date }>> {
  const { OB, MOV } = modulos(db);
  const snap = await db.collection('movimientos').where('categoria', '==', 'Tarjetas').get();
  return snap.docs
    .filter(d => {
      const x = d.data();
      return typeof x.resumenTarjetaId === 'string' && x.resumenTarjetaId !== '' && x.pagado === true
        && x.confirmadoPago !== true && Number(x.monto) > 0;
    })
    .map(doc => { const mov = MOV.docAMovimiento(doc.id, doc.data()); return { doc, mov, vence: OB.fechaEfectivaMov(mov) }; })
    .filter(u => u.vence.getTime() >= inicioDia(hoy).getTime())
    .sort((a, b) => a.vence.getTime() - b.vence.getTime() || a.doc.id.localeCompare(b.doc.id));
}

/** Batches de hasta 400. Un batch que falla aborta y se reporta lo que YA quedó escrito. */
async function escribirEnLotes(db: Firestore, ops: Array<{ ref: FirebaseFirestore.DocumentReference; datos: Record<string, unknown> }>, que: string) {
  const escritos: string[] = [];
  for (let i = 0; i < ops.length; i += LOTE) {
    const lote = ops.slice(i, i + LOTE);
    const b = db.batch();
    for (const o of lote) b.update(o.ref, o.datos);
    try {
      await b.commit();
      escritos.push(...lote.map(o => o.ref.id));
    } catch (e) {
      console.log(`>>> ${que}: falló el batch ${i / LOTE + 1} (${lote.length} docs): ${(e as Error).message}`);
      console.log(`>>> quedaron escritos ${escritos.length} de ${ops.length}: ${escritos.join(', ') || '(ninguno)'}`);
      console.log(`>>> sin escribir: ${ops.slice(i).map(o => o.ref.id).join(', ')}`);
      throw e;
    }
  }
  return escritos;
}

async function aplicar(db: Firestore, docs: Doc[]) {
  return escribirEnLotes(db, docs.map(d => ({
    ref: d.ref,
    datos: {
      pagado: false,
      corregidoPor: MARCA,
      corregidoEn: FieldValue.serverTimestamp(),
      actualizadoEnPrevio: d.data().actualizadoEn ?? null,
      actualizadoEn: FieldValue.serverTimestamp(),
    },
  })), 'aplicar');
}

// Solo revierte lo que sigue como lo dejó --aplicar. Si después alguien confirmó el pago, o el cierre
// al vencer lo cerró (cerradoPor), el documento ya cambió por otro camino y no se pisa.
async function revertir(db: Firestore) {
  const snap = await db.collection('movimientos').where('corregidoPor', '==', MARCA).get();
  const intactos = snap.docs.filter(d => d.data().pagado === false && d.data().confirmadoPago !== true);
  const cambiados = snap.docs.filter(d => !intactos.includes(d));
  for (const d of cambiados) {
    const x = d.data();
    console.log(`   no se revierte ${h8(d.id)}: cambió después de aplicar (pagado=${x.pagado} confirmadoPago=${x.confirmadoPago} cerradoPor=${x.cerradoPor ?? '-'})`);
  }
  const escritos = await escribirEnLotes(db, intactos.map(d => ({
    ref: d.ref,
    datos: {
      pagado: true,
      corregidoPor: FieldValue.delete(),
      corregidoEn: FieldValue.delete(),
      actualizadoEnPrevio: FieldValue.delete(),
      actualizadoEn: d.data().actualizadoEnPrevio ?? FieldValue.delete(),
    },
  })), 'revertir');
  return { escritos, cambiados: cambiados.length };
}

// ── el dry-run ───────────────────────────────────────────────────────────────────────────────────
async function dryRun(db: Firestore, hoy: Date) {
  const u = await universo(db, hoy);
  console.log(`── universo: total de resumen · pagado: true · sin confirmar · monto > 0 · vence >= ${iso(hoy)} → ${u.length} (medidos en §0: ${MEDIDOS.length})`);
  console.log('   id       | tarjeta              | moneda |         monto | vence      | mes     | itemEsperadoId | en §0');
  for (const { doc, mov, vence } of u) {
    console.log(`   ${h8(doc.id)} | ${corto(mov.tarjeta ?? mov.tarjetaCodigo, 20).padEnd(20)} | ${mov.moneda.padEnd(6)} | ${fmt(mov.monto).padStart(13)} | ${iso(vence)} | ${mov.mes} | ${h8(mov.itemEsperadoId).padEnd(14)} | ${MEDIDOS.includes(doc.id.slice(0, 8)) ? 'sí' : 'NO'}`);
  }
  const suma: Record<string, number> = {};
  for (const { mov } of u) suma[mov.moneda] = (suma[mov.moneda] ?? 0) + mov.monto;
  console.log(`   suma: ${Object.entries(suma).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ') || '0'}`);
  const nuevos = u.filter(x => !MEDIDOS.includes(x.doc.id.slice(0, 8)));
  const faltan = MEDIDOS.filter(id => !u.some(x => x.doc.id.startsWith(id)));
  if (faltan.length) {
    // Un medido que ya no entra cambió por otro camino (lo confirmó un comprobante, venció): se dice por qué.
    const todos = await db.collection('movimientos').where('categoria', '==', 'Tarjetas').get();
    for (const id of faltan) {
      const d = todos.docs.find(x => x.id.startsWith(id));
      const x = d?.data();
      console.log(`   ya no entra ${id}: ${x ? `pagado=${x.pagado} confirmadoPago=${x.confirmadoPago} corregidoPor=${x.corregidoPor ?? '-'} cerradoPor=${x.cerradoPor ?? '-'}` : 'no existe'}`);
    }
  }
  if (nuevos.length) console.log(`>>> ${nuevos.length} que NO estaban en la medición de §0: ${nuevos.map(x => h8(x.doc.id)).join(', ')}. No se aplica: revisar antes.`);
  return { docs: u.map(x => x.doc), ok: nuevos.length === 0 && u.length > 0 };
}

// ── prueba en el emulador ────────────────────────────────────────────────────────────────────────
async function probarEmulador(db: Firestore, archivo: string) {
  const fx = JSON.parse(fs.readFileSync(archivo, 'utf8')) as Array<{ id: string; data: Record<string, unknown> }>;
  const deJson = (v: unknown): unknown => {
    if (v && typeof v === 'object' && '__ts' in (v as object)) return Timestamp.fromMillis((v as { __ts: number }).__ts);
    if (Array.isArray(v)) return v.map(deJson);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deJson(x)]));
    return v;
  };
  for (let i = 0; i < fx.length; i += LOTE) {
    const b = db.batch();
    for (const d of fx.slice(i, i + LOTE)) b.set(db.collection('movimientos').doc(d.id), deJson(d.data) as Record<string, unknown>);
    await b.commit();
  }
  const ser = (x: unknown) => JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && typeof v.toMillis === 'function' ? `ts:${v.toMillis()}` : v));
  const foto = async () => new Map((await db.collection('movimientos').get()).docs.map(d => [d.id, ser(d.data())]));
  const antes = await foto();
  const hoy = new Date();
  let fallas = 0;
  const ok = (c: boolean, t: string) => { if (!c) fallas++; console.log(`  ${c ? 'OK' : '✗'} ${t}`); };
  console.log(`emulador: ${fx.length} movimientos sembrados · hoy ${iso(hoy)}\n`);

  const d1 = await dryRun(db, hoy);
  ok(d1.ok && d1.docs.length === MEDIDOS.length, `dry-run: ${d1.docs.length} (esperado ${MEDIDOS.length}, todos medidos en §0)`);
  const escritos = await aplicar(db, d1.docs);
  ok(escritos.length === MEDIDOS.length, `--aplicar escribió ${escritos.length}`);
  const tras = await db.collection('movimientos').get();
  const corregidos = tras.docs.filter(d => d.data().corregidoPor === MARCA);
  ok(corregidos.length === MEDIDOS.length && corregidos.every(d => d.data().pagado === false && d.data().corregidoEn && d.data().actualizadoEn && 'actualizadoEnPrevio' in d.data()),
    `${corregidos.length} con pagado=false + corregidoPor + corregidoEn + actualizadoEn + actualizadoEnPrevio`);
  let otros = 0, conf = 0;
  const permitidos = new Set(['pagado', 'corregidoPor', 'corregidoEn', 'actualizadoEn', 'actualizadoEnPrevio']);
  for (const d of tras.docs) {
    const prev = JSON.parse(antes.get(d.id)!), now = JSON.parse(ser(d.data()));
    const cambiados = Object.keys({ ...prev, ...now }).filter(k => JSON.stringify(prev[k]) !== JSON.stringify(now[k]));
    if (d1.docs.some(x => x.id === d.id)) { if (cambiados.some(k => !permitidos.has(k))) otros++; if (prev.confirmadoPago !== now.confirmadoPago) conf++; }
    else if (cambiados.length) otros++;
  }
  ok(otros === 0 && conf === 0, `ningún otro campo cambió (${otros}), confirmadoPago intacto (${conf}), nada fuera del universo se tocó`);

  // Con las funciones reales del cliente: ahora son obligaciones abiertas, no vencidas.
  const { OB, MOV } = modulos(db);
  const movs = tras.docs.map(d => MOV.docAMovimiento(d.id, d.data()));
  const abiertas = OB.obligacionesAbiertas(movs.filter(m => OB.esObligacionAbierta(m)), hoy).filter(o => corregidos.some(c => c.id === o.mov.id));
  ok(abiertas.length === MEDIDOS.length && abiertas.every(o => o.estado !== 'vencida'),
    `las ${abiertas.length} son obligaciones abiertas (${abiertas.map(o => o.estado).join(', ')}), ninguna vencida`);
  const camp = OB.obligacionesParaCampana(abiertas, hoy, 14);
  ok(camp.length === MEDIDOS.length, `las ${camp.length} entran en la campana`);

  const d2 = await dryRun(db, hoy);
  ok(d2.docs.length === 0, `dry-run después de aplicar: ${d2.docs.length} (esperado 0: idempotente)`);
  const rev = await revertir(db);
  ok(rev.escritos.length === MEDIDOS.length && rev.cambiados === 0, `--revertir deshizo ${rev.escritos.length} (${rev.cambiados} cambiados por otro camino)`);
  const despues = await foto();
  let distintos = 0;
  // Campo por campo: el orden de las claves de un documento cambia después de un update.
  for (const [id, prevS] of antes) {
    const prev = JSON.parse(prevS), now = JSON.parse(despues.get(id)!);
    const cambiados = Object.keys({ ...prev, ...now }).filter(k => JSON.stringify(prev[k]) !== JSON.stringify(now[k]));
    if (cambiados.length) { distintos++; console.log(`     distinto: ${h8(id)} → ${cambiados.join(', ')}`); }
  }
  ok(distintos === 0, `después de revertir, TODO igual al original, actualizadoEn incluido (${distintos} documentos distintos)`);
  const d3 = await dryRun(db, hoy);
  ok(d3.docs.length === MEDIDOS.length, `dry-run después de revertir: ${d3.docs.length} (vuelven a ser ${MEDIDOS.length})`);

  // Revertir no pisa lo que cambió por otro camino: aplicar, confirmar uno a mano, revertir.
  await aplicar(db, d3.docs);
  const uno = d3.docs[0].ref;
  await uno.update({ pagado: true, confirmadoPago: true });
  const rev2 = await revertir(db);
  const unoDespues = (await uno.get()).data()!;
  ok(rev2.escritos.length === MEDIDOS.length - 1 && rev2.cambiados === 1 && unoDespues.confirmadoPago === true && unoDespues.corregidoPor === MARCA,
    `con uno confirmado después de aplicar, --revertir deshace ${rev2.escritos.length} y deja el confirmado como está`);
  console.log(`\nPRUEBA EN EMULADOR: ${fallas === 0 ? 'TODO OK' : `${fallas} FALLA(S)`}`);
  return fallas;
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const emu = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (getApps().length === 0) {
    if (emu) initializeApp({ projectId: 'demo-f9188' });
    else initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
  }
  const db = getFirestore();

  if (PROBAR) { if (!emu) throw new Error('--probar-emulador corre dentro de firebase emulators:exec'); process.exit(await probarEmulador(db, PROBAR) ? 1 : 0); }
  if (EXPORTAR) {
    const snap = await db.collection('movimientos').get();
    const aJson = (v: unknown): unknown => {
      if (v && typeof v === 'object' && typeof (v as { toMillis?: unknown }).toMillis === 'function') return { __ts: (v as { toMillis: () => number }).toMillis() };
      if (Array.isArray(v)) return v.map(aJson);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, aJson(x)]));
      return v;
    };
    fs.writeFileSync(EXPORTAR, JSON.stringify(snap.docs.map(d => ({ id: d.id, data: aJson(d.data()) }))));
    console.log(`exportados ${snap.size} movimientos a ${EXPORTAR}`);
    return;
  }
  if (REVERTIR) {
    const r = await revertir(db);
    console.log(`revertidos ${r.escritos.length} (corregidoPor == '${MARCA}'); ${r.cambiados} no se tocaron porque cambiaron después`);
    return;
  }

  console.log(`F9.188 §1.3 — ${APLICAR ? 'APLICAR' : 'DRY-RUN (no escribe nada)'} · ${emu ? 'EMULADOR' : 'PRODUCCIÓN'}\n`);
  const { docs, ok } = await dryRun(db, new Date());
  if (!APLICAR) { console.log(`\nDRY-RUN: ${ok ? 'listo para --aplicar' : 'NO aplicar (ver arriba)'}`); return; }
  if (!ok) { console.log('>>> no se aplica: el universo está vacío o trae algo que no se midió en §0'); process.exit(1); }
  const escritos = await aplicar(db, docs);
  console.log(`\nAPLICADO: ${escritos.length} totales con pagado=false y corregidoPor='${MARCA}'`);
}

main().catch(e => { console.error(e); process.exit(1); });
