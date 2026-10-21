// F9.196 Addendum 2 §B (H3c) — Balanz: archivo de Movimientos (.xlsx de la pestaña "Movimientos").
//
// Funciones PURAS: reciben las filas ya leídas (array de arrays, fila 1 = encabezados) y devuelven:
// - la clasificación de cada fila por el texto de `Descripcion` (tabla del Addendum 2 §B);
// - los `movimientosCuenta` que se registran (un boleto = un movimiento aunque venga en varias filas);
// - la caja ANCLADA: caja de la última corrida de la comitente + Importe de lo liquidado después.
//
// ⛔ No se inventan reglas: lo que no matchea la tabla queda `para_revisar` con el texto crudo.
import type { Posicion, PosicionTipo } from '../types/patrimonio';
import { hashId, type MovimientoCuenta } from './patrimonioMovimientos';
import { cuentaDeComitente } from './patrimonioBalanzArchivo';

export const ENCABEZADOS_MOVIMIENTOS_BALANZ = [
  'Descripcion', 'Ticker', 'Tipo de Instrumento', 'Concertacion', 'Cantidad', 'Precio',
  'Liquidacion', 'Moneda', 'Importe',
] as const;

export type ClaseBalanz =
  | 'deposito' | 'retiro' | 'anula_retiro'
  | 'compra' | 'venta' | 'caucion'
  | 'renta' | 'gasto' | 'ajuste_caja'
  | 'fci_caja' | 'fci_tenencia'
  | 'transferencia_titulos'
  | 'para_revisar';

export type FilaMovBalanz = {
  /** Fila del archivo (1 = encabezados). */
  fila: number;
  descripcion: string;
  ticker: string | null;
  tipoInstrumento: string | null;
  concertacion: string;
  cantidad: number;
  precio: number | null;          // null cuando Balanz pone -1 (fila solo de dinero)
  liquidacion: string;
  monedaCruda: string;            // '' en las transferencias de títulos
  moneda: 'ARS' | 'USD' | null;
  importe: number;
  clase: ClaseBalanz;
  /** Detalle de la clase: 'contado'/'futuro' (caución), 'credito'/'debito', 'suscripcion'/'rescate', 'amortizacion'. */
  detalle: string | null;
  /** Número de boleto / comprobante / recibo, si la descripción lo trae. */
  numero: string | null;
  /**
   * Cuántas filas IDÉNTICAS (misma clave de §B) aparecieron antes en el mismo archivo. Dos filas
   * legítimas iguales (dos "Ajuste de saldo" de 100 el mismo día) son dos filas; la clave de §B sirve
   * para que exportes que se pisan no dupliquen, y eso lo garantiza el id (clave + ocurrencia).
   */
  ocurrencia: number;
};

const MONEDAS: Record<string, 'ARS' | 'USD'> = {
  Pesos: 'ARS', 'Dólares': 'USD', 'Dólares C.V. 7000': 'USD', 'US Dollar (Cable)': 'USD',
};

const TIPO_INSTRUMENTO: Record<string, PosicionTipo> = {
  Acciones: 'accion', Cedears: 'cedear', Bonos: 'bono', Corporativos: 'on', Fondos: 'fci',
};

/**
 * Clasificación por el texto de `Descripcion` (tabla del Addendum 2 §B). Se compara el tramo
 * antes del primer " / " y, para "Boleto" y "Movimiento Manual", el tramo que sigue.
 */
export function clasificarDescripcion(desc: string): { clase: ClaseBalanz; detalle: string | null; numero: string | null } {
  const partes = desc.split(' / ').map(s => s.trim());
  const p0 = partes[0];
  const numero = /^\d+$/.test(partes[1] ?? '') ? partes[1] : null;
  if (p0 === 'Recibo de Cobro') return { clase: 'deposito', detalle: null, numero };
  if (p0 === 'Comprobante de Pago') return { clase: 'retiro', detalle: null, numero };
  if (p0 === 'Boleto') {
    const op = partes[2] ?? '';
    if (op === 'COMPRA' || op === 'COMPRAEXT') return { clase: 'compra', detalle: op === 'COMPRAEXT' ? 'exterior' : null, numero };
    if (op === 'VENTA') return { clase: 'venta', detalle: null, numero };
    if (op === 'APCOLCON') return { clase: 'caucion', detalle: 'contado', numero };
    if (op === 'APCOLFUT') return { clase: 'caucion', detalle: 'futuro', numero };
    return { clase: 'para_revisar', detalle: null, numero };
  }
  if (p0 === 'Dividendo en efectivo' || p0 === 'Renta') return { clase: 'renta', detalle: null, numero: null };
  if (p0 === 'Amortización' || p0 === 'Renta y Amortización') return { clase: 'renta', detalle: 'amortizacion', numero: null };
  if (p0.startsWith('Cargo por Descubierto')) return { clase: 'gasto', detalle: 'descubierto', numero: null };
  if (p0 === 'Movimiento Manual') {
    const p1 = partes.slice(1).join(' / ');
    if (p1 === 'Devolucion por rechazo de transferencia') return { clase: 'anula_retiro', detalle: null, numero: null };
    if (p1.startsWith('N/D Ret IIGG y BBPP')) return { clase: 'gasto', detalle: 'retencion', numero: null };
    if (p1.startsWith('Conversión CV 7.000 a CV 10.000') || p1 === 'Renta CV 7.000 a Cable'
      || p1 === 'Liquidación con conversión' || p1 === 'Ajuste de saldo') {
      return { clase: 'ajuste_caja', detalle: null, numero: null };
    }
    return { clase: 'para_revisar', detalle: null, numero: null };
  }
  if (p0 === 'Liquidación de Suscripción') return { clase: 'fci_caja', detalle: 'suscripcion', numero };
  if (p0 === 'Liquidación de Rescate') return { clase: 'fci_caja', detalle: 'rescate', numero };
  if (p0 === 'Suscripción desde Balanz') return { clase: 'fci_tenencia', detalle: 'suscripcion', numero: null };
  if (p0 === 'Rescate a Balanz') return { clase: 'fci_tenencia', detalle: 'rescate', numero: null };
  if (p0 === 'Transferencia Externa (Crédito)') return { clase: 'transferencia_titulos', detalle: 'credito', numero: null };
  if (p0 === 'Transferencia Externa (Débito)') return { clase: 'transferencia_titulos', detalle: 'debito', numero: null };
  return { clase: 'para_revisar', detalle: null, numero: null };
}

const txt = (x: unknown) => String(x ?? '').trim();
const num = (x: unknown): number | null => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const s = txt(x).replace(/\./g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Clave de duplicado del Addendum 2 §B: `(comitente, Descripcion, Concertacion, Moneda, Importe, Cantidad)`. */
export const claveFilaBalanz = (comitente: string, f: Pick<FilaMovBalanz, 'descripcion' | 'concertacion' | 'monedaCruda' | 'importe' | 'cantidad'>) =>
  [comitente, f.descripcion, f.concertacion, f.monedaCruda, f.importe.toFixed(2), String(f.cantidad)].join('|');

/** Id de Firestore de una fila: clave de §B + ocurrencia. Igual en dos exportes que se pisan. */
export const idFilaBalanz = (comitente: string, f: FilaMovBalanz) =>
  `bzmov_${comitente}_${hashId(`${claveFilaBalanz(comitente, f)}#${f.ocurrencia}`)}`;

/**
 * Ids de los `Comprobante de Pago` anulados por una devolución. Si un export anterior los guardó
 * como retiro, hay que BORRARLOS: si no, quedan como candidatos de §C aunque ya no existan.
 */
export function idsAnulados(filas: FilaMovBalanz[], comitente: string, anuladas: Set<number>): string[] {
  return filas.filter(f => anuladas.has(f.fila) && f.clase === 'retiro').map(f => idFilaBalanz(comitente, f));
}

// F9.196 H2 — `hashId` vive en ./compartido/patrimonioMovimientos (lo usan también las Functions).
export { hashId };

/**
 * Lee las filas del archivo. Falla con el nombre del encabezado si falta alguno. Las filas
 * repetidas (misma clave de §B, por ejemplo de dos exportes que se pisan) se cuentan una vez.
 */
export function parsearMovimientosBalanz(filas: unknown[][], comitente: string): {
  filas: FilaMovBalanz[];
  /** Filas idénticas dentro del archivo (se conservan; ver `ocurrencia`). */
  duplicadas: number;
  /** Filas con una `Moneda` que no es ninguna de las cuatro conocidas: quedan fuera de la caja. */
  monedasDesconocidas: string[];
} {
  if (!filas.length) throw new Error('El archivo está vacío: no tiene fila de encabezados.');
  const enc = filas[0].map(txt);
  const faltan = ENCABEZADOS_MOVIMIENTOS_BALANZ.filter(e => !enc.includes(e));
  if (faltan.length) throw new Error(`No es un archivo de Movimientos válido: falta el encabezado ${faltan.map(f => `"${f}"`).join(', ')}.`);
  const col = (n: (typeof ENCABEZADOS_MOVIMIENTOS_BALANZ)[number]) => enc.indexOf(n);
  const vistas = new Map<string, number>();
  const out: FilaMovBalanz[] = [];
  const monedasDesconocidas: string[] = [];
  let duplicadas = 0;
  filas.slice(1).forEach((r, i) => {
    const descripcion = txt(r[col('Descripcion')]);
    if (!descripcion) return;
    const monedaCruda = txt(r[col('Moneda')]);
    const precio = num(r[col('Precio')]);
    const { clase, detalle, numero } = clasificarDescripcion(descripcion);
    const f: FilaMovBalanz = {
      fila: i + 2, descripcion,
      ticker: txt(r[col('Ticker')]) || null,
      tipoInstrumento: txt(r[col('Tipo de Instrumento')]) || null,
      concertacion: txt(r[col('Concertacion')]).slice(0, 10),
      cantidad: num(r[col('Cantidad')]) ?? 0,
      precio: precio === -1 ? null : precio,
      liquidacion: txt(r[col('Liquidacion')]).slice(0, 10),
      monedaCruda, moneda: MONEDAS[monedaCruda] ?? null,
      importe: num(r[col('Importe')]) ?? 0,
      clase, detalle, numero, ocurrencia: 0,
    };
    const k = claveFilaBalanz(comitente, f);
    f.ocurrencia = vistas.get(k) ?? 0;
    if (f.ocurrencia) duplicadas++;
    vistas.set(k, f.ocurrencia + 1);
    if (monedaCruda && !f.moneda) monedasDesconocidas.push(`fila ${f.fila}: «${monedaCruda}»`);
    out.push(f);
  });
  return { filas: out, duplicadas, monedasDesconocidas };
}

/**
 * "Devolucion por rechazo de transferencia" anula el `Comprobante de Pago` ANTERIOR del mismo
 * monto (con signo opuesto) y la misma moneda. Se anulan los dos. Devuelve los pares y las
 * devoluciones que no encontraron su comprobante (esas se reportan, no se resuelven solas).
 */
export function aparearDevoluciones(filas: FilaMovBalanz[]): {
  anuladas: Set<number>;
  pares: Array<{ devolucion: FilaMovBalanz; comprobante: FilaMovBalanz }>;
  sinComprobante: FilaMovBalanz[];
} {
  const anuladas = new Set<number>();
  const pares: Array<{ devolucion: FilaMovBalanz; comprobante: FilaMovBalanz }> = [];
  const sinComprobante: FilaMovBalanz[] = [];
  const porFecha = [...filas].sort((a, b) => a.concertacion.localeCompare(b.concertacion) || b.fila - a.fila);
  for (const dv of porFecha.filter(f => f.clase === 'anula_retiro')) {
    const cand = porFecha
      .filter(f => f.clase === 'retiro' && !anuladas.has(f.fila) && f.concertacion <= dv.concertacion
        && f.moneda === dv.moneda && Math.abs(Math.abs(f.importe) - Math.abs(dv.importe)) < 0.005)
      .sort((a, b) => b.concertacion.localeCompare(a.concertacion));
    if (cand.length) {
      anuladas.add(cand[0].fila); anuladas.add(dv.fila);
      pares.push({ devolucion: dv, comprobante: cand[0] });
    } else sinComprobante.push(dv);
  }
  return { anuladas, pares, sinComprobante };
}

/**
 * Los `movimientosCuenta` que deja el archivo:
 * - depósito / retiro: uno por fila (salvo los anulados por una devolución). Son candidatos a
 *   flujo de §C (aporte / retiro), no flujos automáticos.
 * - compra / venta: UNO POR BOLETO, aunque venga en varias filas (una por moneda). Cantidad,
 *   precio y monto salen de la fila con precio; las de otra moneda (comisiones) mueven solo la caja.
 * - FCI: la tenencia sale SOLO de "Suscripción desde Balanz" / "Rescate a Balanz" (compra / venta
 *   de cuotapartes con el ticker de Mis Instrumentos); el lado caja ("Liquidación de …") no genera
 *   movimiento propio.
 * - renta: una por fila de importe positivo; la amortización queda `devolucionCapital`.
 * - transferencia de títulos: depósito (crédito) o retiro (débito) EN ESPECIE, valuado
 *   cantidad × precio del archivo. ⚠ La fila no trae moneda: se asume pesos (para confirmar).
 * - caución, gastos, ajustes y conversiones: no generan movimiento; mueven solo la caja.
 * Ids deterministas: re-importar un archivo que se pisa con otro no duplica.
 */
export function movimientosDeBalanz(filas: FilaMovBalanz[], comitente: string, anuladas: Set<number>): MovimientoCuenta[] {
  const cuenta = cuentaDeComitente(comitente);
  const base = (f: FilaMovBalanz, extra: Partial<MovimientoCuenta>): MovimientoCuenta => ({
    id: idFilaBalanz(comitente, f),
    fecha: f.concertacion, cuenta, moneda: f.moneda ?? 'ARS', origen: 'archivo_balanz',
    idOrigen: f.numero, subcuenta: f.monedaCruda || null, nota: f.descripcion,
    tipo: 'deposito', montoNeto: Math.abs(f.importe), ...extra,
  });
  const out: MovimientoCuenta[] = [];

  for (const f of filas) {
    if (anuladas.has(f.fila)) continue;
    if (f.clase === 'deposito' || f.clase === 'retiro') out.push(base(f, { tipo: f.clase }));
    else if (f.clase === 'renta' && f.importe > 0) {
      out.push(base(f, { tipo: 'renta', ticker: f.ticker, devolucionCapital: f.detalle === 'amortizacion' }));
    } else if (f.clase === 'fci_tenencia') {
      out.push(base(f, {
        tipo: f.detalle === 'rescate' ? 'venta' : 'compra', ticker: f.ticker,
        cantidad: Math.abs(f.cantidad), precio: f.precio, tipoActivo: 'fci',
      }));
    } else if (f.clase === 'transferencia_titulos') {
      const valor = f.precio !== null ? Math.abs(f.cantidad) * f.precio : 0;
      out.push(base(f, {
        tipo: f.detalle === 'debito' ? 'retiro' : 'deposito', ticker: f.ticker, cantidad: Math.abs(f.cantidad),
        precio: f.precio, moneda: f.moneda ?? 'ARS', montoNeto: Math.round(valor * 100) / 100,
        tipoActivo: f.tipoInstrumento ? TIPO_INSTRUMENTO[f.tipoInstrumento] ?? null : null,
        nota: `${f.descripcion} · en especie, valuado cantidad × precio del archivo${f.moneda ? '' : ' (moneda vacía: se asume pesos)'}`,
      }));
    }
  }

  // Boletos de compra / venta: agrupados por número de boleto y operación.
  const boletos = new Map<string, FilaMovBalanz[]>();
  for (const f of filas) {
    if (f.clase !== 'compra' && f.clase !== 'venta') continue;
    // Número + operación + fecha + ticker: dos boletos con el mismo número en otra fecha u otra
    // especie no se funden. Sin número, la clave de la fila (estable entre exportes, no la posición).
    const k = f.numero ? `${f.numero}|${f.clase}|${f.concertacion}|${f.ticker ?? ''}` : `sin_numero|${claveFilaBalanz(comitente, f)}#${f.ocurrencia}`;
    boletos.set(k, [...(boletos.get(k) ?? []), f]);
  }
  for (const grupo of boletos.values()) {
    const conPrecio = grupo.find(f => f.precio !== null) ?? grupo[0];
    const otras = grupo.filter(f => f !== conPrecio);
    out.push({
      ...base(conPrecio, {}),
      id: conPrecio.numero
        ? `bzmov_${comitente}_${hashId(`${comitente}|boleto|${conPrecio.numero}|${conPrecio.clase}|${conPrecio.concertacion}|${conPrecio.ticker ?? ''}`)}`
        : idFilaBalanz(comitente, conPrecio),
      tipo: conPrecio.clase === 'venta' ? 'venta' : 'compra',
      ticker: conPrecio.ticker, cantidad: Math.abs(conPrecio.cantidad), precio: conPrecio.precio,
      tipoActivo: conPrecio.tipoInstrumento ? TIPO_INSTRUMENTO[conPrecio.tipoInstrumento] ?? null : null,
      nota: otras.length
        ? `${conPrecio.descripcion} · además ${otras.map(o => `${o.importe} ${o.monedaCruda}`).join(', ')} (otra moneda: solo caja)`
        : conPrecio.descripcion,
    });
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.id ?? '').localeCompare(b.id ?? ''));
}

/**
 * Clases cuyo `Importe` NO es efecto en la caja. Medido en las muestras: "Suscripción desde
 * Balanz" lleva el mismo importe, con signo opuesto, que su "Liquidación de Suscripción"; si se
 * sumaran los dos, una suscripción dejaría la caja igual. La caja la mueve el lado "Liquidación".
 */
const SIN_EFECTO_CAJA = new Set<ClaseBalanz>(['fci_tenencia', 'transferencia_titulos']);

export type CajaAnclada =
  | {
      estado: 'ok';
      /** Fecha de la corrida que ancla la caja. */
      ancla: string;
      cajaCorrida: { ARS: number; USD: number };
      sumaMovimientos: { ARS: number; USD: number };
      saldos: { ARS: number; USD: number };
      /** Suma de Importe posterior al ancla, por subcuenta original (Dólares, C.V. 7000, Cable…). */
      porSubcuenta: Record<string, number>;
      filasSumadas: number;
      /** Última liquidación del archivo: hasta cuándo llega esta caja. Una caja más vieja no pisa a una más nueva. */
      hasta: string;
    }
  | { estado: 'desconocida'; motivo: string };

/**
 * Caja = caja de la última corrida de la comitente (fecha F) + Σ Importe por moneda de las filas
 * con Liquidación POSTERIOR a F. No se calcula desde cero porque el export puede venir cortado
 * (la muestra de la 402665 tiene justo 1000 filas). Sin corrida con caja, o si el archivo no llega
 * hasta F, la caja es "desconocida": no se inventa.
 */
export function cajaAnclada(
  filas: FilaMovBalanz[],
  corrida: { fecha: string; posiciones: Array<Pick<Posicion, 'cuenta' | 'tipo' | 'moneda_origen' | 'valor_origen'>> } | null,
  comitente: string,
): CajaAnclada {
  if (!corrida) return { estado: 'desconocida', motivo: 'No hay corrida cargada.' };
  const cuenta = cuentaDeComitente(comitente);
  const cajas = corrida.posiciones.filter(p => p.cuenta === cuenta && p.tipo === 'cash');
  if (!cajas.length) return { estado: 'desconocida', motivo: `La corrida del ${corrida.fecha} no tiene caja de ${cuenta}.` };
  const F = corrida.fecha;
  const masVieja = filas.map(f => f.liquidacion).filter(Boolean).sort()[0];
  if (!masVieja || masVieja > F) {
    return { estado: 'desconocida', motivo: `El archivo empieza el ${masVieja ?? '—'}, después de la corrida del ${F}: puede faltar historia entre las dos.` };
  }
  const cajaCorrida = { ARS: 0, USD: 0 };
  for (const c of cajas) cajaCorrida[c.moneda_origen] += c.valor_origen;
  const sumaMovimientos = { ARS: 0, USD: 0 };
  const porSubcuenta: Record<string, number> = {};
  let filasSumadas = 0;
  for (const f of filas) {
    if (!(f.liquidacion > F) || SIN_EFECTO_CAJA.has(f.clase) || f.importe === 0) continue;
    if (!f.moneda) continue;
    sumaMovimientos[f.moneda] += f.importe;
    porSubcuenta[f.monedaCruda] = (porSubcuenta[f.monedaCruda] ?? 0) + f.importe;
    filasSumadas++;
  }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    estado: 'ok', ancla: F, cajaCorrida: { ARS: r2(cajaCorrida.ARS), USD: r2(cajaCorrida.USD) },
    sumaMovimientos: { ARS: r2(sumaMovimientos.ARS), USD: r2(sumaMovimientos.USD) },
    saldos: { ARS: r2(cajaCorrida.ARS + sumaMovimientos.ARS), USD: r2(cajaCorrida.USD + sumaMovimientos.USD) },
    porSubcuenta: Object.fromEntries(Object.entries(porSubcuenta).map(([k, v]) => [k, r2(v)])),
    filasSumadas,
    hasta: filas.map(f => f.liquidacion).filter(Boolean).sort().pop() ?? F,
  };
}

/**
 * Comitente sugerida para un archivo de Movimientos (el nombre no la trae): la que más tickers
 * comparte con su último "Mis Instrumentos". Es una SUGERENCIA: Juan la confirma.
 */
export function sugerirComitente(
  filas: FilaMovBalanz[],
  candidatas: Array<{ comitente: string; tickers: string[] }>,
): Array<{ comitente: string; comunes: number; total: number }> {
  const delArchivo = new Set(filas.map(f => f.ticker?.replace(/\s+/g, '').toUpperCase()).filter((t): t is string => !!t));
  return candidatas
    .map(c => {
      const suyos = new Set(c.tickers.map(t => t.replace(/\s+/g, '').toUpperCase()));
      return { comitente: c.comitente, comunes: [...suyos].filter(t => delArchivo.has(t)).length, total: suyos.size };
    })
    .sort((a, b) => b.comunes - a.comunes || a.comitente.localeCompare(b.comitente));
}

/** Resumen por clase, para la vista previa y el script de las muestras. */
export function contarPorClase(filas: FilaMovBalanz[]): Record<ClaseBalanz, number> {
  const out = {} as Record<ClaseBalanz, number>;
  for (const f of filas) out[f.clase] = (out[f.clase] ?? 0) + 1;
  return out;
}
