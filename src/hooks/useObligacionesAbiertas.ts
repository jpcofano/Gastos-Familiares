import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { docAMovimiento } from '../datos/movimientos';
import { esObligacionAbierta } from '../datos/obligaciones';
import type { Movement } from '../types';

// F9.184 §1 — las obligaciones abiertas de TODOS los meses (docs/CLAUDE.md, "La unidad de lo
// pendiente es la OBLIGACIÓN"). La consulta es `pagado == false` y el resto lo decide el cliente
// con `esObligacionAbierta`: medido en F9.184 §0.2, todo movimiento tiene el campo `pagado` y ese
// filtro trae exactamente el conjunto, mientras que `confirmadoPago` falta en más de la mitad de
// los docs y por igualdad los perdería. Sin índice compuesto: es un solo campo.
//
// Solo admin, el mismo gate que Resumen: las reglas solo dejan leer movimientos ajenos a un admin,
// y una consulta sin filtro de persona fallaría entera para un dependiente. Con `habilitado` en
// false no se abre ningún listener y devuelve vacío.
//
// Devuelve los movimientos crudos, no `Obligacion[]`: la fecha efectiva y el estado dependen de
// `hoy`, y cada consumidor los calcula con `obligacionesAbiertas(movs, hoy)` en su render.
export function useObligacionesAbiertas(habilitado: boolean) {
  const [abiertas, setAbiertas] = useState<Movement[]>([]);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    if (!habilitado) { setAbiertas([]); return; }
    setError(null);
    const q = query(collection(db, 'movimientos'), where('pagado', '==', false));
    return onSnapshot(
      q,
      snap => setAbiertas(snap.docs.map(d => docAMovimiento(d.id, d.data())).filter(esObligacionAbierta)),
      err  => setError(err.message),
    );
  }, [habilitado]);

  return { abiertas, error };
}
