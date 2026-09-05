// F9.156-pre — volcado crudo de resúmenes de tarjeta, sus movimientos y el checklist. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'node:fs';
// checklist.ts es puro (solo tipos), así que se importa el motor REAL. `docAItemEsperado` no se
// puede importar: arrastra src/firebase.ts, que usa import.meta.env y no existe fuera de Vite.
import { calcularChecklist, mesActualStr } from '../src/datos/checklist';
import type { Movement, ExpectedItem } from '../src/types';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();

const lineas: string[] = [];
function out(l = '') { lineas.push(l); console.log(l); }
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const fecha = (v: unknown) => {
  const t = v as { toDate?: () => Date } | null | undefined;
  return t?.toDate ? t.toDate().toISOString().slice(0, 10) : s(v);
};

async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  const movsSnap = await db.collection('movimientos').get();
  const itemsSnap = await db.collection('itemsEsperados').get();

  // ── (a) resúmenes ─────────────────────────────────────────────────────────
  out(`=== (a) resumenesTarjeta: ${resus.size} docs, ordenados por periodo ===`);
  out();
  const porEstado: Record<string, number> = {};
  for (const d of resus.docs) porEstado[s(d.data().estado)] = (porEstado[s(d.data().estado)] ?? 0) + 1;
  out('por estado: ' + JSON.stringify(porEstado));
  out();
  const ordenados = resus.docs.slice().sort((a, b) => s(a.data().periodo).localeCompare(s(b.data().periodo)));
  for (const d of ordenados) {
    const x = d.data();
    out(`${d.id.slice(0, 8)} | ${s(x.estado).padEnd(16)} | ${s(x.banco).padEnd(22)} | ${s(x.tarjeta).padEnd(18)} | ${s(x.periodo)} | cierre=${fecha(x.fechaCierre)} | venc=${fecha(x.fechaVencimiento)}`);
    out(`         totalARS=${s(x.totalARS).padStart(12)} | totalUSD=${s(x.totalUSD).padStart(10)} | pagoMinARS=${s(x.pagoMinimoARS).padStart(11)} | tarjetaCodigo=${s(x.tarjetaCodigo)}`);
    out(`         numeroCuenta=${s(x.numeroCuenta)} | ultimos4=${s(x.ultimos4)} | confirmadoEn=${fecha(x.confirmadoEn)} | movimientosParseados=${Array.isArray(x.movimientosParseados) ? x.movimientosParseados.length : 0}`);
    if (x.estado !== 'confirmado') {
      out(`         >>> NO CONFIRMADO | tipoError=${s(x.tipoError)} | intentos=${s(x.intentos)} | duplicadoDe=${s(x.duplicadoDe)}`);
      out(`         >>> errorExtraccion=${s(x.errorExtraccion)}`);
      out(`         >>> observaciones=${s(x.observaciones)}`);
    }
    out();
  }

  // ── (b) movimientos por resumen ───────────────────────────────────────────
  out('=== (b) movimientos generados por cada resumen (por resumenTarjetaId) ===');
  out();
  let conDos = 0, conUno = 0, conCero = 0;
  for (const d of ordenados) {
    const x = d.data();
    // El join NO es solo por doc id: los 17 resúmenes del seed llevan un `resumenTarjetaId` legacy
    // con formato `{tarjetaCodigo}_{nroResumen}` (ej. "GAL-VISA_VI00000000042774389") que no
    // coincide con el id del documento. Sin contemplarlo parecía que no tenían movimientos.
    const claveLegacy = `${s(x.tarjetaCodigo)}_${s(x.nroResumen)}`;
    const esMio = (m: FirebaseFirestore.QueryDocumentSnapshot) => {
      const k = s(m.data().resumenTarjetaId);
      return k === d.id || k === claveLegacy;
    };
    const todos = movsSnap.docs.filter(esMio);
    // Los movimientos-TOTAL (los que crea confirmarResumen) son los que llevan excluirDash: true;
    // el resto son los renglones parseados del PDF, que también llevan resumenTarjetaId.
    const míos = todos.filter(m => m.data().excluirDash === true);
    const monedas = míos.map(m => s(m.data().moneda)).sort().join('+') || '(ninguna)';
    if (míos.length >= 2) conDos++; else if (míos.length === 1) conUno++; else conCero++;
    const falta = Number(x.totalUSD ?? 0) !== 0 && !míos.some(m => m.data().moneda === 'USD') ? '   <<< SIN MOVIMIENTO USD' : '';
    out(`${d.id.slice(0, 8)} | ${s(x.periodo)} | ${s(x.estado).padEnd(16)} | totalARS=${s(x.totalARS).padStart(12)} totalUSD=${s(x.totalUSD).padStart(9)} | movs-total=${míos.length} [${monedas}] | renglones=${todos.length - míos.length}${falta}`);
    for (const m of míos) {
      const y = m.data();
      out(`    ${m.id} | ${s(y.moneda)} ${s(y.monto).padStart(12)} | mes=${s(y.mes)} | pagado=${s(y.pagado)} confirmadoPago=${s(y.confirmadoPago)} | item=${s(y.itemEsperadoId)}`);
      out(`      incluirResumenMes=${s(y.incluirResumenMes)} excluirDash=${s(y.excluirDash)} | ${s(y.descripcion)}`);
    }
    out();
  }
  out(`resúmenes con 2+ movimientos (ARS+USD): ${conDos} | con 1 solo: ${conUno} | con ninguno: ${conCero}`);
  out();

  // ── (c) ítems esperados de tarjeta ────────────────────────────────────────
  out('=== (c) itemsEsperados de tarjeta (tarjetaCodigo poblado o categoria "Tarjetas") ===');
  out();
  const itemsTarjeta = itemsSnap.docs.filter(d => d.data().tarjetaCodigo || d.data().categoria === 'Tarjetas');
  for (const d of itemsTarjeta) {
    const x = d.data();
    out(`${d.id} | ${s(x.tipo)} | ${s(x.categoria)} > ${s(x.subcategoria)} | moneda=${s(x.moneda)} | montoEsperado=${s(x.montoEsperado).padStart(12)} | tarjetaCodigo=${s(x.tarjetaCodigo)}`);
    out(`         activo=${s(x.activo)} | periodicidad=${s(x.periodicidad)} | diaVencimiento=${s(x.diaVencimiento)} | actualizadoEn=${fecha(x.actualizadoEn)}`);
  }
  out();

  out('--- cruce (c) x (b): en qué meses cada ítem de tarjeta tuvo movimiento ---');
  for (const d of itemsTarjeta) {
    const x = d.data();
    const míos = movsSnap.docs.filter(m => m.data().itemEsperadoId === d.id);
    const meses = míos.map(m => `${s(m.data().mes)}(${s(m.data().moneda)} ${s(m.data().monto)})`).sort();
    out(`  ${s(x.moneda)} ${s(x.subcategoria).padEnd(14)} ${d.id} | movimientos: ${míos.length} ${meses.length ? '→ ' + meses.join(', ') : '→ NINGUNO'}`);
  }
  out();

  // ── (d) checklist real ────────────────────────────────────────────────────
  out('=== (d) estado de checklist REAL (calcularChecklist importado, no replicado) ===');
  out();
  const items: ExpectedItem[] = itemsSnap.docs.map(d => {
    const y = d.data();
    return {
      id: d.id,
      tipo: y.tipo, activo: y.activo ?? false,
      categoria: y.categoria ?? null, subcategoria: y.subcategoria ?? null,
      etiqueta: y.etiqueta ?? null, persona: y.persona ?? null,
      moneda: y.moneda ?? 'ARS', banco: y.banco ?? null,
      montoEsperado: y.montoEsperado ?? null, diaVencimiento: y.diaVencimiento ?? null,
      autoCalendario: y.autoCalendario ?? false, notas: y.notas ?? null,
      tarjetaCodigo: y.tarjetaCodigo ?? null,
      matchTexto: y.matchTexto ? { incluye: y.matchTexto.incluye ?? [], excluye: y.matchTexto.excluye ?? [] } : null,
      periodicidad: y.periodicidad || 'mensual', pagoAutomatico: y.pagoAutomatico ?? false,
      clavesDesambiguacion: Array.isArray(y.clavesDesambiguacion) ? y.clavesDesambiguacion : null,
      diaCorteImputacion: y.diaCorteImputacion ?? null,
    } as ExpectedItem;
  });
  const idsTarjeta = new Set(itemsTarjeta.map(d => d.id));

  const movimientos: Movement[] = movsSnap.docs.map(d => {
    const y = d.data();
    return {
      ...y,
      id: d.id,
      fecha: (y.fecha as { toDate?: () => Date } | null)?.toDate?.() ?? new Date(0),
      creadoEn: (y.creadoEn as { toDate?: () => Date } | null)?.toDate?.() ?? new Date(0),
      actualizadoEn: (y.actualizadoEn as { toDate?: () => Date } | null)?.toDate?.() ?? new Date(0),
      fechaConsumoOriginal: (y.fechaConsumoOriginal as { toDate?: () => Date } | null)?.toDate?.() ?? null,
      pagadoEn: (y.pagadoEn as { toDate?: () => Date } | null)?.toDate?.() ?? null,
    } as unknown as Movement;
  });

  const mesAct = mesActualStr();
  const mesMenos = (n: number) => {
    const [y, m] = mesAct.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 - n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const meses = [mesMenos(2), mesMenos(1), mesAct];
  out(`mes actual = ${mesAct} | meses evaluados: ${meses.join(', ')}`);
  out();

  const pendientesUsd: string[] = [];
  for (const mes of meses) {
    const movsMes = movimientos.filter(m => m.mes === mes);
    const chk = calcularChecklist(items, movsMes, mes);
    out(`--- ${mes} ---`);
    for (const ci of chk) {
      if (!idsTarjeta.has(ci.item.id)) continue;
      const marca = ci.item.moneda === 'USD' && ci.estado === 'pendiente' ? '   <<< PENDIENTE COLGADO' : '';
      out(`  ${ci.item.moneda} ${s(ci.item.subcategoria).padEnd(14)} ${ci.item.id} | estado=${ci.estado.padEnd(14)} | matches=${ci.matches.length} ${ci.matches.map(m => `${m.moneda} ${m.monto}`).join(', ')}${marca}`);
      if (marca) pendientesUsd.push(`${mes} | ${ci.item.id} | ${s(ci.item.subcategoria)} | montoEsperado=${s(ci.item.montoEsperado)}`);
    }
    out();
  }

  out(`>>> ítems-mes en USD en estado 'pendiente': ${pendientesUsd.length}`);
  for (const p of pendientesUsd) out('    ' + p);
  out();

  // ── §2.4 — el caso espejo ────────────────────────────────────────────────
  out('=== §2.4 — ¿algún resumen con totalARS === 0 y totalUSD > 0? ===');
  const espejo = resus.docs.filter(d => Number(d.data().totalARS ?? 0) === 0 && Number(d.data().totalUSD ?? 0) > 0);
  if (espejo.length === 0) out('  (ninguno)');
  for (const d of espejo) {
    const x = d.data();
    out(`  ${d.id.slice(0, 8)} | ${s(x.periodo)} | totalARS=${s(x.totalARS)} totalUSD=${s(x.totalUSD)} | ${s(x.banco)} ${s(x.tarjeta)}`);
  }
  out();
  out('  --- distribución de (totalARS, totalUSD) sobre los resúmenes confirmados ---');
  const conf = resus.docs.filter(d => d.data().estado === 'confirmado');
  let ambos = 0, soloArs = 0, soloUsd = 0, ninguno = 0;
  for (const d of conf) {
    const a = Number(d.data().totalARS ?? 0) > 0;
    const u = Number(d.data().totalUSD ?? 0) > 0;
    if (a && u) ambos++; else if (a) soloArs++; else if (u) soloUsd++; else ninguno++;
  }
  out(`  confirmados: ${conf.length} | ARS>0 y USD>0: ${ambos} | solo ARS: ${soloArs} | solo USD: ${soloUsd} | los dos en 0: ${ninguno}`);

  fs.writeFileSync('docs/F9.156-pre-volcado-resumenes.txt', lineas.join('\n'), 'utf8');
  console.log('\n(escrito también en docs/F9.156-pre-volcado-resumenes.txt)');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
