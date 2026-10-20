// F9.196 — acceso a `cuentasVivas` y `movimientosCuenta` desde el cliente.
//
// Hoy solo lo usa el importador de Balanz (Addendum 2 §A, H2b): el cliente escribe
// `cuentasVivas/balanz_<comitente>` y los movimientos inferidos. Las cuentas con API (PPI,
// Bitfinex) las va a escribir el cron con Admin SDK (H2); las Rules no le dejan al cliente
// escribir esas.
//
// La lógica (y la lectura del .xlsx) está en ./patrimonioBalanzArchivo; acá solo hay Firestore.
import { doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { MovimientoCuenta } from './patrimonioMovimientos';
import { idCuentaVivaBalanz, type CuentaVivaBalanz } from './patrimonioBalanzArchivo';
import type { CajaAnclada } from './patrimonioBalanzMovimientos';

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
 *
 * La caja anclada (`saldos`, `cajaAnclada`) la escribe el archivo de Movimientos (§B) y "Mis
 * Instrumentos" no la trae: se CONSERVA de la versión anterior del documento. Si se perdiera, la
 * cuenta volvería en silencio a la caja de la corrida.
 */
export async function guardarImportacionBalanz(cv: CuentaVivaBalanz, movimientos: MovimientoCuenta[]): Promise<void> {
  if (movimientos.length + 1 > 450) {
    throw new Error(`Demasiados movimientos para un solo batch (${movimientos.length}).`);
  }
  const ref = doc(db, 'cuentasVivas', idCuentaVivaBalanz(cv.comitente));
  const previa = await getDoc(ref);
  const p = previa.exists() ? previa.data() : {};
  const cajaPrevia = {
    ...(p.saldos ? { saldos: p.saldos } : {}),
    ...(p.cajaAnclada ? { cajaAnclada: p.cajaAnclada } : {}),
    ...(p.cajaActualizadaEn ? { cajaActualizadaEn: p.cajaActualizadaEn } : {}),
  };
  const batch = writeBatch(db);
  batch.set(ref, { ...limpio(cv), ...cajaPrevia, importadoEn: serverTimestamp() });
  for (const m of movimientos) {
    if (!m.id) throw new Error('Movimiento inferido sin id.');
    batch.set(doc(db, 'movimientosCuenta', m.id), { ...limpio(m), creadoEn: serverTimestamp() }, { merge: true });
  }
  await batch.commit();
}

export type ResultadoCajaBalanz = 'actualizada' | 'creada_sin_tenencia' | 'mas_vieja' | 'desconocida';

/**
 * Addendum 2 §B (H3c) — movimientos del archivo de Movimientos de Balanz, en batches de 400.
 * - Ids deterministas y `merge`: un export que se pisa con otro no duplica ni borra campos que se
 *   agreguen después (por ejemplo `flujoId`).
 * - `borrar`: los `Comprobante de Pago` que una devolución anuló. Si un export anterior los guardó
 *   como retiro, se borran.
 * - Caja anclada: se escribe como `saldos` de la cuenta viva. Si la comitente todavía no tiene
 *   "Mis Instrumentos", se crea la cuenta viva solo con la caja (`posiciones: []`), y la cartera
 *   viva sigue usando la tenencia de la corrida. Una caja que llega hasta una fecha ANTERIOR a la
 *   guardada no la pisa.
 */
export async function guardarMovimientosBalanz(
  comitente: string,
  cuenta: string,
  movimientos: MovimientoCuenta[],
  borrar: string[],
  caja: CajaAnclada,
): Promise<{ caja: ResultadoCajaBalanz }> {
  const ops: Array<{ borrar: string } | { set: MovimientoCuenta }> = [
    ...borrar.map(id => ({ borrar: id })),
    ...movimientos.map(m => ({ set: m })),
  ];
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + 400)) {
      if ('borrar' in op) { batch.delete(doc(db, 'movimientosCuenta', op.borrar)); continue; }
      const m = op.set;
      if (!m.id) throw new Error('Movimiento sin id.');
      batch.set(doc(db, 'movimientosCuenta', m.id), { ...limpio(m), creadoEn: serverTimestamp() }, { merge: true });
    }
    await batch.commit();
  }
  if (caja.estado !== 'ok') return { caja: 'desconocida' };
  const ref = doc(db, 'cuentasVivas', idCuentaVivaBalanz(comitente));
  const previa = await getDoc(ref);
  const hastaPrevia = previa.exists() ? (previa.data().cajaAnclada?.hasta as string | undefined) : undefined;
  if (hastaPrevia && hastaPrevia > caja.hasta) return { caja: 'mas_vieja' };
  const campos = { saldos: caja.saldos, cajaAnclada: limpio(caja), cajaActualizadaEn: serverTimestamp() };
  if (previa.exists()) {
    await updateDoc(ref, campos);
    const tiene = Array.isArray(previa.data().posiciones) && previa.data().posiciones.length > 0;
    return { caja: tiene ? 'actualizada' : 'creada_sin_tenencia' };
  }
  await setDoc(ref, {
    cuenta, fuente: 'archivo_balanz', comitente, posiciones: [], error: null,
    leidoEn: `${caja.hasta}T23:59:59-03:00`, ...campos,
  });
  return { caja: 'creada_sin_tenencia' };
}
