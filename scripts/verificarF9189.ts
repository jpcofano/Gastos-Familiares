// F9.189 §0 — medición. SOLO LECTURA (Admin SDK).
//
//   npx tsx scripts/verificarF9189.ts
//
// 0.1 corridas duplicadas: por cada snapshotsPortafolio, posicionesPatrimonio con esa fechaCorrida
//     (cantidad y suma de valorUsd) contra cantidadPosiciones / totalCorridaUsd del snapshot.
// 0.2 corrida del 2026-10-13: existe, cuántas posiciones, cuántas con revisar: true.
// V4  BCMMUSDA: bloque y factor antes/después de `money_market_usd`, y delta en los escenarios de
//     estrés sobre la corrida vigente (deduplicada si 0.1 la encontró duplicada).
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { bloqueDe, factorDe, calcEscenarios, violacionesBandas, RIESGO_DEFAULTS } from '../src/datos/patrimonioRiesgo';
import type { Posicion, PosicionManual } from '../src/types/patrimonio';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const usd = (n: number) => `U$S ${Math.round(n).toLocaleString('es-AR')}`;

async function main() {
  // ── 0.1 ──
  console.log('── 0.1 Corridas duplicadas ──');
  const snaps = await db.collection('snapshotsPortafolio').orderBy('fechaCorrida').get();
  const pos = await db.collection('posicionesPatrimonio').get();
  const porFecha = new Map<string, Posicion[]>();
  for (const d of pos.docs) {
    const p = d.data() as Posicion;
    const arr = porFecha.get(p.fechaCorrida) ?? [];
    arr.push(p);
    porFecha.set(p.fechaCorrida, arr);
  }
  const malas: string[] = [];
  for (const s of snaps.docs) {
    const d = s.data();
    const f = d.fechaCorrida as string;
    const arr = porFecha.get(f) ?? [];
    const suma = arr.reduce((t, p) => t + (p.valorUsd ?? 0), 0);
    const espN = d.cantidadPosiciones as number;
    const espUsd = (d.totalCorridaUsd ?? d.totalInvertibleUsd) as number;
    const ok = arr.length === espN && Math.abs(suma - espUsd) < 1;
    console.log(`${ok ? 'OK ' : 'MAL'} ${f}  esperado ${espN} pos / ${usd(espUsd)}  ·  encontrado ${arr.length} pos / ${usd(suma)}`);
    if (!ok) malas.push(f);
  }
  const huerfanas = [...porFecha.keys()].filter(f => !snaps.docs.some(s => s.data().fechaCorrida === f));
  console.log(`Fechas que no cuadran: ${malas.length ? malas.join(', ') : 'ninguna'}`);
  console.log(`Posiciones sin snapshot (fechas): ${huerfanas.length ? huerfanas.join(', ') : 'ninguna'}`);

  // ── 0.2 ──
  console.log('\n── 0.2 Corrida 2026-10-13 ──');
  const f13 = porFecha.get('2026-10-13') ?? [];
  const snap13 = snaps.docs.find(s => s.id === '2026-10-13');
  console.log(`Snapshot: ${snap13 ? 'existe' : 'NO existe'} · posiciones: ${f13.length} · revisar: ${f13.filter(p => p.revisar).length}`);
  for (const p of f13.filter(p => p.revisar)) console.log(`   ${p.ticker.padEnd(10)} ${p.cuenta}  titular=${p.titular ?? 'null'}`);

  // ── V4 ──
  console.log('\n── V4 BCMMUSDA en el modelo de riesgo ──');
  const vigente = snaps.docs[snaps.docs.length - 1]?.data().fechaCorrida as string | undefined;
  if (!vigente) { console.log('Sin corridas.'); return; }
  // Dedup por contenido para medir sobre la corrida real si está duplicada.
  const vistos = new Set<string>();
  const corrida = (porFecha.get(vigente) ?? []).filter(p => {
    const k = JSON.stringify([p.cuenta, p.ticker, p.moneda_origen, p.valor_origen, p.cantidad, p.tipo]);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  console.log(`Corrida vigente ${vigente}: ${porFecha.get(vigente)?.length ?? 0} docs, ${corrida.length} tras dedup`);
  const manuales = (await db.collection('posicionesManuales').get()).docs.map(d => ({ id: d.id, ...d.data() }) as PosicionManual);

  const bcm = corrida.filter(p => p.ticker === 'BCMMUSDA');
  if (bcm.length === 0) {
    console.log('BCMMUSDA no está en la corrida vigente; se mide con una fila sintética.');
  }
  for (const p of bcm) console.log(`   guardado: tipo=${p.tipo} sector=${p.sector} pais=${p.pais_riesgo} ${usd(p.valorUsd)}`);

  const conSector = (sector: string) => corrida.map(p => (p.ticker === 'BCMMUSDA' ? { ...p, sector, tipo: 'fci' as const, pais_riesgo: 'AR' as const } : p));
  const antes = conSector('__sin_sector__');   // sector desconocido: el comportamiento previo
  const despues = conSector('money_market_usd');
  const muestra = (arr: Posicion[]) => arr.find(p => p.ticker === 'BCMMUSDA');
  const a = muestra(antes), d = muestra(despues);
  if (a && d) {
    console.log(`bloqueDe: antes ${bloqueDe(a)} → después ${bloqueDe(d)}`);
    console.log(`factorDe: antes ${factorDe(a).factor} → después ${factorDe(d).factor}`);
  }

  const ea = calcEscenarios(antes, manuales);
  const ed = calcEscenarios(despues, manuales);
  console.log('\nEscenario                                   antes          después        Δ');
  for (let i = 0; i < ea.length; i++) {
    const x = ea[i], y = ed[i];
    const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
    console.log(`${x.nombre.slice(0, 42).padEnd(42)}  ${pct(x.perdidaPct).padStart(7)} ${usd(x.perdidaUsd).padStart(12)}  ${pct(y.perdidaPct).padStart(7)} ${usd(y.perdidaUsd).padStart(12)}  ${usd(y.perdidaUsd - x.perdidaUsd)}`);
  }
  const caja = (arr: Posicion[]) => violacionesBandas(arr, manuales, RIESGO_DEFAULTS).find(v => v.tipo === 'caja');
  const total = (arr: Posicion[]) => arr.reduce((s, p) => s + p.valorUsd, 0) + manuales.reduce((s, m) => s + m.valorUsd, 0);
  console.log(`\nPiso de caja (por bloque): antes ${caja(antes) ? `violado, caja ${(caja(antes)!.actual * 100).toFixed(2)}%` : 'cumple'} · después ${caja(despues) ? `violado, caja ${(caja(despues)!.actual * 100).toFixed(2)}%` : 'cumple'} · total ${usd(total(despues))}`);
}

main().catch(e => { console.error(e); process.exit(1); });
