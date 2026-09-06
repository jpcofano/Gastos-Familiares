// F9.161 §5.1/§5.2/§5.5/§5.6 — el prompt nuevo y el guard, contra la API real y el motor real.
// `buildResumenTarjetaPrompt`, `corregirSignoConsumos`, `calcularCuadre` y `totalesNetos` se
// EXTRAEN del fuente: si el motor cambia, esto se rompe. SOLO LEE.
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
let ok = 0, fail = 0;
function chk(rot: string, cond: boolean, detalle = '') {
  if (cond) { ok++; console.log(`  OK   ${rot}${detalle ? ' — ' + detalle : ''}`); }
  else { fail++; console.log(`  FAIL ${rot}${detalle ? ' — ' + detalle : ''}`); }
}

function leerSecreto(): string | null {
  try {
    return execSync('npx firebase functions:secrets:access ANTHROPIC_API_KEY',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

function aJs(codigo: string): string {
  return ts.transpileModule(codigo, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
}
const srcFn = fs.readFileSync('functions/src/index.ts', 'utf8').replace(/\r\n/g, '\n');
function bloque(src: string, desde: string, hasta: string): string {
  const i = src.indexOf(desde);
  if (i < 0) throw new Error(`no encontré "${desde}"`);
  return src.slice(i, src.indexOf(hasta, i) + hasta.length);
}

const buildResumenTarjetaPrompt = new Function(
  `${aJs([
    bloque(srcFn, 'const PERSONAS_CANONICAS =', '`;'),
    bloque(srcFn, 'function buildResumenTarjetaPrompt', '`;\n}'),
  ].join('\n'))}\nreturn buildResumenTarjetaPrompt;`,
)() as (banco: string, tarjeta: string) => string;
const sanitizarJson = new Function(
  `${aJs(bloque(srcFn, 'function sanitizarJson', '\n}'))}\nreturn sanitizarJson;`,
)() as (raw: string) => string;

// El guard real, extraído de su módulo.
const srcGuard = fs.readFileSync('functions/src/signoLineas.ts', 'utf8').replace(/\r\n/g, '\n');
const guard = new Function(
  `${aJs(srcGuard.replace(/export /g, ''))}\nreturn { esSeccionDeConsumos, corregirSignoConsumos };`,
)() as {
  esSeccionDeConsumos: (s: string | null) => boolean;
  corregirSignoConsumos: (l: Array<Record<string, unknown>>) =>
    { lineas: Array<Record<string, unknown>>; correcciones: Array<Record<string, unknown>> };
};

// El motor de cuadre real, extraído del cliente.
const srcDatos = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
const trozo = (d: string, h: string) => {
  const i = srcDatos.indexOf(d);
  return srcDatos.slice(i, srcDatos.indexOf(h, i) + h.length);
};
const motor = new Function(`${aJs([
  trozo('function tipoDeLinea', '\n}'),
  trozo('export function totalesNetos', '\n}').replace('export ', ''),
  (() => { const _r = require('node:fs').readFileSync('src/datos/ajusteConsolidado.ts','utf8').replace(/\\r\\n/g,'\\n'); return _r.replace(/^import .*$/gm,'').replace(/export /g,''); })(),
  trozo('export function calcularCuadre', '\n}').replace('export ', ''),
].join('\n'))}\nreturn { calcularCuadre, totalesNetos };`)() as {
  calcularCuadre: (l: unknown[], a: number, u: number, aj?: unknown[]) => {
    sumaARS: number; diffARS: number; balanceARS: boolean; sumaUSD: number; diffUSD: number;
    balanceUSD: boolean; noDebitadoARS: number; objetivoARS: number; objetivoUSD: number };
  totalesNetos: (l: unknown[], a: number, u: number) => { objetivoARS: number; objetivoUSD: number };
};

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? leerSecreto();
  if (!apiKey) { console.log('>>> SALTEADO: sin ANTHROPIC_API_KEY'); return; }

  const resus = await db.collection('resumenesTarjeta').get();
  const d = resus.docs.find(x => x.id.startsWith('08a697e0'))!;
  const x = d.data();
  const [buf] = await getStorage().bucket().file(s(x.refStoragePdf)).download();
  const prompt = buildResumenTarjetaPrompt(s(x.banco), s(x.tarjeta));
  console.log(`=== §5.1 — extracción real de 08a697e0 con el prompt de F9.161 (${prompt.length} chars) ===`);

  const client = new Anthropic({ apiKey });
  const resp = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 32000,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: (buf as Buffer).toString('base64') } },
        { type: 'text', text: prompt },
      ],
    }],
  }).finalMessage();
  const raw = (resp.content as Array<{ type: string; text?: string }>)
    .filter(b => b.type === 'text').map(b => b.text ?? '').join('');
  const m = raw.match(/```json\s*([\s\S]*?)\s*```/) ?? raw.match(/(\{[\s\S]*\})/);
  if (!m) { console.log('  >>> no parseó JSON'); process.exit(1); }
  const p = JSON.parse(sanitizarJson(m[1])) as Record<string, unknown>;
  const cab = (p.resumen ?? {}) as Record<string, unknown>;
  const crudas = (p.movimientos ?? []) as Array<Record<string, unknown>>;
  console.log(`  líneas: ${crudas.length} | totalARS=${s(cab.totalARS)} totalUSD=${s(cab.totalUSD)}`);

  // ── §5.1 — los campos nuevos, sin que `monto` cambie ────────────────────────
  console.log('\n--- §5.1: montoFirmado y seccion ---');
  const conFirmado = crudas.filter(l => typeof l.montoFirmado === 'number');
  const conSeccion = crudas.filter(l => typeof l.seccion === 'string' && l.seccion);
  chk('montoFirmado poblado en todas las líneas', conFirmado.length === crudas.length,
      `${conFirmado.length}/${crudas.length}`);
  chk('seccion poblada en todas las líneas', conSeccion.length === crudas.length,
      `${conSeccion.length}/${crudas.length}`);
  const desalineadas = conFirmado.filter(l =>
    Math.abs(Math.abs(Number(l.montoFirmado)) - Number(l.monto ?? 0)) > 0.01);
  chk('monto === |montoFirmado| en todas', desalineadas.length === 0,
      desalineadas.length ? JSON.stringify(desalineadas.slice(0, 3).map(l => ({ d: l.descripcionRaw, m: l.monto, f: l.montoFirmado }))) : '');
  const negativas = crudas.filter(l => Number(l.montoFirmado ?? 0) < 0);
  chk('hay al menos un montoFirmado NEGATIVO (el signo sobrevive)', negativas.length > 0,
      `${negativas.length} negativas`);
  for (const l of negativas) {
    console.log(`       ${String(s(l.descripcionRaw)).padEnd(34).slice(0, 34)} | monto=${String(s(l.monto)).padStart(11)} | montoFirmado=${String(s(l.montoFirmado)).padStart(12)} | ${s(l.seccion)}`);
  }
  const coto = crudas.find(l => /COTO DIGITAL.*CRED/i.test(s(l.descripcionRaw)) &&
    Math.abs(Number(l.monto ?? 0) - 8870.44) < 0.01);
  chk('COTO DIGITAL CRED viene con montoFirmado = −8.870,44',
      !!coto && Math.abs(Number(coto.montoFirmado) + 8870.44) < 0.01,
      coto ? `montoFirmado=${s(coto.montoFirmado)} seccion="${s(coto.seccion)}"` : 'no aparece');
  console.log('  secciones distintas: ' +
    JSON.stringify([...new Set(crudas.map(l => s(l.seccion)))]));

  // ── §5.2 — el guard, sobre esta misma extracción ────────────────────────────
  console.log('\n--- §5.2: el guard del signo sobre la extracción real ---');
  const g = guard.corregirSignoConsumos(crudas);
  console.log(`  correcciones: ${g.correcciones.length}`);
  for (const c of g.correcciones) console.log(`       ${JSON.stringify(c)}`);
  const seg = g.lineas.find(l => /CAJA SEG/i.test(s(l.descripcionRaw)))!;
  const cotoOut = g.lineas.find(l => /COTO DIGITAL.*CRED/i.test(s(l.descripcionRaw)) &&
    Math.abs(Number(l.monto ?? 0) - 8870.44) < 0.01)!;
  chk('CAJA SEG-PROMO termina en consumo', s(seg.tipoLinea) === 'consumo', `tipoLinea=${s(seg.tipoLinea)}`);
  chk('COTO DIGITAL CRED (−8.870,44) NO lo toca el guard',
      !g.correcciones.some(c => /COTO/i.test(s(c.descripcionRaw))),
      `tipoLinea=${s(cotoOut.tipoLinea)}`);

  // ── §5.4 (cuadre) y §5.5/§5.6 (noDebitado) ──────────────────────────────────
  console.log('\n--- §5.6 no regresión: sin nada marcado, cuadra contra totalARS como siempre ---');
  // El spread de un Record<string, unknown> descarta el index signature: se repone a mano.
  const lineas: Array<Record<string, unknown>> = g.lineas.map(l => ({ ...l, incluir: true }));
  const aj = (cab.ajustesConsolidado ?? []) as unknown[];
  const c0 = motor.calcularCuadre(lineas, Number(cab.totalARS), Number(cab.totalUSD), aj);
  console.log(`  sumaARS=${c0.sumaARS.toFixed(2)} objetivoARS=${c0.objetivoARS.toFixed(2)} diffARS=${c0.diffARS.toFixed(2)} balanceARS=${c0.balanceARS}`);
  chk('objetivoARS === totalARS cuando no hay nada marcado',
      Math.abs(c0.objetivoARS - Number(cab.totalARS)) < 0.01);
  chk('noDebitadoARS = 0', c0.noDebitadoARS === 0);
  chk('cuadra: diffARS = 0', c0.diffARS < 0.01, `diffARS=${c0.diffARS.toFixed(2)}`);
  chk('cuadra USD: diffUSD = 0', c0.diffUSD < 0.01, `diffUSD=${c0.diffUSD.toFixed(2)}`);

  console.log('\n--- §5.5: marcar DB.RG 5617 30% (33.406,41) como noDebitado ---');
  const idxDb = lineas.findIndex(l => /DB\.RG 5617/i.test(s(l.descripcionRaw)));
  chk('la línea DB.RG 5617 30% existe', idxDb >= 0,
      idxDb >= 0 ? `monto=${s(lineas[idxDb].monto)}` : '');
  const marcadas = lineas.map((l, i) => i === idxDb ? { ...l, noDebitado: true } : l);
  const c1 = motor.calcularCuadre(marcadas, Number(cab.totalARS), Number(cab.totalUSD), aj);
  console.log(`  total PDF = ${Number(cab.totalARS).toFixed(2)}`);
  console.log(`  no debitado = ${c1.noDebitadoARS.toFixed(2)}`);
  console.log(`  objetivo neto = ${c1.objetivoARS.toFixed(2)}`);
  console.log(`  sumaARS = ${c1.sumaARS.toFixed(2)} | diffARS = ${c1.diffARS.toFixed(2)} | balanceARS = ${c1.balanceARS}`);
  chk('el objetivo baja a 1.370.414,69', Math.abs(c1.objetivoARS - 1370414.69) < 0.01,
      `objetivoARS=${c1.objetivoARS.toFixed(2)}`);
  chk('el cuadre sigue en cero contra el neto', c1.diffARS < 0.01 && c1.balanceARS,
      `diffARS=${c1.diffARS.toFixed(2)}`);
  // La otra punta: el movimiento-total sale por `Math.max(objetivoARS, 0)` (resumenesTarjeta.ts).
  const netos = motor.totalesNetos(marcadas, Number(cab.totalARS), Number(cab.totalUSD));
  const movTotal = Math.max(netos.objetivoARS, 0);
  chk('el movimiento-total sale por ese MISMO número', Math.abs(movTotal - 1370414.69) < 0.01,
      `movimiento-total = ${movTotal.toFixed(2)}`);

  console.log(`\n${fail === 0 ? 'TODO OK' : 'HAY FALLAS'} — ${ok} ok, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
