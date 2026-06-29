// money.jsx — Formateo de moneda unificado (es-AR) para TODO el kit móvil.
// Cierra la herencia legacy donde cada pantalla formateaba distinto:
//   · Notación única: "$ 1.234.567" (ARS) / "U$S 1.234" (USD) — igual que el
//     componente Money del design system y la pantalla Resumen.
//   · UN solo tipo de cambio: window.M_TC (no más M_DASH.tc divergente).
//   · Sin decimales en mobile (montos grandes; los centavos son ruido).
// Toda pantalla debe usar window.GFMoney en vez de helpers locales.

(function () {
  const TC = () => window.M_TC || 1180;
  const nfes = (n) => Math.round(Math.abs(n)).toLocaleString('es-AR');
  const sign = (n) => (n < 0 ? '-' : '');

  // Formato directo en una moneda ya resuelta.
  const ars = (n) => `${sign(n)}$ ${nfes(n)}`;
  const usd = (n) => `${sign(n)}U$S ${nfes(n)}`;

  // Monto base en USD → string en la moneda elegida ('ARS' | 'USD').
  const fromUSD = (amountUsd, cur) => (cur === 'USD' ? usd(amountUsd) : ars(amountUsd * TC()));
  // Monto base en ARS → string en la moneda elegida.
  const fromARS = (amountArs, cur) => (cur === 'USD' ? usd(amountArs / TC()) : ars(amountArs));

  // Secundario: el MISMO monto en la otra moneda (sin sufijo "eq").
  const otherFromUSD = (amountUsd, cur) =>
    cur === 'USD' ? ars(amountUsd * TC()) : usd(amountUsd);
  const otherFromARS = (amountArs, cur) =>
    cur === 'USD' ? ars(amountArs) : usd(amountArs / TC());

  window.GFMoney = { tc: TC, nfes, ars, usd, fromUSD, fromARS, otherFromUSD, otherFromARS };
})();
