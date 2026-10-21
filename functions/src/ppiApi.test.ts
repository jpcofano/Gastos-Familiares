// F9.196 H2a — cliente de producción de PPI: lista blanca, login (400 = credenciales inválidas),
// token cacheado, refresh con el Bearer anterior, reintento en 401 y errores sin tokens. Sin red: el
// fetch es falso. Correr: npx tsx functions/src/ppiApi.test.ts   → exit 1 si algo falla.
import { crearClientePPI, rutaPermitidaPPI, RutaProhibidaPPI, CredencialesPPIInvalidas, ErrorPPI, taparTokens, type FetchPPI } from './ppiApi';

let ok = 0, fail = 0;
function t(rotulo: string, cond: boolean, detalle?: unknown) {
  if (cond) { ok++; console.log(`  OK   ${rotulo}`); }
  else { fail++; console.log(`  FAIL ${rotulo}${detalle !== undefined ? `\n       ${JSON.stringify(detalle)}` : ''}`); }
}
const cred = { authorizedClient: 'ac', clientKey: 'ck', apiKey: 'ak', apiSecret: 'as' };
type Llamada = { url: string; method: string; headers: Record<string, string>; body?: string };
function falso(responder: (l: Llamada, n: number) => { status: number; body: unknown }) {
  const llamadas: Llamada[] = [];
  const f: FetchPPI = async (url, init) => {
    const l = { url, ...init };
    llamadas.push(l);
    const r = responder(l, llamadas.length);
    return { status: r.status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
  return { f, llamadas };
}
const tokenOk = (access: string, expires = 28799) => ({ creationDate: '', expirationDate: '', accessToken: access, refreshToken: `r-${access}`, expires, tokenType: 'bearer' });

(async () => {
  console.log('=== lista blanca ===');
  for (const r of ['Order/Budget', 'Order/Confirm', 'Order/Cancel', 'Account/BankAccount', 'Account/ForeignBankAccount', 'Account/InvestingProfile', 'InterestBearingAccount/MassOperation', 'Account/Accounts/../../Order/Budget']) {
    t(`GET ${r} no permitido`, !rutaPermitidaPPI('GET', r) && !rutaPermitidaPPI('POST', r));
  }
  t('lectura permitida (BalancesAndPositions, Movements, MarketData/*, Configuration/*)',
    ['Account/BalancesAndPositions?accountNumber=1', 'Account/Movements', 'MarketData/Current?Ticker=X', 'MarketData/SearchInstrument', 'Configuration/Settlements'].every(r => rutaPermitidaPPI('GET', r)));
  {
    const { f, llamadas } = falso(() => ({ status: 200, body: tokenOk('a1') }));
    const c = crearClientePPI(cred, { fetchImpl: f });
    let error: unknown = null;
    try { await c.get('Order/Budget'); } catch (e) { error = e; }
    t('get("Order/Budget") tira RutaProhibida SIN hacer red (ni siquiera login)', error instanceof RutaProhibidaPPI && llamadas.length === 0);
  }

  console.log('\n=== login ===');
  {
    const { f } = falso(() => ({ status: 400, body: 'Credenciales invalidas.' }));
    let error: unknown = null;
    try { await crearClientePPI(cred, { fetchImpl: f }).get('Account/Accounts'); } catch (e) { error = e; }
    t('LoginApi 400 → CredencialesPPIInvalidas (la doc dice 401, la realidad es 400)', error instanceof CredencialesPPIInvalidas, String(error));
  }
  {
    const { f, llamadas } = falso(l => (l.url.endsWith('LoginApi') ? { status: 200, body: tokenOk('a1') } : { status: 200, body: [] }));
    const c = crearClientePPI(cred, { fetchImpl: f });
    await c.get('Account/Accounts'); await c.get('Account/Accounts');
    const logins = llamadas.filter(l => l.url.endsWith('LoginApi'));
    t('token cacheado: dos lecturas, un solo login', logins.length === 1);
    t('el login lleva AuthorizedClient, ClientKey, ApiKey y ApiSecret', logins[0].headers.AuthorizedClient === 'ac' && logins[0].headers.ApiKey === 'ak' && logins[0].headers.ApiSecret === 'as');
    const lect = llamadas.filter(l => !l.url.endsWith('LoginApi'));
    t('las lecturas van con Bearer y sin ApiSecret', lect.every(l => l.headers.Authorization === 'Bearer a1' && !l.headers.ApiSecret));
    t('base de producción', llamadas[0].url.startsWith('https://clientapi.portfoliopersonal.com/api/1.0/'));
  }

  console.log('\n=== refresh ===');
  {
    let ahora = 1_000_000;
    const { f, llamadas } = falso(l => {
      if (l.url.endsWith('LoginApi')) return { status: 200, body: tokenOk('a1', 3600) };
      if (l.url.endsWith('RefreshToken')) return { status: 200, body: tokenOk('a2', 3600) };
      return { status: 200, body: [] };
    });
    const c = crearClientePPI(cred, { fetchImpl: f, ahora: () => ahora });
    await c.get('Account/Accounts');
    ahora += 3600_000 - 60_000;   // a 1 minuto de vencer
    await c.get('Account/Accounts');
    const ref = llamadas.find(l => l.url.endsWith('RefreshToken'));
    t('cerca del vencimiento refresca con el Bearer ANTERIOR y el refreshToken en el body',
      !!ref && ref.headers.Authorization === 'Bearer a1' && JSON.parse(ref.body ?? '{}').refreshToken === 'r-a1');
    t('después del refresh usa el token nuevo', llamadas[llamadas.length - 1].headers.Authorization === 'Bearer a2');
  }
  {
    const { f, llamadas } = falso((l, n) => {
      if (l.url.endsWith('LoginApi')) return { status: 200, body: tokenOk('a1') };
      if (l.url.endsWith('RefreshToken')) return { status: 200, body: tokenOk('a2') };
      return n === 2 ? { status: 401, body: 'vencido' } : { status: 200, body: { ok: 1 } };
    });
    const r = await crearClientePPI(cred, { fetchImpl: f }).get('Account/Accounts');
    t('un 401 refresca y reintenta UNA vez', JSON.stringify(r) === '{"ok":1}' && llamadas.filter(l => l.url.endsWith('RefreshToken')).length === 1);
  }

  console.log('\n=== errores sin tokens ===');
  {
    const { f } = falso(l => (l.url.endsWith('LoginApi') ? { status: 200, body: tokenOk('a1') } : { status: 500, body: { accessToken: 'secreto', detalle: 'x' } }));
    let error: unknown = null;
    try { await crearClientePPI(cred, { fetchImpl: f }).get('Account/Accounts'); } catch (e) { error = e; }
    t('un 500 tira ErrorPPI con ruta y status', error instanceof ErrorPPI && (error as ErrorPPI).status === 500);
    t('...y el cuerpo con el token tapado', !String(error).includes('secreto'), String(error));
    t('taparTokens tapa JWT y campos *Token', !taparTokens('{"refreshToken":"abc"} eyJhbGciOiJIUzI1.eyJzdWIi.firma').includes('abc') && !taparTokens('eyJhbGciOiJIUzI1.eyJzdWIi.firma').includes('eyJ'));
  }

  console.log(`\n${ok} OK, ${fail} FAIL`);
  if (fail) process.exit(1);
})();
