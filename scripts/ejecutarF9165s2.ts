// F9.165 §2 — RE-EXTRACCIÓN de los cuatro resúmenes. ESCRIBE EN PRODUCCIÓN con --apply.
// Sin --apply es dry run y no toca nada.
//
// Qué escribe, y qué NO:
//   escribe : movimientosParseados, ajustesConsolidado (solo los de PDF), saldoAnterior*,
//             pagosDelPeriodo*, ajustesManualesPrevios (archivo), actualizadoEn, reextraidoEn
//   NO toca : estado, confirmadoEn, tarjetaCodigo, banco, tarjeta, periodo, fechas, hashPdf,
//             refStoragePdf, ni NINGÚN movimiento ya generado.
//
// Los ajustes `origen: 'manual'` NO se borran: se mueven a `ajustesManualesPrevios`. Si se
// dejaran en `ajustesConsolidado` el cuadre no daría cero, y no hay control en la UI para sacar
// un ajuste manual — los cuatro quedarían descuadrados sin salida.
//
// Dos guardas que ABORTAN el resumen (no escriben) si no se cumplen:
//   · el totalARS/totalUSD de la extracción nueva tiene que ser IDÉNTICO al guardado;
//   · el cuadre con la regla de F9.163 tiene que dar diffARS y diffUSD ≈ 0.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
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
const f2 = (v: number) => v.toFixed(2).padStart(14);
const APPLY = process.argv.includes('--apply');

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
const TIPOLINEA_VALIDOS = new Set(['consumo', 'cuota', 'impuesto', 'reintegro_percepcion', 'bonificacion', 'reverso']);

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
    decisionAjustes: { decision: string; motivo: string } };
};

function leerSecreto(): string | null {
  try {
    return execSync('npx firebase functions:secrets:access ANTHROPIC_API_KEY',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

/** Mismo mapeo que `procesarResumenTarjeta` (functions/src/index.ts). */
function mapearLineas(brutas: any[]) {
  return brutas.map((m, i) => ({
    seq: typeof m.seq === 'number' ? m.seq : i + 1,
    tipoLinea: TIPOLINEA_VALIDOS.has(m.tipoLinea ?? '') ? m.tipoLinea : 'consumo',
    fechaConsumo: m.fechaConsumo ?? null,
    descripcionRaw: m.descripcionRaw ?? '',
    nroCupon: m.nroCupon ?? '',
    cuotaActual: m.cuotaActual ?? 1,
    cuotaTotal: m.cuotaTotal ?? 1,
    moneda: m.moneda === 'USD' ? 'USD' : 'ARS',
    monto: Math.abs(m.monto ?? 0),
    montoFirmado: typeof m.montoFirmado === 'number' ? m.montoFirmado : null,
    seccion: m.seccion ?? null,
    noDebitado: false,
    personaDetectada: m.personaDetectada ?? '',
    esBonificacion: m.esBonificacion ?? false,
    esReverso: m.esReverso ?? false,
    esImpuesto: m.esImpuesto ?? false,
    personaConfirmada: null,
    categoria: null,
    subcategoria: null,
    incluir: true,
  }));
}
const numeroONull = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;

const IDS = ['b553ddf1', 'f3e9e4f3', '5d948f9a', 'c7222865'];

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? leerSecreto();
  if (!apiKey) { console.log('>>> sin ANTHROPIC_API_KEY'); process.exit(1); }
  const client = new Anthropic({ apiKey });
  const resus = await db.collection('resumenesTarjeta').get();

  console.log(`F9.165 §2 — re-extracción de los cuatro. ${APPLY ? '*** APLICANDO (ESCRIBE) ***' : 'DRY RUN (no escribe)'}\n`);
  let aplicados = 0, abortados = 0;

  for (const pref of IDS) {
    const d = resus.docs.find(x => x.id.startsWith(pref))!;
    const x = d.data();
    const manuales = ((x.ajustesConsolidado ?? []) as any[]).filter(a => a.origen === 'manual');
    console.log('═'.repeat(104));
    console.log(`${pref} | ${s(x.periodo)} | ${s(x.banco)}/${s(x.tarjeta)} | estado=${s(x.estado)} | ${(x.movimientosParseados ?? []).length} líneas`);

    const [buf] = await getStorage().bucket().file(s(x.refStoragePdf)).download();
    const resp = await client.messages.stream({
      model: 'claude-sonnet-4-6', max_tokens: 32000,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: (buf as Buffer).toString('base64') } },
        { type: 'text', text: buildPrompt(s(x.banco), s(x.tarjeta)) },
      ] }],
    }).finalMessage();
    const raw = (resp.content as any[]).filter(b => b.type === 'text').map(b => b.text).join('');
    const m = raw.match(/```json\s*([\s\S]*?)\s*```/) ?? raw.match(/(\{[\s\S]*\})/);
    if (!m) { console.log('  >>> ABORTA: no parseó JSON'); abortados++; continue; }
    let p: any;
    try { p = JSON.parse(sanitizarJson(m[1])); }
    catch (e) { console.log(`  >>> ABORTA: JSON inválido — ${(e as Error).message.slice(0, 100)}`); abortados++; continue; }

    const cab = p.resumen ?? {};
    const g = guard.corregirSignoConsumos(mapearLineas((p.movimientos ?? []) as any[]));
    const lineas = g.lineas;
    const ajPdf = ((cab.ajustesConsolidado ?? []) as any[]).map(a => ({ ...a, origen: 'pdf' }));
    const cons = {
      saldoAnteriorARS: numeroONull(cab.saldoAnteriorARS), saldoAnteriorUSD: numeroONull(cab.saldoAnteriorUSD),
      pagosDelPeriodoARS: numeroONull(cab.pagosDelPeriodoARS), pagosDelPeriodoUSD: numeroONull(cab.pagosDelPeriodoUSD),
    };

    // ── guarda 1: el total no puede haber cambiado ───────────────────────────
    const tARS = Number(cab.totalARS ?? NaN), tUSD = Number(cab.totalUSD ?? NaN);
    if (Math.abs(tARS - Number(x.totalARS)) > 0.01 || Math.abs(tUSD - Number(x.totalUSD)) > 0.01) {
      console.log(`  >>> ABORTA: el total cambió — ARS ${s(x.totalARS)} → ${tARS} | USD ${s(x.totalUSD)} → ${tUSD}`);
      abortados++; continue;
    }
    // ── guarda 2: tiene que cuadrar con la regla ─────────────────────────────
    const c = motor.calcularCuadre(lineas, tARS, tUSD, ajPdf, cons);
    console.log(`  líneas ${(x.movimientosParseados ?? []).length} → ${lineas.length} | guard del signo: ${g.correcciones.length}`);
    console.log(`  saldoAnteriorARS=${s(cons.saldoAnteriorARS)} pagosDelPeriodoARS=${s(cons.pagosDelPeriodoARS)}`);
    console.log(`  ajustesConsolidado (pdf): ${JSON.stringify(ajPdf.map(a => [a.concepto, a.montoARS]))}`);
    console.log(`  cuadre: sumaARS=${f2(c.sumaARS)} diffARS=${f2(c.diffARS)} diffUSD=${f2(c.diffUSD)} | decisión=${c.decisionAjustes.decision}`);
    if (!(c.diffARS < 1 && c.diffUSD < 1 && c.balanceARS && c.balanceUSD)) {
      console.log('  >>> ABORTA: no cuadra. No se escribe nada de este resumen.');
      abortados++; continue;
    }
    console.log(`  ajustes MANUALES que se archivan (no se borran): ${JSON.stringify(manuales.map(a => a.montoARS))}`);

    if (!APPLY) { console.log('  (dry run — no se escribe)'); continue; }
    await d.ref.update({
      movimientosParseados: lineas,
      ajustesConsolidado: ajPdf,
      ajustesManualesPrevios: manuales.map(a => ({ ...a, archivadoEn: new Date().toISOString(), archivadoPor: 'F9.165 §2' })),
      saldoAnteriorARS: cons.saldoAnteriorARS, saldoAnteriorUSD: cons.saldoAnteriorUSD,
      pagosDelPeriodoARS: cons.pagosDelPeriodoARS, pagosDelPeriodoUSD: cons.pagosDelPeriodoUSD,
      reextraidoEn: FieldValue.serverTimestamp(),
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    aplicados++;
    console.log('  ESCRITO.');
  }

  console.log('\n' + '═'.repeat(104));
  console.log(`${APPLY ? 'aplicados' : 'listos para aplicar'}: ${aplicados || IDS.length - abortados} | abortados: ${abortados}`);
  if (APPLY) console.log('\nNO se tocó ningún movimiento ya generado ni el estado de los resúmenes.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
