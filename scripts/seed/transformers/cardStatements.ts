import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { writeBatch } from '../utils/firestore';
import type { MovimientoParseado } from '../../../src/types';

function periodoYYYYMM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

// Agrupa Tarjetas_Movimientos por ResumenID y devuelve cada línea en la forma
// EXACTA de MovimientoParseado — calcularCuadre saltea líneas sin incluir:true
// o sin tipoLinea, así que el shape tiene que calzar 1:1 con el del runtime.
function buildMovimientosParseados(tarjetasMovimientos: any[]): Map<string, MovimientoParseado[]> {
  const porResumen = new Map<string, any[]>();
  for (const r of tarjetasMovimientos) {
    if (!r.ResumenID) continue;
    const arr = porResumen.get(r.ResumenID) ?? [];
    arr.push(r);
    porResumen.set(r.ResumenID, arr);
  }

  const result = new Map<string, MovimientoParseado[]>();
  for (const [resumenId, rows] of porResumen) {
    const lineas: MovimientoParseado[] = rows.map((r, idx) => {
      const cuotaActual = Number(r.CuotaActual) || 1;
      const cuotaTotal  = Number(r.CuotaTotal) || 1;
      const persona     = r.Persona || '';
      return {
        seq: idx + 1,
        tipoLinea: cuotaTotal > 1 ? 'cuota' : 'consumo',
        fechaConsumo: r.FechaConsumo ? isoDate(r.FechaConsumo as Date) : null,
        descripcionRaw: r['Descripción'] ?? '',
        nroCupon: '',
        cuotaActual,
        cuotaTotal,
        moneda: (r.Moneda === 'USD' ? 'USD' : 'ARS') as 'ARS' | 'USD',
        monto: Math.abs(Number(r.Monto) || 0),
        personaDetectada: persona,
        esBonificacion: false,
        esReverso: false,
        esImpuesto: false,
        personaConfirmada: persona || null,
        categoria: r['Categoría'] ?? null,
        subcategoria: r.Subcategoria ?? null,
        incluir: true,
      };
    });
    result.set(resumenId, lineas);
  }
  return result;
}

export async function seedCardStatements(db: Firestore, data: SheetData, dryRun: boolean): Promise<number> {
  console.log('-> resumenesTarjeta');

  const movimientosPorResumen = buildMovimientosParseados(data.tarjetasMovimientos);

  let sinLineas = 0;
  const docs = data.tarjetasResumen
    .filter(r => r.ResumenID)
    .map(r => {
      const movimientosParseados = movimientosPorResumen.get(r.ResumenID) ?? [];
      if (movimientosParseados.length === 0) sinLineas++;
      return {
        id: r.ResumenID,
        estado: r.EstadoImport === 'aplicado' ? 'confirmado' : 'parseado',
        tarjetaCodigo: r.TarjetaCodigo,
        banco: r.Banco,
        tarjeta: r.Tarjeta,
        periodo: r.MesResumen ? periodoYYYYMM(r.MesResumen as Date) : '',
        fechaCierre: r.FechaCierre
          ? Timestamp.fromDate(r.FechaCierre as Date) : null,
        fechaVencimiento: r.FechaVencimiento
          ? Timestamp.fromDate(r.FechaVencimiento as Date) : null,
        totalARS: Number(r.TotalARS ?? 0),
        totalUSD: Number(r.TotalUSD ?? 0),
        pagoMinimoARS: Number(r.PagoMinimoARS ?? 0),
        cuentaDebito: r.CuentaDebitoDetalle ?? null,
        hashPdf: r.HashPDF ?? null,
        refStoragePdf: null,
        parseadoEn:   r.ImportadoEn
          ? Timestamp.fromDate(r.ImportadoEn as Date) : Timestamp.now(),
        confirmadoEn: r.EstadoImport === 'aplicado'
          ? Timestamp.fromDate(r.ImportadoEn as Date) : null,
        confirmadoPor: r.ImportadoPor ?? null,
        observaciones: r.Observaciones ?? null,
        movimientosParseados,
        ajustesConsolidado: [],
      };
    });

  console.log(`   ${docs.length} resumenes (${sinLineas} sin líneas en Tarjetas_Movimientos)`);
  if (dryRun) return docs.length;
  await writeBatch(db, 'resumenesTarjeta', docs);
  console.log('   OK\n');
  return docs.length;
}
