// F9.181 — verificación del formato compacto. Llama a la API; NO ESCRIBE en Firestore ni en Storage.
//
//   npx tsx scripts/probarF9181.ts                 → el PDF que falló + no regresión (2 resúmenes)
//   npx tsx scripts/probarF9181.ts 37ab6ea1 ...    → solo esos ids
//
// Usa el buildResumenTarjetaPrompt, parsearRespuestaResumen y armarMovimientosCrudos REALES del árbol
// de trabajo (functions/src/index.ts, transpilados en memoria: index.ts no se puede importar sin
// levantar firebase-functions), el corregirSignoConsumos real y el calcularCuadre del cliente.
//
// 1. el que falló: stop_reason, output_tokens, líneas y cuadre (arrastre incluido) en las dos monedas
// 2. no regresión: contra los movimientosParseados guardados — cantidad, montos, tipoLinea y
//    montoFirmado por línea (apareando por fecha + moneda + monto), y los totales del encabezado
// 3. tokens por línea, medidos (output_tokens de la respuesta real)
//
// Privacidad: ids a 8 caracteres, descripciones recortadas.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { corregirSignoConsumos } from '../functions/src/signoLineas';
import { crearSim } from './simConfirmarResumen';
import type { MovimientoParseado } from '../src/types';
import type { CuadreResult } from '../src/datos/resumenesTarjeta';

const req = createRequire(process.cwd() + '/functions/package.json');
const Anthropic = req('@anthropic-ai/sdk').default ?? req('@anthropic-ai/sdk');
const ts = req('typescript') as typeof import('typescript');

process.env.TZ = 'America/Argentina/Buenos_Aires';
if (getApps().length === 0) initializeApp({
  credential: cert('./secrets/serviceAccountKey.json'),
  storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
});
const db = getFirestore();
const sim = crearSim(db);
const TOL = { ARS: 1, USD: 0.01 } as const;

// ── las piezas reales de functions/src/index.ts ──────────────────────────────
const aJs = (c: string) =>
  ts.transpileModule(c, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
const srcFn = fs.readFileSync('functions/src/index.ts', 'utf8').replace(/\r\n/g, '\n');
const bl = (d: string, h: string) => {
  const i = srcFn.indexOf(d);
  if (i < 0) throw new Error(`no está en index.ts: ${d}`);
  return srcFn.slice(i, srcFn.indexOf(h, i) + h.length);
};
const fn = new Function(`${aJs([
  bl('const PERSONAS_CANONICAS =', '`;'),
  bl('function buildResumenTarjetaPrompt', '`;\n}'),
  bl('type MovimientoRaw = {', '\n};'),
  bl('function sanitizarJson', '\n}'),
  bl('const TIPOLINEA_VALIDOS =', ']);'),
  bl('function parsearRespuestaResumen', '\n}'),
  bl('function armarMovimientosCrudos', '\n}'),
].join('\n'))}\nreturn { buildResumenTarjetaPrompt, parsearRespuestaResumen, armarMovimientosCrudos };`)() as {
  buildResumenTarjetaPrompt: (b: string, t: string) => string;
  parsearRespuestaResumen: (raw: string) => { resumen: Record<string, unknown>; movimientos: unknown[] };
  armarMovimientosCrudos: (m: unknown[]) => Array<Record<string, unknown>>;
};

type RTMod = {
  calcularCuadre: (l: MovimientoParseado[], tARS: number, tUSD: number, aj: unknown[], c?: unknown) => CuadreResult;
};
const RT = sim.cargar<RTMod>('src/datos/resumenesTarjeta.ts');

// ── salida ────────────────────────────────────────────────────────────────────
const h8 = (v: unknown) => (v ? String(v).slice(0, 8) : '-');
const s = (v: unknown) => (v === null ? 'null' : v === undefined ? '(ausente)' : String(v));
const corto = (v: unknown, n = 18) => { const t = String(v ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const ok = (c: boolean) => (c ? 'OK' : '✗');

function leerSecreto(): string | null {
  try {
    return execSync('npx firebase functions:secrets:access ANTHROPIC_API_KEY',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

const FALLADO = '37ab6ea1';
// El confirmado más largo (GAL-VISA 2026-06, 148) es migrado y no tiene PDF en Storage: no se puede
// re-extraer. Se usa el más largo CON PDF (BBVA Visa, 139) y, de Galicia, el más reciente (2026-10),
// que trae seccion y montoFirmado y por eso se puede comparar línea por línea.
const NO_REGRESION = ['b553ddf1', '2a0f81f8'];
const IDS = process.argv.slice(2).filter(a => !a.startsWith('-')).length
  ? process.argv.slice(2).filter(a => !a.startsWith('-'))
  : [FALLADO, ...NO_REGRESION];

type Linea = Record<string, unknown>;

async function extraer(client: InstanceType<typeof Anthropic>, pdf: Buffer, banco: string, tarjeta: string) {
  const t0 = Date.now();
  const resp = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 64000,  // holgado a propósito: medir lo que el formato nuevo necesita, no cortarlo
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
      { type: 'text', text: fn.buildResumenTarjetaPrompt(banco, tarjeta) },
    ] }],
  }).finalMessage();
  const seg = (Date.now() - t0) / 1000;
  const raw = (resp.content as Array<{ type: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text).join('');
  return { resp, seg, raw };
}

/** Residuo del cuadre por sección: lo que suma cada `seccion` con el signo del cliente. */
function porSeccion(ls: Linea[], moneda: 'ARS' | 'USD') {
  const m = new Map<string, number>();
  for (const l of ls) {
    if (l.moneda !== moneda) continue;
    const ingreso = ['reintegro_percepcion', 'bonificacion', 'reverso'].includes(String(l.tipoLinea));
    const k = s(l.seccion);
    m.set(k, r2((m.get(k) ?? 0) + (ingreso ? -1 : 1) * Number(l.monto)));
  }
  return m;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? leerSecreto();
  if (!apiKey) { console.log('>>> SALTEADO: sin ANTHROPIC_API_KEY'); return; }
  const client = new Anthropic({ apiKey });
  const resus = await db.collection('resumenesTarjeta').get();

  console.log('F9.181 — verificación con el prompt NUEVO. NO SE ESCRIBE NADA.\n');

  // Las extracciones corren en paralelo (cada una tarda minutos); el reporte sale en orden.
  const trabajos = IDS.map(async pref => {
    const d = resus.docs.find(x => x.id.startsWith(pref));
    if (!d) return { pref, error: 'no está' } as const;
    const x = d.data();
    const [buf] = await getStorage().bucket().file(s(x.refStoragePdf)).download();
    // Igual que procesarResumenTarjeta: banco/tarjeta del doc tal cual (vacíos en el que falló).
    try {
      return { pref, d, x, ...(await extraer(client, buf as Buffer, String(x.banco ?? ''), String(x.tarjeta ?? ''))) };
    } catch (e) { return { pref, error: (e as Error).message } as const; }
  });

  for (const tr of await Promise.all(trabajos)) {
    console.log('═'.repeat(100));
    if ('error' in tr) { console.log(`${tr.pref}: ${tr.error}`); continue; }
    const { d, x, resp, seg, raw } = tr;
    const guardadas = (x.movimientosParseados ?? []) as Linea[];
    console.log(`${h8(d.id)} | ${s(x.tarjetaCodigo)} ${s(x.periodo)} [${s(x.estado)}] | guardadas: ${guardadas.length} líneas`);
    console.log(`  stop_reason=${resp.stop_reason} | input=${resp.usage.input_tokens} | output=${resp.usage.output_tokens} | ${seg.toFixed(0)} s (${(resp.usage.output_tokens / seg).toFixed(0)} tok/s)`);

    let parsed: ReturnType<typeof fn.parsearRespuestaResumen>;
    try { parsed = fn.parsearRespuestaResumen(raw); }
    catch (e) { console.log(`  >>> no parsea: ${(e as Error).message.slice(0, 160)}`); continue; }
    const cab = parsed.resumen;
    const { lineas, correcciones } = corregirSignoConsumos(fn.armarMovimientosCrudos(parsed.movimientos) as never[]);
    const nuevas = lineas as unknown as Linea[];
    const renglones = raw.split('\n').filter(l => /^\s*\{"seq"/.test(l)).length;
    console.log(`  líneas: ${nuevas.length} (${renglones} en un renglón cada una) | guard: ${correcciones.length} corrección(es)`);
    console.log(`  tokens/línea medidos: ${(resp.usage.output_tokens / Math.max(1, nuevas.length)).toFixed(1)} (salida total / líneas, cabecera incluida)`);
    const omitidos = {
      nroCupon: parsed.movimientos.filter(m => !('nroCupon' in (m as object))).length,
      personaDetectada: parsed.movimientos.filter(m => !('personaDetectada' in (m as object))).length,
      cuotaActual: parsed.movimientos.filter(m => !('cuotaActual' in (m as object))).length,
      sinMontoFirmado: parsed.movimientos.filter(m => typeof (m as Linea).montoFirmado !== 'number').length,
      sinSeccion: parsed.movimientos.filter(m => !('seccion' in (m as object))).length,
      conEspejos: parsed.movimientos.filter(m => ['esBonificacion', 'esReverso', 'esImpuesto', 'esPagoAnterior'].some(k => k in (m as object))).length,
    };
    console.log(`  campos: omitidos nroCupon=${omitidos.nroCupon} personaDetectada=${omitidos.personaDetectada} cuotaActual=${omitidos.cuotaActual} | sin montoFirmado=${omitidos.sinMontoFirmado} | sin seccion=${omitidos.sinSeccion} | con espejos=${omitidos.conEspejos}`);
    const espejoMal = nuevas.filter(l => l.esBonificacion !== (l.tipoLinea === 'bonificacion') || l.esReverso !== (l.tipoLinea === 'reverso') || l.esImpuesto !== (l.tipoLinea === 'impuesto')).length;
    console.log(`  espejos derivados ≠ tipoLinea: ${espejoMal}`);

    // ── cuadre (arrastre incluido), con el encabezado de ESTA extracción ──
    const aj = (Array.isArray(cab.ajustesConsolidado) ? cab.ajustesConsolidado : []) as unknown[];
    const cons = {
      saldoAnteriorARS: cab.saldoAnteriorARS as number | null, saldoAnteriorUSD: cab.saldoAnteriorUSD as number | null,
      pagosDelPeriodoARS: cab.pagosDelPeriodoARS as number | null, pagosDelPeriodoUSD: cab.pagosDelPeriodoUSD as number | null,
    };
    const c = RT.calcularCuadre(nuevas as unknown as MovimientoParseado[], Number(cab.totalARS ?? 0), Number(cab.totalUSD ?? 0), aj, cons);
    const cuadraARS = Math.abs(c.diffARS) <= TOL.ARS, cuadraUSD = Math.abs(c.diffUSD) <= TOL.USD;
    console.log(`  cuadre ARS: suma=${r2(c.sumaARS)} objetivo=${r2(c.objetivoARS)} diff=${r2(c.diffARS)} ${ok(cuadraARS)}`);
    console.log(`  cuadre USD: suma=${r2(c.sumaUSD)} objetivo=${r2(c.objetivoUSD)} diff=${r2(c.diffUSD)} ${ok(cuadraUSD)}`);
    console.log(`  encabezado: totalARS=${s(cab.totalARS)} totalUSD=${s(cab.totalUSD)} saldoAnt=${s(cab.saldoAnteriorARS)}/${s(cab.saldoAnteriorUSD)} pagos=${s(cab.pagosDelPeriodoARS)}/${s(cab.pagosDelPeriodoUSD)} ajustes=${JSON.stringify(aj)}`);
    if (!cuadraARS || !cuadraUSD) {
      for (const m of ['ARS', 'USD'] as const)
        for (const [sec, v] of porSeccion(nuevas, m)) console.log(`    residuo ${m} | ${corto(sec, 40)}: ${v}`);
    }

    if (d.id.startsWith(FALLADO)) continue;

    // ── no regresión contra lo guardado ──
    const camposCab = ['totalARS', 'totalUSD', 'saldoAnteriorARS', 'saldoAnteriorUSD', 'pagosDelPeriodoARS', 'pagosDelPeriodoUSD'];
    for (const k of camposCab) {
      const g = x[k], n = cab[k];
      if (!(typeof g === 'number' && typeof n === 'number' ? Math.abs(g - n) < 0.005 : g == n))
        console.log(`  ✗ encabezado ${k}: guardado=${s(g)} nuevo=${s(n)}`);
    }
    console.log(`  cantidad de líneas: guardadas=${guardadas.length} nuevas=${nuevas.length} ${ok(guardadas.length === nuevas.length)}`);
    const clave = (l: Linea) => `${s(l.fechaConsumo)}|${l.moneda}|${r2(Number(l.monto))}`;
    const libres = new Map<string, Linea[]>();
    for (const l of guardadas) { const k = clave(l); libres.set(k, [...(libres.get(k) ?? []), l]); }
    const sinPar: Linea[] = [];
    let difTipo = 0, difFirma = 0, pares = 0;
    for (const l of nuevas) {
      const cand = libres.get(clave(l));
      if (!cand?.length) { sinPar.push(l); continue; }
      const g = cand.shift()!;
      pares++;
      if (g.tipoLinea !== l.tipoLinea) {
        difTipo++;
        console.log(`  ✗ tipoLinea seq=${s(l.seq)} ${corto(l.descripcionRaw)} ${s(l.monto)}: guardado=${s(g.tipoLinea)} nuevo=${s(l.tipoLinea)}`);
      }
      if (g.montoFirmado !== l.montoFirmado) {
        difFirma++;
        if (difFirma <= 8 || g.montoFirmado != null)
          console.log(`  ${g.montoFirmado == null ? '·' : '✗'} montoFirmado seq=${s(l.seq)} ${corto(l.descripcionRaw)}: guardado=${s(g.montoFirmado)} nuevo=${s(l.montoFirmado)}`);
      }
    }
    const sobrantes = [...libres.values()].flat();
    console.log(`  apareadas ${pares} | tipoLinea distinto: ${difTipo} | montoFirmado distinto: ${difFirma}` +
      `${guardadas.every(g => g.montoFirmado == null) ? ' (lo guardado es anterior a F9.161: no tiene montoFirmado)' : ''}`);
    for (const l of sinPar) console.log(`  + solo en la nueva: seq=${s(l.seq)} ${s(l.fechaConsumo)} ${corto(l.descripcionRaw)} ${l.moneda} ${s(l.monto)} (${s(l.tipoLinea)})`);
    for (const l of sobrantes) console.log(`  − solo en la guardada: seq=${s(l.seq)} ${s(l.fechaConsumo)} ${corto(l.descripcionRaw)} ${l.moneda} ${s(l.monto)} (${s(l.tipoLinea)})`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
