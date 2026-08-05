// F9.122 §0 — Auditoría previa obligatoria. SOLO LEE, nunca escribe.
//
// Vuelca los tres puntos que pide el prompt:
//   1. posiciones[] de UNA cartera de cafciCarteras (la más reciente de un fondo de acciones)
//   2. totalPct / pesoResto / coberturaIdentificada de esa misma cartera
//   3. cafciMapping: total de docs, cuántos con ticker == null, y 15 ejemplos de esos IDs
//
// Todas las consultas acotadas: limit() en las lecturas de documentos y count() agregado
// para los totales — nunca un scan completo de la colección.
//
// Uso:
//   tsx scripts/auditF9122.ts --target=production
//   tsx scripts/auditF9122.ts --target=production --fondo=<substring del nombre>

import { getDb } from './seed/utils/firestore';

const args = process.argv.slice(2);
const target = args.includes('--target=production') ? 'production' : 'emulator';
const fondoFiltro = (args.find(a => a.startsWith('--fondo=')) ?? '').replace('--fondo=', '').toLowerCase();

async function main() {
  const db = getDb(target as 'emulator' | 'production');

  // ── 1/2 — carteras recientes, acotado a 30 docs
  const snap = await db.collection('cafciCarteras').orderBy('fechaFetch', 'desc').limit(30).get();
  console.log(`\n=== cafciCarteras — ${snap.size} docs más recientes (limit 30) ===`);
  for (const d of snap.docs) {
    const c = d.data() as any;
    console.log(
      `  ${d.id} | fondoId=${c.fondoId} | ${c.nombre ?? c.nombreFondo ?? '?'} | ` +
      `datos=${c.fechaDatos} | pos=${(c.posiciones ?? []).length} | totalPct=${c.totalPct}`
    );
  }

  const elegida = fondoFiltro
    ? snap.docs.find(d => JSON.stringify(d.data()).toLowerCase().includes(fondoFiltro))
    : snap.docs[0];

  if (!elegida) {
    console.log('\nNo hay cartera que matchee el filtro. Fin.');
    return;
  }

  const c = elegida.data() as any;
  console.log(`\n=== PUNTO 1 — posiciones[] de ${elegida.id} ===`);
  console.log(`fondo: ${c.nombre ?? c.nombreFondo} | fechaDatos: ${c.fechaDatos} | fechaFetch: ${c.fechaFetch}`);
  console.log('especieRaw | ticker | pesoPct | categoria');
  for (const p of (c.posiciones ?? []).slice(0, 30)) {
    console.log(`  ${p.especieRaw} | ${p.ticker ?? 'null'} | ${p.pesoPct} | ${p.categoria ?? '-'}`);
  }
  if ((c.posiciones ?? []).length > 30) {
    console.log(`  … (${c.posiciones.length - 30} filas más, no mostradas)`);
  }

  console.log(`\n=== PUNTO 2 — totales de ${elegida.id} ===`);
  console.log(`  totalPct               = ${c.totalPct}`);
  console.log(`  pesoResto              = ${c.pesoResto}`);
  console.log(`  coberturaIdentificada  = ${c.coberturaIdentificada}`);
  console.log(`  advertenciaSuma        = ${c.advertenciaSuma}`);
  console.log(`  advertenciaCobertura   = ${c.advertenciaCobertura}`);
  console.log(`  suma manual de pesoPct = ${(c.posiciones ?? []).reduce((s: number, p: any) => s + (p.pesoPct ?? 0), 0)}`);

  // ── 3 — cafciMapping por agregación (count no lee documentos)
  console.log('\n=== PUNTO 3 — cafciMapping ===');
  const total = await db.collection('cafciMapping').count().get();
  const nulos = await db.collection('cafciMapping').where('ticker', '==', null).count().get();
  console.log(`  docs totales      = ${total.data().count}`);
  console.log(`  con ticker null   = ${nulos.data().count}`);

  const ejemplos = await db.collection('cafciMapping').where('ticker', '==', null).limit(15).get();
  console.log('  15 ejemplos de IDs con ticker null (con sus campos):');
  for (const d of ejemplos.docs) {
    const m = d.data() as any;
    console.log(`    "${d.id}"  | tipo=${m.tipo ?? '-'} | origen=${m.origen ?? '-'}`);
  }

  const resueltos = await db.collection('cafciMapping').where('ticker', '!=', null).limit(15).get();
  console.log('  15 ejemplos de IDs CON ticker resuelto (para comparar forma de clave):');
  for (const d of resueltos.docs) {
    const m = d.data() as any;
    console.log(`    "${d.id}" -> ${m.ticker} | tipo=${m.tipo ?? '-'} | origen=${m.origen ?? '-'}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
