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

// ── F9.141 — serie de precios diaria e indicadores ───────────────────────────
// El escritor de estos dos documentos es functions/src/patrimonioPrecios.ts + el cron
// actualizarPreciosDiarios. Acá solo se declara la forma para leerlos: la tabla de
// routing y la matemática NO se reimplementan del lado del cliente.

export type EstadoSerie = 'limpia' | 'ajustada' | 'sospechosa' | 'sin_serie';
export type Semaforo = 'verde' | 'amarillo' | 'rojo' | 'sin_datos';
export type CoberturaPrecio = 'con_serie' | 'solo_live' | 'sin_fuente';

export type PuntoSerie = {
  f: string;                 // YYYY-MM-DD
  o: number | null;          // null en /historical/usa_stocks/, que trae solo cierre
  h: number | null;
  l: number | null;
  c: number;
  v: number | null;          // nominales operados
};

export type SplitAplicado = {
  fecha: string;
  razon: number;
  cocienteCrudo: number | null;
  residuo: number | null;
  origen: 'tabla' | 'cantidad';
};

// Salto de más de 35% que las capas 1 y 2 no explican. Marca la serie; nunca la corrige.
export type SaltoDetectado = {
  fecha: string;
  cAnterior: number;
  cPosterior: number;
  retornoCrudo: number;
  cocienteCrudo: number;
  razonSugerida: number | null;
  residuo: number | null;
};

export type PreciosDiarios = {
  docId: string;
  ticker: string;
  tipo: PosicionTipo;
  paisRiesgo: PaisRiesgo;
  panelLive: string | null;
  panelHistorico: string | null;
  monedaSerie: 'ARS' | 'USD' | null;
  fuente: string | null;
  cobertura: CoberturaPrecio;
  estadoSerie: EstadoSerie;
  puntos: number;
  primeraFecha: string | null;
  ultimaFecha: string | null;
  precioLive: number | null;
  splitsAplicados: SplitAplicado[];
  saltosDetectados: SaltoDetectado[];
  serie: PuntoSerie[];
};

// Todo indicador es `null` cuando no hay puntos suficientes para su ventana; nunca una
// media de 200 días calculada sobre 40 datos. `puntosDisponibles` explica la ausencia.
export type IndicadoresPosicion = {
  docId: string;
  ticker: string;
  tipo: PosicionTipo;
  paisRiesgo: PaisRiesgo;
  calculadoEnISO?: string;
  estadoSerie: EstadoSerie;
  motivo: 'sin_fuente' | 'sin_historico' | 'fuente_sin_serie' | null;
  monedaSerie: 'ARS' | 'USD' | null;
  puntosDisponibles: number;
  fechaUltimoPrecio: string | null;
  precio: number | null;
  pesoEnCartera: number | null;
  ruedasParaSalir: number | null;
  sma20: number | null; sma50: number | null; sma200: number | null;
  vsSma20Pct: number | null; vsSma50Pct: number | null; vsSma200Pct: number | null;
  max52s: number | null; min52s: number | null;
  distanciaMax52sPct: number | null; distanciaMin52sPct: number | null;
  drawdownDesdeMaxPct: number | null;
  volAnualizada30d: number | null; volAnualizada90d: number | null;
  perf1m: number | null; perf3m: number | null; perf6m: number | null; perf1a: number | null;
  rsi14: number | null; atrPct: number | null;
  montoOperadoProm30d: number | null; montoOperadoUltimo: number | null;
  ratioVolumen: number | null;
  semaforos: Record<string, Semaforo>;
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
