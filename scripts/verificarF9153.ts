// F9.153 §5 — verificación contra el CÓDIGO REAL: extrae `contarMarcadores`, las listas de
// marcadores, el regex de PAN y el `{max:N}` del propio functions/src/index.ts y los corre sobre
// los 70 PDF de producción. Si mañana alguien cambia el motor, esto lo ve; una copia no. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
const require = createRequire(import.meta.url ?? __filename);

const req = createRequire(process.cwd() + '/functions/package.json');
const pdfParse = req('pdf-parse') as (b: Buffer, o?: { max: number }) => Promise<{ text: string; numpages: number }>;

if (getApps().length === 0) {
  initializeApp({
    credential: cert('./secrets/serviceAccountKey.json'),
    storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
  });
}
const db = getFirestore();

const src = fs.readFileSync('functions/src/index.ts', 'utf8').replace(/\r\n/g, '\n');

function bloque(desde: string, hasta: string): string {
  const i = src.indexOf(desde);
  if (i < 0) throw new Error(`no encontré "${desde}" en index.ts`);
  const j = src.indexOf(hasta, i);
  if (j < 0) throw new Error(`no encontré el cierre "${hasta}"`);
  return src.slice(i, j + hasta.length);
}

// Constantes + funciones tal cual están en el fuente, sin reescribir nada. Los tipos los saca el
// compilador de TypeScript de verdad, no un regex a mano (el primer intento rompió `string[]`).
const codigoTs = [
  bloque('const MARCADORES_GENERICOS = [', '];'),
  bloque('const MARCADORES_DECISIVOS = [', '];'),
  bloque('const RE_PAN_ENMASCARADO =', ';'),
  bloque('function normalizarParaDeteccion', '\n}'),
  bloque('function contarMarcadores', '\n}'),
].join('\n');
const ts = require('typescript') as typeof import('typescript');
const codigo = ts.transpileModule(codigoTs, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;

type Conteo = { count: number; hits: string[]; tieneDecisivo: boolean };
const contarMarcadores = new Function(`${codigo}\nreturn contarMarcadores;`)() as (t: string) => Conteo;

// El `{max:N}` que usa el router, leído del fuente.
const mMax = src.match(/pdfParse\(fileBytes as Buffer, \{ max: (\d+) \}\)/);
if (!mMax) throw new Error('no encontré la llamada a pdfParse del router');
const MAX_PAGINAS = Number(mMax[1]);

// El umbral del fallback de visión, leído del fuente.
const mUmbral = src.match(/if \(textoCabecera\.trim\(\)\.length < (\d+)\)/);
const UMBRAL_VISION = mUmbral ? Number(mUmbral[1]) : 50;

// La tabla de decisión, leída del fuente (que el umbral siga siendo >= 2).
const mUmbralCount = src.match(/if \(tieneDecisivo && count >= (\d+)\)/);
const UMBRAL_COUNT = mUmbralCount ? Number(mUmbralCount[1]) : -1;

console.log('=== parámetros leídos del código real (functions/src/index.ts) ===');
console.log(`  pdfParse max páginas   = ${MAX_PAGINAS}`);
console.log(`  umbral fallback visión = ${UMBRAL_VISION} chars`);
console.log(`  umbral count decisivo  = ${UMBRAL_COUNT}`);
// Ojo con la máscara de prueba: el regex admite entre 4 y 10 caracteres de [\s*X] entre los dos
// grupos de dígitos, así que "4509 XXXX XXXX 1234" (11 caracteres en el medio) NO matchea ni en
// mayúscula. Se usa una máscara corta, que es la que ejercita de verdad el mayúscula/minúscula.
const PAN_MAY = 'saldo 4509 XXXX 1234 pesos';
const PAN_MIN = 'saldo 4509 xxxx 1234 pesos';
console.log(`  PAN mayúscula → hits   = ${JSON.stringify(contarMarcadores(PAN_MAY).hits)} | decisivo=${contarMarcadores(PAN_MAY).tieneDecisivo}`);
console.log(`  PAN minúscula → hits   = ${JSON.stringify(contarMarcadores(PAN_MIN).hits)} | decisivo=${contarMarcadores(PAN_MIN).tieneDecisivo}   (§3: antes daba [])`);
console.log();

function rutear(texto: string): string {
  if (texto.trim().length < UMBRAL_VISION) return 'vision';
  const { count, tieneDecisivo } = contarMarcadores(texto);
  if (tieneDecisivo && count >= UMBRAL_COUNT) return 'resumen';
  if (count === 0 || !tieneDecisivo) return 'comprobante';
  return 'ambiguo';
}

// Config ANTERIOR (la que está desplegada hoy), para el diff.
const MG = ['TOTAL A PAGAR', 'VENCIMIENTO', 'CIERRE', 'SALDO PENDIENTE'];
const MD = ['PAGO MINIMO', 'LIMITE DE COMPRA', 'LIMITE DE CREDITO'];
const RE = /\d{4}[\s*X]{4,10}\d{4}/;
function ruteaHoy(t1: string): string {
  if (t1.trim().length < 50) return 'vision';
  const norm = t1.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const hits: string[] = [];
  let dec = false;
  for (const m of MG) if (norm.includes(m)) hits.push(m);
  for (const m of MD) if (norm.includes(m)) { hits.push(m); dec = true; }
  if (RE.test(t1)) { hits.push('pan_enmascarado'); dec = true; }
  if (dec && hits.length >= 2) return 'resumen';
  if (hits.length === 0 || !dec) return 'comprobante';
  return 'ambiguo';
}

async function main() {
  const ents = await db.collection('entrantes').get();
  const bucket = getStorage().bucket();
  const pdfs = ents.docs.filter(d => d.data().mimeType === 'application/pdf');
  console.log(`=== corrida sobre ${pdfs.length} PDF de producción ===\n`);

  const cambios: string[] = [];
  let iguales = 0;
  let visionHoy = 0, visionNuevo = 0;
  const dejanVision: string[] = [];
  const detalle = new Map<string, { destino: string; hits: string[] }>();

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
    let t1 = '', tN = '', npag = 0;
    try { const r = await pdfParse(bytes, { max: 1 });           t1 = r.text; } catch { /* sin texto */ }
    try { const r = await pdfParse(bytes, { max: MAX_PAGINAS }); tN = r.text; npag = r.numpages; } catch { /* sin texto */ }

    const antes   = ruteaHoy(t1);
    const despues = rutear(tN);
    const hits    = tN.trim().length < UMBRAL_VISION ? [] : contarMarcadores(tN).hits;
    detalle.set(d.id.slice(0, 8), { destino: despues, hits });

    if (t1.trim().length < 50) visionHoy++;
    if (tN.trim().length < UMBRAL_VISION) visionNuevo++;
    if (t1.trim().length < 50 && tN.trim().length >= UMBRAL_VISION) {
      dejanVision.push(`${d.id.slice(0, 8)} | ${t1.trim().length} → ${tN.trim().length} chars | ${String(x.nombreArchivo)}`);
    }

    if (antes !== despues) {
      cambios.push(
        `${d.id.slice(0, 8)} | pags=${String(npag).padStart(2)} | ANTES=${antes.padEnd(11)} → AHORA=${despues.padEnd(11)}` +
        ` (${hits.length}) [${hits.join(', ')}] | ${String(x.nombreArchivo).slice(0, 26)}`,
      );
    } else iguales++;
  }

  console.log(`§5.1 — cambios de destino contra el código desplegado: ${cambios.length} de ${pdfs.length} (sin cambio: ${iguales})`);
  for (const c of cambios) console.log('  ' + c);

  console.log('\n§5.2 — los casos nombrados por la spec:');
  for (const [pref, esperado] of [['f9d9b308', 'resumen'], ['f9dcc286', 'resumen'], ['fc31ca48', 'resumen'], ['93e6c911', 'comprobante']] as const) {
    const r = detalle.get(pref);
    const ok = r?.destino === esperado ? 'OK ' : '>>> NO';
    console.log(`  ${ok} ${pref} → ${r?.destino ?? '(no está)'} (esperado: ${esperado}) [${r?.hits.join(', ') ?? ''}]`);
  }

  console.log('\n§5.3 — fallback de visión:');
  console.log(`  van a visión con el código desplegado ({max:1}, umbral 50): ${visionHoy}`);
  console.log(`  van a visión con el código nuevo ({max:${MAX_PAGINAS}}, umbral ${UMBRAL_VISION}): ${visionNuevo}`);
  console.log(`  documentos que HOY van a visión y ahora dejarían de ir: ${dejanVision.length}`);
  for (const l of dejanVision) console.log('    ' + l);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
