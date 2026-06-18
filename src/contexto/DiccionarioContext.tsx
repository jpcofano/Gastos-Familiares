import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { clasificar as clasificarPuro, type EntradaDict, type ClasificacionResult } from '../datos/clasificador';
import type { NormRule } from '../datos/normalizador';

interface DiccionarioCtx {
  clasificar: (texto: string, opts?: { banco?: string | null; tarjeta?: string | null }) => ClasificacionResult | null;
  cargando: boolean;
}

const Ctx = createContext<DiccionarioCtx>({ clasificar: () => null, cargando: true });

export function DiccionarioProvider({ children }: { children: ReactNode }) {
  const [cargando, setCargando] = useState(true);
  const entradasRef = useRef<EntradaDict[]>([]);
  const reglasRef   = useRef<NormRule[]>([]);
  const cacheRef    = useRef<Map<string, ClasificacionResult | null>>(new Map());

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, 'diccionario'), where('activo', '==', true))),
      getDocs(collection(db, 'reglasNormalizacion')),
    ])
      .then(([dictSnap, reglasSnap]) => {
        entradasRef.current = dictSnap.docs.map(d => {
          const data = d.data();
          return {
            patron:            data.patron            ?? null,
            tipoMatch:         data.tipoMatch === 'contains' ? 'contains' : 'exact',
            descripcionLimpia: data.descripcionLimpia  ?? null,
            categoria:         data.categoria          ?? null,
            subcategoria:      data.subcategoria       ?? null,
            etiqueta:          data.etiqueta           ?? null,
            personaDefault:    data.personaDefault     ?? null,
            monedaDefault:     data.monedaDefault       ?? null,
            bancoFiltro:       data.bancoFiltro         ?? null,
            tarjetaFiltro:     data.tarjetaFiltro       ?? null,
            confianza:         typeof data.confianza === 'number' ? data.confianza : 0.9,
            activo:            true,
          } satisfies EntradaDict;
        });
        reglasRef.current = reglasSnap.docs
          .map(d => d.data())
          .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
          .map(d => ({ tipo: d.tipo, patron: d.patron, reemplazo: d.reemplazo ?? '' } satisfies NormRule));
        cacheRef.current.clear();
        setCargando(false);
      })
      .catch(() => setCargando(false)); // fallo silencioso — sin sugerencias
  }, []);

  // Cache por texto+banco+tarjeta; se invalida cuando el diccionario recarga.
  const clasificar = useCallback(
    (texto: string, opts?: { banco?: string | null; tarjeta?: string | null }) => {
      const key = `${texto}\x00${opts?.banco ?? ''}\x00${opts?.tarjeta ?? ''}`;
      if (cacheRef.current.has(key)) return cacheRef.current.get(key) ?? null;
      const result = clasificarPuro(texto, entradasRef.current, reglasRef.current, opts);
      cacheRef.current.set(key, result);
      return result;
    },
    [],
  );

  return <Ctx.Provider value={{ clasificar, cargando }}>{children}</Ctx.Provider>;
}

export function useDiccionario(): DiccionarioCtx {
  return useContext(Ctx);
}
