// F9.190 — contexto del informe v2 ("Actualizar todo") y evaluación de las señales de la reserva.
//
// Módulo PURO: sin Firestore ni callables, para que se pueda verificar bajo node con datos reales
// (mismo criterio que `contextoPosicion` de F9.147). Los datos asincrónicos (declaraciones,
// custodias, última lectura de señales) los resuelve el llamador y entran ya calculados.

import type { Posicion, PosicionManual } from '../types/patrimonio';
import {
  bloqueDe, posicionesInvertibles, calcEscenarios, calcBrecha, violacionesBandas, exposicionArgentina,
  ESCENARIO_TITULAR, BLOQUE_LABEL, FACTOR_LABEL,
  type Bloque, type Factor, type TopesRiesgo,
} from './patrimonioRiesgo';
import type { Exposicion } from './patrimonioDeclaraciones';
import { universoParaPrompt } from './universoCandidatos';

// ── Materialidad ─────────────────────────────────────────────────────────────
// ELECCIONES DE DISEÑO, no verdades. Con la cartera de oct-2026: 15 materiales, 10 menores y 10
// excluidas (saldos de USD 0,31 a 47 que el v1 analizaba igual que YPFD).
export const UMBRAL_MATERIAL = 0.02;
export const UMBRAL_MENOR = 0.005;

// Las exposiciones sin decidir (F9.131) se mandan acotadas: con el umbral de materialidad salen ~25
// porque los cuatro ejes describen la misma plata desde ángulos distintos (hallazgo abierto de
// F9.131). Al modelo le alcanzan las excedidas y las más grandes.
export const MAX_EXPOSICIONES_CONTEXTO = 6;

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export type PosicionContexto = { ticker: string; sector: string; peso: number; valorUsd: number };

export type ContextoInformeV2 = {
  version: 2;
  fecha: string;
  cartera: {
    totalUsd: number;
    paisAr: number;
    cripto: number;
    hhi: number;
    porBloque: { bloque: string; peso: number }[];
    top5: { ticker: string; peso: number }[];
  };
  riesgo: {
    politica: { toleranciaCaida: number; topePosicion: number; topeDriver: number; pisoCaja: number; configurada: boolean };
    escenarios: { nombre: string; resultado: number }[];
    brechaTitular: { escenario: string; perdida: number; tolerancia: number; cumple: boolean; veces: number } | null;
    fueraDePolitica: { tipo: string; nombre: string; actual: number; limite: number; usd: number }[];
    exposicionArgentina: { peso: number; hhiFactor: number; factoresEfectivos: number; porFactor: { factor: string; peso: number; tickers: string[] }[] } | null;
    exposicionesSinDecidir: { eje: string; etiqueta: string; peso: number; estado: string }[];
  };
  reserva: {
    cajaUsd: number;
    caja: number;
    piso: number;
    faltanteUsd: number;
    senales: SenalEvaluada[] | null;
  };
  materiales: PosicionContexto[];
  menores: { ticker: string; sector: string; peso: number }[];
  excluidas: { cantidad: number; peso: number };
  manuales: { id: string; ticker: string; nombre: string; cantidad: number; valorUsd: number; fechaValuacion: string }[];
  // Para la agenda (la exposición por sector que ya usaba F9.95.1).
  exposicion: Record<string, number>;
};

export type EntradaContexto = {
  fecha: string;
  posiciones: Posicion[];
  manuales: PosicionManual[];
  topes: TopesRiesgo;
  riesgoConfigurado: boolean;
  factores: Record<string, Factor>;
  exposiciones: Exposicion[];             // clasificarExposiciones(), ya calculado
  sectorDe: Record<string, string>;       // ticker → sector para mostrar (buildByTickerMap)
  hhi: number;
  senales: SenalEvaluada[] | null;
};

export function contextoInformeV2(e: EntradaContexto): ContextoInformeV2 {
  const todas = posicionesInvertibles(e.posiciones, e.manuales);
  const total = todas.reduce((s, p) => s + p.valorUsd, 0) || 1;

  // Por ticker (el mismo papel en dos cuentas es una sola posición) y por bloque.
  const porTicker = new Map<string, { usd: number; soloCash: boolean }>();
  const porBloque = new Map<Bloque, number>();
  let paisAr = 0;
  let cripto = 0;
  for (const p of todas) {
    const b = bloqueDe(p);
    const acc = porTicker.get(p.ticker) ?? { usd: 0, soloCash: true };
    acc.usd += p.valorUsd;
    if (b !== 'cash') acc.soloCash = false;
    porTicker.set(p.ticker, acc);
    porBloque.set(b, (porBloque.get(b) ?? 0) + p.valorUsd);
    if (p.pais_riesgo === 'AR') paisAr += p.valorUsd;
    if (b === 'cripto') cripto += p.valorUsd;
  }

  const filas = [...porTicker.entries()]
    .map(([ticker, v]) => ({ ticker, ...v, peso: v.usd / total }))
    .sort((a, b) => b.usd - a.usd);

  // La caja no se analiza como posición: su "análisis" es la reserva, más abajo.
  const analizables = filas.filter(f => !f.soloCash);
  const materiales = analizables.filter(f => f.peso >= UMBRAL_MATERIAL);
  const menores = analizables.filter(f => f.peso >= UMBRAL_MENOR && f.peso < UMBRAL_MATERIAL);
  const excluidas = filas.filter(f => !materiales.includes(f) && !menores.includes(f));

  // Motor de riesgo — las mismas funciones que pinta la card "Riesgo y escenarios".
  const escenarios = calcEscenarios(e.posiciones, e.manuales);
  const titular = escenarios.find(x => x.id === ESCENARIO_TITULAR) ?? null;
  const brecha = titular ? calcBrecha(titular.perdidaPct, e.topes.toleranciaCaidaPct) : null;
  const violaciones = violacionesBandas(e.posiciones, e.manuales, e.topes);
  const expo = exposicionArgentina(todas, e.factores);

  const sinDecidir = e.exposiciones
    .filter(x => x.estado === 'excedida' || x.estado === 'emergente')
    .sort((a, b) => Number(b.estado === 'excedida') - Number(a.estado === 'excedida') || b.pct - a.pct)
    .slice(0, MAX_EXPOSICIONES_CONTEXTO);

  const cajaUsd = porBloque.get('cash') ?? 0;
  const caja = cajaUsd / total;
  const piso = e.topes.pisoCajaPct;

  const exposicion: Record<string, number> = {};
  for (const [b, v] of porBloque) exposicion[BLOQUE_LABEL[b]] = r3(v / total);

  return {
    version: 2,
    fecha: e.fecha,
    cartera: {
      totalUsd: Math.round(total),
      paisAr: r3(paisAr / total),
      cripto: r3(cripto / total),
      hhi: r3(e.hhi),
      porBloque: [...porBloque.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([b, v]) => ({ bloque: BLOQUE_LABEL[b], peso: r3(v / total) })),
      top5: filas.slice(0, 5).map(f => ({ ticker: f.ticker, peso: r3(f.peso) })),
    },
    riesgo: {
      politica: {
        toleranciaCaida: e.topes.toleranciaCaidaPct, topePosicion: e.topes.topePosicionPct,
        topeDriver: e.topes.topeDriverPct, pisoCaja: e.topes.pisoCajaPct, configurada: e.riesgoConfigurado,
      },
      escenarios: [...escenarios]
        .sort((a, b) => a.perdidaPct - b.perdidaPct)
        .map(x => ({ nombre: x.nombre, resultado: r3(x.perdidaPct) })),
      brechaTitular: titular && brecha ? {
        escenario: titular.nombre, perdida: r3(titular.perdidaPct), tolerancia: e.topes.toleranciaCaidaPct,
        cumple: brecha.cumple, veces: Math.round(brecha.factor * 100) / 100,
      } : null,
      fueraDePolitica: violaciones.map(v => ({
        tipo: v.tipo, nombre: v.nombre, actual: r3(v.actual), limite: v.tope, usd: Math.round(v.excesoUsd),
      })),
      exposicionArgentina: expo ? {
        peso: r3(expo.pctInvertible), hhiFactor: r3(expo.hhiFactor), factoresEfectivos: Math.round(expo.nombresEfectivos * 10) / 10,
        porFactor: expo.porFactor
          .filter(f => f.usd > 0 && f.factor !== 'sin_clasificar')
          .map(f => ({ factor: FACTOR_LABEL[f.factor], peso: r3(f.pctInvertible), tickers: f.tickers })),
      } : null,
      exposicionesSinDecidir: sinDecidir.map(x => ({ eje: x.eje, etiqueta: x.etiqueta, peso: r3(x.pct), estado: x.estado })),
    },
    reserva: {
      cajaUsd: Math.round(cajaUsd),
      caja: r3(caja),
      piso,
      faltanteUsd: Math.max(0, Math.round((piso - caja) * total)),
      senales: e.senales,
    },
    materiales: materiales.map(f => ({ ticker: f.ticker, sector: e.sectorDe[f.ticker] ?? '', peso: r3(f.peso), valorUsd: Math.round(f.usd) })),
    menores: menores.map(f => ({ ticker: f.ticker, sector: e.sectorDe[f.ticker] ?? '', peso: r3(f.peso) })),
    excluidas: { cantidad: excluidas.length, peso: r3(excluidas.reduce((s, f) => s + f.peso, 0)) },
    manuales: e.manuales.map(m => ({
      id: m.id, ticker: m.ticker, nombre: m.nombre, cantidad: m.cantidad, valorUsd: m.valorUsd, fechaValuacion: m.fechaValuacion,
    })),
    exposicion,
  };
}

// ── Señales de mercado de la reserva (F9.190 §2) ─────────────────────────────
// Espejo del tipo que escribe la callable `leerSenalesMercado` (functions/src/senalesMercado.ts).
export type DatoMercado = { valor: number | null; fecha: string | null; fuente: string; error: string | null };
export type LecturaMercado = {
  leidoEnISO: string;
  riesgoPais: DatoMercado;
  mervalArs: DatoMercado;
  ccl: DatoMercado;
  mervalUsd: DatoMercado;
  sp500: DatoMercado;
};
export type BaseMercado = { valor: number; fecha: string; fuente?: string };
export type BasesMercado = { mervalUsd: BaseMercado | null; sp500: BaseMercado | null };

// Umbrales elegidos con el titular el 13-oct-2026 (chat de planificación). ELECCIONES, no verdades:
// se discuten sin leer el código. Nivel 1 / nivel 2.
export const UMBRALES_SENALES = {
  riesgoPais: [700, 800] as const,       // puntos básicos
  mervalUsdCaida: [0.15, 0.25] as const, // caída desde la base
  sp500Caida: [0.15] as const,           // caída desde la base
};

export type SenalEvaluada = {
  id: 'riesgoPais' | 'mervalUsd' | 'sp500';
  etiqueta: string;
  valor: number | null;
  fecha: string | null;
  // Para las caídas: variación contra la base (negativa = cayó). Para riesgo país: null.
  variacion: number | null;
  base: BaseMercado | null;
  umbrales: string;
  nivel: 0 | 1 | 2 | null;   // null = sin dato
  error: string | null;
};

const nivelPorUmbrales = (x: number, cortes: readonly number[]): 0 | 1 | 2 =>
  (cortes.length > 1 && x >= cortes[1]) ? 2 : x >= cortes[0] ? 1 : 0;

/**
 * Evalúa la lectura contra los umbrales. Sin histéresis a propósito: no hay notificaciones que
 * puedan rebotar (la decisión fue "solo en la app"), así que un estado que se prende y apaga entre
 * dos lecturas es exactamente lo que pasó en el mercado, no ruido de un aviso.
 */
export function evaluarSenales(lectura: LecturaMercado | null, bases: BasesMercado | null): SenalEvaluada[] {
  if (!lectura) return [];
  const rp = lectura.riesgoPais;
  const caida = (d: DatoMercado, b: BaseMercado | null) =>
    d.valor !== null && b && b.valor > 0 ? d.valor / b.valor - 1 : null;
  const varMerval = caida(lectura.mervalUsd, bases?.mervalUsd ?? null);
  const varSp = caida(lectura.sp500, bases?.sp500 ?? null);
  return [
    {
      id: 'riesgoPais', etiqueta: 'Riesgo país', valor: rp.valor, fecha: rp.fecha, variacion: null, base: null,
      umbrales: `${UMBRALES_SENALES.riesgoPais[0]} / ${UMBRALES_SENALES.riesgoPais[1]} pb`,
      nivel: rp.valor === null ? null : nivelPorUmbrales(rp.valor, UMBRALES_SENALES.riesgoPais),
      error: rp.error,
    },
    {
      id: 'mervalUsd', etiqueta: 'Merval en USD (CCL)', valor: lectura.mervalUsd.valor, fecha: lectura.mervalUsd.fecha,
      variacion: varMerval, base: bases?.mervalUsd ?? null,
      umbrales: `−${UMBRALES_SENALES.mervalUsdCaida[0] * 100}% / −${UMBRALES_SENALES.mervalUsdCaida[1] * 100}% desde la base`,
      nivel: varMerval === null ? null : nivelPorUmbrales(-varMerval, UMBRALES_SENALES.mervalUsdCaida),
      error: lectura.mervalUsd.error,
    },
    {
      id: 'sp500', etiqueta: 'S&P 500 (índice)', valor: lectura.sp500.valor, fecha: lectura.sp500.fecha,
      variacion: varSp, base: bases?.sp500 ?? null,
      umbrales: `−${UMBRALES_SENALES.sp500Caida[0] * 100}% desde la base`,
      nivel: varSp === null ? null : nivelPorUmbrales(-varSp, UMBRALES_SENALES.sp500Caida),
      error: lectura.sp500.error,
    },
  ];
}

// ══ F9.191 — contexto v3: lo que FALTA, no solo lo que hay ══════════════════════
//
// Diagnóstico (corrida del 13-oct-2026 con el prompt v2):
//   1. Todo el prompt partía de lo existente (posiciones, drivers presentes, fueraDePolitica): un
//      activo que la cartera no tiene no tenía dónde aparecer, y el rebalanceo solo sabía recortar.
//   2. Nadie confrontaba política y cartera: tolerancia 10% contra una peor caída de 38,8% salía
//      como "un dato más".
//   3. El modelo gastaba la mitad de las búsquedas en datos que la app YA lee (riesgo país, CCL,
//      SPY) y encontraba valores distintos para el mismo dato (589 vs 595).
//   4. `fueraDePolitica.usd` significaba "falta" para la caja y "sobra" para el resto;
//      `exposicionArgentina` incluía cripto y global; los escenarios no decían qué bloque arrastra.
//   5. Sin universo invertible ni perfil, ninguna "oportunidad" se puede evaluar.
//
// v3 = v2 + esos cinco arreglos. Módulo puro igual que v2 (se verifica en scripts/verificarF9191.ts).

export const VERSION_CONTEXTO_V3 = 3 as const;

/** Escenarios cuya contribución por bloque viaja al prompt (los N peores). */
export const ESCENARIOS_CON_CONTRIBUCION = 4;

/**
 * Perfil del titular. Todavía no hay UI que lo cargue (pendiente F9.192): viaja null y el prompt
 * obliga al modelo a declarar qué supuso. Cuando exista, entra por `EntradaContextoV3.perfil`.
 */
export type PerfilInversor = {
  objetivo: string;                 // p. ej. "preservar poder de compra en USD"
  horizonteAnios: number | null;
  monedaConsumo: 'ARS' | 'USD' | 'mixta';
  necesidadLiquidezUsd12m: number | null;
  notas: string;
};

/**
 * Lo que se puede operar. ELECCIÓN, no verdad: describe familias de instrumentos disponibles en
 * cuentas comitentes argentinas; las cuentas concretas salen de la cartera. La definición de caja
 * es la de F9.190 §2 (la que usa el piso de la política).
 */
export const UNIVERSO_DEFAULT = {
  instrumentos: [
    'Acciones argentinas (BYMA)',
    'CEDEARs, incluidos CEDEARs de ETFs',
    'Bonos soberanos y subsoberanos (USD y pesos)',
    'Letras y bonos del Tesoro en pesos (LECAP, BONCAP, BONCER, dollar linked)',
    'Obligaciones negociables (ON) en USD',
    'FCI: money market en pesos y en USD, renta fija, renta variable',
    'Caución en pesos y en USD',
    'Cripto y stablecoins (en la cuenta cripto existente)',
  ],
  restricciones: [
    'No asumir cuentas en el exterior ni derivados.',
    'Cuenta como caja para el piso: efectivo USD, stablecoins y FCI money market USD. Un money market en pesos o una ON corta NO cuentan.',
  ],
};

export type EntradaContextoV3 = EntradaContexto & {
  lectura?: LecturaMercado | null;
  bases?: BasesMercado | null;
  perfil?: PerfilInversor | null;
};

const datoMercado = (d: DatoMercado | undefined) =>
  d ? { valor: d.valor, fecha: d.fecha, fuente: d.fuente, error: d.error } : null;

const sectorLegible = (s: string) => s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

export function contextoInformeV3(e: EntradaContextoV3) {
  const lectura = e.lectura ?? null;
  const evaluadas = lectura ? evaluarSenales(lectura, e.bases ?? null) : null;
  const v2 = contextoInformeV2({ ...e, senales: evaluadas });

  const todas = posicionesInvertibles(e.posiciones, e.manuales);
  const total = todas.reduce((s, p) => s + p.valorUsd, 0) || 1;

  // Escenarios: los N peores llevan qué bloques explican el resultado, en fracción del TOTAL
  // (−0.12 = ese bloque le resta 12 puntos a la cartera). Un bloque con aporte > 0 en un escenario
  // malo es un amortiguador; si no hay ninguno, la cartera no tiene cobertura para ese caso.
  const escenarios = [...calcEscenarios(e.posiciones, e.manuales)].sort((a, b) => a.perdidaPct - b.perdidaPct);
  const peores = new Set(escenarios.slice(0, ESCENARIOS_CON_CONTRIBUCION).map(x => x.id));

  const violaciones = violacionesBandas(e.posiciones, e.manuales, e.topes);
  const expo = exposicionArgentina(todas, e.factores);

  const cuentas = [...new Set(todas.map(p => p.cuenta).filter((c): c is string => !!c))].sort();

  return {
    version: VERSION_CONTEXTO_V3,
    fecha: v2.fecha,
    perfil: e.perfil ?? null,
    parte: 'estrategia' as const,
    // F9.193 — lista blanca de candidatos (universoCandidatos.ts): el modelo elige de acá.
    universo: { cuentas, ...UNIVERSO_DEFAULT, ...universoParaPrompt(new Set(todas.map(p => p.ticker))) },
    cartera: v2.cartera,
    riesgo: {
      politica: v2.riesgo.politica,
      escenarios: escenarios.map(x => ({
        nombre: x.nombre,
        resultado: r3(x.perdidaPct),
        ...(peores.has(x.id) ? {
          contribucion: x.contribucion
            .filter(c => Math.abs(c.perdidaUsd) / total >= 0.001)
            .map(c => ({ bloque: c.nombre, aporte: r3(c.perdidaUsd / total) })),
        } : {}),
      })),
      brechaTitular: v2.riesgo.brechaTitular,
      fueraDePolitica: violaciones.map(v => ({
        tipo: v.tipo, nombre: v.nombre, actual: r3(v.actual), limite: v.tope,
        usdFaltante: v.tipo === 'caja' ? Math.round(v.excesoUsd) : null,
        usdExcedente: v.tipo === 'caja' ? null : Math.round(v.excesoUsd),
      })),
      exposicionPorFactor: expo ? {
        hhiFactor: r3(expo.hhiFactor),
        factoresEfectivos: Math.round(expo.nombresEfectivos * 10) / 10,
        porFactor: expo.porFactor
          .filter(f => f.usd > 0 && f.factor !== 'sin_clasificar')
          .map(f => ({ factor: FACTOR_LABEL[f.factor], peso: r3(f.pctInvertible), tickers: f.tickers })),
      } : null,
      exposicionesSinDecidir: v2.riesgo.exposicionesSinDecidir,
    },
    reserva: {
      cajaUsd: v2.reserva.cajaUsd,
      caja: v2.reserva.caja,
      piso: v2.reserva.piso,
      faltanteUsd: v2.reserva.faltanteUsd,
    },
    mercado: {
      leidoEnISO: lectura?.leidoEnISO ?? null,
      riesgoPais: datoMercado(lectura?.riesgoPais),
      mervalUsd: datoMercado(lectura?.mervalUsd),
      spy: datoMercado(lectura?.sp500),
      ccl: datoMercado(lectura?.ccl),
      umbrales: {
        riesgoPaisPb: [...UMBRALES_SENALES.riesgoPais],
        mervalUsdCaidaDesdeBase: [...UMBRALES_SENALES.mervalUsdCaida],
        spyCaidaDesdeBase: [...UMBRALES_SENALES.sp500Caida],
      },
      bases: e.bases ?? null,
      senales: evaluadas
        ? evaluadas.map(s => ({ id: s.id, valor: s.valor, variacionDesdeBase: s.variacion === null ? null : r3(s.variacion), nivel: s.nivel }))
        : null,
    },
    materiales: v2.materiales.map(m => ({ ...m, sector: sectorLegible(m.sector) })),
    menores: v2.menores.map(m => ({ ...m, sector: sectorLegible(m.sector) })),
    excluidas: v2.excluidas,
    manuales: v2.manuales,
    exposicion: v2.exposicion,
  };
}

export type ContextoInformeV3 = ReturnType<typeof contextoInformeV3>;

// ══ F9.194 — informe en DOS prompts: estrategia y posiciones ══════════════════════
//
// Decisión de Juan (13-oct-2026): si la calidad mejora con dos prompts, que sean dos. Un solo
// prompt pedía mercado + política + oportunidades + sectorial + agenda + 15 posiciones con 15
// búsquedas: las posiciones llegaban al final con el presupuesto agotado.
//   Parte 1 (estrategia) = contextoInformeV3 → global, oportunidades, sectorial, agenda.
//   Parte 2 (posiciones) = contextoPosicionesV3 → posiciones (análisis + notas) y manuales.
// La parte 2 recibe lo que la parte 1 ya dejó importado (diagnóstico, sectorial, agenda) para no
// repetir búsquedas y para que cada ficha sea coherente con el panorama.

export type PanoramaParte1 = {
  generadoEnISO: string | null;
  diagnostico: string | null;
  sectorial: string | null;
  agenda: { fecha: string | null; evento: string; tickers?: string[] }[] | null;
};

/**
 * @param tesisPrevias F9.196 H5 — la última tesis guardada por ticker (`tesisPosicion`), para que el
 *   chat la actualice. Opcional: sin ella el prompt pide la tesis igual.
 */
export function contextoPosicionesV3(e: EntradaContextoV3, panorama: PanoramaParte1, tesisPrevias: Record<string, unknown> = {}) {
  const v3 = contextoInformeV3(e);
  // Factor de cada ticker, del motor (el mismo que pinta "Riesgo y escenarios").
  const factorDe = new Map<string, string>();
  for (const f of v3.riesgo.exposicionPorFactor?.porFactor ?? []) for (const t of f.tickers) factorDe.set(t, f.factor);
  const conFactor = <T extends { ticker: string }>(x: T) => ({ ...x, factor: factorDe.get(x.ticker) ?? null });
  // F9.196 H5 — la tesis se pide solo para las ACCIONES y CEDEARs materiales.
  const tiposDe = new Map<string, Set<string>>();
  for (const p of [...e.posiciones, ...e.manuales.map(m => ({ ticker: m.ticker, tipo: m.tipo as string }))]) {
    if (!tiposDe.has(p.ticker)) tiposDe.set(p.ticker, new Set());
    tiposDe.get(p.ticker)!.add(p.tipo);
  }
  const conTesis = v3.materiales.map(m => m.ticker)
    .filter(t => [...(tiposDe.get(t) ?? [])].some(tipo => tipo === 'accion' || tipo === 'cedear'));
  return {
    version: VERSION_CONTEXTO_V3,
    parte: 'posiciones' as const,
    fecha: v3.fecha,
    cartera: { totalUsd: v3.cartera.totalUsd, paisAr: v3.cartera.paisAr, cripto: v3.cartera.cripto, porBloque: v3.cartera.porBloque },
    politica: { topePosicion: v3.riesgo.politica.topePosicion, topeDriver: v3.riesgo.politica.topeDriver },
    fueraDePolitica: v3.riesgo.fueraDePolitica.filter(v => v.tipo !== 'caja'),
    panorama,
    materiales: v3.materiales.map(conFactor),
    menores: v3.menores.map(conFactor),
    // F9.195 — el cron de precios valúa las manuales (cantidad × precio live). Al modelo solo le
    // llegan las que quedaron viejas (> DIAS_MANUAL_VIEJA): es el respaldo, no el camino normal.
    manuales: v3.manuales.filter(m => diasEntre(m.fechaValuacion, v3.fecha) > DIAS_MANUAL_VIEJA),
    conTesis,
    tesisPrevias: Object.fromEntries(conTesis.filter(t => tesisPrevias[t] !== undefined).map(t => [t, tesisPrevias[t]])),
  };
}

export const DIAS_MANUAL_VIEJA = 4;
const diasEntre = (desde: string, hasta: string) => {
  const a = Date.parse(`${desde}T00:00:00Z`), b = Date.parse(`${hasta}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : Infinity;
};
