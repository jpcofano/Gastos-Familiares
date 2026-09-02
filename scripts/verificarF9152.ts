// F9.152 §5 — verificación del hotfix de media_type. SOLO LEE Firestore/Storage.
//
// Qué prueba, en orden:
//   A) `detectarTipoReal` contra archivos REALES de producción + un HEIC y un blob desconocido.
//   B) La decisión vieja (string declarado) vs la nueva (bytes) sobre los mismos bytes.
//   C) Contra la API de verdad: los MISMOS bytes JPEG mandados como `image/png` (lo que hacía el
//      código viejo) y como `image/jpeg` (lo que manda el nuevo). Uno tiene que fallar 400 y el
//      otro tiene que extraer. Sin esto §5.1/§5.2 son teoría.
//
// La API key sale de `firebase functions:secrets:access ANTHROPIC_API_KEY` por variable de entorno
// (ANTHROPIC_API_KEY); nunca se imprime ni se escribe en disco.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { detectarTipoReal, motivoFormatoNoSoportado } from '../functions/src/tipoArchivo';

// El SDK vive en functions/node_modules, no en la raíz (mismo truco que usa scripts/auditF9151b.ts
// para pdf-parse).
const requireFunctions = createRequire(process.cwd() + '/functions/package.json');
const Anthropic = requireFunctions('@anthropic-ai/sdk').default ?? requireFunctions('@anthropic-ai/sdk');

if (getApps().length === 0) {
  initializeApp({
    credential: cert('./secrets/serviceAccountKey.json'),
    storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
  });
}

// Lo que hacía el código viejo: functions/src/index.ts:143-144 y :161 (pre-F9.152).
function decisionVieja(contentTypeDeclarado: string): { rama: string; mediaType: string } {
  const isPdf = contentTypeDeclarado === 'application/pdf';
  return isPdf
    ? { rama: 'document', mediaType: 'application/pdf' }
    : { rama: 'image', mediaType: contentTypeDeclarado };
}
function decisionNueva(b: Buffer, declarado: string): { rama: string; mediaType: string } {
  const t = detectarTipoReal(b);
  if (!t) return { rama: 'ERROR', mediaType: motivoFormatoNoSoportado(b, declarado) };
  return t === 'application/pdf'
    ? { rama: 'document', mediaType: 'application/pdf' }
    : { rama: 'image', mediaType: t };
}

// La key se pide al CLI de Firebase y se queda en memoria de este proceso: no se imprime, no se
// escribe a disco, no aparece en ningún comando del historial. Es el mismo secreto que usa la CF.
function leerSecretoAnthropic(): string | null {
  try {
    const out = execSync(
      'npx firebase functions:secrets:access ANTHROPIC_API_KEY',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const v = out.trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

// HEIC sintético: caja ISO-BMFF con marca `heic` en 8..11 (los bytes que mira el sniff).
function heicFalso(): Buffer {
  const b = Buffer.alloc(32);
  b.writeUInt32BE(32, 0);
  b.write('ftyp', 4, 'latin1');
  b.write('heic', 8, 'latin1');
  return b;
}

async function main() {
  const bucket = getStorage().bucket();

  // Archivos reales de producción, uno de cada tipo que el pipeline ve.
  const muestras: { etiqueta: string; ruta: string; declarado: string }[] = [
    { etiqueta: 'JPEG real (screenshot Galicia)', ruta: 'entrantes/0e59c80c66' , declarado: 'image/jpeg' },
    { etiqueta: 'PNG real (comprobante MP)',      ruta: 'entrantes/049af4d2c6', declarado: 'image/png'  },
    { etiqueta: 'PDF real (comprobante BBVA)',    ruta: 'entrantes/00c3651d5e', declarado: 'application/pdf' },
  ];

  // Resolver los paths completos: los doc id están truncados arriba, hay que buscarlos.
  const [files] = await bucket.getFiles({ prefix: 'entrantes/' });
  const resolver = (pref: string) => files.find(f => f.name.startsWith(pref))?.name ?? null;

  console.log('=== A) detectarTipoReal sobre archivos reales ===\n');
  const cache = new Map<string, Buffer>();
  for (const m of muestras) {
    const ruta = resolver(m.ruta);
    if (!ruta) { console.log(`${m.etiqueta}: NO ENCONTRADO (${m.ruta})`); continue; }
    const [buf] = await bucket.file(ruta).download();
    cache.set(m.etiqueta, buf as Buffer);
    const real = detectarTipoReal(buf as Buffer);
    console.log(`${m.etiqueta.padEnd(32)} | ${(buf as Buffer).length} bytes | primeros 8 = ${(buf as Buffer).subarray(0, 8).toString('hex')} | detectarTipoReal = ${String(real)}`);
  }

  const heic = heicFalso();
  const raro = Buffer.from('esto no es una imagen ni un pdf, es texto plano', 'utf8');
  console.log(`${'HEIC sintético'.padEnd(32)} | ${heic.length} bytes | primeros 8 = ${heic.subarray(0, 8).toString('hex')} | detectarTipoReal = ${String(detectarTipoReal(heic))}`);
  console.log(`${'Blob desconocido (texto)'.padEnd(32)} | ${raro.length} bytes | primeros 8 = ${raro.subarray(0, 8).toString('hex')} | detectarTipoReal = ${String(detectarTipoReal(raro))}`);

  console.log('\n=== §5.4 — mensaje que ve el usuario cuando el sniff no reconoce el archivo ===');
  console.log('HEIC        → ' + motivoFormatoNoSoportado(heic, 'image/heic'));
  console.log('desconocido → ' + motivoFormatoNoSoportado(raro, 'image/png'));

  // ── B) el caso del bug: JPEG real, declarado image/png ──────────────────────
  const jpeg = cache.get('JPEG real (screenshot Galicia)');
  if (!jpeg) { console.log('\nSin JPEG de muestra, corto acá.'); return; }

  console.log('\n=== B) mismos bytes JPEG, declarados como "image/png" (el caso de producción) ===');
  const vieja = decisionVieja('image/png');
  const nueva = decisionNueva(jpeg, 'image/png');
  console.log(`código VIEJO → rama=${vieja.rama}  media_type="${vieja.mediaType}"   <-- miente, la API responde 400`);
  console.log(`código NUEVO → rama=${nueva.rama}  media_type="${nueva.mediaType}"`);

  console.log('\n--- no-regresión §5.5: los casos que ya andaban ---');
  for (const [etiqueta, decl] of [['JPEG real (screenshot Galicia)', 'image/jpeg'], ['PNG real (comprobante MP)', 'image/png'], ['PDF real (comprobante BBVA)', 'application/pdf']] as const) {
    const b = cache.get(etiqueta);
    if (!b) continue;
    const v = decisionVieja(decl);
    const n = decisionNueva(b, decl);
    const igual = v.rama === n.rama && v.mediaType === n.mediaType;
    console.log(`${etiqueta.padEnd(32)} declarado="${decl}" | viejo=${v.rama}/${v.mediaType} | nuevo=${n.rama}/${n.mediaType} | ${igual ? 'IDÉNTICO' : 'CAMBIA'}`);
  }

  // ── C) contra la API de verdad ─────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY ?? leerSecretoAnthropic();
  if (!apiKey) {
    console.log('\n=== C) SALTEADO: no se pudo obtener ANTHROPIC_API_KEY ===');
    return;
  }
  const client = new Anthropic({ apiKey });
  const base64 = jpeg.toString('base64');

  for (const [rotulo, mediaType] of [['ANTES del fix (media_type declarado)', 'image/png'], ['DESPUÉS del fix (media_type de los bytes)', 'image/jpeg']] as const) {
    console.log(`\n--- ${rotulo}: media_type="${mediaType}" ---`);
    try {
      const resp = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 64,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/png' | 'image/jpeg', data: base64 } },
            { type: 'text', text: 'Respondé en una línea: ¿qué tipo de documento es? No extraigas datos.' },
          ],
        }],
      });
      const txt = (resp.content as Array<{ type: string; text?: string }>).find(b => b.type === 'text');
      console.log('OK 200 → ' + (txt && txt.type === 'text' ? (txt.text ?? '').trim().slice(0, 160) : '(sin texto)'));
    } catch (e) {
      console.log('FALLA → ' + String(e instanceof Error ? e.message : e).replace(/\s+/g, ' ').slice(0, 300));
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
