// F9.185 — cerrar como pagadas las obligaciones abiertas de meses anteriores al actual.
// Regla y significado de `cerradoPor` en docs/CLAUDE.md, "`cerradoPor` — cierres masivos con nombre".
//
//   npx tsx scripts/ejecutarF9185.ts                 → DRY-RUN contra producción (no escribe nada)
//   npx tsx scripts/ejecutarF9185.ts --aplicar       → escribe (lo corre Juan)
//   npx tsx scripts/ejecutarF9185.ts --revertir      → deshace EXACTAMENTE este cierre
//   npx tsx scripts/ejecutarF9185.ts --exportar F    → copia los movimientos de producción a F (solo lectura;
//                                                      F tiene datos reales: va al scratchpad, no se commitea)
//   firebase emulators:exec --only firestore --project demo-f9185 \
//     "npx tsx scripts/ejecutarF9185.ts --probar-emulador F"
//                                                    → siembra F en el emulador y prueba dry-run → aplicar →
//                                                      dry-run → revertir, comparando campo por campo
//
// Universo: movimientos con pagado == false, tipo 'Gasto', mes < '2026-10' y sin cubrir
// (esObligacionAbierta de src/datos/obligaciones.ts: un confirmadoPago == true ya está cubierto).
// Escribe pagado: true + cerradoPor + cerradoEn + actualizadoEn. No toca confirmadoPago ni nada más.
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { crearSim } from './simConfirmarResumen';
import type { ExpectedItem, Movement } from '../src/types';
import type { CheckItem } from '../src/datos/checklist';

process.env.TZ = 'America/Argentina/Buenos_Aires';
const MARCA = 'F9.185-cierre-meses-anteriores';
const CORTE = '2026-10';
const ESPERADO = 134;
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
const corto = (v: unknown, n = 30) => { const t = String(v ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };
const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── el universo y las dos escrituras ─────────────────────────────────────────────────────────────
async function universo(db: Firestore): Promise<Doc[]> {
  const snap = await db.collection('movimientos').where('pagado', '==', false).get();
  return snap.docs.filter(d => {
    const x = d.data();
    return x.tipo === 'Gasto' && typeof x.mes === 'string' && x.mes < CORTE && x.confirmadoPago !== true;
  });
}

/** Batches de hasta 400. Un batch que falla aborta y se reporta lo que YA quedó escrito. */
async function escribirEnLotes(db: Firestore, refs: FirebaseFirestore.DocumentReference[], datos: Record<string, unknown>, que: string) {
  const escritos: string[] = [];
  for (let i = 0; i < refs.length; i += LOTE) {
    const lote = refs.slice(i, i + LOTE);
    const b = db.batch();
    for (const r of lote) b.update(r, datos);
    try {
      await b.commit();
      escritos.push(...lote.map(r => r.id));
    } catch (e) {
      console.log(`>>> ${que}: falló el batch ${i / LOTE + 1} (${lote.length} docs): ${(e as Error).message}`);
      console.log(`>>> quedaron escritos ${escritos.length} de ${refs.length}: ${escritos.join(', ') || '(ninguno)'}`);
      console.log(`>>> sin escribir: ${refs.slice(i).map(r => r.id).join(', ')}`);
      throw e;
    }
  }
  return escritos;
}

async function aplicar(db: Firestore, docs: Doc[]) {
  return escribirEnLotes(db, docs.map(d => d.ref), {
    pagado: true, cerradoPor: MARCA, cerradoEn: FieldValue.serverTimestamp(), actualizadoEn: FieldValue.serverTimestamp(),
  }, 'aplicar');
}

async function revertir(db: Firestore) {
  const snap = await db.collection('movimientos').where('cerradoPor', '==', MARCA).get();
  return escribirEnLotes(db, snap.docs.map(d => d.ref), {
    pagado: false, cerradoPor: FieldValue.delete(), cerradoEn: FieldValue.delete(),
  }, 'revertir');
}

// ── el dry-run ───────────────────────────────────────────────────────────────────────────────────
// La lista de F9.184 §0.1 (a), para comparar uno por uno si el número no da 134.
function listaF9184(): string[] {
  const t = fs.readFileSync('docs/F9.184.txt', 'utf8');
  return t.split(/\r?\n/).filter(l => /^ {2}\S{8} \| \d{4}-\d{2} \| vence/.test(l)).map(l => {
    const p = l.split('|').map(x => x.trim());
    return `${p[0]}|${p[1]}|${p[3].replace(/\s+/g, ' ')}`;
  });
}
const claveDe = (id: string, x: FirebaseFirestore.DocumentData) =>
  `${id.slice(0, 8)}|${x.mes}|${x.moneda} ${fmt(Math.abs(Number(x.monto)))}`;

async function dryRun(db: Firestore) {
  const sim = crearSim(db);
  type ObMod = typeof import('../src/datos/obligaciones');
  type ChkMod = { calcularChecklist: (i: ExpectedItem[], m: Movement[], mes: string) => CheckItem[] };
  const OB = sim.cargar<ObMod>('src/datos/obligaciones.ts');
  const CHK = sim.cargar<ChkMod>('src/datos/checklist.ts');
  const MOV = sim.cargar<{ docAMovimiento: (id: string, d: FirebaseFirestore.DocumentData) => Movement }>('src/datos/movimientos.ts');
  const ITEMS = sim.cargar<{ docAItemEsperado: (id: string, d: FirebaseFirestore.DocumentData) => ExpectedItem }>('src/datos/itemsEsperados.ts');

  const docs = await universo(db);
  console.log(`── universo: pagado == false · tipo Gasto · mes < ${CORTE} · sin confirmadoPago → ${docs.length} (esperado ${ESPERADO})`);
  if (docs.length !== ESPERADO) {
    const ref = listaF9184();
    const ahora = docs.map(d => claveDe(d.id, d.data()));
    const sobran = ahora.filter(k => { const i = ref.indexOf(k); if (i >= 0) { ref.splice(i, 1); return false; } return true; });
    console.log(`>>> NO DA ${ESPERADO}: PARAR. Diferencia contra la lista de docs/F9.184.txt §0.1 (a):`);
    for (const k of sobran) console.log(`    + nueva desde F9.184: ${k}`);
    for (const k of ref) console.log(`    − estaba en F9.184 y ya no: ${k}`);
    return { docs, ok: false };
  }

  const porMoneda: Record<string, number> = {};
  const porMes: Record<string, number> = {};
  for (const d of docs) {
    const x = d.data();
    porMoneda[x.moneda] = (porMoneda[x.moneda] ?? 0) + Math.abs(Number(x.monto));
    porMes[x.mes] = (porMes[x.mes] ?? 0) + 1;
  }
  console.log(`   suma: ${Object.entries(porMoneda).map(([m, v]) => `${m} ${fmt(v)}`).join(' · ')}`);
  console.log(`   por mes: ${Object.entries(porMes).sort().map(([m, n]) => `${m}: ${n}`).join(' · ')}`);
  console.log(`   prefijos: HIS_ ${docs.filter(d => d.id.startsWith('HIS_')).length} · OBL- ${docs.filter(d => d.id.startsWith('OBL-')).length} · otros ${docs.filter(d => !/^(HIS_|OBL-)/.test(d.id)).length}`);
  const conConf = (await db.collection('movimientos').where('pagado', '==', false).get()).docs
    .filter(d => d.data().tipo === 'Gasto' && d.data().mes < CORTE && d.data().confirmadoPago === true);
  console.log(`   excluidas por confirmadoPago == true (ya cubiertas, par imposible de F9.140): ${conConf.length}`);

  // Lo abierto que NO se toca.
  const todas = await db.collection('movimientos').get();
  const movs = todas.docs.map(d => MOV.docAMovimiento(d.id, d.data()));
  const abiertas = movs.filter(m => OB.esObligacionAbierta(m));
  const quedan = abiertas.filter(m => m.mes >= CORTE).sort((a, b) => a.mes.localeCompare(b.mes) || OB.fechaEfectivaMov(a).getTime() - OB.fechaEfectivaMov(b).getTime());
  console.log(`\n── lo abierto que NO se toca (mes >= ${CORTE}): ${quedan.length}`);
  for (const m of quedan) console.log(`    ${h8(m.id)} | ${m.mes} | vence ${OB.fechaEfectivaMov(m).toLocaleDateString('sv-SE')} | ${m.moneda} ${fmt(Math.abs(m.monto)).padStart(13)} | ${corto(m.descripcion)}`);

  // Resultado esperado en el Resumen de octubre, con las funciones reales de obligaciones.ts.
  const ids = new Set(docs.map(d => d.id));
  const despues = abiertas.filter(m => !ids.has(m.id));
  const hoy = new Date();
  const items = (await db.collection('itemsEsperados').get()).docs.map(d => ITEMS.docAItemEsperado(d.id, d.data()));
  const movsOct = movs.filter(m => m.mes === CORTE);
  const chk = CHK.calcularChecklist(items, movsOct, CORTE);
  const foto = (abiertasTodas: Movement[]) => {
    const venc = OB.vencidasParaResumen(movsOct, abiertasTodas, CORTE, hoy, true);
    const pm = OB.pendienteMes(chk, movsOct, abiertasTodas, CORTE, hoy, true);
    const camp = OB.obligacionesParaCampana(OB.obligacionesAbiertas(abiertasTodas, hoy), hoy, 14);
    return { venc, pm, camp };
  };
  const a = foto(abiertas), b = foto(despues);
  console.log(`\n── Resumen de ${CORTE}, hoy ${hoy.toLocaleDateString('sv-SE')} (funciones reales de src/datos/obligaciones.ts), con F9.184 deployado:`);
  console.log(`   card de vencidos:  sin el cierre ${a.venc.length} · ${fmt(a.venc.reduce((s, o) => s + Math.abs(o.mov.monto), 0))}  →  con el cierre ${b.venc.length} · ${fmt(b.venc.reduce((s, o) => s + Math.abs(o.mov.monto), 0))}`);
  console.log(`   banner pendiente:  ${fmt(a.pm.monto)} (${a.pm.vencidos} vencidos)  →  ${fmt(b.pm.monto)} (${b.pm.vencidos} vencidos, ${b.pm.obligaciones} obligaciones)`);
  console.log(`   campana:           ${a.camp.length} (${a.camp.filter(o => o.estado === 'vencida').length} vencidas)  →  ${b.camp.length} (${b.camp.filter(o => o.estado === 'vencida').length} vencidas, ${b.camp.filter(o => o.estado === 'hoy').length} hoy, ${b.camp.filter(o => o.estado === 'proxima').length} próximas)`);
  for (const o of b.venc) console.log(`     queda vencida: ${h8(o.mov.id)} ${o.mov.mes} ${corto(o.mov.descripcion)} ${fmt(o.mov.monto)} (venció ${o.fechaEfectiva.toLocaleDateString('sv-SE')})`);
  for (const o of b.camp) console.log(`     en la campana: ${h8(o.mov.id)} ${o.mov.mes} ${corto(o.mov.descripcion)} ${fmt(o.mov.monto)} · ${o.estado} (${o.fechaEfectiva.toLocaleDateString('sv-SE')})`);
  const sinCargar = chk.filter(c => c.item.tipo === 'Gasto' && c.matches.length === 0 && !['pagado', 'automatico'].includes(c.estado));
  console.log(`   el banner después = ${b.pm.obligaciones} obligaciones abiertas de octubre ${fmt(OB.obligacionesAbiertas(movsOct, hoy).reduce((s, o) => s + Math.abs(o.mov.monto), 0))}` +
    ` + ${sinCargar.length} ítems sin nada cargado a su montoEsperado ${fmt(sinCargar.reduce((s, c) => s + (c.item.montoEsperado ?? 0), 0))}`);

  // Pares de cierre de tarjeta duplicados por la migración (solo reporte).
  console.log('\n── pares HIS_ / OBL- con el mismo mes, moneda y monto (duplicados de la migración; solo reporte)');
  // Solo los cierres de tarjeta: el HIS_ es el "Pago Visa/Mastercard …" del resumen. Sin este filtro
  // aparean por casualidad consumos (AMAZON PRIME 14,99) con obligaciones del mismo monto.
  const his = todas.docs.filter(d => d.id.startsWith('HIS_') && /^pago (visa|mastercard)/i.test(String(d.data().descripcion ?? '')));
  const obl = todas.docs.filter(d => d.id.startsWith('OBL-'));
  let pares = 0;
  const cuenta = (x: FirebaseFirestore.DocumentData) =>
    `Dashboard ${x.excluirDash ? 'NO (excluirDash)' : 'SÍ'} · Resumen ${x.incluirResumenMes ? 'SÍ' : 'NO'}`;
  for (const hd of his) {
    const h = hd.data();
    const gemelos = obl.filter(od => { const o = od.data(); return o.mes === h.mes && o.moneda === h.moneda && Math.abs(Number(o.monto) - Number(h.monto)) <= 1 && o.tipo === h.tipo; });
    for (const od of gemelos) {
      const o = od.data();
      pares++;
      const enCierre = `${ids.has(hd.id) ? 'HIS_ se cierra' : 'HIS_ no'} / ${ids.has(od.id) ? 'OBL- se cierra' : 'OBL- no'}`;
      const dif = Math.abs(Number(o.monto) - Number(h.monto));
      console.log(`   ${h.mes} ${h.moneda} ${fmt(Number(h.monto)).padStart(13)}${dif >= 0.005 ? ` (≠ ${fmt(Number(o.monto))})` : ''} | ${h8(hd.id)} "${corto(h.descripcion, 26)}" [${cuenta(h)}${h.resumenTarjetaId ? ', de resumen' : ''}, pagado=${h.pagado}]`);
      console.log(`   ${' '.repeat(7 + 4 + 14)} | ${h8(od.id)} "${corto(o.descripcion, 26)}" [${cuenta(o)}${o.itemEsperadoId ? ', con ítem' : ''}, pagado=${o.pagado}] · ${enCierre}`);
    }
  }
  console.log(`   ${pares} pares`);
  return { docs, ok: true };
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
  const foto = async () => new Map((await db.collection('movimientos').get()).docs.map(d => [d.id, JSON.stringify(d.data(), (_k, v) => (v && typeof v === 'object' && typeof v.toMillis === 'function' ? `ts:${v.toMillis()}` : v))]));
  const antes = await foto();
  let fallas = 0;
  const ok = (c: boolean, t: string) => { if (!c) fallas++; console.log(`  ${c ? 'OK' : '✗'} ${t}`); };
  console.log(`emulador: ${fx.length} movimientos sembrados\n`);

  const u1 = await universo(db);
  ok(u1.length === ESPERADO, `dry-run: ${u1.length} (esperado ${ESPERADO})`);
  const escritos = await aplicar(db, u1);
  ok(escritos.length === ESPERADO, `--aplicar escribió ${escritos.length} en ${Math.ceil(escritos.length / LOTE)} batch(es)`);
  const tras = await db.collection('movimientos').get();
  const cerrados = tras.docs.filter(d => d.data().cerradoPor === MARCA);
  ok(cerrados.length === ESPERADO && cerrados.every(d => d.data().pagado === true && d.data().cerradoEn && d.data().actualizadoEn), `${cerrados.length} con pagado=true + cerradoPor + cerradoEn + actualizadoEn`);
  // Ningún otro campo cambió, y nada fuera del universo se tocó.
  let otros = 0, conf = 0;
  for (const d of tras.docs) {
    const prev = JSON.parse(antes.get(d.id)!);
    const now = JSON.parse(JSON.stringify(d.data(), (_k, v) => (v && typeof v === 'object' && typeof v.toMillis === 'function' ? `ts:${v.toMillis()}` : v)));
    const cambiados = Object.keys({ ...prev, ...now }).filter(k => JSON.stringify(prev[k]) !== JSON.stringify(now[k]));
    const permitidos = new Set(['pagado', 'cerradoPor', 'cerradoEn', 'actualizadoEn']);
    if (u1.some(x => x.id === d.id)) { if (cambiados.some(k => !permitidos.has(k))) otros++; if (prev.confirmadoPago !== now.confirmadoPago) conf++; }
    else if (cambiados.length) otros++;
  }
  ok(otros === 0 && conf === 0, `ningún otro campo cambió (${otros}), confirmadoPago intacto (${conf} cambios), nada fuera del universo se tocó`);
  const u2 = await universo(db);
  ok(u2.length === 0, `dry-run después de aplicar: ${u2.length} (esperado 0: idempotente)`);
  const abiertasOct = tras.docs.filter(d => d.data().pagado === false && d.data().tipo === 'Gasto' && d.data().mes >= CORTE).length;
  ok(abiertasOct === 8, `las de ${CORTE} y futuras siguen abiertas: ${abiertasOct}`);

  const rev = await revertir(db);
  ok(rev.length === ESPERADO, `--revertir deshizo ${rev.length}`);
  const despues = await foto();
  let distintos = 0, soloActualizado = 0;
  for (const [id, prevS] of antes) {
    const prev = JSON.parse(prevS), now = JSON.parse(despues.get(id)!);
    const cambiados = Object.keys({ ...prev, ...now }).filter(k => JSON.stringify(prev[k]) !== JSON.stringify(now[k]));
    if (cambiados.length === 0) continue;
    if (cambiados.every(k => k === 'actualizadoEn')) soloActualizado++; else distintos++;
  }
  ok(distintos === 0, `después de revertir, todo igual al original salvo actualizadoEn (${soloActualizado} con actualizadoEn nuevo, ${distintos} con otra diferencia)`);
  const u3 = await universo(db);
  ok(u3.length === ESPERADO, `dry-run después de revertir: ${u3.length} (vuelven a ser ${ESPERADO})`);
  console.log(`\nPRUEBA EN EMULADOR: ${fallas === 0 ? 'TODO OK' : `${fallas} FALLA(S)`}`);
  return fallas;
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const emu = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (getApps().length === 0) {
    if (emu) initializeApp({ projectId: 'demo-f9185' });
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
    console.log(`revertidos ${r.length} (cerradoPor == '${MARCA}')`);
    return;
  }

  console.log(`F9.185 — ${APLICAR ? 'APLICAR' : 'DRY-RUN (no escribe nada)'} · ${emu ? 'EMULADOR' : 'PRODUCCIÓN'}\n`);
  const { docs, ok } = await dryRun(db);
  if (!APLICAR) { console.log(`\nDRY-RUN: ${ok ? 'listo para --aplicar' : 'NO aplicar: el universo no da ' + ESPERADO}`); return; }
  if (!ok) { console.log('>>> no se aplica: el universo no da el número esperado'); process.exit(1); }
  const escritos = await aplicar(db, docs);
  console.log(`\nAPLICADO: ${escritos.length} movimientos con pagado=true y cerradoPor='${MARCA}'`);
}

main().catch(e => { console.error(e); process.exit(1); });
