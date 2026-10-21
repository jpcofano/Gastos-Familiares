// F9.196 H2a — `sincronizarPPI` (base §1): BalancesAndPositions + Movements → `cuentasVivas/ppi` y
// `movimientosCuenta`, y los flujos automáticos de F9.96 (Addendum 2 §C).
//
// Dos capas:
// - `planSincronizacionPPI` (PURA): de las respuestas de la API a lo que se escribe. Ids
//   deterministas: re-sincronizar el mismo día, o con ventanas que se pisan, no duplica nada.
// - `sincronizarPPI` (Firestore + API): lee lo necesario, llama al plan, escribe.
//
// Ventana: la primera corrida trae 3 años de movimientos (una sola vez, marca `historialCompleto`);
// las siguientes, 10 días con solapamiento.
import { FieldPath, FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { PosicionTipo, PaisRiesgo } from './compartido/tiposPatrimonio';
import type { CuentaViva } from './compartido/patrimonioCarteraViva';
import { leerPosicionesPPI, leerMovimientosPPI, movimientosDePPI, contarPorClasePPI } from './compartido/clasificacionPPI';
import { flujosAutomaticos, clavesDe, type DecisionFlujo } from './compartido/patrimonioFlujosAuto';
import { hashId, type MovimientoCuenta } from './compartido/patrimonioMovimientos';
import type { ClientePPI } from './ppiApi';

export const DIAS_PRIMERA = 1095;
export const DIAS_SIGUIENTES = 10;
/** Solapamiento con la última lectura buena, para no dejar huecos si hubo días sin sincronizar. */
export const DIAS_SOLAPAMIENTO = 3;

/**
 * Desde cuándo pedir movimientos. Sin historial completo: 3 años. Con historial: lo que sea más
 * viejo entre "hace 10 días" y "la última lectura buena − 3 días", así una racha de fallas (por
 * ejemplo credenciales vencidas) no deja un hueco permanente. Nunca más de 3 años.
 */
export function ventanaDesde(previo: { historialCompleto?: unknown; leidoEn?: unknown } | null, ahoraMs: number): { desdeMs: number; dias: number } {
  const tope = ahoraMs - DIAS_PRIMERA * 86_400_000;
  if (!previo || previo.historialCompleto !== true) return { desdeMs: tope, dias: DIAS_PRIMERA };
  let desdeMs = ahoraMs - DIAS_SIGUIENTES * 86_400_000;
  const ultima = typeof previo.leidoEn === 'string' ? Date.parse(previo.leidoEn) : NaN;
  if (Number.isFinite(ultima)) desdeMs = Math.min(desdeMs, ultima - DIAS_SOLAPAMIENTO * 86_400_000);
  desdeMs = Math.max(desdeMs, tope);
  return { desdeMs, dias: Math.ceil((ahoraMs - desdeMs) / 86_400_000) };
}

/** Distancia máxima, en días, entre un movimiento y el tcDiario que lo convierte. */
export const TC_DISTANCIA_MAX_DIAS = 5;

/**
 * El TC de un movimiento del día F. `tcDiario[D]` guarda el cierre de D−1, así que se usa el doc
 * del día SIGUIENTE más cercano y, si no hay, el anterior más cercano, siempre a
 * `TC_DISTANCIA_MAX_DIAS` días o menos. Más lejos: null (va a `sinTc`, no se inventa).
 */
export function crearTcDe(tc: Map<string, number>): (fecha: string) => number | null {
  const fechas = [...tc.keys()].filter(f => (tc.get(f) ?? 0) > 0).sort();
  const dias = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;
  return (f: string) => {
    const sig = fechas.find(x => x > f);
    if (sig && dias(sig, f) <= TC_DISTANCIA_MAX_DIAS) return tc.get(sig)!;
    const ant = [...fechas].reverse().find(x => x <= f);
    if (ant && dias(ant, f) <= TC_DISTANCIA_MAX_DIAS) return tc.get(ant)!;
    return null;
  };
}

export type DocCuentaVivaPPI = CuentaViva & {
  fuente: 'ppi_api';
  historialCompleto: boolean;
  movimientosParaRevisar: string[];
  monedasDesconocidas: string[];
};

export type PlanPPI = {
  cuentaViva: DocCuentaVivaPPI;
  movimientos: MovimientoCuenta[];
  resumen: { posiciones: number; movimientos: number; porClase: Record<string, number> };
};

/** Lo que se escribe, a partir de las respuestas crudas. Puro. */
export function planSincronizacionPPI(args: {
  cuenta: string;                 // "PPI <número>", el mismo texto que en las corridas
  balances: unknown;
  movements: unknown;
  leidoEnISO: string;
  clasificar: (ticker: string, tipo: PosicionTipo) => { sector: string; pais_riesgo: PaisRiesgo } | null;
}): PlanPPI {
  const pos = leerPosicionesPPI(args.balances, args.cuenta, args.clasificar);
  const { filas, monedasDesconocidas } = leerMovimientosPPI(args.movements);
  const movimientos = movimientosDePPI(filas, args.cuenta);
  return {
    cuentaViva: {
      cuenta: args.cuenta, fuente: 'ppi_api', leidoEn: args.leidoEnISO,
      posiciones: pos.posiciones, saldos: pos.saldos, saldosPorSubcuenta: pos.saldosPorSubcuenta,
      costoPromedio: pos.costoPromedio, costoSospechoso: pos.costoSospechoso, paraRevisar: pos.paraRevisar,
      error: null, historialCompleto: true,
      movimientosParaRevisar: filas.filter(f => f.clase === 'para_revisar').map(f => f.descripcion),
      monedasDesconocidas,
    },
    movimientos,
    resumen: { posiciones: pos.posiciones.length, movimientos: movimientos.length, porClase: contarPorClasePPI(filas) },
  };
}

const fechaArg = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);
const limpio = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Sector y país por ticker y tipo, de la corrida vigente (la misma cuenta primero). */
async function clasificadorDeCorrida(db: Firestore, cuenta: string) {
  const snap = await db.collection('snapshotsPortafolio').orderBy('fechaCorrida', 'desc').limit(1).get();
  const fecha = snap.empty ? null : (snap.docs[0].data().fechaCorrida as string);
  const m = new Map<string, { sector: string; pais_riesgo: PaisRiesgo }>();
  if (fecha) {
    const pos = await db.collection('posicionesPatrimonio').where('fechaCorrida', '==', fecha).get();
    const filas = pos.docs.map(d => d.data() as { cuenta: string; ticker: string; tipo: PosicionTipo; sector: string; pais_riesgo: PaisRiesgo });
    for (const p of [...filas.filter(p => p.cuenta === cuenta), ...filas]) {
      const k = `${p.ticker}|${p.tipo}`;
      if (!m.has(k) && p.sector) m.set(k, { sector: p.sector, pais_riesgo: p.pais_riesgo });
    }
  }
  return (ticker: string, tipo: PosicionTipo) => m.get(`${ticker}|${tipo}`) ?? null;
}

export async function escribirMovimientos(db: Firestore, movimientos: MovimientoCuenta[]): Promise<void> {
  for (let i = 0; i < movimientos.length; i += 400) {
    const batch = db.batch();
    for (const m of movimientos.slice(i, i + 400)) {
      batch.set(db.collection('movimientosCuenta').doc(m.id!), { ...limpio(m), actualizadoEn: FieldValue.serverTimestamp() }, { merge: true });
    }
    await batch.commit();
  }
}

export async function sincronizarPPI(
  db: Firestore,
  cliente: ClientePPI,
  numeroCuenta: string,
  ahora: () => number = Date.now,
): Promise<PlanPPI['resumen'] & { dias: number; flujos: ResumenFlujos }> {
  const cuenta = `PPI ${numeroCuenta}`;
  const ref = db.collection('cuentasVivas').doc('ppi');
  try {
    const previo = await ref.get();
    const { desdeMs, dias } = ventanaDesde(previo.exists ? (previo.data() ?? null) : null, ahora());
    const hoy = fechaArg(ahora());
    const desde = fechaArg(desdeMs);
    const q = `accountNumber=${encodeURIComponent(numeroCuenta)}`;
    const balances = await cliente.get(`Account/BalancesAndPositions?${q}`);
    const movements = await cliente.get(`Account/Movements?${q}&dateFrom=${desde}&dateTo=${hoy}`);
    const plan = planSincronizacionPPI({
      cuenta, balances, movements, leidoEnISO: new Date(ahora()).toISOString(),
      clasificar: await clasificadorDeCorrida(db, cuenta),
    });
    // Primero los movimientos y DESPUÉS la cuenta viva con `historialCompleto: true`: si la escritura
    // de movimientos falla a mitad, la próxima corrida vuelve a pedir la ventana entera.
    await escribirMovimientos(db, plan.movimientos);
    await ref.set({ ...limpio(plan.cuentaViva), sincronizadoEn: FieldValue.serverTimestamp(), errorEn: null });
    const flujos = await flujosSinRomper(db, 'sincronizarPPI');
    return { ...plan.resumen, dias, flujos };
  } catch (e) {
    // La última lectura buena se conserva (merge): la card muestra "PPI sin sincronizar desde dd/mm".
    await ref.set({ cuenta, fuente: 'ppi_api', error: e instanceof Error ? e.message : String(e), errorEn: FieldValue.serverTimestamp() }, { merge: true });
    throw e;
  }
}

// ── Flujos automáticos (Addendum 2 §C) ───────────────────────────────────────

export type ResumenFlujos = { internas: number; pendientes: number; flujos: number; sinTc: number; error?: string };

/**
 * Los flujos corren aparte: si fallan, NO marcan como fallida la sincronización de la cuenta (que
 * ya se leyó bien). El error queda en el log y en el resumen.
 */
export async function flujosSinRomper(db: Firestore, quien: string): Promise<ResumenFlujos> {
  try { return await actualizarFlujosAutomaticos(db); }
  catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[${quien}] flujos automáticos: ${error}`);
    return { internas: 0, pendientes: 0, flujos: 0, sinTc: 0, error };
  }
}

/**
 * Depósitos y retiros de TODAS las fuentes (PPI, Balanz, …) → apareo de transferencias internas y
 * flujos. Lo que no aparea queda en `flujosAuto/estado.pendientes` hasta que Juan decida
 * (`decisionesFlujo/{clave}`); los decididos como aporte o retiro se escriben en `flujosPatrimonio`
 * con id determinista (`auto_<hash>`) y el movimiento queda con su `flujoId`.
 */
export async function actualizarFlujosAutomaticos(db: Firestore): Promise<ResumenFlujos> {
  const [movSnap, decSnap, tcSnap, autoSnap] = await Promise.all([
    db.collection('movimientosCuenta').where('tipo', 'in', ['deposito', 'retiro']).get(),
    db.collection('decisionesFlujo').get(),
    // tcDiario entero (~1.200 docs, sin huecos desde 2023-06-01): un movimiento viejo no puede caer
    // en un TC de otra época.
    db.collection('tcDiario').orderBy(FieldPath.documentId()).get(),
    db.collection('flujosPatrimonio').where('automatico', '==', true).get(),
  ]);
  const movimientos: MovimientoCuenta[] = movSnap.docs.map(d => ({ ...(d.data() as MovimientoCuenta), id: d.id }));
  const decisiones: Record<string, DecisionFlujo> = {};
  for (const d of decSnap.docs) {
    const v = d.data().decision;
    if (v === 'aporte' || v === 'retiro' || v === 'interna') decisiones[d.id] = v;
  }
  const tcDe = crearTcDe(new Map(tcSnap.docs.map(d => [d.id, Number(d.data().tcUsdArs)] as const)));
  const r = flujosAutomaticos(movimientos, decisiones, tcDe);
  const claves = new Map(movimientos.map((m, i) => [m, clavesDe(movimientos)[i]] as const));
  const resumen = (m: MovimientoCuenta) => ({
    clave: claves.get(m) ?? m.id ?? '', fecha: m.fecha, cuenta: m.cuenta, tipo: m.tipo, moneda: m.moneda,
    montoNeto: m.montoNeto, ticker: m.ticker ?? null, cantidad: m.cantidad ?? null, origen: m.origen,
  });

  // Escrituras en lotes de 400 (el límite de Firestore es 500 por batch).
  type Op = (b: FirebaseFirestore.WriteBatch) => void;
  const ops: Op[] = [];
  const vigentes = new Set<string>();
  for (const f of r.flujos) {
    const id = `auto_${hashId(f.movimientoClave)}`;
    vigentes.add(id);
    ops.push(b => b.set(db.collection('flujosPatrimonio').doc(id), {
      fecha: new Date(`${f.fecha}T12:00:00-03:00`), tipo: f.tipo, montoUsd: f.montoUsd, cuenta: f.cuenta,
      nota: `${f.nota} · automático (F9.196 §C)`, automatico: true, movimientoClave: f.movimientoClave,
    }, { merge: true }));
    const mov = movimientos.find(m => (claves.get(m) ?? m.id) === f.movimientoClave);
    if (mov?.id) ops.push(b => b.set(db.collection('movimientosCuenta').doc(mov.id!), { flujoId: id }, { merge: true }));
  }
  // Un flujo automático que dejó de corresponder (ahora aparea como interno, Juan cambió la
  // decisión, o el movimiento se borró) se BORRA, y su movimiento pierde el `flujoId`.
  for (const d of autoSnap.docs) {
    if (vigentes.has(d.id)) continue;
    ops.push(b => b.delete(d.ref));
    for (const m of movimientos.filter(x => x.flujoId === d.id && x.id)) {
      ops.push(b => b.set(db.collection('movimientosCuenta').doc(m.id!), { flujoId: FieldValue.delete() }, { merge: true }));
    }
  }
  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    for (const op of ops.slice(i, i + 400)) op(b);
    await b.commit();
  }
  const batch = db.batch();
  batch.set(db.collection('flujosAuto').doc('estado'), {
    calculadoEn: FieldValue.serverTimestamp(),
    pendientes: r.pendientes.map(p => ({ ...resumen(p.movimiento), sugerido: p.sugerido })),
    internas: r.internas.map(i => ({ retiro: resumen(i.retiro), deposito: resumen(i.deposito), clase: i.clase, dias: i.dias, diferencia: i.diferencia })),
    sinTc: r.sinTc.map(resumen),
    flujos: r.flujos.length,
  });
  await batch.commit();
  return { internas: r.internas.length, pendientes: r.pendientes.length, flujos: r.flujos.length, sinTc: r.sinTc.length };
}
