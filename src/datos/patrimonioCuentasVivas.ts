// F9.196 — acceso a `cuentasVivas` y `movimientosCuenta` desde el cliente.
//
// Hoy solo lo usa el importador de Balanz (Addendum 2 §A, H2b): el cliente escribe
// `cuentasVivas/balanz_<comitente>` y los movimientos inferidos. Las cuentas con API (PPI,
// Bitfinex) las va a escribir el cron con Admin SDK (H2); las Rules no le dejan al cliente
// escribir esas.
//
// La lógica (y la lectura del .xlsx) está en ./patrimonioBalanzArchivo; acá solo hay Firestore.
import { doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { MovimientoCuenta } from './patrimonioMovimientos';
import { idCuentaVivaBalanz, type CuentaVivaBalanz } from './patrimonioBalanzArchivo';

export async function cargarCuentaVivaBalanz(comitente: string): Promise<CuentaVivaBalanz | null> {
  const snap = await getDoc(doc(db, 'cuentasVivas', idCuentaVivaBalanz(comitente)));
  return snap.exists() ? (snap.data() as CuentaVivaBalanz) : null;
}

/** Firestore no acepta `undefined`: se limpia antes de escribir. */
const limpio = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/**
 * Escribe la cuenta viva y sus movimientos inferidos en un solo batch: o queda la importación
 * entera, o nada. Los ids de los movimientos son deterministas (comitente + exportación +
 * ticker), así que re-confirmar el mismo archivo pisa lo mismo y no duplica.
 */
export async function guardarImportacionBalanz(cv: CuentaVivaBalanz, movimientos: MovimientoCuenta[]): Promise<void> {
  if (movimientos.length + 1 > 450) {
    throw new Error(`Demasiados movimientos para un solo batch (${movimientos.length}).`);
  }
  const batch = writeBatch(db);
  batch.set(doc(db, 'cuentasVivas', idCuentaVivaBalanz(cv.comitente)), {
    ...limpio(cv), importadoEn: serverTimestamp(),
  });
  for (const m of movimientos) {
    if (!m.id) throw new Error('Movimiento inferido sin id.');
    batch.set(doc(db, 'movimientosCuenta', m.id), { ...limpio(m), creadoEn: serverTimestamp() });
  }
  await batch.commit();
}
