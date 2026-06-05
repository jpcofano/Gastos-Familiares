/**************************************
 * 47_Tarjetas_PDF.gs - Fase 2.2.b
 * Parser de PDFs de resúmenes de tarjeta usando Claude API.
 * Soporta 4 formatos reales:
 *   BBVA Visa Signature, BBVA Mastercard Black,
 *   Galicia Visa, Galicia Mastercard Black.
 *
 * NO escribe nada en el Sheet. Retorna datos estructurados.
 * El caller (endpoint 2.2.c) decide qué hacer con el resultado.
 *
 * Función pública:
 *   parsearPDF(pdfBase64, tarjetaCodigo)
 *
 * Helpers privados:
 *   gf_getAnthropicKey_()
 *   gf_llamarClaudeConPDF_(pdfBase64, promptText, apiKey)
 *   gf_buildParserPrompt_(tarjetaCodigo)
 **************************************/

const GF_CLAUDE_MODEL_PDF    = 'claude-sonnet-4-6';
const GF_CLAUDE_MAX_TOKENS   = 32000;
const GF_CLAUDE_API_URL      = 'https://api.anthropic.com/v1/messages';
const GF_CLAUDE_API_VERSION  = '2023-06-01';
const GF_CLAUDE_BETA_PDFS    = 'pdfs-2024-09-25';

/**
 * Parsea un resumen de tarjeta en PDF y devuelve los datos estructurados.
 * NO escribe nada en el Sheet.
 *
 * @param {string} pdfBase64     PDF codificado en base64
 * @param {string} tarjetaCodigo Código del catálogo:
 *                               'BBVA-VISA-SIG' | 'BBVA-MASTER-BLK' |
 *                               'GAL-VISA' | 'GAL-MASTER-BLK'
 * @returns {{
 *   resumen: {
 *     nroResumen:      string,
 *     banco:           string,
 *     tarjeta:         string,
 *     titular:         string,
 *     fechaCierre:     string,      // YYYY-MM-DD
 *     fechaVencimiento:string,      // YYYY-MM-DD
 *     totalARS:        number,
 *     totalUSD:        number,
 *     pagoMinimoARS:   number,
 *     cuentaDebito:    string
 *   },
 *   movimientos: Array<{
 *     seq:              number,
 *     tipoLinea:        string,
 *     fechaConsumo:     string,     // YYYY-MM-DD o null
 *     descripcionRaw:   string,
 *     nroCupon:         string,
 *     cuotaActual:      number,
 *     cuotaTotal:       number,
 *     moneda:           string,     // 'ARS' | 'USD'
 *     monto:            number,
 *     personaDetectada: string,
 *     esBonificacion:   boolean,
 *     esReverso:        boolean,
 *     esImpuesto:       boolean,
 *     esPagoAnterior:   boolean
 *   }>
 * }}
 */
function parsearPDF(pdfBase64, tarjetaCodigo) {
  if (!pdfBase64) throw new Error('parsearPDF: pdfBase64 requerido');

  // tarjetaCodigo es opcional — si viene, validarlo; si no, se detecta post-parseo
  if (tarjetaCodigo) {
    const codigosValidos = GF_TARJETAS_CATALOGO.map(function(t) { return t[0]; });
    if (codigosValidos.indexOf(tarjetaCodigo) === -1) {
      throw new Error('parsearPDF: tarjetaCodigo inválido: ' + tarjetaCodigo +
        '. Válidos: ' + codigosValidos.join(', '));
    }
  }

  const apiKey = gf_getAnthropicKey_();
  const prompt = gf_buildParserPrompt_(tarjetaCodigo || null);

  Logger.log('parsearPDF: llamando Claude API para ' + (tarjetaCodigo || 'auto-detect'));
  const responseText = gf_llamarClaudeConPDF_(pdfBase64, prompt, apiKey);

  // Extraer el bloque JSON — Claude puede envolverlo en ```json ... ``` o devolverlo directo
  const mdMatch  = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  const rawMatch = responseText.match(/(\{[\s\S]*\})/);
  const jsonStr  = mdMatch ? mdMatch[1] : (rawMatch ? rawMatch[1] : null);

  if (!jsonStr) {
    throw new Error('parsearPDF: Claude no devolvió JSON válido.\nResponse (500 chars): ' +
      responseText.substring(0, 500));
  }

  // Escapar caracteres de control literales dentro de strings JSON antes de parsear.
  // Claude a veces incluye newlines o tabs literales en campos de descripción.
  let jsonSanitized = '';
  { let inStr = false, esc = false;
    for (let ci = 0; ci < jsonStr.length; ci++) {
      const ch = jsonStr[ci];
      if (esc)              { jsonSanitized += ch; esc = false; continue; }
      if (ch === '\\' && inStr) { jsonSanitized += ch; esc = true;  continue; }
      if (ch === '"')       { inStr = !inStr; jsonSanitized += ch; continue; }
      if (inStr && ch === '\n') { jsonSanitized += '\\n'; continue; }
      if (inStr && ch === '\r') { jsonSanitized += '\\r'; continue; }
      if (inStr && ch === '\t') { jsonSanitized += '\\t'; continue; }
      jsonSanitized += ch;
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonSanitized);
  } catch (e) {
    throw new Error('parsearPDF: JSON inválido de Claude: ' + e.message +
      '\nJSON (500 chars): ' + jsonStr.substring(0, 500));
  }

  if (!parsed.resumen || !Array.isArray(parsed.movimientos)) {
    throw new Error('parsearPDF: estructura incompleta (falta resumen o movimientos)');
  }

  Logger.log('PRE-DEDUP: ' + parsed.movimientos.length + ' movimientos');
  var seen = {};
  parsed.movimientos = parsed.movimientos.filter(function(m) {
    var key1 = (m.descripcionRaw || '').trim().toUpperCase() + '|' + String(m.monto || 0);
    var key2 = String(m.monto || 0) + '|' + (m.moneda || 'ARS') + '|' + (m.fechaConsumo || '');
    if (seen[key1] || seen[key2]) return false;
    seen[key1] = true;
    seen[key2] = true;
    return true;
  });
  Logger.log('POST-DEDUP: ' + parsed.movimientos.length + ' movimientos');

  parsed.movimientos.forEach(function(m, i) { m.seq = i + 1; });

  Logger.log('parsearPDF OK — ' + tarjetaCodigo +
    ' | movimientos: ' + parsed.movimientos.length +
    ' | totalARS: ' + (parsed.resumen.totalARS || 0));
  SpreadsheetApp.getActive().toast(
    'PDF parseado: ' + parsed.movimientos.length + ' movimientos',
    'Parser PDF', 5
  );

  return parsed;
}

// ── Helpers privados ──────────────────────────────────────────────────────────

/**
 * Lee la Anthropic API Key desde Script Properties.
 * Si no está guardada ahí, intenta leerla desde Config B18 como fallback
 * y muestra un aviso para que el usuario la migre con gf_guardarAnthropicKey_().
 */
function gf_getAnthropicKey_() {
  const PROP_KEY = 'GF_ANTHROPIC_API_KEY';
  const stored = PropertiesService.getScriptProperties().getProperty(PROP_KEY);
  if (stored && stored.trim()) return stored.trim();

  // Fallback: leer de Config (solo para no romper si alguien la puso ahí antes)
  const sh = SpreadsheetApp.getActive().getSheetByName(GF.SHEET_CONFIG);
  if (sh) {
    const fromCell = String(sh.getRange(GF.CFG_ANTHROPIC_KEY_CELL).getValue() || '').trim();
    if (fromCell) {
      Logger.log('⚠ API Key leída desde Config. Corré gf_guardarAnthropicKey_() para guardarla de forma segura.');
      return fromCell;
    }
  }

  throw new Error(
    'Anthropic API Key no configurada. ' +
    'Pegá la clave en Config ' + GF.CFG_ANTHROPIC_KEY_CELL + ' y corré gf_guardarAnthropicKey_(), ' +
    'o usá el menú Tarjetas → Configurar API Key.'
  );
}

/**
 * Llama a la Claude API enviando el PDF como documento base64.
 *
 * @param {string} pdfBase64
 * @param {string} promptText
 * @param {string} apiKey
 * @returns {string} Texto de la respuesta de Claude
 */
function gf_llamarClaudeConPDF_(pdfBase64, promptText, apiKey) {
  const payload = {
    model: GF_CLAUDE_MODEL_PDF,
    max_tokens: GF_CLAUDE_MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64
            }
          },
          {
            type: 'text',
            text: promptText
          }
        ]
      }
    ]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key':          apiKey,
      'anthropic-version':  GF_CLAUDE_API_VERSION,
      'anthropic-beta':     GF_CLAUDE_BETA_PDFS
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(GF_CLAUDE_API_URL, options);
  const code     = response.getResponseCode();
  const body     = response.getContentText();

  if (code !== 200) {
    throw new Error('Claude API error HTTP ' + code + ': ' + body.substring(0, 800));
  }

  const json = JSON.parse(body);
  if (!json.content || !json.content[0] || !json.content[0].text) {
    throw new Error('Claude API: respuesta sin contenido de texto: ' + body.substring(0, 500));
  }

  return json.content[0].text;
}

/**
 * Construye el prompt para parsear el PDF.
 * El mismo prompt cubre los 4 formatos; Claude detecta el layout desde el PDF.
 *
 * @param {string} tarjetaCodigo
 * @returns {string}
 */
function gf_buildParserPrompt_(tarjetaCodigo) {
  var info    = GF_TARJETAS_CATALOGO.filter(function(t) { return t[0] === tarjetaCodigo; })[0] || [];
  var banco   = info[1] || '';
  var tarjeta = info[2] || '';
  var cats    = gf_getDiccionarioValores_('Categoria');
  if (!cats.length) cats = ['Casa','Auto','Alimentación cotidiana','Salidas','Vacaciones y viajes','Salud','Educación y chicos','Personal','Indumentaria','Impuestos y finanzas','Transporte general','Tarjetas','Ingresos'];

  return 'Sos un parser especializado en resúmenes de tarjetas de crédito argentinas.\n' +
'Tu tarea es extraer los datos del PDF adjunto y devolver ÚNICAMENTE un bloque JSON válido\n' +
'(envuelto en ```json ... ```).\n' +
'\n' +
'CONTEXTO DE ESTA TARJETA:\n' +
'- Banco: ' + banco + '\n' +
'- Tarjeta: ' + tarjeta + '\n' +
'\n' +
'MAPEO CANÓNICO DE PERSONAS (usá estos valores exactos en personaDetectada):\n' +
'  "MARIA LASCANO", "LASCANO MARIA", "LASCANO,MARIA", "Maria Lascano" → "María"\n' +
'  "JUAN PABLO COFANO", "COFANO JUAN", "COFANO,JUAN", "Juan Pablo Cofano" → "Juan"\n' +
'  "FEDERICO N COFANO", "Federico N Cofano" → "Federico"\n' +
'  "SOFIA COFANO", "Sofía Cofano" → "Sofía"\n' +
'\n' +
'═══════════════════════════════════════════════════════════\n' +
'PARTE 1 — OBJETO "resumen" (metadata del encabezado del PDF)\n' +
'═══════════════════════════════════════════════════════════\n' +
'\n' +
'Extraé los siguientes campos:\n' +
'- nroResumen: número de resumen del encabezado\n' +
'  (ej Galicia Visa: "VI00000000064559935", Galicia Master: "027032119814",\n' +
'   BBVA: número de sobre como "1445563")\n' +
'- banco: "' + banco + '"\n' +
'- tarjeta: "' + tarjeta + '"\n' +
'- titular: nombre del titular principal tal como aparece (ej: "LASCANO MARIA")\n' +
'- fechaCierre: fecha de cierre ACTUAL en formato YYYY-MM-DD\n' +
'  (no el cierre anterior; buscá "Cierre actual" o "CIERRE ACTUAL")\n' +
'- fechaVencimiento: fecha de vencimiento ACTUAL en formato YYYY-MM-DD\n' +
'  (buscá "Vencimiento actual" o "VENCIMIENTO ACTUAL")\n' +
'- totalARS: total a pagar en pesos (número decimal, sin símbolos $)\n' +
'  (buscá "TOTAL A PAGAR" o "SALDO ACTUAL $")\n' +
'- totalUSD: total a pagar en dólares (número decimal, 0 si no aplica)\n' +
'- pagoMinimoARS: pago mínimo en pesos (número decimal)\n' +
'- cuentaDebito: número de cuenta donde se debitará\n' +
'  (extraer de la línea "DEBITAREMOS DE SU C.A.XXXXXXXXX" o "DEBITAREMOS DE SU CTA XXXXXXXXX"\n' +
'   o "Debitaremos de su c.ahorro XXXXXXXXXX"; devolver solo el número de cuenta)\n' +
'\n' +
'═══════════════════════════════════════════════════════════\n' +
'PARTE 2 — ARRAY "movimientos" (uno por línea de consumo)\n' +
'═══════════════════════════════════════════════════════════\n' +
'\n' +
'── QUÉ INCLUIR ──\n' +
'✓ Todos los consumos y cuotas del "DETALLE DEL CONSUMO"\n' +
'✓ Percepciones e impuestos (IIBB, IVA RG, DB.RG, PERCEPCION)\n' +
'✓ Devoluciones de percepciones (DEV.IMP, CR.RG, DEV PER, CAJA SEG-PROMO)\n' +
'✓ Bonificaciones (BONIF. CONSUMO) y reversos (montos negativos en la sección de consumos)\n' +
'\n' +
'── QUÉ EXCLUIR ──\n' +
'✗ Saldo anterior\n' +
'✗ Pagos del resumen anterior (SU PAGO EN PESOS, SU PAGO EN USD)\n' +
'✗ Devoluciones de percepciones que aparecen en el CONSOLIDADO entre\n' +
'  "SU PAGO" y "SALDO PENDIENTE" (ej: DEV PER RG 4815 30% con monto\n' +
'  negativo). Estas son ajustes del período anterior, NO del mes actual.\n' +
'  SOLO incluir devoluciones que aparezcan en el DETALLE DEL CONSUMO\n' +
'  o debajo del SUBTOTAL como percepciones del mes.\n' +
'✗ Subtotales por persona o tarjeta (esas líneas solo sirven para detectar persona)\n' +
'✗ Todo el texto legal, tablas de financiación, información institucional\n' +
'✗ Cuotas a vencer (tabla de proyección futura)\n' +
'\n' +
'── CAMPOS POR MOVIMIENTO ──\n' +
'\n' +
'seq (number): secuencia desde 1\n' +
'\n' +
'tipoLinea (string): uno de estos valores:\n' +
'  "consumo"              → gasto en un solo pago (cuotaTotal=1)\n' +
'  "cuota"                → cuota de compra en cuotas (cuotaTotal>1)\n' +
'  "impuesto"             → percepción o impuesto (IIBB, IVA RG, DB.RG, PERCEPCION)\n' +
'  "reintegro_percepcion" → devolución de percepción (DEV.IMP, CR.RG, DEV PER, CAJA SEG-PROMO)\n' +
'  "bonificacion"         → descuento explícito (BONIF. CONSUMO ...)\n' +
'  "reverso"              → anulación de consumo previo (monto negativo en sección de consumos)\n' +
'\n' +
'fechaConsumo (string|null): fecha en formato YYYY-MM-DD.\n' +
'  - Para percepciones sin fecha propia, usar la fechaCierre del resumen.\n' +
'  - Para devoluciones en el CONSOLIDADO (CR.RG, DEV PER), usar la fecha que aparece en esa línea.\n' +
'  - Las fechas del PDF vienen en formato DD-MM-YY o DD-MM-AAAA; convertir a YYYY-MM-DD.\n' +
'\n' +
'descripcionRaw (string): descripción limpia del comercio o concepto.\n' +
'  REGLAS DE LIMPIEZA:\n' +
'  • BBVA cuotas: quitar el sufijo " C.XX/YY" al final\n' +
'    (ej: "LAS MARGARITAS C.02/03" → "LAS MARGARITAS")\n' +
'  • BBVA consumos USD: quitar "USD X,XX" o "USD X.XX" de la descripción\n' +
'    (ej: "PLAYSTATION USD 9,99" → "PLAYSTATION";\n' +
'         "NETFLIX.COM EaDrY5hBOUSD 14,34" → "NETFLIX.COM EaDrY5hBOH";\n' +
'         "APPLE.COM/BILL USD 6,99" → "APPLE.COM/BILL")\n' +
'  • Galicia Visa consumos USD: la descripción termina con el código de sesión y el monto USD\n' +
'    (ej: "AMAZON PRIME*5B5 1VaRjv8EhUSD" → "AMAZON PRIME*5B5 1VaRjv8Eh";\n' +
'         el monto USD aparece como número en la misma línea)\n' +
'  • No modificar el resto de la descripción; preservar mayúsculas como están\n' +
'\n' +
'nroCupon (string): número de cupón/comprobante. Vacío si no hay.\n' +
'\n' +
'cuotaActual (number): número de cuota actual. 0 si no aplica, 1 si es un solo pago.\n' +
'cuotaTotal (number): total de cuotas. 0 si no aplica, 1 si es un solo pago.\n' +
'  DETECCIÓN DE CUOTAS:\n' +
'  • BBVA: el sufijo " C.XX/YY" en la descripción indica cuotaActual=XX, cuotaTotal=YY\n' +
'  • Galicia Visa: columna CUOTA explícita con formato "XX/YY"\n' +
'  • Galicia Master: sección "CUOTA DEL MES" o "CUOTAS DEL MES" + columna cuota "XX/YY"\n' +
'  • Si cuotaTotal=1 o no hay info de cuotas → tipoLinea="consumo", no "cuota"\n' +
'\n' +
'moneda (string): "ARS" o "USD".\n' +
'  Un movimiento es en USD si:\n' +
'  • El monto aparece en la columna DÓLARES (no en PESOS)\n' +
'  • La descripción contiene "USD X,XX" o el monto USD está separado\n' +
'\n' +
'monto (number): monto en la moneda indicada. SIEMPRE positivo.\n' +
'  (para bonificaciones y reversos el monto también es positivo;\n' +
'   el carácter negativo lo indica tipoLinea/esBonificacion/esReverso)\n' +
'  CONVERSIÓN: los números argentinos usan punto como miles y coma como decimal.\n' +
'  "1.447,94" → 1447.94   "301.393,73" → 301393.73   "9,99" → 9.99\n' +
'\n' +
'personaDetectada (string): nombre canónico (ver mapeos arriba). Vacío si no se puede determinar.\n' +
'  DETECCIÓN POR FORMATO:\n' +
'\n' +
'  BBVA (Visa y Mastercard):\n' +
'  El PDF tiene secciones tituladas "Consumos [Nombre Apellido]" o\n' +
'  "Consumos [Nombre] [Apellido]". Todos los movimientos bajo esa sección\n' +
'  son de esa persona, hasta que aparece la siguiente sección.\n' +
'  Ejemplo: bajo "Consumos Maria Lascano" → personaDetectada="María"\n' +
'\n' +
'  GALICIA VISA:\n' +
'  El detalle se divide en bloques cerrados por subtotales:\n' +
'  "TARJETA XXXX Total Consumos de NOMBRE APELLIDO"\n' +
'  Los movimientos ANTES de ese subtotal son de esa persona.\n' +
'  Ejemplo: si la línea "TARJETA 9318 Total Consumos de MARIA LASCANO" aparece\n' +
'  después de un bloque, todos los movimientos de ese bloque → personaDetectada="María".\n' +
'  Si hubiera movimientos antes del primer subtotal, son del titular principal.\n' +
'\n' +
'  GALICIA MASTERCARD:\n' +
'  El titular principal (la persona en el encabezado) tiene los consumos principales.\n' +
'  Los adicionales aparecen antes del subtotal "TOTAL ADICIONAL DE NOMBRE,APELLIDO".\n' +
'  Ejemplo: movimientos antes de "TOTAL ADICIONAL DE COFANO,JUAN" → personaDetectada="Juan".\n' +
'  Los movimientos del titular principal son los del bloque inicial.\n' +
'\n' +
'  PERCEPCIONES E IMPUESTOS: dejar personaDetectada = "" (vacío).\n' +
'\n' +
'esBonificacion (boolean): true solo si es un descuento explícito (BONIF. CONSUMO)\n' +
'esReverso (boolean): true solo si anula/revierte un consumo previo (monto negativo en consumos)\n' +
'esImpuesto (boolean): true si tipoLinea = "impuesto"\n' +
'esPagoAnterior (boolean): false siempre (los pagos no se incluyen)\n' +
'\n' +
'categoriaSugerida (string): categoría sugerida. DEBE ser una de estas ' + cats.length + ' (exacto):\n' +
'  ' + cats.join(', ') + '\n' +
'  Para percepciones/impuestos: "Impuestos y finanzas".\n' +
'  Para reintegros de percepciones: "Ingresos".\n' +
'\n' +
'subcategoriaSugerida (string): subcategoría libre, lo más específica posible.\n' +
'  Ejemplos: "Supermercado", "Delivery", "Farmacia", "Streaming",\n' +
'  "Nafta", "Peaje", "Colegio Fede", "Restaurante", "Cafetería".\n' +
'  Si no hay subdivisión útil, dejar vacío.\n' +
'\n' +
'═══════════════════════════════════════════════════════════\n' +
'DUPLICACIONES A EVITAR\n' +
'═══════════════════════════════════════════════════════════\n' +
'\n' +
'DEV PER RG 4815 30% en Galicia Master: aparece UNA SOLA VEZ en el\n' +
'  CONSOLIDADO. NO duplicar. Usar fechaCierre como fecha si no tiene fecha propia.\n' +
'\n' +
'Consumos en USD (ej PARAMOUNT+): aparecen UNA SOLA VEZ. El PDF puede mostrar\n' +
'  el monto ARS equivalente en la misma línea entre paréntesis (USA,ARS,1321.49).\n' +
'  Eso NO es un segundo movimiento — es la conversión. Generar UN solo movimiento\n' +
'  con moneda=USD y el monto en USD.\n' +
'\n' +
'═══════════════════════════════════════════════════════════\n' +
'CASOS ESPECIALES IMPORTANTES\n' +
'═══════════════════════════════════════════════════════════\n' +
'\n' +
'CR.RG 5617 en BBVA (sección "Sus pagos y ajustes realizados"):\n' +
'  → tipoLinea="reintegro_percepcion", monto positivo (ignorar signo negativo)\n' +
'  → fechaConsumo = fecha de la línea, personaDetectada = ""\n' +
'\n' +
'DEV.IMP. RG 5617 en Galicia Visa (sección CONSOLIDADO):\n' +
'  → tipoLinea="reintegro_percepcion", monto positivo\n' +
'\n' +
'DEV PER RG 4815 en Galicia Master:\n' +
'  → Si aparece en el CONSOLIDADO (entre SU PAGO y SALDO PENDIENTE)\n' +
'    con monto NEGATIVO: es del período anterior. EXCLUIR (igual que SU PAGO).\n' +
'  → Si aparece en el DETALLE DEL CONSUMO o como percepción del mes\n' +
'    con monto POSITIVO: es un reintegro del mes actual.\n' +
'    tipoLinea="reintegro_percepcion", monto positivo.\n' +
'\n' +
'PERCEPCIONES EN GALICIA MASTER (aparecen en el CONSOLIDADO, no en el detalle):\n' +
'  "PERCEPCION IVA DTO 354/18", "PERCEP.AFIP RG 4815 30%", "PERC IIBB SERV DIG CABA"\n' +
'  → tipoLinea="impuesto", esImpuesto=true\n' +
'  → fechaConsumo = fechaCierre del resumen\n' +
'\n' +
'CAJA SEG-PROMO en BBVA (aparece en la sección de consumos con monto positivo):\n' +
'  → tipoLinea="reintegro_percepcion", monto positivo\n' +
'\n' +
'4F SOLUCIONES y similares (monto negativo en consumos, cancela una compra previa):\n' +
'  → tipoLinea="reverso", esReverso=true, monto positivo (valor absoluto)\n' +
'\n' +
'BONIF. CONSUMO CABIFY y similares:\n' +
'  → tipoLinea="bonificacion", esBonificacion=true, monto positivo (valor absoluto)\n' +
'\n' +
'═══════════════════════════════════════════════════════════\n' +
'FORMATO DE RESPUESTA REQUERIDO\n' +
'═══════════════════════════════════════════════════════════\n' +
'\n' +
'Devolvé ÚNICAMENTE el JSON en un bloque ```json ... ```.\n' +
'No incluyas texto antes ni después del bloque.\n' +
'\n' +
'```json\n' +
'{\n' +
'  "resumen": {\n' +
'    "nroResumen": "...",\n' +
'    "banco": "...",\n' +
'    "tarjeta": "...",\n' +
'    "titular": "...",\n' +
'    "fechaCierre": "YYYY-MM-DD",\n' +
'    "fechaVencimiento": "YYYY-MM-DD",\n' +
'    "totalARS": 0.00,\n' +
'    "totalUSD": 0.00,\n' +
'    "pagoMinimoARS": 0.00,\n' +
'    "cuentaDebito": "..."\n' +
'  },\n' +
'  "movimientos": [\n' +
'    {\n' +
'      "seq": 1,\n' +
'      "tipoLinea": "consumo",\n' +
'      "fechaConsumo": "YYYY-MM-DD",\n' +
'      "descripcionRaw": "...",\n' +
'      "nroCupon": "...",\n' +
'      "cuotaActual": 1,\n' +
'      "cuotaTotal": 1,\n' +
'      "moneda": "ARS",\n' +
'      "monto": 0.00,\n' +
'      "personaDetectada": "",\n' +
'      "esBonificacion": false,\n' +
'      "esReverso": false,\n' +
'      "esImpuesto": false,\n' +
'      "esPagoAnterior": false,\n' +
'      "categoriaSugerida": "...",\n' +
'      "subcategoriaSugerida": "..."\n' +
'    }\n' +
'  ]\n' +
'}\n' +
'```';

}

/**
 * Calcula un hash SHA-256 del contenido base64 del PDF.
 * Se usa como identificador único del archivo para detectar duplicados.
 *
 * @param {string} pdfBase64
 * @returns {string} Hash hex de 64 caracteres
 */
function gf_calcularHashPDF_(pdfBase64) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    pdfBase64,
    Utilities.Charset.US_ASCII
  );
  return bytes.map(function(b) {
    return ('0' + (b & 0xff).toString(16)).slice(-2);
  }).join('');
}

/**
 * Verifica si el hashPDF ya existe en Tarjetas_Resumen.
 * Llamar ANTES de parsear con Claude API para evitar gasto de tokens innecesario.
 *
 * @param {string} hashPDF
 * @returns {{ duplicado: false } |
 *           { duplicado: true, resumenIDDup: string, resumen: {
 *               resumenID, tarjeta, banco, mesResumen,
 *               fechaCierre, fechaVencimiento, totalARS, totalUSD, estado, importadoPor
 *             }}}
 */
function gf_checkResumenDuplicado_(hashPDF) {
  if (!hashPDF) return { duplicado: false };

  var shRes = SpreadsheetApp.getActive().getSheetByName(GF.SHEET_TARJETAS_RESUMEN);
  if (!shRes || shRes.getLastRow() < 2) return { duplicado: false };

  var headers = shRes.getRange(1, 1, 1, shRes.getLastColumn()).getValues()[0];
  var idx = {};
  headers.forEach(function(h, i) { idx[String(h).trim()] = i; });

  if (idx['HashPDF'] === undefined) return { duplicado: false };

  var nRows = shRes.getLastRow() - 1;
  var data  = shRes.getRange(2, 1, nRows, shRes.getLastColumn()).getValues();
  var tz    = Session.getScriptTimeZone();

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (String(row[idx['HashPDF']] || '').trim() !== hashPDF) continue;

    var fmtDate = function(v) {
      if (!v) return '';
      if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      return String(v);
    };

    return {
      duplicado:    true,
      resumenIDDup: String(row[idx['ResumenID']] || ''),
      resumen: {
        resumenID:       String(row[idx['ResumenID']]      || ''),
        tarjeta:         String(row[idx['Tarjeta']]        || ''),
        banco:           String(row[idx['Banco']]          || ''),
        mesResumen:      String(row[idx['MesResumen']]     || ''),
        fechaCierre:     fmtDate(row[idx['FechaCierre']]),
        fechaVencimiento:fmtDate(row[idx['FechaVencimiento']]),
        totalARS:        Number(row[idx['TotalARS']]       || 0),
        totalUSD:        Number(row[idx['TotalUSD']]       || 0),
        estado:          String(row[idx['EstadoImport']]   || ''),
        importadoPor:    String(row[idx['ImportadoPor']]   || '')
      }
    };
  }

  return { duplicado: false };
}

/**
 * Detecta el código de tarjeta del catálogo a partir del banco y tarjeta
 * extraídos por Claude del PDF.
 *
 * @param {string} banco   Ej: "Galicia", "BBVA"
 * @param {string} tarjeta Ej: "Visa", "Mastercard Black"
 * @returns {string|null}  Código del catálogo (ej: 'GAL-MASTER-BLK') o null si no matchea
 */
function gf_detectarTarjetaCodigo_(banco, tarjeta) {
  var b = String(banco   || '').trim().toUpperCase();
  var t = String(tarjeta || '').trim().toUpperCase();
  if (!b && !t) return null;

  for (var i = 0; i < GF_TARJETAS_CATALOGO.length; i++) {
    var cat       = GF_TARJETAS_CATALOGO[i];
    var catBanco  = String(cat[1] || '').trim().toUpperCase();
    var catTarjeta= String(cat[2] || '').trim().toUpperCase();
    var bancoOk   = b && (b.indexOf(catBanco)  !== -1 || catBanco.indexOf(b)  !== -1);
    var tarjetaOk = t && (t.indexOf(catTarjeta) !== -1 || catTarjeta.indexOf(t) !== -1);
    if (bancoOk && tarjetaOk) return cat[0];
  }
  return null;
}
