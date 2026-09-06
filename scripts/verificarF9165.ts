// F9.165 §3 — verificación: los 4 `parcial` de tarjeta desaparecen, el banner del mes en curso no
// cambia, y ningún ítem no-tarjeta cambia de estado. SOLO LEE.
//
// El motor (`calcularChecklist`, `estadoItem`, `pendienteDeEntrada`) se BUNDLEA del fuente. El
// "después" se simula poniendo `montoEsperado: null` en los ítems de tarjeta, que es exactamente el
// estado al que llegan cuando la confirmación deja de escribirlo.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const req = createRequire(process.cwd() + '/functions/package.json');
const esbuild = req('esbuild') as typeof import('esbuild');
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const f2 = (v: number) => v.toFixed(2).padStart(14);
let ok = 0, fail = 0;
const chkOk = (rot: string, cond: boolean, det = '') => {
  if (cond) { ok++; console.log(`  OK   ${rot}${det ? ' — ' + det : ''}`); }
  else { fail++; console.log(`  FAIL ${rot}${det ? ' — ' + det : ''}`); }
};

const mk = (entry: string, name: string) => {
  const t = path.join(os.tmpdir(), `${name}-${Date.now()}.cjs`);
  esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: t, logLevel: 'silent' });
  return t;
};
const tA = mk('src/datos/checklist.ts', 'f9165chk');
const tB = mk('src/datos/agenda.ts', 'f9165ag');
const chk = require(tA) as { calcularChecklist: (i: any[], m: any[], mes: string) => any[]; mesActualStr: () => string };
const ag = require(tB) as { pendienteDeEntrada: (e: any) => number; agendaCubierto: (e: any) => boolean };

const aDate = (v: unknown) => v instanceof Timestamp ? v.toDate() : new Date(0);
const docAItem = (id: string, d: FirebaseFirestore.DocumentData) => ({
  id, tipo: d.tipo ?? 'Gasto', activo: d.activo !== false, categoria: d.categoria ?? null,
  subcategoria: d.subcategoria ?? null, etiqueta: d.etiqueta ?? null, persona: d.persona ?? null,
  moneda: d.moneda === 'USD' ? 'USD' : 'ARS', banco: d.banco ?? null,
  montoEsperado: d.montoEsperado ?? null, diaVencimiento: d.diaVencimiento ?? null,
  autoCalendario: d.autoCalendario ?? false, notas: d.notas ?? null,
  tarjetaCodigo: d.tarjetaCodigo ?? null, matchTexto: d.matchTexto ?? null,
  periodicidad: d.periodicidad ?? 'mensual', pagoAutomatico: d.pagoAutomatico ?? false,
  clavesDesambiguacion: d.clavesDesambiguacion ?? null, diaCorteImputacion: d.diaCorteImputacion ?? null,
});
const docAMov = (id: string, d: FirebaseFirestore.DocumentData) => ({
  id, mes: d.mes ?? '', fecha: aDate(d.fecha), descripcion: d.descripcion ?? '',
  monto: d.monto ?? 0, moneda: d.moneda === 'USD' ? 'USD' : 'ARS', tipo: d.tipo ?? 'Gasto',
  subtipo: d.subtipo ?? '', origen: d.origen ?? '', categoria: d.categoria ?? null,
  subcategoria: d.subcategoria ?? null, etiqueta: d.etiqueta ?? null, banco: d.banco ?? null,
  tarjetaCodigo: d.tarjetaCodigo ?? null, persona: d.persona || null, pagado: d.pagado ?? false,
  confirmadoPago: d.confirmadoPago ?? false, itemEsperadoId: d.itemEsperadoId ?? null,
  excluirDash: d.excluirDash ?? false, incluirResumenMes: d.incluirResumenMes ?? false,
  resumenTarjetaId: d.resumenTarjetaId ?? null, vencimientos: d.vencimientos ?? null,
  mesManual: d.mesManual ?? false,
});
const mesesAtras = (n: number) => {
  const out: string[] = []; const d = new Date(); d.setDate(1);
  for (let i = 0; i < n; i++) { out.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); d.setMonth(d.getMonth() - 1); }
  return out;
};

async function main() {
  const items = (await db.collection('itemsEsperados').get()).docs.map(d => docAItem(d.id, d.data())).filter(i => i.activo);
  const meses = mesesAtras(6);
  const mesAct = chk.mesActualStr();
  const movsPorMes = new Map<string, any[]>();
  for (const mes of meses) {
    movsPorMes.set(mes, (await db.collection('movimientos').where('mes', '==', mes).get()).docs.map(d => docAMov(d.id, d.data())));
  }
  // DESPUÉS = los ítems de tarjeta sin montoEsperado (a lo que llegan al dejar de escribirlo).
  const itemsDesp = items.map(i => i.tarjetaCodigo ? { ...i, montoEsperado: null } : i);

  console.log(`F9.165 §3 — verificación. mes actual = ${mesAct}. SOLO LECTURA.\n`);

  // ── los ítems de tarjeta que HOY tienen montoEsperado escrito por una confirmación ──
  console.log('=== ítems de tarjeta con montoEsperado escrito (NO se tocan; el dueño decide) ===');
  for (const i of items.filter(v => v.tarjetaCodigo))
    console.log(`  ${i.id.slice(0, 8)} | ${s(i.tarjetaCodigo).padEnd(15)} | ${i.moneda} | montoEsperado = ${f2(Number(i.montoEsperado ?? 0))}${i.montoEsperado == null ? '  (ya está en null)' : ''}`);

  // ── §3.1 — los 4 parcial ──────────────────────────────────────────────────
  console.log('\n=== los `parcial` de los 6 meses, antes y después ===');
  const parc = (lista: any[], mes: string) => chk.calcularChecklist(lista, movsPorMes.get(mes)!, mes)
    .filter(ci => ci.estado === 'parcial');
  let antesN = 0, despN = 0;
  for (const mes of meses) {
    for (const ci of parc(items, mes))
      { antesN++; console.log(`  ANTES   ${mes} | ${ci.item.id.slice(0, 8)} | ${(ci.item.tarjetaCodigo ? 'tarjeta' : 'NO-tarjeta').padEnd(10)} | ${ci.item.moneda} | esperado ${f2(Number(ci.item.montoEsperado ?? 0))}`); }
    for (const ci of parc(itemsDesp, mes))
      { despN++; console.log(`  DESPUÉS ${mes} | ${ci.item.id.slice(0, 8)} | ${(ci.item.tarjetaCodigo ? 'tarjeta' : 'NO-tarjeta').padEnd(10)} | ${ci.item.moneda}`); }
  }
  chkOk('había 4 `parcial` antes', antesN === 4, `${antesN}`);
  chkOk('no queda ninguno después', despN === 0, `${despN}`);

  // ── §3.2 — el banner del mes en curso ─────────────────────────────────────
  console.log('\n=== el banner de pendientes, mes a mes ===');
  console.log('mes     |   antes (ARS) |  después (ARS) |     Δ ARS |  antes (USD) | después (USD) |   Δ USD');
  const banner = (lista: any[], mes: string) => {
    let ars = 0, usd = 0;
    for (const ci of chk.calcularChecklist(lista, movsPorMes.get(mes)!, mes)) {
      const e = { kind: 'esperado' as const, ci };
      if (ag.agendaCubierto(e)) continue;
      const v = ag.pendienteDeEntrada(e);
      if (ci.item.moneda === 'ARS') ars += v; else usd += v;
    }
    return { ars, usd };
  };
  let deltaMesActual = { ars: 0, usd: 0 };
  for (const mes of meses) {
    const a = banner(items, mes), b = banner(itemsDesp, mes);
    if (mes === mesAct) deltaMesActual = { ars: b.ars - a.ars, usd: b.usd - a.usd };
    console.log(`${mes} | ${f2(a.ars)} | ${f2(b.ars)} | ${f2(b.ars - a.ars)} | ${f2(a.usd)} | ${f2(b.usd)} | ${f2(b.usd - a.usd)}`);
  }
  chkOk('el banner del mes EN CURSO no cambia', Math.abs(deltaMesActual.ars) < 0.01 && Math.abs(deltaMesActual.usd) < 0.01,
        `Δ ARS ${deltaMesActual.ars.toFixed(2)} | Δ USD ${deltaMesActual.usd.toFixed(2)}`);

  // ── §3.3 — ningún ítem NO-tarjeta cambia de estado ────────────────────────
  console.log('\n=== ¿algún ítem NO-tarjeta cambia de estado? ===');
  let cambianNoTarj = 0, cambianTarj = 0;
  for (const mes of meses) {
    const a = new Map(chk.calcularChecklist(items, movsPorMes.get(mes)!, mes).map(ci => [ci.item.id, ci.estado]));
    const b = new Map(chk.calcularChecklist(itemsDesp, movsPorMes.get(mes)!, mes).map(ci => [ci.item.id, ci.estado]));
    for (const [id, ea] of a) {
      const eb = b.get(id);
      if (ea === eb) continue;
      const it = items.find(v => v.id === id)!;
      if (it.tarjetaCodigo) cambianTarj++; else cambianNoTarj++;
      console.log(`  ${mes} | ${id.slice(0, 8)} | ${(it.tarjetaCodigo ? 'tarjeta' : '>>> NO-tarjeta').padEnd(14)} | ${s(ea)} → ${s(eb)}`);
    }
  }
  chkOk('ningún ítem NO-tarjeta cambia de estado', cambianNoTarj === 0, `${cambianNoTarj}`);
  console.log(`  (ítems de tarjeta que sí cambian: ${cambianTarj} — es el objetivo del cambio)`);

  console.log(`\n${fail === 0 ? 'TODO OK' : 'HAY FALLAS'} — ${ok} ok, ${fail} fail`);
  fs.rmSync(tA, { force: true }); fs.rmSync(tB, { force: true });
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
