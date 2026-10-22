// F9.196 H2c — `sincronizarBitfinex` (base §1): billeteras, funding y ledgers → `cuentasVivas/bitfinex`
// y `movimientosCuenta`, y después los flujos automáticos (Addendum 2 §C) y la cartera viva.
//
// Forma real confirmada en vivo el 20/10/2026 (docs/patrimonio/cripto-apis-exploracion.md):
// - wallets: `[TYPE, CURRENCY, BALANCE, UNSETTLED, AVAILABLE, LAST_CHANGE, META]`, números.
// - ledgers: `[ID, CURRENCY, WALLET, MTS, _, AMOUNT, BALANCE, _, DESCRIPTION]`, SIN categoría en la
//   fila: se pide filtrando por `category` (101 depósito, 104 retiro, 28 interés de funding). La 51
//   (transferencia entre billeteras propias) no es flujo ni movimiento de cuenta: no se pide.
// - Sin `limit` (da error en movements): 25 filas por página; se pagina hacia atrás con `end`.
// - Funding: hoy vacío. El lector es TOLERANTE: una fila con forma desconocida queda `para_revisar`
//   sin romper la sincronización. Se confirma la primera vez que Juan preste.
//
// Capas: lectores y `planSincronizacionBitfinex` (PUROS, con test) y `sincronizarBitfinex` (red + Firestore).
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { STABLECOINS, type PosicionRaw } from './compartido/tiposPatrimonio';
import type { CuentaViva } from './compartido/patrimonioCarteraViva';
import type { MovimientoCuenta } from './compartido/patrimonioMovimientos';
import { preciosPublicosBitfinex, type ClienteBitfinex, type PedirPublico } from './bitfinexApi';
import { escribirMovimientos, flujosSinRomper, ventanaDesde, type ResumenFlujos } from './ppiSincronizacion';
import { actualizarCarteraViva, lecturaCriptoDeDoc } from './carteraVivaCron';

export const CUENTA_BITFINEX = 'Bitfinex';   // el mismo texto que en las corridas
/** Códigos de Bitfinex → ticker de la app (F9.195). */
export const TICKER_DE_BITFINEX: Record<string, string> = { UST: 'USDT', UDC: 'USDC' };
const ESTABLES_FIAT = new Set(['USD']);
export const tickerApp = (c: string) => TICKER_DE_BITFINEX[c.toUpperCase()] ?? c.toUpperCase();
const num = (x: unknown): number | null => {
  const n = typeof x === 'string' ? Number(x) : x;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

// ── Billeteras ───────────────────────────────────────────────────────────────

/**
 * Billeteras → posiciones por activo (suma exchange + margin + funding: lo prestado en funding
 * sigue en el saldo de la billetera funding). USD fiat → caja. Valor = cantidad × precio de
 * `criptoLectura` (stablecoins a 1); sin precio, valor 0 marcado `revisar` (la cartera viva lo
 * revalúa con el precio del día igual).
 */
export function leerBilleteras(body: unknown, precioUsd: (ticker: string) => number | null): {
  posiciones: PosicionRaw[]; saldos: { ARS: number; USD: number }; paraRevisar: Array<{ ticker: string; motivo: string }>;
  porBilletera: Record<string, Record<string, number>>;
} {
  if (!Array.isArray(body)) throw new Error('wallets: la respuesta no es un array');
  const cantidades = new Map<string, number>();
  const porBilletera: Record<string, Record<string, number>> = {};
  const paraRevisar: Array<{ ticker: string; motivo: string }> = [];
  let usd = 0;
  for (const w of body as unknown[]) {
    if (!Array.isArray(w) || typeof w[0] !== 'string' || typeof w[1] !== 'string') {
      paraRevisar.push({ ticker: '?', motivo: `Billetera con forma desconocida: ${JSON.stringify(w).slice(0, 80)}` });
      continue;
    }
    const balance = num(w[2]);
    if (balance === null) { paraRevisar.push({ ticker: w[1], motivo: 'BALANCE no es un número' }); continue; }
    (porBilletera[w[0]] ??= {})[w[1]] = balance;
    if (ESTABLES_FIAT.has(w[1].toUpperCase())) { usd += balance; continue; }
    const t = tickerApp(w[1]);
    cantidades.set(t, (cantidades.get(t) ?? 0) + balance);
  }
  const posiciones: PosicionRaw[] = [];
  for (const [t, q] of cantidades) {
    if (Math.abs(q) < 1e-12) continue;
    const estable = STABLECOINS.has(t);
    const px = estable ? 1 : precioUsd(t);
    posiciones.push({
      cuenta: CUENTA_BITFINEX, titular: null, ticker: t, tipo: 'cripto',
      sector: estable ? 'stablecoin' : 'cripto', pais_riesgo: 'global',
      moneda_origen: 'USD', valor_origen: px !== null ? Math.round(q * px * 100) / 100 : 0, cantidad: q,
      fuente: 'bitfinex_api', revisar: px === null, motivo_revisar: px === null ? `Sin precio de ${t} en criptoLectura ni en el ticker público de Bitfinex al sincronizar` : null,
    });
  }
  return { posiciones, saldos: { ARS: 0, USD: Math.round(usd * 100) / 100 }, paraRevisar, porBilletera };
}

// ── Funding (lector tolerante) ───────────────────────────────────────────────

export type PrestamoFunding = { origen: 'credits' | 'loans' | 'offers'; simbolo: string; monto: number; tasa: number | null; periodo: number | null; estado: string | null };

/**
 * Créditos, préstamos y ofertas de funding. Índices de la doc (credits/loans: 1 SYMBOL, 5 AMOUNT,
 * 7 STATUS, 11 RATE, 12 PERIOD; offers: 1 SYMBOL, 4 AMOUNT, 10 STATUS, 14 RATE, 15 PERIOD).
 * ⚠ Sin confirmar en vivo (hoy no hay nada prestado): una fila que no tenga esa forma va a
 * `paraRevisar` y no rompe nada.
 */
export function leerFunding(origen: PrestamoFunding['origen'], body: unknown): { prestamos: PrestamoFunding[]; paraRevisar: Array<{ ticker: string; motivo: string }> } {
  const prestamos: PrestamoFunding[] = [];
  const paraRevisar: Array<{ ticker: string; motivo: string }> = [];
  if (!Array.isArray(body)) return { prestamos, paraRevisar: [{ ticker: `funding/${origen}`, motivo: `Respuesta con forma desconocida: ${JSON.stringify(body).slice(0, 80)}` }] };
  const ix = origen === 'offers' ? { monto: 4, estado: 10, tasa: 14, periodo: 15 } : { monto: 5, estado: 7, tasa: 11, periodo: 12 };
  for (const f of body as unknown[]) {
    const ok = Array.isArray(f) && typeof f[1] === 'string' && /^f[A-Z0-9:]+$/.test(f[1]) && num(f[ix.monto]) !== null;
    if (!ok) { paraRevisar.push({ ticker: `funding/${origen}`, motivo: `Fila con forma desconocida: ${JSON.stringify(f).slice(0, 100)}` }); continue; }
    const fila = f as unknown[];
    prestamos.push({
      origen, simbolo: fila[1] as string, monto: num(fila[ix.monto])!, tasa: num(fila[ix.tasa]), periodo: num(fila[ix.periodo]),
      estado: typeof fila[ix.estado] === 'string' ? (fila[ix.estado] as string) : null,
    });
  }
  return { prestamos, paraRevisar };
}

// ── Ledgers → movimientos ────────────────────────────────────────────────────

export const CATEGORIAS_LEDGER = { deposito: 101, retiro: 104, interes: 28 } as const;

const fechaArgMs = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);

/**
 * Un asiento del ledger (de la categoría pedida) → movimiento de cuenta. Los depósitos y retiros
 * de cripto son EN ESPECIE (ticker + cantidad): para §C aparean por activo y cantidad (regla de
 * cripto). El interés de funding es renta. Id `bfxmov_<ID del asiento>`: determinista.
 */
export function movimientoDeLedger(
  fila: unknown,
  categoria: (typeof CATEGORIAS_LEDGER)[keyof typeof CATEGORIAS_LEDGER],
  precioUsd: (ticker: string) => number | null,
): MovimientoCuenta | null {
  if (!Array.isArray(fila) || num(fila[0]) === null || typeof fila[1] !== 'string' || num(fila[3]) === null || num(fila[5]) === null) return null;
  const monto = num(fila[5])!;
  const cur = fila[1].toUpperCase();
  const fiat = ESTABLES_FIAT.has(cur);
  const ticker = fiat ? null : tickerApp(cur);
  const px = fiat || (ticker && STABLECOINS.has(ticker)) ? 1 : ticker ? precioUsd(ticker) : null;
  const base: MovimientoCuenta = {
    id: `bfxmov_${num(fila[0])}`, fecha: fechaArgMs(num(fila[3])!), cuenta: CUENTA_BITFINEX, origen: 'bitfinex_api',
    moneda: 'USD', montoNeto: px !== null ? Math.round(Math.abs(monto) * px * 100) / 100 : 0,
    tipo: 'deposito', idOrigen: String(num(fila[0])), nota: typeof fila[8] === 'string' ? fila[8] : null, subcuenta: typeof fila[2] === 'string' ? fila[2] : null,
  };
  const especie = ticker ? { ticker, cantidad: Math.abs(monto), tipoActivo: 'cripto' as const } : {};
  if (categoria === CATEGORIAS_LEDGER.interes) return { ...base, tipo: 'renta', ...(ticker ? { ticker } : {}) };
  if (categoria === CATEGORIAS_LEDGER.retiro) return { ...base, tipo: 'retiro', ...especie };
  return { ...base, tipo: 'deposito', ...especie };
}

export type DocCuentaVivaBitfinex = CuentaViva & {
  fuente: 'bitfinex_api';
  porBilletera: Record<string, Record<string, number>>;
  prestamos: PrestamoFunding[];
  historialCompleto: boolean;
};

/** PURO: de las respuestas crudas a lo que se escribe. */
export function planSincronizacionBitfinex(args: {
  wallets: unknown;
  funding: Array<{ origen: PrestamoFunding['origen']; body: unknown }>;
  ledgers: Array<{ categoria: (typeof CATEGORIAS_LEDGER)[keyof typeof CATEGORIAS_LEDGER]; filas: unknown[] }>;
  leidoEnISO: string;
  precioUsd: (ticker: string) => number | null;
}): { cuentaViva: DocCuentaVivaBitfinex; movimientos: MovimientoCuenta[] } {
  const b = leerBilleteras(args.wallets, args.precioUsd);
  const prestamos: PrestamoFunding[] = [];
  const paraRevisar = [...b.paraRevisar];
  for (const f of args.funding) {
    const r = leerFunding(f.origen, f.body);
    prestamos.push(...r.prestamos);
    paraRevisar.push(...r.paraRevisar);
  }
  const porId = new Map<string, MovimientoCuenta>();
  for (const l of args.ledgers) {
    for (const fila of l.filas) {
      const m = movimientoDeLedger(fila, l.categoria, args.precioUsd);
      if (m) porId.set(m.id!, m);
      else paraRevisar.push({ ticker: `ledger/${l.categoria}`, motivo: `Asiento con forma desconocida: ${JSON.stringify(fila).slice(0, 100)}` });
    }
  }
  return {
    cuentaViva: {
      cuenta: CUENTA_BITFINEX, fuente: 'bitfinex_api', leidoEn: args.leidoEnISO,
      posiciones: b.posiciones, saldos: b.saldos, porBilletera: b.porBilletera, prestamos, paraRevisar,
      error: null, historialCompleto: true,
    },
    movimientos: [...porId.values()].sort((x, y) => x.fecha.localeCompare(y.fecha) || x.id!.localeCompare(y.id!)),
  };
}

// ── Red + Firestore ──────────────────────────────────────────────────────────

/** Ledger de una categoría, paginando hacia atrás con `end` (25 por página, sin `limit`). */
async function ledgerPaginado(cliente: ClienteBitfinex, categoria: number, desdeMs: number, maxPaginas: number): Promise<unknown[]> {
  const out: unknown[] = [];
  let end: number | undefined;
  for (let i = 0; i < maxPaginas; i++) {
    const pagina = await cliente.leer('auth/r/ledgers/hist', { category: categoria, start: desdeMs, ...(end ? { end } : {}) });
    if (!Array.isArray(pagina) || !pagina.length) break;
    out.push(...pagina);
    const mts = (pagina as unknown[][]).map(f => num(f?.[3])).filter((x): x is number => x !== null);
    const masViejo = Math.min(...mts);
    if (pagina.length < 25 || !Number.isFinite(masViejo) || masViejo <= desdeMs) break;
    end = masViejo - 1;
  }
  return out;
}

/**
 * F9.196 nota de revisión 2 — los activos (de billeteras y ledgers) que no tienen precio en
 * `criptoLectura`: se piden al ticker público de Bitfinex. USD fiat y stablecoins no (valen 1).
 */
export function tickersSinPrecio(
  wallets: unknown, ledgers: Array<{ filas: unknown[] }>, precioLectura: (t: string) => number | null,
): string[] {
  const monedas: string[] = [];
  if (Array.isArray(wallets)) for (const w of wallets) if (Array.isArray(w) && typeof w[1] === 'string') monedas.push(w[1]);
  for (const l of ledgers) for (const f of l.filas) if (Array.isArray(f) && typeof f[1] === 'string') monedas.push(f[1]);
  const out = new Set<string>();
  for (const m of monedas) {
    if (ESTABLES_FIAT.has(m.toUpperCase())) continue;
    const t = tickerApp(m);
    if (STABLECOINS.has(t) || precioLectura(t) !== null) continue;
    out.add(t);
  }
  return [...out].sort();
}

/** Precio en USD: el de `criptoLectura`; si falta, el del ticker público de Bitfinex; si no, null. */
export const precioConRespaldo = (lectura: (t: string) => number | null, publicos: Record<string, number>) =>
  (t: string): number | null => lectura(t) ?? publicos[t] ?? null;

export async function sincronizarBitfinex(
  db: Firestore, cliente: ClienteBitfinex, ahora: () => number = Date.now,
  /** Lectura pública de precios (inyectable para tests). */
  pedirPublico?: PedirPublico,
): Promise<{
  posiciones: number; movimientos: number; prestamos: number; paraRevisar: number; flujos: ResumenFlujos;
  /** F9.196.1 Addendum 1 B — por qué no se pudo recalcular la cartera viva (null = se recalculó). */
  carteraError: string | null;
}> {
  const ref = db.collection('cuentasVivas').doc('bitfinex');
  try {
    const previo = await ref.get();
    // Misma ventana que PPI: 3 años la primera vez; después, sin huecos si hubo días sin sincronizar.
    const { desdeMs, dias } = ventanaDesde(previo.exists ? (previo.data() ?? null) : null, ahora());
    // Nota de revisión 2: `criptoLectura/ultima` tiene `precios` en la raíz (antes se leía `.lectura`).
    const lectura = lecturaCriptoDeDoc((await db.collection('criptoLectura').doc('ultima').get()).data());
    const precioLectura = (t: string) => lectura?.precios?.[t]?.valor ?? null;

    const wallets = await cliente.leer('auth/r/wallets');
    const funding: Array<{ origen: PrestamoFunding['origen']; body: unknown }> = [];
    for (const [origen, endpoint] of [['credits', 'auth/r/funding/credits'], ['loans', 'auth/r/funding/loans'], ['offers', 'auth/r/funding/offers']] as const) {
      funding.push({ origen, body: await cliente.leer(endpoint) });
    }
    const ledgers: Array<{ categoria: 101 | 104 | 28; filas: unknown[] }> = [];
    for (const categoria of [CATEGORIAS_LEDGER.deposito, CATEGORIAS_LEDGER.retiro, CATEGORIAS_LEDGER.interes]) {
      ledgers.push({ categoria, filas: await ledgerPaginado(cliente, categoria, desdeMs, dias > 30 ? 40 : 4) });
    }
    // Lo que no tiene precio en criptoLectura: ticker público de Bitfinex (un pedido). Si tampoco hay,
    // la posición queda en 0 con `revisar` y la cartera viva la valúa a la carga, con aviso.
    const faltan = tickersSinPrecio(wallets, ledgers, precioLectura);
    const publicos = faltan.length ? await preciosPublicosBitfinex(faltan, pedirPublico) : { precios: {}, error: null };
    if (publicos.error) console.warn(`[sincronizarBitfinex] ticker público de Bitfinex: ${publicos.error}`);
    const precioUsd = precioConRespaldo(precioLectura, publicos.precios);
    const plan = planSincronizacionBitfinex({ wallets, funding, ledgers, leidoEnISO: new Date(ahora()).toISOString(), precioUsd });
    // Movimientos primero; la cuenta viva (con `historialCompleto: true`) al final.
    await escribirMovimientos(db, plan.movimientos);
    await ref.set({ ...JSON.parse(JSON.stringify(plan.cuentaViva)), sincronizadoEn: FieldValue.serverTimestamp(), errorEn: null });
    const flujos = await flujosSinRomper(db, 'sincronizarBitfinex');
    // Las cantidades de la card cripto salen de la cartera viva: se recalcula ya, no a las 18:20.
    // Si falla, Bitfinex ya quedó sincronizado: no se tira, pero se devuelve el motivo (el botón no
    // puede decir "Valor de hoy recalculado" si no lo está).
    const carteraError = await actualizarCarteraViva(db, ahora)
      .then(d => (d ? null : 'no hay una corrida vigente'))
      .catch(e => {
        const m = e instanceof Error ? e.message : String(e);
        console.error(`[sincronizarBitfinex] cartera viva: ${m}`);
        return m;
      });
    return {
      posiciones: plan.cuentaViva.posiciones.length, movimientos: plan.movimientos.length,
      prestamos: plan.cuentaViva.prestamos.length, paraRevisar: plan.cuentaViva.paraRevisar?.length ?? 0, flujos, carteraError,
    };
  } catch (e) {
    await ref.set({ cuenta: CUENTA_BITFINEX, fuente: 'bitfinex_api', error: e instanceof Error ? e.message : String(e), errorEn: FieldValue.serverTimestamp() }, { merge: true });
    throw e;
  }
}
