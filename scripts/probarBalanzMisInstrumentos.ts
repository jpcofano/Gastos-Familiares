// F9.196 Addendum 2 §A (H2b) — prueba LOCAL del parser contra las muestras reales de
// data/balanz-muestras/ (fuera de git por `data/*`). No escribe nada ni copia datos: imprime solo
// agregados (especies, tipos, control de Valor actual, filas para revisar).
// Uso: npx tsx scripts/probarBalanzMisInstrumentos.ts [corrida.txt]
//   corrida.txt (opcional): un .txt de corrida para heredar sector y país, como hace la app.
import * as fs from 'fs';
import * as path from 'path';
import {
  detectarArchivoBalanz, parsearNombreBalanz, parsearMisInstrumentos, clasificacionesDe,
  cuentaDeComitente, leerFilasXlsx,
} from '../src/datos/patrimonioBalanzArchivo';
import type { CorraidaJSON } from '../src/types/patrimonio';

const DIR = path.join(__dirname, '..', 'data', 'balanz-muestras');

(async () => {
  const corrida = process.argv[2] ? (JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as CorraidaJSON).posiciones : [];
  let fallas = 0;
  for (const nombre of fs.readdirSync(DIR).filter(f => f.endsWith('.xlsx'))) {
    const { filas } = await leerFilasXlsx(fs.readFileSync(path.join(DIR, nombre)));
    const tipo = detectarArchivoBalanz(filas[0] ?? []);
    const { comitente, exportadoEn } = parsearNombreBalanz(nombre);
    if (tipo !== 'mis_instrumentos') { console.log(`· ${tipo ?? 'no reconocido'} · comitente del nombre: ${comitente ?? '—'} (no es Mis Instrumentos)`); continue; }
    if (!comitente || !exportadoEn) { console.log(`✗ Mis Instrumentos sin comitente/fecha en el nombre → la UI pide la cuenta`); fallas++; continue; }
    const imp = parsearMisInstrumentos(filas, {
      comitente, exportadoEn, clasificaciones: clasificacionesDe([], corrida, cuentaDeComitente(comitente)),
    });
    const porTipo = imp.posiciones.reduce<Record<string, number>>((a, p) => ({ ...a, [p.tipo]: (a[p.tipo] ?? 0) + 1 }), {});
    const maxDif = Math.max(...imp.filas.map(f => f.difRedondeoUsd));
    console.log(`\n✓ Mis Instrumentos · comitente ${comitente} · exportado ${exportadoEn}`);
    console.log(`  ${imp.filas.length} especies · tipos ${JSON.stringify(porTipo)} · total Valor actual U$S ${Math.round(imp.valorUsdBalanz).toLocaleString('es-AR')}`);
    console.log(`  máx |Nominales × Precio − Valor actual| = ${maxDif.toFixed(4)} USD ${maxDif <= 1 ? '(dentro de 1 USD)' : '✗ FUERA DE TOLERANCIA'}`);
    console.log(`  costoPromedio: ${Object.keys(imp.costoPromedio).length} de ${imp.posiciones.length} · tipo desconocido: ${imp.paraRevisar.length ? imp.paraRevisar.map(r => `${r.ticker} (${r.motivo})`).join('; ') : 'ninguno'}`);
    console.log(`  sin sector/país conocido: ${imp.posiciones.filter(p => p.revisar).map(p => p.ticker).join(', ') || 'ninguno'} · avisos: ${imp.avisos.length ? imp.avisos.join(' | ') : 'ninguno'}`);
    if (maxDif > 1 || imp.paraRevisar.length) fallas++;
  }
  if (fallas) process.exit(1);
})();
