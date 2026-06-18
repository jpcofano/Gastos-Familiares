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
import { normalizar, type NormRule } from './normalizador';

if (!getApps().length) initializeApp();

setGlobalOptions({ region: 'southamerica-east1' });

const db            = getFirestore();
const storage       = getStorage();
const anthropicKey  = defineSecret('ANTHROPIC_API_KEY');

function hoyArgentinaISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
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

async function cargarReglasNormalizacion(): Promise<NormRule[]> {
  const snap = await db.collection('reglasNormalizacion').get();
  return snap.docs
    .map(d => d.data())
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

export const aprenderMovimientoCreado = onDocumentCreated(
  { document: 'movimientos/{id}', memory: '128MiB' },
  async event => {
    const data = event.data?.data();
    if (data?.seedImport) return;
    if (!data?.categoria || !data?.subcategoria) return;
    await aprender(data).catch(e => console.error('[aprender] error en create:', e));
  },
);

export const aprenderMovimientoActualizado = onDocumentUpdated(
  { document: 'movimientos/{id}', memory: '128MiB' },
  async event => {
    const before = event.data?.before.data();
    const after  = event.data?.after.data();
    if (after?.seedImport) return;
    if (!after?.categoria || !after?.subcategoria) return;
    if (before?.categoria === after.categoria && before?.subcategoria === after.subcategoria) return;
    await aprender(after).catch(e => console.error('[aprender] error en update:', e));
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

function dedupMovimientos(movs: MovimientoRaw[]): MovimientoRaw[] {
  const seen = new Set<string>();
  return movs.filter(m => {
    const k1 = `${(m.descripcionRaw ?? '').trim().toUpperCase()}|${m.monto ?? 0}`;
    const k2 = `${m.monto ?? 0}|${m.moneda ?? 'ARS'}|${m.fechaConsumo ?? ''}`;
    if (seen.has(k1) || seen.has(k2)) return false;
    seen.add(k1);
    seen.add(k2);
    return true;
  });
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
      const movsBrutos = dedupMovimientos(parsed.movimientos);

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
        estado:              'parseado',
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
