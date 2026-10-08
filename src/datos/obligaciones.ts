// F9.184 — la unidad de lo pendiente es la OBLIGACIÓN; el ítem es lo esperado sin cargar.
// Regla y definiciones en docs/CLAUDE.md, "La unidad de lo pendiente es la OBLIGACIÓN".
//
// Obligación abierta = movimiento `tipo: 'Gasto'` con `!movimientoCubierto(m)`. No mira el ítem, ni
// el mes, ni `incluirResumenMes`: una cuota de viaje sin plantilla, una boleta con su vencimiento y
// una cuota atrasada de ABL detrás de un ítem que ya figura pagado son lo mismo, plata que falta
// que salga. Antes de esto había cuatro huecos por los que una así dejaba de verse (F9.184 H1-H4):
// el estado del ítem la tapaba, el filtro `fecha >= hoy` de los sueltos la soltaba al vencer, la
// card de vencidos solo miraba el mes en pantalla y la campana solo miraba ítems.
//
// Todo lo de acá es puro (sin Firestore): las pantallas lo consumen y scripts/verificarF9184.ts lo
// ejercita con los mismos datos.
import type { Movement } from '../types';
import { cubierto, movimientoCubierto, type CheckItem } from './checklist';

function inicioDia(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

// F9.132.2 cambio 1 — fecha con la que un movimiento se considera exigible: la primera de
// `vencimientos[].fecha` cuando el comprobante la trajo, si no la fecha del movimiento.
// Medido sobre los impagos del 7/8/2026: AYSA no tiene `vencimientos` (cae a `m.fecha`) y
// Empresa Distribuidora sí, con `2026-08-07` — el mismo día. Las dos ramas están vivas.
// Se normaliza a inicio de día para poder comparar contra `inicioHoy` sin arrastrar la hora.
// F9.184 — se mudó acá desde Resumen.tsx, sin cambiar la lógica: ahora la usan también la agenda
// y la campana, y una segunda copia sería otra vez dos definiciones de lo mismo.
export function fechaEfectivaMov(m: Movement): Date {
  const venc = m.vencimientos;
  if (Array.isArray(venc) && venc.length > 0 && venc[0]?.fecha) {
    const d = new Date(`${String(venc[0].fecha).slice(0, 10)}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }
  return inicioDia(m.fecha);
}

export type EstadoObligacion = 'vencida' | 'hoy' | 'proxima';

// (`ObligacionAbierta` ya existe en src/datos/comprobantes.ts y es otra cosa: el candidato del
// picker de conciliación. Por eso el nombre corto.)
export interface Obligacion {
  mov: Movement;
  fechaEfectiva: Date;
  estado: EstadoObligacion;
}

export function esObligacionAbierta(m: Pick<Movement, 'tipo' | 'pagado' | 'confirmadoPago'>): boolean {
  return m.tipo === 'Gasto' && !movimientoCubierto(m);
}

function estadoDe(fecha: Date, hoy: Date): EstadoObligacion {
  const h = inicioDia(hoy).getTime();
  const f = fecha.getTime();
  return f < h ? 'vencida' : f === h ? 'hoy' : 'proxima';
}

/** Las obligaciones abiertas de `movs`, con fecha efectiva y estado, de la más vieja a la más nueva. */
export function obligacionesAbiertas(movs: Movement[], hoy: Date): Obligacion[] {
  return movs
    .filter(esObligacionAbierta)
    .map(mov => { const fechaEfectiva = fechaEfectivaMov(mov); return { mov, fechaEfectiva, estado: estadoDe(fechaEfectiva, hoy) }; })
    .sort((a, b) => a.fechaEfectiva.getTime() - b.fechaEfectiva.getTime());
}

/**
 * Las vencidas de meses ANTERIORES a `mes`, sacadas del conjunto de todos los meses
 * (`useObligacionesAbiertas`). Las del propio mes salen de los movimientos del mes, que es la
 * consulta que la pantalla ya tiene viva: así una misma obligación nunca entra dos veces.
 */
export function vencidasAnteriores(abiertasTodas: Movement[], mes: string, hoy: Date): Obligacion[] {
  return obligacionesAbiertas(abiertasTodas.filter(m => m.mes < mes), hoy).filter(o => o.estado === 'vencida');
}

/**
 * §2.1 — la card de vencidos del Resumen: vencidas del mes en pantalla más las de meses anteriores.
 * Solo en el mes actual: mirando un mes cerrado no hay "hoy" contra el cual vencer, como antes.
 */
export function vencidasParaResumen(movsDelMes: Movement[], abiertasTodas: Movement[], mes: string, hoy: Date, esMesActual: boolean): Obligacion[] {
  if (!esMesActual) return [];
  return [
    ...obligacionesAbiertas(movsDelMes, hoy).filter(o => o.estado === 'vencida'),
    ...vencidasAnteriores(abiertasTodas, mes, hoy),
  ].sort((a, b) => a.fechaEfectiva.getTime() - b.fechaEfectiva.getTime());
}

/** §2.3 — las obligaciones abiertas que reclama un ítem en su mes (sus matches sin cubrir). */
export function abiertasDelItem(ci: CheckItem): Movement[] {
  return ci.matches.filter(esObligacionAbierta);
}

// ── F9.188 §3 — los dos datos de arriba del Resumen ─────────────────────────────────────────────
// `pendienteMes` sumaba en UN número dos cosas que no son lo mismo: lo que falta CARGAR (un ítem
// esperado sin nada, a su `montoEsperado`) y lo que falta PAGAR (obligaciones cargadas sin cubrir).
// El banner que lo mostraba cambiaba de significado según el estado ("N sin pagar" contaba ítems sin
// cargar) y sumaba pesos y dólares crudos. Ahora son dos funciones y dos datos fijos.

export interface SinCargarMes {
  /** Ítems de Gasto del mes sin NADA cargado y sin cubrir (el `sinCargar` de `pendienteMes`). */
  items: CheckItem[];
  /** Suma de sus `montoEsperado` en pesos equivalentes; null si ninguno lo tiene ("monto desconocido"). */
  esperadoArs: number | null;
  /** Cuántos ya pasaron su `diaVencimiento` sin nada cargado. */
  vencidos: number;
}

/**
 * "Sin cargar: N". `aArs` convierte un `montoEsperado` a pesos: es plata viva, no se movió, así que el
 * llamador usa el TC de hoy (F9.114).
 */
export function sinCargarMes(checklist: CheckItem[], aArs: (monto: number, moneda: 'ARS' | 'USD') => number): SinCargarMes {
  const items = checklist.filter(ci => ci.item.tipo === 'Gasto' && ci.matches.length === 0 && !cubierto(ci.estado));
  const conMonto = items.filter(ci => ci.item.montoEsperado != null);
  return {
    items,
    esperadoArs: conMonto.length === 0 ? null : conMonto.reduce((s, ci) => s + aArs(ci.item.montoEsperado!, ci.item.moneda), 0),
    vencidos: items.filter(ci => ci.estado === 'vencido').length,
  };
}

export interface FaltaPagarMes {
  /** Las obligaciones abiertas del mes más, en el mes actual, las vencidas de meses anteriores (F9.184), por fecha. */
  obligaciones: Obligacion[];
  /** Total en pesos equivalentes, con la conversión de los totales del Resumen. */
  ars: number;
  /** Los dólares que entran en `ars`, en su moneda ("incluye U$S Z"). */
  usd: number;
  vencidas: number;
}

/**
 * "Falta pagar: $Y". SOLO obligaciones abiertas: el `montoEsperado` de lo no cargado está en el otro
 * dato. `aArs` es `arsEq` del Resumen (cada movimiento a su TC), para no volver a sumar monedas crudas.
 */
export function faltaPagarMes(movsDelMes: Movement[], abiertasTodas: Movement[], mes: string, hoy: Date, esMesActual: boolean, aArs: (m: Movement) => number): FaltaPagarMes {
  const obligaciones = [
    ...obligacionesAbiertas(movsDelMes, hoy),
    ...(esMesActual ? vencidasAnteriores(abiertasTodas, mes, hoy) : []),
  ].sort((a, b) => a.fechaEfectiva.getTime() - b.fechaEfectiva.getTime());
  return {
    obligaciones,
    ars: obligaciones.reduce((s, o) => s + Math.abs(aArs(o.mov)), 0),
    usd: obligaciones.filter(o => o.mov.moneda === 'USD').reduce((s, o) => s + Math.abs(o.mov.monto), 0),
    vencidas: obligaciones.filter(o => o.estado === 'vencida').length,
  };
}

export interface PendienteMes {
  /** Monto crudo, sin conversión de moneda (igual que el pendiente de antes, `pendienteAgenda`). */
  monto: number;
  /** Obligaciones vencidas (del mes y, en el mes actual, de meses anteriores) + ítems vencidos sin cargar. */
  vencidos: number;
  /** Cuántas obligaciones abiertas entran: las del mes más las vencidas de meses anteriores. */
  obligaciones: number;
}

/**
 * F9.184 §2.2 — el pendiente del mes en UN número. DESDE F9.188 §3 LA APP NO LO USA: lo reemplazan
 * `sinCargarMes` y `faltaPagarMes`. Queda porque scripts/verificarF9184.ts y scripts/ejecutarF9185.ts
 * lo cargan para reproducir sus mediciones, y por eso conserva su contrato: suma cruda de monedas.
 * Se arma con las dos funciones nuevas para que los conjuntos tengan una sola definición.
 */
export function pendienteMes(checklist: CheckItem[], movsDelMes: Movement[], abiertasTodas: Movement[], mes: string, hoy: Date, esMesActual: boolean): PendienteMes {
  const crudo = (m: Movement) => m.monto;
  const fp = faltaPagarMes(movsDelMes, abiertasTodas, mes, hoy, esMesActual, crudo);
  const sc = sinCargarMes(checklist, monto => monto);
  return { monto: fp.ars + (sc.esperadoArs ?? 0), vencidos: fp.vencidas + sc.vencidos, obligaciones: fp.obligaciones.length };
}

/** §3 — lo que entra en la campana: vencidas (de cualquier antigüedad), de hoy, y las próximas dentro de la ventana. */
export function obligacionesParaCampana(obligaciones: Obligacion[], hoy: Date, diasVentana: number): Obligacion[] {
  const limite = inicioDia(hoy).getTime() + diasVentana * 86400000;
  return obligaciones.filter(o => o.estado !== 'proxima' || o.fechaEfectiva.getTime() <= limite);
}

/**
 * §3 — sin duplicar: el aviso por `diaVencimiento` de un ítem se reemplaza por los de sus
 * obligaciones cuando tiene alguna ABIERTA cargada en el mes. Un ítem con el pago cargado pero sin
 * confirmar (cubierto) no tiene obligación abierta y conserva su aviso "falta confirmar".
 */
export function itemTieneObligacionAbierta(ci: CheckItem): boolean {
  return ci.matches.some(esObligacionAbierta);
}
