// F9.141 §2 — backfill inicial de preciosDiarios / indicadoresPosicion.
//
// Por defecto corre EN SECO: calcula exactamente lo que escribiría el cron y reporta, sin
// tocar Firestore. Usa el mismo orquestador que `actualizarPreciosDiarios` — no hay una
// segunda implementación de la escritura.
//
//   npx tsx scripts/backfillPreciosF9141.ts --target=production              (seco, reporta)
//   npx tsx scripts/backfillPreciosF9141.ts --target=production --escribir   (puebla)
//
// Serial con pausa de 600 ms: data912 limita a 120 req/min.
import { correrActualizacionPrecios } from '../functions/src/patrimonioPreciosCron';
import { getDb } from './seed/utils/firestore';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
const escribir = process.argv.includes('--escribir');

async function main() {
  const db = getDb(target as 'emulator' | 'production');
  console.log(`[backfill F9.141] target=${target} · modo=${escribir ? 'ESCRIBE' : 'EN SECO'}\n`);

  const r = await correrActualizacionPrecios(db as any, { escribir });

  console.log(`\n=== corrida ${r.fechaCorrida} · ${r.objetivos} objetivos ===`);
  console.log('ticker        cobertura    estadoSerie   puntos  splits  saltos  motivo');
  for (const x of [...r.resultados].sort((a, b) => a.ticker.localeCompare(b.ticker))) {
    console.log(
      `${x.ticker.padEnd(13)} ${x.cobertura.padEnd(12)} ${x.estadoSerie.padEnd(13)} ` +
      `${String(x.puntos).padStart(6)}  ${String(x.splitsAplicados).padStart(6)}  ` +
      `${String(x.saltosPendientes).padStart(6)}  ${x.motivo ?? ''}`,
    );
  }

  const cuenta = (clave: 'cobertura' | 'estadoSerie') => {
    const m: Record<string, number> = {};
    for (const x of r.resultados) m[x[clave]] = (m[x[clave]] ?? 0) + 1;
    return m;
  };
  console.log(`\ncobertura:   ${JSON.stringify(cuenta('cobertura'))}`);
  console.log(`estadoSerie: ${JSON.stringify(cuenta('estadoSerie'))}`);
  console.log(`splits aplicados: ${r.resultados.reduce((a, x) => a + x.splitsAplicados, 0)} · ` +
    `saltos pendientes: ${r.resultados.reduce((a, x) => a + x.saltosPendientes, 0)}`);
  if (r.fallos.length) {
    console.log(`\nfallos (${r.fallos.length}):`);
    for (const f of r.fallos) console.log(`  ${f.ticker}: ${f.error}`);
  }
  if (!escribir) console.log('\nNada escrito. Volver a correr con --escribir para poblar.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
