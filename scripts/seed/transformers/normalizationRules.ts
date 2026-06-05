import { Firestore } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { writeBatch } from '../utils/firestore';

export async function seedNormalizationRules(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> normalizationRules');

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
  if (dryRun) return;
  await writeBatch(db, 'normalizationRules', docs);
  console.log('   OK\n');
}
