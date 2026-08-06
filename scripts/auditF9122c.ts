// F9.122.1 §A — barrido del normalizador nuevo sobre datos reales. SOLO LEE.
//
// Antes de reimportar el seed hay que saber qué claves va a escribir: el reseed reescribe 70 docs
// y una colisión (dos patrones distintos colapsando a la misma clave con tickers distintos) haría
// que un papel quede mapeado al ticker de otro, en silencio. Este script mide eso contra:
//   a) los 70 patrones de MAPPING_SEED (leídos del fuente, sin importarlo: el módulo arrastra el
//      SDK de firebase cliente y no corre bajo node)
//   b) los IDs de cafciMapping vivos
//   c) todos los especieRaw de las carteras sincronizadas
//
// Usa la copia CANÓNICA del gemelo (functions/src/cafciHtml.ts), no una reimplementación.
//
// Uso: tsx scripts/auditF9122c.ts --target=production

import { readFileSync } from 'node:fs';
import { normalizarEspecie } from '../functions/src/cafciHtml';
import { getDb } from './seed/utils/firestore';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';

function patronesDelSeed(): Array<{ patron: string; ticker: string }> {
  const src = readFileSync('src/datos/patrimonioCafci.ts', 'utf8');
  const out: Array<{ patron: string; ticker: string }> = [];
  const re = /\{\s*patron:\s*'([^']+)',\s*ticker:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push({ patron: m[1], ticker: m[2] });
  return out;
}

async function main() {
  const db = getDb(target as 'emulator' | 'production');

  // ── a) seed
  const seed = patronesDelSeed();
  console.log(`\n=== MAPPING_SEED: ${seed.length} patrones ===`);
  const porClave = new Map<string, Set<string>>();
  for (const { patron, ticker } of seed) {
    const k = normalizarEspecie(patron);
    if (!k) { console.log(`  !! "${patron}" normaliza a CADENA VACÍA`); continue; }
    if (!porClave.has(k)) porClave.set(k, new Set());
    porClave.get(k)!.add(ticker);
  }
  const colisiones = [...porClave.entries()].filter(([, t]) => t.size > 1);
  console.log(`  claves distintas: ${porClave.size}`);
  console.log(`  COLISIONES (misma clave, tickers distintos): ${colisiones.length}`);
  for (const [k, t] of colisiones) console.log(`    !! "${k}" -> ${[...t].join(' / ')}`);

  const cambian = seed.filter(s => normalizarEspecie(s.patron) !== s.patron.trim().toLowerCase());
  console.log(`  patrones cuya clave CAMBIA respecto del normalizador viejo: ${cambian.length}`);
  for (const s of cambian) console.log(`    "${s.patron}" -> "${normalizarEspecie(s.patron)}"`);

  // ── b) mappings vivos
  const snap = await db.collection('cafciMapping').limit(200).get();
  console.log(`\n=== cafciMapping vivo: ${snap.size} docs ===`);
  const huerfanos = snap.docs.filter(d => normalizarEspecie(d.id) !== d.id);
  console.log(`  docs cuyo ID NO es estable bajo el normalizador nuevo: ${huerfanos.length}`);
  for (const d of huerfanos) {
    console.log(`    "${d.id}" -> "${normalizarEspecie(d.id)}" (ticker=${(d.data() as any).ticker})`);
  }

  // ── c) especies reales de las carteras
  const cart = await db.collection('cafciCarteras').orderBy('fechaFetch', 'desc').limit(30).get();
  const especies = new Map<string, string>();
  for (const d of cart.docs) {
    for (const p of ((d.data() as any).posiciones ?? [])) especies.set(p.especieRaw, normalizarEspecie(p.especieRaw));
  }
  console.log(`\n=== especieRaw distintas en ${cart.size} carteras: ${especies.size} ===`);
  const porNorm = new Map<string, string[]>();
  for (const [raw, norm] of especies) {
    if (!norm) console.log(`  !! "${raw}" normaliza a CADENA VACÍA`);
    if (!porNorm.has(norm)) porNorm.set(norm, []);
    porNorm.get(norm)!.push(raw);
  }
  console.log('  especies que colapsan juntas (esperado: variantes de clase del mismo emisor):');
  for (const [norm, raws] of porNorm) {
    if (raws.length > 1) console.log(`    "${norm}" <- ${raws.map(r => `"${r}"`).join(', ')}`);
  }

  // ── resolución final simulada, con el diccionario vivo renormalizado
  const patrones = snap.docs
    .map(d => ({ id: normalizarEspecie(d.id), ticker: (d.data() as any).ticker as string | null }))
    .filter(p => !!p.ticker)
    .sort((a, b) => b.id.length - a.id.length);
  const seedNorm = new Map(seed.map(s => [normalizarEspecie(s.patron), s.ticker]));
  for (const [k, t] of seedNorm) if (!patrones.some(p => p.id === k)) patrones.push({ id: k, ticker: t });
  patrones.sort((a, b) => b.id.length - a.id.length);

  console.log('\n=== Resolución simulada de cada especie real (post-reseed) ===');
  const sinResolver: string[] = [];
  for (const [raw, norm] of [...especies].sort()) {
    if (/^resto de activos$/i.test(raw.trim())) { console.log(`  "${raw}" -> RESTO`); continue; }
    if (/^(fci\b|cta\.? ?cte\.?|cauci[oó]n)/i.test(raw.trim())) { console.log(`  "${raw}" -> LIQUIDEZ`); continue; }
    const esCedear = /^cedear/i.test(raw.trim());
    const clave = esCedear ? normalizarEspecie(raw.replace(/^cedear\s*/i, '')) : norm;
    if (/^(on\b|o\.?n\.?\s|obligaci[oó]n|bono|letra|lecap|boncer|titulo|t[ií]tulo)/i.test(raw.trim())) {
      console.log(`  "${raw}" -> RENTA_FIJA`); continue;
    }
    const hit = patrones.find(p => p.id === clave) ?? patrones.find(p => clave.includes(p.id));
    console.log(`  "${raw}" -> ${hit ? hit.ticker : 'SIN RESOLVER'}${esCedear ? ' [CEDEAR]' : ''}`);
    if (!hit) sinResolver.push(raw);
  }
  console.log(`\n  sin resolver: ${sinResolver.length}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
