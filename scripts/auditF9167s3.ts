// F9.167 §3 (gate) — ¿cuántas obligaciones impagas nacieron de una factura y cuántas del calendario?
// Si casi ninguna se pre-crea del calendario, rama 1 casi nunca se usa legitimamente. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

async function main() {
  console.log('F9.167 §3 (gate) — obligaciones impagas: ¿de factura o de calendario? SOLO LECTURA.\n');
  // Obligacion = Gasto con itemEsperadoId, confirmadoPago=false.
  const snap = await db.collection('movimientos').where('confirmadoPago', '==', false).get();
  const oblig = snap.docs.filter(d => d.data().tipo === 'Gasto' && d.data().itemEsperadoId);
  const items = new Map((await db.collection('itemsEsperados').get()).docs.map(d => [d.id, d.data()]));

  let conOrigen = 0, sinOrigen = 0;
  console.log('id                   | mes     | item             | autoCal | origenComprobanteId | monto');
  for (const d of oblig.sort((a, b) => s(a.data().mes).localeCompare(s(b.data().mes)))) {
    const x = d.data();
    const it = items.get(s(x.itemEsperadoId));
    const tieneOrigen = !!x.origenComprobanteId;
    if (tieneOrigen) conOrigen++; else sinOrigen++;
    console.log(`${d.id.slice(0,20).padEnd(20)} | ${s(x.mes)} | ${`${s(it?.categoria)}>${s(it?.subcategoria)}`.slice(0,16).padEnd(16)} | ${String(s(it?.autoCalendario)).padEnd(7)} | ${(tieneOrigen ? 'SÍ' : 'no').padEnd(19)} | ${s(x.monto)}`);
  }
  console.log(`\n  obligaciones impagas con itemEsperadoId: ${oblig.length}`);
  console.log(`    con origenComprobanteId (nacieron de una FACTURA):   ${conOrigen}`);
  console.log(`    sin origenComprobanteId (calendario u otra via):     ${sinOrigen}`);

  // Panorama: TODOS los movimientos con itemEsperadoId, pagados o no.
  const todos = await db.collection('movimientos').where('tipo', '==', 'Gasto').get();
  const conItem = todos.docs.filter(d => d.data().itemEsperadoId);
  const co = conItem.filter(d => d.data().origenComprobanteId).length;
  console.log(`\n  panorama sobre TODOS los Gasto con itemEsperadoId: ${conItem.length}`);
  console.log(`    con origenComprobanteId: ${co} | sin: ${conItem.length - co}`);
  const itemsAuto = [...items.values()].filter(i => i.autoCalendario).length;
  console.log(`  items esperados con autoCalendario=true: ${itemsAuto} de ${items.size}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
