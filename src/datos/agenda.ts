// Agenda unificada de pagos del mes (F9.99.8, extraído a módulo compartido en F9.99.8.1
// para que F9.99.9 — picker de conciliación con agenda unificada — lo reuse sin duplicar).
// Esperados: el checklist actual, SIN cambios en su cálculo (calcularChecklist).
// Futuros sueltos: gastos manuales sin plantilla — tipo='Gasto', pagado=false,
// fecha >= hoy — que ningún ítem esperado capturó (dedupe: si matchean alguna
// rama de movimientosDelItem() ya cuentan como esperado, vía ci.matches).
import type { Movement } from '../types';
import { cubierto, type CheckItem } from './checklist';

export type AgendaEntry = { kind: 'esperado'; ci: CheckItem } | { kind: 'suelto'; mov: Movement };

export function inicioDia(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

export function sueltosFuturosDelMes(movs: Movement[], checklist: CheckItem[], hoy: Date): Movement[] {
  const matchedIds = new Set(checklist.flatMap(ci => ci.matches.map(m => m.id)));
  const inicioHoy = inicioDia(hoy);
  return movs.filter(m =>
    m.tipo === 'Gasto' && !m.pagado && !matchedIds.has(m.id) && inicioDia(m.fecha) >= inicioHoy
  );
}

export function construirAgenda(checklist: CheckItem[], sueltosFuturos: Movement[]): AgendaEntry[] {
  return [
    ...checklist.map(ci => ({ kind: 'esperado', ci } as AgendaEntry)),
    ...sueltosFuturos.map(mov => ({ kind: 'suelto', mov } as AgendaEntry)),
  ];
}

export function agendaCubierto(e: AgendaEntry): boolean {
  return e.kind === 'esperado' ? cubierto(e.ci.estado) : e.mov.confirmadoPago === true;
}

// F9.102 1b — pendiente de UNA entrada, en su moneda nativa (sin conversión ARS-eq):
// vencidos/pendientes sin match aportan montoEsperado; por_confirmar/parcial aportan el
// monto REAL de sus matches (no montoEsperado, que puede venir null); sueltos aportan su
// monto real. Extraído de pendienteAgenda para que PorDiaSeccion (Card HOY) lo reuse.
export function pendienteDeEntrada(e: AgendaEntry): number {
  if (e.kind === 'suelto') return Math.abs(e.mov.monto);
  const c = e.ci;
  const noConfirmado = c.estado === 'por_confirmar' || c.estado === 'parcial';
  const montoReal = c.matches.reduce((a, m) => a + Math.abs(m.monto), 0);
  return noConfirmado ? montoReal : (c.item.montoEsperado ?? 0);
}

// F9.62 (esperados) + F9.99.8 (sueltos) — pendiente TOTAL de la agenda: monto crudo,
// sin conversión de moneda (ver pendienteDeEntrada).
export function pendienteAgenda(agenda: AgendaEntry[]): number {
  return agenda.filter(e => !agendaCubierto(e)).reduce((s, e) => s + pendienteDeEntrada(e), 0);
}

// F9.99.8.1 — día de vencimiento de una entrada de agenda, para intercalar sueltos con
// esperados en orden ascendente (antes los sueltos se anexaban sin ordenar al final).
// Sin día conocido (esperado sin diaVencimiento) se empuja al final del mes (día 99).
export function diaDeAgenda(e: AgendaEntry): number {
  if (e.kind === 'suelto') return e.mov.fecha.getDate();
  return e.ci.item.diaVencimiento ?? 99;
}
