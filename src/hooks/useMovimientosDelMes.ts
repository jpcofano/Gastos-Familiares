import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { docAMovimiento } from '../datos/movimientos';
import type { Movement } from '../types';

export function useMovimientosDelMes(mes: string, persona?: string) {
  const [movimientos, setMovimientos] = useState<Movement[]>([]);
  const [cargando,    setCargando]    = useState(true);
  const [error,       setError]       = useState<string | null>(null);

  useEffect(() => {
    setCargando(true);
    setError(null);
    const col = collection(db, 'movimientos');
    const q   = persona
      ? query(col, where('mes', '==', mes), where('persona', '==', persona))
      : query(col, where('mes', '==', mes));

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
  }, [mes, persona]);

  return { movimientos, cargando, error };
}
