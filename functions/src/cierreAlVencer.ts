// F9.188 §2 — cierre al vencer. Regla en docs/CLAUDE.md, "`cierreAlVencer` — dar por pagado al
// vencer, por ítem".
//
// Toma cada obligación abierta (pagado == false, tipo Gasto, sin confirmar) con `itemEsperadoId` de
// un ítem con `cierreAlVencer: true` y fecha efectiva ANTERIOR a hoy (ART), y le escribe pagado: true
// + cerradoPor 'cierre-al-vencer' + cerradoEn + actualizadoEn. No toca confirmadoPago.
//
// Separado de index.ts para que scripts/probarF9188.ts lo corra contra el emulador con el
// firebase-admin de la raíz: por eso no importa nada de valor de firebase-admin y la marca de tiempo
// (FieldValue.serverTimestamp()) entra por parámetro. Un sentinel de otra copia del paquete no se
// puede mezclar con un Firestore de esta.
import type { Firestore, DocumentData, DocumentReference } from 'firebase-admin/firestore';

export const MARCA_CIERRE_AL_VENCER = 'cierre-al-vencer';
const TZ = 'America/Argentina/Buenos_Aires';
const LOTE = 400;

export function isoArgentina(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

/**
 * Twin de `fechaEfectivaMov` (src/datos/obligaciones.ts), en YYYY-MM-DD de ART: la primera
 * `vencimientos[].fecha` si el movimiento la trajo, si no `fecha`. Mantener en sync manual.
 */
export function fechaEfectivaISO(x: DocumentData): string | null {
  const venc = x.vencimientos;
  if (Array.isArray(venc) && venc.length > 0 && venc[0]?.fecha) {
    const s = String(venc[0].fecha).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00Z`).getTime())) return s;
  }
  const f: unknown = x.fecha?.toDate?.() ?? x.fecha;
  return f instanceof Date && !isNaN(f.getTime()) ? isoArgentina(f) : null;
}

export interface CierreAlVencer {
  id: string;
  itemEsperadoId: string;
  fechaEfectiva: string;
  moneda: string;
  monto: number;
  descripcion: string;
}

/** Lo que cerraría hoy, sin escribir nada. */
export async function candidatasCierreAlVencer(db: Firestore, hoyISO: string): Promise<Array<CierreAlVencer & { ref: DocumentReference }>> {
  const itemsSnap = await db.collection('itemsEsperados').where('cierreAlVencer', '==', true).get();
  const items = new Set(itemsSnap.docs.map(d => d.id));
  if (items.size === 0) return [];
  // Un solo campo, sin índice compuesto: el mismo filtro que useObligacionesAbiertas (F9.184 §0.2).
  const snap = await db.collection('movimientos').where('pagado', '==', false).get();
  const out: Array<CierreAlVencer & { ref: DocumentReference }> = [];
  for (const d of snap.docs) {
    const x = d.data();
    if (x.tipo !== 'Gasto' || x.confirmadoPago === true) continue;
    if (typeof x.itemEsperadoId !== 'string' || !items.has(x.itemEsperadoId)) continue;
    const fe = fechaEfectivaISO(x);
    // El día siguiente al vencimiento, nunca el mismo día: durante el día del vencimiento sigue a la
    // vista como "a pagar · vence hoy", que es cuando se ve si el débito todavía no impactó.
    if (fe == null || fe >= hoyISO) continue;
    out.push({
      ref: d.ref, id: d.id, itemEsperadoId: x.itemEsperadoId, fechaEfectiva: fe,
      moneda: String(x.moneda ?? ''), monto: Number(x.monto ?? 0), descripcion: String(x.descripcion ?? ''),
    });
  }
  return out.sort((a, b) => a.fechaEfectiva.localeCompare(b.fechaEfectiva) || a.id.localeCompare(b.id));
}

/**
 * Cierra las candidatas de hoy. Idempotente: solo mira `pagado == false`, así que una segunda corrida
 * el mismo día no encuentra nada. `marcaTiempo` es FieldValue.serverTimestamp() del llamador.
 */
export async function cerrarAlVencer(db: Firestore, hoyISO: string, marcaTiempo: unknown): Promise<CierreAlVencer[]> {
  const candidatas = await candidatasCierreAlVencer(db, hoyISO);
  const cerradas: CierreAlVencer[] = [];
  for (let i = 0; i < candidatas.length; i += LOTE) {
    const lote = candidatas.slice(i, i + LOTE);
    const batch = db.batch();
    for (const c of lote) {
      batch.update(c.ref, { pagado: true, cerradoPor: MARCA_CIERRE_AL_VENCER, cerradoEn: marcaTiempo, actualizadoEn: marcaTiempo });
    }
    await batch.commit();
    cerradas.push(...lote.map(c => ({
      id: c.id, itemEsperadoId: c.itemEsperadoId, fechaEfectiva: c.fechaEfectiva,
      moneda: c.moneda, monto: c.monto, descripcion: c.descripcion,
    })));
  }
  return cerradas;
}
