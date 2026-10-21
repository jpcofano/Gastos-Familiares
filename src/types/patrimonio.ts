// Tipos del contrato de patrimonio (F9.84 / F9.90).
// NO mezclar con src/types/index.ts (gastos). Colecciones propias, aislamiento total.

import type { CalculoTesis } from '../datos/compartido/tesis';
// F9.196 H2 — definidos en src/datos/compartido/tiposPatrimonio.ts (código compartido con las
// Functions). Se re-exportan acá para que los imports de siempre sigan andando.
import type { PosicionTipo, PaisRiesgo, PosicionRaw, Posicion, PosicionManual } from '../datos/compartido/tiposPatrimonio';
export type { PosicionTipo, PaisRiesgo, PosicionRaw, Posicion, PosicionManual } from '../datos/compartido/tiposPatrimonio';

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
  // F9.148 — dato probadamente malo de la fuente (data912, 2023-08-03). Se conserva para que
  // el problema quede visible y el arreglo sea idempotente, y se excluye de todo cálculo.
  malo?: true;
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
  puntosMalos?: number;      // F9.148 — cuántos de `puntos` están marcados y no se calcularon
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
  // F9.148 §4 — la performance (y SOLO la performance) va en dólares; el resto está en
  // `monedaSerie`. Es dato del motor, no se infiere: los docs viejos no lo traen.
  monedaPerformance?: 'ARS' | 'USD';
  motivoPerfEnMoneda?: 'ya_en_usd' | 'sin_tc_completo' | null;
  // F9.149 — la distribución de caídas del propio activo, de donde salen las bandas del
  // semáforo `caida52s`. Opcionales: los documentos escritos antes de F9.149 no las traen.
  ddMediana?: number | null;
  ddCdar80?: number | null;
  ddObservaciones?: number;
  ulcerIndex126?: number | null;   // profundidad + duración; SIN semáforo, a propósito
  rsi14: number | null; atrPct: number | null;
  montoOperadoProm30d: number | null; montoOperadoUltimo: number | null;
  ratioVolumen: number | null;
  semaforos: Record<string, Semaforo>;
  // F9.196 §4–§5 — los escribe el cron (functions/src/patrimonioPrecios.ts, `calcStops` y
  // `calcSenales`). Solo acciones y CEDEARs; null en el resto. Opcionales: los docs anteriores a
  // F9.196 no los traen. Son niveles de REFERENCIA, no órdenes: sin push ni campana.
  atr14?: number | null;
  stops?: StopsPosicion | null;
  historialStops?: Array<{
    fecha: string; stopAtr: number | null; sma50: number | null; sma200: number | null; cierre: number;
  }> | null;
  senales?: SenalPosicion[] | null;
  // F9.196 H2a — precio del día con su fuente (data912 o PPI), por unidad de cantidad.
  precioDia?: { precio: number; moneda: 'ARS' | 'USD'; fecha: string; fuente: 'data912' | 'ppi'; escala: number | null } | null;
  // F9.196 H5 — cálculos de la tesis con el cierre del día (P/E, potencial, gatillos, días al evento).
  tesisCalculo?: (CalculoTesis & { fecha: string }) | null;
};

/** F9.196 §4 — espejo de `Stops` de functions/src/patrimonioPrecios.ts. */
export type StopsPosicion = {
  identidad: string;
  fechaLectura: string;
  fechaCorridaLectura: string | null;
  cierre: number;
  atr14: number | null;
  stopAtrBase: number | null;
  stopAtr: number | null;
  stopAtrDesde: string | null;
  motivoStopAtr: 'menos_de_30_puntos' | 'sin_ohlc' | null;
  reinicio: 'identidad' | 'tenencia_interrumpida' | null;
  stopSma50: number | null;  estadoSma50: 'encima' | 'cerca' | 'debajo' | null;  cierresDebajoSma50: number;
  stopSma200: number | null; estadoSma200: 'encima' | 'cerca' | 'debajo' | null; cierresDebajoSma200: number;
  distStopAtrPct: number | null; distSma50Pct: number | null; distSma200Pct: number | null;
  estado: 'tocado' | 'cerca' | 'ok' | 'sin_datos';
};

/** F9.196 §5 — espejo de `Senal` de functions/src/patrimonioPrecios.ts. */
export type SenalPosicion = {
  id: string; texto: string; desde: string; nivel: 'info' | 'atencion'; nueva: boolean;
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
