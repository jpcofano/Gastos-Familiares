// F9.196 Addendum 2 §C (H3b) — aportes y retiros automáticos y apareo de transferencias internas.
// Sin red ni Firestore. Uso: npx tsx scripts/verificarFlujosAuto.ts   → exit 1 si algo falla.
import {
  aparearTransferencias, flujosAutomaticos, diasHabilesEntre, diasEntre, claveMovimiento, APAREO,
} from '../src/datos/patrimonioFlujosAuto';
import type { MovimientoCuenta } from '../src/datos/patrimonioMovimientos';

let fallas = 0;
const ok = (cond: boolean, msg: string, detalle?: unknown) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${!cond && detalle !== undefined ? `\n       ${JSON.stringify(detalle)}` : ''}`);
  if (!cond) fallas++;
};
let n = 0;
const mov = (m: Partial<MovimientoCuenta> & Pick<MovimientoCuenta, 'cuenta' | 'tipo' | 'fecha' | 'montoNeto'>): MovimientoCuenta =>
  ({ id: `m${++n}`, moneda: 'USD', origen: 'manual', ...m });
const tcDe = (f: string) => (f >= '2026-10-01' ? 1500 : null);

console.log('=== días hábiles ===');
ok(diasHabilesEntre('2026-10-16', '2026-10-19') === 1, 'viernes → lunes = 1 día hábil');
ok(diasHabilesEntre('2026-10-19', '2026-10-26') === 5, 'lunes → lunes siguiente = 5');
ok(diasHabilesEntre('2026-10-19', '2026-10-19') === 0 && diasEntre('2026-10-19', '2026-10-22') === 3, 'mismo día = 0; corridos = 3');

console.log('\n=== Verificación del Addendum 2: transferencia interna ===');
{
  // Retiro de US$1.000 en PPI y depósito de US$995 en Balanz dos días después.
  const r = mov({ cuenta: 'PPI 0000', tipo: 'retiro', fecha: '2026-10-19', montoNeto: 1000, origen: 'ppi_api' });
  const d = mov({ cuenta: 'Balanz 0001', tipo: 'deposito', fecha: '2026-10-21', montoNeto: 995, origen: 'archivo_balanz' });
  const out = flujosAutomaticos([r, d], {}, tcDe);
  ok(out.internas.length === 1 && out.internas[0].retiro === r && out.internas[0].deposito === d, 'retiro 1.000 en PPI + depósito 995 en Balanz a 2 días → se aparean');
  ok(out.flujos.length === 0 && out.pendientes.length === 0, '...y no generan flujo');
  // Uno de US$1.000 sin pareja aparece en la lista para revisar.
  const solo = flujosAutomaticos([mov({ cuenta: 'PPI 0000', tipo: 'retiro', fecha: '2026-10-19', montoNeto: 1000 })], {}, tcDe);
  ok(solo.pendientes.length === 1 && solo.pendientes[0].sugerido === 'retiro' && solo.flujos.length === 0, 'retiro de 1.000 sin pareja → en la lista "¿Es plata que entró o salió?", sin flujo todavía');
}

console.log('\n=== reglas de dinero ===');
{
  const r = mov({ cuenta: 'A', tipo: 'retiro', fecha: '2026-10-19', montoNeto: 1000 });
  const casos: Array<[string, Partial<MovimientoCuenta>, boolean]> = [
    ['monto 1% abajo (990) → aparea', { montoNeto: 990 }, true],
    ['monto 1,1% abajo (989) → no', { montoNeto: 989 }, false],
    ['otra moneda → no', { moneda: 'ARS' }, false],
    ['misma cuenta → no', { cuenta: 'A' }, false],
    ['5 días hábiles después (26/10) → aparea', { fecha: '2026-10-26' }, true],
    ['6 días hábiles después (27/10) → no', { fecha: '2026-10-27' }, false],
    ['depósito anterior al retiro → no', { fecha: '2026-10-16' }, false],
  ];
  for (const [rotulo, cambio, espera] of casos) {
    const d = mov({ cuenta: 'B', tipo: 'deposito', fecha: '2026-10-20', montoNeto: 1000, ...cambio });
    ok((aparearTransferencias([r, d]).internas.length === 1) === espera, rotulo);
  }
  // Goloso: con dos candidatos toma el más cercano en el tiempo.
  const cerca = mov({ cuenta: 'B', tipo: 'deposito', fecha: '2026-10-20', montoNeto: 1000 });
  const lejos = mov({ cuenta: 'C', tipo: 'deposito', fecha: '2026-10-23', montoNeto: 1000 });
  const ap = aparearTransferencias([lejos, r, cerca]);
  ok(ap.internas.length === 1 && ap.internas[0].deposito === cerca && ap.sinAparear.length === 1 && ap.sinAparear[0] === lejos, 'dos candidatos → el más cercano; el otro queda sin aparear');
  // Cada movimiento entra en un solo par.
  const r2 = mov({ cuenta: 'A', tipo: 'retiro', fecha: '2026-10-19', montoNeto: 1000 });
  const unico = aparearTransferencias([r, r2, cerca]);
  ok(unico.internas.length === 1 && unico.sinAparear.length === 1, 'dos retiros y un depósito → un par y un retiro sin aparear');
}

console.log('\n=== reglas de cripto y títulos ===');
{
  const sale = mov({ cuenta: 'Bitfinex', tipo: 'retiro', fecha: '2026-10-19', montoNeto: 5000, ticker: 'BTC', cantidad: 0.05, tipoActivo: 'cripto' });
  const llega = (cantidad: number, fecha = '2026-10-21', ticker = 'BTC') =>
    mov({ cuenta: 'Nexo', tipo: 'deposito', fecha, montoNeto: 4990, ticker, cantidad, tipoActivo: 'cripto' });
  ok(aparearTransferencias([sale, llega(0.0499)]).internas.length === 1, 'BTC 0,05 → 0,0499 (comisión 0,2%) a 2 días → interna');
  ok(aparearTransferencias([sale, llega(0.0499, '2026-10-23')]).internas.length === 0, '4 días corridos → no');
  ok(aparearTransferencias([sale, llega(0.051)]).internas.length === 0, 'llega MÁS de lo que salió → no');
  ok(aparearTransferencias([sale, llega(0.0490)]).internas.length === 0, `comisión mayor al ${APAREO.toleranciaComisionCripto * 100}% → no`);
  ok(aparearTransferencias([sale, llega(0.0499, '2026-10-21', 'ETH')]).internas.length === 0, 'otro activo → no');
  const tSale = mov({ cuenta: 'Balanz 0001', tipo: 'retiro', fecha: '2026-10-19', montoNeto: 550, ticker: 'GD30', cantidad: 1000, tipoActivo: 'bono' });
  const tLlega = (cantidad: number) => mov({ cuenta: 'PPI 0000', tipo: 'deposito', fecha: '2026-10-22', montoNeto: 550, ticker: 'GD30', cantidad, tipoActivo: 'bono' });
  ok(aparearTransferencias([tSale, tLlega(1000)]).internas.length === 1, 'títulos: misma especie y cantidad a 3 días hábiles → interna');
  ok(aparearTransferencias([tSale, tLlega(999)]).internas.length === 0, 'títulos: otra cantidad → no');
  ok(aparearTransferencias([sale, mov({ cuenta: 'B', tipo: 'deposito', fecha: '2026-10-19', montoNeto: 5000 })]).internas.length === 0, 'cripto contra dinero → no');
}

console.log('\n=== regresiones de la revisión del diff (H3b) ===');
{
  // Goloso perdía este par: R1 1000 (05/10) y R2 1015 (07/10) contra D1 1010 (07/10) y D2 995 (09/10).
  const R1 = mov({ cuenta: 'PPI', tipo: 'retiro', fecha: '2026-10-05', montoNeto: 1000 });
  const R2 = mov({ cuenta: 'PPI', tipo: 'retiro', fecha: '2026-10-07', montoNeto: 1015 });
  const D1 = mov({ cuenta: 'Balanz', tipo: 'deposito', fecha: '2026-10-07', montoNeto: 1010 });
  const D2 = mov({ cuenta: 'Balanz', tipo: 'deposito', fecha: '2026-10-09', montoNeto: 995 });
  const ap = aparearTransferencias([R1, R2, D1, D2]);
  ok(ap.internas.length === 2 && ap.sinAparear.length === 0, 'apareo máximo: R1–D2 y R2–D1, ninguno queda pendiente', ap.internas.map(i => [i.retiro.montoNeto, i.deposito.montoNeto]));
  // Movimientos sin id con la misma clave no se pisan.
  const sinId = (m: Partial<MovimientoCuenta> & Pick<MovimientoCuenta, 'cuenta' | 'tipo' | 'fecha' | 'montoNeto'>): MovimientoCuenta => ({ moneda: 'USD', origen: 'manual', ...m });
  const a = sinId({ cuenta: 'PPI', tipo: 'retiro', fecha: '2026-10-19', montoNeto: 1000 });
  const b = sinId({ cuenta: 'PPI', tipo: 'retiro', fecha: '2026-10-19', montoNeto: 1000 });
  const d = sinId({ cuenta: 'Balanz', tipo: 'deposito', fecha: '2026-10-20', montoNeto: 1000 });
  const out = flujosAutomaticos([a, b, d], {}, tcDe);
  ok(out.internas.length === 1 && out.pendientes.length === 1, 'dos retiros iguales sin id + un depósito → 1 par y 1 pendiente (no desaparece)', { i: out.internas.length, p: out.pendientes.length });
  // En especie sin valuación no da un flujo de 0.
  const t = mov({ cuenta: 'Balanz', tipo: 'deposito', fecha: '2026-10-19', montoNeto: 0, ticker: 'PAMP', cantidad: 10, tipoActivo: 'accion', moneda: 'ARS' });
  const z = flujosAutomaticos([t], { [claveMovimiento(t)]: 'aporte' }, tcDe);
  ok(z.flujos.length === 0 && z.pendientes.length === 1, 'aporte en especie sin valuación → sigue pendiente, no un flujo de 0');
}

console.log('\n=== decisiones de Juan y flujos ===');
{
  const retiro = mov({ cuenta: 'PPI 0000', tipo: 'retiro', fecha: '2026-10-19', montoNeto: 1000 });
  const deposito = mov({ cuenta: 'Balanz 0001', tipo: 'deposito', fecha: '2026-10-01', montoNeto: 150_000, moneda: 'ARS' });
  const viejo = mov({ cuenta: 'Balanz 0001', tipo: 'deposito', fecha: '2025-01-10', montoNeto: 10, moneda: 'ARS' });
  const venta = mov({ cuenta: 'Balanz 0001', tipo: 'venta', fecha: '2026-10-02', montoNeto: 500, ticker: 'GGAL', cantidad: 10 });
  const inferido = mov({ cuenta: 'Balanz 0001', tipo: 'retiro', fecha: '2026-10-03', montoNeto: 70, inferido: true });
  const todos = [retiro, deposito, viejo, venta, inferido];
  const sinDecidir = flujosAutomaticos(todos, {}, tcDe);
  ok(sinDecidir.flujos.length === 0 && sinDecidir.pendientes.length === 3, 'sin decisiones: 3 pendientes (retiro, depósito, depósito viejo), cero flujos');
  ok(!sinDecidir.pendientes.some(p => p.movimiento === venta || p.movimiento === inferido), 'una venta y un movimiento inferido nunca son candidatos a flujo');
  const decidido = flujosAutomaticos(todos, {
    [claveMovimiento(retiro)]: 'retiro', [claveMovimiento(deposito)]: 'aporte', [claveMovimiento(viejo)]: 'aporte',
  }, tcDe);
  const fr = decidido.flujos.find(f => f.movimientoClave === claveMovimiento(retiro));
  const fa = decidido.flujos.find(f => f.movimientoClave === claveMovimiento(deposito));
  ok(fr?.tipo === 'retiro' && fr.montoUsd === 1000, 'retiro confirmado → flujo retiro US$1.000');
  ok(fa?.tipo === 'aporte' && fa.montoUsd === 100, 'depósito en pesos confirmado → aporte con el TC de su fecha ($150.000 / 1.500 = US$100)');
  ok(decidido.sinTc.length === 1 && decidido.sinTc[0] === viejo && decidido.pendientes.length === 0, 'depósito en pesos sin TC para su fecha → sinTc, no se inventa');
  const interna = flujosAutomaticos([retiro], { [claveMovimiento(retiro)]: 'interna' }, tcDe);
  ok(interna.flujos.length === 0 && interna.pendientes.length === 0, 'marcado "interna" por Juan → sin flujo y sale de la lista');
  const alReves = flujosAutomaticos([retiro], { [claveMovimiento(retiro)]: 'aporte' }, tcDe);
  ok(alReves.flujos[0]?.tipo === 'aporte', 'la decisión de Juan manda sobre el tipo del movimiento');
}

console.log(`\n${fallas === 0 ? 'OK — todo verde' : `${fallas} FALLA(S)`}`);
if (fallas) process.exit(1);
