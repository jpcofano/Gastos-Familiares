import { collection, doc, getDoc, getDocs, query, orderBy, limit, documentId, startAt } from 'firebase/firestore';
import { db } from '../firebase';

export async function tcParaFecha(fecha: Date): Promise<number | null> {
  const dateStr = fecha.toISOString().slice(0, 10);

  const exactSnap = await getDoc(doc(db, 'tcDiario', dateStr));
  if (exactSnap.exists()) return (exactSnap.data().tcUsdArs as number) ?? null;

  // TC más reciente ≤ fecha: desc + startAt(dateStr) evita el where(documentId()) que
  // requería un índice compuesto en Firestore. startAt en desc order incluye dateStr y
  // todos los IDs menores (fechas anteriores), por lo que el primer resultado es el
  // día exacto o el más reciente anterior.
  const snap = await getDocs(
    query(
      collection(db, 'tcDiario'),
      orderBy(documentId(), 'desc'),
      startAt(dateStr),
      limit(1),
    ),
  );
  if (snap.empty) return null;
  const hit = snap.docs[0];
  return hit.id <= dateStr ? ((hit.data().tcUsdArs as number) ?? null) : null;
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
