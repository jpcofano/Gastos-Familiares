import { collection, getDocs, query, where, type DocumentData } from 'firebase/firestore';
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
    matchTexto:     data.matchTexto     ?? null,
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
