import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit,
} from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';

// ── Tipos ─────────────────────────────────────────────────────────────────────
export type CafciFondoConfig = {
  fondoId: string;
  claseId: string;
  nombre: string;
};

export type ConfigCafci = {
  fondos: CafciFondoConfig[];
};

export type CafciPosicion = {
  especieRaw: string;
  ticker: string | null;
  pesoPct: number;
  incompleto?: boolean;
};

export type CafciCartera = {
  id: string;
  fondoId: string;
  nombre: string;
  fechaDatos: string;   // YYYY-MM-DD
  fechaFetch: string;   // ISO
  posiciones: CafciPosicion[];
  totalPct: number;
};

// ── Config CAFCI ────���─────────────────────────────────────────────────────────
export async function cargarConfigCafci(): Promise<ConfigCafci> {
  const snap = await getDoc(doc(db, 'configPatrimonio', 'cafci'));
  if (!snap.exists()) return { fondos: [] };
  const data = snap.data() as { fondos?: CafciFondoConfig[] };
  return { fondos: data.fondos ?? [] };
}

export async function guardarConfigCafci(config: ConfigCafci): Promise<void> {
  await setDoc(doc(db, 'configPatrimonio', 'cafci'), config, { merge: true });
}

// ── Carteras ──────────────────────────────────────────────────────────────────
export async function cargarUltimasCarteras(): Promise<CafciCartera[]> {
  // Para cada fondoId, carga la corrida más reciente
  const snap = await getDocs(
    query(collection(db, 'cafciCarteras'), orderBy('fechaFetch', 'desc'), limit(50))
  );
  // Deduplica por fondoId: queda solo la última por fondo
  const seen = new Set<string>();
  const result: CafciCartera[] = [];
  for (const d of snap.docs) {
    const data = d.data() as Omit<CafciCartera, 'id'>;
    if (!seen.has(data.fondoId)) {
      seen.add(data.fondoId);
      result.push({ id: d.id, ...data });
    }
  }
  return result;
}

export async function cargarTodasLasCarteras(): Promise<CafciCartera[]> {
  const snap = await getDocs(
    query(collection(db, 'cafciCarteras'), orderBy('fechaFetch', 'desc'))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as CafciCartera);
}

// ── Mapping especie → ticker ───────────────────────────────────────────────────
export async function cargarMappings(): Promise<Record<string, string | null>> {
  const snap = await getDocs(collection(db, 'cafciMapping'));
  const result: Record<string, string | null> = {};
  for (const d of snap.docs) {
    result[d.id] = (d.data() as { ticker: string | null }).ticker;
  }
  return result;
}

export async function guardarMapping(especieNorm: string, ticker: string | null): Promise<void> {
  await setDoc(doc(db, 'cafciMapping', especieNorm), { ticker });
}

// ── Sincronización (callable) ──────────────────────────────────────────────────
export async function sincronizarCafci(): Promise<{ sincronizados: number; pendientesMapeo: string[] }> {
  const fn = httpsCallable<void, { sincronizados: number; pendientesMapeo: string[] }>(
    functions, 'sincronizarCafci'
  );
  const result = await fn();
  return result.data;
}

// ── Helpers de análisis para BenchmarkTab ─────────────────────────────────────
export type FilaBenchmark = {
  ticker: string;
  propioUsd: number | null;   // null si no está en cartera propia
  propioPct: number | null;   // % sobre total propio
  fondosAvgPct: number;       // promedio de los fondos
  fondosMinPct: number;
  fondosMaxPct: number;
  fondosStdPct: number;
  divergencia: number;        // |propioPct - fondosAvgPct|, para ordenar
};

export function calcBenchmark(
  posicionesPropias: Array<{ ticker: string; valorUsd: number }>,
  carteras: CafciCartera[],
  mappings: Record<string, string | null>
): {
  filas: FilaBenchmark[];
  soloenFondos: Array<{ ticker: string; avgPct: number }>;
  soloEnPropio: string[];
} {
  if (carteras.length === 0) return { filas: [], soloenFondos: [], soloEnPropio: [] };

  const totalPropio = posicionesPropias.reduce((s, p) => s + p.valorUsd, 0);

  // Peso propio por ticker
  const propioByTicker: Record<string, number> = {};
  for (const p of posicionesPropias) {
    propioByTicker[p.ticker] = (propioByTicker[p.ticker] ?? 0) + p.valorUsd;
  }

  // Pesos de fondos por ticker (usando mapping)
  const fondosByTicker: Record<string, number[]> = {};
  for (const cartera of carteras) {
    const tickersEnCartera = new Set<string>();
    for (const pos of cartera.posiciones) {
      if (pos.incompleto) continue;
      const ticker = pos.ticker ?? mappings[normalizeEspecie(pos.especieRaw)];
      if (!ticker) continue;
      tickersEnCartera.add(ticker);
      if (!fondosByTicker[ticker]) fondosByTicker[ticker] = Array(carteras.length).fill(0);
      const idx = carteras.indexOf(cartera);
      fondosByTicker[ticker][idx] = (fondosByTicker[ticker][idx] ?? 0) + pos.pesoPct;
    }
  }

  // Unión de tickers
  const todosLosTickers = new Set([
    ...Object.keys(propioByTicker),
    ...Object.keys(fondosByTicker),
  ]);

  const filas: FilaBenchmark[] = [];
  for (const ticker of todosLosTickers) {
    const propioUsd = propioByTicker[ticker] ?? null;
    const propioPct = propioUsd !== null ? propioUsd / (totalPropio || 1) : null;
    const pcts = fondosByTicker[ticker] ?? [];
    const avg = pcts.length > 0 ? pcts.reduce((s, x) => s + x, 0) / pcts.length : 0;
    const min = pcts.length > 0 ? Math.min(...pcts) : 0;
    const max = pcts.length > 0 ? Math.max(...pcts) : 0;
    const std = pcts.length > 1
      ? Math.sqrt(pcts.reduce((s, x) => s + (x - avg) ** 2, 0) / pcts.length)
      : 0;
    filas.push({
      ticker,
      propioUsd,
      propioPct,
      fondosAvgPct: avg,
      fondosMinPct: min,
      fondosMaxPct: max,
      fondosStdPct: std,
      divergencia: Math.abs((propioPct ?? 0) - avg),
    });
  }

  filas.sort((a, b) => b.divergencia - a.divergencia);

  const soloenFondos = filas
    .filter(f => f.propioPct === null && f.fondosAvgPct > 0)
    .sort((a, b) => b.fondosAvgPct - a.fondosAvgPct)
    .slice(0, 10)
    .map(f => ({ ticker: f.ticker, avgPct: f.fondosAvgPct }));

  const soloEnPropio = filas
    .filter(f => f.fondosAvgPct === 0 && f.propioPct !== null)
    .map(f => f.ticker);

  return { filas, soloenFondos, soloEnPropio };
}

export function normalizeEspecie(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
