import { useState, useEffect } from 'react';
import { type User } from 'firebase/auth';
import { useFirebaseUser } from './useFirebaseUser';
import { cargarFamiliaConfig, resolverMiembro } from '../familia';
import type { FamiliaMiembro } from '../types';

type Estado = 'cargando' | 'noAutenticado' | 'noAutorizado' | 'autenticado';

export interface UseMiembroResult {
  estado: Estado;
  memberId: string | null;
  miembro: FamiliaMiembro | null;
  firebaseUser: User | null;
}

export function useMiembro(): UseMiembroResult {
  const { user, cargando: cargandoAuth } = useFirebaseUser();
  const [estado, setEstado] = useState<Estado>('cargando');
  const [memberId, setMemberId] = useState<string | null>(null);
  const [miembro, setMiembro] = useState<FamiliaMiembro | null>(null);

  useEffect(() => {
    if (cargandoAuth) return;

    if (!user) {
      setEstado('noAutenticado');
      setMemberId(null);
      setMiembro(null);
      return;
    }

    let cancelled = false;
    setEstado('cargando');

    cargarFamiliaConfig()
      .then(config => {
        if (cancelled) return;
        if (!config) {
          console.error('[useMiembro] /config/familia no existe o no es legible');
          setEstado('noAutorizado');
          return;
        }
        const resultado = resolverMiembro(user.email ?? '', config);
        if (resultado) {
          setMemberId(resultado.memberId);
          setMiembro(resultado.miembro);
          setEstado('autenticado');
        } else {
          setEstado('noAutorizado');
        }
      })
      .catch(err => {
        if (cancelled) return;
        console.error('[useMiembro] Error leyendo /config/familia:', err);
        setEstado('noAutorizado');
      });

    return () => { cancelled = true; };
  }, [user, cargandoAuth]);

  return { estado, memberId, miembro, firebaseUser: user };
}
