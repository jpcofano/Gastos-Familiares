// F9.196 H2a — corre la tabla de clasificación de movimientos de PPI sobre la respuesta REAL de
// `Account/Movements` (3 años) guardada por scripts/explorarPPI.ts en data/ppi-exploracion/ (fuera de
// git; no se commitea ni se copia). Imprime cuántas filas cayeron en cada clase y, si alguna queda
// `para_revisar`, su texto crudo. Tiene que dar 0: si no, se reporta, no se inventa una regla.
// Además lee la respuesta real de BalancesAndPositions con el mismo lector que la sincronización.
// Uso: npx tsx scripts/clasificarPPIMuestras.ts   → exit 1 si algo no cierra.
import * as fs from 'fs';
import * as path from 'path';
import {
  leerMovimientosPPI, movimientosDePPI, contarPorClasePPI, leerPosicionesPPI, FAMILIAS_PPI, clasificarDescripcionPPI,
} from '../src/datos/compartido/clasificacionPPI';

const DIR = path.join(__dirname, '..', 'data', 'ppi-exploracion');
const archivo = (parte: string) => {
  const f = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(x => x.includes(parte)).sort().pop() : undefined;
  return f ? (JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as { body: unknown }).body : null;
};
const enmascarar = (s: string) => s.replace(/\d{5,}/g, '#');

let fallas = 0;
const mov = archivo('movements-1095d');
if (!mov) { console.log('· falta data/ppi-exploracion/*movements-1095d*: corré antes scripts/explorarPPI.ts'); process.exit(1); }
const { filas, monedasDesconocidas } = leerMovimientosPPI(mov);
const fechas = filas.map(f => f.fecha).sort();
console.log(`== Movements · ${filas.length} filas · ${fechas[0]} .. ${fechas[fechas.length - 1]}`);
for (const [c, n] of Object.entries(contarPorClasePPI(filas)).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${c}`);
const revisar = filas.filter(f => f.clase === 'para_revisar');
console.log(`  para_revisar: ${revisar.length}`);
for (const f of revisar) console.log(`    «${enmascarar(f.descripcion)}»`);
if (revisar.length) fallas++;
const usadas = new Set(filas.map(f => clasificarDescripcionPPI(f.descripcion).familia).filter(Boolean));
console.log(`  familias usadas: ${usadas.size} de ${FAMILIAS_PPI.length}${usadas.size < FAMILIAS_PPI.length ? ` (sin uso: ${FAMILIAS_PPI.filter(x => !usadas.has(x.familia)).map(x => x.familia).join(' · ')})` : ''}`);
console.log(`  monedas desconocidas: ${monedasDesconocidas.length ? monedasDesconocidas.join(' · ') : 'ninguna'}`);
if (monedasDesconocidas.length) fallas++;
const movs = movimientosDePPI(filas, 'PPI XXXXX');
const porTipo = movs.reduce<Record<string, number>>((a, m) => ({ ...a, [m.tipo]: (a[m.tipo] ?? 0) + 1 }), {});
const idsUnicos = new Set(movs.map(m => m.id)).size === movs.length;
console.log(`  movimientosCuenta: ${movs.length} ${JSON.stringify(porTipo)} · ids únicos: ${idsUnicos}`);
if (!idsUnicos) fallas++;

const bp = archivo('balances-positions');
if (bp) {
  const l = leerPosicionesPPI(bp, 'PPI XXXXX', () => ({ sector: 'x', pais_riesgo: 'AR' }));
  console.log(`\n== BalancesAndPositions · ${l.posiciones.length} posiciones ${JSON.stringify(l.posiciones.reduce<Record<string, number>>((a, p) => ({ ...a, [p.tipo]: (a[p.tipo] ?? 0) + 1 }), {}))}`);
  console.log(`  caja (INMEDIATA): ARS ${Math.round(l.saldos.ARS)} · USD ${Math.round(l.saldos.USD)} · subcuentas ${Object.keys(l.saldosPorSubcuenta).join(', ')}`);
  console.log(`  costo promedio: ${Object.keys(l.costoPromedio).length} · costo sospechoso (>5× del precio): ${Object.keys(l.costoSospechoso).join(', ') || 'ninguno'}`);
  console.log(`  para revisar: ${l.paraRevisar.length ? l.paraRevisar.map(r => `${r.ticker} (${r.motivo})`).join('; ') : 'ninguna'}`);
  if (l.paraRevisar.length) fallas++;
}
console.log(`\n${fallas ? `${fallas} cosa(s) para reportar` : 'OK — 0 para_revisar'}`);
if (fallas) process.exit(1);
