// F9.196 H1b — cliente de EXPLORACIÓN de la API autenticada de Bitfinex v2: solo lectura.
// No es la sincronización de producción (eso es el H2 de Bitfinex): lo usa scripts/explorarBitfinex.ts.
//
// ⛔ Seguridad (F9.196 §0.b):
// - Lista blanca: solo `POST /v2/auth/r/*`. Cualquier otra ruta —en particular `auth/w/*`— tira
//   error ANTES de salir a la red. Lo verifica scripts/bitfinexCliente.test.ts sin hacer red.
// - Nunca se loguean la key, el secret, la firma ni el nonce.
//
// Decisiones FIJAS (no cambiarlas después; ver docs/patrimonio/cripto-apis-exploracion.md):
// - Nonce en MILISEGUNDOS, estrictamente creciente dentro del proceso. Bitfinex exige que cada nonce
//   sea mayor que el último usado con la key: si alguna vez se pasa a microsegundos y se vuelve
//   atrás, el nonce baja y la API rechaza la key para siempre (hasta crear otra).
// - Firma: HMAC-SHA384 (secret como clave), en hex, de `/api/v2/<endpoint>` + nonce + body. Se
//   manda siempre body `{}` (o el body pedido) y se firma exactamente ese string.
import * as crypto from 'crypto';

export const BASE_BITFINEX = 'https://api.bitfinex.com/v2/';

/** Solo `auth/r/<segmentos>`: letras, números, `_`, `-` y `:` (símbolos como `fUSD`, `tBTC:USD`). */
const RUTA_LECTURA = /^auth\/r\/[A-Za-z0-9_:\-]+(\/[A-Za-z0-9_:\-]+)*$/;

export function rutaPermitida(endpoint: string): boolean {
  return RUTA_LECTURA.test(endpoint) && !endpoint.split('/').some(s => s === '..' || s === '.');
}

export class RutaProhibida extends Error {
  constructor(endpoint: string) {
    super(`[bitfinex] ruta fuera de la lista blanca (solo auth/r/*), no se envía: ${endpoint}`);
  }
}

/** Nonce en milisegundos, estrictamente creciente dentro del proceso. */
export function crearNonce(ahora: () => number = Date.now): () => string {
  let ultimo = 0;
  return () => {
    const n = Math.max(ahora(), ultimo + 1);
    ultimo = n;
    return String(n);
  };
}

/** Firma de Bitfinex v2: HMAC-SHA384 hex de `/api/v2/<endpoint>` + nonce + body. */
export function firmar(secret: string, endpoint: string, nonce: string, body: string): string {
  return crypto.createHmac('sha384', secret).update(`/api/v2/${endpoint}${nonce}${body}`, 'utf8').digest('hex');
}

export type Respuesta = { status: number; body: unknown; ms: number };
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) =>
  Promise<{ status: number; text(): Promise<string> }>;

/**
 * Pedido autenticado. La lista blanca se chequea PRIMERO, antes de calcular la firma o tocar
 * `fetchImpl`. `conBody: false` manda el pedido sin body (y firma sin body): solo para el fallback
 * de firma que pide el prompt.
 */
export async function pedirBitfinex(
  cred: { key: string; secret: string },
  nonce: () => string,
  endpoint: string,
  body: Record<string, unknown> = {},
  opciones: { conBody?: boolean; fetchImpl?: FetchLike } = {},
): Promise<Respuesta> {
  if (!rutaPermitida(endpoint)) throw new RutaProhibida(endpoint);
  const conBody = opciones.conBody ?? true;
  const cuerpo = conBody ? JSON.stringify(body) : '';
  const n = nonce();
  const headers: Record<string, string> = {
    'bfx-nonce': n,
    'bfx-apikey': cred.key,
    'bfx-signature': firmar(cred.secret, endpoint, n, cuerpo),
    ...(conBody ? { 'Content-Type': 'application/json' } : {}),
  };
  const f = opciones.fetchImpl ?? (fetch as unknown as FetchLike);
  const t0 = Date.now();
  const res = await f(BASE_BITFINEX + endpoint, { method: 'POST', headers, ...(conBody ? { body: cuerpo } : {}) });
  const texto = await res.text();
  let parsed: unknown = texto;
  try { parsed = texto ? JSON.parse(texto) : null; } catch { /* queda como texto */ }
  return { status: res.status, body: parsed, ms: Date.now() - t0 };
}

/** `["error", código, "mensaje"]` de Bitfinex. */
export const esErrorBitfinex = (b: unknown): b is [string, number, string] =>
  Array.isArray(b) && b[0] === 'error';

/** Un reloj de a lo sumo 1 llamada por segundo: el bloqueo de Bitfinex es de 60 s por IP. */
export function crearRitmo(msEntre = 1100): () => Promise<void> {
  let ultimo = 0;
  return async () => {
    const espera = ultimo + msEntre - Date.now();
    if (espera > 0) await new Promise(r => setTimeout(r, espera));
    ultimo = Date.now();
  };
}
