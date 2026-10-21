// F9.196 H2 — el código compartido entre el cliente (src/) y las Functions vive en DOS copias
// idénticas byte a byte, porque functions/ tiene `rootDir: src` y no puede importar de src/.
// El original es el de src/; la copia se regenera copiando el archivo. Este script falla si alguna
// copia difiere, falta, o sobra un archivo en una de las dos carpetas compartidas.
//
// Uso: npx tsx scripts/verificarCopiasIdenticas.ts            → exit 1 si algo difiere
//      npx tsx scripts/verificarCopiasIdenticas.ts --copiar   → copia src/ → functions/ y verifica
import * as fs from 'fs';
import * as path from 'path';

const RAIZ = path.join(__dirname, '..');
const CARPETAS: Array<[string, string]> = [['src/datos/compartido', 'functions/src/compartido']];
// Precedente: el normalizador (docs/CLAUDE.md, "Reglas operativas").
const ARCHIVOS: Array<[string, string]> = [['src/datos/normalizador.ts', 'functions/src/normalizador.ts']];

const copiar = process.argv.includes('--copiar');
const pares: Array<[string, string]> = [...ARCHIVOS];
let fallas = 0;

for (const [a, b] of CARPETAS) {
  const da = path.join(RAIZ, a), db = path.join(RAIZ, b);
  if (copiar) {
    fs.mkdirSync(db, { recursive: true });
    for (const f of fs.readdirSync(da).filter(f => f.endsWith('.ts'))) fs.copyFileSync(path.join(da, f), path.join(db, f));
  }
  const fa = fs.readdirSync(da).filter(f => f.endsWith('.ts')).sort();
  const fb = fs.existsSync(db) ? fs.readdirSync(db).filter(f => f.endsWith('.ts')).sort() : [];
  for (const f of fb.filter(x => !fa.includes(x))) { console.log(`FAIL ${b}/${f} sobra (no existe en ${a})`); fallas++; }
  for (const f of fa) pares.push([`${a}/${f}`, `${b}/${f}`]);
}

for (const [a, b] of pares) {
  const pa = path.join(RAIZ, a), pb = path.join(RAIZ, b);
  if (!fs.existsSync(pb)) { console.log(`FAIL falta ${b}`); fallas++; continue; }
  const ba = fs.readFileSync(pa), bb = fs.readFileSync(pb);
  if (ba.equals(bb)) { console.log(`OK   ${a} = ${b}`); continue; }
  const sinCr = (x: Buffer) => x.toString('utf8').replace(/\r\n/g, '\n');
  const soloFinDeLinea = sinCr(ba) === sinCr(bb);
  console.log(`FAIL ${a} ≠ ${b}${soloFinDeLinea ? ' (solo difieren los fines de línea CRLF/LF)' : ''}`);
  fallas++;
}

console.log(`\n${fallas === 0 ? `OK — ${pares.length} copias idénticas` : `${fallas} FALLA(S): copiá el original de src/ con --copiar`}`);
if (fallas) process.exit(1);
