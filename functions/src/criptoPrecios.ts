// F9.195 (sistema cripto) §3 — lectura diaria de precios cripto.
//
// Módulo puro: sin SDK de Firebase. La red se inyecta (`pedir`), como en senalesMercado.ts, para
// probar el parseo sin red. INFORMATIVO: produce precios y un valor del sistema; no notifica a nadie.
//
// FUENTES — sondeadas el 15-oct-2026 desde la PC de Juan (no desde Cloud Functions): las tres
// respondieron 200 con estos formatos.
//   · Bitfinex público `/v2/tickers?symbols=…` → array de arrays `[SYMBOL, BID, BID_SIZE, ASK,
//     ASK_SIZE, DAILY_CHANGE, DAILY_CHANGE_REL, LAST_PRICE, …]`. Un símbolo que no existe se omite
//     (no da error). Símbolo: `tBTCUSD` para bases de 3 letras, `tAAVE:USD` para las más largas.
//   · Kraken `/0/public/Ticker?pair=…` → `{ error: [], result: { XXBTZUSD: { c: [último, vol] } } }`.
//     Un par desconocido hace fallar el pedido entero (`EQuery:Unknown asset pair`): se pide de a uno.
//   · CoinGecko `/simple/price?ids=…&vs_currencies=usd` → `{ bitcoin: { usd, last_updated_at } }`.
//     Necesita el id de la moneda: tabla explícita, sin búsqueda difusa.
// Primaria Bitfinex (la plataforma de Juan, un solo pedido), respaldo Kraken, último recurso CoinGecko
// (límite de pedidos sin key). Si desde Cloud Functions alguna bloquea, el error crudo queda en
// `sondeo` y se reordena con ese dato a la vista.
//
// Un activo sin precio queda "sin dato" con el error crudo: nunca un proxy ni el último valor
// presentado como de hoy. Los stablecoins se valúan a 1 por definición, sin pedido.

export type RespuestaCruda = { status: number; body: unknown };
export type Pedir = (url: string) => Promise<RespuestaCruda>;

// Mismo conjunto que `STABLECOINS` de src/datos/patrimonioRiesgo.ts (functions no importa de src/).
export const STABLECOINS_CRIPTO = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD']);

export const FUENTE_BITFINEX = 'bitfinex';
export const FUENTE_KRAKEN = 'kraken';
export const FUENTE_COINGECKO = 'coingecko';
export const FUENTE_STABLE = 'stablecoin=1';

// Kraken llama XBT al bitcoin.
const KRAKEN_BASE: Record<string, string> = { BTC: 'XBT' };
// CoinGecko pide ids. Tabla explícita: un ticker que no está acá no se adivina.
export const COINGECKO_ID: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', AAVE: 'aave', UNI: 'uniswap', SOL: 'solana', LINK: 'chainlink',
  ADA: 'cardano', DOT: 'polkadot', XRP: 'ripple', LTC: 'litecoin', MATIC: 'matic-network', POL: 'polygon-ecosystem-token',
};

export const simboloBitfinex = (t: string) => (t.length === 3 ? `t${t}USD` : `t${t}:USD`);
export const parKraken = (t: string) => `${KRAKEN_BASE[t] ?? t}USD`;

export const urlBitfinex = (tickers: string[]) =>
  `https://api-pub.bitfinex.com/v2/tickers?symbols=${tickers.map(simboloBitfinex).join(',')}`;
export const urlKraken = (ticker: string) => `https://api.kraken.com/0/public/Ticker?pair=${parKraken(ticker)}`;
export const urlCoingecko = (tickers: string[]) =>
  `https://api.coingecko.com/api/v3/simple/price?ids=${tickers.map(t => COINGECKO_ID[t]).filter(Boolean).join(',')}&vs_currencies=usd`;

export type PrecioCripto = {
  valor: number | null;
  fuente: string | null;
  error: string | null;   // por qué no hay precio: el error crudo de cada fuente probada
};

// Status y principio del cuerpo de cada pedido: el sondeo que pide §3, guardado con la lectura.
export type Sondeo = { fuente: string; url: string; status: number; error: string | null };

const recorte = (body: unknown) => {
  try { return JSON.stringify(body).slice(0, 200); } catch { return String(body).slice(0, 200); }
};
const errorCrudo = (r: RespuestaCruda) => `HTTP ${r.status} — ${recorte(r.body)}`;
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

type Parseo = { precios: Record<string, number>; error: string | null };

/** Bitfinex: LAST_PRICE (índice 7) de cada fila. Los pedidos que no vinieron quedan afuera. */
export function parseBitfinex(r: RespuestaCruda, tickers: string[]): Parseo {
  if (r.status !== 200 || !Array.isArray(r.body)) return { precios: {}, error: errorCrudo(r) };
  const precios: Record<string, number> = {};
  for (const t of tickers) {
    const fila = (r.body as unknown[]).find(f => Array.isArray(f) && f[0] === simboloBitfinex(t)) as unknown[] | undefined;
    const v = fila ? num(fila[7]) : null;
    if (v !== null) precios[t] = v;
  }
  return { precios, error: null };
}

/** Kraken, un par por pedido: toma el único resultado y su último precio (`c[0]`). */
export function parseKraken(r: RespuestaCruda, ticker: string): Parseo {
  const b = r.body as { error?: unknown; result?: Record<string, { c?: unknown[] }> } | null;
  const errs = Array.isArray(b?.error) ? b!.error as unknown[] : [];
  if (r.status !== 200 || !b || typeof b !== 'object' || errs.length > 0 || !b.result) {
    return { precios: {}, error: errorCrudo(r) };
  }
  const fila = Object.values(b.result)[0];
  const v = fila && Array.isArray(fila.c) ? num(fila.c[0]) : null;
  return v !== null ? { precios: { [ticker]: v }, error: null } : { precios: {}, error: `sin campo c — ${recorte(r.body)}` };
}

/** CoinGecko: `{ [id]: { usd } }`, deshecho a ticker con la tabla. */
export function parseCoingecko(r: RespuestaCruda, tickers: string[]): Parseo {
  const b = r.body as Record<string, { usd?: unknown }> | null;
  if (r.status !== 200 || !b || typeof b !== 'object' || Array.isArray(b)) return { precios: {}, error: errorCrudo(r) };
  const precios: Record<string, number> = {};
  for (const t of tickers) {
    const id = COINGECKO_ID[t];
    const v = id ? num(b[id]?.usd) : null;
    if (v !== null) precios[t] = v;
  }
  return { precios, error: null };
}

async function intentarUnaVez(pedir: Pedir, url: string): Promise<RespuestaCruda> {
  try {
    return await pedir(url);
  } catch (e) {
    return { status: 0, body: e instanceof Error ? e.message : String(e) };
  }
}

/** Un reintento ante fallas transitorias (5xx, 429, red), igual que senalesMercado.ts. */
const esTransitorio = (r: RespuestaCruda) => r.status === 0 || r.status === 429 || r.status >= 500;
async function intentar(pedir: Pedir, url: string, esperaMs: number): Promise<RespuestaCruda> {
  const r = await intentarUnaVez(pedir, url);
  if (!esTransitorio(r)) return r;
  await new Promise(ok => setTimeout(ok, esperaMs));
  return intentarUnaVez(pedir, url);
}

export type LecturaCripto = {
  leidoEnISO: string;
  precios: Record<string, PrecioCripto>;
  sondeo: Sondeo[];
};

/**
 * Lee el precio en USD de cada ticker: Bitfinex, después Kraken para lo que faltó, después
 * CoinGecko. Nunca rechaza: un ticker que ninguna fuente trae queda con `valor: null` y el motivo
 * de cada fuente.
 */
export async function leerPreciosCripto(
  pedir: Pedir, tickersEntrada: string[], ahoraISO: string, esperaReintentoMs = 1500,
): Promise<LecturaCripto> {
  const tickers = [...new Set(tickersEntrada.map(t => t.trim().toUpperCase()).filter(Boolean))].sort();
  const precios: Record<string, PrecioCripto> = {};
  const motivos: Record<string, string[]> = {};
  const sondeo: Sondeo[] = [];

  for (const t of tickers) {
    if (STABLECOINS_CRIPTO.has(t)) precios[t] = { valor: 1, fuente: FUENTE_STABLE, error: null };
  }
  const faltan = () => tickers.filter(t => !precios[t]);
  const anotar = (fuente: string, url: string, r: RespuestaCruda, p: Parseo, pedidos: string[]) => {
    sondeo.push({ fuente, url, status: r.status, error: p.error });
    for (const t of pedidos) {
      const v = p.precios[t];
      if (v !== undefined) precios[t] = { valor: v, fuente, error: null };
      else (motivos[t] ??= []).push(`${fuente}: ${p.error ?? 'no lo trae'}`);
    }
  };

  if (faltan().length) {
    const pedidos = faltan();
    const url = urlBitfinex(pedidos);
    const r = await intentar(pedir, url, esperaReintentoMs);
    anotar(FUENTE_BITFINEX, url, r, parseBitfinex(r, pedidos), pedidos);
  }
  // Kraken de a uno: un par desconocido rompe el pedido entero.
  for (const t of faltan()) {
    const url = urlKraken(t);
    const r = await intentar(pedir, url, esperaReintentoMs);
    anotar(FUENTE_KRAKEN, url, r, parseKraken(r, t), [t]);
  }
  const sinId = faltan().filter(t => !COINGECKO_ID[t]);
  for (const t of sinId) (motivos[t] ??= []).push(`${FUENTE_COINGECKO}: sin id en la tabla`);
  const conId = faltan().filter(t => COINGECKO_ID[t]);
  if (conId.length) {
    const url = urlCoingecko(conId);
    const r = await intentar(pedir, url, esperaReintentoMs);
    anotar(FUENTE_COINGECKO, url, r, parseCoingecko(r, conId), conId);
  }

  for (const t of faltan()) precios[t] = { valor: null, fuente: null, error: (motivos[t] ?? ['sin fuente']).join(' · ') };
  return { leidoEnISO: ahoraISO, precios, sondeo };
}

// ── Base de BTC para los tramos ──────────────────────────────────────────────
export type BaseBtc = { valor: number; fecha: string; fuente: string | null };

/**
 * Misma regla que las señales de F9.190: la base se fija con la PRIMERA lectura con precio y no se
 * mueve sola (no es un máximo móvil). `reiniciar` la fija en la lectura de hoy.
 */
export function resolverBaseBtc(previa: BaseBtc | null, lectura: LecturaCripto, hoy: string, reiniciar: boolean): BaseBtc | null {
  const p = lectura.precios['BTC'];
  if (previa && !reiniciar) return previa;
  if (!p || p.valor === null) return reiniciar ? null : previa;
  return { valor: p.valor, fecha: hoy, fuente: p.fuente };
}

// ── Serie diaria del sistema (para el freno) ─────────────────────────────────
export type PosicionCripto = { ticker: string; cantidad: number | null; valorUsd: number };

export type DiaHistorial = {
  valorSistemaUsd: number;
  cantidadesDeFecha: string | null;    // fechaCorrida del snapshot de donde salen las cantidades
  precios: Record<string, number | null>;
  // Tickers valuados con el valorUsd del snapshot (sin precio o sin cantidad). Un día incompleto
  // mezcla precios de hoy con valores viejos: el freno no lo usa como máximo.
  valuadosConSnapshot: string[];
  completo: boolean;
};

/** Valor del sistema = Σ cantidad × precio de hoy; lo que no tiene precio o cantidad, a valorUsd. */
export function armarDiaHistorial(posiciones: PosicionCripto[], lectura: LecturaCripto, cantidadesDeFecha: string | null): DiaHistorial {
  let valor = 0;
  const conSnapshot = new Set<string>();
  for (const p of posiciones) {
    const t = p.ticker.trim().toUpperCase();
    const precio = lectura.precios[t]?.valor ?? null;
    if (precio !== null && typeof p.cantidad === 'number') valor += p.cantidad * precio;
    else { valor += p.valorUsd; conSnapshot.add(t); }
  }
  const precios: Record<string, number | null> = {};
  for (const [t, p] of Object.entries(lectura.precios)) precios[t] = p.valor;
  return {
    valorSistemaUsd: Math.round(valor * 100) / 100,
    cantidadesDeFecha,
    precios,
    valuadosConSnapshot: [...conSnapshot].sort(),
    completo: conSnapshot.size === 0,
  };
}
