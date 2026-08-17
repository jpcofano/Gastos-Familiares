// F9.143 §1/§4 — construye el universo del benchmark y lo guarda fechado en `cafciUniverso`.
//
// Se corre el PRIMER DÍA HÁBIL de enero, abril, julio y octubre. Entre rebalanceos el universo no
// cambia aunque la planilla se actualice todos los días: ver `monitorDerivaCafci.ts`, que avisa
// pero no actúa.
//
// Uso:
//   npx tsx scripts/construirUniversoCafci.ts                          (dry-run, no escribe)
//   npx tsx scripts/construirUniversoCafci.ts --apply --i-am-sure      (escribe en producción)
import { getDb } from './seed/utils/firestore';
import { universoActual, proximoRebalanceo } from './cafciUniverso';

const args = process.argv.slice(2);
const apply = args.includes('--apply') && args.includes('--i-am-sure');
const M = 1e6;

// Se conservan el vigente y el anterior. No hace falta serie completa (F9.143 §4) y una colección
// que crece sin tope termina siendo un scan caro por un dato que nadie mira.
const UNIVERSOS_A_CONSERVAR = 2;

async function main() {
  console.log(apply ? '=== ESCRITURA EN PRODUCCIÓN ===' : '=== DRY-RUN (no escribe) — usá --apply --i-am-sure ===\n');

  const u = await universoActual();
  console.log(`planilla : ${u.fechaPlanilla}`);
  console.log(`catálogo : ${u.fechaCatalogo}`);
  console.log(`segmento : ${u.fondos.length} fondos con patrimonio (+${u.fondosSinPatrimonio} en cero)`);
  console.log(`patrimonio total: ARS ${(u.totalPatrimonioArs / M).toFixed(0)} M\n`);

  console.log('  #  fondoId  claseTop  clases   ARS M    %seg  nombre');
  u.fondos.slice(0, 15).forEach((f, i) => {
    console.log(`  ${String(i + 1).padStart(2)}  ${f.fondoId.padStart(7)}  ${f.claseId.padStart(8)}  ${String(f.clases).padStart(6)}  ${(f.patrimonioArs / M).toFixed(0).padStart(6)}  ${(f.patrimonioArs / u.totalPatrimonioArs * 100).toFixed(2).padStart(5)}%  ${f.nombre}`);
  });

  // Testigo del error de identidad de §1: si esto no da la suma de las nueve clases, el join está
  // ponderando por la clase y no por el fondo.
  const srv = u.fondos.find(f => f.fondoId === '51');
  if (srv) {
    console.log(`\nTESTIGO — Superfondo Renta Variable (51): ARS ${(srv.patrimonioArs / M).toFixed(0)} M en ${srv.clases} clases`);
    console.log(`  (si diera ~39.084 M estaría ponderando por la Clase B sola: mal)`);
  }

  const hoy = new Date().toISOString().slice(0, 10);
  console.log(`\nid del documento: cafciUniverso/${hoy}`);
  console.log(`próximo rebalanceo: ${proximoRebalanceo()}`);

  if (!apply) { console.log('\n(dry-run — nada escrito)'); return; }

  const db = getDb('production');
  await db.collection('cafciUniverso').doc(hoy).set({
    fechaPlanilla: u.fechaPlanilla,
    fechaCatalogo: u.fechaCatalogo,
    totalPatrimonioArs: u.totalPatrimonioArs,
    fondos: u.fondos,
    generadoEn: new Date().toISOString(),
  });
  console.log(`\nESCRITO cafciUniverso/${hoy} (${u.fondos.length} fondos)`);

  // MEDIDO el 17/08: `orderBy('__name__', 'desc')` devuelve FAILED_PRECONDITION pidiendo un índice
  // compuesto. El índice automático de Firestore es ascendente sobre `__name__`; el descendente
  // hay que declararlo. Como acá se conservan dos documentos, se lee la colección entera y se
  // ordena en memoria: el id ES la fecha, así que el orden lexicográfico es el cronológico.
  const todos = await db.collection('cafciUniverso').get();
  const ids = todos.docs.map(d => d.id).sort().reverse();
  const sobrantes = ids.slice(UNIVERSOS_A_CONSERVAR).map(id => todos.docs.find(d => d.id === id)!);
  for (const d of sobrantes) {
    await d.ref.delete();
    console.log(`  borrado universo viejo: ${d.id}`);
  }
  console.log(`universos conservados: ${Math.min(ids.length, UNIVERSOS_A_CONSERVAR)}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
