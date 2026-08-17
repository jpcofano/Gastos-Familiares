import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit, startAfter, writeBatch,
  type QueryDocumentSnapshot, type QuerySnapshot,
} from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { bloqueDe } from './patrimonioRiesgo';
import type { Posicion } from '../types/patrimonio';

// ── Tipos ─────────────────────────────────────────────────────────────────────
export type CafciFondoConfig = {
  fondoId: string;
  claseId: string;
  nombre: string;
};

export type ConfigCafci = {
  fondos: CafciFondoConfig[];
};

export type CafciPosicion = {
  especieRaw: string;
  ticker: string | null;
  pesoPct: number;
  // F9.122 — RENTA_FIJA se suma acá: una ON de un emisor de acciones no es la acción, y contarla
  // en el benchmark de renta variable falsea el peso del papel.
  categoria?: 'LIQUIDEZ' | 'CEDEAR' | 'RESTO' | 'RENTA_FIJA';
  incompleto?: boolean;
};

export type CafciCartera = {
  id: string;
  fondoId: string;
  nombre: string;
  nombreFondo?: string;
  nombreClase?: string;
  fechaDatos: string;   // YYYY-MM-DD
  fechaFetch: string;   // ISO
  posiciones: CafciPosicion[];
  totalPct: number;
  // F9.104 — "Resto de Activos" (cola truncada del pie chart de origen) como bucket explícito
  // de desconocido: pesoResto nunca se prorratea ni se descarta en silencio.
  pesoResto?: number;
  coberturaIdentificada?: number; // totalPct − pesoResto
  advertenciaSuma?: boolean;      // totalPct fuera de [98,102] — HTML roto o parseo incompleto
  advertenciaCobertura?: boolean; // coberturaIdentificada < umbral — truncamiento severo
  origen?: 'manual';     // F9.102.2 4a — presente solo en cartas cargadas vía "Pegar JSON"
  fechaIngesta?: string; // ISO — idem
};

// ── Config CAFCI ────���─────────────────────────────────────────────────────────
export async function cargarConfigCafci(): Promise<ConfigCafci> {
  const snap = await getDoc(doc(db, 'configPatrimonio', 'cafci'));
  if (!snap.exists()) return { fondos: [] };
  const data = snap.data() as { fondos?: CafciFondoConfig[] };
  return { fondos: data.fondos ?? [] };
}

export async function guardarConfigCafci(config: ConfigCafci): Promise<void> {
  await setDoc(doc(db, 'configPatrimonio', 'cafci'), config, { merge: true });
}

// ── Universo del segmento (F9.143) ────────────────────────────────────────────
// El universo dejó de configurarse a mano: se DERIVA del join catálogo ⋈ planilla de CAFCI y se
// guarda fechado en `cafciUniverso/{YYYY-MM-DD}`. Se construye desde `scripts/construirUniversoCafci.ts`
// (necesita parsear un XLSX, y `xlsx` no es dependencia de functions/); acá sólo se lee.
//
// `configPatrimonio/cafci` NO desaparece: queda como override manual. Ver §1 del cierre de F9.143.

export type CafciFondoUniverso = {
  fondoId: string;
  claseId: string;        // claseTop — SOLO para armar la URL de ficha, la cartera es del fondo
  nombre: string;
  cnv: string | null;
  patrimonioArs: number;  // suma de TODAS las clases del fondo
  clases: number;
};

export type UniversoCafci = {
  fecha: string;            // YYYY-MM-DD, id del documento
  fechaPlanilla: string;    // la planilla de la que salió el patrimonio
  fechaCatalogo: string;
  totalPatrimonioArs: number;
  fondos: CafciFondoUniverso[];
};

/**
 * Vigente + anterior, para comparar. F9.143 §4 no guarda serie completa: alcanza con dos.
 *
 * Se lee la colección entera y se ordena en memoria, sin `orderBy`. MEDIDO el 17/08:
 * `orderBy('__name__', 'desc')` devuelve FAILED_PRECONDITION pidiendo un índice compuesto — el
 * índice automático de Firestore es ASCENDENTE sobre `__name__`, el descendente hay que
 * declararlo. Como la colección tiene dos documentos por diseño, ordenar acá no cuesta nada y no
 * agrega un índice al proyecto. (Mismo criterio que el fallback de `tcDiario`, F9.113/F9.146.)
 */
export async function cargarUniversos(n = 2): Promise<UniversoCafci[]> {
  const snap = await getDocs(collection(db, 'cafciUniverso'));
  return snap.docs
    .map(d => ({ ...(d.data() as Omit<UniversoCafci, 'fecha'>), fecha: d.id }))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
    .slice(0, n);
}

/** Universo vigente (el de fecha más reciente), o null si todavía no se construyó ninguno. */
export async function cargarUniversoVigente(): Promise<UniversoCafci | null> {
  return (await cargarUniversos(1))[0] ?? null;
}

/** Pesos de ponderación para `calcBenchmark`: patrimonio del FONDO por `fondoId`. */
export function pesosDeUniverso(u: UniversoCafci | null): Record<string, number> | undefined {
  if (!u) return undefined;
  const out: Record<string, number> = {};
  for (const f of u.fondos) out[f.fondoId] = f.patrimonioArs;
  return out;
}

/** El universo expresado como config de fondos, para reusar `cargarUltimasCarteras`. */
export function fondosDeUniverso(u: UniversoCafci): CafciFondoConfig[] {
  return u.fondos.map(f => ({ fondoId: f.fondoId, claseId: f.claseId, nombre: f.nombre }));
}

/** `undefined` (no `[]`) si no hay universo, para que el `??` caiga a la config. */
function fondosDeUniversoOVacio(u: UniversoCafci | null): CafciFondoConfig[] | undefined {
  if (!u || u.fondos.length === 0) return undefined;
  return fondosDeUniverso(u);
}

// ── Carteras ──────────────────────────────────────────────────────────────────
// F9.142 — tamaño de página y tope de páginas. La página es la de siempre (50); lo que cambia
// es que ahora hay una segunda pasada si hace falta, en vez de cortar a ciegas. El tope existe
// para que un fondo configurado que nunca sincronizó no dispare un scan de la colección entera.
const CARTERAS_PAGINA = 50;

// F9.143 — el tope de páginas se DERIVA de cuántos fondos hay que cubrir, no es una constante.
// Con 13 fondos y un tope fijo de 4 páginas (200 docs) se toleraban ~15 sincronizaciones antes de
// que un fondo congelado cayera fuera del corte. Con 54 fondos ese mismo tope da ~3,7: el
// truncamiento silencioso que F9.142 vino a cerrar volvía por la ventana, cuadruplicado.
// SINCRONIZACIONES_TOLERADAS es cuántas corridas puede quedarse atrás un fondo antes de que
// haga falta paginar de más para encontrarlo.
const SINCRONIZACIONES_TOLERADAS = 12;
function maxPaginas(nFondos: number): number {
  return Math.max(4, Math.ceil((nFondos * SINCRONIZACIONES_TOLERADAS) / CARTERAS_PAGINA));
}

/**
 * Última cartera de cada fondo **configurado**.
 *
 * F9.142 — la config manda. Antes se leía `cafciCarteras` sin filtrar, así que un fondo sacado
 * de la config seguía pesando en el benchmark con su última cartera, para siempre. Sacar un
 * fondo tenía que poder hacerse desde la UI y no se podía. Los documentos huérfanos no se
 * borran —la colección es historia y sirve para reconstruir corridas viejas—: se filtran acá,
 * en lectura.
 *
 * `fondos` es opcional a propósito: si no viene, se lee la config. Un llamador que se olvide
 * de pasarla obtiene el comportamiento gobernado igual, nunca el viejo.
 *
 * Sobre el `limit(50)` que había: con 13 fondos y una cartera semanal, un fondo que deje de
 * sincronizar (403, timeout — ver F9.112) congela su `fechaFetch` y cae fuera del corte
 * después de ~5 carteras nuevas de los demás; desaparecía del benchmark sin que nada lo
 * dijera. La alternativa que evaluamos —`where('fondoId', 'in', …)` en tandas de 30— necesita
 * un índice compuesto (`fondoId` + `fechaFetch`) que el proyecto no tiene, igual que el
 * `__name__` descendente que pedía la variante por rango de docId: las dos obligan a deployar
 * índices. Paginar no necesita ninguno, lee lo mismo que antes en el caso normal (una página
 * alcanza para los 13 fondos de hoy) y convierte el truncamiento silencioso en un warning.
 */
export async function cargarUltimasCarteras(fondos?: CafciFondoConfig[]): Promise<CafciCartera[]> {
  // F9.143 — sin argumento, el universo derivado manda y la config es el respaldo. Misma
  // precedencia que `sincronizarCafci`: nunca los dos juntos, porque mezclarlos dejaría entrar
  // por la config a un fondo que el universo ya no incluye, sin que se note.
  const configurados = fondos
    ?? fondosDeUniversoOVacio(await cargarUniversoVigente())
    ?? (await cargarConfigCafci()).fondos;
  if (configurados.length === 0) return [];
  const permitidos = new Set(configurados.map(f => f.fondoId));

  const seen = new Set<string>();
  const result: CafciCartera[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  const topePaginas = maxPaginas(permitidos.size);

  for (let pagina = 0; pagina < topePaginas; pagina++) {
    // El cursor es el snapshot del último documento, no su `fechaFetch`: una sincronización
    // escribe los 13 documentos con el MISMO timestamp, así que `startAfter(valor)` se saltearía
    // la tanda entera. La anotación de `snap` corta la inferencia circular (cursor ← snap ← cursor).
    const snap: QuerySnapshot = await getDocs(
      cursor
        ? query(collection(db, 'cafciCarteras'), orderBy('fechaFetch', 'desc'), startAfter(cursor), limit(CARTERAS_PAGINA))
        : query(collection(db, 'cafciCarteras'), orderBy('fechaFetch', 'desc'), limit(CARTERAS_PAGINA))
    );
    if (snap.empty) break;

    for (const d of snap.docs) {
      const data = d.data() as Omit<CafciCartera, 'id'>;
      if (!permitidos.has(data.fondoId) || seen.has(data.fondoId)) continue;
      seen.add(data.fondoId);
      result.push({ id: d.id, ...data });
    }
    if (seen.size === permitidos.size) return result;
    if (snap.docs.length < CARTERAS_PAGINA) break;
    cursor = snap.docs[snap.docs.length - 1];
  }

  // Un fondo configurado sin cartera no es un caso raro que se pueda ignorar: es exactamente el
  // "no está aportando al benchmark" que antes pasaba callado.
  const faltantes = [...permitidos].filter(id => !seen.has(id));
  if (faltantes.length > 0) {
    console.warn(
      `[cargarUltimasCarteras] sin cartera en los últimos ${CARTERAS_PAGINA * topePaginas} documentos: ` +
      faltantes.map(id => configurados.find(f => f.fondoId === id)?.nombre ?? id).join(', ') +
      ' — no aportan al benchmark. ¿Sincronizaste después de agregarlos?'
    );
  }
  return result;
}

export async function cargarTodasLasCarteras(): Promise<CafciCartera[]> {
  const snap = await getDocs(
    query(collection(db, 'cafciCarteras'), orderBy('fechaFetch', 'desc'))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as CafciCartera);
}

// ── Mapping especie → ticker ───────────────────────────────────────────────────
export type MappingEntry = { ticker: string | null; categoria?: string };

export async function cargarMappings(): Promise<Record<string, string | null>> {
  const snap = await getDocs(collection(db, 'cafciMapping'));
  const result: Record<string, string | null> = {};
  for (const d of snap.docs) {
    result[d.id] = (d.data() as MappingEntry).ticker;
  }
  return result;
}

export async function guardarMapping(especieNorm: string, ticker: string | null): Promise<void> {
  await setDoc(doc(db, 'cafciMapping', especieNorm), { ticker });
}

// ── Seed de fondos sugeridos (F9.97.1 §8a) ───────────────────────────────────
// F9.142 — verificado fondo por fondo contra el catálogo de CAFCI
// (estadisticas.cafci.org.ar/consulta-de-fondos.json) y la planilla diaria con patrimonio por
// clase (api.pub.cafci.org.ar/pb_get), el 16/08/2026. Tres correcciones:
//
//   · `15/15` NO era "Pionero Acciones": es **Pionero Acciones Plus** (CNV 71, ARS 5.609 M),
//     un fondo 8x más chico y con 57% de CEDEARs brasileños y globales. El que la etiqueta
//     decía es `39/6174` (CNV 61, ARS 44.408 M). Se verificó por patrimonio, no por nombre:
//     los dos nombres se parecen demasiado, y confundirlos a ojo es como nació el defecto.
//   · `514/1038` (Consultatio Renta Variable) tiene patrimonio **0** y su última cartera es del
//     2026-01-23. No es que falle la sincronización: CAFCI no publica carteras nuevas de un
//     fondo vacío. Fuera del seed.
//   · `505/1021` decía "MAF Acciones Argentinas"; el fondo es "MAF Acciones Argentina". Los ids
//     apuntaban bien, era solo la etiqueta.
//
// El `claseId` elige la URL, no la cartera: la composición es del fondo (verificado idéntica
// entre ?clase=39 y ?clase=6174). Va Clase B por consistencia con el resto de la lista.
const FONDOS_SEED: CafciFondoConfig[] = [
  { fondoId: '216', claseId: '1634', nombre: 'Consultatio Acciones Argentina - Clase C' },
  { fondoId: '51',  claseId: '683',  nombre: 'Superfondo Renta Variable - Clase B' },
  { fondoId: '22',  claseId: '1193', nombre: 'Fima PB Acciones - Clase B' },
  { fondoId: '370', claseId: '662',  nombre: 'Delta Acciones - Clase B' },
  { fondoId: '275', claseId: '275',  nombre: '1810 Renta Variable Argentina - única' },
  { fondoId: '436', claseId: '821',  nombre: 'SBS Acciones Argentina - Clase B' },
  { fondoId: '39',  claseId: '6174', nombre: 'Pionero Acciones - Clase B' },
  { fondoId: '227', claseId: '227',  nombre: 'Premier Renta Variable - Clase A' },
  { fondoId: '441', claseId: '836',  nombre: 'Allaria Acciones - Clase B' },
  { fondoId: '615', claseId: '2249', nombre: 'Galileo Acciones - Clase B' },
  { fondoId: '505', claseId: '1021', nombre: 'MAF Acciones Argentina - Clase B' },
  { fondoId: '430', claseId: '804',  nombre: 'IAM Renta Variable - Clase B' },
];

/** Agrega los fondos sugeridos a la config (merge: no borra los ya existentes). */
export async function importarFondosSugeridos(): Promise<number> {
  const current = await cargarConfigCafci();
  const existingIds = new Set(current.fondos.map(f => `${f.fondoId}_${f.claseId}`));
  const nuevos = FONDOS_SEED.filter(f => !existingIds.has(`${f.fondoId}_${f.claseId}`));
  if (nuevos.length === 0) return 0;
  await guardarConfigCafci({ fondos: [...current.fondos, ...nuevos] });
  return nuevos.length;
}

// ── Seed de mapping especie→ticker (F9.97.1 §8b) ─────────────────────────────
// 70 patrones validados contra la API en producción (sistema AppsScript, abril 2026).
const MAPPING_SEED: Array<{ patron: string; ticker: string; tipo: string; sector: string }> = [
  { patron: 'YPF',                        ticker: 'YPFD',  tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Grupo Galicia',              ticker: 'GGAL',  tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Galicia',                    ticker: 'GGAL',  tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Banco Macro',               ticker: 'BMA',   tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Macro Bansud',              ticker: 'BMA',   tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Banco Patagonia',           ticker: 'BPAT',  tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Banco de Valores',          ticker: 'VALO',  tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'BBVA Argentina',            ticker: 'BBAR',  tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Supervielle',               ticker: 'SUPV',  tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Pampa Energia',             ticker: 'PAMP',  tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Central Puerto',            ticker: 'CEPU',  tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Edenor',                    ticker: 'EDN',   tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Capex',                     ticker: 'CAPX',  tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Transportadora Gas del Sur', ticker: 'TGSU2', tipo: 'ACCION',        sector: 'Energía' },
  { patron: 'Transportadora Gas del Norte', ticker: 'TGNO4', tipo: 'ACCION',      sector: 'Energía' },
  { patron: 'Transener',                 ticker: 'TRAN',  tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Metrogas',                  ticker: 'METR',  tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Vista',                     ticker: 'VIST',  tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Aluar',                     ticker: 'ALUA',  tipo: 'ACCION',         sector: 'Materiales' },
  { patron: 'Ternium',                   ticker: 'TXAR',  tipo: 'ACCION',         sector: 'Materiales' },
  { patron: 'Loma Negra',               ticker: 'LOMA',  tipo: 'ACCION',         sector: 'Materiales' },
  { patron: 'Holcim',                    ticker: 'HARG',  tipo: 'ACCION',         sector: 'Materiales' },
  { patron: 'Telecom Argentina',         ticker: 'TECO2', tipo: 'ACCION',         sector: 'Telecomunicaciones' },
  { patron: 'Telecom',                   ticker: 'TECO2', tipo: 'ACCION',         sector: 'Telecomunicaciones' },
  { patron: 'Cablevision',               ticker: 'CVH',   tipo: 'ACCION',         sector: 'Telecomunicaciones' },
  { patron: 'BYMA',                      ticker: 'BYMA',  tipo: 'ACCION',         sector: 'Financiero' },
  { patron: 'Bolsas y Mercados Argentinos', ticker: 'BYMA', tipo: 'ACCION',       sector: 'Financiero' },
  { patron: 'Cresud',                    ticker: 'CRES',  tipo: 'ACCION',         sector: 'Real Estate / Agro' },
  { patron: 'IRSA',                      ticker: 'IRSA',  tipo: 'ACCION',         sector: 'Real Estate' },
  { patron: 'Consultatio',               ticker: 'CTIO',  tipo: 'ACCION',         sector: 'Real Estate' },
  { patron: 'Mirgor',                    ticker: 'MIRG',  tipo: 'ACCION',         sector: 'Industrial' },
  { patron: 'Comercial del Plata',       ticker: 'COME',  tipo: 'ACCION',         sector: 'Holding' },
  { patron: 'Sociedad Comercial del Plata', ticker: 'COME', tipo: 'ACCION',       sector: 'Holding' },
  { patron: 'Autopistas del Sol',        ticker: 'AUSO',  tipo: 'ACCION',         sector: 'Infraestructura' },
  { patron: 'Molinos Rio de la Plata',   ticker: 'MOLI',  tipo: 'ACCION',         sector: 'Consumo' },
  { patron: 'Molinos Río de la Plata',   ticker: 'MOLI',  tipo: 'ACCION',         sector: 'Consumo' },
  { patron: 'Molinos Agro',              ticker: 'MOLA',  tipo: 'ACCION',         sector: 'Agro' },
  { patron: 'San Miguel',                ticker: 'SAMI',  tipo: 'ACCION',         sector: 'Agro' },
  { patron: 'Havanna',                   ticker: 'HAVA',  tipo: 'ACCION',         sector: 'Consumo' },
  { patron: 'Grupo Fciero Galicia',      ticker: 'GGAL',  tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Banco Rio',                 ticker: 'BRIO',  tipo: 'ACCION_LEGACY',  sector: 'Bancos' },
  { patron: 'Banco Santander Rio',       ticker: 'BRIO',  tipo: 'ACCION_LEGACY',  sector: 'Bancos' },
  { patron: 'Grupo Supervielle',         ticker: 'SUPV',  tipo: 'ACCION',         sector: 'Bancos' },
  { patron: 'Grupo Finc. Valores',       ticker: 'VALO',  tipo: 'ACCION',         sector: 'Financiero' },
  { patron: 'Grupo Financiero Valores',  ticker: 'VALO',  tipo: 'ACCION',         sector: 'Financiero' },
  { patron: 'Phoenix Global Resources',  ticker: 'PGR',   tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Centaurus Energy',          ticker: 'CTA',   tipo: 'ACCION_EXTERIOR', sector: 'Energía' },
  { patron: 'Camuzzi Gas Pampeana',      ticker: 'CGPA2', tipo: 'ACCION',         sector: 'Servicios públicos / Gas' },
  { patron: 'Camuzzi',                   ticker: 'CGPA2', tipo: 'ACCION',         sector: 'Servicios públicos / Gas' },
  { patron: 'Dist Gas Cuyana',           ticker: 'DGCU2', tipo: 'ACCION',         sector: 'Servicios públicos / Gas' },
  { patron: 'Distribuidora de Gas Cuyana', ticker: 'DGCU2', tipo: 'ACCION',       sector: 'Servicios públicos / Gas' },
  { patron: 'Ecogas',                    ticker: 'ECOG',  tipo: 'ACCION',         sector: 'Servicios públicos / Gas' },
  { patron: 'Transp Gas del Norte',      ticker: 'TGNO4', tipo: 'ACCION',         sector: 'Servicios públicos / Gas' },
  { patron: 'Transportadora de Gas del Norte', ticker: 'TGNO4', tipo: 'ACCION',   sector: 'Servicios públicos / Gas' },
  { patron: 'Transp Gas del Sur',        ticker: 'TGSU2', tipo: 'ACCION',         sector: 'Servicios públicos / Gas' },
  { patron: 'Transportadora de Gas del Sur', ticker: 'TGSU2', tipo: 'ACCION',     sector: 'Servicios públicos / Gas' },
  { patron: 'Holcim Argentina',          ticker: 'HARG',  tipo: 'ACCION',         sector: 'Materiales' },
  { patron: 'Cablevision Holding',       ticker: 'CVH',   tipo: 'ACCION',         sector: 'Holding' },
  { patron: 'Raghsa',                    ticker: 'RAGH',  tipo: 'ACCION',         sector: 'Real Estate' },
  { patron: 'Dycasa',                    ticker: 'DYCA',  tipo: 'ACCION',         sector: 'Construcción / Infraestructura' },
  { patron: 'Ferrum S.A.',               ticker: 'FERR',  tipo: 'ACCION',         sector: 'Construcción / Consumo durable' },
  { patron: 'Ferrum',                    ticker: 'FERR',  tipo: 'ACCION',         sector: 'Construcción / Consumo durable' },
  { patron: 'Grimoldi',                  ticker: 'GRIM',  tipo: 'ACCION',         sector: 'Consumo' },
  { patron: 'Morixe Hermanos',           ticker: 'MORI',  tipo: 'ACCION',         sector: 'Consumo / Alimentos' },
  { patron: 'Morixe',                    ticker: 'MORI',  tipo: 'ACCION',         sector: 'Consumo / Alimentos' },
  { patron: 'Ovoprot Internacional',     ticker: 'OVOP',  tipo: 'ACCION',         sector: 'Consumo / Alimentos' },
  { patron: 'Ovoprot International',     ticker: 'OVOP',  tipo: 'ACCION',         sector: 'Consumo / Alimentos' },
  { patron: 'Corporacion America Airports', ticker: 'CAAP', tipo: 'ACCION',       sector: 'Infraestructura aeroportuaria' },
  { patron: 'Vista Oil & Gas',           ticker: 'VIST',  tipo: 'ACCION',         sector: 'Energía' },
  { patron: 'Vista Energy',              ticker: 'VIST',  tipo: 'ACCION',         sector: 'Energía' },
];

/** Escribe los 70 patrones de mapping en cafciMapping (sobrescribe docs existentes). */
export async function importarMappingSeed(): Promise<number> {
  const batch = writeBatch(db);
  for (const entry of MAPPING_SEED) {
    const norm = normalizarEspecie(entry.patron);
    batch.set(doc(db, 'cafciMapping', norm), {
      ticker: entry.ticker,
      tipo: entry.tipo,
      sector: entry.sector,
    });
  }
  await batch.commit();
  return MAPPING_SEED.length;
}

// ── Sincronización (callable) ──────────────────────────────────────────────────
export type ResultadoSincronizarCafci = {
  sincronizados: number;
  pendientesMapeo: string[];
  errores: Array<{ fondo: string; mensaje: string }>;
  // F9.143 — opcionales: una respuesta de una función desplegada antes de F9.143 no los trae.
  total?: number;
  origenUniverso?: string;
  duracionSegundos?: number;
  bajoCobertura?: number;
  sumaFueraDeRango?: number;
};

export async function sincronizarCafci(): Promise<ResultadoSincronizarCafci> {
  // F9.104 — cerrado el experimento de región (F9.102.1/.2): vuelve a la instancia default.
  const fn = httpsCallable<void, ResultadoSincronizarCafci>(
    functions, 'sincronizarCafci'
  );
  const result = await fn();
  return result.data;
}

// ── Ingesta manual (F9.102.2 4a) ───────────────────────────────────────────────
export type ResultadoImportarCafciManual = {
  ok: boolean;
  especies: number;
  pendientesMapeo: string[];
  fechaDatos: string;
};

export async function importarCafciManual(fondoId: string, claseId: string, json: string): Promise<ResultadoImportarCafciManual> {
  const fn = httpsCallable<{ fondoId: string; claseId: string; json: string }, ResultadoImportarCafciManual>(
    functions, 'importarCafciManual'
  );
  const result = await fn({ fondoId, claseId, json });
  return result.data;
}

/** Fecha de datos de la última cartera cargada para un fondo (auto o manual), o null si no hay ninguna. */
export function fechaDatosDeFondo(carteras: CafciCartera[], fondoId: string): string | null {
  const c = carteras.find(c => c.fondoId === fondoId);
  return c?.fechaDatos ?? null;
}

// ── Helpers de análisis para BenchmarkTab ─────────────────────────────────────
// F9.122 — TODOS los campos de peso son FRACCIÓN (0–1), nunca porcentaje. `CafciPosicion.pesoPct`
// viene de CAFCI en 0–100 (lo confirma la validación totalPct ∈ [98,102]) y se divide acá al leer.
// Antes convivían las dos unidades en la misma fila y la UI multiplicaba las dos por 100: un fondo
// con 11,4% de PAMP se mostraba como 1140,0%. El sufijo `Frac` es el que impide que vuelva a pasar.
export type FilaBenchmark = {
  ticker: string;
  propioUsd: number | null;    // null si no está en cartera propia
  propioFrac: number | null;   // fracción sobre total propio
  // F9.143 — promedio PONDERADO por el patrimonio del fondo cuando se pasan `pesos`; los fondos
  // que no tienen el papel pesan 0 (siguen en el denominador). Sin `pesos`, equiponderado.
  fondosAvgFrac: number;
  fondosMinFrac: number;
  fondosMaxFrac: number;
  // F9.143 — `std` se pondera con los MISMOS pesos que el promedio. La alternativa (dejarla sin
  // ponderar) daba una dispersión que no correspondía al promedio de al lado, y es justo el tipo
  // de campo que después se lee como si midiera otra cosa. Min y max no cambian: son extremos
  // observados, la ponderación no los toca.
  fondosStdFrac: number;
  divergencia: number;         // |propioFrac - fondosAvgFrac|, para ordenar
};

// F9.122.1 §B — la base sobre la que se calculan TODOS los porcentajes de este módulo. Se expone
// porque un % sin denominador declarado es una cifra que induce a error, no una medición.
export type BaseComparable = {
  propioUsd: number;          // renta variable AR propia
  propioPctDeCartera: number; // qué fracción del invertible representa
  fondoCoberturaProm: number; // fracción promedio de los fondos que entró a la base
  excluidoFondoProm: number;  // 1 − cobertura: liquidez + resto + renta fija + CEDEAR no-AR
  // Agregados sobre el spec: sin esto, "se saltearon fondos" es una decisión invisible.
  fondosEnBase: number;
  fondosSalteados: number;
  // F9.143 — un promedio ponderado sin decir sobre qué masa se ponderó induce a error, mismo
  // criterio que `propioPctDeCartera`. `ponderado:false` = no se pasaron pesos y el promedio
  // quedó equiponderado; ahí `patrimonioBaseArs` es 0 y no significa nada.
  ponderado: boolean;
  patrimonioBaseArs: number;  // suma del patrimonio de los fondos que entraron a la base
};

// Un fondo cuya porción comparable no llega a este piso no se renormaliza: dividir por una base
// flaca amplifica el ruido en vez de medir. Está en escala 0–100, como pesoPct.
const BASE_FONDO_MINIMA = 40;

/**
 * @param pesos F9.143 — patrimonio en ARS por `fondoId` (suma de TODAS las clases del fondo, ver
 *   CLAUDE-PATRIMONIO §"El patrimonio es del FONDO, no de la clase"). Si se omite, el promedio
 *   queda equiponderado como antes de F9.143 — es opcional a propósito para no romper a los
 *   llamadores que no tienen el universo a mano (informe viejo, scripts de auditoría).
 */
export function calcBenchmark(
  posicionesPropias: Posicion[],
  carteras: CafciCartera[],
  mappings: Record<string, string | null>,
  pesos?: Record<string, number>
): {
  filas: FilaBenchmark[];
  soloenFondos: Array<{ ticker: string; avgFrac: number }>;
  soloEnPropio: string[];
  base: BaseComparable;
} {
  const baseVacia: BaseComparable = {
    propioUsd: 0, propioPctDeCartera: 0, fondoCoberturaProm: 0, excluidoFondoProm: 0,
    fondosEnBase: 0, fondosSalteados: 0, ponderado: false, patrimonioBaseArs: 0,
  };
  if (carteras.length === 0) return { filas: [], soloenFondos: [], soloEnPropio: [], base: baseVacia };

  // F9.122.1 §B — BASE PROPIA: renta variable argentina, no el invertible entero. Comparar el peso
  // de un papel sobre una cartera que incluye cripto, cash y soberanos contra el peso que ese papel
  // tiene dentro de un fondo de acciones son dos universos distintos, y el número que sale de
  // mezclarlos no significa nada: subestima sistemáticamente lo propio y hace leer "estás en línea"
  // donde en realidad hay más concentración. Se reusa `bloqueDe` de patrimonioRiesgo.ts —la función
  // canónica de clasificación— en vez de inventar un filtro nuevo que pueda divergir de ella.
  const propias = posicionesPropias.filter(p => bloqueDe(p) === 'accionesAr');
  const totalPropio = propias.reduce((s, p) => s + p.valorUsd, 0);
  const totalInvertible = posicionesPropias.reduce((s, p) => s + p.valorUsd, 0);

  // Peso propio por ticker
  const propioByTicker: Record<string, number> = {};
  for (const p of propias) {
    propioByTicker[p.ticker] = (propioByTicker[p.ticker] ?? 0) + p.valorUsd;
  }
  const tickersArPropios = new Set(propias.map(p => p.ticker));

  const tickerDe = (pos: CafciPosicion): string | null =>
    pos.ticker ?? mappings[normalizarEspecie(pos.especieRaw)] ?? null;

  // BASE FONDO: se sacan liquidez, "Resto de Activos" y renta fija, y los CEDEARs cuyo subyacente
  // no está en tu renta variable AR. La regla del CEDEAR es asimétrica y conviene decirlo: solo
  // puede *encontrar* solapamiento (VIST, que Galileo tiene al 13,5%), nunca mostrarte un CEDEAR de
  // riesgo argentino que el fondo tenga y vos no. La alternativa —un registro propio de riesgo-país
  // por CEDEAR— es un dato que la app no tiene.
  const enBase: Array<{ comparables: CafciPosicion[]; baseFondo: number; fondoId: string }> = [];
  let fondosSalteados = 0;
  for (const cartera of carteras) {
    const comparables = cartera.posiciones.filter(pos => {
      if (pos.incompleto) return false;
      const t = tickerDe(pos);
      if (!t) return false;
      if (pos.categoria === 'LIQUIDEZ' || pos.categoria === 'RESTO' || pos.categoria === 'RENTA_FIJA') return false;
      if (pos.categoria === 'CEDEAR' && !tickersArPropios.has(t)) return false;
      return true;
    });
    const baseFondo = comparables.reduce((s, p) => s + p.pesoPct, 0);
    if (baseFondo < BASE_FONDO_MINIMA) { fondosSalteados++; continue; }
    enBase.push({ comparables, baseFondo, fondoId: cartera.fondoId });
  }

  // F9.143 — pesos de ponderación, normalizados sobre los fondos que EFECTIVAMENTE entraron a la
  // base, no sobre el universo entero: si BASE_FONDO_MINIMA saltea seis, sus patrimonios no
  // cuentan en el denominador (si contaran, el promedio sumaría menos de 1 y todos los pesos
  // quedarían diluidos por fondos que no aportaron ningún papel).
  const ponderado = !!pesos;
  const patrimonioDe = (fondoId: string) => (pesos ? (pesos[fondoId] ?? 0) : 1);
  const patrimonioBaseArs = ponderado ? enBase.reduce((s, f) => s + patrimonioDe(f.fondoId), 0) : 0;
  // Un universo con pesos donde ninguno de los que entró tiene patrimonio (>0) sería una división
  // por cero: se cae a equiponderado y se avisa, en vez de devolver NaN en cada fila.
  const sinMasa = ponderado && patrimonioBaseArs <= 0;
  if (sinMasa) {
    console.warn('[calcBenchmark] se pasaron pesos pero ningún fondo en base tiene patrimonio > 0 — se pondera equiponderado');
  }
  const totalPeso = enBase.reduce((s, f) => s + (ponderado && !sinMasa ? patrimonioDe(f.fondoId) : 1), 0);
  const wDe = (idx: number) =>
    totalPeso > 0 ? (ponderado && !sinMasa ? patrimonioDe(enBase[idx].fondoId) : 1) / totalPeso : 0;
  const pesosNorm = enBase.map((_, idx) => wDe(idx));

  // Pesos de fondos por ticker, renormalizados sobre la base comparable de cada fondo.
  const fondosByTicker: Record<string, number[]> = {};
  for (let idx = 0; idx < enBase.length; idx++) {
    const { comparables, baseFondo } = enBase[idx];
    for (const pos of comparables) {
      const ticker = tickerDe(pos)!;
      if (!fondosByTicker[ticker]) fondosByTicker[ticker] = Array(enBase.length).fill(0);
      // F9.122.1 §B — acá NO va el /100 que introdujo F9.122 §1: `pesoPct` y `baseFondo` están en
      // la misma escala 0–100, así que el cociente ya sale en fracción. Un /100 de más daría 0,01.
      fondosByTicker[ticker][idx] = (fondosByTicker[ticker][idx] ?? 0) + pos.pesoPct / baseFondo;
    }
  }

  // Assert de la renormalización: los pesos de cada fondo tienen que sumar 1,0. Si no suman, o el
  // filtro de comparables no coincide con el denominador, o volvió a colarse una conversión.
  for (let idx = 0; idx < enBase.length; idx++) {
    const suma = Object.values(fondosByTicker).reduce((s, arr) => s + (arr[idx] ?? 0), 0);
    if (Math.abs(suma - 1) > 0.001) {
      console.warn(`[calcBenchmark] fondo #${idx}: pesos renormalizados suman ${suma.toFixed(6)}, esperado 1,0 ± 0,001`);
    }
  }

  // Unión de tickers
  const todosLosTickers = new Set([
    ...Object.keys(propioByTicker),
    ...Object.keys(fondosByTicker),
  ]);

  const filas: FilaBenchmark[] = [];
  for (const ticker of todosLosTickers) {
    const propioUsd = propioByTicker[ticker] ?? null;
    const propioFrac = propioUsd !== null ? propioUsd / (totalPropio || 1) : null;
    const pcts = fondosByTicker[ticker] ?? [];
    // F9.143 — promedio y desviación ponderados con los MISMOS pesos. Sin `pesos`, `pesosNorm`
    // es 1/n para todos y las dos fórmulas colapsan exactamente en las de antes.
    const avg = pcts.reduce((s, x, i) => s + x * pesosNorm[i], 0);
    const min = pcts.length > 0 ? Math.min(...pcts) : 0;
    const max = pcts.length > 0 ? Math.max(...pcts) : 0;
    const std = pcts.length > 1
      ? Math.sqrt(pcts.reduce((s, x, i) => s + pesosNorm[i] * (x - avg) ** 2, 0))
      : 0;
    filas.push({
      ticker,
      propioUsd,
      propioFrac,
      fondosAvgFrac: avg,
      fondosMinFrac: min,
      fondosMaxFrac: max,
      fondosStdFrac: std,
      divergencia: Math.abs((propioFrac ?? 0) - avg),
    });
  }

  filas.sort((a, b) => b.divergencia - a.divergencia);

  // F9.122 — guardarraíl de unidad: una fracción > 1 sería un fondo con más del 100% en un solo
  // papel. Es imposible, así que si aparece es que volvió a colarse un peso en escala 0–100.
  for (const f of filas) {
    if (f.fondosAvgFrac > 1) {
      console.warn(`[calcBenchmark] ${f.ticker}: fondosAvgFrac=${f.fondosAvgFrac} > 1 — peso en escala equivocada`);
    }
  }

  const soloenFondos = filas
    .filter(f => f.propioFrac === null && f.fondosAvgFrac > 0)
    .sort((a, b) => b.fondosAvgFrac - a.fondosAvgFrac)
    .slice(0, 10)
    .map(f => ({ ticker: f.ticker, avgFrac: f.fondosAvgFrac }));

  const soloEnPropio = filas
    .filter(f => f.fondosAvgFrac === 0 && f.propioFrac !== null)
    .map(f => f.ticker);

  // La cobertura promedio se deja SIN ponderar a propósito: describe la calidad del parseo del
  // set de fondos ("cuánto de la cartera media pudimos identificar"), no una magnitud de dinero.
  // Ponderarla haría que el número lo dominara Superfondo y dejaría de decir lo que dice.
  const coberturaProm = enBase.length > 0
    ? enBase.reduce((s, c) => s + c.baseFondo / 100, 0) / enBase.length
    : 0;
  const base: BaseComparable = {
    propioUsd: totalPropio,
    propioPctDeCartera: totalInvertible > 0 ? totalPropio / totalInvertible : 0,
    fondoCoberturaProm: coberturaProm,
    excluidoFondoProm: enBase.length > 0 ? 1 - coberturaProm : 0,
    fondosEnBase: enBase.length,
    fondosSalteados,
    ponderado: ponderado && !sinMasa,
    patrimonioBaseArs,
  };

  return { filas, soloenFondos, soloEnPropio, base };
}

// F9.122.1 — GEMELO. La copia canónica es functions/src/cafciHtml.ts; src/datos/patrimonioCafci.ts la
// espeja. Divergir rompe el mapeo en silencio: el seed escribe claves con una normalización y el
// servidor las busca con otra, y el resultado es "el fondo no tiene el papel" en vez de un error.
// Cada regla responde a una forma observada en CAFCI (auditoría F9.122 §0, 2026-08):
//   "YPF - D"                  — sufijo de clase: la clase no cambia el emisor
//   "Cedear Vista Oil Gas"     — '&' ausente respecto del patrón "Vista Oil & Gas"
//   "Grupo Fciero Galicia - B" — puntuación irregular entre fuentes
export function normalizarEspecie(s: string): string {
  return s
    .trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(s\.?a\.?u?\.?|s\.?r\.?l\.?)\b/g, ' ')  // razón social, no identifica al emisor
    .replace(/[^a-z0-9]+/g, ' ')                        // & . - , ( ) → espacio
    .trim()
    .replace(/\s+[a-z]$/, '')                           // sufijo de clase de UNA letra al final
    .replace(/\s+/g, ' ')
    .trim();
}

// ── F9.125 — cobertura del espejo cliente del gemelo ──────────────────────────
// La tabla es la MISMA que la de functions/src/cafciHtml.test.ts, a propósito. El gemelo solo
// sirve si las dos copias se comportan igual, y hasta acá los tests cubrían únicamente la del
// servidor: si alguien editaba esta copia, nada fallaba. Ahora falla el panel de tests de
// Patrimonio. Si tocás una tabla, tocá la otra — es el punto entero del par.
const CASOS_GEMELO: Array<[string, string]> = [
  ['YPF - D', 'ypf'],
  ['Grupo Fciero Galicia - B', 'grupo fciero galicia'],
  ['Ternium - A', 'ternium'],
  ['Transp Gas del Norte C', 'transp gas del norte'],
  ['Vista Oil & Gas', 'vista oil gas'],
  ['Pampa Energía S.A.', 'pampa energia'],
  ['Grupo Supervielle CB', 'grupo supervielle cb'],
  ['Lecap S31G6', 'lecap s31g6'],
  ['Aluar', 'aluar'],
  ['  BYMA  ', 'byma'],
];

export function testsGemeloNormalizarEspecie(): Array<{ nombre: string; ok: boolean; detalle: string }> {
  const fallas = CASOS_GEMELO
    .map(([entrada, esperado]) => ({ entrada, esperado, obtenido: normalizarEspecie(entrada) }))
    .filter(r => r.obtenido !== r.esperado);

  // El prefijo "Cedear " lo saca el parser antes de normalizar (F9.122.1 §A.2); se replica acá
  // porque es el caso que hace que VIST resuelva en vez de quedar como CEDEAR anónimo.
  const cedear = normalizarEspecie('Cedear Vista Oil Gas'.replace(/^cedear\s*/i, ''));

  // Idempotencia: el seed escribe la clave ya normalizada y la relectura la vuelve a normalizar.
  // Si no fuera idempotente, la segunda pasada buscaría una clave que nadie escribió.
  const noIdempotentes = CASOS_GEMELO
    .map(([entrada]) => normalizarEspecie(entrada))
    .filter(k => normalizarEspecie(k) !== k);

  return [
    {
      nombre: 'Gemelo normalizarEspecie — tabla de casos (espejo cliente)',
      ok: fallas.length === 0,
      detalle: fallas.length === 0
        ? `${CASOS_GEMELO.length}/${CASOS_GEMELO.length} casos ✓`
        : fallas.map(f => `"${f.entrada}" → "${f.obtenido}" (esperado "${f.esperado}")`).join(' · '),
    },
    {
      nombre: 'Gemelo normalizarEspecie — CEDEAR sin prefijo → subyacente',
      ok: cedear === 'vista oil gas',
      detalle: cedear === 'vista oil gas' ? '"Cedear Vista Oil Gas" → "vista oil gas" ✓' : `obtenido "${cedear}"`,
    },
    {
      nombre: 'Gemelo normalizarEspecie — idempotencia',
      ok: noIdempotentes.length === 0,
      detalle: noIdempotentes.length === 0
        ? 'normalizar dos veces da lo mismo ✓'
        : `no idempotente sobre: ${noIdempotentes.join(', ')}`,
    },
  ];
}
