// F9.196 H2a — cliente de PRODUCCIÓN de la API de PPI. Solo lectura.
//
// Confirmado en vivo el 20/10/2026 (docs/patrimonio/ppi-api-exploracion.md):
// - base `https://clientapi.portfoliopersonal.com/api/1.0/`;
// - LoginApi devuelve un OBJETO; el token dura 8 h (`expires` en segundos);
// - con credenciales inválidas, LoginApi responde **400** (la doc dice 401): se trata como inválidas;
// - RefreshToken exige el Bearer del token anterior; el refreshToken rota.
//
// ⛔ Seguridad (F9.196 §0):
// - Lista blanca de rutas: las de §0 más `Configuration/*` de consulta. Cualquier otra —`Order/*`,
//   `Account/BankAccount*`, `InterestBearingAccount/*`…— tira error ANTES de salir (test:
//   functions/src/ppiApi.test.ts). Este código no tiene forma de operar.
// - Nunca se loguean headers ni tokens. Los errores llevan ruta, status y cuerpo con los tokens tapados.
// - Las credenciales salen de secretos de Firebase (`defineSecret` en index.ts), nunca del código.

export const BASE_PPI = 'https://clientapi.portfoliopersonal.com/api/1.0/';

type Metodo = 'GET' | 'POST';
const PERMITIDAS: Array<{ metodo: Metodo; ruta: RegExp }> = [
  { metodo: 'POST', ruta: /^Account\/LoginApi$/ },
  { metodo: 'POST', ruta: /^Account\/RefreshToken$/ },
  { metodo: 'GET', ruta: /^Account\/Accounts$/ },
  { metodo: 'GET', ruta: /^Account\/AvailableBalance$/ },
  { metodo: 'GET', ruta: /^Account\/BalancesAndPositions$/ },
  { metodo: 'GET', ruta: /^Account\/Movements$/ },
  { metodo: 'GET', ruta: /^MarketData\/[A-Za-z]+$/ },
  { metodo: 'GET', ruta: /^Configuration\/[A-Za-z]+$/ },
];

export function rutaPermitidaPPI(metodo: Metodo, ruta: string): boolean {
  const limpia = ruta.split('?')[0].replace(/^\/+/, '');
  return PERMITIDAS.some(p => p.metodo === metodo && p.ruta.test(limpia));
}

export class RutaProhibidaPPI extends Error {
  constructor(metodo: Metodo, ruta: string) {
    super(`[ppi] ruta fuera de la lista blanca, no se envía: ${metodo} ${ruta.split('?')[0]}`);
  }
}

export class CredencialesPPIInvalidas extends Error {
  constructor(status: number, cuerpo: string) {
    super(`[ppi] credenciales inválidas (LoginApi HTTP ${status}: ${cuerpo})`);
  }
}

export class ErrorPPI extends Error {
  constructor(public status: number, ruta: string, cuerpo: string) {
    super(`[ppi] ${ruta.split('?')[0]} → HTTP ${status}: ${cuerpo}`);
  }
}

export type CredencialesPPI = { authorizedClient: string; clientKey: string; apiKey: string; apiSecret: string };
export type FetchPPI = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ status: number; text(): Promise<string> }>;

/** Tapa todo lo que parezca token en un cuerpo, para mensajes de error. */
export function taparTokens(texto: string): string {
  return texto
    .replace(/("(?:access|refresh)Token"\s*:\s*")[^"]*"/gi, '$1<tapado>"')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt tapado>')
    .slice(0, 400);
}

type Token = { access: string; refresh: string; venceMs: number };

/**
 * Cliente con el token cacheado en memoria de la instancia (dura 8 h). Antes de vencer (5 min de
 * margen) se refresca con el Bearer anterior; si el refresh falla, se vuelve a loguear. Un 401 en
 * una llamada fuerza un refresh y UN reintento.
 */
export function crearClientePPI(cred: CredencialesPPI, opciones: { fetchImpl?: FetchPPI; ahora?: () => number } = {}) {
  const f = opciones.fetchImpl ?? (fetch as unknown as FetchPPI);
  const ahora = opciones.ahora ?? Date.now;
  let token: Token | null = null;
  const comunes = () => ({ AuthorizedClient: cred.authorizedClient, ClientKey: cred.clientKey, Accept: 'application/json' });

  async function pedir(metodo: Metodo, ruta: string, headers: Record<string, string>, body?: unknown) {
    if (!rutaPermitidaPPI(metodo, ruta)) throw new RutaProhibidaPPI(metodo, ruta);
    // Timeout propio: si PPI cuelga, no se come el tiempo del cron (el respaldo se usa justo cuando
    // data912 está caído y todas las especies van a PPI).
    const res = await f(BASE_PPI + ruta.replace(/^\/+/, ''), {
      signal: AbortSignal.timeout(15_000),
      method: metodo,
      headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const texto = await res.text();
    let json: unknown = texto;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* queda como texto */ }
    return { status: res.status, json, texto };
  }

  const aToken = (json: unknown): Token => {
    const o = (Array.isArray(json) ? json[0] : json) as { accessToken?: unknown; refreshToken?: unknown; expires?: unknown } | null;
    const access = typeof o?.accessToken === 'string' ? o.accessToken : '';
    if (!access) throw new Error('[ppi] la respuesta de login no trae accessToken');
    const seg = typeof o?.expires === 'number' && o.expires > 0 ? o.expires : 8 * 3600;
    return { access, refresh: typeof o?.refreshToken === 'string' ? o.refreshToken : '', venceMs: ahora() + seg * 1000 };
  };

  async function login(): Promise<Token> {
    const r = await pedir('POST', 'Account/LoginApi', { ...comunes(), ApiKey: cred.apiKey, ApiSecret: cred.apiSecret });
    if (r.status === 400 || r.status === 401) throw new CredencialesPPIInvalidas(r.status, taparTokens(r.texto));
    if (r.status !== 200) throw new ErrorPPI(r.status, 'Account/LoginApi', taparTokens(r.texto));
    return aToken(r.json);
  }

  async function refrescar(t: Token): Promise<Token> {
    if (!t.refresh) return login();
    const r = await pedir('POST', 'Account/RefreshToken', { ...comunes(), Authorization: `Bearer ${t.access}` }, { refreshToken: t.refresh });
    if (r.status !== 200) return login();
    try { return aToken(r.json); } catch { return login(); }
  }

  async function vigente(): Promise<Token> {
    if (!token) token = await login();
    else if (ahora() > token.venceMs - 5 * 60_000) token = await refrescar(token);
    return token;
  }

  /** GET autenticado. Devuelve el JSON; un status ≠ 200 tira `ErrorPPI` con el cuerpo tapado. */
  async function get(ruta: string): Promise<unknown> {
    if (!rutaPermitidaPPI('GET', ruta)) throw new RutaProhibidaPPI('GET', ruta);
    let t = await vigente();
    let r = await pedir('GET', ruta, { ...comunes(), Authorization: `Bearer ${t.access}` });
    if (r.status === 401) {
      t = token = await refrescar(t);
      r = await pedir('GET', ruta, { ...comunes(), Authorization: `Bearer ${t.access}` });
    }
    if (r.status !== 200) throw new ErrorPPI(r.status, ruta, taparTokens(r.texto));
    return r.json;
  }

  return { get, _estado: () => (token ? { vence: token.venceMs } : null) };
}

export type ClientePPI = ReturnType<typeof crearClientePPI>;

/** Cliente por instancia: el token se reutiliza entre ejecuciones del cron en la misma instancia. */
let clienteCacheado: { clave: string; cliente: ClientePPI } | null = null;
export function clientePPIDeInstancia(cred: CredencialesPPI): ClientePPI {
  const clave = `${cred.authorizedClient}|${cred.clientKey}|${cred.apiKey}`;
  if (!clienteCacheado || clienteCacheado.clave !== clave) clienteCacheado = { clave, cliente: crearClientePPI(cred) };
  return clienteCacheado.cliente;
}
