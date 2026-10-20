// F9.196 H1 — la lista blanca del cliente de exploración de PPI. Sin red: el fetch es falso y
// cuenta las llamadas. Uso: npx tsx scripts/ppiCliente.test.ts   → exit 1 si algo falla.
import { pedirPPI, rutaPermitida, parsearEnv, sinTokens, RutaProhibida, BASE_PRODUCCION, type FetchLike } from './ppiCliente';

let fallas = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) fallas++; };

let llamadas = 0;
const fetchFalso: FetchLike = async () => {
  llamadas++;
  return { status: 200, headers: { forEach: () => {} }, text: async () => '{}' };
};

async function rechaza(metodo: 'GET' | 'POST', ruta: string): Promise<boolean> {
  const antes = llamadas;
  try {
    await pedirPPI(BASE_PRODUCCION, metodo, ruta, {}, undefined, fetchFalso);
    return false;
  } catch (e) {
    return e instanceof RutaProhibida && llamadas === antes;
  }
}

(async () => {
  console.log('=== rutas prohibidas: error antes de salir, sin red ===');
  ok(await rechaza('POST', 'Order/Budget'), 'POST Order/Budget');
  ok(await rechaza('GET', 'Order/Budget'), 'GET Order/Budget');
  for (const r of ['Order/Confirm', 'Order/Cancel', 'Order/MassCancel', 'Order/BudgetTransfer', 'Order/ConfirmTransfer']) {
    ok(await rechaza('POST', r), `POST ${r}`);
  }
  ok(await rechaza('POST', 'Account/BankAccount'), 'POST Account/BankAccount');
  ok(await rechaza('POST', 'Account/CancelBankAccount'), 'POST Account/CancelBankAccount');
  ok(await rechaza('POST', 'Account/BankAccountX'), 'POST Account/BankAccount* (cualquier sufijo)');
  ok(await rechaza('POST', 'Account/ForeignBankAccount'), 'POST Account/ForeignBankAccount');
  ok(await rechaza('POST', 'Account/InvestingProfile'), 'POST Account/InvestingProfile');
  ok(await rechaza('POST', 'InterestBearingAccount/MassOperation'), 'POST InterestBearingAccount/MassOperation');
  ok(await rechaza('POST', 'MarketData/Current'), 'POST a una ruta de lectura (MarketData solo GET)');
  ok(await rechaza('GET', 'Account/Accounts/../../Order/Budget'), 'no se cuela por path traversal');
  ok(await rechaza('GET', 'Configuration/Markets'), 'Configuration/* fuera de las dos permitidas');
  ok(llamadas === 0, 'ninguna de las prohibidas tocó la red');

  console.log('\n=== rutas permitidas ===');
  ok(rutaPermitida('POST', 'Account/LoginApi') && rutaPermitida('POST', 'Account/RefreshToken'), 'login y refresh');
  ok(rutaPermitida('GET', 'Account/BalancesAndPositions?accountNumber=1'), 'BalancesAndPositions con query');
  ok(rutaPermitida('GET', 'MarketData/Current?Ticker=GGAL&Type=ACCIONES&Settlement=A-24HS'), 'MarketData/Current');
  ok(rutaPermitida('GET', 'Configuration/InstrumentTypes') && rutaPermitida('GET', 'Configuration/Settlements'), 'Configuration de consulta');
  await pedirPPI(BASE_PRODUCCION, 'GET', 'Account/Accounts', {}, undefined, fetchFalso);
  ok(llamadas === 1, 'una permitida sí sale');

  console.log('\n=== parser de .env y tapado de tokens ===');
  const env = parsearEnv('# comentario\n\nA=1\n B = "dos" \nC=\'tres\'\nD = cuatro=4\r\n');
  ok(env.A === '1' && env.B === 'dos' && env.C === 'tres' && env.D === 'cuatro=4' && Object.keys(env).length === 4, 'clave=valor, comillas, espacios, comentarios');
  const tapado = JSON.stringify(sinTokens([{ accessToken: 'abc', refreshToken: 'de', expires: 1 }]));
  ok(!tapado.includes('abc') && !tapado.includes('"de"') && tapado.includes('"expires":1'), 'sinTokens no deja los tokens');

  console.log(`\n${fallas === 0 ? 'OK — todo verde' : `${fallas} FALLA(S)`}`);
  if (fallas) process.exit(1);
})();
