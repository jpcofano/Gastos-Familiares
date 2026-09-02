// F9.151 §H1/H2/H3 — re-corre el detector real del router sobre TODOS los PDF de producción,
// comparando página 1 (lo que hace hoy, `{max:1}`) contra el PDF completo, y el regex de PAN
// sobre texto crudo vs normalizado. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';

const require2 = createRequire(process.cwd() + '/functions/package.json');
const pdfParse = require2('pdf-parse') as (b: Buffer, o?: { max: number }) => Promise<{ text: string; numpages: number }>;

if (getApps().length === 0) {
  initializeApp({
    credential: cert('./secrets/serviceAccountKey.json'),
    storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
  });
}
const db = getFirestore();

// ── copia literal de functions/src/index.ts:1314-1341 ────────────────────────
const MARCADORES_GENERICOS = ['TOTAL A PAGAR', 'VENCIMIENTO', 'CIERRE', 'SALDO PENDIENTE'];
const MARCADORES_DECISIVOS = ['PAGO MINIMO', 'LIMITE DE COMPRA', 'LIMITE DE CREDITO'];
const RE_PAN_ENMASCARADO = /\d{4}[\s*X]{4,10}\d{4}/;
const RE_PAN_INSENSIBLE  = /\d{4}[\s*Xx]{4,10}\d{4}/;

function normalizarParaDeteccion(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}
function contarMarcadores(texto: string) {
  const norm = normalizarParaDeteccion(texto);
  const hits: string[] = [];
  let tieneDecisivo = false;
  for (const m of MARCADORES_GENERICOS) if (norm.includes(m)) hits.push(m);
  for (const m of MARCADORES_DECISIVOS) if (norm.includes(m)) { hits.push(m); tieneDecisivo = true; }
  if (RE_PAN_ENMASCARADO.test(texto)) { hits.push('pan_enmascarado'); tieneDecisivo = true; }
  return { count: hits.length, hits, tieneDecisivo };
}
function rutear(count: number, tieneDecisivo: boolean): string {
  if (tieneDecisivo && count >= 2) return 'resumen';
  if (count === 0 || !tieneDecisivo) return 'comprobante';
  return 'ambiguo';
}

async function main() {
  const ents = await db.collection('entrantes').get();
  const bucket = getStorage().bucket();
  const pdfs = ents.docs.filter(d => d.data().mimeType === 'application/pdf');
  console.log('PDFs en entrantes: ' + pdfs.length + ' de ' + ents.size + '\n');

  let difieren = 0;
  let panSoloMinuscula = 0;
  const filas: string[] = [];

  for (const d of pdfs) {
    const x = d.data();
    let bytes: Buffer;
    try {
      const [b] = await bucket.file(x.rutaStorage as string).download();
      bytes = b as Buffer;
    } catch (e) {
      console.log('ERR storage ' + d.id.slice(0, 8) + ': ' + (e as Error).message.slice(0, 70));
      continue;
    }

    let t1 = '', tAll = '', npag = 0;
    try { const r = await pdfParse(bytes, { max: 1 }); t1 = r.text; } catch { /* sin texto */ }
    try { const r = await pdfParse(bytes); tAll = r.text; npag = r.numpages; } catch { /* sin texto */ }

    const c1 = contarMarcadores(t1);
    const cA = contarMarcadores(tAll);
    const r1 = t1.trim().length < 50 ? 'vision' : rutear(c1.count, c1.tieneDecisivo);
    const rA = tAll.trim().length < 50 ? 'vision' : rutear(cA.count, cA.tieneDecisivo);

    // H3 — PAN que solo matchea con x minúscula (o solo sobre el normalizado)
    const panCrudo = RE_PAN_ENMASCARADO.test(tAll);
    const panInsens = RE_PAN_INSENSIBLE.test(tAll);
    const panNorm = RE_PAN_ENMASCARADO.test(normalizarParaDeteccion(tAll));
    if (!panCrudo && (panInsens || panNorm)) panSoloMinuscula++;

    const marca = r1 !== rA ? ' <<< DIFIERE' : '';
    if (r1 !== rA) difieren++;

    filas.push(
      d.id.slice(0, 8) + ' | pags=' + String(npag).padStart(2) +
      ' | pag1=' + r1.padEnd(11) + '(' + c1.count + (c1.tieneDecisivo ? 'D' : ' ') + ') ' + c1.hits.join(',').slice(0, 46).padEnd(46) +
      ' | full=' + rA.padEnd(11) + '(' + cA.count + (cA.tieneDecisivo ? 'D' : ' ') + ')' +
      ' | pan crudo=' + (panCrudo ? 'si' : 'no') + '/norm=' + (panNorm ? 'si' : 'no') + '/insens=' + (panInsens ? 'si' : 'no') +
      ' | dest=' + String(x.destino?.coleccion ?? x.estado) +
      ' | ' + String(x.nombreArchivo).slice(0, 30) + marca,
    );
  }

  for (const f of filas) console.log(f);
  console.log('\nPDFs donde leer solo la pág.1 cambia el ruteo respecto de leer todo: ' + difieren);
  console.log('PDFs con PAN que el regex actual (X mayúscula, texto crudo) NO ve pero sí vería insensible/normalizado: ' + panSoloMinuscula);

  // H1 — cuántos PDFs caerían en 'ambiguo' con la tabla actual, leyendo todo
  const amb = filas.filter(f => f.includes('full=ambiguo'));
  console.log('PDFs que la tabla actual mandaría a ambiguo leyendo el PDF completo: ' + amb.length);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
