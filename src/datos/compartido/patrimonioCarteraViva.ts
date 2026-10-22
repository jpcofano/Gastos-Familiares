// F9.196 §2 (+ Addendum 1) — cartera viva: el valor de HOY, cuenta por cuenta, con la mejor fuente
// disponible de cada una. Función pura: no lee Firestore ni la API. El cron `actualizarCarteraViva`
// (todavía no existe) arma los parámetros, la llama y guarda el resultado en `carteraViva/ultima`.
//
// NO modifica `posicionesPatrimonio`: las corridas siguen siendo la foto histórica y el retorno
// (Dietz, F9.96) se sigue calculando entre corridas.
//
// ⛔ CÓDIGO COMPARTIDO (F9.196 H2): idéntico byte a byte en src/datos/compartido/ y
// functions/src/compartido/. Se edita el de src/datos/ y se copia; `scripts/verificarCopiasIdenticas.ts`
// falla si difieren. Sin imports fuera de esta carpeta.
import type { Posicion, PosicionManual, PosicionRaw, PosicionTipo, PaisRiesgo, LecturaCripto } from './tiposPatrimonio';
import { fechaArgentina, STABLECOINS } from './tiposPatrimonio';
import { efectoMovimiento, movimientoVigente, type MovimientoCuenta } from './patrimonioMovimientos';

// ── Entradas ─────────────────────────────────────────────────────────────────

/**
 * Addendum 1: el dólar de la cartera viva es el MEP del día leído a la hora del cálculo
 * (`dolarapi.com/v1/dolares/bolsa`, campo `venta`). Si no se pudo, el `tcDiario` más reciente,
 * marcado `viejo`. Nunca se escribe en `tcDiario`.
 */
export type TcCarteraViva = {
  valor: number;
  fuente: 'dolarapi-bolsa' | 'tcDiario';
  /**
   * YYYY-MM-DD: la fecha del CIERRE cotizado. dolarapi: `fechaActualizacion` pasada a hora
   * argentina. tcDiario: el día hábil anterior al id del doc (convención D−1 de F9.103).
   */
  fechaCotizacion: string;
  viejo: boolean;
};

/**
 * Forma normalizada de `cuentasVivas/{id}` (§1). NO es la respuesta cruda de PPI ni de Bitfinex:
 * cada sincronización la arma con el mismo mapeo de tipos que la ingesta.
 *
 * ⚠ Sin confirmar en vivo (docs/patrimonio/ppi-api-exploracion.md, "Pendiente con credenciales"):
 * - `saldos`: PPI separa por plazo (CI / 24 hs / 48 hs) y no se sabe todavía cuál es "la caja".
 *   Opcional hasta entonces; quien sincroniza decide qué número va.
 * - `costoPromedio`: no se sabe si BalancesAndPositions lo trae.
 */
export type CuentaViva = {
  cuenta: string;                       // mismo texto que `cuenta` en las corridas ("PPI XXXXX")
  fuente: 'ppi_api' | 'bitfinex_api' | 'nexo_api' | 'archivo_balanz';
  leidoEn: string;                      // ISO
  posiciones: PosicionRaw[];
  saldos?: { ARS: number; USD: number };
  costoPromedio?: Record<string, number>;
  /**
   * F9.196 H2 — tickers cuyo costo promedio difiere más de 5× del precio del día (escala de antes
   * de un split, medido en PPI con PAMP, TGSU2, TRAN). Se guarda el costo pero NO entra en ningún
   * cálculo (P/E, rendimiento, potencial).
   */
  costoSospechoso?: Record<string, true>;
  /** Detalle de la caja por subcuenta de origen (Pesos, CCL, MEP…), además de `saldos`. */
  saldosPorSubcuenta?: Record<string, number>;
  /** Filas que no se pudieron mapear (tipo o moneda desconocidos): se muestran, no se descartan en silencio. */
  paraRevisar?: Array<{ ticker: string; motivo: string }>;
  /** Mensaje crudo del último fallo. Si hay posiciones, son las de la última lectura buena. */
  error?: string | null;
};

/**
 * Precio del día de una identidad, **por unidad de `cantidad`**, en `moneda`. Quien lo arma (el cron)
 * normaliza la escala de la fuente. Si la escala no coincide con la de la corrida, la línea no se
 * valúa con ese precio (ver `escala_dudosa`).
 */
export type PrecioDia = { precio: number; moneda: 'ARS' | 'USD'; fecha: string };

export type PreciosCarteraViva = {
  /** Hoy en hora argentina (YYYY-MM-DD). Un precio de otra fecha queda marcado `viejo`. */
  hoy: string;
  /** Clave = `claveIdentidad` (`ticker|tipo|pais`), la misma que usa el cron de precios. */
  porIdentidad: Record<string, PrecioDia>;
};

export type CorridaBase = {
  fecha: string;
  posiciones: Posicion[];
  /** Fecha de corte por cuenta, si alguna cuenta se cargó en otra fecha. Default: `fecha`. */
  fechaPorCuenta?: Record<string, string>;
};

// ── Salida ───────────────────────────────────────────────────────────────────

/**
 * - `hoy`: precio del día. `viejo`: último precio conocido, de otra fecha (`precioFecha`).
 * - `corrida`: sin precio nuevo; vale lo de la carga, con su fecha.
 * - `escala_dudosa`: el precio del día difiere más de 5× del implícito en la carga (escala distinta,
 *   p. ej. bonos cotizados cada 100 nominales, o un split sin registrar). Se usa el de la carga.
 * - `api`: lo valuó la propia fuente de la cuenta (API o archivo de Balanz), sin precio del día.
 * - `caja`: efectivo. `manual`: valuada por el cron de precios (F9.195).
 */
export type EstadoPrecio = 'hoy' | 'viejo' | 'corrida' | 'escala_dudosa' | 'api' | 'caja' | 'manual';

export type LineaViva = {
  cuenta: string;
  ticker: string;
  tipo: PosicionTipo | null;            // null = compra de un ticker nuevo sin `tipoActivo`
  pais_riesgo: PaisRiesgo | null;
  sector: string | null;
  cantidad: number | null;
  cantidadCarga: number | null;         // la de la corrida / API, antes de movimientos
  moneda: 'ARS' | 'USD';                // moneda de `valorOrigen`
  valorOrigen: number;
  valorUsd: number | null;              // null = no se pudo convertir (sin TC)
  precio: EstadoPrecio;
  precioFecha: string | null;
  revisar: boolean;
};

export type FuenteCuenta = 'api' | 'corrida' | 'manual';

export type CuentaCarteraViva = {
  cuenta: string;
  fuente: FuenteCuenta;
  /** API: fecha de lectura. Corrida: fecha de corte de la cuenta. Manual: la valuación más vieja. */
  fechaBase: string | null;
  leidoEn: string | null;
  movimientosAplicados: number;
  error: string | null;
  valorUsd: number;
  valorCargaUsd: number;
};

export type CarteraViva = {
  tc: TcCarteraViva | null;
  /** Atajo de `tc.viejo`, para la marca del hero sin tener que mirar adentro. */
  tcViejo: boolean;
  totalUsd: number;
  /** Última carga: lo que valía la corrida (con su TC) más las manuales. */
  totalCargaUsd: number;
  /**
   * Diferencia = efecto precios + efecto movimientos. El efecto precios INCLUYE el del dólar;
   * `efectoDolarUsd` es la parte de ese efecto que viene solo del cambio del MEP (Addendum 1).
   */
  efectoPreciosUsd: number;
  efectoDolarUsd: number;
  /** Total − valor a precios de hoy de la carga: es un RESTO (flujos + lo que no se explica). */
  efectoMovimientosUsd: number;
  /**
   * F9.196 nota de revisión 2 — la parte de `efectoMovimientosUsd` que son depósitos y retiros REALES
   * (`movimientosCuenta`) desde el corte de cada cuenta, en USD. Ausente en documentos viejos.
   */
  efectoFlujosUsd?: number;
  /** `efectoMovimientosUsd − efectoFlujosUsd`: lo que ni los precios ni los flujos explican. */
  efectoSinExplicarUsd?: number;
  cuentas: CuentaCarteraViva[];
  lineas: LineaViva[];
  /** Lo que no cuadra o no se pudo valuar. Se muestra; no se corrige solo (decisión de Juan). */
  inconsistencias: string[];
};

// ── Cálculo ──────────────────────────────────────────────────────────────────

const clave = (ticker: string, tipo: PosicionTipo, pais: PaisRiesgo) => `${ticker}|${tipo}|${pais}`;
const norm = (t: string) => t.trim().toUpperCase();
/** Más de este factor entre el precio del día y el implícito de la carga = escalas distintas. */
const FACTOR_ESCALA = 5;

type Trabajo = LineaViva & {
  /** TC con que se valuó la carga (solo filas en ARS). */
  tcCarga: number | null;
  /** Valor de la fila en la carga y a precios de hoy con la tenencia de la carga. */
  v0: number;
  vp: number | null;
  /** Moneda en que quedó valuado `vp` (la del precio del día, si se usó). */
  monedaVp: 'ARS' | 'USD' | null;
  /** Precio unitario implícito de la carga, en `moneda`. */
  unitCarga: number | null;
  esCarga: boolean;
};

/**
 * F9.196 nota de revisión 2 — depósitos (+) y retiros (−) REALES desde el corte de cada cuenta, en
 * USD: los de `movimientosCuenta` (no los inferidos entre dos "Mis Instrumentos"). Lo que está en
 * pesos se pasa con el MEP de hoy; sin MEP, queda afuera. Una transferencia entre cuentas propias
 * suma un retiro y un depósito: se cancela sola.
 */
export function flujosRealesUsd(
  movimientos: MovimientoCuenta[], corrida: Pick<CorridaBase, 'fecha' | 'fechaPorCuenta'>, tcHoy: number | null,
): number {
  let total = 0;
  for (const m of movimientos) {
    if (m.inferido || (m.tipo !== 'deposito' && m.tipo !== 'retiro')) continue;
    if (!movimientoVigente(m, corrida.fechaPorCuenta?.[m.cuenta] ?? corrida.fecha)) continue;
    const monto = Math.abs(m.montoNeto);
    const usd = m.moneda === 'USD' ? monto : tcHoy && tcHoy > 0 ? monto / tcHoy : null;
    if (usd === null) continue;
    total += m.tipo === 'deposito' ? usd : -usd;
  }
  return total;
}

export function armarCarteraViva(
  corrida: CorridaBase,
  cuentasVivas: CuentaViva[],
  movimientos: MovimientoCuenta[],
  precios: PreciosCarteraViva,
  cripto: LecturaCripto | null,
  manuales: PosicionManual[],
  tc: TcCarteraViva | null,
): CarteraViva {
  const inconsistencias: string[] = [];
  const tcHoy = tc && tc.valor > 0 ? tc.valor : null;
  const aUsd = (monto: number, moneda: 'ARS' | 'USD') =>
    moneda === 'USD' ? monto : tcHoy !== null ? monto / tcHoy : null;
  const fechaCripto = cripto ? fechaArgentina(cripto.leidoEnISO) : null;

  /** Precio del día de una fila, en la moneda que corresponda. */
  const precioDe = (p: PosicionRaw): (PrecioDia & { fuente: 'precios' | 'cripto' }) | null => {
    if (p.tipo === 'cripto') {
      const t = norm(p.ticker);
      if (STABLECOINS.has(t)) return { precio: 1, moneda: 'USD', fecha: fechaCripto ?? precios.hoy, fuente: 'cripto' };
      const v = cripto?.precios[t]?.valor ?? null;
      return v !== null && fechaCripto ? { precio: v, moneda: 'USD', fecha: fechaCripto, fuente: 'cripto' } : null;
    }
    const d = precios.porIdentidad[clave(p.ticker, p.tipo, p.pais_riesgo)];
    return d ? { ...d, fuente: 'precios' } : null;
  };

  const vivas = new Map(cuentasVivas.map(c => [c.cuenta, c]));
  const trabajo: Trabajo[] = [];

  // 1) Filas de la carga (corrida), para todas las cuentas: son la base de la diferencia.
  for (const p of corrida.posiciones) {
    const tcCarga = p.moneda_origen === 'ARS'
      ? (p.tcUsado ?? (p.valorUsd > 0 ? p.valor_origen / p.valorUsd : null))
      : null;
    const unitCarga = p.cantidad && p.cantidad !== 0 ? p.valor_origen / p.cantidad : null;
    trabajo.push({
      cuenta: p.cuenta, ticker: p.ticker, tipo: p.tipo, pais_riesgo: p.pais_riesgo, sector: p.sector,
      cantidad: p.cantidad, cantidadCarga: p.cantidad, moneda: p.moneda_origen,
      valorOrigen: p.valor_origen, valorUsd: null, precio: 'corrida', precioFecha: corrida.fecha,
      revisar: p.revisar, tcCarga, v0: p.valorUsd, vp: null, monedaVp: null, unitCarga, esCarga: true,
    });
  }

  // 2) Cuentas con API: sus filas reemplazan a las de la carga en la salida. Las de la carga se
  //    quedan solo como base (v0, vp) para separar precios de movimientos.
  const deApi: Trabajo[] = [];
  /**
   * Cuentas por archivo de Balanz SIN `saldos`: "Mis Instrumentos" no trae caja, así que se conserva
   * la de la carga. Solo `archivo_balanz` y solo si no trae filas cash: una cuenta con API que
   * mande su caja como fila cash no tiene que sumar además la de la corrida.
   */
  const sinCaja = new Set<string>();
  /**
   * Balanz con caja anclada (archivo de Movimientos, Addendum 2 §B) pero todavía sin "Mis
   * Instrumentos": la tenencia sigue siendo la de la corrida y la caja pasa a ser la anclada.
   */
  const soloCaja = new Set<string>();
  const cajasSolas: Trabajo[] = [];
  const lineaCaja = (cuenta: string, moneda: 'ARS' | 'USD', monto: number, fecha: string): Trabajo => ({
    cuenta, ticker: moneda, tipo: 'cash', pais_riesgo: moneda === 'ARS' ? 'AR' : 'global', sector: 'cash',
    cantidad: null, cantidadCarga: null, moneda, valorOrigen: monto, valorUsd: null, precio: 'caja',
    precioFecha: fecha, revisar: false, tcCarga: null, v0: 0, vp: null, monedaVp: null, unitCarga: null, esCarga: false,
  });
  for (const c of cuentasVivas) {
    if (!c.posiciones?.length) {
      if (c.fuente === 'archivo_balanz' && c.saldos) {
        soloCaja.add(c.cuenta);
        for (const moneda of ['ARS', 'USD'] as const) {
          if (c.saldos[moneda]) cajasSolas.push(lineaCaja(c.cuenta, moneda, c.saldos[moneda], c.leidoEn.slice(0, 10)));
        }
      }
      continue;   // sin lectura buena: la tenencia sigue por la carga
    }
    const conSaldos = !!c.saldos;
    if (!conSaldos && c.fuente === 'archivo_balanz' && !c.posiciones.some(p => p.tipo === 'cash')) sinCaja.add(c.cuenta);
    if (conSaldos && c.posiciones.some(p => p.tipo === 'cash')) {
      inconsistencias.push(`${c.cuenta}: la API trae filas cash y saldos; se usan los saldos`);
    }
    for (const p of c.posiciones) {
      if (conSaldos && p.tipo === 'cash') continue;
      const unit = p.cantidad && p.cantidad !== 0 ? p.valor_origen / p.cantidad : null;
      deApi.push({
        cuenta: c.cuenta, ticker: p.ticker, tipo: p.tipo, pais_riesgo: p.pais_riesgo, sector: p.sector,
        cantidad: p.cantidad, cantidadCarga: p.cantidad, moneda: p.moneda_origen, valorOrigen: p.valor_origen,
        valorUsd: null, precio: 'api', precioFecha: c.leidoEn.slice(0, 10), revisar: p.revisar,
        tcCarga: null, v0: 0, vp: null, monedaVp: null, unitCarga: unit, esCarga: false,
      });
    }
    if (c.saldos) {
      for (const moneda of ['ARS', 'USD'] as const) {
        const monto = c.saldos[moneda];
        if (!monto) continue;
        deApi.push({
          cuenta: c.cuenta, ticker: moneda, tipo: 'cash', pais_riesgo: moneda === 'ARS' ? 'AR' : 'global', sector: 'cash',
          cantidad: null, cantidadCarga: null, moneda, valorOrigen: monto, valorUsd: null, precio: 'caja',
          precioFecha: c.leidoEn.slice(0, 10), revisar: false, tcCarga: null, v0: 0, vp: null, monedaVp: null, unitCarga: null, esCarga: false,
        });
      }
    }
  }
  const cuentasConApi = new Set(deApi.map(l => l.cuenta));

  // 3) Valuación a precio del día. Para las filas de la carga se calcula además `vp`: la tenencia
  //    de la carga a precios (y dólar) de hoy, que es lo que separa precios de movimientos.
  const valuar = (l: Trabajo, p: PosicionRaw | null) => {
    if (l.tipo === 'cash' || l.cantidad === null || l.cantidad === undefined) {
      l.precio = l.tipo === 'cash' ? 'caja' : l.precio;
      l.valorUsd = aUsd(l.valorOrigen, l.moneda);
      return;
    }
    const pd = p ? precioDe(p) : null;
    if (pd) {
      // Guarda de escala: el precio del día contra el implícito de la carga, en la misma moneda.
      const unitEnMonedaPrecio = l.unitCarga === null ? null
        : l.moneda === pd.moneda ? l.unitCarga
        : l.moneda === 'ARS' ? (l.tcCarga ?? tcHoy) ? l.unitCarga / (l.tcCarga ?? tcHoy)! : null
        : tcHoy ? l.unitCarga * tcHoy : null;
      const r = unitEnMonedaPrecio && unitEnMonedaPrecio > 0 ? pd.precio / unitEnMonedaPrecio : null;
      if (r !== null && (r > FACTOR_ESCALA || r < 1 / FACTOR_ESCALA)) {
        l.precio = 'escala_dudosa';
        inconsistencias.push(`${l.cuenta} ${l.ticker}: precio del día ${pd.precio} vs ${unitEnMonedaPrecio!.toFixed(4)} implícito en la carga (×${r.toFixed(2)}); se usa el de la carga`);
      } else {
        l.moneda = pd.moneda;
        l.valorOrigen = l.cantidad * pd.precio;
        l.precio = pd.fecha === precios.hoy ? 'hoy' : 'viejo';
        l.precioFecha = pd.fecha;
      }
    }
    if (l.precio === 'corrida' || l.precio === 'escala_dudosa') {
      // Sin precio usable: la tenencia viva al precio unitario de la carga. Lo que está en pesos se
      // pasa con el MEP de hoy (`tc.valor`), no con el de la carga: el dólar sí se movió.
      if (l.unitCarga !== null) l.valorOrigen = l.cantidad * l.unitCarga;
      l.valorUsd = aUsd(l.valorOrigen, l.moneda);
      return;
    }
    l.valorUsd = aUsd(l.valorOrigen, l.moneda);
  };

  const filaDe = (l: Trabajo): PosicionRaw | null => (l.tipo ? {
    cuenta: l.cuenta, titular: null, ticker: l.ticker, tipo: l.tipo, sector: l.sector ?? '',
    pais_riesgo: l.pais_riesgo ?? 'AR', moneda_origen: l.moneda, valor_origen: l.valorOrigen,
    cantidad: l.cantidad, fuente: '', revisar: l.revisar,
  } : null);

  // `vp` de cada fila de la carga: misma tenencia, precio y dólar de hoy.
  for (const l of trabajo) {
    const copia: Trabajo = { ...l };
    valuar(copia, filaDe(l));
    l.vp = copia.valorUsd;
    l.monedaVp = copia.moneda;
  }

  // 4) Movimientos posteriores al corte de cada cuenta. Las cuentas con API no los aplican: sus
  //    posiciones ya son las de hoy (aplicarlos contaría dos veces).
  // Una cuenta viva sin `saldos` conserva la caja de la carga (Addendum 2 §B: la caja de Balanz
  // se ancla en la última corrida; el archivo de Movimientos la moverá en H3c).
  const salida: Trabajo[] = [
    ...trabajo.filter(l =>
      (!cuentasConApi.has(l.cuenta) && !(soloCaja.has(l.cuenta) && l.tipo === 'cash'))
      || (sinCaja.has(l.cuenta) && l.tipo === 'cash')).map(l => ({ ...l })),
    ...deApi,
    ...cajasSolas,
  ];
  const aplicados = new Map<string, number>();
  const ordenados = [...movimientos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  for (const m of ordenados) {
    // Un movimiento inferido (diferencia entre dos "Mis Instrumentos") describe un cambio que la
    // tenencia del archivo ya trae: aplicarlo sería contarlo dos veces. Nunca se aplica.
    if (m.inferido) continue;
    // Addendum 2: en Balanz la tenencia sale de "Mis Instrumentos" y la caja de la caja anclada. Los
    // movimientos del archivo de Movimientos son historial y candidatos de §C: aplicarlos acá no
    // reproduciría la caja (comisiones en otra moneda, retenciones y cauciones no son movimientos).
    if (m.origen === 'archivo_balanz') continue;
    if (cuentasConApi.has(m.cuenta)) continue;
    const corte = corrida.fechaPorCuenta?.[m.cuenta] ?? corrida.fecha;
    if (!movimientoVigente(m, corte)) continue;
    const { deltaCantidad, deltaCaja } = efectoMovimiento(m);
    aplicados.set(m.cuenta, (aplicados.get(m.cuenta) ?? 0) + 1);

    if (deltaCantidad !== 0 && m.ticker) {
      const t = norm(m.ticker);
      const linea = salida.find(l => l.cuenta === m.cuenta && norm(l.ticker) === t && l.tipo !== 'cash');
      if (linea) {
        linea.cantidad = (linea.cantidad ?? 0) + deltaCantidad;
        if (linea.cantidad < 0) inconsistencias.push(`${m.cuenta} ${m.ticker}: la venta del ${m.fecha} deja la tenencia en ${linea.cantidad}`);
      } else if (deltaCantidad < 0) {
        inconsistencias.push(`${m.cuenta} ${m.ticker}: venta del ${m.fecha} de un ticker que la carga no tiene`);
      } else {
        const unit = m.precio ?? (m.cantidad ? Math.abs(m.montoNeto) / Math.abs(m.cantidad) : null);
        if (!m.tipoActivo) inconsistencias.push(`${m.cuenta} ${m.ticker}: compra del ${m.fecha} de un ticker nuevo sin tipo; revisar`);
        salida.push({
          cuenta: m.cuenta, ticker: m.ticker, tipo: m.tipoActivo ?? null, pais_riesgo: m.paisRiesgo ?? null, sector: null,
          cantidad: deltaCantidad, cantidadCarga: 0, moneda: m.moneda, valorOrigen: 0, valorUsd: null,
          precio: 'corrida', precioFecha: m.fecha, revisar: !m.tipoActivo, tcCarga: null, v0: 0, vp: null, monedaVp: null,
          unitCarga: unit, esCarga: false,
        });
      }
    }

    if (deltaCaja !== 0) {
      const caja = salida.find(l => l.cuenta === m.cuenta && l.tipo === 'cash' && l.moneda === m.moneda);
      if (caja) caja.valorOrigen += deltaCaja;
      else {
        salida.push({
          cuenta: m.cuenta, ticker: m.moneda, tipo: 'cash', pais_riesgo: m.moneda === 'ARS' ? 'AR' : 'global', sector: 'cash',
          cantidad: null, cantidadCarga: null, moneda: m.moneda, valorOrigen: deltaCaja, valorUsd: null,
          precio: 'caja', precioFecha: m.fecha, revisar: false, tcCarga: null, v0: 0, vp: null, monedaVp: null, unitCarga: null, esCarga: false,
        });
      }
      if (caja && caja.valorOrigen < 0) inconsistencias.push(`${m.cuenta}: la caja en ${m.moneda} queda negativa (${caja.valorOrigen}) después del ${m.tipo} del ${m.fecha}`);
    }
  }

  // 5) Valuación final de la salida.
  for (const l of salida) {
    if (l.precio === 'api' && l.cantidad !== null) {
      // Solo un precio de la MISMA fecha que la lectura de la API (o posterior) la revalúa: un último
      // cierre más viejo pisaría la valuación de hoy de la propia fuente.
      const pd = filaDe(l) ? precioDe(filaDe(l)!) : null;
      if (pd && pd.fecha >= (l.precioFecha ?? '')) { valuar(l, filaDe(l)); continue; }
      // Nota de revisión 2: la API trajo tenencia pero valor 0 (no tenía precio) y no hay precio del
      // día. Nota de revisión 3: primero el precio más reciente que haya (más viejo que la lectura de
      // la API), con su fecha y estado 'viejo'; si no hay ninguno, el precio unitario de la CARGA de
      // ese ticker en esa cuenta. Nunca 0 en silencio.
      if (l.cantidad > 0 && l.valorOrigen === 0 && l.tipo !== 'cash') {
        const carga = trabajo.find(c => c.esCarga && c.cuenta === l.cuenta && norm(c.ticker) === norm(l.ticker) && c.unitCarga !== null && c.unitCarga > 0);
        if (pd && pd.precio > 0) {
          l.moneda = pd.moneda;
          l.valorOrigen = l.cantidad * pd.precio;
          l.precio = 'viejo';
          l.precioFecha = pd.fecha;
          inconsistencias.push(`${l.cuenta} ${l.ticker}: precio del ${pd.fecha.slice(8, 10)}/${pd.fecha.slice(5, 7)}`);
        } else if (carga) {
          l.moneda = carga.moneda;
          l.valorOrigen = l.cantidad * carga.unitCarga!;
          l.precio = 'corrida';
          l.precioFecha = corrida.fechaPorCuenta?.[l.cuenta] ?? corrida.fecha;
          inconsistencias.push(`${l.cuenta} ${l.ticker}: sin precio, valuado a la carga`);
        } else {
          inconsistencias.push(`${l.cuenta} ${l.ticker}: sin precio ni carga, queda en 0`);
        }
      }
      l.valorUsd = aUsd(l.valorOrigen, l.moneda);
      continue;
    }
    valuar(l, filaDe(l));
  }

  // 6) Manuales: ya valuadas por el cron de precios (F9.195).
  const lineasManuales: LineaViva[] = manuales.map(m => ({
    cuenta: m.cuenta, ticker: m.ticker, tipo: m.tipo, pais_riesgo: m.pais_riesgo, sector: m.sector,
    cantidad: m.cantidad, cantidadCarga: m.cantidad, moneda: 'USD', valorOrigen: m.valorUsd, valorUsd: m.valorUsd,
    precio: 'manual', precioFecha: m.fechaValuacion, revisar: false,
  }));

  for (const l of salida) {
    if (l.valorUsd === null) inconsistencias.push(`${l.cuenta} ${l.ticker}: sin TC para pasar ${l.valorOrigen} ARS a dólares; queda fuera del total`);
  }

  // 7) Totales y diferencia con la última carga.
  const suma = (xs: Array<number | null>) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);
  const totalManuales = suma(manuales.map(m => m.valorUsd));
  const totalCargaUsd = suma(trabajo.map(l => l.v0)) + totalManuales;
  const totalUsd = suma(salida.map(l => l.valorUsd)) + totalManuales;
  const totalVp = suma(trabajo.map(l => l.vp ?? l.v0)) + totalManuales;
  // Efecto dólar: lo que quedó en pesos, valuado a precios de hoy, con el MEP de hoy contra el de la carga.
  const efectoDolarUsd = tcHoy === null ? 0 : suma(trabajo.map(l => {
    if (l.tcCarga === null || l.vp === null || l.monedaVp !== 'ARS') return 0;
    const arsHoy = l.vp * tcHoy;
    return arsHoy / tcHoy - arsHoy / l.tcCarga;
  }));

  const cuentasNombres = [...new Set([...trabajo.map(l => l.cuenta), ...salida.map(l => l.cuenta)])];
  const cuentas: CuentaCarteraViva[] = cuentasNombres.map(nombre => {
    const viva = vivas.get(nombre);
    const conApi = cuentasConApi.has(nombre);
    if (viva?.error) inconsistencias.push(`${nombre}: la última sincronización falló (${viva.error})`);
    return {
      cuenta: nombre,
      fuente: conApi ? 'api' : 'corrida',
      fechaBase: conApi ? viva!.leidoEn.slice(0, 10) : corrida.fechaPorCuenta?.[nombre] ?? corrida.fecha,
      leidoEn: viva?.leidoEn ?? null,
      movimientosAplicados: aplicados.get(nombre) ?? 0,
      error: viva?.error ?? null,
      valorUsd: suma(salida.filter(l => l.cuenta === nombre).map(l => l.valorUsd)),
      valorCargaUsd: suma(trabajo.filter(l => l.cuenta === nombre).map(l => l.v0)),
    };
  });
  for (const nombre of [...new Set(manuales.map(m => m.cuenta))]) {
    const delaCuenta = manuales.filter(m => m.cuenta === nombre);
    cuentas.push({
      cuenta: nombre, fuente: 'manual',
      fechaBase: delaCuenta.map(m => m.fechaValuacion).sort()[0] ?? null, leidoEn: null,
      movimientosAplicados: 0, error: null,
      valorUsd: suma(delaCuenta.map(m => m.valorUsd)), valorCargaUsd: suma(delaCuenta.map(m => m.valorUsd)),
    });
  }

  const redondo = (x: number) => Math.round(x * 100) / 100;
  const efectoMovimientosUsd = redondo(totalUsd - totalVp);
  const efectoFlujosUsd = redondo(flujosRealesUsd(movimientos, corrida, tcHoy));
  return {
    tc,
    tcViejo: tc?.viejo ?? true,
    totalUsd: redondo(totalUsd),
    totalCargaUsd: redondo(totalCargaUsd),
    efectoPreciosUsd: redondo(totalVp - totalCargaUsd),
    efectoDolarUsd: redondo(efectoDolarUsd),
    efectoMovimientosUsd,
    efectoFlujosUsd,
    efectoSinExplicarUsd: redondo(efectoMovimientosUsd - efectoFlujosUsd),
    cuentas,
    lineas: [
      ...salida.map(({ tcCarga: _a, v0: _b, vp: _c, monedaVp: _f, unitCarga: _d, esCarga: _e, ...l }) => l),
      ...lineasManuales,
    ],
    // `valuar` corre dos veces por fila de la carga (para `vp` y para la salida): sin repetidos.
    inconsistencias: [...new Set(inconsistencias)],
  };
}

// ── Tipo de cambio (Addendum 1) ──────────────────────────────────────────────

/**
 * El TC de la cartera viva. Puro: recibe la respuesta de dolarapi ya pedida (o null si el pedido
 * falló) y los `tcDiario` disponibles.
 *
 * - Respuesta válida (`venta` > 0) y `fechaActualizacion` de HOY en hora argentina → ese valor.
 *   Medido el 19/10/2026: `fechaActualizacion` viene en ISO UTC (`2026-10-19T21:00:00.000Z` =
 *   18:00 ART), así que se pasa a hora argentina antes de comparar: después de las 21:00 ART la
 *   fecha UTC ya es la del día siguiente.
 * - Si no: el `tcDiario` más reciente, `viejo: true`. `tcDiario[D]` guarda el cierre del día hábil
 *   anterior (el cron corre a las 09:00, antes de que abra el mercado; F9.103), así que
 *   `fechaCotizacion` es `diaHabilAnterior(D)`: un doc del lunes rotula el viernes.
 * - Sin ninguno de los dos: null. No se inventa un valor.
 */
export function resolverTcCarteraViva(
  api: { status: number; body: unknown } | null,
  tcDiario: Array<{ fecha: string; tcUsdArs: number }>,
  ahoraISO: string,
): TcCarteraViva | null {
  const hoy = fechaArgentina(ahoraISO);
  if (api && api.status === 200 && api.body && typeof api.body === 'object') {
    const b = api.body as { venta?: unknown; fechaActualizacion?: unknown };
    const venta = Number(b.venta);
    const ms = typeof b.fechaActualizacion === 'string' ? Date.parse(b.fechaActualizacion) : NaN;
    if (Number.isFinite(venta) && venta > 0 && Number.isFinite(ms)) {
      const fecha = fechaArgentina(new Date(ms).toISOString());
      if (fecha === hoy) return { valor: venta, fuente: 'dolarapi-bolsa', fechaCotizacion: fecha, viejo: false };
    }
  }
  const validos = tcDiario.filter(d => Number.isFinite(d.tcUsdArs) && d.tcUsdArs > 0);
  if (!validos.length) return null;
  const ultimo = validos.reduce((a, b) => (b.fecha > a.fecha ? b : a));
  return { valor: ultimo.tcUsdArs, fuente: 'tcDiario', fechaCotizacion: diaHabilAnterior(ultimo.fecha), viejo: true };
}

/**
 * Día hábil anterior a una fecha YYYY-MM-DD: salta sábados y domingos.
 * ⚠ Limitación: no conoce feriados. Un doc del día siguiente a un feriado rotula el feriado.
 */
export function diaHabilAnterior(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

// ── Cartera viva → posiciones (F9.196 H2a) ───────────────────────────────────

/**
 * Las líneas de la cartera viva como `Posicion`, para que pesos, riesgo y reserva se calculen sobre
 * el valor de HOY con los mismos motores de siempre. Quedan afuera: las manuales (los motores las
 * reciben aparte, como hasta ahora), las líneas sin tipo y las que no se pudieron pasar a dólares.
 */
export function posicionesDeCarteraViva(cv: Pick<CarteraViva, 'lineas'>, fecha: string): Posicion[] {
  const out: Posicion[] = [];
  for (const l of cv.lineas) {
    if (l.precio === 'manual' || l.tipo === null || l.valorUsd === null) continue;
    out.push({
      cuenta: l.cuenta, titular: null, ticker: l.ticker, tipo: l.tipo, sector: l.sector ?? '',
      pais_riesgo: l.pais_riesgo ?? 'AR', moneda_origen: l.moneda, valor_origen: l.valorOrigen,
      cantidad: l.cantidad, fuente: 'cartera_viva', revisar: l.revisar,
      valorUsd: l.valorUsd, tcUsado: null, fechaCorrida: fecha,
    });
  }
  return out;
}
