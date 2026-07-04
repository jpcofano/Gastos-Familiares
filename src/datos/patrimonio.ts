import {
  collection, doc, getDocs, setDoc, deleteDoc,
  query, orderBy, where, limit, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Posicion, ActivoFijo, MetaCorrida, PosicionManual } from '../types/patrimonio';

const ACTIVOS_SEED: ActivoFijo[] = [
  { id: 'propiedad', nombre: 'Propiedad', valorUsd: 220000, pais: 'AR', notas: '' },
  { id: 'auto',      nombre: 'Auto',      valorUsd: 10000,  pais: 'AR', notas: '' },
];

export async function cargarSnapshotVigente(): Promise<{
  fechaCorrida: string;
  totalInvertibleUsd: number;
  totalFijosUsd: number;
  totalPatrimonioUsd: number;
  cantidadPosiciones: number;
  fuentes: string[];
} | null> {
  const snap = await getDocs(
    query(collection(db, 'snapshotsPortafolio'), orderBy('fechaCorrida', 'desc'), limit(1))
  );
  if (snap.empty) return null;
  const d = snap.docs[0].data();
  return {
    fechaCorrida: d.fechaCorrida as string,
    totalInvertibleUsd: d.totalInvertibleUsd as number,
    totalFijosUsd: d.totalFijosUsd as number,
    totalPatrimonioUsd: d.totalPatrimonioUsd as number,
    cantidadPosiciones: d.cantidadPosiciones as number,
    fuentes: (d.fuentes as string[]) ?? [],
  };
}

export async function cargarPosicionesVigentes(): Promise<Posicion[]> {
  const snapshot = await cargarSnapshotVigente();
  if (!snapshot) return [];
  const snap = await getDocs(
    query(collection(db, 'posicionesPatrimonio'), where('fechaCorrida', '==', snapshot.fechaCorrida))
  );
  return snap.docs.map(d => d.data() as Posicion);
}

export async function cargarActivosFijos(): Promise<ActivoFijo[]> {
  const snap = await getDocs(collection(db, 'activosFijos'));
  if (snap.empty) {
    await Promise.all(ACTIVOS_SEED.map(af => setDoc(doc(db, 'activosFijos', af.id), af)));
    return ACTIVOS_SEED;
  }
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as ActivoFijo);
}

export async function guardarActivoFijo(af: ActivoFijo): Promise<void> {
  await setDoc(doc(db, 'activosFijos', af.id), af);
}

export async function eliminarActivoFijo(id: string): Promise<void> {
  await deleteDoc(doc(db, 'activosFijos', id));
}

// ── Posiciones manuales (planes de empleado, etc.) ────────────────────────────
const MANUALES_SEED: PosicionManual[] = [
  { id: 'acn',  ticker: 'ACN',  nombre: 'Accenture', cantidad: 50, valorUsd: 6870,
    fechaValuacion: '2026-07-02', tipo: 'accion', sector: 'tech', pais_riesgo: 'global',
    cuenta: 'Plan empleado ACN',  notas: '~USD 137,35/acción al 02/07/2026' },
  { id: 'glob', ticker: 'GLOB', nombre: 'Globant',   cantidad: 50, valorUsd: 1626,
    fechaValuacion: '2026-07-03', tipo: 'accion', sector: 'tech', pais_riesgo: 'global',
    cuenta: 'Plan empleado GLOB', notas: '~USD 32,51/acción al 03/07/2026' },
];

export async function cargarPosicionesManuales(): Promise<PosicionManual[]> {
  const snap = await getDocs(collection(db, 'posicionesManuales'));
  if (snap.empty) {
    await Promise.all(MANUALES_SEED.map(pm => setDoc(doc(db, 'posicionesManuales', pm.id), pm)));
    return MANUALES_SEED;
  }
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as PosicionManual);
}

export async function guardarPosicionManual(pm: PosicionManual): Promise<void> {
  await setDoc(doc(db, 'posicionesManuales', pm.id), pm);
}

export async function eliminarPosicionManual(id: string): Promise<void> {
  await deleteDoc(doc(db, 'posicionesManuales', id));
}

export type SnapshotResumen = {
  fechaCorrida: string;
  totalInvertibleUsd: number;
  totalFijosUsd: number;
  totalPatrimonioUsd: number;
};

export async function cargarHistorialSnapshots(limite = 10): Promise<SnapshotResumen[]> {
  const snap = await getDocs(
    query(collection(db, 'snapshotsPortafolio'), orderBy('fechaCorrida', 'desc'), limit(limite))
  );
  return snap.docs.map(d => {
    const data = d.data();
    return {
      fechaCorrida: data.fechaCorrida as string,
      totalInvertibleUsd: (data.totalInvertibleUsd ?? 0) as number,
      totalFijosUsd: (data.totalFijosUsd ?? 0) as number,
      totalPatrimonioUsd: (data.totalPatrimonioUsd ?? 0) as number,
    };
  });
}

export async function confirmarIngesta(
  posiciones: Posicion[],
  meta: MetaCorrida,
  totalFijosUsd: number,
  totalManualesUsd: number,
  metricasJson: Record<string, unknown>,
): Promise<void> {
  const batch = writeBatch(db);

  for (const p of posiciones) {
    const ref = doc(collection(db, 'posicionesPatrimonio'));
    batch.set(ref, p);
  }

  const totalCorridaUsd = posiciones.reduce((s, p) => s + p.valorUsd, 0);
  const totalInvertibleUsd = totalCorridaUsd + totalManualesUsd;
  batch.set(doc(db, 'snapshotsPortafolio', meta.fecha_corrida), {
    fechaCorrida: meta.fecha_corrida,
    totalCorridaUsd,
    totalManualesUsd,
    totalInvertibleUsd,
    totalFijosUsd,
    totalPatrimonioUsd: totalInvertibleUsd + totalFijosUsd,
    tcUsado: posiciones.find(p => p.tcUsado != null)?.tcUsado ?? null,
    cantidadPosiciones: posiciones.length,
    fuentes: meta.fuentes,
    metricas: metricasJson,
    creadoEn: serverTimestamp(),
  });

  await batch.commit();
}
