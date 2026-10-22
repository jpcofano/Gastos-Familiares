// F9.196.1 corrida nocturna del 21/10, punto 2 — prueba de H0 con los "Mis Instrumentos" REALES.
// SOLO LOCAL Y SOLO LECTURA: lee data/balanz-muestras/ (fuera de git) y no toca Firestore.
// Imprime solo totales, la vista detectada y los tickers de control (FCI en USD, GD30, GD35, BPOC7).
// Uso: npx tsx scripts/probarVistaBalanzReal.ts
//
// Referencia de precios y "previa": el export en dólares de la 402665 del 20/10. MEP: $1.549 del 21/10.
import * as fs from 'fs';
import * as path from 'path';
import {
  leerFilasXlsx, parsearNombreBalanz, parsearMisInstrumentos, detectarVista, aplicarVista, cuentaVivaDeImportacion,
  type ImportacionMisInstrumentos,
} from '../src/datos/patrimonioBalanzArchivo';
import type { TcCarteraViva } from '../src/datos/patrimonioCarteraViva';

const DIR = path.join(__dirname, '..', 'data', 'balanz-muestras');
const MEP: TcCarteraViva = { valor: 1549, fuente: 'tcDiario', fechaCotizacion: '2026-10-21', viejo: false };
const CONTROL = ['GD30', 'GD35', 'BPOC7'];
const FCI_USD = ['BCMMUSDA', 'ESTRA1A'];
const usd = (n: number) => `US$ ${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;

/** El "Mis Instrumentos" de esa comitente y fecha (YYYYMMDD), sin depender de los titulares del nombre. */
function archivo(comitente: string, fecha: string): string {
  const f = fs.readdirSync(DIR).find(n => n.includes('MisInstrumentos') && n.includes(`com${comitente}`) && n.includes(fecha) && n.endsWith('.xlsx'));
  if (!f) throw new Error(`No está el Mis Instrumentos de ${comitente} del ${fecha} en data/balanz-muestras/`);
  return f;
}

async function leer(comitente: string, fecha: string): Promise<ImportacionMisInstrumentos> {
  const nombre = archivo(comitente, fecha);
  const { filas } = await leerFilasXlsx(fs.readFileSync(path.join(DIR, nombre)));
  const { exportadoEn } = parsearNombreBalanz(nombre);
  return parsearMisInstrumentos(filas, { comitente, exportadoEn: exportadoEn!, clasificaciones: new Map() });
}

async function main() {
  // Referencia: 402665 del 20/10, en dólares.
  const ref = aplicarVista(await leer('402665', '20261020'), 'USD', { mep: null, previa: null }).imp!;
  const previa = cuentaVivaDeImportacion(ref);
  const precioRef = new Map(ref.filas.map(f => [f.ticker, f.precioUsd]));
  const precioDe = (p: { ticker: string }) => (precioRef.has(p.ticker) ? { precio: precioRef.get(p.ticker)!, moneda: 'USD' as const, fecha: '2026-10-20' } : null);
  console.log(`Referencia 402665 20/10 (dólares): ${usd(ref.valorUsdBalanz)} · ${ref.filas.length} especies`);

  // 402665 del 21/10 (en pesos).
  const a = await leer('402665', '20261021');
  const dA = detectarVista(a, { precioDe, tc: MEP.valor, previa });
  console.log(`\n402665 21/10: vista detectada ${dA.vista} (método ${dA.metodo}, mediana ${dA.mediana?.toFixed(5)}, ${dA.especiesUsadas} especies) · precios de la app: ${dA.preciosApp?.vista ?? '—'} · anterior: ${dA.importacionAnterior?.vista ?? '—'}`);
  const rA = aplicarVista(a, 'ARS', { mep: MEP, previa });
  if (!rA.imp) { console.log(`  aplicarVista ARS falló: ${rA.error}`); }
  else {
    const dif = rA.imp.valorUsdBalanz / ref.valorUsdBalanz - 1;
    console.log(`  total convertido: ${usd(rA.imp.valorUsdBalanz)} (esperado ≈ US$ 30.638 ± 1%; contra el export en dólares del 20/10: ${(dif * 100).toFixed(2)}%) · noCuadran ${rA.imp.noCuadran.length} · costoUsdDel ${rA.imp.costoUsdDel}`);
    for (const t of FCI_USD) {
      const crudo = a.posiciones.find(p => p.ticker === t)?.valor_origen;
      const conv = rA.imp.posiciones.find(p => p.ticker === t)?.valor_origen;
      console.log(`  ${t}: archivo ${crudo?.toFixed(2)} → guardado ${conv?.toFixed(2)} ${crudo === conv ? '(sin convertir ✓)' : '(¡CONVERTIDO!)'}`);
    }
    for (const t of CONTROL) {
      const esperado = ref.costoPromedio[t];
      const salio = rA.imp.costoPromedio[t];
      const enPesos = a.costoPromedio[t];
      console.log(`  costo ${t}: esperado (USD del 20/10) ${esperado} · salió ${salio} · pesos del archivo ${enPesos} (÷ MEP = ${enPesos !== undefined ? (enPesos / MEP.valor).toFixed(5) : '—'}) ${salio === esperado ? '✓' : '✗'}`);
    }
  }

  // 1120830 del 21/10 (en dólares).
  const b = await leer('1120830', '20261021');
  const dB = detectarVista(b, { precioDe, tc: MEP.valor, previa: null });
  console.log(`\n1120830 21/10: vista detectada ${dB.vista} con los precios de la 402665 (método ${dB.metodo}, mediana ${dB.mediana?.toFixed(5) ?? '—'}, ${dB.especiesUsadas} especies)`);
  let previaB = null;
  try {
    const b13 = aplicarVista(await leer('1120830', '20261013'), 'USD', { mep: null, previa: null }).imp!;
    previaB = cuentaVivaDeImportacion(b13);
    const dB2 = detectarVista(b, { precioDe, tc: MEP.valor, previa: previaB });
    console.log(`  con la 1120830 del 13/10 (dólares) como anterior: ${dB2.vista} (método ${dB2.metodo}, ${dB2.especiesUsadas} especies) · precios de la app: ${dB2.preciosApp?.vista ?? '—'} · anterior: ${dB2.importacionAnterior?.vista ?? '—'}`);
  } catch (e) { console.log(`  (sin la 1120830 del 13/10: ${(e as Error).message})`); }
  const rB = aplicarVista(b, 'USD', { mep: MEP, previa: previaB });
  console.log(`  leída en dólares: ${usd(rB.imp!.valorUsdBalanz)} · tcConversion ${rB.imp!.tcConversion === null ? 'ninguna (sin conversión ✓)' : JSON.stringify(rB.imp!.tcConversion)} · noCuadran ${rB.imp!.noCuadran.length}`);
}

main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
