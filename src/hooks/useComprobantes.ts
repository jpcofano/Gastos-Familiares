import { useEffect, useState } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { docAComprobante } from '../datos/comprobantes';
import type { Comprobante } from '../types';

export function useComprobantes(memberId: string, esAdmin: boolean) {
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([]);
  const [cargando,     setCargando]     = useState(true);
  const [error,        setError]        = useState<string | null>(null);

  useEffect(() => {
    const q = esAdmin
      ? query(collection(db, 'comprobantes'), orderBy('subidoEn', 'desc'))
      : query(collection(db, 'comprobantes'), where('subidoPor', '==', memberId), orderBy('subidoEn', 'desc'));
    const unsub = onSnapshot(
      q,
      snap => {
        setComprobantes(snap.docs.map(d => docAComprobante(d.id, d.data())));
        setCargando(false);
      },
      err => {
        setError(err.message);
        setCargando(false);
      },
    );
    return unsub;
  }, [memberId, esAdmin]);

  return { comprobantes, cargando, error };
}
