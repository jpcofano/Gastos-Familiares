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
  /** Fecha del último cierre de esa variación (para decir "hoy" o "al dd/mm"). */
  fechaVariacion: string | null;
  /** Segunda línea: "Stop ATR 36,40 (−6,9%) · SMA200 debajo · Balance en 4 días". */
  detalle: string[];
};

const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtPctAR = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1).replace('.', ',')}%`;
const fmtPct = fmtPctAR;

/** Hoy en Argentina, YYYY-MM-DD. */
export const hoyART = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });

/**
 * Distancia del precio a un nivel, en el formato de §7: nivel ÷ precio − 1 ("Stop ATR 36,40 (−6,9%)"
 * = cuánto tendría que caer el precio para llegar al nivel). El cron guarda precio ÷ nivel − 1.
 */
export const distANivel = (distCron: number) => 1 / (1 + distCron) - 1;

/** Más de esto entre las dos lecturas no es "una rueda": el cron faltó y la variación sería de varios días. */
const MAX_DIAS_ENTRE_LECTURAS = 4;

/**
 * Variación del último cierre contra el anterior, de las lecturas guardadas en `historialStops`, con
 * la fecha de ese último cierre. null si no hay dos lecturas o si entre ellas hay un hueco.
 */
export function variacionConFecha(ind: Pick<IndicadoresPosicion, 'historialStops'>): { valor: number; fecha: string } | null {
  const h = ind.historialStops ?? [];
  if (h.length < 2) return null;
  const [a, b] = [h[h.length - 2], h[h.length - 1]];
  const dias = (Date.parse(`${b.fecha}T12:00:00Z`) - Date.parse(`${a.fecha}T12:00:00Z`)) / 86_400_000;
  if (!(a.cierre > 0) || !(dias > 0) || dias > MAX_DIAS_ENTRE_LECTURAS) return null;
  return { valor: b.cierre / a.cierre - 1, fecha: b.fecha };
}

export function variacionDia(ind: Pick<IndicadoresPosicion, 'historialStops'>): number | null {
  return variacionConFecha(ind)?.valor ?? null;
}

/** "hoy" si la fecha es hoy en Argentina; si no, "al dd/mm". */
export const cuandoFue = (fecha: string, hoy = hoyART()) => (fecha === hoy ? 'hoy' : `al ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`);

/**
 * Modo privado: tapa los montos de un texto (números con decimales o de 3+ cifras), deja los
 * porcentajes y los conteos chicos ("en 4 días", "60 ruedas").
 */
export const taparMontos = (texto: string) => texto.replace(/\d[\d.,]*(\s*%)?/g, (m, pct) => {
  if (pct) return m;
  const digitos = m.replace(/[.,]/g, '');
  return /[.,]\d/.test(m) || digitos.length >= 3 ? '•••' : m;
});

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
  if (st?.stopAtr != null) out.push(`Stop ATR ${fmt(st.stopAtr)}${st.distStopAtrPct != null ? ` (${fmtPct(distANivel(st.distStopAtrPct))})` : ''}`);
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
  filas: FilaAMirar[]; revisadas: number; sinDatos: number; calculadoEnISO: string | null;
} {
  const filas: FilaAMirar[] = [];
  let revisadas = 0, sinDatos = 0;
  let calculadoEnISO: string | null = null;
  for (const [identidad, ind] of indicadores) {
    if (!identidades.has(identidad) || (ind.tipo !== 'accion' && ind.tipo !== 'cedear') || !ind.stops) continue;
    revisadas++;
    if (ind.stops.estado === 'sin_datos') sinDatos++;
    if (ind.calculadoEnISO && (!calculadoEnISO || ind.calculadoEnISO > calculadoEnISO)) calculadoEnISO = ind.calculadoEnISO;
    const motivo = motivoDe(ind);
    if (!motivo) continue;
    filas.push({
      identidad, ticker: ind.ticker, motivo, precio: ind.precio, moneda: ind.monedaSerie,
      variacionDia: variacionConFecha(ind)?.valor ?? null, fechaVariacion: variacionConFecha(ind)?.fecha ?? null, detalle: detalleDe(ind),
    });
  }
  // A igual motivo: los eventos por días al evento; lo demás por distancia al stop.
  const orden = (f: FilaAMirar) => {
    const ind = indicadores.get(f.identidad);
    return f.motivo === 'evento' ? (ind?.tesisCalculo?.diasAlEvento ?? Infinity) : (ind?.stops?.distStopAtrPct ?? Infinity);
  };
  filas.sort((a, b) => PRIORIDAD[a.motivo] - PRIORIDAD[b.motivo]
    || (orden(a) - orden(b) || 0)
    || a.ticker.localeCompare(b.ticker));
  return { filas, revisadas, sinDatos, calculadoEnISO };
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
