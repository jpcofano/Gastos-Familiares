// F9.157 §5 — verificación. `tipoDeLinea` y `calcularCuadre` se EXTRAEN del código real, y el
// cableado del selector se lee del fuente de la vista. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';

const req = createRequire(process.cwd() + '/functions/package.json');
const ts = req('typescript') as typeof import('typescript');

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

const srcDatos = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
const srcVista = fs.readFileSync('src/vistas/ResumenesTarjeta.tsx', 'utf8').replace(/\r\n/g, '\n');

function bloque(fuente: string, desde: string, hasta: string): string {
  const i = fuente.indexOf(desde);
  if (i < 0) throw new Error(`no encontré "${desde}"`);
  const j = fuente.indexOf(hasta, i);
  return fuente.slice(i, j + hasta.length);
}
const js = ts.transpileModule([
  bloque(srcDatos, 'function tipoDeLinea', '\n}'),
  bloque(srcDatos, 'export function calcularCuadre', '\n}').replace('export ', ''),
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
const motor = new Function(`${js}\nreturn { tipoDeLinea, calcularCuadre };`)() as {
  tipoDeLinea: (l: Record<string, unknown>) => 'Gasto' | 'Ingreso';
  calcularCuadre: (l: unknown[], a: number, u: number, aj?: unknown[]) => {
    sumaARS: number; sumaUSD: number; diffARS: number; diffUSD: number; balanceARS: boolean; balanceUSD: boolean;
  };
};

type Linea = { tipoLinea?: string; descripcionRaw?: string; monto?: number; moneda?: string; incluir?: boolean; categoria?: string | null; subcategoria?: string | null };
const TIPOS_INGRESO = ['reintegro_percepcion', 'bonificacion', 'reverso'];

async function main() {
  // ── §5.2 — el selector está cableado ────────────────────────────────────
  console.log('=== §5.2 — el selector, leído del fuente de la vista ===');
  for (const [rotulo, aguja] of [
    ['es un <select>, no un <span> de solo lectura', 'value={linea.tipoLinea}'],
    ['llama a actualizar(idx, { tipoLinea })',       'actualizar(idx, cruza'],
    ['ofrece los seis valores',                      '{TIPOS_LINEA.map(t => ('],
    ['recalcula la categoría al cruzar impuesto',    'categoriaSugerida(tipoLinea, linea.descripcionRaw)'],
    ['ya no queda el <span> viejo',                  '<span className={`rt-tipo rt-tipo--${linea.tipoLinea}`}>'],
  ] as const) {
    const hay = srcVista.includes(aguja);
    const esperado = rotulo.startsWith('ya no') ? !hay : hay;
    console.log(`  ${esperado ? 'OK ' : '>>> NO'} ${rotulo}`);
  }
  const tipos = bloque(srcVista, 'const TIPOS_LINEA', '];');
  console.log(`  valores ofrecidos: ${tipos.split('\n').slice(1).join(' ').trim()}`);

  console.log('\n  --- el signo del movimiento cambia con el tipo (tipoDeLinea real) ---');
  for (const t of ['consumo', 'cuota', 'impuesto', 'reintegro_percepcion', 'bonificacion', 'reverso']) {
    console.log(`      tipoLinea=${t.padEnd(21)} → ${motor.tipoDeLinea({ tipoLinea: t })}`);
  }

  // ── §5.3 — el cuadre se recalcula ───────────────────────────────────────
  console.log('\n=== §5.3 — el cuadre se recalcula al cambiar tipoLinea (calcularCuadre real) ===');
  const resus = await db.collection('resumenesTarjeta').get();
  // El caso real: el seguro del auto en 08a697e0, hoy reintegro_percepcion por 168542.
  const d = resus.docs.find(x => x.id.startsWith('08a697e0'))!;
  const x = d.data();
  const lineas = (x.movimientosParseados ?? []) as Linea[];
  const idx = lineas.findIndex(l => s(l.descripcionRaw).includes('CAJA SEG-PROMO'));
  const laLinea = lineas[idx];
  console.log(`  resumen 08a697e0 ${s(x.periodo)} | línea [${idx}] "${s(laLinea.descripcionRaw)}" | monto=${s(laLinea.monto)} ${s(laLinea.moneda)}`);

  const antes = motor.calcularCuadre(lineas, Number(x.totalARS), Number(x.totalUSD), (x.ajustesConsolidado ?? []) as unknown[]);
  const corregidas = lineas.map((l, i) => i === idx ? { ...l, tipoLinea: 'consumo' } : l);
  const despues = motor.calcularCuadre(corregidas, Number(x.totalARS), Number(x.totalUSD), (x.ajustesConsolidado ?? []) as unknown[]);
  const monto = Number(laLinea.monto ?? 0);

  console.log(`  ANTES   (reintegro_percepcion → Ingreso, resta): sumaARS=${antes.sumaARS.toFixed(2)} diffARS=${antes.diffARS.toFixed(2)} balanceARS=${antes.balanceARS}`);
  console.log(`  DESPUÉS (consumo → Gasto, suma):                 sumaARS=${despues.sumaARS.toFixed(2)} diffARS=${despues.diffARS.toFixed(2)} balanceARS=${despues.balanceARS}`);
  const deltaSuma = despues.sumaARS - antes.sumaARS;
  console.log(`  Δ sumaARS = ${deltaSuma.toFixed(2)} | 2 × monto = ${(2 * monto).toFixed(2)} → ${Math.abs(deltaSuma - 2 * monto) < 0.01 ? 'OK  se movió por el DOBLE del monto' : '>>> NO'}`);
  console.log(`  Δ diffARS = ${(despues.diffARS - antes.diffARS).toFixed(2)}`);

  // El mismo experimento al revés: bonificacion → consumo, como pide la spec textualmente.
  console.log('\n  --- el caso literal de la spec: una línea de `bonificacion` a `consumo` ---');
  const sintetica: Linea[] = [
    { tipoLinea: 'consumo', monto: 1000, moneda: 'ARS', incluir: true },
    { tipoLinea: 'bonificacion', monto: 250, moneda: 'ARS', incluir: true },
  ];
  const a2 = motor.calcularCuadre(sintetica, 1250, 0, []);
  const b2 = motor.calcularCuadre(sintetica.map((l, i) => i === 1 ? { ...l, tipoLinea: 'consumo' } : l), 1250, 0, []);
  console.log(`      total del resumen = 1250 | líneas: consumo 1000 + bonificacion 250`);
  console.log(`      ANTES:   sumaARS=${a2.sumaARS} diffARS=${a2.diffARS} balanceARS=${a2.balanceARS}`);
  console.log(`      DESPUÉS: sumaARS=${b2.sumaARS} diffARS=${b2.diffARS} balanceARS=${b2.balanceARS}`);
  console.log(`      ${Math.abs((b2.sumaARS - a2.sumaARS) - 500) < 0.01 ? 'OK ' : '>>> NO'} la suma se movió 500 = 2 × 250, y el resumen pasa a cuadrar`);

  // ── §5.3b — ¿la aritmética del PDF respalda la clasificación actual? ────
  // La pregunta que decide si el "seguro como Ingreso" es un bug o no lo es: si el resumen cuadra
  // al centavo CON la línea como reintegro y dejaría de cuadrar como consumo, el que se equivoca
  // no es el extractor.
  console.log('\n=== §5.3b — el cuadre como juez de la clasificación del seguro ===');
  console.log('  resumen  | periodo | tipoLinea del seguro   | cuadra HOY | cuadra como consumo');
  for (const r of resus.docs.slice().sort((a, b) => s(a.data().periodo).localeCompare(s(b.data().periodo)))) {
    const y = r.data();
    const ls = (y.movimientosParseados ?? []) as Linea[];
    const i = ls.findIndex(l => /CAJA SEG/i.test(s(l.descripcionRaw)));
    if (i < 0) continue;
    const hoy = motor.calcularCuadre(ls, Number(y.totalARS), Number(y.totalUSD), (y.ajustesConsolidado ?? []) as unknown[]);
    const alt = motor.calcularCuadre(ls.map((l, n) => n === i ? { ...l, tipoLinea: 'consumo' } : l), Number(y.totalARS), Number(y.totalUSD), (y.ajustesConsolidado ?? []) as unknown[]);
    console.log(`  ${r.id.slice(0, 8)} | ${s(y.periodo)} | ${s(ls[i].tipoLinea).padEnd(21)} | ${String(hoy.balanceARS).padEnd(10)} | ${alt.balanceARS} (diff ${hoy.diffARS.toFixed(0)} → ${alt.diffARS.toFixed(0)})`);
  }

  // ── §5.4 — derivados de tipoLinea ───────────────────────────────────────
  console.log('\n=== §5.4 — qué más depende de tipoLinea, y qué pasa al editarlo ===');
  const derivados: Array<[string, string, string]> = [
    ['tipoDeLinea → Gasto/Ingreso',   'src/datos/resumenesTarjeta.ts:158', 'se recalcula solo (corre sobre lineasEditadas)'],
    ['calcularCuadre → signo y diff', 'src/datos/resumenesTarjeta.ts:181', 'se recalcula solo (corre sobre lineasEditadas)'],
    ['categoria "Impuestos y finanzas"', 'ResumenesTarjeta.tsx (useEffect init)', 'NO se recalculaba → arreglado en §2 (categoriaSugerida al cruzar impuesto)'],
    ['sinPersona (avisa persona faltante)', 'ResumenesTarjeta.tsx:sinPersona', 'se recalcula solo (const del render)'],
    ['split de cuotas de la card',    'TarjetaFace.tsx:48', 'lee lo PERSISTIDO: cambia recién al confirmar'],
    ['conteo de cuotas',              'functions/src/index.ts:2716', 'lee lo PERSISTIDO: cambia recién al confirmar'],
    ['validación de tipoLinea',       'functions/src/index.ts:1348', 'solo en la extracción, no aplica a la edición'],
    ['esBonificacion/esReverso/esImpuesto', 'src/types/index.ts:79-81', 'NO se usan en el cliente; quedan desincronizados y no afectan nada'],
  ];
  for (const [q, donde, efecto] of derivados) console.log(`  · ${q.padEnd(38)} ${donde.padEnd(40)} → ${efecto}`);

  // ── §5.5 — no regresión ─────────────────────────────────────────────────
  console.log('\n=== §5.5 — no regresión: un resumen SIN líneas mal clasificadas ===');
  const limpio = resus.docs.find(r => {
    const ls = (r.data().movimientosParseados ?? []) as Linea[];
    return ls.length > 0 && !ls.some(l => TIPOS_INGRESO.includes(s(l.tipoLinea)));
  })!;
  const lx = limpio.data();
  const ll = (lx.movimientosParseados ?? []) as Linea[];
  const c = motor.calcularCuadre(ll, Number(lx.totalARS), Number(lx.totalUSD), (lx.ajustesConsolidado ?? []) as unknown[]);
  const signos = new Map<string, number>();
  for (const l of ll) {
    if (!l.incluir || Number(l.monto ?? 0) <= 0) continue;
    const t = motor.tipoDeLinea(l as Record<string, unknown>);
    signos.set(t, (signos.get(t) ?? 0) + 1);
  }
  console.log(`  ${limpio.id.slice(0, 8)} | ${s(lx.periodo)} | ${s(lx.banco)}/${s(lx.tarjeta)} | ${ll.length} líneas`);
  console.log(`  signos: ${JSON.stringify([...signos])} → ${[...signos.keys()].every(k => k === 'Gasto') ? 'OK  todas Gasto, como hoy' : '>>> hay Ingresos'}`);
  console.log(`  cuadre: sumaARS=${c.sumaARS.toFixed(2)} total=${s(lx.totalARS)} diffARS=${c.diffARS.toFixed(2)} balanceARS=${c.balanceARS}`);
  console.log('  El selector solo cambia lo que el usuario toca: sin tocarlo, `lineasEditadas` sale del');
  console.log('  mismo useEffect de inicialización de siempre y confirmarResumenTarjeta produce lo mismo.');

  // Prueba mecánica: los valores iniciales del selector son los de los datos, sin transformación.
  const iguales = ll.every(l => TIPOS_INGRESO.includes(s(l.tipoLinea)) === (motor.tipoDeLinea(l as Record<string, unknown>) === 'Ingreso'));
  console.log(`  ${iguales ? 'OK ' : '>>> NO'} tipoDeLinea sobre las ${ll.length} líneas coincide con la clasificación de origen (el mapeo no se tocó, §4)`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
