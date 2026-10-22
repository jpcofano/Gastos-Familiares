// F9.196.1 §1.c — lectura del estado de los flujos automáticos (`flujosAuto/estado`, lo escribe
// `actualizarFlujosAutomaticos` en Functions) y las decisiones de Juan (`decisionesFlujo/{id}`) sobre
// lo que no apareó. Las Rules permiten al dueño escribir `decisionesFlujo`; `flujosAuto` es solo lectura.
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { idDecisionFlujo, type DecisionFlujo } from './compartido/patrimonioFlujosAuto';

/** Un movimiento resumido, como lo guarda `actualizarFlujosAutomaticos`. */
export type ResumenMovimientoFlujo = {
  clave: string;
  fecha: string;
  cuenta: string;
  tipo: 'deposito' | 'retiro' | string;
  moneda: 'ARS' | 'USD' | string;
  montoNeto: number;
  ticker: string | null;
  cantidad: number | null;
  origen?: string;
};

export type PendienteResumen = ResumenMovimientoFlujo & {
  sugerido: 'aporte' | 'retiro';
  /** Decidido, pero en especie sin valuación: no entra hasta tener precio. */
  motivo?: 'sin_valuacion';
  /** Con el TC de su fecha; null si no se pudo valuar. */
  montoUsd?: number | null;
};

export type EstadoFlujosAuto = {
  calculadoEn?: Timestamp;
  pendientes: PendienteResumen[];
  sinTc: ResumenMovimientoFlujo[];
  flujos: number;
  /** §1.a — sin par y anteriores a `desde`: solo se cuentan. */
  historial?: number;
  desde?: string;
  /** Claves que hoy generan un flujo automático. */
  clavesConFlujo?: string[];
};

export type DecisionGuardada = {
  id: string;
  clave: string;
  decision: DecisionFlujo;
  decididoEn?: Timestamp;
  resumen?: ResumenMovimientoFlujo;
};

export async function cargarEstadoFlujosAuto(): Promise<EstadoFlujosAuto | null> {
  const snap = await getDoc(doc(db, 'flujosAuto', 'estado'));
  if (!snap.exists()) return null;
  const d = snap.data() as Partial<EstadoFlujosAuto>;
  return { ...d, pendientes: d.pendientes ?? [], sinTc: d.sinTc ?? [], flujos: d.flujos ?? 0 } as EstadoFlujosAuto;
}

export async function cargarDecisionesFlujo(): Promise<DecisionGuardada[]> {
  const snap = await getDocs(collection(db, 'decisionesFlujo'));
  return snap.docs.map(d => {
    const x = d.data();
    return { id: d.id, clave: typeof x.clave === 'string' ? x.clave : d.id, decision: x.decision, decididoEn: x.decididoEn, resumen: x.resumen } as DecisionGuardada;
  }).filter(d => d.decision === 'aporte' || d.decision === 'retiro' || d.decision === 'interna');
}

/** Guarda (o cambia) la decisión de Juan. Se aplica cuando corren los flujos ("Aplicar" o el cron). */
export async function guardarDecisionFlujo(clave: string, decision: DecisionFlujo, resumen: ResumenMovimientoFlujo): Promise<void> {
  const id = idDecisionFlujo(clave);
  await setDoc(doc(db, 'decisionesFlujo', id), {
    decision, decididoEn: serverTimestamp(), resumen: JSON.parse(JSON.stringify(resumen)),
    ...(id !== clave ? { clave } : {}),
  });
}
