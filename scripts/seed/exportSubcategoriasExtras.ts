// Exporta las subcategorías agregadas desde la app (IDs tipo "subcat-*") a
// scripts/seed/extras/subcategorias.json para que el seed las recree en el emulador.
//
// Uso:
//   tsx scripts/seed/exportSubcategoriasExtras.ts                   (desde emulador)
//   tsx scripts/seed/exportSubcategoriasExtras.ts --target=production
//
// Tras correrlo, revisá el archivo y hacé commit.

import fs from 'fs';
import path from 'path';
import { getDb } from './utils/firestore';

interface SubcatExtra {
  id: string;
  categoriaPadre: string;
  valor: string;
  activo: boolean;
}

function parseFlags() {
  const args = process.argv.slice(2);
  return {
    target: args.includes('--target=production') ? 'production' as const : 'emulator' as const,
  };
}

async function main() {
  const { target } = parseFlags();
  console.error(`Exportando subcategorías extras desde ${target}…`);

  const db = getDb(target);
  const snap = await db.collection('subcategorias').get();

  // Las subcategorías del seed tienen IDs SHA256 (16 hex chars).
  // Las creadas en la app tienen IDs "subcat-<base36>-<random>".
  const extras: SubcatExtra[] = snap.docs
    .filter(d => d.id.startsWith('subcat-'))
    .map(d => {
      const data = d.data();
      return {
        id:            d.id,
        categoriaPadre: (data.categoriaPadre as string) ?? '',
        valor:         (data.valor          as string) ?? '',
        activo:        (data.activo         as boolean) ?? true,
      };
    })
    .sort((a, b) => a.categoriaPadre.localeCompare(b.categoriaPadre) || a.valor.localeCompare(b.valor));

  console.error(`  Encontradas ${extras.length} subcategorías extras (app-created).`);

  const outPath = path.join(process.cwd(), 'scripts', 'seed', 'extras', 'subcategorias.json');
  fs.writeFileSync(outPath, JSON.stringify(extras, null, 2) + '\n', 'utf-8');
  console.error(`  Guardado en ${outPath}`);

  if (extras.length > 0) {
    console.error('\n  Detalle:');
    for (const s of extras) {
      console.error(`    [${s.activo ? '✓' : '✗'}] ${s.categoriaPadre} / ${s.valor}  (${s.id})`);
    }
  }
  console.error('\nListo. Revisá el archivo y hacé commit si todo está bien.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
