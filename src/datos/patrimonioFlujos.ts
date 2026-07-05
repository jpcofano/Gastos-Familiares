import {
  collection, doc, addDoc, getDocs, updateDoc, deleteDoc,
  query, orderBy, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { SnapshotResumen } from './patrimonio';

export type FlujoPatrimonio = {
  id: string;
  fecha: Timestamp;
  tipo: 'aporte' | 'retiro';
  montoUsd: number;
  cuenta: string | null;
  nota: string;
};

export type NuevoFlujo = {
  fecha: Timestamp;
  tipo: 'aporte' | 'retiro';
  montoUsd: number;
  cuenta: string | null;
  nota: string;
};

export async function cargarFlujos(): Promise<FlujoPatrimonio[]> {
  const snap = await getDocs(
    query(collection(db, 'flujosPatrimonio'), orderBy('fecha', 'desc'))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as FlujoPatrimonio);
}

export async function crearFlujo(nuevo: NuevoFlujo): Promise<FlujoPatrimonio> {
  const ref = await addDoc(collection(db, 'flujosPatrimonio'), nuevo);
  return { id: ref.id, ...nuevo };
}

export async function actualizarFlujo(id: string, cambios: Partial<NuevoFlujo>): Promise<void> {
  await updateDoc(doc(db, 'flujosPatrimonio', id), cambios);
}

export async function eliminarFlujo(id: string): Promise<void> {
  await deleteDoc(doc(db, 'flujosPatrimonio', id));
}

// ── Cálculo de retorno (Modified Dietz, peso 0.5) ────────────────────────────
// Entre cada par de snapshots consecutivos calcula R = (V1 - V0 - F) / (V0 + 0.5*F)
// donde F = flujo neto (aportes - retiros) entre ambas fechas.
// Si no hay flujos en el período, queda el retorno simple (V1-V0)/V0.
// El acumulado encadena: (1+R1)*(1+R2)*…-1
export type PeriodoRetorno = {
  fechaDesde: string;  // YYYY-MM-DD del snapshot anterior
  fechaHasta: string;  // YYYY-MM-DD del snapshot actual
  retornoPct: number;  // retorno del período como decimal (0.05 = 5%)
  flujoNeto: number;   // aporte - retiro en USD
};

export function calcRetorno(
  historial: SnapshotResumen[],
  flujos: FlujoPatrimonio[]
): { periodos: PeriodoRetorno[]; acumulado: number } | null {
  // historial viene ordenado desc (más reciente primero)
  if (historial.length < 2) return null;

  const periodos: PeriodoRetorno[] = [];

  // Recorremos de más antiguo a más reciente para encadenar bien
  for (let i = historial.length - 1; i > 0; i--) {
    const snap0 = historial[i];    // anterior (más viejo)
    const snap1 = historial[i - 1]; // siguiente (más nuevo)

    const t0 = new Date(snap0.fechaCorrida).getTime();
    const t1 = new Date(snap1.fechaCorrida).getTime();

    // Flujos que caen estrictamente entre t0 (excl.) y t1 (incl.)
    const flujosPeriodo = flujos.filter(f => {
      const tf = f.fecha.toMillis();
      return tf > t0 && tf <= t1;
    });

    const flujoNeto = flujosPeriodo.reduce((s, f) =>
      s + (f.tipo === 'aporte' ? f.montoUsd : -f.montoUsd), 0
    );

    const v0 = snap0.totalInvertibleUsd;
    const v1 = snap1.totalInvertibleUsd;
    const denominador = v0 + 0.5 * flujoNeto;
    const retornoPct = denominador !== 0
      ? (v1 - v0 - flujoNeto) / denominador
      : 0;

    periodos.push({
      fechaDesde: snap0.fechaCorrida,
      fechaHasta: snap1.fechaCorrida,
      retornoPct,
      flujoNeto,
    });
  }

  const acumulado = periodos.reduce((acc, p) => acc * (1 + p.retornoPct), 1) - 1;

  return { periodos, acumulado };
}
