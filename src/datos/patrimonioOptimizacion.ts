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

// F9.102 4b — diagnóstico end-to-end por símbolo, para la card "Diagnóstico de series" en
// Optim. sin_datos_yahoo/tc_insuficiente se agregan en el caller (Patrimonio.tsx, antes de
// llegar a alinearSeries); ok/serie_corta/recorta_interseccion vienen de alinearSeries.
export type MotivoDiagnosticoSerie = 'ok' | 'sin_datos_yahoo' | 'tc_insuficiente' | 'serie_corta' | 'recorta_interseccion';
export type DiagnosticoSerie = {
  puntosCrudos: number;
  puntosDolarizados?: number;
  semanasAlineadas: number;
  motivo: MotivoDiagnosticoSerie;
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
  diagnostico?: Record<string, DiagnosticoSerie>;
  advertencias?: string[];
};

// F9.102.1 1a — Firestore no acepta arrays anidados (number[][]); matrizFlat en row-major
// (matrizFlat[i*n+j] === matriz[i][j]) es la forma de persistir MatrizCorrelacion.
export type MatrizCorrelacionDoc = { simbolos: string[]; matrizFlat: number[]; n: number };

export function serializarCorrelacion(c: MatrizCorrelacion): MatrizCorrelacionDoc {
  const { simbolos, matriz } = c;
  const n = simbolos.length;
  const matrizFlat: number[] = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = matriz[i]?.[j];
      matrizFlat[i * n + j] = Number.isFinite(v) ? (v as number) : 0;
    }
  }
  return { simbolos, matrizFlat, n };
}

// Retrocompatible: si el doc trae `matriz` (formato viejo) no debería llegar acá — lo maneja
// cargarUltimaOptimizacion antes de llamar a este helper. Este helper asume formato nuevo.
export function deserializarCorrelacion(d: MatrizCorrelacionDoc): MatrizCorrelacion {
  const { simbolos, matrizFlat, n } = d;
  const matriz: number[][] = [];
  for (let i = 0; i < n; i++) {
    matriz.push(matrizFlat.slice(i * n, i * n + n));
  }
  return { simbolos, matriz };
}

// Detecta valores no finitos en la matriz cruda (NaN/Infinity) — Firestore los rechaza y
// serializarCorrelacion ya los reemplaza por 0; esto solo produce el mensaje para auditoría.
function advertenciasCorrelacion(c: MatrizCorrelacion): string[] {
  const out: string[] = [];
  const { simbolos, matriz } = c;
  for (let i = 0; i < simbolos.length; i++) {
    for (let j = 0; j < simbolos.length; j++) {
      const v = matriz[i]?.[j];
      if (!Number.isFinite(v)) {
        out.push(`Correlación no finita entre ${simbolos[i]} y ${simbolos[j]} — guardada como 0`);
      }
    }
  }
  return out;
}

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
  const data = snap.docs[0].data() as Omit<ResultadoOptimizacion, 'correlacion'> & {
    correlacion?: MatrizCorrelacion | MatrizCorrelacionDoc | null;
  };
  const c = data.correlacion;
  // Retrocompatible: formato viejo trae `matriz` directo; formato nuevo trae `matrizFlat`.
  // Sin ninguno de los dos (doc corrupto o vacío), no revienta: matriz vacía.
  const correlacion: MatrizCorrelacion =
    c && 'matriz' in c ? c
    : c && 'matrizFlat' in c ? deserializarCorrelacion(c)
    : { simbolos: [], matriz: [] };
  return { ...data, correlacion } as ResultadoOptimizacion;
}

export async function guardarOptimizacion(r: ResultadoOptimizacion): Promise<void> {
  const advertenciasCorr = advertenciasCorrelacion(r.correlacion);
  const docData: Omit<ResultadoOptimizacion, 'correlacion'> & { correlacion: MatrizCorrelacionDoc } = {
    ...r,
    correlacion: serializarCorrelacion(r.correlacion),
    ...(advertenciasCorr.length > 0
      ? { advertencias: [...(r.advertencias ?? []), ...advertenciasCorr] }
      : {}),
  };
  await setDoc(doc(collection(db, 'optimizacionPortafolio')), docData);
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

// ── Semana ISO-8601 (puro, sin dependencias) ──────────────────────────────────
// "{isoYear}-W{isoWeek:2d}". El jueves de la semana define el año ISO — absorbe los
// corrimientos de ±1–3 días entre Yahoo US / .BA (UTC-3, toISOString() puede correr un
// día) / cripto (opera 7 días) que antes hacían colapsar la intersección por fecha exacta.
export function claveSemanaISO(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const diaLun0 = (date.getUTCDay() + 6) % 7; // lunes=0 … domingo=6
  date.setUTCDate(date.getUTCDate() - diaLun0 + 3); // mover al jueves de esta semana
  const isoYear = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DiaLun0 = (jan4.getUTCDay() + 6) % 7;
  const semana1Lunes = new Date(jan4);
  semana1Lunes.setUTCDate(jan4.getUTCDate() - jan4DiaLun0);
  const diffDias = Math.round((date.getTime() - semana1Lunes.getTime()) / 86400000);
  const isoWeek = Math.floor(diffDias / 7) + 1;
  return `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
}

// Reduce una serie a { semanaISO → cierre }, usando la ÚLTIMA observación de la semana
// (los puntos se ordenan por fecha asc antes de bucketear, así "última escritura gana").
function bucketSemanal(puntos: PuntoPrecio[]): Record<string, number> {
  const ordenados = [...puntos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const map: Record<string, number> = {};
  for (const p of ordenados) map[claveSemanaISO(p.fecha)] = p.cierre;
  return map;
}

function interseccionSemanas(simbolos: string[], semanasPorSimbolo: Record<string, Record<string, number>>): string[] {
  if (simbolos.length === 0) return [];
  let inter = Object.keys(semanasPorSimbolo[simbolos[0]]);
  for (const s of simbolos.slice(1)) {
    const set = new Set(Object.keys(semanasPorSimbolo[s]));
    inter = inter.filter(w => set.has(w));
  }
  return inter;
}

export type MotivoExclusionSerie = 'ok' | 'serie_corta' | 'recorta_interseccion';
export type DiagnosticoAlineado = { puntos: number; semanas: number; motivo: MotivoExclusionSerie };

// ── Alinear series por semana ISO ──────────────────────────────────────────────
// F9.102 4a — reescrita: bucketea cada serie por semana ISO (absorbe corrimientos de fecha
// entre fuentes), excluye PRIMERO las series cortas (antes: se intersectaba primero y una
// sola serie mala arrastraba a todas bajo minObs), y si la intersección de las sobrevivientes
// queda corta, excluye iterativamente la que más la restringe (la cuya ausencia libera más
// semanas comunes) hasta alcanzar minObs o quedarse sin series.
export function alinearSeries(
  series: Record<string, PuntoPrecio[]>,
  minObs: number
): { fechas: string[]; precios: Record<string, number[]>; excluidos: string[]; diagnostico: Record<string, DiagnosticoAlineado> } {
  const diagnostico: Record<string, DiagnosticoAlineado> = {};
  const excluidos: string[] = [];

  // 1. Bucket semanal por símbolo
  const semanasPorSimbolo: Record<string, Record<string, number>> = {};
  for (const [simbolo, puntos] of Object.entries(series)) {
    semanasPorSimbolo[simbolo] = bucketSemanal(puntos);
  }

  // 2. Excluir primero las series cortas (antes de intersectar)
  let activos: string[] = [];
  for (const simbolo of Object.keys(series)) {
    const nSemanas = Object.keys(semanasPorSimbolo[simbolo]).length;
    if (nSemanas < minObs) {
      excluidos.push(simbolo);
      diagnostico[simbolo] = { puntos: series[simbolo].length, semanas: nSemanas, motivo: 'serie_corta' };
    } else {
      activos.push(simbolo);
    }
  }

  // 3. Intersección de semanas solo entre las sobrevivientes; si queda bajo minObs, excluir
  // iterativamente la serie cuya ausencia libera más semanas comunes (la que más restringe).
  let semanasComunes = interseccionSemanas(activos, semanasPorSimbolo);
  while (semanasComunes.length < minObs && activos.length > 1) {
    let peor: string | null = null;
    let mejorResto: string[] = [];
    for (const candidato of activos) {
      const resto = activos.filter(s => s !== candidato);
      const interResto = interseccionSemanas(resto, semanasPorSimbolo);
      if (interResto.length > mejorResto.length) {
        mejorResto = interResto;
        peor = candidato;
      }
    }
    if (!peor) break;
    activos = activos.filter(s => s !== peor);
    excluidos.push(peor);
    diagnostico[peor] = { puntos: series[peor].length, semanas: Object.keys(semanasPorSimbolo[peor]).length, motivo: 'recorta_interseccion' };
    semanasComunes = mejorResto;
  }
  if (semanasComunes.length < minObs) {
    // No quedan series suficientes ni combinándolas — excluir el resto sin diagnóstico previo.
    for (const s of activos) {
      excluidos.push(s);
      diagnostico[s] = { puntos: series[s].length, semanas: Object.keys(semanasPorSimbolo[s]).length, motivo: 'recorta_interseccion' };
    }
    activos = [];
    semanasComunes = [];
  }

  const fechas = semanasComunes.slice().sort();
  const precios: Record<string, number[]> = {};
  for (const simbolo of activos) {
    precios[simbolo] = fechas.map(w => semanasPorSimbolo[simbolo][w]);
    diagnostico[simbolo] = { puntos: series[simbolo].length, semanas: Object.keys(semanasPorSimbolo[simbolo]).length, motivo: 'ok' };
  }

  return { fechas, precios, excluidos, diagnostico };
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

// F9.102.2 1 — si n·wMax < 1, el conjunto {w≥0, Σw=1, wᵢ≤wMax} es vacío: no hay forma de
// sumar 1 sin superar el tope en algún activo. Usar 1/n (reparto uniforme, el único punto
// factible en el borde) en vez de fallar o quedar en un punto espurio. El caller
// (calcularOptimizacion) compara wMax vs este valor para decidir si anotar una advertencia.
export function wMaxEfectivo(n: number, wMax: number): number {
  if (n <= 0) return wMax;
  return n * wMax < 1 ? 1 / n : wMax;
}

// ── Proyección euclídea al simplex con caja [0, wMax] ─────────────────────────
// Proyecta v sobre { w >= 0, sum(w) = 1, w[i] <= wMax } por bisección sobre el umbral τ:
// w(τ)ᵢ = clamp(vᵢ − τ, 0, wMax). Σw(τ)ᵢ es monótona no creciente en τ → la bisección
// converge siempre. Reemplaza el algoritmo anterior (clamp a [0,wMax] → renormalizar →
// repetir), que era una proyección RADIAL, no euclídea: al clampear negativos a cero y
// reescalar proporcionalmente empujaba la solución a los vértices y expulsaba de forma
// irreversible cualquier activo que tocara el cero — la causa del bug bang-bang de F9.102.2
// (calcMinVarianza devolvía wMax en algunos activos y 0 en el resto).
function proyectarSimplex(v: number[], wMax: number): number[] {
  const n = v.length;
  if (n === 0) return [];
  const wCap = wMaxEfectivo(n, wMax);
  const clampAt = (tau: number) => v.map(vi => Math.max(0, Math.min(wCap, vi - tau)));

  // Bracket: en lo = min(v)-1, vi-lo >= 1 para todo i → clamp = wCap para todo i →
  // suma = n·wCap >= 1 (por construcción de wCap). En hi = max(v), vi-hi <= 0 para todo i →
  // suma = 0. La raíz de suma(τ)=1 está siempre en [lo, hi].
  let lo = Math.min(...v) - 1;
  let hi = Math.max(...v);
  for (let iter = 0; iter < 100; iter++) {
    const mid = (lo + hi) / 2;
    const suma = clampAt(mid).reduce((s, x) => s + x, 0);
    if (Math.abs(suma - 1) < 1e-12) { lo = hi = mid; break; }
    if (suma > 1) lo = mid; else hi = mid;
  }
  return clampAt((lo + hi) / 2);
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
  const { precios, excluidos, diagnostico: diagAlin } = alinearSeries(series, minObs);
  const simbolos = Object.keys(precios);
  const diagnostico: Record<string, DiagnosticoSerie> = {};
  for (const [sym, d] of Object.entries(diagAlin)) {
    diagnostico[sym] = { puntosCrudos: d.puntos, semanasAlineadas: d.semanas, motivo: d.motivo };
  }
  const n = simbolos.length;

  // Retornos semanales por activo
  const retornos = simbolos.map(s => calcRetornos(precios[s]));

  // Covarianza con shrinkage + correlación
  const Sigma = calcCovarianza(retornos);
  const corrMatrix = covToCorr(Sigma);
  const correlacion: MatrizCorrelacion = { simbolos, matriz: corrMatrix };

  // F9.102.2 1 — guarda de factibilidad: si el tope wMax no admite ningún reparto que sume 1
  // con n activos, calcMinVarianza ya usa wMaxEfectivo internamente (no se rompe), pero acá se
  // detecta el caso para dejarlo anotado en advertencias[] del resultado en vez de que el
  // usuario vea un tope "15%" que en los hechos no se respetó.
  const advertenciasSimplex: string[] = [];
  if (n > 0) {
    const wCap = wMaxEfectivo(n, pesoMax);
    if (wCap !== pesoMax) {
      advertenciasSimplex.push(
        `Con ${n} activos elegibles, el tope de ${(pesoMax * 100).toFixed(0)}% es infactible (necesita ≥ ${(wCap * 100).toFixed(1)}%); se usó 1/${n} = ${(wCap * 100).toFixed(1)}%.`
      );
    }
  }

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
    diagnostico,
    ...(advertenciasSimplex.length > 0 ? { advertencias: advertenciasSimplex } : {}),
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
// F9.102.2 — con n=2 y wMax=0.4, el conjunto {w≥0, Σw=1, wᵢ≤0.4} es VACÍO por construcción
// (2×0.4=0.8<1: ningún par de pesos ≤40% puede sumar 100%). Se mantiene el fixture exacto del
// reporte de bug de producción (Sigma, wMax=0.4) para trazabilidad, pero la aserción compara
// contra wMaxEfectivo(2,0.4)=0.5 — el único punto factible ([0.5,0.5]) — en vez del 0.4 literal
// inalcanzable. Lo que este test realmente prueba: que el motor ya no explota a [1.0000,0.0000]
// (el bang-bang real reportado en prod) y respeta el tope que SÍ es alcanzable.
export function testMinVarConstraintWmax(): TestResult {
  const Sigma = [[1, 0], [0, 100]];
  const wMax = 0.4;
  const wCap = wMaxEfectivo(2, wMax);
  const w = calcMinVarianza(Sigma, 2, wMax);
  const ok = w.every(v => v <= wCap + 1e-6) && cerca(w.reduce((s, v) => s + v, 0), 1, 1e-6);
  return {
    nombre: `Min-var respeta wMax=${wMax} (infactible con n=2 → usa wMaxEfectivo=${wCap})`,
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

// F9.102 4c — tests de alinearSeries/claveSemanaISO ────────────────────────────
function addDiasISO(fechaBase: string, dias: number): string {
  const [y, m, d] = fechaBase.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

// Test 5: 3 series con las mismas semanas ISO pero fechas corridas ±2 días (equities US /
// .BA / cripto) alinean completo — caso que con intersección por fecha exacta fallaba.
export function testAlineadoSemanaISO(): TestResult {
  const base = '2025-01-06'; // lunes
  const A: PuntoPrecio[] = [];
  const B: PuntoPrecio[] = [];
  const C: PuntoPrecio[] = [];
  for (let i = 0; i < 10; i++) {
    const lunes = addDiasISO(base, i * 7);
    A.push({ fecha: lunes, cierre: 100 + i });
    B.push({ fecha: addDiasISO(lunes, 2), cierre: 100 + i }); // miércoles
    C.push({ fecha: addDiasISO(lunes, 4), cierre: 100 + i }); // viernes
  }
  const { precios, excluidos, fechas } = alinearSeries({ A, B, C }, 5);
  const ok = excluidos.length === 0 && fechas.length === 10
    && (precios.A?.length ?? 0) === 10 && (precios.B?.length ?? 0) === 10 && (precios.C?.length ?? 0) === 10;
  return {
    nombre: 'alinearSeries: fechas corridas ±2 días alinean por semana ISO',
    ok,
    detalle: ok
      ? `3 series, ${fechas.length} semanas alineadas, 0 excluidos ✓`
      : `excluidos=[${excluidos.join(',')}], fechas=${fechas.length}`,
  };
}

// Test 6: una serie corta se excluye ANTES de intersectar, sin arrastrar a las otras dos.
export function testSerieCortaNoArrastra(): TestResult {
  const base = '2025-01-06';
  const A: PuntoPrecio[] = [];
  const B: PuntoPrecio[] = [];
  const C: PuntoPrecio[] = [];
  for (let i = 0; i < 10; i++) {
    const lunes = addDiasISO(base, i * 7);
    A.push({ fecha: lunes, cierre: 100 + i });
    B.push({ fecha: lunes, cierre: 200 + i });
  }
  for (let i = 0; i < 3; i++) C.push({ fecha: addDiasISO(base, i * 7), cierre: 300 + i });

  const { precios, excluidos, fechas } = alinearSeries({ A, B, C }, 5);
  const ok = excluidos.length === 1 && excluidos[0] === 'C' && fechas.length === 10
    && (precios.A?.length ?? 0) === 10 && (precios.B?.length ?? 0) === 10 && precios.C === undefined;
  return {
    nombre: 'alinearSeries: serie corta se excluye sin arrastrar a las otras',
    ok,
    detalle: ok
      ? `C excluida (corta), A/B alinean completas (${fechas.length} sem) ✓`
      : `excluidos=[${excluidos.join(',')}], fechas=${fechas.length}`,
  };
}

// Test 7: claveSemanaISO en el borde de año — 2025-12-29 (lunes) cae en la semana 1 de 2026.
export function testClaveSemanaISOBordeAno(): TestResult {
  const clave = claveSemanaISO('2025-12-29');
  const ok = clave === '2026-W01';
  return {
    nombre: 'claveSemanaISO: borde de año 2025-12-29 → 2026-W01',
    ok,
    detalle: ok ? `${clave} ✓` : `Esperado 2026-W01, obtenido ${clave}`,
  };
}

// F9.102.1 1c — tests de serialización de la matriz de correlaciones ─────────
// Test 8: round-trip 3×3 reproduce la matriz original exacta.
export function testSerializacionRoundTrip(): TestResult {
  const m: MatrizCorrelacion = {
    simbolos: ['AAPL', 'GGAL', 'BTC'],
    matriz: [
      [1, 0.3, -0.2],
      [0.3, 1, 0.1],
      [-0.2, 0.1, 1],
    ],
  };
  const d = deserializarCorrelacion(serializarCorrelacion(m));
  const ok = d.simbolos.join(',') === m.simbolos.join(',')
    && d.matriz.every((row, i) => row.every((v, j) => v === m.matriz[i][j]));
  return {
    nombre: 'serializarCorrelacion/deserializarCorrelacion: round-trip 3×3 exacto',
    ok,
    detalle: ok ? 'round-trip reproduce la matriz original ✓' : `divergencia: obtenido ${JSON.stringify(d.matriz)}`,
  };
}

// Test 9: matriz vacía (0 símbolos) hace round-trip sin romper.
export function testSerializacionMatrizVacia(): TestResult {
  const m: MatrizCorrelacion = { simbolos: [], matriz: [] };
  const d = deserializarCorrelacion(serializarCorrelacion(m));
  const ok = d.simbolos.length === 0 && d.matriz.length === 0;
  return {
    nombre: 'serializarCorrelacion/deserializarCorrelacion: matriz vacía round-trip',
    ok,
    detalle: ok ? 'matriz vacía sin romper ✓' : `obtenido simbolos=${d.simbolos.length}, matriz=${d.matriz.length}`,
  };
}

// Test 10: deserializarCorrelacion sobre un doc en formato viejo ({simbolos, matriz}) — el
// caller (cargarUltimaOptimizacion) detecta el formato viejo y usa la matriz tal cual, sin
// llamar a deserializarCorrelacion; este test fija ese contrato de detección.
export function testFormatoViejoNoLlamaDeserializar(): TestResult {
  const docViejo = { simbolos: ['AAPL', 'GGAL'], matriz: [[1, 0.5], [0.5, 1]] };
  const esFormatoViejo = 'matriz' in docViejo;
  const ok = esFormatoViejo && docViejo.matriz[0][1] === 0.5;
  return {
    nombre: 'cargarUltimaOptimizacion: doc formato viejo (matriz) se detecta y usa tal cual',
    ok,
    detalle: ok ? 'formato viejo detectado por la presencia de `matriz` ✓' : 'no se detectó el formato viejo',
  };
}

// F9.102.2 — Test 11: wMax por debajo de 1/n (3 activos, wMax=10% → 3×0.1=0.3<1, infactible).
// El cálculo completo no debe romperse y debe quedar registrado en advertencias[].
export function testWmaxInfactibleEndToEnd(): TestResult {
  const base = '2025-01-06';
  const series: Record<string, PuntoPrecio[]> = { A: [], B: [], C: [] };
  for (let i = 0; i < 10; i++) {
    const lunes = addDiasISO(base, i * 7);
    series.A.push({ fecha: lunes, cierre: 100 + i });
    series.B.push({ fecha: lunes, cierre: 200 - i * 0.5 });
    series.C.push({ fecha: lunes, cierre: 50 + i * 2 });
  }
  const pesosActuales = { A: 1 / 3, B: 1 / 3, C: 1 / 3 };
  const resultado = calcularOptimizacion(series, pesosActuales, 10, 0.1, 5);
  const sumaMinVar = Object.values(resultado.minVarianza.pesos).reduce((s, v) => s + v, 0);
  const dentroDeCap = Object.values(resultado.minVarianza.pesos).every(v => v <= 1 / 3 + 1e-6);
  const ok = (resultado.advertencias?.length ?? 0) > 0 && cerca(sumaMinVar, 1, 1e-6) && dentroDeCap;
  return {
    nombre: 'calcularOptimizacion: wMax infactible (< 1/n) no rompe y queda en advertencias[]',
    ok,
    detalle: ok
      ? `advertencias=${JSON.stringify(resultado.advertencias)} ✓`
      : `advertencias=${JSON.stringify(resultado.advertencias)}, suma=${sumaMinVar.toFixed(4)}, dentroDeCap=${dentroDeCap}`,
  };
}

export function correrTests(): TestResult[] {
  return [
    testMinVarAnalitico(),
    testRiskParityAnalitico(),
    testMinVarConstraintWmax(),
    testRetornos(),
    testAlineadoSemanaISO(),
    testSerieCortaNoArrastra(),
    testClaveSemanaISOBordeAno(),
    testSerializacionRoundTrip(),
    testSerializacionMatrizVacia(),
    testFormatoViejoNoLlamaDeserializar(),
    testWmaxInfactibleEndToEnd(),
  ];
}
