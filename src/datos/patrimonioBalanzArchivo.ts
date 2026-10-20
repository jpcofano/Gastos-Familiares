// F9.196 Addendum 2 §A (H2b) — Balanz por archivo: "Mis Instrumentos" (.xlsx), sin LLM.
//
// Funciones PURAS: reciben las filas ya leídas del .xlsx (array de arrays) y devuelven la forma
// normalizada de `cuentasVivas` (§1). La lectura del archivo y la escritura en Firestore están en
// src/datos/patrimonioCuentasVivas.ts; la UI en src/vistas/PatrimonioBalanz.tsx.
//
// Semántica verificada con las muestras reales (Addendum 2 §A):
// - `Valor actual` = Nominales × Precio, en USD, para TODAS las especies (también las que cotizan
//   en pesos). `Precio` = USD por unidad nominal (bonos por 1 VN, no por 100).
// - `Precio promedio de compra` = costo promedio en USD por unidad → `costoPromedio`.
// - `Moneda` es la moneda de COTIZACIÓN del instrumento, no la de `Valor actual`.
// - No trae caja.
// - No crea una corrida: alimenta solo la cartera viva (F9.189 §1 sigue intacto).
import type { PosicionRaw, PosicionTipo, PaisRiesgo } from '../types/patrimonio';
import type { CuentaViva, PrecioDia } from './patrimonioCarteraViva';
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

const normEnc = (x: unknown) => String(x ?? '').trim();

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

/** Número de una celda: number tal cual; texto en formato argentino ("1.234,56") o plano. */
export function numeroCelda(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x !== 'string') return null;
  let s = x.trim().replace(/[^\d,.\-]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
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
  /** `Valor actual` contra `Nominales × Precio`, en USD. */
  difRedondeoUsd: number;
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
  /** Filas con tipo desconocido: no entran a `posiciones`, se muestran con el texto crudo. */
  paraRevisar: Array<{ ticker: string; motivo: string }>;
  avisos: string[];
};

/** Tolerancia de redondeo entre `Nominales × Precio` y `Valor actual` (Addendum 2: 1 USD). */
export const TOLERANCIA_VALOR_USD = 1;

/**
 * Parser de "Mis Instrumentos". Falla con el nombre del encabezado si falta alguno. Un tipo
 * desconocido no se descarta en silencio: queda en `paraRevisar` con el texto crudo.
 */
export function parsearMisInstrumentos(
  filas: unknown[][],
  ctx: { comitente: string; exportadoEn: string; clasificaciones: Map<string, Clasificacion> },
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
    const tipo = TIPO_BALANZ[tipoCrudo] ?? null;
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
      avisos.push(`${ticker}: Nominales × Precio = ${(nominales * precio).toFixed(2)} y Valor actual = ${va.toFixed(2)} (difieren ${difRedondeoUsd.toFixed(2)} USD).`);
    }
    if (monedaCotizacion === null) avisos.push(`${ticker}: moneda de cotización desconocida «${monedaCruda}».`);
    if (!tipo) {
      paraRevisar.push({ ticker, motivo: `Tipo de Instrumento desconocido: «${tipoCrudo}»` });
      return;
    }

    const clas = ctx.clasificaciones.get(claveClasificacion(ticker, tipo)) ?? null;
    posiciones.push({
      cuenta, titular: null, ticker, tipo,
      sector: clas?.sector ?? '',
      pais_riesgo: clas?.pais_riesgo ?? 'AR',
      moneda_origen: 'USD', valor_origen: va, cantidad: nominales,
      fuente: 'archivo_balanz', revisar: !clas,
      motivo_revisar: clas ? null : `Sector y país desconocidos para ${ticker} (${tipoCrudo}): no está en la corrida ni en la importación anterior`,
    });
    if (ppc !== null && ppc > 0) costoPromedio[ticker] = ppc;
  });

  const valorUsdBalanz = Math.round(out.reduce((a, f) => a + f.valorActualUsd, 0) * 100) / 100;
  return {
    comitente: ctx.comitente, cuenta, exportadoEn: ctx.exportadoEn,
    filas: out, posiciones, costoPromedio, valorUsdBalanz, paraRevisar, avisos,
  };
}

/** Clasificaciones conocidas: primero la importación anterior, después la corrida (misma cuenta antes que otra). */
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
  anteriores.forEach(poner);
  corrida.filter(p => p.cuenta === cuenta).forEach(poner);
  corrida.forEach(poner);
  return m;
}

/** El documento de `cuentasVivas/balanz_<comitente>`. Forma normalizada de §1 + control. */
export type CuentaVivaBalanz = CuentaViva & {
  fuente: 'archivo_balanz';
  comitente: string;
  exportadoEn: string;
  valorUsdBalanz: number;
  paraRevisar: Array<{ ticker: string; motivo: string }>;
};

export function cuentaVivaDeImportacion(imp: ImportacionMisInstrumentos): CuentaVivaBalanz {
  return {
    cuenta: imp.cuenta, fuente: 'archivo_balanz', leidoEn: imp.exportadoEn,
    posiciones: imp.posiciones, costoPromedio: imp.costoPromedio, error: null,
    comitente: imp.comitente, exportadoEn: imp.exportadoEn,
    valorUsdBalanz: imp.valorUsdBalanz, paraRevisar: imp.paraRevisar,
  };
}

/** Mismo archivo (misma comitente, fecha y hora de exportación) → no cambia nada. */
export const esMismaImportacion = (
  previa: Pick<CuentaVivaBalanz, 'comitente' | 'exportadoEn'> | null,
  imp: Pick<ImportacionMisInstrumentos, 'comitente' | 'exportadoEn'>,
) => !!previa && previa.comitente === imp.comitente && previa.exportadoEn === imp.exportadoEn;

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
): MovimientoCuenta[] {
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
    const unit = b?.unit ?? a?.unit ?? null;
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
  nota: 'sin_precio_app' | 'escala_distinta' | 'sin_tc' | null;
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
    const r = archivo > 0 ? app / archivo : null;
    if (r !== null && (r > FACTOR_ESCALA || r < 1 / FACTOR_ESCALA)) {
      return { ...base, valorAppUsd: app, difPct: r - 1, nota: 'escala_distinta' as const };
    }
    return { ...base, valorAppUsd: app, difPct: archivo > 0 ? app / archivo - 1 : null, nota: null };
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
