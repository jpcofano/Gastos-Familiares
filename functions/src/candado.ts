// F9.196.1 §3 — candado en Firestore (`locks/{nombre}`) para que dos servicios distintos de Cloud
// Run no llamen a la vez a una API con nonce. El nonce de Bitfinex es monótono DENTRO de una
// instancia (bitfinexApi.ts); el cron `sincronizarBitfinex` y el botón `sincronizarBitfinexAhora` son
// servicios separados (`maxInstances: 1` en cada uno no evita que se pisen), y un nonce más chico
// que el último visto hace que Bitfinex rechace la key.
//
// Se toma en una transacción antes de la primera llamada y se libera al final (también si falla).
// `hasta` = ahora + 6 minutos (más que el `timeoutSeconds: 300` de las dos funciones): si una
// instancia muere sin liberar, el candado vence solo. Las Rules no dejan leerlo ni escribirlo al
// cliente (`locks`: false); solo el Admin SDK.
import type { Firestore } from 'firebase-admin/firestore';

export const DURACION_CANDADO_MS = 6 * 60_000;
/**
 * Plazo para la ÚLTIMA llamada a la API dentro de una corrida, contado desde que se tomó el candado:
 * menos que el vencimiento. En Cloud Run gen2 el `timeoutSeconds` corta la respuesta pero no mata el
 * proceso; sin este plazo, una corrida que se pasó podría seguir llamando con el candado ya vencido
 * y tomado por otro (dos clientes con la misma key).
 */
export const PLAZO_LLAMADAS_MS = 270_000;

export type Candado =
  | { tomado: true; liberar: () => Promise<void> }
  | { tomado: false; hasta: number; quien: string | null };

/** Lo mínimo de Firestore que usa el candado (para probarlo con un Firestore falso). */
export type DbCandado = Pick<Firestore, 'collection' | 'runTransaction'>;

export async function tomarCandado(db: DbCandado, nombre: string, quien: string, ahora: () => number = Date.now): Promise<Candado> {
  const ref = db.collection('locks').doc(nombre);
  const token = `${quien}-${ahora()}-${Math.random().toString(36).slice(2, 10)}`;
  const r = await db.runTransaction(async tx => {
    const d = (await tx.get(ref)).data() as { hasta?: number; quien?: string; token?: string } | undefined;
    // Idempotente: si el SDK reintenta después de un commit que sí se aplicó, el candado ya es nuestro.
    if (d?.token === token) return { tomado: true as const };
    if (d && typeof d.hasta === 'number' && d.hasta > ahora()) return { tomado: false as const, hasta: d.hasta, quien: d.quien ?? null };
    tx.set(ref, { hasta: ahora() + DURACION_CANDADO_MS, quien, token, desde: ahora() });
    return { tomado: true as const };
  });
  if (!r.tomado) return r;
  return {
    tomado: true,
    // Solo libera si sigue siendo suyo (si venció y lo tomó otro, no se lo saca).
    liberar: async () => {
      await db.runTransaction(async tx => {
        const d = (await tx.get(ref)).data() as { token?: string } | undefined;
        if (d?.token === token) tx.delete(ref);
      });
    },
  };
}

/**
 * Corre `fn` con el candado tomado y lo libera al terminar (también si falla). Si ya está tomado,
 * no corre `fn` y devuelve `{ corrio: false }` con hasta cuándo está tomado.
 */
export async function conCandado<T>(
  db: DbCandado, nombre: string, quien: string, fn: () => Promise<T>, ahora: () => number = Date.now,
): Promise<{ corrio: true; resultado: T } | { corrio: false; hasta: number; quien: string | null }> {
  const c = await tomarCandado(db, nombre, quien, ahora);
  if (!c.tomado) return { corrio: false, hasta: c.hasta, quien: c.quien };
  try {
    return { corrio: true, resultado: await fn() };
  } finally {
    await c.liberar().catch(e => console.error(`[candado ${nombre}] no se pudo liberar (vence solo): ${e instanceof Error ? e.message : String(e)}`));
  }
}
