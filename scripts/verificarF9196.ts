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
// F9.196 cierre — H2 (sincronizaciones y valor de hoy), H5 (tesis) y H6 (card y orden de Tenencias).
import { planSincronizacionPPI, ventanaDesde } from '../functions/src/ppiSincronizacion';
import { planSincronizacionBitfinex } from '../functions/src/bitfinexSincronizacion';
import { armarDocCarteraViva } from '../functions/src/carteraVivaCron';
import { elegirPrecioDia, escalaData912 } from '../functions/src/preciosRespaldo';
import { normalizarTesis, fusionarTesis, editarTesis, calcularTesis, type Tesis } from '../src/datos/compartido/tesis';
import { accionesAMirar, ordenarTenencias, variacionConFecha, distANivel, taparMontos, cuandoFue } from '../src/datos/patrimonioAccionesAMirar';
import { leerNumero } from '../src/datos/patrimonioNumeros';
import type { IndicadoresPosicion } from '../src/types/patrimonio';
// F9.196.1 — H0 a H4.
import { ENCABEZADOS_MIS_INSTRUMENTOS, parsearMisInstrumentos, detectarVista, aplicarVista } from '../src/datos/patrimonioBalanzArchivo';
import { flujosAutomaticos, aparearTransferencias, FLUJOS_AUTO_DESDE } from '../src/datos/compartido/patrimonioFlujosAuto';
import { conCandado, type DbCandado } from '../functions/src/candado';
import { frescuraCartera } from '../functions/src/carteraVivaCron';
// F9.196.1 Addendum 1 — A y B.
import { mensajeDeErrorCallable, exigirRecalculoOk } from '../src/datos/patrimonioRecalcular';

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
// Origen 'manual' (carga manual de §3): desde el Addendum 2 los movimientos del archivo de Balanz
// (`archivo_balanz`) no se aplican en la cartera viva — la caja de Balanz es la anclada (§B).
const mov = (m: Partial<MovimientoCuenta> & Pick<MovimientoCuenta, 'tipo' | 'montoNeto'>): MovimientoCuenta => ({
  fecha: '2026-10-15', cuenta: BALANZ, moneda: 'ARS', origen: 'manual', ...m,
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
  const delArchivo = armarCarteraViva(corrida, [], [{ ...venta, origen: 'archivo_balanz' }], precios(6_500), null, [], tcHoy);
  ok(tenencia(delArchivo, 'GGAL') === 100 && caja(delArchivo, 'ARS') === 150_000, 'Addendum 2: un movimiento del archivo de Balanz no se aplica (la caja es la anclada)');
  const enEspecie = armarCarteraViva(corrida, [], [mov({ tipo: 'deposito', ticker: 'GGAL', cantidad: 10, montoNeto: 60_000 })], precios(6_500), null, [], tcHoy);
  ok(tenencia(enEspecie, 'GGAL') === 110 && caja(enEspecie, 'ARS') === 150_000, 'un depósito EN ESPECIE suma tenencia y no caja');
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

console.log('\n=== H2: sincronización de PPI y Bitfinex, y valor de hoy (sintéticos) ===');
{
  const balances = {
    groupedAvailability: [{ currency: 'Dolar Billete | MEP', availability: [{ name: 'MEP', symbol: 'USD', amount: 100, settlement: 'INMEDIATA' }] }],
    groupedInstruments: [{ name: 'ACCIONES', instruments: [{ ticker: 'GGAL', currency: 'Pesos', price: 6000, quantity: 10, amount: 60000, ppc: { ppcValue: 5000 } }] }],
  };
  const movs = [{ agreementDate: '2026-10-15', settlementDate: '2026-10-16', currency: 'Pesos', amount: -60000, price: 6000, description: 'COMPRA GGAL', ticker: 'GGAL', quantity: 10, balance: 0 }];
  const p1 = planSincronizacionPPI({ cuenta: 'PPI XXXXX', balances, movements: movs, leidoEnISO: '2026-10-20T21:10:00Z', clasificar: () => ({ sector: 'bancos', pais_riesgo: 'AR' }) });
  const p2 = planSincronizacionPPI({ cuenta: 'PPI XXXXX', balances, movements: movs, leidoEnISO: '2026-10-21T21:10:00Z', clasificar: () => ({ sector: 'bancos', pais_riesgo: 'AR' }) });
  ok(p1.cuentaViva.saldos?.USD === 100 && p1.movimientos.length === 1 && p1.movimientos[0].id === p2.movimientos[0].id, 'PPI: caja INMEDIATA, movimiento clasificado e id idéntico al re-sincronizar');
  ok(ventanaDesde({ historialCompleto: true, leidoEn: '2026-10-01T00:00:00Z' }, Date.parse('2026-10-20T21:00:00Z')).dias > 10, 'PPI: tras días sin sincronizar, la ventana cubre el hueco');
  const bfx = planSincronizacionBitfinex({
    wallets: [['exchange', 'BTC', 0.1, 0, 0.1, null, null], ['exchange', 'UST', 5, 0, 5, null, null]],
    funding: [{ origen: 'credits', body: [] }],
    ledgers: [{ categoria: 101, filas: [[1, 'UST', 'exchange', Date.UTC(2026, 9, 1), null, 5, 5, null, 'Deposit']] }],
    leidoEnISO: '2026-10-21T12:20:00Z', precioUsd: () => 80000,
  });
  ok(bfx.cuentaViva.posiciones.length === 2 && bfx.movimientos[0].ticker === 'USDT' && bfx.movimientos[0].tipo === 'deposito', 'Bitfinex: billeteras por activo y depósito en especie');
  ok(elegirPrecioDia({ data912: 88_000, monedaSerie: 'ARS', escalaData912: escalaData912('bono', null), ppi: null, hoy: '2026-10-20' })?.precio === 880
    && elegirPrecioDia({ data912: null, monedaSerie: 'ARS', ppi: { precio: 5765, escala: 1 }, hoy: '2026-10-20' })?.fuente === 'ppi', 'precios: bonos de data912 a 1 VN; respaldo de PPI cuando data912 falla');
  const doc = armarDocCarteraViva({
    fechaCorrida: '2026-10-13', posiciones: corridaBase, cuentasVivas: [], movimientos: [], cripto: null, manuales: [],
    indicadores: [{ ticker: 'GGAL', tipo: 'accion', paisRiesgo: 'AR', precioDia: { precio: 6500, moneda: 'ARS', fecha: '2026-10-20', fuente: 'data912' } }],
    tc: { valor: 1544.1, fuente: 'dolarapi-bolsa', fechaCotizacion: '2026-10-20', viejo: false },
  }, '2026-10-20T21:20:00.000Z');
  ok(doc.frescura.some(l => l.startsWith('Balanz 402665: carga 13/10')) && doc.frescura.some(l => l.startsWith('MEP $1.544, hoy')) && cerca(doc.efectoPreciosUsd + doc.efectoMovimientosUsd, doc.totalUsd - doc.totalCargaUsd),
    'cron de cartera viva: frescura por cuenta y diferencia = precios + movimientos', doc.frescura);
}

console.log('\n=== H5: tesis por acción (sintéticos) ===');
{
  const t = normalizarTesis({ monedaFundamentals: 'USD', epsGuiaMin: 2, epsGuiaMax: 3, precioObjetivoConsenso: 60, gatillos: [{ texto: 'x ≥ 1', metrica: 'x', operador: '>=', umbral: 1, valorActual: 2 }], proximoEvento: { fecha: '2026-10-24', tipo: 'balance', texto: '' }, cortoPlazo: '', medianoPlazo: '', riesgoPrincipal: '', fuentes: [], fechaDatos: '2026-10-19' }).tesis as Tesis;
  const c = calcularTesis(t, { valor: 75_000, moneda: 'ARS' }, { tc: 1500, hoy: '2026-10-20' });
  ok(cerca(c.pe, 20, 1e-9) && cerca(c.potencial, 0.2, 1e-9) && c.gatillos[0].cumplido === true && c.diasAlEvento === 4, 'P/E con MEP, potencial, gatillo y días al evento');
  const editado = editarTesis(fusionarTesis(null, 'YPFD', t), 'precioObjetivoConsenso', 55);
  const re = fusionarTesis(editado, 'YPFD', { ...t, precioObjetivoConsenso: 70 });
  ok(re.tesis.precioObjetivoConsenso === 55 && re.distintoDelChat.precioObjetivoConsenso === 70, 'el campo editado por Juan no se pisa y el del chat queda aparte');
}

console.log('\n=== H6: Acciones a mirar y orden de Tenencias (sintéticos) ===');
{
  const ind = (ticker: string, estado: 'tocado' | 'cerca' | 'ok', dist: number, senales: IndicadoresPosicion['senales'] = []): [string, IndicadoresPosicion] => [`${ticker}|accion|AR`, {
    ticker, tipo: 'accion', paisRiesgo: 'AR', precio: 100, monedaSerie: 'ARS', calculadoEnISO: '2026-10-20T21:00:00Z',
    stops: { estado, distStopAtrPct: dist, stopAtr: 95, estadoSma200: 'encima' } as IndicadoresPosicion['stops'],
    senales, historialStops: [{ fecha: '2026-10-19', cierre: 102, stopAtr: 95, sma50: null, sma200: null }, { fecha: '2026-10-20', cierre: 100, stopAtr: 95, sma50: null, sma200: null }],
  } as unknown as IndicadoresPosicion];
  const m = new Map([
    ind('OKA', 'ok', 0.3),
    ind('EVE', 'ok', 0.2, [{ id: 'evento_proximo', texto: 'Balance en 4 días', desde: '2026-10-17', nivel: 'info', nueva: false }]),
    ind('CER', 'cerca', 0.02),
    ind('TOC', 'tocado', -0.01),
    ind('GAT', 'ok', 0.25, [{ id: 'gatillo_tesis', texto: 'Gatillo de tesis cumplido: x', desde: '2026-10-20', nivel: 'atencion', nueva: true }]),
  ]);
  const a = accionesAMirar(m, new Set(m.keys()));
  ok(a.filas.map(f => f.ticker).join(',') === 'TOC,CER,GAT,EVE' && a.revisadas === 5, 'solo excepciones, en el orden de §7 (tocado, cerca, gatillo, evento)', a.filas.map(f => f.ticker));
  ok(cerca(a.filas[0].variacionDia, 100 / 102 - 1, 1e-9) && a.filas.find(f => f.ticker === 'EVE')!.detalle.includes('Balance en 4 días'), 'fila: variación del día y detalle de la segunda línea');
  ok(accionesAMirar(new Map([ind('OKA', 'ok', 0.3)]), new Set(['OKA|accion|AR'])).filas.length === 0, 'sin excepciones → la card muestra "Ninguna acción…" (0 filas, 1 revisada)');
  const xs = [...m.keys()].map((k, i) => ({ ticker: k.split('|')[0], totalUsd: 100 - i, identidades: [k] }));
  ok(ordenarTenencias(xs, 'stop', m)[0].ticker === 'TOC' && ordenarTenencias(xs, 'peso', m)[0].ticker === 'OKA' && ordenarTenencias(xs, 'peso', m, 'ce').map(x => x.ticker).join() === 'CER',
    'Tenencias: "cerca del stop primero", peso y buscador por ticker');
  // Arreglos de la revisión de H6.
  const h = (f1: string, f2: string) => ({ historialStops: [{ fecha: f1, cierre: 100, stopAtr: null, sma50: null, sma200: null }, { fecha: f2, cierre: 90, stopAtr: null, sma50: null, sma200: null }] }) as Pick<IndicadoresPosicion, 'historialStops'>;
  ok(variacionConFecha(h('2026-10-10', '2026-10-20')) === null && cerca(variacionConFecha(h('2026-10-16', '2026-10-19'))!.valor, -0.1, 1e-9),
    'variación: con un hueco de más de 4 días no se muestra; viernes → lunes sí');
  ok(cuandoFue('2026-10-20', '2026-10-20') === 'hoy' && cuandoFue('2026-10-17', '2026-10-20') === 'al 17/10', 'variación rotulada "hoy" solo si es de hoy');
  ok(cerca(distANivel(39.10 / 36.40 - 1), 36.40 / 39.10 - 1, 1e-12), 'distancia al stop en el formato de §7: nivel ÷ precio − 1 (36,40 vs 39,10 → −6,9%)');
  ok(taparMontos('Cierre 39,10 en o debajo del stop ATR 36,40') === 'Cierre ••• en o debajo del stop ATR •••' && taparMontos('Balance en 4 días · −6,9%') === 'Balance en 4 días · −6,9%',
    'modo privado: se tapan los montos, no los porcentajes ni los días');
  const n = (s: string) => { const r = leerNumero(s); return 'error' in r ? 'error' : r.valor; };
  ok(n('45000') === 45000 && n('45,5') === 45.5 && n('1.234,56') === 1234.56 && n('2.5') === 2.5 && n('0.125') === 0.125 && n('45.000') === 'error' && n('abc') === 'error' && n('-1,5') === -1.5 && n('') === null,
    'editor: números como se escriben en Argentina; "45.000" es ambiguo y se rechaza');
}

console.log('\n=== F9.196.1: H0 a H4 (sintéticos) ===');
const h0aH4 = (async () => {
  // H0 — la misma cartera en las dos vistas da el mismo valor en USD; el costo en pesos no se convierte.
  const MEP = 1550;
  const filas: Array<[string, string, number, number, string]> = [['GGAL', 'Acciones', 100, 4, 'Pesos'], ['GD30', 'Bonos', 1000, 0.57, 'Dólares'], ['VIST', 'Cedears', 50, 2.2, 'Pesos'], ['BCMMUSDA', 'Fondos', 500, 1.02, 'Dólares']];
  const fila = (ars: boolean) => ([t, tipo, nom, px, mon]: (typeof filas)[number]) => {
    const enUsd = !ars || (tipo === 'Fondos' && mon === 'Dólares');
    const p = enUsd ? px : px * MEP;
    return [t, tipo, t, nom, 0, p, '17:00', 0, enUsd ? px * 0.9 : px * 0.9 * 1000, Math.round(nom * p * 100) / 100, 0, 0, 0, 0, 0, null, mon];
  };
  const tabla = (ars: boolean) => [[...ENCABEZADOS_MIS_INSTRUMENTOS], ...filas.map(fila(ars))];
  const ctx = (exp: string) => ({ comitente: '999001', exportadoEn: exp, clasificaciones: new Map() });
  const usd = parsearMisInstrumentos(tabla(false), ctx('2026-10-20T18:31:00-03:00'));
  const ars = parsearMisInstrumentos(tabla(true), ctx('2026-10-21T17:42:00-03:00'));
  const px = new Map(filas.map(f => [f[0], f[3]]));
  const precioDe = (p: { ticker: string }) => (px.has(p.ticker) ? { precio: px.get(p.ticker)!, moneda: 'USD' as const, fecha: '2026-10-21' } : null);
  const det = detectarVista(ars, { precioDe, tc: MEP, previa: null });
  const rU = aplicarVista(usd, 'USD', { mep: null, previa: null }).imp!;
  const rA = aplicarVista(ars, 'ARS', { mep: { valor: MEP, fuente: 'dolarapi-bolsa', fechaCotizacion: '2026-10-21', viejo: false }, previa: { costoPromedio: rU.costoPromedio, costoUsdDel: rU.costoUsdDel, exportadoEn: rU.exportadoEn, vista: 'USD' } }).imp!;
  ok(det.vista === 'ARS' && Math.abs(rA.valorUsdBalanz / rU.valorUsdBalanz - 1) < 0.01 && rA.costoPromedio['GGAL'] === rU.costoPromedio['GGAL'],
    'H0: vista en pesos reconocida; mismo valor en USD que la de dólares; el costo es el del archivo en dólares', { det: det.vista, u: rU.valorUsdBalanz, a: rA.valorUsdBalanz });

  // H1 — corte de los flujos automáticos y un día al revés.
  let k = 0;
  const mov = (m: Partial<MovimientoCuenta> & Pick<MovimientoCuenta, 'cuenta' | 'tipo' | 'fecha' | 'montoNeto'>): MovimientoCuenta => ({ id: `v${++k}`, moneda: 'USD', origen: 'manual', ...m });
  const viejo = flujosAutomaticos([mov({ cuenta: 'PPI', tipo: 'retiro', fecha: '2026-10-20', montoNeto: 1000 })], {}, () => 1500, FLUJOS_AUTO_DESDE);
  const alReves = aparearTransferencias([mov({ cuenta: 'PPI', tipo: 'retiro', fecha: '2026-10-21', montoNeto: 1000 }), mov({ cuenta: 'Balanz', tipo: 'deposito', fecha: '2026-10-20', montoNeto: 1000 })]);
  ok(viejo.historial.length === 1 && viejo.pendientes.length === 0 && alReves.internas.length === 1, 'H1: lo anterior al 21/10 sin par va a historial; un depósito 1 día hábil antes aparea');

  // H2 — ratio con el subyacente y control de escala.
  const t = normalizarTesis({ monedaFundamentals: 'USD', epsGuiaMin: 4, epsGuiaMax: 6, precioObjetivoConsenso: 60, gatillos: [], proximoEvento: { fecha: null, tipo: 'otro', texto: '' }, cortoPlazo: '', medianoPlazo: '', riesgoPrincipal: '', fuentes: [], fechaDatos: null }).tesis as Tesis;
  const sin = calcularTesis(t, { valor: 6000, moneda: 'ARS' }, { tc: 1500, hoy: '2026-10-20' });
  const con = calcularTesis({ ...t, ratioSubyacente: { valor: 10, tipo: 'adr', fuente: 'x', fecha: null } }, { valor: 6000, moneda: 'ARS' }, { tc: 1500, hoy: '2026-10-20' });
  ok(sin.potencial === null && sin.motivoPotencial === 'consenso_fuera_de_escala' && cerca(con.potencial, 0.5, 1e-9) && cerca(con.pe, 8, 1e-9), 'H2: ADR sin ratio → fuera de escala; con ratio 10 → potencial +50% y P/E 8');

  // H3 — candado: dos corridas simultáneas, una sola llamada.
  const docs = new Map<string, Record<string, unknown>>();
  let cola: Promise<unknown> = Promise.resolve();
  const db = {
    collection: () => ({ doc: (id: string) => ({ id }) }),
    runTransaction: <T>(fn: (tx: unknown) => Promise<T>) => {
      const p = cola.then(async () => {
        const w: Array<() => void> = [];
        const out = await fn({
          get: async (r: { id: string }) => ({ data: () => docs.get(r.id) }),
          set: (r: { id: string }, v: Record<string, unknown>) => { w.push(() => docs.set(r.id, v)); },
          delete: (r: { id: string }) => { w.push(() => docs.delete(r.id)); },
        });
        w.forEach(x => x());
        return out;
      });
      cola = p.catch(() => undefined);
      return p;
    },
  } as unknown as DbCandado;
  let llamadas = 0;
  const correr = () => conCandado(db, 'bitfinex', 'x', async () => { llamadas++; await new Promise(r => setTimeout(r, 20)); });
  const rs = await Promise.all([correr(), correr()]);
  ok(llamadas === 1 && rs.filter(r => r.corrio).length === 1 && docs.size === 0, 'H3: dos sincronizaciones de Bitfinex a la vez → una sola llama a la API, y el candado se libera');

  // H4 — las dos fechas de Balanz.
  const cv = { cuentas: [{ cuenta: 'Balanz 999001', fuente: 'cuenta_viva', fechaBase: '2026-10-13' }], tc: null } as unknown as Parameters<typeof frescuraCartera>[0];
  const viva = { cuenta: 'Balanz 999001', fuente: 'archivo_balanz', leidoEn: '2026-10-21T17:42:00-03:00', exportadoEn: '2026-10-21T17:42:00-03:00', error: null, posiciones: [{}], saldos: {}, cajaAnclada: { hasta: '2026-10-16' } } as unknown as Parameters<typeof frescuraCartera>[1][number];
  const fr = frescuraCartera(cv, [viva], null, '2026-10-21T21:20:00.000Z');
  ok(fr.some(l => l.startsWith('Balanz 999001: tenencia del 21/10 · caja al 16/10 · ⚠ fechas distintas')), 'H4: "tenencia del dd/mm · caja al dd/mm" con aviso si difieren más de 1 día hábil', fr);
})();

console.log('\n=== F9.196.1 Addendum 1 A: mensaje del internal sin texto ===');
{
  const sinTexto = mensajeDeErrorCallable(Object.assign(new Error('internal'), { code: 'functions/internal' }));
  const conTexto = mensajeDeErrorCallable(Object.assign(new Error('Faltan secretos de PPI'), { code: 'functions/internal' }));
  const tiempo = mensajeDeErrorCallable(Object.assign(new Error('deadline-exceeded'), { code: 'functions/deadline-exceeded' }));
  ok(sinTexto.startsWith('No respondió la función') && conTexto === 'Faltan secretos de PPI' && tiempo.startsWith('La función tardó'),
    'internal sin texto → "No respondió la función…"; con texto → el texto real; deadline → aviso de tiempo', { sinTexto, conTexto, tiempo });
}

console.log('\n=== F9.196.1 Addendum 1 B: ok: false nunca es éxito ===');
{
  const tira = (r: Parameters<typeof exigirRecalculoOk>[0]) => { try { exigirRecalculoOk(r); return null; } catch (e) { return (e as Error).message; } };
  ok(tira({ ok: false, totalUsd: null, error: 'Firestore caído' }) === 'Firestore caído' && tira({ ok: false, totalUsd: null }) === 'sin detalle',
    'ok: false → tira con el mensaje real (o "sin detalle")');
  const conFlujos = exigirRecalculoOk({ ok: true, totalUsd: 100, flujos: { internas: 0, pendientes: 0, flujos: 0, sinTc: 0, error: 'timeout' } });
  ok(tira({ ok: true, totalUsd: 100 }) === null && conFlujos.avisoFlujos === 'los flujos automáticos fallaron: timeout',
    'ok: true → no tira; si fallaron los flujos, el aviso va aparte');
}

h0aH4.then(() => {
  console.log(`\n${fallas === 0 ? 'OK — todo verde' : `${fallas} FALLA(S)`}`);
  if (fallas) process.exit(1);
});
