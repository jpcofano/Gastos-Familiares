// F9.196 H1b — lista blanca, nonce y firma del cliente de exploración de Bitfinex. Sin red: el
// fetch es falso y cuenta las llamadas. Uso: npx tsx scripts/bitfinexCliente.test.ts → exit 1 si falla.
import * as crypto from 'crypto';
import { pedirBitfinex, rutaPermitida, crearNonce, firmar, RutaProhibida, type FetchLike } from './bitfinexCliente';

let fallas = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) fallas++; };

let llamadas = 0;
let ultimo: { url: string; headers: Record<string, string>; body?: string } | null = null;
const fetchFalso: FetchLike = async (url, init) => {
  llamadas++;
  ultimo = { url, headers: init.headers, body: init.body };
  return { status: 200, text: async () => '[]' };
};
const cred = { key: 'k-falsa', secret: 's-falso' };

async function rechaza(endpoint: string): Promise<boolean> {
  const antes = llamadas;
  try { await pedirBitfinex(cred, crearNonce(), endpoint, {}, { fetchImpl: fetchFalso }); return false; }
  catch (e) { return e instanceof RutaProhibida && llamadas === antes; }
}

(async () => {
  console.log('=== escritura bloqueada antes de salir, sin red ===');
  for (const e of ['auth/w/order/submit', 'auth/w/withdraw', 'auth/w/transfer', 'auth/w/funding/offer/submit',
    'auth/w/deposit/address', 'auth/calc/order/avail', 'auth/r/../w/withdraw', 'auth/r/', 'w/auth/r/wallets', 'auth/r/wallets?x=1']) {
    ok(await rechaza(e), `rechaza ${e}`);
  }
  ok(llamadas === 0, 'ninguna rechazada tocó la red');

  console.log('\n=== lectura permitida ===');
  for (const e of ['auth/r/permissions', 'auth/r/wallets', 'auth/r/funding/credits', 'auth/r/funding/credits/fUSD',
    'auth/r/ledgers/hist', 'auth/r/ledgers/USD/hist', 'auth/r/movements/hist', 'auth/r/trades/tBTC:USD/hist']) {
    ok(rutaPermitida(e), `permite ${e}`);
  }

  console.log('\n=== nonce en milisegundos, estrictamente creciente ===');
  let t = 1_760_000_000_000;
  const reloj = () => t;
  const nonce = crearNonce(reloj);
  const a = nonce(), b = nonce(); t -= 5; const c = nonce(); t += 1000; const d = nonce();
  ok(Number(b) > Number(a) && Number(c) > Number(b) && Number(d) > Number(c), 'crece aunque el reloj no avance o retroceda');
  ok(a.length === 13, 'milisegundos (13 dígitos), no microsegundos');

  console.log('\n=== firma ===');
  const esperada = crypto.createHmac('sha384', 's-falso').update('/api/v2/auth/r/wallets1760000000000{}').digest('hex');
  ok(firmar('s-falso', 'auth/r/wallets', '1760000000000', '{}') === esperada && esperada.length === 96, 'HMAC-SHA384 hex de /api/v2/<endpoint> + nonce + body');
  await pedirBitfinex(cred, crearNonce(reloj), 'auth/r/wallets', {}, { fetchImpl: fetchFalso });
  const u = ultimo!;
  ok(u.url === 'https://api.bitfinex.com/v2/auth/r/wallets' && u.body === '{}', 'manda body {} a api.bitfinex.com/v2');
  ok(u.headers['bfx-signature'] === firmar('s-falso', 'auth/r/wallets', u.headers['bfx-nonce'], '{}') && u.headers['bfx-apikey'] === 'k-falsa',
    'la firma enviada es la del body {} con el nonce enviado');
  await pedirBitfinex(cred, crearNonce(reloj), 'auth/r/wallets', {}, { fetchImpl: fetchFalso, conBody: false });
  ok(ultimo!.body === undefined && ultimo!.headers['bfx-signature'] === firmar('s-falso', 'auth/r/wallets', ultimo!.headers['bfx-nonce'], ''), 'fallback sin body: firma sin body');

  console.log(`\n${fallas === 0 ? 'OK — todo verde' : `${fallas} FALLA(S)`}`);
  if (fallas) process.exit(1);
})();
