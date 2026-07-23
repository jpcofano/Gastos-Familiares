import { collection, doc, getDoc, getDocs, query, orderBy, limit, documentId, startAt } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { claveSemanaISO } from './patrimonioOptimizacion';

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
  // F9.39 distingue cron (F9.30) de carga manual; F9.103 suma el origen del backfill.
  origen?: 'dolarapi-bolsa' | 'manual' | 'argentinadatos-bolsa-backfill';
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

// F9.103 — estado de cobertura para la card "Tipo de cambio" en Patrimonio › Config.
export interface EstadoTcDiario {
  fechaMin: string | null;
  fechaMax: string | null;
  cantidadDias: number;
  semanasISO: number;
  huecos: string[]; // fechas de calendario faltantes dentro de [fechaMin, fechaMax]
}

export async function cargarEstadoTcDiario(): Promise<EstadoTcDiario> {
  const snap = await getDocs(collection(db, 'tcDiario'));
  const fechas = snap.docs.map(d => d.id).sort();
  if (fechas.length === 0) {
    return { fechaMin: null, fechaMax: null, cantidadDias: 0, semanasISO: 0, huecos: [] };
  }
  const fechaMin = fechas[0];
  const fechaMax = fechas[fechas.length - 1];
  const presentes = new Set(fechas);
  const huecos: string[] = [];
  const cursor = new Date(fechaMin + 'T00:00:00Z');
  const ultimo = new Date(fechaMax + 'T00:00:00Z');
  while (cursor <= ultimo) {
    const iso = cursor.toISOString().slice(0, 10);
    if (!presentes.has(iso)) huecos.push(iso);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const semanasISO = new Set(fechas.map(claveSemanaISO)).size;
  return { fechaMin, fechaMax, cantidadDias: fechas.length, semanasISO, huecos };
}

// F9.103 — backfill de tcDiario desde ArgentinaDatos (ver comentario del shift +1 en la CF,
// functions/src/index.ts). soloValidar:true corre el chequeo de solapamiento sin escribir.
export interface SolapamientoTc {
  coinciden: number;
  totalComparados: number;
  difieren: Array<{ fecha: string; propio: number; api: number; deltaAbs: number; deltaPct: number }>;
  soloPropioSinApi: string[];
}

export interface ResultadoBackfillTc {
  soloValidar: boolean;
  solapamiento: SolapamientoTc;
  planEscritura?: { aEscribir: number; saltadosPorExistir: number; sinDatoEnApi: string[] };
  escritos?: number;
  saltadosPorExistir?: number;
  sinDatoEnApi?: string[];
}

export interface ParamsBackfillTc {
  desde?: string;
  hasta?: string;
  pisarExistentes?: boolean;
  soloValidar?: boolean;
}

export async function backfillTcDiario(params: ParamsBackfillTc = {}): Promise<ResultadoBackfillTc> {
  const fn = httpsCallable<ParamsBackfillTc, ResultadoBackfillTc>(functions, 'backfillTcDiario');
  const result = await fn(params);
  return result.data;
}
