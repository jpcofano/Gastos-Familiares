import fs from 'fs';
import path from 'path';
import { Firestore } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { sha256Hex } from '../utils/hash';
import { writeBatch } from '../utils/firestore';

interface SubcatExtra {
  id: string;
  categoriaPadre: string;
  valor: string;
  activo: boolean;
}

function cargarExtras(): SubcatExtra[] {
  const p = path.join(process.cwd(), 'scripts', 'seed', 'extras', 'subcategorias.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as SubcatExtra[];
  } catch {
    return [];
  }
}

export async function seedSubcategorias(db: Firestore, data: SheetData, dryRun: boolean): Promise<number> {
  console.log('-> subcategorias');

  // Fuente 1: Excel (seed original)
  const fromExcel = data.diccionario
    .filter(r => r.Tipo === 'Subcategoria' && r.Valor)
    .map(r => ({
      id: sha256Hex('subcat', r.Categoria ?? '', r.Valor).slice(0, 16),
      categoriaPadre: r.Categoria ?? null,
      valor: r.Valor,
      activo: r.Activo === true || r.Activo === 'VERDADERO',
    }));

  // Fuente 2: extras agregadas desde la app (scripts/seed/extras/subcategorias.json)
  const extras = cargarExtras();
  if (extras.length > 0) {
    console.log(`   + ${extras.length} subcategorías extras (app-created)`);
  }

  // Merge por ID — extras no pisan al Excel salvo colisión de ID (no debería ocurrir)
  const byId = new Map(fromExcel.map(s => [s.id, s]));
  for (const e of extras) {
    byId.set(e.id, e);
  }
  const docs = [...byId.values()];

  console.log(`   ${docs.length} subcategorias (${fromExcel.length} Excel + ${extras.length} extras)`);
  if (dryRun) return docs.length;
  await writeBatch(db, 'subcategorias', docs);
  console.log('   OK\n');
  return docs.length;
}
