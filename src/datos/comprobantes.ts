import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp, writeBatch,
  collection, query, orderBy, getDocs, type DocumentData,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import { sha256Archivo } from './hashArchivo';
import type { Comprobante, PropuestaMatch } from '../types';

type Resultado<T> = { ok: true; data: T } | { ok: false; error: Error };

function docAComprobante(id: string, data: DocumentData): Comprobante {
  const pm = data.propuestaMatch as Record<string, unknown> | null | undefined;
  return {
    id,
    hashPdf:          data.hashPdf,
    nombreArchivo:    data.nombreArchivo,
    contentType:      data.contentType,
    tamano:           data.tamano,
    refStoragePdf:    data.refStoragePdf,
    subidoPor:        data.subidoPor,
    subidoEn:         data.subidoEn?.toDate() ?? new Date(0),
    estado:           data.estado,
    errorExtraccion:  data.errorExtraccion  ?? undefined,
    datosExtraidos:   data.datosExtraidos   ?? undefined,
    propuestaMatch:   pm ? {
      rama:           pm.rama           as PropuestaMatch['rama'],
      movimientoId:   pm.movimientoId   as string | undefined,
      itemEsperadoId: pm.itemEsperadoId as string | undefined,
      candidatos:     pm.candidatos     as PropuestaMatch['candidatos'],
      calculadoEn:    (pm.calculadoEn as { toDate?: () => Date } | null)?.toDate?.() ?? new Date(),
    } : undefined,
  };
}

type ResultadoSubida =
  | { ok: true;  duplicado: true;  comprobante: Comprobante }
  | { ok: true;  duplicado: false; comprobante: Comprobante }
  | { ok: false; error: Error };

export async function subirComprobante(
  file: File,
  memberId: string,
): Promise<ResultadoSubida> {
  try {
    const hashPdf = await sha256Archivo(file);
    const docRef  = doc(db, 'comprobantes', hashPdf);
    const snap    = await getDoc(docRef);

    if (snap.exists()) {
      return { ok: true, duplicado: true, comprobante: docAComprobante(snap.id, snap.data()) };
    }

    const storagePath = `comprobantes/${hashPdf}`;
    await uploadBytes(ref(storage, storagePath), file, {
      contentType: file.type,
      customMetadata: { nombreArchivo: file.name },
    });

    await setDoc(docRef, {
      hashPdf,
      nombreArchivo: file.name,
      contentType:   file.type,
      tamano:        file.size,
      refStoragePdf: storagePath,
      subidoPor:     memberId,
      estado:        'subido',
      subidoEn:      serverTimestamp(),
    });

    const comprobante: Comprobante = {
      id:            hashPdf,
      hashPdf,
      nombreArchivo: file.name,
      contentType:   file.type,
      tamano:        file.size,
      refStoragePdf: storagePath,
      subidoPor:     memberId,
      subidoEn:      new Date(),
      estado:        'subido',
    };
    return { ok: true, duplicado: false, comprobante };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export async function listarComprobantes(): Promise<Resultado<Comprobante[]>> {
  try {
    const snap = await getDocs(
      query(collection(db, 'comprobantes'), orderBy('subidoEn', 'desc')),
    );
    return { ok: true, data: snap.docs.map(d => docAComprobante(d.id, d.data())) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// Rama 1: adjuntar hashPdf al movimiento existente + confirmar pago + marcar comprobante vinculado
export async function confirmarRama1(
  comp: Comprobante,
  movimientoId: string,
  itemEsperadoId: string | undefined,
): Promise<Resultado<void>> {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'movimientos', movimientoId), {
      hashPdf:       comp.hashPdf,
      refStoragePdf: comp.refStoragePdf,
      confirmadoPago: true,
      ...(itemEsperadoId ? { itemEsperadoId } : {}),
      actualizadoEn: serverTimestamp(),
    });
    batch.update(doc(db, 'comprobantes', comp.id), {
      estado:       'vinculado',
      actualizadoEn: serverTimestamp(),
    });
    await batch.commit();
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// Ramas 2/3: marcar comprobante vinculado tras crear el movimiento desde AltaMovimiento
export async function marcarVinculado(compId: string): Promise<Resultado<void>> {
  try {
    await updateDoc(doc(db, 'comprobantes', compId), {
      estado:       'vinculado',
      actualizadoEn: serverTimestamp(),
    });
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}
