import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const iso = (t: unknown) => t instanceof Timestamp ? t.toDate().toISOString() : String(t);
(async () => {
  for (const item of ['90b30edcc0666376321d', 'eb8e59f225ed73b785b6']) {
    const it = await db.collection('itemsEsperados').doc(item).get();
    console.log(`item ${item}: ${it.data()?.categoria} › ${it.data()?.subcategoria} notas=${it.data()?.notas}`);
    const s = await db.collection('movimientos').where('itemEsperadoId', '==', item).where('mes', '==', '2026-09').get();
    for (const d of s.docs) { const x = d.data(); console.log(`  ${d.id} ${x.descripcion} $${x.monto} conf=${x.confirmadoPago} pagadoEn=${iso(x.pagadoEn)} creadoEn=${iso(x.creadoEn)} origen=${String(x.origenComprobanteId).slice(0,8)} hash=${String(x.hashPdf).slice(0,8)}`); }
  }
  const ds = await db.collection('destinos').get();
  for (const d of ds.docs) if (/metrogas|30572975831/i.test(JSON.stringify(d.data()))) console.log('destino', d.id, JSON.stringify({ ...d.data(), actualizadoEn: iso(d.data().actualizadoEn) }));
})();
