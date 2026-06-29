import { Firestore } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { writeBatch } from '../utils/firestore';

export async function seedNormalizationRules(db: Firestore, data: SheetData, dryRun: boolean): Promise<number> {
  console.log('-> reglasNormalizacion');

  const docs = data.diccionarioNorm
    .filter(r => r.Activo === true || r.Activo === 'VERDADERO')
    .map((r, i) => ({
      id: `rule_${String(i).padStart(3,'0')}`,
      tipo: r.Tipo,
      patron: r.Patron,
      reemplazo: r.Reemplazo ?? '',
      activo: true,
      orden: i,
      notas: r.Notas ?? null,
    }));

  console.log(`   ${docs.length} reglas activas`);
  if (dryRun) return docs.length;
  await writeBatch(db, 'reglasNormalizacion', docs);
  console.log('   OK\n');
  return docs.length;
}
