// F9.196 H1 en vivo — exploración de la API de PPI, solo lectura (docs/prompts/F9.196-h1-ppi-en-vivo.md).
// Uso: npx tsx scripts/explorarPPI.ts
//
// - Credenciales: %OneDrive%\.secrets\gastos-familiares.env, con el parser mínimo de ./ppiCliente.
//   Nunca se imprimen valores, headers ni tokens.
// - Rutas: solo la lista blanca de ./ppiCliente (cualquier otra tira error antes de salir).
// - Respuestas crudas → data/ppi-exploracion/ (gitignored por `data/*`), con los tokens tapados.
//   Por consola sale solo la FORMA (claves, tipos, cantidades), no montos ni el número de cuenta.
import * as fs from 'fs';
import * as path from 'path';
import { pedirPPI, leerEnv, sinTokens, BASE_PRODUCCION, BASE_SANDBOX, type Metodo, type Respuesta } from './ppiCliente';

const REQUERIDAS = ['PPI_API_KEY', 'PPI_API_SECRET', 'PPI_AUTHORIZED_CLIENT', 'PPI_CLIENT_KEY', 'PPI_ACCOUNT_NUMBER', 'PPI_ENTORNO'];
const SALIDA = path.join(__dirname, '..', 'data', 'ppi-exploracion');

const ahoraArt = () => new Date(Date.now() - 3 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
const isoFecha = (d: Date) => d.toISOString().slice(0, 10);

/** Forma de un valor: tipos y claves, nunca valores. */
function forma(x: unknown, prof = 0): string {
  if (x === null) return 'null';
  if (Array.isArray(x)) return x.length ? `array(${x.length})<${forma(x[0], prof + 1)}>` : 'array(0)';
  if (typeof x === 'object') {
    if (prof > 4) return 'object{…}';
    return '{' + Object.entries(x as Record<string, unknown>).map(([k, v]) => `${k}: ${forma(v, prof + 1)}`).join(', ') + '}';
  }
  return typeof x;
}

let n = 0;
function guardar(nombre: string, r: Respuesta | Record<string, unknown>) {
  n++;
  const archivo = path.join(SALIDA, `${String(n).padStart(2, '0')}-${nombre}.json`);
  const datos = 'status' in r && 'body' in r ? { ...r, body: sinTokens((r as Respuesta).body) } : r;
  fs.writeFileSync(archivo, JSON.stringify({ guardadoArt: ahoraArt(), ...datos }, null, 2));
}

async function main() {
  const rutaEnv = path.join(process.env.OneDrive ?? '', '.secrets', 'gastos-familiares.env');
  if (!process.env.OneDrive || !fs.existsSync(rutaEnv)) {
    console.error('[ppi] no encuentro %OneDrive%\\.secrets\\gastos-familiares.env');
    process.exit(2);
  }
  const env = leerEnv(rutaEnv);
  const faltan = REQUERIDAS.filter(k => !env[k]);
  if (faltan.length) {
    console.error(`[ppi] faltan variables (sin valor o ausentes): ${faltan.join(', ')}`);
    process.exit(2);
  }
  const entorno = env.PPI_ENTORNO.toLowerCase();
  const base = /^(prod|produccion|producción|production)$/.test(entorno) ? BASE_PRODUCCION
    : /sandbox|sbx|test/.test(entorno) ? BASE_SANDBOX : null;
  if (!base) { console.error('[ppi] PPI_ENTORNO no es ni producción ni sandbox'); process.exit(2); }
  fs.mkdirSync(SALIDA, { recursive: true });
  console.log(`[ppi] ${ahoraArt()} ART · base ${new URL(base).host}`);

  const cuenta = env.PPI_ACCOUNT_NUMBER;
  const comunes = { AuthorizedClient: env.PPI_AUTHORIZED_CLIENT, ClientKey: env.PPI_CLIENT_KEY };
  let token = '';
  const pedir = async (metodo: Metodo, ruta: string, nombre: string, body?: unknown, conBearer = true) => {
    const h: Record<string, string> = { ...comunes, ...(conBearer && token ? { Authorization: `Bearer ${token}` } : {}) };
    const r = await pedirPPI(base, metodo, ruta, h, body);
    guardar(nombre, r);
    return r;
  };
  const corto = (b: unknown) => (typeof b === 'string' ? b : JSON.stringify(b)).slice(0, 300);

  // ── 1–2. Login ───────────────────────────────────────────────────────────
  const login = async () => pedirPPI(base, 'POST', 'Account/LoginApi', {
    ...comunes, ApiKey: env.PPI_API_KEY, ApiSecret: env.PPI_API_SECRET,
  });
  let rl = await login();
  guardar('login', rl);
  console.log(`[1] LoginApi → HTTP ${rl.status} (${rl.ms} ms) · forma ${forma(sinTokens(rl.body))}`);
  if (rl.status === 401) {
    console.log(`    401: cuerpo ${corto(rl.body)} · reintento UNA vez`);
    rl = await login();
    guardar('login-reintento', rl);
    console.log(`    reintento → HTTP ${rl.status} · cuerpo ${rl.status === 200 ? '(ok)' : corto(rl.body)}`);
  }
  if (rl.status !== 200) { console.log('[ppi] sin login no sigo.'); return; }
  const tok = (Array.isArray(rl.body) ? rl.body[0] : rl.body) as Record<string, unknown>;
  token = String(tok.accessToken ?? '');
  const refresh0 = String(tok.refreshToken ?? '');
  const dur = (Date.parse(String(tok.expirationDate)) - Date.parse(String(tok.creationDate))) / 1000;
  console.log(`    respuesta es ${Array.isArray(rl.body) ? 'ARRAY' : 'OBJETO'} · expires=${tok.expires} · expirationDate−creationDate=${dur} s · tokenType=${tok.tokenType}`);
  guardar('login-resumen', { esArray: Array.isArray(rl.body), expires: tok.expires, duracionSegunFechas: dur, creationDate: tok.creationDate, expirationDate: tok.expirationDate, tokenType: tok.tokenType });

  // Refresh: primero SIN Bearer; si falla, con el Bearer viejo.
  const tokenViejo = token;
  let rr = await pedir('POST', 'Account/RefreshToken', 'refresh-sin-bearer', { refreshToken: refresh0 }, false);
  let necesitaBearer = false;
  console.log(`[2] RefreshToken sin Bearer → HTTP ${rr.status}${rr.status !== 200 ? ` · ${corto(rr.body)}` : ''}`);
  if (rr.status !== 200) {
    rr = await pedir('POST', 'Account/RefreshToken', 'refresh-con-bearer', { refreshToken: refresh0 }, true);
    necesitaBearer = rr.status === 200;
    console.log(`    con Bearer viejo → HTTP ${rr.status}${rr.status !== 200 ? ` · ${corto(rr.body)}` : ''}`);
  }
  if (rr.status === 200) {
    const t2 = (Array.isArray(rr.body) ? rr.body[0] : rr.body) as Record<string, unknown>;
    const rota = String(t2.refreshToken ?? '') !== refresh0;
    const cambiaAccess = String(t2.accessToken ?? '') !== tokenViejo;
    token = String(t2.accessToken ?? token);
    console.log(`    respuesta ${Array.isArray(rr.body) ? 'ARRAY' : 'OBJETO'} · refreshToken rota: ${rota} · accessToken nuevo: ${cambiaAccess} · expires=${t2.expires}`);
    // ¿El access token viejo sigue sirviendo después del refresh?
    const r = await pedirPPI(base, 'GET', 'Account/Accounts', { ...comunes, Authorization: `Bearer ${tokenViejo}` });
    console.log(`    access token viejo después del refresh → HTTP ${r.status}`);
    guardar('refresh-resumen', { necesitaBearer, refreshRota: rota, accessNuevo: cambiaAccess, expires: t2.expires, tokenViejoDespues: r.status });
  }

  // ── 3. Accounts ──────────────────────────────────────────────────────────
  const ra = await pedir('GET', 'Account/Accounts', 'accounts');
  const cuentas = Array.isArray(ra.body) ? ra.body as Array<Record<string, unknown>> : [];
  console.log(`[3] Accounts → HTTP ${ra.status} · ${cuentas.length} cuenta(s) · forma ${forma(ra.body)}`);
  for (const c of cuentas) {
    const num = String(c.accountNumber ?? '');
    console.log(`    accountNumber: ${num.length} caracteres, ${/^\d+$/.test(num) ? 'solo dígitos' : 'NO solo dígitos'}, coincide con PPI_ACCOUNT_NUMBER: ${num === cuenta} · externalID ${c.externalID === null || c.externalID === undefined ? 'vacío' : typeof c.externalID} · owners ${Array.isArray(c.owners) ? c.owners.length : typeof c.owners}`);
  }

  // ── 4. Saldos y posiciones ───────────────────────────────────────────────
  const q = `accountNumber=${encodeURIComponent(cuenta)}`;
  const rab = await pedir('GET', `Account/AvailableBalance?${q}`, 'available-balance');
  console.log(`[4] AvailableBalance → HTTP ${rab.status} · forma ${forma(rab.body)}`);
  const rbp = await pedir('GET', `Account/BalancesAndPositions?${q}`, 'balances-positions');
  console.log(`    BalancesAndPositions → HTTP ${rbp.status} · forma ${forma(rbp.body)}`);

  // ── 5. Movimientos ───────────────────────────────────────────────────────
  const hoy = new Date();
  const hace = (dias: number) => new Date(hoy.getTime() - dias * 86_400_000);
  const formatos: Array<[string, (d: Date) => string]> = [
    ['YYYY-MM-DD', isoFecha],
    ['ISO completo', d => d.toISOString()],
  ];
  let formatoOk: [string, (d: Date) => string] | null = null;
  for (const [nombre, fmt] of formatos) {
    const r = await pedir('GET', `Account/Movements?${q}&dateFrom=${encodeURIComponent(fmt(hace(90)))}&dateTo=${encodeURIComponent(fmt(hoy))}`, `movements-90d-${nombre.replace(/\W+/g, '')}`);
    console.log(`[5] Movements 90 días, fechas ${nombre} → HTTP ${r.status} · ${Array.isArray(r.body) ? `${r.body.length} movimientos` : corto(r.body)}`);
    if (r.status === 200 && !formatoOk) formatoOk = [nombre, fmt];
  }
  if (formatoOk) {
    for (const dias of [365, 1095]) {
      const r = await pedir('GET', `Account/Movements?${q}&dateFrom=${encodeURIComponent(formatoOk[1](hace(dias)))}&dateTo=${encodeURIComponent(formatoOk[1](hoy))}`, `movements-${dias}d`);
      const arr = Array.isArray(r.body) ? r.body as Array<Record<string, unknown>> : null;
      const fechas = arr?.map(m => String(m.agreementDate ?? m.settlementDate ?? '')).filter(Boolean).sort() ?? [];
      console.log(`    rango ${dias} días → HTTP ${r.status} · ${arr ? `${arr.length} movimientos, ${fechas[0]?.slice(0, 10)} .. ${fechas[fechas.length - 1]?.slice(0, 10)}` : corto(r.body)}`);
    }
  }

  // ── 6. Configuración y MarketData ────────────────────────────────────────
  const rt = await pedir('GET', 'Configuration/InstrumentTypes', 'instrument-types');
  const rs = await pedir('GET', 'Configuration/Settlements', 'settlements');
  console.log(`[6] InstrumentTypes → HTTP ${rt.status} · ${corto(rt.body)}`);
  console.log(`    Settlements → HTTP ${rs.status} · ${corto(rs.body)}`);
  const especies: Array<[string, string]> = [['YPFD', 'ACCIONES'], ['PAMP', 'ACCIONES'], ['GGAL', 'ACCIONES'], ['GLOB', 'CEDEARS'], ['TLCPO', 'ON']];
  const plazos = Array.isArray(rs.body) && rs.body.length ? (rs.body as string[]) : ['INMEDIATA', 'A-24HS'];
  for (const [ticker, tipo] of especies) {
    const si = await pedir('GET', `MarketData/SearchInstrument?Ticker=${ticker}`, `search-${ticker}`);
    console.log(`    SearchInstrument ${ticker} → HTTP ${si.status} · ${corto(si.body)}`);
    for (const plazo of plazos) {
      const r = await pedir('GET', `MarketData/Current?Ticker=${ticker}&Type=${tipo}&Settlement=${plazo}`, `current-${ticker}-${plazo}`);
      const b = r.body as Record<string, unknown> | null;
      console.log(`    Current ${ticker} ${tipo} ${plazo} → HTTP ${r.status} · ${r.status === 200 && b && typeof b === 'object' ? `price ${b.price} · date ${b.date} · prevClose ${b.previousClose}` : corto(r.body)}`);
    }
  }
  // ¿Distingue mayúsculas en Type?
  const rc = await pedir('GET', 'MarketData/Current?Ticker=GGAL&Type=Acciones&Settlement=A-24HS', 'current-GGAL-mayusculas');
  console.log(`    Type=Acciones (mixto) → HTTP ${rc.status} · ${rc.status === 200 ? 'acepta' : corto(rc.body)}`);

  // ── 7. Límites: 50 seguidas SOLO a MarketData/Current ────────────────────
  const intentos: Array<{ i: number; status: number; ms: number; limite: Record<string, string> }> = [];
  for (let i = 1; i <= 50; i++) {
    const r = await pedirPPI(base, 'GET', 'MarketData/Current?Ticker=GGAL&Type=ACCIONES&Settlement=A-24HS', { ...comunes, Authorization: `Bearer ${token}` });
    const limite = Object.fromEntries(Object.entries(r.headers).filter(([k]) => /rate|limit|retry|throttl|quota/i.test(k)));
    intentos.push({ i, status: r.status, ms: r.ms, limite });
    if (r.status === 429) { guardar('limite-429', r); break; }
  }
  const porStatus = intentos.reduce<Record<number, number>>((a, x) => ({ ...a, [x.status]: (a[x.status] ?? 0) + 1 }), {});
  const ms = intentos.map(x => x.ms).sort((a, b) => a - b);
  guardar('limites-50', { intentos });
  console.log(`[7] ${intentos.length} llamadas seguidas → ${JSON.stringify(porStatus)} · ms mediana ${ms[Math.floor(ms.length / 2)]}, máx ${ms[ms.length - 1]} · headers de límite: ${JSON.stringify(intentos.find(x => Object.keys(x.limite).length)?.limite ?? {})}`);
  console.log(`[ppi] fin ${ahoraArt()} ART · ${n} archivos en data/ppi-exploracion/`);
}

main().catch(e => { console.error('[ppi] error:', e instanceof Error ? e.message : String(e)); process.exit(1); });
