// F9.122 §0 (complemento) — SOLO LEE. Verifica si los patrones del seed que DEBERÍAN resolver
// las especies que hoy quedaron con ticker null existen realmente en cafciMapping, y simula la
// resolución por patrón (`norm.includes(pat)`, patrones ordenados por longitud desc) que propone
// §2, sin escribir nada. Lectura acotada: getAll() de una lista fija + limit() en la colección.

import { getDb } from './seed/utils/firestore';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';

// Las 10 claves con ticker null medidas en la corrida anterior.
const NULOS = [
  'banco macro bansud - b', 'grupo fciero galicia - b', 'grupo supervielle cb', 'lecap s31g6',
  'telecom argentina - b', 'ternium - a', 'transener - b', 'transp gas del norte c',
  'transp gas del sur - b', 'ypf - d',
];

async function main() {
  const db = getDb(target as 'emulator' | 'production');

  // Diccionario completo de mappings: 79 docs medidos, es una lectura acotada por tamaño conocido.
  const snap = await db.collection('cafciMapping').limit(200).get();
  const patrones = snap.docs
    .map(d => ({ id: d.id, ticker: (d.data() as any).ticker as string | null }))
    .filter(p => !!p.ticker)
    .sort((a, b) => b.id.length - a.id.length);

  console.log(`\n=== Patrones con ticker resuelto: ${patrones.length} de ${snap.size} docs ===`);

  console.log('\n=== Simulación de §2: resolución por patrón sobre las claves null ===');
  for (const norm of NULOS) {
    const hit = patrones.find(p => norm.includes(p.id));
    const rf = /^(on\b|o\.?n\.?\s|obligaci[oó]n|bono|letra|lecap|boncer|titulo|t[ií]tulo)/i.test(norm);
    console.log(`  "${norm}" -> ${rf ? 'RENTA_FIJA (regex)' : hit ? `${hit.ticker} (patrón "${hit.id}")` : 'SIGUE SIN RESOLVER'}`);
  }

  console.log('\n=== Chequeo de colisiones: patrones cortos que matchean a otros patrones ===');
  for (const p of patrones) {
    const tragados = patrones.filter(q => q.id !== p.id && q.id.includes(p.id) && q.ticker !== p.ticker);
    if (tragados.length > 0) {
      console.log(`  "${p.id}" (${p.ticker}) está contenido en: ${tragados.map(t => `"${t.id}"(${t.ticker})`).join(', ')}`);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
