// F9.196 Addendum 2 §C (H3b) — aportes y retiros automáticos, con el apareo de transferencias
// internas. Funciones PURAS: sin Firestore, sin red, sin UI.
//
// Regla: el flujo de F9.96 sale SOLO de los movimientos de cada fuente; Juan no lo carga. Un aporte
// o retiro es plata que entra o sale del PATRIMONIO TOTAL, no de una cuenta, así que una
// transferencia entre cuentas propias no es flujo (cada cuenta sí mueve su caja).
//
// - Dinero: `retiro` en una cuenta y `deposito` en otra, misma moneda, monto dentro del 1% y a 5
//   días hábiles o menos → transferencia interna.
// - Cripto: mismo activo, cantidad dentro de la comisión de red, 3 días o menos → interna.
// - Lo que no aparea va a la lista "¿Es plata que entró o salió del patrimonio?" (aporte, retiro o
//   interna). Es la única intervención de Juan. Hasta que elige, no genera flujo.
import { claveDuplicado, flujoDeMovimiento, type FlujoPropuesto, type MovimientoCuenta } from './patrimonioMovimientos';

export const APAREO = {
  /** Dinero: diferencia de monto relativa al mayor de los dos. */
  toleranciaMonto: 0.01,
  diasHabilesDinero: 5,
  /**
   * Cripto: lo que llega puede ser menos que lo que salió por la comisión de red, nunca más.
   * ⚠ La spec dice "dentro de la comisión de red" sin número: 1% es una propuesta, para confirmar.
   */
  toleranciaComisionCripto: 0.01,
  diasCripto: 3,
  /**
   * Títulos en especie (Balanz "Transferencia Externa", §B): misma especie y misma cantidad.
   * ⚠ La spec no fija la ventana para títulos: se usa la del dinero (5 días hábiles), para confirmar.
   */
  diasHabilesTitulos: 5,
} as const;

export type ClaseMovimiento = 'dinero' | 'cripto' | 'titulos';

/** Dinero si no hay ticker; si hay, cripto o títulos según `tipoActivo`. */
export function claseDe(m: MovimientoCuenta): ClaseMovimiento {
  if (!m.ticker) return 'dinero';
  return m.tipoActivo === 'cripto' ? 'cripto' : 'titulos';
}

export const claveMovimiento = (m: MovimientoCuenta) => m.id ?? claveDuplicado(m);

const ms = (f: string) => Date.parse(`${f}T12:00:00Z`);
/** Días corridos de `a` a `b` (puede ser negativo). */
export const diasEntre = (a: string, b: string) => Math.round((ms(b) - ms(a)) / 86_400_000);
/** Días hábiles (lunes a viernes) de `a` a `b`, sin contar `a`. Sin feriados. */
export function diasHabilesEntre(a: string, b: string): number {
  if (b < a) return -diasHabilesEntre(b, a);
  let n = 0;
  const d = new Date(ms(a));
  while (d.toISOString().slice(0, 10) < b) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

export type TransferenciaInterna = {
  retiro: MovimientoCuenta;
  deposito: MovimientoCuenta;
  clase: ClaseMovimiento;
  /** Días hábiles (dinero, títulos) o corridos (cripto) entre salida y llegada. */
  dias: number;
  /** Dinero: diferencia relativa de monto. Cripto/títulos: (salió − llegó) / salió. */
  diferencia: number;
};

/**
 * ¿Pueden ser las dos puntas de una transferencia interna? La llegada nunca es anterior a la salida.
 * ⚠ Interpretación: la spec dice "a 5 días hábiles o menos" sin sentido; se exige que el depósito
 * no sea anterior al retiro.
 */
export function compatibles(r: MovimientoCuenta, d: MovimientoCuenta): { dias: number; diferencia: number } | null {
  if (r.tipo !== 'retiro' || d.tipo !== 'deposito' || r.cuenta === d.cuenta) return null;
  const clase = claseDe(r);
  if (claseDe(d) !== clase) return null;
  if (d.fecha < r.fecha) return null;
  if (clase === 'dinero') {
    if (r.moneda !== d.moneda) return null;
    const a = Math.abs(r.montoNeto), b = Math.abs(d.montoNeto);
    const diferencia = Math.max(a, b) > 0 ? Math.abs(a - b) / Math.max(a, b) : 0;
    const dias = diasHabilesEntre(r.fecha, d.fecha);
    return diferencia <= APAREO.toleranciaMonto && dias <= APAREO.diasHabilesDinero ? { dias, diferencia } : null;
  }
  if ((r.ticker ?? '').trim().toUpperCase() !== (d.ticker ?? '').trim().toUpperCase()) return null;
  const sale = Math.abs(r.cantidad ?? 0), llega = Math.abs(d.cantidad ?? 0);
  if (!(sale > 0)) return null;
  const diferencia = (sale - llega) / sale;
  if (clase === 'cripto') {
    const dias = diasEntre(r.fecha, d.fecha);
    return diferencia >= 0 && diferencia <= APAREO.toleranciaComisionCripto && dias <= APAREO.diasCripto ? { dias, diferencia } : null;
  }
  const dias = diasHabilesEntre(r.fecha, d.fecha);
  return Math.abs(diferencia) < 1e-9 && dias <= APAREO.diasHabilesTitulos ? { dias, diferencia } : null;
}

/**
 * Apareo goloso y determinista: cada retiro (del más viejo al más nuevo) toma el depósito
 * compatible más cercano en el tiempo y, a igual distancia, el de monto o cantidad más parecido.
 * Cada movimiento entra a lo sumo en un par.
 */
export function aparearTransferencias(movimientos: MovimientoCuenta[]): {
  internas: TransferenciaInterna[];
  sinAparear: MovimientoCuenta[];
} {
  const candidatos = movimientos.filter(m => m.tipo === 'retiro' || m.tipo === 'deposito');
  const retiros = candidatos.filter(m => m.tipo === 'retiro')
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || claveMovimiento(a).localeCompare(claveMovimiento(b)));
  const usados = new Set<string>();
  const internas: TransferenciaInterna[] = [];
  for (const r of retiros) {
    let mejor: { d: MovimientoCuenta; dias: number; diferencia: number } | null = null;
    for (const d of candidatos) {
      if (d.tipo !== 'deposito' || usados.has(claveMovimiento(d))) continue;
      const c = compatibles(r, d);
      if (!c) continue;
      if (!mejor || c.dias < mejor.dias || (c.dias === mejor.dias && Math.abs(c.diferencia) < Math.abs(mejor.diferencia))) {
        mejor = { d, ...c };
      }
    }
    if (mejor) {
      usados.add(claveMovimiento(r));
      usados.add(claveMovimiento(mejor.d));
      internas.push({ retiro: r, deposito: mejor.d, clase: claseDe(r), dias: mejor.dias, diferencia: mejor.diferencia });
    }
  }
  return { internas, sinAparear: candidatos.filter(m => !usados.has(claveMovimiento(m))) };
}

export type DecisionFlujo = 'aporte' | 'retiro' | 'interna';

export type PendienteFlujo = {
  movimiento: MovimientoCuenta;
  /** Lo que el movimiento dice por sí solo; la lista lo ofrece primero, pero decide Juan. */
  sugerido: 'aporte' | 'retiro';
};

/**
 * Los flujos de F9.96 a partir de los movimientos de todas las fuentes.
 * - Pares internos: sin flujo.
 * - Sin par y con decisión de Juan: `aporte` / `retiro` generan el flujo (con el signo que eligió),
 *   `interna` no genera nada.
 * - Sin par y sin decisión: quedan en `pendientes` y NO generan flujo todavía.
 * - Un monto en pesos sin TC para su fecha no se convierte con un número inventado: va a `sinTc`.
 *
 * @param tcDe ARS por USD de una fecha (lo elige quien llama).
 */
export function flujosAutomaticos(
  movimientos: MovimientoCuenta[],
  decisiones: Record<string, DecisionFlujo>,
  tcDe: (fecha: string) => number | null,
): {
  internas: TransferenciaInterna[];
  flujos: Array<FlujoPropuesto & { movimientoClave: string }>;
  pendientes: PendienteFlujo[];
  sinTc: MovimientoCuenta[];
} {
  // Los movimientos inferidos (diferencias entre dos "Mis Instrumentos") nunca son flujo.
  const reales = movimientos.filter(m => !m.inferido);
  const { internas, sinAparear } = aparearTransferencias(reales);
  const flujos: Array<FlujoPropuesto & { movimientoClave: string }> = [];
  const pendientes: PendienteFlujo[] = [];
  const sinTc: MovimientoCuenta[] = [];
  for (const m of sinAparear) {
    const clave = claveMovimiento(m);
    const decision = decisiones[clave];
    if (!decision) { pendientes.push({ movimiento: m, sugerido: m.tipo === 'retiro' ? 'retiro' : 'aporte' }); continue; }
    if (decision === 'interna') continue;
    const comoFlujo: MovimientoCuenta = { ...m, tipo: decision === 'retiro' ? 'retiro' : 'deposito' };
    const { flujo, motivo } = flujoDeMovimiento(comoFlujo, m.moneda === 'ARS' ? tcDe(m.fecha) : null);
    if (motivo === 'sin_tc') { sinTc.push(m); continue; }
    if (flujo) flujos.push({ ...flujo, movimientoClave: clave });
  }
  return { internas, flujos, pendientes, sinTc };
}
