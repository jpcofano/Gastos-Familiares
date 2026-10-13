// F9.190 — verificación sin red ni Firestore: corre las funciones REALES (no copias) de
//   src/datos/patrimonioInformeV2.ts   (contexto v2, materialidad, evaluación de señales)
//   functions/src/informeV2.ts         (prompt v2, validador del global, detección de forma)
//   functions/src/senalesMercado.ts    (parseo de las fuentes con respuestas simuladas)
// Uso: npx tsx scripts/verificarF9190.ts   → exit 1 si algo falla.
//
// La cartera de prueba es la del 13-oct-2026 (35 tickers, USD 111.888) tal como la mandaba el
// prompt v1, armada a mano con tipo/sector/país aproximados. Alcanza para el contrato de
// materialidad y forma; los números del motor contra producción se verifican en la app.
import type { Posicion } from '../src/types/patrimonio';
import { contextoInformeV2, evaluarSenales, UMBRAL_MATERIAL, type LecturaMercado } from '../src/datos/patrimonioInformeV2';
import { RIESGO_DEFAULTS } from '../src/datos/patrimonioRiesgo';
import { buildPromptCompletoV2, validarGlobal, esRespuestaV2 } from '../functions/src/informeV2';
import {
  parseRiesgoPais, precioDePanel, parseCcl, leerMercado, resolverBases,
  URL_RIESGO_PAIS, URL_ARG_STOCKS, URL_USA_STOCKS, URL_CCL, type RespuestaCruda,
} from '../functions/src/senalesMercado';

let fallas = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) fallas++; };

type T = Posicion['tipo'];
const fila = (ticker: string, valorUsd: number, tipo: T, sector: string, pais: 'AR' | 'global', moneda: 'ARS' | 'USD' = 'USD'): Posicion => ({
  cuenta: 'test', titular: null, ticker, tipo, sector, pais_riesgo: pais, moneda_origen: moneda,
  valor_origen: valorUsd, cantidad: null, fuente: 'test', revisar: false, valorUsd, tcUsado: null, fechaCorrida: '2026-10-13',
});

const posiciones: Posicion[] = [
  fila('ETH', 17719, 'cripto', 'cripto', 'global'), fila('YPFD', 11942, 'accion', 'energia', 'AR', 'ARS'),
  fila('BTC', 11448, 'cripto', 'cripto', 'global'), fila('TRAN', 8174, 'accion', 'energia', 'AR', 'ARS'),
  fila('VIST', 7715, 'accion', 'energia', 'AR', 'ARS'), fila('PAMP', 6662, 'accion', 'energia', 'AR', 'ARS'),
  fila('TZXM7', 6153, 'bono', 'cer_pesos', 'AR', 'ARS'), fila('TGSU2', 3269, 'accion', 'energia', 'AR', 'ARS'),
  fila('GLOB', 2741, 'cedear', 'tech', 'global', 'ARS'), fila('GD30', 2723, 'bono', 'soberano', 'AR'),
  fila('DICP', 2457, 'bono', 'cer_pesos', 'AR', 'ARS'), fila('BMA', 2411, 'accion', 'bancos', 'AR', 'ARS'),
  fila('AAVE', 2397, 'cripto', 'cripto', 'global'), fila('TX26', 2372, 'bono', 'cer_pesos', 'AR', 'ARS'),
  fila('GD35', 1937, 'bono', 'soberano', 'AR'), fila('B', 1680, 'cedear', 'materiales', 'global', 'ARS'),
  fila('GGAL', 1650, 'accion', 'bancos', 'AR', 'ARS'), fila('UNI', 1638, 'cripto', 'cripto', 'global'),
  fila('CEPU', 1497, 'accion', 'energia', 'AR', 'ARS'), fila('LECAPSA', 1497, 'fci', 'lecaps_pesos', 'AR', 'ARS'),
  fila('TXAR', 1190, 'accion', 'materiales', 'AR', 'ARS'), fila('RV', 1181, 'fci', 'renta_variable_ar', 'AR', 'ARS'),
  fila('BCAHA', 807, 'fci', 'money_market_pesos', 'AR', 'ARS'), fila('VZ', 685, 'cedear', 'telecom', 'global', 'ARS'),
  fila('CVX', 497, 'cedear', 'energia', 'global', 'ARS'), fila('BCMMUSDA', 412, 'cash', 'cash', 'AR'),
  fila('BPOC7', 412, 'bono', 'soberano', 'AR'), fila('TLCPO', 373, 'on', 'corporativo_usd', 'AR'),
  fila('USD', 113, 'cash', 'cash', 'AR'), fila('BIOX', 47, 'accion', 'agro', 'AR'),
  fila('BPOD7', 8, 'bono', 'soberano', 'AR'), fila('USD_CABLE', 5, 'cash', 'cash', 'AR'),
  fila('ARS', 4, 'cash', 'cash', 'AR', 'ARS'), fila('USDT', 0.31, 'cripto', 'stablecoin', 'global'),
];
const manuales = [{ id: 'acn', ticker: 'ACN', nombre: 'Accenture', cantidad: 43, valorUsd: 8070.24, fechaValuacion: '2026-09-03',
  tipo: 'accion' as const, sector: 'tech', pais_riesgo: 'global' as const, cuenta: 'Plan empleado ACN', notas: '' }];

// ── 1. Contexto v2 ───────────────────────────────────────────────────────────
const ctx = contextoInformeV2({
  fecha: '2026-10-13', posiciones, manuales, topes: { ...RIESGO_DEFAULTS, pisoCajaPct: 0.10 }, riesgoConfigurado: true,
  factores: {}, exposiciones: [], sectorDe: {}, hhi: 0.074, senales: null,
});
const mat = ctx.materiales.map(m => m.ticker);
ok(Math.abs(ctx.cartera.totalUsd - 111888) <= 2, `total invertible ${ctx.cartera.totalUsd} ≈ 111.888`);
ok(ctx.materiales.every(m => m.peso >= UMBRAL_MATERIAL), 'todas las materiales pesan ≥ 2%');
ok(mat.includes('ETH') && mat.includes('YPFD') && mat.includes('ACN'), 'ETH, YPFD y ACN (manual) son materiales');
ok(!mat.includes('USDT') && !ctx.menores.some(m => m.ticker === 'BIOX'), 'USDT y BIOX quedan excluidas');
ok(![...mat, ...ctx.menores.map(m => m.ticker)].some(t => ['USD', 'ARS', 'USD_CABLE', 'BCMMUSDA'].includes(t)),
  'la caja no se analiza como posición');
ok(ctx.materiales.length + ctx.menores.length + ctx.excluidas.cantidad === 35, `35 tickers repartidos (${ctx.materiales.length}/${ctx.menores.length}/${ctx.excluidas.cantidad})`);
ok(ctx.riesgo.escenarios.length >= 8 && ctx.riesgo.escenarios.every(e => Number.isFinite(e.resultado)), `${ctx.riesgo.escenarios.length} escenarios sin NaN`);
ok(ctx.riesgo.brechaTitular !== null, 'brecha del escenario titular presente');
ok(ctx.reserva.piso === 0.10 && ctx.reserva.faltanteUsd > 0, `caja ${ctx.reserva.caja} bajo el piso 10%: faltan USD ${ctx.reserva.faltanteUsd}`);
ok(ctx.riesgo.fueraDePolitica.some(v => v.tipo === 'caja'), 'la caja figura fuera de política');

// ── 2. Prompt v2 ─────────────────────────────────────────────────────────────
const prompt = buildPromptCompletoV2(ctx as unknown as Record<string, unknown>);
const formato = prompt.slice(prompt.indexOf('═══ FORMATO'));
const orden = ['"global"', '"sectorial"', '"agenda"', '"posiciones"', '"manuales"'].map(k => formato.indexOf(k));
ok(orden.every((x, i) => x > 0 && (i === 0 || x > orden[i - 1])), 'el formato pide global → sectorial → agenda → posiciones → manuales');
ok((prompt.match(/REGLAS/g) ?? []).length === 1, 'un solo bloque de reglas (v1 tenía cuatro)');
ok(prompt.includes('NUNCA "global"'), 'el recorte por espacio protege el global');
const seccionPos = prompt.slice(prompt.indexOf('POSICIONES MATERIALES'), prompt.indexOf('POSICIONES MANUALES'));
ok(!seccionPos.includes('"USDT"') && !seccionPos.includes('"BIOX"') && seccionPos.includes('"YPFD"'),
  'las secciones de posiciones no llevan las excluidas (sí pueden aparecer en los factores del motor)');
const palabras = prompt.split(/\s+/).length;
console.log(`     largo del prompt: ${palabras} palabras`);

// ── 3. Validador y forma ─────────────────────────────────────────────────────
ok(validarGlobal({ diagnostico: 'La cartera depende de energía argentina y cripto; la caja está bajo el piso.' }) === null, 'global válido pasa');
ok(validarGlobal({ diagnostico: 'corto' }) !== null, 'global con diagnóstico corto falla');
ok(validarGlobal(null) !== null, 'global ausente falla');
ok(esRespuestaV2({ global: {}, posiciones: {} }) && !esRespuestaV2({ lote: { analisis: [] } }), 'v2 se distingue de v1 por la forma');

// ── 4. Parseo de fuentes (respuestas simuladas) ──────────────────────────────
const HOY = '2026-10-13';
ok(parseRiesgoPais({ status: 200, body: { valor: 589, fecha: '2026-10-13' } }, HOY).valor === 589, 'riesgo país {valor, fecha}');
ok(parseRiesgoPais({ status: 200, body: [{ valor: 600, fecha: '2026-10-12' }, { valor: 589, fecha: '2026-10-13' }] }, HOY).valor === 589, 'riesgo país como array toma el último');
const err = parseRiesgoPais({ status: 403, body: '<html>Forbidden</html>' }, HOY);
ok(err.valor === null && !!err.error?.includes('403'), 'error de fuente viaja con status crudo');
ok(precioDePanel({ status: 200, body: [{ symbol: 'SPY', c: 650 }] }, ['SPY'], 'p', HOY).valor === 650, 'SPY del panel');
const sinMerval = precioDePanel({ status: 200, body: [{ symbol: 'YPFD', c: 1 }] }, ['MERVAL'], 'p', HOY);
ok(sinMerval.valor === null && !!sinMerval.error?.includes('no trae'), 'Merval ausente del panel: sin proxy, con motivo');
ok(parseCcl({ status: 200, body: { venta: 1550, fechaActualizacion: '2026-10-13T15:00:00Z' } }, HOY).valor === 1550, 'CCL de dolarapi');

const respuestas: Record<string, RespuestaCruda> = {
  [URL_RIESGO_PAIS]: { status: 200, body: { valor: 720, fecha: HOY } },
  [URL_ARG_STOCKS]: { status: 200, body: [{ symbol: 'MERVAL', c: 2_878_000 }] },
  [URL_USA_STOCKS]: { status: 200, body: [{ symbol: 'SPY', c: 650 }] },
  [URL_CCL]: { status: 200, body: { venta: 1550 } },
};
(async () => {
  const lectura = await leerMercado(async u => respuestas[u], HOY, '2026-10-13T18:00:00Z');
  ok(Math.abs((lectura.mervalUsd.valor ?? 0) - 2_878_000 / 1550) < 1e-6, 'Merval USD = Merval / CCL');
  const caida = await leerMercado(async () => { throw new Error('ECONNRESET'); }, HOY, 'x');
  ok(caida.riesgoPais.error?.includes('ECONNRESET') === true, 'leerMercado nunca rechaza: el error queda en el dato');

  // ── 5. Bases y evaluación ──────────────────────────────────────────────────
  const b1 = resolverBases(null, lectura, false);
  ok(b1.sp500?.valor === 650, 'la primera lectura fija la base');
  const lectura2 = { ...lectura, sp500: { ...lectura.sp500, valor: 540 }, mervalUsd: { ...lectura.mervalUsd, valor: (2_878_000 / 1550) * 0.7 } };
  ok(resolverBases(b1, lectura2, false).sp500?.valor === 650, 'la base no se mueve sola');
  ok(resolverBases(b1, lectura2, true).sp500?.valor === 540, 'reiniciar la fija en hoy');

  const ev = evaluarSenales(lectura2 as LecturaMercado, b1);
  const by = Object.fromEntries(ev.map(e => [e.id, e]));
  ok(by.riesgoPais.nivel === 1, 'riesgo país 720 → nivel 1');
  ok(by.mervalUsd.nivel === 2, 'Merval −30% → nivel 2');
  ok(by.sp500.nivel === 1, 'S&P −16,9% → nivel 1');
  ok(evaluarSenales({ ...lectura, riesgoPais: { valor: null, fecha: null, fuente: 'x', error: 'HTTP 403' } } as LecturaMercado, b1)[0].nivel === null,
    'sin dato → nivel null, no verde');

  console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
  process.exit(fallas ? 1 : 0);
})();
