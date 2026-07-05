import {
  collection, doc, addDoc, getDocs, updateDoc,
  query, orderBy, Timestamp, arrayUnion,
} from 'firebase/firestore';
import { db } from '../firebase';

export type MetricasSnap = {
  totalInvertibleUsd: number;
  energiaArPct: number;
  paisArPct: number;
  criptoPct: number;
  top1Ticker: string;
  top1Pct: number;
  hhi: number;
  valoresTickers: Record<string, number>;
};

export type RevisionDecision = {
  tipo: '30d' | '90d';
  fecha: Timestamp;
  notas: string;
  metricasAlRevisar: MetricasSnap;
};

export type DecisionPatrimonio = {
  id: string;
  creadaEn: Timestamp;
  titulo: string;
  razon: string;
  tickers: string[];
  opcionReferencia: 'A' | 'B' | 'C' | null;
  metricasAlCrear: MetricasSnap;
  revisiones: RevisionDecision[];
  estado: 'abierta' | 'revisada30' | 'revisada90' | 'cerrada';
};

export type NuevaDecision = {
  titulo: string;
  razon: string;
  tickers: string[];
  opcionReferencia: 'A' | 'B' | 'C' | null;
  metricasAlCrear: MetricasSnap;
};

export async function cargarDecisiones(): Promise<DecisionPatrimonio[]> {
  const snap = await getDocs(
    query(collection(db, 'decisionesPatrimonio'), orderBy('creadaEn', 'desc'))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as DecisionPatrimonio);
}

export async function crearDecision(nueva: NuevaDecision): Promise<DecisionPatrimonio> {
  const ahora = Timestamp.now();
  const ref = await addDoc(collection(db, 'decisionesPatrimonio'), {
    ...nueva,
    creadaEn: ahora,
    revisiones: [],
    estado: 'abierta',
  });
  return {
    id: ref.id,
    ...nueva,
    creadaEn: ahora,
    revisiones: [],
    estado: 'abierta',
  };
}

export async function agregarRevision(
  decisionId: string,
  tipo: '30d' | '90d',
  notas: string,
  metricasAlRevisar: MetricasSnap,
  estadoNuevo: DecisionPatrimonio['estado'],
): Promise<RevisionDecision> {
  const rev: RevisionDecision = { tipo, fecha: Timestamp.now(), notas, metricasAlRevisar };
  await updateDoc(doc(db, 'decisionesPatrimonio', decisionId), {
    revisiones: arrayUnion(rev),
    estado: estadoNuevo,
  });
  return rev;
}

export function revisionPendiente(d: DecisionPatrimonio): '30d' | '90d' | null {
  const ahora = Date.now();
  const creadoMs = d.creadaEn.toMillis();
  const tiene30 = d.revisiones.some(r => r.tipo === '30d');
  const tiene90 = d.revisiones.some(r => r.tipo === '90d');
  if (!tiene90 && creadoMs + 90 * 86400000 < ahora) return '90d';
  if (!tiene30 && creadoMs + 30 * 86400000 < ahora) return '30d';
  return null;
}
