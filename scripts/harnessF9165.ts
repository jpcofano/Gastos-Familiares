// F9.165 §5 — el router sobre los PDF de producción, ANTES vs DESPUÉS del cambio del regex.
//
// A diferencia del harness de F9.153, que tenía una COPIA de los marcadores, éste EXTRAE el bloque
// real de `functions/src/index.ts`: la versión de HEAD (antes) y la del árbol de trabajo (después).
// Si el código cambia, esto se rompe en vez de mentir. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';

const req = createRequire(process.cwd() + '/functions/package.json');
const pdfParse = req('pdf-parse') as (b: Buffer, o?: { max: number }) => Promise<{ text: string }>;
const ts = req('typescript') as typeof import('typescript');

if (getApps().length === 0) initializeApp({
  credential: cert('./secrets/serviceAccountKey.json'),
  storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
});
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

type Router = {
  contarMarcadores: (t: string) => { count: number; hits: string[]; tieneDecisivo: boolean };
  RE_PAN_ENMASCARADO: RegExp;
};

/** Extrae el bloque del router (constantes + normalizador + contarMarcadores) de un fuente dado. */
function routerDe(src: string): Router {
  src = src.replace(/\r\n/g, '\n');
  const ini = src.indexOf('const MARCADORES_GENERICOS');
  if (ini < 0) throw new Error('no encontré MARCADORES_GENERICOS');
  const fin = src.indexOf('\n}', src.indexOf('function contarMarcadores', ini)) + 2;
  const bloque = src.slice(ini, fin);
  const js = ts.transpileModule(bloque, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(`${js}\nreturn { contarMarcadores, RE_PAN_ENMASCARADO };`)() as Router;
}

const antes = routerDe(execSync('git show HEAD:functions/src/index.ts', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const despues = routerDe(fs.readFileSync('functions/src/index.ts', 'utf8'));

/** La decisión de destino del router, tal como la toma `routearEntrante` (F9.153 §1: {max:3}). */
function destino(r: Router, texto: string): string {
  const m = r.contarMarcadores(texto);
  if (m.tieneDecisivo && m.count >= 2) return 'resumen';
  if (m.count >= 2) return 'ambiguo';
  return 'comprobante';
}

async function main() {
  console.log('F9.165 §5 — harness del router, ANTES (HEAD) vs DESPUÉS. SOLO LECTURA.\n');
  console.log(`  regex antes:   ${antes.RE_PAN_ENMASCARADO}`);
  console.log(`  regex después: ${despues.RE_PAN_ENMASCARADO}\n`);

  // Todos los PDF de producción: entrantes + comprobantes + resúmenes.
  const refs: Array<{ id: string; ref: string; col: string }> = [];
  for (const col of ['entrantes', 'comprobantes', 'resumenesTarjeta']) {
    const snap = await db.collection(col).get();
    for (const d of snap.docs) {
      const r = d.data().refStoragePdf ?? d.data().refStorage;
      if (r) refs.push({ id: d.id.slice(0, 10), ref: s(r), col });
    }
  }
  console.log(`  documentos con archivo: ${refs.length}\n`);

  let leidos = 0, saltados = 0, cambiaDestino = 0, cambiaMarcadores = 0, ganaPan = 0;
  const filas: string[] = [];
  for (const { id, ref, col } of refs) {
    let texto: string;
    try {
      const [buf] = await getStorage().bucket().file(ref).download();
      texto = (await pdfParse(buf as Buffer, { max: 3 })).text;
    } catch { saltados++; continue; }
    leidos++;
    const norm = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const a = antes.contarMarcadores(norm), b = despues.contarMarcadores(norm);
    const dA = destino(antes, norm), dB = destino(despues, norm);
    const panNuevo = !a.hits.includes('pan_enmascarado') && b.hits.includes('pan_enmascarado');
    if (panNuevo) ganaPan++;
    if (JSON.stringify(a.hits) !== JSON.stringify(b.hits)) cambiaMarcadores++;
    if (dA !== dB) {
      cambiaDestino++;
      filas.push(`  >>> CAMBIA DESTINO  ${col}/${id}  ${dA} → ${dB}  | antes ${JSON.stringify(a.hits)} | después ${JSON.stringify(b.hits)}`);
    } else if (panNuevo) {
      filas.push(`      gana pan_enmascarado, MISMO destino (${dA})  ${col}/${id}  | antes ${JSON.stringify(a.hits)} | después ${JSON.stringify(b.hits)}`);
    }
  }

  for (const f of filas) console.log(f);
  console.log(`\n  PDFs leídos: ${leidos} | no legibles: ${saltados}`);
  console.log(`  documentos que GANAN el marcador pan_enmascarado: ${ganaPan}`);
  console.log(`  documentos con marcadores distintos:              ${cambiaMarcadores}`);
  console.log(`  documentos que CAMBIAN DE DESTINO:                ${cambiaDestino}`);
  if (cambiaDestino > 0) console.log('\n  >>> ALGUNO CAMBIA DE DESTINO: la spec dice NO APLICAR y avisar.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
