// F9.196 §3 — movimientos de cuenta (`movimientosCuenta/{id}`): tipos y lógica pura.
//
// Sin Firestore ni red: lo usan `armarCarteraViva` (src/datos/patrimonioCarteraViva.ts) y, cuando
// existan, las tres vías de carga (PPI por API, archivo de Balanz, carga manual). Este archivo NO
// escribe nada: no hay cron, UI ni reglas todavía (H2/H3 posteriores).
//
// ⛔ CÓDIGO COMPARTIDO (F9.196 H2): idéntico byte a byte en src/datos/compartido/ y
// functions/src/compartido/. Se edita el de src/datos/ y se copia; `scripts/verificarCopiasIdenticas.ts`
// falla si difieren. Sin imports fuera de esta carpeta.
import type { PosicionTipo, PaisRiesgo } from './tiposPatrimonio';

export type TipoMovimiento = 'venta' | 'compra' | 'retiro' | 'deposito' | 'renta';
export type OrigenMovimiento = 'ppi_api' | 'archivo_balanz' | 'manual';

/** Forma de §3. `montoNeto` siempre positivo: el signo lo pone el tipo (ver `efectoMovimiento`). */
export type MovimientoCuenta = {
  id?: string;
  fecha: string;                 // YYYY-MM-DD
  cuenta: string;
  tipo: TipoMovimiento;
  ticker?: string | null;
  cantidad?: number | null;
  precio?: number | null;
  moneda: 'ARS' | 'USD';
  montoNeto: number;
  origen: OrigenMovimiento;
  idOrigen?: string | null;
  flujoId?: string | null;
  nota?: string | null;
  /**
   * NO está en §3: propuesto para la compra de un ticker que la cuenta no tenía, que si no queda
   * sin clase. Opcional; sin él, la línea nueva sale con `tipo: null` y marcada para revisar.
   */
  tipoActivo?: PosicionTipo | null;
  paisRiesgo?: PaisRiesgo | null;
  /**
   * Addendum 2 §A — deducido de la diferencia entre dos "Mis Instrumentos" de la misma comitente,
   * no leído de un movimiento real: muestra QUÉ cambió en el historial, con monto estimado. Nunca
   * es flujo. La cartera viva no lo aplica (la cuenta ya viene con la tenencia del archivo).
   */
  inferido?: boolean;
  /**
   * Addendum 2 §B — la `Moneda` original de Balanz (`Dólares`, `Dólares C.V. 7000`,
   * `US Dollar (Cable)`, `Pesos`). Las tres de dólar suman como USD; acá queda la subcuenta.
   */
  subcuenta?: string | null;
  /** Addendum 2 §B — renta que es (o incluye) amortización: devolución de capital. */
  devolucionCapital?: boolean;
};

/**
 * Efecto de un movimiento sobre la tenencia del ticker y la caja de la cuenta (§3):
 *
 * | tipo     | tenencia            | caja           |
 * |----------|---------------------|----------------|
 * | venta    | − cantidad          | + montoNeto    |
 * | compra   | + cantidad          | − montoNeto    |
 * | retiro   | —  (en especie: − cantidad) | − montoNeto (en especie: —) |
 * | deposito | —  (en especie: + cantidad) | + montoNeto (en especie: —) |
 * | renta    | —                   | + montoNeto    |
 */
export function efectoMovimiento(m: MovimientoCuenta): { deltaCantidad: number; deltaCaja: number } {
  const cant = Math.abs(m.cantidad ?? 0);
  const monto = Math.abs(m.montoNeto);
  switch (m.tipo) {
    case 'venta':    return { deltaCantidad: -cant, deltaCaja: +monto };
    case 'compra':   return { deltaCantidad: +cant, deltaCaja: -monto };
    // Un retiro o depósito CON ticker es en especie (títulos o cripto que entran o salen de la
    // cuenta): mueve la tenencia, no la caja. `montoNeto` es solo su valuación, para el flujo.
    case 'retiro':   return m.ticker && cant > 0 ? { deltaCantidad: -cant, deltaCaja: 0 } : { deltaCantidad: 0, deltaCaja: -monto };
    case 'deposito': return m.ticker && cant > 0 ? { deltaCantidad: +cant, deltaCaja: 0 } : { deltaCantidad: 0, deltaCaja: +monto };
    case 'renta':    return { deltaCantidad: 0, deltaCaja: +monto };
  }
}

const normTicker = (t: string | null | undefined) => (t ?? '').trim().toUpperCase();
const redondeo = (x: number | null | undefined) => (x === null || x === undefined ? '' : (Math.round(x * 100) / 100).toFixed(2));

/**
 * Clave de duplicado de §3: `(cuenta, fecha, tipo, ticker, cantidad, monto)`. Ticker en mayúsculas
 * y sin espacios; cantidad y monto redondeados al centavo, para que el mismo movimiento leído de
 * dos archivos (o pegado dos veces) dé la misma clave.
 */
export function claveDuplicado(m: MovimientoCuenta): string {
  return [m.cuenta.trim(), m.fecha, m.tipo, normTicker(m.ticker), redondeo(m.cantidad), redondeo(Math.abs(m.montoNeto))].join('|');
}

/**
 * Separa lo que se carga de lo que ya estaba (§3: "no se cargan dos veces"). Detecta también los
 * repetidos dentro del mismo lote. No borra nada: devuelve las dos listas para mostrarlas antes de
 * confirmar.
 */
export function separarDuplicados(
  nuevos: MovimientoCuenta[],
  existentes: MovimientoCuenta[],
): { aCargar: MovimientoCuenta[]; duplicados: MovimientoCuenta[] } {
  const vistas = new Set(existentes.map(claveDuplicado));
  const aCargar: MovimientoCuenta[] = [];
  const duplicados: MovimientoCuenta[] = [];
  for (const m of nuevos) {
    const k = claveDuplicado(m);
    if (vistas.has(k)) duplicados.push(m);
    else { vistas.add(k); aCargar.push(m); }
  }
  return { aCargar, duplicados };
}

/**
 * Regla de §3: cuando llega una corrida nueva de una cuenta, los movimientos anteriores a la fecha
 * de esa corrida dejan de aplicarse — la corrida ya los incluye.
 *
 * ⚠ Interpretación (para confirmar): un movimiento con la MISMA fecha que la corrida se considera
 * incluido en ella (no se aplica). Solo se aplican los estrictamente posteriores.
 */
export function movimientoVigente(m: MovimientoCuenta, fechaCorteCuenta: string | null): boolean {
  return fechaCorteCuenta === null || m.fecha > fechaCorteCuenta;
}

/** El flujo de F9.96 que genera un movimiento. Una venta sola NO es flujo: es un cambio interno. */
export type FlujoPropuesto = {
  fecha: string;          // YYYY-MM-DD; quien escribe lo convierte a Timestamp
  tipo: 'aporte' | 'retiro';
  montoUsd: number;
  cuenta: string;
  nota: string;
};

/**
 * Retiros y depósitos generan el flujo de F9.96 (`flujoId`) para que el retorno (Dietz) siga
 * igual. Venta, compra y renta devuelven `null`. Un monto en pesos sin TC no se convierte con un
 * número inventado: devuelve `{ flujo: null, motivo: 'sin_tc' }`.
 * @param tc ARS por USD del día del movimiento (lo elige quien llama).
 */
export function flujoDeMovimiento(
  m: MovimientoCuenta,
  tc: number | null,
): { flujo: FlujoPropuesto | null; motivo: 'no_es_flujo' | 'sin_tc' | null } {
  if (m.tipo !== 'retiro' && m.tipo !== 'deposito') return { flujo: null, motivo: 'no_es_flujo' };
  const monto = Math.abs(m.montoNeto);
  let montoUsd: number;
  if (m.moneda === 'USD') montoUsd = monto;
  else if (tc !== null && tc > 0) montoUsd = monto / tc;
  else return { flujo: null, motivo: 'sin_tc' };
  return {
    flujo: {
      fecha: m.fecha,
      tipo: m.tipo === 'retiro' ? 'retiro' : 'aporte',
      montoUsd: Math.round(montoUsd * 100) / 100,
      cuenta: m.cuenta,
      nota: m.nota ?? `${m.tipo} ${m.cuenta} (${m.origen})`,
    },
    motivo: null,
  };
}

/** Hash determinista (FNV-1a de 2 × 32 bits) para ids de Firestore. Sin crypto: puro y sincrónico. */
export function hashId(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
