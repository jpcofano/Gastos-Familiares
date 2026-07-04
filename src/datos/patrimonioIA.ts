import { httpsCallable } from 'firebase/functions';
import {
  doc, getDoc, setDoc, getDocs, collection,
  query, orderBy, limit, type Timestamp,
} from 'firebase/firestore';
import { db, functions } from '../firebase';

// ── Tipos ─────────────────────────────────────────────────────────────────────
export type AnalisisPosicion = {
  ticker: string;
  generadoEnISO: string;
  modeloUsado: string;
  resultado: {
    queEs?: string;
    situacionActual?: string;
    riesgos?: string[];
    rolEnCartera?: string;
    proximosEventos?: string[];
    queHariaEnCadaCaso?: { caso: string; acciones: string[]; costo: string }[];
    senalesAVigilar?: string[];
    fuentes?: string[];
  };
};

export type AnalisisSectorial = {
  id: string;
  generadoEnISO: string;
  modeloUsado: string;
  resultado: string;
};

export type ConfigIA = { habilitado: boolean };

// ── Config ────────────────────────────────────────────────────────────────────
export async function cargarConfigIA(): Promise<ConfigIA> {
  const snap = await getDoc(doc(db, 'configPatrimonio', 'ia'));
  if (!snap.exists()) return { habilitado: false };
  return { habilitado: (snap.data().habilitado as boolean) ?? false };
}

export async function guardarConfigIA(cfg: ConfigIA): Promise<void> {
  await setDoc(doc(db, 'configPatrimonio', 'ia'), cfg, { merge: true });
}

// ── Caché de análisis ─────────────────────────────────────────────────────────
export async function cargarAnalisisPosicion(ticker: string): Promise<AnalisisPosicion | null> {
  const snap = await getDoc(doc(db, 'analisisPosiciones', ticker));
  if (!snap.exists()) return null;
  const data = snap.data();
  const ts = data.generadoEn as Timestamp | null;
  return {
    ticker,
    generadoEnISO: ts?.toDate?.()?.toISOString() ?? '',
    modeloUsado: (data.modeloUsado as string) ?? '',
    resultado: (data.resultado as AnalisisPosicion['resultado']) ?? {},
  };
}

export async function cargarTodosLosAnalisis(): Promise<AnalisisPosicion[]> {
  const snap = await getDocs(collection(db, 'analisisPosiciones'));
  return snap.docs.map(d => {
    const data = d.data();
    const ts = data.generadoEn as Timestamp | null;
    return {
      ticker: d.id,
      generadoEnISO: ts?.toDate?.()?.toISOString() ?? '',
      modeloUsado: (data.modeloUsado as string) ?? '',
      resultado: (data.resultado as AnalisisPosicion['resultado']) ?? {},
    };
  });
}

export async function cargarUltimoSectorial(): Promise<AnalisisSectorial | null> {
  const snap = await getDocs(
    query(collection(db, 'analisisSectorial'), orderBy('generadoEn', 'desc'), limit(1))
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  const data = d.data();
  const ts = data.generadoEn as Timestamp | null;
  return {
    id: d.id,
    generadoEnISO: ts?.toDate?.()?.toISOString() ?? '',
    modeloUsado: (data.modeloUsado as string) ?? '',
    resultado: (data.resultado as string) ?? '',
  };
}

// ── Callable wrapper ──────────────────────────────────────────────────────────
const _analizarConIA = httpsCallable<
  { modo: 'posicion' | 'sectorial'; ticker?: string; contexto: Record<string, unknown> },
  { ok: boolean; resultado: unknown }
>(functions, 'analizarConIA');

export async function analizarPosicion(
  ticker: string,
  contexto: Record<string, unknown>,
): Promise<AnalisisPosicion> {
  await _analizarConIA({ modo: 'posicion', ticker, contexto });
  const result = await cargarAnalisisPosicion(ticker);
  if (!result) throw new Error('Análisis no encontrado tras generación');
  return result;
}

export async function analizarSectorial(
  contexto: Record<string, unknown>,
): Promise<AnalisisSectorial> {
  await _analizarConIA({ modo: 'sectorial', contexto });
  const result = await cargarUltimoSectorial();
  if (!result) throw new Error('Sectorial no encontrado tras generación');
  return result;
}
