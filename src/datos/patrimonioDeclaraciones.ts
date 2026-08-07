// F9.131 — Declarada, derivada, emergente. Es el módulo que convierte la medición en sistema:
// F9.127 y F9.130 miden; esto define qué se hace con lo medido.
//
// EL PRINCIPIO: no hay topes duros. Una banda dura marcaría TRAN en rojo en cada valuación, el dueño
// sabría que está bien, y en tres meses ignoraría todas las alertas por igual. Un tablero que grita
// siempre no informa. La distinción que sirve no es "cuánto es demasiado" sino **qué elegiste y qué
// se acumuló**:
//
//   declarada — la marcaste, con fecha, techo y una línea de por qué. No se cuestiona mientras esté
//               abajo del techo QUE VOS PUSISTE.
//   derivada  — consecuencia aritmética de una declarada. Se muestra como consecuencia, no alerta.
//   emergente — nadie la eligió y creció sola. Es la única que levanta la mano.
//   excedida  — hay declaración y se pasó. Es el dueño contra su propia decisión pasada.
//
// El caso testigo: TRAN al 22,9% fue una decisión. Que el 87,7% de la renta variable argentina sea
// energía no lo decidió nadie — emergió de sumar siete posiciones razonables por separado, y no se
// vio hasta que F9.122.1 §B corrigió el denominador.
//
// La app no dice qué hacer. Dice dónde hay exposición que nunca pasó por una decisión.

import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  bloqueDe, factorDe, custodiaDe, esCreditoCustodia,
  type Factor, type Custodia, type Bloque,
} from './patrimonioRiesgo';
import type { Posicion } from '../types/patrimonio';

export type EjeDeclaracion = 'ticker' | 'factor' | 'bloque' | 'contraparte';

export type Declaracion = {
  id: string;
  eje: EjeDeclaracion;
  clave: string;              // 'TRAN', 'oil_gas', 'accionesAr', nombre de plataforma
  techoPct: number;           // fracción sobre la base declarada
  base: 'invertible' | 'bloque';   // SIEMPRE explícita — la lección de F9.122.1 §B
  fecha: string;              // ISO. Una declaración vieja es un dato, no un error.
  nota: string;
  revisarEn?: string;
};

// F9.131 §1 — `nota` obligatoria con mínimo real. NO es burocracia: una declaración sin motivo
// escrito es indistinguible de una exposición emergente que alguien silenció apretando un botón, y
// todo este módulo se apoya en esa diferencia. El texto es lo único que permite, dentro de seis
// meses, saber si la convicción sigue en pie o si solo quedó el hábito. Si no se puede escribir por
// qué, la exposición todavía no es una decisión.
export const NOTA_MINIMA = 20;

export function declaracionValida(d: Pick<Declaracion, 'nota' | 'techoPct'>): string | null {
  if (!d.nota || d.nota.trim().length < NOTA_MINIMA) {
    return `El motivo es obligatorio y necesita al menos ${NOTA_MINIMA} caracteres. Sin él, esta declaración no se distingue de silenciar la alerta.`;
  }
  if (!Number.isFinite(d.techoPct) || d.techoPct <= 0 || d.techoPct > 1) {
    return 'El techo tiene que ser una fracción entre 0 y 1.';
  }
  return null;
}

export async function cargarDeclaraciones(): Promise<Declaracion[]> {
  const snap = await getDocs(collection(db, 'declaraciones'));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Declaracion, 'id'>) }));
}

export async function guardarDeclaracion(d: Omit<Declaracion, 'id'> & { id?: string }): Promise<void> {
  const err = declaracionValida(d);
  // La validación va también acá y no solo en el formulario: la regla es del dominio, no de la UI.
  if (err) throw new Error(err);
  const id = d.id || `${d.eje}__${d.clave}`;
  const { id: _omit, ...datos } = { ...d, id };
  await setDoc(doc(db, 'declaraciones', id), datos, { merge: true });
}

export async function borrarDeclaracion(id: string): Promise<void> {
  await deleteDoc(doc(db, 'declaraciones', id));
}

// ── §2 — clasificación ────────────────────────────────────────────────────────
export type EstadoExposicion = 'declarada' | 'derivada' | 'emergente' | 'excedida';

// F9.131 §2 — ELECCIONES DE DISEÑO, no verdades. Se pueden discutir sin releer el código.
//
// 5% del invertible: por debajo no se reporta nada. Una lista de treinta exposiciones emergentes del
// 0,3% es ruido, y el ruido es lo que entrena a ignorar la pantalla.
export const UMBRAL_MATERIALIDAD = 0.05;
// 70%: cuánto de una exposición tiene que venir de posiciones ya declaradas para considerarla
// consecuencia y no hallazgo. Más bajo y todo se vuelve "derivada" (se pierde la señal); más alto y
// una declaración de TRAN + TGSU2 + CEPU seguiría reportando energía regulada como emergente, que es
// exactamente el falso positivo que enseña a ignorar.
export const UMBRAL_DERIVADA = 0.70;

export type Exposicion = {
  eje: EjeDeclaracion;
  clave: string;
  etiqueta: string;
  usd: number;
  pct: number;                 // sobre el invertible
  estado: EstadoExposicion;
  declaracion: Declaracion | null;
  excesoUsd: number;           // solo si excedida: cuánto hay que mover para volver adentro
  tickers: string[];
};

type Ctx = {
  factores: Record<string, Factor>;
  custodias: Record<string, Custodia>;
  labelFactor: (f: Factor) => string;
  labelBloque: (b: Bloque) => string;
};

/**
 * F9.131 §2 — clasifica las exposiciones materiales de los cuatro ejes.
 * No propone nada, no recomienda nada: dice qué pasó por una decisión y qué no.
 */
export function clasificarExposiciones(
  posiciones: Posicion[],
  declaraciones: Declaracion[],
  ctx: Ctx,
): Exposicion[] {
  const total = posiciones.reduce((s, p) => s + p.valorUsd, 0);
  if (total <= 0) return [];

  const decl = new Map(declaraciones.map(d => [`${d.eje}__${d.clave}`, d]));

  // Tickers con declaración propia: es lo que hace que un factor pase a ser consecuencia.
  const tickersDeclarados = new Set(
    declaraciones.filter(d => d.eje === 'ticker').map(d => d.clave),
  );

  type Grupo = { usd: number; usdDeclarado: number; tickers: Map<string, number> };
  const ejes: Record<EjeDeclaracion, Map<string, Grupo>> = {
    ticker: new Map(), factor: new Map(), bloque: new Map(), contraparte: new Map(),
  };

  const acum = (eje: EjeDeclaracion, clave: string, p: Posicion) => {
    const m = ejes[eje];
    const g = m.get(clave) ?? { usd: 0, usdDeclarado: 0, tickers: new Map<string, number>() };
    g.usd += p.valorUsd;
    if (tickersDeclarados.has(p.ticker)) g.usdDeclarado += p.valorUsd;
    g.tickers.set(p.ticker, (g.tickers.get(p.ticker) ?? 0) + p.valorUsd);
    m.set(clave, g);
  };

  for (const p of posiciones) {
    acum('ticker', p.ticker, p);
    acum('factor', factorDe(p, ctx.factores).factor, p);
    acum('bloque', bloqueDe(p), p);
    acum('contraparte', p.cuenta || '(sin cuenta)', p);
  }

  const out: Exposicion[] = [];
  for (const eje of ['ticker', 'factor', 'bloque', 'contraparte'] as EjeDeclaracion[]) {
    for (const [clave, g] of ejes[eje]) {
      const pct = g.usd / total;
      const d = decl.get(`${eje}__${clave}`) ?? null;
      // Por debajo de la materialidad no se reporta NADA, ni siquiera si está declarada: una
      // declaración del 1% no necesita ocupar pantalla.
      if (!d && pct < UMBRAL_MATERIALIDAD) continue;

      let estado: EstadoExposicion;
      let excesoUsd = 0;
      if (d) {
        if (pct <= d.techoPct) {
          estado = 'declarada';
        } else {
          estado = 'excedida';
          // Aritmética, no recomendación: cuánto habría que mover para volver al techo declarado.
          excesoUsd = g.usd - d.techoPct * total;
        }
      } else if (eje !== 'ticker' && g.usd > 0 && g.usdDeclarado / g.usd > UMBRAL_DERIVADA) {
        estado = 'derivada';
      } else {
        estado = 'emergente';
      }

      const etiqueta = eje === 'factor' ? ctx.labelFactor(clave as Factor)
        : eje === 'bloque' ? ctx.labelBloque(clave as Bloque)
        : clave;

      out.push({
        eje, clave, etiqueta,
        usd: g.usd, pct, estado, declaracion: d, excesoUsd,
        tickers: [...g.tickers.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
      });
    }
  }

  // Orden por ACCIONABILIDAD, no por tamaño: lo que hay que mirar primero es lo que no pasó por una
  // decisión, no lo que más pesa.
  const rank: Record<EstadoExposicion, number> = { excedida: 0, emergente: 1, declarada: 2, derivada: 3 };
  return out.sort((a, b) => rank[a.estado] - rank[b.estado] || b.pct - a.pct);
}

// ── §3 — techos propuestos, anclados a la historia propia ─────────────────────
// NO salen de los 13 fondos CAFCI: anclarse al promedio de la industria es adoptar las restricciones
// de mandato y liquidez de otro sin haberlas elegido. Salen de dónde estuvo la exposición del propio
// dueño, que es su comportamiento revelado.
//
// La app PROPONE, el dueño edita y confirma. Nunca se autodeclara nada — una declaración que el
// dueño no tipeó no es una decisión, y todo el módulo se apoya en esa diferencia.
export const CORRIDAS_MINIMAS = 3;

export type PropuestaTecho = { clave: string; eje: EjeDeclaracion; min: number; max: number; sugerido: number };

export function proponerTechos(
  historial: Array<{ fechaCorrida: string; posiciones: Posicion[] }>,
  ctx: Ctx,
): { propuestas: PropuestaTecho[]; motivo: string | null } {
  if (historial.length < CORRIDAS_MINIMAS) {
    return {
      propuestas: [],
      motivo: `Hacen falta al menos ${CORRIDAS_MINIMAS} corridas para proponer un techo contra tu propia `
        + `historia; hay ${historial.length}. Se puede declarar a mano igual.`,
    };
  }

  const series = new Map<string, { eje: EjeDeclaracion; pcts: number[] }>();
  for (const corrida of historial) {
    const total = corrida.posiciones.reduce((s, p) => s + p.valorUsd, 0);
    if (total <= 0) continue;
    const acum = new Map<string, number>();
    for (const p of corrida.posiciones) {
      const claves: Array<[EjeDeclaracion, string]> = [
        ['ticker', p.ticker],
        ['factor', factorDe(p, ctx.factores).factor],
        ['bloque', bloqueDe(p)],
        ['contraparte', p.cuenta || '(sin cuenta)'],
      ];
      for (const [eje, clave] of claves) {
        const k = `${eje}__${clave}`;
        acum.set(k, (acum.get(k) ?? 0) + p.valorUsd);
      }
    }
    for (const [k, usd] of acum) {
      const [eje] = k.split('__') as [EjeDeclaracion];
      const s = series.get(k) ?? { eje, pcts: [] };
      s.pcts.push(usd / total);
      series.set(k, s);
    }
  }

  const propuestas: PropuestaTecho[] = [];
  for (const [k, s] of series) {
    const max = Math.max(...s.pcts);
    if (max < UMBRAL_MATERIALIDAD) continue;
    propuestas.push({
      clave: k.split('__').slice(1).join('__'),
      eje: s.eje,
      min: Math.min(...s.pcts),
      max,
      // Sugerido = el máximo histórico redondeado hacia arriba al punto porcentual. Es donde el
      // dueño ya estuvo cómodo, no un número inventado.
      sugerido: Math.ceil(max * 100) / 100,
    });
  }
  propuestas.sort((a, b) => b.max - a.max);
  return { propuestas, motivo: null };
}

/** Helper para la card: cuánto del invertible es crédito contra terceros, ya clasificado. */
export function creditoDeclarado(posiciones: Posicion[], custodias: Record<string, Custodia>): number {
  const total = posiciones.reduce((s, p) => s + p.valorUsd, 0);
  if (total <= 0) return 0;
  const usd = posiciones
    .filter(p => esCreditoCustodia(custodiaDe(p, custodias)))
    .reduce((s, p) => s + p.valorUsd, 0);
  return usd / total;
}
