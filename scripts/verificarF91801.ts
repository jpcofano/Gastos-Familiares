// F9.180.1 — "Cerrar diferencia" contra el objetivo, una moneda por vez, y quitar ajustes manuales.
// SOLO LECTURA: lecturas por Admin SDK; updateDoc, runTransaction y commit() simulados
// (scripts/simConfirmarResumen.ts). Nada llega a Firestore.
//
//   npx tsx scripts/verificarF91801.ts --s0   → solo §0 (cierre de F9.180, gate de §4, ajustes manuales)
//   npx tsx scripts/verificarF91801.ts        → §0 + la verificación (escenarios A, B, C y §4)
//
// "Viejo" = BASE (origin/main al abrir F9.180.1), leído de git; "nuevo" = árbol de trabajo.
// Privacidad: ids a 8 caracteres, descripciones recortadas.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getSecurityRules } from 'firebase-admin/security-rules';
import { crearSim, esServerTimestamp } from './simConfirmarResumen';
import type { AjusteConsolidado, CardStatement, ExpectedItem, Movement, MovimientoParseado } from '../src/types';
import type { CuadreResult } from '../src/datos/resumenesTarjeta';
import type { CheckItem } from '../src/datos/checklist';

process.env.TZ = 'America/Argentina/Buenos_Aires';
const BASE = '1de7c40';
const SOLO_S0 = process.argv.includes('--s0');
const RES_2A0 = '2a0f81f8';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const adminDb = getFirestore();
const sim = crearSim(adminDb);

type Moneda = 'ARS' | 'USD';
type Res = { ok: true; data: void } | { ok: false; error: Error };
type RTMod = {
  docACardStatement: (id: string, data: FirebaseFirestore.DocumentData) => CardStatement;
  calcularCuadre: (l: MovimientoParseado[], tARS: number, tUSD: number, aj: AjusteConsolidado[], c?: CardStatement | null) => CuadreResult;
  clavesDeResumen: (r: CardStatement) => string[];
  // F9.180.1 — solo en el código nuevo:
  residuoCuadre: (c: CuadreResult, m: Moneda) => number;
  monedasSinCuadrar: (c: CuadreResult) => Moneda[];
  agregarAjusteCuadreManual: (r: CardStatement, l: MovimientoParseado[], memberId: string, motivo: string, moneda?: Moneda) => Promise<Res>;
  quitarAjusteManual: (r: CardStatement, a: AjusteConsolidado) => Promise<Res>;
};
type MovMod = { docAMovimiento: (id: string, data: FirebaseFirestore.DocumentData) => Movement };
type ItemsMod = { docAItemEsperado: (id: string, data: FirebaseFirestore.DocumentData) => ExpectedItem };
type ChkMod = { calcularChecklist: (items: ExpectedItem[], movs: Movement[], mes: string) => CheckItem[] };

const RT_VIEJO = sim.cargar<RTMod>('src/datos/resumenesTarjeta.ts', BASE);
const RT = sim.cargar<RTMod>('src/datos/resumenesTarjeta.ts');
const MOV = sim.cargar<MovMod>('src/datos/movimientos.ts');
const ITEMS = sim.cargar<ItemsMod>('src/datos/itemsEsperados.ts');
const CHK = sim.cargar<ChkMod>('src/datos/checklist.ts');

// ── salida ────────────────────────────────────────────────────────────────────
const h8 = (s: unknown) => (s ? String(s).slice(0, 8) : '-');
const s = (v: unknown) => (v === null ? 'null' : v === undefined ? '(ausente)' : String(v));
const corto = (v: unknown, n = 60) => { const t = String(v ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };
const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fechaAR = (v: unknown) => {
  const t = v as { toDate?: () => Date } | null | undefined;
  return t?.toDate ? t.toDate().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }) : s(v);
};
const ok = (c: boolean) => (c ? 'OK' : '✗');
const MONEDAS: Moneda[] = ['ARS', 'USD'];
const enMoneda = (c: CuadreResult, m: Moneda) => (m === 'ARS'
  ? { objetivo: c.objetivoARS, suma: c.sumaARS, diff: c.diffARS, balance: c.balanceARS }
  : { objetivo: c.objetivoUSD, suma: c.sumaUSD, diff: c.diffUSD, balance: c.balanceUSD });
const casi = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 0.005;
const esReverso = (l: MovimientoParseado) => l.tipoLinea === 'reverso' && casi(l.monto, 149.96);
const esUsd029 = (l: MovimientoParseado) => l.moneda === 'USD' && casi(l.monto, 0.29);

let fallas = 0;
const chk = (que: string, c: boolean, detalle = '') => {
  if (!c) fallas++;
  console.log(`    ${ok(c)} ${que}${detalle ? ` — ${detalle}` : ''}`);
};

// Qué está deployado de F9.180: el ruleset activo (Admin SDK, lectura) y el bundle que sirve el
// hosting (GET público). Sirve para saber si una confirmación podría haber pasado.
async function reglasActivas(): Promise<string> {
  try {
    const rs = await getSecurityRules().getFirestoreRuleset();
    const fuente = rs.source.map(f => f.content).join('\n');
    return `ruleset ${h8(rs.name.split('/').pop())} creado ${new Date(rs.createTime).toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })} (AR)` +
      ` · trae la excepción de F9.180 §2: ${fuente.includes('request.resource.data.monto == 0') ? 'sí' : 'NO'}`;
  } catch (e) { return `no se pudo leer: ${(e as Error).message}`; }
}
async function clientePublicado(): Promise<string> {
  const url = 'https://gastos-familiares-jmsf.web.app';
  try {
    const html = await (await fetch(`${url}/`)).text();
    const js = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
    if (!js) return 'no encontré el bundle en el index';
    const res = await fetch(`${url}/${js}`);
    const cuerpo = await res.text();
    return `${js} (Last-Modified ${res.headers.get('last-modified')}) · trae la UI de F9.180: ` +
      `${cuerpo.includes('las líneas del mes tienen que dar') ? 'sí' : 'NO'}`;
  } catch (e) { return `no se pudo leer: ${(e as Error).message}`; }
}

function cuadreTxt(rt: RTMod, r: CardStatement, l: MovimientoParseado[], aj: AjusteConsolidado[]) {
  const c = rt.calcularCuadre(l, r.totalARS, r.totalUSD, aj, r);
  for (const m of MONEDAS) {
    const x = enMoneda(c, m);
    console.log(`    ${m}: objetivo=${num(x.objetivo)} suma=${num(x.suma)} residuo=${num(+(x.objetivo - x.suma).toFixed(2))} balance=${x.balance}`);
  }
  return c;
}

async function main() {
  const ahora = new Date().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
  console.log('F9.180.1 — "Cerrar diferencia" por moneda contra el objetivo, y quitar ajustes manuales: verificación');
  console.log(`corrido: ${ahora} (AR) · viejo = ${BASE} (git) · nuevo = árbol de trabajo · SOLO LECTURA (escrituras simuladas)`);
  console.log(`modo: ${SOLO_S0 ? '§0 solo (antes de tocar código)' : '§0 + verificación'}\n`);

  const resSnap = await adminDb.collection('resumenesTarjeta').get();
  const todos = resSnap.docs
    .map(d => RT_VIEJO.docACardStatement(d.id, d.data()))
    .sort((a, b) => a.periodo.localeCompare(b.periodo) || s(a.tarjetaCodigo).localeCompare(s(b.tarjetaCodigo)));
  const itemsSnap = await adminDb.collection('itemsEsperados').get();
  const items = itemsSnap.docs.map(d => ITEMS.docAItemEsperado(d.id, d.data()));
  const r2a0 = todos.find(r => r.id.startsWith(RES_2A0));
  if (!r2a0) throw new Error(`no está el resumen ${RES_2A0}`);

  // ════ §0.1 — el cierre real de F9.180 ════
  console.log(`=== §0.1 Post-deploy de F9.180: ${RES_2A0} (${r2a0.tarjetaCodigo} ${r2a0.periodo}) ===`);
  const crudo = resSnap.docs.find(d => d.id === r2a0.id)!.data();
  const propios: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const k of RT_VIEJO.clavesDeResumen(r2a0)) {
    for (const d of (await adminDb.collection('movimientos').where('resumenTarjetaId', '==', k).get()).docs) {
      if (!propios.some(p => p.id === d.id)) propios.push(d);
    }
  }
  const totales = propios.filter(d => d.data().excluirDash === true);
  const tUSD = totales.find(d => d.data().moneda === 'USD')?.data();
  const tARS = totales.find(d => d.data().moneda === 'ARS')?.data();
  const movsOct = (await adminDb.collection('movimientos').where('mes', '==', '2026-10').get()).docs.map(d => MOV.docAMovimiento(d.id, d.data()));
  const checkOct = CHK.calcularChecklist(items, movsOct, '2026-10').filter(c => c.item.tarjetaCodigo === r2a0.tarjetaCodigo);
  const estUSD = checkOct.find(c => c.item.moneda === 'USD')?.estado;
  const estARS = checkOct.find(c => c.item.moneda === 'ARS')?.estado;
  const difs: string[] = [];
  if (r2a0.estado !== 'confirmado') difs.push(`estado=${r2a0.estado}`);
  if (r2a0.ajustesConsolidado.length !== 0) difs.push(`ajustes=${r2a0.ajustesConsolidado.length}`);
  if (propios.length !== 45) difs.push(`movimientos=${propios.length}`);
  if (!tUSD || tUSD.monto !== 0 || tUSD.confirmadoPago !== true || !tUSD.pagadoEn) difs.push('total USD no es 0/confirmado/pagadoEn');
  if (estUSD !== 'pagado') difs.push(`checklist USD=${s(estUSD)}`);
  if (estARS !== 'por_confirmar' && !(estARS === 'pagado' && tARS?.confirmadoPago === true)) difs.push(`checklist ARS=${s(estARS)}`);
  console.log(`  CIERRE DE F9.180: ${difs.length === 0 ? 'coincide con lo esperado en todo' : `>>> NO COINCIDE: ${difs.join(' · ')}`}`);
  console.log(`  estado=${r2a0.estado} · confirmadoEn=${fechaAR(crudo.confirmadoEn)} · confirmadoPor=${s(crudo.confirmadoPor)} · actualizadoEn=${fechaAR(crudo.actualizadoEn)}`);
  console.log(`  ajustesConsolidado: ${r2a0.ajustesConsolidado.length} (esperado 0)`);
  console.log(`  movimientos con su clave: ${propios.length} (esperado 45) · totales: ${totales.length}`);
  for (const t of totales) {
    const x = t.data();
    console.log(`    total ${x.moneda}: monto=${s(x.monto)} pagado=${s(x.pagado)} confirmadoPago=${s(x.confirmadoPago)} pagadoEn=${fechaAR(x.pagadoEn)} ` +
      `itemEsperadoId=${h8(x.itemEsperadoId)} mes=${s(x.mes)} creadoEn=${fechaAR(x.creadoEn)}`);
  }
  const lin = r2a0.movimientosParseados;
  console.log(`  líneas guardadas: ${lin.length} · incluir=${lin.filter(l => l.incluir).length} · reverso 149,96 incluir=${s(lin.find(esReverso)?.incluir)} · USD 0,29 incluir=${s(lin.find(esUsd029)?.incluir)}`);
  for (const c of checkOct) {
    console.log(`  checklist 2026-10 · ${c.item.tarjetaCodigo} ${c.item.moneda}: ${c.estado} · matches: ${c.matches.map(m => `${h8(m.id)} ${m.moneda} ${m.monto} conf=${m.confirmadoPago}`).join(', ') || '—'}`);
  }
  console.log(`  (esperado: USD pagado; ARS por_confirmar, salvo que ya se haya confirmado el débito)`);
  console.log(`  deploy de F9.180 · reglas activas: ${await reglasActivas()}`);
  console.log(`  deploy de F9.180 · cliente publicado: ${await clientePublicado()}`);
  if (r2a0.estado !== 'confirmado' && r2a0.ajustesConsolidado.length === 0) {
    console.log('  lectura: el --aplicar de §4 corrió (no quedan ajustes) y lo deployado es F9.180, pero el resumen no se');
    console.log('  confirmó. Un batch rechazado no deja rastro: desde los datos no se distingue "no se intentó" de "falló".');
  }
  console.log('');

  // ════ §0.2 — alcance del `=== 0` (gate de §4) ════
  console.log(`=== §0.2 Resúmenes que hoy cuadran SOLO por la rama \`objetivo === 0\` (calcularCuadre de ${BASE}) ===`);
  console.log('  criterio: objetivo === 0 y |suma| > umbral (ARS: piso de $10, porque con objetivo 0 el umbral es 10; USD: 1)');
  const soloPorCero: Array<{ r: CardStatement; m: Moneda; suma: number }> = [];
  const objetivoCero: string[] = [];
  for (const r of todos) {
    const c = RT_VIEJO.calcularCuadre(r.movimientosParseados, r.totalARS, r.totalUSD, r.ajustesConsolidado, r);
    for (const m of MONEDAS) {
      const x = enMoneda(c, m);
      if (x.objetivo !== 0) continue;
      objetivoCero.push(`${h8(r.id)} ${m} (suma ${num(x.suma)})`);
      if (Math.abs(x.suma) > (m === 'ARS' ? 10 : 1)) soloPorCero.push({ r, m, suma: x.suma });
    }
  }
  console.log(`  con objetivo 0 en alguna moneda: ${objetivoCero.length ? objetivoCero.join(' · ') : 'ninguno'}`);
  const conf = soloPorCero.filter(x => x.r.estado === 'confirmado');
  const noConf = soloPorCero.filter(x => x.r.estado !== 'confirmado');
  for (const [titulo, lista] of [['confirmados', conf], ['no confirmados', noConf]] as const) {
    console.log(`  ${titulo}: ${lista.length}`);
    for (const x of lista) console.log(`    ${h8(x.r.id)} ${s(x.r.tarjetaCodigo).padEnd(14)} ${x.r.periodo} ${x.r.estado} · ${x.m}: objetivo 0, suma ${num(x.suma)}`);
  }
  const gate4 = conf.length === 0;
  console.log(`  GATE §4: ${gate4 ? 'se aplica — ningún confirmado cuadra solo por la rama === 0' : '>>> NO se aplica — hay confirmados que pasarían a no cuadrar'}\n`);

  // ════ §0.3 — ajustes manuales en producción ════
  console.log('=== §0.3 Ajustes origen manual en producción (solo para dimensionar: no se toca ninguno) ===');
  let manuales = 0, dosMonedas = 0;
  for (const r of todos) {
    for (const a of r.ajustesConsolidado.filter(x => x.origen === 'manual')) {
      manuales++;
      const ambas = a.montoARS !== 0 && a.montoUSD !== 0;
      if (ambas) dosMonedas++;
      console.log(`  ${h8(r.id)} ${s(r.tarjetaCodigo).padEnd(14)} ${r.periodo} ${r.estado.padEnd(10)} ARS=${num(a.montoARS)} USD=${num(a.montoUSD)}${ambas ? ' · LAS DOS' : ''}` +
        ` · motivo=${JSON.stringify(corto(a.motivo ?? a.concepto))}`);
    }
  }
  console.log(`  total: ${manuales} · con las dos monedas distintas de 0: ${dosMonedas}\n`);

  if (SOLO_S0) return;

  // ════ Verificación ════
  console.log(`=== Verificación sobre las líneas guardadas de ${RES_2A0}, código nuevo, escrituras simuladas ===`);
  console.log('  Los escenarios usan una copia con id "sim-…": así la consulta de movimientos da 0, como en un resumen sin confirmar.');
  const SIM_ID = `sim-${RES_2A0}`;
  const base: CardStatement = { ...r2a0, id: SIM_ID, estado: 'parseado', ajustesConsolidado: [] };
  const conReverso = (l: MovimientoParseado[], incluir: boolean) => l.map(x => (esReverso(x) ? { ...x, incluir } : x));
  const linA = conReverso(lin, false);
  const MOTIVO = 'F9.180.1 escenario de prueba, no se escribe';

  // ── A ──
  console.log('\n  Escenario A — reverso destildado, sin ajustes:');
  const cA = cuadreTxt(RT, base, linA, []);
  const botonesA = RT.monedasSinCuadrar(cA);
  chk('no cuadra ARS, residuo −149,96', !cA.balanceARS && RT.residuoCuadre(cA, 'ARS') === -149.96, `residuo ${num(RT.residuoCuadre(cA, 'ARS'))}`);
  chk('cuadra USD, residuo 0 con objetivo 0,29 (arrastre)', cA.balanceUSD && RT.residuoCuadre(cA, 'USD') === 0 && cA.objetivoUSD === 0.29,
    `objetivo ${num(cA.objetivoUSD)} residuo ${num(RT.residuoCuadre(cA, 'USD'))}`);
  chk('solo se ofrece el botón ARS', JSON.stringify(botonesA) === '["ARS"]', `monedasSinCuadrar = ${JSON.stringify(botonesA)}`);
  sim.reset();
  const agARS = await RT.agregarAjusteCuadreManual(base, linA, 'Juan', MOTIVO, 'ARS');
  const escA = sim.escrituras[0];
  const nuevoAj = (escA?.ops[0]?.data?.ajustesConsolidado as AjusteConsolidado[] | undefined)?.at(-1);
  chk('el ajuste ARS se guarda con montoARS −149,96 / montoUSD 0', agARS.ok && nuevoAj?.montoARS === -149.96 && nuevoAj?.montoUSD === 0,
    agARS.ok ? `${escA?.via} ${escA?.ops[0]?.ref.path} → ARS ${s(nuevoAj?.montoARS)} / USD ${s(nuevoAj?.montoUSD)} · origen ${s(nuevoAj?.origen)}` : agARS.error.message);
  sim.reset();
  const agUSD = await RT.agregarAjusteCuadreManual(base, linA, 'Juan', MOTIVO, 'USD');
  chk('pedir el ajuste en USD se rechaza (USD ya cuadra) y no escribe nada', !agUSD.ok && sim.escrituras.length === 0,
    agUSD.ok ? 'se aceptó' : agUSD.error.message);
  sim.reset();
  const agViejo = await RT_VIEJO.agregarAjusteCuadreManual(base, linA, 'Juan', MOTIVO);
  const ajViejo = (sim.escrituras[0]?.ops[0]?.data?.ajustesConsolidado as AjusteConsolidado[] | undefined)?.at(-1);
  console.log(`    (código viejo, mismo escenario: ${agViejo.ok ? `guardaba ARS ${s(ajViejo?.montoARS)} / USD ${s(ajViejo?.montoUSD)} — las dos monedas, y el USD con el arrastre adentro` : agViejo.error.message})`);

  // ── B ──
  console.log('\n  Escenario B — A más el ajuste ARS:');
  if (!nuevoAj) throw new Error('sin el ajuste de A no se puede armar B');
  const resB: CardStatement = { ...base, ajustesConsolidado: [nuevoAj] };
  const cB = cuadreTxt(RT, resB, linA, resB.ajustesConsolidado);
  chk('cuadra en las dos monedas', cB.balanceARS && cB.balanceUSD);
  chk('no se ofrece ningún botón', RT.monedasSinCuadrar(cB).length === 0);
  sim.reset();
  sim.docs.set(`resumenesTarjeta/${SIM_ID}`, { estado: 'parseado', ajustesConsolidado: [nuevoAj] });
  const qB = await RT.quitarAjusteManual(resB, nuevoAj);
  const escB = sim.escrituras[0];
  const despuesB = escB?.ops[0]?.data?.ajustesConsolidado as AjusteConsolidado[] | undefined;
  chk('quitarAjusteManual lo encuentra exactamente 1 vez y lo saca', qB.ok && escB?.via === 'runTransaction' && Array.isArray(despuesB) && despuesB.length === 0,
    qB.ok ? `${escB?.via}: ${escB?.ops.map(o => `${o.op} ${o.ref.path} ajustes=${(o.data?.ajustesConsolidado as unknown[] | undefined)?.length} actualizadoEn=${esServerTimestamp(o.data?.actualizadoEn) ? 'serverTimestamp()' : s(o.data?.actualizadoEn)}`).join(', ')}` : qB.error.message);
  const cB2 = RT.calcularCuadre(linA, base.totalARS, base.totalUSD, despuesB ?? [], { ...resB, ajustesConsolidado: despuesB ?? [] });
  chk('después vuelve al estado de A', cB2.sumaARS === cA.sumaARS && cB2.sumaUSD === cA.sumaUSD && cB2.balanceARS === cA.balanceARS && cB2.balanceUSD === cA.balanceUSD,
    `ARS suma ${num(cB2.sumaARS)} balance ${cB2.balanceARS} · USD suma ${num(cB2.sumaUSD)} balance ${cB2.balanceUSD}`);
  sim.reset();
  sim.docs.set(`resumenesTarjeta/${SIM_ID}`, { estado: 'parseado', ajustesConsolidado: [nuevoAj, { ...nuevoAj }] });
  const qDup = await RT.quitarAjusteManual(resB, nuevoAj);
  chk('(extra) si el ajuste aparece 2 veces, aborta sin escribir', !qDup.ok && sim.escrituras.length === 0, qDup.ok ? 'se aceptó' : qDup.error.message);
  sim.docs.clear();

  // ── C ──
  console.log('\n  Escenario C — reverso tildado, la línea USD de 0,29 destildada, sin ajustes:');
  const linC = conReverso(lin, true).map(x => (esUsd029(x) ? { ...x, incluir: false } : x));
  const cC = cuadreTxt(RT, base, linC, []);
  chk('residuo USD +0,29 (no −14,40 ni −14,69)', RT.residuoCuadre(cC, 'USD') === 0.29, `residuo ${num(RT.residuoCuadre(cC, 'USD'))}; el código viejo tomaba total − suma = ${num(+(base.totalUSD - cC.sumaUSD).toFixed(2))}`);
  // 0,29 está dentro de la tolerancia USD (≤ 1): la moneda cuadra, así que ni botón ni ajuste. Es el
  // mismo criterio en las dos puntas, que es lo que pide §1.
  chk('con 0,29 de diferencia el USD cuadra por tolerancia: no se ofrece botón', RT.monedasSinCuadrar(cC).length === 0, JSON.stringify(RT.monedasSinCuadrar(cC)));
  sim.reset();
  const agC = await RT.agregarAjusteCuadreManual(base, linC, 'Juan', MOTIVO, 'USD');
  chk('y la función también lo rechaza, sin escribir', !agC.ok && sim.escrituras.length === 0, agC.ok ? 'se aceptó' : agC.error.message);

  // ── C' ── el camino USD con una diferencia que sí excede la tolerancia
  console.log("\n  Escenario C' (extra) — reverso tildado, la línea USD leída como 3,29 en vez de 0,29:");
  const linC2 = conReverso(lin, true).map(x => (esUsd029(x) ? { ...x, monto: 3.29, incluir: true } : x));
  const cC2 = cuadreTxt(RT, base, linC2, []);
  chk('residuo USD −3,00 y solo se ofrece el botón USD', RT.residuoCuadre(cC2, 'USD') === -3 && JSON.stringify(RT.monedasSinCuadrar(cC2)) === '["USD"]',
    `residuo ${num(RT.residuoCuadre(cC2, 'USD'))} · monedasSinCuadrar = ${JSON.stringify(RT.monedasSinCuadrar(cC2))}`);
  sim.reset();
  const agC2 = await RT.agregarAjusteCuadreManual(base, linC2, 'Juan', MOTIVO, 'USD');
  const ajC2 = (sim.escrituras[0]?.ops[0]?.data?.ajustesConsolidado as AjusteConsolidado[] | undefined)?.at(-1);
  chk('el ajuste USD se guarda con montoARS 0 / montoUSD −3,00', agC2.ok && ajC2?.montoARS === 0 && ajC2?.montoUSD === -3,
    agC2.ok ? `ARS ${s(ajC2?.montoARS)} / USD ${s(ajC2?.montoUSD)}` : agC2.error.message);
  if (ajC2) {
    const cC2b = RT.calcularCuadre(linC2, base.totalARS, base.totalUSD, [ajC2], { ...base, ajustesConsolidado: [ajC2] });
    chk('con ese ajuste cuadra en las dos monedas', cC2b.balanceARS && cC2b.balanceUSD, `USD suma ${num(cC2b.sumaUSD)} vs objetivo ${num(cC2b.objetivoUSD)}`);
  }
  sim.reset();
  const agC2ars = await RT.agregarAjusteCuadreManual(base, linC2, 'Juan', MOTIVO, 'ARS');
  chk('pedir el ajuste en ARS se rechaza (ARS cuadra)', !agC2ars.ok && sim.escrituras.length === 0, agC2ars.ok ? 'se aceptó' : agC2ars.error.message);

  // ── quitar con movimientos ──
  // 2a0f81f8 todavía no se confirmó (ver §0.1): se usa el confirmado más reciente que tenga un ajuste
  // manual de verdad, y se intenta quitar ese ajuste.
  const conMovs = [...todos].reverse().find(r => r.estado === 'confirmado' && r.ajustesConsolidado.some(a => a.origen === 'manual'));
  if (!conMovs) throw new Error('no hay un resumen confirmado con ajuste manual para probar');
  const ajReal = conMovs.ajustesConsolidado.find(a => a.origen === 'manual')!;
  console.log(`\n  quitarAjusteManual sobre ${h8(conMovs.id)} (${conMovs.tarjetaCodigo} ${conMovs.periodo}, confirmado), su ajuste manual real USD ${num(ajReal.montoUSD)}:`);
  sim.reset();
  const qMov = await RT.quitarAjusteManual(conMovs, ajReal);
  chk('se rechaza, sin escribir', !qMov.ok && sim.escrituras.length === 0, qMov.ok ? 'se aceptó' : qMov.error.message);
  const ajFicticio: AjusteConsolidado = { concepto: 'Ajuste manual: prueba', montoARS: -1, montoUSD: 0, origen: 'manual', motivo: 'prueba', creadoPor: 'Juan', creadoEn: '2026-10-05T16:09:54.000Z' };
  const qPdf = await RT.quitarAjusteManual(base, { ...ajFicticio, origen: 'pdf' });
  chk('(extra) un ajuste de PDF no se quita', !qPdf.ok && sim.escrituras.length === 0, qPdf.ok ? 'se aceptó' : qPdf.error.message);

  // ── §4 ──
  console.log('\n  §4 — balance sin la rama `objetivo === 0`:');
  const lineaUsd5: MovimientoParseado = { ...(lin.find(esUsd029) ?? lin[0]), moneda: 'USD', monto: 5, incluir: true, noDebitado: false, tipoLinea: 'consumo' };
  const sintetico: CardStatement = { ...base, id: 'sim-objetivo-0', totalARS: 0, totalUSD: 0, saldoAnteriorUSD: null, pagosDelPeriodoUSD: null, movimientosParseados: [lineaUsd5] };
  const cNuevo = RT.calcularCuadre(sintetico.movimientosParseados, 0, 0, [], sintetico);
  const cViejo = RT_VIEJO.calcularCuadre(sintetico.movimientosParseados, 0, 0, [], sintetico);
  chk('objetivo USD 0 con una línea USD de 5: balanceUSD false', cNuevo.balanceUSD === false,
    `nuevo balanceUSD=${cNuevo.balanceUSD} (objetivo ${num(cNuevo.objetivoUSD)}, suma ${num(cNuevo.sumaUSD)}) · viejo balanceUSD=${cViejo.balanceUSD}`);
  let cambian = 0, rompeConfirmado = 0;
  for (const r of todos) {
    const v = RT_VIEJO.calcularCuadre(r.movimientosParseados, r.totalARS, r.totalUSD, r.ajustesConsolidado, r);
    const n = RT.calcularCuadre(r.movimientosParseados, r.totalARS, r.totalUSD, r.ajustesConsolidado, r);
    if (v.balanceARS === n.balanceARS && v.balanceUSD === n.balanceUSD) continue;
    cambian++;
    if (r.estado === 'confirmado') rompeConfirmado++;
    console.log(`    CAMBIA ${h8(r.id)} ${r.tarjetaCodigo} ${r.periodo} ${r.estado}: ARS ${v.balanceARS}→${n.balanceARS} · USD ${v.balanceUSD}→${n.balanceUSD}`);
  }
  chk(`sobre los ${todos.length} resúmenes guardados, ningún confirmado cambia de balance`, rompeConfirmado === 0, `cambian ${cambian}, confirmados ${rompeConfirmado}`);

  console.log(`\nresultado de la verificación: ${fallas === 0 ? 'todo OK' : `>>> ${fallas} chequeo(s) fallaron`}`);
  if (fallas) process.exitCode = 1;
}

main().then(() => process.exit(process.exitCode ?? 0)).catch(e => { console.error(e); process.exit(1); });
