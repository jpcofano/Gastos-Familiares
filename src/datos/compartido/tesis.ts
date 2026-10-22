// F9.196 H5 (base §6) — tesis por acción: el Chat 2 propone los datos, la app hace las cuentas con el
// precio del día y Juan puede editar. Funciones PURAS: las usan la importación (functions/), el cron
// de señales (functions/) y la ficha (src/).
//
// ⛔ CÓDIGO COMPARTIDO (F9.196 H2): idéntico byte a byte en src/datos/compartido/ y
// functions/src/compartido/. Se edita el de src/datos/ y se copia; `scripts/verificarCopiasIdenticas.ts`
// falla si difieren. Sin imports fuera de esta carpeta.
//
// Contrato: el chat trae DATOS con fuente y fecha (null si no hay); la app calcula P/E, potencial,
// gatillos cumplidos y días al evento. Sin precio objetivo propio: solo el consenso publicado.

export type Gatillo = {
  texto: string;
  metrica: string;
  operador: '>=' | '<=';
  umbral: number;
  valorActual: number | null;
};

/**
 * F9.196.1 §2.a — cuántas unidades locales equivalen a una del subyacente (la que cubre el consenso):
 * - CEDEAR: N CEDEARs = 1 acción del exterior (`tipo: 'cedear'`);
 * - acción local con ADR: 1 ADR = N acciones locales (`tipo: 'adr'`).
 * En los dos casos, precio del subyacente = precio local × N. Lo trae el Chat 2 CON FUENTE y Juan lo
 * puede editar. No hay tabla fija en el código: los ratios cambian y un número viejo da un P/E falso.
 */
export type RatioSubyacente = { valor: number; tipo: 'cedear' | 'adr'; fuente: string; fecha: string | null };

export type Tesis = {
  /** null = el chat no trajo una moneda válida: P/E y potencial no se calculan (motivo `sin_moneda`). */
  monedaFundamentals: 'USD' | 'ARS' | null;
  epsGuiaMin: number | null;
  epsGuiaMax: number | null;
  epsPeriodo: string | null;
  precioObjetivoConsenso: number | null;
  analistas: number | null;
  recomendacionConsenso: string | null;
  gatillos: Gatillo[];
  proximoEvento: { fecha: string | null; tipo: 'balance' | 'otro'; texto: string };
  cortoPlazo: string;
  medianoPlazo: string;
  riesgoPrincipal: string;
  fuentes: Array<{ texto: string; fecha: string | null }>;
  fechaDatos: string | null;
  /** §2.a — null si el consenso es de la acción local (o no hay dato). */
  ratioSubyacente: RatioSubyacente | null;
};

export const CAMPOS_TESIS = [
  'monedaFundamentals', 'epsGuiaMin', 'epsGuiaMax', 'epsPeriodo', 'precioObjetivoConsenso', 'analistas',
  'recomendacionConsenso', 'gatillos', 'proximoEvento', 'cortoPlazo', 'medianoPlazo', 'riesgoPrincipal',
  'fuentes', 'fechaDatos', 'ratioSubyacente',
] as const;
export type CampoTesis = (typeof CAMPOS_TESIS)[number];

// Un número que el chat mandó como texto ("2.1") se acepta; uno con coma o separadores, no (ambiguo).
const numONull = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x
  : typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x.trim()) ? Number(x.trim()) : null);
/** Como numONull, pero avisa cuando había algo que no se pudo leer como número. */
const numConAviso = (x: unknown, campo: string, avisos: string[]): number | null => {
  const n = numONull(x);
  if (n === null && x !== null && x !== undefined) avisos.push(`${campo}: «${String(x).slice(0, 30)}» no es un número, queda sin dato`);
  return n;
};
const txtONull = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null);
const fechaONull = (x: unknown): string | null => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);

/**
 * Normaliza la `tesis` que trae el chat. Tolerante: lo que no tiene la forma esperada queda en null
 * (nunca se inventa) y se informa en `avisos`. Sin `tesis` (informes viejos) devuelve null.
 */
export function normalizarTesis(x: unknown): { tesis: Tesis | null; avisos: string[] } {
  if (x === undefined || x === null) return { tesis: null, avisos: [] };
  if (typeof x !== 'object' || Array.isArray(x)) return { tesis: null, avisos: ['tesis: no es un objeto'] };
  const o = x as Record<string, unknown>;
  const avisos: string[] = [];
  const m = typeof o.monedaFundamentals === 'string' ? o.monedaFundamentals.trim().toUpperCase() : '';
  const moneda = m === 'ARS' ? 'ARS' : m === 'USD' ? 'USD' : null;
  if (!moneda) avisos.push(`monedaFundamentals inválida («${String(o.monedaFundamentals)}»): sin moneda no se calculan P/E ni potencial`);
  const gatillos: Gatillo[] = [];
  for (const g of Array.isArray(o.gatillos) ? o.gatillos : []) {
    const gg = (g ?? {}) as Record<string, unknown>;
    const umbral = numONull(gg.umbral);
    const op = gg.operador === '>=' || gg.operador === '<=' ? gg.operador : null;
    if (!txtONull(gg.texto) || !op || umbral === null) { avisos.push(`gatillo descartado (forma inválida): ${JSON.stringify(g).slice(0, 80)}`); continue; }
    gatillos.push({ texto: txtONull(gg.texto)!, metrica: txtONull(gg.metrica) ?? '', operador: op, umbral, valorActual: numConAviso(gg.valorActual, `gatillo «${txtONull(gg.texto)}»`, avisos) });
  }
  const repetidas = new Set<string>();
  for (const k of gatillos.map(claveGatillo)) { if (repetidas.has(k)) avisos.push(`gatillo repetido: ${k}`); repetidas.add(k); }
  // §2.a — ratio con el subyacente: valor > 0, tipo válido y fuente; si no, null con aviso.
  let ratioSubyacente: RatioSubyacente | null = null;
  if (o.ratioSubyacente !== undefined && o.ratioSubyacente !== null) {
    const r = (typeof o.ratioSubyacente === 'object' ? o.ratioSubyacente : {}) as Record<string, unknown>;
    const valor = numONull(r.valor);
    const tipo = typeof r.tipo === 'string' ? r.tipo.trim().toLowerCase() : '';
    if (valor !== null && valor > 0 && (tipo === 'cedear' || tipo === 'adr')) {
      ratioSubyacente = { valor, tipo, fuente: txtONull(r.fuente) ?? '', fecha: fechaONull(r.fecha) };
      if (!ratioSubyacente.fuente) avisos.push('ratioSubyacente sin fuente');
    } else {
      avisos.push(`ratioSubyacente inválido (${JSON.stringify(o.ratioSubyacente).slice(0, 60)}): queda sin ratio`);
    }
  }
  const ev = (o.proximoEvento ?? {}) as Record<string, unknown>;
  const fuentes = (Array.isArray(o.fuentes) ? o.fuentes : [])
    .map(f => (typeof f === 'string' ? { texto: f, fecha: null } : { texto: txtONull((f as Record<string, unknown>)?.texto) ?? '', fecha: fechaONull((f as Record<string, unknown>)?.fecha) }))
    .filter(f => f.texto);
  return {
    tesis: {
      monedaFundamentals: moneda,
      epsGuiaMin: numConAviso(o.epsGuiaMin, 'epsGuiaMin', avisos), epsGuiaMax: numConAviso(o.epsGuiaMax, 'epsGuiaMax', avisos),
      epsPeriodo: txtONull(o.epsPeriodo) ?? (typeof o.epsPeriodo === 'number' ? String(o.epsPeriodo) : null),
      precioObjetivoConsenso: numConAviso(o.precioObjetivoConsenso, 'precioObjetivoConsenso', avisos), analistas: numONull(o.analistas),
      recomendacionConsenso: txtONull(o.recomendacionConsenso),
      gatillos,
      proximoEvento: { fecha: fechaONull(ev.fecha), tipo: typeof ev.tipo === 'string' && ev.tipo.trim().toLowerCase() === 'balance' ? 'balance' : 'otro', texto: txtONull(ev.texto) ?? '' },
      cortoPlazo: txtONull(o.cortoPlazo) ?? '', medianoPlazo: txtONull(o.medianoPlazo) ?? '', riesgoPrincipal: txtONull(o.riesgoPrincipal) ?? '',
      fuentes, fechaDatos: fechaONull(o.fechaDatos),
      ratioSubyacente,
    },
    avisos,
  };
}

/** Documento `tesisPosicion/{ticker}`. */
export type DocTesis = {
  ticker: string;
  /** Lo vigente: lo del chat, salvo los campos que Juan editó. */
  tesis: Tesis;
  /** Campos que Juan editó: la importación siguiente no los pisa. */
  editadoPorJuan: Partial<Record<CampoTesis, true>>;
  /** Campo editado por Juan donde el chat trajo OTRO valor: se muestra "dato del chat distinto: X". */
  distintoDelChat: Partial<Record<CampoTesis, unknown>>;
  /**
   * Gatillos: la edición es POR GATILLO (clave de `claveGatillo` → `valorActual` que puso Juan). Así
   * corregir un valor no congela la lista: el chat sigue trayendo textos, umbrales y los demás valores.
   */
  gatillosEditados?: Record<string, number | null>;
  /** Gatillo editado por Juan donde el chat trajo otro `valorActual`. */
  gatillosDistintos?: Record<string, number | null>;
};

/** JSON con las claves ordenadas: Firestore puede devolver los mapas con otro orden de claves. */
const estable = (x: unknown): string => JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, (v as Record<string, unknown>)[k]])) : v));
const igual = (a: unknown, b: unknown) => estable(a) === estable(b);

/**
 * La importación del Chat 2 sobre lo que ya había. Un campo con `editadoPorJuan` NO se pisa: si el
 * chat trae otro valor, se guarda en `distintoDelChat` para que Juan decida.
 */
export function fusionarTesis(previo: DocTesis | null, ticker: string, delChat: Tesis): DocTesis {
  const editado = previo?.editadoPorJuan ?? {};
  const tesis = { ...delChat } as Record<CampoTesis, unknown>;
  const distintoDelChat: Partial<Record<CampoTesis, unknown>> = {};
  for (const c of CAMPOS_TESIS) {
    if (!editado[c] || !previo) continue;
    const deJuan = (previo.tesis as Record<CampoTesis, unknown>)[c];
    tesis[c] = deJuan;
    if (!igual(deJuan, (delChat as Record<CampoTesis, unknown>)[c])) distintoDelChat[c] = (delChat as Record<CampoTesis, unknown>)[c];
  }
  // Gatillos editados de a uno: el valor de Juan se mantiene en el gatillo de igual clave; un gatillo
  // que el chat ya no trae se va (y su edición con él).
  const gatillosEditados: Record<string, number | null> = {};
  const gatillosDistintos: Record<string, number | null> = {};
  if (!editado.gatillos) {
    const ge = previo?.gatillosEditados ?? {};
    tesis.gatillos = delChat.gatillos.map(g => {
      const k = claveGatillo(g);
      if (!(k in ge)) return g;
      gatillosEditados[k] = ge[k];
      if (ge[k] !== g.valorActual) gatillosDistintos[k] = g.valorActual;
      return { ...g, valorActual: ge[k] };
    });
  }
  return { ticker, tesis: tesis as unknown as Tesis, editadoPorJuan: { ...editado }, distintoDelChat, gatillosEditados, gatillosDistintos };
}

/** Juan corrige el `valorActual` de UN gatillo: solo ese queda editado. */
export function editarValorGatillo(doc: DocTesis, clave: string, valor: number | null): DocTesis {
  const gatillosDistintos = { ...(doc.gatillosDistintos ?? {}) };
  delete gatillosDistintos[clave];
  return {
    ...doc,
    tesis: { ...doc.tesis, gatillos: doc.tesis.gatillos.map(g => (claveGatillo(g) === clave ? { ...g, valorActual: valor } : g)) },
    gatillosEditados: { ...(doc.gatillosEditados ?? {}), [clave]: valor },
    gatillosDistintos,
  };
}

/** "Usar el dato del chat": el campo vuelve a ser del chat (deja de estar editado por Juan). */
export function aceptarDatoDelChat(doc: DocTesis, campo: CampoTesis): DocTesis {
  if (!(campo in (doc.distintoDelChat ?? {}))) return doc;
  const editadoPorJuan = { ...doc.editadoPorJuan };
  delete editadoPorJuan[campo];
  const distintoDelChat = { ...doc.distintoDelChat };
  const valor = distintoDelChat[campo];
  delete distintoDelChat[campo];
  return { ...doc, tesis: { ...doc.tesis, [campo]: valor }, editadoPorJuan, distintoDelChat };
}

/** Lo mismo para un gatillo. */
export function aceptarGatilloDelChat(doc: DocTesis, clave: string): DocTesis {
  const d = doc.gatillosDistintos ?? {};
  if (!(clave in d)) return doc;
  const gatillosEditados = { ...(doc.gatillosEditados ?? {}) };
  delete gatillosEditados[clave];
  const gatillosDistintos = { ...d };
  delete gatillosDistintos[clave];
  return {
    ...doc,
    tesis: { ...doc.tesis, gatillos: doc.tesis.gatillos.map(g => (claveGatillo(g) === clave ? { ...g, valorActual: d[clave] } : g)) },
    gatillosEditados, gatillosDistintos,
  };
}

/** Una edición de Juan: cambia el campo y lo marca `editadoPorJuan` (y ya no está "distinto"). */
export function editarTesis<C extends CampoTesis>(doc: DocTesis, campo: C, valor: Tesis[C]): DocTesis {
  const distintoDelChat = { ...doc.distintoDelChat };
  delete distintoDelChat[campo];
  return { ...doc, tesis: { ...doc.tesis, [campo]: valor }, editadoPorJuan: { ...doc.editadoPorJuan, [campo]: true }, distintoDelChat };
}

// ── Cálculos de la app con el precio del día ─────────────────────────────────

export type CalculoTesis = {
  /** Precio ÷ promedio(EPS mín, máx), en la moneda de los fundamentals. */
  pe: number | null;
  /** Precio objetivo de consenso ÷ precio − 1. */
  potencial: number | null;
  /** Por qué no se calculó P/E (o ninguno de los dos), cuando no se pudo. */
  motivo: string | null;
  /** §2.b — por qué no se calculó el potencial cuando el P/E sí (p. ej. `consenso_fuera_de_escala`). */
  motivoPotencial?: string | null;
  /** §2.a — el ratio con el subyacente que se usó, para que la ficha lo diga. */
  ratioUsado?: RatioSubyacente | null;
  gatillos: Array<Gatillo & { cumplido: boolean | null }>;
  diasAlEvento: number | null;
  /** El precio usado, ya en la moneda de los fundamentals. */
  precioEnMoneda: number | null;
};

/**
 * §2.b — controles de valores absurdos. El consenso entre 0,2 y 5 veces el precio deja pasar
 * cualquier potencial publicado razonable (−80% a +400%) y frena el error de escala de un ADR o un
 * CEDEAR sin ratio (≈ 10 veces). Un P/E de más de 300 no es informativo (y suele ser un EPS mal leído).
 */
export const CONSENSO_SOBRE_PRECIO: [number, number] = [0.2, 5];
export const PE_MAXIMO = 300;

const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);

/**
 * P/E, potencial, gatillos y días al evento. El precio se pasa a la moneda de los fundamentals con
 * el MEP de la cartera viva si hace falta (sin MEP: null, no se inventa).
 * ⚠ CEDEARs: el precio en pesos es del certificado y los fundamentals son del subyacente; sin el
 * ratio de conversión el P/E y el potencial no se calculan (motivo `cedear_sin_ratio`).
 */
export function calcularTesis(
  t: Tesis,
  precio: { valor: number; moneda: 'ARS' | 'USD' } | null,
  opciones: { tc: number | null; hoy: string; esCedear?: boolean },
): CalculoTesis {
  let precioEnMoneda: number | null = null;
  let motivo: string | null = null;
  // §2.a — con ratio, el precio del subyacente = precio local × N; después, la moneda como siempre.
  const ratio = t.ratioSubyacente ?? null;
  const base = precio && ratio ? precio.valor * ratio.valor : precio?.valor ?? 0;
  if (!precio || !(precio.valor > 0)) motivo = 'sin_precio';
  else if (opciones.esCedear && !ratio) motivo = 'cedear_sin_ratio';
  else if (t.monedaFundamentals === null) motivo = 'sin_moneda';
  else if (precio.moneda === t.monedaFundamentals) precioEnMoneda = base;
  else if (opciones.tc && opciones.tc > 0) precioEnMoneda = precio.moneda === 'ARS' ? base / opciones.tc : base * opciones.tc;
  else motivo = 'sin_tc';

  const eps = t.epsGuiaMin !== null && t.epsGuiaMax !== null ? (t.epsGuiaMin + t.epsGuiaMax) / 2
    : t.epsGuiaMin ?? t.epsGuiaMax;
  let pe = precioEnMoneda !== null && eps !== null && eps > 0 && (t.epsGuiaMin ?? 1) > 0 && (t.epsGuiaMax ?? 1) > 0 ? precioEnMoneda / eps : null;
  // EPS negativo en un extremo del rango: el promedio no es un P/E con sentido.
  if (motivo === null && precioEnMoneda !== null) {
    if (eps === null) motivo = 'sin_eps';
    else if (eps <= 0 || (t.epsGuiaMin ?? 1) <= 0 || (t.epsGuiaMax ?? 1) <= 0) motivo = 'eps_no_positivo';
  }
  if (pe !== null && !(pe > 0 && pe <= PE_MAXIMO)) { pe = null; motivo = 'pe_fuera_de_escala'; }
  let potencial = precioEnMoneda !== null && precioEnMoneda > 0 && t.precioObjetivoConsenso !== null ? t.precioObjetivoConsenso / precioEnMoneda - 1 : null;
  let motivoPotencial: string | null = null;
  if (potencial !== null) {
    const veces = potencial + 1;
    if (veces < CONSENSO_SOBRE_PRECIO[0] || veces > CONSENSO_SOBRE_PRECIO[1]) { potencial = null; motivoPotencial = 'consenso_fuera_de_escala'; }
  }
  const gatillos = t.gatillos.map(g => ({
    ...g,
    cumplido: g.valorActual === null ? null : g.operador === '>=' ? g.valorActual >= g.umbral : g.valorActual <= g.umbral,
  }));
  const diasAlEvento = t.proximoEvento.fecha ? dias(opciones.hoy, t.proximoEvento.fecha) : null;
  return { pe, potencial, motivo, motivoPotencial, ratioUsado: ratio, gatillos, diasAlEvento, precioEnMoneda };
}

// ── Señales de §5 que dependen de la tesis ───────────────────────────────────

export type SenalTesis = { id: 'evento_proximo' | 'gatillo_tesis'; texto: string; desde: string; nivel: 'info' | 'atencion' };
/**
 * Estado de un gatillo entre lecturas. `cumplido` = el último estado CONOCIDO (una lectura sin dato
 * no lo pisa: cumplido → sin dato → no cumplido es un cambio). `desde` = desde cuándo está en ese
 * estado; `cambio` = ese estado salió de una TRANSICIÓN real (cumplido ↔ no cumplido), no de la
 * primera vez que se vio.
 */
export type EstadoGatillo = { clave: string; cumplido: boolean | null; desde: string; cambio: boolean };

export const DIAS_EVENTO_PROXIMO = 7;
/** Una señal de gatillo se muestra durante esta cantidad de días desde que cambió. */
export const DIAS_SENAL_GATILLO = 10;

/** Incluye el texto: dos gatillos sin `metrica` con el mismo umbral no se pisan entre sí. */
export const claveGatillo = (g: Pick<Gatillo, 'texto' | 'metrica' | 'operador' | 'umbral'>) => `${g.metrica}|${g.operador}|${g.umbral}|${g.texto}`;

/**
 * - "Evento próximo": evento a 7 días o menos (y no pasado), nivel info, `desde` = fecha − 7 días.
 * - "Gatillo de tesis": un gatillo que pasa a cumplirse o deja de cumplirse, nivel atención, con
 *   `desde` = el día del cambio; visible `DIAS_SENAL_GATILLO` días. Un gatillo nuevo, o uno que pasa
 *   de/a "sin dato", no es un cambio: no hay contra qué comparar.
 */
export function senalesDeTesis(
  calc: CalculoTesis,
  t: Tesis,
  previo: EstadoGatillo[],
  hoy: string,
): { senales: SenalTesis[]; estado: EstadoGatillo[] } {
  const senales: SenalTesis[] = [];
  if (calc.diasAlEvento !== null && calc.diasAlEvento >= 0 && calc.diasAlEvento <= DIAS_EVENTO_PROXIMO && t.proximoEvento.fecha) {
    const desde = new Date(Date.parse(`${t.proximoEvento.fecha}T12:00:00Z`) - DIAS_EVENTO_PROXIMO * 86_400_000).toISOString().slice(0, 10);
    senales.push({
      id: 'evento_proximo', nivel: 'info', desde: desde < hoy ? desde : hoy,
      texto: `${t.proximoEvento.tipo === 'balance' ? 'Balance' : t.proximoEvento.texto || 'Evento'} ${calc.diasAlEvento === 0 ? 'hoy' : `en ${calc.diasAlEvento} días`}`,
    });
  }
  const prev = new Map(previo.map(e => [e.clave, e]));
  const estado: EstadoGatillo[] = [];
  const vistas = new Map<string, number>();
  for (const g of calc.gatillos) {
    // Un gatillo repetido (misma clave) lleva el número de aparición: cada uno guarda su estado.
    const base = claveGatillo(g);
    const n = (vistas.get(base) ?? 0) + 1;
    vistas.set(base, n);
    const clave = n === 1 ? base : `${base}#${n}`;
    const antes = prev.get(clave);
    let e: EstadoGatillo;
    if (!antes) e = { clave, cumplido: g.cumplido, desde: hoy, cambio: false };
    else if (g.cumplido === null || antes.cumplido === g.cumplido) e = antes;      // sin dato hoy: queda lo último conocido
    else if (antes.cumplido === null) e = { clave, cumplido: g.cumplido, desde: hoy, cambio: false };  // primer dato
    else e = { clave, cumplido: g.cumplido, desde: hoy, cambio: true };
    estado.push(e);
    if (e.cambio && e.cumplido !== null && dias(e.desde, hoy) <= DIAS_SENAL_GATILLO) {
      senales.push({ id: 'gatillo_tesis', nivel: 'atencion', desde: e.desde, texto: `Gatillo de tesis ${e.cumplido ? 'cumplido' : 'dejó de cumplirse'}: ${g.texto}` });
    }
  }
  return { senales, estado };
}
