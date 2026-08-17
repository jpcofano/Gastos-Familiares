// F9.143 §5 — monitor de deriva del universo. AVISA, NO ACTÚA.
//
// Rehace el join y lo compara contra el universo vigente en Firestore: qué fondos entrarían, cuáles
// saldrían, y cuánto se movió el patrimonio de los que ya están. Ese último es el que importa con
// ponderación por patrimonio: un fondo grande que se achica mueve el benchmark aunque no entre ni
// salga nadie.
//
// NO REBALANCEA, y no debe. El rebalanceo es trimestral (construirUniversoCafci.ts). Esto existe
// para que ese recálculo sea una decisión informada en vez de una sorpresa. El script es de SOLO
// LECTURA: no tiene rama de escritura, ni siquiera detrás de un flag.
//
// NO HAY UMBRAL DE AVISO todavía, a propósito (F9.143 §5): no hay base para elegirlo y un umbral
// arbitrario es peor que ninguno. Se define con el primer trimestre de datos. Por eso el script
// imprime magnitudes y no dice "esto está mal".
//
// Uso: npx tsx scripts/monitorDerivaCafci.ts
import { getDb } from './seed/utils/firestore';
import { universoActual, proximoRebalanceo, type FondoUniverso } from './cafciUniverso';

const M = 1e6;

async function main() {
  const db = getDb('production');
  // Sin `orderBy('__name__','desc')`: pide un índice compuesto (medido 17/08). Son dos docs.
  const snap = await db.collection('cafciUniverso').get();
  const doc = snap.docs.sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  if (!doc) {
    console.log('No hay universo vigente. Corré scripts/construirUniversoCafci.ts primero.');
    return;
  }
  const vigenteId = doc.id;
  const vigente = doc.data() as { fondos: FondoUniverso[]; totalPatrimonioArs: number; fechaPlanilla: string };

  const actual = await universoActual();

  console.log(`universo vigente : ${vigenteId} (planilla ${vigente.fechaPlanilla}) — ${vigente.fondos.length} fondos, ARS ${(vigente.totalPatrimonioArs / M).toFixed(0)} M`);
  console.log(`planilla de hoy  : ${actual.fechaPlanilla} — ${actual.fondos.length} fondos, ARS ${(actual.totalPatrimonioArs / M).toFixed(0)} M`);
  console.log(`próximo rebalanceo: ${proximoRebalanceo()}\n`);

  const mapVig = new Map(vigente.fondos.map(f => [f.fondoId, f]));
  const mapAct = new Map(actual.fondos.map(f => [f.fondoId, f]));

  const entran = actual.fondos.filter(f => !mapVig.has(f.fondoId));
  const salen = vigente.fondos.filter(f => !mapAct.has(f.fondoId));

  console.log(`── ENTRARÍAN: ${entran.length}`);
  for (const f of entran) console.log(`   + ${f.fondoId.padStart(5)}  ARS ${(f.patrimonioArs / M).toFixed(0).padStart(7)} M  ${f.nombre}`);
  console.log(`── SALDRÍAN: ${salen.length}`);
  for (const f of salen) console.log(`   − ${f.fondoId.padStart(5)}  ARS ${(f.patrimonioArs / M).toFixed(0).padStart(7)} M  ${f.nombre}`);

  // Deriva de patrimonio de los que ya están. Se mide sobre el peso RELATIVO (que es lo que entra
  // al benchmark), no sobre el monto: en un contexto inflacionario todos los montos suben a la vez
  // y un delta absoluto no distingue "creció" de "hubo inflación".
  const comunes = actual.fondos.filter(f => mapVig.has(f.fondoId));
  const derivas = comunes.map(f => {
    const v = mapVig.get(f.fondoId)!;
    const pesoVig = v.patrimonioArs / vigente.totalPatrimonioArs;
    const pesoAct = f.patrimonioArs / actual.totalPatrimonioArs;
    return { nombre: f.nombre, fondoId: f.fondoId, pesoVig, pesoAct, deltaPp: (pesoAct - pesoVig) * 100 };
  }).sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp));

  console.log(`\n── DERIVA DE PESO de los ${comunes.length} que siguen (top 10 por |Δ|)`);
  console.log('   fondoId   vigente    hoy      Δ pp   nombre');
  for (const d of derivas.slice(0, 10)) {
    console.log(`   ${d.fondoId.padStart(7)}  ${(d.pesoVig * 100).toFixed(2).padStart(6)}%  ${(d.pesoAct * 100).toFixed(2).padStart(6)}%  ${d.deltaPp >= 0 ? '+' : ''}${d.deltaPp.toFixed(2).padStart(6)}   ${d.nombre}`);
  }
  const l1 = derivas.reduce((s, d) => s + Math.abs(d.deltaPp), 0);
  console.log(`\n   deriva total (L1 sobre los comunes): ${l1.toFixed(2)} pp`);
  console.log(`   nuevo peso que traerían los que entran: ${(entran.reduce((s, f) => s + f.patrimonioArs, 0) / actual.totalPatrimonioArs * 100).toFixed(2)}%`);
  console.log('\n(sin umbral de aviso: se define con el primer trimestre de datos — F9.143 §5)');
  console.log('(este script NO rebalancea; el universo se recalcula con construirUniversoCafci.ts)');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
