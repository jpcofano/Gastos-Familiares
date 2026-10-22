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
  /** Por UNIDAD de cantidad (bonos y ONs por 1 VN), como `PrecioDia` de la cartera viva. */
  precio: number;
  moneda: 'ARS' | 'USD';
  fecha: string;                    // YYYY-MM-DD (Argentina): la del precio, no la de la corrida
  fuente: 'data912' | 'ppi';
  /** Por cuánto se dividió el precio de la fuente (100 = cotiza cada 100 VN; null = sin escala conocida, crudo). */
  escala: number | null;
};

/**
 * Escala del precio de data912: bonos y ONs cotizan cada 100 VN; acciones y CEDEARs, por unidad.
 * F9.196.1 Addendum 1 C: FIJA en 100 para bonos y ONs, medida en vivo el 21/10/2026 con siete
 * especies (docs/patrimonio/data912-escala.md). La escala de PPI (`nominalInPrice`, `escalaPPI`)
 * se usa SOLO para el precio que viene de PPI (`respaldoPPI` / `elegirPrecioDia`), nunca para el de
 * data912: un `nominalInPrice` distinto de 100 dejaría el precio de data912 100 veces corrido.
 */
export function escalaData912(tipo: PosicionTipo): number {
  return tipo === 'bono' || tipo === 'on' ? 100 : 1;
}

const fechaArgDeISO = (iso: string | null): string | null => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Date(ms - 3 * 3600_000).toISOString().slice(0, 10) : null;
};

/**
 * El precio del día: data912 si lo trajo; si no, el de PPI (dividido por su escala si se conoce).
 * Sin ninguno de los dos: null (la cartera viva usa el último conocido, marcado viejo).
 */
export function elegirPrecioDia(args: {
  data912: number | null;
  monedaSerie: 'ARS' | 'USD';
  /** Escala del precio de data912 (ver `escalaData912`). Default 1. */
  escalaData912?: number;
  ppi: { precio: number; escala: number | null; fechaISO?: string | null } | null;
  hoy: string;
}): PrecioDiaGuardado | null {
  if (args.data912 !== null && args.data912 > 0) {
    const escala = args.escalaData912 && args.escalaData912 > 0 ? args.escalaData912 : 1;
    return { precio: args.data912 / escala, moneda: args.monedaSerie, fecha: args.hoy, fuente: 'data912', escala: escala === 1 ? null : escala };
  }
  if (args.ppi) {
    const precio = args.ppi.escala ? args.ppi.precio / args.ppi.escala : args.ppi.precio;
    // La fecha es la de la cotización de PPI (una ON ilíquida puede traer un precio de días atrás).
    return { precio, moneda: 'ARS', fecha: fechaArgDeISO(args.ppi.fechaISO ?? null) ?? args.hoy, fuente: 'ppi', escala: args.ppi.escala };
  }
  return null;
}
