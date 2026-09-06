// F9.161 §3 — DRY RUN. Re-extrae los 4 resúmenes descuadrados con el prompt nuevo y compara
// contra la extracción vieja y contra los subtotales que IMPRIME el PDF (sacados con pdf-parse,
// no a ojo). NO ESCRIBE NADA.
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
const n2 = (v: number) => v.toFixed(2).padStart(14);

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
const tz = (d: string, h: string) => { const i = srcDatos.indexOf(d); return srcDatos.slice(i, srcDatos.indexOf(h, i) + h.length); };
const motor = new Function(`${aJs([
  tz('function tipoDeLinea', '\n}'),
  tz('export function totalesNetos', '\n}').replace('export ', ''),
  tz('export function calcularCuadre', '\n}').replace('export ', ''),
].join('\n'))}\nreturn { calcularCuadre };`)() as {
  calcularCuadre: (l: any[], a: number, u: number, aj?: any[]) => {
    sumaARS: number; diffARS: number; balanceARS: boolean; sumaUSD: number; diffUSD: number };
};

function leerSecreto(): string | null {
  try {
    return execSync('npx firebase functions:secrets:access ANTHROPIC_API_KEY',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

const numAr = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'));

/** Los subtotales que IMPRIME el PDF: "TOTAL CONSUMOS DE X  1.336.897,92". */
function subtotalesDelPdf(texto: string): Array<{ rotulo: string; monto: number }> {
  const out: Array<{ rotulo: string; monto: number }> = [];
  const re = /(TOTAL\s+(?:DE\s+)?CONSUMOS?\s+(?:DE\s+)?[^\d\n]{0,40}?|TOTAL\s+ADICIONAL\s+DE\s+[^\d\n]{0,40}?)\s+(-?[\d.]+,\d{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    out.push({ rotulo: m[1].replace(/\s+/g, ' ').trim(), monto: numAr(m[2]) });
  }
  return out;
}

const norm = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

function porSeccionOPersona(lineas: any[], clave: 'seccion' | 'personaDetectada') {
  const map = new Map<string, number>();
  for (const l of lineas) {
    if (Number(l.monto ?? 0) <= 0 || l.moneda !== 'ARS') continue;
    const k = norm(s(l[clave])).trim() || '(sin)';
    const ingreso = ['reintegro_percepcion', 'bonificacion', 'reverso'].includes(s(l.tipoLinea));
    map.set(k, (map.get(k) ?? 0) + (ingreso ? -1 : 1) * Number(l.monto ?? 0));
  }
  return map;
}

const IDS = process.argv.slice(2).filter(a => !a.startsWith('-')).length
  ? process.argv.slice(2).filter(a => !a.startsWith('-'))
  : ['b553ddf1', 'f3e9e4f3', '5d948f9a', 'c7222865'];

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? leerSecreto();
  if (!apiKey) { console.log('>>> SALTEADO: sin ANTHROPIC_API_KEY'); return; }
  const client = new Anthropic({ apiKey });
  const resus = await db.collection('resumenesTarjeta').get();

  console.log('F9.161 §3 — DRY RUN. Re-extracción con el prompt nuevo. NO SE ESCRIBE NADA.\n');

  for (const pref of IDS) {
    const d = resus.docs.find(x => x.id.startsWith(pref));
    if (!d) { console.log(`>>> ${pref}: no está`); continue; }
    const x = d.data();
    const viejas = (x.movimientosParseados ?? []) as any[];
    const ajTodos = (x.ajustesConsolidado ?? []) as any[];
    const ajPdf = ajTodos.filter(a => a.origen !== 'manual');
    const manuales = ajTodos.filter(a => a.origen === 'manual');

    console.log('═'.repeat(100));
    console.log(`${d.id.slice(0, 8)} | ${s(x.periodo)} | ${s(x.banco)}/${s(x.tarjeta)} | totalARS=${s(x.totalARS)} totalUSD=${s(x.totalUSD)}`);
    for (const a of manuales) console.log(`  ajuste manual que hay hoy: ${a.montoARS} — "${a.concepto}"`);

    const cVieja = motor.calcularCuadre(viejas, Number(x.totalARS), Number(x.totalUSD), ajPdf);
    console.log(`  VIEJA (sin el ajuste manual): sumaARS=${n2(cVieja.sumaARS)} diffARS=${n2(cVieja.diffARS)} | ${viejas.length} líneas`);

    const [buf] = await getStorage().bucket().file(s(x.refStoragePdf)).download();
    const texto = (await pdfParse(buf as Buffer)).text;

    const resp = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 32000,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: (buf as Buffer).toString('base64') } },
        { type: 'text', text: buildPrompt(s(x.banco), s(x.tarjeta)) },
      ] }],
    }).finalMessage();
    const raw = (resp.content as any[]).filter(b => b.type === 'text').map(b => b.text).join('');
    const m = raw.match(/```json\s*([\s\S]*?)\s*```/) ?? raw.match(/(\{[\s\S]*\})/);
    if (!m) { console.log('  >>> no parseó JSON'); continue; }
    let p: any;
    try { p = JSON.parse(sanitizarJson(m[1])); }
    catch (e) { console.log(`  >>> JSON inválido: ${(e as Error).message.slice(0, 120)}`); continue; }
    const cab = p.resumen ?? {};
    const g = guard.corregirSignoConsumos((p.movimientos ?? []) as any[]);
    const nuevas = g.lineas.map(l => ({ ...l, incluir: true }));
    const ajNuevos = (cab.ajustesConsolidado ?? []) as any[];

    const cNueva = motor.calcularCuadre(nuevas, Number(cab.totalARS), Number(cab.totalUSD), ajNuevos);
    console.log(`  NUEVA:                        sumaARS=${n2(cNueva.sumaARS)} diffARS=${n2(cNueva.diffARS)} | ${nuevas.length} líneas | totalARS=${s(cab.totalARS)}`);
    console.log(`  guard: ${g.correcciones.length} corrección(es)${g.correcciones.length ? ' → ' + JSON.stringify(g.correcciones) : ''}`);
    console.log(`  ajustesConsolidado nuevos: ${JSON.stringify(ajNuevos)}`);
    console.log(`  USD: viejo diffUSD=${cVieja.diffUSD.toFixed(2)} | nuevo diffUSD=${cNueva.diffUSD.toFixed(2)} (totalUSD=${s(cab.totalUSD)})`);

    // ── qué líneas cambiaron ────────────────────────────────────────────────
    const clave = (l: any) => `${norm(s(l.descripcionRaw)).trim()}|${Number(l.monto ?? 0).toFixed(2)}|${s(l.moneda)}`;
    const mapV = new Map<string, any>(); for (const l of viejas) mapV.set(clave(l), l);
    const mapN = new Map<string, any>(); for (const l of nuevas) mapN.set(clave(l), l);
    const soloV = [...mapV.keys()].filter(k => !mapN.has(k));
    const soloN = [...mapN.keys()].filter(k => !mapV.has(k));
    const tipoDistinto = [...mapV.keys()].filter(k => mapN.has(k) && s(mapV.get(k).tipoLinea) !== s(mapN.get(k).tipoLinea));
    console.log(`  DESAPARECEN (${soloV.length}):`);
    for (const k of soloV.slice(0, 12)) console.log(`      ${k} [${s(mapV.get(k).tipoLinea)}]`);
    if (soloV.length > 12) console.log(`      … y ${soloV.length - 12} más`);
    console.log(`  APARECEN (${soloN.length}):`);
    for (const k of soloN.slice(0, 12)) console.log(`      ${k} [${s(mapN.get(k).tipoLinea)}] sec="${s(mapN.get(k).seccion)}" firmado=${s(mapN.get(k).montoFirmado)}`);
    if (soloN.length > 12) console.log(`      … y ${soloN.length - 12} más`);
    console.log(`  CAMBIAN DE tipoLinea (${tipoDistinto.length}):`);
    for (const k of tipoDistinto) console.log(`      ${k}: ${s(mapV.get(k).tipoLinea)} → ${s(mapN.get(k).tipoLinea)} (firmado=${s(mapN.get(k).montoFirmado)})`);

    // ── subtotales: parseado nuevo vs los que imprime el PDF ─────────────────
    console.log('  SUBTOTALES parseados (nueva extracción, por sección):');
    for (const [k, v] of [...porSeccionOPersona(nuevas, 'seccion')].sort()) console.log(`      ${k.padEnd(42).slice(0, 42)} ${n2(v)}`);
    const impresos = subtotalesDelPdf(texto);
    console.log(`  SUBTOTALES que IMPRIME el PDF (${impresos.length}):`);
    for (const t of impresos) console.log(`      ${t.rotulo.padEnd(42).slice(0, 42)} ${n2(t.monto)}`);
    console.log('  SUBTOTALES parseados por persona (para cruzar con los impresos):');
    for (const [k, v] of [...porSeccionOPersona(nuevas, 'personaDetectada')].sort()) console.log(`      ${k.padEnd(42).slice(0, 42)} ${n2(v)}`);
    console.log();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
