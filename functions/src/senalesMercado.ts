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

export type RespuestaCruda = { status: number; body: unknown };
export type Pedir = (url: string) => Promise<RespuestaCruda>;

export const URL_RIESGO_PAIS = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo';
export const URL_ARG_STOCKS = 'https://data912.com/live/arg_stocks';
export const URL_USA_STOCKS = 'https://data912.com/live/usa_stocks';
export const URL_CCL = 'https://dolarapi.com/v1/dolares/contadoconliqui';

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

async function intentar(pedir: Pedir, url: string): Promise<RespuestaCruda> {
  try {
    return await pedir(url);
  } catch (e) {
    return { status: 0, body: e instanceof Error ? e.message : String(e) };
  }
}

/** Lee las cuatro fuentes. Nunca rechaza: cada dato que falla viaja con su error. */
export async function leerMercado(pedir: Pedir, hoy: string, ahoraISO: string): Promise<LecturaMercado> {
  const [rp, ar, usa, ccl] = await Promise.all([
    intentar(pedir, URL_RIESGO_PAIS),
    intentar(pedir, URL_ARG_STOCKS),
    intentar(pedir, URL_USA_STOCKS),
    intentar(pedir, URL_CCL),
  ]);
  const riesgoPais = parseRiesgoPais(rp, hoy);
  const mervalArs = precioDePanel(ar, SIMBOLOS_MERVAL, 'data912:arg_stocks', hoy);
  const cclDato = parseCcl(ccl, hoy);
  const sp500 = precioDePanel(usa, [SIMBOLO_SP500], 'data912:usa_stocks', hoy);

  const mervalUsd: Dato = mervalArs.valor !== null && cclDato.valor !== null
    ? { valor: mervalArs.valor / cclDato.valor, fecha: mervalArs.fecha, fuente: 'merval/ccl', error: null }
    : {
      valor: null, fecha: null, fuente: 'merval/ccl',
      error: [mervalArs.error && `merval: ${mervalArs.error}`, cclDato.error && `ccl: ${cclDato.error}`]
        .filter(Boolean).join(' · ') || 'sin dato',
    };

  return { leidoEnISO: ahoraISO, riesgoPais, mervalArs, ccl: cclDato, mervalUsd, sp500 };
}

export type Base = { valor: number; fecha: string };
export type Bases = { mervalUsd: Base | null; sp500: Base | null };

/**
 * La base de las caídas se fija la PRIMERA vez que hay dato, y después no se mueve sola: no es un
 * máximo móvil, para que el criterio sea simple de auditar ("cayó X% desde el día que lo
 * activaste"). `reiniciar` la pisa con la lectura de hoy.
 */
export function resolverBases(previas: Bases | null, lectura: LecturaMercado, reiniciar: boolean): Bases {
  const pick = (prev: Base | null, d: Dato): Base | null => {
    if (prev && !reiniciar) return prev;
    return d.valor !== null ? { valor: d.valor, fecha: d.fecha ?? lectura.leidoEnISO.slice(0, 10) } : (reiniciar ? null : prev);
  };
  return {
    mervalUsd: pick(previas?.mervalUsd ?? null, lectura.mervalUsd),
    sp500: pick(previas?.sp500 ?? null, lectura.sp500),
  };
}
