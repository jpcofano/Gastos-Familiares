import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { docAMovimiento } from '../datos/movimientos';
import type { Movement } from '../types';

// Mismo patrón que useMovimientosDelMes (F5.3, realtime) pero para el tab
// Anual del Dashboard, que necesita los 12 meses de un año. `mes` es
// string lexicográfico 'YYYY-MM', así que el rango funciona con <=/>=.
export function useMovimientosDelAnio(anio: number, persona?: string) {
  const [movimientos, setMovimientos] = useState<Movement[]>([]);
  const [cargando,    setCargando]    = useState(true);
  const [error,       setError]       = useState<string | null>(null);

  useEffect(() => {
    setCargando(true);
    setError(null);
    const desde = `${anio}-01`;
    const hasta = `${anio}-12`;
    const col = collection(db, 'movimientos');
    const q = persona
      ? query(col, where('mes', '>=', desde), where('mes', '<=', hasta), where('persona', '==', persona))
      : query(col, where('mes', '>=', desde), where('mes', '<=', hasta));

    const unsub = onSnapshot(
      q,
      snap => {
        setMovimientos(snap.docs.map(d => docAMovimiento(d.id, d.data())));
        setCargando(false);
      },
      err => {
        setError(err.message);
        setCargando(false);
      },
    );
    return unsub;
  }, [anio, persona]);

  return { movimientos, cargando, error };
}
