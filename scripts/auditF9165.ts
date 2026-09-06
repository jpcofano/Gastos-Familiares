// F9.165 §1 (gate) — ¿hay INGRESOS FANTASMA ya cargados? Movimientos que nacieron de una línea
// `reintegro_percepcion` de un resumen: el crédito de la tarjeta convertido en Ingreso.
// SOLO LEE. No borra nada.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const f2 = (v: number) => v.toFixed(2).padStart(14);
const aDate = (v: unknown) => v instanceof Timestamp ? v.toDate() : null;

/** Los tres tipoLinea que `tipoDeLinea()` manda a Ingreso. */
const TIPOS_INGRESO = ['reintegro_percepcion', 'bonificacion', 'reverso'];
/** Los conceptos del bloque consolidado, mapeados en el gate de F9.164 §1. */
const RE_CONSOLIDADO = /CR\.RG|CANJE PUNTOS|DEV PER|DEV\.IMP/i;

async function main() {
  console.log('F9.165 §1 (gate) — ingresos fantasma. SOLO LECTURA, no se borra nada.\n');

  // ── 1. movimientos de tipo Ingreso nacidos de un resumen de tarjeta ─────────
  const movs = await db.collection('movimientos').where('tipo', '==', 'Ingreso').get();
  const deResumen = movs.docs.filter(d => d.data().resumenTarjetaId);
  console.log(`movimientos tipo=Ingreso en total: ${movs.size}`);
  console.log(`de ésos, con resumenTarjetaId (nacidos de un resumen): ${deResumen.length}\n`);

  console.log('id                       | descripción                          |          monto | mon | mes     | resumenTarjetaId | excluirDash');
  console.log('-'.repeat(132));
  let sospechosos = 0, totalARS = 0, totalUSD = 0;
  for (const d of deResumen.sort((a, b) => Math.abs(b.data().monto ?? 0) - Math.abs(a.data().monto ?? 0))) {
    const x = d.data();
    const esConsolidado = RE_CONSOLIDADO.test(s(x.descripcion)) || RE_CONSOLIDADO.test(s(x.descripcionOriginal));
    if (esConsolidado) {
      sospechosos++;
      if (x.moneda === 'USD') totalUSD += Math.abs(Number(x.monto ?? 0)); else totalARS += Math.abs(Number(x.monto ?? 0));
    }
    console.log(
      `${d.id.padEnd(24)} | ${s(x.descripcion).padEnd(36).slice(0, 36)} | ${f2(Number(x.monto ?? 0))} | ${s(x.moneda)} | ${s(x.mes)} | ${s(x.resumenTarjetaId).slice(0, 16).padEnd(16)} | ${s(x.excluirDash)}${esConsolidado ? '   <<< concepto del consolidado' : ''}`,
    );
  }
  console.log(`\n  con concepto del bloque consolidado (CR.RG / CANJE PUNTOS / DEV PER / DEV.IMP): ${sospechosos}`);
  console.log(`  suman: ARS ${totalARS.toFixed(2)} | USD ${totalUSD.toFixed(2)}`);

  // ── 2. las LÍNEAS guardadas que producirían uno si se confirmara hoy ────────
  console.log('\n' + '═'.repeat(132));
  console.log('LÍNEAS guardadas con tipoLinea de la familia de ingresos y concepto del consolidado');
  console.log('(no son movimientos todavía: lo serían al confirmar el resumen)');
  console.log('═'.repeat(132));
  const resus = await db.collection('resumenesTarjeta').get();
  let lineas = 0, lARS = 0;
  console.log('resumen  | período | estado     | tipoLinea            |          monto | mon | descripción');
  for (const d of resus.docs.sort((a, b) => s(a.data().periodo).localeCompare(s(b.data().periodo)))) {
    const x = d.data();
    for (const l of (x.movimientosParseados ?? []) as any[]) {
      if (!TIPOS_INGRESO.includes(s(l.tipoLinea))) continue;
      if (!RE_CONSOLIDADO.test(s(l.descripcionRaw))) continue;
      lineas++;
      if (l.moneda !== 'USD') lARS += Number(l.monto ?? 0);
      console.log(`${d.id.slice(0, 8)} | ${s(x.periodo)} | ${s(x.estado).padEnd(10)} | ${s(l.tipoLinea).padEnd(20)} | ${f2(Number(l.monto ?? 0))} | ${s(l.moneda)} | ${s(l.descripcionRaw)}`);
    }
  }
  console.log(`\n  líneas así en los 30 resúmenes: ${lineas} (ARS ${lARS.toFixed(2)})`);

  // ── 3. el panorama completo de la familia de ingresos, por si hay otra cosa ─
  console.log('\n' + '═'.repeat(132));
  console.log('TODAS las líneas de la familia de ingresos (para ver si hay algo más que el consolidado)');
  console.log('═'.repeat(132));
  const porTipo = new Map<string, { n: number; ars: number; usd: number; ej: string[] }>();
  for (const d of resus.docs) {
    for (const l of (d.data().movimientosParseados ?? []) as any[]) {
      if (!TIPOS_INGRESO.includes(s(l.tipoLinea))) continue;
      const k = s(l.tipoLinea);
      const e = porTipo.get(k) ?? { n: 0, ars: 0, usd: 0, ej: [] };
      e.n++;
      if (l.moneda === 'USD') e.usd += Number(l.monto ?? 0); else e.ars += Number(l.monto ?? 0);
      if (e.ej.length < 5) e.ej.push(`${s(l.descripcionRaw).slice(0, 40)} (${l.monto})`);
      porTipo.set(k, e);
    }
  }
  for (const [k, e] of [...porTipo].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${k.padEnd(22)} ${String(e.n).padStart(4)} líneas | ARS ${e.ars.toFixed(2).padStart(14)} | USD ${e.usd.toFixed(2).padStart(10)}`);
    for (const ej of e.ej) console.log(`        ej: ${ej}`);
  }
  void aDate;
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
