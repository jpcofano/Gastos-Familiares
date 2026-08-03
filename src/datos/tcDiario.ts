import { collection, doc, getDoc, getDocs, query, orderBy, limit, documentId, startAt } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { claveSemanaISO } from './patrimonioOptimizacion';
import { TC_FALLBACK } from './money';

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
  const aItem = (d: { id: string; data: () => any }): TCDiarioItem => ({
    fecha: d.id,
    tcUsdArs: d.data().tcUsdArs as number,
    origen: d.data().origen as TCDiarioItem['origen'],
  });

  // F9.114 — cada lectura exitosa refresca el cache de localStorage, que es el segundo
  // escalón de la cascada (ver tcEfectivoDe): así el fallback se actualiza solo.
  const cachear = (items: TCDiarioItem[]): TCDiarioItem[] => {
    if (items[0]?.tcUsdArs) guardarTcCache(items[0].fecha, items[0].tcUsdArs);
    return items;
  };

  try {
    const snap = await getDocs(
      query(collection(db, 'tcDiario'), orderBy(documentId(), 'desc'), limit(n)),
    );
    return cachear(snap.docs.map(aItem));
  } catch (err) {
    // F9.113 — fallback sin índice: el id ES la fecha (YYYY-MM-DD), así que ordenar en
    // cliente da el mismo resultado. La colección es chica (un doc por día) y es la misma
    // lectura completa que ya hace cargarEstadoTcDiario. Preferimos leer de más antes que
    // dejar la pantalla sin valor de TC.
    console.warn('[cargarTCReciente] consulta ordenada falló, uso fallback sin índice:', err);
    const snap = await getDocs(collection(db, 'tcDiario'));
    return cachear(
      snap.docs
        .map(aItem)
        .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
        .slice(0, n),
    );
  }
}

// F9.114 — TC de una fecha contra un mapa ya cargado (cargarTCRango): exacto, o el más
// reciente anterior (fines de semana y feriados no tienen doc). null si no hay ninguno
// anterior — el mapa se carga con margen hacia atrás para que el día 1 del mes tenga uno.
// NOTA: se respeta la convención existente del cron (la key D guarda el cierre de D−1);
// acá NO se corrige ni se desplaza — sólo se lee como está.
export function tcDeFecha(mapa: Record<string, number>, fecha: string): number | null {
  if (mapa[fecha]) return mapa[fecha];
  const anteriores = Object.keys(mapa).filter(k => k < fecha).sort();
  const ultima = anteriores[anteriores.length - 1];
  return ultima ? mapa[ultima] : null;
}

// F9.114 — cache del último TC leído con éxito. Mismo patrón try/catch que
// comerciosLogos.ts:15-16 (el storage puede estar bloqueado). Se reescribe en cada
// lectura exitosa, así el fallback se actualiza solo todos los días.
const KEY_TC_CACHE = 'gf-tc-ultimo';

export function guardarTcCache(fecha: string, tc: number) {
  try { localStorage.setItem(KEY_TC_CACHE, JSON.stringify({ fecha, tc })); } catch { /* storage bloqueado */ }
}

export function leerTcCache(): { fecha: string; tc: number } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_TC_CACHE) ?? 'null');
    return raw && typeof raw.tc === 'number' && raw.tc > 0 ? raw : null;
  } catch { return null; }
}

// F9.114 — cascada de TC para valuar lo VIVO (esperados no pagados, ingresos del mes en
// curso). Tres niveles, y la pantalla SIEMPRE dice cuál está usando: nunca un valor
// plausible sin marcar. `aviso` null = el TC es el real de /tcDiario.
export function tcEfectivoDe(tcHoy: number | null): { tc: number; aviso: string | null } {
  if (tcHoy) return { tc: tcHoy, aviso: null };
  const cache = leerTcCache();
  if (cache) return { tc: cache.tc, aviso: `TC del ${cache.fecha} — no se pudo leer el de hoy.` };
  return { tc: TC_FALLBACK, aviso: 'Sin TC — valor de referencia.' };
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
