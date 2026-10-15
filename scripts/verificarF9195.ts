// F9.195 (sistema cripto) — verificación sin red ni Firestore: corre las funciones REALES (no copias) de
//   src/datos/patrimonioCripto.ts      (política, validación, evaluación del sistema)
//   functions/src/criptoPrecios.ts     (parseo de Bitfinex / Kraken / CoinGecko, base de BTC, día de historial)
// Uso: npx tsx scripts/verificarF9195.ts   → exit 1 si algo falla.
//
// La foto es la del 15-oct-2026 (capturas de Nexo y Bitfinex): ETH 17.719 · BTC 11.448 · AAVE 2.397 ·
// UNI 1.638 · USDT 0,31, repartidas entre las dos cuentas como en la corrida del 13-oct.
import type { Posicion } from '../src/types/patrimonio';
import {
  evaluarSistemaCripto, validarPoliticaCripto, plataformaDeCuenta, CRIPTO_DEFAULTS,
  type PoliticaCripto, type LecturaCripto as LecturaCliente,
} from '../src/datos/patrimonioCripto';
import {
  parseBitfinex, parseKraken, parseCoingecko, leerPreciosCripto, resolverBaseBtc, armarDiaHistorial,
  urlBitfinex, urlKraken, simboloBitfinex, parKraken, type RespuestaCruda, type LecturaCripto,
} from '../functions/src/criptoPrecios';

let fallas = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) fallas++; };
const cerca = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const fila = (cuenta: string, ticker: string, valorUsd: number, cantidad: number | null = null): Posicion => ({
  cuenta, titular: null, ticker, tipo: 'cripto', sector: ticker === 'USDT' ? 'stablecoin' : 'cripto', pais_riesgo: 'global',
  moneda_origen: 'USD', valor_origen: valorUsd, cantidad, fuente: 'test', revisar: false, valorUsd, tcUsado: null,
  fechaCorrida: '2026-10-13',
});

const foto: Posicion[] = [
  fila('Bitfinex', 'AAVE', 760.7), fila('Bitfinex', 'BTC', 8672.25), fila('Bitfinex', 'ETH', 12865.05),
  fila('Bitfinex', 'UNI', 644.52), fila('Bitfinex', 'USDT', 0.21),
  fila('Nexo', 'ETH', 4854.27), fila('Nexo', 'BTC', 2775.88), fila('Nexo', 'AAVE', 1636.69),
  fila('Nexo', 'UNI', 993.16), fila('Nexo', 'USDT', 0.1),
];
// Una acción no entra al sistema.
const conAccion = [...foto, { ...fila('IOL', 'YPFD', 5000), tipo: 'accion' as const }];

const evaluar = (posiciones: Posicion[], extra: Partial<Parameters<typeof evaluarSistemaCripto>[0]> = {}) =>
  evaluarSistemaCripto({
    posiciones, lectura: null, bases: null, historial: [], politica: CRIPTO_DEFAULTS, custodias: {}, pesoClase: 0.297, ...extra,
  })!;

// ── 1. Composición con la foto del 15-oct ────────────────────────────────────
const ev = evaluar(conAccion);
const g = (k: string) => ev.composicion.find(c => c.grupo === k)!;
ok(cerca(ev.valorUsd, 33203, 1), `total del sistema ${ev.valorUsd.toFixed(2)} ≈ 33.203 (la acción no entra)`);
ok(cerca(g('BTC').actual, 0.345, 0.0005) && g('BTC').estado === 'fuera_de_banda' && cerca(g('BTC').desvioPts, -0.105, 0.0005),
  `BTC ${(g('BTC').actual * 100).toFixed(1)}% fuera de banda, ${(g('BTC').desvioPts * 100).toFixed(1)} pts`);
ok(cerca(g('ETH').actual, 0.534, 0.0005) && g('ETH').estado === 'fuera_de_banda' && cerca(g('ETH').desvioPts, 0.184, 0.0005),
  `ETH ${(g('ETH').actual * 100).toFixed(1)}% fuera de banda, +${(g('ETH').desvioPts * 100).toFixed(1)} pts`);
ok(cerca(g('otras').actual, 0.122, 0.0005) && g('otras').estado === 'en_banda' && cerca(g('otras').desvioPts, 0.022, 0.0005),
  `otras ${(g('otras').actual * 100).toFixed(1)}% en banda, +${(g('otras').desvioPts * 100).toFixed(1)} pts`);
ok(cerca(g('reserva').actual, 0, 0.0005) && g('reserva').estado === 'fuera_de_banda' && cerca(g('reserva').desvioPts, -0.10, 0.0005),
  `reserva ${(g('reserva').actual * 100).toFixed(1)}% fuera de banda, −10,0 pts`);
ok(cerca(ev.reserva.faltaUsd, 3320, 1), `a la reserva le faltan USD ${ev.reserva.faltaUsd.toFixed(0)} (~3.320)`);
ok(cerca(ev.reserva.tercioUsd * 3, ev.reserva.objetivoUsd, 0.01), 'tres tercios = la reserva objetivo');
ok(ev.pesoEnTotal === 0.297, 'el peso en el total es el número de la banda de clase, sin recalcular');
ok(ev.valuadosConSnapshot.length === 5, 'sin lectura, los cinco tickers se valúan con el snapshot y se marcan');

// ── 2. Plataformas ───────────────────────────────────────────────────────────
const pf = (e: typeof ev, k: string) => e.plataformas.find(p => p.plataforma === k);
ok(cerca(pf(ev, 'Bitfinex')!.pct, 0.691, 0.0005) && pf(ev, 'Bitfinex')!.superaTope, `Bitfinex ${(pf(ev, 'Bitfinex')!.pct * 100).toFixed(1)}% supera el tope de 60%`);
ok(cerca(pf(ev, 'Nexo')!.pct, 0.309, 0.0005) && !pf(ev, 'Nexo')!.superaTope, `Nexo ${(pf(ev, 'Nexo')!.pct * 100).toFixed(1)}% dentro del tope`);
ok(ev.plataformas.every(p => p.cuentas.every(c => c.custodia === 'sin_declarar')), 'sin overrides, la custodia queda "sin declarar" (F9.130)');
const conCustodia = evaluar(foto, { custodias: { Nexo: 'credito', Bitfinex: 'credito' } });
ok(conCustodia.plataformas.every(p => p.cuentas.every(c => c.custodia === 'credito')), 'declaradas como crédito, se muestran como crédito');

// Addendum 1 — dos cuentas de Nexo son UNA plataforma; una cuenta fuera de la tabla queda marcada.
const dosNexo = [
  fila('Bitfinex', 'ETH', 6900), fila('Nexo', 'BTC', 1500), fila('Nexo 2', 'ETH', 1600),
];
const evNexo = evaluar(dosNexo);
const nexo = pf(evNexo, 'Nexo')!;
ok(cerca(nexo.pct, 0.31, 0.0005) && nexo.cuentas.length === 2 && evNexo.plataformas.length === 2,
  `"Nexo" (15%) y "Nexo 2" (16%) → una sola plataforma Nexo al ${(nexo.pct * 100).toFixed(0)}%`);
ok(nexo.cuentas.map(c => c.cuenta).join(',') === 'Nexo 2,Nexo' && nexo.mapeada, 'las dos cuentas quedan debajo de Nexo, mapeada');
const conKraken = evaluar([...foto, fila('Kraken', 'BTC', 500)]);
const kraken = pf(conKraken, 'Kraken');
ok(!!kraken && !kraken.mapeada && kraken.cuentas.length === 1, 'una cuenta "Kraken" fuera de la tabla → plataforma propia, sin mapear');
ok(plataformaDeCuenta('Nexus').mapeada === false && plataformaDeCuenta('Nexo Earn').plataforma === 'Nexo',
  'sin matcheo difuso: "Nexus" no es Nexo; "Nexo Earn" sí');
const topeDeSuma = evaluar([fila('Nexo', 'BTC', 35), fila('Nexo 2', 'ETH', 30), fila('Bitfinex', 'ETH', 35)]);
ok(pf(topeDeSuma, 'Nexo')!.superaTope && pf(topeDeSuma, 'Nexo')!.cuentas.every(c => c.pct < 0.6),
  'el tope se evalúa contra la suma de las cuentas (35% + 30% = 65% supera 60%)');

// ── 3. Valuación con precios ─────────────────────────────────────────────────
const lecturaCli: LecturaCliente = {
  leidoEnISO: '2026-10-15T12:15:00.000Z', sondeo: [],
  precios: { BTC: { valor: 80000, fuente: 'bitfinex', error: null }, ETH: { valor: null, fuente: null, error: 'HTTP 403' } },
};
const conPrecio = evaluar([fila('Nexo', 'BTC', 2000, 0.03), fila('Nexo', 'ETH', 5000, 2)], { lectura: lecturaCli });
ok(cerca(conPrecio.valorUsd, 0.03 * 80000 + 5000, 0.01), 'BTC a cantidad × precio; ETH sin precio al valor del snapshot');
ok(conPrecio.valuadosConSnapshot.join() === 'ETH' && conPrecio.fechaPrecios === '2026-10-15', 'ETH marcado "valor del 13/10"');
const tarde = evaluar([fila('Nexo', 'BTC', 2000, 0.03)], { lectura: { ...lecturaCli, leidoEnISO: '2026-10-16T01:30:00.000Z' } });
ok(tarde.fechaPrecios === '2026-10-15', 'una lectura a las 22:30 ART del 15 es del 15, no del 16 (UTC)');

// ── 4. Tramos de BTC ─────────────────────────────────────────────────────────
const conBtc = (precio: number) => evaluar(foto, {
  bases: { btc: { valor: 84000, fecha: '2026-10-15', fuente: 'bitfinex' } },
  lectura: { leidoEnISO: '2026-10-16T12:15:00.000Z', sondeo: [], precios: { BTC: { valor: precio, fuente: 'bitfinex', error: null } } },
});
ok(conBtc(79800).tramos.alcanzados === 1, 'base 84.000, precio 79.800 (−5%) → nivel 1');
ok(conBtc(73900).tramos.alcanzados === 2, 'precio 73.900 (−12%) → nivel 2');
ok(conBtc(85000).tramos.alcanzados === 0, 'por encima de la base → ningún nivel');
ok(evaluar(foto).tramos.variacion === null && evaluar(foto).tramos.alcanzados === 0, 'sin base ni precio → sin variación, no verde inventado');

// ── 5. Freno ─────────────────────────────────────────────────────────────────
const conFreno = evaluar([fila('Nexo', 'BTC', 27500)], {
  historial: [
    { fecha: '2026-10-01', valorSistemaUsd: 40000, completo: true },
    { fecha: '2026-10-05', valorSistemaUsd: 90000, completo: false },   // incompleto: no cuenta como máximo
    { fecha: '2026-10-10', valorSistemaUsd: 35000, completo: true },
  ],
});
ok(cerca(conFreno.freno.caida, -0.3125, 1e-9) && conFreno.freno.activo && conFreno.freno.maximoUsd === 40000,
  `máximo 40.000, valor 27.500 → ${(conFreno.freno.caida * 100).toFixed(2)}%, marca`);
ok(!evaluar([fila('Nexo', 'BTC', 30000)], { historial: [{ fecha: '2026-10-01', valorSistemaUsd: 40000, completo: true }] }).freno.activo,
  '−25% no llega al freno de 30%');

// ── 6. Validación de la política ─────────────────────────────────────────────
ok(validarPoliticaCripto(CRIPTO_DEFAULTS).length === 0, 'los valores iniciales validan');
const mal = (p: Partial<PoliticaCripto>) => validarPoliticaCripto({ ...CRIPTO_DEFAULTS, ...p });
ok(mal({ objetivo: { BTC: 0.5, ETH: 0.35, otras: 0.10, reserva: 0.10 } }).some(e => e.includes('sumar 100%')), 'objetivos que suman 105% → error');
ok(mal({ objetivo: { BTC: 1.2, ETH: -0.4, otras: 0.10, reserva: 0.10 } }).some(e => e.includes('entre 0 y 100%')), 'objetivo fuera de 0–100% → error aunque sume 1');
ok(mal({ tramosBtc: [-0.12, -0.05, -0.20] }).some(e => e.includes('mayor que el anterior')), 'tramos mal ordenados → error');
ok(mal({ tramosBtc: [0.05, -0.12] }).some(e => e.includes('negativos')), 'tramo positivo → error');
ok(mal({ tramosBtc: [] }).length > 0, 'sin tramos → error');

// ── 7. Parseo de las fuentes (respuestas con la forma real del 15-oct) ───────
const bfx: RespuestaCruda = { status: 200, body: [
  ['tBTCUSD', 82449, 3.7, 82466, 2.2, 735, 0.009, 82461, 650, 82641, 79821],
  ['tAAVE:USD', 157.87, 831, 158.5, 1097, 5.13, 0.03, 157.89, 266, 157.89, 147.97],
] };
const pb = parseBitfinex(bfx, ['BTC', 'AAVE', 'UNI']);
ok(pb.precios.BTC === 82461 && pb.precios.AAVE === 157.89 && pb.precios.UNI === undefined && pb.error === null,
  'Bitfinex: LAST_PRICE por símbolo; el que no vino queda afuera');
ok(simboloBitfinex('BTC') === 'tBTCUSD' && simboloBitfinex('AAVE') === 'tAAVE:USD', 'Bitfinex: tBTCUSD y tAAVE:USD');
ok(parseBitfinex({ status: 403, body: '<html>Forbidden</html>' }, ['BTC']).error!.startsWith('HTTP 403'), 'Bitfinex 403 → error crudo');
ok(parseBitfinex({ status: 200, body: { error: 'ratelimit' } }, ['BTC']).error!.includes('ratelimit'), 'Bitfinex cuerpo inesperado → error crudo');

const krk: RespuestaCruda = { status: 200, body: { error: [], result: { XXBTZUSD: { c: ['82377.80000', '0.0006'] } } } };
ok(parseKraken(krk, 'BTC').precios.BTC === 82377.8 && parKraken('BTC') === 'XBTUSD', 'Kraken: XBTUSD → c[0]');
ok(parseKraken({ status: 200, body: { error: ['EQuery:Unknown asset pair'] } }, 'FOO').error!.includes('Unknown asset pair'), 'Kraken par desconocido → error crudo');
ok(parseKraken({ status: 429, body: 'Too Many Requests' }, 'BTC').error!.startsWith('HTTP 429'), 'Kraken 429 → error crudo');

const cg: RespuestaCruda = { status: 200, body: { bitcoin: { usd: 82406 }, uniswap: { usd: 7.48 } } };
const pc = parseCoingecko(cg, ['BTC', 'UNI', 'ETH']);
ok(pc.precios.BTC === 82406 && pc.precios.UNI === 7.48 && pc.precios.ETH === undefined, 'CoinGecko: id → ticker');
ok(parseCoingecko({ status: 429, body: { status: { error_code: 429 } } }, ['BTC']).error!.startsWith('HTTP 429'), 'CoinGecko 429 → error crudo');
ok(parseCoingecko({ status: 200, body: [] }, ['BTC']).error !== null, 'CoinGecko cuerpo inesperado (array) → error crudo');

// ── 8. Cadena de fuentes ─────────────────────────────────────────────────────
type Resp = (url: string) => RespuestaCruda;
const red = (f: Resp) => {
  const pedidos: string[] = [];
  return { pedidos, pedir: async (url: string) => { pedidos.push(url); return f(url); } };
};

async function cadena() {
  // Bitfinex trae BTC; ETH lo trae Kraken; UNI ninguna de las dos y sí CoinGecko; FOO nadie.
  const r1 = red(url => {
    if (url.startsWith('https://api-pub.bitfinex.com')) return { status: 200, body: [['tBTCUSD', 0, 0, 0, 0, 0, 0, 80000]] };
    if (url === urlKraken('ETH')) return { status: 200, body: { error: [], result: { XETHZUSD: { c: ['2450.5', '1'] } } } };
    if (url.startsWith('https://api.kraken.com')) return { status: 200, body: { error: ['EQuery:Unknown asset pair'] } };
    if (url.startsWith('https://api.coingecko.com')) return { status: 200, body: { uniswap: { usd: 7.5 } } };
    return { status: 404, body: 'no' };
  });
  const l1 = await leerPreciosCripto(r1.pedir, ['btc', 'ETH', 'UNI', 'FOO', 'USDT', 'BTC'], '2026-10-15T12:15:00.000Z', 0);
  ok(l1.precios.BTC.fuente === 'bitfinex' && l1.precios.ETH.fuente === 'kraken' && l1.precios.UNI.fuente === 'coingecko',
    'cadena: Bitfinex → Kraken → CoinGecko, cada ticker con su fuente');
  ok(l1.precios.USDT.valor === 1 && l1.precios.USDT.fuente === 'stablecoin=1', 'USDT a 1, sin pedido');
  ok(l1.precios.FOO.valor === null && l1.precios.FOO.error!.includes('Unknown asset pair') && l1.precios.FOO.error!.includes('sin id'),
    'FOO sin precio, con el motivo de cada fuente');
  ok(!r1.pedidos.some(u => u.includes('USDT') || u.includes('tether')), 'el stablecoin no se pide a ninguna fuente');
  ok(r1.pedidos[0] === urlBitfinex(['BTC', 'ETH', 'FOO', 'UNI']), 'un solo pedido a Bitfinex con todos los tickers (sin duplicados)');
  ok(l1.sondeo.length === r1.pedidos.length && l1.sondeo.every(s => typeof s.status === 'number'), 'cada pedido queda en el sondeo con su status');

  // Todo bloqueado: 403 en las tres. Nada inventado.
  const r2 = red(() => ({ status: 403, body: 'Forbidden' }));
  const l2 = await leerPreciosCripto(r2.pedir, ['BTC'], '2026-10-15T12:15:00.000Z', 0);
  ok(l2.precios.BTC.valor === null && (l2.precios.BTC.error!.match(/HTTP 403/g) ?? []).length === 3, 'tres 403 → sin dato, con los tres errores');

  // 502 transitorio: un reintento y el segundo intento trae el dato.
  let n = 0;
  const r3 = red(url => (url.startsWith('https://api-pub.bitfinex.com') && n++ === 0
    ? { status: 502, body: 'Bad Gateway' }
    : { status: 200, body: [['tBTCUSD', 0, 0, 0, 0, 0, 0, 81000]] }));
  const l3 = await leerPreciosCripto(r3.pedir, ['BTC'], '2026-10-15T12:15:00.000Z', 0);
  ok(l3.precios.BTC.valor === 81000 && l3.precios.BTC.fuente === 'bitfinex', '502 y reintento OK → dato de Bitfinex');

  // Red caída (fetch rechaza): no rechaza la lectura.
  const l4 = await leerPreciosCripto(async () => { throw new Error('ECONNRESET'); }, ['BTC'], '2026-10-15T12:15:00.000Z', 0);
  ok(l4.precios.BTC.valor === null && l4.precios.BTC.error!.includes('ECONNRESET'), 'error de red → sin dato con el mensaje, sin rechazar');

  // ── 9. Base de BTC y día de historial ──────────────────────────────────────
  const b1 = resolverBaseBtc(null, l1, '2026-10-15', false);
  ok(b1?.valor === 80000 && b1.fecha === '2026-10-15', 'la primera lectura fija la base');
  const lOtra: LecturaCripto = { ...l1, precios: { ...l1.precios, BTC: { valor: 70000, fuente: 'bitfinex', error: null } } };
  ok(resolverBaseBtc(b1, lOtra, '2026-10-20', false) === b1, 'la base no se mueve sola');
  ok(resolverBaseBtc(b1, lOtra, '2026-10-20', true)?.valor === 70000, 'reiniciar la fija en hoy');
  ok(resolverBaseBtc(null, l2, '2026-10-15', false) === null, 'sin precio no se fija base');

  const dia = armarDiaHistorial(
    [{ ticker: 'BTC', cantidad: 0.1, valorUsd: 8000 }, { ticker: 'UNI', cantidad: null, valorUsd: 600 }, { ticker: 'FOO', cantidad: 5, valorUsd: 50 }],
    l1, '2026-10-13',
  );
  ok(cerca(dia.valorSistemaUsd, 8000 + 600 + 50, 0.01) && !dia.completo && dia.valuadosConSnapshot.join() === 'FOO,UNI',
    'día de historial: BTC a precio; UNI sin cantidad y FOO sin precio al snapshot → incompleto');
  ok(armarDiaHistorial([{ ticker: 'BTC', cantidad: 0.1, valorUsd: 1 }], l1, '2026-10-13').completo, 'todo a precio del día → completo');
}

cadena().then(() => {
  console.log(fallas ? `\n${fallas} falla(s)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
});
