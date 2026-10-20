// F9.196 (H2/H3, funciones puras) — verificación sin red ni Firestore: corre las funciones REALES de
//   src/datos/patrimonioCarteraViva.ts   (armarCarteraViva, resolverTcCarteraViva)
//   src/datos/patrimonioMovimientos.ts   (efecto por tipo, duplicados, corte por corrida, flujo F9.96)
// Uso: npx tsx scripts/verificarF9196.ts   → exit 1 si algo falla.
//
// Los stops y señales (H4) tienen su propio banco: npx tsx functions/src/patrimonioStops.test.ts
import type { Posicion, PosicionManual } from '../src/types/patrimonio';
import {
  armarCarteraViva, resolverTcCarteraViva, diaHabilAnterior,
  type CuentaViva, type PreciosCarteraViva, type TcCarteraViva,
} from '../src/datos/patrimonioCarteraViva';
import {
  efectoMovimiento, claveDuplicado, separarDuplicados, movimientoVigente, flujoDeMovimiento,
  type MovimientoCuenta,
} from '../src/datos/patrimonioMovimientos';
import type { LecturaCripto } from '../src/datos/patrimonioCripto';

let fallas = 0;
const ok = (cond: boolean, msg: string, detalle?: unknown) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${!cond && detalle !== undefined ? `\n       ${JSON.stringify(detalle)}` : ''}`);
  if (!cond) fallas++;
};
const cerca = (a: number | null | undefined, b: number, tol = 0.01) => a !== null && a !== undefined && Math.abs(a - b) <= tol;

// ── Datos sintéticos ─────────────────────────────────────────────────────────
// Corrida del 10/10 valuada con tcDiario = 1500. Hoy: 19/10, MEP del día 1544,10.
const FECHA_CORRIDA = '2026-10-10';
const HOY = '2026-10-19';
const TC_CARGA = 1500;
const fila = (p: Partial<Posicion> & Pick<Posicion, 'cuenta' | 'ticker' | 'tipo' | 'moneda_origen' | 'valor_origen'>): Posicion => ({
  titular: null, sector: 'x', pais_riesgo: 'AR', cantidad: null, fuente: 'test', revisar: false,
  valorUsd: p.moneda_origen === 'ARS' ? p.valor_origen / TC_CARGA : p.valor_origen,
  tcUsado: p.moneda_origen === 'ARS' ? TC_CARGA : null, fechaCorrida: FECHA_CORRIDA, ...p,
});
const BALANZ = 'Balanz 402665';
const corridaBase = [
  // 100 GGAL a $6.000 = $600.000
  fila({ cuenta: BALANZ, ticker: 'GGAL', tipo: 'accion', moneda_origen: 'ARS', valor_origen: 600_000, cantidad: 100 }),
  // Caja: $150.000 y USD 2.000
  fila({ cuenta: BALANZ, ticker: 'ARS', tipo: 'cash', moneda_origen: 'ARS', valor_origen: 150_000 }),
  fila({ cuenta: BALANZ, ticker: 'USD', tipo: 'cash', moneda_origen: 'USD', valor_origen: 2_000, pais_riesgo: 'global' }),
];
const corrida = { fecha: FECHA_CORRIDA, posiciones: corridaBase };
const precios = (ggal: number | null, fecha = HOY): PreciosCarteraViva => ({
  hoy: HOY,
  porIdentidad: ggal === null ? {} : { 'GGAL|accion|AR': { precio: ggal, moneda: 'ARS', fecha } },
});
const tcHoy: TcCarteraViva = { valor: 1544.1, fuente: 'dolarapi-bolsa', fechaCotizacion: HOY, viejo: false };
const mov = (m: Partial<MovimientoCuenta> & Pick<MovimientoCuenta, 'tipo' | 'montoNeto'>): MovimientoCuenta => ({
  fecha: '2026-10-15', cuenta: BALANZ, moneda: 'ARS', origen: 'archivo_balanz', ...m,
});
const caja = (cv: ReturnType<typeof armarCarteraViva>, moneda: 'ARS' | 'USD') =>
  cv.lineas.filter(l => l.cuenta === BALANZ && l.tipo === 'cash' && l.moneda === moneda).reduce((a, l) => a + l.valorOrigen, 0);
const tenencia = (cv: ReturnType<typeof armarCarteraViva>, ticker: string) =>
  cv.lineas.find(l => l.cuenta === BALANZ && l.ticker === ticker)?.cantidad ?? null;

console.log('=== §3 efecto de cada tipo ===');
ok(JSON.stringify(efectoMovimiento(mov({ tipo: 'venta', ticker: 'GGAL', cantidad: 10, montoNeto: 60_000 }))) === JSON.stringify({ deltaCantidad: -10, deltaCaja: 60_000 }), 'venta: −cantidad, +caja');
ok(JSON.stringify(efectoMovimiento(mov({ tipo: 'compra', ticker: 'GGAL', cantidad: 10, montoNeto: 60_000 }))) === JSON.stringify({ deltaCantidad: 10, deltaCaja: -60_000 }), 'compra: +cantidad, −caja');
ok(efectoMovimiento(mov({ tipo: 'retiro', montoNeto: 1000 })).deltaCaja === -1000, 'retiro: −caja');
ok(efectoMovimiento(mov({ tipo: 'deposito', montoNeto: 1000 })).deltaCaja === 1000, 'depósito: +caja');
ok(efectoMovimiento(mov({ tipo: 'renta', montoNeto: 1000 })).deltaCaja === 1000, 'renta (cupón/dividendo): +caja');
ok(efectoMovimiento(mov({ tipo: 'retiro', montoNeto: -1000 })).deltaCaja === -1000, 'el signo de montoNeto no invierte el efecto');

console.log('\n=== §9 una venta en Balanz baja la tenencia y sube la caja ===');
{
  const venta = mov({ tipo: 'venta', ticker: 'GGAL', cantidad: 30, precio: 6_200, montoNeto: 186_000 });
  const sin = armarCarteraViva(corrida, [], [], precios(6_500), null, [], tcHoy);
  const con = armarCarteraViva(corrida, [], [venta], precios(6_500), null, [], tcHoy);
  ok(tenencia(sin, 'GGAL') === 100 && tenencia(con, 'GGAL') === 70, 'GGAL: 100 → 70', { sin: tenencia(sin, 'GGAL'), con: tenencia(con, 'GGAL') });
  ok(caja(sin, 'ARS') === 150_000 && caja(con, 'ARS') === 336_000, 'caja ARS: 150.000 → 336.000', caja(con, 'ARS'));
  ok(con.cuentas.find(c => c.cuenta === BALANZ)?.movimientosAplicados === 1, 'la cuenta cuenta 1 movimiento aplicado');
  const ggal = con.lineas.find(l => l.ticker === 'GGAL')!;
  ok(ggal.precio === 'hoy' && cerca(ggal.valorUsd, 70 * 6_500 / 1544.1), 'GGAL valuada con el precio del día y el MEP de hoy');
  ok(cerca(con.efectoPreciosUsd + con.efectoMovimientosUsd, con.totalUsd - con.totalCargaUsd), 'diferencia = efecto precios + efecto movimientos');
  // Venta a 6.200 con precio del día 6.500: el efecto de la venta es (186.000 − 30×6.500)/MEP.
  ok(cerca(con.efectoMovimientosUsd, (186_000 - 30 * 6_500) / 1544.1), 'efecto movimientos de la venta = monto cobrado − tenencia a precio de hoy', con.efectoMovimientosUsd);
  ok(cerca(sin.efectoMovimientosUsd, 0), 'sin movimientos, el efecto movimientos es 0');
}

console.log('\n=== §9 un retiro baja la caja y crea el flujo ===');
{
  const retiro = mov({ tipo: 'retiro', moneda: 'USD', montoNeto: 500, origen: 'manual' });
  const cv = armarCarteraViva(corrida, [], [retiro], precios(6_000), null, [], tcHoy);
  ok(caja(cv, 'USD') === 1_500, 'caja USD: 2.000 → 1.500', caja(cv, 'USD'));
  const { flujo } = flujoDeMovimiento(retiro, null);
  ok(!!flujo && flujo.tipo === 'retiro' && flujo.montoUsd === 500 && flujo.cuenta === BALANZ, 'el retiro genera un flujo F9.96 de USD 500', flujo);
  const enPesos = flujoDeMovimiento(mov({ tipo: 'retiro', montoNeto: 154_410 }), 1544.1);
  ok(enPesos.flujo?.montoUsd === 100, 'un retiro en pesos se convierte con el TC que se pasa', enPesos);
  ok(flujoDeMovimiento(mov({ tipo: 'retiro', montoNeto: 1 }), null).motivo === 'sin_tc', 'retiro en pesos sin TC: no se inventa el flujo');
  ok(flujoDeMovimiento(mov({ tipo: 'deposito', moneda: 'USD', montoNeto: 10 }), null).flujo?.tipo === 'aporte', 'un depósito genera un aporte');
  ok(flujoDeMovimiento(mov({ tipo: 'venta', ticker: 'GGAL', cantidad: 1, montoNeto: 10 }), 1500).flujo === null, 'una venta sola NO es flujo');
  ok(flujoDeMovimiento(mov({ tipo: 'renta', montoNeto: 10 }), 1500).flujo === null, 'una renta NO es flujo');
}

console.log('\n=== §9 una corrida nueva deja sin efecto los movimientos anteriores ===');
{
  const venta = mov({ fecha: '2026-10-15', tipo: 'venta', ticker: 'GGAL', cantidad: 30, montoNeto: 180_000 });
  const vieja = armarCarteraViva(corrida, [], [venta], precios(6_000), null, [], tcHoy);
  // Corrida nueva del 17/10 que ya refleja la venta.
  const nueva = {
    fecha: '2026-10-17',
    posiciones: [
      fila({ cuenta: BALANZ, ticker: 'GGAL', tipo: 'accion', moneda_origen: 'ARS', valor_origen: 420_000, cantidad: 70, fechaCorrida: '2026-10-17' }),
      fila({ cuenta: BALANZ, ticker: 'ARS', tipo: 'cash', moneda_origen: 'ARS', valor_origen: 330_000, fechaCorrida: '2026-10-17' }),
    ],
  };
  const conNueva = armarCarteraViva(nueva, [], [venta], precios(6_000), null, [], tcHoy);
  ok(tenencia(vieja, 'GGAL') === 70, 'con la corrida del 10/10, la venta del 15/10 se aplica');
  ok(tenencia(conNueva, 'GGAL') === 70 && caja(conNueva, 'ARS') === 330_000, 'con la corrida del 17/10, la misma venta no se aplica otra vez', { t: tenencia(conNueva, 'GGAL'), c: caja(conNueva, 'ARS') });
  ok(conNueva.cuentas.find(c => c.cuenta === BALANZ)?.movimientosAplicados === 0, 'la cuenta queda con 0 movimientos aplicados');
  ok(!movimientoVigente(mov({ fecha: '2026-10-17', tipo: 'renta', montoNeto: 1 }), '2026-10-17'), 'un movimiento del mismo día de la corrida se toma como incluido');
  ok(movimientoVigente(mov({ fecha: '2026-10-18', tipo: 'renta', montoNeto: 1 }), '2026-10-17'), 'uno posterior se aplica');
  const porCuenta = armarCarteraViva({ ...corrida, fechaPorCuenta: { [BALANZ]: '2026-10-16' } }, [], [venta], precios(6_000), null, [], tcHoy);
  ok(tenencia(porCuenta, 'GGAL') === 100, 'el corte también puede ser por cuenta (fechaPorCuenta)');
}

console.log('\n=== §3 duplicados por (cuenta, fecha, tipo, ticker, cantidad, monto) ===');
{
  const a = mov({ tipo: 'venta', ticker: 'GGAL', cantidad: 30, montoNeto: 186_000 });
  const mismoOtroArchivo = { ...a, ticker: ' ggal ', montoNeto: 186_000.001, origen: 'manual' as const, nota: 'otra' };
  ok(claveDuplicado(a) === claveDuplicado(mismoOtroArchivo), 'misma clave con ticker en minúscula/espacios y monto al centavo');
  ok(claveDuplicado(a) !== claveDuplicado({ ...a, cantidad: 31 }), 'otra cantidad → otra clave');
  ok(claveDuplicado(a) !== claveDuplicado({ ...a, fecha: '2026-10-16' }), 'otra fecha → otra clave');
  const r = separarDuplicados([a, mismoOtroArchivo, { ...a, cantidad: 5, montoNeto: 31_000 }], [{ ...a, id: 'ya' }]);
  ok(r.aCargar.length === 1 && r.duplicados.length === 2, 'contra lo existente y dentro del mismo lote', { aCargar: r.aCargar.length, dup: r.duplicados.length });
}

console.log('\n=== Addendum 1: el TC de la cartera viva ===');
{
  const viejo: TcCarteraViva = { valor: 1480, fuente: 'tcDiario', fechaCotizacion: '2026-10-19', viejo: true };
  const cv = armarCarteraViva(corrida, [], [], precios(6_000), null, [], viejo);
  ok(cv.tcViejo === true && cv.tc?.viejo === true && cv.tc.fuente === 'tcDiario', 'con tc.viejo la marca llega a la salida');
  const ggal = cv.lineas.find(l => l.ticker === 'GGAL')!;
  ok(cerca(ggal.valorUsd, 600_000 / 1480), 'un activo en pesos se divide por tc.valor (1480), no por el tcDiario de la carga (1500)', ggal.valorUsd);
  ok(cerca(cv.lineas.find(l => l.ticker === 'ARS')!.valorUsd, 150_000 / 1480), 'la caja en pesos también va con tc.valor');
  const hoy = armarCarteraViva(corrida, [], [], precios(6_000), null, [], tcHoy);
  ok(hoy.tcViejo === false, 'con el MEP del día, tcViejo = false');
  // Mismo precio que la carga: toda la diferencia es dólar.
  ok(cerca(hoy.efectoDolarUsd, hoy.efectoPreciosUsd) && hoy.efectoDolarUsd < 0, 'precio sin cambio y MEP que sube: el efecto precios es todo efecto dólar (negativo)', { d: hoy.efectoDolarUsd, p: hoy.efectoPreciosUsd });
  const sinTc = armarCarteraViva(corrida, [], [], precios(6_000), null, [], null);
  ok(sinTc.lineas.find(l => l.ticker === 'GGAL')!.valorUsd === null && sinTc.inconsistencias.some(i => i.includes('sin TC')), 'sin TC: lo que está en pesos no se valúa y se dice');

  const RESP = { moneda: 'USD', casa: 'bolsa', nombre: 'Bolsa', compra: 1536.7, venta: 1544.1, fechaActualizacion: '2026-10-19T21:00:00.000Z' };
  const diario = [{ fecha: '2026-10-17', tcUsdArs: 1530 }, { fecha: '2026-10-19', tcUsdArs: 1541 }, { fecha: '2026-10-18', tcUsdArs: 1535 }];
  const a = resolverTcCarteraViva({ status: 200, body: RESP }, diario, '2026-10-19T21:20:00.000Z');   // 18:20 ART
  ok(a?.fuente === 'dolarapi-bolsa' && a.valor === 1544.1 && a.viejo === false && a.fechaCotizacion === HOY, 'respuesta real de hoy (21:00Z = 18:00 ART) → dolarapi, no viejo', a);
  const b = resolverTcCarteraViva({ status: 200, body: RESP }, diario, '2026-10-20T01:38:00.000Z');   // 22:38 ART del 19
  ok(b?.fuente === 'dolarapi-bolsa', 'a las 22:38 ART (ya 20/10 en UTC) sigue siendo de hoy: la fecha se compara en hora argentina', b);
  const c = resolverTcCarteraViva({ status: 502, body: 'Bad Gateway' }, diario, '2026-10-19T21:20:00.000Z');
  ok(c?.fuente === 'tcDiario' && c.valor === 1541 && c.viejo, 'API caída → el tcDiario más reciente, marcado viejo', c);
  // tcDiario[D] guarda el cierre del día hábil anterior (F9.103): el doc del lunes 19/10 rotula el viernes 16/10.
  ok(c?.fechaCotizacion === '2026-10-16', 'respaldo: un doc del lunes rotula el viernes', c?.fechaCotizacion);
  ok(diaHabilAnterior('2026-10-21') === '2026-10-20', 'día hábil anterior de un miércoles = martes');
  ok(diaHabilAnterior('2026-10-18') === '2026-10-16' && diaHabilAnterior('2026-10-17') === '2026-10-16', 'domingo y sábado → viernes');
  ok(diaHabilAnterior('2026-03-02') === '2026-02-27', 'cruza fin de mes (lunes 02/03 → viernes 27/02)');
  const d = resolverTcCarteraViva({ status: 200, body: { ...RESP, fechaActualizacion: '2026-10-17T21:00:00.000Z' } }, diario, '2026-10-19T21:20:00.000Z');
  ok(d?.fuente === 'tcDiario', 'fechaActualizacion de otro día → respaldo', d);
  const e = resolverTcCarteraViva({ status: 200, body: { ...RESP, venta: 'x' } }, diario, '2026-10-19T21:20:00.000Z');
  ok(e?.fuente === 'tcDiario', 'venta inválida → respaldo');
  ok(resolverTcCarteraViva(null, [], '2026-10-19T21:20:00.000Z') === null, 'sin API ni tcDiario → null, no inventa');
  ok(resolverTcCarteraViva(null, [{ fecha: '2026-10-19', tcUsdArs: 0 }], '2026-10-19T21:20:00.000Z') === null, 'un tcDiario en 0 no cuenta como respaldo');
}

console.log('\n=== §2 resto de la definición por cuenta ===');
{
  // Precio viejo: el último conocido, marcado con su fecha.
  const v = armarCarteraViva(corrida, [], [], precios(6_100, '2026-10-16'), null, [], tcHoy);
  const g = v.lineas.find(l => l.ticker === 'GGAL')!;
  ok(g.precio === 'viejo' && g.precioFecha === '2026-10-16', 'sin precio de hoy → último conocido, marcado viejo con su fecha');
  // Sin ningún precio: el de la carga.
  const sp = armarCarteraViva(corrida, [], [], precios(null), null, [], tcHoy).lineas.find(l => l.ticker === 'GGAL')!;
  ok(sp.precio === 'corrida' && sp.precioFecha === FECHA_CORRIDA && cerca(sp.valorUsd, 600_000 / 1544.1), 'sin precio → el de la carga, con su fecha');
  // Guarda de escala: un precio 100× (bono cotizado cada 100 VN) no se usa.
  const bono = { fecha: FECHA_CORRIDA, posiciones: [fila({ cuenta: BALANZ, ticker: 'AL30', tipo: 'bono', moneda_origen: 'ARS', valor_origen: 90_000, cantidad: 1000 })] };
  const eb = armarCarteraViva(bono, [], [], { hoy: HOY, porIdentidad: { 'AL30|bono|AR': { precio: 9_100, moneda: 'ARS', fecha: HOY } } }, null, [], tcHoy);
  const al = eb.lineas[0];
  ok(al.precio === 'escala_dudosa' && cerca(al.valorOrigen, 90_000) && eb.inconsistencias.some(i => i.includes('AL30')), 'precio 100× el implícito → escala_dudosa, se usa el de la carga y se avisa', al);
  // Cripto: precio de criptoLectura, stablecoins a 1.
  const cripto: LecturaCripto = { leidoEnISO: '2026-10-19T12:15:00.000Z', precios: { BTC: { valor: 100_000, fuente: 'bitfinex', error: null } }, sondeo: [] };
  const cc = { fecha: FECHA_CORRIDA, posiciones: [
    fila({ cuenta: 'Nexo', ticker: 'BTC', tipo: 'cripto', moneda_origen: 'USD', valor_origen: 9_000, cantidad: 0.1, pais_riesgo: 'global' }),
    fila({ cuenta: 'Nexo', ticker: 'USDT', tipo: 'cripto', moneda_origen: 'USD', valor_origen: 50, cantidad: 50, pais_riesgo: 'global' }),
  ] };
  const ec = armarCarteraViva(cc, [], [], precios(null), cripto, [], tcHoy);
  ok(cerca(ec.lineas.find(l => l.ticker === 'BTC')!.valorUsd, 10_000) && ec.lineas.find(l => l.ticker === 'BTC')!.precio === 'hoy', 'BTC: cantidad × precio de criptoLectura');
  ok(cerca(ec.lineas.find(l => l.ticker === 'USDT')!.valorUsd, 50), 'USDT a 1');
  // Manuales: ya valuadas por el cron.
  const man: PosicionManual = { id: 'm1', ticker: 'ACN', nombre: 'Accenture', cantidad: 43, valorUsd: 10_000, fechaValuacion: HOY, tipo: 'accion', sector: 'it', pais_riesgo: 'global', cuenta: 'Plan ACN', notas: '' };
  const em = armarCarteraViva(corrida, [], [], precios(6_000), null, [man], tcHoy);
  ok(em.lineas.some(l => l.ticker === 'ACN' && l.precio === 'manual') && em.cuentas.some(c => c.cuenta === 'Plan ACN' && c.fuente === 'manual'), 'las manuales entran tal como las valuó el cron');
  // Cuenta con API: reemplaza a la carga y no aplica movimientos.
  const PPI = 'PPI 101268';
  const conPpi = { fecha: FECHA_CORRIDA, posiciones: [...corridaBase, fila({ cuenta: PPI, ticker: 'GGAL', tipo: 'accion', moneda_origen: 'ARS', valor_origen: 60_000, cantidad: 10 })] };
  const viva: CuentaViva = {
    cuenta: PPI, fuente: 'ppi_api', leidoEn: '2026-10-19T21:10:00.000Z',
    posiciones: [{ cuenta: PPI, titular: null, ticker: 'GGAL', tipo: 'accion', sector: 'x', pais_riesgo: 'AR', moneda_origen: 'ARS', valor_origen: 78_000, cantidad: 12, fuente: 'ppi_api', revisar: false }],
    saldos: { ARS: 5_000, USD: 0 },
  };
  const movPpi = mov({ cuenta: PPI, tipo: 'compra', ticker: 'GGAL', cantidad: 2, montoNeto: 12_000, origen: 'ppi_api' });
  const ep = armarCarteraViva(conPpi, [viva], [movPpi], precios(6_500), null, [], tcHoy);
  const ppiGgal = ep.lineas.filter(l => l.cuenta === PPI && l.ticker === 'GGAL');
  ok(ppiGgal.length === 1 && ppiGgal[0].cantidad === 12, 'PPI: las posiciones de la API reemplazan a las de la carga, sin aplicar sus movimientos', ppiGgal);
  ok(cerca(ppiGgal[0].valorUsd, 12 * 6_500 / 1544.1), 'PPI: la tenencia de la API, a precio del día');
  ok(ep.lineas.some(l => l.cuenta === PPI && l.tipo === 'cash' && l.valorOrigen === 5_000), 'PPI: la caja sale de saldos');
  ok(ep.cuentas.find(c => c.cuenta === PPI)?.fuente === 'api', 'PPI figura con fuente api');
  const conError = armarCarteraViva(conPpi, [{ ...viva, posiciones: [], error: 'HTTP 401' }], [], precios(6_500), null, [], tcHoy);
  ok(conError.cuentas.find(c => c.cuenta === PPI)?.fuente === 'corrida' && conError.inconsistencias.some(i => i.includes('HTTP 401')), 'PPI con error y sin lectura buena: sigue por la carga y muestra el error crudo');
  // Venta mayor a la tenencia: se muestra, no se corrige sola.
  const excede = armarCarteraViva(corrida, [], [mov({ tipo: 'venta', ticker: 'GGAL', cantidad: 150, montoNeto: 900_000 })], precios(6_000), null, [], tcHoy);
  ok(tenencia(excede, 'GGAL') === -50 && excede.inconsistencias.some(i => i.includes('−50') || i.includes('-50')), 'venta mayor a la tenencia: queda la diferencia a la vista', excede.inconsistencias);
}

console.log(`\n${fallas === 0 ? 'OK — todo verde' : `${fallas} FALLA(S)`}`);
if (fallas) process.exit(1);
