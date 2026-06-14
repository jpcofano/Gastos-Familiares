import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { setGlobalOptions }   from 'firebase-functions/v2';
import { defineSecret }       from 'firebase-functions/params';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import Anthropic from '@anthropic-ai/sdk';
import {
  calcularPropuesta,
  type DatosExtractosMin,
  type MovimientoMin,
  type ItemEsperadoMin,
} from './matchLogica';

if (!getApps().length) initializeApp();

setGlobalOptions({ region: 'southamerica-east1' });

const db            = getFirestore();
const storage       = getStorage();
const anthropicKey  = defineSecret('ANTHROPIC_API_KEY');

const SYSTEM_PROMPT = `\
Sos un extractor de datos de comprobantes argentinos (facturas, tickets, comprobantes de pago/transferencia, resúmenes de tarjeta, recibos de servicios).

Devolvés EXCLUSIVAMENTE un objeto JSON válido. Sin markdown, sin \`\`\`json, sin texto antes ni después.

PASO 1 — Clasificá tipoDocumento ANTES que nada. Esto decide dónde están los demás campos.
Valores: "factura_a" | "factura_b" | "factura_c" | "ticket" | "comprobante_pago" | "transferencia" | "resumen_tarjeta" | "recibo_servicio" | "otro".

PASO 2 — Extraé los campos según el tipo.

REGLAS DURAS:
- cuit: 11 dígitos, formato XX-XXXXXXXX-X. Es el identificador fiscal del emisor. NUNCA lo pongas en numeroOperacion. Si ves "CUIT", "C.U.I.T." o un número de 11 dígitos con ese patrón, va en cuit.
- numeroOperacion: el número de operación / transacción / comprobante / factura. NO es el CUIT. NO es el monto. NO es la fecha.
- Si el comprobante NO tiene número de operación real, generá un pseudo-número con formato YYYY-MM-<slug>. YYYY-MM: usá periodoFacturado si existe y es claro, sino la fecha de emisión. <slug>: comercio en minúsculas, sin espacios ni acentos. Ej: "2026-06-edesur".
- moneda: "ARS" o "USD". Inferí por símbolo ($ = ARS salvo que diga USD / U$S / dólares), contexto y emisor. Ante la duda, "ARS".
- fecha: ISO "YYYY-MM-DD", fecha de emisión del documento.
- montoTotal: el monto del PRIMER vencimiento (pronto pago / monto base). NUNCA el segundo vencimiento (que lleva recargo). Si no hay vencimientos, montoTotal = total del documento.
- comercioRazonSocial: razón social o nombre de fantasía del emisor.
- periodoFacturado: el período que cubre la factura/servicio. Si es claro, normalizá a "YYYY-MM" (ej: "junio 2026" → "2026-06"). Si no es normalizable, ponelo tal cual. null si no hay período.
- numeroCliente: número de cliente / cuenta / suministro / NIS del emisor. NO es el CUIT. NO es el número de operación. null si no aplica.
- vencimientos: si el comprobante tiene fechas/montos de vencimiento (1er venc, 2do venc con recargo, etc.), listalos en orden como array de {fecha, monto}. fecha en ISO YYYY-MM-DD o null. monto como número o null. vencimientos[0].monto SIEMPRE debe coincidir con montoTotal. Si no hay vencimientos explícitos, vencimientos: [].

Si un campo no se puede determinar con confianza, usá null (excepto numeroOperacion, que siempre lleva número real o pseudo-número).

Esquema de salida EXACTO:
{
  "tipoDocumento": "...",
  "fecha": "YYYY-MM-DD" | null,
  "montoTotal": number | null,
  "moneda": "ARS" | "USD",
  "comercioRazonSocial": "..." | null,
  "cuit": "XX-XXXXXXXX-X" | null,
  "numeroOperacion": "...",
  "periodoFacturado": "YYYY-MM" | "<texto crudo>" | null,
  "numeroCliente": "..." | null,
  "vencimientos": [{ "fecha": "YYYY-MM-DD" | null, "monto": number | null }]
}`;

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export const extraerComprobante = onDocumentCreated(
  {
    document:       'comprobantes/{hash}',
    secrets:        [anthropicKey],
    timeoutSeconds: 120,
    memory:         '512MiB',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const comp = snap.data();

    // Idempotencia: solo procesar docs recién subidos
    if (comp.estado !== 'subido') return;

    const ref = db.collection('comprobantes').doc(snap.id);

    try {
      const [fileBytes] = await storage
        .bucket()
        .file(comp.refStoragePdf as string)
        .download();

      if (!fileBytes || fileBytes.length === 0) {
        throw new Error('Archivo vacío o no encontrado en Storage');
      }

      const base64      = fileBytes.toString('base64');
      const contentType = comp.contentType as string;
      const isPdf       = contentType === 'application/pdf';

      const client   = new Anthropic({ apiKey: anthropicKey.value() });
      const response = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 1536,
        system:     SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: isPdf
              ? [
                  { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } },
                  { type: 'text'     as const, text: 'Extraé este comprobante.' },
                ]
              : [
                  { type: 'image' as const, source: { type: 'base64' as const, media_type: contentType as ImageMediaType, data: base64 } },
                  { type: 'text'  as const, text: 'Extraé este comprobante.' },
                ],
          },
        ],
      });

      const raw = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();

      const cleaned = raw
        .replace(/^```json\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(cleaned) as Record<string, unknown>;
      } catch {
        throw new Error(`JSON inválido — raw (500c): ${raw.slice(0, 500)}`);
      }

      if (!Array.isArray(parsed.vencimientos)) parsed.vencimientos = [];

      if (
        parsed.montoTotal === null &&
        Array.isArray(parsed.vencimientos) &&
        parsed.vencimientos.length > 0
      ) {
        const primerVenc = parsed.vencimientos[0] as { monto?: unknown };
        if (typeof primerVenc.monto === 'number') parsed.montoTotal = primerVenc.monto;
      }

      const { tipoDocumento, moneda, numeroOperacion } = parsed;
      if (!tipoDocumento || typeof tipoDocumento !== 'string' || tipoDocumento.trim() === '') {
        throw new Error(`tipoDocumento ausente — raw (500c): ${raw.slice(0, 500)}`);
      }
      if (moneda !== 'ARS' && moneda !== 'USD') {
        throw new Error(`moneda inválida: "${String(moneda)}" — raw (500c): ${raw.slice(0, 500)}`);
      }
      if (!numeroOperacion || typeof numeroOperacion !== 'string' || numeroOperacion.trim() === '') {
        throw new Error(`numeroOperacion ausente — raw (500c): ${raw.slice(0, 500)}`);
      }

      await ref.update({
        estado:          'extraido',
        datosExtraidos:  parsed,
        errorExtraccion: FieldValue.delete(),
        actualizadoEn:   FieldValue.serverTimestamp(),
      });

      console.log(`[extraerComprobante] ${snap.id} → extraido (${String(tipoDocumento)}, ${String(moneda)})`);

    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      console.error(`[extraerComprobante] error en ${snap.id}:`, mensaje);
      await ref.update({
        estado:          'error',
        errorExtraccion: mensaje,
        actualizadoEn:   FieldValue.serverTimestamp(),
      });
    }
  },
);

export const matchComprobante = onDocumentUpdated(
  {
    document:       'comprobantes/{hash}',
    timeoutSeconds: 60,
    memory:         '256MiB',
  },
  async (event) => {
    if (!event.data) return;

    const before = event.data.before.data();
    const after  = event.data.after.data();

    // Guard anti-loop: solo cuando estado transiciona a 'extraido'
    if (before.estado === 'extraido' || after.estado !== 'extraido') return;

    const datos = after.datosExtraidos as DatosExtractosMin | undefined;
    if (!datos) return;

    const ref        = db.collection('comprobantes').doc(event.data.after.id);
    const hashActual = event.data.after.id;

    // Rama 0: dedup — ¿ya existe un movimiento con este hashPdf?
    const dedupSnap = await db.collection('movimientos')
      .where('hashPdf', '==', hashActual)
      .limit(1)
      .get();

    if (!dedupSnap.empty) {
      const movId = dedupSnap.docs[0].id;
      await ref.update({
        estado: 'vinculado',
        propuestaMatch: {
          rama:         0,
          movimientoId: movId,
          calculadoEn:  FieldValue.serverTimestamp(),
        },
        actualizadoEn: FieldValue.serverTimestamp(),
      });
      console.log(`[matchComprobante] ${hashActual} → rama 0 (dedup, mov ${movId})`);
      return;
    }

    // Derivar mes del comprobante + meses adyacentes para la ventana ±7d
    const mesComp = datos.fecha ? datos.fecha.slice(0, 7) : '';
    const mesesAConsultar: string[] = [];
    if (mesComp) {
      const [y, m] = mesComp.split('-').map(Number);
      const prev = new Date(y, m - 2);
      const next = new Date(y, m);
      mesesAConsultar.push(
        `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`,
        mesComp,
        `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`,
      );
    }

    const [movsSnap, itemsSnap] = await Promise.all([
      mesesAConsultar.length > 0
        ? db.collection('movimientos').where('mes', 'in', mesesAConsultar).get()
        : db.collection('movimientos').limit(0).get(),
      db.collection('itemsEsperados').where('activo', '==', true).get(),
    ]);

    const movs: MovimientoMin[] = movsSnap.docs.map(d => {
      const data = d.data();
      return {
        id:            d.id,
        monto:         data.monto as number,
        moneda:        data.moneda as 'ARS' | 'USD',
        tipo:          data.tipo   as 'Gasto' | 'Ingreso',
        fecha:         (data.fecha as FirebaseFirestore.Timestamp | null)?.toDate() ?? new Date(0),
        mes:           data.mes as string,
        descripcion:   (data.descripcion as string) ?? '',
        itemEsperadoId: (data.itemEsperadoId as string | null) ?? null,
      };
    });

    const items: ItemEsperadoMin[] = itemsSnap.docs.map(d => {
      const data = d.data();
      const mt   = data.matchTexto as { incluye?: string[]; excluye?: string[] } | null;
      return {
        id:         d.id,
        tipo:       data.tipo   as 'Gasto' | 'Ingreso',
        moneda:     data.moneda as 'ARS' | 'USD',
        activo:     (data.activo as boolean) ?? false,
        matchTexto: mt ? { incluye: mt.incluye ?? [], excluye: mt.excluye ?? [] } : null,
      };
    });

    const propuesta = calcularPropuesta(datos, movs, items, mesComp);

    await ref.update({
      propuestaMatch: {
        ...propuesta,
        calculadoEn: FieldValue.serverTimestamp(),
      },
      actualizadoEn: FieldValue.serverTimestamp(),
    });

    console.log(`[matchComprobante] ${hashActual} → rama ${propuesta.rama}`);
  },
);
