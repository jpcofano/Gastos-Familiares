// Lógica de match/estado del checklist de itemsEsperados — extraída de Resumen.tsx
// (recuperada de git 0bc11e6, nunca reescrita) para compartirla con Notificaciones
// (F9.43), que necesita el mismo "¿este ítem ya está cubierto este mes?" sin
// duplicar las 3 ramas de matching (itemEsperadoId / tarjetaCodigo / matchTexto).
import type { EstadoChecklist } from '../design-system/components';
import type { Movement, ExpectedItem } from '../types';

// F9.111 — matcheo de tokens con límite de palabra. Antes era includes() crudo, así que
// 'glob' matcheaba "BODEGON EL GLOBITO SRL" y 'sa' matcheaba cualquier razón social.
// Sin lookbehind a propósito: no está disponible en todos los WebView de Android/iOS viejos.
export const LARGO_MINIMO_TOKEN = 3;

const esAlfanum = (c: string) => /[\p{L}\p{N}]/u.test(c);

export function coincideToken(texto: string, patron: string): boolean {
  const p = patron.trim().toLowerCase();
  if (p.length < LARGO_MINIMO_TOKEN) return false; // token demasiado corto: se ignora
  const t = texto.toLowerCase();
  for (let i = t.indexOf(p); i !== -1; i = t.indexOf(p, i + 1)) {
    const antes = i === 0 ? '' : t[i - 1];
    const desp = t[i + p.length] ?? '';
    if ((!antes || !esAlfanum(antes)) && (!desp || !esAlfanum(desp))) return true;
  }
  return false;
}

// F9.111 — puntaje de especificidad de un reclamo. null = el ítem no reclama el movimiento.
// El predicado replica el de la vieja movimientosDelItem (rama 1 tarjeta, rama 2 matchTexto/
// cat+subcat); lo nuevo es el score, que decide quién gana cuando más de un ítem reclama el
// mismo movimiento libre (sin itemEsperadoId propio).
// Fallback (§4.2 del spec): si NINGÚN token de incluye llega al largo mínimo, el ítem se trata
// como si no tuviera matchTexto (cae a categoría+subcategoría) en vez de dejar de matchear todo.
function puntajeReclamo(item: ExpectedItem, m: Movement): number | null {
  if (item.tarjetaCodigo) {
    return (m.subtipo === 'TarjetaPago' && m.tarjetaCodigo === item.tarjetaCodigo && m.moneda === item.moneda) ? 8 : null;
  }
  if (m.tipo !== item.tipo) return null;
  if (m.moneda !== item.moneda) return null;

  const cat = item.categoria !== null && m.categoria === item.categoria;
  const subcat = item.subcategoria !== null && m.subcategoria === item.subcategoria;

  const tokensUtiles = item.matchTexto ? item.matchTexto.incluye.filter(t => t.trim().length >= LARGO_MINIMO_TOKEN) : [];
  if (item.matchTexto && tokensUtiles.length > 0) {
    const desc = (m.descripcion ?? '').toLowerCase();
    if (!item.matchTexto.incluye.some(t => coincideToken(desc, t))) return null;
    if (item.matchTexto.excluye.some(t => coincideToken(desc, t))) return null;
    return 1 + (cat ? 2 : 0) + (subcat ? 2 : 0); // el texto solo es lo MENOS específico
  }

  if (item.categoria !== null && m.categoria !== item.categoria) return null;
  if (item.subcategoria !== null && m.subcategoria !== item.subcategoria) return null;
  if (item.tipo === 'Ingreso' && item.persona !== null && m.persona !== item.persona) return null;
  return (cat ? 2 : 0) + (subcat ? 2 : 0) + (item.tipo === 'Ingreso' && item.persona !== null ? 1 : 0);
}

function push<K>(mapa: Map<K, Movement[]>, clave: K, m: Movement): void {
  const arr = mapa.get(clave);
  if (arr) arr.push(m); else mapa.set(clave, [m]);
}

function pushDisputa(mapa: Map<string, DisputaChecklist[]>, clave: string, d: DisputaChecklist): void {
  const arr = mapa.get(clave);
  if (arr) arr.push(d); else mapa.set(clave, [d]);
}

export function aplicaEnMes(_item: ExpectedItem, _mes: string): boolean {
  // TODO: periodicidades no mensuales necesitan mes-ancla (ver docs/CLAUDE.md). Placeholder: aplica siempre.
  return true;
}

// F9.99.7 — corte de semántica de pagos: los meses >= este valor ya no asumen "pagado" sin
// evidencia (ni por arrastre de mes pasado, ni por diaVencimiento de un débito automático).
// Los meses < corte conservan el comportamiento legacy — no se re-pinta la historia.
// Ver docs/prompts/F9.99.7-semantica-pagos-y-match-futuros.md.
export const MES_CORTE_SEMANTICA_PAGOS = '2026-07';

// F9.132.2 §4 — la fecha con la que un ítem puede vencer. Prioridad medida, no supuesta:
// `diaVencimiento` está poblado en 1 de 22 ítems activos, así que apoyar el vencimiento
// solo en él dejaba la rama muerta (`estadoItem` no podía devolver 'vencido' para nadie
// salvo Monotributo). La app carga la fecha real en `vencimientos[0].fecha` del movimiento
// matcheado — ésa manda; `diaVencimiento` queda como fallback del ítem sin movimiento.
// Devuelve YYYY-MM-DD, o null cuando no hay ninguna de las dos: sin fecha no hay vencimiento.
export function fechaEfectivaItem(item: ExpectedItem, matches: Movement[], mes: string): string | null {
  const venc = matches[0]?.vencimientos;
  if (Array.isArray(venc) && venc.length > 0 && venc[0]?.fecha) return String(venc[0].fecha).slice(0, 10);
  if (item.diaVencimiento) return `${mes}-${String(item.diaVencimiento).padStart(2, '0')}`;
  return null;
}

// Cubierto a los efectos del vencimiento: la plata ya salió (`pagado`) o ya se confirmó que
// salió (`confirmadoPago`). Un por_confirmar con el débito ya impactado NO está vencido:
// lo que falta es la confirmación, que es otro problema.
function tieneCobertura(matches: Movement[]): boolean {
  return matches.some(m => m.pagado === true || m.confirmadoPago === true);
}

function estaVencido(item: ExpectedItem, matches: Movement[], mes: string, hoyIso: string): boolean {
  const fe = fechaEfectivaItem(item, matches, mes);
  return fe != null && fe < hoyIso && !tieneCobertura(matches);
}

function isoDeHoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function estadoItem(item: ExpectedItem, matches: Movement[], mesActualStr: string, mes: string): EstadoChecklist {
  if (!aplicaEnMes(item, mes)) return 'no_aplica';
  const corte = mes >= MES_CORTE_SEMANTICA_PAGOS;
  const hoyIso = isoDeHoy();

  if (matches.length > 0) {
    // F9.99.7 Parte 5 — fin del arrastre: solo meses < corte siguen asumiendo "pagado" por
    // el mero hecho de estar en el pasado, sin mirar confirmadoPago.
    if (!corte && mes < mesActualStr) return 'pagado';
    const confirmados = matches.filter(m => m.confirmadoPago);
    if (confirmados.length > 0) {
      const montoConf = confirmados.reduce((s, m) => s + Math.abs(m.monto), 0);
      if (item.montoEsperado != null && montoConf < item.montoEsperado * 0.99) return 'parcial';
      return 'pagado';
    }
    // F9.132.2 §4 — un ítem con movimiento cargado pero sin cobertura (ni pagado ni confirmado)
    // cuya fecha efectiva ya pasó está vencido, no meramente "a confirmar". Antes esta rama
    // devolvía siempre 'por_confirmar' y el vencimiento no se miraba nunca.
    if (corte && mes === mesActualStr && estaVencido(item, matches, mes, hoyIso)) return 'vencido';
    return 'por_confirmar';
  }

  if (item.pagoAutomatico && !corte) {
    // F9.61 — legacy (mes < corte): débito automático se asume pagado por vencimiento.
    if (mes < mesActualStr) return 'pagado';
    if (mes > mesActualStr) return 'programado';
    if (item.diaVencimiento && item.diaVencimiento <= new Date().getDate()) return 'pagado';
    return 'automatico';
  }
  // F9.99.7 Parte 4.1 — mes >= corte: pagoAutomatico ya no es atajo de estado, es metadato.
  // Cae a la misma máquina que cualquier ítem: programado / no_registrado / vencido / pendiente.
  if (mes > mesActualStr) return 'programado';
  if (mes < mesActualStr) return 'no_registrado';
  // F9.132.2 §4 — antes: `item.diaVencimiento < new Date().getDate()`. Sin movimiento no hay
  // `vencimientos[]`, así que acá la fecha efectiva es siempre el `diaVencimiento` del ítem —
  // el cambio real es comparar fechas completas en vez de números de día sueltos.
  if (estaVencido(item, matches, mes, hoyIso)) return 'vencido';
  return 'pendiente';
}

export function cubierto(estado: EstadoChecklist): boolean { return estado === 'pagado' || estado === 'automatico'; }

export const ORDEN_ESTADO: Record<EstadoChecklist, number> = {
  vencido: 0, pendiente: 1, por_confirmar: 2, parcial: 3,
  no_registrado: 4, programado: 5, automatico: 6,
  pagado: 7, no_aplica: 8,
};

// F9.111 — empate arbitrado: más de un ítem reclamó este movimiento con el mismo score máximo.
export interface DisputaChecklist { movId: string; otros: string[] }

export interface CheckItem {
  item: ExpectedItem;
  matches: Movement[];
  estado: EstadoChecklist;
  disputas?: DisputaChecklist[];
}

export function mesActualStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// F9.111 — resolvedor con arbitraje, reemplaza la vieja movimientosDelItem (cada ítem se
// evaluaba de forma independiente, así que N ítems podían devolver el mismo movimiento).
// Regla nueva: un movimiento lo reclama un solo ítem. Pase 1 preserva la garantía de F9.110
// (dueño explícito por itemEsperadoId manda sobre todo, sin participar de la heurística).
// Pase 2 arbitra entre las heurísticas: gana el reclamo más específico; empate en el máximo
// se resuelve por menor id (determinístico) y se deja registrado en `disputas` para mostrarlo,
// no para ocultarlo. Un itemEsperadoId colgado (ítem borrado) no se asigna en el pase 1: queda
// libre para el pase 2 y no se pierde del checklist.
export function calcularChecklist(items: ExpectedItem[], movs: Movement[], mes: string): CheckItem[] {
  const mesHoy = mesActualStr();
  const idsConocidos = new Set(items.map(i => i.id)); // activos + inactivos: un ítem
  const activos = items.filter(i => i.activo); // desactivado sigue siendo dueño (pase 1)

  const porItem = new Map<string, Movement[]>();
  const disputas = new Map<string, DisputaChecklist[]>();
  const asignados = new Set<string>();

  // Pase 1 — vínculo directo (manda sobre todo).
  for (const m of movs) {
    if (m.itemEsperadoId && idsConocidos.has(m.itemEsperadoId)) {
      push(porItem, m.itemEsperadoId, m);
      asignados.add(m.id);
    }
  }

  // Un ítem con vínculo directo NO participa de la heurística del pase 2.
  const candidatos = activos.filter(i => (porItem.get(i.id)?.length ?? 0) === 0);

  // Pase 2 — arbitraje: cada movimiento libre va a UN solo ítem.
  for (const m of movs) {
    if (asignados.has(m.id)) continue;
    const reclamos = candidatos
      .map(i => ({ id: i.id, score: puntajeReclamo(i, m) }))
      .filter((r): r is { id: string; score: number } => r.score !== null);
    if (reclamos.length === 0) continue;

    // Mayor score gana; empate ⇒ menor id lexicográfico (determinístico e independiente
    // del orden en que Firestore devuelva los ítems).
    reclamos.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    const ganador = reclamos[0];
    push(porItem, ganador.id, m);
    asignados.add(m.id);

    // Solo es ambigüedad cuando EMPATAN en el máximo: ahí el desempate es arbitrario y hay
    // que mostrarlo. Si el ganador gana por score, el arbitraje es correcto y no molesta.
    const empatados = reclamos.filter(r => r.score === ganador.score);
    if (empatados.length > 1) {
      pushDisputa(disputas, ganador.id, { movId: m.id, otros: empatados.slice(1).map(r => r.id) });
    }
  }

  return activos
    .map(item => {
      const matches = porItem.get(item.id) ?? [];
      return { item, matches, estado: estadoItem(item, matches, mesHoy, mes), disputas: disputas.get(item.id) };
    })
    .sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]);
}

export const ACCIONABLE: EstadoChecklist[] = ['pendiente', 'vencido', 'no_registrado', 'por_confirmar'];
