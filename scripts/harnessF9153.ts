// F9.153 §5 — harness del router sobre los PDF de producción, con tres configuraciones:
//   A = HOY            ({max:1}, pan decisivo, regex sobre `texto` crudo)
//   B = §1+§2          ({max:3}, pan genérico, regex sobre `texto` crudo)
//   C = §1+§2+§3       ({max:3}, pan genérico, regex sobre `norm`)
// El diff B↔C es el que decide si el §3 se aplica o queda afuera. SOLO LEE.
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

// Copia literal de functions/src/index.ts:1355-1380.
const MARCADORES_GENERICOS = ['TOTAL A PAGAR', 'VENCIMIENTO', 'CIERRE', 'SALDO PENDIENTE'];
const MARCADORES_DECISIVOS = ['PAGO MINIMO', 'LIMITE DE COMPRA', 'LIMITE DE CREDITO'];
const RE_PAN_ENMASCARADO = /\d{4}[\s*X]{4,10}\d{4}/;

function normalizarParaDeteccion(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

type Cfg = { panDecisivo: boolean; panSobreNorm: boolean };

function contarMarcadores(texto: string, cfg: Cfg) {
  const norm = normalizarParaDeteccion(texto);
  const hits: string[] = [];
  let tieneDecisivo = false;
  for (const m of MARCADORES_GENERICOS) if (norm.includes(m)) hits.push(m);
  for (const m of MARCADORES_DECISIVOS) if (norm.includes(m)) { hits.push(m); tieneDecisivo = true; }
  if (RE_PAN_ENMASCARADO.test(cfg.panSobreNorm ? norm : texto)) {
    hits.push('pan_enmascarado');
    if (cfg.panDecisivo) tieneDecisivo = true;
  }
  return { count: hits.length, hits, tieneDecisivo };
}

function rutear(texto: string, cfg: Cfg) {
  if (texto.trim().length < 50) return { destino: 'vision', count: 0, hits: [] as string[] };
  const { count, hits, tieneDecisivo } = contarMarcadores(texto, cfg);
  if (tieneDecisivo && count >= 2) return { destino: 'resumen', count, hits };
  if (count === 0 || !tieneDecisivo) return { destino: 'comprobante', count, hits };
  return { destino: 'ambiguo', count, hits };
}

const CFG_A: Cfg = { panDecisivo: true,  panSobreNorm: false };
const CFG_B: Cfg = { panDecisivo: false, panSobreNorm: false };
const CFG_C: Cfg = { panDecisivo: false, panSobreNorm: true  };

async function main() {
  const ents = await db.collection('entrantes').get();
  const bucket = getStorage().bucket();
  const pdfs = ents.docs.filter(d => d.data().mimeType === 'application/pdf');
  console.log(`PDFs en entrantes: ${pdfs.length} (de ${ents.size} entrantes)\n`);

  type Fila = {
    id: string; nombre: string; npag: number; len1: number; len3: number;
    a: ReturnType<typeof rutear>; b: ReturnType<typeof rutear>; c: ReturnType<typeof rutear>;
    destinoReal: string;
  };
  const filas: Fila[] = [];

  for (const d of pdfs) {
    const x = d.data();
    let bytes: Buffer;
    try {
      const [bb] = await bucket.file(x.rutaStorage as string).download();
      bytes = bb as Buffer;
    } catch (e) {
      console.log(`ERR storage ${d.id.slice(0, 8)}: ${(e as Error).message.slice(0, 60)}`);
      continue;
    }

    let t1 = '', t3 = '', npag = 0;
    try { const r = await pdfParse(bytes, { max: 1 }); t1 = r.text; } catch { /* sin texto */ }
    try { const r = await pdfParse(bytes, { max: 3 }); t3 = r.text; npag = r.numpages; } catch { /* sin texto */ }

    filas.push({
      id: d.id, nombre: String(x.nombreArchivo), npag,
      len1: t1.trim().length, len3: t3.trim().length,
      a: rutear(t1, CFG_A),   // hoy: max1
      b: rutear(t3, CFG_B),   // §1+§2: max3
      c: rutear(t3, CFG_C),   // §1+§2+§3: max3
      destinoReal: String(x.destino?.coleccion ?? x.estado),
    });
  }

  // ── §3: el diff que decide ────────────────────────────────────────────────
  const difBC = filas.filter(f => f.b.destino !== f.c.destino);
  console.log('=== §3 — diff B(§1+§2) contra C(§1+§2+§3): ¿el regex sobre `norm` mueve algo? ===');
  console.log(`documentos que cambian de destino por el §3: ${difBC.length}`);
  for (const f of difBC) {
    console.log(`  ${f.id.slice(0, 8)} | B=${f.b.destino}(${f.b.count}) [${f.b.hits.join(',')}] | C=${f.c.destino}(${f.c.count}) [${f.c.hits.join(',')}] | ${f.nombre}`);
  }
  const difHits = filas.filter(f => f.b.hits.join(',') !== f.c.hits.join(','));
  console.log(`documentos donde el §3 cambia los marcadores detectados (aunque no el destino): ${difHits.length}`);
  for (const f of difHits) {
    console.log(`  ${f.id.slice(0, 8)} | B=[${f.b.hits.join(',')}] | C=[${f.c.hits.join(',')}] | ${f.nombre}`);
  }

  // ── §5.1: diff completo A → B ─────────────────────────────────────────────
  const difAB = filas.filter(f => f.a.destino !== f.b.destino);
  console.log(`\n=== §5.1 — diff HOY(A) contra §1+§2(B): ${difAB.length} de ${filas.length} cambian ===`);
  for (const f of difAB) {
    console.log(
      `${f.id.slice(0, 8)} | pags=${String(f.npag).padStart(2)} | ` +
      `A=${f.a.destino.padEnd(11)}(${f.a.count}) ${f.a.hits.join(',').slice(0, 34).padEnd(34)} | ` +
      `B=${f.b.destino.padEnd(11)}(${f.b.count}) ${f.b.hits.join(',').slice(0, 36).padEnd(36)} | ${f.nombre.slice(0, 26)}`,
    );
  }

  // ── §5.2: los casos nombrados ─────────────────────────────────────────────
  console.log('\n=== §5.2 — los casos que la spec nombra ===');
  for (const pref of ['f9d9b308', 'f9dcc286', 'fc31ca48', '93e6c911']) {
    const f = filas.find(x => x.id.startsWith(pref));
    if (!f) { console.log(`${pref} | NO ESTÁ en entrantes`); continue; }
    console.log(
      `${pref} | pags=${String(f.npag).padStart(2)} | HOY=${f.a.destino.padEnd(11)}(${f.a.count}) [${f.a.hits.join(',')}]`,
    );
    console.log(`         → B=${f.b.destino.padEnd(11)}(${f.b.count}) [${f.b.hits.join(',')}]  C=${f.c.destino.padEnd(11)}(${f.c.count}) [${f.c.hits.join(',')}] | ${f.nombre}`);
  }
  const sinCambio = filas.filter(f => f.a.destino === f.b.destino);
  console.log(`\nsin cambio A→B: ${sinCambio.length} de ${filas.length}`);

  // ── §5.3: el fallback de visión ───────────────────────────────────────────
  console.log('\n=== §5.3 — fallback de visión (umbral 50 chars de texto extraído) ===');
  const visionHoy = filas.filter(f => f.len1 < 50);
  const visionB   = filas.filter(f => f.len3 < 50);
  console.log(`van a visión HOY (len(pág.1) < 50): ${visionHoy.length}`);
  for (const f of visionHoy) console.log(`  ${f.id.slice(0, 8)} | pags=${f.npag} | len(max1)=${f.len1} | len(max3)=${f.len3} | ${f.nombre}`);
  console.log(`van a visión con {max:3} (len(págs.1-3) < 50): ${visionB.length}`);
  for (const f of visionB) console.log(`  ${f.id.slice(0, 8)} | pags=${f.npag} | len(max1)=${f.len1} | len(max3)=${f.len3} | ${f.nombre}`);
  const dejanDeIr = visionHoy.filter(f => f.len3 >= 50);
  console.log(`documentos que HOY van a visión y con {max:3} dejarían de ir: ${dejanDeIr.length}`);
  for (const f of dejanDeIr) console.log(`  ${f.id.slice(0, 8)} | len(max1)=${f.len1} → len(max3)=${f.len3} | ${f.nombre}`);

  // ── §4: ¿los resueltos a mano quedaron en la colección correcta? ──────────
  console.log('\n=== §4 — dónde quedaron los entrantes resueltos a mano ===');
  for (const d of ents.docs) {
    const x = d.data();
    if (x.tipoDetectado !== 'ambiguo') continue;
    const f = filas.find(y => y.id === d.id);
    console.log(`${d.id.slice(0, 8)} | destino REAL = ${String(x.destino?.coleccion)} | motivo="${String(x.motivoDeteccion)}" | el router con §1+§2 diría: ${f ? f.b.destino : '(no es PDF)'} | ${String(x.nombreArchivo)}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
