// F9.196 H6 (base §7, diseño 3) — "Acciones a mirar": de los indicadores del cron (stops, señales,
// tesis) a las filas de la card de Resumen y al orden de Tenencias. PURO (sin Firestore).
//
// ⛔ Contrato: los stops son niveles de REFERENCIA, no órdenes. Ningún texto de acá dice qué hacer:
// describe dónde está el precio respecto de un nivel medido, o qué señal se encendió.
import type { IndicadoresPosicion } from '../types/patrimonio';

export type MotivoAMirar = 'stop_tocado' | 'stop_cerca' | 'senal_nueva' | 'gatillo' | 'evento';

/** Orden de §7: stop tocado, stop cerca, señal nueva de atención, gatillo que cambió, evento ≤ 7 días. */
const PRIORIDAD: Record<MotivoAMirar, number> = { stop_tocado: 1, stop_cerca: 2, senal_nueva: 3, gatillo: 4, evento: 5 };

export type FilaAMirar = {
  identidad: string;
  ticker: string;
  motivo: MotivoAMirar;
  precio: number | null;
  moneda: 'ARS' | 'USD' | null;
  /** Variación del último cierre contra el anterior (de `historialStops`), o null. */
  variacionDia: number | null;
  /** Segunda línea: "Stop ATR 36,40 (−6,9%) · SMA200 debajo · Balance en 4 días". */
  detalle: string[];
};

const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1).replace('.', ',')}%`;

/** Variación del último cierre contra el anterior, de las lecturas guardadas en `historialStops`. */
export function variacionDia(ind: Pick<IndicadoresPosicion, 'historialStops'>): number | null {
  const h = ind.historialStops ?? [];
  if (h.length < 2) return null;
  const [a, b] = [h[h.length - 2].cierre, h[h.length - 1].cierre];
  return a > 0 ? b / a - 1 : null;
}

/** El motivo más importante de una acción, o null si no hay nada que mirar. */
export function motivoDe(ind: IndicadoresPosicion): MotivoAMirar | null {
  const senales = ind.senales ?? [];
  if (ind.stops?.estado === 'tocado') return 'stop_tocado';
  if (ind.stops?.estado === 'cerca') return 'stop_cerca';
  if (senales.some(s => s.nueva && s.nivel === 'atencion' && s.id !== 'gatillo_tesis')) return 'senal_nueva';
  if (senales.some(s => s.id === 'gatillo_tesis')) return 'gatillo';
  if (senales.some(s => s.id === 'evento_proximo')) return 'evento';
  return null;
}

export function detalleDe(ind: IndicadoresPosicion): string[] {
  const out: string[] = [];
  const st = ind.stops;
  if (st?.stopAtr != null) out.push(`Stop ATR ${fmt(st.stopAtr)}${st.distStopAtrPct != null ? ` (${fmtPct(st.distStopAtrPct)})` : ''}`);
  if (st?.estadoSma200 === 'debajo') out.push('SMA200 debajo');
  else if (st?.estadoSma200 === 'cerca') out.push('SMA200 cerca');
  for (const s of ind.senales ?? []) {
    if (s.id === 'evento_proximo') out.push(s.texto);
    else if (s.id === 'gatillo_tesis') out.push(s.texto);
    else if (s.nueva && s.nivel === 'atencion' && s.id !== 'stop_atr_tocado' && s.id !== 'debajo_sma200') out.push(s.texto);
  }
  return out;
}

/**
 * Las excepciones, en el orden de §7. `identidades`: las acciones y CEDEARs que hay HOY en la
 * cartera (las demás pueden tener indicadores viejos).
 */
export function accionesAMirar(indicadores: Map<string, IndicadoresPosicion>, identidades: Set<string>): {
  filas: FilaAMirar[]; revisadas: number; calculadoEnISO: string | null;
} {
  const filas: FilaAMirar[] = [];
  let revisadas = 0;
  let calculadoEnISO: string | null = null;
  for (const [identidad, ind] of indicadores) {
    if (!identidades.has(identidad) || (ind.tipo !== 'accion' && ind.tipo !== 'cedear') || !ind.stops) continue;
    revisadas++;
    if (ind.calculadoEnISO && (!calculadoEnISO || ind.calculadoEnISO > calculadoEnISO)) calculadoEnISO = ind.calculadoEnISO;
    const motivo = motivoDe(ind);
    if (!motivo) continue;
    filas.push({
      identidad, ticker: ind.ticker, motivo, precio: ind.precio, moneda: ind.monedaSerie,
      variacionDia: variacionDia(ind), detalle: detalleDe(ind),
    });
  }
  filas.sort((a, b) => PRIORIDAD[a.motivo] - PRIORIDAD[b.motivo]
    || (indicadores.get(a.identidad)?.stops?.distStopAtrPct ?? Infinity) - (indicadores.get(b.identidad)?.stops?.distStopAtrPct ?? Infinity)
    || a.ticker.localeCompare(b.ticker));
  return { filas, revisadas, calculadoEnISO };
}

// ── Orden de Tenencias ───────────────────────────────────────────────────────

export type OrdenTenencias = 'peso' | 'stop' | 'variacion';

/** Rango para "cerca del stop primero": tocado < cerca < ok < sin stop; a igual estado, menor distancia. */
export function rangoStop(ind: IndicadoresPosicion | null | undefined): [number, number] {
  const st = ind?.stops;
  const r = st?.estado === 'tocado' ? 0 : st?.estado === 'cerca' ? 1 : st?.estado === 'ok' ? 2 : 3;
  return [r, st?.distStopAtrPct ?? Infinity];
}

/**
 * Ordena las tenencias consolidadas (por ticker, que agrupa sus identidades). Para cada ticker se
 * usa su identidad más "cerca del stop" y su variación más negativa.
 */
export function ordenarTenencias<T extends { ticker: string; totalUsd: number; identidades: string[] }>(
  xs: T[], orden: OrdenTenencias, indicadores: Map<string, IndicadoresPosicion>, busqueda = '',
): T[] {
  const q = busqueda.trim().toUpperCase();
  const filtrados = q ? xs.filter(x => x.ticker.toUpperCase().includes(q)) : [...xs];
  const mejorStop = (x: T): [number, number] => x.identidades.map(i => rangoStop(indicadores.get(i)))
    .reduce((a, b) => (b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]) ? b : a), [3, Infinity] as [number, number]);
  const variacion = (x: T) => Math.min(...x.identidades.map(i => {
    const ind = indicadores.get(i);
    return ind ? variacionDia(ind) ?? Infinity : Infinity;
  }));
  if (orden === 'stop') return filtrados.sort((a, b) => { const [ra, da] = mejorStop(a), [rb, db] = mejorStop(b); return ra - rb || da - db || b.totalUsd - a.totalUsd; });
  if (orden === 'variacion') return filtrados.sort((a, b) => variacion(a) - variacion(b) || b.totalUsd - a.totalUsd);
  return filtrados.sort((a, b) => b.totalUsd - a.totalUsd);
}
