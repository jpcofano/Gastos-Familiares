import {
  collection, getDocs, query, where, type DocumentData,
  addDoc, doc, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { ExpectedItem } from '../types';

export function docAItemEsperado(id: string, data: DocumentData): ExpectedItem {
  return {
    id,
    tipo:           data.tipo,
    activo:         data.activo         ?? false,
    categoria:      data.categoria      ?? null,
    subcategoria:   data.subcategoria   ?? null,
    etiqueta:       data.etiqueta       ?? null,
    persona:        data.persona        ?? null,
    moneda:         data.moneda         ?? 'ARS',
    banco:          data.banco          ?? null,
    montoEsperado:  data.montoEsperado  ?? null,
    diaVencimiento: data.diaVencimiento ?? null,
    autoCalendario: data.autoCalendario ?? false,
    notas:          data.notas          ?? null,
    tarjetaCodigo:  data.tarjetaCodigo  ?? null,
    matchTexto:     data.matchTexto
      ? { incluye: data.matchTexto.incluye ?? [], excluye: data.matchTexto.excluye ?? [] }
      : null,
    periodicidad:   data.periodicidad   || 'mensual',
    pagoAutomatico: data.pagoAutomatico ?? false,
  };
}

type Resultado<T> = { ok: true; data: T } | { ok: false; error: Error };

export async function itemsEsperadosActivos(): Promise<Resultado<ExpectedItem[]>> {
  try {
    const snap = await getDocs(
      query(collection(db, 'itemsEsperados'), where('activo', '==', true)),
    );
    return { ok: true, data: snap.docs.map(d => docAItemEsperado(d.id, d.data())) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export async function itemsEsperadosTodos(): Promise<Resultado<ExpectedItem[]>> {
  try {
    const snap = await getDocs(collection(db, 'itemsEsperados'));
    return { ok: true, data: snap.docs.map(d => docAItemEsperado(d.id, d.data())) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export interface NuevoItemEsperado {
  tipo: 'Gasto' | 'Ingreso';
  activo: boolean;
  categoria: string | null;
  subcategoria: string | null;
  etiqueta: string | null;
  persona: string | null;
  moneda: 'ARS' | 'USD';
  banco: string | null;
  montoEsperado: number | null;
  diaVencimiento: number | null;
  autoCalendario: boolean;
  notas: string | null;
  tarjetaCodigo: string | null;
  matchTexto: { incluye: string[]; excluye: string[] } | null;
  periodicidad: 'mensual' | 'bimestral' | 'trimestral' | 'anual' | 'unico';
  pagoAutomatico: boolean;
}

export async function crearItemEsperado(data: NuevoItemEsperado): Promise<Resultado<string>> {
  try {
    const ref = await addDoc(collection(db, 'itemsEsperados'), {
      ...data,
      creadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp(),
    });
    return { ok: true, data: ref.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export async function actualizarItemEsperado(
  id: string,
  data: Partial<NuevoItemEsperado>,
): Promise<Resultado<void>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateDoc(doc(db, 'itemsEsperados', id), { ...(data as any), actualizadoEn: serverTimestamp() });
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export function desactivarItemEsperado(id: string): Promise<Resultado<void>> {
  return actualizarItemEsperado(id, { activo: false });
}

export function reactivarItemEsperado(id: string): Promise<Resultado<void>> {
  return actualizarItemEsperado(id, { activo: true });
}

export async function eliminarItemEsperado(id: string): Promise<Resultado<void>> {
  try {
    await deleteDoc(doc(db, 'itemsEsperados', id));
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}
