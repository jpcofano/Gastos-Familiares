// F9.180 — verificación del saldo a favor en el resumen de tarjeta. SOLO LECTURA.
//
//   npx tsx scripts/verificarF9180.ts --s0            → solo §0 (la medición que hace de GATE)
//   npx tsx scripts/verificarF9180.ts                 → §0 + §1 (cuadre viejo vs nuevo) + §3 (checklist)
//   npx tsx scripts/verificarF9180.ts --fixture X     → además deja en X el batch de §3 para el test de
//                                                       reglas en el emulador (scripts/testReglasF9180.ts)
//
// Mismo estilo que verificarF9179pre.ts: funciones reales de src/ (transpiladas en memoria por
// scripts/simConfirmarResumen.ts) y commit() simulado. "Viejo" es el código de BASE (origin/main al
// abrir F9.180) leído de git; "nuevo" es el árbol de trabajo.
//
// Privacidad: ids a 8 caracteres, descripciones recortadas.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'node:fs';
import { crearSim, clienteFS, esServerTimestamp, type OpBatch } from './simConfirmarResumen';
import type { CardStatement, ExpectedItem, FamiliaConfig, Movement, MovimientoParseado } from '../src/types';
import type { CuadreResult } from '../src/datos/resumenesTarjeta';
import type { DecisionAjustes } from '../src/datos/ajusteConsolidado';
import type { CheckItem } from '../src/datos/checklist';

process.env.TZ = 'America/Argentina/Buenos_Aires';
const BASE = '8834356';
const SOLO_S0 = process.argv.includes('--s0');
const iFix = process.argv.indexOf('--fixture');
const FIXTURE = iFix > 0 ? process.argv[iFix + 1] : null;
const RES_2A0 = '2a0f81f8';
const TOL = { ARS: 1, USD: 0.01 } as const;

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const adminDb = getFirestore();
const sim = crearSim(adminDb);

type Netos = { noDebitadoARS: number; noDebitadoUSD: number; objetivoARS: number; objetivoUSD: number };
type RTMod = {
  docACardStatement: (id: string, data: FirebaseFirestore.DocumentData) => CardStatement;
  calcularCuadre: (l: MovimientoParseado[], tARS: number, tUSD: number, aj: CardStatement['ajustesConsolidado'], c?: CardStatement | null) => CuadreResult;
  totalesNetos: (l: MovimientoParseado[], tARS: number, tUSD: number, c?: CardStatement | null) => Netos;
  clavesDeResumen: (r: CardStatement) => string[];
  confirmarResumenTarjeta: (r: CardStatement, l: MovimientoParseado[], memberId: string, cfg: FamiliaConfig) =>
    Promise<{ ok: true; data: void } | { ok: false; error: Error }>;
};
type AjMod = { decidirAjustesConsolidado: (aj: CardStatement['ajustesConsolidado'], c: CardStatement | null) => DecisionAjustes };
type FamMod = { cargarFamiliaConfig: () => Promise<FamiliaConfig | null>; resolverNombreMiembro: (n: string, c: FamiliaConfig) => string | null };
type MovMod = { docAMovimiento: (id: string, data: FirebaseFirestore.DocumentData) => Movement };
type ItemsMod = { docAItemEsperado: (id: string, data: FirebaseFirestore.DocumentData) => ExpectedItem };
type ChkMod = { calcularChecklist: (items: ExpectedItem[], movs: Movement[], mes: string) => CheckItem[] };

const RT_VIEJO = sim.cargar<RTMod>('src/datos/resumenesTarjeta.ts', BASE);
const RT = sim.cargar<RTMod>('src/datos/resumenesTarjeta.ts');
const AJ = sim.cargar<AjMod>('src/datos/ajusteConsolidado.ts');
const FAM = sim.cargar<FamMod>('src/familia.ts');
const MOV = sim.cargar<MovMod>('src/datos/movimientos.ts');
const ITEMS = sim.cargar<ItemsMod>('src/datos/itemsEsperados.ts');
const CHK = sim.cargar<ChkMod>('src/datos/checklist.ts');

// ── salida ────────────────────────────────────────────────────────────────────
const h8 = (s: unknown) => (s ? String(s).slice(0, 8) : '-');
const s = (v: unknown) => (v === null ? 'null' : v === undefined ? '(ausente)' : String(v));
const corto = (v: unknown, n = 24) => { const t = String(v ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };
const num = (n: number | null | undefined, dec = 2) => (n == null ? '—' : n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
const r2 = (n: number) => Math.round(n * 100) / 100;
const fechaAR = (v: unknown) => {
  const t = v as { toDate?: () => Date } | null | undefined;
  return t?.toDate ? t.toDate().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }) : s(v);
};
const ok = (c: boolean) => (c ? 'OK' : '✗');
type Moneda = 'ARS' | 'USD';
const MONEDAS: Moneda[] = ['ARS', 'USD'];

const enMoneda = (c: CuadreResult, m: Moneda) => m === 'ARS'
  ? { objetivo: c.objetivoARS, suma: c.sumaARS, diff: c.diffARS, balance: c.balanceARS }
  : { objetivo: c.objetivoUSD, suma: c.sumaUSD, diff: c.diffUSD, balance: c.balanceUSD };

function arrastreDe(r: CardStatement, m: Moneda): number | null {
  const saldo = m === 'ARS' ? r.saldoAnteriorARS : r.saldoAnteriorUSD;
  const pagos = m === 'ARS' ? r.pagosDelPeriodoARS : r.pagosDelPeriodoUSD;
  return typeof saldo === 'number' && typeof pagos === 'number' ? r2(saldo + pagos) : null;
}

/** Σ líneas con el signo de tipoDeLinea, como las cuenta el cuadre: las incluidas y no debitadas
 *  entran en la suma; las no debitadas, por el lado del objetivo. Con las funciones viejas, que
 *  no saben de arrastre: total 0, sin ajustes. */
function lineasFirmadas(l: MovimientoParseado[]): Record<Moneda, number> {
  const cu = RT_VIEJO.calcularCuadre(l, 0, 0, [], null);
  const nd = RT_VIEJO.totalesNetos(l, 0, 0);
  return { ARS: r2(cu.sumaARS + nd.noDebitadoARS), USD: r2(cu.sumaUSD + nd.noDebitadoUSD) };
}

async function checklistDe(items: ExpectedItem[], mes: string, extra: Movement[] = []): Promise<CheckItem[]> {
  const snap = await adminDb.collection('movimientos').where('mes', '==', mes).get();
  const movs = snap.docs.map(d => MOV.docAMovimiento(d.id, d.data()));
  return CHK.calcularChecklist(items, [...movs, ...extra], mes);
}

async function main() {
  const ahora = new Date().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
  console.log('F9.180 — Saldo a favor en el resumen de tarjeta: verificación');
  console.log(`corrido: ${ahora} (AR) · viejo = ${BASE} (git) · nuevo = árbol de trabajo · SOLO LECTURA (commit() simulado)`);
  console.log(`modo: ${SOLO_S0 ? '§0 solo (gate, antes de tocar código)' : '§0 + §1 + §3'}\n`);

  const resSnap = await adminDb.collection('resumenesTarjeta').get();
  const todos = resSnap.docs
    .map(d => RT.docACardStatement(d.id, d.data()))
    .sort((a, b) => a.periodo.localeCompare(b.periodo) || s(a.tarjetaCodigo).localeCompare(s(b.tarjetaCodigo)));
  const itemsSnap = await adminDb.collection('itemsEsperados').get();
  const items = itemsSnap.docs.map(d => ITEMS.docAItemEsperado(d.id, d.data()));

  // ════ §0.1 — identidad del estado de cuenta ════
  console.log('=== §0.1 Identidad: total == saldoAnterior + pagosDelPeriodo + Σ ajustes(pdf) + Σ líneas incluidas ===');
  console.log(`tolerancia: ARS ${TOL.ARS} · USD ${TOL.USD} · líneas con el signo de tipoDeLinea (las no debitadas cuentan: están en el total del PDF)`);
  console.log('A = saldoAnterior + pagosDelPeriodo · resid = total − (A + Σaj + Σlín) · "s/c" = sin campos, A tomado como 0 solo para mostrar\n');
  const conCampos: Record<Moneda, number> = { ARS: 0, USD: 0 };
  const cierran: Record<Moneda, number> = { ARS: 0, USD: 0 };
  const noCierran: string[] = [];
  let sinCampos = 0, ndSinIncluir = 0;
  const aArsNoCero: string[] = [];
  for (const r of todos) {
    const lin = lineasFirmadas(r.movimientosParseados);
    ndSinIncluir += r.movimientosParseados.filter(l => l.noDebitado && !l.incluir && l.monto > 0).length;
    const pdf = r.ajustesConsolidado.filter(a => a.origen !== 'manual');
    const manuales = r.ajustesConsolidado.length - pdf.length;
    const dec = AJ.decidirAjustesConsolidado(r.ajustesConsolidado, r);
    const partes: string[] = [];
    let faltan = false;
    for (const m of MONEDAS) {
      const total = m === 'ARS' ? r.totalARS : r.totalUSD;
      const A = arrastreDe(r, m);
      const sumAj = r2(pdf.reduce((acc, a) => acc + Number((m === 'ARS' ? a.montoARS : a.montoUSD) ?? 0), 0));
      const resid = r2(total - ((A ?? 0) + sumAj + lin[m]));
      const cierra = Math.abs(resid) <= TOL[m];
      if (A == null) faltan = true;
      else {
        conCampos[m]++;
        if (cierra) cierran[m]++;
        else noCierran.push(`${h8(r.id)} ${m} resid=${num(resid)}`);
      }
      partes.push(`${m}: total=${num(total)} A=${A == null ? 's/c' : num(A)} Σaj=${num(sumAj)} Σlín=${num(lin[m])} resid=${num(resid)} ${A == null ? '(s/c)' : ok(cierra)}`);
    }
    if (faltan) sinCampos++;
    const aArs = arrastreDe(r, 'ARS');
    if (aArs != null && Math.abs(aArs) > TOL.ARS && dec.decision !== 'ignora') aArsNoCero.push(`${h8(r.id)} A_ARS=${num(aArs)} (${dec.decision})`);
    console.log(`  ${h8(r.id)} ${s(r.tarjetaCodigo).padEnd(14)} ${r.periodo.padEnd(8)} ${r.estado.padEnd(10)} F9.163=${dec.decision}` +
      `${dec.a != null ? ` (a=${num(dec.a)} b=${num(dec.b)})` : ''}${manuales ? ` · manuales=${manuales}` : ''}`);
    for (const p of partes) console.log(`      ${p}`);
  }
  console.log(`\n  resúmenes: ${todos.length} · sin saldoAnterior*/pagosDelPeriodo* en alguna moneda: ${sinCampos}`);
  for (const m of MONEDAS) console.log(`  con campos en ${m}: ${conCampos[m]} · la identidad cierra en ${cierran[m]}`);
  console.log(`  líneas noDebitado con incluir=false (cuentan igual, por el objetivo): ${ndSinIncluir}`);
  console.log(`  no cierran: ${noCierran.length ? noCierran.join(' · ') : 'ninguno'}`);
  console.log(`  A de ARS lejos de 0 en resúmenes que no son 'ignora': ${aArsNoCero.length ? aArsNoCero.join(' · ') : 'ninguno'}`);
  const gate1 = noCierran.length === 0;
  console.log(`  GATE §1: ${gate1 ? 'PASA — la identidad cierra en todos los que tienen los campos' : '>>> NO PASA — §1 se para'}\n`);

  // ════ §0.2 — ítems esperados de tarjeta ════
  console.log('=== §0.2 Ítems esperados con tarjetaCodigo ===');
  const deTarjeta = items.filter(i => i.tarjetaCodigo);
  for (const i of deTarjeta) {
    console.log(`  ${h8(i.id)} ${s(i.tarjetaCodigo).padEnd(14)} ${i.moneda} montoEsperado=${s(i.montoEsperado).padEnd(10)} activo=${i.activo}`);
  }
  const noNulos = deTarjeta.filter(i => i.montoEsperado != null);
  console.log(`  total: ${deTarjeta.length} · con montoEsperado no nulo: ${noNulos.length}` +
    `${noNulos.length ? ` (${noNulos.map(i => `${i.tarjetaCodigo} ${i.moneda}=${i.montoEsperado}`).join(', ')})` : ''}`);
  const usdNoNulo = noNulos.filter(i => i.moneda === 'USD');
  console.log(`  ítems USD de tarjeta con montoEsperado no nulo: ${usdNoNulo.length}` +
    `${usdNoNulo.length ? ' — con un total en 0, montoConf 0 < montoEsperado·0,99 solo si montoEsperado > 0' : ''}\n`);

  // ════ §0.3 — los totales en 0 que ya existen ════
  console.log('=== §0.3 Movimientos-total USD de los resúmenes confirmados con objetivo USD <= 0 ===');
  const conf0 = todos.filter(r => r.estado === 'confirmado' && RT_VIEJO.totalesNetos(r.movimientosParseados, r.totalARS, r.totalUSD).objetivoUSD <= 0);
  for (const r of conf0) {
    const propios: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    for (const k of RT.clavesDeResumen(r)) propios.push(...(await adminDb.collection('movimientos').where('resumenTarjetaId', '==', k).get()).docs);
    const tot = propios.filter(d => d.data().excluirDash === true && d.data().moneda === 'USD');
    console.log(`  ${h8(r.id)} ${s(r.tarjetaCodigo).padEnd(14)} periodo=${r.periodo} objetivoUSD=${num(RT_VIEJO.totalesNetos(r.movimientosParseados, r.totalARS, r.totalUSD).objetivoUSD)} · movimientos del resumen: ${propios.length} · totales USD: ${tot.length}`);
    for (const d of tot) {
      const x = d.data();
      // El ítem que lo reclama en el checklist de su mes: por itemEsperadoId (pase 1) o por la
      // heurística (pase 2). Si ninguno lo reclama, el total no figura en el Resumen.
      const chk = (await checklistDe(items, x.mes)).find(c => c.matches.some(m => m.id === d.id));
      console.log(`      mov ${h8(d.id)} monto=${s(x.monto)} pagado=${s(x.pagado)} confirmadoPago=${s(x.confirmadoPago)} pagadoEn=${fechaAR(x.pagadoEn)} ` +
        `itemEsperadoId=${h8(x.itemEsperadoId)} mes=${s(x.mes)} creadoEn=${fechaAR(x.creadoEn)}`);
      console.log(`      calcularChecklist(${x.mes}) → ${chk ? `ítem ${chk.item.tarjetaCodigo ?? chk.item.categoria} ${chk.item.moneda}: ${chk.estado} (matches: ${chk.matches.length})` : 'ningún ítem activo lo reclama: no figura en el checklist'}`);
    }
  }
  console.log('');

  if (SOLO_S0) return;

  // ════ §1 — cuadre viejo vs nuevo ════
  console.log('=== §1 calcularCuadre viejo (base) vs nuevo (árbol), sobre lo guardado (líneas y ajustes, incluidos los manuales) ===');
  let cambian = 0, rompeConfirmado = 0;
  for (const r of todos) {
    const v = RT_VIEJO.calcularCuadre(r.movimientosParseados, r.totalARS, r.totalUSD, r.ajustesConsolidado, r);
    const n = RT.calcularCuadre(r.movimientosParseados, r.totalARS, r.totalUSD, r.ajustesConsolidado, r);
    const cambia = v.balanceARS !== n.balanceARS || v.balanceUSD !== n.balanceUSD;
    const sinDecidir = v.decisionAjustes.decision === 'sin_decidir';
    if (cambia) cambian++;
    if (r.estado === 'confirmado' && v.balanceARS && v.balanceUSD && !(n.balanceARS && n.balanceUSD)) rompeConfirmado++;
    if (!cambia && !sinDecidir && r.id.slice(0, 8) !== RES_2A0) continue;
    console.log(`  ${h8(r.id)} ${s(r.tarjetaCodigo).padEnd(14)} ${r.periodo} ${r.estado.padEnd(10)} F9.163=${v.decisionAjustes.decision}${cambia ? ' · CAMBIA' : ''}`);
    for (const m of MONEDAS) {
      const a = enMoneda(v, m), b = enMoneda(n, m);
      console.log(`      ${m}: viejo objetivo=${num(a.objetivo)} suma=${num(a.suma)} diff=${num(a.diff)} balance=${a.balance}` +
        `  →  nuevo objetivo=${num(b.objetivo)} suma=${num(b.suma)} diff=${num(b.diff)} balance=${b.balance}`);
    }
  }
  console.log(`  cambian de balance: ${cambian} · confirmados que pasan de cuadrar a no cuadrar: ${rompeConfirmado} (esperado 0) ${ok(rompeConfirmado === 0)}`);

  const r2a0 = todos.find(r => r.id.startsWith(RES_2A0))!;
  const sinManual = { ...r2a0, ajustesConsolidado: r2a0.ajustesConsolidado.filter(a => a.origen !== 'manual') };
  const esperado = RT.calcularCuadre(sinManual.movimientosParseados, sinManual.totalARS, sinManual.totalUSD, sinManual.ajustesConsolidado, sinManual);
  console.log(`\n  esperado: ${RES_2A0} con el reverso tildado (lo guardado) y SIN el ajuste manual, cuadre nuevo:`);
  console.log(`      ARS objetivo=${num(esperado.objetivoARS)} suma=${num(esperado.sumaARS)} diff=${num(esperado.diffARS)} balance=${esperado.balanceARS}`);
  console.log(`      USD objetivo=${num(esperado.objetivoUSD)} suma=${num(esperado.sumaUSD)} diff=${num(esperado.diffUSD)} balance=${esperado.balanceUSD}`);
  const okEsperado = esperado.balanceARS && esperado.balanceUSD && esperado.diffARS < 0.005 && esperado.diffUSD < 0.005;
  console.log(`      → ${okEsperado ? 'cuadra en las dos monedas con diff 0' : '>>> NO cuadra como se esperaba'} ${ok(okEsperado)}\n`);

  // ════ §3 — el total en 0 figura pagado ════
  console.log(`=== §3 Confirmar ${RES_2A0} HOY (antes del vencimiento), sin el ajuste manual, y el checklist de 2026-10 ===`);
  const config = await FAM.cargarFamiliaConfig();
  if (!config) { console.log('  >>> sin config/familia'); return; }
  const lineasUI = sinManual.movimientosParseados.map(l => ({
    ...l, personaConfirmada: l.personaDetectada ? FAM.resolverNombreMiembro(l.personaDetectada, config) : null,
  }));
  const memberId = s(sinManual.subidoPor);
  sim.reset();
  const resViejo = await RT_VIEJO.confirmarResumenTarjeta(sinManual, lineasUI, memberId, config);
  console.log(`  código viejo: ${resViejo.ok ? 'commit alcanzado' : `cortó antes del commit — ${resViejo.error.message}`}`);
  sim.reset();
  const res = await RT.confirmarResumenTarjeta(sinManual, lineasUI, memberId, config);
  if (!res.ok) { console.log(`  >>> código nuevo: cortó antes del commit — ${res.error.message}`); return; }
  const ops: OpBatch[] = sim.batches[0] ?? [];
  const sets = ops.filter(o => o.op === 'set');
  console.log(`  código nuevo: commit alcanzado · ${sets.length} create + ${ops.filter(o => o.op === 'update').length} update + ${ops.filter(o => o.op === 'delete').length} delete`);
  const totales = sets.filter(o => o.data?.excluirDash === true);
  for (const o of totales) {
    const d = o.data!;
    console.log(`      total ${d.moneda}: monto=${s(d.monto)} pagado=${s(d.pagado)} confirmadoPago=${s(d.confirmadoPago)} ` +
      `pagadoEn=${'pagadoEn' in d ? (esServerTimestamp(d.pagadoEn) ? 'serverTimestamp()' : s(d.pagadoEn)) : '(no se escribe)'} mes=${s(d.mes)} itemEsperadoId=${h8(d.itemEsperadoId)}`);
  }
  const invariante = sets.every(o => o.data?.confirmadoPago !== true || o.data?.pagado === true);
  console.log(`      invariante F9.140 (confirmadoPago ⇒ pagado) en los ${sets.length} creates: ${ok(invariante)}`);

  // Lo que el servidor guarda: los serverTimestamp() pasan a ser la hora del commit.
  const ahoraTs = clienteFS.Timestamp.now();
  const comoGuardado = (d: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(d).map(([k, v]) => [k, esServerTimestamp(v) ? ahoraTs : v]));
  const simulados = sets.map(o => MOV.docAMovimiento(o.ref.id, comoGuardado(o.data!)));
  const delMes = simulados.filter(m => m.mes === '2026-10');
  const chk = await checklistDe(items, '2026-10', delMes);
  for (const c of chk.filter(c => c.item.tarjetaCodigo === sinManual.tarjetaCodigo)) {
    console.log(`  checklist 2026-10 · ítem ${c.item.tarjetaCodigo} ${c.item.moneda} (${h8(c.item.id)}, montoEsperado=${s(c.item.montoEsperado)}): ` +
      `${c.estado} · matches: ${c.matches.map(m => `${h8(m.id)} ${m.moneda} ${m.monto} conf=${m.confirmadoPago}`).join(', ') || '—'}`);
  }
  const usd = chk.find(c => c.item.tarjetaCodigo === sinManual.tarjetaCodigo && c.item.moneda === 'USD');
  console.log(`  → ítem USD de ${sinManual.tarjetaCodigo} en 2026-10: ${s(usd?.estado)} (esperado: pagado) ${ok(usd?.estado === 'pagado')}`);

  // estadoItem: los ítems cuyos confirmados son todos movimientos-total de resumen ya no se comparan
  // contra montoEsperado. Qué cambia sobre los datos reales, sin nada simulado.
  console.log('\n  estadoItem viejo vs nuevo sobre los movimientos reales (sin simular nada), ítems de tarjeta:');
  const CHK_VIEJO = sim.cargar<ChkMod>('src/datos/checklist.ts', BASE);
  let cambiosChk = 0;
  for (const mes of ['2026-07', '2026-08', '2026-09', '2026-10']) {
    const snap = await adminDb.collection('movimientos').where('mes', '==', mes).get();
    const movs = snap.docs.map(d => MOV.docAMovimiento(d.id, d.data()));
    const viejo = CHK_VIEJO.calcularChecklist(items, movs, mes);
    const nuevo = CHK.calcularChecklist(items, movs, mes);
    for (const c of nuevo.filter(c => c.item.tarjetaCodigo)) {
      const v = viejo.find(x => x.item.id === c.item.id);
      const conf = c.matches.filter(m => m.confirmadoPago).reduce((acc, m) => acc + Math.abs(m.monto), 0);
      const marca = v?.estado !== c.estado ? ' · CAMBIA' : '';
      if (marca) cambiosChk++;
      console.log(`    ${mes} ${s(c.item.tarjetaCodigo).padEnd(14)} ${c.item.moneda} montoEsperado=${s(c.item.montoEsperado).padEnd(10)} confirmado=${num(conf)} ` +
        `→ viejo ${s(v?.estado)} / nuevo ${c.estado}${marca}`);
    }
  }
  console.log(`    ítems de tarjeta que cambian de estado: ${cambiosChk}`);

  if (FIXTURE) {
    // Para el test del emulador: el batch tal cual, con Timestamp y serverTimestamp marcados.
    const ser = (v: unknown): unknown => {
      if (v instanceof clienteFS.Timestamp) return { __ts: v.toMillis() };
      if (esServerTimestamp(v)) return { __st: true };
      if (Array.isArray(v)) return v.map(ser);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, ser(x)]));
      return v;
    };
    const lote = { resumenId: sinManual.id, memberId, ops: ops.map(o => ({ op: o.op, path: o.ref.path, data: o.data ? ser(o.data) : null })) };
    fs.writeFileSync(FIXTURE, JSON.stringify(lote));
    console.log(`\n  fixture del batch → ${FIXTURE} (${lote.ops.length} ops; no se commitea: tiene descripciones reales)`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
