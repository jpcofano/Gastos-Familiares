// F9.196 Addendum 2 §B (H3c) — verificación del importador de Movimientos de Balanz.
// Sin red ni Firestore. Fixture SINTÉTICO: una fila de cada prefijo de la tabla de §B, con números
// inventados (boletos y comprobantes falsos, sin datos de la cuenta real).
// Uso: npx tsx scripts/verificarBalanzMovimientos.ts   → exit 1 si algo falla.
import {
  ENCABEZADOS_MOVIMIENTOS_BALANZ, clasificarDescripcion, parsearMovimientosBalanz, aparearDevoluciones,
  movimientosDeBalanz, cajaAnclada, sugerirComitente, contarPorClase, idsAnulados, type ClaseBalanz,
} from '../src/datos/patrimonioBalanzMovimientos';
import { detectarArchivoBalanz } from '../src/datos/patrimonioBalanzArchivo';
import { flujosAutomaticos } from '../src/datos/patrimonioFlujosAuto';

let fallas = 0;
const ok = (cond: boolean, msg: string, detalle?: unknown) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${!cond && detalle !== undefined ? `\n       ${JSON.stringify(detalle)}` : ''}`);
  if (!cond) fallas++;
};

// [Descripcion, Ticker, Tipo, Concertacion, Cantidad, Precio, Liquidacion, Moneda, Importe]
type F = [string, string, string, string, number, number, string, string, number];
const FIX: Array<[F, ClaseBalanz]> = [
  [['Recibo de Cobro / 900001', '', '', '2026-10-01', 0, -1, '2026-10-01', 'Pesos', 300000], 'deposito'],
  [['Comprobante de Pago / 900002', '', '', '2026-10-02', 0, -1, '2026-10-02', 'Dólares', -500], 'retiro'],
  [['Comprobante de Pago / 900003', '', '', '2026-10-03', 0, -1, '2026-10-03', 'Dólares', -120], 'retiro'],
  [['Movimiento Manual / Devolucion por rechazo de transferencia', '', '', '2026-10-04', 0, -1, '2026-10-04', 'Dólares', 120], 'anula_retiro'],
  [['Boleto / 800001 / COMPRA / 0 / GD30 / usd', 'GD30', 'Bonos', '2026-10-05', 1000, 0.55, '2026-10-05', 'Dólares', -550], 'compra'],
  [['Boleto / 800001 / COMPRA / 0 / GD30 / usd', 'GD30', 'Bonos', '2026-10-05', 1000, -1, '2026-10-05', 'Pesos', -20], 'compra'],
  [['Boleto / 800002 / COMPRAEXT / 2 / AAPL.E / U$S', 'AAPL.E', 'Acciones', '2026-10-05', 2, 200, '2026-10-07', 'US Dollar (Cable)', -400], 'compra'],
  [['Boleto / 800003 / VENTA / 1 / VIST / usd', 'VIST', 'Cedears', '2026-10-15', -250, -1, '2026-10-16', 'Pesos', -1000], 'venta'],
  [['Boleto / 800003 / VENTA / 1 / VIST / usd', 'VIST', 'Cedears', '2026-10-15', -250, 24, '2026-10-16', 'Dólares', 6000], 'venta'],
  [['Boleto / 800004 / APCOLCON / 0 / usd', '', '', '2026-10-06', 0, -1, '2026-10-06', 'Dólares', -1000], 'caucion'],
  [['Boleto / 800005 / APCOLFUT / 7 / usd', '', '', '2026-10-06', 0, -1, '2026-10-13', 'Dólares', 1002], 'caucion'],
  [['Dividendo en efectivo / B', 'B', 'Cedears', '2026-10-08', 0, -1, '2026-10-08', 'Dólares C.V. 7000', 5], 'renta'],
  [['Dividendo en efectivo / B', 'B', 'Cedears', '2026-10-08', 0, -1, '2026-10-08', 'Pesos', -40], 'renta'],
  [['Renta / GD35', 'GD35', 'Bonos', '2026-10-09', 0, -1, '2026-10-09', 'Dólares', 30], 'renta'],
  [['Amortización / TTM26', 'TTM26', 'Letras', '2026-10-09', 0, -1, '2026-10-09', 'Pesos', 1000], 'renta'],
  [['Renta y Amortización / GD30', 'GD30', 'Bonos', '2026-10-09', 0, -1, '2026-10-09', 'Dólares', 40], 'renta'],
  [['Movimiento Manual / N/D Ret IIGG y BBPP - GGAL ', '', '', '2026-10-10', 0, -1, '2026-10-10', 'Pesos', -15], 'gasto'],
  [['Cargo por Descubierto del 10/10/2026', '', '', '2026-10-10', 0, -1, '2026-10-10', 'Pesos', -3], 'gasto'],
  [['Movimiento Manual / Conversión CV 7.000 a CV 10.000 (dólar mep)', '', '', '2026-10-11', 0, -1, '2026-10-13', 'Dólares', 5], 'ajuste_caja'],
  [['Movimiento Manual / Conversión CV 7.000 a CV 10.000 (dólar mep)', '', '', '2026-10-11', 0, -1, '2026-10-13', 'Dólares C.V. 7000', -5], 'ajuste_caja'],
  [['Movimiento Manual / Renta CV 7.000 a Cable', '', '', '2026-10-11', 0, -1, '2026-10-11', 'US Dollar (Cable)', 1], 'ajuste_caja'],
  [['Movimiento Manual / Liquidación con conversión', '', '', '2026-10-11', 0, -1, '2026-10-11', 'Pesos', 2], 'ajuste_caja'],
  [['Movimiento Manual / Ajuste de saldo', '', '', '2026-10-11', 0, -1, '2026-10-11', 'Pesos', 1], 'ajuste_caja'],
  [['Liquidación de Suscripción / 700001 / FONDO SINTETICO USD clase A', 'FSUSD A', 'Fondos', '2026-10-12', 1000, 1.5, '2026-10-12', 'Dólares', -1500], 'fci_caja'],
  [['Suscripción desde Balanz', 'FSUSDA', 'Fondos', '2026-10-12', 1000, 1.5, '2026-10-12', 'Dólares', 1500], 'fci_tenencia'],
  [['Liquidación de Rescate / 700002 / FONDO SINTETICO PESOS A', 'FSARS A', 'Fondos', '2026-10-14', -200, 10, '2026-10-14', 'Pesos', 2000], 'fci_caja'],
  [['Rescate a Balanz', 'FSARSA', 'Fondos', '2026-10-14', -200, 10, '2026-10-14', 'Pesos', -2000], 'fci_tenencia'],
  [['Transferencia Externa (Crédito) / EMPRESA SINTETICA / 100.000000', 'PAMP', 'Acciones', '2026-10-01', 100, 4000, '2026-10-01', '', 0], 'transferencia_titulos'],
  [['Transferencia Externa (Débito) / EMPRESA SINTETICA / 10.000000', 'PAMP', 'Acciones', '2026-10-02', -10, 4100, '2026-10-02', '', 0], 'transferencia_titulos'],
];
const tabla = (filas: F[] = FIX.map(x => x[0])): unknown[][] => [[...ENCABEZADOS_MOVIMIENTOS_BALANZ], ...filas];
const COM = '999001';

console.log('=== clasificación: una fila de cada prefijo de §B ===');
{
  const { filas } = parsearMovimientosBalanz(tabla(), COM);
  const mal = FIX.map(([f, esperada], i) => ({ d: f[0], esperada, real: filas[i]?.clase })).filter(x => x.real !== x.esperada);
  ok(mal.length === 0, `las ${FIX.length} filas caen en su clase`, mal);
  ok(!filas.some(f => f.clase === 'para_revisar'), 'ninguna queda para_revisar');
  ok(clasificarDescripcion('Algo Nuevo / 1').clase === 'para_revisar' && clasificarDescripcion('Boleto / 1 / CANJE / 0 / X').clase === 'para_revisar'
    && clasificarDescripcion('Movimiento Manual / Otra cosa').clase === 'para_revisar', 'lo que no está en la tabla → para_revisar (no se inventa)');
  ok(clasificarDescripcion('Renta / GD35').clase === 'renta' && clasificarDescripcion('Movimiento Manual / Renta CV 7.000 a Cable').clase === 'ajuste_caja'
    && clasificarDescripcion('Renta CV 7.000 a Cable').clase === 'para_revisar',
    '"Renta / X" es renta; "Movimiento Manual / Renta CV 7.000 a Cable" es ajuste; sin el prefijo no está en la tabla → para_revisar');
  ok(detectarArchivoBalanz(tabla()[0]) === 'movimientos', 'el archivo se detecta como Movimientos por los encabezados');
  let msg = '';
  try { parsearMovimientosBalanz(tabla().map(r => r.slice(0, 8)), COM); } catch (e) { msg = (e as Error).message; }
  ok(msg.includes('"Importe"'), 'encabezado faltante → error con el nombre', msg);
  const c = contarPorClase(filas);
  ok(c.compra === 3 && c.renta === 5 && c.ajuste_caja === 5, 'contarPorClase', c);
}

console.log('\n=== boletos, devoluciones, FCI y títulos ===');
const { filas } = parsearMovimientosBalanz(tabla(), COM);
const dev = aparearDevoluciones(filas);
const movs = movimientosDeBalanz(filas, COM, dev.anuladas);
{
  const vist = movs.filter(m => m.ticker === 'VIST');
  ok(vist.length === 1 && vist[0].tipo === 'venta' && vist[0].cantidad === 250 && vist[0].moneda === 'USD' && vist[0].montoNeto === 6000 && vist[0].precio === 24,
    'venta de 250 VIST en dos filas (Dólares + Pesos) → UNA venta, con precio y monto de la fila con precio', vist);
  const gd30 = movs.filter(m => m.ticker === 'GD30' && m.tipo === 'compra');
  ok(gd30.length === 1 && gd30[0].cantidad === 1000 && gd30[0].tipoActivo === 'bono', 'compra de GD30 en dos filas → una compra');
  ok(movs.some(m => m.ticker === 'AAPL.E' && m.tipo === 'compra' && m.subcuenta === 'US Dollar (Cable)'), 'COMPRAEXT → compra, con la subcuenta original');
  ok(dev.pares.length === 1 && dev.pares[0].comprobante.descripcion.includes('900003') && dev.sinComprobante.length === 0,
    'la devolución de 120 se aparea con el Comprobante de Pago anterior de 120 (no con el de 500)');
  const retiros = movs.filter(m => m.tipo === 'retiro' && !m.ticker);
  ok(retiros.length === 1 && retiros[0].montoNeto === 500, '...se anulan los dos: queda solo el retiro de 500, no deja retiro de 120');
  ok(movs.filter(m => m.tipo === 'deposito' && !m.ticker).length === 1, 'Recibo de Cobro → un depósito');
  const fci = movs.filter(m => m.tipoActivo === 'fci');
  ok(fci.length === 2 && fci.some(m => m.tipo === 'compra' && m.ticker === 'FSUSDA' && m.cantidad === 1000) && fci.some(m => m.tipo === 'venta' && m.ticker === 'FSARSA' && m.cantidad === 200),
    'FCI: la tenencia sale solo de Suscripción desde / Rescate a Balanz, con el ticker de Mis Instrumentos', fci);
  ok(!movs.some(m => m.ticker === 'FSUSD A' || m.ticker === 'FSARS A'), 'las filas de caja del FCI (otro código) no generan movimiento propio');
  const rentas = movs.filter(m => m.tipo === 'renta');
  ok(rentas.length === 4 && rentas.filter(m => m.devolucionCapital).length === 2, 'renta: una por importe positivo (el cargo en pesos del dividendo no); amortización = devolución de capital', rentas.map(r => [r.ticker, r.montoNeto, r.devolucionCapital]));
  const tt = movs.filter(m => m.ticker === 'PAMP');
  ok(tt.length === 2 && tt.some(m => m.tipo === 'deposito' && m.cantidad === 100 && m.montoNeto === 400000) && tt.some(m => m.tipo === 'retiro' && m.cantidad === 10),
    'transferencia de títulos: crédito = depósito en especie, débito = retiro en especie, valuados cantidad × precio', tt);
  ok(!movs.some(m => m.nota?.startsWith('Boleto / 800004') || m.nota?.startsWith('Boleto / 800005')), 'la caución no genera movimiento (solo caja)');
  ok(new Set(movs.map(m => m.id)).size === movs.length, 'ids únicos');
}

console.log('\n=== duplicados entre exportes que se pisan ===');
{
  const a = FIX.slice(0, 15).map(x => x[0]);
  const b = FIX.slice(10).map(x => x[0]);
  // Dentro de UN archivo, dos filas idénticas son dos filas (se cuentan las dos); entre exportes que
  // se pisan, la deduplicación la da el id (clave de §B + ocurrencia).
  const { filas: juntas, duplicadas } = parsearMovimientosBalanz(tabla([...a, ...b]), COM);
  ok(juntas.length === a.length + b.length && duplicadas === 5, 'en un mismo archivo las filas idénticas se conservan (y se informan)', { n: juntas.length, duplicadas });
  const m1 = movimientosDeBalanz(parsearMovimientosBalanz(tabla(a), COM).filas, COM, new Set()).map(m => m.id);
  const m2 = movimientosDeBalanz(parsearMovimientosBalanz(tabla(b), COM).filas, COM, new Set()).map(m => m.id);
  const comunes = m1.filter(id => m2.includes(id));
  ok(comunes.length > 0, 'el mismo movimiento en dos exportes tiene el mismo id (no se duplica al guardar)');
}

console.log('\n=== caja anclada ===');
{
  const corrida = { fecha: '2026-10-10', posiciones: [
    { cuenta: `Balanz ${COM}`, tipo: 'cash' as const, moneda_origen: 'ARS' as const, valor_origen: 50_000 },
    { cuenta: `Balanz ${COM}`, tipo: 'cash' as const, moneda_origen: 'USD' as const, valor_origen: 100 },
    { cuenta: `Balanz ${COM}`, tipo: 'cash' as const, moneda_origen: 'USD' as const, valor_origen: 10 },
    { cuenta: 'Otra', tipo: 'cash' as const, moneda_origen: 'USD' as const, valor_origen: 999 },
  ] };
  const c = cajaAnclada(filas, corrida, COM);
  // Liquidadas después del 10/10 (no cuentan fci_tenencia ni títulos):
  //   ARS: -1000 (VIST) +2000 (rescate) +2 (liq. con conversión) +1 (ajuste) = 1003;
  //   USD: 6000 (VIST) +1002 (caución) +5 -5 (conversión) +1 (renta CV a Cable) -1500 (suscripción) = 5503.
  ok(c.estado === 'ok' && c.saldos.ARS === 51_003 && c.saldos.USD === 5613, 'caja = caja de la corrida + Importe liquidado después, por moneda', c);
  ok(c.estado === 'ok' && c.cajaCorrida.USD === 110, 'la caja de la corrida suma sus filas cash en USD (sin otras cuentas)');
  ok(c.estado === 'ok' && c.porSubcuenta['Dólares C.V. 7000'] === -5 && c.porSubcuenta['Dólares'] === 5507, 'las tres de dólar suman como USD y se guarda la subcuenta');
  ok(cajaAnclada(filas, null, COM).estado === 'desconocida', 'sin corrida → caja desconocida');
  ok(cajaAnclada(filas, { fecha: '2026-10-10', posiciones: [] }, COM).estado === 'desconocida', 'corrida sin caja de la comitente → desconocida');
  const tarde = cajaAnclada(filas.filter(f => f.liquidacion > '2026-10-12'), corrida, COM);
  ok(tarde.estado === 'desconocida' && tarde.motivo.includes('puede faltar historia'), 'archivo que empieza después de la corrida (export cortado) → desconocida, no se inventa', tarde);
}

console.log('\n=== regresiones de la revisión del diff (H3c) ===');
{
  // Dos filas legítimas idénticas en el mismo archivo: las dos suman a la caja y tienen ids distintos.
  const ajuste: F = ['Movimiento Manual / Ajuste de saldo', '', '', '2026-10-20', 0, -1, '2026-10-20', 'Pesos', 100];
  const viejo: F = ['Recibo de Cobro / 900020', '', '', '2026-10-01', 0, -1, '2026-10-01', 'Pesos', 0];   // cubre el ancla
  const dos = parsearMovimientosBalanz(tabla([ajuste, ajuste, viejo]), COM).filas.filter(f => f.importe !== 0 || f.liquidacion < '2026-10-10');
  const c = cajaAnclada(dos, { fecha: '2026-10-10', posiciones: [{ cuenta: `Balanz ${COM}`, tipo: 'cash', moneda_origen: 'ARS', valor_origen: 0 }] }, COM);
  ok(dos.filter(f => f.importe === 100).length === 2 && c.estado === 'ok' && c.saldos.ARS === 200, 'dos "Ajuste de saldo" de 100 idénticos → la caja suma 200', c);
  // Boletos con el mismo número en otra fecha y otra especie no se funden.
  const b1: F = ['Boleto / 800009 / COMPRA / 0 / GGAL / $', 'GGAL', 'Acciones', '2026-10-05', 10, 6000, '2026-10-06', 'Pesos', -60000];
  const b2: F = ['Boleto / 800009 / COMPRA / 0 / YPFD / $', 'YPFD', 'Acciones', '2026-10-09', 5, 40000, '2026-10-10', 'Pesos', -200000];
  const bm = movimientosDeBalanz(parsearMovimientosBalanz(tabla([b1, b2]), COM).filas, COM, new Set());
  ok(bm.length === 2 && bm.some(m => m.ticker === 'GGAL') && bm.some(m => m.ticker === 'YPFD') && bm[0].id !== bm[1].id, 'mismo número de boleto en otra fecha/especie → dos movimientos');
  // Una devolución que llega en un export posterior borra el retiro que guardó el anterior.
  const comp: F = ['Comprobante de Pago / 900003', '', '', '2026-10-03', 0, -1, '2026-10-03', 'Dólares', -120];
  const devo: F = ['Movimiento Manual / Devolucion por rechazo de transferencia', '', '', '2026-10-04', 0, -1, '2026-10-04', 'Dólares', 120];
  const export1 = movimientosDeBalanz(parsearMovimientosBalanz(tabla([comp]), COM).filas, COM, new Set());
  const f2 = parsearMovimientosBalanz(tabla([devo, comp]), COM).filas;
  const borrar = idsAnulados(f2, COM, aparearDevoluciones(f2).anuladas);
  ok(export1.length === 1 && borrar.length === 1 && borrar[0] === export1[0].id, 'idsAnulados devuelve el id del retiro que guardó el export anterior');
  // Moneda desconocida: se informa.
  const raro: F = ['Recibo de Cobro / 900010', '', '', '2026-10-20', 0, -1, '2026-10-20', 'Euros', 50];
  ok(parsearMovimientosBalanz(tabla([raro]), COM).monedasDesconocidas.length === 1, 'una Moneda desconocida se informa (queda fuera de la caja)');
  // La caja dice hasta cuándo llega.
  const cc = cajaAnclada(filas, { fecha: '2026-10-10', posiciones: [{ cuenta: `Balanz ${COM}`, tipo: 'cash', moneda_origen: 'ARS', valor_origen: 0 }] }, COM);
  ok(cc.estado === 'ok' && cc.hasta === '2026-10-16', 'cajaAnclada.hasta = última liquidación del archivo', cc.estado === 'ok' ? cc.hasta : cc);
}

console.log('\n=== comitente sugerida y §C ===');
{
  const s = sugerirComitente(filas, [{ comitente: '999002', tickers: ['TX26', 'PAMP'] }, { comitente: '999001', tickers: ['VIST', 'GD30', 'B', 'GD35'] }]);
  ok(s[0].comitente === '999001' && s[0].comunes === 4, 'sugiere la comitente con más tickers en común (Juan confirma)', s);
  const { pendientes, internas } = flujosAutomaticos(movs, {}, () => 1500);
  ok(internas.length === 0 && pendientes.length === 4, 'depósito, retiro y las dos transferencias de títulos quedan como candidatos de §C (pendientes), las compras/ventas no', pendientes.map(p => p.movimiento.nota));
}

console.log(`\n${fallas === 0 ? 'OK — todo verde' : `${fallas} FALLA(S)`}`);
if (fallas) process.exit(1);
