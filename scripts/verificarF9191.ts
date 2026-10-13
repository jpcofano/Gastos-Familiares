// F9.191 — verificación sin red ni Firestore del informe v3 (contexto + prompt + validador).
// Corre las funciones REALES de:
//   src/datos/patrimonioInformeV2.ts   (contextoInformeV3)
//   functions/src/informeV2.ts         (buildPromptCompletoV3, validarOportunidades)
// Uso: npx tsx scripts/verificarF9191.ts   → exit 1 si algo falla.
// Cartera de prueba: la misma de verificarF9190 (13-oct-2026, armada a mano).
import type { Posicion } from '../src/types/patrimonio';
import { contextoInformeV3, contextoPosicionesV3, ESCENARIOS_CON_CONTRIBUCION, type LecturaMercado } from '../src/datos/patrimonioInformeV2';
import { UNIVERSO_CANDIDATOS, UNIVERSO_EXCLUIDOS } from '../src/datos/universoCandidatos';
import { RIESGO_DEFAULTS } from '../src/datos/patrimonioRiesgo';
import { buildPromptV3, buildPromptEstrategiaV3, buildPromptPosicionesV3, validarOportunidades, validarGlobal, esRespuestaV2, extraerJson, normalizarCasosPosicion } from '../functions/src/informeV2';

let fallas = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) fallas++; };

type T = Posicion['tipo'];
const fila = (ticker: string, valorUsd: number, tipo: T, sector: string, pais: 'AR' | 'global', moneda: 'ARS' | 'USD' = 'USD', cuenta = 'Balanz 402665'): Posicion => ({
  cuenta, titular: null, ticker, tipo, sector, pais_riesgo: pais, moneda_origen: moneda,
  valor_origen: valorUsd, cantidad: null, fuente: 'test', revisar: false, valorUsd, tcUsado: null, fechaCorrida: '2026-10-13',
});
const posiciones: Posicion[] = [
  fila('ETH', 17719, 'cripto', 'cripto', 'global', 'USD', 'Cripto'), fila('YPFD', 11942, 'accion', 'energia', 'AR', 'ARS'),
  fila('BTC', 11448, 'cripto', 'cripto', 'global', 'USD', 'Cripto'), fila('TRAN', 8174, 'accion', 'energia', 'AR', 'ARS', 'PPI 101268'),
  fila('VIST', 7715, 'accion', 'energia', 'AR', 'ARS'), fila('PAMP', 6662, 'accion', 'energia', 'AR', 'ARS'),
  fila('TZXM7', 6153, 'bono', 'cer_pesos', 'AR', 'ARS'), fila('TGSU2', 3269, 'accion', 'energia', 'AR', 'ARS'),
  fila('GLOB', 2741, 'cedear', 'tech', 'global', 'ARS'), fila('GD30', 2723, 'bono', 'soberano', 'AR'),
  fila('DICP', 2457, 'bono', 'cer_pesos', 'AR', 'ARS'), fila('BMA', 2411, 'accion', 'bancos', 'AR', 'ARS'),
  fila('AAVE', 2397, 'cripto', 'cripto', 'global'), fila('TX26', 2372, 'bono', 'cer_pesos', 'AR', 'ARS'),
  fila('GD35', 1937, 'bono', 'soberano_usd', 'AR'), fila('USD', 113, 'cash', 'cash', 'AR'),
];
const manuales = [{ id: 'acn', ticker: 'ACN', nombre: 'Accenture', cantidad: 43, valorUsd: 9239.41, fechaValuacion: '2026-10-12',
  tipo: 'accion' as const, sector: 'tech', pais_riesgo: 'global' as const, cuenta: 'Plan empleado ACN', notas: '' }];

const base = {
  fecha: '2026-10-13', posiciones, manuales, topes: { ...RIESGO_DEFAULTS, pisoCajaPct: 0.15 }, riesgoConfigurado: true,
  factores: {}, exposiciones: [], sectorDe: { GD35: 'soberano_usd AR' }, hhi: 0.074, senales: null,
};

// ── 1. Contexto v3 sin lectura de mercado ────────────────────────────────────
const c0 = contextoInformeV3(base);
ok(c0.version === 3, 'version 3');
ok(c0.perfil === null, 'perfil null mientras no haya UI');
ok(c0.universo.cuentas.includes('PPI 101268') && c0.universo.cuentas.includes('Plan empleado ACN'), `cuentas del universo: ${c0.universo.cuentas.join(', ')}`);
ok(c0.universo.instrumentos.length >= 6, 'universo con familias de instrumentos');
const conContrib = c0.riesgo.escenarios.filter(e => 'contribucion' in e);
ok(conContrib.length === Math.min(ESCENARIOS_CON_CONTRIBUCION, c0.riesgo.escenarios.length), `contribución solo en los ${ESCENARIOS_CON_CONTRIBUCION} peores`);
ok(c0.riesgo.escenarios[0].resultado <= c0.riesgo.escenarios[c0.riesgo.escenarios.length - 1].resultado, 'escenarios ordenados del peor al mejor');
const peor = c0.riesgo.escenarios[0] as { resultado: number; contribucion?: { aporte: number }[] };
const sumaAportes = (peor.contribucion ?? []).reduce((s, c) => s + c.aporte, 0);
ok(Math.abs(sumaAportes - peor.resultado) < 0.01, `aportes del peor suman su resultado (${sumaAportes.toFixed(3)} ≈ ${peor.resultado})`);
const caja = c0.riesgo.fueraDePolitica.find(v => v.tipo === 'caja');
ok(!!caja && caja.usdFaltante! > 0 && caja.usdExcedente === null, 'caja: usdFaltante, sin usdExcedente');
ok(c0.riesgo.fueraDePolitica.filter(v => v.tipo !== 'caja').every(v => v.usdFaltante === null && (v.usdExcedente ?? 0) > 0), 'topes: usdExcedente, sin usdFaltante');
ok(!('exposicionArgentina' in c0.riesgo) && 'exposicionPorFactor' in c0.riesgo, 'exposicionArgentina renombrada a exposicionPorFactor');
ok(!('senales' in c0.reserva), 'las señales salieron de reserva y viven en mercado');
ok(c0.mercado.riesgoPais === null && c0.mercado.senales === null, 'sin lectura: mercado null, sin inventar');
ok(c0.mercado.umbrales.riesgoPaisPb[0] === 700, 'umbrales viajan aunque no haya lectura');
ok(c0.menores.concat(c0.materiales).every(m => !m.sector.includes('_')), 'sectores sin claves crudas con guion bajo');

// ── 2. Con lectura de mercado ────────────────────────────────────────────────
const lectura: LecturaMercado = {
  leidoEnISO: '2026-10-13T18:00:00Z',
  riesgoPais: { valor: 595, fecha: '2026-10-13', fuente: 'ArgentinaDatos', error: null },
  mervalArs: { valor: 2_883_977, fecha: '2026-10-13', fuente: 'data912', error: null },
  ccl: { valor: 1610, fecha: '2026-10-13', fuente: 'dolarapi', error: null },
  mervalUsd: { valor: 1791, fecha: '2026-10-13', fuente: 'data912 / dolarapi', error: null },
  sp500: { valor: 778.1, fecha: '2026-10-12', fuente: 'data912', error: null },
};
const c1 = contextoInformeV3({ ...base, lectura, bases: { mervalUsd: { valor: 1800, fecha: '2026-10-01' }, sp500: { valor: 770, fecha: '2026-10-01' } } });
ok(c1.mercado.riesgoPais?.valor === 595 && c1.mercado.spy?.valor === 778.1, 'mercado copia la lectura de la app');
ok(c1.mercado.senales?.find(s => s.id === 'riesgoPais')?.nivel === 0, 'riesgo país 595 → nivel 0 (umbral 700)');

// ── 3. Prompt v3 en dos partes (F9.194) ────────────────────────────────────────
const prompt = buildPromptEstrategiaV3(c1 as unknown as Record<string, unknown>);
ok(buildPromptV3(c1 as unknown as Record<string, unknown>) === prompt, 'contexto de estrategia → prompt de estrategia');
const formato = prompt.slice(prompt.indexOf('═══ FORMATO'));
const orden = ['"global"', '"oportunidades"', '"sectorial"', '"agenda"'].map(k => formato.indexOf(k));
ok(orden.every((x, i) => x > 0 && (i === 0 || x > orden[i - 1])), 'parte 1: global → oportunidades → sectorial → agenda');
ok(!formato.includes('"posiciones"') && !formato.includes('"manuales"'), 'parte 1 no pide posiciones ni manuales');
ok(prompt.includes('Nunca se acortan "global" ni "oportunidades"'), 'el recorte protege global y oportunidades');
ok(prompt.includes('"coherencia"') && prompt.includes('adecuar la política'), 'pide coherencia política↔cartera con las tres vías');
ok(prompt.includes('UNIVERSO INVERTIBLE') && prompt.includes('PPI 101268'), 'universo en el prompt');
ok(prompt.includes('"usdFaltante"') && prompt.includes('"usdExcedente"'), 'contexto con usdFaltante/usdExcedente');
ok(prompt.includes('bancos_ar'), 'driver bancos_ar disponible');
ok((prompt.match(/═══ REGLAS/g) ?? []).length === 1, 'un solo bloque de reglas');
ok(!/\$\{|undefined/.test(prompt), 'sin interpolaciones rotas');
ok(!prompt.includes('seguí') && prompt.includes('único bloque JSON válido'), 'sin corte con "seguí": un solo bloque que cierra');
ok(prompt.includes('energia_ar suma Oil & gas + Energía AR regulada') && prompt.includes('Ningún otro'), 'sectorial: tags cerrados y energía consolidada');
ok(prompt.includes('Las CLAVES del JSON van idénticas'), 'claves del JSON inmutables');
ok(prompt.includes('exactamente 3 casos') && prompt.includes('no supongas otro'), 'coherencia: tres caminos con el mismo peso, sin tolerancia inventada');
ok(prompt.includes('"pesoActual": 0,'), 'pesoActual numérico en la plantilla');
ok(prompt.includes('\\n') && prompt.includes('```json'), 'pide escapar saltos de línea y bloque ```json bien formado');
console.log(`     largo parte 1: ${prompt.split(/\s+/).length} palabras`);

// Lista blanca (F9.193)
const cand = c1.universo.candidatos;
ok(cand.length === UNIVERSO_CANDIDATOS.length && cand.length >= 30, `lista blanca en el contexto (${cand.length} candidatos)`);
ok(cand.some(c => c.ticker === 'GD30' && c.enCartera) && !cand.some(c => c.ticker === 'SPY' && c.enCartera), 'marca enCartera solo lo que se tiene');
ok(!UNIVERSO_CANDIDATOS.some(c => ['SHV', 'BIL', 'SGOV', 'TLT', 'IEF', 'VOO'].includes(c.ticker)), 'sin tickers inexistentes en BYMA (SHV, BIL, TLT, VOO…)');
ok(!UNIVERSO_CANDIDATOS.some(c => UNIVERSO_EXCLUIDOS.includes(c.ticker)), 'ningún candidato está en excluidos');
ok(UNIVERSO_CANDIDATOS.every(c => c.fuente && c.cubre.length > 0 && c.factor), 'todo candidato tiene fuente, qué cubre y a qué factor suma');
ok(new Set(UNIVERSO_CANDIDATOS.filter(c => c.ticker).map(c => c.ticker)).size === UNIVERSO_CANDIDATOS.filter(c => c.ticker).length, 'tickers sin duplicados');
ok(prompt.includes('sin candidato en la lista blanca'), 'si nada de la lista sirve, lo dice en vez de inventar');

// Parte 2: posiciones
const panorama = { generadoEnISO: '2026-10-13T20:00:00Z', diagnostico: 'La cartera depende de energía AR y cripto.', sectorial: '## Cripto [driver: cripto]\nETF con salidas.', agenda: [{ fecha: '2026-11-09', evento: 'Vence TX26', tickers: ['TX26'] }] };
const cp = contextoPosicionesV3({ ...base, lectura, bases: null }, panorama);
ok(cp.parte === 'posiciones' && cp.version === 3, 'contexto parte 2');
ok(cp.materiales.find(m => m.ticker === 'YPFD')?.factor === 'Oil & gas' || cp.materiales.every(m => 'factor' in m), 'cada posición trae su factor');
ok(!('riesgo' in cp) && !('universo' in cp) && cp.fueraDePolitica.every(v => v.tipo !== 'caja'), 'parte 2 sin motor completo, sin universo y sin la caja');
const p2 = buildPromptPosicionesV3(cp as unknown as Record<string, unknown>);
ok(buildPromptV3(cp as unknown as Record<string, unknown>) === p2, 'contexto de posiciones → prompt de posiciones');
const f2 = p2.slice(p2.indexOf('═══ FORMATO'));
ok(f2.includes('"posiciones"') && f2.includes('"manuales"') && !f2.includes('"global"') && !f2.includes('"oportunidades"'), 'parte 2 pide solo posiciones y manuales');
ok(p2.includes('Vence TX26') && p2.includes('ETF con salidas'), 'parte 2 recibe el panorama de la parte 1');
ok(p2.includes('la clave de las opciones es "acciones"'), 'posiciones: aclara "acciones" vs "opciones"');
ok(p2.includes('130 palabras') && !p2.includes('PANORAMA vino vacío'), 'fichas de 130 palabras; con panorama no avisa vacío');
const p2v = buildPromptPosicionesV3(contextoPosicionesV3(base, { generadoEnISO: null, diagnostico: null, sectorial: null, agenda: null }) as unknown as Record<string, unknown>);
ok(p2v.includes('PANORAMA vino vacío'), 'sin parte 1 importada, el prompt lo avisa');
ok(!/\$\{|undefined/.test(p2) && (p2.match(/═══ REGLAS/g) ?? []).length === 1, 'parte 2 sin interpolaciones rotas, un bloque de reglas');
console.log(`     largo parte 2: ${p2.split(/\s+/).length} palabras`);

// ── 4. Validadores e import ──────────────────────────────────────────────────
ok(validarOportunidades(undefined) === null, 'respuesta sin oportunidades (v2) es válida');
ok(validarOportunidades({ faltantes: [{ exposicion: 'Liquidez USD' }], fondeo: [], tacticas: [] }) === null, 'oportunidades válidas pasan');
ok(validarOportunidades({ faltantes: [] }) !== null, 'faltantes vacío falla');
ok(validarOportunidades({ faltantes: 'x' }) !== null, 'faltantes no-array falla');
ok(validarOportunidades([]) !== null, 'oportunidades array falla');
ok(esRespuestaV2({ global: {}, oportunidades: {} }), 'una respuesta v3 entra por el camino v2');
ok(validarGlobal({ diagnostico: 'La cartera depende de energía argentina y cripto; la caja está bajo el piso.', coherencia: { veredicto: 'incompatible' } }) === null, 'global con coherencia pasa el validador');

// ── 5. Extracción tolerante y normalización ──────────────────────────────────
const F = '```';
ok((extraerJson(`hola ${F}json\n{"a":1}\n${F} chau`) as { a: number }).a === 1, 'un bloque json');
ok((extraerJson(`${F}json\n{"a":[1,\n${F}\n\nseguí\n\n${F}json\n2]}\n${F}`) as { a: number[] }).a.length === 2, 'respuesta partida en dos bloques se une');
ok((extraerJson('texto {"b":2} texto') as { b: number }).b === 2, 'sin bloque: objeto suelto');
ok(extraerJson(`${F}json\n{"a":\n${F}`) === null, 'bloque roto sin continuación → null');
const r = normalizarCasosPosicion({ queHariaEnCadaCaso: [{ caso: 'x', opciones: ['A'] }, { caso: 'y', acciones: ['B'] }] }) as { queHariaEnCadaCaso: { acciones?: string[]; opciones?: string[] }[] };
ok(r.queHariaEnCadaCaso[0].acciones?.[0] === 'A' && !('opciones' in r.queHariaEnCadaCaso[0]) && r.queHariaEnCadaCaso[1].acciones?.[0] === 'B', '"opciones" en posiciones se normaliza a "acciones"');

console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK');
process.exit(fallas ? 1 : 0);
