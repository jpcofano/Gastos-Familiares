import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { clasificar as clasificarPuro, type EntradaDict, type ClasificacionResult } from '../datos/clasificador';

interface DiccionarioCtx {
  clasificar: (texto: string, opts?: { banco?: string | null; tarjeta?: string | null }) => ClasificacionResult | null;
  cargando: boolean;
}

const Ctx = createContext<DiccionarioCtx>({ clasificar: () => null, cargando: true });

export function DiccionarioProvider({ children }: { children: ReactNode }) {
  const [cargando, setCargando] = useState(true);
  const entradasRef = useRef<EntradaDict[]>([]);

  useEffect(() => {
    getDocs(query(collection(db, 'diccionario'), where('activo', '==', true)))
      .then(snap => {
        entradasRef.current = snap.docs.map(d => {
          const data = d.data();
          return {
            patron:        data.patron        ?? null,
            tipoMatch:     data.tipoMatch === 'contains' ? 'contains' : 'exact',
            categoria:     data.categoria     ?? null,
            subcategoria:  data.subcategoria  ?? null,
            bancoFiltro:   data.bancoFiltro   ?? null,
            tarjetaFiltro: data.tarjetaFiltro ?? null,
            confianza:     typeof data.confianza === 'number' ? data.confianza : 0.9,
            activo:        true,
          } satisfies EntradaDict;
        });
        setCargando(false);
      })
      .catch(() => setCargando(false)); // fallo silencioso — sin sugerencias
  }, []);

  // Referencia estable: nunca cambia su identidad, siempre lee del ref actualizado.
  const clasificar = useCallback(
    (texto: string, opts?: { banco?: string | null; tarjeta?: string | null }) =>
      clasificarPuro(texto, entradasRef.current, opts),
    [],
  );

  return <Ctx.Provider value={{ clasificar, cargando }}>{children}</Ctx.Provider>;
}

export function useDiccionario(): DiccionarioCtx {
  return useContext(Ctx);
}
