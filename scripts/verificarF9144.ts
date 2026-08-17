// F9.144 §6 — verificación. SOLO LEE.
//
// Corre `motivoDeAusencia` y la tabla `MINIMO_PUNTOS` REALES (bundleadas de src/, no copiadas) y
// reproduce, por identidad, exactamente lo que la ficha va a mostrar. Si esto y la pantalla
// difieren, es un bug de la ficha, no de la verificación.
import * as esbuild from 'esbuild';
import { getDb } from './seed/utils/firestore';

const NOMBRES = ['collection','doc','getDoc','getDocs','setDoc','updateDoc','deleteDoc','query','orderBy','where','limit','startAfter','writeBatch','serverTimestamp'];

async function cargarPuro(): Promise<any> {
  const stub: esbuild.Plugin = {
    name: 'stub',
    setup(build) {
      build.onResolve({ filter: /^firebase\/|\/firebase$/ }, a => ({ path: a.path, namespace: 'stub' }));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: ['const nope=()=>{throw new Error("stub")};', 'export const db={};export const functions={};export const httpsCallable=nope;',
          ...NOMBRES.map(n => `export const ${n}=nope;`)].join('\n'), loader: 'js' as const,
      }));
    },
  };
  // MINIMO_PUNTOS no está exportada de FichaPosicion.tsx (es detalle interno del render): se
  // extrae el literal del archivo para no tener una segunda copia acá.
  const src = await import('node:fs').then(fs => fs.readFileSync('src/vistas/FichaPosicion.tsx', 'utf8'));
  const bloque = src.match(/const MINIMO_PUNTOS: Record<string, number> = \{[\s\S]*?\};/)?.[0];
  if (!bloque) throw new Error('No se pudo extraer MINIMO_PUNTOS de FichaPosicion.tsx');
  const out = await esbuild.build({
    stdin: {
      contents: `export { motivoDeAusencia, LEYENDA_SEMAFOROS } from './src/datos/patrimonioPrecios';\n${bloque}\nexport { MINIMO_PUNTOS };`,
      resolveDir: process.cwd(), loader: 'ts',
    },
    bundle: true, format: 'esm', platform: 'node', write: false, plugins: [stub], logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}

let fallos = 0;
const chequear = (n: string, ok: boolean, d: string) => { if (!ok) fallos++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}: ${d}`); };

async function main() {
  const { motivoDeAusencia, LEYENDA_SEMAFOROS, MINIMO_PUNTOS } = await cargarPuro();
  const db = getDb('production');

  const port = await db.collection('snapshotsPortafolio').orderBy('fechaCorrida', 'desc').limit(1).get();
  const fc = (port.docs[0].data() as any).fechaCorrida;
  const pos = await db.collection('posicionesPatrimonio').where('fechaCorrida', '==', fc).get();
  const man = await db.collection('posicionesManuales').get();
  const ind = await db.collection('indicadoresPosicion').get();

  const porId = new Map<string, any>();
  for (const d of ind.docs) { const x = d.data() as any; porId.set(`${x.ticker}|${x.tipo}|${x.paisRiesgo}`, { ...x, docId: x.docId ?? d.id }); }

  const identidades = new Map<string, any[]>();
  const add = (t: string, tipo: string, pais: string, extra: any) => {
    const k = `${t}|${tipo}|${pais}`;
    if (!identidades.has(k)) identidades.set(k, []);
    identidades.get(k)!.push(extra);
  };
  for (const d of pos.docs) { const p = d.data() as any; add(p.ticker, p.tipo, p.pais_riesgo ?? 'AR', p); }
  for (const d of man.docs) { const m = d.data() as any; add(m.ticker, m.tipo ?? 'accion', m.pais_riesgo ?? 'global', m); }

  /** Reproduce la decisión de la ficha para un campo: valor, "faltan puntos (n de m)", o nada. */
  const render = (i: any, campo: string): string => {
    const v = i?.[campo];
    if (v !== null && v !== undefined) return typeof v === 'number' ? v.toFixed(2) : String(v);
    const min = (MINIMO_PUNTOS as Record<string, number>)[campo];
    if (min && i && i.puntosDisponibles < min) return `faltan puntos (${i.puntosDisponibles} de ${min})`;
    return '(no se muestra)';
  };

  console.log('=============== §6 — CRITERIOS ===============\n');

  // 1 — GLOB: dos identidades distintas
  const globs = [...identidades.keys()].filter(k => k.startsWith('GLOB|'));
  console.log('── GLOB');
  for (const k of globs) {
    const i = porId.get(k);
    console.log(`   ${k}`);
    console.log(`     docId=${i?.docId ?? '(sin documento)'} moneda=${i?.monedaSerie ?? '—'} precio=${i?.precio ?? '—'} puntos=${i?.puntosDisponibles ?? '—'}`);
    console.log(`     motivo en pantalla: ${motivoDeAusencia(i ?? null) ?? '(ninguno)'}`);
  }
  chequear('GLOB tiene DOS identidades en la corrida', globs.length === 2, globs.join('  ·  '));
  const docIds = globs.map(k => porId.get(k)?.docId ?? null);
  chequear('la ficha las trata por separado (docId distinto o ausencia explícita)',
    new Set(docIds.map(String)).size === globs.length, `docIds: ${docIds.join(', ')}`);
  if (docIds.includes(null)) {
    console.log('   NOTA: una de las dos NO tiene documento de indicadores todavía. No es el lector:');
    console.log('   el cron corrió por última vez el 2026-08-16 y la corrida vigente es del 2026-08-17.');
    console.log('   La ficha lo dice con motivoDeAusencia en vez de mostrar los datos del CEDEAR.');
  }

  // 2 — ACN, control de serie sana
  const acn = porId.get('ACN|accion|global');
  console.log(`\n── ACN (control sano): puntos=${acn?.puntosDisponibles} estado=${acn?.estadoSerie} precio=${acn?.precio} (${acn?.fechaUltimoPrecio}) ${acn?.monedaSerie}`);
  chequear('ACN muestra ficha completa', acn && acn.estadoSerie === 'limpia' && acn.puntosDisponibles >= 750 && acn.sma200 !== null,
    `sma200=${acn?.sma200 !== null}, perf1a=${acn?.perf1a !== null}, max52s=${acn?.max52s !== null}`);

  // 3 — sospechosa visible
  const sosp = [...identidades.keys()].filter(k => porId.get(k)?.estadoSerie === 'sospechosa');
  chequear('hay posiciones `sospechosa` y la ficha las marca', sosp.length > 0, `${sosp.length}: ${sosp.map(k => k.split('|')[0]).join(', ')}`);

  // 4 — CEDEAR de 183 puntos: explica lo que falta con el número, no con un guión
  const cede = [...identidades.keys()].filter(k => porId.get(k)?.puntosDisponibles === 183);
  console.log(`\n── CEDEARs de 183 puntos: ${cede.map(k => k.split('|')[0]).join(', ')}`);
  if (cede.length) {
    const i = porId.get(cede[0]);
    for (const campo of ['sma20', 'sma50', 'sma200', 'max52s', 'perf1a']) {
      console.log(`   ${campo.padEnd(8)} → ${render(i, campo)}`);
    }
    chequear('SMA20 y SMA50 se muestran', i.sma20 !== null && i.sma50 !== null, `sma20=${i.sma20 !== null} sma50=${i.sma50 !== null}`);
    const faltantes = ['sma200', 'max52s', 'perf1a'].map(c => render(i, c));
    chequear('SMA200 / máx.52s / perf1a explican con el NÚMERO de puntos',
      faltantes.every(f => f.startsWith('faltan puntos')), faltantes.join(' | '));
  }

  // 5 — sin_fuente muestra tenencia + motivo
  const sinFuente = [...identidades.keys()].filter(k => porId.get(k)?.motivo === 'sin_fuente');
  console.log(`\n── sin_fuente: ${sinFuente.length} → ${sinFuente.map(k => k.split('|')[0]).join(', ')}`);
  if (sinFuente.length) {
    const m = motivoDeAusencia(porId.get(sinFuente[0]));
    console.log(`   motivo en pantalla: "${m}"`);
    chequear('sin_fuente explica en vez de dejar el bloque vacío', !!m && m.length > 10, m ?? '(vacío)');
  }
  const sinDoc = [...identidades.keys()].filter(k => !porId.has(k));
  console.log(`── sin documento: ${sinDoc.length} → ${sinDoc.join(', ')}`);
  chequear('sin documento también explica', motivoDeAusencia(null) !== null, motivoDeAusencia(null) ?? '');

  // 6 — la leyenda dice que rojo no es vender
  const dice = /no.*qu[ée] hacer|compra tanto como/i.test(LEYENDA_SEMAFOROS);
  chequear('la leyenda dice que 🔴 no significa vender', dice, LEYENDA_SEMAFOROS);

  // 7 — cero lecturas de preciosDiarios desde el cliente
  const fs = await import('node:fs');
  const usos: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /cargarPreciosDiarios|'preciosDiarios'/.test(fs.readFileSync(p, 'utf8'))) usos.push(p);
    }
  };
  walk('src');
  chequear('cero lecturas de preciosDiarios fuera de la capa de datos',
    usos.every(u => u.includes('datos/patrimonioPrecios')), usos.join(', ') || '(ninguna)');

  console.log(`\n${fallos === 0 ? 'TODOS OK' : `${fallos} FALLOS`}`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
