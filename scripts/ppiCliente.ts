// F9.196 H1 — cliente de EXPLORACIÓN de la API de PPI: solo lectura, con lista blanca de rutas.
// No es el cliente de producción (eso es H2): lo usa scripts/explorarPPI.ts.
//
// ⛔ Seguridad (F9.196 §0):
// - Cualquier ruta fuera de la lista blanca tira error ANTES de salir a la red. En particular
//   `Order/*`, `Account/BankAccount*`, `Account/ForeignBankAccount`, `POST Account/InvestingProfile`
//   e `InterestBearingAccount/*`. Lo verifica scripts/ppiCliente.test.ts.
// - Nunca se loguean headers, credenciales ni tokens. Los errores llevan método, ruta y status.
import * as fs from 'fs';

export type Metodo = 'GET' | 'POST';

/**
 * Lista blanca. `Configuration/InstrumentTypes` y `Configuration/Settlements` no están en §0:
 * se suman porque hacen falta para el punto 6 (valores válidos de Type y Settlement) y son de
 * consulta.
 */
const PERMITIDAS: Array<{ metodo: Metodo; ruta: RegExp }> = [
  { metodo: 'POST', ruta: /^Account\/LoginApi$/ },
  { metodo: 'POST', ruta: /^Account\/RefreshToken$/ },
  { metodo: 'GET', ruta: /^Account\/Accounts$/ },
  { metodo: 'GET', ruta: /^Account\/AvailableBalance$/ },
  { metodo: 'GET', ruta: /^Account\/BalancesAndPositions$/ },
  { metodo: 'GET', ruta: /^Account\/Movements$/ },
  { metodo: 'GET', ruta: /^MarketData\/[A-Za-z]+$/ },
  { metodo: 'GET', ruta: /^Configuration\/InstrumentTypes$/ },
  { metodo: 'GET', ruta: /^Configuration\/Settlements$/ },
];

/** Ruta sin la base ni la versión, sin query: `Account/Accounts`. */
export function rutaPermitida(metodo: Metodo, ruta: string): boolean {
  const limpia = ruta.split('?')[0].replace(/^\/+/, '');
  return PERMITIDAS.some(p => p.metodo === metodo && p.ruta.test(limpia));
}

export class RutaProhibida extends Error {
  constructor(metodo: Metodo, ruta: string) {
    super(`[ppi] ruta fuera de la lista blanca, no se envía: ${metodo} ${ruta.split('?')[0]}`);
  }
}

export const BASE_PRODUCCION = 'https://clientapi.portfoliopersonal.com/api/1.0/';
export const BASE_SANDBOX = 'https://clientapisbx.portfoliopersonal.com/api/1.0/';

export type Respuesta = { status: number; headers: Record<string, string>; body: unknown; ms: number };
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) =>
  Promise<{ status: number; headers: { forEach(cb: (v: string, k: string) => void): void }; text(): Promise<string> }>;

/**
 * Pedido crudo. La lista blanca se chequea PRIMERO, antes de armar headers o tocar `fetchImpl`.
 * `headers` los arma quien llama; acá no se imprimen nunca.
 */
export async function pedirPPI(
  base: string,
  metodo: Metodo,
  ruta: string,
  headers: Record<string, string>,
  body?: unknown,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<Respuesta> {
  if (!rutaPermitida(metodo, ruta)) throw new RutaProhibida(metodo, ruta);
  const t0 = Date.now();
  const res = await fetchImpl(base + ruta.replace(/^\/+/, ''), {
    method: metodo,
    headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const texto = await res.text();
  let parsed: unknown = texto;
  try { parsed = texto ? JSON.parse(texto) : null; } catch { /* queda como texto */ }
  const hs: Record<string, string> = {};
  res.headers.forEach((v, k) => { hs[k.toLowerCase()] = v; });
  return { status: res.status, headers: hs, body: parsed, ms: Date.now() - t0 };
}

/**
 * Parser mínimo de `.env`: `clave=valor`, ignora vacías y `#`, saca comillas y espacios de los
 * costados. Devuelve los valores; quien llama NUNCA los imprime.
 */
export function parsearEnv(texto: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea || linea.startsWith('#')) continue;
    const i = linea.indexOf('=');
    if (i <= 0) continue;
    const clave = linea.slice(0, i).trim();
    let valor = linea.slice(i + 1).trim();
    if (valor.length >= 2 && ((valor[0] === '"' && valor.endsWith('"')) || (valor[0] === "'" && valor.endsWith("'")))) {
      valor = valor.slice(1, -1).trim();
    }
    out[clave] = valor;
  }
  return out;
}

export function leerEnv(ruta: string): Record<string, string> {
  return parsearEnv(fs.readFileSync(ruta, 'utf8'));
}

/** Copia del body sin tokens, para guardar en disco o resumir. */
export function sinTokens(body: unknown): unknown {
  const tapar = (o: Record<string, unknown>) => {
    const c: Record<string, unknown> = { ...o };
    for (const k of Object.keys(c)) {
      if (/token/i.test(k) && typeof c[k] === 'string') c[k] = `<redactado, ${(c[k] as string).length} caracteres>`;
    }
    return c;
  };
  if (Array.isArray(body)) return body.map(x => (x && typeof x === 'object' ? tapar(x as Record<string, unknown>) : x));
  if (body && typeof body === 'object') return tapar(body as Record<string, unknown>);
  return body;
}
