// F9.8 — helper único de formateo de moneda. Toda conversión USD↔ARS pasa por
// acá (sin TC propio por pantalla); notación es-AR ($/U$S, miles con punto,
// sin decimales) y sin sufijo "eq"/"≈" en el monto secundario.

export type Moneda = 'ARS' | 'USD';

// Fallback de TC USD→ARS para datos de EJEMPLO (sin tocar Firestore en esta
// fase). La fuente real es el último doc de /tcDiario (ver datos/tcDiario.ts,
// tcParaFecha) — cuando una pantalla cablea datos reales, usa ese valor en vez
// de este literal. Si se deja un literal de referencia, que sea el último MEP
// real (~1454), no un valor inventado.
export const TC_DEFAULT = 1454;

export function fmtMoney(monto: number, opts: { from: Moneda; to: Moneda; tc?: number }): string {
  const tc = opts.tc ?? TC_DEFAULT;
  const valor = opts.from === opts.to
    ? monto
    : opts.from === 'USD' ? monto * tc : monto / tc;
  const symbol = opts.to === 'USD' ? 'U$S' : '$';
  return `${symbol} ${Math.round(valor).toLocaleString('es-AR')}`;
}
