// F9.147 — verificación. SOLO LEE.
//
// Corre `contextoPosicion` y `buildPromptPosicion`/`validarResultadoImportado` REALES (bundleados
// de src/ y functions/, no copiados) sobre los datos REALES de producción. Si esto y la pantalla
// difieren, es un bug de la pantalla.
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import { getDb } from './seed/utils/firestore';

const NOMBRES = ['collection', 'doc', 'getDoc', 'getDocs', 'setDoc', 'updateDoc', 'deleteDoc',
  'query', 'orderBy', 'where', 'limit', 'startAfter', 'writeBatch', 'serverTimestamp'];

/** Bundlea el módulo de datos con firebase stubeado: interesa la parte pura. */
async function cargarPuro(): Promise<any> {
  const stub: esbuild.Plugin = {
    name: 'stub',
    setup(build) {
      build.onResolve({ filter: /^firebase\/|\/firebase$/ }, a => ({ path: a.path, namespace: 'stub' }));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        // `httpsCallable` se INVOCA a nivel de módulo (los wrappers `_analizarConIA` y compañía),
        // así que no puede tirar: devuelve la función que sí tira si alguien la llama.
        contents: ['const nope=()=>{throw new Error("stub: no se puede llamar a Firebase acá")};',
          'export const db={};export const functions={};',
          'export const httpsCallable=()=>nope;',
          ...NOMBRES.map(n => `export const ${n}=nope;`)].join('\n'), loader: 'js' as const,
      }));
    },
  };
  const out = await esbuild.build({
    stdin: {
      contents: `export { contextoPosicion, FUNDAMENTALS_POR_TIPO } from './src/datos/patrimonioIA';`,
      resolveDir: process.cwd(), loader: 'ts',
    },
    bundle: true, format: 'esm', platform: 'node', write: false, plugins: [stub], logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}

/** Extrae del index.ts real las dos funciones que gobiernan prompt y validación. */
async function cargarFunctions(): Promise<any> {
  const src = fs.readFileSync('functions/src/index.ts', 'utf8');
  const corte = (nombre: string, firma: string) => {
    const i = src.indexOf(firma);
    if (i < 0) throw new Error(`no se encontró ${nombre}`);
    let nivel = 0, j = src.indexOf('{', i);
    const ini = j;
    for (; j < src.length; j++) {
      if (src[j] === '{') nivel++;
      else if (src[j] === '}') { nivel--; if (nivel === 0) break; }
    }
    return src.slice(i, j + 1).replace(/^function /, 'export function ') + '\n';
  };
  const bloque = corte('buildPromptPosicion', 'function buildPromptPosicion(') +
    corte('validarResultadoImportado', 'function validarResultadoImportado(') +
    corte('extraerResultado', 'function extraerResultado(');
  const out = await esbuild.build({
    stdin: { contents: bloque, resolveDir: process.cwd(), loader: 'ts' },
    bundle: false, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}

let fallos = 0;
const chequear = (n: string, ok: boolean, d: string) => {
  if (!ok) fallos++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}: ${d}`);
};

async function main() {
  const { contextoPosicion, FUNDAMENTALS_POR_TIPO } = await cargarPuro();
  const { buildPromptPosicion, validarResultadoImportado, extraerResultado } = await cargarFunctions();
  const db = getDb('production');

  const indSnap = await db.collection('indicadoresPosicion').get();
  const indPorId = new Map<string, any>();
  for (const d of indSnap.docs) indPorId.set(d.id, { ...(d.data() as any) });

  const port = await db.collection('snapshotsPortafolio').orderBy('fechaCorrida', 'desc').limit(1).get();
  const fc = (port.docs[0].data() as any).fechaCorrida;
  const posSnap = await db.collection('posicionesPatrimonio').where('fechaCorrida', '==', fc).get();
  const totalUsd = posSnap.docs.reduce((s, d) => s + ((d.data() as any).valorUsd ?? 0), 0);

  // ── §1 — el contexto lleva la ficha entera, para una posición real
  console.log('\n===== §1 — el contexto del prompt =====\n');
  const pamp = posSnap.docs.filter(d => (d.data() as any).ticker === 'PAMP').map(d => d.data() as any);
  const valorPamp = pamp.reduce((s, p) => s + (p.valorUsd ?? 0), 0);
  const ctx = contextoPosicion('PAMP', 'Energía AR', valorPamp, totalUsd, [{
    identidad: 'PAMP|accion|AR', tipo: 'accion', paisRiesgo: 'AR',
    valorUsd: valorPamp, cantidad: pamp.reduce((s, p) => s + (p.cantidad ?? 0), 0),
    ind: indPorId.get('PAMP') ?? null,
  }]);

  console.log(JSON.stringify(ctx, null, 2).split('\n').slice(0, 46).join('\n'));
  console.log('  …');

  chequear('§1 el contexto dejó de ser 4 campos', Object.keys(ctx).length > 4,
    `${Object.keys(ctx).length} claves de primer nivel: ${Object.keys(ctx).join(', ')}`);

  const f0 = (ctx.fichas as any[])[0];
  const grupos = ['precio', 'tendencia', 'rango', 'riesgo', 'performance', 'momentum', 'liquidez', 'semaforos'];
  const presentes = grupos.filter(g => f0[g] != null);
  chequear('§1 los indicadores llegan con sus valores', presentes.length === grupos.length,
    `grupos presentes: ${presentes.join(', ')}`);
  chequear('§1 el precio va con su fecha', !!f0.precio?.fecha && f0.precio?.valor != null,
    `precio ${f0.precio?.valor} del ${f0.precio?.fecha} en ${f0.precio?.moneda}`);
  chequear('§1 la performance declara su moneda', !!f0.performance?.moneda,
    `performance en ${f0.performance?.moneda}, resto de la ficha en ${f0.monedaSerie}`);
  chequear('§1 viaja el estado de la serie', !!f0.estadoSerie,
    `estadoSerie=${f0.estadoSerie}, puntosDisponibles=${f0.puntosDisponibles}`);

  // F9.149: si los indicadores están recalculados, la calibración tiene que viajar
  const tieneCalib = f0.calibracionCaida != null;
  console.log(`  calibracionCaida: ${tieneCalib ? JSON.stringify(f0.calibracionCaida) : 'null (indicadoresPosicion todavía sin F9.149 desplegado)'}`);

  // ── identidades múltiples
  const glob = contextoPosicion('GLOB', 'Global', 1000, totalUsd, [
    { identidad: 'GLOB|cedear|global', tipo: 'cedear', paisRiesgo: 'global', valorUsd: 600, cantidad: 10, ind: indPorId.get('GLOB__cedear_global') ?? null },
    { identidad: 'GLOB|accion|global', tipo: 'accion', paisRiesgo: 'global', valorUsd: 400, cantidad: 5, ind: indPorId.get('GLOB') ?? null },
  ]);
  chequear('§1 una ficha por IDENTIDAD, no por ticker', (glob.fichas as any[]).length === 2,
    `GLOB manda ${(glob.fichas as any[]).length} fichas (CEDEAR en ARS + acción global en USD)`);

  // ── §2 — selección de fundamentals por tipo
  console.log('\n===== §2 — fundamentals por tipo =====\n');
  chequear('§2 se piden solo los del tipo', (ctx.fundamentalsPedidos as string[]).length >= 5 &&
    (ctx.fundamentalsPedidos as string[]).length <= 8,
    `acción → ${(ctx.fundamentalsPedidos as string[]).length}: ${(ctx.fundamentalsPedidos as string[]).join(', ')}`);
  for (const t of ['accion', 'cedear', 'bono', 'on', 'fci', 'cripto']) {
    const n = (FUNDAMENTALS_POR_TIPO[t] ?? []).length;
    console.log(`  ${t.padEnd(8)} ${n} indicadores: ${(FUNDAMENTALS_POR_TIPO[t] ?? []).join(', ')}`);
    if (n < 4 || n > 8) fallos++;
  }
  chequear('§2 cash no lleva fundamentals', (FUNDAMENTALS_POR_TIPO['cash'] ?? []).length === 0,
    'un dólar en la cuenta no tiene P/E');

  // ── §1/§3 — el prompt
  console.log('\n===== §3 — el prompt =====\n');
  const prompt = buildPromptPosicion(ctx);
  const debeContener: Array<[string, string]> = [
    ['pide fundamentals', '"fundamentals"'],
    ['pide recomendacion', '"recomendacion"'],
    ['pide justificacion', '"justificacion"'],
    ['conserva queHariaEnCadaCaso', '"queHariaEnCadaCaso"'],
    ['prohíbe recalcular', 'NO RECALCULES LO QUE YA ESTÁ EN EL CONTEXTO'],
    ['exige citar indicadores', 'indicadoresCitados'],
    ['null antes que inventar', 'UN HUECO EXPLÍCITO ES PREFERIBLE A UN NÚMERO INVENTADO'],
    ['no vender por estar en ganancia', 'NO asumas que una posición debe venderse porque está en ganancia'],
    ['explica la banda calibrada', 'calibracionCaida'],
    ['advierte sobre la moneda', 'No los mezcles'],
    ['acota la lista de ratios', 'no quiere la pantalla llena de ratios'],
  ];
  for (const [n, needle] of debeContener) chequear(`§3 ${n}`, prompt.includes(needle), `"${needle.slice(0, 46)}…"`);
  chequear('§3 el prompt lleva los valores reales', prompt.includes('"vsSma200"') || prompt.includes('vsSma200'),
    `el JSON del contexto va embebido (${prompt.length} chars en total)`);
  chequear('§3 la lista de fundamentals es la del tipo', prompt.includes('"EV/EBITDA"'),
    'para una acción pide P/E, EV/EBITDA, margen operativo, ROE, deuda/EBITDA, crecimiento');

  // ── validación de importación
  console.log('\n===== validación del pegado manual =====\n');
  const base = { queEs: 'x', situacionActual: 'y', riesgos: ['a'], rolEnCartera: 'z' };
  chequear('viejo shape sigue validando', validarResultadoImportado('posicion', base) === null,
    'un análisis sin los campos nuevos se importa igual — los 40 guardados no se rompen');
  chequear('recomendación sin citas se rechaza',
    validarResultadoImportado('posicion', { ...base, recomendacion: { accion: 'Vender' } }) !== null,
    validarResultadoImportado('posicion', { ...base, recomendacion: { accion: 'Vender' } }) ?? '');
  chequear('recomendación con citas pasa',
    validarResultadoImportado('posicion', { ...base, recomendacion: { accion: 'Vender', indicadoresCitados: [{ nombre: 'x', valor: '1' }] } }) === null,
    'accion + indicadoresCitados no vacío');
  chequear('accion null con motivo pasa',
    validarResultadoImportado('posicion', { ...base, recomendacion: { accion: null, motivoSinRecomendacion: 'sin datos' } }) === null,
    'es la salida prevista cuando no se puede citar nada');
  chequear('accion inventada se rechaza',
    validarResultadoImportado('posicion', { ...base, recomendacion: { accion: 'Rezar', indicadoresCitados: [{ nombre: 'x', valor: '1' }] } }) !== null,
    'solo Mantener/Comprar/Aumentar/Reducir/Vender');
  chequear('fundamentals con valores y sin fuente se rechaza',
    validarResultadoImportado('posicion', { ...base, fundamentals: { metricas: [{ nombre: 'P/E', valor: 12 }] } }) !== null,
    'un número reportado sin procedencia no se puede juzgar');
  chequear('fundamentals todo null sin fuente pasa',
    validarResultadoImportado('posicion', { ...base, fundamentals: { metricas: [{ nombre: 'P/E', valor: null }], fuente: null, fechaDato: null, motivoSinDatos: 'no se encontró' } }) === null,
    'el hueco explícito es válido; el número inventado no');

  // ── ida y vuelta del chat manual: prompt → respuesta pegada → análisis renderizable.
  // Es lo más cerca del end-to-end que se puede llegar sin navegador: recorre exactamente las
  // dos funciones que corre el callable `importarAnalisisIA` al pegar la respuesta.
  console.log('\n===== ida y vuelta del flujo de chat =====\n');
  const respuestaModelo = '```json\n' + JSON.stringify({
    queEs: 'Generadora y distribuidora de energía integrada.',
    situacionActual: 'Cotiza 11,6% abajo de su máximo de 52 semanas.',
    riesgos: ['Riesgo regulatorio tarifario', 'Exposición al ciclo argentino', 'Precio del gas'],
    rolEnCartera: 'Es el 8% de la cartera y comparte driver con TGSU2 y CEPU.',
    fundamentals: {
      metricas: [
        { nombre: 'P/E', valor: 7.2, unidad: null },
        { nombre: 'EV/EBITDA', valor: 3.9, unidad: null },
        { nombre: 'deuda/EBITDA', valor: null, comentario: 'no se encontró con fuente confiable' },
      ],
      fuente: 'balance 2T26 publicado en la CNV',
      fechaDato: '2026-08-08',
    },
    proximosEventos: [{ cuando: '2026-11', evento: 'Resultados 3T26' }],
    queHariaEnCadaCaso: [{ caso: 'Si la revisión tarifaria sale desfavorable', acciones: ['Reducir', 'Mantener y esperar'], costo: 'Impuesto a las ganancias por realizar' }],
    recomendacion: {
      accion: 'Mantener',
      indicadoresCitados: [
        { nombre: 'vsSma200', valor: '-1.3%' },
        { nombre: 'distanciaAlMax', valor: '-11.6%' },
      ],
    },
    justificacion: [
      'Está apenas debajo de su SMA200 (-1,3%), o sea sin quiebre de tendencia.',
      'La caída desde el máximo (-11,6%) está dentro de lo típico para el papel.',
    ],
    fuentes: ['https://www.cnv.gov.ar'],
  }, null, 2) + '\n```';

  const extraido = extraerResultado('posicion', respuestaModelo);
  chequear('el JSON pegado se extrae del bloque ```json', extraido !== null,
    `se parseó un objeto con ${Object.keys(extraido ?? {}).length} claves`);
  const errRT = validarResultadoImportado('posicion', extraido);
  chequear('la respuesta con el shape nuevo valida', errRT === null, errRT ?? 'sin errores');
  const rt = extraido as any;
  chequear('sobreviven fundamentals, recomendación y justificación',
    !!rt.fundamentals && !!rt.recomendacion && Array.isArray(rt.justificacion),
    `${rt.fundamentals.metricas.length} métricas (1 en null), acción "${rt.recomendacion.accion}" con ` +
    `${rt.recomendacion.indicadoresCitados.length} citas, ${rt.justificacion.length} razones`);
  chequear('queHariaEnCadaCaso convive con la recomendación',
    Array.isArray(rt.queHariaEnCadaCaso) && rt.queHariaEnCadaCaso.length > 0 && !!rt.recomendacion.accion,
    'los dos presentes en el mismo análisis, que es lo que pedía el §3');

  // ── §4 — los análisis guardados
  console.log('\n===== §4 — los análisis ya guardados =====\n');
  const guardados = await db.collection('analisisPosiciones').get();
  const rotos = guardados.docs.filter(d =>
    validarResultadoImportado('posicion', (d.data() as any).resultado ?? {}) !== null);
  chequear('§4 los guardados siguen siendo válidos', rotos.length === 0,
    `${guardados.size} análisis en analisisPosiciones, ${rotos.length} que el validador nuevo rechazaría`);
  const conNuevos = guardados.docs.filter(d => {
    const r = (d.data() as any).resultado ?? {};
    return 'fundamentals' in r || 'recomendacion' in r || 'justificacion' in r;
  });
  console.log(`  con campos nuevos: ${conNuevos.length}/${guardados.size} — el resto renderiza degradado (campos opcionales)`);

  console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLOS`}`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
