// F9.127 §0 — Auditoría previa de la capa de factores. SOLO LEE.
//
// Los cuatro puntos que pide el prompt:
//   1. distribución de `sector` sobre las posiciones de la última corrida (null incluido)
//   2. cada posición de renta variable AR con ticker/tipo/sector/pais_riesgo/valorUsd
//   3. si las PosicionManual traen `sector` y cómo las trata manualToPosicion
//   4. los tickers de renta fija AR con su tipo y moneda, para separar hard-dollar de pesos/CER
//
// Usa el `bloqueDe` REAL, bundleado desde patrimonioRiesgo.ts — no una reimplementación: si el
// script clasificara distinto que la app, la auditoría no probaría nada sobre la app.
//
// Uso (el bundle es un artefacto temporal, no se commitea):
//   npx esbuild src/datos/patrimonioRiesgo.ts --bundle --format=esm --platform=node \
//     --define:import.meta.env='{}' --outfile=riesgo.bundle.mjs
//   npx tsx scripts/auditF9127.ts --target=production
//   rm riesgo.bundle.mjs

import { getDb } from './seed/utils/firestore';
// @ts-expect-error — bundle generado con esbuild para poder correrlo bajo node
import { bloqueDe } from '../riesgo.bundle.mjs';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';

async function main() {
  const db = getDb(target as 'emulator' | 'production');

  const snapCorrida = await db.collection('snapshotsPortafolio').orderBy('fechaCorrida', 'desc').limit(1).get();
  const fechaCorrida = snapCorrida.docs[0].data().fechaCorrida as string;
  const snapPos = await db.collection('posicionesPatrimonio').where('fechaCorrida', '==', fechaCorrida).get();
  const posiciones = snapPos.docs.map(d => d.data() as any);
  console.log(`corrida ${fechaCorrida} · ${posiciones.length} posiciones\n`);

  // ── 1. distribución de sector
  console.log('=== PUNTO 1 — distribución de `sector` ===');
  const porSector = new Map<string, { n: number; usd: number }>();
  for (const p of posiciones) {
    const k = p.sector === null ? '(null)' : p.sector === undefined ? '(undefined)' : p.sector === '' ? '(cadena vacía)' : String(p.sector);
    const cur = porSector.get(k) ?? { n: 0, usd: 0 };
    porSector.set(k, { n: cur.n + 1, usd: cur.usd + (p.valorUsd ?? 0) });
  }
  for (const [k, v] of [...porSector.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${k.padEnd(24)} ${String(v.n).padStart(3)} pos · USD ${Math.round(v.usd).toLocaleString('es-AR')}`);
  }

  // ── 2. renta variable AR
  console.log('\n=== PUNTO 2 — renta variable AR (bloqueDe === accionesAr) ===');
  console.log('  ticker | tipo | sector | pais_riesgo | valorUsd');
  const rvAr = posiciones.filter(p => bloqueDe(p) === 'accionesAr').sort((a, b) => b.valorUsd - a.valorUsd);
  for (const p of rvAr) {
    console.log(`  ${String(p.ticker).padEnd(7)}| ${String(p.tipo).padEnd(7)}| ${String(p.sector ?? '(null)').padEnd(22)}| ${String(p.pais_riesgo).padEnd(7)}| ${Math.round(p.valorUsd).toLocaleString('es-AR')}`);
  }
  const totalRv = rvAr.reduce((s, p) => s + p.valorUsd, 0);
  console.log(`  ${rvAr.length} posiciones · USD ${Math.round(totalRv).toLocaleString('es-AR')}`);

  // ── 3. posiciones manuales
  console.log('\n=== PUNTO 3 — PosicionManual ===');
  const snapMan = await db.collection('posicionesManuales').limit(100).get();
  console.log(`  ${snapMan.size} docs`);
  for (const d of snapMan.docs) {
    const m = d.data() as any;
    const campos = Object.keys(m).sort().join(', ');
    console.log(`  ${m.ticker}: sector=${m.sector === undefined ? '(campo AUSENTE)' : JSON.stringify(m.sector)} · tipo=${m.tipo} · pais_riesgo=${m.pais_riesgo} · valorUsd=${m.valorUsd}`);
    console.log(`    campos presentes: ${campos}`);
  }

  // ── 4. renta fija AR
  console.log('\n=== PUNTO 4 — renta fija AR (bono/on/fci con pais_riesgo AR) ===');
  console.log('  ticker | tipo | moneda_origen | bloque | valorUsd');
  const rf = posiciones
    .filter(p => ['bono', 'on', 'fci'].includes(p.tipo) && p.pais_riesgo === 'AR')
    .sort((a, b) => b.valorUsd - a.valorUsd);
  for (const p of rf) {
    console.log(`  ${String(p.ticker).padEnd(10)}| ${String(p.tipo).padEnd(5)}| ${String(p.moneda_origen).padEnd(6)}| ${String(bloqueDe(p)).padEnd(15)}| ${Math.round(p.valorUsd).toLocaleString('es-AR')}`);
  }

  // ── contexto: reparto por bloque, para dimensionar
  console.log('\n=== Contexto — reparto por bloque ===');
  const porBloque = new Map<string, number>();
  let total = 0;
  for (const p of posiciones) {
    const b = bloqueDe(p);
    porBloque.set(b, (porBloque.get(b) ?? 0) + (p.valorUsd ?? 0));
    total += p.valorUsd ?? 0;
  }
  for (const [b, usd] of [...porBloque.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${b.padEnd(16)} USD ${String(Math.round(usd).toLocaleString('es-AR')).padStart(10)} · ${((usd / total) * 100).toFixed(1)}%`);
  }
  console.log(`  ${'TOTAL'.padEnd(16)} USD ${Math.round(total).toLocaleString('es-AR')}`);

  // ── tipos presentes, por si hay alguno no contemplado
  console.log('\n=== Contexto — valores de `tipo` presentes ===');
  const porTipo = new Map<string, number>();
  for (const p of posiciones) porTipo.set(String(p.tipo), (porTipo.get(String(p.tipo)) ?? 0) + 1);
  for (const [t, n] of [...porTipo.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(10)} ${n}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
