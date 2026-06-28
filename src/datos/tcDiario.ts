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

export interface TCDiarioItem {
  fecha: string;
  tcUsdArs: number;
  origen?: 'dolarapi-bolsa' | 'manual';   // F9.39 — distingue cron (F9.30) de carga manual
}

// F9.26 — Perfil/Tipo de cambio (solo lectura): los N registros más recientes
// de /tcDiario, para mostrar el valor actual + histórico real (reemplaza el
// mock de "por mes" — tcDiario es diario, no mensual).
export async function cargarTCReciente(n = 10): Promise<TCDiarioItem[]> {
  const snap = await getDocs(
    query(collection(db, 'tcDiario'), orderBy(documentId(), 'desc'), limit(n)),
  );
  return snap.docs.map(d => ({
    fecha: d.id,
    tcUsdArs: d.data().tcUsdArs as number,
    origen: d.data().origen as TCDiarioItem['origen'],
  }));
}
