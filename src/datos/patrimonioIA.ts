import { httpsCallable } from 'firebase/functions';
import {
  doc, getDoc, setDoc, getDocs, collection,
  query, orderBy, limit, type Timestamp,
} from 'firebase/firestore';
import { db, functions } from '../firebase';

// ── Tipos ─────────────────────────────────────────────────────────────────────
export type EventoProximo =
  | { cuando: string | null; evento: string }  // formato estructurado (F9.95+)
  | string;                                     // retrocompat: string suelto

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
