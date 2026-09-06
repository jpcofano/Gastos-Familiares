// F9.160 §5.3 — el prompt NUEVO contra la API real, con el PDF de 08a697e0.
// `buildResumenTarjetaPrompt` y `sanitizarJson` se EXTRAEN del fuente, y la llamada replica la del
// código real (mensaje de usuario, streaming, max_tokens 32000). SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';

const req = createRequire(process.cwd() + '/functions/package.json');
const Anthropic = req('@anthropic-ai/sdk').default ?? req('@anthropic-ai/sdk');
const ts = req('typescript') as typeof import('typescript');

if (getApps().length === 0) initializeApp({
  credential: cert('./secrets/serviceAccountKey.json'),
  storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
});
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

function leerSecreto(): string | null {
  try {
    return execSync('npx firebase functions:secrets:access ANTHROPIC_API_KEY',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

const src = fs.readFileSync('functions/src/index.ts', 'utf8').replace(/\r\n/g, '\n');
function aJs(codigo: string): string {
  return ts.transpileModule(codigo, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
}
function bloque(desde: string, hasta: string): string {
  const i = src.indexOf(desde);
  if (i < 0) throw new Error(`no encontré "${desde}"`);
  return src.slice(i, src.indexOf(hasta, i) + hasta.length);
}

// El builder interpola PERSONAS_CANONICAS, así que la constante entra junto con la función.
const buildResumenTarjetaPrompt = new Function(
  `${aJs([
    bloque('const PERSONAS_CANONICAS =', '`;'),
    bloque('function buildResumenTarjetaPrompt', '`;\n}'),
  ].join('\n'))}\nreturn buildResumenTarjetaPrompt;`,
)() as (banco: string, tarjeta: string) => string;
const sanitizarJson = new Function(
  `${aJs(bloque('function sanitizarJson', '\n}'))}\nreturn sanitizarJson;`,
)() as (raw: string) => string;

async function main() {
  console.log('=== §5.3 — las reglas de tipoLinea, leídas del prompt real ===');
  const p0 = buildResumenTarjetaPrompt('BBVA Argentina', 'Visa Signature');
  const iTag = p0.indexOf('tipoLinea (string): uno de estos valores:');
  console.log(p0.slice(iTag, p0.indexOf('fechaConsumo (string|null)', iTag)).trimEnd());
  const iCaja = p0.indexOf('CAJA SEG-PROMO en BBVA');
  console.log('\n--- el caso especial ---');
  console.log(p0.slice(iCaja, p0.indexOf('\n\n', iCaja)).trimEnd());

  if (process.argv.includes('offline')) return;
  const apiKey = process.env.ANTHROPIC_API_KEY ?? leerSecreto();
  if (!apiKey) { console.log('\n>>> SALTEADO: sin ANTHROPIC_API_KEY'); return; }

  const resus = await db.collection('resumenesTarjeta').get();
  const d = resus.docs.find(x => x.id.startsWith('08a697e0'))!;
  const x = d.data();
  const [buf] = await getStorage().bucket().file(s(x.refStoragePdf)).download();
  console.log(`\n=== extrayendo el PDF de 08a697e0 (${(buf as Buffer).length} bytes) con el prompt nuevo ===`);
  console.log(`  prompt: ${p0.length} chars | banco="${s(x.banco)}" tarjeta="${s(x.tarjeta)}"`);

  // Misma forma que functions/src/index.ts:1278-1289: prompt como mensaje de usuario, streaming.
  const client = new Anthropic({ apiKey });
  const stream = client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 32000,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: (buf as Buffer).toString('base64') } },
        { type: 'text', text: buildResumenTarjetaPrompt(s(x.banco), s(x.tarjeta)) },
      ],
    }],
  });
  const resp = await stream.finalMessage();
  const raw = (resp.content as Array<{ type: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text ?? '').join('');
  const m = raw.match(/```json\s*([\s\S]*?)\s*```/) ?? raw.match(/(\{[\s\S]*\})/);
  if (!m) { console.log(`  >>> no parseó JSON (raw ${raw.length} chars, stop=${s((resp as { stop_reason?: string }).stop_reason)})`); return; }
  let p: Record<string, unknown>;
  try { p = JSON.parse(sanitizarJson(m[1])) as Record<string, unknown>; }
  catch (e) { console.log(`  >>> JSON inválido: ${(e as Error).message.slice(0, 140)} (raw ${raw.length} chars, stop=${s((resp as { stop_reason?: string }).stop_reason)})`); return; }

  const ls = (p.movimientos ?? p.movimientosParseados ?? []) as Array<Record<string, unknown>>;
  // La cabecera viene anidada bajo `resumen` (esquema del prompt, index.ts:1176-1189).
  const cab = (p.resumen ?? p) as Record<string, unknown>;
  console.log(`  líneas extraídas: ${ls.length} | totalARS=${s(cab.totalARS)} totalUSD=${s(cab.totalUSD)}`);

  console.log('\n  --- §5.2/§5.3: los dos casos que la spec exige ---');
  // Ojo: "COTO DIGITAL SUC 056 CRED" son DOS renglones distintos del PDF con la MISMA descripción —
  // el crédito de −8.870,44 y un consumo real de +308.251,02. Se los separa por monto.
  for (const [rot, test, esperado] of [
    ['CAJA SEG-PROMO (positivo, 168.542)', (l: Record<string, unknown>) => /CAJA SEG/i.test(s(l.descripcionRaw)), 'consumo'],
    ['COTO DIGITAL CRED (el de 8.870,44)', (l: Record<string, unknown>) => /COTO DIGITAL.*CRED/i.test(s(l.descripcionRaw)) && Math.abs(Number(l.monto ?? 0) - 8870.44) < 0.01, 'reverso'],
    ['COTO DIGITAL (el de 308.251,02)',    (l: Record<string, unknown>) => /COTO DIGITAL/i.test(s(l.descripcionRaw)) && Math.abs(Number(l.monto ?? 0) - 308251.02) < 0.01, 'consumo'],
  ] as const) {
    const hits = ls.filter(test);
    if (hits.length === 0) { console.log(`  >>> ${rot}: no aparece`); continue; }
    for (const h of hits) {
      const ok = s(h.tipoLinea) === esperado;
      console.log(`  ${ok ? 'OK ' : '>>> NO'} ${rot.padEnd(36)} → tipoLinea=${s(h.tipoLinea).padEnd(21)} monto=${String(s(h.monto)).padStart(12)} ${s(h.moneda)} (esperado ${esperado})`);
    }
  }

  // §5.4 — el cuadre con la extracción nueva.
  const srcDatos = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
  const iA = srcDatos.indexOf('function tipoDeLinea');
  const iB = srcDatos.indexOf('export function calcularCuadre');
  const motor = new Function(`${aJs([
    srcDatos.slice(iA, srcDatos.indexOf('\n}', iA) + 2),
    srcDatos.slice(iB, srcDatos.indexOf('\n}', iB) + 2).replace('export ', ''),
  ].join('\n'))}\nreturn { tipoDeLinea, calcularCuadre };`)() as {
    calcularCuadre: (l: unknown[], a: number, u: number, aj?: unknown[]) => {
      sumaARS: number; diffARS: number; balanceARS: boolean; sumaUSD: number; diffUSD: number; balanceUSD: boolean };
  };
  // El spread de un Record<string, unknown> descarta el index signature: se repone a mano.
  const conIncluir: Array<Record<string, unknown>> = ls.map(l => ({ ...l, incluir: true }));
  const ajustes = (cab.ajustesConsolidado ?? []) as unknown[];
  const c = motor.calcularCuadre(conIncluir, Number(cab.totalARS), Number(cab.totalUSD), ajustes);
  console.log(`\n  --- §5.4: el cuadre con la extracción nueva (sin ningún ajuste manual) ---`);
  console.log(`  ajustesConsolidado extraídos: ${JSON.stringify(ajustes)}`);
  console.log(`  sumaARS=${c.sumaARS.toFixed(2)} totalARS=${s(cab.totalARS)} diffARS=${c.diffARS.toFixed(2)} balanceARS=${c.balanceARS}`);
  console.log(`  sumaUSD=${c.sumaUSD.toFixed(2)} totalUSD=${s(cab.totalUSD)} diffUSD=${c.diffUSD.toFixed(2)} balanceUSD=${c.balanceUSD}`);

  // Subtotales por sección contra el PDF.
  const PDF: Record<string, number> = { MARIA: 1336897.92, JUAN: 807818.44, SOFIA: 6951.93, FEDERICO: 107712.15 };
  const porPersona = new Map<string, number>();
  for (const l of conIncluir) {
    if (Number(l.monto ?? 0) <= 0 || l.moneda !== 'ARS') continue;
    const k = s(l.personaDetectada).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/\s+/)[0] || '(sin persona)';
    const ingreso = ['reintegro_percepcion', 'bonificacion', 'reverso'].includes(s(l.tipoLinea));
    porPersona.set(k, (porPersona.get(k) ?? 0) + (ingreso ? -1 : 1) * Number(l.monto ?? 0));
  }
  console.log('\n  --- subtotal por sección vs el PDF ---');
  for (const [k, v] of [...porPersona].sort()) {
    const esp = PDF[k];
    console.log(`  ${esp !== undefined ? (Math.abs(v - esp) < 0.01 ? 'OK ' : '>>> NO') : '    '} ${k.padEnd(13)} parseado=${v.toFixed(2).padStart(14)} | PDF=${esp !== undefined ? esp.toFixed(2).padStart(14) : '           n/d'} | Δ=${esp !== undefined ? (v - esp).toFixed(2) : 'n/d'}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
