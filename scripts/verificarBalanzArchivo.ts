// F9.196 Addendum 2 §A (H2b) — verificación del importador de "Mis Instrumentos" de Balanz.
// Sin red ni Firestore. Fixture SINTÉTICO: los mismos encabezados y tickers que la muestra real,
// con cantidades y precios inventados; sin titulares ni comitente real.
// Uso: npx tsx scripts/verificarBalanzArchivo.ts   → exit 1 si algo falla.
import * as XLSX from 'xlsx';
import {
  ENCABEZADOS_MIS_INSTRUMENTOS, detectarArchivoBalanz, parsearNombreBalanz, parsearMisInstrumentos,
  clasificacionesDe, cuentaVivaDeImportacion, esMismaImportacion, movimientosInferidos, controlContraApp,
  leerFilasXlsx, numeroCelda, esMasViejo, tiposPorTickerDe, type Clasificacion,
} from '../src/datos/patrimonioBalanzArchivo';
import { armarCarteraViva, type TcCarteraViva } from '../src/datos/patrimonioCarteraViva';
import { flujoDeMovimiento } from '../src/datos/patrimonioMovimientos';
import type { Posicion } from '../src/types/patrimonio';

let fallas = 0;
const ok = (cond: boolean, msg: string, detalle?: unknown) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${!cond && detalle !== undefined ? `\n       ${JSON.stringify(detalle)}` : ''}`);
  if (!cond) fallas++;
};

// ── Fixture sintético ────────────────────────────────────────────────────────
// [ticker, tipo Balanz, nominales, precio USD/VN, fecha, moneda]. Números inventados.
const FILAS: Array<[string, string, number, number, string, string]> = [
  ['BPOC7', 'Bonos', 1000, 1.02, '18:04', 'Dólares'],
  ['DICP', 'Bonos', 2000, 0.35, '18:04', 'Pesos'],
  ['GD30', 'Bonos', 3000, 0.55, '18:04', 'Dólares'],
  ['GD35', 'Bonos', 1500, 0.62, '18:04', 'Dólares'],
  ['TX26', 'Bonos', 4000, 0.4, '18:04', 'Pesos'],
  ['TZXM7', 'Bonos', 500000, 0.0015, '18:04', 'Pesos'],
  ['TLCPO', 'Corporativos', 800, 1.05, '18:04', 'US Dollar (Cable)'],
  ['GGAL', 'Acciones', 100, 4.1, '18:04', 'Pesos'],
  ['B', 'Cedears', 40, 12.5, '18:04', 'Pesos'],
  ['BIOX', 'Cedears', 60, 3.2, '18:04', 'Pesos'],
  ['CVX', 'Cedears', 20, 9.8, '18:04', 'Pesos'],
  ['GLOB', 'Cedears', 90, 2.9, '18:04', 'Pesos'],
  ['VIST', 'Cedears', 318, 2.2, '18:04', 'Pesos'],
  ['VZ', 'Cedears', 30, 5.5, '18:04', 'Pesos'],
  ['BCMMUSDA', 'Fondos', 1200, 1.03, '20/10/2026', 'Dólares'],
  ['ESTRA1A', 'Fondos', 700, 1.1, '19/10/2026', 'Dólares'],
  ['LECAPSA', 'Fondos', 900, 0.8, '20/10/2026', 'Pesos'],
];
const fila = ([t, tipo, nom, px, f, mon]: (typeof FILAS)[number]): unknown[] => {
  const va = Math.round(nom * px * 100) / 100;
  // Mismo orden que ENCABEZADOS_MIS_INSTRUMENTOS.
  return [t, tipo, `${t} sintético`, nom, 0, px, f, 0.05, px * 0.9, va, Math.round(nom * px * 0.9 * 100) / 100, va * 0.1, 0.01, 0.11, 120, null, mon];
};
const tabla = (filas = FILAS) => [ [...ENCABEZADOS_MIS_INSTRUMENTOS], ...filas.map(fila) ];
const TOTAL = FILAS.reduce((a, r) => a + Math.round(r[2] * r[3] * 100) / 100, 0);

const COM = '999001';
const EXP = '2026-10-20T18:31:09-03:00';
// Clasificación sintética de la corrida: todos menos ESTRA1A (que no está en la corrida real).
const corrida: Array<Pick<Posicion, 'cuenta' | 'ticker' | 'tipo' | 'sector' | 'pais_riesgo'>> = FILAS
  .filter(r => r[0] !== 'ESTRA1A')
  .map(r => ({
    cuenta: `Balanz ${COM}`, ticker: r[0],
    tipo: ({ Bonos: 'bono', Corporativos: 'on', Acciones: 'accion', Cedears: 'cedear', Fondos: 'fci' } as const)[r[1] as 'Bonos'],
    sector: 'x', pais_riesgo: 'AR' as const,
  }));
const clas = (): Map<string, Clasificacion> => clasificacionesDe([], corrida, `Balanz ${COM}`);
const parsear = (filas = tabla(), exportadoEn = EXP) => parsearMisInstrumentos(filas, { comitente: COM, exportadoEn, clasificaciones: clas() });

(async () => {
  console.log('=== nombre del archivo ===');
  const conCorchetes = parsearNombreBalanz('[MisInstrumentos][com999001][cuo555001][TITULAR UNO Y/O TITULAR DOS][20261020]_[183109hs].xlsx');
  ok(conCorchetes.comitente === '999001' && conCorchetes.exportadoEn === '2026-10-20T18:31:09-03:00', 'con corchetes: comitente y fecha/hora', conCorchetes);
  const sinCorchetes = parsearNombreBalanz('MisInstrumentoscom999002cuo555002TITULAR_UNO20261013_142444hs.xlsx');
  ok(sinCorchetes.comitente === '999002' && sinCorchetes.exportadoEn === '2026-10-13T14:24:44-03:00', 'sin corchetes: comitente y fecha/hora', sinCorchetes);
  const raro = parsearNombreBalanz('Mis Instrumentos (1).xlsx');
  ok(raro.comitente === null && raro.exportadoEn === null, 'nombre raro → null: la cuenta la elige Juan', raro);

  console.log('\n=== detección por encabezados ===');
  ok(detectarArchivoBalanz(tabla()[0]) === 'mis_instrumentos', 'Mis Instrumentos');
  ok(detectarArchivoBalanz(['Descripcion', 'Ticker', 'Tipo de Instrumento', 'Concertacion', 'Cantidad', 'Precio', 'Liquidacion', 'Moneda', 'Importe']) === 'movimientos', 'Movimientos (§B, se reconoce pero se importa en H3c)');
  ok(detectarArchivoBalanz(['Fecha', 'Monto']) === null, 'otro archivo → null');

  console.log('\n=== parser ===');
  const imp = parsear();
  ok(imp.filas.length === 17, '17 especies leídas', imp.filas.length);
  const tipos = Object.fromEntries(imp.posiciones.map(p => [p.ticker, p.tipo]));
  ok(tipos.GGAL === 'accion' && tipos.VIST === 'cedear' && tipos.GD30 === 'bono' && tipos.TLCPO === 'on' && tipos.LECAPSA === 'fci', 'tipos bien mapeados (accion, cedear, bono, on, fci)', tipos);
  ok(imp.filas.every(f => Math.abs(f.nominales * f.precioUsd - f.valorActualUsd) <= 1), 'nominales × precio = Valor actual (±1 USD) en todas');
  ok(Math.abs(imp.valorUsdBalanz - TOTAL) < 0.01, `valorUsdBalanz = suma de Valor actual (${TOTAL.toFixed(2)})`, imp.valorUsdBalanz);
  ok(imp.posiciones.every(p => p.moneda_origen === 'USD' && p.cuenta === `Balanz ${COM}` && p.fuente === 'archivo_balanz'), 'posiciones en USD, cuenta "Balanz <comitente>", fuente archivo_balanz');
  ok(imp.costoPromedio.GGAL !== undefined && Math.abs(imp.costoPromedio.GGAL - 4.1 * 0.9) < 1e-9, 'costoPromedio sale de "Precio promedio de compra"');
  const ggal = imp.filas.find(f => f.ticker === 'GGAL')!;
  const fci = imp.filas.find(f => f.ticker === 'ESTRA1A')!;
  ok(ggal.fechaPrecio === '2026-10-20 18:04' && fci.fechaPrecio === '2026-10-19', 'Fecha: HH:MM = hora del día de exportación; dd/mm/aaaa = fecha del VCP');
  ok(ggal.monedaCotizacion === 'ARS' && imp.filas.find(f => f.ticker === 'TLCPO')!.monedaCotizacion === 'USD', 'Moneda = moneda de cotización (Pesos→ARS, Cable→USD)');
  const estra = imp.posiciones.find(p => p.ticker === 'ESTRA1A')!;
  ok(estra.revisar && !!estra.motivo_revisar && imp.posiciones.filter(p => p.revisar).length === 1, 'ticker sin clasificación conocida → para revisar con motivo (no se adivina sector ni país)', estra);

  // Encabezado faltante.
  const sinPrecio = tabla().map(r => r.filter((_, i) => i !== 5));
  let msg = '';
  try { parsear(sinPrecio); } catch (e) { msg = (e as Error).message; }
  ok(msg.includes('"Precio"'), 'encabezado faltante → error con el nombre del encabezado', msg);
  // Tipo desconocido.
  const conRaro = tabla([...FILAS, ['XYZ', 'Opciones', 10, 1, '18:04', 'Pesos']]);
  const impRaro = parsear(conRaro);
  ok(impRaro.paraRevisar.some(r => r.ticker === 'XYZ' && r.motivo.includes('Opciones')) && !impRaro.posiciones.some(p => p.ticker === 'XYZ'), 'tipo desconocido → para revisar con el texto crudo, no se descarta en silencio');
  ok(Math.abs(impRaro.valorUsdBalanz - (TOTAL + 10)) < 0.01, '...y su valor sigue en el total del archivo');
  ok(numeroCelda('1.234,56') === 1234.56 && numeroCelda(7) === 7 && numeroCelda('abc') === null, 'números como texto argentino');

  console.log('\n=== lectura del .xlsx (ida y vuelta en memoria) ===');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tabla()), 'Mis Instrumentos');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const leido = await leerFilasXlsx(bytes);
  ok(leido.hoja === 'Mis Instrumentos' && leido.filas.length === 18 && detectarArchivoBalanz(leido.filas[0]) === 'mis_instrumentos', 'leerFilasXlsx: hoja, 18 filas y encabezados reconocidos');
  ok(parsear(leido.filas).posiciones.length === 17 - 0, 'el parser acepta lo que devuelve leerFilasXlsx');

  console.log('\n=== doble importación y diferencias ===');
  const cv = cuentaVivaDeImportacion(imp);
  ok(esMismaImportacion(cv, imp), 'mismo archivo (comitente + fecha y hora) → misma importación: no cambia nada');
  ok(!esMismaImportacion(cv, parsear(tabla(), '2026-10-21T10:00:00-03:00')), 'otra hora → importación nueva');
  ok(movimientosInferidos(null, imp).length === 0, 'primera importación → sin movimientos inferidos');
  ok(movimientosInferidos(imp.posiciones, imp).length === 0, 'mismas cantidades → sin movimientos');
  const bajaVist = tabla(FILAS.map(r => (r[0] === 'VIST' ? ['VIST', 'Cedears', 68, 2.2, '18:04', 'Pesos'] as typeof r : r)));
  const imp2 = parsear(bajaVist, '2026-10-21T12:00:00-03:00');
  const movs = movimientosInferidos(imp.posiciones, imp2);
  ok(movs.length === 1 && movs[0].tipo === 'venta' && movs[0].ticker === 'VIST' && movs[0].cantidad === 250 && movs[0].inferido === true && movs[0].origen === 'archivo_balanz', 'VIST 318 → 68: una venta inferida de 250', movs);
  ok(flujoDeMovimiento(movs[0], null).flujo === null, '...que no es flujo');
  ok(Math.abs(movs[0].montoNeto - 250 * 2.2) < 0.01, '...con monto estimado al precio del archivo');
  const sinGgal = parsear(tabla(FILAS.filter(r => r[0] !== 'GGAL')), '2026-10-21T12:00:00-03:00');
  const conNuevo = parsear(tabla([...FILAS, ['YPFD', 'Acciones', 5, 30, '18:04', 'Pesos']]), '2026-10-21T12:00:00-03:00');
  ok(movimientosInferidos(imp.posiciones, sinGgal).some(m => m.tipo === 'venta' && m.ticker === 'GGAL' && m.cantidad === 100), 'especie que desaparece → venta de toda la tenencia');
  ok(movimientosInferidos(imp.posiciones, conNuevo).some(m => m.tipo === 'compra' && m.ticker === 'YPFD' && m.cantidad === 5), 'especie nueva → compra');
  const ids = movimientosInferidos(imp.posiciones, imp2).map(m => m.id);
  ok(JSON.stringify(ids) === JSON.stringify(movs.map(m => m.id)), 'ids deterministas: re-confirmar no duplica');

  console.log('\n=== control contra la app ===');
  const tcApp = 1500;
  // La app valúa GGAL a 4.1 USD × 1500 = 6150 ARS (igual que el archivo) y VIST un 10% más caro.
  const precioDe = (p: { ticker: string }) => p.ticker === 'GGAL' ? { precio: 4.1 * tcApp, moneda: 'ARS' as const, fecha: '2026-10-20' }
    : p.ticker === 'VIST' ? { precio: 2.2 * 1.1 * tcApp, moneda: 'ARS' as const, fecha: '2026-10-20' }
    : p.ticker === 'GD30' ? { precio: 0.55 * 100 * tcApp, moneda: 'ARS' as const, fecha: '2026-10-20' }  // cotiza cada 100 VN
    : null;
  const c = controlContraApp(imp, precioDe, tcApp);
  const vist = c.especies.find(e => e.ticker === 'VIST')!;
  ok(Math.abs((vist.difPct ?? 0) - 0.1) < 1e-9, 'VIST: la app da +10% sobre el archivo');
  ok(c.especies.find(e => e.ticker === 'GD30')!.nota === 'escala_distinta', 'GD30 con precio cada 100 VN → escala distinta, fuera del total');
  ok(c.especies.find(e => e.ticker === 'BIOX')!.nota === 'sin_precio_app', 'sin precio en la app → se dice');
  const esperado = (100 * 4.1 + 318 * 2.2 * 1.1) / (100 * 4.1 + 318 * 2.2) - 1;
  ok(Math.abs((c.difTotalPct ?? 0) - esperado) < 1e-9 && c.supera, `total comparable +${(esperado * 100).toFixed(1)}% → supera el 2% y avisa`, c.difTotalPct);
  const igual = controlContraApp(imp, p => (p.ticker === 'GGAL' ? { precio: 4.1 * tcApp, moneda: 'ARS', fecha: '' } : null), tcApp);
  ok(!igual.supera && Math.abs(igual.difTotalPct ?? 1) < 1e-9, 'mismo valor → no avisa');
  ok(controlContraApp(imp, precioDe, null).especies.find(e => e.ticker === 'GGAL')!.nota === 'sin_tc', 'precio en pesos sin TC → sin_tc, no se inventa');

  console.log('\n=== cartera viva con la cuenta de Balanz por archivo ===');
  const fecha = '2026-10-13';
  const pos = (ticker: string, tipo: Posicion['tipo'], moneda: 'ARS' | 'USD', valor: number, cantidad: number | null): Posicion => ({
    cuenta: `Balanz ${COM}`, titular: null, ticker, tipo, sector: 'x', pais_riesgo: 'AR', moneda_origen: moneda,
    valor_origen: valor, cantidad, fuente: 'test', revisar: false, valorUsd: moneda === 'USD' ? valor : valor / 1500, tcUsado: moneda === 'ARS' ? 1500 : null, fechaCorrida: fecha,
  });
  const corridaBalanz = { fecha, posiciones: [pos('VIST', 'cedear', 'USD', 700, 318), pos('USD', 'cash', 'USD', 1234, null), pos('ARS', 'cash', 'ARS', 150_000, null)] };
  const tcHoy: TcCarteraViva = { valor: 1500, fuente: 'dolarapi-bolsa', fechaCotizacion: '2026-10-20', viejo: false };
  const viva = armarCarteraViva(corridaBalanz, [cuentaVivaDeImportacion(imp2)], movs, { hoy: '2026-10-21', porIdentidad: {} }, null, [], tcHoy);
  const vistViva = viva.lineas.filter(l => l.ticker === 'VIST');
  ok(vistViva.length === 1 && vistViva[0].cantidad === 68, 'la tenencia sale del archivo (VIST 68) y la venta inferida no se aplica otra vez', vistViva);
  const cajas = viva.lineas.filter(l => l.tipo === 'cash').map(l => `${l.moneda}:${l.valorOrigen}`).sort();
  ok(JSON.stringify(cajas) === JSON.stringify(['ARS:150000', 'USD:1234']), 'el archivo no trae caja: se conserva la de la corrida', cajas);
  ok(viva.cuentas.find(c2 => c2.cuenta === `Balanz ${COM}`)?.fuente === 'api' && viva.lineas.length === 17 + 2, 'la cuenta figura con fuente de archivo (api) y las 17 especies + 2 cajas');

  console.log('\n=== regresiones de la revisión del diff (H2b) ===');
  {
    // A1 — una cuenta con API sin `saldos` que manda la caja como fila cash no suma además la de la corrida.
    const conCashApi = armarCarteraViva(
      { fecha, posiciones: [pos('ARS', 'cash', 'ARS', 150_000, null)] },
      [{ cuenta: `Balanz ${COM}`, fuente: 'ppi_api', leidoEn: '2026-10-21T18:00:00-03:00',
        posiciones: [{ cuenta: `Balanz ${COM}`, titular: null, ticker: 'ARS', tipo: 'cash', sector: 'cash', pais_riesgo: 'AR', moneda_origen: 'ARS', valor_origen: 200_000, cantidad: null, fuente: 'api', revisar: false }] }],
      [], { hoy: '2026-10-21', porIdentidad: {} }, null, [], tcHoy);
    ok(JSON.stringify(conCashApi.lineas.filter(l => l.tipo === 'cash').map(l => l.valorOrigen)) === '[200000]', 'A1: API sin saldos con fila cash → una sola caja (la de la API)');
    // A2 — los movimientos inferidos nunca se aplican, aunque la cuenta caiga a la corrida.
    const vacia = { ...cuentaVivaDeImportacion(imp2), posiciones: [] };
    const sinViva = armarCarteraViva(corridaBalanz, [vacia], movs, { hoy: '2026-10-21', porIdentidad: {} }, null, [], tcHoy);
    ok(sinViva.lineas.find(l => l.ticker === 'VIST')?.cantidad === 318 && sinViva.cuentas[0].movimientosAplicados === 0, 'A2: cuenta viva sin posiciones → corrida, sin aplicar la venta inferida');
    // H3c — cuenta viva de Balanz con solo la caja anclada (sin "Mis Instrumentos"): tenencia de la
    // corrida, caja de la anclada (reemplaza a la de la corrida).
    const soloCaja = armarCarteraViva(corridaBalanz,
      [{ cuenta: `Balanz ${COM}`, fuente: 'archivo_balanz', leidoEn: '2026-10-16T23:59:59-03:00', posiciones: [], saldos: { ARS: 999, USD: 5 } }],
      [], { hoy: '2026-10-21', porIdentidad: {} }, null, [], tcHoy);
    const cajasSolo = soloCaja.lineas.filter(l => l.tipo === 'cash').map(l => `${l.moneda}:${l.valorOrigen}`).sort();
    ok(soloCaja.lineas.find(l => l.ticker === 'VIST')?.cantidad === 318 && JSON.stringify(cajasSolo) === JSON.stringify(['ARS:999', 'USD:5']),
      'solo caja anclada: tenencia de la corrida y caja anclada (no la de la corrida)', cajasSolo);
    // A3 — un archivo más viejo que la importación vigente se detecta.
    ok(esMasViejo(cuentaVivaDeImportacion(imp2), imp) && !esMasViejo(cuentaVivaDeImportacion(imp), imp2) && !esMasViejo(null, imp), 'A3: esMasViejo');
    // M1 — tipo desconocido con tipo conocido del ticker → entra con ese tipo, marcado.
    const conOpcion = tabla(FILAS.map(r => (r[0] === 'VIST' ? ['VIST', 'Opciones', 318, 2.2, '18:04', 'Pesos'] as typeof r : r)));
    const impOp = parsearMisInstrumentos(conOpcion, { comitente: COM, exportadoEn: EXP, clasificaciones: clas(), tiposPorTicker: tiposPorTickerDe([], corrida, `Balanz ${COM}`) });
    const vOp = impOp.posiciones.find(p => p.ticker === 'VIST');
    ok(!!vOp && vOp.tipo === 'cedear' && vOp.revisar && (vOp.motivo_revisar ?? '').includes('Opciones') && impOp.paraRevisar.length === 0, 'M1: "Opciones" en un ticker conocido → cedear, revisar con el texto crudo', vOp);
    // M2 — números como texto y filas que no cuadran.
    ok(numeroCelda('1.500') === 1500 && numeroCelda('1,500.25') === 1500.25 && numeroCelda('1.500,25') === 1500.25 && numeroCelda('0,5685') === 0.5685 && numeroCelda('0.5685') === 0.5685, 'M2: miles y decimales en texto');
    const malLeida = tabla(FILAS).map((r, i) => (i === 8 ? r.map((c, j) => (j === 3 ? 1.5 : c)) : r));   // GGAL: 1,5 nominales
    const impMal = parsear(malLeida);
    ok(impMal.noCuadran.length === 1 && impMal.noCuadran[0].startsWith('GGAL'), 'M2: Nominales × Precio ≠ Valor actual → noCuadran (la UI no deja confirmar)', impMal.noCuadran);
    // M5 — la corrida de la misma cuenta manda sobre la importación anterior.
    const anterior = [{ ...imp.posiciones.find(p => p.ticker === 'GGAL')!, sector: 'viejo', pais_riesgo: 'global' as const }];
    const m5 = clasificacionesDe(anterior, [{ cuenta: `Balanz ${COM}`, ticker: 'GGAL', tipo: 'accion', sector: 'bancos', pais_riesgo: 'AR' }], `Balanz ${COM}`);
    ok(m5.get('GGAL|accion')?.sector === 'bancos', 'M5: una corrección en la corrida llega a la cuenta viva');
    // L2 — encabezados en NFD.
    const nfd = tabla().map((r, i) => (i === 0 ? r.map(c => String(c).normalize('NFD')) : r));
    ok(parsear(nfd).filas.length === 17, 'L2: encabezados con tildes descompuestas (NFD) se reconocen');
    // L4 — valor del archivo en 0 no entra al total comparable.
    const cero = tabla(FILAS.map(r => (r[0] === 'GGAL' ? ['GGAL', 'Acciones', 0, 4.1, '18:04', 'Pesos'] as typeof r : r)));
    const c0 = controlContraApp(parsear(cero), p => (p.ticker === 'GGAL' ? { precio: 4.1 * 1500, moneda: 'ARS', fecha: '' } : null), 1500);
    ok(c0.especies.find(e => e.ticker === 'GGAL')?.nota === 'valor_archivo_cero' && c0.difTotalPct === null, 'L4: valor 0 en el archivo → fuera del total, no infla la diferencia');
  }

  console.log(`\n${fallas === 0 ? 'OK — todo verde' : `${fallas} FALLA(S)`}`);
  if (fallas) process.exit(1);
})();
