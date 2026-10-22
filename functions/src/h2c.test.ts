// F9.196 H2c — tests puros de la sincronización de Bitfinex: firma, nonce creciente, lista blanca,
// lector tolerante de funding, billeteras, ledgers e idempotencia. Sin red ni Firestore.
// Correr: npx tsx functions/src/h2c.test.ts   → exit 1 si algo falla.
import * as crypto from 'crypto';
import { crearClienteBitfinex, rutaPermitidaBitfinex, RutaProhibidaBitfinex, ErrorBitfinex, firmarBitfinex, crearNonceMs, type FetchBitfinex,
  rutaPublicaPermitidaBitfinex, preciosPublicosBitfinex } from './bitfinexApi';
import { leerBilleteras, leerFunding, movimientoDeLedger, planSincronizacionBitfinex, CATEGORIAS_LEDGER, tickersSinPrecio, precioConRespaldo } from './bitfinexSincronizacion';
import { aparearTransferencias } from './compartido/patrimonioFlujosAuto';
import { conCandado, tomarCandado, DURACION_CANDADO_MS, type DbCandado } from './candado';

/**
 * Firestore falso para el candado: las transacciones se serializan (como en Firestore, una no ve un
 * estado a medio escribir de la otra). Solo `locks`.
 */
function firestoreFalso(opciones: { reintentarDespuesDelCommit?: number } = {}) {
  const docs = new Map<string, Record<string, unknown>>();
  let cola: Promise<unknown> = Promise.resolve();
  let reintentos = opciones.reintentarDespuesDelCommit ?? 0;
  const ref = (id: string) => ({ id });
  const db = {
    collection: (_c: string) => ({ doc: (id: string) => ref(id) }),
    runTransaction: <T>(fn: (tx: unknown) => Promise<T>) => {
      const p = cola.then(async () => {
        const escrituras: Array<() => void> = [];
        const tx = {
          get: async (r: { id: string }) => { await new Promise(res => setTimeout(res, 5)); const d = docs.get(r.id); return { data: () => (d ? { ...d } : undefined) }; },
          set: (r: { id: string }, v: Record<string, unknown>) => { escrituras.push(() => docs.set(r.id, v)); },
          delete: (r: { id: string }) => { escrituras.push(() => docs.delete(r.id)); },
        };
        const out = await fn(tx);
        escrituras.forEach(e => e());
        // Como el SDK ante un error ambiguo en el commit: lo aplicado queda y el callback se reintenta.
        if (reintentos > 0) { reintentos--; escrituras.length = 0; const otra = await fn(tx); escrituras.forEach(e => e()); return otra; }
        return out;
      });
      cola = p.catch(() => undefined);
      return p;
    },
  };
  return { db: db as unknown as DbCandado, docs };
}
import type { MovimientoCuenta } from './compartido/patrimonioMovimientos';

let ok = 0, fail = 0;
function t(rotulo: string, cond: boolean, detalle?: unknown) {
  if (cond) { ok++; console.log(`  OK   ${rotulo}`); }
  else { fail++; console.log(`  FAIL ${rotulo}${detalle !== undefined ? `\n       ${JSON.stringify(detalle)}` : ''}`); }
}

(async () => {
  console.log('=== lista blanca, firma y nonce ===');
  for (const e of ['auth/w/order/submit', 'auth/w/withdraw', 'auth/w/transfer', 'auth/calc/order/avail', 'auth/r/../w/withdraw', 'auth/r/']) {
    t(`rechaza ${e}`, !rutaPermitidaBitfinex(e));
  }
  {
    let llamadas = 0;
    const f: FetchBitfinex = async () => { llamadas++; return { status: 200, text: async () => '[]' }; };
    const c = crearClienteBitfinex({ key: 'k', secret: 's' }, { fetchImpl: f, pausaMs: 0 });
    let err: unknown = null;
    try { await c.leer('auth/w/withdraw'); } catch (e) { err = e; }
    t('auth/w/* tira error antes de salir (sin red)', err instanceof RutaProhibidaBitfinex && llamadas === 0);
  }
  {
    let reloj = 1_760_000_000_000;
    const n = crearNonceMs(() => reloj);
    const a = Number(n()), b = Number(n()); reloj -= 10; const c = Number(n());
    t('nonce en ms (13 dígitos) estrictamente creciente aunque el reloj no avance o retroceda', String(a).length === 13 && b > a && c > b);
  }
  {
    let capturado: { url: string; headers: Record<string, string>; body: string } | null = null;
    const f: FetchBitfinex = async (url, init) => { capturado = { url, headers: init.headers, body: init.body }; return { status: 200, text: async () => '[]' }; };
    const c = crearClienteBitfinex({ key: 'k-falsa', secret: 's-falso' }, { fetchImpl: f, pausaMs: 0, nonce: () => '1760000000000' });
    await c.leer('auth/r/wallets');
    const esperada = crypto.createHmac('sha384', 's-falso').update('/api/v2/auth/r/wallets1760000000000{}').digest('hex');
    const cap = capturado!;
    t('firma HMAC-SHA384 hex de /api/v2/<endpoint> + nonce + {}', cap.headers['bfx-signature'] === esperada && firmarBitfinex('s-falso', 'auth/r/wallets', '1760000000000', '{}') === esperada);
    t('POST a api.bitfinex.com/v2 con body {} y sin limit', cap.url === 'https://api.bitfinex.com/v2/auth/r/wallets' && cap.body === '{}');
    const f2: FetchBitfinex = async () => ({ status: 500, text: async () => '["error",10020,"limit: invalid"]' });
    let err: unknown = null;
    try { await crearClienteBitfinex({ key: 'k', secret: 's' }, { fetchImpl: f2, pausaMs: 0 }).leer('auth/r/movements/hist'); } catch (e) { err = e; }
    t('["error",…] → ErrorBitfinex con el mensaje crudo', err instanceof ErrorBitfinex && String(err).includes('10020'));
  }

  console.log('\n=== billeteras ===');
  const precio = (tk: string) => ({ BTC: 80000, ETH: 2500, UNI: 7.5, AAVE: 150 } as Record<string, number>)[tk] ?? null;
  const wallets = [
    ['exchange', 'UST', 0.205, 0, 0.205, null, null],
    ['exchange', 'ETH', 5.1294, 0, 5.1294, null, null],
    ['exchange', 'BTC', 0.1, 0, 0.1, null, null],
    ['funding', 'BTC', 0.0042, 0, 0, null, null],
    ['exchange', 'USD', 12.5, 0, 12.5, null, null],
    ['exchange', 'COMP', 1, 0, 1, null, null],
  ];
  {
    const b = leerBilleteras(wallets, precio);
    const btc = b.posiciones.find(p => p.ticker === 'BTC');
    t('suma exchange + funding por activo (lo prestado sigue en la billetera funding)', !!btc && Math.abs((btc.cantidad ?? 0) - 0.1042) < 1e-12);
    t('UST → USDT, stablecoin a 1', b.posiciones.some(p => p.ticker === 'USDT' && p.sector === 'stablecoin' && p.valor_origen === 0.21));
    t('USD fiat → caja (saldos.USD)', b.saldos.USD === 12.5 && !b.posiciones.some(p => p.ticker === 'USD'));
    t('sin precio (COMP) → valor 0 y revisar con motivo', b.posiciones.some(p => p.ticker === 'COMP' && p.revisar && p.valor_origen === 0));
    t('detalle por billetera', b.porBilletera.funding.BTC === 0.0042);
    t('billetera con forma desconocida → para revisar, no rompe', leerBilleteras([...wallets, { raro: 1 }], precio).paraRevisar.length === 1);
  }

  console.log('\n=== funding: lector tolerante ===');
  {
    const credito = [26222883, 'fUST', 1, 1574013661000, 1574079687000, 350, null, 'ACTIVE', 'FIXED', null, null, 0.0024, 2, 1574013661000, 1574078487000, 0, null, null, 0, null, 0, 'tBTCUST'];
    const r = leerFunding('credits', [credito]);
    t('crédito con la forma de la doc → préstamo (símbolo, monto, tasa, período)', r.prestamos.length === 1 && r.prestamos[0].monto === 350 && r.prestamos[0].tasa === 0.0024 && r.prestamos[0].periodo === 2);
    const oferta = [652606505, 'fETH', 1574000611000, 1574000611000, 0.29797676, 0.29797676, 'LIMIT', null, null, 0, 'ACTIVE', null, null, null, 0.0002, 2, 0, null, null, 0, null];
    t('oferta con la forma de la doc', leerFunding('offers', [oferta]).prestamos[0]?.monto === 0.29797676);
    const rara = leerFunding('credits', [{ id: 1 }, ['x', 'no-es-simbolo', 3]]);
    t('fila con forma desconocida → para_revisar, sin romper', rara.prestamos.length === 0 && rara.paraRevisar.length === 2);
    t('respuesta que no es array → para_revisar', leerFunding('loans', { error: 1 }).paraRevisar.length === 1);
    t('vacío (lo de hoy) → sin préstamos ni avisos', leerFunding('credits', []).prestamos.length === 0 && leerFunding('credits', []).paraRevisar.length === 0);
  }

  console.log('\n=== ledgers → movimientos ===');
  const dep = [2531822314, 'UST', 'exchange', Date.UTC(2025, 11, 10, 15), null, 1930.4, 1930.4, null, 'Deposit (TETHERUSDTAVAX) #1 on wallet exchange'];
  const ret = [2531822315, 'UST', 'exchange', Date.UTC(2025, 9, 17, 15), null, -583.83, 0, null, 'Tetherusx Withdrawal #2 on wallet exchange'];
  const int = [2531822316, 'UST', 'funding', Date.UTC(2025, 7, 26, 15), null, 0.05, 0.05, null, 'Margin Funding Payment on wallet funding'];
  {
    const d = movimientoDeLedger(dep, CATEGORIAS_LEDGER.deposito, precio)!;
    const r = movimientoDeLedger(ret, CATEGORIAS_LEDGER.retiro, precio)!;
    const i = movimientoDeLedger(int, CATEGORIAS_LEDGER.interes, precio)!;
    t('101 → depósito EN ESPECIE (USDT, cantidad), id bfxmov_<ID>', d.tipo === 'deposito' && d.ticker === 'USDT' && d.cantidad === 1930.4 && d.tipoActivo === 'cripto' && d.id === 'bfxmov_2531822314');
    t('104 → retiro en especie, cantidad positiva', r.tipo === 'retiro' && r.cantidad === 583.83 && r.montoNeto === 583.83);
    t('28 → renta (interés de funding)', i.tipo === 'renta' && i.ticker === 'USDT' && i.montoNeto === 0.05);
    t('fecha en hora argentina', d.fecha === '2025-12-10' && r.origen === 'bitfinex_api');
    t('asiento con forma desconocida → null', movimientoDeLedger({ x: 1 }, 101, precio) === null);
  }

  console.log('\n=== plan e idempotencia ===');
  {
    const args = (ledger: unknown[][]) => ({
      wallets, funding: [{ origen: 'credits' as const, body: [] }, { origen: 'loans' as const, body: [{ raro: true }] }],
      ledgers: [{ categoria: 101 as const, filas: ledger.filter(l => l === dep) }, { categoria: 104 as const, filas: ledger.filter(l => l === ret) }, { categoria: 28 as const, filas: ledger.filter(l => l === int) }],
      leidoEnISO: '2026-10-21T12:20:00Z', precioUsd: precio,
    });
    const p1 = planSincronizacionBitfinex(args([dep, ret, int]));
    const p2 = planSincronizacionBitfinex(args([dep, ret, int, dep]));   // página que se pisa
    t('mismos asientos dos veces (páginas que se pisan) → mismos movimientos, sin duplicar', JSON.stringify(p1.movimientos) === JSON.stringify(p2.movimientos) && p1.movimientos.length === 3);
    t('re-sincronizar da los mismos ids', planSincronizacionBitfinex(args([dep, ret, int])).movimientos.map(m => m.id).join() === p1.movimientos.map(m => m.id).join());
    t('funding raro → para revisar en la cuenta viva, la sincronización sigue', (p1.cuentaViva.paraRevisar ?? []).some(r => r.ticker === 'funding/loans'));
    t('cuenta "Bitfinex", fuente bitfinex_api, historialCompleto', p1.cuentaViva.cuenta === 'Bitfinex' && p1.cuentaViva.fuente === 'bitfinex_api' && p1.cuentaViva.historialCompleto);
    // §C: un retiro de USDT de Bitfinex y su llegada a otra cuenta, regla de cripto (mismo activo, ≤ 3 días).
    const llegada: MovimientoCuenta = { id: 'x1', fecha: '2025-10-18', cuenta: 'Nexo', tipo: 'deposito', moneda: 'USD', montoNeto: 583, origen: 'manual', ticker: 'USDT', cantidad: 583.5, tipoActivo: 'cripto' };
    const retiro = p1.movimientos.find(m => m.tipo === 'retiro')!;
    t('el retiro de Bitfinex aparea con su llegada (cripto: mismo activo, comisión ≤ 1%, ≤ 3 días)', aparearTransferencias([retiro, llegada]).internas.length === 1);
  }

  console.log('\n=== F9.196.1 §3: un solo cliente a la vez (candado locks/bitfinex) ===');
  {
    const { db, docs } = firestoreFalso();
    let llamadas = 0;
    const f: FetchBitfinex = async () => { llamadas++; await new Promise(r => setTimeout(r, 30)); return { status: 200, text: async () => '[]' }; };
    const cliente = crearClienteBitfinex({ key: 'k', secret: 's' }, { fetchImpl: f, pausaMs: 0 });
    const correr = (quien: string) => conCandado(db, 'bitfinex', quien, () => cliente.leer('auth/r/wallets'));
    const [a, b] = await Promise.all([correr('cron'), correr('boton')]);
    t('dos corridas simultáneas → una sola llama a la API', llamadas === 1 && [a, b].filter(x => x.corrio).length === 1, { llamadas, a: a.corrio, b: b.corrio });
    t('la que no corrió sabe quién lo tiene y hasta cuándo', [a, b].some(x => !x.corrio && x.quien !== null && x.hasta > Date.now()));
    t('al terminar se libera: la siguiente corre', docs.size === 0 && (await correr('boton')).corrio && llamadas === 2);
    let fallo = false;
    try { await conCandado(db, 'bitfinex', 'cron', async () => { throw new Error('API caída'); }); } catch { fallo = true; }
    t('si falla, también se libera', fallo && docs.size === 0);
    // Un candado vencido (una instancia que murió sin liberar) no bloquea.
    docs.set('bitfinex', { hasta: Date.now() - 1, quien: 'muerto', token: 'x' });
    t('un candado vencido no bloquea', (await correr('cron')).corrio && DURACION_CANDADO_MS > 300_000);
    // Uno vigente de otro sí, y no se lo sacan.
    docs.set('bitfinex', { hasta: Date.now() + 60_000, quien: 'otro', token: 'y' });
    const c = await correr('boton');
    t('uno vigente de otro bloquea y queda intacto', !c.corrio && (docs.get('bitfinex') as { token?: string } | undefined)?.token === 'y');
  }
  {
    // Revisión de H3: A vence, B lo toma y A libera → el de B queda intacto.
    const { db, docs } = firestoreFalso();
    let reloj = 1_000_000;
    const ahora = () => reloj;
    const a = await tomarCandado(db, 'bitfinex', 'A', ahora);
    reloj += DURACION_CANDADO_MS + 1;
    const b = await tomarCandado(db, 'bitfinex', 'B', ahora);
    if (a.tomado) await a.liberar();
    t('el que venció no libera el candado del que lo tomó después', a.tomado && b.tomado && (docs.get('bitfinex') as { quien?: string } | undefined)?.quien === 'B');
  }
  {
    // Un reintento del SDK después de un commit aplicado no deja el candado huérfano ni bloquea al que lo tomó.
    const { db, docs } = firestoreFalso({ reintentarDespuesDelCommit: 1 });
    const c = await tomarCandado(db, 'bitfinex', 'cron');
    t('toma idempotente ante un reintento del SDK', c.tomado && docs.size === 1);
    if (c.tomado) await c.liberar();
    t('...y se libera bien', docs.size === 0);
  }
  {
    // Plazo de la corrida: pasado `hastaMs`, el cliente no llama a la API.
    let llamadas = 0;
    const f: FetchBitfinex = async () => { llamadas++; return { status: 200, text: async () => '[]' }; };
    const c = crearClienteBitfinex({ key: 'k', secret: 's' }, { fetchImpl: f, pausaMs: 0, hastaMs: Date.now() - 1 });
    let err: unknown = null;
    try { await c.leer('auth/r/wallets'); } catch (e) { err = e; }
    t('pasado el plazo de la corrida no sale ninguna llamada', llamadas === 0 && err instanceof Error);
  }

  console.log('\n=== F9.196 nota de revisión 2: precio de respaldo del ticker público ===');
  {
    t('lista blanca pública: solo api-pub tickers tXXXUSD / tXXXX:USD',
      rutaPublicaPermitidaBitfinex('https://api-pub.bitfinex.com/v2/tickers?symbols=tBTCUSD,tAAVE:USD')
      && !rutaPublicaPermitidaBitfinex('https://api.bitfinex.com/v2/auth/r/wallets')
      && !rutaPublicaPermitidaBitfinex('https://api-pub.bitfinex.com/v2/tickers?symbols=tBTCUSD&x=1')
      && !rutaPublicaPermitidaBitfinex('https://api-pub.bitfinex.com/v2/candles/trade:1m:tBTCUSD/hist'));
    let urlPedida = '';
    const pedir = async (url: string) => { urlPedida = url; return { status: 200, body: [['tBTCUSD', 0, 0, 0, 0, 0, 0, 108_000], ['tSOLUSD', 0, 0, 0, 0, 0, 0, 180]] }; };
    const pub = await preciosPublicosBitfinex(['btc', 'SOL', 'XYZ'], pedir);
    t('ticker público: un pedido, LAST_PRICE por activo; lo que no viene queda afuera', pub.precios.BTC === 108_000 && pub.precios.SOL === 180 && pub.precios.XYZ === undefined && urlPedida.includes('tBTCUSD,tSOLUSD,tXYZUSD'), { pub, urlPedida });
    const caido = await preciosPublicosBitfinex(['BTC'], async () => { throw new Error('ECONNRESET'); });
    t('ticker público caído → {} con el error (no tira)', Object.keys(caido.precios).length === 0 && caido.error === 'ECONNRESET');
    const wallets = [['exchange', 'BTC', 0.1, 0, 0.1, null, null], ['exchange', 'UST', 50, 0, 50, null, null], ['exchange', 'USD', 10, 0, 10, null, null], ['funding', 'SOL', 3, 0, 3, null, null]];
    const ledgers = [{ categoria: 101, filas: [[1, 'ETH', 'exchange', 0, null, 1, 1, null, 'Deposit']] }];
    const lect = (tk: string) => (tk === 'ETH' ? 3000 : null);
    t('tickersSinPrecio: los de billeteras y ledgers sin precio en criptoLectura (sin USD ni stablecoins)', JSON.stringify(tickersSinPrecio(wallets, ledgers, lect)) === JSON.stringify(['BTC', 'SOL']));
    const precio = precioConRespaldo(lect, { BTC: 108_000 });
    const plan = planSincronizacionBitfinex({ wallets, funding: [], ledgers: [], leidoEnISO: '2026-10-22T12:20:00Z', precioUsd: precio });
    const btc = plan.cuentaViva.posiciones.find(p => p.ticker === 'BTC')!;
    const sol = plan.cuentaViva.posiciones.find(p => p.ticker === 'SOL')!;
    t('sin criptoLectura, el ticker público valúa (BTC 0,1 × 108.000 = 10.800, sin revisar)', btc.valor_origen === 10_800 && !btc.revisar, btc);
    t('sin ninguno de los dos: valor 0 con revisar y el motivo', sol.valor_origen === 0 && sol.revisar && /ni en el ticker público/.test(sol.motivo_revisar ?? ''), sol);
  }

  console.log(`\n${ok} OK, ${fail} FAIL`);
  if (fail) process.exit(1);
})();
