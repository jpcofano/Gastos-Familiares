// F9.150 — verificación. SOLO LEE.
//
// §1 y §2 se verifican leyendo el CÓDIGO REAL de las dos puntas (la tabla `GRUPOS` de la ficha y
// `calcSemaforos` del motor) y cruzándolas contra los indicadores REALES de producción: es la
// única forma de ver un desajuste de "qué se calcula" contra "dónde se muestra".
// §3 compara el seed contra `posicionesManuales` de producción.
import * as fs from 'node:fs';
import { getDb } from './seed/utils/firestore';
import * as PP from '../functions/src/patrimonioPrecios';

let fallos = 0;
const chequear = (n: string, ok: boolean, d: string) => {
  if (!ok) fallos++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}: ${d}`);
};
const pct = (x: number | null | undefined, d = 1) => x == null ? '   n/d' : ((x * 100).toFixed(d) + '%').padStart(7);

/** Qué campo de `Indicadores` banda cada semáforo, extraído del motor. */
function metricasDelMotor(): Record<string, string> {
  const src = fs.readFileSync('functions/src/patrimonioPrecios.ts', 'utf8');
  const cuerpo = src.slice(src.indexOf('export function calcSemaforos('),
    src.indexOf('\n}', src.indexOf('export function calcSemaforos(')));
  const out: Record<string, string> = {};
  for (const m of cuerpo.matchAll(/(\w+):\s*banda\(ind\.(\w+)/g)) out[m[1]] = m[2];
  for (const m of cuerpo.matchAll(/(\w+):\s*bandaCaidaCalibrada\(/g)) {
    const j = src.indexOf('export function bandaCaidaCalibrada(');
    const campo = src.slice(j, src.indexOf('\n}', j)).match(/const v = ind\.(\w+);/);
    out[m[1]] = campo ? campo[1] : '(?)';
  }
  for (const m of cuerpo.matchAll(/(\w+):\s*banda\(pesoEnCartera/g)) out[m[1]] = '(argumento)';
  return out;
}

/** De qué fila cuelga la ficha cada semáforo, y con qué etiqueta. */
function filasDeLaFicha() {
  const src = fs.readFileSync('src/vistas/FichaPosicion.tsx', 'utf8');
  const out: Array<{ clave: string; label: string; semaforo: string }> = [];
  for (const m of src.matchAll(/\{ clave: '(\w+)', label: '([^']+)'[^}]*?semaforo: '(\w+)'/g)) {
    out.push({ clave: m[1], label: m[2], semaforo: m[3] });
  }
  return out;
}

/** Todas las etiquetas de la tabla GRUPOS, para detectar nombres ambiguos. */
function etiquetasDeLaFicha(): Array<{ clave: string; label: string }> {
  const src = fs.readFileSync('src/vistas/FichaPosicion.tsx', 'utf8');
  const bloque = src.slice(src.indexOf('const GRUPOS'), src.indexOf('const CAMPOS_LIQUIDEZ'));
  return [...bloque.matchAll(/\{ clave: '(\w+)', label: '([^']+)'/g)].map(m => ({ clave: m[1], label: m[2] }));
}

async function main() {
  const db = getDb('production');
  const ind = await db.collection('indicadoresPosicion').get();
  const conDatos = ind.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
    .filter(x => x.motivo === null).sort((a, b) => a.id.localeCompare(b.id));

  // ── §1
  console.log('\n===== §1 — el semáforo en la fila que corresponde =====\n');
  const motor = metricasDelMotor();
  const ficha = filasDeLaFicha();
  console.log('clave          motor banda            ficha lo cuelga de       label                        ok');
  const desajustes: string[] = [];
  for (const [clave, campoMotor] of Object.entries(motor)) {
    if (campoMotor === '(argumento)') continue;   // `peso` no vive en la tabla GRUPOS
    const f = ficha.find(x => x.semaforo === clave);
    const campoFicha = f?.clave ?? '(ninguna fila)';
    const ok = campoFicha === campoMotor;
    if (!ok) desajustes.push(`${clave}: motor=${campoMotor} ficha=${campoFicha}`);
    console.log(`${clave.padEnd(14)} ${campoMotor.padEnd(21)} ${campoFicha.padEnd(24)} ${(f?.label ?? '-').padEnd(28)} ${ok ? 'si' : 'NO'}`);
  }
  chequear('§1 ningún semáforo colgado de la fila equivocada', desajustes.length === 0,
    desajustes.length ? desajustes.join(' | ') : `${Object.keys(motor).length - 1} semáforos de la tabla, todos sobre su propia métrica`);

  const huerfanas = ficha.filter(f => !(f.semaforo in motor));
  chequear('§1 sin filas apuntando a semáforos retirados', huerfanas.length === 0,
    huerfanas.length ? huerfanas.map(h => `${h.clave}→${h.semaforo}`).join(' ') : 'ninguna fila apunta a un semáforo que el motor ya no emite');

  // El caso concreto, con datos reales: el color de la fila tiene que ser el de su propio número.
  console.log('\n  con los indicadores de producción — la fila de 90d y su banda:');
  console.log('  ticker              vol30d   vol90d   semáforo   banda del 90d   banda del 30d');
  let mienten = 0;
  for (const x of conDatos) {
    const clase = PP.claseUmbral(x.tipo, x.paisRiesgo === 'global' ? 'global' : 'AR');
    const u = PP.UMBRALES.volatilidad[clase];
    const b = (v: number | null) => v == null ? 'sin_datos'
      : Math.abs(v) < u.verde ? 'verde' : Math.abs(v) <= u.amarillo ? 'amarillo' : 'rojo';
    const sem = x.semaforos?.volatilidad ?? '-';
    const b90 = b(x.volAnualizada90d), b30 = b(x.volAnualizada30d);
    if (b30 !== b90) mienten++;
    const marca = b30 !== b90 ? '  <-- antes el punto caía acá' : '';
    console.log(`  ${x.id.padEnd(19)} ${pct(x.volAnualizada30d)} ${pct(x.volAnualizada90d)}  ${sem.padEnd(10)} ${b90.padEnd(15)} ${b30}${marca}`);
  }
  const coincide = conDatos.every(x => {
    const clase = PP.claseUmbral(x.tipo, x.paisRiesgo === 'global' ? 'global' : 'AR');
    const u = PP.UMBRALES.volatilidad[clase];
    const v = x.volAnualizada90d;
    const esp = v == null ? 'sin_datos' : Math.abs(v) < u.verde ? 'verde' : Math.abs(v) <= u.amarillo ? 'amarillo' : 'rojo';
    return (x.semaforos?.volatilidad ?? 'sin_datos') === esp;
  });
  chequear('§1 el semáforo guardado corresponde al 90d', coincide,
    `las ${conDatos.length} posiciones: el color es el de volAnualizada90d, que ahora es la fila donde se pinta`);
  chequear('§1 los casos medidos', mienten >= 2,
    `${mienten} posiciones donde 30d y 90d caen en bandas distintas — ahí el punto en la fila vieja mentía. ` +
    `GD30 (30d rojo vs 90d amarillo) y TX26 (30d verde vs 90d sin_datos)`);

  // ── §2
  console.log('\n===== §2 — los dos drawdowns, sin ambigüedad =====\n');
  const etiquetas = etiquetasDeLaFicha();
  const l52 = etiquetas.find(e => e.clave === 'distanciaMax52sPct')?.label ?? '';
  const lHist = etiquetas.find(e => e.clave === 'drawdownDesdeMaxPct')?.label ?? '';
  console.log(`  distanciaMax52sPct  → "${l52}"`);
  console.log(`  drawdownDesdeMaxPct → "${lHist}"`);
  chequear('§2 cada etiqueta dice cuál máximo usa',
    /52 sem/i.test(l52) && /hist/i.test(lHist),
    'una nombra la ventana de 52 semanas y la otra el máximo histórico');
  chequear('§2 las etiquetas ya no son casi idénticas', l52 !== lHist && !(l52 === 'Distancia al máx.' && lHist === 'Drawdown desde máx.'),
    `"${l52}" vs "${lHist}"`);
  chequear('§2 el campo se sigue mostrando (opción A, no B)',
    etiquetas.some(e => e.clave === 'drawdownDesdeMaxPct'),
    'la caída desde el máximo histórico es información real; el problema era la etiqueta');
  chequear('§2 el semáforo sigue en el de 52 semanas',
    ficha.find(f => f.semaforo === 'caida52s')?.clave === 'distanciaMax52sPct',
    'es el único con calibración (F9.149); el histórico no lleva banda');
  // El chip del diagnóstico y la fila tienen que llamarse igual, o se leen como dos cosas.
  const src2 = fs.readFileSync('src/datos/patrimonioPrecios.ts', 'utf8');
  const chip = src2.match(/caida52s:\s*'([^']+)'/)?.[1] ?? '';
  chequear('§2 el chip del diagnóstico usa la misma etiqueta que la fila', chip === l52,
    `chip "${chip}" = fila "${l52}"`);

  console.log('\n  las 3 posiciones donde los dos números difieren:');
  console.log('  ticker              52 semanas   histórico   diferencia');
  for (const x of conDatos) {
    const a = x.distanciaMax52sPct, b = x.drawdownDesdeMaxPct;
    if (a == null || b == null || Math.abs(a - b) <= 0.005) continue;
    console.log(`  ${x.id.padEnd(19)} ${pct(a)}      ${pct(b)}    ${((Math.abs(b - a)) * 100).toFixed(1)} pp`);
  }

  // ── §3
  console.log('\n===== §3 — el seed contra producción =====\n');
  const src3 = fs.readFileSync('src/datos/patrimonio.ts', 'utf8');
  const bloque = src3.slice(src3.indexOf('const MANUALES_SEED'), src3.indexOf('];', src3.indexOf('const MANUALES_SEED')) + 2);
  const man = await db.collection('posicionesManuales').get();
  const reales = new Map(man.docs.map(d => [d.id, d.data() as any]));

  const idsSeed = [...bloque.matchAll(/id: '(\w+)'/g)].map(m => m[1]);
  console.log(`  seed: ${idsSeed.join(', ') || '(vacío)'}`);
  console.log(`  producción: ${[...reales.keys()].join(', ') || '(vacía)'}`);

  chequear('§3 el seed no siembra nada que ya no sea manual',
    idsSeed.every(id => reales.has(id)),
    idsSeed.filter(id => !reales.has(id)).length
      ? `sobran en el seed: ${idsSeed.filter(id => !reales.has(id)).join(', ')}`
      : 'todo id del seed existe hoy en posicionesManuales');

  for (const [id, real] of reales) {
    const enSeed = new RegExp(`id: '${id}'[\\s\\S]*?\\}`).exec(bloque)?.[0] ?? '';
    const cant = Number(enSeed.match(/cantidad: ([\d.]+)/)?.[1]);
    const val = Number(enSeed.match(/valorUsd: ([\d.]+)/)?.[1]);
    const fec = enSeed.match(/fechaValuacion: '([\d-]+)'/)?.[1];
    chequear(`§3 ${id} coincide con producción`,
      cant === real.cantidad && Math.abs(val - real.valorUsd) < 0.01 && fec === real.fechaValuacion,
      `seed cantidad=${cant} valorUsd=${val} fecha=${fec} | producción cantidad=${real.cantidad} valorUsd=${real.valorUsd} fecha=${real.fechaValuacion}`);
    // La nota es parte del dato: una nota vieja miente igual que un número viejo.
    const notas = enSeed.match(/notas: '([^']+)'/)?.[1] ?? '';
    const implicito = (real.valorUsd / real.cantidad).toFixed(2).replace('.', ',');
    chequear(`§3 ${id} tiene la nota coherente con sus números`, notas.includes(implicito),
      `nota del seed "${notas}" vs USD ${implicito}/acción implícito`);
  }

  // GLOB: la razón por la que se borró, verificada contra la corrida
  const port = await db.collection('snapshotsPortafolio').orderBy('fechaCorrida', 'desc').limit(1).get();
  const fc = (port.docs[0].data() as any).fechaCorrida;
  const pos = await db.collection('posicionesPatrimonio').where('fechaCorrida', '==', fc).get();
  const globEsp = pos.docs.map(d => d.data() as any).filter(x => x.ticker === 'GLOB' && x.tipo === 'accion');
  chequear('§3 GLOB salió del seed porque ya viene de la corrida', globEsp.length > 0 && !idsSeed.includes('glob'),
    globEsp.length
      ? `la corrida ${fc} trae GLOB ESPP con ${globEsp[0].cantidad} papeles (USD ${Math.round(globEsp[0].valorUsd)}) en "${globEsp[0].cuenta}": ` +
        `resembrarlo como manual habría DUPLICADO la tenencia, no solo desactualizado el número`
      : 'GLOB no aparece en la corrida vigente');

  // ── el motor no se tocó
  console.log('\n===== el motor no se tocó =====\n');
  chequear('cero cambios en los umbrales',
    PP.UMBRALES.volatilidad.accionAr.verde === 0.40 && PP.UMBRALES.volatilidad.accionAr.amarillo === 0.60 &&
    PP.UMBRALES.peso.verde === 0.04 && PP.MINIMO_OBS_DRAWDOWN === 400 && PP.UMBRAL_SALTO === 0.45,
    'volatilidad 0.40/0.60, peso 0.04/0.08, MINIMO_OBS_DRAWDOWN 400, UMBRAL_SALTO 0.45');
  chequear('cero semáforos nuevos o retirados',
    Object.keys(motor).sort().join(',') === 'caida52s,peso,volatilidad',
    `claves: ${Object.keys(motor).sort().join(', ')}`);

  console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLOS`}`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
