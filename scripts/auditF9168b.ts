// F9.168 — la reconstrucción del caso: ¿la reasignación guardó? SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const t = (v: unknown) => v instanceof Timestamp ? v.toDate().toISOString().slice(0,19).replace('T',' ') : '—';
async function main() {
  const mov = await db.collection('movimientos').doc('LNobq8UjkEGyVNB3YSXC').get();
  const m = mov.data()!;
  console.log('=== el movimiento que creó el comprobante de $51.672,34 ===');
  console.log(`  descripcion=${s(m.descripcion)}  monto=${s(m.monto)}  mes=${s(m.mes)}`);
  console.log(`  itemEsperadoId AHORA = ${s(m.itemEsperadoId)}`);
  console.log(`  categoria=${s(m.categoria)} > ${s(m.subcategoria)}`);
  console.log(`  origenComprobanteId  = ${s(m.origenComprobanteId).slice(0,20)}…`);
  console.log(`  confirmadoPago=${s(m.confirmadoPago)}  pagado=${s(m.pagado)}`);
  console.log(`  creadoEn=${t(m.creadoEn)}  actualizadoEn=${t(m.actualizadoEn)}`);
  const dif = (m.actualizadoEn?.toMillis?.() ?? 0) - (m.creadoEn?.toMillis?.() ?? 0);
  console.log(`  → editado ${(dif/1000).toFixed(0)} s después de creado ${dif > 5000 ? '(SÍ se tocó)' : '(no se tocó)'}`);

  console.log('\n=== el destino "aysa" ===');
  const dests = await db.collection('destinos').get();
  for (const d of dests.docs) {
    const x = d.data();
    if (!/aysa|agua/i.test(s(x.destinoNorm))) continue;
    console.log(`  ${d.id.slice(0,14)} | tipo=${s(x.tipo)} | norm="${s(x.destinoNorm)}" | item=${s(x.itemEsperadoId)} | confianza=${s(x.confianza)} | actualizadoEn=${t(x.actualizadoEn)}`);
  }
  console.log('\n=== los dos items, para leer los ids ===');
  for (const id of ['1663f6a600ae1fc05e56','94c07e7c61d119db6fb5']) {
    const i = (await db.collection('itemsEsperados').doc(id).get()).data()!;
    console.log(`  ${id} = ${s(i.categoria)} > ${s(i.subcategoria)}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
