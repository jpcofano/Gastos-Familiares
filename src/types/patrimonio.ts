// Tipos del contrato de patrimonio (F9.84 / F9.90).
// NO mezclar con src/types/index.ts (gastos). Colecciones propias, aislamiento total.

export type PosicionTipo = 'accion' | 'bono' | 'on' | 'cedear' | 'fci' | 'cripto' | 'cash';
export type PaisRiesgo = 'AR' | 'global';

// Posición tal como viene del .txt (campos del schema)
export type PosicionRaw = {
  cuenta: string;
  titular: string | null;
  ticker: string;
  tipo: PosicionTipo;
  sector: string;
  pais_riesgo: PaisRiesgo;
  moneda_origen: 'ARS' | 'USD';
  valor_origen: number;
  cantidad: number | null;
  fuente: string;
  revisar: boolean;
};

// Posición enriquecida (valorUsd calculado, persistida en Firestore)
export type Posicion = PosicionRaw & {
  valorUsd: number;
  tcUsado: number | null;
  fechaCorrida: string;
};

export type MetaCorrida = {
  fecha_corrida: string;
  entidad: 'familia';
  fuentes: string[];
  total_declarado_usd: number;
  nota_tc?: string;
};

export type CorraidaJSON = {
  meta: MetaCorrida;
  posiciones: PosicionRaw[];
};

export type ActivoFijo = {
  id: string;
  nombre: string;
  valorUsd: number;
  pais: string;
  notas: string;
};

// Posición cargada manualmente (planes de empleado, cuentas sin API).
// Entra al análisis de riesgo (métricas, semáforos, HHI) — distinto a ActivoFijo.
export type PosicionManual = {
  id: string;
  ticker: string;
  nombre: string;
  cantidad: number;
  valorUsd: number;
  fechaValuacion: string; // YYYY-MM-DD
  tipo: 'accion';
  sector: string;
  pais_riesgo: PaisRiesgo;
  cuenta: string;
  notas: string;
};

// Métricas calculadas sobre un conjunto de posiciones (output de calcMetrics)
export type PatMetrics = {
  total: number;
  bySector: Record<string, number>;
  byTipo: Record<string, number>;
  byPais: { AR: number; global: number };
  nombreTop: { ticker: string };
  top1: number; top3: number; top5: number; hhi: number;
  sectorTop: { nombre: string; pct: number };
  paisAr: number; cripto: number; rvPct: number;
};
