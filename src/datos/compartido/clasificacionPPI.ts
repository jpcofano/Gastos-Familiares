// F9.196 H2a — PPI: lectura de `Account/BalancesAndPositions` y clasificación de `Account/Movements`.
// Funciones PURAS (sin red ni Firestore): las usa `sincronizarPPI` (functions/) y el script local
// `scripts/clasificarPPIMuestras.ts`.
//
// ⛔ CÓDIGO COMPARTIDO (F9.196 H2): idéntico byte a byte en src/datos/compartido/ y
// functions/src/compartido/. Se edita el de src/datos/ y se copia; `scripts/verificarCopiasIdenticas.ts`
// falla si difieren. Sin imports fuera de esta carpeta.
//
// Forma real confirmada en vivo el 20/10/2026 (docs/patrimonio/ppi-api-exploracion.md):
// - BalancesAndPositions es un OBJETO { groupedAvailability, groupedInstruments } (la doc dice array).
// - `price` en pesos por UNIDAD (bonos por 1 VN), `amount` = quantity × price, costo en `ppc`.
// - La caja de la cuenta es la fila INMEDIATA de cada `groupedAvailability[].currency`.
// - Movements no tiene campo de tipo: el tipo sale SOLO de `description` (tabla de abajo).
import type { PosicionRaw, PosicionTipo, PaisRiesgo } from './tiposPatrimonio';
import { hashId, type MovimientoCuenta } from './patrimonioMovimientos';

// ── Posiciones y caja ────────────────────────────────────────────────────────

const TIPO_GRUPO: Record<string, PosicionTipo> = {
  ACCIONES: 'accion', CEDEARS: 'cedear', BONOS: 'bono', ON: 'on', FCI: 'fci', LETRAS: 'bono',
};

/** Factor a partir del cual costo y precio no son de la misma escala (el de la guarda de escala). */
export const FACTOR_COSTO_SOSPECHOSO = 5;

export type LecturaPosicionesPPI = {
  posiciones: PosicionRaw[];
  /** Caja = fila INMEDIATA de cada moneda. Pesos → ARS; CCL y MEP → USD. */
  saldos: { ARS: number; USD: number };
  saldosPorSubcuenta: Record<string, number>;
  costoPromedio: Record<string, number>;
  costoSospechoso: Record<string, true>;
  paraRevisar: Array<{ ticker: string; motivo: string }>;
};

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const monedaDeTexto = (t: string): 'ARS' | 'USD' | null =>
  /^pesos$/i.test(t.trim()) ? 'ARS' : /^d[oó]lar/i.test(t.trim()) ? 'USD' : null;

/**
 * `Account/BalancesAndPositions` → posiciones normalizadas (forma de §1).
 * @param clasificar sector y país de un ticker (de la corrida); `null` = desconocido → `revisar`.
 */
export function leerPosicionesPPI(
  body: unknown,
  cuenta: string,
  clasificar: (ticker: string, tipo: PosicionTipo) => { sector: string; pais_riesgo: PaisRiesgo } | null,
): LecturaPosicionesPPI {
  const o = (body ?? {}) as { groupedAvailability?: unknown; groupedInstruments?: unknown };
  if (!Array.isArray(o.groupedInstruments) || !Array.isArray(o.groupedAvailability)) {
    throw new Error('BalancesAndPositions: la respuesta no tiene groupedInstruments / groupedAvailability');
  }
  const posiciones: PosicionRaw[] = [];
  const costoPromedio: Record<string, number> = {};
  const costoSospechoso: Record<string, true> = {};
  const paraRevisar: Array<{ ticker: string; motivo: string }> = [];

  for (const g of o.groupedInstruments as Array<{ name?: unknown; instruments?: unknown }>) {
    const grupo = String(g.name ?? '').trim();
    const tipo = TIPO_GRUPO[grupo.toUpperCase()] ?? null;
    for (const i of (Array.isArray(g.instruments) ? g.instruments : []) as Array<Record<string, unknown>>) {
      const ticker = String(i.ticker ?? '').trim().toUpperCase();
      const cantidad = num(i.quantity);
      const valor = num(i.amount);
      const precio = num(i.price);
      const moneda = monedaDeTexto(String(i.currency ?? ''));
      if (!ticker) continue;
      if (!tipo) { paraRevisar.push({ ticker, motivo: `Grupo de instrumento desconocido: «${grupo}»` }); continue; }
      if (cantidad === null || valor === null) { paraRevisar.push({ ticker, motivo: 'quantity o amount no son números' }); continue; }
      if (!moneda) { paraRevisar.push({ ticker, motivo: `Moneda desconocida: «${String(i.currency)}»` }); continue; }
      const clas = clasificar(ticker, tipo);
      posiciones.push({
        cuenta, titular: null, ticker, tipo,
        sector: clas?.sector ?? '', pais_riesgo: clas?.pais_riesgo ?? 'AR',
        moneda_origen: moneda, valor_origen: valor, cantidad,
        fuente: 'ppi_api', revisar: !clas,
        motivo_revisar: clas ? null : `Sector y país desconocidos para ${ticker} (${grupo}): no está en la corrida`,
      });
      const ppc = (i.ppc ?? null) as { ppcValue?: unknown; currency?: unknown } | null;
      const costo = num(ppc?.ppcValue);
      if (costo !== null && costo > 0) {
        costoPromedio[ticker] = costo;
        const r = precio !== null && precio > 0 ? precio / costo : null;
        if (r !== null && (r > FACTOR_COSTO_SOSPECHOSO || r < 1 / FACTOR_COSTO_SOSPECHOSO)) costoSospechoso[ticker] = true;
      }
    }
  }

  const saldos = { ARS: 0, USD: 0 };
  const saldosPorSubcuenta: Record<string, number> = {};
  for (const g of o.groupedAvailability as Array<{ currency?: unknown; availability?: unknown }>) {
    const sub = String(g.currency ?? '').trim();
    const moneda = monedaDeTexto(sub);
    const inmediata = (Array.isArray(g.availability) ? g.availability : [] as unknown[])
      .find(a => String((a as { settlement?: unknown }).settlement ?? '').toUpperCase() === 'INMEDIATA') as { amount?: unknown } | undefined;
    const monto = num(inmediata?.amount) ?? 0;
    if (!moneda) { if (monto) paraRevisar.push({ ticker: sub, motivo: `Caja en moneda desconocida: «${sub}»` }); continue; }
    saldos[moneda] += monto;
    saldosPorSubcuenta[sub] = monto;
  }
  saldos.ARS = Math.round(saldos.ARS * 100) / 100;
  saldos.USD = Math.round(saldos.USD * 100) / 100;
  return { posiciones, saldos, saldosPorSubcuenta, costoPromedio, costoSospechoso, paraRevisar };
}

// ── Movimientos: clasificación por `description` ────────────────────────────

export type ClasePPI =
  | 'compra' | 'venta' | 'deposito' | 'retiro' | 'renta' | 'fci_suscripcion'
  | 'gasto' | 'split' | 'ajuste_caja' | 'para_revisar';

/**
 * Tabla de clasificación: las 16 familias de textos documentadas sobre 3 años de historia real
 * (ppi-api-exploracion.md §5). Lo que no está acá queda `para_revisar` con el texto crudo: no se
 * inventan reglas.
 */
export const FAMILIAS_PPI: Array<{ familia: string; re: RegExp; clase: ClasePPI; detalle?: string }> = [
  { familia: 'COMPRA <ticker>', re: /^COMPRA \S+/, clase: 'compra' },
  { familia: 'VENTA <ticker>', re: /^VENTA \S+/, clase: 'venta' },
  { familia: 'Ingreso de Fondos', re: /^Ingreso de Fondos\s*$/, clase: 'deposito' },
  { familia: 'Retiro de Fondos', re: /^Retiro de Fondos\s*$/, clase: 'retiro' },
  { familia: 'Dividendo en efectivo / <t>', re: /^Dividendo en efectivo \/ /, clase: 'renta', detalle: 'dividendo' },
  { familia: 'Renta / <t> y RENTA. / <t>', re: /^(Renta|RENTA\.) \/ /, clase: 'renta', detalle: 'cupon' },
  { familia: 'Amortización / <t>', re: /^Amortización \/ /, clase: 'renta', detalle: 'amortizacion' },
  { familia: 'Interest payment (INTR) - DISN / <t>', re: /^Interest payment \(INTR\) - DISN \/ /, clase: 'renta', detalle: 'cupon' },
  { familia: 'Liquidación de Suscripción / # / <fondo>', re: /^Liquidación de Suscripción \/ /, clase: 'fci_suscripcion' },
  { familia: 'Ret. Ganancias / Ret. Gcias. Div…', re: /^Ret\.?\s+(Ganancias|Gcias\.?)\s/, clase: 'gasto', detalle: 'retencion' },
  { familia: 'Ret. Bs. Ps. / Retenciones Div.…', re: /^(Ret\.?\s+Bs\.\s*Ps\.|Retenciones Div\.)/, clase: 'gasto', detalle: 'retencion' },
  { familia: 'Split / <t>', re: /^Split \/ /, clase: 'split' },
  { familia: 'Movimiento Manual / Vencimiento Plazo Comunicación A 8042', re: /^Movimiento Manual \/ Vencimiento Plazo Comunicación A 8042/, clase: 'ajuste_caja' },
  { familia: 'Movimiento Manual / Fracción …', re: /^Movimiento Manual \/ Fracción /, clase: 'ajuste_caja' },
  { familia: 'Movimiento Manual / Débito/Crédito - Compensación de monedas', re: /^Movimiento Manual \/ Débito\/Crédito - Compensación de monedas/, clase: 'ajuste_caja' },
  { familia: 'Movimiento Manual / Gastos CVSA …', re: /^Movimiento Manual \/ Gastos CVSA /, clase: 'gasto', detalle: 'gastos_cvsa' },
];

export function clasificarDescripcionPPI(desc: string): { clase: ClasePPI; detalle: string | null; familia: string | null } {
  const d = desc.trim();
  for (const f of FAMILIAS_PPI) if (f.re.test(d)) return { clase: f.clase, detalle: f.detalle ?? null, familia: f.familia };
  return { clase: 'para_revisar', detalle: null, familia: null };
}

export type FilaMovPPI = {
  fecha: string;            // agreementDate (concertación), YYYY-MM-DD
  liquidacion: string;      // settlementDate
  descripcion: string;
  ticker: string | null;    // null cuando la API dice "Ticker not found"
  cantidad: number;
  precio: number;
  importe: number;          // `amount`, con signo: efecto en la caja
  monedaCruda: string;
  moneda: 'ARS' | 'USD' | null;
  clase: ClasePPI;
  detalle: string | null;
  /** Filas idénticas anteriores en la misma lectura (dos filas legítimas iguales son dos). */
  ocurrencia: number;
};

export function leerMovimientosPPI(body: unknown): { filas: FilaMovPPI[]; monedasDesconocidas: string[] } {
  if (!Array.isArray(body)) throw new Error('Movements: la respuesta no es un array');
  const vistas = new Map<string, number>();
  const filas: FilaMovPPI[] = [];
  const monedasDesconocidas: string[] = [];
  for (const m of body as Array<Record<string, unknown>>) {
    const descripcion = String(m.description ?? '').trim();
    const t = String(m.ticker ?? '').trim();
    const monedaCruda = String(m.currency ?? '').trim();
    const { clase, detalle } = clasificarDescripcionPPI(descripcion);
    const f: FilaMovPPI = {
      fecha: String(m.agreementDate ?? '').slice(0, 10),
      liquidacion: String(m.settlementDate ?? '').slice(0, 10),
      descripcion, ticker: !t || /^ticker not found$/i.test(t) ? null : t.toUpperCase(),
      cantidad: num(m.quantity) ?? 0, precio: num(m.price) ?? 0, importe: num(m.amount) ?? 0,
      monedaCruda, moneda: monedaDeTexto(monedaCruda), clase, detalle, ocurrencia: 0,
    };
    const k = clavePPI(f);
    f.ocurrencia = vistas.get(k) ?? 0;
    vistas.set(k, f.ocurrencia + 1);
    if (monedaCruda && !f.moneda) monedasDesconocidas.push(`«${monedaCruda}» en «${descripcion}»`);
    filas.push(f);
  }
  return { filas, monedasDesconocidas };
}

const clavePPI = (f: Pick<FilaMovPPI, 'fecha' | 'descripcion' | 'ticker' | 'cantidad' | 'importe' | 'monedaCruda'>) =>
  [f.fecha, f.descripcion, f.ticker ?? '', String(f.cantidad), f.importe.toFixed(2), f.monedaCruda].join('|');

/** Id determinista: re-sincronizar con ventanas que se pisan no duplica. */
export const idMovimientoPPI = (f: FilaMovPPI) => `ppimov_${hashId(`${clavePPI(f)}#${f.ocurrencia}`)}`;

/**
 * Los `movimientosCuenta` de PPI:
 * - compra / venta (con ticker), depósito / retiro (dinero: candidatos de §C);
 * - renta: dividendos, cupones, amortizaciones (devolución de capital) — solo los de importe positivo;
 * - suscripción de FCI: compra de cuotapartes (caja y tenencia vienen en la misma fila).
 * Retenciones, splits y ajustes de caja NO son movimientos de cuenta: la caja de PPI es la de la API.
 */
export function movimientosDePPI(filas: FilaMovPPI[], cuenta: string): MovimientoCuenta[] {
  const out: MovimientoCuenta[] = [];
  for (const f of filas) {
    const base: MovimientoCuenta = {
      id: idMovimientoPPI(f), fecha: f.fecha, cuenta, moneda: f.moneda ?? 'ARS', origen: 'ppi_api',
      tipo: 'deposito', montoNeto: Math.abs(f.importe), nota: f.descripcion, subcuenta: f.monedaCruda || null,
    };
    if (f.clase === 'compra' || f.clase === 'venta') {
      out.push({ ...base, tipo: f.clase, ticker: f.ticker, cantidad: Math.abs(f.cantidad), precio: f.precio || null });
    } else if (f.clase === 'deposito' || f.clase === 'retiro') {
      out.push({ ...base, tipo: f.clase });
    } else if (f.clase === 'renta' && f.importe > 0) {
      out.push({ ...base, tipo: 'renta', ticker: f.ticker, devolucionCapital: f.detalle === 'amortizacion' });
    } else if (f.clase === 'fci_suscripcion') {
      out.push({ ...base, tipo: 'compra', ticker: f.ticker, cantidad: Math.abs(f.cantidad), precio: f.precio || null, tipoActivo: 'fci' });
    }
  }
  return out;
}

export function contarPorClasePPI(filas: FilaMovPPI[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of filas) out[f.clase] = (out[f.clase] ?? 0) + 1;
  return out;
}
