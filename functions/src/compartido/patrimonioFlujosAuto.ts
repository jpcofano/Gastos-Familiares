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
//
// ⛔ CÓDIGO COMPARTIDO (F9.196 H2): idéntico byte a byte en src/datos/compartido/ y
// functions/src/compartido/. Se edita el de src/datos/ y se copia; `scripts/verificarCopiasIdenticas.ts`
// falla si difieren. Sin imports fuera de esta carpeta.
import { claveDuplicado, flujoDeMovimiento, hashId, type FlujoPropuesto, type MovimientoCuenta } from './patrimonioMovimientos';

/**
 * F9.196.1 §1.a — desde cuándo los movimientos sin par cuentan como aporte o retiro posibles. Es la
 * fecha del deploy de F9.196: la historia anterior ya está en los flujos MANUALES de F9.96, y la
 * primera sincronización de PPI trae 3 años. Lo anterior sin par va a `historial` (solo se cuenta):
 * decidirlo como aporte o retiro duplicaría un flujo manual. El apareo corre igual sobre todo.
 */
export const FLUJOS_AUTO_DESDE = '2026-10-21';

/**
 * Id del documento `decisionesFlujo/{id}` para una clave. Las claves son ids de `movimientosCuenta`
 * (válidos); una clave con "/" (no debería pasar) va hasheada y la clave queda en el campo `clave`.
 */
export const idDecisionFlujo = (clave: string) => (clave.includes('/') ? `h_${hashId(clave)}` : clave);

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
  /**
   * F9.196.1 §1.b — el depósito puede figurar hasta 1 día hábil ANTES del retiro (dinero y títulos)
   * o 1 día corrido (cripto): entre fuentes distintas pasa (concertación contra liquidación, UTC
   * contra hora argentina). Más que eso, no.
   */
  diasHabilesAlReves: 1,
  diasCriptoAlReves: 1,
} as const;

export type ClaseMovimiento = 'dinero' | 'cripto' | 'titulos';

/** Dinero si no hay ticker; si hay, cripto o títulos según `tipoActivo`. */
export function claseDe(m: MovimientoCuenta): ClaseMovimiento {
  if (!m.ticker) return 'dinero';
  return m.tipoActivo === 'cripto' ? 'cripto' : 'titulos';
}

/**
 * Clave estable de cada movimiento de una lista: su `id` o, sin id, la clave de duplicado más el
 * número de ocurrencia. Dos movimientos legítimos iguales sin id (mismo día, cuenta y monto) son
 * dos, no uno. Las decisiones de Juan se guardan con esta clave; conviene que las fuentes pongan id.
 */
export function clavesDe(movimientos: MovimientoCuenta[]): string[] {
  const vistas = new Map<string, number>();
  return movimientos.map(m => {
    if (m.id) return m.id;
    const base = claveDuplicado(m);
    const n = vistas.get(base) ?? 0;
    vistas.set(base, n + 1);
    return n ? `${base}#${n}` : base;
  });
}

/** Clave de UN movimiento suelto (sin contexto de lista): su id o su clave de duplicado. */
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
 * ¿Pueden ser las dos puntas de una transferencia interna? La llegada puede figurar hasta 1 día
 * hábil antes de la salida (1 corrido en cripto, §1.b): `dias` queda en −1. Más que eso, no.
 */
export function compatibles(r: MovimientoCuenta, d: MovimientoCuenta): { dias: number; diferencia: number } | null {
  if (r.tipo !== 'retiro' || d.tipo !== 'deposito' || r.cuenta === d.cuenta) return null;
  const clase = claseDe(r);
  if (claseDe(d) !== clase) return null;
  if (d.fecha < r.fecha) {
    const antes = clase === 'cripto' ? -diasEntre(r.fecha, d.fecha) : -diasHabilesEntre(r.fecha, d.fecha);
    if (antes > (clase === 'cripto' ? APAREO.diasCriptoAlReves : APAREO.diasHabilesAlReves)) return null;
  }
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
 * Apareo de cardinalidad MÁXIMA (caminos aumentantes, Kuhn), determinista. Cada retiro (del más
 * viejo al más nuevo) prueba los depósitos compatibles del más cercano en el tiempo al más lejano
 * (y a igual distancia, el de monto o cantidad más parecido). Si el que quiere ya está tomado, se
 * intenta reasignar al otro retiro. Así un par válido no queda afuera por una elección golosa:
 * R1 1000 / R2 1015 contra D1 1010 / D2 995 aparea R1–D2 y R2–D1.
 * Cada movimiento entra a lo sumo en un par.
 */
export function aparearTransferencias(movimientos: MovimientoCuenta[]): {
  internas: TransferenciaInterna[];
  sinAparear: MovimientoCuenta[];
} {
  const claves = clavesDe(movimientos);
  const idx = movimientos.map((_, i) => i).filter(i => movimientos[i].tipo === 'retiro' || movimientos[i].tipo === 'deposito');
  const retiros = idx.filter(i => movimientos[i].tipo === 'retiro')
    .sort((a, b) => movimientos[a].fecha.localeCompare(movimientos[b].fecha) || claves[a].localeCompare(claves[b]));
  const depositos = idx.filter(i => movimientos[i].tipo === 'deposito');
  // Candidatos de cada retiro, ordenados por preferencia.
  const opciones = new Map<number, Array<{ d: number; dias: number; diferencia: number }>>();
  for (const r of retiros) {
    const cs: Array<{ d: number; dias: number; diferencia: number }> = [];
    for (const d of depositos) {
      const c = compatibles(movimientos[r], movimientos[d]);
      if (c) cs.push({ d, ...c });
    }
    // Más cerca primero (|días|); a igual distancia, el de sentido normal antes que el inverso.
    cs.sort((x, y) => Math.abs(x.dias) - Math.abs(y.dias) || Number(x.dias < 0) - Number(y.dias < 0)
      || Math.abs(x.diferencia) - Math.abs(y.diferencia) || claves[x.d].localeCompare(claves[y.d]));
    opciones.set(r, cs);
  }
  const duenoDe = new Map<number, number>();   // depósito → retiro
  const intentar = (r: number, visto: Set<number>): boolean => {
    for (const { d } of opciones.get(r) ?? []) {
      if (visto.has(d)) continue;
      visto.add(d);
      const otro = duenoDe.get(d);
      if (otro === undefined || intentar(otro, visto)) { duenoDe.set(d, r); return true; }
    }
    return false;
  };
  for (const r of retiros) intentar(r, new Set());

  const internas: TransferenciaInterna[] = [];
  const usados = new Set<number>();
  for (const [d, r] of [...duenoDe].sort((a, b) => movimientos[a[1]].fecha.localeCompare(movimientos[b[1]].fecha) || a[1] - b[1])) {
    const c = opciones.get(r)!.find(o => o.d === d)!;
    usados.add(r); usados.add(d);
    internas.push({ retiro: movimientos[r], deposito: movimientos[d], clase: claseDe(movimientos[r]), dias: c.dias, diferencia: c.diferencia });
  }
  return { internas, sinAparear: idx.filter(i => !usados.has(i)).map(i => movimientos[i]) };
}

export type DecisionFlujo = 'aporte' | 'retiro' | 'interna';

export type PendienteFlujo = {
  movimiento: MovimientoCuenta;
  /** Lo que el movimiento dice por sí solo; la lista lo ofrece primero, pero decide Juan. */
  sugerido: 'aporte' | 'retiro';
};

/**
 * Los flujos de F9.96 a partir de los movimientos de todas las fuentes.
 * - `desde` (§1.a, en producción `FLUJOS_AUTO_DESDE`): lo que no aparea y es anterior NO va a
 *   pendientes ni a flujos: va a `historial` (solo se cuenta). El apareo corre sobre todo.
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
  desde: string | null = null,
): {
  internas: TransferenciaInterna[];
  flujos: Array<FlujoPropuesto & { movimientoClave: string }>;
  pendientes: PendienteFlujo[];
  sinTc: MovimientoCuenta[];
  historial: MovimientoCuenta[];
} {
  // Los movimientos inferidos (diferencias entre dos "Mis Instrumentos") nunca son flujo.
  const reales = movimientos.filter(m => !m.inferido);
  const claveDe = new Map(reales.map((m, i) => [m, clavesDe(reales)[i]] as const));
  const { internas, sinAparear } = aparearTransferencias(reales);
  const flujos: Array<FlujoPropuesto & { movimientoClave: string }> = [];
  const pendientes: PendienteFlujo[] = [];
  const sinTc: MovimientoCuenta[] = [];
  const historial: MovimientoCuenta[] = [];
  for (const m of sinAparear) {
    if (desde && m.fecha < desde) { historial.push(m); continue; }
    const clave = claveDe.get(m)!;
    const decision = decisiones[clave];
    if (!decision) { pendientes.push({ movimiento: m, sugerido: m.tipo === 'retiro' ? 'retiro' : 'aporte' }); continue; }
    if (decision === 'interna') continue;
    const comoFlujo: MovimientoCuenta = { ...m, tipo: decision === 'retiro' ? 'retiro' : 'deposito' };
    const { flujo, motivo } = flujoDeMovimiento(comoFlujo, m.moneda === 'ARS' ? tcDe(m.fecha) : null);
    if (motivo === 'sin_tc') { sinTc.push(m); continue; }
    // Un movimiento en especie sin valuación (precio -1 o 0 en el archivo) no da un flujo de 0: queda pendiente.
    if (flujo && flujo.montoUsd === 0 && m.ticker) { pendientes.push({ movimiento: m, sugerido: decision === 'retiro' ? 'retiro' : 'aporte' }); continue; }
    if (flujo) flujos.push({ ...flujo, movimientoClave: clave });
  }
  return { internas, flujos, pendientes, sinTc, historial };
}

/**
 * §1.c — "¿Ya lo cargaste a mano?": un flujo MANUAL de la misma cuenta a ±5 días hábiles y ±1% del
 * monto en USD. Solo avisa; no decide nada. Devuelve la fecha del manual que coincide, o null.
 */
export function posibleManual(
  p: { fecha: string; cuenta: string; montoUsd: number | null },
  manuales: Array<{ fecha: string; cuenta: string | null; montoUsd: number }>,
): string | null {
  if (p.montoUsd === null || !(Math.abs(p.montoUsd) > 0)) return null;
  const a = Math.abs(p.montoUsd);
  const m = manuales.find(f => f.cuenta?.trim() === p.cuenta.trim()
    && Math.abs(diasHabilesEntre(p.fecha, f.fecha)) <= APAREO.diasHabilesDinero
    && Math.abs(Math.abs(f.montoUsd) - a) / Math.max(Math.abs(f.montoUsd), a) <= APAREO.toleranciaMonto);
  return m?.fecha ?? null;
}
