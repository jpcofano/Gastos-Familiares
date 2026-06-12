import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';

export interface SubcategoriaItem {
  id: string;
  categoriaPadre: string | null;
  valor: string;
}

export interface EtiquetaItem {
  id: string;
  valor: string;
}

export async function cargarSubcategorias(): Promise<SubcategoriaItem[]> {
  const snap = await getDocs(
    query(collection(db, 'subcategorias'), where('activo', '==', true)),
  );
  return snap.docs.map(d => ({
    id: d.id,
    categoriaPadre: d.data().categoriaPadre ?? null,
    valor: d.data().valor as string,
  }));
}

export async function cargarEtiquetas(): Promise<EtiquetaItem[]> {
  const snap = await getDocs(
    query(collection(db, 'etiquetas'), where('activo', '==', true)),
  );
  return snap.docs.map(d => ({
    id: d.id,
    valor: d.data().valor as string,
  }));
}
