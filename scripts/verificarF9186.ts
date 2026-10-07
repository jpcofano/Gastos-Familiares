// F9.186 — verificación de la extracción del resumen 37ab6ea1 después del "Reintentar" con F9.181
// deployado. SOLO LECTURA.
//
//   npx tsx scripts/verificarF9186.ts
//
// 1. el doc: estado, líneas, totales, consolidado, timestamps, error
// 2. el cuadre con el calcularCuadre REAL del cliente (sin ediciones), ARS y USD
// 3. lo que se puede comparar contra F9.181 (docs/F9.181.txt solo guarda agregados de esa corrida:
//    líneas, output_tokens, encabezado, cuadre), más el perfil de líneas de esta extracción
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { crearSim } from './simConfirmarResumen';
import type { CardStatement, MovimientoParseado } from '../src/types';
import type { CuadreResult } from '../src/datos/resumenesTarjeta';

process.env.TZ = 'America/Argentina/Buenos_Aires';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const sim = crearSim(db);
type RTMod = {
  docACardStatement: (id: string, data: FirebaseFirestore.DocumentData) => CardStatement;
  calcularCuadre: (l: MovimientoParseado[], tARS: number, tUSD: number, aj: CardStatement['ajustesConsolidado'], c?: CardStatement | null) => CuadreResult;
};
const RT = sim.cargar<RTMod>('src/datos/resumenesTarjeta.ts');

const s = (v: unknown) => (v === null ? 'null' : v === undefined ? '(ausente)' : String(v));
const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hora = (v: unknown) => {
  const t = v as { toDate?: () => Date } | null | undefined;
  return t?.toDate ? t.toDate().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }) : s(v);
};
const r2 = (n: number) => Math.round(n * 100) / 100;

// F9.181, verificación 1 (docs/F9.181.txt): la extracción con el prompt nuevo del mismo PDF.
const F9181 = {
  lineas: 155, totalARS: 3262475.8, totalUSD: 141.65, saldoAnteriorARS: 1403821.1, saldoAnteriorUSD: 73.55,
  pagosDelPeriodoARS: -1370414.69, pagosDelPeriodoUSD: -73.55, sumaARS: 3229069.39, sumaUSD: 141.65,
  ajustes: [{ concepto: 'CR.RG 5617 30% M', montoARS: -33406.41, montoUSD: 0 }],
};

async function main() {
  const d = (await db.collection('resumenesTarjeta').get()).docs.find(x => x.id.startsWith('37ab6ea1'));
  if (!d) { console.log('>>> 37ab6ea1 no está'); return; }
  const x = d.data();
  const ls = (x.movimientosParseados ?? []) as MovimientoParseado[];

  console.log('F9.186 — 37ab6ea1, SOLO LECTURA\n');
  console.log('── 1. el doc');
  for (const k of ['estado', 'banco', 'tarjeta', 'tarjetaCodigo', 'periodo', 'fechaCierre', 'fechaVencimiento', 'nroResumen',
    'totalARS', 'totalUSD', 'saldoAnteriorARS', 'saldoAnteriorUSD', 'pagosDelPeriodoARS', 'pagosDelPeriodoUSD', 'pagoMinimoARS',
    'errorExtraccion', 'tipoError', 'intentos', 'duplicadoDe'])
    console.log(`  ${k.padEnd(20)} ${s(x[k])}`);
  console.log(`  ${'ajustesConsolidado'.padEnd(20)} ${JSON.stringify(x.ajustesConsolidado ?? null)}`);
  console.log(`  ${'movimientosParseados'.padEnd(20)} ${ls.length}`);
  for (const k of ['subidoEn', 'creadoEn', 'parseadoEn', 'actualizadoEn', 'confirmadoEn']) console.log(`  ${k.padEnd(20)} ${hora(x[k])}`);
  const campos = Object.keys(x).sort();
  console.log(`  campos del doc: ${campos.join(', ')}`);

  console.log('\n── 2. cuadre (calcularCuadre real del cliente, sin ediciones)');
  const r = RT.docACardStatement(d.id, x);
  const c = RT.calcularCuadre(r.movimientosParseados, r.totalARS, r.totalUSD, r.ajustesConsolidado, r);
  console.log(`  ARS: suma ${fmt(c.sumaARS)} · objetivo ${fmt(c.objetivoARS)} · diff ${fmt(c.diffARS)} · balance ${c.balanceARS}`);
  console.log(`  USD: suma ${fmt(c.sumaUSD)} · objetivo ${fmt(c.objetivoUSD)} · diff ${fmt(c.diffUSD)} · balance ${c.balanceUSD}`);
  console.log(`  arrastre (saldoAnterior + pagos): ARS ${fmt(r2((x.saldoAnteriorARS ?? 0) + (x.pagosDelPeriodoARS ?? 0)))} · USD ${fmt(r2((x.saldoAnteriorUSD ?? 0) + (x.pagosDelPeriodoUSD ?? 0)))}`);

  console.log('\n── 3. contra la extracción de verificación de F9.181 (agregados: docs/F9.181.txt no guardó las líneas)');
  const cmp = (k: string, a: unknown, b: unknown) => {
    const igual = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : JSON.stringify(a) === JSON.stringify(b);
    console.log(`  ${igual ? 'OK' : '≠ '} ${k.padEnd(20)} F9.181 ${s(typeof a === 'number' ? fmt(a) : JSON.stringify(a))}  ·  hoy ${s(typeof b === 'number' ? fmt(b) : JSON.stringify(b))}`);
  };
  cmp('líneas', F9181.lineas, ls.length);
  for (const k of ['totalARS', 'totalUSD', 'saldoAnteriorARS', 'saldoAnteriorUSD', 'pagosDelPeriodoARS', 'pagosDelPeriodoUSD'] as const)
    cmp(k, F9181[k], x[k]);
  cmp('suma ARS del cuadre', F9181.sumaARS, r2(c.sumaARS));
  cmp('suma USD del cuadre', F9181.sumaUSD, r2(c.sumaUSD));
  cmp('ajustesConsolidado', F9181.ajustes, (x.ajustesConsolidado ?? []).map((a: Record<string, unknown>) => ({ concepto: a.concepto, montoARS: a.montoARS, montoUSD: a.montoUSD })));

  console.log('\n  perfil de las líneas de hoy:');
  const porTipo: Record<string, number> = {}, porSeccion: Record<string, number> = {}, porPersona: Record<string, number> = {};
  for (const l of ls) {
    porTipo[l.tipoLinea] = (porTipo[l.tipoLinea] ?? 0) + 1;
    porSeccion[s(l.seccion)] = (porSeccion[s(l.seccion)] ?? 0) + 1;
    porPersona[s(l.personaDetectada) || '(vacío)'] = (porPersona[s(l.personaDetectada) || '(vacío)'] ?? 0) + 1;
  }
  console.log(`    tipoLinea: ${JSON.stringify(porTipo)}`);
  console.log(`    seccion:   ${JSON.stringify(porSeccion)}`);
  console.log(`    persona:   ${JSON.stringify(porPersona)}`);
  console.log(`    moneda:    ARS ${ls.filter(l => l.moneda === 'ARS').length} · USD ${ls.filter(l => l.moneda === 'USD').length}`);
  const sinFirma = ls.filter(l => typeof l.montoFirmado !== 'number').length;
  const firmaNeg = ls.filter(l => typeof l.montoFirmado === 'number' && l.montoFirmado < 0);
  console.log(`    montoFirmado: ${sinFirma} sin el campo · ${firmaNeg.length} negativos (${firmaNeg.map(l => l.tipoLinea).join(', ')})`);
  const espejoMal = ls.filter(l => l.esBonificacion !== (l.tipoLinea === 'bonificacion') || l.esReverso !== (l.tipoLinea === 'reverso') || l.esImpuesto !== (l.tipoLinea === 'impuesto')).length;
  console.log(`    espejos derivados (F9.181 §1.2) ≠ tipoLinea: ${espejoMal}`);
  const clave = (l: MovimientoParseado) => `${s(l.fechaConsumo)}|${l.moneda}|${r2(l.monto)}`;
  const vistas = new Map<string, number>();
  for (const l of ls) vistas.set(clave(l), (vistas.get(clave(l)) ?? 0) + 1);
  const rep = [...vistas.entries()].filter(([, n]) => n > 1);
  console.log(`    fecha+moneda+monto repetidos: ${rep.length} (${rep.map(([k, n]) => `${k} ×${n}`).join(' · ') || '-'})`);
  const seqs = ls.map(l => l.seq);
  console.log(`    seq: ${Math.min(...seqs)}..${Math.max(...seqs)}, ${new Set(seqs).size} distintos`);
}

main().catch(e => { console.error(e); process.exit(1); });
