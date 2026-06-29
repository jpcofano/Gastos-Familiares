import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { writeBatch } from '../utils/firestore';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function seedTcDaily(db: Firestore, data: SheetData, dryRun: boolean): Promise<number> {
  console.log('-> tcDiario');

  const docs = data.tcDiario
    .filter(r => r.Fecha && r.TC_USDARS)
    .map(r => ({
      id: isoDate(r.Fecha as Date),
      tcUsdArs: Number(r.TC_USDARS),
      actualizadoEn: r.ActualizadoEn
        ? Timestamp.fromDate(r.ActualizadoEn as Date)
        : Timestamp.fromDate(r.Fecha as Date),
    }));

  console.log(`   ${docs.length} dias con TC`);
  if (dryRun) return docs.length;
  await writeBatch(db, 'tcDiario', docs);
  console.log('   OK\n');
  return docs.length;
}
