import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions }   from 'firebase-functions/v2';
import { defineSecret }       from 'firebase-functions/params';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp, FieldPath, type Firestore, type Query } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import Anthropic from '@anthropic-ai/sdk';
import {
  calcularPropuesta,
  normalizarDestino,
  reconciliarPorPayee,
  reconciliarPorNombre,
  type DatosExtractosMin,
  type MovimientoMin,
  type ItemEsperadoMin,
  type PropuestaMatch,
} from './matchLogica';
import { normalizar, type NormRule } from './normalizador';

if (!getApps().length) initializeApp();

setGlobalOptions({ region: 'southamerica-east1' });

const db            = getFirestore();
const storage       = getStorage();
const anthropicKey  = defineSecret('ANTHROPIC_API_KEY');

function hoyArgentinaISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}

// F9.75 — obligaciones (facturas / recibos de servicio): definen el gasto pero NO se pagan por el
// mero vencimiento. El pago llega después y lo confirma la reconciliación por payee. Ticket/otro/
// pagos siguen la regla de fecha. `resumen_tarjeta` tiene su propia lógica y no entra acá.
function esObligacionDoc(tipo?: string | null): boolean {
  return tipo === 'recibo_servicio'
      || tipo === 'factura_a' || tipo === 'factura_b' || tipo === 'factura_c';
}

function buildSystemPrompt(hoy: string): string {
  return `\
Sos un extractor de datos de comprobantes argentinos (facturas, tickets, comprobantes de pago/transferencia, resúmenes de tarjeta, recibos de servicios).

Hoy es ${hoy} (zona horaria America/Argentina/Buenos_Aires).

Devolvés EXCLUSIVAMENTE un objeto JSON válido. Sin markdown, sin \`\`\`json, sin texto antes ni después.

PASO 1 — Clasificá tipoDocumento ANTES que nada. Esto decide dónde están los demás campos.
Valores: "factura_a" | "factura_b" | "factura_c" | "ticket" | "comprobante_pago" | "transferencia" | "resumen_tarjeta" | "recibo_servicio" | "otro".

PASO 2 — Extraé los campos según el tipo.

REGLAS DURAS:
- cuit: 11 dígitos, formato XX-XXXXXXXX-X. Es el identificador fiscal del emisor. NUNCA lo pongas en numeroOperacion. Si ves "CUIT", "C.U.I.T." o un número de 11 dígitos con ese patrón, va en cuit.
- numeroOperacion: el número de operación / transacción / comprobante / factura. NO es el CUIT. NO es el monto. NO es la fecha.
- Si el comprobante NO tiene número de operación real, generá un pseudo-número con formato YYYY-MM-<slug>. YYYY-MM: usá periodoFacturado si existe y es claro, sino la fecha de emisión. <slug>: comercio en minúsculas, sin espacios ni acentos. Ej: "2026-06-edesur".
- moneda: "ARS" o "USD". Inferí por símbolo ($ = ARS salvo que diga USD / U$S / dólares), contexto y emisor. Ante la duda, "ARS".
- fecha: ISO "YYYY-MM-DD" con año de 4 dígitos SIEMPRE. Es la fecha de emisión.
  Si el documento NO muestra el año explícitamente (ej. "13/jun"), asumí el año tal que la fecha sea
  la ocurrencia MÁS RECIENTE de ese día/mes que NO sea futura respecto de hoy. Ejemplos (hoy = 2026-06-16):
  "13/jun" → 2026-06-13; "20/dic" → 2025-12-20 (porque dic 2026 todavía no pasó).
  NUNCA elijas un año pasado arbitrario ni dejes un año por defecto.
- Aplicá el mismo criterio de año (ocurrencia más reciente no futura respecto de hoy) a las fechas de
  vencimientos[] y al YYYY-MM del pseudo-número / periodoFacturado cuando el año no esté explícito.
- montoTotal: el monto del PRIMER vencimiento (pronto pago / monto base). NUNCA el segundo vencimiento (que lleva recargo). Si no hay vencimientos, montoTotal = total del documento.
- EXPENSAS/CONSORCIO: Si el documento es una liquidación de expensas o consorcio (lista múltiples rubros del edificio: sueldos, cargas sociales, etc.), NO extraigas el total del edificio. Buscá la fila o sección de la unidad funcional UF 043 del titular (COFANO, Del Signo 4042) y extraé el monto a pagar de ESA unidad como montoTotal. Una sola unidad → un solo monto. Ignorá otras UF y los totales del consorcio. Si la UF 043 no figura en el documento, montoTotal = null.
- comercioRazonSocial: razón social o nombre de fantasía del emisor.
- periodoFacturado: el período que cubre la factura/servicio. Si es claro, normalizá a "YYYY-MM" (ej: "junio 2026" → "2026-06"). Si no es normalizable, ponelo tal cual. null si no hay período.
- numeroCliente: número de cliente / cuenta / suministro / NIS del emisor. NO es el CUIT. NO es el número de operación. null si no aplica.
- vencimientos: si el comprobante tiene fechas/montos de vencimiento (1er venc, 2do venc con recargo, etc.), listalos en orden como array de {fecha, monto}. fecha en ISO YYYY-MM-DD o null. monto como número o null. vencimientos[0].monto SIEMPRE debe coincidir con montoTotal. Si no hay vencimientos explícitos, vencimientos: [].
- destinoCbu: CBU/CVU del destinatario (22 dígitos sin espacios). Para transferencia = cuenta receptora. Para factura/servicio = CBU de cobro si figura en el documento. null si no aplica.
- destinoCuit: CUIT/CUIL del PAYEE (a quién se le paga), solo dígitos, 11 dígitos, sin guiones.
  · TRANSFERENCIA/PAGO: es la parte "Para"/"Destinatario"/"Beneficiario"; NUNCA la parte "De"/"Origen" (el titular que paga).
  · FACTURA / COMPROBANTE DE COMERCIO: NO hay parte "Para". El payee del pago futuro ES EL EMISOR (el comercio que emite la factura). Por lo tanto destinoCuit = el MISMO CUIT del emisor (igual valor que el campo cuit, pero solo dígitos sin guiones).
  null si no hay payee claro.
- destinoAlias: alias CVU/CBU del destinatario exactamente como aparece en el documento pero en minúsculas (ej: "micooperativa.mp"). null si no aplica.
- destinoNombre: nombre o razón social del PAYEE. Para transferencia/pago = el destinatario; para factura = el emisor (mismo que comercioRazonSocial). null si no aplica.

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
  "vencimientos": [{ "fecha": "YYYY-MM-DD" | null, "monto": number | null }],
  "destinoCbu": "..." | null,
  "destinoCuit": "XXXXXXXXXXX" | null,
  "destinoAlias": "..." | null,
  "destinoNombre": "..." | null
}`;
}

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
      const hoy         = hoyArgentinaISO();

      const client   = new Anthropic({ apiKey: anthropicKey.value() });
      const response = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 1536,
        system:     buildSystemPrompt(hoy),
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

      // Extracción robusta: el modelo puede narrar prosa antes del JSON
      // (típico en docs complejos como liquidaciones de expensas). Mismo patrón
      // que extraerResumenTarjeta: bloque ```json``` o primer {…último }.
      const mdMatch  = raw.match(/```json\s*([\s\S]*?)\s*```/);
      const rawMatch = raw.match(/(\{[\s\S]*\})/);
      const jsonStr  = mdMatch ? mdMatch[1] : (rawMatch ? rawMatch[1] : null);
      if (!jsonStr) throw new Error(`Sin JSON en la respuesta (500c): ${raw.slice(0, 500)}`);

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(sanitizarJson(jsonStr)) as Record<string, unknown>;
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

      if (typeof parsed.fecha === 'string' && parsed.fecha > hoy) {
        console.warn(`[extraerComprobante] ${snap.id} → fecha futura sospechosa: ${parsed.fecha} (hoy=${hoy})`);
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

// F9.82 — carga nombres aprendidos en /destinos tipo='nombre' con confianza suficiente
async function cargarNombresDestinoAprendidos(): Promise<Map<string, string>> {
  const snap = await db.collection('destinos')
    .where('tipo', '==', 'nombre')
    .where('confianza', '>=', 0.7)
    .limit(500)
    .get();
  const mapa = new Map<string, string>();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.destinoNorm && data.itemEsperadoId) {
      mapa.set(data.destinoNorm as string, data.itemEsperadoId as string);
    }
  }
  return mapa;
}

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
      const movDoc  = dedupSnap.docs[0];
      const movId   = movDoc.id;
      const movData = movDoc.data();
      await ref.update({
        estado: 'vinculado',
        propuestaMatch: {
          rama:         0,
          movimientoId: movId,
          dedupInfo: {
            movId,
            mes:   (movData.mes   as string  | null) ?? null,
            monto: (movData.monto as number  | null) ?? null,
            item:  (movData.descripcion as string | null) ?? null,
          },
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
        destinoCuit:    (data.destinoCuit    as string | null)  ?? null,
        destinoCbu:     (data.destinoCbu     as string | null)  ?? null,
        destinoAlias:   (data.destinoAlias   as string | null)  ?? null,
        destinoNombre:  (data.destinoNombre  as string | null)  ?? null,
        vencimientos:   (data.vencimientos   as Array<{ monto?: number | null }> | null) ?? null,
        confirmadoPago: (data.confirmadoPago as boolean)        ?? false,
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

    // F6.9 — Reconciliación pago↔obligación por payee (antes que clasificación/destino)
    const esPago = datos.tipoDocumento === 'transferencia'
                || datos.tipoDocumento === 'comprobante_pago';
    if (esPago) {
      const reconc = reconciliarPorPayee(datos, movs);
      if (reconc.length === 1) {
        await ref.update({
          propuestaMatch: {
            rama: 1,
            movimientoId: reconc[0].id,
            origenReconciliacion: true,
            calculadoEn: FieldValue.serverTimestamp(),
          },
          actualizadoEn: FieldValue.serverTimestamp(),
        });
        console.log(`[matchComprobante] ${hashActual} → rama 1 (reconciliación por payee, mov ${reconc[0].id})`);
        return;
      }
      if (reconc.length > 1) {
        await ref.update({
          propuestaMatch: {
            rama: 1,
            candidatos: reconc.map(m => ({
              tipo: 'movimiento' as const,
              id: m.id, score: 0,
              descripcion: m.descripcion, monto: m.monto, moneda: m.moneda,
              fecha: m.fecha.toISOString().slice(0, 10),
            })),
            origenReconciliacion: true,
            calculadoEn: FieldValue.serverTimestamp(),
          },
          actualizadoEn: FieldValue.serverTimestamp(),
        });
        console.log(`[matchComprobante] ${hashActual} → rama 1 candidatos (reconciliación, ${reconc.length})`);
        return;
      }
      // F9.82 — 0 candidatos fuerte: pase débil por nombre (nunca auto-confirma)
      // F9.82.1 — fail-soft: si la query de alias falla (índice, permisos, etc.),
      // degradar a pase débil sin alias en vez de abortar todo el match
      let nombresAprendidos: Map<string, string> | null = null;
      try {
        nombresAprendidos = await cargarNombresDestinoAprendidos();
      } catch (e) {
        console.error('[matchComprobante] cargarNombresDestinoAprendidos falló, sigo sin alias:', e);
      }
      const reconcDebil = reconciliarPorNombre(datos, movs, nombresAprendidos);
      if (reconcDebil.length > 0) {
        await ref.update({
          propuestaMatch: {
            rama: 1,
            candidatos: reconcDebil.map(m => ({
              tipo: 'movimiento' as const,
              id: m.id, score: 0,
              descripcion: m.descripcion, monto: m.monto, moneda: m.moneda,
              fecha: m.fecha.toISOString().slice(0, 10),
            })),
            origenReconciliacion: true,
            reconciliacionDebil: true,
            calculadoEn: FieldValue.serverTimestamp(),
          },
          actualizadoEn: FieldValue.serverTimestamp(),
        });
        console.log(`[matchComprobante] ${hashActual} → rama 1 débil (nombre, ${reconcDebil.length} candidatos)`);
        return;
      }
    }

    // Rama destino: match por CBU/alias/nombre aprendido (prioridad sobre texto)
    const propuestaDestino = await matchPorDestino(datos, movs, mesComp);

    // F6.9.7 (P2) — un destino CON itemEsperadoId (rama 2, incluido adicional) gana directo.
    // Un destino SIN item (rama 3, solo categoría aprendida) NO corta el flujo: dejamos que
    // matchConEsperados pruebe por texto. Si nada engancha, cae a rama 3 conservando el prefill.
    if (propuestaDestino && propuestaDestino.rama === 2) {
      await ref.update({
        propuestaMatch: { ...propuestaDestino, calculadoEn: FieldValue.serverTimestamp() },
        actualizadoEn:  FieldValue.serverTimestamp(),
      });
      console.log(`[matchComprobante] ${hashActual} → rama destino (item=${propuestaDestino.itemEsperadoId}, adicional=${propuestaDestino.esAdicional ?? false})`);
      return;
    }

    // sin movs: elimina el rama-1 por monto+mes (autovínculo silencioso).
    // Reconciliación de pagos → F6.9 por payee (arriba); dedup → rama 0.
    const propuesta = calcularPropuesta(datos, [], items, mesComp);

    // F6.9.7 (P2) — si los esperados por texto no engancharon (rama 3) pero el destino había
    // aprendido una categoría, conservamos ese prefill en la rama 3 (no perdemos lo aprendido).
    const propuestaFinal =
      propuesta.rama === 3 && propuestaDestino?.rama === 3
        ? {
            ...propuesta,
            origenDestino:        true,
            categoriaPrellena:    propuestaDestino.categoriaPrellena    ?? null,
            subcategoriaPrellena: propuestaDestino.subcategoriaPrellena ?? null,
            etiquetaPrellena:     propuestaDestino.etiquetaPrellena     ?? null,
          }
        : propuesta;

    await ref.update({
      propuestaMatch: {
        ...propuestaFinal,
        calculadoEn: FieldValue.serverTimestamp(),
      },
      actualizadoEn: FieldValue.serverTimestamp(),
    });

    console.log(`[matchComprobante] ${hashActual} → rama ${propuestaFinal.rama}${(propuestaFinal as { origenDestino?: boolean }).origenDestino && propuestaFinal.rama === 3 ? ' (cat. de destino)' : ''}`);
  },
);

// ── F6.4.5 — Aprendizaje del diccionario (trigger on movimientos) ─────────────

import { createHash } from 'crypto';

// sync manual con src/datos/clasificador.ts
const CONFIANZA_INCREMENTO = 0.1;

function idAprendido(patronNormalizado: string, bancoFiltro: string, tarjetaFiltro: string): string {
  return createHash('sha256')
    .update(`${patronNormalizado}\x00${bancoFiltro}\x00${tarjetaFiltro}`)
    .digest('hex')
    .slice(0, 24);
}

function idDestinoNorm(norm: string): string {
  return createHash('sha256').update(norm).digest('hex').slice(0, 24);
}

async function matchPorDestino(
  datos: DatosExtractosMin,
  movs: MovimientoMin[],
  mesComp: string,
): Promise<Omit<PropuestaMatch, 'calculadoEn'> | null> {
  const raws = [datos.destinoCbu, datos.destinoCuit, datos.destinoAlias, datos.destinoNombre]
    .filter((r): r is string => typeof r === 'string' && r.trim().length > 0);

  for (const raw of raws) {
    const parsed = normalizarDestino(raw);
    if (!parsed) continue;

    const snap = await db.collection('destinos').doc(idDestinoNorm(parsed.norm)).get();
    if (!snap.exists) continue;

    const d = snap.data()!;
    if (((d.confianza as number) ?? 0) < 0.7) continue;

    const itemId = (d.itemEsperadoId as string | undefined);
    if (itemId) {
      const yaEnMes = movs.some(m => m.itemEsperadoId === itemId && m.mes === mesComp);
      if (!yaEnMes) {
        return { rama: 2, itemEsperadoId: itemId, origenDestino: true };
      } else {
        // Esperado ya pagado ese período → movimiento adicional
        return {
          rama: 2,
          itemEsperadoId: itemId,
          esAdicional:         true,
          origenDestino:       true,
          categoriaPrellena:    (d.categoria    as string | null) ?? null,
          subcategoriaPrellena: (d.subcategoria as string | null) ?? null,
          etiquetaPrellena:     (d.etiqueta     as string | null) ?? null,
        };
      }
    } else if (d.categoria) {
      // Solo categoría aprendida — prefill sin vínculo a item
      return {
        rama: 3,
        origenDestino:       true,
        categoriaPrellena:    d.categoria    as string,
        subcategoriaPrellena: (d.subcategoria as string | null) ?? null,
        etiquetaPrellena:     (d.etiqueta     as string | null) ?? null,
      };
    }
  }
  return null;
}

async function cargarReglasNormalizacion(): Promise<NormRule[]> {
  const snap = await db.collection('reglasNormalizacion').get();
  return snap.docs
    .map(d => d.data())
    .filter(d => d.activo !== false) // F8.3 — soft-disable real
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    .map(d => ({ tipo: d.tipo, patron: d.patron, reemplazo: d.reemplazo ?? '' } as NormRule));
}

async function aprender(data: FirebaseFirestore.DocumentData): Promise<void> {
  const descripcionFinal:    string | null = (data.descripcion         as string) ?? null;
  const descripcionOriginal: string | null = (data.descripcionOriginal as string) ?? null;
  const categoria:    string | null = (data.categoria    as string)  ?? null;
  const subcategoria: string | null = (data.subcategoria as string)  ?? null;
  const banco:        string | null = (data.banco        as string)  ?? null;
  // tarjetaCodigo es el identificador único de tarjeta (ej: "gal-visa-sig")
  const tarjeta:      string | null = (data.tarjetaCodigo as string) ?? null;

  if (!descripcionFinal || !categoria) return;
  // textoRaw: la cruda si existe (precarga desde comprobante), sino la descripción tal cual se guardó.
  const textoRaw = (descripcionOriginal ?? descripcionFinal).trim();
  if (!textoRaw) return;

  const reglas = await cargarReglasNormalizacion();
  const patron = normalizar(textoRaw, reglas).toLowerCase();
  if (!patron) return;

  // Validar subcategoría contra el catálogo antes de persistirla
  let subcatValidada: string | null = null;
  if (subcategoria) {
    const snap = await db.collection('subcategorias')
      .where('categoriaPadre', '==', categoria)
      .where('valor', '==', subcategoria)
      .where('activo', '==', true)
      .limit(1)
      .get();
    subcatValidada = snap.empty ? null : subcategoria;
  }

  const id  = idAprendido(patron, banco ?? '', tarjeta ?? '');
  const ref = db.collection('diccionario').doc(id);
  const doc = await ref.get();

  if (doc.exists) {
    const existing = doc.data()!;
    const correccion = existing.categoria !== categoria || existing.subcategoria !== subcatValidada;
    const updatePayload: Record<string, unknown> = {
      categoria,
      subcategoria:      subcatValidada,
      descripcionLimpia: descripcionFinal,
      usoCount:          FieldValue.increment(1),
      ultimoUso:         FieldValue.serverTimestamp(),
      actualizadoEn:     FieldValue.serverTimestamp(),
    };
    if (correccion) {
      const prevConfianza = typeof existing.confianza === 'number' ? existing.confianza : 0.8;
      updatePayload.confianza = Math.min(1.0, prevConfianza + CONFIANZA_INCREMENTO);
    }
    await ref.update(updatePayload);
    console.log(`[aprender] upsert ${id} → ${categoria} / ${subcatValidada ?? 'sin subcat'}${correccion ? ' (+confianza)' : ''}`);
  } else {
    await ref.set({
      patron,
      patronOriginal:    textoRaw,
      tipoMatch:         'contains',
      descripcionLimpia: descripcionFinal,
      categoria,
      subcategoria:      subcatValidada,
      etiqueta:          null,
      personaDefault:    null,
      monedaDefault:     null,
      bancoFiltro:       banco   ?? null,
      tarjetaFiltro:     tarjeta ?? null,
      confianza:         0.8,
      accionDefault:     '',
      usoCount:          1,
      ultimoUso:         FieldValue.serverTimestamp(),
      activo:            true,
      origen:            'Manual',
      creadoPor:         'aprendizaje',
      creadoEn:          FieldValue.serverTimestamp(),
      notas:             null,
    });
    console.log(`[aprender] insert ${id} → ${categoria} / ${subcatValidada ?? 'sin subcat'}`);
  }
}

async function aprenderDestino(data: FirebaseFirestore.DocumentData): Promise<void> {
  const destinoCbu    = (data.destinoCbu    as string | null) ?? null;
  const destinoCuit   = (data.destinoCuit   as string | null) ?? null;
  const destinoAlias  = (data.destinoAlias  as string | null) ?? null;
  const destinoNombre = (data.destinoNombre as string | null) ?? null;
  const itemEsperadoId = (data.itemEsperadoId as string | null) ?? null;
  const categoria     = (data.categoria    as string | null) ?? null;
  const subcategoria  = (data.subcategoria as string | null) ?? null;
  const etiqueta      = (data.etiqueta     as string | null) ?? null;
  const creadoPor     = (data.creadoPor    as string)        ?? 'sistema';

  if (!categoria && !itemEsperadoId) return;

  const destinoRaw = destinoCbu ?? destinoCuit ?? destinoAlias ?? destinoNombre;
  if (!destinoRaw) return;

  const parsed = normalizarDestino(destinoRaw);
  if (!parsed) return;

  const id  = idDestinoNorm(parsed.norm);
  const ref = db.collection('destinos').doc(id);
  const doc = await ref.get();

  if (doc.exists) {
    const existing = doc.data()!;
    const correccion =
      (itemEsperadoId && existing.itemEsperadoId !== itemEsperadoId) ||
      existing.categoria !== categoria;
    const update: Record<string, unknown> = {
      categoria, subcategoria, etiqueta,
      actualizadoEn: FieldValue.serverTimestamp(),
    };
    if (itemEsperadoId) update.itemEsperadoId = itemEsperadoId;
    if (correccion) {
      const prev = typeof existing.confianza === 'number' ? existing.confianza : 0.8;
      update.confianza = Math.min(1.0, prev + CONFIANZA_INCREMENTO);
    }
    await ref.update(update);
    console.log(`[aprenderDestino] upsert ${id} (${parsed.tipo}) → ${categoria ?? 'sin cat'} / item=${itemEsperadoId ?? '-'}${correccion ? ' (+confianza)' : ''}`);
  } else {
    await ref.set({
      destinoNorm:  parsed.norm,
      tipo:         parsed.tipo,
      ...(itemEsperadoId ? { itemEsperadoId } : {}),
      categoria, subcategoria, etiqueta,
      confianza:    0.8,
      creadoPor,
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    console.log(`[aprenderDestino] insert ${id} (${parsed.tipo}) → ${categoria ?? 'sin cat'} / item=${itemEsperadoId ?? '-'}`);
  }

  // F9.82 — si la llave principal es fuerte (CBU/CUIT/alias), también aprender el
  // destinoNombre como entrada tipo 'nombre' para que el pase débil lo encuentre el
  // mes siguiente (el banco repite el mismo texto pero sin CUIT/CBU).
  if (parsed.tipo !== 'nombre' && destinoNombre) {
    const parsedNombre = normalizarDestino(destinoNombre);
    if (parsedNombre?.tipo === 'nombre') {
      const idNombre  = idDestinoNorm(parsedNombre.norm);
      const refNombre = db.collection('destinos').doc(idNombre);
      const docNombre = await refNombre.get();
      if (!docNombre.exists) {
        await refNombre.set({
          destinoNorm:  parsedNombre.norm,
          tipo:         'nombre',
          ...(itemEsperadoId ? { itemEsperadoId } : {}),
          categoria, subcategoria, etiqueta,
          confianza:    0.8,
          creadoPor,
          actualizadoEn: FieldValue.serverTimestamp(),
        });
        console.log(`[aprenderDestino] insert nombre alias ${idNombre} → item=${itemEsperadoId ?? '-'}`);
      } else if (itemEsperadoId && !docNombre.data()?.itemEsperadoId) {
        await refNombre.update({ itemEsperadoId, actualizadoEn: FieldValue.serverTimestamp() });
      }
    }
  }
}

export const aprenderMovimientoCreado = onDocumentCreated(
  { document: 'movimientos/{id}', memory: '256MiB' },
  async event => {
    const data = event.data?.data();
    if (data?.seedImport) return;
    await Promise.all([
      data?.categoria && data?.subcategoria
        ? aprender(data).catch(e => console.error('[aprender] error en create:', e))
        : Promise.resolve(),
      aprenderDestino(data ?? {}).catch(e => console.error('[aprenderDestino] error en create:', e)),
    ]);
  },
);

export const aprenderMovimientoActualizado = onDocumentUpdated(
  { document: 'movimientos/{id}', memory: '256MiB' },
  async event => {
    const before = event.data?.before.data();
    const after  = event.data?.after.data();
    if (after?.seedImport) return;
    await Promise.all([
      after?.categoria && after?.subcategoria &&
      (before?.categoria !== after.categoria || before?.subcategoria !== after.subcategoria)
        ? aprender(after).catch(e => console.error('[aprender] error en update:', e))
        : Promise.resolve(),
      aprenderDestino(after ?? {}).catch(e => console.error('[aprenderDestino] error en update:', e)),
    ]);
  },
);

// ── F6.5 — Extracción de resúmenes de tarjeta ─────────────────────────────────

const PERSONAS_CANONICAS = `\
MAPEO CANÓNICO DE PERSONAS (usá estos valores exactos en personaDetectada):
  "MARIA LASCANO", "LASCANO MARIA", "LASCANO,MARIA", "Maria Lascano" → "María"
  "JUAN PABLO COFANO", "COFANO JUAN", "COFANO,JUAN", "Juan Pablo Cofano" → "Juan"
  "FEDERICO N COFANO", "Federico N Cofano" → "Federico"
  "SOFIA COFANO", "Sofía Cofano" → "Sofía"`;

function buildResumenTarjetaPrompt(banco: string, tarjeta: string): string {
  return `Sos un parser especializado en resúmenes de tarjetas de crédito argentinas.
Tu tarea es extraer los datos del PDF adjunto y devolver ÚNICAMENTE un bloque JSON válido
(envuelto en \`\`\`json ... \`\`\`).

CONTEXTO DE ESTA TARJETA:
- Banco: ${banco}
- Tarjeta: ${tarjeta}

${PERSONAS_CANONICAS}

═══════════════════════════════════════════════════════════
PARTE 1 — OBJETO "resumen" (metadata del encabezado del PDF)
═══════════════════════════════════════════════════════════

Extraé los siguientes campos:
- nroResumen: número de resumen del encabezado
  (ej Galicia Visa: "VI00000000064559935", Galicia Master: "027032119814",
   BBVA: número de sobre como "1445563")
- banco: "${banco}"
- tarjeta: "${tarjeta}"
- titular: nombre del titular principal tal como aparece (ej: "LASCANO MARIA")
- fechaCierre: fecha de cierre ACTUAL en formato YYYY-MM-DD
  (no el cierre anterior; buscá "Cierre actual" o "CIERRE ACTUAL")
- fechaVencimiento: fecha de vencimiento ACTUAL en formato YYYY-MM-DD
  (buscá "Vencimiento actual" o "VENCIMIENTO ACTUAL")
- totalARS: total a pagar en pesos (número decimal, sin símbolos $)
  (buscá "TOTAL A PAGAR" o "SALDO ACTUAL $")
- totalUSD: total a pagar en dólares (número decimal, 0 si no aplica)
- pagoMinimoARS: pago mínimo en pesos (número decimal)
- cuentaDebito: número de cuenta donde se debitará
  (extraer de la línea "DEBITAREMOS DE SU C.A.XXXXXXXXX" o "DEBITAREMOS DE SU CTA XXXXXXXXX"
   o "Debitaremos de su c.ahorro XXXXXXXXXX"; devolver solo el número de cuenta)
- numeroCuenta: número de cuenta/tarjeta del CLIENTE tal como aparece en el encabezado del PDF
  (BBVA: cerca de "Cuenta:" o "N° DE CUENTA" en el membrete; Galicia: campo "CUENTA" o "Nro. cuenta")
  Este número identifica la tarjeta específica (ej: "0916360348", "2380140-0-6"). NO es cuentaDebito.
  Si no se puede determinar con certeza, null.
- ultimos4: últimos 4 dígitos del PAN de la tarjeta tal como aparece en el encabezado
  (buscar el número enmascarado tipo "4509 XX** **** 1234" o "XXXX XXXX XXXX 5678" → devolver "1234" o "5678")
  Si no hay PAN enmascarado en el encabezado, null.
- ajustesConsolidado: array de ajustes de período ANTERIOR que aparecen en el CONSOLIDADO entre
  "SU PAGO" y "SALDO PENDIENTE". Típicamente son devoluciones de percepción del período anterior
  (ej: "DEV PER RG 4815 30% -67.399,98"). Estos NO van en movimientos (no son gasto del mes actual)
  pero SÍ se registran acá para que el cuadre funcione. El banco ya los restó del total a pagar.
  Cada item: { "concepto": "...", "montoARS": -67399.98, "montoUSD": 0 }
  Incluí el signo: devoluciones/créditos son negativos, débitos extra son positivos.
  NO incluir "SU PAGO EN PESOS/USD" ni "SALDO ANTERIOR" (esos no afectan el cuadre del mes).
  Si no hay ajustes, devolver [].

═══════════════════════════════════════════════════════════
PARTE 2 — ARRAY "movimientos" (uno por línea de consumo)
═══════════════════════════════════════════════════════════

── QUÉ INCLUIR ──
✓ Todos los consumos y cuotas del "DETALLE DEL CONSUMO"
✓ Percepciones e impuestos (IIBB, IVA RG, DB.RG, PERCEPCION)
✓ Devoluciones de percepciones (DEV.IMP, CR.RG, DEV PER, CAJA SEG-PROMO)
✓ Bonificaciones (BONIF. CONSUMO) y reversos (montos negativos en la sección de consumos)

── QUÉ EXCLUIR ──
✗ Saldo anterior
✗ Pagos del resumen anterior (SU PAGO EN PESOS, SU PAGO EN USD)
✗ Devoluciones de percepciones que aparecen en el CONSOLIDADO entre
  "SU PAGO" y "SALDO PENDIENTE" (ej: DEV PER RG 4815 30% con monto
  negativo). Estas son ajustes del período anterior, NO del mes actual.
  SOLO incluir devoluciones que aparezcan en el DETALLE DEL CONSUMO
  o debajo del SUBTOTAL como percepciones del mes.
✗ Subtotales por persona o tarjeta (esas líneas solo sirven para detectar persona)
✗ Todo el texto legal, tablas de financiación, información institucional
✗ Cuotas a vencer (tabla de proyección futura)

── CAMPOS POR MOVIMIENTO ──

seq (number): secuencia desde 1

tipoLinea (string): uno de estos valores:
  "consumo"              → gasto en un solo pago (cuotaTotal=1)
  "cuota"                → cuota de compra en cuotas (cuotaTotal>1)
  "impuesto"             → percepción o impuesto (IIBB, IVA RG, DB.RG, PERCEPCION)
  "reintegro_percepcion" → devolución de percepción (DEV.IMP, CR.RG, DEV PER, CAJA SEG-PROMO)
  "bonificacion"         → descuento explícito (BONIF. CONSUMO ...)
  "reverso"              → anulación de consumo previo (monto negativo en sección de consumos)

fechaConsumo (string|null): fecha en formato YYYY-MM-DD.
  - Para percepciones sin fecha propia, usar la fechaCierre del resumen.
  - Para devoluciones en el CONSOLIDADO (CR.RG, DEV PER), usar la fecha que aparece en esa línea.
  - Las fechas del PDF vienen en formato DD-MM-YY o DD-MM-AAAA; convertir a YYYY-MM-DD.

descripcionRaw (string): descripción limpia del comercio o concepto.
  REGLAS DE LIMPIEZA:
  • BBVA cuotas: quitar el sufijo " C.XX/YY" al final
    (ej: "LAS MARGARITAS C.02/03" → "LAS MARGARITAS")
  • BBVA consumos USD: quitar "USD X,XX" o "USD X.XX" de la descripción
    (ej: "PLAYSTATION USD 9,99" → "PLAYSTATION";
         "NETFLIX.COM EaDrY5hBOUSD 14,34" → "NETFLIX.COM EaDrY5hBOH";
         "APPLE.COM/BILL USD 6,99" → "APPLE.COM/BILL")
  • Galicia Visa consumos USD: la descripción termina con el código de sesión y el monto USD
    (ej: "AMAZON PRIME*5B5 1VaRjv8EhUSD" → "AMAZON PRIME*5B5 1VaRjv8Eh";
         el monto USD aparece como número en la misma línea)
  • No modificar el resto de la descripción; preservar mayúsculas como están

nroCupon (string): número de cupón/comprobante. Vacío si no hay.

cuotaActual (number): número de cuota actual. 0 si no aplica, 1 si es un solo pago.
cuotaTotal (number): total de cuotas. 0 si no aplica, 1 si es un solo pago.
  DETECCIÓN DE CUOTAS:
  • BBVA: el sufijo " C.XX/YY" en la descripción indica cuotaActual=XX, cuotaTotal=YY
  • Galicia Visa: columna CUOTA explícita con formato "XX/YY"
  • Galicia Master: sección "CUOTA DEL MES" o "CUOTAS DEL MES" + columna cuota "XX/YY"
  • Si cuotaTotal=1 o no hay info de cuotas → tipoLinea="consumo", no "cuota"

moneda (string): "ARS" o "USD".
  Un movimiento es en USD si:
  • El monto aparece en la columna DÓLARES (no en PESOS)
  • La descripción contiene "USD X,XX" o el monto USD está separado

monto (number): monto en la moneda indicada. SIEMPRE positivo.
  (para bonificaciones y reversos el monto también es positivo;
   el carácter negativo lo indica tipoLinea/esBonificacion/esReverso)
  CONVERSIÓN: los números argentinos usan punto como miles y coma como decimal.
  "1.447,94" → 1447.94   "301.393,73" → 301393.73   "9,99" → 9.99

personaDetectada (string): nombre canónico (ver mapeos arriba). Vacío si no se puede determinar.
  DETECCIÓN POR FORMATO:

  BBVA (Visa y Mastercard):
  El PDF tiene secciones tituladas "Consumos [Nombre Apellido]" o
  "Consumos [Nombre] [Apellido]". Todos los movimientos bajo esa sección
  son de esa persona, hasta que aparece la siguiente sección.
  Ejemplo: bajo "Consumos Maria Lascano" → personaDetectada="María"

  GALICIA VISA:
  El detalle se divide en bloques cerrados por subtotales:
  "TARJETA XXXX Total Consumos de NOMBRE APELLIDO"
  Los movimientos ANTES de ese subtotal son de esa persona.
  Ejemplo: si la línea "TARJETA 9318 Total Consumos de MARIA LASCANO" aparece
  después de un bloque, todos los movimientos de ese bloque → personaDetectada="María".
  Si hubiera movimientos antes del primer subtotal, son del titular principal.

  GALICIA MASTERCARD:
  El titular principal (la persona en el encabezado) tiene los consumos principales.
  Los adicionales aparecen antes del subtotal "TOTAL ADICIONAL DE NOMBRE,APELLIDO".
  Ejemplo: movimientos antes de "TOTAL ADICIONAL DE COFANO,JUAN" → personaDetectada="Juan".
  Los movimientos del titular principal son los del bloque inicial.

  PERCEPCIONES E IMPUESTOS: dejar personaDetectada = "" (vacío).

esBonificacion (boolean): true solo si es un descuento explícito (BONIF. CONSUMO)
esReverso (boolean): true solo si anula/revierte un consumo previo (monto negativo en consumos)
esImpuesto (boolean): true si tipoLinea = "impuesto"
esPagoAnterior (boolean): false siempre (los pagos no se incluyen)

═══════════════════════════════════════════════════════════
DUPLICACIONES A EVITAR
═══════════════════════════════════════════════════════════

DEV PER RG 4815 30% en Galicia Master: aparece UNA SOLA VEZ en el
  CONSOLIDADO. NO duplicar. Usar fechaCierre como fecha si no tiene fecha propia.

Consumos en USD (ej PARAMOUNT+): aparecen UNA SOLA VEZ. El PDF puede mostrar
  el monto ARS equivalente en la misma línea entre paréntesis (USA,ARS,1321.49).
  Eso NO es un segundo movimiento — es la conversión. Generar UN solo movimiento
  con moneda=USD y el monto en USD.

═══════════════════════════════════════════════════════════
CASOS ESPECIALES IMPORTANTES
═══════════════════════════════════════════════════════════

CR.RG 5617 en BBVA (sección "Sus pagos y ajustes realizados"):
  → tipoLinea="reintegro_percepcion", monto positivo (ignorar signo negativo)
  → fechaConsumo = fecha de la línea, personaDetectada = ""

DEV.IMP. RG 5617 en Galicia Visa (sección CONSOLIDADO):
  → tipoLinea="reintegro_percepcion", monto positivo

DEV PER RG 4815 en Galicia Master:
  → Si aparece en el CONSOLIDADO (entre SU PAGO y SALDO PENDIENTE)
    con monto NEGATIVO: es del período anterior. EXCLUIR (igual que SU PAGO).
  → Si aparece en el DETALLE DEL CONSUMO o como percepción del mes
    con monto POSITIVO: es un reintegro del mes actual.
    tipoLinea="reintegro_percepcion", monto positivo.

PERCEPCIONES EN GALICIA MASTER (aparecen en el CONSOLIDADO, no en el detalle):
  "PERCEPCION IVA DTO 354/18", "PERCEP.AFIP RG 4815 30%", "PERC IIBB SERV DIG CABA"
  → tipoLinea="impuesto", esImpuesto=true
  → fechaConsumo = fechaCierre del resumen

CAJA SEG-PROMO en BBVA (aparece en la sección de consumos con monto positivo):
  → tipoLinea="reintegro_percepcion", monto positivo

4F SOLUCIONES y similares (monto negativo en consumos, cancela una compra previa):
  → tipoLinea="reverso", esReverso=true, monto positivo (valor absoluto)

BONIF. CONSUMO CABIFY y similares:
  → tipoLinea="bonificacion", esBonificacion=true, monto positivo (valor absoluto)

═══════════════════════════════════════════════════════════
FORMATO DE RESPUESTA REQUERIDO
═══════════════════════════════════════════════════════════

Devolvé ÚNICAMENTE el JSON en un bloque \`\`\`json ... \`\`\`.
No incluyas texto antes ni después del bloque.

\`\`\`json
{
  "resumen": {
    "nroResumen": "...",
    "banco": "...",
    "tarjeta": "...",
    "titular": "...",
    "fechaCierre": "YYYY-MM-DD",
    "fechaVencimiento": "YYYY-MM-DD",
    "totalARS": 0.00,
    "totalUSD": 0.00,
    "pagoMinimoARS": 0.00,
    "cuentaDebito": "...",
    "numeroCuenta": "...",
    "ultimos4": "...",
    "ajustesConsolidado": [
      { "concepto": "DEV PER RG 4815 30%", "montoARS": -67399.98, "montoUSD": 0 }
    ]
  },
  "movimientos": [
    {
      "seq": 1,
      "tipoLinea": "consumo",
      "fechaConsumo": "YYYY-MM-DD",
      "descripcionRaw": "...",
      "nroCupon": "...",
      "cuotaActual": 1,
      "cuotaTotal": 1,
      "moneda": "ARS",
      "monto": 0.00,
      "personaDetectada": "",
      "esBonificacion": false,
      "esReverso": false,
      "esImpuesto": false,
      "esPagoAnterior": false
    }
  ]
}
\`\`\``;
}

type MovimientoRaw = {
  seq?: number;
  tipoLinea?: string;
  fechaConsumo?: string | null;
  descripcionRaw?: string;
  nroCupon?: string;
  cuotaActual?: number;
  cuotaTotal?: number;
  moneda?: string;
  monto?: number;
  personaDetectada?: string;
  esBonificacion?: boolean;
  esReverso?: boolean;
  esImpuesto?: boolean;
};

function sanitizarJson(raw: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (esc)                     { out += ch; esc = false; continue; }
    if (ch === '\\' && inStr)    { out += ch; esc = true;  continue; }
    if (ch === '"')               { inStr = !inStr; out += ch; continue; }
    if (inStr && ch === '\n')     { out += '\\n'; continue; }
    if (inStr && ch === '\r')     { out += '\\r'; continue; }
    if (inStr && ch === '\t')     { out += '\\t'; continue; }
    out += ch;
  }
  return out;
}


const TIPOLINEA_VALIDOS = new Set([
  'consumo', 'cuota', 'impuesto', 'reintegro_percepcion', 'bonificacion', 'reverso',
]);

export const extraerResumenTarjeta = onDocumentCreated(
  {
    document:       'resumenesTarjeta/{id}',
    secrets:        [anthropicKey],
    timeoutSeconds: 300,
    memory:         '1GiB',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();

    if (data.estado !== 'subido') return;

    const ref = db.collection('resumenesTarjeta').doc(snap.id);

    try {
      const refStorage = data.refStoragePdf as string;
      if (!refStorage) throw new Error('refStoragePdf ausente');

      const [fileBytes] = await storage.bucket().file(refStorage).download();
      if (!fileBytes || fileBytes.length === 0) throw new Error('Archivo vacío en Storage');

      const base64  = fileBytes.toString('base64');
      const banco   = (data.banco   as string) || '';
      const tarjeta = (data.tarjeta as string) || '';
      const prompt  = buildResumenTarjetaPrompt(banco, tarjeta);

      const client = new Anthropic({ apiKey: anthropicKey.value() });
      const stream = client.messages.stream({
        model:      'claude-sonnet-4-6',
        max_tokens: 32000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } },
            { type: 'text'     as const, text: prompt },
          ],
        }],
      });

      const finalMessage = await stream.finalMessage();
      if (finalMessage.stop_reason !== 'end_turn') {
        throw new Error(
          `Respuesta incompleta (stop_reason: ${finalMessage.stop_reason}) — JSON truncado; ` +
          `tokens usados: ${finalMessage.usage?.output_tokens ?? '?'}`,
        );
      }

      const rawText = finalMessage.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();

      const mdMatch  = rawText.match(/```json\s*([\s\S]*?)\s*```/);
      const rawMatch = rawText.match(/(\{[\s\S]*\})/);
      const jsonStr  = mdMatch ? mdMatch[1] : (rawMatch ? rawMatch[1] : null);
      if (!jsonStr) throw new Error(`Sin JSON en la respuesta (500c): ${rawText.slice(0, 500)}`);

      let parsed: { resumen: Record<string, unknown>; movimientos: MovimientoRaw[] };
      try {
        parsed = JSON.parse(sanitizarJson(jsonStr));
      } catch {
        throw new Error(`JSON inválido (500c): ${jsonStr.slice(0, 500)}`);
      }

      if (!parsed.resumen || !Array.isArray(parsed.movimientos)) {
        throw new Error('Estructura incompleta: falta resumen o movimientos');
      }

      const resumen    = parsed.resumen;
      const movsBrutos = parsed.movimientos;

      // Resolver tarjetaCodigo en capas (cada capa necesita match único; si hay ambigüedad baja)
      const configSnap   = await db.collection('config').doc('familia').get();
      const tarjetasConf = ((configSnap.data()?.tarjetas ?? []) as Array<{
        codigo: string; banco: string; tipo: string; titular?: string;
        numeroCuenta?: string; ultimos4?: string[];
      }>);
      const numeroCuentaExtraido = (resumen.numeroCuenta as string | null) ?? null;
      const ultimos4Extraido      = (resumen.ultimos4     as string | null) ?? null;
      const bancoRes              = (resumen.banco         as string) || banco;
      const tarjetaRes            = (resumen.tarjeta       as string) || tarjeta;
      const titularExtraido       = (resumen.titular       as string | null) ?? null;

      let tarjetaCodigoResuelto: string | null = null;

      // Capa 1: numeroCuenta exacto (único match)
      if (!tarjetaCodigoResuelto && numeroCuentaExtraido) {
        const m = tarjetasConf.filter(t => t.numeroCuenta === numeroCuentaExtraido);
        if (m.length === 1) tarjetaCodigoResuelto = m[0].codigo;
      }
      // Capa 2: ultimos4 exacto (único match) — ancla fallback; el array cubre titular + adicionales
      if (!tarjetaCodigoResuelto && ultimos4Extraido) {
        const m = tarjetasConf.filter(t => t.ultimos4?.includes(ultimos4Extraido));
        if (m.length === 1) tarjetaCodigoResuelto = m[0].codigo;
      }
      // Capa 3: banco + tipo (solo si EXACTAMENTE una tarjeta)
      if (!tarjetaCodigoResuelto) {
        const m = tarjetasConf.filter(t => t.banco === bancoRes && t.tipo === tarjetaRes);
        if (m.length === 1) {
          tarjetaCodigoResuelto = m[0].codigo;
        } else if (m.length > 1 && titularExtraido) {
          // Capa 4: desempate por titular (nombre del PDF vs titular en config)
          const normStr = (s: string) =>
            s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
          const normTitular = normStr(titularExtraido);
          const byTitular = m.filter(t => t.titular && normTitular.includes(normStr(t.titular)));
          if (byTitular.length === 1) tarjetaCodigoResuelto = byTitular[0].codigo;
        }
      }

      const estadoFinal = tarjetaCodigoResuelto ? 'parseado' : 'requiere_tarjeta';

      const movimientosParseados = movsBrutos.map((m, i) => ({
        seq:               typeof m.seq === 'number' ? m.seq : i + 1,
        tipoLinea:         TIPOLINEA_VALIDOS.has(m.tipoLinea ?? '') ? m.tipoLinea : 'consumo',
        fechaConsumo:      m.fechaConsumo  ?? null,
        descripcionRaw:    m.descripcionRaw ?? '',
        nroCupon:          m.nroCupon      ?? '',
        cuotaActual:       m.cuotaActual   ?? 1,
        cuotaTotal:        m.cuotaTotal    ?? 1,
        moneda:            m.moneda === 'USD' ? 'USD' : 'ARS',
        monto:             Math.abs(m.monto ?? 0),
        personaDetectada:  m.personaDetectada ?? '',
        esBonificacion:    m.esBonificacion   ?? false,
        esReverso:         m.esReverso         ?? false,
        esImpuesto:        m.esImpuesto        ?? false,
        personaConfirmada: null,
        categoria:         null,
        subcategoria:      null,
        incluir:           true,
      }));

      const fechaCierreStr = resumen.fechaCierre as string | null;
      const periodo = fechaCierreStr ? fechaCierreStr.slice(0, 7) : (data.periodo as string) || '';

      await ref.update({
        estado:              estadoFinal,
        tarjetaCodigo:       tarjetaCodigoResuelto,
        nroResumen:          resumen.nroResumen         ?? null,
        titular:             resumen.titular             ?? null,
        banco:               resumen.banco               || banco,
        tarjeta:             resumen.tarjeta             || tarjeta,
        periodo,
        fechaCierre:         fechaCierreStr              ?? null,
        fechaVencimiento:    resumen.fechaVencimiento    ?? null,
        totalARS:            Number(resumen.totalARS     ?? 0),
        totalUSD:            Number(resumen.totalUSD     ?? 0),
        pagoMinimoARS:       Number(resumen.pagoMinimoARS ?? 0),
        cuentaDebito:        resumen.cuentaDebito        ?? null,
        numeroCuenta:        numeroCuentaExtraido,
        ultimos4:            ultimos4Extraido,
        ajustesConsolidado:  Array.isArray(resumen.ajustesConsolidado)
          ? resumen.ajustesConsolidado
          : [],
        movimientosParseados,
        parseadoEn:          FieldValue.serverTimestamp(),
        errorExtraccion:     FieldValue.delete(),
        actualizadoEn:       FieldValue.serverTimestamp(),
      });

      console.log(`[extraerResumenTarjeta] ${snap.id} → parseado (${movimientosParseados.length} movs)`);

    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      console.error(`[extraerResumenTarjeta] error en ${snap.id}:`, mensaje);
      await ref.update({
        estado:          'error',
        errorExtraccion: mensaje,
        actualizadoEn:   FieldValue.serverTimestamp(),
      });
    }
  },
);

// ── F6.7 — Router de entrantes ────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (b: Buffer, o?: { max: number }) => Promise<{ text: string }>;

// Marcadores genéricos: aparecen en boletas, facturas y resúmenes de tarjeta
const MARCADORES_GENERICOS = [
  'TOTAL A PAGAR', 'VENCIMIENTO', 'CIERRE', 'SALDO PENDIENTE',
];
// Marcadores decisivos: solo presentes en resúmenes de tarjeta de crédito
// SALDO ANTERIOR excluido: aparece en facturas de telco/servicios (ej. "Mi Personal internet")
const MARCADORES_DECISIVOS = [
  'PAGO MINIMO', 'LIMITE DE COMPRA', 'LIMITE DE CREDITO',
];
// PAN enmascarado tipo "4509 XX** **** 1234" o "XXXX XXXX XXXX 1234"
const RE_PAN_ENMASCARADO = /\d{4}[\s*X]{4,10}\d{4}/;

function normalizarParaDeteccion(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function contarMarcadores(texto: string): { count: number; hits: string[]; tieneDecisivo: boolean } {
  const norm = normalizarParaDeteccion(texto);
  const hits: string[] = [];
  let tieneDecisivo = false;
  for (const m of MARCADORES_GENERICOS) {
    if (norm.includes(m)) hits.push(m);
  }
  for (const m of MARCADORES_DECISIVOS) {
    if (norm.includes(m)) { hits.push(m); tieneDecisivo = true; }
  }
  if (RE_PAN_ENMASCARADO.test(texto)) { hits.push('pan_enmascarado'); tieneDecisivo = true; }
  return { count: hits.length, hits, tieneDecisivo };
}

async function clasificarConVision(pdfBase64: string, client: Anthropic): Promise<'comprobante' | 'resumen' | 'ambiguo'> {
  try {
    const resp = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: '¿Es este un resumen mensual de tarjeta de crédito? Responde solo una palabra: "resumen" o "comprobante".' },
        ],
      }],
    });
    const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text?.trim().toLowerCase() ?? '';
    if (text.startsWith('resumen'))     return 'resumen';
    if (text.startsWith('comprobante')) return 'comprobante';
    return 'ambiguo';
  } catch {
    return 'ambiguo';
  }
}

async function crearDocComprobante(
  fsDb: Firestore,
  hash: string,
  entrante: Record<string, unknown>,
  rutaStorage: string,
): Promise<void> {
  await fsDb.collection('comprobantes').doc(hash).set({
    hashPdf:       hash,
    nombreArchivo: (entrante.nombreArchivo as string | null) ?? hash,
    contentType:   entrante.mimeType as string,
    tamano:        (entrante.tamano   as number | null) ?? 0,
    refStoragePdf: rutaStorage,
    subidoPor:     entrante.creadoPor as string,
    estado:        'subido',
    subidoEn:      FieldValue.serverTimestamp(),
  });
}

async function crearDocResumen(
  fsDb: Firestore,
  hash: string,
  entrante: Record<string, unknown>,
  rutaStorage: string,
): Promise<void> {
  await fsDb.collection('resumenesTarjeta').doc(hash).set({
    tarjetaCodigo:        null,
    banco:                '',
    tarjeta:              '',
    periodo:              '',
    estado:               'subido',
    nroResumen:           null,
    titular:              null,
    fechaCierre:          null,
    fechaVencimiento:     null,
    totalARS:             0,
    totalUSD:             0,
    pagoMinimoARS:        0,
    cuentaDebito:         null,
    hashPdf:              hash,
    refStoragePdf:        rutaStorage,
    subidoPor:            entrante.creadoPor as string,
    subidoEn:             FieldValue.serverTimestamp(),
    movimientosParseados: [],
    ajustesConsolidado:   [],
    numeroCuenta:         null,
    ultimos4:             null,
    errorExtraccion:      null,
    creadoEn:             FieldValue.serverTimestamp(),
    actualizadoEn:        FieldValue.serverTimestamp(),
  });
}

export const routearEntrante = onDocumentCreated(
  {
    document:       'entrantes/{hash}',
    secrets:        [anthropicKey],
    timeoutSeconds: 120,
    memory:         '512MiB',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    const hash = snap.id;

    if (data.estado !== 'pendiente') return;

    const entranteRef = db.collection('entrantes').doc(hash);

    try {
      // Idempotencia: ya existe en destino
      const [cmpSnap, rtSnap] = await Promise.all([
        db.collection('comprobantes').doc(hash).get(),
        db.collection('resumenesTarjeta').doc(hash).get(),
      ]);
      if (cmpSnap.exists) {
        await entranteRef.update({ estado: 'ruteado', destino: { coleccion: 'comprobantes', id: hash }, actualizadoEn: FieldValue.serverTimestamp() });
        return;
      }
      if (rtSnap.exists) {
        await entranteRef.update({ estado: 'ruteado', destino: { coleccion: 'resumenesTarjeta', id: hash }, actualizadoEn: FieldValue.serverTimestamp() });
        return;
      }

      // Rol del uploader
      const creadoPor = data.creadoPor as string;
      const autSnap   = await db.collection('autorizados').where('memberId', '==', creadoPor).limit(1).get();
      const rol: 'admin' | 'dependiente' = autSnap.empty
        ? 'dependiente'
        : ((autSnap.docs[0].data().rol as string) === 'admin' ? 'admin' : 'dependiente');

      const mimeType    = data.mimeType    as string;
      const rutaStorage = data.rutaStorage as string;

      let tipoDetectado: 'comprobante' | 'resumen' | 'ambiguo';
      let motivoDeteccion: string;

      if (mimeType.startsWith('image/')) {
        tipoDetectado   = 'comprobante';
        motivoDeteccion = 'imagen → comprobante directo';
      } else {
        const [fileBytes] = await storage.bucket().file(rutaStorage).download();
        let textoPag1 = '';

        try {
          const pdfData = await pdfParse(fileBytes as Buffer, { max: 1 });
          textoPag1 = pdfData.text;
        } catch {
          // Sin texto extraíble → fallback visión
        }

        if (textoPag1.trim().length < 50) {
          const base64 = (fileBytes as Buffer).toString('base64');
          const client = new Anthropic({ apiKey: anthropicKey.value() });
          tipoDetectado   = await clasificarConVision(base64, client);
          motivoDeteccion = `sin_texto → vision → ${tipoDetectado}`;
        } else {
          const { count, hits, tieneDecisivo } = contarMarcadores(textoPag1);
          if (tieneDecisivo && count >= 2) {
            tipoDetectado   = 'resumen';
            motivoDeteccion = `${count} marcadores (decisivo): ${hits.join(', ')}`;
          } else if (count === 0 || !tieneDecisivo) {
            tipoDetectado   = 'comprobante';
            motivoDeteccion = !tieneDecisivo && count > 0
              ? `${count} marcadores sin decisivo → comprobante`
              : '0 marcadores → comprobante';
          } else {
            tipoDetectado   = 'ambiguo';
            motivoDeteccion = `${count} marcador${count !== 1 ? 'es' : ''}: ${hits.join(', ')}`;
          }
        }
      }

      // Prior por rol para ambiguo
      let tipoFinal = tipoDetectado;
      if (tipoDetectado === 'ambiguo' && rol === 'dependiente') {
        tipoFinal        = 'comprobante';
        motivoDeteccion += ' → dependiente → comprobante';
      }

      if (tipoFinal === 'comprobante') {
        await crearDocComprobante(db, hash, data, rutaStorage);
        await entranteRef.update({
          estado: 'ruteado', tipoDetectado, motivoDeteccion,
          destino: { coleccion: 'comprobantes', id: hash },
          actualizadoEn: FieldValue.serverTimestamp(),
        });
      } else if (tipoFinal === 'resumen') {
        await crearDocResumen(db, hash, data, rutaStorage);
        await entranteRef.update({
          estado: 'ruteado', tipoDetectado, motivoDeteccion,
          destino: { coleccion: 'resumenesTarjeta', id: hash },
          actualizadoEn: FieldValue.serverTimestamp(),
        });
      } else {
        await entranteRef.update({
          estado: 'ambiguo', tipoDetectado: 'ambiguo', motivoDeteccion,
          actualizadoEn: FieldValue.serverTimestamp(),
        });
      }

      console.log(`[routearEntrante] ${hash} → ${tipoFinal} (${motivoDeteccion})`);
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      console.error(`[routearEntrante] error en ${hash}:`, mensaje);
      await entranteRef.update({
        estado: 'error', motivoDeteccion: mensaje,
        actualizadoEn: FieldValue.serverTimestamp(),
      });
    }
  },
);

export const resolverEntranteAmbiguo = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');

    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('unauthenticated', 'Email no disponible');

    const autSnap = await db.collection('autorizados').doc(email).get();
    if (!autSnap.exists || autSnap.data()?.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Se requiere rol admin');
    }

    const { hash, tipo } = request.data as { hash?: string; tipo?: string };
    if (!hash || !tipo) throw new HttpsError('invalid-argument', 'hash y tipo son requeridos');
    if (tipo !== 'comprobante' && tipo !== 'resumen') throw new HttpsError('invalid-argument', 'tipo debe ser "comprobante" o "resumen"');

    const entranteRef  = db.collection('entrantes').doc(hash);
    const entranteSnap = await entranteRef.get();
    if (!entranteSnap.exists) throw new HttpsError('not-found', 'Entrante no encontrado');

    const entData = entranteSnap.data()!;
    if (entData.estado !== 'ambiguo') throw new HttpsError('failed-precondition', `Estado inválido: ${String(entData.estado)}`);

    const rutaStorage = entData.rutaStorage as string;

    if (tipo === 'comprobante') {
      await crearDocComprobante(db, hash, entData, rutaStorage);
    } else {
      await crearDocResumen(db, hash, entData, rutaStorage);
    }

    await entranteRef.update({
      estado:        'ruteado',
      destino:       { coleccion: tipo === 'comprobante' ? 'comprobantes' : 'resumenesTarjeta', id: hash },
      actualizadoEn: FieldValue.serverTimestamp(),
    });

    console.log(`[resolverEntranteAmbiguo] ${hash} → ${tipo} (por ${email})`);
    return { ok: true };
  },
);

export const descartarEntrada = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('unauthenticated', 'Email no disponible');
    const autSnap = await db.collection('autorizados').doc(email).get();
    if (!autSnap.exists || autSnap.data()?.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Se requiere rol admin');
    }

    const { tipo, id } = request.data as { tipo?: string; id?: string };
    if (!id) throw new HttpsError('invalid-argument', 'id requerido');
    if (tipo !== 'comprobante' && tipo !== 'resumen') {
      throw new HttpsError('invalid-argument', 'tipo debe ser "comprobante" o "resumen"');
    }

    const coleccion = tipo === 'comprobante' ? 'comprobantes' : 'resumenesTarjeta';
    const docRef = db.collection(coleccion).doc(id);
    const snap   = await docRef.get();
    if (!snap.exists) throw new HttpsError('not-found', `${tipo} no encontrado`);
    const data = snap.data()!;
    const refStorage = data.refStoragePdf as string | undefined;

    let borrados = 0, revertidos = 0;
    let advertenciaDestino: Record<string, unknown> | null = null;

    if (tipo === 'comprobante') {
      const movs = await db.collection('movimientos').where('hashPdf', '==', id).get();
      const batch = db.batch();
      for (const m of movs.docs) {
        if (m.data().origenComprobanteId === id) { batch.delete(m.ref); borrados++; }
        else {
          batch.update(m.ref, {
            hashPdf: null, refStoragePdf: null, confirmadoPago: false,
            itemEsperadoId: FieldValue.delete(),
            destinoCbu: null, destinoCuit: null, destinoAlias: null, destinoNombre: null,
            vencimientos: null, actualizadoEn: FieldValue.serverTimestamp(),
          });
          revertidos++;
        }
      }
      batch.delete(db.collection('entrantes').doc(id));
      batch.delete(docRef);
      await batch.commit();

      const d = data.datosExtraidos ?? {};
      if (d.destinoCbu || d.destinoCuit || d.destinoAlias) {
        advertenciaDestino = { destinoCuit: d.destinoCuit ?? null, destinoCbu: d.destinoCbu ?? null, destinoAlias: d.destinoAlias ?? null };
      }
    } else {
      // resumen: borrar todos los movimientos hijos + entrante + doc, en chunks (límite 500/batch)
      const movs = await db.collection('movimientos').where('resumenTarjetaId', '==', id).get();
      const refs = movs.docs.map(m => m.ref);
      refs.push(db.collection('entrantes').doc(id), docRef);
      for (let i = 0; i < refs.length; i += 400) {
        const batch = db.batch();
        for (const r of refs.slice(i, i + 400)) batch.delete(r);
        await batch.commit();
      }
      borrados = movs.size;
    }

    if (refStorage) {
      try { await getStorage().bucket().file(refStorage).delete(); }
      catch (e) { console.warn(`[descartarEntrada] blob no borrado: ${String(e)}`); }
    }

    console.log(`[descartarEntrada] ${tipo} ${id} — borrados:${borrados} revertidos:${revertidos} (por ${email})`);
    return { ok: true, tipo, borrados, revertidos, advertenciaDestino };
  },
);

// F6.9.11 — el dependiente carga su propio comprobante como su propio movimiento.
// Atómica (batch crear-movimiento + marcar-comprobante-vinculado) e idempotente
// (precondición estado==='extraido': un reintento corta en failed-precondition).
export const cargarMovimientoDesdeComprobante = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('unauthenticated', 'Email no disponible');

    const autSnap = await db.collection('autorizados').doc(email).get();
    if (!autSnap.exists) throw new HttpsError('permission-denied', 'No autorizado');
    const aut = autSnap.data()!;
    const callerMemberId = aut.memberId as string | undefined;
    const esAdmin = aut.rol === 'admin';
    if (!callerMemberId) throw new HttpsError('permission-denied', 'Sin memberId');

    const { compId, payload } = (request.data ?? {}) as { compId?: string; payload?: any };
    if (!compId)  throw new HttpsError('invalid-argument', 'compId requerido');
    if (!payload || typeof payload !== 'object') throw new HttpsError('invalid-argument', 'payload requerido');

    // Comprobante: existe + estado extraido (idempotencia) + dueño o admin
    const compRef  = db.collection('comprobantes').doc(compId);
    const compSnap = await compRef.get();
    if (!compSnap.exists) throw new HttpsError('not-found', 'Comprobante no encontrado');
    const comp = compSnap.data()!;
    if (comp.estado !== 'extraido')
      throw new HttpsError('failed-precondition', `Estado inválido: ${String(comp.estado)}`);
    if (!esAdmin && comp.subidoPor !== callerMemberId)
      throw new HttpsError('permission-denied', 'No es tu comprobante');

    // Validación server-side (Admin SDK bypassa reglas → replicar invariantes del create)
    const { persona, creadoPor, tipo, moneda, monto, descripcion, fechaMs, mes } = payload;
    if (creadoPor !== callerMemberId)
      throw new HttpsError('permission-denied', 'creadoPor debe ser vos');
    if (!esAdmin && persona !== callerMemberId)
      throw new HttpsError('permission-denied', 'persona debe ser vos');
    if (!['Gasto', 'Ingreso'].includes(tipo))  throw new HttpsError('invalid-argument', 'tipo inválido');
    if (!['ARS', 'USD'].includes(moneda))       throw new HttpsError('invalid-argument', 'moneda inválida');
    if (typeof monto !== 'number' || !(monto > 0)) throw new HttpsError('invalid-argument', 'monto inválido');
    if (typeof descripcion !== 'string' || descripcion.length === 0)
      throw new HttpsError('invalid-argument', 'descripcion requerida');
    if (typeof fechaMs !== 'number' || !Number.isFinite(fechaMs))
      throw new HttpsError('invalid-argument', 'fecha inválida');
    if (typeof mes !== 'string' || !/^[0-9]{4}-[0-9]{2}$/.test(mes))
      throw new HttpsError('invalid-argument', 'mes inválido');

    const fecha  = Timestamp.fromMillis(fechaMs);
    const movRef = db.collection('movimientos').doc();
    const batch  = db.batch();

    // F9.63 — estado de pago recalculado server-side desde la fecha final (fechaMs viene a
    // mediodía local, así que toISOString().slice(0,10) da el día calendario correcto).
    const fechaMovISO    = new Date(fechaMs).toISOString().slice(0, 10);
    // F9.75 — una obligación NO se marca pagada por vencimiento; el pago real la confirma luego.
    const tipoDoc        = comp.datosExtraidos?.tipoDocumento as string | undefined;
    const pagadoPorFecha = !esObligacionDoc(tipoDoc) && fechaMovISO <= hoyArgentinaISO();

    batch.set(movRef, {
      fecha, mes,
      tipo, descripcion,
      descripcionOriginal: payload.descripcionOriginal ?? null,
      monto, moneda,
      tcUsdArs:          payload.tcUsdArs           ?? null,
      categoria:         payload.categoria,
      subcategoria:      payload.subcategoria,
      etiqueta:          payload.etiqueta           ?? null,
      banco:             payload.banco              ?? null,
      persona, creadoPor,
      subtipo: 'Manual', origen: 'Manual',
      excluirDash: false, pagado: pagadoPorFecha,
      incluirResumenMes: payload.incluirResumenMes  ?? true,
      itemEsperadoId:    payload.itemEsperadoId      ?? null,
      numeroComprobante: payload.numeroComprobante  ?? null,
      confirmadoPago:    pagadoPorFecha,
      hashPdf:           payload.hashPdf             ?? null,
      refStoragePdf:     payload.refStoragePdf       ?? null,
      destinoCbu:        payload.destinoCbu          ?? null,
      destinoCuit:       payload.destinoCuit         ?? null,
      destinoAlias:      payload.destinoAlias        ?? null,
      destinoNombre:     payload.destinoNombre       ?? null,
      vencimientos:      payload.vencimientos        ?? null,
      origenComprobanteId: payload.origenComprobanteId ?? compId,
      creadoEn:      FieldValue.serverTimestamp(),
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    batch.update(compRef, {
      estado: 'vinculado',
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    console.log(`[cargarMovimientoDesdeComprobante] ${compId} → ${movRef.id} (por ${email})`);
    return { movimientoId: movRef.id };
  },
);

// F9.30 — refresco diario del dólar MEP en tcDiario. Replica el trigger legacy
// (40_TC_Dolar.gs, 09:00) que el rebuild nunca portó: hoy tcParaFecha solo LEE
// tcDiario (poblado por seed), sin refresco → el TC queda estático. Fuente:
// dolarapi.com (pública, sin secrets), campo `venta` del dólar bolsa/MEP —
// mismo criterio que gf_fetchMEP_Bolsa_ del legacy.
export const actualizarTCDiario = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'America/Argentina/Buenos_Aires',
    region: 'southamerica-east1',
  },
  async () => {
    let venta: number;
    try {
      const res = await fetch('https://dolarapi.com/v1/dolares/bolsa');
      if (!res.ok) throw new Error(`dolarapi respondió HTTP ${res.status}`);
      const data = (await res.json()) as { venta?: unknown };
      venta = Number(data.venta);
      if (!Number.isFinite(venta) || venta <= 0) throw new Error(`venta inválida: ${JSON.stringify(data.venta)}`);
    } catch (e) {
      // Tolerancia a fallo: NO escribir basura. El último TC válido sigue
      // disponible (tcParaFecha cae al más reciente anterior); reintenta sola
      // al día siguiente.
      console.error('[actualizarTCDiario] fetch/parseo falló, no se escribe nada:', e);
      return;
    }

    const fechaHoy = hoyArgentinaISO();
    // set + merge (no create): upsert idempotente — re-correr el mismo día pisa el mismo doc.
    await db.collection('tcDiario').doc(fechaHoy).set(
      {
        tcUsdArs: venta,
        actualizadoEn: FieldValue.serverTimestamp(),
        origen: 'dolarapi-bolsa',
      },
      { merge: true },
    );

    console.log(`[actualizarTCDiario] ${fechaHoy} → tcUsdArs=${venta}`);
  },
);

// F9.36 — primer callable de "configs editables" (Etapa A, antes de migrar).
// config/familia tiene write:false en Rules para el cliente (ver docs/CLAUDE.md →
// Decisiones cerradas) — toda escritura pasa por Admin SDK vía callable, nunca
// directo del cliente. Reemplaza el array completo (full-replace, no merge por id)
// porque el cliente ya manda el array completo con altas/bajas/ediciones resueltas.
export const actualizarMediosPago = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('unauthenticated', 'Email no disponible');
    const autSnap = await db.collection('autorizados').doc(email).get();
    if (!autSnap.exists || autSnap.data()?.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Se requiere rol admin');
    }

    const { medios } = (request.data ?? {}) as { medios?: unknown };
    if (!Array.isArray(medios) || medios.length === 0) {
      throw new HttpsError('invalid-argument', 'medios debe ser un array no vacío');
    }

    const TIPOS = ['Banco', 'Billetera', 'Efectivo'];
    const lista = medios as Array<Record<string, unknown>>;
    const idsTodos = new Set(lista.map(m => m.id));
    const idsVistos = new Set<string>();
    for (const m of lista) {
      if (typeof m.id !== 'string' || !m.id) throw new HttpsError('invalid-argument', 'Cada medio necesita id');
      if (idsVistos.has(m.id)) throw new HttpsError('invalid-argument', `id duplicado: ${m.id}`);
      idsVistos.add(m.id);
      if (typeof m.nombre !== 'string' || !m.nombre) throw new HttpsError('invalid-argument', `medio ${m.id}: nombre requerido`);
      if (typeof m.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(m.color)) throw new HttpsError('invalid-argument', `medio ${m.id}: color debe ser hex #RRGGBB`);
      if (!TIPOS.includes(m.tipo as string)) throw new HttpsError('invalid-argument', `medio ${m.id}: tipo inválido`);
      if (m.dominio != null && typeof m.dominio !== 'string') throw new HttpsError('invalid-argument', `medio ${m.id}: dominio debe ser string`);
      // F9.23 — invariante Efectivo: alias cosmético de Mercado Pago, no se puede
      // "des-aliasar" desde esta UI. Se fuerza server-side, no se confía en el cliente.
      if (m.nombre === 'Efectivo') {
        if (typeof m.aliasDe !== 'string' || !m.aliasDe || !idsTodos.has(m.aliasDe)) {
          throw new HttpsError('invalid-argument', 'Efectivo debe tener aliasDe apuntando a un medio existente');
        }
        m.oculto = true;
      }
    }

    await db.collection('config').doc('familia').update({
      bancos: medios,
      actualizadoEn: FieldValue.serverTimestamp(),
    });

    console.log(`[actualizarMediosPago] ${medios.length} medios actualizados (por ${email})`);
    return { ok: true };
  },
);

// F9.39 — respaldo manual de /tcDiario (complementa el cron F9.30). Mismo
// doc/shape que escribe actualizarTCDiario (set merge, origen distingue la
// fuente) — una sola colección de verdad, tcParaFecha no cambia. Admin-only:
// pisar el TC de un día afecta los montos derivados de toda la familia.
export const actualizarTCManual = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('unauthenticated', 'Email no disponible');
    const autSnap = await db.collection('autorizados').doc(email).get();
    if (!autSnap.exists || autSnap.data()?.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Se requiere rol admin');
    }

    const { fecha, tcUsdArs } = (request.data ?? {}) as { fecha?: unknown; tcUsdArs?: unknown };
    const fechaStr = typeof fecha === 'string' && fecha ? fecha : hoyArgentinaISO();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
      throw new HttpsError('invalid-argument', 'fecha debe ser YYYY-MM-DD');
    }
    if (typeof tcUsdArs !== 'number' || !Number.isFinite(tcUsdArs) || tcUsdArs <= 0) {
      throw new HttpsError('invalid-argument', 'tcUsdArs debe ser un número positivo');
    }

    await db.collection('tcDiario').doc(fechaStr).set(
      {
        tcUsdArs,
        actualizadoEn: FieldValue.serverTimestamp(),
        origen: 'manual',
      },
      { merge: true },
    );

    console.log(`[actualizarTCManual] ${fechaStr} → tcUsdArs=${tcUsdArs} (por ${email})`);
    return { ok: true };
  },
);

// F9.36 — "Mis datos": cualquier miembro autenticado edita SU PROPIO nombre
// visible (no admin-only, a diferencia de actualizarMediosPago — un dependiente
// edita lo suyo). Email no es editable acá: es la identidad de login, atada a
// /autorizados; cambiarla es un flujo de seguridad aparte, no de esta fase.
export const actualizarMiPerfil = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('unauthenticated', 'Email no disponible');
    const autSnap = await db.collection('autorizados').doc(email).get();
    if (!autSnap.exists) throw new HttpsError('permission-denied', 'No autorizado');
    const memberId = autSnap.data()?.memberId as string | undefined;
    if (!memberId) throw new HttpsError('permission-denied', 'Sin memberId');

    const { nombre } = (request.data ?? {}) as { nombre?: unknown };
    if (typeof nombre !== 'string' || nombre.trim().length === 0 || nombre.length > 60) {
      throw new HttpsError('invalid-argument', 'nombre inválido (1-60 caracteres)');
    }

    const famRef  = db.collection('config').doc('familia');
    const famSnap = await famRef.get();
    if (!famSnap.exists || !famSnap.data()?.miembros?.[memberId]) {
      throw new HttpsError('not-found', 'Miembro no encontrado en config/familia');
    }

    await famRef.update({
      [`miembros.${memberId}.nombre`]: nombre.trim(),
      actualizadoEn: FieldValue.serverTimestamp(),
    });

    console.log(`[actualizarMiPerfil] ${memberId} → nombre="${nombre.trim()}" (por ${email})`);
    return { ok: true };
  },
);

// F9.37 — CRUD de Miembros (admin-only, sensible: toca roles/permisos).
// Invariante crítico (ver docs/CLAUDE.md → Decisiones cerradas): alta/edición
// de email o rol escribe miembros[] Y /autorizados/{email} en la MISMA
// transacción. Desincronizarlos rompe el login (la whitelist lee de ambos) o
// reabre escalada de privilegios. Por eso esto vive en una sola callable, no
// en un update suelto del cliente.
//
// "Desactivar" NO borra el id (movimientos.persona lo referencia para siempre)
// y NO alcanza con activo:false: esMiembro()/esAdmin() en Rules solo miran
// /autorizados (memberId != null), sin chequear `activo`. Por eso desactivar
// borra los docs /autorizados de ese miembro — eso es lo que de verdad corta
// el acceso. Reactivar los recrea.

function slugMemberId(nombre: string, existentes: Set<string>): string {
  const base = nombre
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .trim() || 'miembro';
  if (!existentes.has(base)) return base;
  let i = 2;
  while (existentes.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

function validarEmails(emails: unknown): string[] {
  if (!Array.isArray(emails) || emails.length === 0) {
    throw new HttpsError('invalid-argument', 'Al menos un email es requerido');
  }
  const limpios = emails.map(e => String(e).trim().toLowerCase());
  for (const e of limpios) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      throw new HttpsError('invalid-argument', `Email inválido: ${e}`);
    }
  }
  return [...new Set(limpios)];
}

export const guardarMiembro = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const callerEmail = request.auth.token.email?.toLowerCase();
    if (!callerEmail) throw new HttpsError('unauthenticated', 'Email no disponible');
    const callerAutSnap = await db.collection('autorizados').doc(callerEmail).get();
    if (!callerAutSnap.exists || callerAutSnap.data()?.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Se requiere rol admin');
    }

    const { accion } = (request.data ?? {}) as { accion?: string };
    const famRef  = db.collection('config').doc('familia');
    const famSnap = await famRef.get();
    if (!famSnap.exists) throw new HttpsError('not-found', 'config/familia no existe');
    const miembros = (famSnap.data()?.miembros ?? {}) as Record<string, { nombre: string; emails: string[]; rol: string; activo: boolean; alias?: string[] }>;

    if (accion === 'crear') {
      const { nombre, emails, rol } = (request.data ?? {}) as { nombre?: unknown; emails?: unknown; rol?: unknown };
      if (typeof nombre !== 'string' || nombre.trim().length === 0 || nombre.length > 60) {
        throw new HttpsError('invalid-argument', 'nombre inválido (1-60 caracteres)');
      }
      if (rol !== 'admin' && rol !== 'dependiente') throw new HttpsError('invalid-argument', 'rol inválido');
      const emailsLimpios = validarEmails(emails);

      // Ningún email puede estar ya tomado por otro miembro
      for (const e of emailsLimpios) {
        const existente = await db.collection('autorizados').doc(e).get();
        if (existente.exists) throw new HttpsError('already-exists', `Email ya en uso: ${e}`);
      }

      const memberId = slugMemberId(nombre.trim(), new Set(Object.keys(miembros)));
      const batch = db.batch();
      batch.update(famRef, {
        [`miembros.${memberId}`]: { nombre: nombre.trim(), emails: emailsLimpios, rol, activo: true, alias: [] },
        actualizadoEn: FieldValue.serverTimestamp(),
      });
      for (const e of emailsLimpios) {
        batch.set(db.collection('autorizados').doc(e), { memberId, rol });
      }
      await batch.commit();

      console.log(`[guardarMiembro] crear ${memberId} (${emailsLimpios.join(',')}) por ${callerEmail}`);
      return { ok: true, memberId };
    }

    const { memberId } = (request.data ?? {}) as { memberId?: unknown };
    if (typeof memberId !== 'string' || !miembros[memberId]) {
      throw new HttpsError('not-found', 'Miembro no encontrado');
    }
    const actual = miembros[memberId];

    if (accion === 'editar') {
      const { nombre, emails, rol } = (request.data ?? {}) as { nombre?: unknown; emails?: unknown; rol?: unknown };
      if (typeof nombre !== 'string' || nombre.trim().length === 0 || nombre.length > 60) {
        throw new HttpsError('invalid-argument', 'nombre inválido (1-60 caracteres)');
      }
      if (rol !== 'admin' && rol !== 'dependiente') throw new HttpsError('invalid-argument', 'rol inválido');
      const emailsNuevos = validarEmails(emails);

      // Emails nuevos (no eran de este miembro) no pueden estar tomados por otro
      const emailsViejos = new Set(actual.emails);
      for (const e of emailsNuevos) {
        if (emailsViejos.has(e)) continue;
        const existente = await db.collection('autorizados').doc(e).get();
        if (existente.exists) throw new HttpsError('already-exists', `Email ya en uso: ${e}`);
      }

      // Si es el único admin activo, no puede dejar de ser admin
      if (actual.rol === 'admin' && rol !== 'admin') {
        const otrosAdmins = Object.entries(miembros).filter(([id, m]) => id !== memberId && m.activo && m.rol === 'admin');
        if (otrosAdmins.length === 0) throw new HttpsError('failed-precondition', 'Tiene que quedar al menos un admin activo');
      }

      const batch = db.batch();
      batch.update(famRef, {
        [`miembros.${memberId}.nombre`]: nombre.trim(),
        [`miembros.${memberId}.emails`]: emailsNuevos,
        [`miembros.${memberId}.rol`]: rol,
        actualizadoEn: FieldValue.serverTimestamp(),
      });
      for (const eViejo of actual.emails) {
        if (!emailsNuevos.includes(eViejo)) batch.delete(db.collection('autorizados').doc(eViejo));
      }
      if (actual.activo) {
        for (const eNuevo of emailsNuevos) {
          batch.set(db.collection('autorizados').doc(eNuevo), { memberId, rol });
        }
      }
      await batch.commit();

      console.log(`[guardarMiembro] editar ${memberId} por ${callerEmail}`);
      return { ok: true };
    }

    if (accion === 'desactivar') {
      if (actual.rol === 'admin') {
        const otrosAdmins = Object.entries(miembros).filter(([id, m]) => id !== memberId && m.activo && m.rol === 'admin');
        if (otrosAdmins.length === 0) throw new HttpsError('failed-precondition', 'Tiene que quedar al menos un admin activo');
      }
      const batch = db.batch();
      batch.update(famRef, {
        [`miembros.${memberId}.activo`]: false,
        actualizadoEn: FieldValue.serverTimestamp(),
      });
      for (const e of actual.emails) batch.delete(db.collection('autorizados').doc(e));
      await batch.commit();

      console.log(`[guardarMiembro] desactivar ${memberId} por ${callerEmail}`);
      return { ok: true };
    }

    if (accion === 'reactivar') {
      // Ningún email puede haber sido tomado por otro miembro mientras estaba inactivo
      for (const e of actual.emails) {
        const existente = await db.collection('autorizados').doc(e).get();
        if (existente.exists && existente.data()?.memberId !== memberId) {
          throw new HttpsError('already-exists', `Email ya en uso por otro miembro: ${e}`);
        }
      }
      const batch = db.batch();
      batch.update(famRef, {
        [`miembros.${memberId}.activo`]: true,
        actualizadoEn: FieldValue.serverTimestamp(),
      });
      for (const e of actual.emails) batch.set(db.collection('autorizados').doc(e), { memberId, rol: actual.rol });
      await batch.commit();

      console.log(`[guardarMiembro] reactivar ${memberId} por ${callerEmail}`);
      return { ok: true };
    }

    throw new HttpsError('invalid-argument', `accion desconocida: ${String(accion)}`);
  },
);

// F9.38 — CRUD de Categorías/Subcategorías/Etiquetas (admin-only; taxonomía
// usada por TODO: movimientos, Dashboard, clasificador, esperados — ver
// docs/CLAUDE.md). Modelo: movimientos y diccionario SIGUEN guardando el
// LABEL (string), no un id — igual que hoy. Categorías gana id estable
// (antes string[] plano) para que la UI trackee una fila a través de un
// rename sin depender del texto; subcategorias/etiquetas ya tenían id propio.
// Renombrar (cualquiera de los 3 niveles) cascada el label viejo→nuevo en
// movimientos + diccionario (+ subcategorias.categoriaPadre si renombra una
// categoría) en la MISMA función, en batches de 450 (límite Firestore 500
// writes/batch). Política de borrado (la recomendada por el doc F9.38): un
// nodo con uso documentado solo se DESACTIVA (activo:false, ya filtrado por
// los queries de catalogos.ts); el borrado duro solo procede con conteo de
// uso en cero — evita dejar movimientos colgados sin construir un flujo de
// reasignación aparte.

async function actualizarEnLotes(query: Query, campos: Record<string, unknown>): Promise<number> {
  const snap = await query.get();
  for (let i = 0; i < snap.docs.length; i += 450) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(i, i + 450)) batch.update(doc.ref, campos);
    await batch.commit();
  }
  return snap.docs.length;
}

async function contarUso(query: Query): Promise<number> {
  const agg = await query.count().get();
  return agg.data().count;
}

function nuevoIdTaxonomia(prefijo: string): string {
  return `${prefijo}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function validarValorTaxonomia(valor: unknown, etiqueta: string): string {
  if (typeof valor !== 'string' || valor.trim().length === 0 || valor.length > 60) {
    throw new HttpsError('invalid-argument', `${etiqueta} inválido (1-60 caracteres)`);
  }
  return valor.trim();
}

async function guardarCategoria(accion: string, data: unknown, email: string) {
  const famRef  = db.collection('config').doc('familia');
  const famSnap = await famRef.get();
  if (!famSnap.exists) throw new HttpsError('not-found', 'config/familia no existe');
  const categorias = (famSnap.data()?.categorias ?? []) as Array<{ id: string; nombre: string; activo: boolean }>;

  if (accion === 'crear') {
    const nombreLimpio = validarValorTaxonomia((data as { nombre?: unknown })?.nombre, 'nombre');
    if (categorias.some(c => c.nombre === nombreLimpio)) {
      throw new HttpsError('already-exists', `Ya existe una categoría "${nombreLimpio}"`);
    }
    const id = nuevoIdTaxonomia('cat');
    await famRef.update({
      categorias: [...categorias, { id, nombre: nombreLimpio, activo: true }],
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    console.log(`[guardarTaxonomia] categoria crear ${id} "${nombreLimpio}" por ${email}`);
    return { ok: true, id };
  }

  const { id } = (data ?? {}) as { id?: unknown };
  const idx = categorias.findIndex(c => c.id === id);
  if (typeof id !== 'string' || idx === -1) throw new HttpsError('not-found', 'Categoría no encontrada');
  const actual = categorias[idx];

  if (accion === 'editar') {
    const nombreNuevo = validarValorTaxonomia((data as { nombre?: unknown })?.nombre, 'nombre');
    if (categorias.some((c, i) => i !== idx && c.nombre === nombreNuevo)) {
      throw new HttpsError('already-exists', `Ya existe una categoría "${nombreNuevo}"`);
    }
    const nombreViejo = actual.nombre;
    const nuevas = categorias.slice();
    nuevas[idx] = { ...actual, nombre: nombreNuevo };
    await famRef.update({ categorias: nuevas, actualizadoEn: FieldValue.serverTimestamp() });
    if (nombreNuevo !== nombreViejo) {
      const nMovs = await actualizarEnLotes(db.collection('movimientos').where('categoria', '==', nombreViejo), { categoria: nombreNuevo });
      const nSub  = await actualizarEnLotes(db.collection('subcategorias').where('categoriaPadre', '==', nombreViejo), { categoriaPadre: nombreNuevo });
      const nDic  = await actualizarEnLotes(db.collection('diccionario').where('categoria', '==', nombreViejo), { categoria: nombreNuevo });
      console.log(`[guardarTaxonomia] categoria editar ${id} "${nombreViejo}"→"${nombreNuevo}" (movs:${nMovs} subcat:${nSub} dict:${nDic}) por ${email}`);
    }
    return { ok: true };
  }

  if (accion === 'desactivar' || accion === 'reactivar') {
    const nuevas = categorias.slice();
    nuevas[idx] = { ...actual, activo: accion === 'reactivar' };
    await famRef.update({ categorias: nuevas, actualizadoEn: FieldValue.serverTimestamp() });
    console.log(`[guardarTaxonomia] categoria ${accion} ${id} por ${email}`);
    return { ok: true };
  }

  // eliminar
  const usoMovs = await contarUso(db.collection('movimientos').where('categoria', '==', actual.nombre));
  if (usoMovs > 0) {
    throw new HttpsError('failed-precondition', `No se puede borrar: ${usoMovs} movimiento(s) usan "${actual.nombre}". Desactivala en su lugar.`);
  }
  const usoSub = await contarUso(db.collection('subcategorias').where('categoriaPadre', '==', actual.nombre));
  if (usoSub > 0) {
    throw new HttpsError('failed-precondition', `No se puede borrar: tiene ${usoSub} subcategoría(s). Borralas primero.`);
  }
  await famRef.update({
    categorias: categorias.filter((_, i) => i !== idx),
    actualizadoEn: FieldValue.serverTimestamp(),
  });
  console.log(`[guardarTaxonomia] categoria eliminar ${id} "${actual.nombre}" por ${email}`);
  return { ok: true };
}

async function guardarSubcategoria(accion: string, data: unknown, email: string) {
  const subRef = db.collection('subcategorias');

  if (accion === 'crear') {
    const { categoriaPadre } = (data ?? {}) as { categoriaPadre?: unknown };
    if (typeof categoriaPadre !== 'string' || !categoriaPadre) throw new HttpsError('invalid-argument', 'categoriaPadre requerida');
    const valorLimpio = validarValorTaxonomia((data as { valor?: unknown })?.valor, 'valor');
    const dupSnap = await subRef.where('categoriaPadre', '==', categoriaPadre).where('valor', '==', valorLimpio).limit(1).get();
    if (!dupSnap.empty) throw new HttpsError('already-exists', `Ya existe "${valorLimpio}" en esa categoría`);
    const id = nuevoIdTaxonomia('subcat');
    await subRef.doc(id).set({ id, categoriaPadre, valor: valorLimpio, activo: true });
    console.log(`[guardarTaxonomia] subcategoria crear ${id} "${categoriaPadre}/${valorLimpio}" por ${email}`);
    return { ok: true, id };
  }

  const { id } = (data ?? {}) as { id?: unknown };
  if (typeof id !== 'string') throw new HttpsError('invalid-argument', 'id requerido');
  const docRef = subRef.doc(id);
  const snap = await docRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Subcategoría no encontrada');
  const actual = snap.data() as { categoriaPadre: string; valor: string; activo: boolean };

  if (accion === 'editar') {
    const valorNuevo = validarValorTaxonomia((data as { valor?: unknown })?.valor, 'valor');
    if (valorNuevo !== actual.valor) {
      const dupSnap = await subRef.where('categoriaPadre', '==', actual.categoriaPadre).where('valor', '==', valorNuevo).limit(1).get();
      if (!dupSnap.empty) throw new HttpsError('already-exists', `Ya existe "${valorNuevo}" en esa categoría`);
      await docRef.update({ valor: valorNuevo });
      const nMovs = await actualizarEnLotes(
        db.collection('movimientos').where('categoria', '==', actual.categoriaPadre).where('subcategoria', '==', actual.valor),
        { subcategoria: valorNuevo },
      );
      const nDic = await actualizarEnLotes(
        db.collection('diccionario').where('categoria', '==', actual.categoriaPadre).where('subcategoria', '==', actual.valor),
        { subcategoria: valorNuevo },
      );
      console.log(`[guardarTaxonomia] subcategoria editar ${id} "${actual.valor}"→"${valorNuevo}" (movs:${nMovs} dict:${nDic}) por ${email}`);
    }
    return { ok: true };
  }

  if (accion === 'desactivar' || accion === 'reactivar') {
    await docRef.update({ activo: accion === 'reactivar' });
    console.log(`[guardarTaxonomia] subcategoria ${accion} ${id} por ${email}`);
    return { ok: true };
  }

  // eliminar
  const uso = await contarUso(
    db.collection('movimientos').where('categoria', '==', actual.categoriaPadre).where('subcategoria', '==', actual.valor),
  );
  if (uso > 0) throw new HttpsError('failed-precondition', `No se puede borrar: ${uso} movimiento(s) usan "${actual.valor}". Desactivala en su lugar.`);
  await docRef.delete();
  console.log(`[guardarTaxonomia] subcategoria eliminar ${id} "${actual.valor}" por ${email}`);
  return { ok: true };
}

async function guardarEtiqueta(accion: string, data: unknown, email: string) {
  const etqRef = db.collection('etiquetas');

  if (accion === 'crear') {
    const valorLimpio = validarValorTaxonomia((data as { valor?: unknown })?.valor, 'valor');
    const dupSnap = await etqRef.where('valor', '==', valorLimpio).limit(1).get();
    if (!dupSnap.empty) throw new HttpsError('already-exists', `Ya existe la etiqueta "${valorLimpio}"`);
    const id = nuevoIdTaxonomia('etiq');
    await etqRef.doc(id).set({ id, valor: valorLimpio, activo: true });
    console.log(`[guardarTaxonomia] etiqueta crear ${id} "${valorLimpio}" por ${email}`);
    return { ok: true, id };
  }

  const { id } = (data ?? {}) as { id?: unknown };
  if (typeof id !== 'string') throw new HttpsError('invalid-argument', 'id requerido');
  const docRef = etqRef.doc(id);
  const snap = await docRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Etiqueta no encontrada');
  const actual = snap.data() as { valor: string; activo: boolean };

  if (accion === 'editar') {
    const valorNuevo = validarValorTaxonomia((data as { valor?: unknown })?.valor, 'valor');
    if (valorNuevo !== actual.valor) {
      const dupSnap = await etqRef.where('valor', '==', valorNuevo).limit(1).get();
      if (!dupSnap.empty) throw new HttpsError('already-exists', `Ya existe la etiqueta "${valorNuevo}"`);
      await docRef.update({ valor: valorNuevo });
      const nMovs = await actualizarEnLotes(db.collection('movimientos').where('etiqueta', '==', actual.valor), { etiqueta: valorNuevo });
      const nDic  = await actualizarEnLotes(db.collection('diccionario').where('etiqueta', '==', actual.valor), { etiqueta: valorNuevo });
      console.log(`[guardarTaxonomia] etiqueta editar ${id} "${actual.valor}"→"${valorNuevo}" (movs:${nMovs} dict:${nDic}) por ${email}`);
    }
    return { ok: true };
  }

  if (accion === 'desactivar' || accion === 'reactivar') {
    await docRef.update({ activo: accion === 'reactivar' });
    console.log(`[guardarTaxonomia] etiqueta ${accion} ${id} por ${email}`);
    return { ok: true };
  }

  // eliminar
  const uso = await contarUso(db.collection('movimientos').where('etiqueta', '==', actual.valor));
  if (uso > 0) throw new HttpsError('failed-precondition', `No se puede borrar: ${uso} movimiento(s) usan "${actual.valor}". Desactivala en su lugar.`);
  await docRef.delete();
  console.log(`[guardarTaxonomia] etiqueta eliminar ${id} "${actual.valor}" por ${email}`);
  return { ok: true };
}

export const guardarTaxonomia = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('unauthenticated', 'Email no disponible');
    const autSnap = await db.collection('autorizados').doc(email).get();
    if (!autSnap.exists || autSnap.data()?.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Se requiere rol admin');
    }

    const { nivel, accion } = (request.data ?? {}) as { nivel?: string; accion?: string };
    if (!['categoria', 'subcategoria', 'etiqueta'].includes(nivel ?? '')) {
      throw new HttpsError('invalid-argument', 'nivel inválido');
    }
    if (!['crear', 'editar', 'desactivar', 'reactivar', 'eliminar'].includes(accion ?? '')) {
      throw new HttpsError('invalid-argument', 'accion inválida');
    }

    if (nivel === 'categoria')    return guardarCategoria(accion!, request.data, email);
    if (nivel === 'subcategoria') return guardarSubcategoria(accion!, request.data, email);
    return guardarEtiqueta(accion!, request.data, email);
  },
);

// F9.41 — CRUD de Tarjetas (catálogo físico, admin-only) — cierra el bloque de
// 6 configs editables (F9.36–F9.41, hallazgo de paridad F9.32). Habilita la
// edición de cierreDia/venceDia/tipoTarjeta que F9.35 había dejado solo-lectura
// a propósito (para no romper la consistencia "ninguna config edita", ya
// resuelta). Mismo patrón admin-only que actualizarMediosPago/guardarTaxonomia
// — config/familia sigue write:false para el cliente.
// Coherencia: débito no genera resúmenes en cuotas (F9.35 solo lo logueaba con
// console.warn) — acá se VALIDA: si se pone/deja tipoTarjeta:'debito' y ya hay
// líneas en cuotas de esa tarjeta en resumenesTarjeta, se bloquea.
function slugTarjeta(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function tieneLineasEnCuotas(tarjetaCodigo: string): Promise<number> {
  const snap = await db.collection('resumenesTarjeta').where('tarjetaCodigo', '==', tarjetaCodigo).get();
  let n = 0;
  for (const doc of snap.docs) {
    const lineas = (doc.data().movimientosParseados ?? []) as Array<{ tipoLinea: string; cuotaTotal: number }>;
    n += lineas.filter(l => (l.tipoLinea === 'consumo' || l.tipoLinea === 'cuota') && l.cuotaTotal > 1).length;
  }
  return n;
}

function validarCamposTarjeta(data: Record<string, unknown>): {
  banco: string; tipo: string; titular: string; cuentaDebito: string;
  numeroCuenta?: string; ultimos4?: string[]; cierreDia?: number; venceDia?: number;
  tipoTarjeta?: 'credito' | 'debito';
} {
  const { banco, tipo, titular, cuentaDebito, numeroCuenta, ultimos4, cierreDia, venceDia, tipoTarjeta } = data;
  for (const [campo, valor] of [['banco', banco], ['tipo', tipo], ['titular', titular], ['cuentaDebito', cuentaDebito]] as const) {
    if (typeof valor !== 'string' || valor.trim().length === 0 || valor.length > 80) {
      throw new HttpsError('invalid-argument', `${campo} inválido (1-80 caracteres)`);
    }
  }
  if (numeroCuenta != null && (typeof numeroCuenta !== 'string' || numeroCuenta.length > 40)) {
    throw new HttpsError('invalid-argument', 'numeroCuenta inválido');
  }
  if (ultimos4 != null) {
    if (!Array.isArray(ultimos4) || ultimos4.some(u => typeof u !== 'string' || !/^\d{4}$/.test(u))) {
      throw new HttpsError('invalid-argument', 'ultimos4 debe ser un array de strings de 4 dígitos');
    }
  }
  for (const [campo, valor] of [['cierreDia', cierreDia], ['venceDia', venceDia]] as const) {
    if (valor != null && (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1 || valor > 31)) {
      throw new HttpsError('invalid-argument', `${campo} debe ser un día entre 1 y 31`);
    }
  }
  if (tipoTarjeta != null && tipoTarjeta !== 'credito' && tipoTarjeta !== 'debito') {
    throw new HttpsError('invalid-argument', 'tipoTarjeta debe ser "credito" o "debito"');
  }
  return {
    banco: (banco as string).trim(), tipo: (tipo as string).trim(), titular: (titular as string).trim(),
    cuentaDebito: (cuentaDebito as string).trim(),
    numeroCuenta: numeroCuenta as string | undefined,
    ultimos4: ultimos4 as string[] | undefined,
    cierreDia: cierreDia as number | undefined,
    venceDia: venceDia as number | undefined,
    tipoTarjeta: tipoTarjeta as 'credito' | 'debito' | undefined,
  };
}

export const guardarTarjeta = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('unauthenticated', 'Email no disponible');
    const autSnap = await db.collection('autorizados').doc(email).get();
    if (!autSnap.exists || autSnap.data()?.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Se requiere rol admin');
    }

    const { accion } = (request.data ?? {}) as { accion?: string };
    const famRef  = db.collection('config').doc('familia');
    const famSnap = await famRef.get();
    if (!famSnap.exists) throw new HttpsError('not-found', 'config/familia no existe');
    const tarjetas = (famSnap.data()?.tarjetas ?? []) as Array<Record<string, unknown> & { codigo: string }>;

    if (accion === 'crear') {
      const campos = validarCamposTarjeta((request.data ?? {}) as Record<string, unknown>);
      const base = slugTarjeta(`${campos.banco}-${campos.tipo}`) || 'TARJETA';
      const codigosExistentes = new Set(tarjetas.map(t => t.codigo));
      let codigo = base;
      let i = 2;
      while (codigosExistentes.has(codigo)) codigo = `${base}-${i++}`;

      await famRef.update({
        tarjetas: [...tarjetas, { codigo, ...campos }],
        actualizadoEn: FieldValue.serverTimestamp(),
      });
      console.log(`[guardarTarjeta] crear ${codigo} por ${email}`);
      return { ok: true, codigo };
    }

    const { codigo } = (request.data ?? {}) as { codigo?: unknown };
    const idx = tarjetas.findIndex(t => t.codigo === codigo);
    if (typeof codigo !== 'string' || idx === -1) throw new HttpsError('not-found', 'Tarjeta no encontrada');

    if (accion === 'editar') {
      const campos = validarCamposTarjeta((request.data ?? {}) as Record<string, unknown>);
      if (campos.tipoTarjeta === 'debito') {
        const nCuotas = await tieneLineasEnCuotas(codigo);
        if (nCuotas > 0) {
          throw new HttpsError('failed-precondition', `No se puede marcar como débito: tiene ${nCuotas} línea(s) en cuotas en resúmenes ya cargados (débito no genera cuotas).`);
        }
      }
      const nuevas = tarjetas.slice();
      nuevas[idx] = { codigo, ...campos };
      await famRef.update({ tarjetas: nuevas, actualizadoEn: FieldValue.serverTimestamp() });
      console.log(`[guardarTarjeta] editar ${codigo} por ${email}`);
      return { ok: true };
    }

    // eliminar
    const usoResumenes = await db.collection('resumenesTarjeta').where('tarjetaCodigo', '==', codigo).count().get();
    if (usoResumenes.data().count > 0) {
      throw new HttpsError('failed-precondition', `No se puede borrar: ${usoResumenes.data().count} resumen(es) usan esta tarjeta.`);
    }
    await famRef.update({
      tarjetas: tarjetas.filter((_, i) => i !== idx),
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    console.log(`[guardarTarjeta] eliminar ${codigo} por ${email}`);
    return { ok: true };
  },
);

// F9.43/F9.45/F9.46 — Canal B: recordatorios de vencimiento en Google Calendar.
export { sincronizarRecordatoriosCalendar, sincronizarCalendarAhora, setCalendarSync } from './calendarSync';

// ── F9.53 — Editar / eliminar movimiento (admin-only) ────────────────────────

// TC server-side: misma lógica que tcParaFecha en src/datos/tcDiario.ts pero
// vía Admin SDK. Se llama solo cuando moneda o fecha cambian en un movimiento USD.
async function tcParaFechaAdmin(fecha: Date): Promise<number | null> {
  const dateStr = fecha.toISOString().slice(0, 10);
  const exactSnap = await db.collection('tcDiario').doc(dateStr).get();
  if (exactSnap.exists) return (exactSnap.data()!.tcUsdArs as number) ?? null;
  const snap = await db.collection('tcDiario')
    .orderBy(FieldPath.documentId(), 'desc')
    .startAt(dateStr)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const hit = snap.docs[0];
  return hit.id <= dateStr ? ((hit.data().tcUsdArs as number) ?? null) : null;
}

// medioCanonico server-side: igual que src/datos/medios.ts pero sin el módulo.
function medioCanonicoBancos(nombre: string, bancos: Array<{ id: string; nombre: string; aliasDe?: string }>): string {
  const medio = bancos.find(b => b.nombre === nombre);
  if (!medio?.aliasDe) return nombre;
  const destino = bancos.find(b => b.id === medio.aliasDe);
  return destino?.nombre ?? nombre;
}

// editarMovimiento — campos editables: descripcion, monto, fecha, tipo, moneda,
// categoria, subcat, persona, medio.
// Invariantes forzados: persona=memberId válido o vacío (=familiar); medio→
// canónico (Efectivo→Mercado Pago); categoria+subcat validados contra taxonomía;
// TC recomputado si cambia moneda/fecha; mes recomputado si cambia fecha;
// itemEsperadoId desvinculado si identidad cambia sustancialmente.
export const editarMovimiento = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('unauthenticated', 'Email no disponible');
    const autSnap = await db.collection('autorizados').doc(email).get();
    if (!autSnap.exists || autSnap.data()?.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Se requiere rol admin');
    }

    const { id, cambios } = (request.data ?? {}) as { id?: string; cambios?: Record<string, unknown> };
    if (!id) throw new HttpsError('invalid-argument', 'id requerido');
    if (!cambios || typeof cambios !== 'object') throw new HttpsError('invalid-argument', 'cambios requerido');

    const movRef  = db.collection('movimientos').doc(id);
    const movSnap = await movRef.get();
    if (!movSnap.exists) throw new HttpsError('not-found', 'Movimiento no encontrado');
    const mov = movSnap.data()!;

    const configSnap = await db.collection('config').doc('familia').get();
    if (!configSnap.exists) throw new HttpsError('not-found', 'config/familia no existe');
    const config = configSnap.data()!;
    const miembros = (config.miembros ?? {}) as Record<string, { nombre: string; activo: boolean }>;
    const categorias = (config.categorias ?? []) as Array<{ nombre: string; activo: boolean }>;
    const bancos = (config.bancos ?? []) as Array<{ id: string; nombre: string; aliasDe?: string }>;

    const update: Record<string, unknown> = {};

    if ('descripcion' in cambios) {
      const d = cambios.descripcion;
      if (typeof d !== 'string' || d.trim().length === 0 || d.length > 300)
        throw new HttpsError('invalid-argument', 'descripcion inválida (1-300 caracteres)');
      update.descripcion = d.trim();
    }

    if ('monto' in cambios) {
      const m = cambios.monto;
      if (typeof m !== 'number' || !(m > 0))
        throw new HttpsError('invalid-argument', 'monto debe ser un número positivo');
      update.monto = m;
    }

    let fechaDate: Date | null = null;
    if ('fecha' in cambios) {
      const f = cambios.fecha;
      if (typeof f === 'number' && Number.isFinite(f)) {
        fechaDate = new Date(f);
      } else if (typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f)) {
        fechaDate = new Date(f + 'T12:00:00');
      } else {
        throw new HttpsError('invalid-argument', 'fecha inválida (YYYY-MM-DD o ms)');
      }
      update.fecha = Timestamp.fromDate(fechaDate);
      update.mes   = `${fechaDate.getFullYear()}-${String(fechaDate.getMonth() + 1).padStart(2, '0')}`;
    }

    if ('tipo' in cambios) {
      const t = cambios.tipo;
      if (t !== 'Gasto' && t !== 'Ingreso') throw new HttpsError('invalid-argument', 'tipo debe ser Gasto o Ingreso');
      update.tipo = t;
    }

    let monedaFinal: 'ARS' | 'USD' = (mov.moneda as 'ARS' | 'USD') ?? 'ARS';
    if ('moneda' in cambios) {
      const m = cambios.moneda;
      if (m !== 'ARS' && m !== 'USD') throw new HttpsError('invalid-argument', 'moneda debe ser ARS o USD');
      monedaFinal = m;
      update.moneda = m;
    }

    if ('moneda' in cambios || 'fecha' in cambios) {
      const fechaParaTC = fechaDate ?? (mov.fecha as FirebaseFirestore.Timestamp)?.toDate() ?? new Date();
      if (monedaFinal === 'USD') {
        update.tcUsdArs = await tcParaFechaAdmin(fechaParaTC);
      } else {
        update.tcUsdArs = null;
      }
    }

    // categoria → valida contra taxonomía activa; al cambiar se limpia subcat
    if ('categoria' in cambios) {
      const c = cambios.categoria;
      if (c === null || c === undefined || c === '') {
        update.categoria   = null;
        update.subcategoria = null;
      } else {
        if (typeof c !== 'string') throw new HttpsError('invalid-argument', 'categoria inválida');
        const catActiva = categorias.find(x => x.nombre === c && x.activo);
        if (!catActiva) throw new HttpsError('invalid-argument', `Categoría "${c}" no existe o está inactiva`);
        update.categoria   = c;
        update.subcategoria = null; // se repone abajo si viene subcat válida
      }
    }

    // subcat → valida contra subcategorias/{categoriaPadre} activas
    if ('subcat' in cambios) {
      const s = cambios.subcat;
      if (s === null || s === undefined || s === '') {
        update.subcategoria = null;
      } else {
        if (typeof s !== 'string') throw new HttpsError('invalid-argument', 'subcat inválida');
        const catPadre = ('categoria' in cambios ? cambios.categoria : mov.categoria) as string | null;
        if (catPadre) {
          const subcatSnap = await db.collection('subcategorias')
            .where('categoriaPadre', '==', catPadre)
            .where('valor', '==', s)
            .where('activo', '==', true)
            .limit(1)
            .get();
          update.subcategoria = subcatSnap.empty ? null : s;
        } else {
          update.subcategoria = null;
        }
      }
    }

    if ('persona' in cambios) {
      const p = cambios.persona;
      if (p === null || p === undefined || p === '') {
        update.persona = null;
      } else {
        if (typeof p !== 'string') throw new HttpsError('invalid-argument', 'persona inválida');
        if (!miembros[p]) throw new HttpsError('invalid-argument', `persona "${p}" no es un memberId válido`);
        update.persona = p;
      }
    }

    if ('medio' in cambios) {
      const m = cambios.medio;
      if (m === null || m === undefined || m === '') {
        update.banco = null;
      } else {
        if (typeof m !== 'string') throw new HttpsError('invalid-argument', 'medio inválido');
        update.banco = medioCanonicoBancos(m, bancos);
      }
    }

    // itemEsperadoId: desvincular si identidad cambia sustancialmente
    const itemActual = (mov.itemEsperadoId as string | null) ?? null;
    if (itemActual) {
      const personaCambio = 'persona' in cambios && update.persona !== (mov.persona ?? null);
      const catCambio     = 'categoria' in cambios && update.categoria !== (mov.categoria ?? null);
      const montoNuevo    = ('monto' in cambios ? update.monto as number : (mov.monto as number)) ?? 0;
      const montoViejo    = (mov.monto as number) ?? 0;
      const fueraDeTol    = montoViejo > 0 && Math.abs(montoNuevo - montoViejo) / montoViejo > 0.10;
      if (personaCambio || catCambio || fueraDeTol) {
        update.itemEsperadoId = null;
      }
    }

    if (Object.keys(update).length === 0) return { ok: true };

    update.actualizadoEn = FieldValue.serverTimestamp();
    await movRef.update(update);

    console.log(`[editarMovimiento] ${id} — campos: ${Object.keys(update).join(', ')} (por ${email})`);
    return { ok: true };
  },
);

// eliminarMovimiento — borra el doc. Guardrail: bloquea si el movimiento es un
// pago de tarjeta consolidado (resumenTarjetaId != null o excluirDash=true) —
// borrarlo descuadra la conciliación de resúmenes.
export const eliminarMovimiento = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('unauthenticated', 'Email no disponible');
    const autSnap = await db.collection('autorizados').doc(email).get();
    if (!autSnap.exists || autSnap.data()?.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Se requiere rol admin');
    }

    const { id } = (request.data ?? {}) as { id?: string };
    if (!id) throw new HttpsError('invalid-argument', 'id requerido');

    const movRef  = db.collection('movimientos').doc(id);
    const movSnap = await movRef.get();
    if (!movSnap.exists) throw new HttpsError('not-found', 'Movimiento no encontrado');
    const mov = movSnap.data()!;

    if (mov.resumenTarjetaId || mov.excluirDash === true) {
      throw new HttpsError(
        'failed-precondition',
        'Este movimiento está vinculado a un resumen de tarjeta y no se puede borrar acá. ' +
        'Para eliminarlo, descartá el resumen de tarjeta desde la sección Comprobantes.',
      );
    }

    await movRef.delete();
    console.log(`[eliminarMovimiento] ${id} eliminado (por ${email})`);
    return { ok: true };
  },
);

// F8.3 — Editor de Normalización: CRUD + reordenar reglas de normalización.
// Valida regex server-side antes de persistir. activo se filtra en cargarReglasNormalizacion.

export const guardarReglaNormalizacion = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('unauthenticated', 'Email no disponible');
    const autSnap = await db.collection('autorizados').doc(email).get();
    if (!autSnap.exists || autSnap.data()?.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Se requiere rol admin');
    }

    const { accion } = (request.data ?? {}) as { accion?: string };
    if (!['crear', 'editar', 'eliminar', 'reordenar'].includes(accion ?? '')) {
      throw new HttpsError('invalid-argument', 'accion inválida');
    }
    const col = db.collection('reglasNormalizacion');

    if (accion === 'reordenar') {
      const { ids } = request.data as { ids?: string[] };
      if (!Array.isArray(ids) || ids.length === 0) throw new HttpsError('invalid-argument', 'ids requerido');
      const batch = db.batch();
      ids.forEach((id, i) => batch.set(col.doc(id), { orden: i }, { merge: true }));
      await batch.commit();
      console.log(`[guardarReglaNormalizacion] reordenar ${ids.length} (por ${email})`);
      return { ok: true };
    }

    if (accion === 'eliminar') {
      const { id } = request.data as { id?: string };
      if (!id) throw new HttpsError('invalid-argument', 'id requerido');
      await col.doc(id).delete();
      console.log(`[guardarReglaNormalizacion] eliminar ${id} (por ${email})`);
      return { ok: true };
    }

    const { id, tipo, patron, reemplazo, activo, notas } = request.data as {
      id?: string; tipo?: string; patron?: string; reemplazo?: string;
      activo?: boolean; notas?: string | null;
    };
    if (!['prefix', 'suffix', 'replace', 'regex'].includes(tipo ?? '')) {
      throw new HttpsError('invalid-argument', 'tipo inválido');
    }
    if (typeof patron !== 'string' || patron.length === 0) {
      throw new HttpsError('invalid-argument', 'patron requerido');
    }
    if (tipo === 'regex') {
      try { new RegExp(patron, 'gi'); }
      catch (e) { throw new HttpsError('invalid-argument', `regex inválido: ${(e as Error).message}`); }
    }

    const payload: Record<string, unknown> = {
      tipo, patron,
      reemplazo: typeof reemplazo === 'string' ? reemplazo : '',
      activo: activo !== false,
      notas: notas ?? null,
    };

    if (accion === 'editar') {
      if (!id) throw new HttpsError('invalid-argument', 'id requerido para editar');
      const snap = await col.doc(id).get();
      if (!snap.exists) throw new HttpsError('not-found', 'Regla no encontrada');
      await col.doc(id).set(payload, { merge: true });
      console.log(`[guardarReglaNormalizacion] editar ${id} (por ${email})`);
      return { ok: true, id };
    }

    const all = await col.get();
    const maxOrden = all.docs.reduce((m, d) => Math.max(m, (d.data().orden ?? 0) as number), -1);
    const ref = await col.add({ ...payload, orden: maxOrden + 1 });
    console.log(`[guardarReglaNormalizacion] crear ${ref.id} orden=${maxOrden + 1} (por ${email})`);
    return { ok: true, id: ref.id };
  },
);

// F8.2 — Editor de Destinos: upsert (crear/editar) y eliminar payees aprendidos.
// La normalización es server-side; el cliente manda `destinoRaw` en creación.
// Write cerrado en rules → toda mutación pasa por acá (Admin SDK, bypassa rules).

export const upsertDestino = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('unauthenticated', 'Email no disponible');
    const autSnap = await db.collection('autorizados').doc(email).get();
    if (!autSnap.exists || autSnap.data()?.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Se requiere rol admin');
    }

    const {
      id, destinoRaw,
      itemEsperadoId, categoria, subcategoria, etiqueta, confianza,
    } = (request.data ?? {}) as {
      id?: string; destinoRaw?: string;
      itemEsperadoId?: string | null;
      categoria?: string | null; subcategoria?: string | null; etiqueta?: string | null;
      confianza?: number;
    };

    const cat  = (categoria ?? null) || null;
    const item = (itemEsperadoId ?? null) || null;

    if (!cat && !item) throw new HttpsError('invalid-argument', 'Se requiere categoría o ítem esperado');

    if (confianza != null && (typeof confianza !== 'number' || confianza < 0 || confianza > 1)) {
      throw new HttpsError('invalid-argument', 'confianza fuera de rango [0,1]');
    }

    if (item) {
      const itemSnap = await db.collection('itemsEsperados').doc(item).get();
      if (!itemSnap.exists) throw new HttpsError('invalid-argument', `itemEsperadoId inexistente: ${item}`);
    }

    let ref: FirebaseFirestore.DocumentReference;
    let base: Record<string, unknown> = {};

    if (id) {
      ref = db.collection('destinos').doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw new HttpsError('not-found', 'Destino no encontrado');
    } else {
      if (!destinoRaw || typeof destinoRaw !== 'string') {
        throw new HttpsError('invalid-argument', 'destinoRaw requerido para crear');
      }
      const parsed = normalizarDestino(destinoRaw);
      if (!parsed) throw new HttpsError('invalid-argument', 'destinoRaw no normalizable');
      const nid = idDestinoNorm(parsed.norm);
      ref = db.collection('destinos').doc(nid);
      base = { destinoNorm: parsed.norm, tipo: parsed.tipo, creadoPor: email };
    }

    const update: Record<string, unknown> = {
      ...base,
      categoria:     cat,
      subcategoria:  (subcategoria ?? null) || null,
      etiqueta:      (etiqueta ?? null) || null,
      actualizadoEn: FieldValue.serverTimestamp(),
    };
    update.itemEsperadoId = item;
    if (confianza != null) update.confianza = confianza;
    else if (!id) update.confianza = 0.8;

    await ref.set(update, { merge: true });
    console.log(`[upsertDestino] ${ref.id} → cat=${cat ?? '-'} item=${item ?? '-'} (por ${email})`);
    return { ok: true, id: ref.id };
  },
);

export const eliminarDestino = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('unauthenticated', 'Email no disponible');
    const autSnap = await db.collection('autorizados').doc(email).get();
    if (!autSnap.exists || autSnap.data()?.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Se requiere rol admin');
    }
    const { id } = (request.data ?? {}) as { id?: string };
    if (!id) throw new HttpsError('invalid-argument', 'id requerido');
    await db.collection('destinos').doc(id).delete();
    console.log(`[eliminarDestino] ${id} (por ${email})`);
    return { ok: true };
  },
);

// ── F9.93 — Análisis IA de patrimonio (por posición y sectorial) ──────────────
const DUENO_EMAIL = 'jpcofano@gmail.com';

function buildPromptPosicion(contexto: Record<string, unknown>): string {
  return `Sos un analista financiero especialista en mercados argentinos e internacionales. Analizás una posición de una cartera familiar.

POSICIÓN A ANALIZAR:
${JSON.stringify(contexto, null, 2)}

Respondé ÚNICAMENTE con un JSON válido (sin markdown, sin texto antes ni después) con este shape exacto:
{
  "queEs": "1-2 frases: qué es el instrumento/empresa y de qué depende su valor",
  "situacionActual": "3-5 frases con lo relevante HOY (resultados, regulación, precio vs historia) — usá web_search para información reciente",
  "riesgos": ["3 a 5 riesgos específicos de ESTE papel, concretos"],
  "rolEnCartera": "1-3 frases usando el contexto provisto: peso, con qué otras posiciones comparte driver, qué le aporta o concentra",
  "proximosEventos": [
    { "cuando": "YYYY-MM-DD o YYYY-MM (null si no hay fecha conocida)", "evento": "descripción corta del evento" }
  ],
  "queHariaEnCadaCaso": [
    {
      "caso": "condición observable y concreta (ej: 'si la revisión tarifaria sale desfavorable')",
      "acciones": ["2-3 opciones de acción posibles para ese escenario"],
      "costo": "el trade-off principal de actuar (impositivo, upside resignado, timing)"
    }
  ],
  "fuentes": ["urls o medios consultados"]
}

REGLAS INNEGOCIABLES:
- Español rioplatense.
- PROHIBIDO: imperativos sin condición ("vendé", "comprá", "recomiendo salir/entrar"), precios objetivo como certeza.
- PERMITIDO: condicionales con opciones ("si X, convendría evaluar A o B porque…"), siempre con el costo/trade-off explícito.
- 2 a 4 casos en queHariaEnCadaCaso, del más probable al menos. Los casos deben ser observables (un dato, un evento, un precio), no vaguedades.
- La decisión es del titular: cada caso presenta opciones, nunca una única salida obligada.
- Si no hay información confiable de algo, decirlo en vez de inventar.
- Máx ~300 palabras en total.`;
}

function buildPromptSectorial(contexto: Record<string, unknown>): string {
  return `Sos un analista financiero especialista en mercados argentinos e internacionales. Analizás el panorama sectorial de una cartera familiar.

COMPOSICIÓN DE LA CARTERA:
${JSON.stringify(contexto, null, 2)}

Escribí un panorama sectorial en texto libre (no JSON), en español rioplatense. Estructura: un bloque por sector relevante de la cartera (energía AR, macro/CER AR, soberano AR, cripto, tech global). Para cada sector incluí:
1. Situación actual y riesgos relevantes.
2. Próximos eventos con fecha aproximada.
3. "Qué haría en cada caso" — 2 a 3 escenarios observables para ESE sector con la forma: "Si [condición concreta] → las opciones serían [A / B], con el trade-off [X]". Uno por línea, breve.

REGLAS INNEGOCIABLES:
- PROHIBIDO: imperativos sin condición ("vendé", "comprá", "conviene salir").
- PERMITIDO: condicionales con opciones, siempre con trade-off explícito.
- La decisión es del titular: cada caso presenta opciones, nunca una salida obligada.
- Usá web_search para información reciente.
- Si no hay info confiable, decirlo.`;
}

function buildPromptAgenda(contexto: Record<string, unknown>): string {
  return `Sos un analista financiero especialista en mercados argentinos e internacionales. Armás la agenda de eventos macro y de mercado de los próximos 45 días relevantes PARA ESTA CARTERA.

COMPOSICIÓN DE LA CARTERA (exposición por driver):
${JSON.stringify(contexto, null, 2)}

Devolvé EXCLUSIVAMENTE un JSON con esta estructura:
{
  "eventos": [
    {
      "fecha": "YYYY-MM-DD",
      "evento": "descripción corta (max 80 chars)",
      "driver": "cer_pesos|soberano|tasas_ar|tasas_global|cripto|energia_ar|tech_global|resultados|impositivo|otro",
      "porQueImporta": "1 frase ligada a la cartera"
    }
  ]
}

CHECKLIST DE COBERTURA — barré estas categorías según la exposición:
- cer_pesos: IPC INDEC (mensual ~día 10-14), REM BCRA (inicios de mes), IPC-CABA como anticipo.
- tasas_ar: decisiones de tasa BCRA; licitaciones del Tesoro (quincenales).
- soberano: cupones de Globales GD (9-ene / 9-jul), Bopreales; dato fiscal mensual; vencimientos relevantes.
- energia_ar: audiencias/resoluciones tarifarias ENRE-ENARGAS; ajustes mensuales; producción Vaca Muerta; reuniones OPEP+.
- resultados: earnings de empresas EN CARTERA (AR: PAMP, YPFD, VIST, TRAN, TGSU2, CEPU, BMA, GGAL, TXAR; global: ACN, GLOB, CVX, VZ, B) — fecha confirmada o estimada.
- tasas_global: FOMC (+dot plot), CPI EE.UU.; empleo como secundario.
- cripto: upgrades programados de Ethereum; hitos regulatorios con fecha; vencimientos trimestrales de derivados.
- impositivo: vencimientos y anticipos de Bienes Personales y Ganancias (AR).

REGLAS INNEGOCIABLES:
- Español rioplatense.
- Usá web_search para verificar fechas reales del calendario económico. Máx 5 búsquedas.
- Si no podés confirmar la fecha, poné "fecha": null y aclaralo en el evento — NO inventar fechas.
- Sin recomendaciones de compra/venta.
- Solo los próximos 45 días desde hoy.
- Priorizá por exposición: los drivers con mayor % en cartera van primero.`;
}

export const analizarConIA = onCall(
  {
    region:         'southamerica-east1',
    secrets:        [anthropicKey],
    timeoutSeconds: 120,
    memory:         '256MiB',
  },
  async (request) => {
    // Auth: solo dueño
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const email = request.auth.token.email?.toLowerCase();
    if (email !== DUENO_EMAIL) throw new HttpsError('permission-denied', 'Acceso restringido al dueño');

    // Toggle: verificar que IA esté habilitada
    const toggleSnap = await db.collection('configPatrimonio').doc('ia').get();
    const habilitado = toggleSnap.exists ? (toggleSnap.data()?.habilitado as boolean) : false;
    if (!habilitado) {
      throw new HttpsError('failed-precondition', 'El análisis IA está deshabilitado. Activarlo desde la solapa Research.');
    }

    const { modo, ticker, contexto } = (request.data ?? {}) as {
      modo?: 'posicion' | 'sectorial' | 'agenda';
      ticker?: string;
      contexto?: Record<string, unknown>;
    };

    if (!modo || !['posicion', 'sectorial', 'agenda'].includes(modo)) {
      throw new HttpsError('invalid-argument', 'modo debe ser "posicion", "sectorial" o "agenda"');
    }
    if (modo === 'posicion' && !ticker) {
      throw new HttpsError('invalid-argument', 'ticker requerido para modo posicion');
    }
    if (!contexto || typeof contexto !== 'object') {
      throw new HttpsError('invalid-argument', 'contexto requerido');
    }

    const client = new Anthropic({ apiKey: anthropicKey.value() });
    const modeloUsado = 'claude-sonnet-4-6';

    const systemPrompt = modo === 'posicion'
      ? buildPromptPosicion(contexto)
      : modo === 'agenda'
        ? buildPromptAgenda(contexto)
        : buildPromptSectorial(contexto);

    const maxWebSearch = modo === 'agenda' ? 5 : 3;
    const maxTokens    = modo === 'posicion' ? 1500 : modo === 'agenda' ? 4000 : 3000;

    const response = await client.messages.create({
      model: modeloUsado,
      max_tokens: maxTokens,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxWebSearch }] as any,
      messages: [{ role: 'user', content: systemPrompt }],
    });

    const rawText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    let resultado: unknown;
    if (modo === 'sectorial') {
      resultado = rawText;
    } else {
      // posicion y agenda: JSON esperado
      const mdMatch  = rawText.match(/```json\s*([\s\S]*?)\s*```/);
      const rawMatch = rawText.match(/(\{[\s\S]*\})/);
      const jsonStr  = mdMatch ? mdMatch[1] : (rawMatch ? rawMatch[1] : null);
      if (!jsonStr) throw new HttpsError('internal', `Sin JSON en respuesta: ${rawText.slice(0, 200)}`);
      try { resultado = JSON.parse(jsonStr); }
      catch { throw new HttpsError('internal', `JSON inválido: ${jsonStr.slice(0, 200)}`); }
    }

    const generadoEn = FieldValue.serverTimestamp();

    if (modo === 'posicion') {
      await db.collection('analisisPosiciones').doc(ticker!).set({
        ticker, generadoEn, modeloUsado, resultado,
      });
      console.log(`[analizarConIA] posicion ${ticker} analizada`);
    } else if (modo === 'agenda') {
      await db.collection('agendaMacro').add({
        generadoEn, modeloUsado, horizonteDias: 45,
        eventos: (resultado as { eventos: unknown[] }).eventos ?? [],
      });
      console.log('[analizarConIA] agenda macro generada');
    } else {
      await db.collection('analisisSectorial').add({
        generadoEn, modeloUsado, resultado,
      });
      console.log('[analizarConIA] sectorial generado');
    }

    return { ok: true, resultado };
  },
);
