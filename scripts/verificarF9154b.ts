// F9.154b §9 — verificación. Extrae del FUENTE la función `bancoDeDatos`, las dos expresiones de
// `banco:` de las ramas con ítem y el inicializador de `incluirResumenMes`, y los evalúa. No es una
// copia de la lógica: si alguien cambia esas líneas, esto lo ve. SOLO LEE.
import { createRequire } from 'node:module';
import * as fs from 'node:fs';

const req = createRequire(process.cwd() + '/functions/package.json');
const ts = req('typescript') as typeof import('typescript');

function aJs(codigoTs: string): string {
  return ts.transpileModule(codigoTs, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
}

const comp = fs.readFileSync('src/vistas/Comprobantes.tsx', 'utf8').replace(/\r\n/g, '\n');
const alta = fs.readFileSync('src/vistas/AltaMovimiento.tsx', 'utf8').replace(/\r\n/g, '\n');

function bloque(src: string, desde: string, hasta: string, rotulo: string): string {
  const i = src.indexOf(desde);
  if (i < 0) throw new Error(`no encontré "${rotulo}"`);
  const j = src.indexOf(hasta, i);
  if (j < 0) throw new Error(`no encontré el cierre de "${rotulo}"`);
  return src.slice(i, j + hasta.length);
}

// ── §7 — la función de precedencia y las dos expresiones, tal cual están ──────
const fnBanco = bloque(comp, 'function bancoDeDatos', '\n}', 'bancoDeDatos');
const bancoDeDatos = new Function(`${aJs(fnBanco)}\nreturn bancoDeDatos;`)() as (d: unknown) => string | undefined;

// Las dos ramas con ítem son exactamente las dos líneas `banco:` que llaman a `bancoDeDatos(`.
// Buscarlas por un marcador vecino no sirve: en una rama el `banco:` va antes del marcador y en la
// otra después, así que indexOf hacia adelante agarraba la línea equivocada (y con -1, basura).
const lineasBanco = comp.split('\n').map(l => l.trim()).filter(l => l.startsWith('banco:') && l.includes('bancoDeDatos('));
if (lineasBanco.length !== 2) throw new Error(`esperaba 2 líneas de banco con bancoDeDatos, encontré ${lineasBanco.length}`);
const [exprForzado, exprRama2] = lineasBanco.map(l => l.slice('banco:'.length).trim().replace(/,$/, ''));

console.log('=== §7 — expresiones de `banco:` leídas del fuente ===');
console.log(`  rama esperadoForzado : banco: ${exprForzado}`);
console.log(`  rama 2               : banco: ${exprRama2}`);

const evalBanco = (expr: string, d: unknown, item: unknown) =>
  new Function('bancoDeDatos', 'd', 'esperado', 'itemForzado', `return ${expr};`)(bancoDeDatos, d, item, item);

console.log('\n=== §9.1 — el banco que llega al alta ===');
const casos7: Array<[string, unknown, unknown, string]> = [
  ['ítem CON banco, comprobante sin banco',     { moneda: 'ARS' },                 { banco: 'BBVA' },          'BBVA'],
  ['ítem CON banco, comprobante CON banco',     { moneda: 'ARS', banco: 'Galicia' }, { banco: 'BBVA' },        'Galicia'],
  ['ítem SIN banco (null), comprobante sin',    { moneda: 'ARS' },                 { banco: null },            'undefined'],
  ['ítem inexistente (undefined)',              { moneda: 'ARS' },                 undefined,                  'undefined'],
  ['ítem SIN banco, comprobante CON banco',     { moneda: 'ARS', banco: 'Personal Pay' }, { banco: null },      'Personal Pay'],
  ['banco del comprobante con espacios',        { moneda: 'ARS', banco: '  Ciudad  ' }, { banco: 'BBVA' },      'Ciudad'],
  ['banco del comprobante vacío → cae al ítem', { moneda: 'ARS', banco: '   ' },   { banco: 'BBVA' },          'BBVA'],
];
for (const [rotulo, d, item, esperado] of casos7) {
  for (const [nombreRama, expr] of [['forzado', exprForzado], ['rama2', exprRama2]] as const) {
    const got = String(evalBanco(expr, d, item));
    const ok = got === esperado ? 'OK ' : '>>> NO';
    if (nombreRama === 'forzado') console.log(`  ${ok} ${rotulo.padEnd(42)} → ${got.padEnd(14)} (esperado ${esperado})`);
    else if (got !== esperado) console.log(`  >>> NO  la rama 2 difiere: ${got}`);
  }
}
console.log('  (las dos ramas se evaluaron con los mismos casos; solo se imprime una porque dan igual)');

// ── §8 — el inicializador de incluirResumenMes, tal cual está ────────────────
const iniTs = bloque(alta, 'const [incluirResumenMes, setIncluirResumenMes] = useState(() => {', '\n  });', 'incluirResumenMes');
const cuerpo = iniTs.slice(iniTs.indexOf('{', iniTs.indexOf('useState(() =>')) + 1, iniTs.lastIndexOf('}'));
const defaultResumen = new Function('preload', 'hoyISO', aJs(cuerpo)) as (p: unknown, h: () => string) => boolean;

const HOY = '2026-09-03';
const hoyISO = () => HOY;

console.log('\n=== §9.2 — default de `incluirResumenMes` (hoy = ' + HOY + ') ===');
console.log('  cuerpo leído del fuente:' + cuerpo.split('\n').filter(l => l.trim() && !l.trim().startsWith('//')).map(l => '\n    ' + l.trim()).join(''));
console.log();

// El "antes" es la regla vieja, para poder decir en cuál cambia.
const antes = (p: { fecha?: string }) => (p?.fecha ?? HOY) > HOY;

const casos8: Array<[string, Record<string, unknown>, boolean]> = [
  ['esperado impago, fecha FUTURA',  { itemEsperadoId: 'i1', confirmadoPago: false, fecha: '2026-09-20' }, true],
  ['esperado impago, fecha de HOY',  { itemEsperadoId: 'i1', confirmadoPago: false, fecha: HOY },          true],
  ['esperado impago, fecha PASADA',  { itemEsperadoId: 'i1', confirmadoPago: false, fecha: '2026-08-10' }, true],
  ['esperado YA PAGADO, fecha pasada', { itemEsperadoId: 'i1', confirmadoPago: true, fecha: '2026-08-10' }, false],
  ['SUELTO, fecha futura',           { confirmadoPago: false, fecha: '2026-09-20' },                       true],
  ['SUELTO, fecha de hoy',           { confirmadoPago: false, fecha: HOY },                                false],
  ['SUELTO, fecha pasada',           { confirmadoPago: false, fecha: '2026-08-10' },                       false],
  ['alta manual (sin preload)',      {},                                                                   false],
];
for (const [rotulo, preload, esperado] of casos8) {
  const got = defaultResumen(preload, hoyISO);
  const viejo = antes(preload as { fecha?: string });
  const ok = got === esperado ? 'OK ' : '>>> NO';
  const cambio = got !== viejo ? '  <<< CAMBIA (antes ' + viejo + ')' : '  = sin cambio';
  console.log(`  ${ok} ${rotulo.padEnd(34)} → ${String(got).padEnd(5)} (esperado ${esperado})${cambio}`);
}

// ── §9.3 — no regresión sobre lo que toca F9.154 §5 ─────────────────────────
console.log('\n=== §9.3 — no regresión: ¿§7/§8 tocaron algo de lo verificado en F9.154 §5? ===');
const intactos: Array<[string, string, string]> = [
  ['§1 guard de vencimientos',   'functions/src/fechasVencimiento.ts', 'UMBRAL_DIAS_VENCIMIENTO = 183'],
  ['§1 prompt: regla de venc.',  'functions/src/index.ts',             'MÁS CERCANA\n  A HOY EN VALOR ABSOLUTO'],
  ['§2 resolución de destino',   'functions/src/index.ts',             'function resolverItemDeDestino'],
  ['§3 mesImputado',             'functions/src/matchLogica.ts',       'export function mesImputado'],
  ['§3 mesImputacion → preload', 'src/vistas/Comprobantes.tsx',        'mes:                 pm.mesImputacion'],
  ['§3 preload.mes fijado',      'src/vistas/AltaMovimiento.tsx',      'useState(!!preload?.mes)'],
  ['§4 badge tocable',           'src/vistas/Comprobantes.tsx',        'function comprobanteCreoElMovimiento'],
];
for (const [rotulo, archivo, aguja] of intactos) {
  const presente = fs.readFileSync(archivo, 'utf8').includes(aguja);
  console.log(`  ${presente ? 'OK ' : '>>> NO'} ${rotulo.padEnd(28)} sigue en ${archivo}`);
}
