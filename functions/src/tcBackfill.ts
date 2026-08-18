// F9.103 / F9.148 §4 — backfill de `tcDiario` desde ArgentinaDatos.
//
// Vive acá y no dentro del callable porque tiene DOS entradas: el callable `backfillTcDiario`
// (index.ts, con auth de admin) y `scripts/backfillTcF9148.ts`, que es como se corrió la primera
// vez sin depender de un deploy. Un solo escritor: no reimplementar el shift en ninguna de las dos.
//
// SHIFT −1 DÍA — crítico, NO es un mapeo 1:1 fecha→fecha. El cron F9.30 corre a las 09:00 ART,
// antes de que abra el mercado de bonos que arma el dólar bolsa/MEP, así que dolarapi todavía
// devuelve el cierre de AYER y lo guarda bajo el rótulo de HOY. ArgentinaDatos rotula con la
// fecha real de mercado. Mismo dato, rótulo corrido un día.
// Auditado dos veces: F9.103 (198/200) y F9.148 (775/778 contra `api[D−1]`, **0/778** contra
// `api[D]`). Sin el shift, empalmar el histórico mete un escalón artificial de hasta ~2%.
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export const URL_ARGENTINADATOS = 'https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa';

export function addDiasISO(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

export type OpcionesBackfill = {
  desde: string;
  hasta: string;
  pisarExistentes: boolean;
  soloValidar: boolean;
  /**
   * Qué escribir en `actualizadoEn`. Existe porque este módulo corre desde dos instalaciones
   * distintas de firebase-admin: la de `functions/node_modules` (el callable) y la de la raíz
   * (los scripts). Un sentinel `serverTimestamp()` creado por una instancia NO lo reconoce el
   * cliente de la otra — falla con "Couldn't serialize ServerTimestampTransform". Cada llamador
   * pasa el suyo; el default sirve al callable, que comparte instancia con este archivo.
   */
  sello?: unknown;
};

export type ResultadoBackfill = {
  soloValidar: boolean;
  solapamiento: {
    coinciden: number;
    totalComparados: number;
    difieren: Array<{ fecha: string; propio: number; api: number; deltaAbs: number; deltaPct: number }>;
    soloPropioSinApi: string[];
  };
  planEscritura?: { aEscribir: number; saltadosPorExistir: number; sinDatoEnApi: string[] };
  escritos?: number;
  saltadosPorExistir?: number;
  sinDatoEnApi?: string[];
};

/** Falla en vez de escribir basura: mejor un hueco que un TC inventado. */
export async function bajarSerieBolsa(): Promise<Map<string, number>> {
  const res = await fetch(URL_ARGENTINADATOS);
  if (!res.ok) throw new Error(`ArgentinaDatos respondió HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error('la respuesta no es un array');
  const serie = (data as Array<Record<string, unknown>>)
    .map(d => ({ fecha: String(d.fecha), venta: Number(d.venta) }))
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.fecha) && Number.isFinite(d.venta) && d.venta > 0);
  if (serie.length === 0) throw new Error('serie vacía tras parsear');
  return new Map(serie.map(d => [d.fecha, d.venta]));
}

export async function backfillTc(
  db: Firestore,
  { desde, hasta, pisarExistentes, soloValidar, sello }: OpcionesBackfill,
): Promise<ResultadoBackfill> {
  const actualizadoEn = sello ?? FieldValue.serverTimestamp();
  const apiMap = await bajarSerieBolsa();

  // Validación de solapamiento: corre SIEMPRE, incluso al escribir. Compara todo el `tcDiario`
  // existente contra `api[fecha − 1]`. Si el shift dejara de valer, se ve acá antes de escribir.
  const propioSnap = await db.collection('tcDiario').get();
  const propioMap = new Map<string, number>();
  propioSnap.forEach(doc => propioMap.set(doc.id, doc.data().tcUsdArs as number));

  const difieren: ResultadoBackfill['solapamiento']['difieren'] = [];
  let coinciden = 0;
  const soloPropioSinApi: string[] = [];
  for (const [fecha, tcPropio] of propioMap) {
    const apiVal = apiMap.get(addDiasISO(fecha, -1));
    if (apiVal == null) { soloPropioSinApi.push(fecha); continue; }
    const deltaAbs = Math.abs(tcPropio - apiVal);
    const deltaPct = (deltaAbs / apiVal) * 100;
    // Tolerancia > 0 porque la fuente revisa valores puntuales con ruido menor (auditado:
    // 2/200 casos, <1% cada uno, no sistemático).
    if (deltaPct < 1) coinciden++;
    else difieren.push({ fecha, propio: tcPropio, api: apiVal, deltaAbs, deltaPct });
  }
  const solapamiento = {
    coinciden,
    totalComparados: coinciden + difieren.length,
    difieren: difieren.sort((a, b) => a.fecha.localeCompare(b.fecha)),
    soloPropioSinApi: soloPropioSinApi.sort(),
  };

  const aEscribir: Array<{ fecha: string; tcUsdArs: number }> = [];
  let saltadosPorExistir = 0;
  const sinDatoEnApi: string[] = [];
  for (let f = desde; f <= hasta; f = addDiasISO(f, 1)) {
    if (propioMap.has(f) && !pisarExistentes) { saltadosPorExistir++; continue; }
    const apiVal = apiMap.get(addDiasISO(f, -1));
    if (apiVal == null) { sinDatoEnApi.push(f); continue; }
    aEscribir.push({ fecha: f, tcUsdArs: apiVal });
  }

  if (soloValidar) {
    return {
      soloValidar: true,
      solapamiento,
      planEscritura: { aEscribir: aEscribir.length, saltadosPorExistir, sinDatoEnApi },
    };
  }

  const BATCH_SIZE = 400;  // límite de Firestore 500, con margen
  for (let i = 0; i < aEscribir.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const { fecha, tcUsdArs } of aEscribir.slice(i, i + BATCH_SIZE)) {
      batch.set(
        db.collection('tcDiario').doc(fecha),
        { tcUsdArs, actualizadoEn, origen: 'argentinadatos-bolsa-backfill' },
        { merge: true },
      );
    }
    await batch.commit();
  }

  return { soloValidar: false, solapamiento, escritos: aEscribir.length, saltadosPorExistir, sinDatoEnApi };
}
