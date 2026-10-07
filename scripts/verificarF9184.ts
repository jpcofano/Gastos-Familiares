// F9.184 §0 — inventario de obligaciones abiertas y la consulta que las trae. SOLO LECTURA.
//
//   npx tsx scripts/verificarF9184.ts
//
// 0.1 obligaciones abiertas (tipo Gasto, !movimientoCubierto) por mes, con ítem / sueltas,
//     incluirResumenMes false, fecha efectiva; grupos (a) vencidas de meses anteriores, (b) abiertas
//     dentro de un ítem que figura pagado/automatico, (c) sueltas vencidas.
// 0.2 qué filtro de Firestore trae TODAS las de 0.1 (gate).
//
// Conversión, checklist y cobertura son las del cliente (cargadas con scripts/simConfirmarResumen.ts):
// docAMovimiento, calcularChecklist, movimientoCubierto. La fecha efectiva replica fechaEfectivaMov
// (Resumen.tsx:138) tal cual.
// Privacidad: ids a 8 caracteres, descripciones recortadas.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { crearSim } from './simConfirmarResumen';
import type { ExpectedItem, Movement } from '../src/types';
import type { CheckItem } from '../src/datos/checklist';

process.env.TZ = 'America/Argentina/Buenos_Aires';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const sim = crearSim(db);

type ChkMod = {
  calcularChecklist: (items: ExpectedItem[], movs: Movement[], mes: string) => CheckItem[];
  movimientoCubierto: (m: Pick<Movement, 'pagado' | 'confirmadoPago'>) => boolean;
  cubierto?: (e: string) => boolean;
  mesActualStr: () => string;
};
type MovMod = { docAMovimiento: (id: string, data: FirebaseFirestore.DocumentData) => Movement };
type ItemsMod = { docAItemEsperado: (id: string, data: FirebaseFirestore.DocumentData) => ExpectedItem };
const CHK = sim.cargar<ChkMod>('src/datos/checklist.ts');
const MOV = sim.cargar<MovMod>('src/datos/movimientos.ts');
const ITEMS = sim.cargar<ItemsMod>('src/datos/itemsEsperados.ts');

const h8 = (v: unknown) => (v ? String(v).slice(0, 8) : '-');
const corto = (v: unknown, n = 26) => { const t = String(v ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inicioDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Copia literal de fechaEfectivaMov (Resumen.tsx:138).
function fechaEfectivaMov(m: Movement): Date {
  const venc = m.vencimientos;
  if (Array.isArray(venc) && venc.length > 0 && venc[0]?.fecha) {
    const d = new Date(`${String(venc[0].fecha).slice(0, 10)}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }
  return inicioDia(m.fecha);
}

async function main() {
  const hoy = inicioDia(new Date());
  const mesActual = CHK.mesActualStr();
  const [movSnap, itemSnap] = await Promise.all([db.collection('movimientos').get(), db.collection('itemsEsperados').get()]);
  const items = itemSnap.docs.map(d => ITEMS.docAItemEsperado(d.id, d.data()));
  const nombreItem = new Map(items.map(i => [i.id, `${i.categoria ?? '?'} › ${i.subcategoria ?? '?'}`]));
  const movs = movSnap.docs.map(d => MOV.docAMovimiento(d.id, d.data()));
  console.log(`F9.184 §0 — SOLO LECTURA. hoy=${iso(hoy)} mesActual=${mesActual} | movimientos: ${movs.length} | itemsEsperados: ${items.length}` +
    ` (activos ${items.filter(i => i.activo).length}, con diaVencimiento ${items.filter(i => i.activo && i.diaVencimiento).length})\n`);

  // ── 0.1 ───────────────────────────────────────────────────────────────────
  const abiertas = movs.filter(m => m.tipo === 'Gasto' && !CHK.movimientoCubierto(m));
  console.log(`── 0.1 obligaciones abiertas (tipo Gasto, !movimientoCubierto): ${abiertas.length}`);
  const porMes = new Map<string, Movement[]>();
  for (const m of abiertas) porMes.set(m.mes, [...(porMes.get(m.mes) ?? []), m]);

  // Estado del ítem y matches del checklist, por mes con abiertas (el estado es POR MES).
  const chkPorMes = new Map<string, CheckItem[]>();
  for (const mes of porMes.keys()) chkPorMes.set(mes, CHK.calcularChecklist(items, movs.filter(m => m.mes === mes), mes));
  const estadoDe = (m: Movement) => {
    const ci = chkPorMes.get(m.mes)?.find(c => c.matches.some(x => x.id === m.id));
    return ci ? { item: ci.item.id, estado: ci.estado } : null;
  };

  console.log('  mes      | abiertas | con ítem* | sueltas | incluirResumenMes=false | vencidas (fecha efectiva < hoy) | monto');
  for (const mes of [...porMes.keys()].sort()) {
    const l = porMes.get(mes)!;
    const conItem = l.filter(m => estadoDe(m)).length;
    console.log(`  ${mes}  | ${String(l.length).padStart(8)} | ${String(conItem).padStart(9)} | ${String(l.length - conItem).padStart(7)} | ${String(l.filter(m => !m.incluirResumenMes).length).padStart(23)} | ${String(l.filter(m => fechaEfectivaMov(m) < hoy).length).padStart(31)} | ${fmt(l.reduce((s, m) => s + Math.abs(m.monto), 0))}`);
  }
  console.log('  * con ítem = la reclama un ítem en el checklist de su mes (pase 1 por itemEsperadoId o heurística); el resto son sueltas.');
  const sinItemId = abiertas.filter(m => !m.itemEsperadoId).length;
  console.log(`  sin itemEsperadoId: ${sinItemId} | USD: ${abiertas.filter(m => m.moneda === 'USD').length}`);

  const linea = (m: Movement, extra = '') =>
    `    ${h8(m.id)} | ${m.mes} | vence ${iso(fechaEfectivaMov(m))} | ${m.moneda} ${fmt(Math.abs(m.monto)).padStart(13)} | ${corto(m.descripcion).padEnd(27)} | ${extra}` +
    `${m.incluirResumenMes ? '' : ' | incluirResumenMes=false'}${m.resumenTarjetaId ? ' | de resumen' : ''}`;

  const grupoA = abiertas.filter(m => m.mes < mesActual && fechaEfectivaMov(m) < hoy);
  console.log(`\n  (a) VENCIDAS DE MESES ANTERIORES (las esconde H3): ${grupoA.length} · ARS ${fmt(grupoA.filter(m => m.moneda === 'ARS').reduce((s, m) => s + Math.abs(m.monto), 0))}`);
  for (const m of grupoA.sort((x, y) => fechaEfectivaMov(x).getTime() - fechaEfectivaMov(y).getTime())) {
    const e = estadoDe(m);
    console.log(linea(m, e ? `ítem ${nombreItem.get(e.item)} (${e.estado} en ${m.mes})` : 'suelta'));
  }

  const grupoB = abiertas.filter(m => { const e = estadoDe(m); return e && (e.estado === 'pagado' || e.estado === 'automatico'); });
  console.log(`\n  (b) ABIERTAS DENTRO DE UN ÍTEM PAGADO/AUTOMÁTICO (las esconde H1): ${grupoB.length} · ARS ${fmt(grupoB.filter(m => m.moneda === 'ARS').reduce((s, m) => s + Math.abs(m.monto), 0))}`);
  for (const m of grupoB.sort((x, y) => x.mes.localeCompare(y.mes))) {
    const e = estadoDe(m)!;
    console.log(linea(m, `ítem ${nombreItem.get(e.item)} = ${e.estado}`));
  }
  const ab = grupoA.filter(m => grupoB.includes(m)).length;
  console.log(`  (a ∩ b: ${ab})`);

  const grupoC = abiertas.filter(m => !estadoDe(m) && fechaEfectivaMov(m) < hoy);
  console.log(`\n  (c) SUELTAS CON FECHA EFECTIVA VENCIDA (las esconde H2): ${grupoC.length} (del mes actual: ${grupoC.filter(m => m.mes === mesActual).length})`);
  for (const m of grupoC.sort((x, y) => fechaEfectivaMov(x).getTime() - fechaEfectivaMov(y).getTime())) console.log(linea(m, 'suelta'));

  // ── 0.2 ───────────────────────────────────────────────────────────────────
  console.log('\n── 0.2 la consulta que trae las abiertas de todos los meses');
  const raw = movSnap.docs.map(d => d.data());
  const valores = (k: string) => {
    const c: Record<string, number> = {};
    for (const x of raw) { const v = !(k in x) ? '(sin campo)' : x[k] === null ? 'null' : typeof x[k] === 'boolean' ? String(x[k]) : `(${typeof x[k]})`; c[v] = (c[v] ?? 0) + 1; }
    return JSON.stringify(c);
  };
  console.log(`  pagado:         ${valores('pagado')}`);
  console.log(`  confirmadoPago: ${valores('confirmadoPago')}`);
  console.log(`  tipo:           ${valores('tipo')}`);
  const idsAbiertas = new Set(abiertas.map(m => m.id));
  const probar = async (nombre: string, q: FirebaseFirestore.Query) => {
    const s = await q.get();
    const tras = s.docs.map(d => MOV.docAMovimiento(d.id, d.data())).filter(m => m.tipo === 'Gasto' && !CHK.movimientoCubierto(m));
    const ids = new Set(tras.map(m => m.id));
    const faltan = [...idsAbiertas].filter(id => !ids.has(id));
    const sobran = [...ids].filter(id => !idsAbiertas.has(id));
    console.log(`  ${nombre.padEnd(52)} → ${String(s.size).padStart(4)} docs leídos, ${ids.size} tras el filtro del cliente | faltan ${faltan.length} | sobran ${sobran.length} ${faltan.length === 0 && sobran.length === 0 ? '✓ EXACTO' : '✗'}`);
    for (const id of faltan.slice(0, 5)) { const m = movs.find(x => x.id === id)!; console.log(`      falta ${h8(id)} pagado=${JSON.stringify(raw[movs.indexOf(m)].pagado)} confirmadoPago=${JSON.stringify(raw[movs.indexOf(m)].confirmadoPago)}`); }
    return faltan.length === 0 && sobran.length === 0;
  };
  const col = db.collection('movimientos');
  const r1 = await probar("where('pagado','==',false)", col.where('pagado', '==', false));
  const r2 = await probar("where('confirmadoPago','==',false)", col.where('confirmadoPago', '==', false));
  const r3 = await probar("where('pagado','==',false) + where('tipo','==','Gasto')", col.where('pagado', '==', false).where('tipo', '==', 'Gasto'));
  console.log(`  GATE: ${r1 || r2 || r3 ? 'PASA — hay un filtro que trae el conjunto completo' : 'NO PASA'}`);

  if (process.argv.includes('--verif')) await verificacion(movs, items, raw);
}

// ── Verificación (--verif): funciones reales de src/datos/obligaciones.ts y agenda.ts ──────────
type Oblig = { mov: Movement; fechaEfectiva: Date; estado: 'vencida' | 'hoy' | 'proxima' };
type ObMod = {
  obligacionesAbiertas: (movs: Movement[], hoy: Date) => Oblig[];
  vencidasParaResumen: (movsDelMes: Movement[], todas: Movement[], mes: string, hoy: Date, esMesActual: boolean) => Oblig[];
  pendienteMes: (chk: CheckItem[], movsDelMes: Movement[], todas: Movement[], mes: string, hoy: Date, esMesActual: boolean) => { monto: number; vencidos: number; obligaciones: number };
  abiertasDelItem: (ci: CheckItem) => Movement[];
  obligacionesParaCampana: (o: Oblig[], hoy: Date, dias: number) => Oblig[];
  itemTieneObligacionAbierta: (ci: CheckItem) => boolean;
  esObligacionAbierta: (m: Movement) => boolean;
};
type AgendaMod = {
  construirAgenda: (chk: CheckItem[], sueltos: Movement[]) => Array<{ kind: string; ci?: CheckItem; mov?: Movement }>;
  pendienteAgenda: (a: unknown[]) => number;
  sueltosFuturosDelMes?: (movs: Movement[], chk: CheckItem[], hoy: Date) => Movement[];
  sueltosAbiertosDelMes?: (movs: Movement[], chk: CheckItem[]) => Movement[];
};
const BASE = 'fb5cc92';

async function verificacion(movs: Movement[], items: ExpectedItem[], raw: FirebaseFirestore.DocumentData[]) {
  const OB = sim.cargar<ObMod>('src/datos/obligaciones.ts');
  const AG = sim.cargar<AgendaMod>('src/datos/agenda.ts');
  const AG_VIEJO = sim.cargar<AgendaMod>('src/datos/agenda.ts', BASE);
  const ok = (c: boolean) => (c ? 'OK' : '✗');
  const d = (s: string) => new Date(`${s}T12:00:00`);
  const DIAS = 14;
  const mkMov = (id: string, data: Record<string, unknown>) => MOV.docAMovimiento(id, {
    tipo: 'Gasto', moneda: 'ARS', pagado: false, confirmadoPago: false, incluirResumenMes: true, descripcion: id, ...data,
  });
  console.log('\n════════ VERIFICACIÓN ════════');

  // ── 1. Cuotas del viaje ──
  console.log('\n── 1. dos cuotas de viaje: Gasto sin ítem, alta manual con fecha futura (pagado/confirmadoPago false)');
  const { Timestamp } = await import('firebase-admin/firestore');
  const c1 = mkMov('SIM-viaje-nov', { monto: 450000, fecha: Timestamp.fromDate(d('2026-11-15')), mes: '2026-11' });
  const c2 = mkMov('SIM-viaje-dic', { monto: 450000, fecha: Timestamp.fromDate(d('2026-12-15')), mes: '2026-12' });
  const todas = [...movs.filter(m => OB.esObligacionAbierta(m)), c1, c2];
  for (const [c, mes] of [[c1, '2026-11'], [c2, '2026-12']] as const) {
    const movsMes = [...movs.filter(m => m.mes === mes), c];
    const chk = CHK.calcularChecklist(items, movsMes, mes);
    const suelto = AG.sueltosAbiertosDelMes!(movsMes, chk).some(m => m.id === c.id);
    const sinC = OB.pendienteMes(chk, movsMes.filter(m => m.id !== c.id), todas, mes, d('2026-10-06'), false).monto;
    const conC = OB.pendienteMes(chk, movsMes, todas, mes, d('2026-10-06'), false).monto;
    console.log(`  ${mes}: en la agenda como suelto a pagar ${ok(suelto)} | el pendiente del mes sube ${fmt(conC - sinC)} ${ok(Math.abs(conC - sinC - 450000) < 0.01)}`);
  }
  for (const hoy of ['2026-10-06', '2026-10-31', '2026-11-01', '2026-11-15']) {
    const camp = OB.obligacionesParaCampana(OB.obligacionesAbiertas([c1], d(hoy)), d(hoy), DIAS);
    console.log(`  campana con hoy=${hoy}: la de noviembre ${camp.length ? `ENTRA (${camp[0].estado})` : 'no entra'}`);
  }
  const hoyNov = d('2026-11-20');
  const vNov = OB.vencidasParaResumen([c1], [c1, c2], '2026-11', hoyNov, true);
  console.log(`  hoy=2026-11-20 sin pagarla, Resumen de noviembre: card de vencidos ${ok(vNov.some(o => o.mov.id === c1.id))} (${vNov.length})`);
  const hoyDic = d('2026-12-05');
  const vDic = OB.vencidasParaResumen([c2], [c1, c2], '2026-12', hoyDic, true);
  const enDic = vDic.find(o => o.mov.id === c1.id);
  console.log(`  hoy=2026-12-05 sin pagarla, Resumen de diciembre: la de noviembre en vencidos ${ok(!!enDic)}, etiqueta de mes ${ok(enDic?.mov.mes === '2026-11')} (mes ${enDic?.mov.mes} ≠ 2026-12 → pie "· noviembre")`);
  console.log(`  mirando noviembre ya cerrado (hoy=2026-12-05): card de vencidos ${OB.vencidasParaResumen([c1], [c1, c2], '2026-11', hoyDic, false).length === 0 ? 'no se muestra OK' : '✗'}`);

  // ── 2. ABL con 5 obligaciones, la del mes pagada ──
  console.log('\n── 2. ABL 2026-10 con las 5 obligaciones de docs/F9.182.txt 0.4, la del mes pagada');
  const abl = items.find(i => i.id === '62a96fc83be3b3506032')!;
  const montos = [76228.21, 92479.04, 89605.43, 88081.49, 87084.97];
  const vtos = ['2026-10-07', '2026-10-31', '2026-10-31', '2026-10-31', '2026-10-31'];
  const ablMovs = montos.map((monto, i) => mkMov(`SIM-abl-${i + 1}`, {
    monto, mes: '2026-10', itemEsperadoId: abl.id, fecha: Timestamp.fromDate(d(vtos[i])), vencimientos: [{ fecha: vtos[i], monto }],
    pagado: i === 0, confirmadoPago: i === 0, descripcion: 'AGIP Inmobiliario/ABL',
  }));
  const ci = CHK.calcularChecklist([abl], ablMovs, '2026-10')[0];
  const extra = OB.abiertasDelItem(ci);
  const sumaExtra = extra.reduce((s, m) => s + m.monto, 0);
  console.log(`  estadoItem = ${ci.estado} ${ok(ci.estado === 'pagado')} | la fila muestra "+${extra.length} a pagar · $${fmt(sumaExtra)}" ${ok(extra.length === 4 && Math.abs(sumaExtra - 357250.93) < 0.01)}`);
  const pmOct = OB.pendienteMes([ci], ablMovs, ablMovs.filter(m => OB.esObligacionAbierta(m)), '2026-10', d('2026-10-06'), true);
  console.log(`  banner (hoy=2026-10-06): pendiente ${fmt(pmOct.monto)} ${ok(Math.abs(pmOct.monto - 357250.93) < 0.01)} | vencidos ${pmOct.vencidos} | obligaciones ${pmOct.obligaciones}`);
  const abiertasAbl = ablMovs.filter(m => OB.esObligacionAbierta(m));
  const hoyPost = d('2026-11-01');
  const vPost = OB.vencidasParaResumen([], abiertasAbl, '2026-11', hoyPost, true);
  const campPost = OB.obligacionesParaCampana(OB.obligacionesAbiertas(abiertasAbl, hoyPost), hoyPost, DIAS);
  console.log(`  hoy=2026-11-01 sin pagarlas: card de vencidos de noviembre ${vPost.length} ${ok(vPost.length === 4)} | campana ${campPost.filter(o => o.estado === 'vencida').length} vencidas ${ok(campPost.filter(o => o.estado === 'vencida').length === 4)}`);
  const pmNov = OB.pendienteMes([], [], abiertasAbl, '2026-11', hoyPost, true);
  console.log(`  banner de noviembre: vencidos ${pmNov.vencidos} ${ok(pmNov.vencidos === 4)}, pendiente ${fmt(pmNov.monto)}`);
  console.log(`  campana del ítem: itemTieneObligacionAbierta = ${OB.itemTieneObligacionAbierta(ci)} → el aviso por diaVencimiento del ítem se reemplaza por las 4`);

  // ── 3. Producción, hoy: antes y después ──
  const hoy = new Date();
  const mes = CHK.mesActualStr();
  console.log(`\n── 3. producción, hoy (${iso(hoy)}), Resumen de ${mes}: banner y card de vencidos ANTES (${BASE}) y DESPUÉS`);
  const movsMes = movs.filter(m => m.mes === mes);
  const abiertasTodas = movs.filter(m => OB.esObligacionAbierta(m));
  const chk = CHK.calcularChecklist(items, movsMes, mes);
  // ANTES: el código de BASE, tal cual (agenda.ts viejo + la expresión vieja de la card y del contador).
  const agendaV = AG_VIEJO.construirAgenda(chk, AG_VIEJO.sueltosFuturosDelMes!(movsMes, chk, hoy));
  const pendV = AG_VIEJO.pendienteAgenda(agendaV);
  const vencV = agendaV.filter(e => e.kind === 'esperado' && e.ci!.estado === 'vencido').length;
  const cardV = movsMes.filter(m => m.incluirResumenMes && m.tipo === 'Gasto' && !CHK.movimientoCubierto(m) && fechaEfectivaMov(m) < inicioDia(hoy));
  // DESPUÉS
  const pmN = OB.pendienteMes(chk, movsMes, abiertasTodas, mes, hoy, true);
  const cardN = OB.vencidasParaResumen(movsMes, abiertasTodas, mes, hoy, true);
  console.log(`  banner pendiente:  antes ${fmt(pendV)} → después ${fmt(pmN.monto)}  (Δ ${fmt(pmN.monto - pendV)})`);
  console.log(`  contador vencidos: antes ${vencV} → después ${pmN.vencidos}`);
  console.log(`  card de vencidos:  antes ${cardV.length} → después ${cardN.length}`);
  // Descomposición del Δ del pendiente.
  const anteriores = cardN.filter(o => o.mov.mes < mes);
  const delMesAbiertas = OB.obligacionesAbiertas(movsMes, hoy);
  const enItemCubierto = chk.filter(c => CHK.cubierto?.(c.estado) ?? (c.estado === 'pagado' || c.estado === 'automatico')).flatMap(c => OB.abiertasDelItem(c));
  console.log(`  descomposición del Δ:`);
  console.log(`    + (a) vencidas de meses anteriores: ${anteriores.length} · ${fmt(anteriores.reduce((s, o) => s + Math.abs(o.mov.monto), 0))}`);
  console.log(`    + (b) abiertas del mes dentro de un ítem cubierto: ${enItemCubierto.length} · ${fmt(enItemCubierto.reduce((s, m) => s + Math.abs(m.monto), 0))}`);
  const sueltosV = new Set(AG_VIEJO.sueltosFuturosDelMes!(movsMes, chk, hoy).map(m => m.id));
  const sueltosVencidosNuevos = delMesAbiertas.filter(o => !sueltosV.has(o.mov.id) && !chk.some(c => c.matches.some(x => x.id === o.mov.id)));
  console.log(`    + (c) sueltas del mes que antes no entraban (vencidas): ${sueltosVencidosNuevos.length} · ${fmt(sueltosVencidosNuevos.reduce((s, o) => s + Math.abs(o.mov.monto), 0))}`);
  const porConfCubiertos = chk.filter(c => c.item.tipo === 'Gasto' && c.matches.length > 0 && !(c.estado === 'pagado' || c.estado === 'automatico'))
    .flatMap(c => c.matches.filter(m => CHK.movimientoCubierto(m)));
  console.log(`    − matches ya cubiertos (pagado) de ítems sin confirmar, que antes sumaban: ${porConfCubiertos.length} · ${fmt(porConfCubiertos.reduce((s, m) => s + Math.abs(m.monto), 0))}`);
  const cardNuevas = cardN.filter(o => !cardV.some(m => m.id === o.mov.id));
  console.log(`  card: entran ${cardNuevas.length} — de meses anteriores ${cardNuevas.filter(o => o.mov.mes < mes).length}, del mes con incluirResumenMes=false ${cardNuevas.filter(o => o.mov.mes === mes && !o.mov.incluirResumenMes).length}`);
  const campHoy = OB.obligacionesParaCampana(OB.obligacionesAbiertas(abiertasTodas, hoy), hoy, DIAS);
  console.log(`  campana: ${campHoy.length} obligaciones (${campHoy.filter(o => o.estado === 'vencida').length} vencidas, ${campHoy.filter(o => o.estado === 'hoy').length} hoy, ${campHoy.filter(o => o.estado === 'proxima').length} próximas ≤ ${DIAS} días)`);

  // ── 4. No regresión ──
  console.log('\n── 4. no regresión: meses sin obligaciones abiertas extra, banner antes = después');
  for (const m of ['2026-07', '2026-08', '2026-09']) {
    const mm = movs.filter(x => x.mes === m);
    const ck = CHK.calcularChecklist(items, mm, m);
    const antes = AG_VIEJO.pendienteAgenda(AG_VIEJO.construirAgenda(ck, AG_VIEJO.sueltosFuturosDelMes!(mm, ck, hoy)));
    const despues = OB.pendienteMes(ck, mm, abiertasTodas, m, hoy, false).monto;
    const abiertasMes = mm.filter(x => OB.esObligacionAbierta(x)).length;
    console.log(`  ${m}: abiertas ${abiertasMes} | antes ${fmt(antes)} | después ${fmt(despues)} ${ok(Math.abs(antes - despues) < 0.01)}`);
    if (Math.abs(antes - despues) >= 0.01) {
      // Explicar la diferencia con los mismos componentes del punto 3.
      const sv = new Set(AG_VIEJO.sueltosFuturosDelMes!(mm, ck, hoy).map(x => x.id));
      const nuevasSueltas = mm.filter(x => OB.esObligacionAbierta(x) && !sv.has(x.id) && !ck.some(c => c.matches.some(y => y.id === x.id)));
      const cubiertosSinConf = ck.filter(c => c.item.tipo === 'Gasto' && c.matches.length > 0 && !(c.estado === 'pagado' || c.estado === 'automatico'))
        .flatMap(c => c.matches.filter(y => CHK.movimientoCubierto(y)));
      const enCubierto = ck.filter(c => c.estado === 'pagado' || c.estado === 'automatico').flatMap(c => OB.abiertasDelItem(c));
      for (const x of nuevasSueltas) console.log(`      + suelta abierta que el filtro de fecha soltaba (H2): ${h8(x.id)} ${corto(x.descripcion)} ${fmt(x.monto)}`);
      for (const x of enCubierto) console.log(`      + abierta dentro de un ítem cubierto (H1): ${h8(x.id)} ${corto(x.descripcion)} ${fmt(x.monto)}`);
      for (const x of cubiertosSinConf) console.log(`      − match pagado sin confirmar, ya no es "a pagar": ${h8(x.id)} ${corto(x.descripcion)} ${fmt(x.monto)} (pagado=${x.pagado} confirmadoPago=${x.confirmadoPago})`);
      const expl = nuevasSueltas.reduce((s, x) => s + x.monto, 0) + enCubierto.reduce((s, x) => s + x.monto, 0) - cubiertosSinConf.reduce((s, x) => s + x.monto, 0);
      console.log(`      explicado: ${fmt(expl)} = Δ ${fmt(despues - antes)} ${ok(Math.abs(expl - (despues - antes)) < 0.01)} — no es un mes "sin obligaciones extra"`);
    }
  }
  void raw;
}

main().catch(e => { console.error(e); process.exit(1); });
