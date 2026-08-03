// F9.8 — helper único de formateo de moneda. Toda conversión USD↔ARS pasa por
// acá (sin TC propio por pantalla); notación es-AR ($/U$S, miles con punto,
// sin decimales) y sin sufijo "eq"/"≈" en el monto secundario.

export type Moneda = 'ARS' | 'USD';

// F9.114 — último escalón de la cascada de TC (ver datos/tcDiario.ts, tcEfectivoDe):
// /tcDiario → último TC leído con éxito (cache de localStorage) → este literal. Sólo
// se llega acá en una instalación nueva que nunca pudo leer /tcDiario, y la pantalla
// que lo use TIENE que decir que es un valor de referencia. Si se actualiza, que sea
// al último MEP real, no a un valor inventado.
export const TC_FALLBACK = 1454;

export function fmtMoney(monto: number, opts: { from: Moneda; to: Moneda; tc?: number }): string {
  const tc = opts.tc ?? TC_FALLBACK;
  const valor = opts.from === opts.to
    ? monto
    : opts.from === 'USD' ? monto * tc : monto / tc;
  const symbol = opts.to === 'USD' ? 'U$S' : '$';
  return `${symbol} ${Math.round(valor).toLocaleString('es-AR')}`;
}
