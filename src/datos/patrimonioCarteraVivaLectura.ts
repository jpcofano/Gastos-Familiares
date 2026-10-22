// F9.196 H2a — lectura de la cartera viva (`carteraViva/ultima`, la escribe `actualizarCarteraViva`)
// y los botones "Sincronizar PPI ahora" y "Recalcular valor de hoy" (callables, solo el dueño).
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import type { CarteraViva } from './patrimonioCarteraViva';
import { exigirRecalculoOk, type ResultadoRecalcular } from './patrimonioRecalcular';

export type { ResultadoRecalcular } from './patrimonioRecalcular';

/** Espejo de `DocCarteraViva` (functions/src/carteraVivaCron.ts). */
export type DocCarteraViva = CarteraViva & { fechaCorrida: string; calculadaEnISO: string; frescura: string[] };

export async function cargarCarteraViva(): Promise<DocCarteraViva | null> {
  const snap = await getDoc(doc(db, 'carteraViva', 'ultima'));
  return snap.exists() ? (snap.data() as DocCarteraViva) : null;
}

// Timeouts del cliente a la medida de cada Function (el default del SDK, 70 s, corta antes que el server).
const _sincronizarPPI = httpsCallable<void, { posiciones: number; movimientos: number; dias: number }>(functions, 'sincronizarPPIAhora', { timeout: 300_000 });
export async function sincronizarPPIAhora() {
  return (await _sincronizarPPI()).data;
}

const _sincronizarBitfinex = httpsCallable<void, { posiciones: number; movimientos: number; prestamos: number; paraRevisar: number }>(functions, 'sincronizarBitfinexAhora', { timeout: 300_000 });
/** F9.196 H2c — "Sincronizar Bitfinex ahora". Al terminar, la Function ya recalculó la cartera viva. */
export async function sincronizarBitfinexAhora() {
  return (await _sincronizarBitfinex()).data;
}

// F9.196.1 §1.d — también corre los flujos automáticos y devuelve su resumen.
const _recalcular = httpsCallable<void, ResultadoRecalcular>(functions, 'recalcularCarteraViva', { timeout: 120_000 });

/** La respuesta tal cual (`ok`, `error`, `flujos`), para quien necesita el detalle ("Para decidir"). */
export async function recalcularCarteraVivaCrudo(): Promise<ResultadoRecalcular> {
  return (await _recalcular()).data;
}

/**
 * Addendum 1 B — recalcula y, si la cartera falló (`ok: false`), TIRA con el mensaje real: ningún
 * llamador puede mostrarlo como éxito. Devuelve el aviso de los flujos, si fallaron.
 */
export async function recalcularCarteraViva(): Promise<{ resultado: ResultadoRecalcular; avisoFlujos: string | null }> {
  const resultado = await recalcularCarteraVivaCrudo();
  return { resultado, ...exigirRecalculoOk(resultado) };
}
