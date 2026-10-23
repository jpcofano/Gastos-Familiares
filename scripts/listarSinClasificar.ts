// F9.196 nota de revisión 6 — SOLO LEE. Lista las líneas de `carteraViva/ultima` que en la
// "Composición por sector" caen en "Sin clasificar" (sector vacío o una clave que el mapa de display
// no conoce), con cuenta, ticker, sector crudo y valor en USD. No escribe nada.
//
// Uso (con la service account de los scripts de auditoría):
//   npx tsx scripts/listarSinClasificar.ts
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { sectorDisplay, SIN_CLASIFICAR } from '../src/datos/patrimonioMetricas';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();

type Linea = { cuenta?: string; ticker?: string; tipo?: string | null; sector?: string | null; pais_riesgo?: string | null; valorUsd?: number | null };

async function main() {
  const snap = await db.collection('carteraViva').doc('ultima').get();
  if (!snap.exists) { console.log('No hay carteraViva/ultima.'); return; }
  const d = snap.data() as { lineas?: Linea[]; fechaCorrida?: string; calculadaEnISO?: string };
  const lineas = Array.isArray(d.lineas) ? d.lineas : [];
  // Como la app (posicionesDeCarteraViva): sin tipo o sin valor en USD, la línea no entra a la composición.
  const sin = lineas
    .filter(l => l.tipo && typeof l.valorUsd === 'number')
    .filter(l => sectorDisplay(l.sector ?? '', l.pais_riesgo ?? '') === SIN_CLASIFICAR)
    .sort((a, b) => (b.valorUsd ?? 0) - (a.valorUsd ?? 0));
  console.log(`carteraViva/ultima: carga del ${d.fechaCorrida ?? '—'}, calculada ${d.calculadaEnISO ?? '—'} · ${lineas.length} líneas`);
  if (!sin.length) { console.log('\nOK — ninguna línea cae en "Sin clasificar".'); return; }
  const total = sin.reduce((a, l) => a + (l.valorUsd ?? 0), 0);
  console.log(`\nSin clasificar: ${sin.length} líneas · U$S ${Math.round(total).toLocaleString('es-AR')}`);
  for (const l of sin) {
    console.log(`  ${l.cuenta ?? '—'} · ${l.ticker ?? '—'} (${l.tipo ?? '—'}, ${l.pais_riesgo ?? '—'}) · sector «${l.sector ?? ''}» · U$S ${Math.round(l.valorUsd ?? 0).toLocaleString('es-AR')}`);
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
