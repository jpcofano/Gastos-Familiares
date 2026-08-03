import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, orderBy, where, limit, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { cargarFlujos, calcRetorno } from './patrimonioFlujos';
import { RIESGO_DEFAULTS, type TopesRiesgo } from './patrimonioRiesgo';
import type { Posicion, ActivoFijo, MetaCorrida, PosicionManual, PosicionRaw, CorraidaJSON } from '../types/patrimonio';

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

// ── F9.116 §3 — Política de riesgo ────────────────────────────────────────────
// Los cuatro números que declara el titular. Se guardan como FRACCIÓN (0.20 = 20%), la
// convención de patrimonioRiesgo.ts; el formulario convierte en su borde.
// Sin doc en Firestore la app usa RIESGO_DEFAULTS y la card lo aclara en pantalla.
export async function cargarConfigRiesgo(): Promise<{ topes: TopesRiesgo; configurado: boolean }> {
  const snap = await getDoc(doc(db, 'configPatrimonio', 'riesgo'));
  if (!snap.exists()) return { topes: RIESGO_DEFAULTS, configurado: false };
  const d = snap.data();
  const num = (k: keyof TopesRiesgo) => (typeof d[k] === 'number' ? (d[k] as number) : RIESGO_DEFAULTS[k]);
  return {
    topes: {
      toleranciaCaidaPct: num('toleranciaCaidaPct'),
      topePosicionPct:    num('topePosicionPct'),
      topeDriverPct:      num('topeDriverPct'),
      pisoCajaPct:        num('pisoCajaPct'),
    },
    configurado: true,
  };
}

export async function guardarConfigRiesgo(topes: TopesRiesgo): Promise<void> {
  await setDoc(doc(db, 'configPatrimonio', 'riesgo'), topes, { merge: true });
}

// ── F9.115 — Exportar corrida y dossier ───────────────────────────────────────
// La app ingería corridas pero no las devolvía: el .txt existía sólo donde el usuario lo
// hubiera guardado al generarlo. Los datos estaban en Firestore pero eran inaccesibles
// fuera de la UI.

// Posicion → PosicionRaw: se descartan los tres campos derivados que agrega la ingesta
// (valorUsd, tcUsado, fechaCorrida) y quedan los 11 del schema. Al reimportar, la ingesta
// los recalcula con tcParaFecha(fecha_corrida), así que el round-trip da el mismo valorUsd.
function aPosicionRaw(p: Posicion): PosicionRaw {
  return {
    cuenta: p.cuenta,
    titular: p.titular,
    ticker: p.ticker,
    tipo: p.tipo,
    sector: p.sector,
    pais_riesgo: p.pais_riesgo,
    moneda_origen: p.moneda_origen,
    valor_origen: p.valor_origen,
    cantidad: p.cantidad,
    fuente: p.fuente,
    revisar: p.revisar,
  };
}

// Arma el CorraidaJSON de una corrida (la vigente si no se pasa fecha). Compartido por el
// export .txt y el dossier. Devuelve null si esa corrida no existe; no lanza — cualquier
// fallo real se loguea con el error de verdad y también devuelve null.
async function armarCorrida(fechaCorrida?: string): Promise<{ fechaCorrida: string; corrida: CorraidaJSON } | null> {
  try {
    let fecha = fechaCorrida;
    let totalInvertibleUsd: number;
    let fuentes: string[];

    if (fecha) {
      const snap = await getDoc(doc(db, 'snapshotsPortafolio', fecha));
      if (!snap.exists()) return null;
      const d = snap.data();
      totalInvertibleUsd = (d.totalInvertibleUsd as number) ?? 0;
      fuentes = (d.fuentes as string[]) ?? [];
    } else {
      const vigente = await cargarSnapshotVigente();
      if (!vigente) return null;
      fecha = vigente.fechaCorrida;
      totalInvertibleUsd = vigente.totalInvertibleUsd;
      fuentes = vigente.fuentes;
    }

    const posSnap = await getDocs(
      query(collection(db, 'posicionesPatrimonio'), where('fechaCorrida', '==', fecha))
    );
    const posiciones = posSnap.docs.map(d => aPosicionRaw(d.data() as Posicion));
    if (posiciones.length === 0) return null;

    const meta: MetaCorrida = {
      fecha_corrida: fecha,
      entidad: 'familia',
      // El validador de la ingesta exige fuentes no vacío y total > 0: si el snapshot no
      // los trae, el archivo exportado sería irreimportable.
      fuentes: fuentes.length > 0 ? fuentes : ['export'],
      total_declarado_usd: totalInvertibleUsd,
    };
    return { fechaCorrida: fecha, corrida: { meta, posiciones } };
  } catch (err) {
    console.error('[armarCorrida] falló la lectura de la corrida:', err);
    return null;
  }
}

// Corrida vigente (o la que se pida) como .txt re-importable en la ingesta.
export async function exportarCorridaTxt(
  fechaCorrida?: string,
): Promise<{ nombre: string; contenido: string } | null> {
  const armada = await armarCorrida(fechaCorrida);
  if (!armada) return null;
  return {
    nombre: `patrimonio_${armada.fechaCorrida}.txt`,
    contenido: JSON.stringify(armada.corrida, null, 2),
  };
}

export type Dossier = {
  generadoEn: string;
  corrida: CorraidaJSON;
  manuales: PosicionManual[];
  flujos: Array<{ fecha: string; tipo: 'aporte' | 'retiro'; montoUsd: number; cuenta: string | null; nota: string }>;
  historial: SnapshotResumen[];
  retorno: ReturnType<typeof calcRetorno>;
};

// Dossier para análisis externo. Propósito distinto al .txt: NO es re-importable.
// Fail-soft por bloque: un bloque caído (flujos, historial, manuales) nunca aborta el
// dossier — se exporta vacío y se loguea el error real, nunca un mensaje hardcodeado.
export async function exportarDossierJson(
  fechaCorrida?: string,
): Promise<{ nombre: string; contenido: string } | null> {
  const armada = await armarCorrida(fechaCorrida);
  if (!armada) return null;

  const manuales = await cargarPosicionesManuales().catch(err => {
    console.error('[exportarDossierJson] cargarPosicionesManuales falló:', err);
    return [] as PosicionManual[];
  });
  const flujosRaw = await cargarFlujos().catch(err => {
    console.error('[exportarDossierJson] cargarFlujos falló:', err);
    return [];
  });
  const historial = await cargarHistorialSnapshots(24).catch(err => {
    console.error('[exportarDossierJson] cargarHistorialSnapshots falló:', err);
    return [] as SnapshotResumen[];
  });

  const flujos = flujosRaw.map(f => ({
    fecha: f.fecha.toDate().toISOString(),
    tipo: f.tipo,
    montoUsd: f.montoUsd,
    cuenta: f.cuenta,
    nota: f.nota,
  }));

  // Sin flujos registrados el número no es un retorno sino una variación de valor bruta
  // (misma distinción que ya hace la card de Resumen): se devuelve null antes que un dato
  // que parece retorno y no lo es.
  const dossier: Dossier = {
    generadoEn: new Date().toISOString(),
    corrida: armada.corrida,
    manuales,
    flujos,
    historial,
    retorno: flujosRaw.length > 0 ? calcRetorno(historial, flujosRaw) : null,
  };

  return {
    nombre: `dossier_patrimonio_${armada.fechaCorrida}.json`,
    contenido: JSON.stringify(dossier, null, 2),
  };
}
