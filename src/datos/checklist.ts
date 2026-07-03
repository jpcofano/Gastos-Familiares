// Lógica de match/estado del checklist de itemsEsperados — extraída de Resumen.tsx
// (recuperada de git 0bc11e6, nunca reescrita) para compartirla con Notificaciones
// (F9.43), que necesita el mismo "¿este ítem ya está cubierto este mes?" sin
// duplicar las 3 ramas de matching (itemEsperadoId / tarjetaCodigo / matchTexto).
import type { EstadoChecklist } from '../design-system/components';
import type { Movement, ExpectedItem } from '../types';

export function movimientosDelItem(item: ExpectedItem, movs: Movement[]): Movement[] {
  // Rama 0: vínculo directo por itemEsperadoId (manda sobre todo)
  const directos = movs.filter(m => m.itemEsperadoId === item.id);
  if (directos.length > 0) return directos;

  // Rama 1: tarjeta por código — identidad fuerte, no categoria/subcategoria
  if (item.tarjetaCodigo) {
    return movs.filter(m => m.subtipo === 'TarjetaPago' && m.tarjetaCodigo === item.tarjetaCodigo && m.moneda === item.moneda);
  }

  // Rama 2: matchTexto manda (relaja cat/subcat) — o, sin matchTexto, clave cat+subcat
  return movs.filter(m => {
    if (m.tipo !== item.tipo) return false;
    if (m.moneda !== item.moneda) return false;
    if (item.matchTexto) {
      const desc = (m.descripcion ?? '').toLowerCase();
      const inc = item.matchTexto.incluye.some(t => desc.includes(t.trim().toLowerCase()));
      const exc = item.matchTexto.excluye.some(t => desc.includes(t.trim().toLowerCase()));
      return inc && !exc;
    }
    if (item.categoria !== null && m.categoria !== item.categoria) return false;
    if (item.subcategoria !== null && m.subcategoria !== item.subcategoria) return false;
    if (item.tipo === 'Ingreso' && item.persona !== null && m.persona !== item.persona) return false;
    return true;
  });
}

export function aplicaEnMes(_item: ExpectedItem, _mes: string): boolean {
  // TODO: periodicidades no mensuales necesitan mes-ancla (ver docs/CLAUDE.md). Placeholder: aplica siempre.
  return true;
}

export function estadoItem(item: ExpectedItem, matches: Movement[], mesActualStr: string, mes: string): EstadoChecklist {
  if (!aplicaEnMes(item, mes)) return 'no_aplica';
  if (matches.length > 0) {
    if (mes < mesActualStr) return 'pagado';
    const confirmados = matches.filter(m => m.confirmadoPago);
    if (confirmados.length > 0) {
      const montoConf = confirmados.reduce((s, m) => s + Math.abs(m.monto), 0);
      if (item.montoEsperado != null && montoConf < item.montoEsperado * 0.99) return 'parcial';
      return 'pagado';
    }
    return 'por_confirmar';
  }
  if (item.pagoAutomatico) {
    // F9.61 — débito automático: usa la fecha para determinar si ya se ejecutó
    if (mes < mesActualStr) return 'pagado';
    if (mes > mesActualStr) return 'programado';
    // mes actual: pagado si el diaVencimiento ya llegó (o no hay día → asumir vigente)
    if (item.diaVencimiento && item.diaVencimiento <= new Date().getDate()) return 'pagado';
    return 'automatico';
  }
  if (mes > mesActualStr) return 'programado';
  if (mes < mesActualStr) return 'no_registrado';
  if (item.diaVencimiento && item.diaVencimiento < new Date().getDate()) return 'vencido';
  return 'pendiente';
}

export function cubierto(estado: EstadoChecklist): boolean { return estado === 'pagado' || estado === 'automatico'; }

export const ORDEN_ESTADO: Record<EstadoChecklist, number> = {
  vencido: 0, pendiente: 1, por_confirmar: 2, parcial: 3,
  no_registrado: 4, programado: 5, automatico: 6,
  pagado: 7, no_aplica: 8,
};

export interface CheckItem { item: ExpectedItem; matches: Movement[]; estado: EstadoChecklist; }

export function mesActualStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function calcularChecklist(items: ExpectedItem[], movs: Movement[], mes: string): CheckItem[] {
  const mesHoy = mesActualStr();
  return items
    .filter(i => i.activo)
    .map(item => {
      const matches = movimientosDelItem(item, movs);
      return { item, matches, estado: estadoItem(item, matches, mesHoy, mes) };
    })
    .sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]);
}

export const ACCIONABLE: EstadoChecklist[] = ['pendiente', 'vencido', 'no_registrado', 'por_confirmar'];
