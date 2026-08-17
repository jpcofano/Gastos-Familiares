// F9.142 §0 — Medición previa obligatoria. SOLO LEE de Firestore, nunca escribe.
//
//   1. fondoId presentes en cafciCarteras vs. los de configPatrimonio/cafci (huérfanos)
//   2. margen real del limit(50) de cargarUltimasCarteras y proyección de cuándo pierde fondos
//   3. línea de base del benchmark (22 filas) — la única foto del número viejo, para F9.143
//
// calcBenchmark se bundlea en memoria desde src/datos/patrimonioCafci.ts stubeando el SDK
// cliente de Firebase (el módulo importa `db` de ../firebase, que necesita import.meta.env).
// Es la MISMA función que corre en la app, no una reimplementación: si divergieran, la línea
// de base no serviría para comparar.
//
// Uso:
//   npx tsx scripts/auditF9142.ts --target=production
//   npx tsx scripts/auditF9142.ts --target=production --baseline=docs/patrimonio/benchmark-baseline-F9142.json
//   npx tsx scripts/auditF9142.ts --target=production --config=39/6174,...   (simula otra config)

import * as esbuild from 'esbuild';
import { writeFileSync } from 'node:fs';
import { getDb } from './seed/utils/firestore';
import type { Firestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const target = args.includes('--target=production') ? 'production' : 'emulator';
const rutaBaseline = args.find(a => a.startsWith('--baseline='))?.replace('--baseline=', '');
const configSimulada = args.find(a => a.startsWith('--config='))?.replace('--config=', '');

// ── El bundle puro ────────────────────────────────────────────────────────────
const NOMBRES_FIRESTORE = [
  'collection', 'doc', 'getDoc', 'getDocs', 'setDoc', 'updateDoc', 'deleteDoc',
  'query', 'orderBy', 'where', 'limit', 'startAfter', 'writeBatch', 'serverTimestamp',
];

async function cargarModuloPuro(): Promise<any> {
  const stub = {
    name: 'stub-firebase',
    setup(build: esbuild.PluginBuild) {
      build.onResolve({ filter: /^firebase\/|\/firebase$/ }, a => ({ path: a.path, namespace: 'stub' }));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: [
          'const nope = () => { throw new Error("stub: este bundle es solo para funciones puras"); };',
          'export const db = {}; export const functions = {}; export const httpsCallable = nope;',
          ...NOMBRES_FIRESTORE.map(n => `export const ${n} = nope;`),
        ].join('\n'),
        loader: 'js' as const,
      }));
    },
  };
  const out = await esbuild.build({
    stdin: {
      contents: `export { calcBenchmark, normalizarEspecie } from './src/datos/patrimonioCafci';
                 export { bloqueDe } from './src/datos/patrimonioRiesgo';`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true, format: 'esm', platform: 'node', write: false, plugins: [stub], logLevel: 'silent',
  });
  const b64 = Buffer.from(out.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${b64}`);
}

// ── Lecturas ──────────────────────────────────────────────────────────────────
type Cartera = { id: string; fondoId: string; nombre?: string; fechaDatos: string; fechaFetch: string; posiciones: any[]; [k: string]: any };

async function leerTodo(db: Firestore) {
  const cfgSnap = await db.collection('configPatrimonio').doc('cafci').get();
  const fondosCfg: Array<{ fondoId: string; claseId: string; nombre: string }> =
    cfgSnap.exists ? ((cfgSnap.data() as any).fondos ?? []) : [];

  // Una sola lectura ordenada por fechaFetch: la query por fondoId + orderBy pediría un índice
  // compuesto que no existe, y crearlo sería escribir en el proyecto.
  const snap = await db.collection('cafciCarteras').orderBy('fechaFetch', 'desc').get();
  const carteras: Cartera[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  const snapPort = await db.collection('snapshotsPortafolio').orderBy('fechaCorrida', 'desc').limit(1).get();
  const fechaCorrida = snapPort.empty ? null : (snapPort.docs[0].data() as any).fechaCorrida;
  const posSnap = fechaCorrida
    ? await db.collection('posicionesPatrimonio').where('fechaCorrida', '==', fechaCorrida).get()
    : null;
  const manSnap = await db.collection('posicionesManuales').get();
  // Copia de manualToPosicion (src/datos/patrimonioMetricas.ts) — pura, sin efectos.
  const manuales = manSnap.docs.map(d => {
    const m = d.data() as any;
    return {
      ticker: m.ticker, tipo: m.tipo, sector: m.sector, pais_riesgo: m.pais_riesgo,
      cuenta: m.cuenta, titular: null, moneda_origen: 'USD', valor_origen: m.valorUsd,
      cantidad: m.cantidad, fuente: 'manual', revisar: false, valorUsd: m.valorUsd,
      tcUsado: null, fechaCorrida: m.fechaValuacion,
    };
  });
  const posiciones = [...(posSnap ? posSnap.docs.map(d => d.data() as any) : []), ...manuales];

  const mapSnap = await db.collection('cafciMapping').get();
  const mappings: Record<string, string | null> = {};
  for (const d of mapSnap.docs) mappings[d.id] = (d.data() as any).ticker ?? null;

  return { fondosCfg, carteras, posiciones, fechaCorrida, mappings };
}

/** Réplica EXACTA de cargarUltimasCarteras tal como está hoy (patrimonioCafci.ts:64). */
function ultimasCarterasHoy(carteras: Cartera[]): Cartera[] {
  const seen = new Set<string>();
  const out: Cartera[] = [];
  for (const c of carteras.slice(0, 50)) {
    if (!seen.has(c.fondoId)) { seen.add(c.fondoId); out.push(c); }
  }
  return out;
}

async function main() {
  const { calcBenchmark, normalizarEspecie, bloqueDe } = await cargarModuloPuro();
  const db = getDb(target as 'emulator' | 'production');
  const { fondosCfg, carteras, posiciones, fechaCorrida, mappings } = await leerTodo(db);

  const idsCfg = new Set(fondosCfg.map(f => f.fondoId));

  // ── §0.1 — huérfanos ────────────────────────────────────────────────────────
  console.log('\n================ §0.1 — fondoId en cafciCarteras vs. config ================');
  console.log(`config: ${fondosCfg.length} fondos · ${fondosCfg.map(f => `${f.fondoId}/${f.claseId}`).join(' ')}`);
  const porFondo = new Map<string, Cartera[]>();
  for (const c of carteras) porFondo.set(c.fondoId, [...(porFondo.get(c.fondoId) ?? []), c]);
  console.log(`\nfondoId | docs | fechaFetch más reciente | fechaDatos | ¿en config?`);
  const huerfanos: string[] = [];
  for (const [fondoId, docs] of [...porFondo.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const enCfg = idsCfg.has(fondoId);
    if (!enCfg) huerfanos.push(fondoId);
    console.log(`${fondoId.padEnd(7)} | ${String(docs.length).padStart(4)} | ${docs[0].fechaFetch} | ${docs[0].fechaDatos} | ${enCfg ? 'sí' : 'NO — HUÉRFANO'}`);
  }
  console.log(`\nfondoId distintos en cafciCarteras: ${porFondo.size}`);
  console.log(`huérfanos (entran al benchmark sin estar en la config): ${huerfanos.length ? huerfanos.join(', ') : '(ninguno)'}`);
  const cfgSinDatos = fondosCfg.filter(f => !porFondo.has(f.fondoId)).map(f => f.fondoId);
  console.log(`configurados sin ningún documento: ${cfgSinDatos.length ? cfgSinDatos.join(', ') : '(ninguno)'}`);

  // ── §0.2 — el limit(50) ─────────────────────────────────────────────────────
  console.log('\n================ §0.2 — margen del limit(50) ================');
  console.log(`documentos totales en cafciCarteras: ${carteras.length}`);
  const vistos = new Set<string>();
  let idxUltimoNecesario = -1;
  for (let i = 0; i < carteras.length; i++) {
    if (!vistos.has(carteras[i].fondoId)) {
      vistos.add(carteras[i].fondoId);
      idxUltimoNecesario = i;
    }
  }
  console.log(`posición (0-based) del doc que completa los ${vistos.size} fondos: ${idxUltimoNecesario} — el limit es 50, margen ${50 - idxUltimoNecesario - 1} docs`);
  const porFecha = new Map<string, number>();
  for (const c of carteras) porFecha.set(c.fechaDatos, (porFecha.get(c.fechaDatos) ?? 0) + 1);
  console.log(`\ndocs por fechaDatos (una tanda por cartera semanal publicada):`);
  for (const [f, n] of [...porFecha.entries()].sort().reverse()) console.log(`  ${f}: ${n}`);
  const docsPorTanda = Math.max(...porFecha.values());
  console.log(`\nCada cartera nueva agrega hasta ${docsPorTanda} documentos (docId = fondoId_fechaDatos).`);
  console.log(`Un fondo que DEJA de sincronizar (error, 403, timeout) congela su fechaFetch y cae`);
  console.log(`fuera del top-50 después de ~${Math.ceil(50 / docsPorTanda)} carteras nuevas de los demás: desaparece del`);
  console.log(`benchmark en silencio, sin que nada lo reporte.`);
  console.log(`Con ${fondosCfg.length} fondos configurados y una cartera semanal, eso es ~${Math.ceil(50 / docsPorTanda)} semanas.`);

  // ── §0.3 — línea de base ────────────────────────────────────────────────────
  const setActual = ultimasCarterasHoy(carteras);
  console.log('\n================ §0.3 — LÍNEA DE BASE DEL BENCHMARK ================');
  console.log(`corrida vigente: ${fechaCorrida} · posiciones=${posiciones.length} · mappings=${Object.keys(mappings).length}`);
  console.log(`carteras que hoy alimentan el cálculo (cargarUltimasCarteras): ${setActual.length} → ${setActual.map(c => c.fondoId).join(', ')}`);

  const usar = configSimulada
    ? setActual.filter(c => new Set(configSimulada.split(',').map(s => s.split('/')[0])).has(c.fondoId))
    : setActual;
  if (configSimulada) console.log(`CONFIG SIMULADA: ${configSimulada} → ${usar.length} carteras`);

  const r = calcBenchmark(posiciones, usar, mappings);
  console.log(`\nbase: propioUsd=${r.base.propioUsd.toFixed(2)} · propioPctDeCartera=${(r.base.propioPctDeCartera * 100).toFixed(4)}%`);
  console.log(`      fondosEnBase=${r.base.fondosEnBase} · fondosSalteados=${r.base.fondosSalteados} · coberturaProm=${(r.base.fondoCoberturaProm * 100).toFixed(4)}%`);
  console.log(`\nticker   | propioUsd    | propioFrac | fondosAvgFrac | min      | max      | std`);
  for (const f of r.filas) {
    console.log(
      `${f.ticker.padEnd(8)} | ${(f.propioUsd ?? 0).toFixed(2).padStart(12)} | ` +
      `${f.propioFrac === null ? '      null' : f.propioFrac.toFixed(6).padStart(10)} | ` +
      `${f.fondosAvgFrac.toFixed(8).padStart(13)} | ${f.fondosMinFrac.toFixed(6)} | ${f.fondosMaxFrac.toFixed(6)} | ${f.fondosStdFrac.toFixed(6)}`
    );
  }
  console.log(`\nfilas: ${r.filas.length} · soloEnPropio: ${r.soloEnPropio.join(', ')}`);
  console.log(`soloEnFondos (top): ${r.soloenFondos.map((s: any) => `${s.ticker}=${(s.avgFrac * 100).toFixed(2)}%`).join(' · ')}`);

  if (rutaBaseline) {
    const payload = {
      generadoEl: new Date().toISOString(),
      spec: 'F9.142 §0.3',
      fechaCorrida,
      fondosConfig: fondosCfg,
      fondosEnElCalculo: usar.map(c => ({ fondoId: c.fondoId, docId: c.id, fechaDatos: c.fechaDatos, nombre: c.nombre })),
      base: r.base,
      filas: r.filas,
      soloEnPropio: r.soloEnPropio,
      soloenFondos: r.soloenFondos,
    };
    writeFileSync(rutaBaseline, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    console.log(`\nlínea de base escrita en ${rutaBaseline}`);
  }

  // Silencia el "declarado y no usado" sin cambiar el comportamiento: normalizarEspecie y
  // bloqueDe se importan para dejar constancia de que el bundle expone lo mismo que la app.
  void normalizarEspecie; void bloqueDe;
}

main().catch(e => { console.error(e); process.exit(1); });
