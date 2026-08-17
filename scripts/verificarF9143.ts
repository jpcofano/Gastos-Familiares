// F9.143 §6 — verificación. SOLO LEE.
//
// Corre la `calcBenchmark` REAL (bundleada de src/, con el SDK cliente stubeado) contra el
// universo guardado en Firestore, y compara el benchmark ponderado con la línea de base de F9.142.
//
// Uso: npx tsx scripts/verificarF9143.ts
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import { getDb } from './seed/utils/firestore';

const M = 1e6;
const NOMBRES = ['collection','doc','getDoc','getDocs','setDoc','updateDoc','deleteDoc','query','orderBy','where','limit','startAfter','writeBatch','serverTimestamp'];

async function cargarModuloPuro(): Promise<any> {
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
  const out = await esbuild.build({
    stdin: { contents: `export { calcBenchmark, pesosDeUniverso } from './src/datos/patrimonioCafci';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, plugins: [stub], logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}

let fallos = 0;
let pendientes = 0;
const chequear = (nombre: string, ok: boolean, detalle: string) => {
  if (!ok) fallos++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nombre}: ${detalle}`);
};
/**
 * Un chequeo que todavía no se puede correr NO es un chequeo que pasa ni uno que falla.
 * Mientras `cafciCarteras` no tenga los 54 fondos del universo, medir contra el número simulado
 * compara otra cosa (el set viejo ponderado, o sea la variante B) y daría una conclusión falsa
 * en cualquiera de las dos direcciones.
 */
const pendiente = (nombre: string, motivo: string) => {
  pendientes++;
  console.log(`PEND ${nombre}: ${motivo}`);
};
const pct = (x: number) => (x * 100).toFixed(2) + '%';

async function main() {
  const { calcBenchmark, pesosDeUniverso } = await cargarModuloPuro();
  const db = getDb('production');

  // Universo vigente (sin orderBy: pide índice — ver F9.143)
  const uSnap = await db.collection('cafciUniverso').get();
  const uDoc = uSnap.docs.sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  if (!uDoc) { console.error('No hay universo. Corré construirUniversoCafci.ts --apply --i-am-sure'); process.exit(1); }
  const universo = { fecha: uDoc.id, ...(uDoc.data() as any) };

  console.log(`\n=========== §6.1 — UNIVERSO ${universo.fecha} ===========`);
  console.log(`planilla ${universo.fechaPlanilla} · ${universo.fondos.length} fondos · ARS ${(universo.totalPatrimonioArs / M).toFixed(0)} M`);
  const ref = JSON.parse(fs.readFileSync('docs/patrimonio/universo-rv-argentina-20260817.json', 'utf8'));
  chequear('60 fondos', universo.fondos.length === ref.fondos.length, `${universo.fondos.length} vs ${ref.fondos.length} de referencia`);
  const dTot = Math.abs(universo.totalPatrimonioArs - ref.totalPatrimonioArs) / ref.totalPatrimonioArs;
  chequear('patrimonio total', dTot < 0.01, `ARS ${(universo.totalPatrimonioArs / M).toFixed(0)} M vs ${(ref.totalPatrimonioArs / M).toFixed(0)} M (${(dTot * 100).toFixed(3)}%)`);

  // El testigo del error de identidad: patrimonio del FONDO, no de la clase.
  const srv = universo.fondos.find((f: any) => f.fondoId === '51');
  chequear('Superfondo RV pondera con el FONDO, no la Clase B',
    srv && srv.patrimonioArs > 150 * M,
    `ARS ${(srv.patrimonioArs / M).toFixed(0)} M en ${srv.clases} clases (la Clase B sola son ~39.084 M)`);

  console.log('\n--- patrimonio con el que entra cada uno de los 3 más grandes ---');
  for (const f of universo.fondos.slice(0, 3)) {
    console.log(`  ${f.fondoId.padStart(5)}  ARS ${(f.patrimonioArs / M).toFixed(0).padStart(7)} M  ${String(f.clases).padStart(2)} clases  ${f.nombre}`);
  }

  // Posiciones propias + mappings + carteras
  const snapPort = await db.collection('snapshotsPortafolio').orderBy('fechaCorrida', 'desc').limit(1).get();
  const fechaCorrida = (snapPort.docs[0].data() as any).fechaCorrida;
  const posSnap = await db.collection('posicionesPatrimonio').where('fechaCorrida', '==', fechaCorrida).get();
  const manSnap = await db.collection('posicionesManuales').get();
  const manuales = manSnap.docs.map(d => { const m = d.data() as any; return {
    ticker: m.ticker, tipo: m.tipo, sector: m.sector, pais_riesgo: m.pais_riesgo, cuenta: m.cuenta,
    titular: null, moneda_origen: 'USD', valor_origen: m.valorUsd, cantidad: m.cantidad,
    fuente: 'manual', revisar: false, valorUsd: m.valorUsd, tcUsado: null, fechaCorrida: m.fechaValuacion }; });
  const posiciones = [...posSnap.docs.map(d => d.data() as any), ...manuales];
  const mapSnap = await db.collection('cafciMapping').get();
  const mappings: Record<string, string | null> = {};
  for (const d of mapSnap.docs) mappings[d.id] = (d.data() as any).ticker ?? null;

  const cartSnap = await db.collection('cafciCarteras').get();
  const permitidos = new Set(universo.fondos.map((f: any) => f.fondoId));
  const porFondo = new Map<string, any>();
  for (const d of cartSnap.docs) {
    const c = { id: d.id, ...(d.data() as any) };
    if (!permitidos.has(c.fondoId)) continue;
    const prev = porFondo.get(c.fondoId);
    if (!prev || c.fechaFetch > prev.fechaFetch) porFondo.set(c.fondoId, c);
  }
  const carteras = [...porFondo.values()];
  console.log(`\ncarteras disponibles del universo: ${carteras.length}/${universo.fondos.length}`);
  if (carteras.length < universo.fondos.length) {
    console.log('  (los que faltan no sincronizaron todavía — corré "Sincronizar" en Config tras el deploy)');
  }

  console.log('\n=========== §6.2 — BENCHMARK PONDERADO vs LÍNEA DE BASE ===========');
  const pesos = pesosDeUniverso(universo);
  const nuevo = calcBenchmark(posiciones, carteras, mappings, pesos);
  const viejo = calcBenchmark(posiciones, carteras, mappings); // mismo set, equiponderado

  console.log(`base: fondosEnBase=${nuevo.base.fondosEnBase} salteados=${nuevo.base.fondosSalteados} ponderado=${nuevo.base.ponderado} patrimonioBase=ARS ${(nuevo.base.patrimonioBaseArs / M).toFixed(0)} M`);
  chequear('el promedio quedó ponderado', nuevo.base.ponderado === true, `ponderado=${nuevo.base.ponderado}`);
  chequear('patrimonioBaseArs declarado', nuevo.base.patrimonioBaseArs > 0, `ARS ${(nuevo.base.patrimonioBaseArs / M).toFixed(0)} M`);

  const salteadosIds = universo.fondos
    .filter((f: any) => porFondo.has(f.fondoId))
    .filter((f: any) => {
      const r = calcBenchmark(posiciones, [porFondo.get(f.fondoId)], mappings);
      return r.base.fondosSalteados > 0;
    }).map((f: any) => f.fondoId);
  console.log(`salteados por BASE_FONDO_MINIMA: ${salteadosIds.length} → ${salteadosIds.join(', ')}`);
  const esperados = ['1876', '1424', '15', '1877', '1515', '425'];
  const universoCompleto = carteras.length >= universo.fondos.length - 1;
  if (universoCompleto) {
    const mismos = esperados.every(e => salteadosIds.includes(e)) && salteadosIds.length === esperados.length;
    chequear('los 6 salteados son los medidos', mismos, mismos ? esperados.join(', ') : `medidos [${salteadosIds.join(', ')}] vs esperados [${esperados.join(', ')}]`);
  } else {
    const presentes = esperados.filter(e => porFondo.has(e));
    pendiente('los 6 salteados son los medidos',
      `sólo ${presentes.length}/6 tienen cartera cargada (${presentes.join(', ') || 'ninguno'}); los salteados de este set son [${salteadosIds.join(', ')}]`);
  }

  const baseline = JSON.parse(fs.readFileSync('docs/patrimonio/benchmark-baseline-F9142.json', 'utf8'));
  const mapBase = new Map<string, number>((baseline.filas ?? []).map((f: any) => [f.ticker, f.fondosAvgFrac]));
  const mapNuevo = new Map<string, number>(nuevo.filas.map((f: any) => [f.ticker, f.fondosAvgFrac]));
  const mapViejo = new Map<string, number>(viejo.filas.map((f: any) => [f.ticker, f.fondosAvgFrac]));
  const propio = new Map<string, number | null>(nuevo.filas.map((f: any) => [f.ticker, f.propioFrac]));

  const tickers = [...new Set([...mapBase.keys(), ...mapNuevo.keys()])]
    .sort((a, b) => (mapNuevo.get(b) ?? 0) - (mapNuevo.get(a) ?? 0));

  console.log('\nticker    propio   baseF9142  equipond.  PONDERADO  | Δ vs base');
  for (const t of tickers) {
    const bl = mapBase.get(t), eq = mapViejo.get(t) ?? 0, nv = mapNuevo.get(t) ?? 0, pr = propio.get(t);
    if (Math.max(bl ?? 0, nv) < 0.005) continue;
    console.log(
      `${t.padEnd(9)} ${(pr == null ? '   —  ' : pct(pr)).padStart(7)} ${(bl === undefined ? '  —  ' : pct(bl)).padStart(10)} ` +
      `${pct(eq).padStart(10)} ${pct(nv).padStart(10)}  | ${bl === undefined ? '   —' : ((nv - bl) * 100).toFixed(2).padStart(7)}`);
  }

  const l1 = (x: Map<string, number>, y: Map<string, number>) =>
    [...new Set([...x.keys(), ...y.keys()])].reduce((s, t) => s + Math.abs((x.get(t) ?? 0) - (y.get(t) ?? 0)), 0) * 100;
  const l1Base = l1(mapNuevo, mapBase);
  console.log(`\ndistancia L1 ponderado vs línea de base F9.142: ${l1Base.toFixed(2)} pp`);
  console.log(`distancia L1 ponderado vs equiponderado del MISMO set: ${l1(mapNuevo, mapViejo).toFixed(2)} pp`);
  if (universoCompleto) {
    chequear('L1 en el orden de lo simulado (9,08 pp para la variante D)', Math.abs(l1Base - 9.08) < 4, `${l1Base.toFixed(2)} pp`);
  } else {
    pendiente('L1 vs los 9,08 pp simulados',
      `con ${carteras.length}/${universo.fondos.length} carteras esto es la variante B (set viejo, ponderado), no la D. ` +
      `Los 9,08 pp son de la D y no se pueden comparar contra este número.`);
  }

  console.log('\n=========== §6.3 — CONCENTRACIÓN ===========');
  const enBase = universo.fondos.filter((f: any) => porFondo.has(f.fondoId) && !salteadosIds.includes(f.fondoId));
  const masa = enBase.reduce((s: number, f: any) => s + f.patrimonioArs, 0);
  const aportes = enBase.map((f: any) => ({ nombre: f.nombre, share: f.patrimonioArs / masa }))
    .sort((a: any, b: any) => b.share - a.share);
  aportes.slice(0, 5).forEach((a: any, i: number) => console.log(`  ${i + 1}. ${pct(a.share).padStart(7)}  ${a.nombre}`));
  const top3 = aportes.slice(0, 3).reduce((s: number, a: any) => s + a.share, 0);
  console.log(`\nlos tres más grandes: ${pct(top3)} sobre ${enBase.length} fondos en base`);
  if (universoCompleto) {
    chequear('concentración en el orden de lo simulado (27,1%)', Math.abs(top3 - 0.271) < 0.06, `${pct(top3)}`);
    chequear('umbral de consulta al dueño (60%)', top3 < 0.6, `${pct(top3)} < 60%`);
  } else {
    pendiente('concentración vs el 27,1% simulado',
      `${pct(top3)} sobre ${enBase.length} fondos, no sobre 54. Con pocos fondos grandes la concentración ` +
      `es alta por construcción; el 27,1% supone el universo entero.`);
  }

  console.log(`\n${fallos === 0 ? 'sin fallos' : `${fallos} FALLOS`}${pendientes > 0 ? ` · ${pendientes} PENDIENTES de sincronizar el universo` : ''}`);
  if (pendientes > 0) {
    console.log('\nPara cerrarlos: deploy de functions → botón "Sincronizar" en Config (trae las 54 carteras)');
    console.log('→ volver a correr este script. NO poblar cafciCarteras a mano: saltearía el code path');
    console.log('   de sincronizarCafci, que es justo lo que hay que verificar.');
  }
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
