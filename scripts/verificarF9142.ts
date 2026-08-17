// F9.142 §1 — verificación del filtro por config. SOLO LEE.
//
//   A. formato de los docId de cafciCarteras (`${fondoId}_${fechaDatos}`), que es lo que
//      habilita la consulta por rango de documentId sin índice compuesto
//   B. la selección nueva (última cartera por fondo CONFIGURADO, por docId desc) devuelve
//      exactamente los mismos documentos que la vieja (orderBy fechaFetch desc + limit 50)
//   C. el benchmark recalculado es idéntico, campo por campo, a la línea de base del §0.3
//
// Uso:
//   npx tsx scripts/verificarF9142.ts --target=production --baseline=docs/patrimonio/benchmark-baseline-F9142.json

import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import { getDb } from './seed/utils/firestore';

const args = process.argv.slice(2);
const target = args.includes('--target=production') ? 'production' : 'emulator';
const rutaBaseline = args.find(a => a.startsWith('--baseline='))!.replace('--baseline=', '');
const configNueva = args.find(a => a.startsWith('--config='))?.replace('--config=', '');

const casos: Array<{ nombre: string; ok: boolean; detalle: string }> = [];
const chequear = (nombre: string, ok: boolean, detalle: string) => casos.push({ nombre, ok, detalle });

async function moduloPuro(): Promise<any> {
  const NOMBRES = ['collection', 'doc', 'getDoc', 'getDocs', 'setDoc', 'updateDoc', 'deleteDoc',
    'query', 'orderBy', 'where', 'limit', 'writeBatch', 'serverTimestamp', 'documentId', 'startAfter'];
  const stub = {
    name: 'stub-firebase',
    setup(build: esbuild.PluginBuild) {
      build.onResolve({ filter: /^firebase\/|\/firebase$/ }, a => ({ path: a.path, namespace: 'stub' }));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: ['const nope = () => { throw new Error("stub"); };',
          'export const db = {}; export const functions = {}; export const httpsCallable = nope;',
          ...NOMBRES.map(n => `export const ${n} = nope;`)].join('\n'),
        loader: 'js' as const,
      }));
    },
  };
  const out = await esbuild.build({
    stdin: {
      contents: `export { calcBenchmark } from './src/datos/patrimonioCafci';`,
      resolveDir: process.cwd(), loader: 'ts',
    },
    bundle: true, format: 'esm', platform: 'node', write: false, plugins: [stub], logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}

async function main() {
  const { calcBenchmark } = await moduloPuro();
  const db = getDb(target as 'emulator' | 'production');
  const baseline = JSON.parse(readFileSync(rutaBaseline, 'utf8'));

  const cfgSnap = await db.collection('configPatrimonio').doc('cafci').get();
  const fondosCfg: Array<{ fondoId: string; claseId: string; nombre: string }> =
    (cfgSnap.data() as any)?.fondos ?? [];
  const fondos = configNueva
    ? configNueva.split(',').map(p => ({ fondoId: p.split('/')[0], claseId: p.split('/')[1] ?? '', nombre: p }))
    : fondosCfg;

  // La identidad contra la línea de base solo es exigible si se está corriendo con LA MISMA
  // config con la que se tomó la base. Ése era el punto del §1 —el filtro no cambia el número—
  // y se verificó con los 13 fondos originales. Con la config corregida del §2 el número TIENE
  // que moverse: pedir identidad ahí convertiría el chequeo en un falso rojo permanente.
  const claveCfg = (f: { fondoId: string; claseId: string }) => `${f.fondoId}/${f.claseId}`;
  const mismaConfigQueLaBase =
    JSON.stringify(fondos.map(claveCfg).sort()) ===
    JSON.stringify((baseline.fondosConfig ?? []).map(claveCfg).sort());
  console.log(mismaConfigQueLaBase
    ? '\nconfig == la de la línea de base → se exige identidad bit a bit'
    : '\nconfig != la de la línea de base → se reporta el delta, no se exige identidad');

  const snap = await db.collection('cafciCarteras').orderBy('fechaFetch', 'desc').get();
  const todos = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  // ── A. formato de docId ─────────────────────────────────────────────────────
  const malFormados = todos.filter(c => c.id !== `${c.fondoId}_${c.fechaDatos}`);
  chequear('docId == `${fondoId}_${fechaDatos}` en los 29 documentos',
    malFormados.length === 0,
    malFormados.length === 0
      ? `${todos.length}/${todos.length} ✓ — la consulta por rango de documentId es válida`
      : malFormados.map(c => `${c.id} (fondoId=${c.fondoId}, fechaDatos=${c.fechaDatos})`).join(' · '));

  const fechasRaras = todos.filter(c => !/^\d{4}-\d{2}-\d{2}$/.test(c.fechaDatos ?? ''));
  chequear('fechaDatos en YYYY-MM-DD (orden lexicográfico == cronológico)',
    fechasRaras.length === 0,
    fechasRaras.length === 0 ? `${todos.length}/${todos.length} ✓` : fechasRaras.map(c => c.id).join(' · '));

  // Un fondoId no puede ser prefijo de otro seguido de dígitos y romper el rango: se verifica
  // que el rango [`${id}_`, `${id}\``) no capture documentos de otro fondo.
  const colisiones: string[] = [];
  for (const f of fondos) {
    const dentro = todos.filter(c => c.id >= `${f.fondoId}_` && c.id < `${f.fondoId}\``);
    const ajenos = dentro.filter(c => c.fondoId !== f.fondoId);
    if (ajenos.length > 0) colisiones.push(`${f.fondoId} captura ${ajenos.map(c => c.id).join(',')}`);
  }
  chequear('el rango de documentId por fondo no captura documentos de otro fondo',
    colisiones.length === 0, colisiones.length === 0 ? `${fondos.length} fondos ✓` : colisiones.join(' · '));

  // ── B. selección vieja vs. nueva ────────────────────────────────────────────
  const seen = new Set<string>();
  const vieja: any[] = [];
  for (const c of todos.slice(0, 50)) {
    if (!seen.has(c.fondoId)) { seen.add(c.fondoId); vieja.push(c); }
  }

  // La nueva: mismo orden que la vieja (fechaFetch desc) pero filtrando por la config y
  // paginando hasta cubrir todos los fondos configurados, en vez de cortar en 50 a ciegas.
  const PAGINA = 50, MAX_PAGINAS = 4;
  const idsCfg = new Set(fondos.map(f => f.fondoId));
  const nueva: any[] = [];
  const vistosNueva = new Set<string>();
  let paginasUsadas = 0;
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const pagina = todos.slice(p * PAGINA, (p + 1) * PAGINA);
    if (pagina.length === 0) break;
    paginasUsadas = p + 1;
    for (const c of pagina) {
      if (!idsCfg.has(c.fondoId) || vistosNueva.has(c.fondoId)) continue;
      vistosNueva.add(c.fondoId);
      nueva.push(c);
    }
    if (vistosNueva.size === idsCfg.size) break;
  }
  const faltantes = [...idsCfg].filter(id => !vistosNueva.has(id));
  chequear('la paginación cubre todos los fondos configurados',
    faltantes.length === 0,
    faltantes.length === 0 ? `${vistosNueva.size}/${idsCfg.size} fondos en ${paginasUsadas} página(s) ✓`
      : `sin cartera: ${faltantes.join(', ')}`);

  const idsVieja = vieja.map(c => c.id).sort();
  const idsNueva = nueva.map(c => c.id).sort();
  const mismos = JSON.stringify(idsVieja) === JSON.stringify(idsNueva);
  chequear('selección nueva (config + paginado) == selección vieja (fechaFetch desc + limit 50)',
    mismos || !mismaConfigQueLaBase,
    mismos ? `${idsNueva.length} documentos idénticos ✓`
      : `${idsVieja.length} → ${idsNueva.length} documentos (esperado: la config cambió) · fuera: ${idsVieja.filter(i => !idsNueva.includes(i)).join(', ') || '—'}`);
  console.log(`\nselección vieja (${idsVieja.length}): ${idsVieja.join(', ')}`);
  console.log(`selección nueva (${idsNueva.length}): ${idsNueva.join(', ')}`);
  console.log(`lecturas: vieja = ${Math.min(50, todos.length)} docs en 1 query · nueva = ${Math.min(PAGINA * paginasUsadas, todos.length)} docs en ${paginasUsadas} query(s)\n`);

  // ── C. benchmark idéntico ───────────────────────────────────────────────────
  const snapPort = await db.collection('snapshotsPortafolio').orderBy('fechaCorrida', 'desc').limit(1).get();
  const fechaCorrida = (snapPort.docs[0].data() as any).fechaCorrida;
  const posSnap = await db.collection('posicionesPatrimonio').where('fechaCorrida', '==', fechaCorrida).get();
  const manSnap = await db.collection('posicionesManuales').get();
  const posiciones = [
    ...posSnap.docs.map(d => d.data() as any),
    ...manSnap.docs.map(d => {
      const m = d.data() as any;
      return { ticker: m.ticker, tipo: m.tipo, sector: m.sector, pais_riesgo: m.pais_riesgo,
        cuenta: m.cuenta, titular: null, moneda_origen: 'USD', valor_origen: m.valorUsd,
        cantidad: m.cantidad, fuente: 'manual', revisar: false, valorUsd: m.valorUsd,
        tcUsado: null, fechaCorrida: m.fechaValuacion };
    }),
  ];
  const mapSnap = await db.collection('cafciMapping').get();
  const mappings: Record<string, string | null> = {};
  for (const d of mapSnap.docs) mappings[d.id] = (d.data() as any).ticker ?? null;

  chequear('la corrida vigente sigue siendo la de la línea de base',
    fechaCorrida === baseline.fechaCorrida, `baseline=${baseline.fechaCorrida} ahora=${fechaCorrida}`);

  const r = calcBenchmark(posiciones, nueva, mappings);
  const porTicker = new Map<string, any>(r.filas.map((f: any) => [f.ticker, f]));
  const difs: string[] = [];
  for (const b of baseline.filas) {
    const a = porTicker.get(b.ticker);
    if (!a) { difs.push(`${b.ticker}: falta en el nuevo`); continue; }
    for (const k of ['propioUsd', 'propioFrac', 'fondosAvgFrac', 'fondosMinFrac', 'fondosMaxFrac', 'fondosStdFrac'] as const) {
      if (a[k] !== b[k]) difs.push(`${b.ticker}.${k}: ${b[k]} → ${a[k]}`);
    }
  }
  for (const a of r.filas) if (!baseline.filas.some((b: any) => b.ticker === a.ticker)) difs.push(`${a.ticker}: nuevo, no estaba en la base`);
  for (const k of ['propioUsd', 'propioPctDeCartera', 'fondoCoberturaProm', 'excluidoFondoProm', 'fondosEnBase', 'fondosSalteados'] as const) {
    if (r.base[k] !== baseline.base[k]) difs.push(`base.${k}: ${baseline.base[k]} → ${r.base[k]}`);
  }
  chequear('benchmark recalculado == línea de base (bit a bit, 22 filas + base)',
    difs.length === 0 || !mismaConfigQueLaBase,
    difs.length === 0 ? `${r.filas.length} filas idénticas ✓`
      : `${difs.length} diferencias — esperadas, la config cambió (ver el delta arriba)`);

  if (!mismaConfigQueLaBase) {
    console.log('=== DELTA contra la línea de base (config nueva) ===');
    console.log('ticker   | propio  | bench base | bench nuevo | delta pp');
    const pct = (x: number) => (x * 100).toFixed(2).padStart(6) + '%';
    const filas = [...r.filas].sort((a: any, b: any) => {
      const da = Math.abs(a.fondosAvgFrac - (baseline.filas.find((x: any) => x.ticker === a.ticker)?.fondosAvgFrac ?? 0));
      const db2 = Math.abs(b.fondosAvgFrac - (baseline.filas.find((x: any) => x.ticker === b.ticker)?.fondosAvgFrac ?? 0));
      return db2 - da;
    });
    let maxD = 0;
    for (const f of filas) {
      const b = baseline.filas.find((x: any) => x.ticker === f.ticker);
      const prev = b?.fondosAvgFrac ?? 0;
      const d = (f.fondosAvgFrac - prev) * 100;
      if (Math.abs(d) > Math.abs(maxD)) maxD = d;
      console.log(`${f.ticker.padEnd(8)} | ${f.propioFrac === null ? '     — ' : pct(f.propioFrac)} | ${pct(prev)} | ${pct(f.fondosAvgFrac)} | ${d >= 0 ? '+' : ''}${d.toFixed(2)}`);
    }
    console.log(`\ndelta máximo: ${maxD >= 0 ? '+' : ''}${maxD.toFixed(2)} pp`);
    console.log(`fondosEnBase: ${baseline.base.fondosEnBase} → ${r.base.fondosEnBase} · salteados: ${baseline.base.fondosSalteados} → ${r.base.fondosSalteados}`);
    console.log(`coberturaProm: ${(baseline.base.fondoCoberturaProm * 100).toFixed(2)}% → ${(r.base.fondoCoberturaProm * 100).toFixed(2)}%\n`);
  }

  let fallas = 0;
  for (const c of casos) {
    if (!c.ok) fallas++;
    console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.nombre} — ${c.detalle}`);
  }
  console.log(`\n${casos.length - fallas}/${casos.length} verificaciones OK`);
  if (fallas > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
