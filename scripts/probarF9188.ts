// F9.188 — verificación.
//
//   npx tsx scripts/probarF9188.ts
//       → SOLO LECTURA contra producción: verificación 1 (los totales del 9/10 con el código nuevo),
//         3 (confirmar un resumen antes / después del vencimiento / en 0, con commit simulado),
//         4 (los dos números de octubre, antes y después) y 5 (no regresión del checklist y la agenda).
//   firebase emulators:exec --only firestore --project demo-f9188 "npx tsx scripts/probarF9188.ts --emulador"
//       → verificación 2 (cierre al vencer, con functions/src/cierreAlVencer.ts) y las reglas de
//         itemsEsperados.cierreAlVencer (rules-unit-testing). Datos sintéticos.
//
// "Viejo" es el código de BASE (origin/main 940ffa1, al abrir F9.188) leído de git; "nuevo" es el árbol
// de trabajo. Los dos se cargan con scripts/simConfirmarResumen.ts. arsEq y crearTcDeMovimiento son
// copia literal de src/vistas/Resumen.tsx (JSX, no se puede cargar).
// Privacidad: ids a 8 caracteres, descripciones recortadas.
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { crearSim, esServerTimestamp, clienteFS, type OpBatch } from './simConfirmarResumen';
import type { CardStatement, ExpectedItem, FamiliaConfig, Movement, MovimientoParseado } from '../src/types';
import type { CheckItem } from '../src/datos/checklist';
import type { AgendaEntry } from '../src/datos/agenda';

process.env.TZ = 'America/Argentina/Buenos_Aires';
const BASE = '940ffa1';
const EMULADOR = process.argv.includes('--emulador');
const PROYECTO = 'demo-f9188';
// docs/F9.188.txt §0.1 (i).
const MEDIDOS = ['4v6zSQBh', '84tYO8zb', '8yrFcA81', 'GNjyjwBJ', 'OpPV0LNm', 'dHJfkxGz'];

const req = createRequire(process.cwd() + '/package.json');
const { initializeApp, cert, getApps } = req('firebase-admin/app') as typeof import('firebase-admin/app');
const { getFirestore, FieldValue, FieldPath, Timestamp } = req('firebase-admin/firestore') as typeof import('firebase-admin/firestore');
type Firestore = import('firebase-admin/firestore').Firestore;

const h8 = (v: unknown) => (v ? String(v).slice(0, 8) : '-');
const corto = (v: unknown, n = 30) => { const t = String(v ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };
const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inicioDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const s = (v: unknown) => (v === null ? 'null' : v === undefined ? '(ausente)' : String(v));
let fallas = 0;
const ok = (c: boolean, t: string) => { if (!c) fallas++; console.log(`  ${c ? 'OK' : '✗ '} ${t}`); };

type ObMod = typeof import('../src/datos/obligaciones');
type ChkMod = {
  calcularChecklist: (items: ExpectedItem[], movs: Movement[], mes: string) => CheckItem[];
  movimientoCubierto: (m: Pick<Movement, 'pagado' | 'confirmadoPago'>) => boolean;
  ACCIONABLE: string[];
};
type AgMod = {
  sueltosAbiertosDelMes: (movs: Movement[], chk: CheckItem[]) => Movement[];
  construirAgenda: (chk: CheckItem[], sueltos: Movement[]) => AgendaEntry[];
  agendaCubierto: (e: AgendaEntry) => boolean;
};
type RTMod = {
  docACardStatement: (id: string, data: FirebaseFirestore.DocumentData) => CardStatement;
  totalesNetos: (l: MovimientoParseado[], tARS: number, tUSD: number, c?: CardStatement | null) => { netoARS: number; netoUSD: number };
  confirmarResumenTarjeta: (r: CardStatement, l: MovimientoParseado[], memberId: string, cfg: FamiliaConfig) =>
    Promise<{ ok: true; data: void } | { ok: false; error: Error }>;
};
type FamMod = { cargarFamiliaConfig: () => Promise<FamiliaConfig | null>; resolverNombreMiembro: (n: string, c: FamiliaConfig) => string | null };
type MovMod = { docAMovimiento: (id: string, d: FirebaseFirestore.DocumentData) => Movement };
type ItemsMod = { docAItemEsperado: (id: string, d: FirebaseFirestore.DocumentData) => ExpectedItem };

// ── copia literal de src/vistas/Resumen.tsx (crearTcDeMovimiento, eqDe/arsEq) y tcDeFecha ──────────
function tcDeFecha(mapa: Record<string, number>, fecha: string): number | null {
  if (mapa[fecha]) return mapa[fecha];
  const anteriores = Object.keys(mapa).filter(k => k < fecha).sort();
  const ultima = anteriores[anteriores.length - 1];
  return ultima ? mapa[ultima] : null;
}
type TcDeMov = (m: Movement) => number;
function crearTcDeMovimiento(mapaTc: Record<string, number>, tcEfectivo: number, esMesActual: boolean): TcDeMov {
  return m => {
    const esVivo = esMesActual && m.tipo === 'Ingreso';
    if (esVivo) return tcEfectivo;
    return tcDeFecha(mapaTc, iso(m.fecha)) ?? tcEfectivo;
  };
}
function arsEq(m: Movement, tcDeMov: TcDeMov): number {
  if (m.moneda === 'ARS') return m.monto;
  const tc = m.tcUsdArs ?? tcDeMov(m);
  return m.monto * tc;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PRODUCCIÓN (solo lectura)
// ════════════════════════════════════════════════════════════════════════════════════════════════
async function produccion(db: Firestore) {
  const sim = crearSim(db);
  const OB = sim.cargar<ObMod>('src/datos/obligaciones.ts');
  const OB_V = sim.cargar<ObMod>('src/datos/obligaciones.ts', BASE);
  const CHK = sim.cargar<ChkMod>('src/datos/checklist.ts');
  const CHK_V = sim.cargar<ChkMod>('src/datos/checklist.ts', BASE);
  const AG = sim.cargar<AgMod>('src/datos/agenda.ts');
  const AG_V = sim.cargar<AgMod>('src/datos/agenda.ts', BASE);
  const MON = sim.cargar<{ fmtMoney: (n: number, o: { from: 'ARS' | 'USD'; to: 'ARS' | 'USD' }) => string }>('src/datos/money.ts');
  const MOV = sim.cargar<MovMod>('src/datos/movimientos.ts');
  const ITEMS = sim.cargar<ItemsMod>('src/datos/itemsEsperados.ts');
  const ITEMS_V = sim.cargar<ItemsMod>('src/datos/itemsEsperados.ts', BASE);
  const RT = sim.cargar<RTMod>('src/datos/resumenesTarjeta.ts');
  const RT_V = sim.cargar<RTMod>('src/datos/resumenesTarjeta.ts', BASE);
  const FAM = sim.cargar<FamMod>('src/familia.ts');
  const fmtArs = (n: number) => MON.fmtMoney(n, { from: 'ARS', to: 'ARS' });
  const fmtUsd = (n: number) => MON.fmtMoney(n, { from: 'USD', to: 'USD' });

  const ahora = new Date();
  const hoy = inicioDia(ahora);
  const MES = iso(hoy).slice(0, 7);
  const [movSnap, itemSnap] = await Promise.all([db.collection('movimientos').get(), db.collection('itemsEsperados').get()]);
  const movsHoy = movSnap.docs.map(d => MOV.docAMovimiento(d.id, d.data()));
  const items = itemSnap.docs.map(d => ITEMS.docAItemEsperado(d.id, d.data()));
  const itemsV = itemSnap.docs.map(d => ITEMS_V.docAItemEsperado(d.id, d.data()));
  const medidos = movsHoy.filter(m => MEDIDOS.includes(m.id.slice(0, 8)));
  // §1.3 aplicado, simulado: los 6 con pagado: false. Nada se escribe.
  const movsS13 = movsHoy.map(m => (MEDIDOS.includes(m.id.slice(0, 8)) ? { ...m, pagado: false } : m));
  console.log(`F9.188 — verificación (SOLO LECTURA). hoy=${iso(hoy)} mes=${MES} · base ${BASE} · movimientos ${movsHoy.length} · medidos ${medidos.length}/6`);

  // TC como en el Resumen: el rango del mes (−10 días) y el último de tcDiario.
  const [y, mm] = MES.split('-').map(Number);
  const desde = new Date(y, mm - 1, 1); desde.setDate(desde.getDate() - 10);
  const hasta = new Date(y, mm, 0);
  const tcSnap = await db.collection('tcDiario').orderBy(FieldPath.documentId()).startAt(iso(desde)).endAt(iso(hasta)).get();
  const mapaTc: Record<string, number> = {};
  for (const d of tcSnap.docs) { const v = Number(d.data().tcUsdArs); if (v > 0) mapaTc[d.id] = v; }
  // El último doc de tcDiario (cargarTCReciente(1)). Descendente por id pide un índice: se lee el último mes ascendente.
  const hace30 = new Date(hoy); hace30.setDate(hace30.getDate() - 30);
  const recientes = await db.collection('tcDiario').orderBy(FieldPath.documentId()).startAt(iso(hace30)).get();
  const ultimo = recientes.docs.filter(d => Number(d.data().tcUsdArs) > 0).pop();
  const tcEfectivo = Number(ultimo?.data().tcUsdArs);
  const tcDeMov = crearTcDeMovimiento(mapaTc, tcEfectivo, true);
  console.log(`TC: hoy ${fmt(tcEfectivo)} (tcDiario/${ultimo?.id}) · ${Object.keys(mapaTc).length} días en el rango del mes`);

  const datosMes = (movs: Movement[]) => {
    const delMes = movs.filter(m => m.mes === MES);
    const abiertasTodas = movs.filter(m => m.pagado === false).filter(OB.esObligacionAbierta);
    return { delMes, abiertasTodas };
  };

  // ── Verificación 1 ─────────────────────────────────────────────────────────────────────────────
  console.log('\n=== 1. Los totales del 9/10 con el código nuevo y §1.3 aplicado (simulado) ===');
  {
    const { delMes, abiertasTodas } = datosMes(movsS13);
    const fp = OB.faltaPagarMes(delMes, abiertasTodas, MES, ahora, true, m => arsEq(m, tcDeMov));
    for (const m of medidos) {
      const o = fp.obligaciones.find(x => x.mov.id === m.id);
      console.log(`    ${h8(m.id)} ${corto(m.tarjeta, 18).padEnd(18)} ${m.moneda} ${fmt(m.monto).padStart(13)} → ${o ? `en "Falta pagar", ${o.estado}, vence ${iso(o.fechaEfectiva)}` : 'NO está en "Falta pagar"'}`);
    }
    ok(medidos.every(m => fp.obligaciones.some(o => o.mov.id === m.id && o.estado === 'proxima')), 'los 6 salen "A pagar" (obligación abierta, próxima) y suman en "Falta pagar"');
    const camp = OB.obligacionesParaCampana(OB.obligacionesAbiertas(abiertasTodas, ahora), ahora, 14);
    const enCamp = camp.filter(o => MEDIDOS.includes(o.mov.id.slice(0, 8)));
    ok(enCamp.length === 6 && enCamp.every(o => iso(o.fechaEfectiva) === `${MES}-09`),
      `los 6 entran en la campana con fecha 9/10 (${enCamp.length}); la campana los muestra con el día y el badge "Próximo" — no tiene un rótulo "mañana"`);
    const campHoy = OB.obligacionesParaCampana(OB.obligacionesAbiertas(movsHoy.filter(m => m.pagado === false).filter(OB.esObligacionAbierta), ahora), ahora, 14);
    console.log(`    campana sin §1.3: ${campHoy.length} obligaciones · con §1.3: ${camp.length}`);
  }

  // ── Verificación 3 ─────────────────────────────────────────────────────────────────────────────
  console.log('\n=== 3. Confirmar un resumen (commit simulado, nada se escribe) ===');
  {
    const config = await FAM.cargarFamiliaConfig();
    if (!config) throw new Error('sin config/familia');
    const resSnap = await db.collection('resumenesTarjeta').where('estado', '==', 'confirmado').get();
    const resumenes = resSnap.docs.map(d => RT.docACardStatement(d.id, d.data()))
      .filter(r => r.movimientosParseados.length > 0)
      .sort((a, b) => (b.fechaVencimiento?.getTime() ?? 0) - (a.fechaVencimiento?.getTime() ?? 0));
    const lineasDe = (r: CardStatement) => r.movimientosParseados.map(l => ({
      ...l, personaConfirmada: l.personaDetectada ? FAM.resolverNombreMiembro(l.personaDetectada, config) : null,
    }));
    // Un resumen de verdad, con id falso para que la idempotencia no lo frene, y el vencimiento movido.
    const confirmarCon = async (mod: RTMod, r: CardStatement, venc: Date) => {
      const prueba: CardStatement = { ...r, id: `F9188-prueba-${r.id.slice(0, 6)}`, nroResumen: null, fechaVencimiento: venc };
      sim.reset();
      const res = await mod.confirmarResumenTarjeta(prueba, lineasDe(r), String(r.subidoPor ?? 'Juan'), config);
      if (!res.ok) return { error: res.error.message, totales: [] as Record<string, unknown>[], sets: [] as OpBatch[] };
      const sets = (sim.batches[0] ?? []).filter((o: OpBatch) => o.op === 'set');
      return { error: null, totales: sets.filter(o => o.data?.excluirDash === true).map(o => o.data!), sets };
    };
    const verTotal = (d: Record<string, unknown>) =>
      `${s(d.moneda)} monto=${fmt(Number(d.monto))} pagado=${s(d.pagado)} confirmadoPago=${s(d.confirmadoPago)} pagadoEn=${'pagadoEn' in d ? (esServerTimestamp(d.pagadoEn) ? 'serverTimestamp()' : s(d.pagadoEn)) : '(no se escribe)'}`;
    const manana = new Date(hoy); manana.setDate(manana.getDate() + 1); manana.setHours(12);
    const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1); ayer.setHours(12);
    const hoyMediodia = new Date(hoy); hoyMediodia.setHours(12);

    // Uno con los dos totales > 0 y uno con un total en 0.
    let conMonto: CardStatement | null = null, conCero: CardStatement | null = null;
    for (const r of resumenes) {
      const n = RT.totalesNetos(r.movimientosParseados, r.totalARS, r.totalUSD, r);
      const cero = Math.max(n.netoARS, 0) === 0 || Math.max(n.netoUSD, 0) === 0;
      const prueba = await confirmarCon(RT, r, manana);
      if (prueba.error) continue;
      if (!cero && !conMonto) conMonto = r;
      if (cero && !conCero) conCero = r;
      if (conMonto && conCero) break;
    }
    if (!conMonto) { ok(false, 'no se encontró un resumen confirmado que vuelva a cuadrar con los dos totales > 0'); return; }
    console.log(`  resumen con los dos totales > 0: ${h8(conMonto.id)} ${conMonto.tarjetaCodigo} ${conMonto.periodo}`);
    for (const [nombre, venc] of [['vence mañana (antes del vencimiento)', manana], ['vence hoy (se confirma el día del vencimiento)', hoyMediodia], ['venció ayer (después del vencimiento)', ayer]] as const) {
      const viejo = await confirmarCon(RT_V, conMonto, venc);
      const nuevo = await confirmarCon(RT, conMonto, venc);
      console.log(`    ${nombre}:`);
      for (const t of viejo.totales) console.log(`      viejo  ${verTotal(t)}`);
      for (const t of nuevo.totales) console.log(`      nuevo  ${verTotal(t)}`);
      const esperadoPagado = venc !== manana;
      ok(nuevo.totales.length === 2 && nuevo.totales.every(t => t.pagado === esperadoPagado && t.confirmadoPago === esperadoPagado),
        `nuevo: los 2 totales nacen pagado=${esperadoPagado} confirmadoPago=${esperadoPagado}`);
      const consumos = (nuevo.sets ?? []).filter(o => o.data?.excluirDash !== true);
      ok(consumos.every(o => o.data?.pagado === true && o.data?.confirmadoPago === false), `los ${consumos.length} consumos siguen pagado=true confirmadoPago=false (no cambian)`);
      const inv = (nuevo.sets ?? []).every(o => o.data?.confirmadoPago !== true || o.data?.pagado === true);
      ok(inv, 'invariante F9.140 (confirmadoPago ⇒ pagado) en todos los creates');
    }
    if (conCero) {
      console.log(`  resumen con un total en 0: ${h8(conCero.id)} ${conCero.tarjetaCodigo} ${conCero.periodo}`);
      const viejo = await confirmarCon(RT_V, conCero, manana);
      const nuevo = await confirmarCon(RT, conCero, manana);
      for (const t of viejo.totales) console.log(`      viejo  ${verTotal(t)}`);
      for (const t of nuevo.totales) console.log(`      nuevo  ${verTotal(t)}`);
      const ceroV = viejo.totales.find(t => Number(t.monto) === 0), ceroN = nuevo.totales.find(t => Number(t.monto) === 0);
      ok(!!ceroN && ceroN.pagado === true && ceroN.confirmadoPago === true && esServerTimestamp(ceroN.pagadoEn)
        && !!ceroV && ceroV.pagado === ceroN.pagado && ceroV.confirmadoPago === ceroN.confirmadoPago,
        'el total en 0 nace igual que en F9.180: pagado=true confirmadoPago=true pagadoEn, antes del vencimiento');
      const otro = nuevo.totales.find(t => Number(t.monto) > 0);
      if (otro) ok(otro.pagado === false && otro.confirmadoPago === false, 'y el otro total del mismo resumen (> 0) nace a pagar');
    } else {
      console.log('  (ningún resumen confirmado con un total en 0 vuelve a cuadrar: el caso 0 queda cubierto por el código, sin dato)');
    }
  }

  // ── Verificación 4 ─────────────────────────────────────────────────────────────────────────────
  console.log(`\n=== 4. Los números de arriba del Resumen de ${MES}: antes y después ===`);
  {
    const foto = (movs: Movement[]) => {
      const { delMes, abiertasTodas } = datosMes(movs);
      const chk = CHK.calcularChecklist(items, delMes, MES);
      return { delMes, abiertasTodas, chk };
    };
    // Antes: el banner de 940ffa1 sobre los datos de hoy (lo mismo que §0.3).
    const a = foto(movsHoy);
    const chkV = CHK_V.calcularChecklist(itemsV, a.delMes, MES);
    const porRevisar = chkV.filter(c => c.matches.length === 0 && CHK_V.ACCIONABLE.includes(c.estado)).length;
    const agenda = AG_V.construirAgenda(chkV, AG_V.sueltosAbiertosDelMes(a.delMes, chkV));
    const pm = OB_V.pendienteMes(chkV, a.delMes, a.abiertasTodas, MES, ahora, true);
    const cub = agenda.filter(AG_V.agendaCubierto).length;
    const todo = porRevisar === 0 && cub === agenda.length && pm.obligaciones === 0;
    const banner = porRevisar > 0
      ? `Revisar pendientes del mes · ${porRevisar} sin pagar · ${fmtArs(pm.monto)}`
      : todo ? `Todo confirmado · ${cub}/${agenda.length}`
        : `${pm.vencidos > 0 ? `${pm.vencidos} vencido${pm.vencidos > 1 ? 's' : ''} · ` : 'Nada vencido · '}${cub}/${agenda.length} confirmados${pm.monto > 0 ? ` · ${fmtArs(pm.monto)} a pagar` : ''}`;
    console.log(`  ANTES (${BASE}, datos de hoy): "${banner}"`);
    console.log(`     pendienteMes: monto ${fmt(pm.monto)} · vencidos ${pm.vencidos} · obligaciones ${pm.obligaciones}`);

    const dos = (movs: Movement[], rotulo: string) => {
      const f = foto(movs);
      const sc = OB.sinCargarMes(f.chk, (monto, moneda) => (moneda === 'USD' ? monto * tcEfectivo : monto));
      const fp = OB.faltaPagarMes(f.delMes, f.abiertasTodas, MES, ahora, true, m => arsEq(m, tcDeMov));
      const txtSc = `Sin cargar: ${sc.items.length} · ${sc.items.length === 0 ? 'todo cargado' : sc.esperadoArs == null ? 'monto desconocido' : `~${fmtArs(sc.esperadoArs)} esperado`}${sc.vencidos ? ` · ${sc.vencidos} vencidos` : ''}`;
      const txtFp = `Falta pagar: ${fmtArs(fp.ars)} · ${fp.obligaciones.length} obligaciones${fp.vencidas ? ` · ${fp.vencidas} vencidas` : ''}${fp.usd > 0 ? ` · incluye ${fmtUsd(fp.usd)}` : ''}`;
      console.log(`  ${rotulo}:`);
      console.log(`     ${sc.items.length === 0 && fp.obligaciones.length === 0 ? 'Todo cargado y pagado' : `${txtSc}   |   ${txtFp}`}`);
      for (const ci of sc.items) console.log(`       sin cargar: ${h8(ci.item.id)} ${corto(`${ci.item.categoria} › ${ci.item.subcategoria}`, 34).padEnd(34)} ${ci.estado.padEnd(10)} ${ci.item.montoEsperado == null ? '—' : `${ci.item.moneda} ${fmt(ci.item.montoEsperado)}`}`);
      for (const o of fp.obligaciones) console.log(`       a pagar:    ${h8(o.mov.id)} ${o.estado.padEnd(8)} vence ${iso(o.fechaEfectiva)} ${o.mov.moneda} ${fmt(o.mov.monto).padStart(13)} → $ ${fmt(arsEq(o.mov, tcDeMov)).padStart(14)}  ${corto(o.mov.descripcion)}`);
      return { sc, fp };
    };
    const d1 = dos(movsHoy, 'DESPUÉS, código nuevo, datos de hoy (sin §1.3)');
    const d2 = dos(movsS13, 'DESPUÉS, código nuevo + §1.3 aplicado (simulado)');

    // Las diferencias, explicadas con números.
    const crudo = (l: { mov: Movement }[]) => l.reduce((acc, o) => acc + Math.abs(o.mov.monto), 0);
    console.log('  diferencias:');
    console.log(`     · antes ${fmt(pm.monto)} = obligaciones ${fmt(crudo(OB.obligacionesAbiertas(a.delMes, ahora)))} + esperado sin cargar ${fmt(pm.monto - crudo(OB.obligacionesAbiertas(a.delMes, ahora)))}.`);
    console.log(`       Ahora se parte en dos: "Sin cargar" ${d1.sc.items.length} (~${fmt(d1.sc.esperadoArs ?? 0)}) y "Falta pagar" ${fmt(d1.fp.ars)}.`);
    ok(Math.abs(d1.fp.ars + (d1.sc.esperadoArs ?? 0) - pm.monto) < 0.01 || d1.fp.usd > 0,
      `sin dólares en juego, las dos partes suman lo de antes: ${fmt(d1.fp.ars)} + ${fmt(d1.sc.esperadoArs ?? 0)} = ${fmt(d1.fp.ars + (d1.sc.esperadoArs ?? 0))} (antes ${fmt(pm.monto)})`);
    const ars6 = medidos.filter(m => m.moneda === 'ARS').reduce((acc, m) => acc + m.monto, 0);
    const usd6 = medidos.filter(m => m.moneda === 'USD').reduce((acc, m) => acc + m.monto, 0);
    const usd6Ars = medidos.filter(m => m.moneda === 'USD').reduce((acc, m) => acc + arsEq(m, tcDeMov), 0);
    console.log(`     · con §1.3 "Falta pagar" sube ${fmt(d2.fp.ars - d1.fp.ars)}: los 6 totales de tarjeta que pasan a deberse,`);
    console.log(`       ARS ${fmt(ars6)} + U$S ${fmt(usd6)} a TC (${fmt(usd6Ars)} en pesos).`);
    ok(Math.abs(d2.fp.ars - d1.fp.ars - ars6 - usd6Ars) < 0.01, 'la suba es exactamente la de los 6 totales');
    const pmS13 = OB.pendienteMes(foto(movsS13).chk, foto(movsS13).delMes, foto(movsS13).abiertasTodas, MES, ahora, true);
    console.log(`     · monedas: con la suma cruda de antes, los U$S ${fmt(usd6)} habrían sumado como $ ${fmt(usd6)};`);
    console.log(`       el pendiente viejo con §1.3 daría ${fmt(pmS13.monto)}, contra ${fmt(d2.fp.ars + (d2.sc.esperadoArs ?? 0))} sumando los dos datos nuevos.`);
    ok(d2.fp.usd > 0 && Math.abs(d2.fp.usd - usd6) < 0.005, `"incluye ${fmtUsd(d2.fp.usd)}": los dólares se convierten y se dicen aparte`);
  }

  // ── Verificación 5 ─────────────────────────────────────────────────────────────────────────────
  console.log('\n=== 5. No regresión: checklist (estadoItem), agenda y picker de conciliación, viejo vs nuevo ===');
  {
    let difChk = 0, difAg = 0, n = 0;
    const meses = [...new Set(movsHoy.map(m => m.mes))].filter(m => m >= '2026-01').sort();
    for (const mes of meses) {
      const delMes = movsHoy.filter(m => m.mes === mes);
      const v = CHK_V.calcularChecklist(itemsV, delMes, mes);
      const nu = CHK.calcularChecklist(items, delMes, mes);
      for (const c of nu) {
        n++;
        const cv = v.find(x => x.item.id === c.item.id);
        if (!cv || cv.estado !== c.estado || cv.matches.map(m => m.id).join() !== c.matches.map(m => m.id).join()) difChk++;
      }
      const agV = AG_V.construirAgenda(v, AG_V.sueltosAbiertosDelMes(delMes, v));
      const agN = AG.construirAgenda(nu, AG.sueltosAbiertosDelMes(delMes, nu));
      const clave = (e: AgendaEntry) => (e.kind === 'esperado' ? `e:${e.ci.item.id}:${e.ci.estado}:${AG.agendaCubierto(e)}` : `s:${e.mov.id}`);
      if (agV.map(clave).join('|') !== agN.map(clave).join('|')) difAg++;
    }
    ok(difChk === 0, `calcularChecklist: ${n} ítem-mes en ${meses.length} meses (${meses[0]}…${meses[meses.length - 1]}), ${difChk} con otro estado o matches`);
    ok(difAg === 0, `construirAgenda (la fuente del picker de conciliación y de Gastos Fijos): ${difAg} meses distintos`);
    ok(items.every(i => i.cierreAlVencer === false), `docAItemEsperado: los ${items.length} ítems leen cierreAlVencer=false (nadie lo tiene todavía)`);
    // El efecto de §1.3 sobre el estado de los 6 ítems de tarjeta: es el dato el que cambia, no la función.
    const delMes = movsS13.filter(m => m.mes === MES);
    const chk13 = CHK.calcularChecklist(items, delMes, MES);
    const chkHoy = CHK.calcularChecklist(items, movsHoy.filter(m => m.mes === MES), MES);
    for (const m of medidos) {
      const antes = chkHoy.find(c => c.matches.some(x => x.id === m.id));
      const desp = chk13.find(c => c.matches.some(x => x.id === m.id));
      console.log(`    ítem ${h8(m.itemEsperadoId)} (${m.tarjetaCodigo} ${m.moneda}): sin §1.3 ${s(antes?.estado)} → con §1.3 ${s(desp?.estado)}`);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EMULADOR (sintético)
// ════════════════════════════════════════════════════════════════════════════════════════════════
async function emulador(db: Firestore) {
  // functions/src/cierreAlVencer.ts no importa nada de valor de firebase-admin: se carga tal cual y
  // escribe con el Firestore y el FieldValue de la raíz.
  const CAV = await import('../functions/src/cierreAlVencer');
  const sim = crearSim(db);
  const OB = sim.cargar<ObMod>('src/datos/obligaciones.ts');
  const CHK = sim.cargar<ChkMod>('src/datos/checklist.ts');
  const MOV = sim.cargar<MovMod>('src/datos/movimientos.ts');
  const ITEMS = sim.cargar<ItemsMod>('src/datos/itemsEsperados.ts');

  const ahora = new Date();
  const hoyISO = CAV.isoArgentina(ahora);
  const dia = (delta: number, hora = 12) => { const d = new Date(`${hoyISO}T${String(hora).padStart(2, '0')}:00:00-03:00`); d.setUTCDate(d.getUTCDate() + delta); return d; };
  const isoDe = (d: Date) => CAV.isoArgentina(d);
  const MES = hoyISO.slice(0, 7);
  console.log(`=== 2. Cierre al vencer (functions/src/cierreAlVencer.ts) en el emulador · hoy ${hoyISO} ===`);

  // Twin de fechaEfectivaMov: sin depender del TZ del proceso (en Cloud Functions es UTC).
  const ts = (iso: string) => ({ toDate: () => new Date(iso) });
  ok(CAV.fechaEfectivaISO({ fecha: ts('2026-10-09T02:30:00Z') }) === '2026-10-08', 'fechaEfectivaISO: 23:30 ART del 8/10 (02:30 UTC del 9) es el 8/10');
  ok(CAV.fechaEfectivaISO({ fecha: ts('2026-10-09T03:30:00Z') }) === '2026-10-09', 'fechaEfectivaISO: 00:30 ART del 9/10 es el 9/10');
  ok(CAV.fechaEfectivaISO({ fecha: ts('2026-10-01T15:00:00Z'), vencimientos: [{ fecha: '2026-10-20', monto: 1 }] }) === '2026-10-20', 'fechaEfectivaISO: manda vencimientos[0].fecha');
  ok(CAV.fechaEfectivaISO({ fecha: ts('2026-10-01T15:00:00Z'), vencimientos: [{ fecha: '2026-13-45', monto: 1 }] }) === '2026-10-01', 'fechaEfectivaISO: un vencimiento inválido cae a la fecha');

  const item = (id: string, cierre: boolean | undefined, extra: Record<string, unknown> = {}) => ({
    tipo: 'Gasto', activo: true, categoria: 'Tarjetas', subcategoria: 'Pago Tarjeta', moneda: 'ARS', periodicidad: 'mensual',
    pagoAutomatico: false, tarjetaCodigo: `TARJ-${id}`, montoEsperado: null, ...(cierre === undefined ? {} : { cierreAlVencer: cierre }), ...extra,
  });
  const mov = (item: string | null, fecha: Date, extra: Record<string, unknown> = {}) => ({
    fecha: Timestamp.fromDate(fecha), mes: isoDe(fecha).slice(0, 7), tipo: 'Gasto', subtipo: 'Tarjeta', origen: 'Tarjeta',
    descripcion: `Resumen de prueba ${item}`, monto: 1000, moneda: 'ARS', categoria: 'Tarjetas', resumenTarjetaId: `res-${item}`,
    excluirDash: true, incluirResumenMes: true, itemEsperadoId: item, pagado: false, confirmadoPago: false,
    creadoPor: 'Juan', creadoEn: Timestamp.now(), actualizadoEn: Timestamp.now(), ...extra,
  });
  const b = db.batch();
  b.set(db.doc('itemsEsperados/A'), item('A', true));
  b.set(db.doc('itemsEsperados/B'), item('B', false));
  b.set(db.doc('itemsEsperados/C'), item('C', undefined));
  const casos: Record<string, Record<string, unknown>> = {
    'a-hoy': mov('A', dia(0)),                                                   // vence hoy → NO
    'a-ayer': mov('A', dia(-1)),                                                 // vence ayer → SÍ
    'a-ayer-tarde': mov('A', dia(-1, 23)),                                       // 23:00 ART de ayer → SÍ
    'a-hoy-temprano': mov('A', dia(0, 0)),                                       // 00:00 ART de hoy → NO
    'a-venc-futuro': mov('A', dia(-5), { vencimientos: [{ fecha: isoDe(dia(1)), monto: 1000 }] }), // vencimiento mañana → NO
    'a-venc-pasado': mov('A', dia(3), { vencimientos: [{ fecha: isoDe(dia(-2)), monto: 1000 }] }), // vencimiento anteayer → SÍ
    'a-pagado': mov('A', dia(-1), { pagado: true }),                             // ya cubierto → no se toca
    'a-ingreso': mov('A', dia(-1), { tipo: 'Ingreso' }),                         // no es Gasto → NO
    'b-ayer': mov('B', dia(-1)),                                                 // ítem con false → NO, y queda vencido
    'c-ayer': mov('C', dia(-1)),                                                 // ítem sin el campo → NO
    'suelto-ayer': mov(null, dia(-1)),                                           // sin ítem → NO
  };
  for (const [id, d] of Object.entries(casos)) b.set(db.doc(`movimientos/${id}`), d);
  await b.commit();
  const antes = new Map((await db.collection('movimientos').get()).docs.map(d => [d.id, d.data()]));

  const cand = await CAV.candidatasCierreAlVencer(db, hoyISO);
  console.log(`  candidatas: ${cand.map(c => `${c.id} (${c.fechaEfectiva})`).join(', ')}`);
  const r1 = await CAV.cerrarAlVencer(db, hoyISO, FieldValue.serverTimestamp());
  const esperadas = ['a-ayer', 'a-ayer-tarde', 'a-venc-pasado'];
  ok(r1.map(c => c.id).sort().join() === esperadas.sort().join(), `primera corrida cierra ${r1.length}: ${r1.map(c => c.id).join(', ')} (esperadas ${esperadas.join(', ')})`);
  const tras = new Map((await db.collection('movimientos').get()).docs.map(d => [d.id, d.data()]));
  for (const id of esperadas) {
    const x = tras.get(id)!;
    ok(x.pagado === true && x.cerradoPor === CAV.MARCA_CIERRE_AL_VENCER && !!x.cerradoEn && x.actualizadoEn?.toMillis() !== antes.get(id)!.actualizadoEn.toMillis() && x.confirmadoPago === false,
      `${id}: pagado=true · cerradoPor='${x.cerradoPor}' · cerradoEn · actualizadoEn nuevo · confirmadoPago sigue ${x.confirmadoPago}`);
  }
  const intactos = [...antes.keys()].filter(id => !esperadas.includes(id));
  const tocados = intactos.filter(id => JSON.stringify(antes.get(id)) !== JSON.stringify(tras.get(id)));
  ok(tocados.length === 0, `los otros ${intactos.length} no se tocaron (vence hoy, 00:00 de hoy, vencimiento futuro, ya pagado, Ingreso, ítem false, ítem sin campo, suelto)${tocados.length ? ': ' + tocados.join(', ') : ''}`);
  const r2 = await CAV.cerrarAlVencer(db, hoyISO, FieldValue.serverTimestamp());
  const tras2 = new Map((await db.collection('movimientos').get()).docs.map(d => [d.id, d.data()]));
  const reescritos = [...tras.keys()].filter(id => tras.get(id)!.actualizadoEn?.toMillis() !== tras2.get(id)!.actualizadoEn?.toMillis());
  ok(r2.length === 0 && reescritos.length === 0, `segunda corrida el mismo día: ${r2.length} cerradas, ${reescritos.length} documentos reescritos (idempotente)`);
  // Al día siguiente, la que vencía hoy sí se cierra.
  const manana = isoDe(dia(1));
  const r3 = await CAV.candidatasCierreAlVencer(db, manana);
  ok(r3.map(c => c.id).sort().join() === ['a-hoy', 'a-hoy-temprano'].join(), `corriendo mañana (${manana}) cerraría ${r3.map(c => c.id).join(', ')}: lo de hoy, el día siguiente`);

  // Con las funciones reales del cliente: la del ítem en false queda abierta y VENCIDA.
  const movs = (await db.collection('movimientos').get()).docs.map(d => MOV.docAMovimiento(d.id, d.data()));
  const abiertas = OB.obligacionesAbiertas(movs.filter(OB.esObligacionAbierta), ahora);
  const bAyer = abiertas.find(o => o.mov.id === 'b-ayer');
  ok(bAyer?.estado === 'vencida', `b-ayer (ítem con cierreAlVencer=false): obligación abierta, estado ${s(bAyer?.estado)}`);
  const aHoy = abiertas.find(o => o.mov.id === 'a-hoy');
  ok(aHoy?.estado === 'hoy', `a-hoy (ítem con true, vence hoy): sigue a la vista como "${s(aHoy?.estado)}"`);
  const items = (await db.collection('itemsEsperados').get()).docs.map(d => ITEMS.docAItemEsperado(d.id, d.data()));
  const chk = CHK.calcularChecklist(items, movs.filter(m => m.mes === MES), MES);
  const est = (id: string) => chk.find(c => c.item.id === id)?.estado;
  // El checklist NO lo marca vencido, y es de antes: `fechaEfectivaItem` mira `vencimientos[0]` del
  // match o el `diaVencimiento` del ítem, y un total de resumen no trae ninguno de los dos (los 8 ítems
  // de tarjeta tienen diaVencimiento null, §0.2). Lo vencido se ve por la obligación: card de vencidos
  // y campana. estadoItem no se toca en F9.188.
  console.log(`  checklist ${MES}: A ${s(est('A'))} · B ${s(est('B'))} · C ${s(est('C'))} (sin vencimientos ni diaVencimiento, estadoItem no puede vencer: ver el reporte)`);
  const camp = OB.obligacionesParaCampana(abiertas, ahora, 14);
  ok(camp.some(o => o.mov.id === 'b-ayer' && o.estado === 'vencida'), 'b-ayer entra en la campana como vencida (y en la card de vencidos: vencidasParaResumen)');
  ok(items.find(i => i.id === 'A')?.cierreAlVencer === true && items.find(i => i.id === 'C')?.cierreAlVencer === false, 'docAItemEsperado: A true, C (sin el campo) false');

  // ── reglas ─────────────────────────────────────────────────────────────────────────────────────
  console.log('\n=== firestore.rules: itemsEsperados.cierreAlVencer (rules-unit-testing) ===');
  const { initializeTestEnvironment } = req('@firebase/rules-unit-testing') as typeof import('@firebase/rules-unit-testing');
  const { doc, setDoc, updateDoc } = clienteFS;
  const env = await initializeTestEnvironment({ projectId: PROYECTO, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore() as unknown as import('firebase/firestore').Firestore;
    await setDoc(doc(d, 'autorizados/juan@test.com'), { rol: 'admin', memberId: 'Juan' });
    await setDoc(doc(d, 'autorizados/sofia@test.com'), { rol: 'dependiente', memberId: 'Sofía' });
  });
  const admin = env.authenticatedContext('uid-juan', { email: 'juan@test.com', email_verified: true }).firestore() as unknown as import('firebase/firestore').Firestore;
  const miembro = env.authenticatedContext('uid-sofia', { email: 'sofia@test.com', email_verified: true }).firestore() as unknown as import('firebase/firestore').Firestore;
  const caso = async (nombre: string, esperado: 'OK' | 'RECHAZA', accion: () => Promise<unknown>) => {
    let r: string;
    try { await accion(); r = 'OK'; } catch (e) { r = (e as { code?: string }).code === 'permission-denied' ? 'RECHAZA' : `ERROR ${(e as Error).message.slice(0, 80)}`; }
    ok(r === esperado, `${nombre}: esperado ${esperado} → ${r}`);
  };
  const base = item('R', undefined);
  try {
    await caso('admin crea un ítem sin cierreAlVencer (como todos los de antes)', 'OK', () => setDoc(doc(admin, 'itemsEsperados/r1'), base));
    await caso('admin crea un ítem con cierreAlVencer: true', 'OK', () => setDoc(doc(admin, 'itemsEsperados/r2'), { ...base, cierreAlVencer: true }));
    await caso('admin crea un ítem con cierreAlVencer: "si" (no bool)', 'RECHAZA', () => setDoc(doc(admin, 'itemsEsperados/r3'), { ...base, cierreAlVencer: 'si' }));
    await caso('admin prende cierreAlVencer en un ítem existente', 'OK', () => updateDoc(doc(admin, 'itemsEsperados/r1'), { cierreAlVencer: true }));
    await caso('admin lo apaga', 'OK', () => updateDoc(doc(admin, 'itemsEsperados/r1'), { cierreAlVencer: false }));
    await caso('admin le pone null', 'RECHAZA', () => updateDoc(doc(admin, 'itemsEsperados/r1'), { cierreAlVencer: null }));
    await caso('un miembro no admin lo prende', 'RECHAZA', () => updateDoc(doc(miembro, 'itemsEsperados/r1'), { cierreAlVencer: true }));
  } finally {
    await env.cleanup();
  }
}

async function main() {
  const emu = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (EMULADOR && !emu) throw new Error('--emulador corre dentro de firebase emulators:exec (ver el encabezado)');
  if (!EMULADOR && emu) throw new Error('sin --emulador lee producción: correrlo fuera de emulators:exec');
  if (getApps().length === 0) {
    if (emu) initializeApp({ projectId: PROYECTO });
    else initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
  }
  const db = getFirestore();
  if (EMULADOR) await emulador(db); else await produccion(db);
  console.log(`\n${fallas === 0 ? 'TODO OK' : `${fallas} FALLA(S)`}`);
  process.exit(fallas ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
