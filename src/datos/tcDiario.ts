import { collection, doc, getDoc, getDocs, query, where, orderBy, limit, documentId } from 'firebase/firestore';
import { db } from '../firebase';

export async function tcParaFecha(fecha: Date): Promise<number | null> {
  const dateStr = fecha.toISOString().slice(0, 10);

  const exactSnap = await getDoc(doc(db, 'tcDiario', dateStr));
  if (exactSnap.exists()) return (exactSnap.data().tcUsdArs as number) ?? null;

  // Tomar el TC más reciente anterior a la fecha (mismo comportamiento que tcForDate del seed)
  const snap = await getDocs(
    query(
      collection(db, 'tcDiario'),
      where(documentId(), '<=', dateStr),
      orderBy(documentId(), 'desc'),
      limit(1),
    ),
  );
  return snap.empty ? null : ((snap.docs[0].data().tcUsdArs as number) ?? null);
}
