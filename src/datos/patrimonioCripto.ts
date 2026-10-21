// F9.195 (sistema cripto) §2 y §4 — política propia del bloque cripto y su evaluación.
//
// Módulo puro: sin Firestore, sin React, sin Date.now(). Recibe posiciones, la última lectura de
// precios (functions/src/criptoPrecios.ts), la serie diaria y la política; devuelve números y
// estados. NUNCA una acción sugerida: los casos condicionales de la card son texto fijo acordado con
// el titular, no una salida de este módulo.
//
// El sistema cripto sigue sumando en el total familiar y en sus bandas (decisión §1.1): esto mide
// la composición INTERNA del bloque, no reemplaza la banda de clase ni los escenarios.
//
// Unidades: toda fracción es FRACCIÓN (0.45 = 45%), como en patrimonioRiesgo.ts. Los "puntos" de
// desvío también son fracción (0.05 = 5 pts).
import type { Posicion } from '../types/patrimonio';
import { STABLECOINS, type Custodia } from './patrimonioRiesgo';

// ── Política ──────────────────────────────────────────────────────────────────
export type GrupoCripto = 'BTC' | 'ETH' | 'otras' | 'reserva';
export const GRUPOS_CRIPTO: GrupoCripto[] = ['BTC', 'ETH', 'otras', 'reserva'];
export const GRUPO_CRIPTO_LABEL: Record<GrupoCripto, string> = {
  BTC: 'BTC', ETH: 'ETH', otras: 'Otras', reserva: 'Reserva (stablecoins)',
};

export type PoliticaCripto = {
  objetivo: Record<GrupoCripto, number>;
  bandaPts: number;            // desvío tolerado por grupo
  topePlataformaPct: number;   // máximo del sistema en una sola `cuenta`
  frenoCaidaPct: number;       // caída del valor del sistema desde su máximo que pide revisar
  tramosBtc: number[];         // caídas de BTC desde la base que habilitan cada tercio de la reserva
};

export const CRIPTO_DEFAULTS: PoliticaCripto = {
  objetivo: { BTC: 0.45, ETH: 0.35, otras: 0.10, reserva: 0.10 },
  bandaPts: 0.05,
  topePlataformaPct: 0.60,
  frenoCaidaPct: 0.30,
  tramosBtc: [-0.05, -0.12, -0.20],
};

/** Errores legibles; vacío si la política se puede guardar. */
export function validarPoliticaCripto(p: PoliticaCripto): string[] {
  const errores: string[] = [];
  const fraccion = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  for (const g of GRUPOS_CRIPTO) {
    if (!fraccion(p.objetivo[g])) errores.push(`El objetivo de ${GRUPO_CRIPTO_LABEL[g]} tiene que estar entre 0 y 100%.`);
  }
  const suma = GRUPOS_CRIPTO.reduce((s, g) => s + (Number(p.objetivo[g]) || 0), 0);
  if (Math.abs(suma - 1) > 0.001) errores.push(`Los cuatro objetivos tienen que sumar 100% (suman ${(suma * 100).toFixed(1)}%).`);
  if (!fraccion(p.bandaPts)) errores.push('La banda tiene que estar entre 0 y 100 puntos.');
  if (!fraccion(p.topePlataformaPct) || p.topePlataformaPct === 0) errores.push('El tope por plataforma tiene que estar entre 1 y 100%.');
  if (!fraccion(p.frenoCaidaPct) || p.frenoCaidaPct === 0) errores.push('El freno tiene que estar entre 1 y 100%.');
  if (!Array.isArray(p.tramosBtc) || p.tramosBtc.length === 0) {
    errores.push('Hace falta al menos un tramo de BTC.');
  } else {
    if (p.tramosBtc.some(t => typeof t !== 'number' || !Number.isFinite(t) || t >= 0 || t <= -1)) {
      errores.push('Los tramos de BTC son caídas: negativos, entre 0 y −100%.');
    }
    if (p.tramosBtc.some((t, i) => i > 0 && !(t < p.tramosBtc[i - 1]))) {
      errores.push('Cada tramo de BTC tiene que ser una caída mayor que el anterior.');
    }
  }
  return errores;
}

// Addendum 1 §2 — el tope se mide por PLATAFORMA (la contraparte), no por `cuenta`: dos cuentas de
// Nexo al 15% son una sola contraparte al 30%. Tabla explícita por prefijo, sin matcheo difuso. Una
// cuenta que no está acá queda como su propia plataforma, marcada: nunca se agrupa por parecido.
export const PLATAFORMA_DE_CUENTA: Array<{ prefijo: string; plataforma: string }> = [
  { prefijo: 'Nexo', plataforma: 'Nexo' },
  { prefijo: 'Bitfinex', plataforma: 'Bitfinex' },
];

export function plataformaDeCuenta(cuenta: string): { plataforma: string; mapeada: boolean } {
  const fila = PLATAFORMA_DE_CUENTA.find(f => cuenta.startsWith(f.prefijo));
  return fila ? { plataforma: fila.plataforma, mapeada: true } : { plataforma: cuenta, mapeada: false };
}

export function grupoCripto(ticker: string): GrupoCripto {
  const t = ticker.trim().toUpperCase();
  if (STABLECOINS.has(t)) return 'reserva';
  if (t === 'BTC') return 'BTC';
  if (t === 'ETH') return 'ETH';
  return 'otras';
}

// ── Lectura (espejo de functions/src/criptoPrecios.ts) ─────────────────────────
// F9.196 H2 — PrecioCripto, SondeoCripto y LecturaCripto viven en ./compartido/tiposPatrimonio.
import type { PrecioCripto, SondeoCripto, LecturaCripto } from './compartido/tiposPatrimonio';
export type { PrecioCripto, SondeoCripto, LecturaCripto } from './compartido/tiposPatrimonio';
export type BaseBtc = { valor: number; fecha: string; fuente: string | null };
export type BasesCripto = { btc: BaseBtc | null };
export type DiaCripto = { fecha: string; valorSistemaUsd: number; completo: boolean };

// ── Evaluación ────────────────────────────────────────────────────────────────
export type EstadoBanda = 'en_banda' | 'fuera_de_banda';

export type FilaComposicion = {
  grupo: GrupoCripto;
  usd: number;
  actual: number;
  objetivo: number;
  desvioPts: number;          // actual − objetivo
  estado: EstadoBanda;
  usdAlObjetivo: number;      // objetivo × sistema − actual: positivo falta, negativo sobra. Dato, no orden.
};

export type CuentaPlataforma = { cuenta: string; usd: number; pct: number; custodia: Custodia };
export type FilaPlataforma = {
  plataforma: string;
  mapeada: boolean;            // false: la cuenta no está en PLATAFORMA_DE_CUENTA ("plataforma sin mapear")
  usd: number;
  pct: number;
  superaTope: boolean;         // contra la suma de todas sus cuentas
  cuentas: CuentaPlataforma[];
};

export type EvaluacionCripto = {
  valorUsd: number;
  pesoEnTotal: number;                 // el mismo número de la banda de clase (M.cripto)
  fechaPrecios: string | null;         // YYYY-MM-DD de la lectura
  fechaCantidades: string | null;      // fechaCorrida del snapshot
  // Tickers sin precio en la lectura: se valúan con el valorUsd del snapshot ("valor del DD/MM").
  valuadosConSnapshot: string[];
  composicion: FilaComposicion[];
  reserva: { usd: number; actual: number; objetivo: number; objetivoUsd: number; faltaUsd: number; tercioUsd: number };
  tramos: {
    base: BaseBtc | null;
    precio: number | null;
    variacion: number | null;
    niveles: Array<{ tramo: number; alcanzado: boolean }>;
    alcanzados: number;
  };
  plataformas: FilaPlataforma[];
  freno: { maximoUsd: number; fechaMaximo: string | null; caida: number; umbral: number; activo: boolean; dias: number };
};

const EPS = 1e-9;

// `leidoEnISO` está en UTC: después de las 21:00 ART su fecha ya es mañana. Argentina es UTC−3 fijo.
export { fechaArgentina } from './compartido/tiposPatrimonio';
import { fechaArgentina } from './compartido/tiposPatrimonio';

export function evaluarSistemaCripto(args: {
  posiciones: Posicion[];
  lectura: LecturaCripto | null;
  bases: BasesCripto | null;
  historial: DiaCripto[];
  politica: PoliticaCripto;
  custodias: Record<string, Custodia>;
  pesoClase: number;
}): EvaluacionCripto | null {
  const { lectura, bases, historial, politica, custodias, pesoClase } = args;
  const cripto = args.posiciones.filter(p => p.tipo === 'cripto');
  if (cripto.length === 0) return null;

  // Valuación: cantidad × precio de la lectura; sin precio (o sin cantidad), el valorUsd del snapshot.
  const conSnapshot = new Set<string>();
  const filas = cripto.map(p => {
    const t = p.ticker.trim().toUpperCase();
    const precio = lectura?.precios[t]?.valor ?? null;
    if (precio !== null && typeof p.cantidad === 'number') return { cuenta: p.cuenta || '(sin cuenta)', ticker: t, usd: p.cantidad * precio };
    conSnapshot.add(t);
    return { cuenta: p.cuenta || '(sin cuenta)', ticker: t, usd: p.valorUsd };
  });
  const valorUsd = filas.reduce((s, f) => s + f.usd, 0);
  const frac = (usd: number) => (valorUsd > 0 ? usd / valorUsd : 0);

  const porGrupo: Record<GrupoCripto, number> = { BTC: 0, ETH: 0, otras: 0, reserva: 0 };
  for (const f of filas) porGrupo[grupoCripto(f.ticker)] += f.usd;
  const composicion: FilaComposicion[] = GRUPOS_CRIPTO.map(g => {
    const actual = frac(porGrupo[g]);
    const objetivo = politica.objetivo[g];
    const desvioPts = actual - objetivo;
    return {
      grupo: g, usd: porGrupo[g], actual, objetivo, desvioPts,
      estado: Math.abs(desvioPts) <= politica.bandaPts + EPS ? 'en_banda' : 'fuera_de_banda',
      usdAlObjetivo: objetivo * valorUsd - porGrupo[g],
    };
  });

  const objetivoReservaUsd = politica.objetivo.reserva * valorUsd;
  const reserva = {
    usd: porGrupo.reserva,
    actual: frac(porGrupo.reserva),
    objetivo: politica.objetivo.reserva,
    objetivoUsd: objetivoReservaUsd,
    faltaUsd: Math.max(0, objetivoReservaUsd - porGrupo.reserva),
    // Cada tramo habilita un tercio de la reserva OBJETIVO: es el tamaño que la política reserva para
    // cada nivel, aunque hoy la reserva real sea menor (la diferencia es `faltaUsd`).
    tercioUsd: objetivoReservaUsd / 3,
  };

  const base = bases?.btc ?? null;
  const precioBtc = lectura?.precios['BTC']?.valor ?? null;
  const variacion = base && precioBtc !== null ? precioBtc / base.valor - 1 : null;
  const niveles = politica.tramosBtc.map(tramo => ({ tramo, alcanzado: variacion !== null && variacion <= tramo + EPS }));

  const porCuenta = new Map<string, number>();
  for (const f of filas) porCuenta.set(f.cuenta, (porCuenta.get(f.cuenta) ?? 0) + f.usd);
  const porPlataforma = new Map<string, { mapeada: boolean; cuentas: CuentaPlataforma[] }>();
  for (const [cuenta, usd] of porCuenta) {
    const { plataforma, mapeada } = plataformaDeCuenta(cuenta);
    const g = porPlataforma.get(plataforma) ?? { mapeada, cuentas: [] };
    // Custodia de la CUENTA, como en exposicionContraparte: sin override, "sin declarar" (F9.130).
    g.cuentas.push({ cuenta, usd, pct: frac(usd), custodia: custodias[cuenta] ?? 'sin_declarar' });
    porPlataforma.set(plataforma, g);
  }
  const plataformas: FilaPlataforma[] = [...porPlataforma.entries()]
    .map(([plataforma, g]) => {
      const usd = g.cuentas.reduce((s, c) => s + c.usd, 0);
      return {
        plataforma, mapeada: g.mapeada, usd, pct: frac(usd),
        superaTope: frac(usd) > politica.topePlataformaPct + EPS,
        cuentas: g.cuentas.sort((a, b) => b.usd - a.usd),
      };
    })
    .sort((a, b) => b.usd - a.usd);

  // Freno: el máximo sale de los días COMPLETOS (todo valuado a precio del día) más el valor de hoy.
  // Un día incompleto mezcla valores viejos y podría fijar un máximo que nunca existió.
  let maximoUsd = valorUsd;
  let fechaMaximo: string | null = lectura ? fechaArgentina(lectura.leidoEnISO) : null;
  const completos = historial.filter(d => d.completo && d.valorSistemaUsd > 0);
  for (const d of completos) {
    if (d.valorSistemaUsd > maximoUsd) { maximoUsd = d.valorSistemaUsd; fechaMaximo = d.fecha; }
  }
  const caida = maximoUsd > 0 ? valorUsd / maximoUsd - 1 : 0;

  return {
    valorUsd,
    pesoEnTotal: pesoClase,
    fechaPrecios: lectura ? fechaArgentina(lectura.leidoEnISO) : null,
    fechaCantidades: cripto[0]?.fechaCorrida ?? null,
    valuadosConSnapshot: [...conSnapshot].sort(),
    composicion,
    reserva,
    tramos: { base, precio: precioBtc, variacion, niveles, alcanzados: niveles.filter(n => n.alcanzado).length },
    plataformas,
    freno: {
      maximoUsd, fechaMaximo, caida, umbral: politica.frenoCaidaPct,
      activo: caida <= -politica.frenoCaidaPct + EPS, dias: completos.length,
    },
  };
}
