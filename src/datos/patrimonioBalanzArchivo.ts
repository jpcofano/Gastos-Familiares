// F9.196 Addendum 2 §A (H2b) — Balanz por archivo: "Mis Instrumentos" (.xlsx), sin LLM.
//
// Funciones PURAS: reciben las filas ya leídas del .xlsx (array de arrays) y devuelven la forma
// normalizada de `cuentasVivas` (§1). La lectura del archivo y la escritura en Firestore están en
// src/datos/patrimonioCuentasVivas.ts; la UI en src/vistas/PatrimonioBalanz.tsx.
//
// Semántica verificada con las muestras reales (Addendum 2 §A), para la VISTA EN DÓLARES:
// - `Valor actual` = Nominales × Precio, en USD, para TODAS las especies (también las que cotizan
//   en pesos). `Precio` = USD por unidad nominal (bonos por 1 VN, no por 100).
// - `Precio promedio de compra` = costo promedio en USD por unidad → `costoPromedio`.
// - `Moneda` es la moneda de COTIZACIÓN del instrumento, no la de `Valor actual`.
// - No trae caja.
// - No crea una corrida: alimenta solo la cartera viva (F9.189 §1 sigue intacto).
//
// F9.196.1 §0 — Balanz deja exportar la misma planilla en la VISTA EN PESOS (medido con los
// exports del 20/10 en dólares y del 21/10 en pesos de la misma comitente):
// - `Precio` y `Valor actual` en pesos del día, salvo los FCI en dólares (`Fondos` + `Dólares`),
//   que quedan en USD. La columna `Moneda` no cambia.
// - `Precio promedio de compra` y `Valor inicial` en pesos HISTÓRICOS (cada compra con el dólar de
//   su fecha): no se convierten con el MEP de hoy.
// `parsearMisInstrumentos` lee los números tal como vienen; `detectarVista` decide la vista y
// `aplicarVista` convierte. Los campos `*Usd` de la fila están en USD recién después de aplicarla.
import type { PosicionRaw, PosicionTipo, PaisRiesgo } from '../types/patrimonio';
import { diaHabilAnterior, type CuentaViva, type PrecioDia, type TcCarteraViva } from './patrimonioCarteraViva';
import type { MovimientoCuenta } from './patrimonioMovimientos';

export const ENCABEZADOS_MIS_INSTRUMENTOS = [
  'Ticker', 'Tipo de Instrumento', 'Descripcion', 'Nominales', 'Garantías', 'Precio', 'Fecha',
  'Porcentaje de tenencia', 'Precio promedio de compra', 'Valor actual', 'Valor inicial',
  'Rendimiento', 'Variación (%)', 'Porcentaje de rendimiento', 'Días promedio de tenencia', 'TNA',
  'Moneda',
] as const;

/** §B (H3c). Acá solo se usan para reconocer el archivo y decir que todavía no se importa. */
export const ENCABEZADOS_MOVIMIENTOS = [
  'Descripcion', 'Ticker', 'Tipo de Instrumento', 'Concertacion', 'Cantidad', 'Precio',
  'Liquidacion', 'Moneda', 'Importe',
] as const;

const TIPO_BALANZ: Record<string, PosicionTipo> = {
  Acciones: 'accion', Cedears: 'cedear', Bonos: 'bono', Corporativos: 'on', Fondos: 'fci',
};

/** Texto de celda normalizado. NFC: un mismo "Garantías" puede llegar con la tilde compuesta o separada. */
const normEnc = (x: unknown) => String(x ?? '').normalize('NFC').trim();

/**
 * Filas de la primera hoja de un .xlsx, como array de arrays (fila 1 = encabezados). `xlsx` se
 * carga recién acá (import dinámico) para no sumarle ~400 KB al bundle de toda la app. Sin
 * Firestore: corre igual en el navegador y en los scripts de verificación.
 */
export async function leerFilasXlsx(datos: ArrayBuffer | Uint8Array): Promise<{ hoja: string; filas: unknown[][] }> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(datos instanceof Uint8Array ? datos : new Uint8Array(datos), { type: 'array' });
  const hoja = wb.SheetNames[0];
  if (!hoja) throw new Error('El archivo no tiene hojas.');
  const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja], { header: 1, raw: true, defval: null, blankrows: false });
  return { hoja, filas };
}

/** Qué archivo es, por los encabezados de la fila 1. Nunca por el nombre. */
export function detectarArchivoBalanz(encabezados: unknown[]): 'mis_instrumentos' | 'movimientos' | null {
  const h = new Set(encabezados.map(normEnc));
  if (ENCABEZADOS_MIS_INSTRUMENTOS.every(e => h.has(e))) return 'mis_instrumentos';
  if (ENCABEZADOS_MOVIMIENTOS.every(e => h.has(e))) return 'movimientos';
  return null;
}

/**
 * Comitente y momento de exportación desde el nombre. Soporta la forma con corchetes
 * (`[MisInstrumentos][com402665][cuo175001][<TITULARES>][20261020]_[183109hs].xlsx`) y la que
 * queda si el navegador se los saca (`MisInstrumentoscom402665cuo175001<TITULARES>20261020_183109hs`).
 * Lo que no matchea vuelve `null`: la cuenta la elige Juan, nunca se adivina.
 */
export function parsearNombreBalanz(nombre: string): { comitente: string | null; exportadoEn: string | null } {
  const com = /com(\d+)/.exec(nombre);
  const fh = /(\d{8})\]?_\[?(\d{6})hs/.exec(nombre);
  let exportadoEn: string | null = null;
  if (fh) {
    const [d, t] = [fh[1], fh[2]];
    const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}-03:00`;
    if (Number.isFinite(Date.parse(iso))) exportadoEn = iso;
  }
  return { comitente: com ? com[1] : null, exportadoEn };
}

export const cuentaDeComitente = (comitente: string) => `Balanz ${comitente}`;
export const idCuentaVivaBalanz = (comitente: string) => `balanz_${comitente}`;

/**
 * Número de una celda: number tal cual; texto en formato argentino ("1.234,56") o plano.
 * Con punto y coma, el ÚLTIMO es el decimal ("1,500.25" y "1.500,25"). Solo puntos en grupos de
 * tres ("1.500", "1.234.567") son miles. Lo demás, punto decimal. Ante la duda, la guarda de
 * `Nominales × Precio` contra `Valor actual` frena la fila (ver `noCuadran`).
 */
export function numeroCelda(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x !== 'string') return null;
  let s = x.trim().replace(/[^\d,.\-]/g, '');
  if (!s) return null;
  const ip = s.lastIndexOf('.'), ic = s.lastIndexOf(',');
  if (ip >= 0 && ic >= 0) {
    s = ic > ip ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (ic >= 0) {
    s = s.replace(/,/g, '.');
    if ((s.match(/\./g) ?? []).length > 1) return null;
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export type FilaMisInstrumentos = {
  ticker: string;
  tipoCrudo: string;
  tipo: PosicionTipo | null;          // null = tipo desconocido → para revisar
  descripcion: string;
  nominales: number;
  precioUsd: number;                  // USD por unidad nominal
  /** `HH:MM` → hora del precio del día de exportación; `dd/mm/aaaa` → fecha del VCP (FCI). */
  fechaPrecio: string | null;
  costoPromedioUsd: number | null;
  valorActualUsd: number;
  valorInicialUsd: number | null;
  monedaCotizacion: 'ARS' | 'USD' | null;
  monedaCruda: string;
  /** `Valor actual` contra `Nominales × Precio`, en la moneda del archivo (USD después de `aplicarVista`). */
  difRedondeoUsd: number;
  /** F9.196.1 §0 — vista en pesos: `Valor actual` tal como vino (ARS), antes de convertir. */
  valorArchivoArs?: number | null;
};

/** Clasificación ya conocida de un ticker (de la importación anterior o de la corrida). */
export type Clasificacion = { sector: string; pais_riesgo: PaisRiesgo };
export const claveClasificacion = (ticker: string, tipo: PosicionTipo) => `${ticker.trim().toUpperCase()}|${tipo}`;

export type ImportacionMisInstrumentos = {
  comitente: string;
  cuenta: string;
  exportadoEn: string;
  filas: FilaMisInstrumentos[];
  posiciones: PosicionRaw[];
  costoPromedio: Record<string, number>;
  /** Suma de `Valor actual` del archivo (todas las filas, también las para revisar). */
  valorUsdBalanz: number;
  /**
   * Filas con tipo desconocido y sin tipo conocido para su ticker: no entran a `posiciones` y se
   * muestran con el texto crudo. Si el ticker tenía tipo en la corrida, entra con ese tipo y
   * `revisar: true` (F9.189 §2: la fila se conserva marcada).
   */
  paraRevisar: Array<{ ticker: string; motivo: string }>;
  /**
   * Filas donde `Nominales × Precio` no cuadra con `Valor actual` (más de 1 USD): un número mal
   * leído. La importación no se puede confirmar con alguna de estas.
   */
  noCuadran: string[];
  avisos: string[];
  /** F9.196.1 §0 — vista del archivo; sin `aplicarVista`, los números están como vinieron. */
  vista?: VistaBalanz;
  /** Con qué MEP se convirtió la vista en pesos. */
  tcConversion?: { valor: number; fecha: string; fuente: string } | null;
  /** Vista en pesos: `Valor actual` crudo en pesos, por ticker. */
  valorArchivoArs?: Record<string, number>;
  /** Vista en pesos: `Precio promedio de compra` crudo (pesos históricos), por ticker. Dato, no entra a cálculos en USD. */
  costoPromedioArs?: Record<string, number>;
  /** Por qué un ticker quedó sin costo en USD. */
  costoMotivo?: Record<string, 'costo_en_pesos_historicos'>;
  /** Exportación (en dólares) de la que salen los costos en USD. */
  costoUsdDel?: string | null;
};

/** Tolerancia de redondeo entre `Nominales × Precio` y `Valor actual` (Addendum 2: 1 USD). */
export const TOLERANCIA_VALOR_USD = 1;

/**
 * Parser de "Mis Instrumentos". Falla con el nombre del encabezado si falta alguno. Un tipo
 * desconocido no se descarta en silencio: queda en `paraRevisar` con el texto crudo.
 */
export function parsearMisInstrumentos(
  filas: unknown[][],
  ctx: {
    comitente: string; exportadoEn: string; clasificaciones: Map<string, Clasificacion>;
    /** Tipo conocido por ticker (de la corrida o la importación anterior), para un tipo desconocido. */
    tiposPorTicker?: Map<string, PosicionTipo>;
  },
): ImportacionMisInstrumentos {
  if (!filas.length) throw new Error('El archivo está vacío: no tiene fila de encabezados.');
  const enc = filas[0].map(normEnc);
  const faltan = ENCABEZADOS_MIS_INSTRUMENTOS.filter(e => !enc.includes(e));
  if (faltan.length) {
    throw new Error(`No es un "Mis Instrumentos" válido: falta el encabezado ${faltan.map(f => `"${f}"`).join(', ')}.`);
  }
  const col = (nombre: (typeof ENCABEZADOS_MIS_INSTRUMENTOS)[number]) => enc.indexOf(nombre);
  const fechaExport = ctx.exportadoEn.slice(0, 10);
  const cuenta = cuentaDeComitente(ctx.comitente);

  const out: FilaMisInstrumentos[] = [];
  const posiciones: PosicionRaw[] = [];
  const costoPromedio: Record<string, number> = {};
  const paraRevisar: Array<{ ticker: string; motivo: string }> = [];
  const noCuadran: string[] = [];
  const avisos: string[] = [];

  filas.slice(1).forEach((r, i) => {
    const celda = (n: (typeof ENCABEZADOS_MIS_INSTRUMENTOS)[number]) => r[col(n)];
    const ticker = normEnc(celda('Ticker')).toUpperCase();
    if (!ticker && r.every(x => x === null || x === undefined || normEnc(x) === '')) return; // fila vacía
    const fila = i + 2;
    if (!ticker) { avisos.push(`Fila ${fila}: sin ticker, no se importa.`); return; }

    const nominales = numeroCelda(celda('Nominales'));
    const precio = numeroCelda(celda('Precio'));
    const va = numeroCelda(celda('Valor actual'));
    if (nominales === null || precio === null || va === null) {
      avisos.push(`Fila ${fila} (${ticker}): Nominales, Precio o Valor actual no son números; no se importa.`);
      return;
    }
    const tipoCrudo = normEnc(celda('Tipo de Instrumento'));
    const tipoBalanz = TIPO_BALANZ[tipoCrudo] ?? null;
    const tipoHeredado = tipoBalanz ? null : ctx.tiposPorTicker?.get(ticker) ?? null;
    const tipo = tipoBalanz ?? tipoHeredado;
    const monedaCruda = normEnc(celda('Moneda'));
    const monedaCotizacion = monedaCruda === 'Pesos' ? 'ARS'
      : monedaCruda === 'Dólares' || monedaCruda === 'US Dollar (Cable)' ? 'USD' : null;
    const f = normEnc(celda('Fecha'));
    const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(f);
    const fechaPrecio = /^\d{1,2}:\d{2}$/.test(f) ? `${fechaExport} ${f.padStart(5, '0')}`
      : dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : f || null;
    const ppc = numeroCelda(celda('Precio promedio de compra'));
    const difRedondeoUsd = Math.abs(nominales * precio - va);

    const filaOut: FilaMisInstrumentos = {
      ticker, tipoCrudo, tipo, descripcion: normEnc(celda('Descripcion')), nominales, precioUsd: precio,
      fechaPrecio, costoPromedioUsd: ppc, valorActualUsd: va, valorInicialUsd: numeroCelda(celda('Valor inicial')),
      monedaCotizacion, monedaCruda, difRedondeoUsd,
    };
    out.push(filaOut);

    if (difRedondeoUsd > TOLERANCIA_VALOR_USD) {
      noCuadran.push(`${ticker}: Nominales × Precio = ${(nominales * precio).toFixed(2)} y Valor actual = ${va.toFixed(2)} (difieren ${difRedondeoUsd.toFixed(2)} USD).`);
    }
    if (monedaCotizacion === null) avisos.push(`${ticker}: moneda de cotización desconocida «${monedaCruda}».`);
    if (!tipo) {
      paraRevisar.push({ ticker, motivo: `Tipo de Instrumento desconocido: «${tipoCrudo}»` });
      return;
    }

    const clas = ctx.clasificaciones.get(claveClasificacion(ticker, tipo)) ?? null;
    const motivos = [
      tipoHeredado ? `Tipo de Instrumento desconocido «${tipoCrudo}»: se usó el tipo conocido del ticker (${tipoHeredado})` : null,
      clas ? null : `Sector y país desconocidos para ${ticker} (${tipoCrudo}): no está en la corrida ni en la importación anterior`,
    ].filter((m): m is string => !!m);
    posiciones.push({
      cuenta, titular: null, ticker, tipo,
      sector: clas?.sector ?? '',
      pais_riesgo: clas?.pais_riesgo ?? 'AR',
      moneda_origen: 'USD', valor_origen: va, cantidad: nominales,
      fuente: 'archivo_balanz', revisar: motivos.length > 0,
      motivo_revisar: motivos.length ? motivos.join(' · ') : null,
    });
    if (ppc !== null && ppc > 0) costoPromedio[ticker] = ppc;
  });

  const valorUsdBalanz = Math.round(out.reduce((a, f) => a + f.valorActualUsd, 0) * 100) / 100;
  return {
    comitente: ctx.comitente, cuenta, exportadoEn: ctx.exportadoEn,
    filas: out, posiciones, costoPromedio, valorUsdBalanz, paraRevisar, noCuadran, avisos,
  };
}

/**
 * Clasificaciones conocidas. Orden: la corrida de la MISMA cuenta (lo último que Juan revisó),
 * después la importación anterior, después la corrida de otras cuentas. Así una corrección de
 * sector o país en una corrida nueva llega a la cuenta viva en vez de quedar congelada.
 */
export function clasificacionesDe(
  anteriores: PosicionRaw[],
  corrida: Array<Pick<PosicionRaw, 'cuenta' | 'ticker' | 'tipo' | 'sector' | 'pais_riesgo'>>,
  cuenta: string,
): Map<string, Clasificacion> {
  const m = new Map<string, Clasificacion>();
  const poner = (p: Pick<PosicionRaw, 'ticker' | 'tipo' | 'sector' | 'pais_riesgo'>) => {
    const k = claveClasificacion(p.ticker, p.tipo);
    if (!m.has(k) && p.sector) m.set(k, { sector: p.sector, pais_riesgo: p.pais_riesgo });
  };
  corrida.filter(p => p.cuenta === cuenta).forEach(poner);
  anteriores.forEach(poner);
  corrida.forEach(poner);
  return m;
}

/** Tipo conocido por ticker (misma prioridad que `clasificacionesDe`), para un tipo desconocido. */
export function tiposPorTickerDe(
  anteriores: PosicionRaw[],
  corrida: Array<Pick<PosicionRaw, 'cuenta' | 'ticker' | 'tipo'>>,
  cuenta: string,
): Map<string, PosicionTipo> {
  const m = new Map<string, PosicionTipo>();
  const poner = (p: Pick<PosicionRaw, 'ticker' | 'tipo'>) => {
    const t = p.ticker.trim().toUpperCase();
    if (!m.has(t) && p.tipo !== 'cash') m.set(t, p.tipo);
  };
  corrida.filter(p => p.cuenta === cuenta).forEach(poner);
  anteriores.forEach(poner);
  corrida.forEach(poner);
  return m;
}

/**
 * Un archivo MÁS VIEJO que la importación vigente no se importa: volvería atrás la cuenta viva e
 * inferiría movimientos al revés, pisando los ids de la importación original de esa fecha.
 */
export const esMasViejo = (
  previa: Pick<CuentaVivaBalanz, 'exportadoEn'> | null,
  imp: Pick<ImportacionMisInstrumentos, 'exportadoEn'>,
) => !!previa && Date.parse(imp.exportadoEn) < Date.parse(previa.exportadoEn);

/** El documento de `cuentasVivas/balanz_<comitente>`. Forma normalizada de §1 + control. */
export type CuentaVivaBalanz = CuentaViva & {
  fuente: 'archivo_balanz';
  comitente: string;
  exportadoEn: string;
  valorUsdBalanz: number;
  paraRevisar: Array<{ ticker: string; motivo: string }>;
  /** F9.196.1 §0 — ausente en lo guardado antes de reconocer las dos vistas. */
  vista?: VistaBalanz;
  tcConversion?: { valor: number; fecha: string; fuente: string } | null;
  valorArchivoArs?: Record<string, number>;
  costoPromedioArs?: Record<string, number>;
  costoMotivo?: Record<string, 'costo_en_pesos_historicos'>;
  costoUsdDel?: string | null;
};

export function cuentaVivaDeImportacion(imp: ImportacionMisInstrumentos): CuentaVivaBalanz {
  return {
    cuenta: imp.cuenta, fuente: 'archivo_balanz', leidoEn: imp.exportadoEn,
    posiciones: imp.posiciones, costoPromedio: imp.costoPromedio, error: null,
    comitente: imp.comitente, exportadoEn: imp.exportadoEn,
    valorUsdBalanz: imp.valorUsdBalanz, paraRevisar: imp.paraRevisar,
    ...(imp.vista ? {
      vista: imp.vista, tcConversion: imp.tcConversion ?? null,
      valorArchivoArs: imp.valorArchivoArs ?? {}, costoPromedioArs: imp.costoPromedioArs ?? {},
      costoMotivo: imp.costoMotivo ?? {}, costoUsdDel: imp.costoUsdDel ?? null,
    } : {}),
  };
}

/**
 * Mismo archivo (misma comitente, fecha y hora de exportación) → no cambia nada. F9.196.1 §0: si
 * lo guardado no tiene `vista` (guardado antes de reconocer pesos y dólares) o tiene otra, NO es el
 * mismo: se puede reimportar.
 */
export const esMismaImportacion = (
  previa: Pick<CuentaVivaBalanz, 'comitente' | 'exportadoEn' | 'vista'> | null,
  imp: Pick<ImportacionMisInstrumentos, 'comitente' | 'exportadoEn' | 'vista'>,
) => !!previa && previa.comitente === imp.comitente && previa.exportadoEn === imp.exportadoEn
  && (imp.vista === undefined || previa.vista === imp.vista);

/** Mismo archivo, pero lo guardado es de antes de §0 o de otra vista: se ofrece "Reimportar". */
export const esReimportacion = (
  previa: Pick<CuentaVivaBalanz, 'comitente' | 'exportadoEn' | 'vista'> | null,
  imp: Pick<ImportacionMisInstrumentos, 'comitente' | 'exportadoEn' | 'vista'>,
) => !!previa && previa.comitente === imp.comitente && previa.exportadoEn === imp.exportadoEn
  && imp.vista !== undefined && previa.vista !== imp.vista;

/**
 * Diferencias de cantidad contra la importación anterior de la MISMA comitente → `compra` /
 * `venta` inferidas (`origen: 'archivo_balanz'`, `inferido: true`). No son flujos (§C): una venta
 * es un cambio dentro de la cartera. Sin importación anterior no se infiere nada.
 *
 * `montoNeto` es una estimación: |Δ| × precio en USD del archivo nuevo (o, si el ticker
 * desapareció, el precio implícito de la importación anterior). El monto real lo trae el archivo
 * de Movimientos (H3c).
 */
export function movimientosInferidos(
  anteriores: PosicionRaw[] | null,
  imp: ImportacionMisInstrumentos,
  /**
   * F9.196.1 §0 — false si lo anterior no es confiable (un archivo en pesos guardado como dólares):
   * se comparan solo cantidades y el monto se estima con el precio del archivo NUEVO; un ticker que
   * desapareció queda sin monto (0) en vez de valuarse con precios inflados.
   */
  opciones: { preciosAnteriores?: boolean } = {},
): MovimientoCuenta[] {
  const usarAnteriores = opciones.preciosAnteriores !== false;
  if (!anteriores) return [];
  const clave = (p: Pick<PosicionRaw, 'ticker' | 'tipo'>) => `${p.ticker.trim().toUpperCase()}|${p.tipo}`;
  const cant = (xs: PosicionRaw[]) => {
    const m = new Map<string, { cantidad: number; unit: number | null; p: PosicionRaw }>();
    for (const p of xs) {
      const k = clave(p);
      const prev = m.get(k);
      const q = (prev?.cantidad ?? 0) + (p.cantidad ?? 0);
      const unit = p.cantidad ? p.valor_origen / p.cantidad : prev?.unit ?? null;
      m.set(k, { cantidad: q, unit, p });
    }
    return m;
  };
  const antes = cant(anteriores);
  const ahora = cant(imp.posiciones);
  const fecha = imp.exportadoEn.slice(0, 10);
  const out: MovimientoCuenta[] = [];
  for (const k of new Set([...antes.keys(), ...ahora.keys()])) {
    const a = antes.get(k);
    const b = ahora.get(k);
    const delta = (b?.cantidad ?? 0) - (a?.cantidad ?? 0);
    if (Math.abs(delta) < 1e-9) continue;
    const ref = (b ?? a)!;
    const unit = b?.unit ?? (usarAnteriores ? a?.unit ?? null : null);
    const cantidad = Math.abs(delta);
    out.push({
      id: `balanz_${imp.comitente}_${imp.exportadoEn.replace(/\D/g, '').slice(0, 14)}_${k.replace(/[^A-Za-z0-9]/g, '_')}`,
      fecha, cuenta: imp.cuenta, tipo: delta > 0 ? 'compra' : 'venta',
      ticker: ref.p.ticker, cantidad, precio: unit, moneda: 'USD',
      montoNeto: unit !== null ? Math.round(cantidad * unit * 100) / 100 : 0,
      origen: 'archivo_balanz', inferido: true,
      tipoActivo: ref.p.tipo, paisRiesgo: ref.p.pais_riesgo,
      nota: `Inferido: ${a?.cantidad ?? 0} → ${b?.cantidad ?? 0} entre importaciones de Mis Instrumentos (monto estimado con el precio del archivo)`,
    });
  }
  return out.sort((x, y) => (x.ticker ?? '').localeCompare(y.ticker ?? ''));
}

// ── Control contra la app ────────────────────────────────────────────────────

/** Diferencia total a partir de la cual se avisa (Addendum 2 §A). */
export const UMBRAL_CONTROL = 0.02;
/** Más de este factor entre app y archivo = escalas distintas; se lista aparte, no entra al total. */
const FACTOR_ESCALA = 5;

export type ControlEspecie = {
  ticker: string;
  valorArchivoUsd: number;
  valorAppUsd: number | null;
  difPct: number | null;
  nota: 'sin_precio_app' | 'escala_distinta' | 'sin_tc' | 'valor_archivo_cero' | null;
  precioAppFecha: string | null;
};

export type ControlBalanz = {
  especies: ControlEspecie[];
  totalArchivoUsd: number;
  /** Solo las especies comparables (con precio en la app y escala compatible). */
  totalArchivoComparableUsd: number;
  totalAppComparableUsd: number;
  difTotalPct: number | null;
  supera: boolean;
};

/**
 * El valor del archivo contra el de la app con los precios del momento (`indicadoresPosicion`:
 * último cierre, en la moneda de la serie). Si la diferencia total supera el 2% se avisa con el
 * detalle por especie. No corrige nada.
 */
export function controlContraApp(
  imp: ImportacionMisInstrumentos,
  precioDe: (p: PosicionRaw) => PrecioDia | null,
  tc: number | null,
): ControlBalanz {
  const especies: ControlEspecie[] = imp.posiciones.map(p => {
    const archivo = p.valor_origen;
    const pd = precioDe(p);
    const base = { ticker: p.ticker, valorArchivoUsd: archivo, precioAppFecha: pd?.fecha ?? null };
    if (!pd || p.cantidad === null) return { ...base, valorAppUsd: null, difPct: null, nota: 'sin_precio_app' as const };
    if (pd.moneda === 'ARS' && !(tc && tc > 0)) return { ...base, valorAppUsd: null, difPct: null, nota: 'sin_tc' as const };
    const app = p.cantidad * (pd.moneda === 'USD' ? pd.precio : pd.precio / tc!);
    if (!(archivo > 0)) return { ...base, valorAppUsd: app, difPct: null, nota: 'valor_archivo_cero' as const };
    const r = app / archivo;
    if (r > FACTOR_ESCALA || r < 1 / FACTOR_ESCALA) {
      return { ...base, valorAppUsd: app, difPct: r - 1, nota: 'escala_distinta' as const };
    }
    return { ...base, valorAppUsd: app, difPct: r - 1, nota: null };
  });
  const comparables = especies.filter(e => e.nota === null && e.valorAppUsd !== null);
  const totalArchivoComparableUsd = comparables.reduce((a, e) => a + e.valorArchivoUsd, 0);
  const totalAppComparableUsd = comparables.reduce((a, e) => a + (e.valorAppUsd ?? 0), 0);
  const difTotalPct = totalArchivoComparableUsd > 0 ? totalAppComparableUsd / totalArchivoComparableUsd - 1 : null;
  return {
    especies,
    totalArchivoUsd: imp.valorUsdBalanz,
    totalArchivoComparableUsd, totalAppComparableUsd, difTotalPct,
    supera: difTotalPct !== null && Math.abs(difTotalPct) > UMBRAL_CONTROL,
  };
}

// ── F9.196.1 §0: vista en dólares o en pesos ─────────────────────────────────

export type VistaBalanz = 'USD' | 'ARS';

/** Los FCI en dólares no cambian entre las dos vistas. */
export const sigueEnUsd = (f: Pick<FilaMisInstrumentos, 'tipoCrudo' | 'monedaCotizacion'>) =>
  f.tipoCrudo === 'Fondos' && f.monedaCotizacion === 'USD';

/** Especies comparables mínimas para decidir con los precios de la app. */
export const MIN_ESPECIES_PRECIOS_APP = 3;
/** Banda alrededor de 1 (o de 1/tc, tc) dentro de la que una mediana decide la vista. */
const BANDA_VISTA: [number, number] = [0.5, 2];

export type ResultadoMetodo = { vista: VistaBalanz | 'fuera_de_banda'; mediana: number; especies: number } | null;

export type DeteccionVista = {
  vista: VistaBalanz | 'desconocida';
  metodo: 'precios_app' | 'importacion_anterior' | null;
  mediana: number | null;
  especiesUsadas: number;
  /** Lo que dio cada referencia (para mostrar por qué quedó desconocida). */
  preciosApp: ResultadoMetodo;
  importacionAnterior: ResultadoMetodo;
};

const mediana = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function clasificar(med: number, usd: [number, number], ars: [number, number] | null): VistaBalanz | 'fuera_de_banda' {
  if (med >= usd[0] && med <= usd[1]) return 'USD';
  if (ars && med >= ars[0] && med <= ars[1]) return 'ARS';
  return 'fuera_de_banda';
}

/**
 * ¿En qué vista vino el archivo? Sobre las filas que NO son FCI en dólares (esas no cambian):
 * - precios de la app (3 o más especies): r = valorApp ÷ valorArchivo; mediana en [0,5; 2] → USD,
 *   en [0,5 ÷ tc; 2 ÷ tc] → ARS;
 * - la importación anterior de la misma comitente (guardada en USD), especies con igual cantidad:
 *   precioNuevo ÷ precioGuardado; en [0,5; 2] → USD, en [0,5 × tc; 2 × tc] → ARS.
 * Si las dos dan resultado y no coinciden, o la que hay cae fuera de las bandas: 'desconocida'.
 * Nunca se adivina.
 */
export function detectarVista(
  imp: ImportacionMisInstrumentos,
  refs: {
    precioDe: (p: PosicionRaw) => PrecioDia | null;
    /** MEP de la cartera viva (ARS por USD). Sin él no se puede reconocer la vista en pesos. */
    tc: number | null;
    /** Solo una importación anterior CONFIABLE (`previaConfiable`), con sus valores en USD. */
    previa: Pick<CuentaVivaBalanz, 'posiciones'> | null;
  },
): DeteccionVista {
  const tc = refs.tc && refs.tc > 0 ? refs.tc : null;
  const filaDe = new Map(imp.filas.map(f => [f.ticker, f]));
  const cambian = imp.posiciones.filter(p => { const f = filaDe.get(p.ticker); return f && !sigueEnUsd(f); });

  // 1. Precios de la app.
  const rs: number[] = [];
  for (const p of cambian) {
    const pd = refs.precioDe(p);
    if (!pd || !p.cantidad || !(p.valor_origen > 0)) continue;
    if (pd.moneda === 'ARS' && !tc) continue;
    const app = p.cantidad * (pd.moneda === 'USD' ? pd.precio : pd.precio / tc!);
    if (app > 0) rs.push(app / p.valor_origen);
  }
  const preciosApp: ResultadoMetodo = rs.length >= MIN_ESPECIES_PRECIOS_APP
    ? (() => { const m = mediana(rs); return { vista: clasificar(m, BANDA_VISTA, tc ? [BANDA_VISTA[0] / tc, BANDA_VISTA[1] / tc] : null), mediana: m, especies: rs.length }; })()
    : null;

  // 2. La importación anterior (en USD), especies con la misma cantidad.
  const qs: number[] = [];
  if (refs.previa) {
    const prev = new Map(refs.previa.posiciones.filter(p => p.cantidad).map(p => [`${p.ticker}|${p.tipo}`, p]));
    for (const p of cambian) {
      const a = prev.get(`${p.ticker}|${p.tipo}`);
      if (!a || !a.cantidad || !p.cantidad || Math.abs(a.cantidad - p.cantidad) > 1e-9 || !(a.valor_origen > 0)) continue;
      qs.push((p.valor_origen / p.cantidad) / (a.valor_origen / a.cantidad));
    }
  }
  const importacionAnterior: ResultadoMetodo = qs.length >= 1
    ? (() => { const m = mediana(qs); return { vista: clasificar(m, BANDA_VISTA, tc ? [BANDA_VISTA[0] * tc, BANDA_VISTA[1] * tc] : null), mediana: m, especies: qs.length }; })()
    : null;

  const base = { preciosApp, importacionAnterior };
  const desconocida: DeteccionVista = { vista: 'desconocida', metodo: null, mediana: null, especiesUsadas: 0, ...base };
  // Solo cuentan las referencias que dieron una vista (dentro de banda). Dos que dan vistas distintas
  // se contradicen; una fuera de banda no dijo nada y no anula a la otra.
  const validas = ([['precios_app', preciosApp], ['importacion_anterior', importacionAnterior]] as const)
    .filter((x): x is readonly ['precios_app' | 'importacion_anterior', { vista: VistaBalanz; mediana: number; especies: number }] => !!x[1] && x[1].vista !== 'fuera_de_banda');
  if (!validas.length) return desconocida;
  if (validas.length === 2 && validas[0][1].vista !== validas[1][1].vista) return desconocida;
  const [metodo, r] = validas[0];
  return { vista: r.vista, metodo, mediana: r.mediana, especiesUsadas: r.especies, ...base };
}

/** Las dos referencias dieron vistas distintas (dentro de banda): para explicar el "desconocida". */
export const seContradicen = (d: DeteccionVista) => !!d.preciosApp && !!d.importacionAnterior
  && d.preciosApp.vista !== 'fuera_de_banda' && d.importacionAnterior.vista !== 'fuera_de_banda'
  && d.preciosApp.vista !== d.importacionAnterior.vista;

/**
 * Mediana de valorApp ÷ valorGuardado por especie (3 o más), para verificar lo guardado cuando no
 * hay corrida contra la cual medirlo. null si no alcanza.
 */
export function medianaContraApp(
  posiciones: PosicionRaw[], precioDe: (p: PosicionRaw) => PrecioDia | null, tc: number | null,
): number | null {
  const rs: number[] = [];
  for (const p of posiciones) {
    const pd = precioDe(p);
    if (!pd || !p.cantidad || !(p.valor_origen > 0)) continue;
    if (pd.moneda === 'ARS' && !(tc && tc > 0)) continue;
    const app = p.cantidad * (pd.moneda === 'USD' ? pd.precio : pd.precio / tc!);
    if (app > 0) rs.push(app / p.valor_origen);
  }
  return rs.length >= MIN_ESPECIES_PRECIOS_APP ? mediana(rs) : null;
}

/**
 * ¿Sirve la importación guardada como referencia (de vista y de costos en USD)? Sí si se guardó
 * con `vista` (ya está en USD). Si es de antes de §0, solo si su total es razonable contra la
 * corrida de esa comitente: un archivo en pesos guardado como dólares la infla ~1.500 veces.
 */
export type MotivoPrevia = 'con_vista' | 'razonable' | 'inflada' | 'sin_verificar' | 'ninguna';

/**
 * Por qué lo guardado sirve (o no) de referencia. Sin `vista`: contra la corrida de esa comitente
 * y, si la comitente no está en la corrida, contra los precios de la app (`medianaApp` =
 * valorApp ÷ valorGuardado). Lo que no se puede medir queda `sin_verificar` (no se usa, pero no se
 * dice que esté inflado).
 */
export function motivoPrevia(
  previa: Pick<CuentaVivaBalanz, 'vista' | 'valorUsdBalanz'> | null,
  totalCorridaUsd: number,
  medianaApp: number | null = null,
): MotivoPrevia {
  if (!previa) return 'ninguna';
  if (previa.vista) return 'con_vista';
  if (totalCorridaUsd > 0 && previa.valorUsdBalanz > 0) {
    const r = previa.valorUsdBalanz / totalCorridaUsd;
    return r <= FACTOR_INFLADA && r >= 1 / FACTOR_INFLADA ? 'razonable' : 'inflada';
  }
  if (medianaApp !== null) {
    if (medianaApp >= BANDA_VISTA[0] && medianaApp <= BANDA_VISTA[1]) return 'razonable';
    if (medianaApp < 1 / FACTOR_INFLADA) return 'inflada';
  }
  return 'sin_verificar';
}

export const previaConfiable = (
  previa: Pick<CuentaVivaBalanz, 'vista' | 'valorUsdBalanz'> | null, totalCorridaUsd: number, medianaApp: number | null = null,
) => { const m = motivoPrevia(previa, totalCorridaUsd, medianaApp); return m === 'con_vista' || m === 'razonable'; };

/** Último día hábil (lunes a viernes) en o antes de la fecha: el de los precios de un archivo de fin de semana. */
export function diaHabilHasta(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * El MEP del día del archivo (el cierre del último día hábil en o antes de su fecha). Primero el de
 * la cartera viva si es ese y no es de respaldo; si no, el doc de `tcDiario` que guarda ese cierre
 * (convención D−1: el doc `X` guarda el cierre de `diaHabilAnterior(X)`). No es un TC viejo: es el
 * del día de los precios del archivo. Sin ninguno de los dos, null (no se convierte).
 */
export function mepDelArchivo(
  fechaArchivo: string,
  cv: TcCarteraViva | null,
  tcDiario: Array<{ id: string; tcUsdArs: number }>,
): TcCarteraViva | null {
  const dia = diaHabilHasta(fechaArchivo);
  if (cv && !cv.viejo && cv.valor > 0 && cv.fechaCotizacion === dia) return cv;
  const doc = tcDiario
    .filter(d => d.id > dia && Number.isFinite(d.tcUsdArs) && d.tcUsdArs > 0 && diaHabilAnterior(d.id) === dia)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  return doc ? { valor: doc.tcUsdArs, fuente: 'tcDiario', fechaCotizacion: dia, viejo: false } : null;
}

/** Una cuenta viva de Balanz que vale más de esto veces la corrida de su comitente está inflada. */
export const FACTOR_INFLADA = 50;

/**
 * §0.6 — solo informa: las `cuentasVivas/balanz_*` cuya suma de `valor_origen` supera 50 veces la
 * de la corrida de esa comitente (un archivo en pesos guardado como dólares antes de §0).
 */
export function cuentasBalanzInfladas(
  cuentas: Array<Pick<CuentaVivaBalanz, 'comitente' | 'cuenta' | 'posiciones' | 'exportadoEn' | 'vista'>>,
  corrida: Array<Pick<PosicionRaw, 'cuenta' | 'valor_origen' | 'moneda_origen' | 'tipo'>>,
  tc: number | null,
): Array<{ comitente: string; exportadoEn: string; sumaCuentaViva: number; sumaCorrida: number; factor: number }> {
  const out: Array<{ comitente: string; exportadoEn: string; sumaCuentaViva: number; sumaCorrida: number; factor: number }> = [];
  for (const c of cuentas) {
    const suma = c.posiciones.reduce((a, p) => a + (p.valor_origen ?? 0), 0);
    const sumaCorrida = corrida
      .filter(p => p.cuenta === c.cuenta && p.tipo !== 'cash')
      .reduce((a, p) => a + (p.moneda_origen === 'USD' ? p.valor_origen : tc && tc > 0 ? p.valor_origen / tc : 0), 0);
    if (sumaCorrida > 0 && suma > FACTOR_INFLADA * sumaCorrida) {
      out.push({ comitente: c.comitente, exportadoEn: c.exportadoEn, sumaCuentaViva: suma, sumaCorrida, factor: suma / sumaCorrida });
    }
  }
  return out;
}

/** Total del archivo leído de las dos formas, para que Juan elija cuando la vista es desconocida. */
export function totalesPorVista(imp: ImportacionMisInstrumentos, tc: number | null): { siUsd: number; siArs: number | null } {
  const siUsd = imp.filas.reduce((a, f) => a + f.valorActualUsd, 0);
  const siArs = tc && tc > 0 ? imp.filas.reduce((a, f) => a + (sigueEnUsd(f) ? f.valorActualUsd : f.valorActualUsd / tc), 0) : null;
  return { siUsd: Math.round(siUsd * 100) / 100, siArs: siArs === null ? null : Math.round(siArs * 100) / 100 };
}

/**
 * Lee el archivo según su vista.
 * - 'USD': como siempre; los costos son de este archivo (`costoUsdDel` = su exportación).
 * - 'ARS': `Precio` y `Valor actual` ÷ MEP del día (salvo FCI en dólares). El costo NO se convierte
 *   (pesos históricos): se conserva el `costoPromedio` en USD de la importación anterior confiable,
 *   por ticker; sin él, sin costo en USD (`costo_en_pesos_historicos`) y el crudo en `costoPromedioArs`.
 *   Sin MEP del día (de la fecha del archivo, no viejo) no se lee: devuelve `error`.
 */
export function aplicarVista(
  imp: ImportacionMisInstrumentos,
  vista: VistaBalanz,
  ctx: {
    mep: TcCarteraViva | null;
    previa: Pick<CuentaVivaBalanz, 'costoPromedio' | 'costoUsdDel' | 'exportadoEn' | 'vista'> | null;
  },
): { imp: ImportacionMisInstrumentos; error: null } | { imp: null; error: string } {
  if (vista === 'USD') {
    return { imp: { ...imp, vista: 'USD', tcConversion: null, costoUsdDel: imp.exportadoEn }, error: null };
  }
  const mep = ctx.mep;
  const dia = diaHabilHasta(imp.exportadoEn.slice(0, 10));
  const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
  if (!mep || !(mep.valor > 0)) {
    return { imp: null, error: `El archivo está en pesos y no hay MEP del ${ddmm(dia)} (ni en la cartera viva ni en el historial de dólar): no se convierte con un dólar de otro día. Si es de hoy, tocá "Calcular valor de hoy" y volvé a subirlo; si no, exportalo en dólares.` };
  }
  if (mep.viejo || mep.fechaCotizacion !== dia) {
    return { imp: null, error: `El archivo está en pesos (precios del ${ddmm(dia)}) y el MEP disponible es del ${ddmm(mep.fechaCotizacion)}${mep.viejo ? ' (de respaldo)' : ''}: no se convierte con un dólar de otro día. Si es de hoy, tocá "Calcular valor de hoy"; si no, exportalo en dólares.` };
  }
  const tc = mep.valor;
  const filas = imp.filas.map(f => {
    if (sigueEnUsd(f)) return { ...f, valorArchivoArs: null };
    return {
      ...f, valorArchivoArs: f.valorActualUsd,
      precioUsd: f.precioUsd / tc, valorActualUsd: f.valorActualUsd / tc,
      difRedondeoUsd: f.difRedondeoUsd / tc,
      costoPromedioUsd: null, valorInicialUsd: null,
    };
  });
  const filaDe = new Map(filas.map(f => [f.ticker, f]));
  const posiciones = imp.posiciones.map(p => {
    const f = filaDe.get(p.ticker);
    return f && !sigueEnUsd(f) ? { ...p, valor_origen: p.valor_origen / tc } : p;
  });
  const costosPrevios = ctx.previa?.costoPromedio ?? {};
  const costoPromedio: Record<string, number> = {};
  const costoPromedioArs: Record<string, number> = {};
  const costoMotivo: Record<string, 'costo_en_pesos_historicos'> = {};
  const valorArchivoArs: Record<string, number> = {};
  for (const f of imp.filas) {
    if (sigueEnUsd(f)) { if (imp.costoPromedio[f.ticker] !== undefined) costoPromedio[f.ticker] = imp.costoPromedio[f.ticker]; continue; }
    valorArchivoArs[f.ticker] = f.valorActualUsd;
    if (imp.costoPromedio[f.ticker] !== undefined) costoPromedioArs[f.ticker] = imp.costoPromedio[f.ticker];
    if (costosPrevios[f.ticker] !== undefined) costoPromedio[f.ticker] = costosPrevios[f.ticker];
    else costoMotivo[f.ticker] = 'costo_en_pesos_historicos';
  }
  const noCuadran = filas.filter(f => f.difRedondeoUsd > TOLERANCIA_VALOR_USD).map(f =>
    `${f.ticker}: Nominales × Precio y Valor actual difieren ${f.difRedondeoUsd.toFixed(2)} USD (convertido con el MEP).`);
  return {
    imp: {
      ...imp, filas, posiciones, costoPromedio, noCuadran,
      valorUsdBalanz: Math.round(filas.reduce((a, f) => a + f.valorActualUsd, 0) * 100) / 100,
      vista: 'ARS', tcConversion: { valor: tc, fecha: mep.fechaCotizacion, fuente: mep.fuente },
      valorArchivoArs, costoPromedioArs, costoMotivo,
      costoUsdDel: ctx.previa ? (ctx.previa.costoUsdDel ?? (ctx.previa.vista === 'ARS' ? null : ctx.previa.exportadoEn)) : null,
    },
    error: null,
  };
}
