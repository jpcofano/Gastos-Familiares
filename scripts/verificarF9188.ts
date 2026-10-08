// F9.188 §0 — medición antes de tocar nada. SOLO LECTURA (Admin SDK).
//
//   npx tsx scripts/verificarF9188.ts
//
// 0.1 movimientos-total de resumen (categoria 'Tarjetas' + resumenTarjetaId) con pagado: true y
//     confirmadoPago: false, separados por fecha efectiva: (i) futura o de hoy — dicen "Pagado" sin
//     estarlo, los corrige §1.3 —; (ii) pasada — la plata ya salió, no se tocan. GATE: (i) vacío = PARAR.
// 0.2 ítems esperados activos: pagoAutomatico, tarjetaCodigo, diaVencimiento.
// 0.3 los números del Resumen de octubre hoy, con las funciones reales del cliente (cargadas con
//     scripts/simConfirmarResumen.ts): porRevisar, pendienteMes() completo y el texto del banner.
//
// El texto del banner replica Resumen.tsx:595-640 (origin/main 940ffa1) sin privacidad: es JSX, no
// una función que se pueda importar.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { crearSim } from './simConfirmarResumen';
import type { ExpectedItem, Movement } from '../src/types';
import type { CheckItem } from '../src/datos/checklist';
import type { AgendaEntry } from '../src/datos/agenda';

process.env.TZ = 'America/Argentina/Buenos_Aires';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const sim = crearSim(db);

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
type ObMod = typeof import('../src/datos/obligaciones');
const CHK = sim.cargar<ChkMod>('src/datos/checklist.ts');
const AG = sim.cargar<AgMod>('src/datos/agenda.ts');
const OB = sim.cargar<ObMod>('src/datos/obligaciones.ts');
const MON = sim.cargar<{ fmtMoney: (n: number, o: { from: 'ARS' | 'USD'; to: 'ARS' | 'USD' }) => string }>('src/datos/money.ts');
const MOV = sim.cargar<{ docAMovimiento: (id: string, d: FirebaseFirestore.DocumentData) => Movement }>('src/datos/movimientos.ts');
const ITEMS = sim.cargar<{ docAItemEsperado: (id: string, d: FirebaseFirestore.DocumentData) => ExpectedItem }>('src/datos/itemsEsperados.ts');

const h8 = (v: unknown) => (v ? String(v).slice(0, 8) : '-');
const corto = (v: unknown, n = 34) => { const t = String(v ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtArs = (n: number) => MON.fmtMoney(n, { from: 'ARS', to: 'ARS' });
const inicioDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

async function main() {
  const ahora = new Date();
  const hoy = inicioDia(ahora);
  const MES = iso(hoy).slice(0, 7);
  const [movSnap, itemSnap] = await Promise.all([db.collection('movimientos').get(), db.collection('itemsEsperados').get()]);
  const movs = movSnap.docs.map(d => MOV.docAMovimiento(d.id, d.data()));
  const crudo = new Map(movSnap.docs.map(d => [d.id, d.data()]));
  const items = itemSnap.docs.map(d => ITEMS.docAItemEsperado(d.id, d.data()));
  console.log(`F9.188 §0 — SOLO LECTURA. hoy=${iso(hoy)} (${ahora.toLocaleTimeString('es-AR')}) mes=${MES} | movimientos: ${movs.length} | itemsEsperados: ${items.length}\n`);

  // ── 0.1 ───────────────────────────────────────────────────────────────────────────────────────
  const totales = movs.filter(m => m.categoria === 'Tarjetas' && !!m.resumenTarjetaId);
  // Sobre el doc crudo: `confirmadoPago` ausente se lee como false (docAMovimiento normaliza igual).
  const nacidosPagados = totales.filter(m => crudo.get(m.id)!.pagado === true && crudo.get(m.id)!.confirmadoPago !== true);
  const futuros = nacidosPagados.filter(m => OB.fechaEfectivaMov(m).getTime() >= hoy.getTime());
  const pasados = nacidosPagados.filter(m => OB.fechaEfectivaMov(m).getTime() < hoy.getTime());
  const porPar = (l: Movement[]) => {
    const c: Record<string, number> = {};
    for (const m of l) { const k = `pagado=${crudo.get(m.id)!.pagado} confirmadoPago=${crudo.get(m.id)!.confirmadoPago ?? '(falta)'}`; c[k] = (c[k] ?? 0) + 1; }
    return Object.entries(c).map(([k, n]) => `${k}: ${n}`).join(' · ');
  };
  console.log(`── 0.1 movimientos-total de resumen (categoria 'Tarjetas' + resumenTarjetaId): ${totales.length}`);
  console.log(`   por par: ${porPar(totales)}`);
  console.log(`   con pagado: true y confirmadoPago: false → ${nacidosPagados.length}`);
  console.log(`   (i) fecha efectiva futura o de hoy (dicen "Pagado" sin estarlo): ${futuros.length}`);
  console.log('       id       | tarjeta                | moneda |         monto | vence      | mes     | itemEsperadoId | creadoEn');
  for (const m of futuros.sort((a, b) => OB.fechaEfectivaMov(a).getTime() - OB.fechaEfectivaMov(b).getTime())) {
    const x = crudo.get(m.id)!;
    const creado = x.creadoEn?.toDate?.() as Date | undefined;
    console.log(`       ${h8(m.id)} | ${corto(m.tarjeta ?? m.tarjetaCodigo, 22).padEnd(22)} | ${m.moneda.padEnd(6)} | ${fmt(m.monto).padStart(13)} | ${iso(OB.fechaEfectivaMov(m))} | ${m.mes} | ${h8(m.itemEsperadoId).padEnd(14)} | ${creado ? iso(creado) : '-'}`);
  }
  const suma = (l: Movement[]) => { const s: Record<string, number> = {}; for (const m of l) s[m.moneda] = (s[m.moneda] ?? 0) + m.monto; return Object.entries(s).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ') || '0'; };
  console.log(`       suma: ${suma(futuros)} · en 0: ${futuros.filter(m => m.monto === 0).length}`);
  const del9 = futuros.filter(m => iso(OB.fechaEfectivaMov(m)) === `${MES}-09`);
  console.log(`       con vencimiento ${MES}-09 (los de la captura): ${del9.length}`);
  console.log(`   (ii) fecha efectiva pasada (la plata ya salió, no se tocan): ${pasados.length}` +
    ` · por mes: ${Object.entries(pasados.reduce((c: Record<string, number>, m) => ({ ...c, [m.mes]: (c[m.mes] ?? 0) + 1 }), {})).sort().map(([k, n]) => `${k}: ${n}`).join(' · ')}`);
  // Los que nacieron con monto 0 y sin confirmar: F9.180 §3 los quiere confirmados. Si aparece alguno
  // es de antes de F9.180; §1.3 no los toca (pagado: true es lo correcto para un total en 0).
  const enCeroSinConf = nacidosPagados.filter(m => m.monto === 0);
  console.log(`   de ellos con monto 0 (anteriores a F9.180 §3; §1.3 no los toca): ${enCeroSinConf.length}`);
  // Los totales abiertos (pagado: false): no deberían existir hasta este cambio.
  const totalesAbiertos = totales.filter(m => crudo.get(m.id)!.pagado === false);
  console.log(`   totales con pagado: false hoy: ${totalesAbiertos.length}${totalesAbiertos.length ? ' → ' + totalesAbiertos.map(m => `${h8(m.id)} ${m.mes} ${m.moneda} ${fmt(m.monto)}`).join(', ') : ''}`);

  // ── 0.2 ───────────────────────────────────────────────────────────────────────────────────────
  const activos = items.filter(i => i.activo).sort((a, b) => Number(!!b.tarjetaCodigo) - Number(!!a.tarjetaCodigo) || String(a.categoria).localeCompare(String(b.categoria)));
  console.log(`\n── 0.2 ítems esperados activos: ${activos.length} (tarjeta ${activos.filter(i => i.tarjetaCodigo).length}, pagoAutomatico ${activos.filter(i => i.pagoAutomatico).length}, con diaVencimiento ${activos.filter(i => i.diaVencimiento).length})`);
  console.log('   id       | tipo    | categoría › subcategoría              | mon | tarjetaCodigo | pagoAutomatico | diaVenc | cierreAlVencer');
  for (const i of activos) {
    const raw = itemSnap.docs.find(d => d.id === i.id)!.data();
    console.log(`   ${h8(i.id)} | ${i.tipo.padEnd(7)} | ${corto(`${i.categoria ?? '?'} › ${i.subcategoria ?? '?'}`, 37).padEnd(37)} | ${i.moneda} | ${String(i.tarjetaCodigo ?? '-').padEnd(13)} | ${String(i.pagoAutomatico).padEnd(14)} | ${String(i.diaVencimiento ?? '-').padEnd(7)} | ${raw.cierreAlVencer ?? '(no existe)'}`);
  }

  // ── 0.3 ───────────────────────────────────────────────────────────────────────────────────────
  const movsMes = movs.filter(m => m.mes === MES);
  const abiertasTodas = movs.filter(m => crudo.get(m.id)!.pagado === false).filter(OB.esObligacionAbierta);
  const checklist = CHK.calcularChecklist(items, movsMes, MES);
  const porRevisar = checklist.filter(c => c.matches.length === 0 && CHK.ACCIONABLE.includes(c.estado)).length;
  const sueltos = AG.sueltosAbiertosDelMes(movsMes, checklist);
  const agenda = AG.construirAgenda(checklist, sueltos);
  const pm = OB.pendienteMes(checklist, movsMes, abiertasTodas, MES, ahora, true);
  const cubiertos = agenda.filter(AG.agendaCubierto).length;
  const total = agenda.length;
  const todoConfirmado = porRevisar === 0 && cubiertos === total && pm.obligaciones === 0;
  const vencidos = pm.vencidos;
  const banner = porRevisar > 0
    ? `Revisar pendientes del mes · ${porRevisar} sin pagar · ${fmtArs(pm.monto)}`
    : todoConfirmado
      ? `Todo confirmado · ${cubiertos}/${total}`
      : `${vencidos > 0 ? `${vencidos} vencido${vencidos > 1 ? 's' : ''} · ` : 'Nada vencido · '}${cubiertos}/${total} confirmados${pm.monto > 0 ? ` · ${fmtArs(pm.monto)} a pagar` : ''}`;
  console.log(`\n── 0.3 Resumen de ${MES} hoy (funciones reales del cliente)`);
  console.log(`   porRevisar (sin nada cargado y accionable, Gasto e Ingreso): ${porRevisar}`);
  for (const c of checklist.filter(c => c.matches.length === 0 && CHK.ACCIONABLE.includes(c.estado))) {
    console.log(`     · ${h8(c.item.id)} ${c.item.tipo.padEnd(7)} ${corto(`${c.item.categoria} › ${c.item.subcategoria}`, 36).padEnd(36)} ${c.estado.padEnd(13)} esperado ${c.item.montoEsperado == null ? '—' : `${c.item.moneda} ${fmt(c.item.montoEsperado)}`}`);
  }
  console.log(`   pendienteMes(): monto ${fmt(pm.monto)} · vencidos ${pm.vencidos} · obligaciones ${pm.obligaciones}`);
  const delMes = OB.obligacionesAbiertas(movsMes, ahora);
  const anteriores = OB.vencidasAnteriores(abiertasTodas, MES, ahora);
  const sinCargar = checklist.filter(c => c.item.tipo === 'Gasto' && c.matches.length === 0 && !['pagado', 'automatico'].includes(c.estado));
  console.log(`     (i)  obligaciones abiertas del mes: ${delMes.length} · ${suma(delMes.map(o => o.mov))}`);
  for (const o of delMes) console.log(`          ${h8(o.mov.id)} ${o.estado.padEnd(8)} vence ${iso(o.fechaEfectiva)} ${o.mov.moneda} ${fmt(o.mov.monto).padStart(13)} ${corto(o.mov.descripcion)}`);
  console.log(`          vencidas de meses anteriores: ${anteriores.length} · ${suma(anteriores.map(o => o.mov))}`);
  console.log(`     (ii) ítems de Gasto sin nada cargado y sin cubrir: ${sinCargar.length} · montoEsperado ${fmt(sinCargar.reduce((s, c) => s + (c.item.montoEsperado ?? 0), 0))}`);
  for (const c of sinCargar) console.log(`          ${h8(c.item.id)} ${c.estado.padEnd(13)} ${corto(`${c.item.categoria} › ${c.item.subcategoria}`, 36).padEnd(36)} ${c.item.montoEsperado == null ? '—' : `${c.item.moneda} ${fmt(c.item.montoEsperado)}`}`);
  const usdCrudo = [...delMes, ...anteriores].filter(o => o.mov.moneda === 'USD').reduce((s, o) => s + o.mov.monto, 0)
    + sinCargar.filter(c => c.item.moneda === 'USD').reduce((s, c) => s + (c.item.montoEsperado ?? 0), 0);
  console.log(`     de ese monto, dólares sumados como si fueran pesos: U$S ${fmt(usdCrudo)}`);
  console.log(`   agenda: ${cubiertos}/${total} cubiertos (${sueltos.length} sueltos)`);
  console.log(`   texto del banner: "${banner}"`);

  // ── gate ─────────────────────────────────────────────────────────────────────────────────────
  console.log(`\nGATE: 0.1 (i) = ${futuros.length}${futuros.length === 0 ? ' → VACÍO: el diagnóstico no es este. PARAR.' : ` → sigue (${del9.length} con vencimiento el 9/10).`}`);
}

main().catch(e => { console.error(e); process.exit(1); });
