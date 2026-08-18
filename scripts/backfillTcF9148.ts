// F9.148 §4 — backfill de `tcDiario` hacia atrás para cubrir las 750 ruedas de `preciosDiarios`.
//
// Usa el MISMO motor que el callable `backfillTcDiario` (functions/src/tcBackfill.ts): el shift
// de fecha no está reimplementado acá. Existe como script porque el backfill hace falta ANTES de
// que el callable esté desplegado, y sin él la performance en dólares no se puede calcular.
//
// Por defecto NO escribe. Para escribir: `npx tsx scripts/backfillTcF9148.ts --apply`.
import { getDb } from './seed/utils/firestore';
import { backfillTc } from '../functions/src/tcBackfill';

const DESDE = '2023-06-01';   // preciosDiarios arranca el 2023-07-20; margen de mes y medio

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb('production');
  const hasta = new Date().toISOString().slice(0, 10);

  // `sello`: ver OpcionesBackfill — el sentinel de functions/node_modules no lo entiende el
  // cliente de la raíz. Para un backfill, la hora de escritura del proceso alcanza.
  const r = await backfillTc(db, {
    desde: DESDE, hasta, pisarExistentes: false, soloValidar: !apply, sello: new Date(),
  });

  console.log(`rango: ${DESDE} .. ${hasta}   modo: ${apply ? 'ESCRIBE' : 'dry-run (sin escribir)'}`);
  const s = r.solapamiento;
  console.log(`\nsolapamiento contra api[D-1]: ${s.coinciden}/${s.totalComparados} coinciden (<1% de diferencia)`);
  if (s.difieren.length) {
    console.log(`  difieren ${s.difieren.length}:`);
    for (const d of s.difieren.slice(0, 12)) console.log(`    ${d.fecha}  propio=${d.propio}  api=${d.api}  ${d.deltaPct.toFixed(2)}%`);
  }
  if (s.soloPropioSinApi.length) console.log(`  sin contraparte en la API: ${s.soloPropioSinApi.length} (${s.soloPropioSinApi.slice(0, 5).join(', ')}...)`);

  if (r.soloValidar) {
    const p = r.planEscritura!;
    console.log(`\nplan: escribiria ${p.aEscribir} docs, saltaria ${p.saltadosPorExistir} que ya existen, ${p.sinDatoEnApi.length} sin dato en la API`);
    if (p.sinDatoEnApi.length) console.log(`  sin dato: ${p.sinDatoEnApi.slice(0, 10).join(', ')}${p.sinDatoEnApi.length > 10 ? '...' : ''}`);
    console.log('\n(dry-run: no se escribio nada. Correr con --apply para aplicar.)');
  } else {
    console.log(`\nESCRITOS: ${r.escritos}   saltados por existir: ${r.saltadosPorExistir}   sin dato en API: ${r.sinDatoEnApi?.length}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
