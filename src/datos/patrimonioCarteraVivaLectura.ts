// F9.196 H2a — lectura de la cartera viva (`carteraViva/ultima`, la escribe `actualizarCarteraViva`)
// y los botones "Sincronizar PPI ahora" y "Recalcular valor de hoy" (callables, solo el dueño).
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import type { CarteraViva } from './patrimonioCarteraViva';

/** Espejo de `DocCarteraViva` (functions/src/carteraVivaCron.ts). */
export type DocCarteraViva = CarteraViva & { fechaCorrida: string; calculadaEnISO: string; frescura: string[] };

export async function cargarCarteraViva(): Promise<DocCarteraViva | null> {
  const snap = await getDoc(doc(db, 'carteraViva', 'ultima'));
  return snap.exists() ? (snap.data() as DocCarteraViva) : null;
}

const _sincronizarPPI = httpsCallable<void, { posiciones: number; movimientos: number; dias: number }>(functions, 'sincronizarPPIAhora');
export async function sincronizarPPIAhora() {
  return (await _sincronizarPPI()).data;
}

const _sincronizarBitfinex = httpsCallable<void, { posiciones: number; movimientos: number; prestamos: number; paraRevisar: number }>(functions, 'sincronizarBitfinexAhora');
/** F9.196 H2c — "Sincronizar Bitfinex ahora". Al terminar, la Function ya recalculó la cartera viva. */
export async function sincronizarBitfinexAhora() {
  return (await _sincronizarBitfinex()).data;
}

const _recalcular = httpsCallable<void, { ok: boolean; totalUsd: number | null }>(functions, 'recalcularCarteraViva');
export async function recalcularCarteraViva() {
  return (await _recalcular()).data;
}
