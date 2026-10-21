// F9.196 H2a — `actualizarCarteraViva` (base §2 + Addendum 1): arma la cartera viva y la guarda en
// `carteraViva/ultima`, con la composición por cuenta y la frescura de cada parte.
//
// Fuentes por cuenta: PPI por API (`cuentasVivas/ppi`); Balanz por archivo (`cuentasVivas/balanz_*`)
// o la corrida; Bitfinex, Nexo y Lemon por la corrida (Bitfinex pasa a API en H2c); las manuales; FCI
// por la corrida. Precio del día: `indicadoresPosicion.precioDia` (data912 o PPI) o, si no hay, el
// último cierre. Dólar: `resolverTcCarteraViva` (MEP de dolarapi del día; si no, tcDiario, viejo).
//
// Dos capas: `armarDocCarteraViva` (PURA, con test) y `actualizarCarteraViva` (Firestore + red).
// NO modifica `posicionesPatrimonio`: las corridas siguen siendo la foto histórica.
import { FieldPath, FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { Posicion, PosicionManual, LecturaCripto } from './compartido/tiposPatrimonio';
import {
  armarCarteraViva, resolverTcCarteraViva,
  type CarteraViva, type CuentaViva, type PreciosCarteraViva, type PrecioDia, type TcCarteraViva,
} from './compartido/patrimonioCarteraViva';
import type { MovimientoCuenta } from './compartido/patrimonioMovimientos';

const fechaArg = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(0, 10);
const horaArg = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(11, 16);
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

export type DocIndicador = {
  ticker: string; tipo: string; paisRiesgo: string;
  precio?: number | null; monedaSerie?: 'ARS' | 'USD' | null; fechaUltimoPrecio?: string | null;
  precioDia?: { precio: number; moneda: 'ARS' | 'USD'; fecha: string; fuente: string } | null;
};

/**
 * Precio del día por identidad: `precioDia` (data912 o PPI) si está; si no, el último cierre de la
 * serie con su fecha (la cartera viva lo marca `viejo`).
 */
export function preciosDesdeIndicadores(docs: DocIndicador[], hoy: string): PreciosCarteraViva {
  const porIdentidad: Record<string, PrecioDia> = {};
  for (const d of docs) {
    const k = `${d.ticker}|${d.tipo}|${d.paisRiesgo}`;
    if (d.precioDia && d.precioDia.precio > 0) {
      porIdentidad[k] = { precio: d.precioDia.precio, moneda: d.precioDia.moneda, fecha: d.precioDia.fecha };
    } else if (typeof d.precio === 'number' && d.precio > 0 && d.monedaSerie && d.fechaUltimoPrecio) {
      porIdentidad[k] = { precio: d.precio, moneda: d.monedaSerie, fecha: d.fechaUltimoPrecio };
    }
  }
  return { hoy, porIdentidad };
}

/** Una línea de frescura por cuenta, más la del dólar y la del cripto. */
export function frescuraCartera(
  cv: CarteraViva,
  cuentasVivas: CuentaViva[],
  cripto: LecturaCripto | null,
  ahoraISO: string,
): string[] {
  const hoy = fechaArg(ahoraISO);
  const cuando = (iso: string) => (fechaArg(iso) === hoy ? `hoy ${horaArg(iso)}` : ddmm(fechaArg(iso)));
  const vivas = new Map(cuentasVivas.map(c => [c.cuenta, c]));
  const out: string[] = [];
  for (const c of cv.cuentas) {
    const v = vivas.get(c.cuenta);
    if (v?.fuente === 'ppi_api') {
      out.push(v.error
        ? `${c.cuenta}: sin sincronizar desde ${ddmm(fechaArg(v.leidoEn))} (último error: ${v.error.slice(0, 80)})`
        : `${c.cuenta}: API ${cuando(v.leidoEn)}`);
    } else if (v?.fuente === 'archivo_balanz') {
      out.push(v.posiciones?.length
        ? `${c.cuenta}: archivo ${ddmm(fechaArg(v.leidoEn))}${v.saldos ? ' + caja anclada' : ''}`
        : `${c.cuenta}: carga ${c.fechaBase ? ddmm(c.fechaBase) : '—'} + caja anclada al ${ddmm(fechaArg(v.leidoEn))}`);
    } else if (c.fuente === 'manual') {
      out.push(`${c.cuenta}: manual, valuada ${c.fechaBase ? ddmm(c.fechaBase) : '—'}`);
    } else {
      out.push(`${c.cuenta}: carga ${c.fechaBase ? ddmm(c.fechaBase) : '—'}${c.movimientosAplicados ? ` + ${c.movimientosAplicados} movimientos` : ''}`);
    }
  }
  if (cripto) out.push(`Cripto: lectura ${cuando(cripto.leidoEnISO)}`);
  out.push(cv.tc
    ? (cv.tc.viejo
      ? `MEP $${Math.round(cv.tc.valor).toLocaleString('es-AR')} del ${ddmm(cv.tc.fechaCotizacion)} (viejo)`
      : `MEP $${Math.round(cv.tc.valor).toLocaleString('es-AR')}, ${cuando(ahoraISO)}`)
    : 'MEP: sin dato (lo que está en pesos no se valúa)');
  return out;
}

export type EntradasCarteraViva = {
  fechaCorrida: string;
  posiciones: Posicion[];
  cuentasVivas: CuentaViva[];
  movimientos: MovimientoCuenta[];
  indicadores: DocIndicador[];
  cripto: LecturaCripto | null;
  manuales: PosicionManual[];
  tc: TcCarteraViva | null;
};

export type DocCarteraViva = CarteraViva & { fechaCorrida: string; calculadaEnISO: string; frescura: string[] };

/** PURA: lo que se guarda en `carteraViva/ultima`. */
export function armarDocCarteraViva(e: EntradasCarteraViva, ahoraISO: string): DocCarteraViva {
  const precios = preciosDesdeIndicadores(e.indicadores, fechaArg(ahoraISO));
  const cv = armarCarteraViva(
    { fecha: e.fechaCorrida, posiciones: e.posiciones }, e.cuentasVivas, e.movimientos, precios, e.cripto, e.manuales, e.tc,
  );
  return { ...cv, fechaCorrida: e.fechaCorrida, calculadaEnISO: ahoraISO, frescura: frescuraCartera(cv, e.cuentasVivas, e.cripto, ahoraISO) };
}

/** El MEP del día (Addendum 1): dolarapi, con tcDiario de respaldo. Nunca escribe en tcDiario. */
async function tcDelDia(db: Firestore, ahoraISO: string): Promise<TcCarteraViva | null> {
  let api: { status: number; body: unknown } | null = null;
  try {
    const res = await fetch('https://dolarapi.com/v1/dolares/bolsa', { signal: AbortSignal.timeout(10_000) });
    api = { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    console.warn(`[carteraViva] dolarapi falló, se usa tcDiario: ${e instanceof Error ? e.message : String(e)}`);
  }
  const snap = await db.collection('tcDiario').orderBy(FieldPath.documentId(), 'desc').limit(10).get();
  const tcDiario = snap.docs.map(d => ({ fecha: d.id, tcUsdArs: Number(d.data().tcUsdArs) }));
  return resolverTcCarteraViva(api, tcDiario, ahoraISO);
}

const limpio = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export async function actualizarCarteraViva(db: Firestore, ahora: () => number = Date.now): Promise<DocCarteraViva | null> {
  const ahoraISO = new Date(ahora()).toISOString();
  const snapQ = await db.collection('snapshotsPortafolio').orderBy('fechaCorrida', 'desc').limit(1).get();
  if (snapQ.empty) { console.warn('[carteraViva] sin corrida vigente'); return null; }
  const fechaCorrida = snapQ.docs[0].data().fechaCorrida as string;
  const [pos, vivas, movs, inds, cri, man, tc] = await Promise.all([
    db.collection('posicionesPatrimonio').where('fechaCorrida', '==', fechaCorrida).get(),
    db.collection('cuentasVivas').get(),
    db.collection('movimientosCuenta').where('fecha', '>', fechaCorrida).get(),
    db.collection('indicadoresPosicion').get(),
    db.collection('criptoLectura').doc('ultima').get(),
    db.collection('posicionesManuales').get(),
    tcDelDia(db, ahoraISO),
  ]);
  const doc = armarDocCarteraViva({
    fechaCorrida,
    posiciones: pos.docs.map(d => d.data() as Posicion),
    cuentasVivas: vivas.docs.map(d => d.data() as CuentaViva).filter(c => typeof c.leidoEn === 'string' && Array.isArray(c.posiciones)),
    movimientos: movs.docs.map(d => ({ ...(d.data() as MovimientoCuenta), id: d.id })),
    indicadores: inds.docs.map(d => d.data() as DocIndicador),
    cripto: ((cri.data()?.lectura ?? null) as LecturaCripto | null),
    manuales: man.docs.map(d => ({ ...(d.data() as PosicionManual), id: d.id })),
    tc,
  }, ahoraISO);
  await db.collection('carteraViva').doc('ultima').set({ ...limpio(doc), calculadaEn: FieldValue.serverTimestamp() });
  console.log(`[carteraViva] total U$S ${doc.totalUsd} · carga U$S ${doc.totalCargaUsd} · precios ${doc.efectoPreciosUsd} (dólar ${doc.efectoDolarUsd}) · movimientos ${doc.efectoMovimientosUsd} · MEP ${doc.tc?.valor ?? '—'}${doc.tcViejo ? ' (viejo)' : ''} · inconsistencias ${doc.inconsistencias.length}`);
  return doc;
}
