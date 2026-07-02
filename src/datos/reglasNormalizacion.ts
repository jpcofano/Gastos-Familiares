import { collection, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import type { NormRule } from './normalizador';

export interface ReglaDoc {
  id: string;
  tipo: NormRule['tipo'];
  patron: string;
  reemplazo: string;
  activo: boolean;
  orden: number;
  notas: string | null;
}

export async function listarReglas(): Promise<ReglaDoc[]> {
  const snap = await getDocs(collection(db, 'reglasNormalizacion'));
  return snap.docs
    .map(d => {
      const x = d.data();
      return {
        id: d.id,
        tipo: x.tipo,
        patron: x.patron ?? '',
        reemplazo: x.reemplazo ?? '',
        activo: x.activo !== false,
        orden: typeof x.orden === 'number' ? x.orden : 0,
        notas: x.notas ?? null,
      } satisfies ReglaDoc;
    })
    .sort((a, b) => a.orden - b.orden);
}

export interface GuardarReglaInput {
  accion: 'crear' | 'editar' | 'eliminar' | 'reordenar';
  id?: string;
  ids?: string[];
  tipo?: NormRule['tipo'];
  patron?: string;
  reemplazo?: string;
  activo?: boolean;
  notas?: string | null;
}

export async function guardarRegla(input: GuardarReglaInput): Promise<{ ok: boolean; id?: string }> {
  const fn = httpsCallable(functions, 'guardarReglaNormalizacion');
  const res = await fn(input);
  return res.data as { ok: boolean; id?: string };
}
