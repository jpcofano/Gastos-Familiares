// F9.122 §3 — purga one-shot del cache negativo de cafciMapping.
//
// El código viejo de `parsearFichaCafci` escribía `{ ticker: null }` cada vez que la resolución
// por clave exacta fallaba. Esos docs bloquean toda re-resolución posterior: la corrida siguiente
// encuentra el doc, lee null, y ni resuelve ni reporta el pendiente. F9.122 §2 dejó de escribirlos,
// pero los ya escritos siguen ahí y hay que sacarlos.
//
// Criterio de borrado (conservador): se borra solo lo que no tiene procedencia declarada.
//   - con campo `tipo`      → viene del seed, se conserva
//   - con `origen: 'manual'` → lo cargó una persona, se conserva
//   - el resto con ticker null → cache negativo, se borra
//
// Dry-run por defecto: reporta y no toca nada. Con --apply borra.
//
// Uso:
//   tsx scripts/limpiarCafciMappingNulos.ts --target=production
//   tsx scripts/limpiarCafciMappingNulos.ts --target=production --apply

import { getDb } from './seed/utils/firestore';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
const apply = process.argv.includes('--apply');

type MappingDoc = { ticker: string | null; tipo?: string; origen?: string };

async function main() {
  const db = getDb(target as 'emulator' | 'production');

  const snap = await db.collection('cafciMapping').where('ticker', '==', null).get();
  const revisados = snap.size;

  const aBorrar: string[] = [];
  const conservados: Array<{ id: string; motivo: string }> = [];
  for (const d of snap.docs) {
    const m = d.data() as MappingDoc;
    if (m.tipo) conservados.push({ id: d.id, motivo: `tipo=${m.tipo} (seed)` });
    else if (m.origen === 'manual') conservados.push({ id: d.id, motivo: 'origen=manual' });
    else aBorrar.push(d.id);
  }

  console.log(`\n=== cafciMapping, docs con ticker null ===`);
  console.log(`  revisados: ${revisados}`);
  console.log(`\n  a borrar (${aBorrar.length}):`);
  for (const id of aBorrar) console.log(`    "${id}"`);
  console.log(`\n  conservados (${conservados.length}):`);
  for (const c of conservados) console.log(`    "${c.id}" — ${c.motivo}`);

  if (!apply) {
    console.log('\nDRY-RUN: no se borró nada. Volver a correr con --apply para aplicar.');
    console.log(JSON.stringify({ revisados, borrados: 0, conservados: conservados.length }));
    return;
  }

  const BATCH = 400;
  for (let i = 0; i < aBorrar.length; i += BATCH) {
    const batch = db.batch();
    for (const id of aBorrar.slice(i, i + BATCH)) batch.delete(db.collection('cafciMapping').doc(id));
    await batch.commit();
  }

  console.log(`\nBorrados ${aBorrar.length} docs.`);
  console.log(JSON.stringify({ revisados, borrados: aBorrar.length, conservados: conservados.length }));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
