// F9.196 H2 — tipos y utilidades de patrimonio que comparten el cliente (src/) y las Functions.
//
// ⛔ CÓDIGO COMPARTIDO: este archivo existe en DOS lugares idénticos byte a byte,
//   src/datos/compartido/  y  functions/src/compartido/
// (functions/ tiene `rootDir: src` y no puede importar de src/). El original es el de src/datos/;
// la copia se regenera copiando el archivo, nunca editándola a mano. `scripts/verificarCopiasIdenticas.ts`
// falla si difieren. Mismo precedente que `normalizador.ts`.
//
// Sin imports fuera de esta carpeta.

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
  // F9.189 §2 — qué mirar, en una frase. Opcional: los .txt anteriores no lo traen y validan igual.
  motivo_revisar?: string | null;
};

// Posición enriquecida (valorUsd calculado, persistida en Firestore)
export type Posicion = PosicionRaw & {
  valorUsd: number;
  tcUsado: number | null;
  fechaCorrida: string;
  // F9.189 §3 — vino con `revisar: true` y Juan la dio por vista en el Paso 3 (queda `revisar: false`).
  // Estado de la app, no del resumen: el export no lo incluye.
  revisadoEnIngesta?: boolean;
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

// ── Lectura de precios cripto (F9.195) ───────────────────────────────────────
export type PrecioCripto = { valor: number | null; fuente: string | null; error: string | null };
export type SondeoCripto = { fuente: string; url: string; status: number; error: string | null };
export type LecturaCripto = { leidoEnISO: string; precios: Record<string, PrecioCripto>; sondeo: SondeoCripto[] };

/** Fecha en Argentina (UTC−3, sin horario de verano) de un instante ISO. */
export const fechaArgentina = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(0, 10);

/** Stablecoins: valen 1 USD por definición (F9.195). */
export const STABLECOINS = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD']);
