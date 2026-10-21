// F9.196 H2a — tests puros: tabla de movimientos de PPI (una fila por familia), costo sospechoso,
// respaldo de precio cuando data912 falla, escala guardada, idempotencia de la sincronización y el
// cron de cartera viva con datos sintéticos. Sin red ni Firestore.
// Correr: npx tsx functions/src/h2a.test.ts   → exit 1 si algo falla.
import {
  FAMILIAS_PPI, clasificarDescripcionPPI, leerMovimientosPPI, movimientosDePPI, leerPosicionesPPI,
} from './compartido/clasificacionPPI';
import { planSincronizacionPPI } from './ppiSincronizacion';
import { tipoPPI, escalaVigente, escalaDeBusqueda, precioDeCurrent, elegirPrecioDia } from './preciosRespaldo';
import { armarDocCarteraViva, preciosDesdeIndicadores, frescuraCartera } from './carteraVivaCron';
import { posicionesDeCarteraViva, type CuentaViva } from './compartido/patrimonioCarteraViva';
import type { Posicion } from './compartido/tiposPatrimonio';

let ok = 0, fail = 0;
function t(rotulo: string, cond: boolean, detalle?: unknown) {
  if (cond) { ok++; console.log(`  OK   ${rotulo}`); }
  else { fail++; console.log(`  FAIL ${rotulo}${detalle !== undefined ? `\n       ${JSON.stringify(detalle)}` : ''}`); }
}

// ── Fixture sintético: una fila por familia (números inventados) ─────────────
const fila = (description: string, extra: Record<string, unknown> = {}) => ({
  agreementDate: '2026-10-15T00:00:00', settlementDate: '2026-10-16T00:00:00', currency: 'Pesos',
  amount: 1000, price: 0, description, ticker: 'Ticker not found', quantity: 0, balance: 0, ...extra,
});
const FIX: Array<[Record<string, unknown>, string]> = [
  [fila('COMPRA GGAL', { ticker: 'GGAL', quantity: 10, price: 5000, amount: -50000 }), 'compra'],
  [fila('VENTA YPFD', { ticker: 'YPFD', quantity: -5, price: 8000, amount: 40000 }), 'venta'],
  [fila('Ingreso de Fondos ', { amount: 100000 }), 'deposito'],
  [fila('Retiro de Fondos ', { amount: -50000 }), 'retiro'],
  [fila('Dividendo en efectivo / BMA', { amount: 5000 }), 'renta'],
  [fila('Renta / GD30', { amount: 30, currency: 'DolarCV7000-Op.' }), 'renta'],
  [fila('RENTA. / GD30', { amount: 1, currency: 'DolarCV7000 Ext.' }), 'renta'],
  [fila('Amortización / GD30', { amount: 40, currency: 'Dolar MEP' }), 'renta'],
  [fila('Interest payment (INTR) - DISN / BPOD7', { amount: 2 }), 'renta'],
  [fila('Liquidación de Suscripción / 1234567 / Fondo Sintético', { ticker: 'RV', quantity: 10, price: 500, amount: -5000 }), 'fci_suscripcion'],
  [fila('Ret. Ganancias Div BMA', { amount: -300 }), 'gasto'],
  [fila('Ret. Gcias  Div. Efvo  Banco Sintético', { amount: -100 }), 'gasto'],
  [fila('Ret Bs. Ps. Div. TGSU2', { amount: -50 }), 'gasto'],
  [fila('Retenciones Div. CEPU', { amount: -20 }), 'gasto'],
  [fila('Split / CEPU', { ticker: 'GD30', quantity: 15, amount: -0.3 }), 'split'],
  [fila('Movimiento Manual / Vencimiento Plazo Comunicación A 8042', { amount: 13, currency: 'DolarCV7000 Ext.' }), 'ajuste_caja'],
  [fila('Movimiento Manual / Fracción Split CEPU', { amount: 1 }), 'ajuste_caja'],
  [fila('Movimiento Manual / Fracción Dividendo TXAR', { amount: 1 }), 'ajuste_caja'],
  [fila('Movimiento Manual / Débito/Crédito - Compensación de monedas', { amount: -12, currency: 'DolarCV10000-Loc.' }), 'ajuste_caja'],
  [fila('Movimiento Manual / Gastos CVSA Split CEPU', { amount: -0.05 }), 'gasto'],
];

console.log('=== tabla de movimientos de PPI (una fila por familia) ===');
{
  const { filas, monedasDesconocidas } = leerMovimientosPPI(FIX.map(x => x[0]));
  const mal = FIX.map(([f, c], i) => ({ d: f.description, esperada: c, real: filas[i].clase })).filter(x => x.real !== x.esperada);
  t(`las ${FIX.length} filas caen en su clase`, mal.length === 0, mal);
  const familias = new Set(filas.map(f => clasificarDescripcionPPI(f.descripcion).familia));
  t(`las ${FAMILIAS_PPI.length} familias de la tabla tienen su fila`, familias.size === FAMILIAS_PPI.length && !familias.has(null));
  t('ninguna moneda desconocida (Pesos, Dolar MEP, DolarCV…)', monedasDesconocidas.length === 0, monedasDesconocidas);
  t('un texto que no está en la tabla → para_revisar (no se inventa)', clasificarDescripcionPPI('Rescate de Fondo / 1 / X').clase === 'para_revisar' && clasificarDescripcionPPI('CANJE GD30').clase === 'para_revisar');
  t('"Ticker not found" → ticker null', filas[2].ticker === null && filas[0].ticker === 'GGAL');
  const movs = movimientosDePPI(filas, 'PPI XXXXX');
  const tipos = movs.map(m => m.tipo).sort().join(',');
  t('movimientos: compra, venta, depósito, retiro, rentas positivas y la suscripción (como compra de FCI)',
    tipos === 'compra,compra,deposito,renta,renta,renta,renta,renta,retiro,venta', tipos);
  t('retenciones, split y ajustes de caja NO son movimientos de cuenta', !movs.some(m => /^(Ret.? |Retenciones|Split|Movimiento Manual)/.test(m.nota ?? '')));
  t('amortización → renta con devolucionCapital', movs.some(m => m.tipo === 'renta' && m.devolucionCapital && /Amortización/.test(m.nota ?? '')));
  t('las monedas de dólar suman como USD y se guarda la subcuenta', movs.find(m => m.nota === 'Renta / GD30')?.moneda === 'USD' && movs.find(m => m.nota === 'Renta / GD30')?.subcuenta === 'DolarCV7000-Op.');
  t('origen ppi_api e ids ppimov_ únicos', movs.every(m => m.origen === 'ppi_api' && m.id!.startsWith('ppimov_')) && new Set(movs.map(m => m.id)).size === movs.length);
}

console.log('\n=== posiciones y costo sospechoso ===');
const balances = {
  groupedAvailability: [
    { currency: 'Pesos', availability: [{ name: 'Pesos', symbol: 'ARS', amount: 1000, settlement: 'INMEDIATA' }, { name: 'Pesos', symbol: 'ARS', amount: 0, settlement: 'A-24HS' }] },
    { currency: 'Dolar Billete | MEP', availability: [{ name: 'Dolar Billete | MEP', symbol: 'USD', amount: 500, settlement: 'INMEDIATA' }] },
    { currency: 'Dolar Divisa | CCL', availability: [{ name: 'Dolar Divisa | CCL', symbol: 'USD', amount: 20, settlement: 'INMEDIATA' }, { name: 'x', symbol: 'USD', amount: 20, settlement: 'A-24HS' }] },
  ],
  groupedInstruments: [
    { name: 'ACCIONES', groupedValue: 0, instruments: [
      { ticker: 'GGAL', currency: 'Pesos', price: 5000, quantity: 10, amount: 50000, ppc: { ppcValue: 4000, currency: 'Pesos' } },
      { ticker: 'PAMP', currency: 'Pesos', price: 5000, quantity: 10, amount: 50000, ppc: { ppcValue: 46, currency: 'Pesos' } },
    ] },
    { name: 'BONOS', groupedValue: 0, instruments: [{ ticker: 'GD30', currency: 'Pesos', price: 878, quantity: 100, amount: 87800, ppc: { ppcValue: 630, currency: 'Pesos' } }] },
    { name: 'OPCIONES', groupedValue: 0, instruments: [{ ticker: 'XYZ', currency: 'Pesos', price: 1, quantity: 1, amount: 1 }] },
  ],
};
{
  const l = leerPosicionesPPI(balances, 'PPI XXXXX', (tk) => (tk === 'GD30' ? null : { sector: 'x', pais_riesgo: 'AR' }));
  t('caja = fila INMEDIATA de cada moneda (Pesos → ARS; MEP y CCL → USD)', l.saldos.ARS === 1000 && l.saldos.USD === 520, l.saldos);
  t('costo promedio guardado para todos', Object.keys(l.costoPromedio).length === 3);
  t('PAMP (precio 5000, costo 46: >5×) → costoSospechoso; GGAL no', l.costoSospechoso.PAMP === true && !l.costoSospechoso.GGAL);
  t('grupo desconocido (OPCIONES) → para revisar, no se descarta en silencio', l.paraRevisar.some(r => r.ticker === 'XYZ' && r.motivo.includes('OPCIONES')));
  t('sin clasificación en la corrida → revisar con motivo', l.posiciones.find(p => p.ticker === 'GD30')?.revisar === true);
  t('valor en pesos, cantidad y tipo mapeados', l.posiciones.find(p => p.ticker === 'GD30')?.tipo === 'bono' && l.posiciones.every(p => p.moneda_origen === 'ARS'));
}

console.log('\n=== idempotencia de la sincronización ===');
{
  const clasificar = () => ({ sector: 'x', pais_riesgo: 'AR' as const });
  // Corrida 1: ventana grande. Corrida 2 (mismo día): ventana de 10 días que se pisa con la anterior.
  const todos = FIX.map(x => x[0]);
  const p1 = planSincronizacionPPI({ cuenta: 'PPI XXXXX', balances, movements: todos, leidoEnISO: '2026-10-20T21:10:00Z', clasificar });
  const p2 = planSincronizacionPPI({ cuenta: 'PPI XXXXX', balances, movements: todos.slice(0, 10), leidoEnISO: '2026-10-20T21:30:00Z', clasificar });
  const ids1 = new Set(p1.movimientos.map(m => m.id));
  t('re-sincronizar con una ventana que se pisa genera los MISMOS ids (set con merge: no duplica)', p2.movimientos.every(m => ids1.has(m.id)));
  const p1b = planSincronizacionPPI({ cuenta: 'PPI XXXXX', balances, movements: todos, leidoEnISO: '2026-10-20T22:00:00Z', clasificar });
  t('dos corridas iguales → mismos movimientos', JSON.stringify(p1.movimientos) === JSON.stringify(p1b.movimientos));
  t('la cuenta viva se escribe entera (mismo contenido salvo leidoEn)', JSON.stringify({ ...p1.cuentaViva, leidoEn: '' }) === JSON.stringify({ ...p1b.cuentaViva, leidoEn: '' }));
  const dup = [...todos.slice(0, 1), ...todos.slice(0, 1)];
  const pd = planSincronizacionPPI({ cuenta: 'PPI XXXXX', balances, movements: dup, leidoEnISO: 'x', clasificar });
  t('dos filas legítimas idénticas en la misma lectura → dos movimientos con ids distintos', pd.movimientos.length === 2 && pd.movimientos[0].id !== pd.movimientos[1].id);
  t('la cuenta viva marca historialCompleto (la próxima corrida pide 10 días)', p1.cuentaViva.historialCompleto === true);
}

console.log('\n=== precios: respaldo de PPI y escala guardada ===');
{
  t('tipoPPI: acción AR, CEDEAR, bono, ON sí; usa_stocks, cripto y FCI no',
    tipoPPI('accion', 'AR', 'arg_stocks') === 'ACCIONES' && tipoPPI('cedear', 'global', 'arg_cedears') === 'CEDEARS' && tipoPPI('on', 'AR', 'arg_corp') === 'ON'
    && tipoPPI('accion', 'global', 'usa_stocks') === null && tipoPPI('cripto', 'global', 'usa_stocks') === null && tipoPPI('fci', 'AR', null) === null);
  const hoy = '2026-10-20';
  const d912 = elegirPrecioDia({ data912: 5765, monedaSerie: 'ARS', ppi: { precio: 9999, escala: 1 }, hoy });
  t('con precio de data912 manda data912 (fuente data912)', d912?.fuente === 'data912' && d912.precio === 5765);
  const resp = elegirPrecioDia({ data912: null, monedaSerie: 'ARS', ppi: { precio: 172910, escala: 100 }, hoy });
  t('data912 falla → PPI, dividido por la escala (ON por 100 VN)', resp?.fuente === 'ppi' && resp.precio === 1729.1 && resp.escala === 100 && resp.moneda === 'ARS');
  const sinEsc = elegirPrecioDia({ data912: null, monedaSerie: 'ARS', ppi: { precio: 8220, escala: null }, hoy });
  t('escala desconocida (SearchInstrument falló) → precio crudo con escala null (actúa la guarda de escala)', sinEsc?.precio === 8220 && sinEsc.escala === null);
  t('sin data912 ni PPI → null (no se inventa)', elegirPrecioDia({ data912: null, monedaSerie: 'ARS', ppi: null, hoy }) === null);
  const guardada = { identidad: 'TLCPO|on|AR', nominalInPrice: 100, consultadoEnISO: 'x' };
  t('escala guardada de la misma identidad → se usa sin volver a pedir', escalaVigente(guardada, 'TLCPO|on|AR') === 100);
  t('escala de OTRA identidad → se vuelve a pedir', escalaVigente(guardada, 'TLCPO|bono|AR') === null && escalaVigente(undefined, 'x') === null);
  const busqueda = [
    { ticker: 'GLOB', type: 'ACCIONES-USA', currency: 'Dolares divisa | CCL', nominalInPrice: 1 },
    { ticker: 'GLOB', type: 'CEDEARS', currency: 'Pesos', nominalInPrice: 1 },
    { ticker: 'TLCPO', type: 'ON', currency: 'Pesos', nominalInPrice: 100 },
  ];
  t('escalaDeBusqueda elige ticker + tipo + pesos (GLOB CEDEAR, no la de NYSE)', escalaDeBusqueda(busqueda, 'GLOB', 'CEDEARS') === 1 && escalaDeBusqueda(busqueda, 'TLCPO', 'ON') === 100);
  t('escalaDeBusqueda de un error ({"error":"Currency not found"}) → null', escalaDeBusqueda({ error: 'Currency not found' }, 'YPFD', 'ACCIONES') === null);
  t('precioDeCurrent', precioDeCurrent({ date: '2026-10-20T17:00:00-03:00', price: 8220 })?.precio === 8220 && precioDeCurrent({ price: 0 }) === null);
}

console.log('\n=== cron de cartera viva (datos sintéticos) ===');
{
  const F = '2026-10-13';
  const pos = (cuenta: string, ticker: string, tipo: Posicion['tipo'], moneda: 'ARS' | 'USD', valor: number, cantidad: number | null, pais: 'AR' | 'global' = 'AR'): Posicion => ({
    cuenta, titular: null, ticker, tipo, sector: 'x', pais_riesgo: pais, moneda_origen: moneda, valor_origen: valor, cantidad,
    fuente: 'test', revisar: false, valorUsd: moneda === 'USD' ? valor : valor / 1500, tcUsado: moneda === 'ARS' ? 1500 : null, fechaCorrida: F,
  });
  const posiciones = [
    pos('PPI XXXXX', 'GGAL', 'accion', 'ARS', 1_500_000, 300),
    pos('Balanz 999001', 'VIST', 'cedear', 'USD', 700, 318),
    pos('Balanz 999001', 'USD', 'cash', 'USD', 100, null, 'global'),
    pos('Nexo', 'BTC', 'cripto', 'USD', 9000, 0.1, 'global'),
  ];
  const ppiViva: CuentaViva = {
    cuenta: 'PPI XXXXX', fuente: 'ppi_api', leidoEn: '2026-10-20T21:10:00.000Z',
    posiciones: [{ cuenta: 'PPI XXXXX', titular: null, ticker: 'GGAL', tipo: 'accion', sector: 'x', pais_riesgo: 'AR', moneda_origen: 'ARS', valor_origen: 1_153_000, cantidad: 200, fuente: 'ppi_api', revisar: false }],
    saldos: { ARS: 0, USD: 500 },
  };
  const doc = armarDocCarteraViva({
    fechaCorrida: F, posiciones, cuentasVivas: [ppiViva], movimientos: [],
    indicadores: [
      { ticker: 'GGAL', tipo: 'accion', paisRiesgo: 'AR', precio: 5700, monedaSerie: 'ARS', fechaUltimoPrecio: '2026-10-19', precioDia: { precio: 5765, moneda: 'ARS', fecha: '2026-10-20', fuente: 'data912' } },
      { ticker: 'VIST', tipo: 'cedear', paisRiesgo: 'AR', precio: 3300, monedaSerie: 'ARS', fechaUltimoPrecio: '2026-10-19' },
    ],
    cripto: { leidoEnISO: '2026-10-20T12:15:00.000Z', precios: { BTC: { valor: 100_000, fuente: 'bitfinex', error: null } }, sondeo: [] },
    manuales: [], tc: { valor: 1544.1, fuente: 'dolarapi-bolsa', fechaCotizacion: '2026-10-20', viejo: false },
  }, '2026-10-20T21:20:00.000Z');
  const ggal = doc.lineas.find(l => l.ticker === 'GGAL')!;
  t('PPI: la tenencia de la API (200), a precio del día de data912', ggal.cantidad === 200 && ggal.precio === 'hoy' && Math.abs((ggal.valorUsd ?? 0) - 200 * 5765 / 1544.1) < 0.01);
  t('Balanz sin cuenta viva: la corrida, a último cierre (viejo)', doc.lineas.find(l => l.ticker === 'VIST')?.precio === 'viejo');
  t('cripto con la lectura del día', Math.abs((doc.lineas.find(l => l.ticker === 'BTC')?.valorUsd ?? 0) - 10_000) < 0.01);
  t('diferencia = precios + movimientos', Math.abs(doc.efectoPreciosUsd + doc.efectoMovimientosUsd - (doc.totalUsd - doc.totalCargaUsd)) < 0.05);
  t('frescura: PPI API hoy 18:10, carga 13/10, cripto, MEP del día', doc.frescura.includes('PPI XXXXX: API hoy 18:10') && doc.frescura.includes('Balanz 999001: carga 13/10')
    && doc.frescura.some(l => l.startsWith('Cripto: lectura hoy')) && doc.frescura.some(l => l.startsWith('MEP $1.544, hoy 18:20')), doc.frescura);
  const conError = frescuraCartera(doc, [{ ...ppiViva, error: 'HTTP 500' }], null, '2026-10-21T21:20:00.000Z');
  t('PPI con error → "sin sincronizar desde dd/mm"', conError.some(l => l.startsWith('PPI XXXXX: sin sincronizar desde 20/10')), conError);
  const viejo = frescuraCartera({ ...doc, tc: { valor: 1530, fuente: 'tcDiario', fechaCotizacion: '2026-10-16', viejo: true } }, [], null, '2026-10-20T21:20:00.000Z');
  t('MEP de respaldo → "del dd/mm (viejo)"', viejo.includes('MEP $1.530 del 16/10 (viejo)'), viejo);
  const p = preciosDesdeIndicadores([{ ticker: 'X', tipo: 'accion', paisRiesgo: 'AR', precio: null, monedaSerie: 'ARS', fechaUltimoPrecio: null }], '2026-10-20');
  t('indicador sin precio → no entra (no se inventa)', Object.keys(p.porIdentidad).length === 0);
  const pv = posicionesDeCarteraViva(doc, F);
  t('posicionesDeCarteraViva: las líneas valuadas como Posicion (para pesos, riesgo y reserva)', pv.length === doc.lineas.filter(l => l.valorUsd !== null && l.tipo).length && pv.every(x => x.fuente === 'cartera_viva'));
}

console.log(`\n${ok} OK, ${fail} FAIL`);
if (fail) process.exit(1);
