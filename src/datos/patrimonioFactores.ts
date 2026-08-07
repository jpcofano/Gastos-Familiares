// F9.127 §2 — override de factor por ticker. Misma forma que `cafciMapping`, que ya funcionó, pero
// con las dos lecciones aprendidas de aquella:
//
//   1. NO se persisten clasificaciones negativas. Un `sin_clasificar` guardado se vuelve cache
//      negativo: fosiliza el miss y además lo silencia, porque la corrida siguiente encuentra el doc
//      y deja de reportar el pendiente. Fue el bug de F9.122 §3 y costó una purga.
//   2. Lectura UNA SOLA VEZ por render, nunca un `get()` por posición. `cargarFactoresTicker`
//      devuelve el diccionario entero y el consumidor lo pasa a `factorDe`.

import { collection, doc, getDocs, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { FACTOR_ENERGIA, type Factor, type Custodia } from './patrimonioRiesgo';

export type FactorTickerDoc = {
  factor: Factor;
  origen: 'auto' | 'manual';
  nota?: string;
};

/** Diccionario completo ticker → factor. Una lectura por render. */
export async function cargarFactoresTicker(): Promise<Record<string, Factor>> {
  const snap = await getDocs(collection(db, 'factoresTicker'));
  const out: Record<string, Factor> = {};
  for (const d of snap.docs) {
    const data = d.data() as FactorTickerDoc;
    // Defensivo: si un `sin_clasificar` se coló alguna vez, se ignora en lectura. No clasificar
    // nunca puede venir de la base — es la ausencia de dato, no un dato.
    if (data.factor && data.factor !== 'sin_clasificar') out[d.id] = data.factor;
  }
  return out;
}

export async function guardarFactorTicker(ticker: string, factor: Factor, nota?: string): Promise<void> {
  if (factor === 'sin_clasificar') {
    // Marcar algo como sin clasificar es BORRAR el override, no escribir uno. Ver el punto 1.
    await deleteDoc(doc(db, 'factoresTicker', ticker));
    return;
  }
  await setDoc(
    doc(db, 'factoresTicker', ticker),
    { factor, origen: 'manual', ...(nota ? { nota } : {}) },
    { merge: true },
  );
}

/**
 * Siembra los factores conocidos desde el mapa de energía de §1. Idempotente y **nunca pisa un
 * `origen: 'manual'`**: lo cargado a mano gana sobre la semilla, siempre.
 */
export async function importarFactoresSeed(): Promise<{ escritos: number; conservados: number }> {
  const snap = await getDocs(collection(db, 'factoresTicker'));
  const manuales = new Set(
    snap.docs.filter(d => (d.data() as FactorTickerDoc).origen === 'manual').map(d => d.id),
  );

  const batch = writeBatch(db);
  let escritos = 0;
  let conservados = 0;
  for (const [ticker, factor] of Object.entries(FACTOR_ENERGIA)) {
    if (manuales.has(ticker)) { conservados++; continue; }
    batch.set(doc(db, 'factoresTicker', ticker), { factor, origen: 'auto' }, { merge: true });
    escritos++;
  }
  if (escritos > 0) await batch.commit();
  return { escritos, conservados };
}

// ── F9.130 §2 — override de custodia por cuenta ───────────────────────────────
// Misma forma que `factoresTicker`: una lectura por render, y **no se persisten negativos** —
// declarar algo como `sin_declarar` borra el override en vez de escribir uno. Un `sin_declarar`
// guardado sería cache negativo (F9.122 §3) y además ocultaría que la custodia sigue sin declarar,
// que es justo lo que la card tiene que gritar.
export async function cargarCustodiaCuenta(): Promise<Record<string, Custodia>> {
  const snap = await getDocs(collection(db, 'custodiaCuenta'));
  const out: Record<string, Custodia> = {};
  for (const d of snap.docs) {
    const data = d.data() as { custodia?: Custodia };
    if (data.custodia && data.custodia !== 'sin_declarar') out[d.id] = data.custodia;
  }
  return out;
}

export async function guardarCustodiaCuenta(cuenta: string, custodia: Custodia, nota?: string): Promise<void> {
  if (custodia === 'sin_declarar') {
    await deleteDoc(doc(db, 'custodiaCuenta', cuenta));
    return;
  }
  await setDoc(
    doc(db, 'custodiaCuenta', cuenta),
    { custodia, origen: 'manual', ...(nota ? { nota } : {}) },
    { merge: true },
  );
}
