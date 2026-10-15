// F9.195 (sistema cripto) — Firestore y callable del sistema cripto. La evaluación es pura y vive en
// patrimonioCripto.ts; acá solo lectura de `criptoLectura`, `criptoHistorial`, la política
// `configPatrimonio/cripto` y la callable del botón "Actualizar".
import { httpsCallable } from 'firebase/functions';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';
import {
  CRIPTO_DEFAULTS, GRUPOS_CRIPTO, validarPoliticaCripto,
  type BasesCripto, type DiaCripto, type LecturaCripto, type PoliticaCripto,
} from './patrimonioCripto';

export type EstadoCripto = { lectura: LecturaCripto | null; bases: BasesCripto | null; cantidadesDeFecha: string | null };

/** Última lectura guardada. Todo null si nunca se leyó. Rechaza si Firestore falla. */
export async function cargarLecturaCripto(): Promise<EstadoCripto> {
  const snap = await getDoc(doc(db, 'criptoLectura', 'ultima'));
  if (!snap.exists()) return { lectura: null, bases: null, cantidadesDeFecha: null };
  const d = snap.data();
  return {
    lectura: { leidoEnISO: d.leidoEnISO as string, precios: d.precios ?? {}, sondeo: d.sondeo ?? [] },
    bases: (d.bases as BasesCripto | undefined) ?? null,
    cantidadesDeFecha: (d.cantidadesDeFecha as string | null | undefined) ?? null,
  };
}

/** Serie diaria completa (un doc por día; para el máximo del freno). */
export async function cargarHistorialCripto(): Promise<DiaCripto[]> {
  const snap = await getDocs(collection(db, 'criptoHistorial'));
  return snap.docs.map(d => {
    const x = d.data();
    return { fecha: d.id, valorSistemaUsd: Number(x.valorSistemaUsd) || 0, completo: x.completo === true };
  });
}

const _leer = httpsCallable<{ reiniciarBase?: boolean }, EstadoCripto>(functions, 'leerPreciosCriptoAhora');

/** Lee los precios ahora (server-side), guarda lectura e historial del día y devuelve la lectura. */
export async function actualizarPreciosCripto(reiniciarBase = false): Promise<EstadoCripto> {
  const r = await _leer({ reiniciarBase });
  return r.data;
}

// ── Política (§2) ─────────────────────────────────────────────────────────────
// Misma forma que cargarConfigRiesgo: sin doc, valores iniciales y la card lo aclara.
export async function cargarPoliticaCripto(): Promise<{ politica: PoliticaCripto; configurada: boolean }> {
  const snap = await getDoc(doc(db, 'configPatrimonio', 'cripto'));
  if (!snap.exists()) return { politica: CRIPTO_DEFAULTS, configurada: false };
  const d = snap.data();
  const n = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  const obj = (d.objetivo ?? {}) as Record<string, unknown>;
  return {
    politica: {
      objetivo: Object.fromEntries(GRUPOS_CRIPTO.map(g => [g, n(obj[g], CRIPTO_DEFAULTS.objetivo[g])])) as PoliticaCripto['objetivo'],
      bandaPts: n(d.bandaPts, CRIPTO_DEFAULTS.bandaPts),
      topePlataformaPct: n(d.topePlataformaPct, CRIPTO_DEFAULTS.topePlataformaPct),
      frenoCaidaPct: n(d.frenoCaidaPct, CRIPTO_DEFAULTS.frenoCaidaPct),
      tramosBtc: Array.isArray(d.tramosBtc) && d.tramosBtc.every((t: unknown) => typeof t === 'number')
        ? d.tramosBtc as number[] : CRIPTO_DEFAULTS.tramosBtc,
    },
    configurada: true,
  };
}

/** Valida antes de escribir: una política que no suma 100% no llega a Firestore. */
export async function guardarPoliticaCripto(p: PoliticaCripto): Promise<void> {
  const errores = validarPoliticaCripto(p);
  if (errores.length) throw new Error(errores.join(' '));
  await setDoc(doc(db, 'configPatrimonio', 'cripto'), p);
}
