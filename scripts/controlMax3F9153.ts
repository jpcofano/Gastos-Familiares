// F9.153 §5.1 — corrida de control: el detector del router con {max:1} (hoy) vs {max:3} (el fix
// propuesto en F9.151), sobre los MISMOS 71 PDF de producción. SOLO LEE.
//
// La pregunta que bloquea: la factura del Colegio que muestra el PAN enmascarado (93e6c911) hoy
// da `ambiguo` y se resuelve a mano. Con {max:3}, si aparece un marcador genérico en la página 2
// o 3, pasa a 2 marcadores con decisivo y se rutea a `resumen` EN SILENCIO.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';

const req = createRequire(process.cwd() + '/functions/package.json');
const pdfParse = req('pdf-parse') as (b: Buffer, o?: { max: number }) => Promise<{ text: string; numpages: number }>;

if (getApps().length === 0) {
  initializeApp({
    credential: cert('./secrets/serviceAccountKey.json'),
    storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
  });
}
const db = getFirestore();

// Copia literal de functions/src/index.ts (detector del router).
const MARCADORES_GENERICOS = ['TOTAL A PAGAR', 'VENCIMIENTO', 'CIERRE', 'SALDO PENDIENTE'];
const MARCADORES_DECISIVOS = ['PAGO MINIMO', 'LIMITE DE COMPRA', 'LIMITE DE CREDITO'];
const RE_PAN_ENMASCARADO = /\d{4}[\s*X]{4,10}\d{4}/;

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
function rutear(texto: string): { destino: string; count: number; hits: string[] } {
  if (texto.trim().length < 50) return { destino: 'vision', count: 0, hits: [] };
  const { count, hits, tieneDecisivo } = contarMarcadores(texto);
  if (tieneDecisivo && count >= 2) return { destino: 'resumen', count, hits };
  if (count === 0 || !tieneDecisivo) return { destino: 'comprobante', count, hits };
  return { destino: 'ambiguo', count, hits };
}

async function main() {
  const ents = await db.collection('entrantes').get();
  const bucket = getStorage().bucket();
  const pdfs = ents.docs.filter(d => d.data().mimeType === 'application/pdf');
  console.log(`PDFs en entrantes: ${pdfs.length}\n`);

  const cambios: string[] = [];
  let iguales = 0;

  for (const d of pdfs) {
    const x = d.data();
    let bytes: Buffer;
    try {
      const [b] = await bucket.file(x.rutaStorage as string).download();
      bytes = b as Buffer;
    } catch (e) {
      console.log(`ERR storage ${d.id.slice(0, 8)}: ${(e as Error).message.slice(0, 60)}`);
      continue;
    }

    let t1 = '', t3 = '', npag = 0;
    try { const r = await pdfParse(bytes, { max: 1 }); t1 = r.text; } catch { /* sin texto */ }
    try { const r = await pdfParse(bytes, { max: 3 }); t3 = r.text; npag = r.numpages; } catch { /* sin texto */ }

    const r1 = rutear(t1);
    const r3 = rutear(t3);
    const linea =
      `${d.id.slice(0, 8)} | pags=${String(npag).padStart(2)} | ` +
      `max1=${r1.destino.padEnd(11)}(${r1.count}) ${r1.hits.join(',').slice(0, 40).padEnd(40)} | ` +
      `max3=${r3.destino.padEnd(11)}(${r3.count}) ${r3.hits.join(',').slice(0, 44).padEnd(44)} | ` +
      `${String(x.nombreArchivo).slice(0, 26)}`;

    if (r1.destino !== r3.destino) cambios.push(linea);
    else iguales++;

    // La factura del Colegio con el PAN — el caso que bloquea.
    if (d.id.startsWith('93e6c911')) {
      console.log('=== 93e6c911 — la factura del Colegio con el PAN enmascarado ===');
      console.log(linea);
      console.log(`  páginas del PDF: ${npag}`);
      console.log(`  texto pág.1 : ${t1.trim().length} chars | texto págs.1-3: ${t3.trim().length} chars`);
      console.log(`  marcadores max1: [${r1.hits.join(', ')}] → ${r1.destino}`);
      console.log(`  marcadores max3: [${r3.hits.join(', ')}] → ${r3.destino}`);
      console.log();
    }
  }

  console.log(`=== cambios de destino entre {max:1} y {max:3}: ${cambios.length} (sin cambio: ${iguales}) ===\n`);
  for (const c of cambios) console.log(c);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
