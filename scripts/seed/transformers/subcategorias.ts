import { Firestore } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { sha256Hex } from '../utils/hash';
import { writeBatch } from '../utils/firestore';

export async function seedSubcategorias(db: Firestore, data: SheetData, dryRun: boolean): Promise<number> {
  console.log('-> subcategorias');

  const docs = data.diccionario
    .filter(r => r.Tipo === 'Subcategoria' && r.Valor)
    .map(r => ({
      id: sha256Hex('subcat', r.Categoria ?? '', r.Valor).slice(0, 16),
      categoriaPadre: r.Categoria ?? null,
      valor: r.Valor,
      activo: r.Activo === true || r.Activo === 'VERDADERO',
    }));

  console.log(`   ${docs.length} subcategorias`);
  if (dryRun) return docs.length;
  await writeBatch(db, 'subcategorias', docs);
  console.log('   OK\n');
  return docs.length;
}
