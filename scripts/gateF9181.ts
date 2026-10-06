// F9.181 §0 — desempate del GATE. NO ESCRIBE NADA (ni Firestore ni Storage).
//
//   npx tsx scripts/gateF9181.ts
//
// La aritmética de §0 deja al resumen que falló en el borde de la capacidad del formato actual
// (~148–155 líneas estimadas contra ~155 que entran). Esto lo desempata: el prompt de BASE, sin
// cambios, sobre el PDF que falló, con max_tokens holgado. Si termina en end_turn poco después de
// 32.000 con líneas distintas, es el formato; si se va hasta el techo o repite líneas, es un loop.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const req = createRequire(process.cwd() + '/functions/package.json');
const Anthropic = req('@anthropic-ai/sdk').default ?? req('@anthropic-ai/sdk');
const ts = req('typescript') as typeof import('typescript');

if (getApps().length === 0) initializeApp({
  credential: cert('./secrets/serviceAccountKey.json'),
  storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
});
const db = getFirestore();
const BASE = 'c641204';
const FALLADO = '37ab6ea1';
const TECHO = 64000;

const aJs = (c: string) =>
  ts.transpileModule(c, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
const bl = (src: string, d: string, h: string) => { const i = src.indexOf(d); return src.slice(i, src.indexOf(h, i) + h.length); };
const srcBase = execSync(`git show ${BASE}:functions/src/index.ts`, { encoding: 'utf8', maxBuffer: 64 << 20 }).replace(/\r\n/g, '\n');
const buildPromptBase = new Function(`${aJs([
  bl(srcBase, 'const PERSONAS_CANONICAS =', '`;'),
  bl(srcBase, 'function buildResumenTarjetaPrompt', '`;\n}'),
].join('\n'))}\nreturn buildResumenTarjetaPrompt;`)() as (b: string, t: string) => string;

function leerSecreto(): string | null {
  try {
    return execSync('npx firebase functions:secrets:access ANTHROPIC_API_KEY',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? leerSecreto();
  if (!apiKey) { console.log('>>> SALTEADO: sin ANTHROPIC_API_KEY'); return; }
  const client = new Anthropic({ apiKey });
  const d = (await db.collection('resumenesTarjeta').get()).docs.find(x => x.id.startsWith(FALLADO));
  if (!d) { console.log(`>>> ${FALLADO}: no está`); return; }
  const x = d.data();
  const [buf] = await getStorage().bucket().file(String(x.refStoragePdf)).download();

  // Igual que procesarResumenTarjeta: banco/tarjeta del doc (vacíos en este caso).
  const t0 = Date.now();
  const resp = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: TECHO,
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: (buf as Buffer).toString('base64') } },
      { type: 'text', text: buildPromptBase(String(x.banco ?? ''), String(x.tarjeta ?? '')) },
    ] }],
  }).finalMessage();
  const seg = (Date.now() - t0) / 1000;
  const raw = (resp.content as Array<{ type: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text).join('');

  console.log(`F9.181 GATE — prompt de BASE ${BASE}, PDF ${FALLADO}, max_tokens=${TECHO}`);
  console.log(`  stop_reason=${resp.stop_reason} | input_tokens=${resp.usage.input_tokens} | output_tokens=${resp.usage.output_tokens} | ${seg.toFixed(0)} s → ${(resp.usage.output_tokens / seg).toFixed(0)} tok/s`);
  const seqs = [...raw.matchAll(/"seq":\s*(\d+)/g)].map(m => Number(m[1]));
  const firmas = [...raw.matchAll(/"fechaConsumo":\s*("[^"]*"|null),\s*"descripcionRaw":\s*"([^"]*)"[\s\S]*?"monto":\s*([\d.]+)/g)]
    .map(m => `${m[1]}|${m[2]}|${m[3]}`);
  const repetidas = firmas.length - new Set(firmas).size;
  console.log(`  movimientos emitidos: ${seqs.length} (seq ${seqs[0]}..${seqs[seqs.length - 1]}) | seq repetidos: ${seqs.length - new Set(seqs).size} | fecha+desc+monto repetidos: ${repetidas}`);
  const m = raw.match(/```json\s*([\s\S]*?)\s*```/);
  let parseo = 'no';
  try { if (m) { const p = JSON.parse(m[1]); parseo = `sí, ${p.movimientos?.length} movimientos`; } } catch (e) { parseo = `no (${(e as Error).message.slice(0, 60)})`; }
  console.log(`  JSON parsea: ${parseo}`);
  const tokPorLinea = seqs.length ? resp.usage.output_tokens / seqs.length : 0;
  console.log(`  tok/línea efectivos (salida total / líneas, incluye cabecera): ${tokPorLinea.toFixed(1)}`);
  console.log(`  ¿excede 32000 con el formato actual? ${resp.usage.output_tokens > 32000 ? 'SÍ — la hipótesis se sostiene' : 'NO — la hipótesis cae'}`);
}

main().catch(e => { console.error(e); process.exit(1); });
