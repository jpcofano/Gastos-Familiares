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

export type Tesis = {
  monedaFundamentals: 'USD' | 'ARS';
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
};

export const CAMPOS_TESIS = [
  'monedaFundamentals', 'epsGuiaMin', 'epsGuiaMax', 'epsPeriodo', 'precioObjetivoConsenso', 'analistas',
  'recomendacionConsenso', 'gatillos', 'proximoEvento', 'cortoPlazo', 'medianoPlazo', 'riesgoPrincipal',
  'fuentes', 'fechaDatos',
] as const;
export type CampoTesis = (typeof CAMPOS_TESIS)[number];

const numONull = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
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
  const moneda = o.monedaFundamentals === 'ARS' ? 'ARS' : o.monedaFundamentals === 'USD' ? 'USD' : null;
  if (!moneda) avisos.push(`monedaFundamentals inválida («${String(o.monedaFundamentals)}»): se toma USD`);
  const gatillos: Gatillo[] = [];
  for (const g of Array.isArray(o.gatillos) ? o.gatillos : []) {
    const gg = (g ?? {}) as Record<string, unknown>;
    const umbral = numONull(gg.umbral);
    const op = gg.operador === '>=' || gg.operador === '<=' ? gg.operador : null;
    if (!txtONull(gg.texto) || !op || umbral === null) { avisos.push(`gatillo descartado (forma inválida): ${JSON.stringify(g).slice(0, 80)}`); continue; }
    gatillos.push({ texto: txtONull(gg.texto)!, metrica: txtONull(gg.metrica) ?? '', operador: op, umbral, valorActual: numONull(gg.valorActual) });
  }
  const ev = (o.proximoEvento ?? {}) as Record<string, unknown>;
  const fuentes = (Array.isArray(o.fuentes) ? o.fuentes : [])
    .map(f => (typeof f === 'string' ? { texto: f, fecha: null } : { texto: txtONull((f as Record<string, unknown>)?.texto) ?? '', fecha: fechaONull((f as Record<string, unknown>)?.fecha) }))
    .filter(f => f.texto);
  return {
    tesis: {
      monedaFundamentals: moneda ?? 'USD',
      epsGuiaMin: numONull(o.epsGuiaMin), epsGuiaMax: numONull(o.epsGuiaMax),
      epsPeriodo: txtONull(o.epsPeriodo) ?? (typeof o.epsPeriodo === 'number' ? String(o.epsPeriodo) : null),
      precioObjetivoConsenso: numONull(o.precioObjetivoConsenso), analistas: numONull(o.analistas),
      recomendacionConsenso: txtONull(o.recomendacionConsenso),
      gatillos,
      proximoEvento: { fecha: fechaONull(ev.fecha), tipo: ev.tipo === 'balance' ? 'balance' : 'otro', texto: txtONull(ev.texto) ?? '' },
      cortoPlazo: txtONull(o.cortoPlazo) ?? '', medianoPlazo: txtONull(o.medianoPlazo) ?? '', riesgoPrincipal: txtONull(o.riesgoPrincipal) ?? '',
      fuentes, fechaDatos: fechaONull(o.fechaDatos),
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
};

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

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
  return { ticker, tesis: tesis as unknown as Tesis, editadoPorJuan: { ...editado }, distintoDelChat };
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
  /** Por qué no se calculó P/E o potencial, cuando no se pudo. */
  motivo: string | null;
  gatillos: Array<Gatillo & { cumplido: boolean | null }>;
  diasAlEvento: number | null;
  /** El precio usado, ya en la moneda de los fundamentals. */
  precioEnMoneda: number | null;
};

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
  if (!precio || !(precio.valor > 0)) motivo = 'sin_precio';
  else if (opciones.esCedear) motivo = 'cedear_sin_ratio';
  else if (precio.moneda === t.monedaFundamentals) precioEnMoneda = precio.valor;
  else if (opciones.tc && opciones.tc > 0) precioEnMoneda = precio.moneda === 'ARS' ? precio.valor / opciones.tc : precio.valor * opciones.tc;
  else motivo = 'sin_tc';

  const eps = t.epsGuiaMin !== null && t.epsGuiaMax !== null ? (t.epsGuiaMin + t.epsGuiaMax) / 2
    : t.epsGuiaMin ?? t.epsGuiaMax;
  const pe = precioEnMoneda !== null && eps !== null && eps > 0 ? precioEnMoneda / eps : null;
  const potencial = precioEnMoneda !== null && precioEnMoneda > 0 && t.precioObjetivoConsenso !== null ? t.precioObjetivoConsenso / precioEnMoneda - 1 : null;
  const gatillos = t.gatillos.map(g => ({
    ...g,
    cumplido: g.valorActual === null ? null : g.operador === '>=' ? g.valorActual >= g.umbral : g.valorActual <= g.umbral,
  }));
  const diasAlEvento = t.proximoEvento.fecha ? dias(opciones.hoy, t.proximoEvento.fecha) : null;
  return { pe, potencial, motivo, gatillos, diasAlEvento, precioEnMoneda };
}

// ── Señales de §5 que dependen de la tesis ───────────────────────────────────

export type SenalTesis = { id: 'evento_proximo' | 'gatillo_tesis'; texto: string; desde: string; nivel: 'info' | 'atencion' };
/**
 * Estado de un gatillo entre lecturas. `desde` = desde cuándo está en ese estado; `cambio` = ese
 * estado salió de una TRANSICIÓN real (cumplido ↔ no cumplido), no de la primera vez que se vio.
 */
export type EstadoGatillo = { clave: string; cumplido: boolean | null; desde: string; cambio: boolean };

export const DIAS_EVENTO_PROXIMO = 7;
/** Una señal de gatillo se muestra durante esta cantidad de días desde que cambió. */
export const DIAS_SENAL_GATILLO = 10;

export const claveGatillo = (g: Pick<Gatillo, 'metrica' | 'operador' | 'umbral'>) => `${g.metrica}|${g.operador}|${g.umbral}`;

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
  for (const g of calc.gatillos) {
    const clave = claveGatillo(g);
    const antes = prev.get(clave);
    let e: EstadoGatillo;
    if (!antes) e = { clave, cumplido: g.cumplido, desde: hoy, cambio: false };
    else if (antes.cumplido === g.cumplido) e = antes;
    else if (antes.cumplido === null || g.cumplido === null) e = { clave, cumplido: g.cumplido, desde: hoy, cambio: false };
    else e = { clave, cumplido: g.cumplido, desde: hoy, cambio: true };
    estado.push(e);
    if (e.cambio && e.cumplido !== null && dias(e.desde, hoy) <= DIAS_SENAL_GATILLO) {
      senales.push({ id: 'gatillo_tesis', nivel: 'atencion', desde: e.desde, texto: `Gatillo de tesis ${e.cumplido ? 'cumplido' : 'dejó de cumplirse'}: ${g.texto}` });
    }
  }
  return { senales, estado };
}
