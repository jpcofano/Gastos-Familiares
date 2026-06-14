import {
  collection, getDocs, query, where, addDoc, writeBatch, doc,
  serverTimestamp, Timestamp, type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Movement, ExpectedItem } from '../types';

export function docAMovimiento(id: string, data: DocumentData): Movement {
  return {
    id,
    idLegacy:               data.idLegacy,
    fecha:                  data.fecha?.toDate()                  ?? new Date(0),
    fechaConsumoOriginal:   data.fechaConsumoOriginal?.toDate()   ?? null,
    mes:                    data.mes,
    descripcion:            data.descripcion,
    descripcionOriginal:    data.descripcionOriginal              ?? null,
    monto:                  data.monto,
    moneda:                 data.moneda,
    tcUsdArs:               data.tcUsdArs                         ?? null,
    tipo:                   data.tipo,
    subtipo:                data.subtipo,
    origen:                 data.origen,
    categoria:              data.categoria                        ?? null,
    subcategoria:           data.subcategoria                     ?? null,
    etiqueta:               data.etiqueta                         ?? null,
    banco:                  data.banco                            ?? null,
    cuenta:                 data.cuenta                           ?? null,
    tarjetaCodigo:          data.tarjetaCodigo                    ?? null,
    tarjeta:                data.tarjeta                          ?? null,
    persona:                data.persona                          ?? null,
    creadoPor:              data.creadoPor,
    pagado:                 data.pagado                           ?? false,
    excluirDash:            data.excluirDash                      ?? false,
    incluirResumenMes:      data.incluirResumenMes                ?? false,
    padreId:                data.padreId                          ?? null,
    resumenTarjetaId:       data.resumenTarjetaId                 ?? null,
    itemEsperadoId:         data.itemEsperadoId                   ?? null,
    confirmadoPago:         data.confirmadoPago                   ?? false,
    numeroComprobante:      data.numeroComprobante                ?? null,
    hashPdf:                data.hashPdf                          ?? null,
    refStoragePdf:          data.refStoragePdf                    ?? null,
    notas:                  data.notas                            ?? null,
    creadoEn:               data.creadoEn?.toDate()               ?? new Date(0),
    actualizadoEn:          data.actualizadoEn?.toDate()          ?? new Date(0),
  };
}

type ResultadoMovimientos =
  | { ok: true;  data: Movement[] }
  | { ok: false; error: Error };

export interface NuevoMovimiento {
  fecha: Date;
  tipo: 'Gasto' | 'Ingreso';
  descripcion: string;
  monto: number;
  moneda: 'ARS' | 'USD';
  tcUsdArs: number | null;
  categoria: string;
  subcategoria: string;
  etiqueta: string | null;
  banco: string | null;
  persona: string;
  creadoPor: string;
  incluirResumenMes: boolean;
  itemEsperadoId?: string;
  // F6.3 — link a comprobante (opcionales)
  hashPdf?: string;
  refStoragePdf?: string;
  confirmadoPago?: boolean;
}

type ResultadoCreacion =
  | { ok: true;  id: string }
  | { ok: false; error: Error };

export async function crearMovimiento(payload: NuevoMovimiento): Promise<ResultadoCreacion> {
  try {
    const mes = `${payload.fecha.getFullYear()}-${String(payload.fecha.getMonth() + 1).padStart(2, '0')}`;
    const docRef = await addDoc(collection(db, 'movimientos'), {
      fecha:             Timestamp.fromDate(payload.fecha),
      mes,
      tipo:              payload.tipo,
      descripcion:       payload.descripcion,
      monto:             payload.monto,
      moneda:            payload.moneda,
      tcUsdArs:          payload.tcUsdArs,
      categoria:         payload.categoria,
      subcategoria:      payload.subcategoria,
      etiqueta:          payload.etiqueta,
      banco:             payload.banco,
      persona:           payload.persona,
      creadoPor:         payload.creadoPor,
      subtipo:           'Manual',
      origen:            'Manual',
      excluirDash:       false,
      pagado:            true,
      incluirResumenMes: payload.incluirResumenMes,
      itemEsperadoId:    payload.itemEsperadoId  ?? null,
      confirmadoPago:    payload.confirmadoPago  ?? false,
      hashPdf:           payload.hashPdf         ?? null,
      refStoragePdf:     payload.refStoragePdf   ?? null,
      // idLegacy intencionalmente ausente — los validators lo usan para distinguir docs del seed
      creadoEn:          serverTimestamp(),
      actualizadoEn:     serverTimestamp(),
    });
    return { ok: true, id: docRef.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

type Resultado<T> = { ok: true; data: T } | { ok: false; error: Error };

export async function confirmarPagoEsperado(
  item: ExpectedItem,
  matches: Movement[],
): Promise<Resultado<void>> {
  try {
    const batch = writeBatch(db);
    for (const m of matches) {
      batch.update(doc(db, 'movimientos', m.id), {
        confirmadoPago: true,
        itemEsperadoId: item.id,
        actualizadoEn: serverTimestamp(),
      });
    }
    await batch.commit();
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export async function desmarcarPago(matches: Movement[]): Promise<Resultado<void>> {
  try {
    const batch = writeBatch(db);
    for (const m of matches) {
      batch.update(doc(db, 'movimientos', m.id), {
        confirmadoPago: false,
        actualizadoEn: serverTimestamp(),
      });
    }
    await batch.commit();
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export async function movimientosDelMes(
  mes: string,
  persona?: string,
): Promise<ResultadoMovimientos> {
  try {
    const col = collection(db, 'movimientos');
    const q = persona
      ? query(col, where('mes', '==', mes), where('persona', '==', persona))
      : query(col, where('mes', '==', mes));
    const snap = await getDocs(q);
    const data = snap.docs.map(d => docAMovimiento(d.id, d.data()));
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}
