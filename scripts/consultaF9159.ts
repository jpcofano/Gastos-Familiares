// F9.159-pre — CONSULTA. Cuánto pesa cada uso de `montoEsperado`.
// SOLO LEE: ni una escritura, ni una llamada a la API. `calcularChecklist`, `estadoItem`,
// `pendienteDeEntrada` y `agendaCubierto` se BUNDLEAN del fuente con esbuild — es el código real
// del cliente, no una reimplementación.
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
const f2 = (v: number | null) => v === null ? '        n/d' : v.toFixed(2).padStart(14);

// ── el motor REAL, bundleado ──────────────────────────────────────────────────
const tmp = path.join(os.tmpdir(), `f9159-${Date.now()}.cjs`);
esbuild.buildSync({
  entryPoints: ['src/datos/agenda.ts'],
  bundle: true, platform: 'node', format: 'cjs', outfile: tmp, logLevel: 'silent',
});
const agenda = require(tmp) as {
  pendienteDeEntrada: (e: any) => number;
  agendaCubierto: (e: any) => boolean;
  esEntradaDeGasto: (e: any) => boolean;
};
const tmp2 = path.join(os.tmpdir(), `f9159b-${Date.now()}.cjs`);
esbuild.buildSync({
  entryPoints: ['src/datos/checklist.ts'],
  bundle: true, platform: 'node', format: 'cjs', outfile: tmp2, logLevel: 'silent',
});
const chk = require(tmp2) as {
  calcularChecklist: (items: any[], movs: any[], mes: string) => any[];
  cubierto: (e: string) => boolean;
  mesActualStr: () => string;
};

const aDate = (v: unknown): Date | null =>
  v instanceof Timestamp ? v.toDate() : v instanceof Date ? v : null;
const iso = (d: Date | null) => d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—';

function docAItem(id: string, d: FirebaseFirestore.DocumentData) {
  return {
    id, tipo: d.tipo ?? 'Gasto', activo: d.activo !== false,
    categoria: d.categoria ?? null, subcategoria: d.subcategoria ?? null,
    etiqueta: d.etiqueta ?? null, persona: d.persona ?? null,
    moneda: d.moneda === 'USD' ? 'USD' : 'ARS', banco: d.banco ?? null,
    montoEsperado: d.montoEsperado ?? null, diaVencimiento: d.diaVencimiento ?? null,
    autoCalendario: d.autoCalendario ?? false, notas: d.notas ?? null,
    tarjetaCodigo: d.tarjetaCodigo ?? null, matchTexto: d.matchTexto ?? null,
    periodicidad: d.periodicidad ?? 'mensual', pagoAutomatico: d.pagoAutomatico ?? false,
    clavesDesambiguacion: d.clavesDesambiguacion ?? null,
    diaCorteImputacion: d.diaCorteImputacion ?? null,
    _creadoEn: aDate(d.creadoEn), _actualizadoEn: aDate(d.actualizadoEn),
  };
}
function docAMov(id: string, d: FirebaseFirestore.DocumentData) {
  return {
    id, mes: d.mes ?? '', fecha: aDate(d.fecha) ?? new Date(0),
    descripcion: d.descripcion ?? '', monto: d.monto ?? 0,
    moneda: d.moneda === 'USD' ? 'USD' : 'ARS', tipo: d.tipo ?? 'Gasto',
    subtipo: d.subtipo ?? '', origen: d.origen ?? '',
    categoria: d.categoria ?? null, subcategoria: d.subcategoria ?? null,
    etiqueta: d.etiqueta ?? null, banco: d.banco ?? null,
    tarjetaCodigo: d.tarjetaCodigo ?? null, persona: d.persona || null,
    pagado: d.pagado ?? false, confirmadoPago: d.confirmadoPago ?? false,
    itemEsperadoId: d.itemEsperadoId ?? null, excluirDash: d.excluirDash ?? false,
    incluirResumenMes: d.incluirResumenMes ?? false,
    resumenTarjetaId: d.resumenTarjetaId ?? null,
    vencimientos: d.vencimientos ?? null, mesManual: d.mesManual ?? false,
  };
}

function mesesAtras(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    out.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

async function main() {
  const itemsSnap = await db.collection('itemsEsperados').get();
  const todos = itemsSnap.docs.map(d => docAItem(d.id, d.data()));
  const activos = todos.filter(i => i.activo);
  const resus = await db.collection('resumenesTarjeta').get();
  const confirmaciones = resus.docs
    .map(d => ({ id: d.id.slice(0, 8), t: aDate(d.data().confirmadoEn) }))
    .filter(x => x.t) as Array<{ id: string; t: Date }>;

  // ── (a) ────────────────────────────────────────────────────────────────────
  console.log('═'.repeat(112));
  console.log('(a) ÍTEMS ESPERADOS ACTIVOS Y SU montoEsperado');
  console.log('═'.repeat(112));
  for (const grupo of ['CON tarjetaCodigo (lo sobrescribe la confirmación de resumen)',
                       'SIN tarjetaCodigo (configurado a mano)'] as const) {
    const conTarjeta = grupo.startsWith('CON');
    const lista = activos.filter(i => conTarjeta ? !!i.tarjetaCodigo : !i.tarjetaCodigo);
    console.log(`\n── ${grupo} — ${lista.length} ítems ──`);
    console.log('id       | tipo    | categoría > subcategoría              | mon | montoEsperado  | tarjeta        | autoCal | period. | actualizadoEn    | creadoEn');
    for (const i of lista.sort((a, b) => `${a.categoria}${a.subcategoria}`.localeCompare(`${b.categoria}${b.subcategoria}`))) {
      console.log(
        `${i.id.slice(0, 8)} | ${String(i.tipo).padEnd(7)} | ${`${s(i.categoria)} > ${s(i.subcategoria)}`.padEnd(36).slice(0, 36)} | ${i.moneda} | ${f2(i.montoEsperado)} | ${String(s(i.tarjetaCodigo)).padEnd(14).slice(0, 14)} | ${String(i.autoCalendario).padEnd(7)} | ${String(i.periodicidad).padEnd(7)} | ${iso(i._actualizadoEn).padEnd(16)} | ${iso(i._creadoEn)}`,
      );
    }
  }
  const nTarj = activos.filter(i => i.tarjetaCodigo).length;
  console.log(`\n  TOTAL activos: ${activos.length}  (con tarjetaCodigo: ${nTarj} | sin: ${activos.length - nTarj})`);
  console.log(`  inactivos (no listados): ${todos.length - activos.length}`);

  // ── (b) ────────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(112));
  console.log('(b) ¿QUIÉN EDITA montoEsperado A MANO?');
  console.log('═'.repeat(112));
  const noTarj = activos.filter(i => !i.tarjetaCodigo);
  const conMonto = noTarj.filter(i => i.montoEsperado != null);
  const sinMonto = noTarj.filter(i => i.montoEsperado == null);
  console.log(`  no-tarjeta con montoEsperado configurado: ${conMonto.length} de ${noTarj.length}`);
  console.log(`  no-tarjeta con montoEsperado en null:     ${sinMonto.length} de ${noTarj.length}`);
  for (const i of sinMonto) console.log(`      null → ${i.id.slice(0, 8)} ${s(i.categoria)} > ${s(i.subcategoria)}`);
  console.log('\n  ¿el actualizadoEn de cada ítem coincide con una confirmación de resumen (±5 min)?');
  console.log('  id       | tarjeta? | actualizadoEn    | creadoEn         | ¿tocado después de creado? | ¿coincide con confirmación?');
  for (const i of activos.sort((a, b) => (b._actualizadoEn?.getTime() ?? 0) - (a._actualizadoEn?.getTime() ?? 0))) {
    const act = i._actualizadoEn, cre = i._creadoEn;
    const tocado = act && cre ? (act.getTime() - cre.getTime() > 60_000 ? 'sí' : 'no') : '?';
    const cerca = act ? confirmaciones.find(c => Math.abs(c.t.getTime() - act.getTime()) < 5 * 60_000) : null;
    console.log(`  ${i.id.slice(0, 8)} | ${(i.tarjetaCodigo ? 'sí' : 'no').padEnd(8)} | ${iso(act).padEnd(16)} | ${iso(cre).padEnd(16)} | ${String(tocado).padEnd(26)} | ${cerca ? `sí — resumen ${cerca.id}` : 'no'}`);
  }

  // ── (c) y (d) ──────────────────────────────────────────────────────────────
  const meses = mesesAtras(6);
  const movsPorMes = new Map<string, any[]>();
  for (const mes of meses) {
    const snap = await db.collection('movimientos').where('mes', '==', mes).get();
    movsPorMes.set(mes, snap.docs.map(d => docAMov(d.id, d.data())));
  }
  const mesAct = chk.mesActualStr();

  console.log('\n' + '═'.repeat(112));
  console.log(`(c) TODOS LOS 'parcial' DE LOS ÚLTIMOS 6 MESES (${meses[0]} … ${meses[5]}), mes actual = ${mesAct}`);
  console.log('═'.repeat(112));
  console.log('mes     | id       | categoría > subcategoría          | tarjeta? | mon |     montoConf |  montoEsperado |     diferencia');
  let parcTarj = 0, parcNoTarj = 0;
  const checklistPorMes = new Map<string, any[]>();
  for (const mes of meses) {
    const lista = chk.calcularChecklist(activos, movsPorMes.get(mes)!, mes);
    checklistPorMes.set(mes, lista);
    for (const ci of lista) {
      if (ci.estado !== 'parcial') continue;
      const conf = ci.matches.filter((m: any) => m.confirmadoPago);
      const montoConf = conf.reduce((a: number, m: any) => a + Math.abs(m.monto), 0);
      const esp = ci.item.montoEsperado;
      if (ci.item.tarjetaCodigo) parcTarj++; else parcNoTarj++;
      console.log(`${mes} | ${ci.item.id.slice(0, 8)} | ${`${s(ci.item.categoria)} > ${s(ci.item.subcategoria)}`.padEnd(32).slice(0, 32)} | ${(ci.item.tarjetaCodigo ? 'SÍ' : 'no').padEnd(8)} | ${ci.item.moneda} | ${f2(montoConf)} | ${f2(esp)} | ${f2(montoConf - (esp ?? 0))}`);
    }
  }
  console.log(`\n  'parcial' de ítems de TARJETA:    ${parcTarj}`);
  console.log(`  'parcial' de ítems NO-tarjeta:    ${parcNoTarj}`);
  if (parcTarj + parcNoTarj === 0) console.log('  (ninguno en los 6 meses)');

  console.log('\n' + '═'.repeat(112));
  console.log('(d) EL PESO DEL PRONÓSTICO: ítem-mes donde la agenda usó montoEsperado (sin match, no cubierto)');
  console.log('═'.repeat(112));
  console.log('mes     | id       | categoría > subcategoría          | tarjeta? | mon | estado          | aportó al banner');
  let usosTarj = 0, montoTarjARS = 0, montoTarjUSD = 0, usosNoTarj = 0, montoNoTarj = 0;
  const deltaPorMes = new Map<string, { ars: number; usd: number }>();
  for (const mes of meses) {
    let dA = 0, dU = 0;
    for (const ci of checklistPorMes.get(mes)!) {
      const e = { kind: 'esperado' as const, ci };
      if (agenda.agendaCubierto(e)) continue;
      if (!agenda.esEntradaDeGasto(e)) continue;
      const aporte = agenda.pendienteDeEntrada(e);
      // la rama de pronóstico es exactamente: sin match (o cubierto), o sea aporta montoEsperado
      const usaPronostico = !(ci.matches.length > 0 && !chk.cubierto(ci.estado));
      if (!usaPronostico || aporte === 0) continue;
      if (ci.item.tarjetaCodigo) {
        usosTarj++;
        if (ci.item.moneda === 'ARS') { montoTarjARS += aporte; dA += aporte; }
        else { montoTarjUSD += aporte; dU += aporte; }
      } else { usosNoTarj++; montoNoTarj += aporte; }
      console.log(`${mes} | ${ci.item.id.slice(0, 8)} | ${`${s(ci.item.categoria)} > ${s(ci.item.subcategoria)}`.padEnd(32).slice(0, 32)} | ${(ci.item.tarjetaCodigo ? 'SÍ' : 'no').padEnd(8)} | ${ci.item.moneda} | ${String(ci.estado).padEnd(15)} | ${f2(aporte)}`);
    }
    deltaPorMes.set(mes, { ars: dA, usd: dU });
  }
  console.log(`\n  ítem-mes de TARJETA que usaron el pronóstico: ${usosTarj}  (ARS ${montoTarjARS.toFixed(2)} | USD ${montoTarjUSD.toFixed(2)})`);
  console.log(`  ítem-mes NO-tarjeta que usaron el pronóstico: ${usosNoTarj}  (${montoNoTarj.toFixed(2)} crudo, mezcla de monedas)`);

  // ── §2.3 — el banner con y sin el montoEsperado de tarjeta ─────────────────
  console.log('\n' + '═'.repeat(112));
  console.log('§2.3 — EL BANNER DE PENDIENTES SI montoEsperado DE LOS ÍTEMS DE TARJETA FUERA null');
  console.log('═'.repeat(112));
  console.log('mes     |   banner HOY (ARS) |  banner SIN (ARS) |      Δ ARS |  banner HOY (USD) | banner SIN (USD) |   Δ USD');
  const itemsNull = activos.map(i => i.tarjetaCodigo ? { ...i, montoEsperado: null } : i);
  for (const mes of meses) {
    const sumar = (lista: any[]) => {
      let ars = 0, usd = 0;
      for (const ci of lista) {
        const e = { kind: 'esperado' as const, ci };
        if (agenda.agendaCubierto(e)) continue;
        const v = agenda.pendienteDeEntrada(e);
        if (ci.item.moneda === 'ARS') ars += v; else usd += v;
      }
      return { ars, usd };
    };
    const hoy = sumar(checklistPorMes.get(mes)!);
    const sin = sumar(chk.calcularChecklist(itemsNull, movsPorMes.get(mes)!, mes));
    console.log(`${mes} | ${f2(hoy.ars)} | ${f2(sin.ars)} | ${f2(sin.ars - hoy.ars)} | ${f2(hoy.usd)} | ${f2(sin.usd)} | ${f2(sin.usd - hoy.usd)}`);
  }

  // ── §2.4 — otros campos con el mismo problema latente ─────────────────────
  console.log('\n' + '═'.repeat(112));
  console.log('§2.4 — OTROS CAMPOS DEL ÍTEM: ¿varían mes a mes y viven en un campo único?');
  console.log('═'.repeat(112));
  const CAMPOS = ['diaVencimiento', 'banco', 'persona', 'moneda', 'categoria', 'subcategoria',
                  'etiqueta', 'tarjetaCodigo', 'periodicidad', 'pagoAutomatico', 'autoCalendario',
                  'diaCorteImputacion'] as const;
  console.log('  poblado / null por campo, sobre los ítems activos:');
  for (const c of CAMPOS) {
    const pob = activos.filter(i => (i as any)[c] != null && (i as any)[c] !== '').length;
    console.log(`    ${c.padEnd(20)} poblado en ${String(pob).padStart(2)}/${activos.length}`);
  }
  console.log('\n  ¿el dato del ítem coincide con el de sus movimientos reales, mes a mes?');
  console.log('  (si un ítem tiene UN valor pero sus movimientos traen VARIOS, el campo único no alcanza)');
  for (const campo of ['banco', 'persona', 'diaVencimiento'] as const) {
    console.log(`\n  ── ${campo} ──`);
    for (const i of activos) {
      const vistos = new Map<string, number>();
      for (const mes of meses) {
        for (const ci of checklistPorMes.get(mes)!) {
          if (ci.item.id !== i.id) continue;
          for (const m of ci.matches) {
            const v = campo === 'diaVencimiento'
              ? (m.vencimientos?.[0]?.fecha ? String(m.vencimientos[0].fecha).slice(8, 10) : null)
              : (m as any)[campo];
            if (v == null || v === '') continue;
            vistos.set(String(v), (vistos.get(String(v)) ?? 0) + 1);
          }
        }
      }
      if (vistos.size <= 1) continue;
      console.log(`    ${i.id.slice(0, 8)} ${`${s(i.categoria)} > ${s(i.subcategoria)}`.padEnd(30).slice(0, 30)} | ítem dice "${s((i as any)[campo])}" | movimientos traen ${JSON.stringify([...vistos])}`);
    }
  }
  fs.rmSync(tmp, { force: true }); fs.rmSync(tmp2, { force: true });
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
