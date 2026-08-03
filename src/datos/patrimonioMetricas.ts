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

// ── Sector crudo → display ────────────────────────────────────────────────────
// Acompaña a calcMetrics porque las claves de bySector son las de display (no las crudas).
export const SECTOR_DISPLAY: Record<string, string> = {
  energia:             'Energía',
  bancos:              'Bancos',
  cripto:              'Cripto',
  cer_pesos:           'Renta fija',
  deuda_soberana_ar:   'Renta fija',
  deuda_soberana_usd:  'Renta fija',
  on:                  'ONs',
  cash:                'Cash',
  tecnologia:          'Tecnología',
  tech:                'Tecnología',
  consumo:             'Consumo',
  real_estate:         'Real Estate',
  materiales:          'Materiales',
  agro:                'Agro',
  fci:                 'FCI',
  global:              'Global',
};

export function sectorDisplay(sector: string, pais_riesgo: string): string {
  const base = SECTOR_DISPLAY[sector] ?? sector;
  if (sector === 'cripto' || sector === 'cash' || sector === 'global') return base;
  return base + (pais_riesgo === 'AR' ? ' AR' : pais_riesgo === 'global' ? ' Global' : '');
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
