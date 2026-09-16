// F9.175-pre — CONSULTA. Solo lectura, no escribe nada. Sin commitear.
// Pasada 1: localizar el pago, la obligación de expensas y los destinos del payee, y volcarlos crudos.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { normalizarDestino } from '../functions/src/matchLogica';
import { createHash } from 'node:crypto';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();

const MONTO = 266469;
const cerca = (v: unknown) => typeof v === 'number' && Math.abs(v - MONTO) < 1;
const tieneSigno = (v: unknown) => typeof v === 'string' && /signo/i.test(v);

// Timestamps legibles en el volcado
const plano = (v: unknown): unknown => {
  if (v instanceof Timestamp) return `TS(${v.toDate().toISOString()})`;
  if (Array.isArray(v)) return v.map(plano);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plano(x)]));
  return v;
};
const dump = (titulo: string, o: unknown) => console.log(`\n── ${titulo}\n${JSON.stringify(plano(o), null, 2)}`);

async function main() {
  console.log('F9.175-pre pasada 1 — SOLO LECTURA\n');

  const comps = await db.collection('comprobantes').get();
  const compsHit = comps.docs.filter(d => {
    const x = d.data(); const dt = x.datosExtraidos ?? {};
    return cerca(dt.montoTotal) || JSON.stringify(x).match(/signo/i);
  });
  console.log(`comprobantes totales=${comps.size}, candidatos=${compsHit.length}`);
  for (const d of compsHit) dump(`comprobante ${d.id}`, d.data());

  const movs = await db.collection('movimientos').where('mes', 'in', ['2026-08', '2026-09', '2026-10']).get();
  const movsHit = movs.docs.filter(d => {
    const x = d.data();
    return cerca(x.monto) || tieneSigno(x.descripcion) || tieneSigno(x.destinoNombre)
      || (Array.isArray(x.vencimientos) && x.vencimientos.some((v: { monto?: unknown }) => cerca(v?.monto)));
  });
  console.log(`\nmovimientos 2026-08..10 totales=${movs.size}, candidatos=${movsHit.length}`);
  for (const d of movsHit) dump(`movimiento ${d.id}`, d.data());

  // Destinos: por cada campo de payee de los comprobantes candidatos, el doc que leería matchPorDestino
  const raws = new Set<string>();
  for (const d of compsHit) {
    const dt = d.data().datosExtraidos ?? {};
    for (const k of ['destinoCbu', 'destinoCuit', 'destinoAlias', 'destinoNombre']) if (dt[k]) raws.add(String(dt[k]));
  }
  for (const d of movsHit) {
    const x = d.data();
    for (const k of ['destinoCbu', 'destinoCuit', 'destinoAlias', 'destinoNombre']) if (x[k]) raws.add(String(x[k]));
  }
  console.log('\n── destinos por clave de payee');
  for (const raw of raws) {
    const p = normalizarDestino(raw);
    if (!p) { console.log(`  "${raw}" → normalizarDestino null`); continue; }
    const id = createHash('sha256').update(p.norm).digest('hex').slice(0, 24);
    const s = await db.collection('destinos').doc(id).get();
    console.log(`  "${raw}" → ${p.tipo}:"${p.norm}" id=${id} existe=${s.exists}`);
    if (s.exists) dump(`destino ${id}`, s.data());
  }

  const dests = await db.collection('destinos').get();
  const destHit = dests.docs.filter(d => JSON.stringify(d.data()).match(/signo|consorcio/i));
  console.log(`\ndestinos totales=${dests.size}, que mencionan signo/consorcio=${destHit.length}`);
  for (const d of destHit) dump(`destino (búsqueda texto) ${d.id}`, d.data());
}
main().catch(e => { console.error(e); process.exit(1); });
