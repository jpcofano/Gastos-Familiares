import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { writeBatch } from '../utils/firestore';

function periodoYYYYMM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

export async function seedCardStatements(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> cardStatements');

  const docs = data.tarjetasResumen
    .filter(r => r.ResumenID)
    .map(r => ({
      id: r.ResumenID,
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
      pdfHash: r.HashPDF ?? null,
      pdfStorageRef: null,
      parsedAt:     r.ImportadoEn
        ? Timestamp.fromDate(r.ImportadoEn as Date) : Timestamp.now(),
      confirmedAt:  r.EstadoImport === 'aplicado'
        ? Timestamp.fromDate(r.ImportadoEn as Date) : null,
      confirmedBy:  r.ImportadoPor ?? null,
      observaciones: r.Observaciones ?? null,
    }));

  console.log(`   ${docs.length} resumenes`);
  if (dryRun) return;
  await writeBatch(db, 'cardStatements', docs);
  console.log('   OK\n');
}
