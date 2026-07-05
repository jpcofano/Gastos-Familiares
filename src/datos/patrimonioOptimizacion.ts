import { httpsCallable } from 'firebase/functions';
import {
  doc, getDoc, setDoc,
  collection, getDocs, query, orderBy, limit, documentId, startAt, endAt,
} from 'firebase/firestore';
import { db, functions } from '../firebase';

// ── Tipos de series ────────────────────────────────────────────────────────────
export type PuntoPrecio = { fecha: string; cierre: number }; // YYYY-MM-DD

export type SeriePrecios = {
  simbolo: string;
  fuente: 'yahoo';
  moneda: 'USD' | 'ARS';
  puntos: PuntoPrecio[];
  actualizadoEn: string; // ISO
};

export type SeriesResult = {
  series: Record<string, SeriePrecios>;
  faltantes: string[]; // símbolos que no pudieron obtenerse
};

// ── Tipos de optimización ──────────────────────────────────────────────────────
export type MatrizCorrelacion = {
  simbolos: string[];
  // matriz[i][j] = correlación entre simbolos[i] y simbolos[j]
  matriz: number[][];
};

export type CarteraOptima = {
  metodo: 'min-varianza' | 'risk-parity';
  pesos: Record<string, number>; // símbolo → peso 0..1
  varianza: number; // varianza total de la cartera
  volatilidad: number; // sqrt(varianza), en unidades semanales
  excluidos: string[]; // activos sin serie suficiente
};

export type DeltaCartera = {
  simbolo: string;
  pesoActual: number; // 0..1
  pesoOptimo: number; // 0..1
  delta: number; // pesoOptimo - pesoActual
};

export type ResultadoOptimizacion = {
  fechaCalculo: string; // ISO
  semanas: number;
  pesoMaxPorPosicion: number;
  correlacion: MatrizCorrelacion;
  sinSerieSuficiente: string[];
  minVarianza: CarteraOptima;
  riskParity: CarteraOptima;
  deltasMinVarianza: DeltaCartera[];
  deltasRiskParity: DeltaCartera[];
};

// ── Firestore: TC histórico para dolarización ─────────────────────────────────
// Carga tcDiario en el rango [desde, hasta] (YYYY-MM-DD) → map fecha→tcUsdArs
export async function cargarTCRango(
  desde: string,
  hasta: string
): Promise<Record<string, number>> {
  const snap = await getDocs(
    query(
      collection(db, 'tcDiario'),
      orderBy(documentId()),
      startAt(desde),
      endAt(hasta),
    )
  );
  const result: Record<string, number> = {};
  for (const d of snap.docs) {
    const v = d.data().tcUsdArs as number;
    if (v > 0) result[d.id] = v;
  }
  return result;
}

// Dolariza una serie ARS usando el map de TC por fecha.
// Para cada fecha de la serie, busca el TC exacto o el más reciente anterior.
// Retorna la serie en USD y un flag excluir=true si hay < minObs puntos dolarizables.
export function dolarizarSerie(
  puntos: PuntoPrecio[],
  tcByDate: Record<string, number>,
  minObs: number
): { puntos: PuntoPrecio[]; excluir: boolean } {
  const fechasTC = Object.keys(tcByDate).sort();
  const resultado: PuntoPrecio[] = [];

  for (const p of puntos) {
    // Buscar TC exacto o más reciente anterior
    let tc: number | null = tcByDate[p.fecha] ?? null;
    if (tc === null) {
      const anterior = fechasTC.filter(f => f <= p.fecha).pop();
      if (anterior) tc = tcByDate[anterior];
    }
    if (tc && tc > 0) {
      resultado.push({ fecha: p.fecha, cierre: p.cierre / tc });
    }
  }

  return { puntos: resultado, excluir: resultado.length < minObs };
}

// ── Firestore: cargar/guardar resultado ───────────────────────────────────────
export async function cargarUltimaOptimizacion(): Promise<ResultadoOptimizacion | null> {
  const snap = await getDocs(
    query(collection(db, 'optimizacionPortafolio'), orderBy('fechaCalculo', 'desc'), limit(1))
  );
  if (snap.empty) return null;
  return snap.docs[0].data() as ResultadoOptimizacion;
}

export async function guardarOptimizacion(r: ResultadoOptimizacion): Promise<void> {
  await setDoc(doc(collection(db, 'optimizacionPortafolio')), r);
}

// ── Callable: obtener series de precios ───────────────────────────────────────
export async function obtenerSeriesPrecios(
  simbolos: string[],
  semanas: number
): Promise<SeriesResult> {
  const fn = httpsCallable<{ simbolos: string[]; semanas: number }, SeriesResult>(
    functions, 'obtenerSeriesPrecios'
  );
  const r = await fn({ simbolos, semanas });
  return r.data;
}

// ══════════════════════════════════════════════════════════════════════════════
// MOTOR DE OPTIMIZACIÓN (puro, determinístico, sin dependencias externas)
// ══════════════════════════════════════════════════════════════════════════════

// ── Retornos semanales ────────────────────────────────────────────────────────
export function calcRetornos(precios: number[]): number[] {
  // r[i] = (p[i+1] - p[i]) / p[i]
  const r: number[] = [];
  for (let i = 0; i < precios.length - 1; i++) {
    if (precios[i] > 0) r.push((precios[i + 1] - precios[i]) / precios[i]);
  }
  return r;
}

// ── Alinear series por fecha ──────────────────────────────────────────────────
export function alinearSeries(
  series: Record<string, PuntoPrecio[]>,
  minObs: number
): { fechas: string[]; precios: Record<string, number[]>; excluidos: string[] } {
  // Intersección de fechas entre todas las series
  const setsFechas = Object.values(series).map(s => new Set(s.map(p => p.fecha)));
  let fechasComunes = setsFechas[0] ? [...setsFechas[0]] : [];
  for (const s of setsFechas.slice(1)) {
    fechasComunes = fechasComunes.filter(f => s.has(f));
  }
  fechasComunes.sort();

  const precios: Record<string, number[]> = {};
  const excluidos: string[] = [];

  for (const [simbolo, puntos] of Object.entries(series)) {
    const byFecha: Record<string, number> = {};
    for (const p of puntos) byFecha[p.fecha] = p.cierre;
    const vals = fechasComunes.map(f => byFecha[f] ?? 0).filter(v => v > 0);
    if (vals.length < minObs) {
      excluidos.push(simbolo);
    } else {
      precios[simbolo] = fechasComunes.map(f => byFecha[f] ?? 0);
    }
  }

  return { fechas: fechasComunes, precios, excluidos };
}

// ── Covarianza muestral con shrinkage Ledoit-Wolf fijo (α = 0.2) ──────────────
export function calcCovarianza(retornos: number[][]): number[][] {
  const n = retornos.length; // activos
  const T = retornos[0]?.length ?? 0;
  if (n === 0 || T < 2) return [];

  // Media de retornos
  const medias = retornos.map(r => r.reduce((s, x) => s + x, 0) / r.length);

  // Covarianza muestral
  const S: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let cov = 0;
      for (let t = 0; t < T; t++) {
        cov += (retornos[i][t] - medias[i]) * (retornos[j][t] - medias[j]);
      }
      S[i][j] = S[j][i] = cov / (T - 1);
    }
  }

  // Shrinkage: Σ_shrunk = (1-α)*S + α*μ*I  con μ = trace(S)/n, α = 0.2
  const alpha = 0.2;
  const mu = S.reduce((s, _, i) => s + S[i][i], 0) / n;
  const Sigma: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) =>
      (1 - alpha) * S[i][j] + (i === j ? alpha * mu : 0)
    )
  );

  return Sigma;
}

// ── Correlaciones desde covarianza ────────────────────────────────────────────
export function covToCorr(Sigma: number[][]): number[][] {
  const n = Sigma.length;
  const stds = Sigma.map((_, i) => Math.sqrt(Math.max(Sigma[i][i], 1e-12)));
  return Sigma.map((row, i) =>
    row.map((v, j) => {
      const r = v / (stds[i] * stds[j]);
      return Math.max(-1, Math.min(1, r));
    })
  );
}

// ── Varianza de la cartera ─────────────────────────────────────────────────────
export function calcVarianza(Sigma: number[][], w: number[]): number {
  const n = w.length;
  let v = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      v += w[i] * w[j] * Sigma[i][j];
  return v;
}

// ── Multiplicación matriz × vector ────────────────────────────────────────────
function matVec(A: number[][], v: number[]): number[] {
  return A.map(row => row.reduce((s, a, j) => s + a * v[j], 0));
}

// ── Proyección al simplex con caja [0, wMax] ──────────────────────────────────
// Proyecta w sobre { w >= 0, sum(w) = 1, w[i] <= wMax }
// Algoritmo: clamp a [0,wMax], renormalizar, repetir hasta estable
function proyectarSimplex(w: number[], wMax: number): number[] {
  const n = w.length;
  let x = [...w];
  for (let iter = 0; iter < 200; iter++) {
    // Clamp
    x = x.map(v => Math.max(0, Math.min(wMax, v)));
    const suma = x.reduce((s, v) => s + v, 0);
    if (suma < 1e-12) { x = new Array(n).fill(1 / n); continue; }
    x = x.map(v => v / suma);
    // Check: suma debe ser 1 y todos en [0, wMax]
    const ok = x.every(v => v >= -1e-9 && v <= wMax + 1e-9);
    if (ok) break;
  }
  return x;
}

// ── Mínima varianza (projected gradient descent) ──────────────────────────────
export function calcMinVarianza(
  Sigma: number[][],
  n: number,
  wMax: number,
  maxIter = 3000
): number[] {
  // Inicializar con pesos iguales
  let w = new Array(n).fill(1 / n);
  w = proyectarSimplex(w, wMax);

  const eigMax = Sigma.reduce((s, row) => s + row.reduce((ss, v) => ss + Math.abs(v), 0), 0) / n;
  const lr = 0.5 / Math.max(eigMax, 1e-12);

  for (let k = 0; k < maxIter; k++) {
    const g = matVec(Sigma, w).map(v => 2 * v);
    const wNew = w.map((wi, i) => wi - lr * g[i]);
    const wProj = proyectarSimplex(wNew, wMax);

    // Criterio de convergencia
    const diff = Math.sqrt(wProj.reduce((s, v, i) => s + (v - w[i]) ** 2, 0));
    w = wProj;
    if (diff < 1e-9) break;
  }

  return w;
}

// ── Risk Parity (Newton cíclico) ──────────────────────────────────────────────
// Basado en Maillard-Roncalli-Teïletche (2010)
export function calcRiskParity(
  Sigma: number[][],
  n: number,
  maxIter = 3000
): number[] {
  // Inicializar con pesos inversos a la volatilidad individual
  const vols = Sigma.map((_, i) => Math.sqrt(Math.max(Sigma[i][i], 1e-12)));
  const invVol = vols.map(v => 1 / v);
  const sumInv = invVol.reduce((s, v) => s + v, 0);
  let w = invVol.map(v => v / sumInv);

  for (let k = 0; k < maxIter; k++) {
    const Sw = matVec(Sigma, w);
    const varTotal = w.reduce((s, wi, i) => s + wi * Sw[i], 0);
    const target = varTotal / n;

    let changed = false;
    for (let i = 0; i < n; i++) {
      const a = Sigma[i][i];
      // b = (Σw)[i] - w[i]*Σ[i][i]  (contribución cruzada sin el propio)
      const b = Sw[i] - w[i] * a;
      // a*w_i^2 + b*w_i - target = 0  → w_i = (-b + sqrt(b^2+4*a*target))/(2a)
      const disc = b * b + 4 * a * Math.max(target, 0);
      if (disc < 0 || a < 1e-16) continue;
      const wNew = (-b + Math.sqrt(disc)) / (2 * a);
      const delta = Math.abs(wNew - w[i]);
      if (delta > 1e-12) changed = true;
      w[i] = Math.max(wNew, 1e-8); // long-only
    }

    // Renormalizar
    const suma = w.reduce((s, v) => s + v, 0);
    w = w.map(v => v / suma);

    if (!changed) break;
  }

  return w;
}

// ── Función principal: calcular todo dado las series ──────────────────────────
export function calcularOptimizacion(
  series: Record<string, PuntoPrecio[]>,
  pesosActuales: Record<string, number>,  // símbolo → peso 0..1 (suman 1)
  semanas: number,
  pesoMax: number,
  minObs: number
): ResultadoOptimizacion {
  const { precios, excluidos } = alinearSeries(series, minObs);
  const simbolos = Object.keys(precios);
  const n = simbolos.length;

  // Retornos semanales por activo
  const retornos = simbolos.map(s => calcRetornos(precios[s]));

  // Covarianza con shrinkage + correlación
  const Sigma = calcCovarianza(retornos);
  const corrMatrix = covToCorr(Sigma);
  const correlacion: MatrizCorrelacion = { simbolos, matriz: corrMatrix };

  // Optimización
  const wMinVar = calcMinVarianza(Sigma, n, pesoMax);
  const wRiskParity = calcRiskParity(Sigma, n);

  const toCartera = (w: number[], metodo: CarteraOptima['metodo']): CarteraOptima => {
    const pesos: Record<string, number> = {};
    simbolos.forEach((s, i) => { pesos[s] = w[i]; });
    const varianza = calcVarianza(Sigma, w);
    return { metodo, pesos, varianza, volatilidad: Math.sqrt(varianza), excluidos };
  };

  const calcDeltas = (cartera: CarteraOptima): DeltaCartera[] =>
    Object.keys(cartera.pesos).map(s => ({
      simbolo: s,
      pesoActual: pesosActuales[s] ?? 0,
      pesoOptimo: cartera.pesos[s],
      delta: cartera.pesos[s] - (pesosActuales[s] ?? 0),
    })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const minVar = toCartera(wMinVar, 'min-varianza');
  const rp = toCartera(wRiskParity, 'risk-parity');

  return {
    fechaCalculo: new Date().toISOString(),
    semanas,
    pesoMaxPorPosicion: pesoMax,
    correlacion,
    sinSerieSuficiente: excluidos,
    minVarianza: minVar,
    riskParity: rp,
    deltasMinVarianza: calcDeltas(minVar),
    deltasRiskParity: calcDeltas(rp),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// TESTS UNITARIOS (determinísticos, resultado conocido)
// exportados para que sean llamables desde la UI de Optimización
// ══════════════════════════════════════════════════════════════════════════════

export type TestResult = { nombre: string; ok: boolean; detalle: string };

function cerca(a: number, b: number, tol = 1e-4): boolean {
  return Math.abs(a - b) <= tol;
}

// Test 1: 2 activos no correlacionados → min-var analítico conocido
// Si σ1=1, σ2=2 → w1_opt = σ2²/(σ1²+σ2²) = 4/5 = 0.8
export function testMinVarAnalitico(): TestResult {
  const Sigma = [[1, 0], [0, 4]]; // σ1=1, σ2=2
  const w = calcMinVarianza(Sigma, 2, 1.0);
  // Analíticamente: w* = [4/5, 1/5] = [0.8, 0.2]
  const ok = cerca(w[0], 0.8, 0.01) && cerca(w[1], 0.2, 0.01);
  return {
    nombre: 'Min-var 2 activos no correlacionados (analítico)',
    ok,
    detalle: ok
      ? `w = [${w[0].toFixed(4)}, ${w[1].toFixed(4)}] ≈ [0.8, 0.2] ✓`
      : `Esperado [0.8, 0.2], obtenido [${w[0].toFixed(4)}, ${w[1].toFixed(4)}]`,
  };
}

// Test 2: Risk parity 2 activos → pesos inversos a la vol
// Si σ1=1, σ2=2, no correlación → w_rp = [2/3, 1/3]
export function testRiskParityAnalitico(): TestResult {
  const Sigma = [[1, 0], [0, 4]];
  const w = calcRiskParity(Sigma, 2);
  // RP: w1/w2 = σ2/σ1 = 2 → w1=2/3, w2=1/3
  const ok = cerca(w[0], 2 / 3, 0.01) && cerca(w[1], 1 / 3, 0.01);
  return {
    nombre: 'Risk parity 2 activos (pesos inversos a vol)',
    ok,
    detalle: ok
      ? `w = [${w[0].toFixed(4)}, ${w[1].toFixed(4)}] ≈ [0.667, 0.333] ✓`
      : `Esperado [0.667, 0.333], obtenido [${w[0].toFixed(4)}, ${w[1].toFixed(4)}]`,
  };
}

// Test 3: Min-var respeta constraint wMax
export function testMinVarConstraintWmax(): TestResult {
  const Sigma = [[1, 0], [0, 100]]; // Asset 2 muy volátil → debería ir a 0
  const wMax = 0.4;
  const w = calcMinVarianza(Sigma, 2, wMax);
  const ok = w.every(v => v <= wMax + 1e-6) && cerca(w.reduce((s, v) => s + v, 0), 1, 1e-6);
  return {
    nombre: `Min-var respeta wMax=${wMax}`,
    ok,
    detalle: ok
      ? `w = [${w[0].toFixed(4)}, ${w[1].toFixed(4)}], suma=${(w[0]+w[1]).toFixed(4)} ✓`
      : `Constraint violada: w = [${w[0].toFixed(4)}, ${w[1].toFixed(4)}]`,
  };
}

// Test 4: Retornos semanales correctos
export function testRetornos(): TestResult {
  const precios = [100, 110, 99];
  const r = calcRetornos(precios);
  // r[0] = (110-100)/100 = 0.1;  r[1] = (99-110)/110 ≈ -0.1
  const ok = cerca(r[0], 0.1, 1e-9) && cerca(r[1], -11 / 110, 1e-9);
  return {
    nombre: 'Cálculo de retornos semanales',
    ok,
    detalle: ok
      ? `r = [${r[0].toFixed(6)}, ${r[1].toFixed(6)}] ✓`
      : `Esperado [0.1, -0.1], obtenido [${r[0].toFixed(6)}, ${r[1].toFixed(6)}]`,
  };
}

export function correrTests(): TestResult[] {
  return [
    testMinVarAnalitico(),
    testRiskParityAnalitico(),
    testMinVarConstraintWmax(),
    testRetornos(),
  ];
}
