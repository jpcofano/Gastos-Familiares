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
    const dias = previo.exists && previo.data()?.historialCompleto === true ? DIAS_SIGUIENTES : DIAS_PRIMERA;
    const hoy = fechaArg(ahora());
    const desde = fechaArg(ahora() - dias * 86_400_000);
    const q = `accountNumber=${encodeURIComponent(numeroCuenta)}`;
    const balances = await cliente.get(`Account/BalancesAndPositions?${q}`);
    const movements = await cliente.get(`Account/Movements?${q}&dateFrom=${desde}&dateTo=${hoy}`);
    const plan = planSincronizacionPPI({
      cuenta, balances, movements, leidoEnISO: new Date(ahora()).toISOString(),
      clasificar: await clasificadorDeCorrida(db, cuenta),
    });
    await ref.set({ ...limpio(plan.cuentaViva), sincronizadoEn: FieldValue.serverTimestamp(), errorEn: null });
    await escribirMovimientos(db, plan.movimientos);
    const flujos = await actualizarFlujosAutomaticos(db);
    return { ...plan.resumen, dias, flujos };
  } catch (e) {
    // La última lectura buena se conserva (merge): la card muestra "PPI sin sincronizar desde dd/mm".
    await ref.set({ cuenta, fuente: 'ppi_api', error: e instanceof Error ? e.message : String(e), errorEn: FieldValue.serverTimestamp() }, { merge: true });
    throw e;
  }
}

// ── Flujos automáticos (Addendum 2 §C) ───────────────────────────────────────

export type ResumenFlujos = { internas: number; pendientes: number; flujos: number; sinTc: number };

/**
 * Depósitos y retiros de TODAS las fuentes (PPI, Balanz, …) → apareo de transferencias internas y
 * flujos. Lo que no aparea queda en `flujosAuto/estado.pendientes` hasta que Juan decida
 * (`decisionesFlujo/{clave}`); los decididos como aporte o retiro se escriben en `flujosPatrimonio`
 * con id determinista (`auto_<hash>`) y el movimiento queda con su `flujoId`.
 */
export async function actualizarFlujosAutomaticos(db: Firestore): Promise<ResumenFlujos> {
  const [movSnap, decSnap, tcSnap] = await Promise.all([
    db.collection('movimientosCuenta').where('tipo', 'in', ['deposito', 'retiro']).get(),
    db.collection('decisionesFlujo').get(),
    db.collection('tcDiario').orderBy(FieldPath.documentId(), 'desc').limit(1500).get(),
  ]);
  const movimientos: MovimientoCuenta[] = movSnap.docs.map(d => ({ ...(d.data() as MovimientoCuenta), id: d.id }));
  const decisiones: Record<string, DecisionFlujo> = {};
  for (const d of decSnap.docs) {
    const v = d.data().decision;
    if (v === 'aporte' || v === 'retiro' || v === 'interna') decisiones[d.id] = v;
  }
  const tc = new Map(tcSnap.docs.map(d => [d.id, Number(d.data().tcUsdArs)] as const));
  // tcDiario[D] guarda el cierre de D−1: el TC de un movimiento del día F es el doc del día siguiente
  // o, si no está, el más cercano anterior.
  const fechasTc = [...tc.keys()].sort();
  const tcDe = (f: string) => {
    const sig = fechasTc.find(x => x > f);
    const v = sig ? tc.get(sig) : undefined;
    if (v && v > 0) return v;
    const ant = [...fechasTc].reverse().find(x => x <= f);
    return ant ? tc.get(ant) ?? null : null;
  };
  const r = flujosAutomaticos(movimientos, decisiones, tcDe);
  const claves = new Map(movimientos.map((m, i) => [m, clavesDe(movimientos)[i]] as const));
  const resumen = (m: MovimientoCuenta) => ({
    clave: claves.get(m) ?? m.id ?? '', fecha: m.fecha, cuenta: m.cuenta, tipo: m.tipo, moneda: m.moneda,
    montoNeto: m.montoNeto, ticker: m.ticker ?? null, cantidad: m.cantidad ?? null, origen: m.origen,
  });

  const batch = db.batch();
  for (const f of r.flujos) {
    const id = `auto_${hashId(f.movimientoClave)}`;
    batch.set(db.collection('flujosPatrimonio').doc(id), {
      fecha: new Date(`${f.fecha}T12:00:00-03:00`), tipo: f.tipo, montoUsd: f.montoUsd, cuenta: f.cuenta,
      nota: `${f.nota} · automático (F9.196 §C)`, automatico: true, movimientoClave: f.movimientoClave,
    }, { merge: true });
    const mov = movimientos.find(m => (claves.get(m) ?? m.id) === f.movimientoClave);
    if (mov?.id) batch.set(db.collection('movimientosCuenta').doc(mov.id), { flujoId: id }, { merge: true });
  }
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
