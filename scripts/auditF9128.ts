// F9.128 §0 — Medición previa antes de tocar `bloqueDe`. SOLO LEE.
//
// El punto 3 es el que importa: el resultado ACTUAL de los 8 escenarios, para poder decir cuánto
// movió el fix cada uno en vez de esconderlo dentro de un "ahora está bien". Se corre igual después
// del cambio y se comparan las dos salidas.
//
// Usa el motor REAL (`calcEscenarios`, `bloqueDe`, `ESCENARIOS`, `BETA_DEFAULT`) bundleado desde
// patrimonioRiesgo.ts. Reimplementarlo daría una medición de otra cosa.
//
// Uso (el bundle es temporal, no se commitea):
//   npx esbuild src/datos/patrimonioRiesgo.ts --bundle --format=esm --platform=node \
//     --define:import.meta.env='{}' --outfile=riesgo.bundle.mjs
//   npx tsx scripts/auditF9128.ts --target=production
//   rm riesgo.bundle.mjs

import { getDb } from './seed/utils/firestore';
// @ts-expect-error — bundle generado con esbuild para poder correrlo bajo node
import { bloqueDe, BETA_DEFAULT, ESCENARIOS, calcEscenarios } from '../riesgo.bundle.mjs';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';

async function main() {
  const db = getDb(target as 'emulator' | 'production');

  const snapCorrida = await db.collection('snapshotsPortafolio').orderBy('fechaCorrida', 'desc').limit(1).get();
  const fechaCorrida = snapCorrida.docs[0].data().fechaCorrida as string;
  const snapPos = await db.collection('posicionesPatrimonio').where('fechaCorrida', '==', fechaCorrida).get();
  const posiciones = snapPos.docs.map(d => d.data() as any);

  const snapMan = await db.collection('posicionesManuales').limit(100).get();
  const manuales = snapMan.docs.map(d => d.data() as any);

  console.log(`corrida ${fechaCorrida} · ${posiciones.length} posiciones + ${manuales.length} manuales\n`);

  // ── 1. renta fija AR con su bloque actual
  console.log('=== PUNTO 1 — renta fija AR, bloque ACTUAL (por moneda_origen) ===');
  console.log('  ticker     | tipo | moneda_origen | sector             | bloque actual   | valorUsd');
  const rf = posiciones
    .filter(p => ['bono', 'on'].includes(p.tipo) && p.pais_riesgo === 'AR')
    .sort((a, b) => b.valorUsd - a.valorUsd);
  for (const p of rf) {
    console.log(`  ${String(p.ticker).padEnd(11)}| ${String(p.tipo).padEnd(5)}| ${String(p.moneda_origen).padEnd(14)}| ${String(p.sector ?? '-').padEnd(19)}| ${String(bloqueDe(p)).padEnd(16)}| ${Math.round(p.valorUsd).toLocaleString('es-AR')}`);
  }
  // Los FCI AR entran al mismo camino de bloqueDe, así que se listan aparte para no perderlos.
  const fciAr = posiciones.filter(p => p.tipo === 'fci' && p.pais_riesgo === 'AR').sort((a, b) => b.valorUsd - a.valorUsd);
  console.log('  — FCI AR (misma rama de bloqueDe) —');
  for (const p of fciAr) {
    console.log(`  ${String(p.ticker).padEnd(11)}| ${String(p.tipo).padEnd(5)}| ${String(p.moneda_origen).padEnd(14)}| ${String(p.sector ?? '-').padEnd(19)}| ${String(bloqueDe(p)).padEnd(16)}| ${Math.round(p.valorUsd).toLocaleString('es-AR')}`);
  }

  // ── ONs corporativas: el gate de §2
  console.log('\n=== GATE §2 — ONs corporativas ===');
  const ons = posiciones.filter(p => p.tipo === 'on');
  if (ons.length === 0) {
    console.log('  ninguna: el gate no aplica.');
  } else {
    for (const p of ons) {
      console.log(`  ${p.ticker} · sector=${p.sector} · moneda_origen=${p.moneda_origen} · bloque actual=${bloqueDe(p)} · USD ${Math.round(p.valorUsd).toLocaleString('es-AR')}`);
    }
  }

  // ── 2. betas
  console.log('\n=== PUNTO 2 — BETA_DEFAULT ===');
  for (const [b, v] of Object.entries(BETA_DEFAULT as Record<string, number>)) {
    console.log(`  ${b.padEnd(16)} ${v}`);
  }

  // ── 3. los 8 escenarios, estado actual
  console.log('\n=== PUNTO 3 — escenarios, resultado ACTUAL ===');
  const res = calcEscenarios(posiciones, manuales);
  const total = [...posiciones, ...manuales].reduce((s, p) => s + (p.valorUsd ?? 0), 0);
  console.log(`  invertible total: USD ${Math.round(total).toLocaleString('es-AR')}`);
  console.log(`  ${'id'.padEnd(18)}${'nombre'.padEnd(30)}${'pérdida USD'.padStart(13)}${'% invert.'.padStart(11)}`);
  for (const r of res as any[]) {
    const esc = (ESCENARIOS as any[]).find(e => e.id === r.id) ?? {};
    console.log(`  ${String(r.id).padEnd(18)}${String(esc.nombre ?? '').padEnd(30)}${Math.round(r.perdidaUsd).toLocaleString('es-AR').padStart(13)}${(r.perdidaPct * 100).toFixed(2).padStart(10)}%`);
  }
  console.log(`  (${(res as any[]).length} escenarios)`);

  // ── contexto: reparto por bloque, para el check de "el total AR no se mueve"
  console.log('\n=== Contexto — reparto por bloque (referencia para el after) ===');
  const porBloque = new Map<string, number>();
  for (const p of [...posiciones, ...manuales]) {
    const b = bloqueDe(p);
    porBloque.set(b, (porBloque.get(b) ?? 0) + (p.valorUsd ?? 0));
  }
  let ar = 0;
  for (const [b, usd] of [...porBloque.entries()].sort((a, b) => b[1] - a[1])) {
    if (['accionesAr', 'soberanoAr', 'rentaFijaPesos'].includes(b)) ar += usd;
    console.log(`  ${b.padEnd(16)} USD ${String(Math.round(usd).toLocaleString('es-AR')).padStart(10)} · ${((usd / total) * 100).toFixed(1)}%`);
  }
  console.log(`  exposición AR agregada: ${((ar / total) * 100).toFixed(1)}%  <-- no puede moverse con el fix`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
