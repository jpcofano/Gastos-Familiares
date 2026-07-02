import { collection, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

export interface DestinoDoc {
  id: string;
  destinoNorm: string;
  tipo: 'cbu' | 'cuit' | 'alias' | 'nombre';
  itemEsperadoId: string | null;
  categoria: string | null;
  subcategoria: string | null;
  etiqueta: string | null;
  confianza: number;
}

export async function listarDestinos(): Promise<DestinoDoc[]> {
  const snap = await getDocs(collection(db, 'destinos'));
  return snap.docs.map(d => {
    const x = d.data();
    return {
      id: d.id,
      destinoNorm: x.destinoNorm ?? d.id,
      tipo: x.tipo ?? 'nombre',
      itemEsperadoId: x.itemEsperadoId ?? null,
      categoria: x.categoria ?? null,
      subcategoria: x.subcategoria ?? null,
      etiqueta: x.etiqueta ?? null,
      confianza: typeof x.confianza === 'number' ? x.confianza : 0,
    } satisfies DestinoDoc;
  });
}

export interface UpsertDestinoInput {
  id?: string;
  destinoRaw?: string;
  itemEsperadoId?: string | null;
  categoria?: string | null;
  subcategoria?: string | null;
  etiqueta?: string | null;
  confianza?: number;
}

export async function upsertDestino(input: UpsertDestinoInput): Promise<{ ok: boolean; id: string }> {
  const fn = httpsCallable(functions, 'upsertDestino');
  const res = await fn(input);
  return res.data as { ok: boolean; id: string };
}

export async function eliminarDestino(id: string): Promise<void> {
  const fn = httpsCallable(functions, 'eliminarDestino');
  await fn({ id });
}
