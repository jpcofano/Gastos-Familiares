// F9.169 §1 (gate) — todos los movimientos de agua de septiembre 2026, de dónde vino cada uno.
// SOLO LEE. No borra nada.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const t = (v: unknown) => v instanceof Timestamp ? v.toDate().toISOString().slice(0,19).replace('T',' ') : '—';
const AUTO = '1663f6a600ae1fc05e56', CASA = '94c07e7c61d119db6fb5';

async function main() {
  console.log('F9.169 §1 — movimientos de agua, septiembre 2026. SOLO LECTURA.\n');
  const snap = await db.collection('movimientos').where('mes', '==', '2026-09').get();
  const agua = snap.docs.filter(d => [AUTO, CASA].includes(s(d.data().itemEsperadoId)));
  const comps = await db.collection('comprobantes').get();
  const nom = (id: string) => id === AUTO ? 'Auto > Agua' : id === CASA ? 'Casa > Agua' : id;

  console.log('id                   | item        |     monto | descripcion | origenComprobanteId | esAdic | confPago | creadoEn            | actualizadoEn');
  let totAuto = 0, totCasa = 0;
  for (const d of agua.sort((a,b) => (a.data().creadoEn?.toMillis?.() ?? 0) - (b.data().creadoEn?.toMillis?.() ?? 0))) {
    const x = d.data();
    const it = s(x.itemEsperadoId);
    if (it === AUTO) totAuto += Number(x.monto ?? 0); else totCasa += Number(x.monto ?? 0);
    const oc = s(x.origenComprobanteId);
    console.log(`${d.id.slice(0,20).padEnd(20)} | ${nom(it).padEnd(11)} | ${String(s(x.monto)).padStart(9)} | ${s(x.descripcion).slice(0,11).padEnd(11)} | ${(oc === '(ausente)' || oc === 'null' ? '>>> NINGUNO' : oc.slice(0,19)).padEnd(19)} | ${String(s(x.esAdicional)).padEnd(6)} | ${String(s(x.confirmadoPago)).padEnd(8)} | ${t(x.creadoEn)} | ${t(x.actualizadoEn)}`);
    if (oc !== '(ausente)' && oc !== 'null') {
      const c = comps.docs.find(z => z.id === oc);
      const pm = c?.data().propuestaMatch;
      console.log(`     ← comprobante ${oc.slice(0,14)} | monto ${s(c?.data().datosExtraidos?.montoTotal)} | propuesta rama ${s(pm?.rama)} item ${nom(s(pm?.itemEsperadoId))} esAdicional=${s(pm?.esAdicional)} reasignadoAMano=${s(pm?.reasignadoAMano)}`);
    }
  }
  console.log(`\n  obligaciones Auto > Agua en septiembre: ${agua.filter(d => s(d.data().itemEsperadoId) === AUTO).length}  (suman ${totAuto.toFixed(2)})`);
  console.log(`  obligaciones Casa > Agua en septiembre: ${agua.filter(d => s(d.data().itemEsperadoId) === CASA).length}  (suman ${totCasa.toFixed(2)})`);
  console.log(`  TOTAL agua septiembre: ${(totAuto+totCasa).toFixed(2)}  |  las dos boletas suman: ${(51672.34+23301.99).toFixed(2)}`);
  console.log(`  diferencia: ${((totAuto+totCasa) - (51672.34+23301.99)).toFixed(2)}`);

  // ¿hay movimientos de agua en septiembre SIN itemEsperadoId de agua? (por descripcion)
  console.log('\n  movimientos de septiembre con descripcion tipo agua pero OTRO item (o ninguno):');
  let otros = 0;
  for (const d of snap.docs) {
    const x = d.data();
    if ([AUTO, CASA].includes(s(x.itemEsperadoId))) continue;
    if (!/aysa|agua/i.test(s(x.descripcion))) continue;
    otros++;
    console.log(`    ${d.id.slice(0,20)} | ${s(x.descripcion).slice(0,20).padEnd(20)} | ${s(x.monto)} | item=${s(x.itemEsperadoId)} | origen=${s(x.origenComprobanteId).slice(0,14)}`);
  }
  if (otros === 0) console.log('    (ninguno)');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
