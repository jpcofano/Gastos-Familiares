import { httpsCallable } from 'firebase/functions';
import {
  doc, getDoc, setDoc, getDocs, collection,
  query, orderBy, limit, type Timestamp,
} from 'firebase/firestore';
import { db, functions } from '../firebase';
import type { IndicadoresPosicion } from '../types/patrimonio';

// ── Tipos ─────────────────────────────────────────────────────────────────────
export type EventoProximo =
  | { cuando: string | null; evento: string }  // formato estructurado (F9.95+)
  | string;                                     // retrocompat: string suelto

// F9.147 §1 — LO REPORTADO POR EL MODELO, que la app NO puede verificar.
//
// Los números de `indicadoresPosicion` salen de Firestore y se auditan contra `preciosDiarios`.
// Éstos salen de una búsqueda web y no hay con qué contrastarlos. En una tabla se ven idénticos,
// y un P/E equivocado al lado de un semáforo verde se lee como dato de la app. Por eso viajan en
// su propia estructura, con fuente y fecha OBLIGATORIAS, y se pintan en un bloque aparte.
//
// SIN SEMÁFORO, y no es un olvido: un umbral aplicado a un número que no se puede verificar
// convierte un dato dudoso en un veredicto. Si alguna vez se quiere, primero hay que medir qué
// tan estables son entre corridas — el criterio que F9.149 aplicó al drawdown.
export type MetricaReportada = {
  nombre: string;
  valor: string | number | null;   // null explícito = no se encontró; NUNCA un número inventado
  unidad?: string | null;
  comentario?: string | null;
};

export type Fundamentals = {
  metricas: MetricaReportada[];
  fuente: string | null;
  fechaDato: string | null;        // YYYY-MM-DD del dato, no de la corrida
  motivoSinDatos?: string | null;  // por qué no hay nada, cuando `metricas` viene vacío
};

export type AccionRecomendada = 'Mantener' | 'Comprar' | 'Aumentar' | 'Reducir' | 'Vender';

// F9.147 §3 — la recomendación explícita CONVIVE con `queHariaEnCadaCaso`, no lo reemplaza: los
// escenarios condicionales son los que responden "qué hago si pasa X".
//
// La regla vieja ("prohibido imperativos sin condición") existía por un motivo válido —una
// recomendación categórica sin condición es una opinión con cara de conclusión— así que se
// reemplazó por una MÁS exigente, no se borró: la recomendación tiene que citar los indicadores
// que la sostienen, por nombre y valor. Si no puede citar ninguno, `accion` va en null con motivo.
export type Recomendacion = {
  accion: AccionRecomendada | null;
  indicadoresCitados?: { nombre: string; valor: string }[];
  motivoSinRecomendacion?: string | null;
};

export type AnalisisPosicion = {
  ticker: string;
  generadoEnISO: string;
  modeloUsado: string;
  origen?: 'api' | 'chat';
  resultado: {
    queEs?: string;
    situacionActual?: string;
    riesgos?: string[];
    rolEnCartera?: string;
    proximosEventos?: EventoProximo[];
    queHariaEnCadaCaso?: { caso: string; acciones: string[]; costo: string }[];
    senalesAVigilar?: string[];
    fuentes?: string[];
    // F9.147 — opcionales a propósito: los 40 análisis guardados al 2026-08-19 no los traen y
    // tienen que seguir renderizando degradados, no romper ni migrarse.
    fundamentals?: Fundamentals | null;
    recomendacion?: Recomendacion | null;
    justificacion?: string[];
  };
};

export type AnalisisSectorial = {
  id: string;
  generadoEnISO: string;
  modeloUsado: string;
  origen?: 'api' | 'chat';
  resultado: string;
};

export type ConfigIA = { habilitado: boolean };

export type EventoAgenda = {
  fecha: string | null;
  evento: string;
  driver: string;
  porQueImporta: string;
};

export type AgendaMacro = {
  id: string;
  generadoEnISO: string;
  horizonteDias: number;
  origen?: 'api' | 'chat';
  eventos: EventoAgenda[];
};

// Helper: normaliza un EventoProximo al formato estructurado
export function normalizarEventoProximo(e: EventoProximo): { cuando: string | null; evento: string } {
  if (typeof e === 'string') return { cuando: null, evento: e };
  return e;
}

// ── Config ────────────────────────────────────────────────────────────────────
export async function cargarConfigIA(): Promise<ConfigIA> {
  const snap = await getDoc(doc(db, 'configPatrimonio', 'ia'));
  if (!snap.exists()) return { habilitado: false };
  return { habilitado: (snap.data().habilitado as boolean) ?? false };
}

export async function guardarConfigIA(cfg: ConfigIA): Promise<void> {
  await setDoc(doc(db, 'configPatrimonio', 'ia'), cfg, { merge: true });
}

// ── Caché de análisis ─────────────────────────────────────────────────────────
function toISO(data: Record<string, unknown>): string {
  // Prefiere generadoEnISO (string, escrito por ambos caminos). Fallback a Timestamp.
  const iso = data.generadoEnISO;
  if (typeof iso === 'string' && iso) return iso;
  const ts = data.generadoEn as Timestamp | null;
  return ts?.toDate?.()?.toISOString() ?? '';
}

export async function cargarAnalisisPosicion(ticker: string): Promise<AnalisisPosicion | null> {
  const snap = await getDoc(doc(db, 'analisisPosiciones', ticker));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    ticker,
    generadoEnISO: toISO(data),
    modeloUsado: (data.modeloUsado as string) ?? '',
    origen: (data.origen as 'api' | 'chat') ?? undefined,
    resultado: (data.resultado as AnalisisPosicion['resultado']) ?? {},
  };
}

export async function cargarTodosLosAnalisis(): Promise<AnalisisPosicion[]> {
  const snap = await getDocs(collection(db, 'analisisPosiciones'));
  return snap.docs.map(d => {
    const data = d.data();
    return {
      ticker: d.id,
      generadoEnISO: toISO(data),
      modeloUsado: (data.modeloUsado as string) ?? '',
      origen: (data.origen as 'api' | 'chat') ?? undefined,
      resultado: (data.resultado as AnalisisPosicion['resultado']) ?? {},
    };
  });
}

export async function cargarUltimoSectorial(): Promise<AnalisisSectorial | null> {
  const snap = await getDocs(
    query(collection(db, 'analisisSectorial'), orderBy('generadoEn', 'desc'), limit(1))
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  const data = d.data();
  return {
    id: d.id,
    generadoEnISO: toISO(data),
    modeloUsado: (data.modeloUsado as string) ?? '',
    origen: (data.origen as 'api' | 'chat') ?? undefined,
    resultado: (data.resultado as string) ?? '',
  };
}

export async function cargarUltimaAgenda(): Promise<AgendaMacro | null> {
  const snap = await getDocs(
    query(collection(db, 'agendaMacro'), orderBy('generadoEn', 'desc'), limit(1))
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  const data = d.data();
  return {
    id: d.id,
    generadoEnISO: toISO(data),
    horizonteDias: (data.horizonteDias as number) ?? 45,
    origen: (data.origen as 'api' | 'chat') ?? undefined,
    eventos: (data.eventos as EventoAgenda[]) ?? [],
  };
}

// ── Callable wrapper ──────────────────────────────────────────────────────────
const _analizarConIA = httpsCallable<
  { modo: 'posicion' | 'sectorial' | 'agenda' | 'manuales'; ticker?: string; contexto: Record<string, unknown> },
  { ok: boolean; resultado: unknown; resumen?: string }
>(functions, 'analizarConIA');

export async function analizarPosicion(
  ticker: string,
  contexto: Record<string, unknown>,
): Promise<AnalisisPosicion> {
  await _analizarConIA({ modo: 'posicion', ticker, contexto });
  const result = await cargarAnalisisPosicion(ticker);
  if (!result) throw new Error('Análisis no encontrado tras generación');
  return result;
}

export async function analizarSectorial(
  contexto: Record<string, unknown>,
): Promise<AnalisisSectorial> {
  await _analizarConIA({ modo: 'sectorial', contexto });
  const result = await cargarUltimoSectorial();
  if (!result) throw new Error('Sectorial no encontrado tras generación');
  return result;
}

export async function generarAgenda(
  contexto: Record<string, unknown>,
): Promise<AgendaMacro> {
  await _analizarConIA({ modo: 'agenda', contexto });
  const result = await cargarUltimaAgenda();
  if (!result) throw new Error('Agenda no encontrada tras generación');
  return result;
}

// F9.101 — etapa 'manuales' del orquestador API: actualiza valorUsd/fechaValuacion
// de posicionesManuales server-side (vía importarManuales); no hay caché propio
// que releer acá, el caller refresca cargarPosicionesManuales() por su cuenta.
export async function analizarManuales(
  contexto: Record<string, unknown>,
): Promise<string> {
  const r = await _analizarConIA({ modo: 'manuales', contexto });
  return r.data.resumen ?? 'manuales: sin resumen';
}

// ── F9.99: callables chat path ────────────────────────────────────────────────
export type ModoIA = 'posicion' | 'sectorial' | 'agenda' | 'lote' | 'completo';

export type PromptGenerado = {
  prompt: string;
  modo: ModoIA;
  ticker?: string;
  generadoEn: string;
};

export type ImportarResult = {
  ok: boolean;
  resumen: string;
};

const _generarPromptIA = httpsCallable<
  { modo: ModoIA; ticker?: string; contexto: Record<string, unknown> },
  PromptGenerado
>(functions, 'generarPromptIA');

const _importarAnalisisIA = httpsCallable<
  { modo: ModoIA; ticker?: string; contenido: string },
  ImportarResult
>(functions, 'importarAnalisisIA');

export async function generarPromptIA(
  modo: ModoIA,
  contexto: Record<string, unknown>,
  ticker?: string,
): Promise<PromptGenerado> {
  const r = await _generarPromptIA({ modo, contexto, ...(ticker ? { ticker } : {}) });
  return r.data;
}

export async function importarAnalisisIA(
  modo: ModoIA,
  contenido: string,
  ticker?: string,
): Promise<ImportarResult> {
  const r = await _importarAnalisisIA({ modo, contenido, ...(ticker ? { ticker } : {}) });
  return r.data;
}

// ── F9.99.3: helpers de sectorial ─────────────────────────────────────────────

export type Driver = 'energia_ar' | 'cer_pesos' | 'soberano' | 'cripto' | 'tech_global' | 'otro';

export type SeccionSectorial = { driver: string; titulo: string; cuerpo: string };

export function splitSectorialPorDriver(texto: string): SeccionSectorial[] {
  const headerRe = /^## (.+?) \[driver: (\w+)\]/gm;
  const pieces: { idx: number; driver: string; titulo: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = headerRe.exec(texto)) !== null) {
    pieces.push({ idx: match.index, driver: match[2], titulo: match[1] });
  }
  return pieces.map((p, i) => {
    const end = i + 1 < pieces.length ? pieces[i + 1].idx : texto.length;
    const lineEnd = texto.indexOf('\n', p.idx);
    const cuerpo = lineEnd >= 0 ? texto.slice(lineEnd + 1, end).trim() : '';
    return { driver: p.driver, titulo: p.titulo, cuerpo };
  });
}

export function tickerADriver(ticker: string, sectorDisp: string): Driver {
  const t = ticker.toUpperCase();
  const s = sectorDisp.toLowerCase();
  if (/^(BTC|ETH|AAVE|UNI|SOL|MATIC|BNB)$/.test(t)) return 'cripto';
  if (/^(GD|AL)\d{2}/.test(t)) return 'soberano';
  if (/^(LECAP|LEDES|LECER|LELINK|DICA|TDF|TZVD|TDA|TVP)/.test(t)) return 'cer_pesos';
  if (/^(TRAN|TGSU2|TGSU|PAMP|VIST|YPFD|YPF|CEPU|MOLI)$/.test(t)) return 'energia_ar';
  if (/^(ACN|GLOB|CVX|VZ|MSFT|GOOGL|GOOG|AMZN|META|NVDA|AAPL)$/.test(t) || t === 'B') return 'tech_global';
  if (/cripto|defi|btc|eth/.test(s)) return 'cripto';
  if (/soberano|bono usd|global/.test(s)) return 'soberano';
  if (/energi|tarifas|gas|electr|util|petr|oil/.test(s)) return 'energia_ar';
  if (/peso|cer|ajust|local|captur/.test(s)) return 'cer_pesos';
  if (/tech|eeuu/.test(s)) return 'tech_global';
  return 'otro';
}

// ── F9.147 §1 — el contexto del prompt de posición ────────────────────────────
//
// Antes eran CUATRO campos (ticker, sector, peso, valorUsd): el modelo opinaba sobre una
// posición de la que no sabía nada y reconstruía por su cuenta datos que la app ya tiene
// calculados y auditados. Ahora la ficha entera de F9.144/F9.148/F9.149 entra al prompt.
//
// Vive acá y no dentro de `Patrimonio.tsx` porque es una transformación pura y es lo único
// verificable sin pintar: `scripts/verificarF9147.ts` la corre sobre datos reales.

/** Los fundamentals que aplican a cada tipo. Lo que no aplica no se pide, y así no se muestra. */
export const FUNDAMENTALS_POR_TIPO: Record<string, string[]> = {
  accion: ['P/E', 'EV/EBITDA', 'margen operativo', 'ROE', 'deuda/EBITDA', 'crecimiento de ingresos'],
  cedear: ['P/E', 'EV/EBITDA', 'margen operativo', 'ROE', 'deuda/EBITDA', 'ratio de conversión del CEDEAR'],
  bono:   ['TIR', 'duration', 'paridad', 'vencimiento', 'calificación'],
  on:     ['TIR', 'duration', 'vencimiento', 'calificación', 'deuda/EBITDA del emisor'],
  fci:    ['rendimiento 12m', 'comisión de administración', 'composición de cartera', 'duration si es de renta fija'],
  cripto: ['market cap', 'dominancia', 'oferta circulante', 'métricas propias del activo'],
  cash:   [],
};

export type FichaParaPrompt = {
  identidad: string;
  tipo: string;
  paisRiesgo: string;
  valorUsd: number;
  cantidad: number | null;
  estadoSerie?: string;
  motivoSinDatos?: string | null;
} & Record<string, unknown>;

/**
 * Arma el contexto de una posición para el prompt. Una entrada por IDENTIDAD
 * (`ticker|tipo|paisRiesgo`), no por ticker: GLOB es a la vez un CEDEAR en ARS y una acción
 * global en USD, y colapsarlos le daría al plan de empleado los indicadores del CEDEAR.
 *
 * Los indicadores viajan AGRUPADOS igual que en la ficha (tendencia / rango / riesgo /
 * performance / liquidez) y **con su moneda**, para que el modelo no reste un `perf1a` en
 * dólares de un drawdown en pesos.
 */
export function contextoPosicion(
  ticker: string,
  sectorDisp: string,
  totalUsd: number,
  totalPortafolio: number,
  identidades: Array<{
    identidad: string;
    tipo: string;
    paisRiesgo: string;
    valorUsd: number;
    cantidad: number | null;
    ind: IndicadoresPosicion | null;
  }>,
): Record<string, unknown> {
  const num = (x: number | null | undefined, dec = 2) =>
    x === null || x === undefined || !Number.isFinite(x) ? null : Number(x.toFixed(dec));
  const p = (x: number | null | undefined) =>
    x === null || x === undefined || !Number.isFinite(x) ? null : `${(x * 100).toFixed(1)}%`;

  const fichas: FichaParaPrompt[] = identidades.map(id => {
    const i = id.ind;
    const base: FichaParaPrompt = {
      identidad: id.identidad, tipo: id.tipo, paisRiesgo: id.paisRiesgo,
      valorUsd: Math.round(id.valorUsd), cantidad: id.cantidad,
    };
    if (!i || i.motivo !== null) {
      return { ...base, estadoSerie: i?.estadoSerie ?? 'sin_serie', motivoSinDatos: i?.motivo ?? 'sin indicadores' };
    }
    return {
      ...base,
      estadoSerie: i.estadoSerie,
      monedaSerie: i.monedaSerie,
      puntosDisponibles: i.puntosDisponibles,
      precio: { valor: num(i.precio, 4), fecha: i.fechaUltimoPrecio, moneda: i.monedaSerie },
      tendencia: { sma20: num(i.sma20, 4), sma50: num(i.sma50, 4), sma200: num(i.sma200, 4),
        vsSma20: p(i.vsSma20Pct), vsSma50: p(i.vsSma50Pct), vsSma200: p(i.vsSma200Pct) },
      rango: { max52s: num(i.max52s, 4), min52s: num(i.min52s, 4),
        distanciaAlMax: p(i.distanciaMax52sPct), distanciaAlMin: p(i.distanciaMin52sPct) },
      riesgo: { drawdownDesdeMax: p(i.drawdownDesdeMaxPct), ulcerIndex126: p(i.ulcerIndex126),
        volatilidad30d: p(i.volAnualizada30d), volatilidad90d: p(i.volAnualizada90d), atr: p(i.atrPct) },
      // La banda de caída de F9.149 no es un umbral fijo: sin estos números el modelo no puede
      // entender por qué un −48% puede ser verde y un −17% rojo.
      calibracionCaida: i.ddMediana == null ? null : {
        metodo: 'CDaR(0,8) sobre la distribución de caídas del propio activo',
        caidaTipica: p(i.ddMediana), promedioDelPeor20: p(i.ddCdar80), observaciones: i.ddObservaciones,
      },
      performance: { moneda: i.monedaPerformance ?? i.monedaSerie,
        p1m: p(i.perf1m), p3m: p(i.perf3m), p6m: p(i.perf6m), p1a: p(i.perf1a) },
      momentum: { rsi14: num(i.rsi14, 1) },
      liquidez: { ruedasParaSalir: num(i.ruedasParaSalir, 4),
        montoOperadoProm30d: num(i.montoOperadoProm30d, 0), ratioVolumen: num(i.ratioVolumen, 2) },
      semaforos: i.semaforos ?? {},
    };
  });

  const tipos = [...new Set(identidades.map(x => x.tipo))];
  return {
    ticker,
    sector: sectorDisp,
    pesoEnCartera: `${Math.round((totalUsd / (totalPortafolio || 1)) * 100)}%`,
    valorUsd: Math.round(totalUsd),
    fundamentalsPedidos: [...new Set(tipos.flatMap(t => FUNDAMENTALS_POR_TIPO[t] ?? []))],
    fichas,
  };
}
