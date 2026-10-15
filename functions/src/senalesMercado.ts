// F9.190 §2 — señales de mercado para la reserva (riesgo país, Merval en USD, S&P 500).
//
// Módulo puro: sin SDK de Firebase. Las lecturas de red se inyectan (`pedir`) para poder probar el
// parseo sin red. INFORMATIVO, nunca alarma (contrato de Patrimonio: "nunca ordena ni dispara
// alarmas"): esto produce números y un estado; no notifica a nadie.
//
// FUENTES NO VERIFICADAS EN VIVO al escribir esto (el entorno de la sesión no tenía salida a
// ninguna de las tres). Por eso cada lectura devuelve el status y el principio del cuerpo REAL
// cuando falla, sin interpretar la causa — la lección de CAFCI (F9.102.x / F9.104).
//   · Riesgo país: ArgentinaDatos `/v1/finanzas/indices/riesgo-pais/ultimo`. Mismo proveedor que el
//     backfill de tcDiario (F9.103/F9.148), que sí sale desde Functions.
//   · Merval: data912 `/live/arg_stocks`, buscando el símbolo del índice. Si el panel no lo trae, la
//     señal queda "sin fuente" y lo dice — NO se reemplaza por un proxy (un proxy con nombre de
//     Merval sería un número plausible sin marcar).
//   · CCL: dolarapi `/v1/dolares/contadoconliqui`. Mismo proveedor que el cron F9.30.
//   · S&P 500: SPY en data912 `/live/usa_stocks` (el mismo panel que valúa ACN). SPY replica el
//     índice; para medir una caída porcentual es equivalente.
//
// F9.195 — CORRECCIÓN con la primera lectura real (13-oct-2026): data912 no trae ninguno de los
// dos. `arg_stocks` no tiene el índice ("no trae MERVAL/IMV/M.AR/^MERV", 96 símbolos) y
// `usa_stocks` es solo acciones, sin ETFs ("no trae SPY", 3152 símbolos). La documentación de
// data912 (openapi) lo confirma: no hay endpoint de índices ni de ETFs de EE.UU.; SPY existe solo
// como CEDEAR en `arg_cedears`. Fuentes nuevas:
//   · Merval: Yahoo Finance `^MERV` (chart v8, sin clave). Es el índice en pesos; se divide por el
//     CCL como antes. Si Yahoo bloquea, el error llega crudo a la card: sin proxy.
//   · S&P 500: CEDEAR SPY de data912 `/live/arg_cedears` (pesos) ÷ CCL. El nivel es el del CEDEAR
//     en dólares (no el del ETF: lo divide el ratio), pero la señal mide la CAÍDA PORCENTUAL desde
//     la base, que es la misma. Mismo proveedor que ya valúa la cartera desde Functions.
// F9.195.1 — segunda lectura real (14-oct-2026): Yahoo respondió desde Functions (Merval OK) y
// `data912 /live/arg_cedears` devolvió HTTP 502 (nginx). El S&P pasa a Yahoo `^GSPC`: es el índice
// en sí, en dólares, sin CCL en el medio, y la fuente que ya probó que responde. Todos los pedidos
// tienen un reintento ante 5xx / 429 / error de red.
// Las bases guardan su `fuente`: si la fuente de una señal cambia, la base se reinicia sola (una
// base medida con otra fuente está en otra escala y daría una caída falsa).

export type RespuestaCruda = { status: number; body: unknown };
export type Pedir = (url: string) => Promise<RespuestaCruda>;

export const URL_RIESGO_PAIS = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo';
export const URL_ARG_STOCKS = 'https://data912.com/live/arg_stocks';
export const URL_USA_STOCKS = 'https://data912.com/live/usa_stocks';
export const URL_CCL = 'https://dolarapi.com/v1/dolares/contadoconliqui';
// F9.195
export const URL_ARG_CEDEARS = 'https://data912.com/live/arg_cedears';
export const URL_YAHOO_MERVAL = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EMERV?range=5d&interval=1d';
export const FUENTE_MERVAL = 'yahoo:^MERV';
export const URL_YAHOO_SP500 = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5d&interval=1d';
export const FUENTE_SP500 = 'yahoo:^GSPC';

// Símbolos con los que el índice podría aparecer en el panel. Tabla explícita, no búsqueda difusa.
export const SIMBOLOS_MERVAL = ['MERVAL', 'IMV', 'M.AR', '^MERV'];
export const SIMBOLO_SP500 = 'SPY';

export type Dato = {
  valor: number | null;
  fecha: string | null;     // YYYY-MM-DD del dato si la fuente lo trae; si no, la de la lectura
  fuente: string;
  error: string | null;     // status + cuerpo crudo recortado; null si salió bien
};

const recorte = (body: unknown) => {
  try { return JSON.stringify(body).slice(0, 200); } catch { return String(body).slice(0, 200); }
};
const errorCrudo = (r: RespuestaCruda) => `HTTP ${r.status} — ${recorte(r.body)}`;
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** ArgentinaDatos devuelve `{ valor, fecha }`; se acepta también un array (toma el último). */
export function parseRiesgoPais(r: RespuestaCruda, hoy: string): Dato {
  const fuente = 'argentinadatos:riesgo-pais';
  let o: unknown = r.body;
  if (Array.isArray(o)) o = o[o.length - 1];
  if (r.status !== 200 || !o || typeof o !== 'object') return { valor: null, fecha: null, fuente, error: errorCrudo(r) };
  const rec = o as Record<string, unknown>;
  const valor = num(rec.valor);
  if (valor === null) return { valor: null, fecha: null, fuente, error: `sin campo valor — ${recorte(r.body)}` };
  const fecha = typeof rec.fecha === 'string' ? rec.fecha.slice(0, 10) : hoy;
  return { valor, fecha, fuente, error: null };
}

/** Panel live de data912: array de `{ symbol, c }`. Valúa por `c`, igual que el cron de precios. */
export function precioDePanel(r: RespuestaCruda, simbolos: string[], fuente: string, hoy: string): Dato {
  if (r.status !== 200 || !Array.isArray(r.body)) return { valor: null, fecha: null, fuente, error: errorCrudo(r) };
  for (const s of simbolos) {
    const fila = (r.body as Array<{ symbol?: unknown; c?: unknown }>).find(f => f.symbol === s);
    const c = fila ? num(fila.c) : null;
    if (c !== null) return { valor: c, fecha: hoy, fuente: `${fuente}:${s}`, error: null };
  }
  return { valor: null, fecha: null, fuente, error: `el panel no trae ${simbolos.join('/')} (${r.body.length} símbolos)` };
}

/**
 * F9.195 — Yahoo chart v8: `{ chart: { result: [{ meta: { regularMarketPrice, regularMarketTime } }],
 * error } }`. `regularMarketTime` viene en segundos epoch.
 */
export function parseYahooChart(r: RespuestaCruda, fuente: string, hoy: string): Dato {
  const chart = (r.body as { chart?: { result?: Array<{ meta?: Record<string, unknown> }> | null; error?: unknown } } | null)?.chart;
  const meta = chart?.result?.[0]?.meta;
  if (r.status !== 200 || !meta) return { valor: null, fecha: null, fuente, error: errorCrudo(r) };
  const valor = num(meta.regularMarketPrice);
  if (valor === null) return { valor: null, fecha: null, fuente, error: `sin regularMarketPrice — ${recorte(r.body)}` };
  const t = Number(meta.regularMarketTime);
  const fecha = Number.isFinite(t) && t > 0 ? new Date(t * 1000).toISOString().slice(0, 10) : hoy;
  return { valor, fecha, fuente, error: null };
}

/** dolarapi: `{ venta, fechaActualizacion }`. */
export function parseCcl(r: RespuestaCruda, hoy: string): Dato {
  const fuente = 'dolarapi:contadoconliqui';
  const o = r.body as Record<string, unknown> | null;
  if (r.status !== 200 || !o || typeof o !== 'object') return { valor: null, fecha: null, fuente, error: errorCrudo(r) };
  const valor = num(o.venta);
  if (valor === null) return { valor: null, fecha: null, fuente, error: `sin campo venta — ${recorte(r.body)}` };
  const fecha = typeof o.fechaActualizacion === 'string' ? o.fechaActualizacion.slice(0, 10) : hoy;
  return { valor, fecha, fuente, error: null };
}

export type LecturaMercado = {
  leidoEnISO: string;
  riesgoPais: Dato;
  mervalArs: Dato;
  ccl: Dato;
  mervalUsd: Dato;   // derivado: mervalArs / ccl
  sp500: Dato;
};

async function intentarUnaVez(pedir: Pedir, url: string): Promise<RespuestaCruda> {
  try {
    return await pedir(url);
  } catch (e) {
    return { status: 0, body: e instanceof Error ? e.message : String(e) };
  }
}

/** Un reintento ante fallas transitorias (5xx, 429, red). El error que queda es el del segundo. */
export const esTransitorio = (r: RespuestaCruda) => r.status === 0 || r.status === 429 || r.status >= 500;
async function intentar(pedir: Pedir, url: string, esperaMs = 1500): Promise<RespuestaCruda> {
  const r = await intentarUnaVez(pedir, url);
  if (!esTransitorio(r)) return r;
  await new Promise(ok => setTimeout(ok, esperaMs));
  return intentarUnaVez(pedir, url);
}

/** Lee las cuatro fuentes. Nunca rechaza: cada dato que falla viaja con su error. */
export async function leerMercado(pedir: Pedir, hoy: string, ahoraISO: string, esperaReintentoMs = 1500): Promise<LecturaMercado> {
  const [rp, merv, gspc, ccl] = await Promise.all([
    intentar(pedir, URL_RIESGO_PAIS, esperaReintentoMs),
    intentar(pedir, URL_YAHOO_MERVAL, esperaReintentoMs),
    intentar(pedir, URL_YAHOO_SP500, esperaReintentoMs),
    intentar(pedir, URL_CCL, esperaReintentoMs),
  ]);
  const riesgoPais = parseRiesgoPais(rp, hoy);
  const mervalArs = parseYahooChart(merv, FUENTE_MERVAL, hoy);
  const cclDato = parseCcl(ccl, hoy);

  const enUsd = (d: Dato, fuente: string, etiqueta: string): Dato =>
    d.valor !== null && cclDato.valor !== null
      ? { valor: d.valor / cclDato.valor, fecha: d.fecha, fuente, error: null }
      : {
        valor: null, fecha: null, fuente,
        error: [d.error && `${etiqueta}: ${d.error}`, cclDato.error && `ccl: ${cclDato.error}`]
          .filter(Boolean).join(' · ') || 'sin dato',
      };

  const mervalUsd = enUsd(mervalArs, `${FUENTE_MERVAL}/ccl`, 'merval');
  // F9.195.1 — el índice ya está en dólares: no pasa por el CCL.
  const sp500 = parseYahooChart(gspc, FUENTE_SP500, hoy);

  return { leidoEnISO: ahoraISO, riesgoPais, mervalArs, ccl: cclDato, mervalUsd, sp500 };
}

// F9.195 — `fuente` opcional: las bases viejas no la traen.
export type Base = { valor: number; fecha: string; fuente?: string };
export type Bases = { mervalUsd: Base | null; sp500: Base | null };

/**
 * La base de las caídas se fija la PRIMERA vez que hay dato, y después no se mueve sola: no es un
 * máximo móvil, para que el criterio sea simple de auditar ("cayó X% desde el día que lo
 * activaste"). `reiniciar` la pisa con la lectura de hoy.
 */
export function resolverBases(previas: Bases | null, lectura: LecturaMercado, reiniciar: boolean): Bases {
  const pick = (prev: Base | null, d: Dato): Base | null => {
    // F9.195 — una base de otra fuente está en otra escala: se descarta como si se reiniciara.
    // Una base sin `fuente` es de antes de F9.195 (otra fuente): cuenta como distinta.
    const mismaFuente = !prev || prev.fuente === d.fuente;
    const reset = reiniciar || (prev !== null && d.valor !== null && !mismaFuente);
    if (prev && !reset) return prev;
    return d.valor !== null
      ? { valor: d.valor, fecha: d.fecha ?? lectura.leidoEnISO.slice(0, 10), fuente: d.fuente }
      : (reset ? null : prev);
  };
  return {
    mervalUsd: pick(previas?.mervalUsd ?? null, lectura.mervalUsd),
    sp500: pick(previas?.sp500 ?? null, lectura.sp500),
  };
}
