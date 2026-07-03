import {
  doc, getDoc, setDoc, serverTimestamp, writeBatch,
  collection, query, orderBy, where, limit, getDocs, type DocumentData,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { db, storage, functions } from '../firebase';
import { sha256Archivo } from './hashArchivo';
import type { Comprobante, PropuestaMatch } from '../types';

type Resultado<T> = { ok: true; data: T } | { ok: false; error: Error };

export function docAComprobante(id: string, data: DocumentData): Comprobante {
  const pm = data.propuestaMatch as Record<string, unknown> | null | undefined;
  const dd = pm?.dedupInfo as Record<string, unknown> | null | undefined;
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
      rama:                pm.rama                as PropuestaMatch['rama'],
      movimientoId:        pm.movimientoId        as string | undefined,
      itemEsperadoId:      pm.itemEsperadoId      as string | undefined,
      candidatos:          pm.candidatos          as PropuestaMatch['candidatos'],
      calculadoEn:         (pm.calculadoEn as { toDate?: () => Date } | null)?.toDate?.() ?? new Date(),
      origenDestino:       (pm.origenDestino      as boolean | undefined),
      esAdicional:         (pm.esAdicional        as boolean | undefined),
      categoriaPrellena:   (pm.categoriaPrellena  as string | null | undefined),
      subcategoriaPrellena:(pm.subcategoriaPrellena as string | null | undefined),
      etiquetaPrellena:    (pm.etiquetaPrellena   as string | null | undefined),
      dedupInfo: dd ? {
        movId: dd.movId as string,
        mes:   (dd.mes   as string | null) ?? null,
        monto: (dd.monto as number | null) ?? null,
        item:  (dd.item  as string | null | undefined),
      } : undefined,
      origenReconciliacion: (pm.origenReconciliacion as boolean | undefined),
      reconciliacionDebil:  (pm.reconciliacionDebil  as boolean | undefined),
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

function hoyArgentinaISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}

// Fecha de comprobante (YYYY-MM-DD) ≤ hoy en Argentina → ya se pagó
export function confirmadoPagoPorFecha(fechaISO: string | null | undefined): boolean {
  if (!fechaISO) return false;
  return fechaISO <= hoyArgentinaISO();
}

// F9.75 — twin de esObligacionDoc del server (matchLogica/index). Mantener en sync manual.
export function esObligacionDoc(tipo?: string | null): boolean {
  return tipo === 'recibo_servicio'
      || tipo === 'factura_a' || tipo === 'factura_b' || tipo === 'factura_c';
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
      hashPdf:        comp.hashPdf,
      refStoragePdf:  comp.refStoragePdf,
      // F9.75 — si es obligación, NO tocar confirmadoPago del movimiento existente (preservar el
      // estado del pago real). Solo pagos/tickets confirman por fecha.
      ...(esObligacionDoc(comp.datosExtraidos?.tipoDocumento)
        ? {}
        : { confirmadoPago: confirmadoPagoPorFecha(comp.datosExtraidos?.vencimientos?.[0]?.fecha ?? comp.datosExtraidos?.fecha) }),
      ...(itemEsperadoId ? { itemEsperadoId } : {}),
      // F6.8 — propagar destino y vencimientos para que aprenderDestino() aprenda
      // seedImport: false — gradúa el mov de "seed pristino" a "tocado por usuario"
      //             para que aprenderMovimientoActualizado no lo saltee
      seedImport: false,
      // F9.82 — merge conservador: no pisar payee del emisor con null
      // (el pago suele traer menos datos que la factura: BBVA no trae CUIT)
      ...(comp.datosExtraidos?.destinoCbu    ? { destinoCbu:    comp.datosExtraidos.destinoCbu }    : {}),
      ...(comp.datosExtraidos?.destinoCuit   ? { destinoCuit:   comp.datosExtraidos.destinoCuit }   : {}),
      ...(comp.datosExtraidos?.destinoAlias  ? { destinoAlias:  comp.datosExtraidos.destinoAlias }  : {}),
      ...(comp.datosExtraidos?.destinoNombre ? { destinoNombre: comp.datosExtraidos.destinoNombre } : {}),
      ...(comp.datosExtraidos?.vencimientos?.length ? { vencimientos: comp.datosExtraidos.vencimientos } : {}),
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

// Ramas 2/3: callable server-side (Admin SDK) — crea el movimiento del dependiente/admin
// dueño del comprobante y lo marca vinculado en un único batch atómico. Reglas de Firestore
// no se tocan (comprobantes:update y movimientos:create siguen admin-only para el cliente).
export async function cargarMovimientoDesdeComprobante(
  compId: string,
  payload: Record<string, unknown>,
): Promise<Resultado<{ movimientoId: string }>> {
  try {
    const fn  = httpsCallable(functions, 'cargarMovimientoDesdeComprobante');
    const res = await fn({ compId, payload });
    return { ok: true, data: res.data as { movimientoId: string } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// F9.82 — picker "Conciliar con gasto esperado": busca obligación abierta para un item
export async function buscarObligacionAbierta(
  itemEsperadoId: string,
  mes: string,
): Promise<string | null> {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'movimientos'),
        where('itemEsperadoId', '==', itemEsperadoId),
        where('confirmadoPago', '==', false),
        where('mes', '==', mes),
        limit(5),
      ),
    );
    return snap.empty ? null : snap.docs[0].id;
  } catch {
    return null;
  }
}
