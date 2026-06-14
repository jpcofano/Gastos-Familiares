import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { docAItemEsperado } from '../datos/itemsEsperados';
import type { ExpectedItem } from '../types';

interface ItemsEsperadosCtx {
  items:    ExpectedItem[];
  cargando: boolean;
  error:    string | null;
}

const Ctx = createContext<ItemsEsperadosCtx>({ items: [], cargando: true, error: null });

export function ItemsEsperadosProvider({ children }: { children: ReactNode }) {
  const [items,    setItems]    = useState<ExpectedItem[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'itemsEsperados'),
      snap => {
        setItems(snap.docs.map(d => docAItemEsperado(d.id, d.data())));
        setCargando(false);
      },
      err => {
        setError(err.message);
        setCargando(false);
      },
    );
    return unsub;
  }, []);

  return <Ctx.Provider value={{ items, cargando, error }}>{children}</Ctx.Provider>;
}

export function useItemsEsperados(): ItemsEsperadosCtx {
  return useContext(Ctx);
}
