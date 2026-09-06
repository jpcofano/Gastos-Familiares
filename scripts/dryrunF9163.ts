// F9.163 §5.1 + §4 — extracción REAL contra la API con el prompt de F9.163, y dry run de los
// cuatro. Prompt, guard y motor se EXTRAEN del fuente. NO ESCRIBE NADA.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';

const req = createRequire(process.cwd() + '/functions/package.json');
const Anthropic = req('@anthropic-ai/sdk').default ?? req('@anthropic-ai/sdk');
const pdfParse = req('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;
const ts = req('typescript') as typeof import('typescript');

if (getApps().length === 0) initializeApp({
  credential: cert('./secrets/serviceAccountKey.json'),
  storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
});
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const f2 = (v: number) => v.toFixed(2).padStart(14);
let ok = 0, fail = 0;
const chk = (rot: string, cond: boolean, det = '') => {
  if (cond) { ok++; console.log(`  OK   ${rot}${det ? ' — ' + det : ''}`); }
  else { fail++; console.log(`  FAIL ${rot}${det ? ' — ' + det : ''}`); }
};

function aJs(c: string) {
  return ts.transpileModule(c, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
}
const srcFn = fs.readFileSync('functions/src/index.ts', 'utf8').replace(/\r\n/g, '\n');
const bl = (src: string, d: string, h: string) => { const i = src.indexOf(d); return src.slice(i, src.indexOf(h, i) + h.length); };
const buildPrompt = new Function(`${aJs([
  bl(srcFn, 'const PERSONAS_CANONICAS =', '`;'),
  bl(srcFn, 'function buildResumenTarjetaPrompt', '`;\n}'),
].join('\n'))}\nreturn buildResumenTarjetaPrompt;`)() as (b: string, t: string) => string;
const sanitizarJson = new Function(`${aJs(bl(srcFn, 'function sanitizarJson', '\n}'))}\nreturn sanitizarJson;`)() as (r: string) => string;

const srcGuard = fs.readFileSync('functions/src/signoLineas.ts', 'utf8').replace(/\r\n/g, '\n');
const guard = new Function(`${aJs(srcGuard.replace(/export /g, ''))}\nreturn { corregirSignoConsumos };`)() as
  { corregirSignoConsumos: (l: any[]) => { lineas: any[]; correcciones: any[] } };

const srcDatos = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
const srcRegla = fs.readFileSync('src/datos/ajusteConsolidado.ts', 'utf8').replace(/\r\n/g, '\n');
const tz = (d: string, h: string) => { const i = srcDatos.indexOf(d); return srcDatos.slice(i, srcDatos.indexOf(h, i) + h.length); };
const motor = new Function(`${aJs([
  srcRegla.replace(/^import .*$/gm, '').replace(/export /g, ''),
  tz('function tipoDeLinea', '\n}'),
  tz('export function totalesNetos', '\n}').replace('export ', ''),
  tz('export function calcularCuadre', '\n}').replace('export ', ''),
].join('\n'))}\nreturn { calcularCuadre };`)() as {
  calcularCuadre: (l: any[], a: number, u: number, aj?: any[], cons?: any) => {
    sumaARS: number; diffARS: number; balanceARS: boolean; diffUSD: number; balanceUSD: boolean;
    decisionAjustes: { decision: string; motivo: string; a: number | null; b: number | null } };
};

function leerSecreto(): string | null {
  try {
    return execSync('npx firebase functions:secrets:access ANTHROPIC_API_KEY',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}
const numAr = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'));
function subtotalesDelPdf(texto: string) {
  const out: Array<{ rotulo: string; monto: number }> = [];
  const re = /(TOTAL\s+(?:DE\s+)?CONSUMOS?\s+(?:DE\s+)?[^\d\n]{0,40}?)\s+(-?[\d.]+,\d{2})/gi;
  let m: RegExpExecArray | null; const vistos = new Set<string>();
  while ((m = re.exec(texto)) !== null) {
    const k = `${m[1].replace(/\s+/g, ' ').trim()}|${m[2]}`;
    if (vistos.has(k)) continue; vistos.add(k);
    out.push({ rotulo: m[1].replace(/\s+/g, ' ').trim(), monto: numAr(m[2]) });
  }
  return out;
}
const norm = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
function porSeccion(lineas: any[]) {
  const map = new Map<string, number>();
  for (const l of lineas) {
    if (Number(l.monto ?? 0) <= 0 || l.moneda !== 'ARS') continue;
    const k = norm(s(l.seccion));
    const ing = ['reintegro_percepcion', 'bonificacion', 'reverso'].includes(s(l.tipoLinea));
    map.set(k, (map.get(k) ?? 0) + (ing ? -1 : 1) * Number(l.monto ?? 0));
  }
  return map;
}

const IDS = process.argv.slice(2).filter(a => !a.startsWith('-'));
const FOCO = IDS.length ? IDS : ['08a697e0', 'b553ddf1', 'f3e9e4f3', '5d948f9a', 'c7222865'];

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? leerSecreto();
  if (!apiKey) { console.log('>>> SALTEADO: sin ANTHROPIC_API_KEY'); return; }
  const client = new Anthropic({ apiKey });
  const resus = await db.collection('resumenesTarjeta').get();
  console.log('F9.163 §5.1 + §4 — DRY RUN. Extracción real con el prompt nuevo. NO SE ESCRIBE NADA.\n');

  for (const pref of FOCO) {
    const d = resus.docs.find(x => x.id.startsWith(pref));
    if (!d) { console.log(`>>> ${pref}: no está`); continue; }
    const x = d.data();
    const viejas = (x.movimientosParseados ?? []) as any[];
    const manuales = ((x.ajustesConsolidado ?? []) as any[]).filter(a => a.origen === 'manual');

    console.log('═'.repeat(104));
    console.log(`${d.id.slice(0, 8)} | ${s(x.periodo)} | ${s(x.banco)}/${s(x.tarjeta)} | totalARS=${s(x.totalARS)}`);

    const [buf] = await getStorage().bucket().file(s(x.refStoragePdf)).download();
    const texto = (await pdfParse(buf as Buffer)).text;

    const resp = await client.messages.stream({
      model: 'claude-sonnet-4-6', max_tokens: 32000,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: (buf as Buffer).toString('base64') } },
        { type: 'text', text: buildPrompt(s(x.banco), s(x.tarjeta)) },
      ] }],
    }).finalMessage();
    const raw = (resp.content as any[]).filter(b => b.type === 'text').map(b => b.text).join('');
    const m = raw.match(/```json\s*([\s\S]*?)\s*```/) ?? raw.match(/(\{[\s\S]*\})/);
    if (!m) { console.log('  >>> no parseó JSON'); fail++; continue; }
    let p: any;
    try { p = JSON.parse(sanitizarJson(m[1])); }
    catch (e) { console.log(`  >>> JSON inválido: ${(e as Error).message.slice(0, 120)}`); fail++; continue; }
    const cab = p.resumen ?? {};
    const g = guard.corregirSignoConsumos((p.movimientos ?? []) as any[]);
    const nuevas = g.lineas.map(l => ({ ...l, incluir: true }));
    const ajNuevos = (cab.ajustesConsolidado ?? []) as any[];

    // ── §5.1 — los cuatro campos nuevos ──────────────────────────────────────
    console.log(`  saldoAnteriorARS   = ${s(cab.saldoAnteriorARS)}`);
    console.log(`  saldoAnteriorUSD   = ${s(cab.saldoAnteriorUSD)}`);
    console.log(`  pagosDelPeriodoARS = ${s(cab.pagosDelPeriodoARS)}`);
    console.log(`  pagosDelPeriodoUSD = ${s(cab.pagosDelPeriodoUSD)}`);
    if (pref === '08a697e0') {
      chk('08a697e0 — saldoAnteriorARS = 4.313.337,28',
          Math.abs(Number(cab.saldoAnteriorARS) - 4313337.28) < 0.01, s(cab.saldoAnteriorARS));
      chk('08a697e0 — pagosDelPeriodoARS = −4.313.337,28',
          Math.abs(Number(cab.pagosDelPeriodoARS) + 4313337.28) < 0.01, s(cab.pagosDelPeriodoARS));
      chk('08a697e0 — totalARS no cambió', Math.abs(Number(cab.totalARS) - Number(x.totalARS)) < 0.01,
          `${s(cab.totalARS)} vs ${s(x.totalARS)}`);
      chk('08a697e0 — sigue emitiendo las 90 líneas', nuevas.length === 90, `${nuevas.length} líneas`);
    }

    // ── §4 — el cuadre con la regla ──────────────────────────────────────────
    const cSin = motor.calcularCuadre(nuevas, Number(cab.totalARS), Number(cab.totalUSD), ajNuevos);
    const cCon = motor.calcularCuadre(nuevas, Number(cab.totalARS), Number(cab.totalUSD), ajNuevos, cab);
    console.log(`  ajustesConsolidado extraídos: ${JSON.stringify(ajNuevos)}`);
    console.log(`  guard del signo: ${g.correcciones.length} corrección(es)`);
    console.log(`  SIN la regla:  sumaARS=${f2(cSin.sumaARS)} diffARS=${f2(cSin.diffARS)} balance=${cSin.balanceARS}`);
    console.log(`  CON la regla:  sumaARS=${f2(cCon.sumaARS)} diffARS=${f2(cCon.diffARS)} balance=${cCon.balanceARS}`);
    console.log(`  decisión: ${cCon.decisionAjustes.decision} — ${cCon.decisionAjustes.motivo} (A=${cCon.decisionAjustes.a?.toFixed(2)} B=${cCon.decisionAjustes.b?.toFixed(2)})`);
    chk(`${pref} — cuadra con la regla y SIN ningún ajuste manual`, cCon.diffARS < 1 && cCon.balanceARS,
        `diffARS=${cCon.diffARS.toFixed(2)}`);
    chk(`${pref} — el USD también cuadra`, cCon.diffUSD < 1 && cCon.balanceUSD, `diffUSD=${cCon.diffUSD.toFixed(2)}`);

    // qué líneas cambian respecto de lo guardado
    const clave = (l: any) => `${norm(s(l.descripcionRaw)).trim()}|${Number(l.monto ?? 0).toFixed(2)}|${s(l.moneda)}`;
    const mv = new Map(viejas.map(l => [clave(l), l])), mn = new Map(nuevas.map(l => [clave(l), l]));
    const soloV = [...mv.keys()].filter(k => !mn.has(k));
    const soloN = [...mn.keys()].filter(k => !mv.has(k));
    const tipoDist = [...mv.keys()].filter(k => mn.has(k) && s(mv.get(k).tipoLinea) !== s(mn.get(k).tipoLinea));
    console.log(`  líneas: ${viejas.length} → ${nuevas.length} | desaparecen ${soloV.length} | aparecen ${soloN.length} | cambian de tipoLinea ${tipoDist.length}`);
    for (const k of tipoDist) console.log(`      ${k}: ${s(mv.get(k).tipoLinea)} → ${s(mn.get(k).tipoLinea)}`);
    for (const k of soloV.slice(0, 6)) console.log(`      DESAPARECE ${k} [${s(mv.get(k).tipoLinea)}]`);
    for (const k of soloN.slice(0, 6)) console.log(`      APARECE    ${k} [${s(mn.get(k).tipoLinea)}] sec="${s(mn.get(k).seccion)}"`);

    // subtotales por sección contra el PDF
    console.log('  subtotales por sección (nueva) vs los impresos en el PDF:');
    const imp = subtotalesDelPdf(texto);
    for (const [k, v] of [...porSeccion(nuevas)].sort()) {
      const t = imp.find(z => norm(z.rotulo).includes(k) || k.includes(norm(z.rotulo).replace(/^TOTAL (DE )?CONSUMOS (DE )?/, '')));
      const marca = t ? (Math.abs(t.monto - v) < 0.01 ? 'OK ' : '>>> NO') : '   ';
      console.log(`      ${marca} ${k.padEnd(40).slice(0, 40)} ${f2(v)}${t ? ` | PDF=${f2(t.monto)} Δ=${(v - t.monto).toFixed(2)}` : ' | (sin subtotal impreso)'}`);
    }
    if (manuales.length)
      console.log(`  ajustes MANUALES que hoy tiene (no se borran, quedan como registro): ${JSON.stringify(manuales.map(a => ({ montoARS: a.montoARS, concepto: a.concepto })))}`);
    console.log();
  }
  console.log(`${fail === 0 ? 'TODO OK' : 'HAY FALLAS'} — ${ok} ok, ${fail} fail`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
