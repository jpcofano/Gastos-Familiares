import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit, writeBatch,
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
  categoria?: 'LIQUIDEZ' | 'CEDEAR';
  incompleto?: boolean;
};

export type CafciCartera = {
  id: string;
  fondoId: string;
  nombre: string;
  nombreFondo?: string;
  nombreClase?: string;
  fechaDatos: string;   // YYYY-MM-DD
  fechaFetch: string;   // ISO
  posiciones: CafciPosicion[];
  totalPct: number;
  advertenciaIntegridad?: boolean;
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
export type MappingEntry = { ticker: string | null; categoria?: string };

export async function cargarMappings(): Promise<Record<string, string | null>> {
  const snap = await getDocs(collection(db, 'cafciMapping'));
  const result: Record<string, string | null> = {};
  for (const d of snap.docs) {
    result[d.id] = (d.data() as MappingEntry).ticker;
  }
  return result;
}

export async function guardarMapping(especieNorm: string, ticker: string | null): Promise<void> {
  await setDoc(doc(db, 'cafciMapping', especieNorm), { ticker });
}

// ── Seed de fondos sugeridos (F9.97.1 §8a) ───────────────────────────────────
const FONDOS_SEED: CafciFondoConfig[] = [
  { fondoId: '216', claseId: '1634', nombre: 'Consultatio Acciones Argentina - Clase C' },
  { fondoId: '51',  claseId: '683',  nombre: 'Superfondo Renta Variable - Clase B' },
  { fondoId: '22',  claseId: '1193', nombre: 'Fima PB Acciones - Clase B' },
  { fondoId: '370', claseId: '662',  nombre: 'Delta Acciones - Clase B' },
  { fondoId: '275', claseId: '275',  nombre: '1810 Renta Variable Argentina - única' },
  { fondoId: '436', claseId: '821',  nombre: 'SBS Acciones Argentina - Clase B' },
  { fondoId: '15',  claseId: '15',   nombre: 'Pionero Acciones - Clase B' },
  { fondoId: '227', claseId: '227',  nombre: 'Premier Renta Variable - Clase A' },
  { fondoId: '514', claseId: '1038', nombre: 'Consultatio Renta Variable - Clase B' },
  { fondoId: '441', claseId: '836',  nombre: 'Allaria Acciones - Clase B' },
  { fondoId: '615', claseId: '2249', nombre: 'Galileo Acciones - Clase B' },
  { fondoId: '505', claseId: '1021', nombre: 'MAF Acciones Argentinas - Clase B' },
  { fondoId: '430', claseId: '804',  nombre: 'IAM Renta Variable - Clase B' },
];

/** Agrega los fondos sugeridos a la config (merge: no borra los ya existentes). */
export async function importarFondosSugeridos(): Promise<number> {
  const current = await cargarConfigCafci();
  const existingIds = new Set(current.fondos.map(f => `${f.fondoId}_${f.claseId}`));
  const nuevos = FONDOS_SEED.filter(f => !existingIds.has(`${f.fondoId}_${f.claseId}`));
  if (nuevos.length === 0) return 0;
  await guardarConfigCafci({ fondos: [...current.fondos, ...nuevos] });
  return nuevos.length;
}

// ── Seed de mapping especie→ticker (F9.97.1 §8b) ─────────────────────────────
// 70 patrones validados contra la API en producción (sistema AppsScript, abril 2026).
const MAPPING_SEED: Array<{ patron: string; ticker: string; tipo: string; sector: string }> = [
  { patron: 'YPF',                        ticker: 'YPFD',  tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Grupo Galicia',              ticker: 'GGAL',  tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Galicia',                    ticker: 'GGAL',  tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Banco Macro',               ticker: 'BMA',   tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Macro Bansud',              ticker: 'BMA',   tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Banco Patagonia',           ticker: 'BPAT',  tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Banco de Valores',          ticker: 'VALO',  tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'BBVA Argentina',            ticker: 'BBAR',  tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Supervielle',               ticker: 'SUPV',  tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Pampa Energia',             ticker: 'PAMP',  tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Central Puerto',            ticker: 'CEPU',  tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Edenor',                    ticker: 'EDN',   tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Capex',                     ticker: 'CAPX',  tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Transportadora Gas del Sur', ticker: 'TGSU2', tipo: 'ACCION',        sector: 'Energía' },
  { patron: 'Transportadora Gas del Norte', ticker: 'TGNO4', tipo: 'ACCION',      sector: 'Energía' },
  { patron: 'Transener',                 ticker: 'TRAN',  tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Metrogas',                  ticker: 'METR',  tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Vista',                     ticker: 'VIST',  tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Aluar',                     ticker: 'ALUA',  tipo: 'ACCION',         sector: 'Materiales' },
  { patron: 'Ternium',                   ticker: 'TXAR',  tipo: 'ACCION',         sector: 'Materiales' },
  { patron: 'Loma Negra',               ticker: 'LOMA',  tipo: 'ACCION',         sector: 'Materiales' },
  { patron: 'Holcim',                    ticker: 'HARG',  tipo: 'ACCION',         sector: 'Materiales' },
  { patron: 'Telecom Argentina',         ticker: 'TECO2', tipo: 'ACCION',         sector: 'Telecomunicaciones' },
  { patron: 'Telecom',                   ticker: 'TECO2', tipo: 'ACCION',         sector: 'Telecomunicaciones' },
  { patron: 'Cablevision',               ticker: 'CVH',   tipo: 'ACCION',         sector: 'Telecomunicaciones' },
  { patron: 'BYMA',                      ticker: 'BYMA',  tipo: 'ACCION',         sector: 'Financiero' },
  { patron: 'Bolsas y Mercados Argentinos', ticker: 'BYMA', tipo: 'ACCION',       sector: 'Financiero' },
  { patron: 'Cresud',                    ticker: 'CRES',  tipo: 'ACCION',         sector: 'Real Estate / Agro' },
  { patron: 'IRSA',                      ticker: 'IRSA',  tipo: 'ACCION',         sector: 'Real Estate' },
  { patron: 'Consultatio',               ticker: 'CTIO',  tipo: 'ACCION',         sector: 'Real Estate' },
  { patron: 'Mirgor',                    ticker: 'MIRG',  tipo: 'ACCION',         sector: 'Industrial' },
  { patron: 'Comercial del Plata',       ticker: 'COME',  tipo: 'ACCION',         sector: 'Holding' },
  { patron: 'Sociedad Comercial del Plata', ticker: 'COME', tipo: 'ACCION',       sector: 'Holding' },
  { patron: 'Autopistas del Sol',        ticker: 'AUSO',  tipo: 'ACCION',         sector: 'Infraestructura' },
  { patron: 'Molinos Rio de la Plata',   ticker: 'MOLI',  tipo: 'ACCION',         sector: 'Consumo' },
  { patron: 'Molinos Río de la Plata',   ticker: 'MOLI',  tipo: 'ACCION',         sector: 'Consumo' },
  { patron: 'Molinos Agro',              ticker: 'MOLA',  tipo: 'ACCION',         sector: 'Agro' },
  { patron: 'San Miguel',                ticker: 'SAMI',  tipo: 'ACCION',         sector: 'Agro' },
  { patron: 'Havanna',                   ticker: 'HAVA',  tipo: 'ACCION',         sector: 'Consumo' },
  { patron: 'Grupo Fciero Galicia',      ticker: 'GGAL',  tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Banco Rio',                 ticker: 'BRIO',  tipo: 'ACCION_LEGACY',  sector: 'Bancos' },
  { patron: 'Banco Santander Rio',       ticker: 'BRIO',  tipo: 'ACCION_LEGACY',  sector: 'Bancos' },
  { patron: 'Grupo Supervielle',         ticker: 'SUPV',  tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Grupo Finc. Valores',       ticker: 'VALO',  tipo: 'ACCION',         sector: 'Financiero' },
  { patron: 'Grupo Financiero Valores',  ticker: 'VALO',  tipo: 'ACCION',         sector: 'Financiero' },
  { patron: 'Phoenix Global Resources',  ticker: 'PGR',   tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Centaurus Energy',          ticker: 'CTA',   tipo: 'ACCION_EXTERIOR', sector: 'Energía' },
  { patron: 'Camuzzi Gas Pampeana',      ticker: 'CGPA2', tipo: 'ACCION',         sector: 'Servicios públicos / Gas' },
  { patron: 'Camuzzi',                   ticker: 'CGPA2', tipo: 'ACCION',         sector: 'Servicios públicos / Gas' },
  { patron: 'Dist Gas Cuyana',           ticker: 'DGCU2', tipo: 'ACCION',         sector: 'Servicios públicos / Gas' },
  { patron: 'Distribuidora de Gas Cuyana', ticker: 'DGCU2', tipo: 'ACCION',       sector: 'Servicios públicos / Gas' },
  { patron: 'Ecogas',                    ticker: 'ECOG',  tipo: 'ACCION',         sector: 'Servicios públicos / Gas' },
  { patron: 'Transp Gas del Norte',      ticker: 'TGNO4', tipo: 'ACCION',         sector: 'Servicios públicos / Gas' },
  { patron: 'Transportadora de Gas del Norte', ticker: 'TGNO4', tipo: 'ACCION',   sector: 'Servicios públicos / Gas' },
  { patron: 'Transp Gas del Sur',        ticker: 'TGSU2', tipo: 'ACCION',         sector: 'Servicios públicos / Gas' },
  { patron: 'Transportadora de Gas del Sur', ticker: 'TGSU2', tipo: 'ACCION',     sector: 'Servicios públicos / Gas' },
  { patron: 'Holcim Argentina',          ticker: 'HARG',  tipo: 'ACCION',         sector: 'Materiales' },
  { patron: 'Cablevision Holding',       ticker: 'CVH',   tipo: 'ACCION',         sector: 'Holding' },
  { patron: 'Raghsa',                    ticker: 'RAGH',  tipo: 'ACCION',         sector: 'Real Estate' },
  { patron: 'Dycasa',                    ticker: 'DYCA',  tipo: 'ACCION',         sector: 'Construcción / Infraestructura' },
  { patron: 'Ferrum S.A.',               ticker: 'FERR',  tipo: 'ACCION',         sector: 'Construcción / Consumo durable' },
  { patron: 'Ferrum',                    ticker: 'FERR',  tipo: 'ACCION',         sector: 'Construcción / Consumo durable' },
  { patron: 'Grimoldi',                  ticker: 'GRIM',  tipo: 'ACCION',         sector: 'Consumo' },
  { patron: 'Morixe Hermanos',           ticker: 'MORI',  tipo: 'ACCION',         sector: 'Consumo / Alimentos' },
  { patron: 'Morixe',                    ticker: 'MORI',  tipo: 'ACCION',         sector: 'Consumo / Alimentos' },
  { patron: 'Ovoprot Internacional',     ticker: 'OVOP',  tipo: 'ACCION',         sector: 'Consumo / Alimentos' },
  { patron: 'Ovoprot International',     ticker: 'OVOP',  tipo: 'ACCION',         sector: 'Consumo / Alimentos' },
  { patron: 'Corporacion America Airports', ticker: 'CAAP', tipo: 'ACCION',       sector: 'Infraestructura aeroportuaria' },
  { patron: 'Vista Oil & Gas',           ticker: 'VIST',  tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Vista Energy',              ticker: 'VIST',  tipo: 'ACCION',         sector: 'Energía' },
];

/** Escribe los 70 patrones de mapping en cafciMapping (sobrescribe docs existentes). */
export async function importarMappingSeed(): Promise<number> {
  const batch = writeBatch(db);
  for (const entry of MAPPING_SEED) {
    const norm = normalizeEspecie(entry.patron);
    batch.set(doc(db, 'cafciMapping', norm), {
      ticker: entry.ticker,
      tipo: entry.tipo,
      sector: entry.sector,
    });
  }
  await batch.commit();
  return MAPPING_SEED.length;
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
