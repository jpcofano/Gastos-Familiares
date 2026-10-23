// F9.116 §1 — métricas de composición del portafolio, extraídas de vistas/Patrimonio.tsx.
// Vivían dentro de un archivo de ~4.100 líneas y sin exportar: no se podían reusar desde un
// módulo de datos ni verificar de forma aislada. Este módulo es puro: sin Firestore, sin
// React, sin Date.now(). La lógica de cálculo se movió TAL CUAL — cualquier diferencia
// numérica en la solapa Resumen respecto de antes del refactor es un bug, no una mejora.
import type { Posicion, PatMetrics, PosicionManual } from '../types/patrimonio';

// La "lente invertible" mira corrida + manuales juntas: una posición manual se proyecta a
// Posicion para entrar a las métricas y a los escenarios de riesgo.
export function manualToPosicion(m: PosicionManual): Posicion {
  return {
    ticker: m.ticker, tipo: m.tipo, sector: m.sector,
    pais_riesgo: m.pais_riesgo, cuenta: m.cuenta,
    titular: null, moneda_origen: 'USD', valor_origen: m.valorUsd,
    cantidad: m.cantidad, fuente: 'manual', revisar: false,
    valorUsd: m.valorUsd, tcUsado: null, fechaCorrida: m.fechaValuacion,
  };
}

// ── Sector crudo → grupo de display ───────────────────────────────────────────
// Acompaña a calcMetrics porque las claves de bySector son las de display (no las crudas).
//
// F9.196 nota de revisión 6 — `sector` es texto libre en el `.txt` (el contrato fija `tipo` y
// `pais_riesgo`, no `sector`): la carga del 13/10 trae 15 claves y el mapa viejo no tenía 8, que se
// mostraban crudas ("soberano_usd AR", "efectivo AR", "AR" a secas). Es SOLO display: las claves
// guardadas no cambian y el modelo de riesgo (patrimonioRiesgo.ts) las sigue usando tal cual.
//
// `pais`:
// - 'sufijo'  → " AR" / " Global" según `pais_riesgo`, como siempre (Energía AR, Tecnología Global…);
// - 'ninguno' → sin país (Cripto, Stablecoins, Cash, Global, Sin clasificar);
// - 'fijo'    → el nombre ya lo dice (Renta fija pesos AR, Renta fija USD AR, Acciones AR (FCI)).
export type GrupoSector = { grupo: string; pais: 'sufijo' | 'ninguno' | 'fijo' };

export const SIN_CLASIFICAR = 'Sin clasificar';

export const GRUPO_SECTOR: Record<string, GrupoSector> = {
  cripto:              { grupo: 'Cripto', pais: 'ninguno' },
  // La reserva en USDC/USDT: aparte de Cripto (no la infla) y de Cash (no es la caja del broker).
  // El riesgo "Cripto (clase)" va por `tipo`, no cambia.
  stablecoin:          { grupo: 'Stablecoins', pais: 'ninguno' },
  // Una sola caja: la cartera viva usa `cash`, la carga `efectivo` (BCMMUSDA, money market USD).
  // Lo que está en pesos también va acá (separar pesos y dólares es otra decisión).
  cash:                { grupo: 'Cash', pais: 'ninguno' },
  efectivo:            { grupo: 'Cash', pais: 'ninguno' },
  money_market_usd:    { grupo: 'Cash', pais: 'ninguno' },
  cer_pesos:           { grupo: 'Renta fija pesos AR', pais: 'fijo' },
  lecaps_pesos:        { grupo: 'Renta fija pesos AR', pais: 'fijo' },
  money_market_pesos:  { grupo: 'Renta fija pesos AR', pais: 'fijo' },
  deuda_soberana_ar:   { grupo: 'Renta fija pesos AR', pais: 'fijo' },
  soberano_usd:        { grupo: 'Renta fija USD AR', pais: 'fijo' },
  deuda_soberana_usd:  { grupo: 'Renta fija USD AR', pais: 'fijo' },
  corporativo_usd:     { grupo: 'Renta fija USD AR', pais: 'fijo' },
  on:                  { grupo: 'Renta fija USD AR', pais: 'fijo' },
  renta_variable_ar:   { grupo: 'Acciones AR (FCI)', pais: 'fijo' },
  energia:             { grupo: 'Energía', pais: 'sufijo' },
  bancos:              { grupo: 'Bancos', pais: 'sufijo' },
  materiales:          { grupo: 'Materiales', pais: 'sufijo' },
  agro:                { grupo: 'Agro', pais: 'sufijo' },
  telecom:             { grupo: 'Telecom', pais: 'sufijo' },
  tecnologia:          { grupo: 'Tecnología', pais: 'sufijo' },
  tech:                { grupo: 'Tecnología', pais: 'sufijo' },
  consumo:             { grupo: 'Consumo', pais: 'sufijo' },
  real_estate:         { grupo: 'Real Estate', pais: 'sufijo' },
  fci:                 { grupo: 'FCI', pais: 'sufijo' },
  global:              { grupo: 'Global', pais: 'ninguno' },
};

/**
 * El grupo que se ve en la composición. Una clave vacía o desconocida NO se muestra cruda: va a
 * "Sin clasificar" (y en el desplegable se ve la clave original).
 */
/** "Energía" / "Real Estate" / "real-estate" → "energia" / "real_estate": las manuales se cargan a mano. */
const claveSector = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim().toLowerCase().replace(/[\s-]+/g, '_');

export function sectorDisplay(sector: string | null | undefined, pais_riesgo: string | null | undefined): string {
  const g = GRUPO_SECTOR[claveSector(sector)];
  if (!g) return SIN_CLASIFICAR;
  if (g.pais !== 'sufijo') return g.grupo;
  return g.grupo + (pais_riesgo === 'AR' ? ' AR' : pais_riesgo === 'global' ? ' Global' : '');
}

export function calcMetrics(posiciones: Posicion[]): PatMetrics {
  const total = posiciones.reduce((s, p) => s + p.valorUsd, 0);
  const bySector: Record<string, number> = {};
  const byTipo:   Record<string, number> = {};
  const byPais = { AR: 0, global: 0 };

  for (const p of posiciones) {
    const sec = sectorDisplay(p.sector, p.pais_riesgo);
    bySector[sec]  = (bySector[sec]  ?? 0) + p.valorUsd;
    byTipo[p.tipo] = (byTipo[p.tipo] ?? 0) + p.valorUsd;
    byPais[p.pais_riesgo] += p.valorUsd;
  }

  // Concentración por ticker (GLOB CEDEAR + GLOB manual se suman)
  const byTickerAll: Record<string, number> = {};
  const byTickerNoCripto: Record<string, number> = {};
  for (const p of posiciones) {
    byTickerAll[p.ticker] = (byTickerAll[p.ticker] ?? 0) + p.valorUsd;
    if (p.tipo !== 'cripto') byTickerNoCripto[p.ticker] = (byTickerNoCripto[p.ticker] ?? 0) + p.valorUsd;
  }
  const tickerAllEntries    = Object.entries(byTickerAll).sort((a, b) => b[1] - a[1]);
  const tickerNoCriptoEntries = Object.entries(byTickerNoCripto).sort((a, b) => b[1] - a[1]);

  const top1Entry = tickerNoCriptoEntries[0] ?? tickerAllEntries[0] ?? ['—', 0];
  const top1 = total > 0 ? top1Entry[1] / total : 0;
  const top3 = total > 0 ? tickerAllEntries.slice(0, 3).reduce((s, [, v]) => s + v, 0) / total : 0;
  const top5 = total > 0 ? tickerAllEntries.slice(0, 5).reduce((s, [, v]) => s + v, 0) / total : 0;
  const hhi  = total > 0 ? tickerAllEntries.reduce((s, [, v]) => s + (v / total) ** 2, 0) : 0;

  const sectorEntry = Object.entries(bySector).sort((a, b) => b[1] - a[1])[0] ?? ['—', 0];
  const cripto = total > 0 ? (byTipo.cripto ?? 0) / total : 0;
  const rvUsd  = posiciones
    .filter(p => p.tipo === 'accion' || p.tipo === 'cedear' || p.tipo === 'cripto')
    .reduce((s, p) => s + p.valorUsd, 0);

  return {
    total, bySector, byTipo, byPais,
    nombreTop: { ticker: top1Entry[0] },
    top1, top3, top5, hhi,
    sectorTop: { nombre: sectorEntry[0], pct: total > 0 ? sectorEntry[1] / total : 0 },
    paisAr: total > 0 ? byPais.AR / total : 0,
    cripto, rvPct: total > 0 ? rvUsd / total : 0,
  };
}
