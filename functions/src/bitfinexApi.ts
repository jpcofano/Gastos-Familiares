// F9.196 H2c — cliente de PRODUCCIÓN de la API autenticada de Bitfinex v2. Solo lectura.
//
// Confirmado en vivo el 20/10/2026 (docs/patrimonio/cripto-apis-exploracion.md):
// - firma HMAC-SHA384 en hex de `/api/v2/<endpoint>` + nonce + body, con body `{}` siempre firmado;
// - `limit` en movements/hist da error 10020: los historiales se piden SIN `limit` (25 por página).
//
// ⛔ Seguridad (F9.196 §0.b):
// - Lista blanca: solo `auth/r/*`. Cualquier otra —`auth/w/*`, `auth/calc/*`— tira error ANTES de
//   salir (test: functions/src/h2c.test.ts). Este código no tiene forma de operar ni retirar.
// - Nunca se loguean la key, el secret, la firma ni el nonce.
// - Credenciales: secretos de Firebase BITFINEX_API_KEY y BITFINEX_API_SECRET (index.ts).
//
// ⛔ Nonce en MILISEGUNDOS, estrictamente creciente, y no se cambia nunca: si alguna vez se usa en
// microsegundos y se vuelve atrás, el nonce baja y Bitfinex rechaza la key. Dentro de la instancia
// es `max(Date.now(), último + 1)`.
import * as crypto from 'crypto';

export const BASE_BITFINEX = 'https://api.bitfinex.com/v2/';
const RUTA_LECTURA = /^auth\/r\/[A-Za-z0-9_:\-]+(\/[A-Za-z0-9_:\-]+)*$/;

export function rutaPermitidaBitfinex(endpoint: string): boolean {
  return RUTA_LECTURA.test(endpoint) && !endpoint.split('/').some(s => s === '..' || s === '.');
}

export class RutaProhibidaBitfinex extends Error {
  constructor(endpoint: string) { super(`[bitfinex] ruta fuera de la lista blanca (solo auth/r/*), no se envía: ${endpoint}`); }
}

export class ErrorBitfinex extends Error {
  constructor(public status: number, endpoint: string, cuerpo: string) { super(`[bitfinex] ${endpoint} → HTTP ${status}: ${cuerpo.slice(0, 300)}`); }
}

export function firmarBitfinex(secret: string, endpoint: string, nonce: string, body: string): string {
  return crypto.createHmac('sha384', secret).update(`/api/v2/${endpoint}${nonce}${body}`, 'utf8').digest('hex');
}

export function crearNonceMs(ahora: () => number = Date.now): () => string {
  let ultimo = 0;
  return () => {
    const n = Math.max(ahora(), ultimo + 1);
    ultimo = n;
    return String(n);
  };
}

export type FetchBitfinex = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ status: number; text(): Promise<string> }>;

export function crearClienteBitfinex(
  cred: { key: string; secret: string },
  opciones: { fetchImpl?: FetchBitfinex; nonce?: () => string; pausaMs?: number } = {},
) {
  const f = opciones.fetchImpl ?? (fetch as unknown as FetchBitfinex);
  const nonce = opciones.nonce ?? nonceDeInstancia;
  const pausaMs = opciones.pausaMs ?? 1100;   // ≤ 1 llamada por segundo: el bloqueo es de 60 s por IP
  let ultimaLlamada = 0;

  /** POST autenticado a `auth/r/*`. Devuelve el JSON; un error tira `ErrorBitfinex`. */
  async function leer(endpoint: string, body: Record<string, unknown> = {}): Promise<unknown> {
    if (!rutaPermitidaBitfinex(endpoint)) throw new RutaProhibidaBitfinex(endpoint);
    const espera = ultimaLlamada + pausaMs - Date.now();
    if (espera > 0) await new Promise(r => setTimeout(r, espera));
    ultimaLlamada = Date.now();
    const cuerpo = JSON.stringify(body);
    const n = nonce();
    const res = await f(BASE_BITFINEX + endpoint, {
      signal: AbortSignal.timeout(15_000),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'bfx-nonce': n, 'bfx-apikey': cred.key,
        'bfx-signature': firmarBitfinex(cred.secret, endpoint, n, cuerpo),
      },
      body: cuerpo,
    });
    const texto = await res.text();
    let json: unknown = texto;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* queda como texto */ }
    if (res.status !== 200 || (Array.isArray(json) && json[0] === 'error')) throw new ErrorBitfinex(res.status, endpoint, texto);
    return json;
  }
  return { leer };
}

export type ClienteBitfinex = ReturnType<typeof crearClienteBitfinex>;

/** Nonce compartido por todos los clientes de la instancia (nunca dos llamadas con el mismo). */
const nonceDeInstancia = crearNonceMs();
