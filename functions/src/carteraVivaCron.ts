// F9.196 H2a — `actualizarCarteraViva` (base §2 + Addendum 1): arma la cartera viva y la guarda en
// `carteraViva/ultima`, con la composición por cuenta y la frescura de cada parte.
//
// Fuentes por cuenta: PPI por API (`cuentasVivas/ppi`); Bitfinex por API (`cuentasVivas/bitfinex`,
// H2c); Balanz por archivo (`cuentasVivas/balanz_*`) o la corrida; Nexo y Lemon por la corrida; las manuales; FCI
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
import { diasHabilesEntre } from './compartido/patrimonioFlujosAuto';
import type { PosicionTipo } from './compartido/tiposPatrimonio';
import { escalaData912 } from './preciosRespaldo';

const fechaArg = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(0, 10);
const horaArg = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(11, 16);
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

export type DocIndicador = {
  ticker: string; tipo: string; paisRiesgo: string;
  precio?: number | null; monedaSerie?: 'ARS' | 'USD' | null; fechaUltimoPrecio?: string | null;
  precioDia?: { precio: number; moneda: 'ARS' | 'USD'; fecha: string; fuente: string } | null;
  escalaPPI?: { identidad?: string; nominalInPrice?: number } | null;
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
      // El último cierre de la serie viene en la escala de data912: bonos y ONs cada 100 VN (fija:
      // la escala de PPI no se aplica al precio de data912, Addendum 1 C).
      const esc = escalaData912(d.tipo as PosicionTipo);
      porIdentidad[k] = { precio: d.precio / esc, moneda: d.monedaSerie, fecha: d.fechaUltimoPrecio };
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
    if (v?.fuente === 'ppi_api' || v?.fuente === 'bitfinex_api') {
      out.push(v.error
        ? `${c.cuenta}: sin sincronizar desde ${ddmm(fechaArg(v.leidoEn))} (último error: ${v.error.slice(0, 80)})`
        : `${c.cuenta}: API ${cuando(v.leidoEn)}`);
    } else if (v?.fuente === 'archivo_balanz') {
      // F9.196.1 §4 — las dos fechas a la vista: la tenencia es la de exportación de "Mis
      // Instrumentos" y la caja, la de la última liquidación del archivo de Movimientos
      // (`cajaAnclada.hasta`). Se acepta que difieran; si es más de 1 día hábil, se avisa.
      const b = v as CuentaViva & { exportadoEn?: string; cajaAnclada?: { hasta?: string } };
      const tenencia = v.posiciones?.length ? (b.exportadoEn ?? v.leidoEn).slice(0, 10) : c.fechaBase;
      const caja = b.cajaAnclada?.hasta ?? null;
      let linea = `${c.cuenta}: tenencia del ${tenencia ? ddmm(tenencia) : '—'}${v.posiciones?.length ? '' : ' (carga)'} · ${caja ? `caja al ${ddmm(caja)}` : 'caja de la carga'}`;
      if (tenencia && caja && Math.abs(diasHabilesEntre(tenencia, caja)) > 1) {
        linea += ' · ⚠ fechas distintas: una operación entre las dos puede estar en una y no en la otra';
      }
      out.push(linea);
    } else if (c.fuente === 'manual') {
      out.push(`${c.cuenta}: manual, valuada ${c.fechaBase ? ddmm(c.fechaBase) : '—'}`);
    } else {
      out.push(`${c.cuenta}: carga ${c.fechaBase ? ddmm(c.fechaBase) : '—'}${c.movimientosAplicados ? ` + ${c.movimientosAplicados} movimientos` : ''}`);
    }
  }
  out.push(cripto ? `Cripto: lectura ${cuando(cripto.leidoEnISO)}` : 'Cripto: sin lectura de precios');
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

/**
 * F9.196 nota de revisión 2 — `criptoLectura/ultima` como la escribe `leerYGuardarCripto`
 * (functions/src/index.ts): `{ ...lectura, bases, cantidadesDeFecha }`, o sea `leidoEnISO`, `precios`
 * y `sondeo` en la RAÍZ del documento (igual que lo lee el cliente, src/datos/patrimonioCriptoLectura.ts).
 * Antes los lectores de Functions buscaban `data().lectura`, que no existe: nunca veían un precio.
 * Se tolera también la forma anidada, por si quedó algún documento viejo.
 */
export function lecturaCriptoDeDoc(d: Record<string, unknown> | undefined | null): LecturaCripto | null {
  if (!d) return null;
  const x = (d.precios && typeof d.precios === 'object' ? d : d.lectura) as Partial<LecturaCripto> | undefined;
  if (!x || !x.precios || typeof x.precios !== 'object' || typeof x.leidoEnISO !== 'string' || !x.leidoEnISO) return null;
  return { leidoEnISO: x.leidoEnISO, precios: x.precios, sondeo: Array.isArray(x.sondeo) ? x.sondeo : [] };
}

/**
 * F9.196 nota de revisión 1 — `tcDiario` se lee SIN índice compuesto. `orderBy(documentId, 'desc')`
 * lo pide, y en producción falló con FAILED_PRECONDITION. Se pide una consulta ascendente por rango
 * (`documentId >= hoy − 20 días corridos`) y se recorta en memoria a los 10 más nuevos, en orden
 * descendente: `resolverTcCarteraViva` recibe lo mismo que antes.
 */
export const TC_VENTANA_DIAS = 20;
export const TC_ULTIMOS = 10;

/** El id (YYYY-MM-DD) desde el que se leen los `tcDiario`: hoy en Argentina menos `dias` corridos. */
export function desdeVentanaTc(ahoraISO: string, dias = TC_VENTANA_DIAS): string {
  const hoy = fechaArg(ahoraISO);
  return new Date(Date.parse(`${hoy}T12:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
}

/** De los docs en orden ASCENDENTE por id, los `n` más nuevos en orden DESCENDENTE (como antes). */
export function ultimosTc<T>(ascendentes: T[], n = TC_ULTIMOS): T[] {
  return ascendentes.slice(-n).reverse();
}

/** El MEP del día (Addendum 1): dolarapi, con tcDiario de respaldo. Nunca escribe en tcDiario. */
export async function tcDelDia(db: Firestore, ahoraISO: string): Promise<TcCarteraViva | null> {
  let api: { status: number; body: unknown } | null = null;
  try {
    const res = await fetch('https://dolarapi.com/v1/dolares/bolsa', { signal: AbortSignal.timeout(10_000) });
    api = { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    console.warn(`[carteraViva] dolarapi falló, se usa tcDiario: ${e instanceof Error ? e.message : String(e)}`);
  }
  const snap = await db.collection('tcDiario')
    .where(FieldPath.documentId(), '>=', desdeVentanaTc(ahoraISO))
    .orderBy(FieldPath.documentId())
    .get();
  const tcDiario = ultimosTc(snap.docs.map(d => ({ fecha: d.id, tcUsdArs: Number(d.data().tcUsdArs) })));
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
    cripto: lecturaCriptoDeDoc(cri.data()),
    manuales: man.docs.map(d => ({ ...(d.data() as PosicionManual), id: d.id })),
    tc,
  }, ahoraISO);
  await db.collection('carteraViva').doc('ultima').set({ ...limpio(doc), calculadaEn: FieldValue.serverTimestamp() });
  console.log(`[carteraViva] total U$S ${doc.totalUsd} · carga U$S ${doc.totalCargaUsd} · precios ${doc.efectoPreciosUsd} (dólar ${doc.efectoDolarUsd}) · movimientos ${doc.efectoMovimientosUsd} · MEP ${doc.tc?.valor ?? '—'}${doc.tcViejo ? ' (viejo)' : ''} · inconsistencias ${doc.inconsistencias.length}`);
  return doc;
}
