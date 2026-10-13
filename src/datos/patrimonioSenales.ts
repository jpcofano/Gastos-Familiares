// F9.190 §2 — lectura de las señales de mercado de la reserva. La evaluación es pura y vive en
// patrimonioInformeV2.ts; acá solo Firestore y la callable.
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';
import type { LecturaMercado, BasesMercado } from './patrimonioInformeV2';

export type EstadoSenales = { lectura: LecturaMercado | null; bases: BasesMercado | null };

/** Última lectura guardada. `{null, null}` si nunca se leyó. Rechaza si Firestore falla. */
export async function cargarUltimaLecturaSenales(): Promise<EstadoSenales> {
  const snap = await getDoc(doc(db, 'senalesMercado', 'ultima'));
  if (!snap.exists()) return { lectura: null, bases: null };
  const d = snap.data();
  return {
    lectura: (d.lectura as LecturaMercado | undefined) ?? null,
    bases: (d.bases as BasesMercado | undefined) ?? null,
  };
}

const _leer = httpsCallable<{ reiniciarBase?: boolean }, EstadoSenales>(functions, 'leerSenalesMercado');

/** Lee las fuentes ahora (server-side) y devuelve la lectura nueva. */
export async function actualizarSenales(reiniciarBase = false): Promise<EstadoSenales> {
  const r = await _leer({ reiniciarBase });
  return r.data;
}
