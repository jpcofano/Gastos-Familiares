// F9.196 Addendum 2 §B (H3c) — corre la clasificación sobre las muestras REALES de
// data/balanz-muestras/ (fuera de git por `data/*`; no se commitean ni se copian). Imprime cuántas
// filas cayeron en cada clase y, si alguna queda `para_revisar`, su texto crudo.
// Tiene que dar 0 `para_revisar`: si da otra cosa se reporta, no se inventa una regla.
// Uso: npx tsx scripts/clasificarBalanzMuestras.ts [corrida.txt]   → exit 1 si algo no cierra.
import * as fs from 'fs';
import * as path from 'path';
import { leerFilasXlsx } from '../src/datos/patrimonioBalanzArchivo';
import {
  parsearMovimientosBalanz, aparearDevoluciones, movimientosDeBalanz, cajaAnclada, contarPorClase,
} from '../src/datos/patrimonioBalanzMovimientos';
import type { CorraidaJSON } from '../src/types/patrimonio';

const DIR = path.join(__dirname, '..', 'data', 'balanz-muestras');
// La comitente de cada muestra la inferió Juan por los tickers (Addendum 2 §B).
const MUESTRAS: Array<[string, string]> = [['movimientos_com402665.xlsx', '402665'], ['movimientos_com1120830.xlsx', '1120830']];
const enmascarar = (s: string) => s.replace(/\d{6,}/g, m => '#'.repeat(Math.min(m.length, 6)));

(async () => {
  const corrida = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as CorraidaJSON : null;
  let fallas = 0;
  for (const [archivo, comitente] of MUESTRAS) {
    const ruta = path.join(DIR, archivo);
    if (!fs.existsSync(ruta)) { console.log(`· falta ${archivo}`); fallas++; continue; }
    const { filas: crudas } = await leerFilasXlsx(fs.readFileSync(ruta));
    const { filas, duplicadas } = parsearMovimientosBalanz(crudas, comitente);
    const conteo = contarPorClase(filas);
    const revisar = filas.filter(f => f.clase === 'para_revisar');
    const dev = aparearDevoluciones(filas);
    const movs = movimientosDeBalanz(filas, comitente, dev.anuladas);
    const fechas = filas.map(f => f.concertacion).sort();
    console.log(`\n== ${archivo} · comitente ${comitente} · ${filas.length} filas (${duplicadas} repetidas descartadas) · ${fechas[0]} .. ${fechas[fechas.length - 1]}`);
    for (const [clase, n] of Object.entries(conteo).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${clase}`);
    console.log(`  para_revisar: ${revisar.length}`);
    for (const f of revisar) console.log(`    fila ${f.fila}: «${enmascarar(f.descripcion)}»`);
    if (revisar.length) fallas++;
    console.log(`  devoluciones: ${dev.pares.length} apareadas con su Comprobante de Pago, ${dev.sinComprobante.length} sin comprobante`);
    for (const p of dev.pares) console.log(`    ${p.devolucion.concertacion} ${p.devolucion.importe} ${p.devolucion.monedaCruda} ↔ comprobante del ${p.comprobante.concertacion} ${p.comprobante.importe}`);
    for (const d of dev.sinComprobante) console.log(`    ✗ sin comprobante: ${d.concertacion} ${d.importe} ${d.monedaCruda}`);
    const porTipo = movs.reduce<Record<string, number>>((a, m) => ({ ...a, [m.tipo]: (a[m.tipo] ?? 0) + 1 }), {});
    console.log(`  movimientosCuenta: ${movs.length} ${JSON.stringify(porTipo)} · ids únicos: ${new Set(movs.map(m => m.id)).size === movs.length}`);
    if (new Set(movs.map(m => m.id)).size !== movs.length) fallas++;

    if (comitente === '402665') {
      const vist = movs.filter(m => m.ticker === 'VIST' && m.fecha === '2026-10-15');
      const okVist = vist.length === 1 && vist[0].tipo === 'venta' && vist[0].cantidad === 250;
      console.log(`  ${okVist ? '✓' : '✗'} venta de 250 VIST del 15/10: ${vist.length} movimiento(s) ${JSON.stringify(vist.map(m => ({ tipo: m.tipo, cantidad: m.cantidad, moneda: m.moneda, monto: m.montoNeto })))}`);
      if (!okVist) fallas++;
      const okDev = dev.pares.length >= 1 && dev.sinComprobante.length === 0
        && !movs.some(m => m.tipo === 'retiro' && dev.pares.some(p => m.nota === p.comprobante.descripcion && m.fecha === p.comprobante.concertacion));
      console.log(`  ${okDev ? '✓' : '✗'} la devolución anula su Comprobante de Pago y no deja retiro`);
      if (!okDev) fallas++;
    }
    if (corrida) {
      const caja = cajaAnclada(filas, { fecha: corrida.meta.fecha_corrida, posiciones: corrida.posiciones }, comitente);
      console.log(`  caja anclada: ${caja.estado === 'ok'
        ? `ancla ${caja.ancla} · ${caja.filasSumadas} filas liquidadas después · saldos ARS ${caja.saldos.ARS} / USD ${caja.saldos.USD} (corrida ARS ${caja.cajaCorrida.ARS} / USD ${caja.cajaCorrida.USD}) · por subcuenta ${JSON.stringify(caja.porSubcuenta)}`
        : `desconocida — ${caja.motivo}`}`);
    }
  }
  console.log(`\n${fallas ? `${fallas} cosa(s) para reportar` : 'OK — 0 para_revisar y los casos de la verificación cierran'}`);
  if (fallas) process.exit(1);
})();
