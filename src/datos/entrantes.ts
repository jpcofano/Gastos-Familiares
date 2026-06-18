import {
  doc, setDoc, getDoc, onSnapshot, query, collection,
  orderBy, where, limit, serverTimestamp, type DocumentData, type Unsubscribe,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { db, storage, functions } from '../firebase';
import { sha256Archivo } from './hashArchivo';
import type { Entrante } from '../types';

type Resultado<T> = { ok: true; data: T } | { ok: false; error: Error };

function docAEntrante(id: string, data: DocumentData): Entrante {
  return {
    hash:            id,
    rutaStorage:     data.rutaStorage     ?? '',
    mimeType:        data.mimeType        ?? '',
    nombreArchivo:   data.nombreArchivo   ?? null,
    tamano:          data.tamano          ?? null,
    creadoPor:       data.creadoPor       ?? '',
    origen:          data.origen          ?? 'app',
    estado:          data.estado          ?? 'pendiente',
    tipoDetectado:   data.tipoDetectado,
    destino:         data.destino,
    motivoDeteccion: data.motivoDeteccion,
    creadoEn:        data.creadoEn?.toDate()      ?? new Date(0),
    actualizadoEn:   data.actualizadoEn?.toDate() ?? new Date(0),
  };
}

type ResultadoSubida =
  | { ok: true; duplicado: true;  entrante: Entrante }
  | { ok: true; duplicado: false; entrante: Entrante }
  | { ok: false; error: Error };

export async function subirEntrante(
  file: File,
  memberId: string,
  origen: 'app' | 'share_target',
): Promise<ResultadoSubida> {
  try {
    const hash   = await sha256Archivo(file);
    const docRef = doc(db, 'entrantes', hash);
    const snap   = await getDoc(docRef);

    if (snap.exists()) {
      return { ok: true, duplicado: true, entrante: docAEntrante(snap.id, snap.data()) };
    }

    const storagePath = `entrantes/${hash}`;
    await uploadBytes(ref(storage, storagePath), file, {
      contentType: file.type,
      customMetadata: { nombreArchivo: file.name },
    });

    await setDoc(docRef, {
      hash,
      rutaStorage:   storagePath,
      mimeType:      file.type,
      nombreArchivo: file.name,
      tamano:        file.size,
      creadoPor:     memberId,
      origen,
      estado:        'pendiente',
      creadoEn:      serverTimestamp(),
      actualizadoEn: serverTimestamp(),
    });

    const entrante: Entrante = {
      hash, rutaStorage: storagePath, mimeType: file.type,
      nombreArchivo: file.name, tamano: file.size,
      creadoPor: memberId, origen, estado: 'pendiente',
      creadoEn: new Date(), actualizadoEn: new Date(),
    };
    return { ok: true, duplicado: false, entrante };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// Admin: todos; dependiente: solo los propios (exigido por reglas Firestore)
export function suscribirEntrantes(
  memberId: string,
  esAdmin: boolean,
  callback: (entrantes: Entrante[]) => void,
): Unsubscribe {
  const q = esAdmin
    ? query(collection(db, 'entrantes'), orderBy('creadoEn', 'desc'), limit(50))
    : query(collection(db, 'entrantes'), where('creadoPor', '==', memberId), orderBy('creadoEn', 'desc'), limit(20));
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => docAEntrante(d.id, d.data()))),
    () => callback([]),
  );
}

export async function resolverEntranteAmbiguo(
  hash: string,
  tipo: 'comprobante' | 'resumen',
): Promise<Resultado<void>> {
  try {
    const fn = httpsCallable(functions, 'resolverEntranteAmbiguo');
    await fn({ hash, tipo });
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}
