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

// F9.38 — variantes "admin" sin el filtro activo==true: las usa Perfil ›
// Categorías para poder mostrar/reactivar nodos desactivados. Los consumidores
// normales (AltaMovimiento, ConfigEsperados, clasificador) siguen usando las
// de arriba — no se les cambia el comportamiento.
export interface SubcategoriaAdminItem extends SubcategoriaItem { activo: boolean }
export interface EtiquetaAdminItem extends EtiquetaItem { activo: boolean }

export async function cargarSubcategoriasAdmin(): Promise<SubcategoriaAdminItem[]> {
  const snap = await getDocs(collection(db, 'subcategorias'));
  return snap.docs.map(d => ({
    id: d.id,
    categoriaPadre: d.data().categoriaPadre ?? null,
    valor: d.data().valor as string,
    activo: d.data().activo as boolean,
  }));
}

export async function cargarEtiquetasAdmin(): Promise<EtiquetaAdminItem[]> {
  const snap = await getDocs(collection(db, 'etiquetas'));
  return snap.docs.map(d => ({
    id: d.id,
    valor: d.data().valor as string,
    activo: d.data().activo as boolean,
  }));
}
