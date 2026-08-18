// F9.141 — motor de serie de precios e indicadores técnicos por posición.
//
// Vive acá y no en src/datos/ porque el cron es quien calcula, y functions/ tiene
// `rootDir: "src"` propio: no puede importar de src/. src/datos/patrimonioPrecios.ts
// solo LEE las colecciones; no reimplementa nada de este archivo.
//
// Contrato completo y las mediciones que lo fundamentan:
// docs/patrimonio/CLAUDE-PATRIMONIO.md → "Precios y serie diaria (F9.141)".

export type PosicionTipo = 'accion' | 'bono' | 'on' | 'cedear' | 'fci' | 'cripto' | 'cash';
export type PaisRiesgo = 'AR' | 'global';

export type PanelLive = 'arg_stocks' | 'arg_cedears' | 'arg_bonds' | 'arg_corp' | 'usa_stocks';
export type PanelHistorico = 'stocks' | 'cedears' | 'bonds' | 'usa_stocks';
export type PanelSpec = { live: PanelLive; historical: PanelHistorico | null };

export type EstadoSerie = 'limpia' | 'ajustada' | 'sospechosa' | 'sin_serie';
export type Semaforo = 'verde' | 'amarillo' | 'rojo' | 'sin_datos';

export type PuntoSerie = {
  f: string;
  o: number | null;
  h: number | null;
  l: number | null;
  c: number;
  v: number | null;
  /** F9.148 — dato probadamente malo de la fuente. Se conserva y se excluye de todo cálculo. */
  malo?: true;
};

export type SplitAplicado = {
  fecha: string;
  razon: number;
  cocienteCrudo: number | null;
  residuo: number | null;
  origen: 'tabla' | 'cantidad';
};

export type SaltoDetectado = {
  fecha: string;
  cAnterior: number;
  cPosterior: number;
  retornoCrudo: number;
  cocienteCrudo: number;
  razonSugerida: number | null;
  residuo: number | null;
};

const BASE = 'https://data912.com';

// ── Routing ──────────────────────────────────────────────────────────────────
// F9.141 — el panel se determina por `tipo`, NUNCA buscando el ticker entre paneles.
// BTC (cripto) existe como ticker listado en usa_stocks: buscar por nombre devuelve
// un precio equivocado, que es peor que no devolver nada.
export const PANEL_POR_TIPO: Record<PosicionTipo, PanelSpec | null> = {
  accion: { live: 'arg_stocks',  historical: 'stocks'  },  // AR; el caso global lo abre panelesPara()
  cedear: { live: 'arg_cedears', historical: 'cedears' },
  bono:   { live: 'arg_bonds',   historical: 'bonds'   },
  on:     { live: 'arg_corp',    historical: null      },  // /historical/corp/ da 404 (medido)
  fci:    null,   // CAFCI, ya integrado (F9.104)
  cripto: null,   // fuera de alcance de F9.141
  cash:   null,   // no tiene precio ni indicadores, por definición
};

// `accion` + `pais_riesgo: 'global'` (ACN, GLOB de posicionesManuales) va a usa_stocks.
// /historical/usa_stocks/ SÍ existe, pero devuelve solo cierre: sin OHLCV, ATR y volumen
// quedan en null. No se sustituye por la serie del CEDEAR — está en ARS y mezcla el
// movimiento del papel con el del dólar.
export function panelesPara(tipo: PosicionTipo, pais: PaisRiesgo): PanelSpec | null {
  if (tipo === 'accion' && pais === 'global') return { live: 'usa_stocks', historical: 'usa_stocks' };
  return PANEL_POR_TIPO[tipo];
}

// F9.141 — alias de ticker de corrida → símbolo del panel. Tabla explícita, como
// ALIAS_NOMBRE_MEDIO de F9.139. Lo que no está mapeado se marca sin_fuente, no se adivina.
// La medición del §0 no encontró ninguno: los 22 tickers bursátiles matchean tal cual.
export const ALIAS_TICKER: Record<string, string> = {};

export const simboloDePanel = (ticker: string): string => ALIAS_TICKER[ticker] ?? ticker;

// ── Identidad de una posición (F9.141.1) ─────────────────────────────────────
// El ticker NO alcanza. GLOB es a la vez un CEDEAR en ARS (corrida) y una acción global en USD
// (plan de empleado): mismo símbolo, dos instrumentos, dos ruteos. Agruparlos le colgaría al
// plan los indicadores del CEDEAR.
export type Identidad = { ticker: string; tipo: PosicionTipo; paisRiesgo: PaisRiesgo };

export const claveIdentidad = (i: Identidad): string => `${i.ticker}|${i.tipo}|${i.paisRiesgo}`;

/**
 * Id del documento: ticker pelado mientras no haya ambigüedad, sufijo solo cuando la hay.
 * Una colisión nueva no renombra documentos que ya existen.
 */
export const idDocumento = (i: Identidad, ambiguo: boolean): string =>
  ambiguo ? `${i.ticker}__${i.tipo}_${i.paisRiesgo}` : i.ticker;

/**
 * Resuelve los ids de todo el universo de una vez, porque la ambigüedad es una propiedad del
 * conjunto y no de la posición: hasta no ver las 36 no se sabe si GLOB es uno o son dos.
 *
 * Cuando un ticker está repetido, la posición de la corrida (`vigenteEnCorrida`) se queda con el
 * ticker pelado y las demás se sufijan. El orden restante es determinístico (tipo, luego país)
 * para que dos corridas seguidas no permuten los ids.
 */
export function resolverIds<T extends Identidad & { vigenteEnCorrida?: boolean }>(
  objetivos: T[],
): Map<string, string> {
  const porTicker = new Map<string, T[]>();
  for (const o of objetivos) {
    if (!porTicker.has(o.ticker)) porTicker.set(o.ticker, []);
    porTicker.get(o.ticker)!.push(o);
  }

  const ids = new Map<string, string>();
  for (const [, grupo] of porTicker) {
    if (grupo.length === 1) {
      ids.set(claveIdentidad(grupo[0]), idDocumento(grupo[0], false));
      continue;
    }
    const ordenado = [...grupo].sort((a, b) =>
      Number(b.vigenteEnCorrida ?? false) - Number(a.vigenteEnCorrida ?? false) ||
      a.tipo.localeCompare(b.tipo) ||
      a.paisRiesgo.localeCompare(b.paisRiesgo));
    ordenado.forEach((o, i) => ids.set(claveIdentidad(o), idDocumento(o, i > 0)));
  }
  return ids;
}

// ── Contrato de errores de data912 ───────────────────────────────────────────
// Medido: ticker inexistente devuelve HTTP 200 con {"Error":"Nahh no tengo ese ticker loko"};
// ruta inexistente devuelve 404 con {"detail":"Not Found"}. No hay 422. Discriminar por status
// guardaría el objeto de error como si fuera una serie: se valida la FORMA del payload.
export function esErrorDeFuente(body: unknown): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return true;
  const o = body as Record<string, unknown>;
  if ('Error' in o || 'detail' in o) return true;
  return !(Array.isArray(o.dates) && Array.isArray(o.prices));
}

export type RespuestaFuente = { status: number; body: unknown };

export async function pedir(url: string): Promise<RespuestaFuente> {
  const res = await fetch(url);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

export const urlLive = (panel: PanelLive) => `${BASE}/live/${panel}`;
export const urlHistorico = (panel: PanelHistorico, ticker: string) =>
  `${BASE}/historical/${panel}/${encodeURIComponent(ticker)}`;

/**
 * Qué hacer cuando la fuente no devolvió serie. Vive acá y no en el cron para que sea
 * verificable: es la regla que impide que una caída de data912 vacíe la base.
 */
export function decidirEscritura(
  serieNueva: PuntoSerie[] | null,
  teniaSerie: boolean,
): 'escribir' | 'conservar' | 'marcar_sin_serie' {
  if (serieNueva && serieNueva.length) return 'escribir';
  return teniaSerie ? 'conservar' : 'marcar_sin_serie';
}

// ── Parseo de series ─────────────────────────────────────────────────────────
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Devuelve la serie ascendente por fecha, o null si la fuente no tiene ese ticker. */
export function parseSerie(body: unknown): PuntoSerie[] | null {
  // Formato de filas: /historical/{stocks,cedears,bonds}/ → [{date,o,h,l,c,v,dr,sa}]
  // `dr` y `sa` se descartan a propósito: dr viene sin ajustar por splits y sa está
  // contaminado por los glitches de la propia fuente (ver CLAUDE-PATRIMONIO).
  if (Array.isArray(body)) {
    const pts: PuntoSerie[] = [];
    for (const fila of body as Array<Record<string, unknown>>) {
      const c = num(fila.c);
      const f = typeof fila.date === 'string' ? fila.date : null;
      if (!f || c === null || c <= 0) continue;
      pts.push({ f, o: num(fila.o), h: num(fila.h), l: num(fila.l), c, v: num(fila.v) });
    }
    return pts.length ? ordenar(pts) : null;
  }

  // Formato columnar: /historical/usa_stocks/ → {ticker, dates[], prices[]}. Solo cierre.
  if (body && typeof body === 'object' && !esErrorDeFuente(body)) {
    const o = body as { dates: unknown[]; prices: unknown[] };
    const pts: PuntoSerie[] = [];
    const n = Math.min(o.dates.length, o.prices.length);
    for (let i = 0; i < n; i++) {
      const f = typeof o.dates[i] === 'string' ? (o.dates[i] as string) : null;
      const c = num(o.prices[i]);
      if (!f || c === null || c <= 0) continue;
      pts.push({ f, o: null, h: null, l: null, c, v: null });
    }
    return pts.length ? ordenar(pts) : null;
  }

  return null;
}

function ordenar(pts: PuntoSerie[]): PuntoSerie[] {
  const porFecha = new Map<string, PuntoSerie>();
  for (const p of pts) porFecha.set(p.f, p);  // última gana si la fuente repite una fecha
  return [...porFecha.values()].sort((a, b) => (a.f < b.f ? -1 : a.f > b.f ? 1 : 0));
}

// ── Puntos malos de la fuente ────────────────────────────────────────────────
// F9.148 — data912 sirve una fila OHLCV inventada para el 2023-08-03. Verificado contra Yahoo
// Finance (`.BA`): las dos fuentes coinciden AL CENTAVO en todas las demás ruedas de la ventana
// de 750, y solo ese día difieren ~45%. El retorno real de PAMP fue −2,0%, no −47,1%. No es un
// cierre mal capturado: es la fila entera, con volumen propio distinto del real.
//
// SE MARCA, NO SE BORRA. Borrarlo haría que `preciosDiarios` no coincida con lo que la fuente
// devuelve, y la próxima sincronización lo traería de vuelta sin que nadie entienda por qué
// reapareció. Marcado, el problema queda visible y el arreglo es idempotente.
//
// LISTA EXPLÍCITA, NO COMODÍN — y es una medición, no una intuición. Se barrieron los tres
// paneles argentinos completos (2026-08-18): acciones 32 podridas de 60 con fila, bonos 18 de 41,
// cedears 32 de 50. **BMA, CEPU, ALUA, BBAR, COME y otras 23 acciones tienen el dato bien** y un
// comodín les tiraría un punto bueno. El criterio usado (pozo de un día: el cierre se desvía >20%
// del vecino previo Y del siguiente, con los vecinos a menos de 15% entre sí) se validó contra
// Yahoo en 37 acciones: **37/37 de acuerdo**, sin un solo falso positivo ni negativo.
//
// La fuente NO lo corrigió en tres años: se volvió a pedir la serie el 2026-08-18 y sigue
// devolviendo el mismo valor. Hay que asumir que vuelve en cada corrida.
export const PUNTOS_MALOS: Record<string, string[]> = {
  '2023-08-03': [
    // acciones (panel `stocks`)
    'EDN', 'FERR', 'FIPL', 'GARO', 'GBAN', 'GCDI', 'GCLA', 'GGAL', 'HARG', 'HAVA', 'INVJ',
    'IRSA', 'LEDE', 'LOMA', 'LONG', 'METR', 'MIRG', 'MOLA', 'MOLI', 'MORI', 'OEST', 'PAMP',
    'PATA', 'RICH', 'SAMI', 'SUPV', 'TECO2', 'TGNO4', 'TGSU2', 'TRAN', 'TXAR', 'YPFD',
    // bonos (panel `bonds`). Las especies en dólares (sufijo C/D) están sanas salvo BA37D.
    'AE38', 'AL29', 'AL30', 'AL35', 'AL41', 'BA37D', 'CUAP', 'DICP', 'GD29', 'GD30', 'GD35',
    'GD38', 'GD41', 'GD46', 'PARP', 'TVPA', 'TX26', 'TX28',
    // cedears (panel `cedears`)
    'EEM', 'EWZ', 'GE', 'GOOGL', 'GS', 'HPQ', 'IBM', 'INTC', 'IWM', 'KO', 'LMT', 'MCD', 'MELI',
    'META', 'MO', 'MSFT', 'NFLX', 'PBR', 'PFE', 'PYPL', 'QCOM', 'QQQ', 'SPY', 'TEN', 'TSLA',
    'TXR', 'V', 'WFC', 'WMT', 'XLE', 'XLF', 'XOM',
  ],
};

/** Puntos de la serie que NO están marcados como dato malo. Es la base de todo cálculo. */
export const soloBuenos = (serie: PuntoSerie[]): PuntoSerie[] => serie.filter(p => !p.malo);

/**
 * Marca (no elimina) los puntos que `PUNTOS_MALOS` declara podridos para este símbolo.
 * Idempotente: correrla dos veces da lo mismo.
 */
export function marcarPuntosMalos(serie: PuntoSerie[], simbolo: string): PuntoSerie[] {
  const fechas = Object.keys(PUNTOS_MALOS).filter(f => PUNTOS_MALOS[f].includes(simbolo));
  if (!fechas.length) return serie;
  const malas = new Set(fechas);
  return serie.map(p => (malas.has(p.f) ? { ...p, malo: true as const } : p));
}

// ── Splits ───────────────────────────────────────────────────────────────────
// F9.141 — splits confirmados. Certeza, no inferencia. Se agrega a mano cuando se detecta uno.
export const SPLITS_CONFIRMADOS: Record<string, { fecha: string; razon: number }[]> = {
  YPFD: [{ fecha: '2026-08-03', razon: 10 }],
};

export const RAZONES_SIMPLES = [10, 5, 4, 3, 2, 1.5];
const CANDIDATAS = [...RAZONES_SIMPLES, ...RAZONES_SIMPLES.map(r => 1 / r)];

// F9.148 — era 0,35. El umbral tiene que separar SPLITS de MOVIMIENTOS DE MERCADO, y esos dos
// difieren en orden de magnitud: el split más chico que existe en la tabla es 3:2 (±33%/+50%),
// y de ahí para arriba; el mercado argentino hace ±40% en un día extremo.
//
// 0,35 fallaba de los dos lados, medido:
//  · Dejaba pasar el rally REAL del 2025-10-27 (post-legislativas) cuando la serie se expresa en
//    dólares: +28% en pesos más un MEP que cayó 6,8% da +37%, cruza el umbral, y
//    `recortarPorEstado` tiraba 554 puntos en cinco series. Es lo que bloqueaba F9.148 §4.
//  · Y al mismo tiempo dejaba invisibles caídas del 33,4% justo debajo del corte.
// 0,45 cubre el 37% del rally dolarizado y sigue por debajo del 50% de un split 2:1.
export const UMBRAL_SALTO = 0.45;
export const TOLERANCIA_RAZON = 0.05;

/** La razón simple que explica el cociente, o null. Separada para que el gate la pueda usar. */
function razonPara(cociente: number): { razon: number; residuo: number } | null {
  let mejor: { razon: number; residuo: number } | null = null;
  for (const razon of CANDIDATAS) {
    if (Math.abs(cociente / razon - 1) > TOLERANCIA_RAZON) continue;
    const residuo = razon / cociente - 1;
    if (!mejor || Math.abs(residuo) < Math.abs(mejor.residuo)) mejor = { razon, residuo };
  }
  return mejor;
}

/**
 * Capa 3 — SOLO REPORTE. Nunca reescala.
 *
 * Medido sobre las series completas: en la ventana de 750 días detecta 6 saltos con razón
 * simple y solo uno es un split real (YPFD 2026-08-03). Los otros cinco son eventos macro
 * (devaluación post-PASO 2023) y amortizaciones de bonos. Reescalar por parecido habría
 * corrompido cinco series con un factor inventado — exactamente el modo de falla que este
 * spec existe para evitar.
 *
 * F9.148 — el umbral dejó de ser el único disparador. Un movimiento se reporta si es grande
 * **o** si su cociente matchea una razón simple, aunque quede debajo del umbral: un split 3:2
 * es ~33% y con 0,45 pasaría desapercibido. Como la razón más chica es 1,5, este segundo
 * criterio no puede disparar por debajo de ~30% — no agrega ruido de movimientos normales.
 */
export function detectarSaltos(serie: PuntoSerie[]): SaltoDetectado[] {
  // F9.148 — los puntos marcados no participan: el salto se mide entre los dos buenos que
  // rodean al malo. Sin esto, un dato podrido genera DOS saltos fantasma (la ida y la vuelta).
  const buenos = soloBuenos(serie);
  const out: SaltoDetectado[] = [];
  for (let i = 1; i < buenos.length; i++) {
    const a = buenos[i - 1], b = buenos[i];
    const ret = b.c / a.c - 1;

    const cociente = a.c / b.c;
    const mejor = razonPara(cociente);
    if (Math.abs(ret) <= UMBRAL_SALTO && !mejor) continue;

    out.push({
      fecha: b.f, cAnterior: a.c, cPosterior: b.c,
      retornoCrudo: ret, cocienteCrudo: cociente,
      razonSugerida: mejor?.razon ?? null, residuo: mejor?.residuo ?? null,
    });
  }
  return out;
}

/**
 * Aplica splits probados (capa 1 tabla curada, capa 2 cantidad entre corridas) a la serie.
 * Todo lo anterior a la fecha se lleva a la escala posterior: precios ÷ razón, volumen × razón
 * (medido: `v` viene en nominales — en el split de YPFD salta de 150.611 a 1.196.647 mientras
 * el monto operado `c·v` queda continuo).
 */
export function aplicarSplits(
  serie: PuntoSerie[],
  splits: Array<{ fecha: string; razon: number; origen: 'tabla' | 'cantidad' }>,
): { serie: PuntoSerie[]; aplicados: SplitAplicado[] } {
  if (!splits.length) return { serie, aplicados: [] };

  let ajustada = serie.map(p => ({ ...p }));
  const aplicados: SplitAplicado[] = [];

  for (const { fecha, razon, origen } of [...splits].sort((a, b) => (a.fecha < b.fecha ? -1 : 1))) {
    const idx = ajustada.findIndex(p => p.f >= fecha);
    if (idx <= 0) continue;  // el split cae fuera de la serie retenida: nada que reescalar

    const cAnt = ajustada[idx - 1].c, cPost = ajustada[idx].c;
    const cocienteCrudo = cAnt / cPost;

    ajustada = ajustada.map((p, i) => (i >= idx ? p : {
      ...p,
      o: p.o === null ? null : p.o / razon,
      h: p.h === null ? null : p.h / razon,
      l: p.l === null ? null : p.l / razon,
      c: p.c / razon,
      v: p.v === null ? null : p.v * razon,
    }));

    aplicados.push({
      fecha: ajustada[idx].f, razon, cocienteCrudo,
      residuo: (cPost * razon) / cAnt - 1,
      origen,
    });
  }

  return { serie: ajustada, aplicados };
}

/**
 * Capa 2 — la cantidad entre corridas prueba el factor; la serie aporta la fecha exacta.
 *
 * Si entre dos corridas la cantidad de un ticker se multiplicó por N y el precio implícito
 * (valor_origen / cantidad) se dividió por N, es split y está probado con dato propio. La
 * corrida no dice QUÉ DÍA ocurrió, así que se busca dentro de la ventana el único día cuyo
 * salto de precio coincide con N.
 */
export function splitsPorCantidad(
  observaciones: Array<{ fecha: string; cantidad: number; valorOrigen: number }>,
  serie: PuntoSerie[],
): Array<{ fecha: string; razon: number }> {
  const obs = [...observaciones]
    .filter(o => o.cantidad > 0 && o.valorOrigen > 0)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : 1));

  const out: Array<{ fecha: string; razon: number }> = [];
  for (let i = 1; i < obs.length; i++) {
    const a = obs[i - 1], b = obs[i];
    const razonCantidad = b.cantidad / a.cantidad;
    const precioA = a.valorOrigen / a.cantidad, precioB = b.valorOrigen / b.cantidad;
    const razonPrecio = precioA / precioB;

    const razon = RAZONES_SIMPLES.find(r =>
      Math.abs(razonCantidad / r - 1) <= TOLERANCIA_RAZON &&
      Math.abs(razonPrecio / r - 1) <= TOLERANCIA_RAZON);
    if (!razon) continue;

    // La fecha sale de la serie: el día de mayor salto compatible dentro de la ventana.
    const dentro = detectarSaltos(serie).filter(s =>
      s.fecha > a.fecha && s.fecha <= b.fecha &&
      Math.abs(s.cocienteCrudo / razon - 1) <= TOLERANCIA_RAZON);
    if (dentro.length !== 1) continue;  // ambiguo o invisible en la serie: no se toca nada

    out.push({ fecha: dentro[0].fecha, razon });
  }
  return out;
}

// ── Indicadores ──────────────────────────────────────────────────────────────
export type Indicadores = {
  puntosDisponibles: number;
  fechaUltimoPrecio: string | null;
  precio: number | null;
  sma20: number | null;   sma50: number | null;   sma200: number | null;
  vsSma20Pct: number | null; vsSma50Pct: number | null; vsSma200Pct: number | null;
  max52s: number | null;  min52s: number | null;
  distanciaMax52sPct: number | null; distanciaMin52sPct: number | null;
  drawdownDesdeMaxPct: number | null;
  volAnualizada30d: number | null; volAnualizada90d: number | null;
  perf1m: number | null; perf3m: number | null; perf6m: number | null; perf1a: number | null;
  rsi14: number | null;  atrPct: number | null;
  montoOperadoProm30d: number | null; montoOperadoUltimo: number | null; ratioVolumen: number | null;
  /**
   * F9.148 §4 — en qué moneda están `perf1m/3m/6m/1a`, y SOLO ellos. Todo lo demás está en
   * `monedaSerie`. Nunca se infiere en la UI: el motor dice cuál usó.
   */
  monedaPerformance: 'ARS' | 'USD';
  /** Por qué la performance no está en dólares, cuando no lo está. null si sí lo está. */
  motivoPerfEnMoneda: 'ya_en_usd' | 'sin_tc_completo' | null;
};

const RUEDAS = { mes: 21, tri: 63, sem: 126, anio: 252, cincuentaydos: 252 };

const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** null si no hay al menos `ventana` puntos. Nunca una media de 200 días sobre 40 datos. */
function sma(cierres: number[], ventana: number): number | null {
  if (cierres.length < ventana) return null;
  return media(cierres.slice(-ventana));
}

function volAnualizada(cierres: number[], ventana: number): number | null {
  if (cierres.length < ventana + 1) return null;
  const tramo = cierres.slice(-(ventana + 1));
  const rets: number[] = [];
  for (let i = 1; i < tramo.length; i++) rets.push(Math.log(tramo[i] / tramo[i - 1]));
  const m = media(rets);
  const varianza = media(rets.map(r => (r - m) ** 2));
  return Math.sqrt(varianza) * Math.sqrt(252);
}

function perf(cierres: number[], ruedas: number): number | null {
  if (cierres.length < ruedas + 1) return null;
  return cierres[cierres.length - 1] / cierres[cierres.length - 1 - ruedas] - 1;
}

/** RSI de Wilder. Necesita 15 puntos para 14 ruedas de variación. */
function rsi(cierres: number[], ventana = 14): number | null {
  if (cierres.length < ventana + 1) return null;
  let ganancia = 0, perdida = 0;
  for (let i = 1; i <= ventana; i++) {
    const d = cierres[i] - cierres[i - 1];
    if (d >= 0) ganancia += d; else perdida -= d;
  }
  ganancia /= ventana; perdida /= ventana;
  for (let i = ventana + 1; i < cierres.length; i++) {
    const d = cierres[i] - cierres[i - 1];
    ganancia = (ganancia * (ventana - 1) + Math.max(d, 0)) / ventana;
    perdida = (perdida * (ventana - 1) + Math.max(-d, 0)) / ventana;
  }
  if (perdida === 0) return ganancia === 0 ? 50 : 100;
  return 100 - 100 / (1 + ganancia / perdida);
}

/** ATR% de Wilder. null sin OHLC — es el caso de /historical/usa_stocks/ (solo cierre). */
function atrPct(serie: PuntoSerie[], ventana = 14): number | null {
  if (serie.length < ventana + 1) return null;
  const tramo = serie.slice(-(ventana + 1));
  const trs: number[] = [];
  for (let i = 1; i < tramo.length; i++) {
    const { h, l } = tramo[i];
    if (h === null || l === null) return null;
    const cPrev = tramo[i - 1].c;
    trs.push(Math.max(h - l, Math.abs(h - cPrev), Math.abs(l - cPrev)));
  }
  const ultimo = tramo[tramo.length - 1].c;
  return ultimo > 0 ? media(trs) / ultimo : null;
}

/**
 * F9.148 §4 — la performance se calcula en DÓLARES; todo lo demás, en la moneda de la serie.
 *
 * No es una inconsistencia, es el resultado de una medición: dolarizar volatilidad, drawdown y
 * medias las EMPEORA. La correlación diaria entre el retorno del papel en ARS y el del MEP pasó
 * de +0,2/+0,5 (2023-24, bajo cepo: se movían juntos y convertir cancelaba ruido) a −0,2/−0,46
 * (2025: se mueven en contra y convertir amplifica). Medido: la volatilidad SUBE en 13 de 15
 * posiciones al dolarizar.
 *
 * La performance es el caso opuesto y por eso es la única que se convierte: `perf1a` cambia de
 * signo en 3 de 12 posiciones, ARS y USD discrepan el 15,0% de los días, y en pesos la
 * performance a un año da positiva el 86% del tiempo —100% en cuatro papeles—, que es la
 * deriva nominal contestando "¿gané o perdí?" con un sí que no significa nada.
 *
 * @param serieUsd la MISMA serie convertida, rueda a rueda. Si no cubre todas las ruedas buenas
 *   (falta TC en alguna), NO se usa: se calcula en la moneda de la serie y se dice por qué.
 *   Recortar el índice sobre una serie con agujeros correría la ventana de 252 ruedas sin avisar.
 */
export function calcIndicadores(
  serieConMalos: PuntoSerie[],
  opciones?: { serieUsd?: PuntoSerie[] | null; yaEnUsd?: boolean },
): Indicadores {
  // F9.148 — un punto marcado como dato malo no entra en NINGÚN indicador: ni medias, ni
  // máximos y mínimos, ni drawdown, ni volatilidad, ni performance, ni RSI, ni ATR, ni volumen.
  // `puntosDisponibles` cuenta los buenos, que es lo que efectivamente se usó para calcular.
  const serie = soloBuenos(serieConMalos);
  const cierres = serie.map(p => p.c);
  const ultimo = cierres.length ? cierres[cierres.length - 1] : null;
  const rel = (base: number | null) => (base === null || ultimo === null ? null : ultimo / base - 1);

  const s20 = sma(cierres, 20), s50 = sma(cierres, 50), s200 = sma(cierres, 200);

  const hayAnio = cierres.length >= RUEDAS.cincuentaydos;
  const ventana52 = hayAnio ? cierres.slice(-RUEDAS.cincuentaydos) : null;
  const max52 = ventana52 ? Math.max(...ventana52) : null;
  const min52 = ventana52 ? Math.min(...ventana52) : null;

  // Drawdown desde el máximo de la serie retenida; sin serie mínima no se informa.
  const maxHist = cierres.length >= 20 ? Math.max(...cierres) : null;

  // ── Performance: la única familia que cambia de moneda (F9.148 §4) ──────────
  const usd = opciones?.serieUsd ? soloBuenos(opciones.serieUsd) : null;
  const usdCompleta = !!usd && usd.length === serie.length;
  const cierresPerf = opciones?.yaEnUsd ? cierres : usdCompleta ? usd!.map(p => p.c) : cierres;
  const monedaPerformance: 'ARS' | 'USD' = opciones?.yaEnUsd || usdCompleta ? 'USD' : 'ARS';
  const motivoPerfEnMoneda = opciones?.yaEnUsd ? 'ya_en_usd' as const
    : usdCompleta ? null : 'sin_tc_completo' as const;

  const montos = serie.map(p => (p.v === null ? null : p.c * p.v));
  const hayMontos = montos.length >= 30 && montos.slice(-30).every(m => m !== null);
  const montoProm30 = hayMontos ? media(montos.slice(-30) as number[]) : null;
  const montoUlt = montos.length ? montos[montos.length - 1] : null;

  return {
    puntosDisponibles: serie.length,
    fechaUltimoPrecio: serie.length ? serie[serie.length - 1].f : null,
    precio: ultimo,
    sma20: s20, sma50: s50, sma200: s200,
    vsSma20Pct: rel(s20), vsSma50Pct: rel(s50), vsSma200Pct: rel(s200),
    max52s: max52, min52s: min52,
    distanciaMax52sPct: rel(max52), distanciaMin52sPct: rel(min52),
    drawdownDesdeMaxPct: rel(maxHist),
    volAnualizada30d: volAnualizada(cierres, 30),
    volAnualizada90d: volAnualizada(cierres, 90),
    perf1m: perf(cierresPerf, RUEDAS.mes),
    perf3m: perf(cierresPerf, RUEDAS.tri),
    perf6m: perf(cierresPerf, RUEDAS.sem),
    perf1a: perf(cierresPerf, RUEDAS.anio),
    rsi14: rsi(cierres),
    atrPct: atrPct(serie),
    montoOperadoProm30d: montoProm30,
    montoOperadoUltimo: montoUlt,
    ratioVolumen: montoProm30 && montoUlt !== null && montoProm30 > 0 ? montoUlt / montoProm30 : null,
    monedaPerformance, motivoPerfEnMoneda,
  };
}

// ── Semáforos ────────────────────────────────────────────────────────────────
// 🔴 significa "está fuera de banda, mirá esto", NO "vendé": un drawdown rojo puede ser
// motivo de compra. Sin semáforo compuesto — agregarlos exige pesos y esos pesos serían
// arbitrarios. Sin semáforo para SMA, RSI ni ATR: son contexto, no umbral.
export type ClaseUmbral = 'accionAr' | 'accionGlobal' | 'cedear' | 'bonoAr' | 'on' | 'fciMM' | 'cripto';

export const UMBRALES = {
  peso:      { verde: 0.04, amarillo: 0.08 },
  // F9.148 §3 — las bandas son las mismas, pero ahora miden `distanciaMax52sPct` en vez de
  // `drawdownDesdeMaxPct`. Ver `calcSemaforos`.
  caida52s: {
    accionAr:     { verde: 0.20, amarillo: 0.40 },
    cripto:       { verde: 0.20, amarillo: 0.40 },
    accionGlobal: { verde: 0.15, amarillo: 0.30 },
    cedear:       { verde: 0.15, amarillo: 0.30 },
    bonoAr:       { verde: 0.08, amarillo: 0.20 },
    on:           { verde: 0.08, amarillo: 0.20 },
    fciMM:        { verde: 0.08, amarillo: 0.20 },
  },
  volatilidad: {
    cripto:       { verde: 0.60, amarillo: 0.90 },
    accionAr:     { verde: 0.40, amarillo: 0.60 },
    accionGlobal: { verde: 0.25, amarillo: 0.40 },
    cedear:       { verde: 0.25, amarillo: 0.40 },
    bonoAr:       { verde: 0.20, amarillo: 0.35 },
    on:           { verde: 0.20, amarillo: 0.35 },
    fciMM:        { verde: 0.05, amarillo: 0.12 },
  },
  // F9.148 §3 — el semáforo de liquidez SE ELIMINÓ, no se recalibró. Medido sobre las 16
  // series: `ruedasParaSalir` va de 2,3e-6 a 1,8e-2 y las 15 con dato dan verde. Ninguna llega
  // siquiera a 0,05 ruedas, así que no hay umbral que informe algo — la posición más ilíquida
  // de la cartera se liquida en el 2% de una rueda. Un semáforo que nunca cambia de color no es
  // información: entrena a no mirarlo. El número sigue en la ficha, que es lo que sí sirve.
  // Si algún día la cartera crece un orden de magnitud, se recalibra con la distribución de
  // entonces y no con una banda inventada para que algo se encienda.
} as const;

export function claseUmbral(tipo: PosicionTipo, pais: PaisRiesgo): ClaseUmbral {
  if (tipo === 'accion') return pais === 'global' ? 'accionGlobal' : 'accionAr';
  if (tipo === 'cedear') return 'cedear';
  if (tipo === 'bono') return 'bonoAr';
  if (tipo === 'on') return 'on';
  if (tipo === 'fci') return 'fciMM';
  if (tipo === 'cripto') return 'cripto';
  return 'accionAr';
}

/** Bandas crecientes: por debajo de `verde` es verde, por encima de `amarillo` es rojo. */
function banda(valor: number | null, u: { verde: number; amarillo: number }): Semaforo {
  if (valor === null || !Number.isFinite(valor)) return 'sin_datos';
  const v = Math.abs(valor);
  if (v < u.verde) return 'verde';
  if (v <= u.amarillo) return 'amarillo';
  return 'rojo';
}

/**
 * F9.148 §3 — dos cambios, los dos medidos, ninguno de los dos por gusto.
 *
 * 1. `drawdown` → `caida52s`. La referencia dejó de ser el máximo de TODA la serie retenida y
 *    pasó a ser el máximo de 52 semanas (`distanciaMax52sPct`, que ya se calculaba). El máximo
 *    de la serie mide contra una ventana que dura 750 ruedas en unas posiciones y 183 en otras:
 *    el mismo semáforo comparaba cosas distintas. 52 semanas es ventana fija y comparable.
 *    Cuando no hay 252 ruedas devuelve `sin_datos`, igual que el resto de los indicadores de
 *    ventana: nunca una banda calculada sobre menos historia de la que dice medir.
 *
 *    HONESTIDAD SOBRE EL ALCANCE: esto NO destraba la distribución cargada. Medido después de
 *    §1 y §2, entre las 12 series con las dos referencias definidas, amarillo-o-rojo pasa de
 *    8/12 a 7/12 — se mueve una sola posición (TXAR). La hipótesis del spec de que el punto
 *    podrido inflaba los drawdowns era falsa: ese punto era un POZO, y un pozo nunca es el
 *    máximo desde el que se mide una caída. **El umbral sigue siendo el problema abierto.**
 *
 * 2. `liquidez` se fue. Ver `UMBRALES`.
 */
export function calcSemaforos(
  ind: Indicadores,
  clase: ClaseUmbral,
  pesoEnCartera: number | null,
): Record<string, Semaforo> {
  return {
    peso: banda(pesoEnCartera, UMBRALES.peso),
    caida52s: banda(ind.distanciaMax52sPct, UMBRALES.caida52s[clase]),
    volatilidad: banda(ind.volAnualizada90d, UMBRALES.volatilidad[clase]),
  };
}

// ── Recorte por estado de serie ──────────────────────────────────────────────
export const TOPE_PUNTOS = 750;

/**
 * `sospechosa` → solo se calcula sobre lo posterior al último salto sin resolver.
 * Devuelve la serie utilizable y el estado resultante.
 */
export function recortarPorEstado(
  serie: PuntoSerie[],
  saltosSinResolver: SaltoDetectado[],
  huboSplitAplicado: boolean,
): { util: PuntoSerie[]; estado: EstadoSerie } {
  if (!serie.length) return { util: [], estado: 'sin_serie' };
  if (!saltosSinResolver.length) {
    return { util: serie, estado: huboSplitAplicado ? 'ajustada' : 'limpia' };
  }
  const ultimo = saltosSinResolver[saltosSinResolver.length - 1].fecha;
  const idx = serie.findIndex(p => p.f >= ultimo);
  return { util: idx >= 0 ? serie.slice(idx) : serie, estado: 'sospechosa' };
}

export const recortarTope = (serie: PuntoSerie[]) =>
  serie.length > TOPE_PUNTOS ? serie.slice(-TOPE_PUNTOS) : serie;
