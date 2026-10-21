// F9.196 H2a — PPI como respaldo de precios de data912 (decisiones de Juan del 20/10, 1 y 2).
//
// - data912 sigue siendo la fuente principal. Si falla o no tiene la especie, el precio sale de
//   `MarketData/Current` de PPI, plazo A-24HS (el más parecido al cierre de data912).
// - La escala de PPI (`nominalInPrice`: 1 en acciones y CEDEARs, 100 en ONs) se consulta UNA vez por
//   especie con `MarketData/SearchInstrument` y queda guardada en `indicadoresPosicion.escalaPPI`.
//   Se vuelve a pedir solo si cambia la identidad. Si la consulta falla (YPFD dio 400 "Currency not
//   found" el 20/10), se usa el precio igual, sin escala, y actúa la guarda de escala de la cartera
//   viva (`escala_dudosa`). No se inventa.
// - Cada precio guarda de qué fuente salió: `precioDia.fuente` = 'data912' | 'ppi'.
import type { PosicionTipo, PaisRiesgo } from './patrimonioPrecios';

export type TipoPPI = 'ACCIONES' | 'CEDEARS' | 'BONOS' | 'ON';
export const PLAZO_PPI = 'A-24HS';

/** Tipo de instrumento de PPI para una posición, o null si PPI no aplica (cripto, FCI, cash, USA). */
export function tipoPPI(tipo: PosicionTipo, pais: PaisRiesgo, panelLive: string | null): TipoPPI | null {
  if (panelLive === 'usa_stocks') return null;
  if (tipo === 'accion' && pais === 'AR') return 'ACCIONES';
  if (tipo === 'cedear') return 'CEDEARS';
  if (tipo === 'bono') return 'BONOS';
  if (tipo === 'on') return 'ON';
  return null;
}

export type EscalaPPI = { identidad: string; nominalInPrice: number; consultadoEnISO: string };

/** La escala guardada sirve si es de la misma identidad. */
export function escalaVigente(guardada: unknown, identidad: string): number | null {
  const g = guardada as Partial<EscalaPPI> | null | undefined;
  return g && g.identidad === identidad && typeof g.nominalInPrice === 'number' && g.nominalInPrice > 0 ? g.nominalInPrice : null;
}

/**
 * `nominalInPrice` de la respuesta de SearchInstrument: la fila del mismo ticker, del tipo pedido y
 * en pesos (GLOB, por ejemplo, viene como ACCIONES-USA en NYSE y como CEDEARS en BYMA).
 */
export function escalaDeBusqueda(body: unknown, ticker: string, tipo: TipoPPI): number | null {
  if (!Array.isArray(body)) return null;
  const fila = (body as Array<Record<string, unknown>>).find(x =>
    String(x.ticker ?? '').toUpperCase() === ticker.toUpperCase()
    && String(x.type ?? '').toUpperCase() === tipo
    && /^pesos$/i.test(String(x.currency ?? '')));
  const n = Number(fila?.nominalInPrice);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Precio de `MarketData/Current` (objeto `{date, price, ...}`), o null. */
export function precioDeCurrent(body: unknown): { precio: number; fechaISO: string | null } | null {
  const o = body as { price?: unknown; date?: unknown } | null;
  const p = Number(o?.price);
  return Number.isFinite(p) && p > 0 ? { precio: p, fechaISO: typeof o?.date === 'string' ? o.date : null } : null;
}

export type PrecioDiaGuardado = {
  precio: number;
  moneda: 'ARS' | 'USD';
  fecha: string;                    // YYYY-MM-DD (Argentina)
  fuente: 'data912' | 'ppi';
  /** PPI: el `nominalInPrice` por el que se dividió (null = sin escala conocida, precio crudo). */
  escala: number | null;
};

/**
 * El precio del día: data912 si lo trajo; si no, el de PPI (dividido por su escala si se conoce).
 * Sin ninguno de los dos: null (la cartera viva usa el último conocido, marcado viejo).
 */
export function elegirPrecioDia(args: {
  data912: number | null;
  monedaSerie: 'ARS' | 'USD';
  ppi: { precio: number; escala: number | null } | null;
  hoy: string;
}): PrecioDiaGuardado | null {
  if (args.data912 !== null && args.data912 > 0) {
    return { precio: args.data912, moneda: args.monedaSerie, fecha: args.hoy, fuente: 'data912', escala: null };
  }
  if (args.ppi) {
    const precio = args.ppi.escala ? args.ppi.precio / args.ppi.escala : args.ppi.precio;
    return { precio, moneda: 'ARS', fecha: args.hoy, fuente: 'ppi', escala: args.ppi.escala };
  }
  return null;
}
