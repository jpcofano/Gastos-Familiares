// F9.183 §2 — la división de una agenda en hijos, ATÓMICA e IDEMPOTENTE. Semántica en docs/CLAUDE.md,
// "Agenda de pagos: una captura, un comprobante por fila nueva".
//
// Todo pasa en UNA transacción: leer el universo de 2.0 y los hijos candidatos, decidir, crear SOLO los
// que no existen y pasar el padre a 'dividido'. Si algo tira antes del commit no se escribe nada y el
// caller (procesarComprobante) deja el padre en 'error', con "Reintentar". Al reintentar, los ids por
// contenido y el dedup hacen que nada se repita.
//
// Recibe el `Firestore` por parámetro (no usa el `db` de index.ts) para que scripts/probarF9183.ts la
// corra contra el emulador tal cual corre en producción.
import { FieldValue, type Firestore, type DocumentReference, type DocumentData } from 'firebase-admin/firestore';
import {
  aparearConExistentes, idsDeHijos, datosDeHijo,
  type FilaAgenda, type FilaInvalida, type FilaDescartada, type Existente,
} from './agendaPagos';

export type FilaResultado =
  | (FilaAgenda & { resultado: 'hijo'; hijo: string; nuevo: boolean })
  | (FilaAgenda & { resultado: 'yaCargada'; yaCargada: { comprobanteId: string; emisor: string; monto: number; subidoEn: string | null; diferencia: number } });

export type ResultadoDivision = {
  filas: FilaResultado[];
  hijos: Array<{ id: string; nuevo: boolean }>;
  nuevos: number;
  yaCargadas: number;
};

function fechaDia(v: unknown): string | null {
  const t = v as { toDate?: () => Date } | null | undefined;
  return t?.toDate ? t.toDate().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }) : null;
}

/** Un comprobante del universo de 2.0 como `Existente`, o null si no tiene monto y vencimiento. */
export function aExistente(id: string, d: DocumentData): Existente | null {
  const de = (d.datosExtraidos ?? {}) as Record<string, unknown>;
  const venc = (de.vencimientos as Array<{ fecha?: unknown; monto?: unknown }> | undefined)?.[0];
  const monto = typeof de.montoTotal === 'number' ? de.montoTotal : typeof venc?.monto === 'number' ? venc.monto : null;
  const vencimiento = typeof venc?.fecha === 'string' ? venc.fecha.slice(0, 10) : null;
  const nc = de.numeroCliente;
  if (monto == null || monto <= 0 || !vencimiento || nc == null || String(nc).trim() === '') return null;
  return {
    id, numeroCliente: String(nc), monto, vencimiento,
    emisor: String(de.comercioRazonSocial ?? de.destinoNombre ?? ''),
    subidoEn: fechaDia(d.subidoEn),
  };
}

export async function dividirAgenda(
  db: Firestore,
  padreRef: DocumentReference,
  padre: DocumentData,
  entrada: {
    filas: FilaAgenda[];
    invalidas: FilaInvalida[];
    descartadas: FilaDescartada[];
    /** Lo que devolvió la primera llamada (tipoDocumento 'agenda_pagos'): queda como datosExtraidos del padre. */
    primera: Record<string, unknown>;
  },
  normalizar: (v: unknown) => string,
  // Solo para la verificación de atomicidad: se llama después de decidir y antes de escribir.
  opts: { antesDelCommit?: () => void } = {},
): Promise<ResultadoDivision> {
  const col = db.collection('comprobantes');

  return db.runTransaction(async tx => {
    // 2.0 — universo: todo comprobante con numeroCliente, salvo el propio padre y SUS hijos (al
    // re-dividir el mismo padre, sus hijos no son "otra fuente": se reconocen por id, nuevo:false).
    const universoSnap = await tx.get(col.where('datosExtraidos.numeroCliente', '!=', null));
    const existentes = universoSnap.docs
      .filter(d => d.id !== padreRef.id && d.data().padreHash !== padreRef.id)
      .map(d => aExistente(d.id, d.data()))
      .filter((e): e is Existente => e !== null);

    const pares = aparearConExistentes(entrada.filas, existentes, normalizar);
    const nuevas = entrada.filas.filter((_, i) => pares[i] === null);
    const { ids, repetidas } = idsDeHijos(nuevas, normalizar);
    if (repetidas > 0) console.log(`[dividirAgenda] ${padreRef.id} — ${repetidas} fila(s) idéntica(s) en la misma captura: llevan |2, |3…`);

    // 2.2.1 — leer los hijos candidatos (todas las lecturas antes de la primera escritura).
    const refs = ids.map(id => col.doc(id));
    const snaps = refs.length ? await tx.getAll(...refs) : [];
    const existe = new Map(snaps.map(s => [s.id, s.exists]));

    let k = 0;
    const filas: FilaResultado[] = entrada.filas.map((f, i) => {
      const p = pares[i];
      if (p) {
        return { ...f, resultado: 'yaCargada' as const, yaCargada: {
          comprobanteId: p.existente.id, emisor: p.existente.emisor, monto: p.existente.monto,
          subidoEn: p.existente.subidoEn, diferencia: Math.round(p.diff * 10000) / 10000,
        } };
      }
      const id = ids[k++];
      return { ...f, resultado: 'hijo' as const, hijo: id, nuevo: !existe.get(id) };
    });
    const hijos = filas.flatMap(f => (f.resultado === 'hijo' ? [{ id: f.hijo, nuevo: f.nuevo }] : []));

    opts.antesDelCommit?.();

    // 2.2.2 — crear SOLO los que no existen.
    for (const f of filas) {
      if (f.resultado !== 'hijo' || !f.nuevo) continue;
      tx.create(col.doc(f.hijo), {
        // §2.3 — hashPdf = SU PROPIO ID, no el de la imagen: la rama 0 busca movimientos por el id del
        // doc y el alta copia este campo (docs/F9.182.txt 0.2).
        hashPdf:        f.hijo,
        nombreArchivo:  `Agenda · ${f.emisor}`,
        contentType:    padre.contentType ?? null,
        tamano:         0,
        refStoragePdf:  padre.refStoragePdf,     // la imagen del padre, compartida
        subidoPor:      padre.subidoPor,
        subidoEn:       padre.subidoEn,
        estado:         'extraido',
        padreHash:      padreRef.id,
        datosExtraidos: datosDeHijo(f),
        creadoEn:       FieldValue.serverTimestamp(),
        actualizadoEn:  FieldValue.serverTimestamp(),
      });
    }

    // 2.2.3 — el padre, en la misma transacción.
    tx.update(padreRef, {
      estado:           'dividido',
      datosExtraidos:   entrada.primera,
      filas,
      hijos,
      filasInvalidas:   entrada.invalidas,
      filasDescartadas: entrada.descartadas,
      errorExtraccion:  FieldValue.delete(),
      actualizadoEn:    FieldValue.serverTimestamp(),
    });

    return {
      filas, hijos,
      nuevos: hijos.filter(h => h.nuevo).length,
      yaCargadas: filas.filter(f => f.resultado === 'yaCargada').length,
    };
  });
}
