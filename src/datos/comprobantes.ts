import { doc, getDoc, setDoc, serverTimestamp, type DocumentData } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import { sha256Archivo } from './hashArchivo';
import type { Comprobante } from '../types';

function docAComprobante(id: string, data: DocumentData): Comprobante {
  return {
    id,
    hashPdf:       data.hashPdf,
    nombreArchivo: data.nombreArchivo,
    contentType:   data.contentType,
    tamano:        data.tamano,
    refStoragePdf: data.refStoragePdf,
    subidoPor:     data.subidoPor,
    subidoEn:      data.subidoEn?.toDate() ?? new Date(0),
    estado:        data.estado,
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
