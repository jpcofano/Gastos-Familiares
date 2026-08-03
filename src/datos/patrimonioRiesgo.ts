// F9.116 §2 — riesgo del portafolio: pérdida esperable por escenario, brecha contra la
// tolerancia declarada, bandas de concentración y mix objetivo. Módulo puro: sin Firestore,
// sin React, sin Date.now() — todo determinístico y verificable con scripts/verificarRiesgo.ts.
//
// UNIFICACIÓN (decisión del dueño al ejecutar el spec): los cuatro escenarios idiosincráticos
// que vivían dentro de vistas/Patrimonio.tsx (STRESS_ESCENARIOS + calcStress, consumidos por la
// solapa Plan y por el informe PDF) se movieron ACÁ tal cual y conviven con los cuatro
// sistémicos nuevos en un único registro. Hay un solo motor de escenarios en la app: dos
// motores darían dos números distintos para la misma pregunta en la misma pantalla.
//
// CONVENCIÓN DE UNIDADES: todo porcentaje de este módulo es una FRACCIÓN (0.20 = 20%), igual
// que el resto de las métricas de patrimonio (top1, hhi, cripto) y que el helper pct() de la
// UI. La conversión a números enteros pasa sólo en el borde del formulario de configuración.
import type { Posicion, PosicionManual } from '../types/patrimonio';
import { manualToPosicion } from './patrimonioMetricas';

// ── Bloques de riesgo ─────────────────────────────────────────────────────────
// El bloque es el DRIVER: lo que hace que un conjunto de posiciones se mueva junto en una
// crisis. Es la unidad de los shocks y de las betas.
export type Bloque = 'accionesAr' | 'accionesGlobal' | 'cripto' | 'soberanoAr' | 'rentaFijaPesos' | 'cash';

export const STABLECOINS = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD']);

export const BLOQUE_LABEL: Record<Bloque, string> = {
  accionesAr:     'Acciones AR',
  accionesGlobal: 'Acciones global',
  cripto:         'Cripto',
  soberanoAr:     'Soberano AR (USD)',
  // Agrupa la renta fija de beta baja: pesos AR y renta fija global. La beta de ambas es del
  // mismo orden; no se inventa un bloque nuevo sin fundamento para separarlas.
  rentaFijaPesos: 'Renta fija (pesos / global)',
  cash:           'Cash y stablecoins',
};

export function bloqueDe(p: Posicion): Bloque {
  if (p.tipo === 'cash') return 'cash';
  // Una stablecoin no es cripto a efectos de riesgo de mercado: se comporta como cash.
  if (p.tipo === 'cripto') return STABLECOINS.has(p.ticker) ? 'cash' : 'cripto';
  if (p.tipo === 'accion' || p.tipo === 'cedear') {
    return p.pais_riesgo === 'AR' ? 'accionesAr' : 'accionesGlobal';
  }
  // bono / on / fci
  if (p.pais_riesgo === 'AR') return p.moneda_origen === 'USD' ? 'soberanoAr' : 'rentaFijaPesos';
  return 'rentaFijaPesos';
}

// ── Betas por bloque ──────────────────────────────────────────────────────────
// Constantes documentadas, no estimadas de series (eso está fuera de alcance de F9.116).
// Referencia de la beta AR: marzo 2020, el Merval cayó ~34% en USD contra ~34% del S&P pico a
// piso, pero los nombres individuales cayeron mucho más — YPF −47,5%, GGAL −43,7%, BMA −40,4%.
export const BETA_DEFAULT: Record<Bloque, number> = {
  accionesAr:     1.30,
  cripto:         1.75,
  accionesGlobal: 1.00,
  soberanoAr:     0.40,
  rentaFijaPesos: 0.25,
  cash:           0.00,
};

// ── Escenarios ────────────────────────────────────────────────────────────────
export type ShockFn = (p: Posicion) => number;
export type FamiliaEscenario = 'sistemico' | 'idiosincratico';

export type Escenario = {
  id: string;
  nombre: string;
  descripcion: string;
  familia: FamiliaEscenario;
  shock: ShockFn;
};

// Shock por bloque → ShockFn. Los sistémicos se definen así: el driver manda, no el papel.
function porBloque(mapa: Partial<Record<Bloque, number>>): ShockFn {
  return p => mapa[bloqueDe(p)] ?? 0;
}

// Movimiento del mercado global × beta del bloque.
function porBeta(shockMercado: number): ShockFn {
  return p => shockMercado * BETA_DEFAULT[bloqueDe(p)];
}

// Sistémicos (F9.116). Un shock negativo es caída.
export const ESCENARIOS_SISTEMICOS: Escenario[] = [
  {
    id: 'global20',
    nombre: 'Corrección global −20%',
    descripcion: 'S&P −20%, cada bloque golpeado por su beta.',
    familia: 'sistemico',
    shock: porBeta(-0.20),
  },
  {
    id: 'crash2020',
    nombre: 'Crash tipo marzo 2020',
    descripcion: 'S&P −34%, acciones AR −44%, cripto −50%; renta fija por beta sobre el −34%.',
    familia: 'sistemico',
    // Los tres primeros son valores observados en marzo 2020; los de renta fija se derivan
    // con la beta del bloque sobre el mismo −34%, para no inventar un número suelto.
    shock: porBloque({
      accionesGlobal: -0.34,
      accionesAr:     -0.44,
      cripto:         -0.50,
      soberanoAr:     -0.34 * BETA_DEFAULT.soberanoAr,
      rentaFijaPesos: -0.34 * BETA_DEFAULT.rentaFijaPesos,
      cash:            0,
    }),
  },
  {
    id: 'localAr',
    nombre: 'Evento local AR',
    descripcion: 'Acciones AR −50%, soberano −40%, pesos −35%; global y cripto sin shock.',
    familia: 'sistemico',
    // Agosto 2019: la Bolsa cayó más de 57% en USD en un mes sin crisis global — el riesgo
    // local no necesita que el mundo acompañe.
    shock: porBloque({
      accionesAr:     -0.50,
      soberanoAr:     -0.40,
      rentaFijaPesos: -0.35,
      accionesGlobal:  0,
      cripto:          0,
      cash:            0,
    }),
  },
  {
    id: 'rally',
    nombre: 'Rally global +20%',
    descripcion: 'Simétrico de la corrección: S&P +20% por beta. El upside también se mide.',
    familia: 'sistemico',
    // Contrapeso deliberado: mostrar sólo el downside es información sesgada.
    shock: porBeta(0.20),
  },
];

// Idiosincráticos: los cuatro que ya existían en vistas/Patrimonio.tsx, movidos sin cambiar
// un solo shock. Son a nivel posición (sector, ticker), no por bloque.
export const ESCENARIOS_IDIOSINCRATICOS: Escenario[] = [
  {
    id: 'energia_ar',
    nombre: 'Corrección energía AR',
    descripcion: 'Acciones de energía argentina −30%.',
    familia: 'idiosincratico',
    shock: p => (p.sector === 'energia' && p.pais_riesgo === 'AR' && p.tipo === 'accion' ? -0.30 : 0),
  },
  {
    id: 'cripto',
    nombre: 'Invierno cripto',
    descripcion: 'Cripto no-stablecoin −50%.',
    familia: 'idiosincratico',
    shock: p => (p.tipo === 'cripto' && !STABLECOINS.has(p.ticker) ? -0.50 : 0),
  },
  {
    id: 'soberano_ar',
    nombre: 'Evento soberano AR',
    descripcion: 'Todo lo argentino golpeado según su instrumento.',
    familia: 'idiosincratico',
    shock: p => {
      if (p.pais_riesgo !== 'AR') return 0;
      if (p.tipo === 'accion' || p.tipo === 'cedear') return -0.40;
      if (p.tipo === 'bono' || p.tipo === 'on') return -0.25;
      if (p.tipo === 'fci') return -0.30;
      return 0;
    },
  },
  {
    id: 'tormenta',
    nombre: 'Tormenta perfecta',
    descripcion: 'Evento soberano AR y invierno cripto a la vez.',
    familia: 'idiosincratico',
    shock: p => {
      let s = 0;
      if (p.pais_riesgo === 'AR') {
        if (p.tipo === 'accion' || p.tipo === 'cedear') s = -0.40;
        else if (p.tipo === 'bono' || p.tipo === 'on') s = -0.25;
        else if (p.tipo === 'fci') s = -0.30;
      }
      if (p.tipo === 'cripto' && !STABLECOINS.has(p.ticker)) s = -0.50;
      return s;
    },
  },
];

export const ESCENARIOS: Escenario[] = [...ESCENARIOS_SISTEMICOS, ...ESCENARIOS_IDIOSINCRATICOS];

// El titular de la brecha se mide contra este escenario: es el más comparable con "cuánta
// caída bancás", porque no depende de que se dé un evento argentino puntual.
export const ESCENARIO_TITULAR = 'global20';

// ── Cálculo ───────────────────────────────────────────────────────────────────
export type ContribucionBloque = {
  bloque: Bloque;
  nombre: string;
  valorUsd: number;
  perdidaUsd: number;   // negativo = pérdida
  aporteFrac: number;   // fracción de la pérdida total que aporta este bloque
};

export type ResultadoEscenario = {
  id: string;
  nombre: string;
  descripcion: string;
  familia: FamiliaEscenario;
  total: number;
  perdidaUsd: number;   // negativo = pérdida, positivo = ganancia (rally)
  perdidaPct: number;   // fracción sobre el total, mismo signo que perdidaUsd
  totalFinal: number;
  contribucion: ContribucionBloque[];
};

// Corrida + manuales: la lente invertible completa.
export function posicionesInvertibles(posiciones: Posicion[], manuales: PosicionManual[]): Posicion[] {
  return [...posiciones, ...manuales.map(manualToPosicion)];
}

export function calcEscenarios(
  posiciones: Posicion[],
  manuales: PosicionManual[] = [],
  escenarios: Escenario[] = ESCENARIOS,
): ResultadoEscenario[] {
  const todas = posicionesInvertibles(posiciones, manuales);
  const total = todas.reduce((s, p) => s + p.valorUsd, 0);

  return escenarios.map(e => {
    const porB = new Map<Bloque, { valorUsd: number; perdidaUsd: number }>();
    let perdidaUsd = 0;

    for (const p of todas) {
      const b = bloqueDe(p);
      const delta = p.valorUsd * e.shock(p);
      perdidaUsd += delta;
      const acc = porB.get(b) ?? { valorUsd: 0, perdidaUsd: 0 };
      acc.valorUsd += p.valorUsd;
      acc.perdidaUsd += delta;
      porB.set(b, acc);
    }

    const contribucion: ContribucionBloque[] = [...porB.entries()]
      .map(([bloque, v]) => ({
        bloque,
        nombre: BLOQUE_LABEL[bloque],
        valorUsd: v.valorUsd,
        perdidaUsd: v.perdidaUsd,
        aporteFrac: perdidaUsd !== 0 ? v.perdidaUsd / perdidaUsd : 0,
      }))
      // Mayor aporte primero (el que más pesa en el resultado, sea pérdida o ganancia).
      .sort((a, b) => Math.abs(b.perdidaUsd) - Math.abs(a.perdidaUsd));

    return {
      id: e.id, nombre: e.nombre, descripcion: e.descripcion, familia: e.familia,
      total,
      perdidaUsd,
      perdidaPct: total > 0 ? perdidaUsd / total : 0,
      totalFinal: total + perdidaUsd,
      contribucion,
    };
  });
}

export type Brecha = {
  brechaPct: number;   // cuánto excede la pérdida a la tolerancia, en fracción del total
  factor: number;      // pérdida / tolerancia (1.5 = perdés una vez y media lo que bancás)
  cumple: boolean;
};

// `perdidaPct` puede venir con signo (como sale de calcEscenarios); se compara en magnitud.
export function calcBrecha(perdidaPct: number, toleranciaPct: number): Brecha {
  const perdida = Math.abs(perdidaPct);
  const tol = Math.abs(toleranciaPct);
  return {
    brechaPct: perdida - tol,
    factor: tol > 0 ? perdida / tol : Infinity,
    cumple: perdida <= tol,
  };
}

// ── Mix objetivo ──────────────────────────────────────────────────────────────
export type MixObjetivo = {
  pesosObjetivo: Record<Bloque, number>;  // fracción del total por bloque, después del recorte
  ventaNecesariaUsd: number;
  upsideResignadoPct: number;             // fracción del total que se deja de ganar en el rally
};

// Recorta los bloques de mayor aporte a la pérdida —pasándolos a cash— hasta que el escenario
// dé exactamente la tolerancia. Devuelve también lo que ese recorte cuesta al alza: mostrar el
// recorte sin mostrar el upside resignado es información sesgada.
export function calcMixObjetivo(
  posiciones: Posicion[],
  manuales: PosicionManual[],
  toleranciaPct: number,
  escenarioId: string = ESCENARIO_TITULAR,
): MixObjetivo | null {
  const escenario = ESCENARIOS.find(e => e.id === escenarioId);
  if (!escenario) return null;

  const todas = posicionesInvertibles(posiciones, manuales);
  const total = todas.reduce((s, p) => s + p.valorUsd, 0);
  if (total <= 0) return null;

  // Valor y shock efectivo por bloque (promedio ponderado, porque dentro de un bloque los
  // escenarios idiosincráticos no golpean a todas las posiciones por igual).
  const valor = {} as Record<Bloque, number>;
  const perdida = {} as Record<Bloque, number>;
  const upside = {} as Record<Bloque, number>;
  for (const b of Object.keys(BLOQUE_LABEL) as Bloque[]) { valor[b] = 0; perdida[b] = 0; upside[b] = 0; }

  const rally = ESCENARIOS.find(e => e.id === 'rally')!;
  for (const p of todas) {
    const b = bloqueDe(p);
    valor[b] += p.valorUsd;
    perdida[b] += p.valorUsd * escenario.shock(p);
    upside[b] += p.valorUsd * rally.shock(p);
  }

  const perdidaActual = (Object.keys(valor) as Bloque[]).reduce((s, b) => s + perdida[b], 0);
  const objetivo = -Math.abs(toleranciaPct) * total;   // pérdida máxima admitida, negativa

  const recortado = { ...valor };
  let ventaNecesariaUsd = 0;
  let upsideResignadoUsd = 0;

  // Si ya cumple, no hay nada que vender.
  if (perdidaActual >= objetivo) {
    return {
      pesosObjetivo: fracciones(recortado, total),
      ventaNecesariaUsd: 0,
      upsideResignadoPct: 0,
    };
  }

  let faltante = objetivo - perdidaActual;   // positivo: cuánta pérdida hay que eliminar
  const orden = (Object.keys(valor) as Bloque[])
    .filter(b => b !== 'cash' && valor[b] > 0 && perdida[b] < 0)
    .sort((a, b) => perdida[a] - perdida[b]);   // el que más pierde, primero

  for (const b of orden) {
    if (faltante <= 0) break;
    // Pérdida por dólar de este bloque (magnitud) — mover un dólar a cash la elimina entera.
    const perdidaPorUsd = -perdida[b] / valor[b];
    if (perdidaPorUsd <= 0) continue;
    const usdNecesarios = faltante / perdidaPorUsd;
    const usdAMover = Math.min(usdNecesarios, recortado[b]);
    const fraccionMovida = usdAMover / valor[b];

    recortado[b] -= usdAMover;
    recortado.cash += usdAMover;
    ventaNecesariaUsd += usdAMover;
    upsideResignadoUsd += upside[b] * fraccionMovida;
    faltante -= usdAMover * perdidaPorUsd;
  }

  return {
    pesosObjetivo: fracciones(recortado, total),
    ventaNecesariaUsd,
    upsideResignadoPct: total > 0 ? upsideResignadoUsd / total : 0,
  };
}

function fracciones(valores: Record<Bloque, number>, total: number): Record<Bloque, number> {
  const out = {} as Record<Bloque, number>;
  for (const b of Object.keys(valores) as Bloque[]) out[b] = total > 0 ? valores[b] / total : 0;
  return out;
}

// ── Bandas ────────────────────────────────────────────────────────────────────
// Fracciones (0.20 = 20%). Ver la convención de unidades al tope del archivo.
export type TopesRiesgo = {
  toleranciaCaidaPct: number;
  topePosicionPct: number;
  topeDriverPct: number;
  pisoCajaPct: number;
};

export const RIESGO_DEFAULTS: TopesRiesgo = {
  toleranciaCaidaPct: 0.20,
  topePosicionPct:    0.08,
  topeDriverPct:      0.35,
  pisoCajaPct:        0.05,
};

export type ViolacionBanda = {
  tipo: 'posicion' | 'driver' | 'caja';
  nombre: string;
  actual: number;      // fracción del total
  tope: number;        // fracción del total (piso, en el caso de caja)
  excesoUsd: number;   // USD por encima del tope; en caja, USD que faltan para el piso
};

export function violacionesBandas(
  posiciones: Posicion[],
  manuales: PosicionManual[],
  topes: TopesRiesgo = RIESGO_DEFAULTS,
): ViolacionBanda[] {
  const todas = posicionesInvertibles(posiciones, manuales);
  const total = todas.reduce((s, p) => s + p.valorUsd, 0);
  if (total <= 0) return [];

  const out: ViolacionBanda[] = [];

  // Por posición: consolidada por ticker (el mismo papel en dos cuentas es una sola apuesta).
  const porTicker: Record<string, number> = {};
  for (const p of todas) porTicker[p.ticker] = (porTicker[p.ticker] ?? 0) + p.valorUsd;
  for (const [ticker, v] of Object.entries(porTicker)) {
    const actual = v / total;
    if (actual > topes.topePosicionPct) {
      out.push({ tipo: 'posicion', nombre: ticker, actual, tope: topes.topePosicionPct, excesoUsd: (actual - topes.topePosicionPct) * total });
    }
  }

  // Por driver: el bloque de riesgo, que es lo que se mueve junto en una crisis.
  const porDriver = {} as Record<Bloque, number>;
  for (const p of todas) porDriver[bloqueDe(p)] = (porDriver[bloqueDe(p)] ?? 0) + p.valorUsd;
  for (const [bloque, v] of Object.entries(porDriver) as [Bloque, number][]) {
    if (bloque === 'cash') continue;   // el cash tiene piso, no tope
    const actual = v / total;
    if (actual > topes.topeDriverPct) {
      out.push({ tipo: 'driver', nombre: BLOQUE_LABEL[bloque], actual, tope: topes.topeDriverPct, excesoUsd: (actual - topes.topeDriverPct) * total });
    }
  }

  // Caja: es un PISO, no un tope — la violación es quedarse corto.
  const caja = (porDriver.cash ?? 0) / total;
  if (caja < topes.pisoCajaPct) {
    out.push({ tipo: 'caja', nombre: BLOQUE_LABEL.cash, actual: caja, tope: topes.pisoCajaPct, excesoUsd: (topes.pisoCajaPct - caja) * total });
  }

  return out.sort((a, b) => b.excesoUsd - a.excesoUsd);
}
