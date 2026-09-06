import {
  collection, doc, getDoc, getDocs, onSnapshot, query, updateDoc, where,
  serverTimestamp, writeBatch, Timestamp, type DocumentData, type Unsubscribe,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import { sha256Archivo } from './hashArchivo';
import type { CardStatement, MovimientoParseado, AjusteConsolidado, FamiliaConfig } from '../types';
import { resolverNombreMiembro } from '../familia';
import { medioPorDefecto, ALIAS_NOMBRE_MEDIO } from './medios';
import { ajustesComputables, type ConsolidadoResumen, type DecisionAjustes } from './ajusteConsolidado';

type Resultado<T> = { ok: true; data: T } | { ok: false; error: Error };

// ── Conversión Firestore → CardStatement ──────────────────────────────────────

// Acepta Firestore Timestamp (docs seed/emulador) o string "YYYY-MM-DD" (docs escritos por la Cloud Function).
function toDateSafe(v: unknown): Date | null {
  if (!v) return null;
  if (typeof (v as { toDate?: unknown }).toDate === 'function')
    return (v as { toDate: () => Date }).toDate();
  if (typeof v === 'string') return new Date(v + 'T00:00:00');
  if (v instanceof Date) return v;
  return null;
}

export function docACardStatement(id: string, data: DocumentData): CardStatement {
  const movs = Array.isArray(data.movimientosParseados)
    ? (data.movimientosParseados as MovimientoParseado[])
    : [];
  return {
    id,
    tarjetaCodigo:       data.tarjetaCodigo        ?? null,
    banco:               data.banco               ?? '',
    tarjeta:             data.tarjeta              ?? '',
    periodo:             data.periodo              ?? '',
    estado:              data.estado               ?? 'subido',
    nroResumen:          data.nroResumen           ?? null,
    titular:             data.titular              ?? null,
    fechaCierre:         toDateSafe(data.fechaCierre),
    fechaVencimiento:    toDateSafe(data.fechaVencimiento),
    totalARS:            data.totalARS             ?? 0,
    totalUSD:            data.totalUSD             ?? 0,
    // F9.163 §1 — `?? null` y no `?? 0`: cero es un mes sin pagos, null es "no se sabe", y la
    // regla del §2 se abstiene solo ante null.
    saldoAnteriorARS:    data.saldoAnteriorARS      ?? null,
    saldoAnteriorUSD:    data.saldoAnteriorUSD      ?? null,
    pagosDelPeriodoARS:  data.pagosDelPeriodoARS    ?? null,
    pagosDelPeriodoUSD:  data.pagosDelPeriodoUSD    ?? null,
    pagoMinimoARS:       data.pagoMinimoARS         ?? 0,
    cuentaDebito:        data.cuentaDebito          ?? null,
    hashPdf:             data.hashPdf               ?? null,
    refStoragePdf:       data.refStoragePdf          ?? null,
    subidoPor:           data.subidoPor              ?? null,
    subidoEn:            data.subidoEn?.toDate()     ?? null,
    parseadoEn:          data.parseadoEn?.toDate()   ?? null,
    confirmadoEn:        data.confirmadoEn?.toDate() ?? null,
    confirmadoPor:       data.confirmadoPor          ?? null,
    observaciones:       data.observaciones          ?? null,
    errorExtraccion:     data.errorExtraccion        ?? null,
    tipoError:           data.tipoError              ?? null,
    intentos:            data.intentos               ?? 0,
    duplicadoDe:         data.duplicadoDe            ?? null,
    movimientosParseados: movs,
    ajustesConsolidado:  Array.isArray(data.ajustesConsolidado)
      ? (data.ajustesConsolidado as AjusteConsolidado[])
      : [],
  };
}

// ── Lecturas ──────────────────────────────────────────────────────────────────

export async function listarResumenesTarjeta(): Promise<Resultado<CardStatement[]>> {
  try {
    const snap = await getDocs(collection(db, 'resumenesTarjeta'));
    const data = snap.docs
      .map(d => docACardStatement(d.id, d.data()))
      .sort((a, b) => b.periodo.localeCompare(a.periodo));
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// ── Subida ────────────────────────────────────────────────────────────────────

type ResultadoSubida =
  | { ok: true;  duplicado: true;  resumen: CardStatement }
  | { ok: true;  duplicado: false; resumen: CardStatement }
  | { ok: false; error: Error };

export async function subirResumenTarjeta(
  file: File,
  memberId: string,
): Promise<ResultadoSubida> {
  try {
    const hashPdf = await sha256Archivo(file);
    const docRef  = doc(db, 'resumenesTarjeta', hashPdf);
    const snap    = await getDoc(docRef);

    if (snap.exists()) {
      return { ok: true, duplicado: true, resumen: docACardStatement(snap.id, snap.data()) };
    }

    const storagePath = `resumenesTarjeta/${hashPdf}`;
    await uploadBytes(ref(storage, storagePath), file, {
      contentType: file.type,
      customMetadata: { nombreArchivo: file.name },
    });

    await writeBatch(db)
      .set(docRef, {
        tarjetaCodigo: null,
        banco:         '',
        tarjeta:       '',
        periodo:       '',
        estado:        'subido',
        nroResumen:    null,
        titular:       null,
        fechaCierre:   null,
        fechaVencimiento: null,
        totalARS:      0,
        totalUSD:      0,
        pagoMinimoARS: 0,
        cuentaDebito:  null,
        hashPdf,
        refStoragePdf: storagePath,
        subidoPor:     memberId,
        subidoEn:      serverTimestamp(),
        movimientosParseados: [],
        ajustesConsolidado:  [],
        errorExtraccion: null,
        creadoEn:      serverTimestamp(),
        actualizadoEn: serverTimestamp(),
      })
      .commit();

    const resumen: CardStatement = {
      id: hashPdf, tarjetaCodigo: null, banco: '', tarjeta: '',
      periodo: '', estado: 'subido', nroResumen: null, titular: null,
      fechaCierre: null, fechaVencimiento: null, totalARS: 0, totalUSD: 0,
      pagoMinimoARS: 0, cuentaDebito: null, hashPdf, refStoragePdf: storagePath,
      subidoPor: memberId, subidoEn: new Date(), parseadoEn: null,
      confirmadoEn: null, confirmadoPor: null, observaciones: null,
      errorExtraccion: null, movimientosParseados: [], ajustesConsolidado: [],
    };
    return { ok: true, duplicado: false, resumen };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// ── Confirmación ──────────────────────────────────────────────────────────────

function hoyArgentinaISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}

function confirmadoPagoPorFecha(fechaISO: string | null | undefined): boolean {
  if (!fechaISO) return false;
  return fechaISO <= hoyArgentinaISO();
}

function tipoDeLinea(linea: MovimientoParseado): 'Gasto' | 'Ingreso' {
  const tiposIngreso: MovimientoParseado['tipoLinea'][] = ['reintegro_percepcion', 'bonificacion', 'reverso'];
  return tiposIngreso.includes(linea.tipoLinea) ? 'Ingreso' : 'Gasto';
}

export interface CuadreResult {
  sumaARS: number;
  sumaUSD: number;
  diffARS: number;
  diffUSD: number;
  balanceARS: boolean;
  balanceUSD: boolean;
  // F9.161 §4 — lo marcado como no debitado, y el objetivo neto contra el que se cuadra.
  // Sin nada marcado: `noDebitado*` en 0 y `objetivo* === total*`, o sea idéntico a antes.
  noDebitadoARS: number;
  noDebitadoUSD: number;
  objetivoARS: number;
  objetivoUSD: number;
  // F9.163 §2 — qué se decidió con los ajustes del consolidado y por qué. Sin el bloque
  // consolidado en el resumen la decisión es `sin_decidir` y el cuadre queda igual que antes.
  decisionAjustes: DecisionAjustes;
}

/**
 * F9.161 §4 — el total que el banco realmente cobra: el del PDF menos lo marcado `noDebitado`.
 * Única fuente de ese número: lo usan el cuadre, el movimiento-total y el banner de la UI, así que
 * las tres puntas no pueden divergir.
 */
export function totalesNetos(
  lineas: MovimientoParseado[],
  totalARS: number,
  totalUSD: number,
): { noDebitadoARS: number; noDebitadoUSD: number; objetivoARS: number; objetivoUSD: number } {
  let noDebitadoARS = 0;
  let noDebitadoUSD = 0;
  for (const l of lineas) {
    if (!l.noDebitado || l.monto <= 0) continue;
    const signo = tipoDeLinea(l) === 'Gasto' ? 1 : -1;
    if (l.moneda === 'ARS') noDebitadoARS += signo * l.monto;
    else noDebitadoUSD += signo * l.monto;
  }
  return {
    noDebitadoARS, noDebitadoUSD,
    objetivoARS: +(totalARS - noDebitadoARS).toFixed(2),
    objetivoUSD: +(totalUSD - noDebitadoUSD).toFixed(2),
  };
}

export function calcularCuadre(
  lineas: MovimientoParseado[],
  totalARS: number,
  totalUSD: number,
  ajustes: AjusteConsolidado[] = [],
  consolidado?: ConsolidadoResumen | null,
): CuadreResult {
  // F9.163 §2 — un ajuste del consolidado que el banco usó para terminar de saldar el mes ANTERIOR
  // ya está contado y no va en el cuadre de éste. Sin `consolidado` la regla se abstiene y los
  // ajustes entran como siempre: el parámetro es opcional justamente para que nada cambie sin él.
  const { ajustes: ajustesUsados, decision: decisionAjustes } = ajustesComputables(ajustes, consolidado);
  ajustes = ajustesUsados;
  // F9.161 §4 — las dos puntas se mueven juntas: la línea no debitada sale de la suma Y baja el
  // objetivo. Mover una sola dejaría una diferencia igual al monto marcado.
  const netos = totalesNetos(lineas, totalARS, totalUSD);
  totalARS = netos.objetivoARS;
  totalUSD = netos.objetivoUSD;
  let sumaARS = 0;
  let sumaUSD = 0;
  for (const l of lineas) {
    if (!l.incluir || l.noDebitado || l.monto <= 0) continue;
    const signo = tipoDeLinea(l) === 'Gasto' ? 1 : -1;
    if (l.moneda === 'ARS') sumaARS += signo * l.monto;
    else sumaUSD += signo * l.monto;
  }
  // Los ajustes del consolidado (DEV PER, etc.) ya están restados del total PDF
  // pero NO están en movimientosParseados → sumamos su monto (negativo) para llegar al neto.
  for (const a of ajustes) {
    sumaARS += a.montoARS;
    sumaUSD += a.montoUSD;
  }
  const diffARS = Math.abs(sumaARS - totalARS);
  const diffUSD = Math.abs(sumaUSD - totalUSD);
  // F9.99.5 — umbral relativo: 0.01% del total con piso de $10 ARS.
  // Resúmenes largos acumulan redondeos de céntimos → $1 era demasiado estricto.
  // USD queda en ≤1 (los totales USD son pequeños y la precisión centavil importa).
  const umbralARS = totalARS > 0 ? Math.max(10, totalARS * 0.0001) : 10;
  return {
    sumaARS, sumaUSD, diffARS, diffUSD,
    balanceARS: totalARS === 0 || diffARS <= umbralARS,
    balanceUSD: totalUSD === 0 || diffUSD <= 1,
    ...netos,
    decisionAjustes,
  };
}

// F9.139 §3 — `resumen.banco` es TEXTO LIBRE: lo escribe el modelo leyendo la carátula del PDF
// (functions/src/index.ts:1229). Propagarlo crudo a `movimientos.banco` metía bancos que nadie
// configuró — medidos 299 movimientos con "BBVA Argentina", que la app muestra como fila propia
// separada de BBVA. Precedencia, de más autoritativa a menos:
//   1. `config.tarjetas[].banco` por `tarjetaCodigo` — el mismo criterio que ya usaba `:409`.
//      Medido: resuelto en 26/26 resúmenes de prod, así que en la práctica gana siempre.
//   2. Match exacto contra los medios configurados.
//   3. Tabla de alias explícita (ALIAS_NOMBRE_MEDIO). Explícita a propósito: el matcheo difuso
//      convierte un banco desconocido en uno conocido sin que nadie se entere.
//   4. El medio por defecto — y se loguea el string crudo, que es la señal de que falta un alias.
function bancoCanonicoDeResumen(resumen: CardStatement, config: FamiliaConfig): string | null {
  const porTarjeta = config.tarjetas.find(t => t.codigo === resumen.tarjetaCodigo)?.banco;
  if (porTarjeta) return porTarjeta;

  const crudo = (resumen.banco ?? '').trim();
  if (crudo) {
    const exacto = config.bancos.find(b => b.nombre === crudo);
    if (exacto) return exacto.nombre;

    const alias = ALIAS_NOMBRE_MEDIO[crudo.toLowerCase()];
    if (alias) return alias;
  }

  // Sin mensaje inventado sobre la causa: el string crudo es el dato que sirve para saber
  // qué alias agregar a la tabla.
  console.warn('[F9.139] banco de resumen no resuelto:', JSON.stringify(crudo), '· tarjetaCodigo:', resumen.tarjetaCodigo);
  return medioPorDefecto(config.bancos)?.nombre ?? null;
}


// ── Idempotencia de la confirmación (F9.158 §1) ──────────────────────────────
//
// `confirmarResumenTarjeta` no tenía ninguna guarda de estado: hacía `batch.set` sobre refs nuevas
// para cada línea y para los dos totales, así que confirmar un resumen ya confirmado no reemplazaba
// nada — escribía todo de nuevo. Es la forma exacta de los 8 movimientos duplicados que encontró
// F9.156 §4, y la UI ofrecía el botón igual sobre un resumen `confirmado`.
//
// Política elegida: REEMPLAZO EXPLÍCITO Y ATÓMICO.
//   · Si el resumen ya tiene movimientos y no se pide `reemplazar`, la confirmación se rechaza con
//     un mensaje que dice cuántos hay. Nunca puede haber dos totales de la misma moneda.
//   · Con `reemplazar: true`, los movimientos viejos se borran EN EL MISMO BATCH que crea los
//     nuevos, así que la operación es atómica y la re-confirmación refleja las ediciones de líneas.
//
// Por qué no un upsert silencioso con ids determinísticos, que sería más elegante: hay 58
// movimientos de resumen editados a mano después de importados (categoría, persona, etiqueta —
// medido en producción, ver scripts/auditF9158.ts). Reemplazar los pierde. Esto no lo evita, pero
// obliga a que sea una decisión con el número delante en vez de un efecto secundario silencioso.

// Un movimiento pertenece a este resumen por su doc id o por la clave legacy
// `{tarjetaCodigo}_{nroResumen}`, que es la que usan los 17 resúmenes del seed (F9.156 §4).
export function clavesDeResumen(resumen: CardStatement): string[] {
  const claves = [resumen.id];
  if (resumen.tarjetaCodigo && resumen.nroResumen) {
    const legacy = `${resumen.tarjetaCodigo}_${resumen.nroResumen}`;
    if (legacy !== resumen.id) claves.push(legacy);
  }
  return claves;
}

async function movimientosDeResumen(resumen: CardStatement) {
  // Firestore no hace OR sobre el mismo campo, así que son dos queries y una unión por id.
  const snaps = await Promise.all(clavesDeResumen(resumen).map(k =>
    getDocs(query(collection(db, 'movimientos'), where('resumenTarjetaId', '==', k))),
  ));
  const vistos = new Set<string>();
  const docs: Array<{ id: string; ref: import('firebase/firestore').DocumentReference; data: () => DocumentData }> = [];
  for (const snap of snaps) {
    for (const d of snap.docs) {
      if (vistos.has(d.id)) continue;
      vistos.add(d.id);
      docs.push(d);
    }
  }
  return docs;
}

// Para que la UI diga lo mismo que el código: cuántos movimientos se reemplazarían y cuántos de
// ellos fueron tocados a mano después de importados (por si el usuario pierde ediciones).
export async function resumenYaGeneroMovimientos(
  resumen: CardStatement,
): Promise<{ total: number; editados: number }> {
  const docs = await movimientosDeResumen(resumen);
  const TOLERANCIA_MS = 5000; // creadoEn y actualizadoEn salen del mismo serverTimestamp del batch
  const editados = docs.filter(d => {
    const y = d.data();
    const c = (y.creadoEn as { toMillis?: () => number } | null)?.toMillis?.();
    const a = (y.actualizadoEn as { toMillis?: () => number } | null)?.toMillis?.();
    return c != null && a != null && a - c > TOLERANCIA_MS;
  }).length;
  return { total: docs.length, editados };
}

// Firestore admite 500 operaciones por batch. Pasarse obligaría a partirlo, y partirlo rompe la
// atomicidad justo en la operación que borra y recrea. Se rechaza con un mensaje claro en vez de
// dejar el resumen a medio reemplazar. Peor caso medido hoy: 287 operaciones.
const MAX_OPS_BATCH = 450;

export async function confirmarResumenTarjeta(
  resumen: CardStatement,
  lineasEditadas: MovimientoParseado[],
  memberId: string,
  config: FamiliaConfig,
  opciones?: { reemplazar?: boolean },
): Promise<Resultado<void>> {
  try {
    // Se resuelve UNA vez antes del batch: los cinco usos de abajo tienen que dar el mismo banco.
    const bancoCanonico = bancoCanonicoDeResumen(resumen, config);
    // ── Cuadre check ──────────────────────────────────────────────────────────
    const cuadre = calcularCuadre(lineasEditadas, resumen.totalARS, resumen.totalUSD, resumen.ajustesConsolidado, resumen);
    if (!cuadre.balanceARS || !cuadre.balanceUSD) {
      const parts = [
        !cuadre.balanceARS ? `ARS dif $${cuadre.diffARS.toFixed(2)}` : null,
        !cuadre.balanceUSD ? `USD dif $${cuadre.diffUSD.toFixed(2)}` : null,
      ].filter(Boolean).join(', ');
      return { ok: false, error: new Error(`Cuadre fallido (${parts}) — revisá las líneas antes de confirmar`) };
    }

    // Buscar los 2 itemsEsperados de esta tarjeta (ARS y USD)
    const itemsSnap = await getDocs(
      query(
        collection(db, 'itemsEsperados'),
        where('tarjetaCodigo', '==', resumen.tarjetaCodigo),
        where('activo', '==', true),
      ),
    );
    const itemARS = itemsSnap.docs.find(d => d.data().moneda === 'ARS');
    const itemUSD = itemsSnap.docs.find(d => d.data().moneda === 'USD');

    const fechaVencISO = resumen.fechaVencimiento
      ? resumen.fechaVencimiento.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
      : null;
    const confirmadoPagoTotal = confirmadoPagoPorFecha(fechaVencISO);

    // Fecha de referencia para los movimientos (vencimiento o fecha de cierre o hoy)
    const fechaRef = resumen.fechaVencimiento ?? resumen.fechaCierre ?? new Date();
    const mesRef   = `${fechaRef.getFullYear()}-${String(fechaRef.getMonth() + 1).padStart(2, '0')}`;

    // ── F9.158 §1 — idempotencia ─────────────────────────────────────────────
    const existentes = await movimientosDeResumen(resumen);
    if (existentes.length > 0 && !opciones?.reemplazar) {
      return {
        ok: false,
        error: new Error(
          `Este resumen ya generó ${existentes.length} movimiento${existentes.length !== 1 ? 's' : ''}. ` +
          'Confirmar de nuevo los reemplaza: usá "Re-confirmar".',
        ),
      };
    }

    // F9.161 §4 — `noDebitado` también saca la línea de los movimientos: el banco no la cobra,
    // así que un movimiento por ella contaría plata que nunca sale.
    const lineasAImportar = lineasEditadas.filter(l => l.incluir && !l.noDebitado && l.monto > 0);

    // deletes + líneas nuevas + 2 totales + 1 update del resumen = 3.
    // F9.165 §3 sacó los 2 updates de ítem, pero el margen se deja en 5: sobreestimar el batch
    // solo puede hacer que se rechace algo que entraba, nunca que se parta uno que no entra.
    const opsEstimadas = existentes.length + lineasAImportar.length + 5;
    if (opsEstimadas > MAX_OPS_BATCH) {
      return {
        ok: false,
        error: new Error(
          `La operación necesita ${opsEstimadas} escrituras y el máximo atómico es ${MAX_OPS_BATCH}. ` +
          'Partir el batch dejaría el resumen a medio reemplazar; hay que hacerlo a mano.',
        ),
      };
    }

    const batch = writeBatch(db);

    // Los viejos se borran en el MISMO batch que crea los nuevos: o pasa todo, o no pasa nada.
    for (const d of existentes) batch.delete(d.ref);

    // ── N movimientos de consumo ──────────────────────────────────────────────
    for (const linea of lineasAImportar) {
      const fechaConsumo = linea.fechaConsumo ? new Date(linea.fechaConsumo) : fechaRef;
      const mesConsumo   = `${fechaConsumo.getFullYear()}-${String(fechaConsumo.getMonth() + 1).padStart(2, '0')}`;

      const personaMemberId = linea.personaConfirmada
        ? resolverNombreMiembro(linea.personaConfirmada, config)
        : null;

      const movRef = doc(collection(db, 'movimientos'));
      batch.set(movRef, {
        fecha:               Timestamp.fromDate(fechaConsumo),
        mes:                 mesConsumo,
        tipo:                tipoDeLinea(linea),
        subtipo:             'Tarjeta',
        origen:              'Tarjeta',
        descripcion:         linea.descripcionRaw,
        descripcionOriginal: linea.descripcionRaw,
        monto:               linea.monto,
        moneda:              linea.moneda,
        tcUsdArs:            null,
        categoria:           linea.categoria   ?? null,
        subcategoria:        linea.subcategoria ?? null,
        etiqueta:            null,
        banco:               bancoCanonico,
        cuenta:              null,
        tarjetaCodigo:       resumen.tarjetaCodigo,
        tarjeta:             resumen.tarjeta    || null,
        persona:             personaMemberId,
        creadoPor:           memberId,
        pagado:              true,
        excluirDash:         false,
        incluirResumenMes:   false,
        resumenTarjetaId:    resumen.id,
        itemEsperadoId:      null,
        confirmadoPago:      false,
        hashPdf:             resumen.hashPdf,
        refStoragePdf:       resumen.refStoragePdf,
        padreId:             null,
        notas:               linea.cuotaTotal > 1
          ? `Cuota ${linea.cuotaActual}/${linea.cuotaTotal}`
          : null,
        creadoEn:      serverTimestamp(),
        actualizadoEn: serverTimestamp(),
      });
    }

    // F9.156 §1 — el movimiento-total se crea SIEMPRE, con el monto clampeado a cero.
    //
    // Antes iba dentro de `if (total > 0)`, y eso descartaba dos casos distintos con la misma
    // condición: el mes sin consumo en esa moneda (total 0) y el mes con saldo a favor (total
    // negativo). Sin movimiento, el ítem esperado queda `pendiente` para siempre — medido en
    // producción: 4 resúmenes en dos meses, 2 con cero y 2 con saldo a favor (−14,99 y −14,69),
    // y dos altas manuales de U$S 1 para destaparlo a mano (F9.156-pre).
    //
    // El saldo a favor NO se refleja como movimiento negativo, a propósito: el resumen del mes
    // siguiente ya viene neteado, así que un negativo lo contaría dos veces. El dato no se pierde,
    // queda en `resumenesTarjeta.totalUSD`/`totalARS`.
    //
    // F9.161 §4 — y sale por el NETO: el total del PDF menos lo marcado como no debitado. Es la
    // otra punta del cuadre; si solo se moviera el objetivo, la pantalla cuadraría en verde
    // mientras el movimiento sigue cargando plata que no se paga.
    const netos = totalesNetos(lineasEditadas, resumen.totalARS, resumen.totalUSD);
    const totalARSMov = Math.max(netos.objetivoARS, 0);
    const totalUSDMov = Math.max(netos.objetivoUSD, 0);

    // ── Total ARS ─────────────────────────────────────────────────────────────
    {
      const movTotalARS = doc(collection(db, 'movimientos'));
      batch.set(movTotalARS, {
        fecha:               Timestamp.fromDate(fechaRef),
        mes:                 mesRef,
        tipo:                'Gasto',
        subtipo:             'Tarjeta',
        origen:              'Tarjeta',
        descripcion:         `Resumen ${resumen.tarjeta} ${resumen.periodo}`,
        descripcionOriginal: null,
        monto:               totalARSMov,
        moneda:              'ARS',
        tcUsdArs:            null,
        categoria:           'Tarjetas',
        subcategoria:        bancoCanonico,
        etiqueta:            null,
        banco:               bancoCanonico,
        cuenta:              null,
        tarjetaCodigo:       resumen.tarjetaCodigo,
        tarjeta:             resumen.tarjeta || null,
        persona:             null,
        creadoPor:           memberId,
        pagado:              true,
        excluirDash:         true,
        incluirResumenMes:   true,
        resumenTarjetaId:    resumen.id,
        itemEsperadoId:      itemARS?.id ?? null,
        confirmadoPago:      confirmadoPagoTotal,
        hashPdf:             resumen.hashPdf,
        refStoragePdf:       resumen.refStoragePdf,
        padreId:             null,
        notas:               null,
        creadoEn:            serverTimestamp(),
        actualizadoEn:       serverTimestamp(),
      });
    }

    // ── Total USD ─────────────────────────────────────────────────────────────
    {
      const movTotalUSD = doc(collection(db, 'movimientos'));
      batch.set(movTotalUSD, {
        fecha:               Timestamp.fromDate(fechaRef),
        mes:                 mesRef,
        tipo:                'Gasto',
        subtipo:             'Tarjeta',
        origen:              'Tarjeta',
        descripcion:         `Resumen ${resumen.tarjeta} ${resumen.periodo} (USD)`,
        descripcionOriginal: null,
        monto:               totalUSDMov,
        moneda:              'USD',
        tcUsdArs:            null,
        categoria:           'Tarjetas',
        subcategoria:        bancoCanonico,
        etiqueta:            null,
        banco:               bancoCanonico,
        cuenta:              null,
        tarjetaCodigo:       resumen.tarjetaCodigo,
        tarjeta:             resumen.tarjeta || null,
        persona:             null,
        creadoPor:           memberId,
        pagado:              true,
        excluirDash:         true,
        incluirResumenMes:   true,
        resumenTarjetaId:    resumen.id,
        itemEsperadoId:      itemUSD?.id ?? null,
        confirmadoPago:      confirmadoPagoTotal,
        hashPdf:             resumen.hashPdf,
        refStoragePdf:       resumen.refStoragePdf,
        padreId:             null,
        notas:               null,
        creadoEn:            serverTimestamp(),
        actualizadoEn:       serverTimestamp(),
      });
    }

    // ── F9.165 §3 — la confirmación YA NO escribe `montoEsperado` ─────────────
    //
    // Acá había un `batch.update` por ítem que le pisaba `montoEsperado` con el total de ESTE
    // resumen. El resumen de un período se paga al mes siguiente, así que quedaba escrito el total
    // de agosto mientras el match que el checklist evalúa para agosto es el pago del resumen de
    // julio: `estadoItem` comparaba `montoConf` contra un esperado de otro período y devolvía
    // `parcial`.
    //
    // La medición de F9.159-pre cerró el tradeoff que frenaba sacarlo — `montoEsperado` cumple dos
    // funciones (pronóstico de la agenda y control de cobertura del checklist) y NO se superponen:
    //   · los 8 ítems de tarjeta usaron el pronóstico 0 veces en 6 meses;
    //   · los 14 no-tarjeta dispararon el control 0 veces, y 10 ya tienen `montoEsperado: null`;
    //   · los 4 `parcial` del período son todos de tarjeta y todos el desfasaje, ninguno legítimo;
    //   · con el campo en null el banner del mes en curso no cambia (Δ = 0,00).
    // Para tarjetas ese control tampoco puede detectar nada real: `montoConf` y `montoEsperado`
    // salen los dos del total del resumen, son el mismo número por construcción.
    //
    // El campo queda como lo que siempre debió ser: un valor que configura el usuario.
    // El resto de F9.156 NO se toca: el movimiento-total se sigue creando siempre con
    // `Math.max(total, 0)`, que es lo que destrabó los ítems USD y funciona.

    // ── Marcar resumen como confirmado ────────────────────────────────────────
    const resumenRef = doc(db, 'resumenesTarjeta', resumen.id);
    batch.update(resumenRef, {
      estado:              'confirmado',
      movimientosParseados: lineasEditadas,
      confirmadoEn:        serverTimestamp(),
      confirmadoPor:       memberId,
      actualizadoEn:       serverTimestamp(),
    });

    await batch.commit();
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// ── Asignación manual de tarjeta ──────────────────────────────────────────────

export async function asignarTarjetaResumen(
  resumenId: string,
  tarjetaCodigo: string,
  config: FamiliaConfig,
): Promise<Resultado<void>> {
  try {
    const tarjetaMeta = config.tarjetas.find(t => t.codigo === tarjetaCodigo);
    if (!tarjetaMeta) throw new Error(`tarjetaCodigo no encontrado: ${tarjetaCodigo}`);
    await updateDoc(doc(db, 'resumenesTarjeta', resumenId), {
      tarjetaCodigo,
      banco:         tarjetaMeta.banco,
      tarjeta:       tarjetaMeta.tipo,
      estado:        'parseado',
      actualizadoEn: serverTimestamp(),
    });
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// ── Ajuste manual de cuadre ───────────────────────────────────────────────────

/**
 * F9.161 §4 — el `motivo` es OBLIGATORIO y va al `concepto`.
 *
 * Los 10 ajustes que había en producción decían todos "Diferencia no identificada", así que cada
 * uso enterraba un bug distinto sin dejar rastro de cuál: cuatro de los treinta resúmenes tenían un
 * descuadre real tapado por este botón, de 33.035,55 a 2.878.033,12, y ninguno se podía diagnosticar
 * después. El escape sigue existiendo —bloquearlo dejaría resúmenes imposibles de confirmar— pero
 * ahora enterrar cuesta más que diagnosticar, que era el arreglo de fondo.
 */
export const MOTIVO_AJUSTE_MIN = 15;

export async function agregarAjusteCuadreManual(
  resumen: CardStatement,
  lineas: MovimientoParseado[],
  memberId: string,
  motivo: string,
): Promise<Resultado<void>> {
  try {
    const motivoLimpio = motivo.trim();
    if (motivoLimpio.length < MOTIVO_AJUSTE_MIN) {
      return {
        ok: false,
        error: new Error(
          `Hay que decir qué se está tapando (mínimo ${MOTIVO_AJUSTE_MIN} caracteres). ` +
          'Un ajuste sin motivo entierra el bug y no se puede diagnosticar después.',
        ),
      };
    }
    const cuadre = calcularCuadre(lineas, resumen.totalARS, resumen.totalUSD, resumen.ajustesConsolidado, resumen);
    const residuoARS = +(resumen.totalARS - cuadre.sumaARS).toFixed(2);
    const residuoUSD = +(resumen.totalUSD - cuadre.sumaUSD).toFixed(2);
    if (Math.abs(residuoARS) <= 1 && Math.abs(residuoUSD) <= 1) {
      return { ok: false, error: new Error('No hay diferencia para ajustar') };
    }
    const entrada: AjusteConsolidado = {
      concepto:  `Ajuste manual: ${motivoLimpio}`,
      montoARS:  residuoARS,
      montoUSD:  residuoUSD,
      origen:    'manual',
      motivo:    motivoLimpio,
      creadoPor: memberId,
      creadoEn:  new Date().toISOString(),
    };
    await updateDoc(doc(db, 'resumenesTarjeta', resumen.id), {
      ajustesConsolidado: [...resumen.ajustesConsolidado, entrada],
      actualizadoEn:      serverTimestamp(),
    });
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// ── Reintento (F9.99.5) ───────────────────────────────────────────────────────

export async function reintentarResumen(resumenId: string): Promise<Resultado<void>> {
  try {
    await updateDoc(doc(db, 'resumenesTarjeta', resumenId), {
      estado:          'subido',
      errorExtraccion: null,
      actualizadoEn:   serverTimestamp(),
    });
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// ── onSnapshot helper ─────────────────────────────────────────────────────────

export function suscribirResumenesTarjeta(
  cb: (resumenes: CardStatement[]) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, 'resumenesTarjeta'),
    snap => {
      const data = snap.docs
        .map(d => docACardStatement(d.id, d.data()))
        .sort((a, b) => b.periodo.localeCompare(a.periodo));
      cb(data);
    },
    err => console.error('[suscribirResumenesTarjeta]', err),
  );
}
