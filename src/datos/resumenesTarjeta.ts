import {
  collection, doc, getDoc, getDocs, query, updateDoc, where,
  serverTimestamp, writeBatch, Timestamp, type DocumentData,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import { sha256Archivo } from './hashArchivo';
import type { CardStatement, MovimientoParseado, AjusteConsolidado, FamiliaConfig } from '../types';
import { resolverNombreMiembro } from '../familia';

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
}

export function calcularCuadre(
  lineas: MovimientoParseado[],
  totalARS: number,
  totalUSD: number,
  ajustes: AjusteConsolidado[] = [],
): CuadreResult {
  let sumaARS = 0;
  let sumaUSD = 0;
  for (const l of lineas) {
    if (!l.incluir || l.monto <= 0) continue;
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
  return {
    sumaARS, sumaUSD, diffARS, diffUSD,
    balanceARS: totalARS === 0 || diffARS <= 1,
    balanceUSD: totalUSD === 0 || diffUSD <= 1,
  };
}

export async function confirmarResumenTarjeta(
  resumen: CardStatement,
  lineasEditadas: MovimientoParseado[],
  memberId: string,
  config: FamiliaConfig,
): Promise<Resultado<void>> {
  try {
    // ── Cuadre check ──────────────────────────────────────────────────────────
    const cuadre = calcularCuadre(lineasEditadas, resumen.totalARS, resumen.totalUSD, resumen.ajustesConsolidado);
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

    const batch = writeBatch(db);

    // ── N movimientos de consumo ──────────────────────────────────────────────
    const lineasAImportar = lineasEditadas.filter(l => l.incluir && l.monto > 0);
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
        banco:               resumen.banco      || null,
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

    // ── Total ARS ─────────────────────────────────────────────────────────────
    if (resumen.totalARS > 0) {
      const movTotalARS = doc(collection(db, 'movimientos'));
      batch.set(movTotalARS, {
        fecha:               Timestamp.fromDate(fechaRef),
        mes:                 mesRef,
        tipo:                'Gasto',
        subtipo:             'Tarjeta',
        origen:              'Tarjeta',
        descripcion:         `Resumen ${resumen.tarjeta} ${resumen.periodo}`,
        descripcionOriginal: null,
        monto:               resumen.totalARS,
        moneda:              'ARS',
        tcUsdArs:            null,
        categoria:           'Tarjetas',
        subcategoria:        resumen.banco || null,
        etiqueta:            null,
        banco:               resumen.banco || null,
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
    if (resumen.totalUSD > 0) {
      const movTotalUSD = doc(collection(db, 'movimientos'));
      batch.set(movTotalUSD, {
        fecha:               Timestamp.fromDate(fechaRef),
        mes:                 mesRef,
        tipo:                'Gasto',
        subtipo:             'Tarjeta',
        origen:              'Tarjeta',
        descripcion:         `Resumen ${resumen.tarjeta} ${resumen.periodo} (USD)`,
        descripcionOriginal: null,
        monto:               resumen.totalUSD,
        moneda:              'USD',
        tcUsdArs:            null,
        categoria:           'Tarjetas',
        subcategoria:        resumen.banco || null,
        etiqueta:            null,
        banco:               resumen.banco || null,
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
      estado:        'subido',
      actualizadoEn: serverTimestamp(),
    });
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// ── onSnapshot helper ─────────────────────────────────────────────────────────

import { onSnapshot, type Unsubscribe } from 'firebase/firestore';

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
