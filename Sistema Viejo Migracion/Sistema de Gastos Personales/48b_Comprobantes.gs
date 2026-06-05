/**************************************
 * 48b_Comprobantes.gs
 * Parsea comprobantes y facturas con Claude API y guarda en Historico.
 * Un solo gasto por PDF (a diferencia del importador de tarjetas).
 *
 * Funciones públicas:
 *   api_parsearComprobante(params)   — parsea y devuelve datos al frontend
 *   api_guardarComprobante(params)   — guarda directo en Historico
 *
 * Helpers privados:
 *   gf_parsearComprobante_(pdfBase64)
 *   gf_buildComprobantePrompt_()
 **************************************/

/**
 * Llama a Claude API con un archivo (PDF o imagen) y devuelve el texto de respuesta.
 * - PDF   → content block tipo 'document' + header anthropic-beta pdfs
 * - Imagen → content block tipo 'image', sin header beta
 *
 * @param {string} base64
 * @param {string} mimeType  'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'
 * @param {string} promptText
 * @param {string} apiKey
 * @returns {string}
 */
function gf_llamarClaudeConArchivo_(base64, mimeType, promptText, apiKey) {
  const mime = String(mimeType || 'application/pdf').toLowerCase();
  const isPdf = mime === 'application/pdf';

  const fileBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image',    source: { type: 'base64', media_type: mime,               data: base64 } };

  const payload = {
    model:      GF_CLAUDE_MODEL_PDF,
    max_tokens: GF_CLAUDE_MAX_TOKENS,
    messages: [{
      role: 'user',
      content: [fileBlock, { type: 'text', text: promptText }]
    }]
  };

  const headers = {
    'x-api-key':         apiKey,
    'anthropic-version': GF_CLAUDE_API_VERSION
  };
  if (isPdf) headers['anthropic-beta'] = GF_CLAUDE_BETA_PDFS;

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
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
 * Parsea un archivo (PDF o imagen) con Claude y devuelve los datos estructurados.
 * NO escribe nada en el Sheet.
 *
 * @param {string} fileBase64
 * @param {string} [mimeType]  default 'application/pdf'
 * @returns {{
 *   tipoDocumento:       string,
 *   descripcion:         string,
 *   fecha:               string,   // YYYY-MM-DD — fecha de pago o vencimiento
 *   fechaEmision:        string,   // YYYY-MM-DD — fecha del documento
 *   monto:               number,
 *   moneda:              string,
 *   pagado:              boolean,
 *   persona:             string,
 *   categoriaSugerida:    string,
 *   subcategoriaSugerida: string,
 *   notas:                string,
 *   numeroComprobante:    string|null
 * }}
 */
function gf_parsearComprobante_(fileBase64, mimeType) {
  const apiKey = gf_getAnthropicKey_();
  const prompt = gf_buildComprobantePrompt_();

  Logger.log('gf_parsearComprobante_: llamando Claude API... mimeType=' + (mimeType || 'application/pdf'));
  const responseText = gf_llamarClaudeConArchivo_(fileBase64, mimeType || 'application/pdf', prompt, apiKey);

  const mdMatch  = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  const rawMatch = responseText.match(/(\{[\s\S]*\})/);
  const jsonStr  = mdMatch ? mdMatch[1] : (rawMatch ? rawMatch[1] : null);

  if (!jsonStr) {
    throw new Error('Claude no devolvió JSON válido.\nResponse: ' + responseText.substring(0, 300));
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch(e) {
    throw new Error('JSON inválido de Claude: ' + e.message);
  }

  Logger.log('gf_parsearComprobante_ OK: ' + parsed.tipoDocumento + ' $' + parsed.monto);
  return parsed;
}

/**
 * Endpoint público: parsea un archivo (PDF o imagen) y devuelve los datos para el frontend.
 * El usuario los revisa/edita antes de confirmar.
 *
 * @param {{ pdfBase64: string, mimeType?: string }} params
 * @returns {{ ok: boolean, data: Object, error?: string }}
 */
function api_parsearComprobante(params) {
  try {
    requireUser_();
    if (!params || !params.pdfBase64) throw new Error('pdfBase64 requerido');

    const data = gf_parsearComprobante_(params.pdfBase64, params.mimeType || 'application/pdf');

    // Lookup server-side: enriquece data con campos de GastosEsperados/IngresosEsperados
    // (Banco, Persona, Etiqueta, Moneda canónicos) para pre-rellenar el form en el frontend.
    // Usa data.persona como personaHint para desambiguar filas con misma cat+subcat.
    var _esp = gf_gastosEsperados_lookup_(
      data.categoriaSugerida    || '',
      data.subcategoriaSugerida || '',
      data.persona              || ''
    );
    if (_esp) data.esperado = _esp;

    // Si Claude no detectó número real, intentar pseudo-id para recurrentes mensuales.
    // Ahora que data.esperado ya fue resuelto, podemos incluir la etiqueta canónica
    // en el id → distingue "2026-05-Sueldo-JuanARS" de "2026-05-Sueldo-MariaARS".
    if (!data.numeroComprobante) {
      var pCat  = String(data.categoriaSugerida    || '').trim();
      var pSub  = String(data.subcategoriaSugerida || '').trim();
      var pEtiq = (data.esperado && data.esperado.etiqueta)
                  ? String(data.esperado.etiqueta).trim()
                  : '';
      if (gf_esRecurrenteUnicaAlMes_(pCat, pSub)) {
        data.numeroComprobante = gf_generarPseudoNumero_(data.fecha, pSub, pEtiq, data.monto);
      }
    }

    if (data.numeroComprobante) {
      var duplicado = gf_buscarComprobanteDuplicado_(data.numeroComprobante);
      if (duplicado) data.duplicado = duplicado;
    }

    return { ok: true, data: data };

  } catch(e) {
    Logger.log('api_parsearComprobante ERROR: ' + e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Endpoint público: guarda el comprobante directamente en Historico.
 * Recibe los datos ya revisados y editados por el usuario desde el frontend.
 *
 * @param {{
 *   descripcion:   string,   (obligatorio)
 *   fecha:         string,   YYYY-MM-DD (obligatorio)
 *   monto:         number,   (obligatorio)
 *   banco:         string,   (obligatorio)
 *   moneda?:       string,   default 'ARS'
 *   persona?:      string,
 *   categoria?:    string,
 *   subcategoria?: string,
 *   etiqueta?:     string,
 *   pagado?:       boolean,  default false
 *   notas?:        string
 * }} params
 * @returns {{ ok: boolean, mensaje?: string, error?: string }}
 */
function api_guardarComprobante(params) {
  try {
    requireUser_();
    if (!params)             throw new Error('params requerido');
    if (!params.descripcion) throw new Error('descripcion requerido');
    if (!params.fecha)       throw new Error('fecha requerido');
    if (!params.monto)       throw new Error('monto requerido');
    if (!params.banco)       throw new Error('banco requerido');

    const bancoNorm = gf_normalizarBanco_(params.banco);
    if (!bancoNorm) throw new Error('Banco inválido: ' + params.banco +
      '. Válidos: ' + GF_BANCOS_VALIDOS.join(', '));

    // Para recurrentes mensuales: regenerar pseudo-id con la etiqueta confirmada por el usuario.
    // /^\d{4}-\d{2}-/ detecta ids generados por gf_generarPseudoNumero_ vs números reales.
    var _numComp = params.numeroComprobante || '';
    if (gf_esRecurrenteUnicaAlMes_(params.categoria || '', params.subcategoria || '')) {
      if (!_numComp || /^\d{4}-\d{2}-/.test(_numComp)) {
        params.numeroComprobante = gf_generarPseudoNumero_(
          params.fecha, params.subcategoria || '', params.etiqueta || '', params.monto);
      }
    }

    const ss     = SpreadsheetApp.getActive();
    const shHist = ss.getSheetByName(GF.SHEET_HIST);
    if (!shHist) throw new Error('Hoja Historico no encontrada');

    const headers = shHist.getRange(1, 1, 1, shHist.getLastColumn()).getValues()[0];
    const iHist   = {};
    headers.forEach(function(h, i) { iHist[String(h).trim()] = i; });

    const now    = new Date();
    const usuario = Session.getActiveUser().getEmail() || 'WebApp';
    const fecha  = gf_parseDate_(params.fecha);
    if (!fecha)  throw new Error('Fecha inválida: ' + params.fecha);

    const mes = yyyymm_(fecha);
    const dia = fecha.getDate();

    const row = new Array(headers.length).fill('');
    var set = function(col, val) {
      if (iHist[col] !== undefined && val !== undefined && val !== null) row[iHist[col]] = val;
    };

    set('ID',             newId_('HIS'));
    set('ParentID',       '');
    var esIngreso = gf_esIngreso_(params.categoria);
    set('Tipo',           esIngreso ? 'Ingreso' : 'Gasto');
    set('Subtipo',        'EventualDirecto');
    set('Origen',         'WebApp');
    set('Persona',        params.persona      || '');
    set('Descripción',    params.descripcion);
    set('Categoría',      params.categoria    || '');
    set('Subcategoria',   params.subcategoria || '');
    set('Etiqueta',       params.etiqueta     || '');
    set('Banco',          bancoNorm);
    set('Cuenta',         '');
    set('Moneda',         params.moneda       || 'ARS');
    set('Monto',          Number(params.monto));
    set('Día',            dia);
    set('Fecha',          fecha);
    set('Pagado',         !!params.pagado);
    set('FlagResumenMes', esIngreso ? false : !params.pagado);
    set('ExcluirDash',    false);
    set('EstadoRegistro', 'Registrado');
    set('Usuario',        usuario);
    set('Notas',              params.notas              || '');
    set('NumeroComprobante',  params.numeroComprobante  || '');
    set('Mes',                mes);
    set('CreatedAt',      now);
    set('UpdatedAt',      now);

    shHist.appendRow(row);

    Logger.log('api_guardarComprobante: OK — ' + params.descripcion + ' $' + params.monto);
    SpreadsheetApp.getActive().toast(
      params.descripcion + ' — $' + Number(params.monto).toLocaleString('es-AR'),
      'Comprobante guardado', 6
    );
    return { ok: true, mensaje: 'Guardado en Historico' };

  } catch(e) {
    Logger.log('api_guardarComprobante ERROR: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ── Prompt ────────────────────────────────────────────────────────────────────

function gf_buildComprobantePrompt_() {
  var cats = gf_getDiccionarioValores_('Categoria');
  if (!cats.length) cats = ['Casa','Auto','Alimentación cotidiana','Salidas','Vacaciones y viajes','Salud','Educación y chicos','Personal','Indumentaria','Impuestos y finanzas','Transporte general','Tarjetas','Ingresos'];
  return (
    'Sos un extractor de datos de comprobantes y facturas argentinas.\n' +
    'Leé el documento o imagen adjunto y devolvé ÚNICAMENTE un bloque JSON válido (envuelto en ```json ... ```).\n' +
    '\n' +
    'PERSONAS DEL HOGAR (usá estos valores exactos en el campo "persona"):\n' +
    '  "COFANO JUAN PABLO", "Juan Pablo Cofano", "COFANO, JUAN PABLO" → "Juan"\n' +
    '  "LASCANO MARIA", "LASCANO, MARIA", "Maria Lascano"            → "María"\n' +
    '  "COFANO LASCANO, SOFIA INES", "Sofia Cofano"                  → "Sofía"\n' +
    '  "COFANO LASCANO, FEDERICO NICOLAS", "Federico Cofano"         → "Federico"\n' +
    '\n' +
    'TIPOS DE DOCUMENTO:\n' +
    '  "comprobante_pago"  → comprobante de transferencia/pago ya realizado\n' +
    '                        (Mercado Pago, homebanking, etc.)\n' +
    '  "factura"           → factura de colegio, servicio profesional, etc.\n' +
    '  "expensas"          → liquidación de expensas de consorcio\n' +
    '  "abl"               → boleta de ABL / Impuesto Inmobiliario\n' +
    '  "otro"              → cualquier otro tipo\n' +
    '\n' +
    '══════════════════════════════════\n' +
    'CLASIFICACIÓN DEL DOCUMENTO — PRIMER PASO\n' +
    '══════════════════════════════════\n' +
    '\n' +
    'ANTES de extraer cualquier fecha, identificá tipoDocumento con esta\n' +
    'jerarquía. Esta clasificación es CRÍTICA porque determina cómo se\n' +
    'interpreta el campo `fecha` y el campo `pagado`.\n' +
    '\n' +
    '· comprobante_pago: el documento muestra un pago YA EFECTUADO. Indicadores:\n' +
    '    - Texto explícito: "PAGADO", "OPERACIÓN APROBADA", "PAGO REALIZADO",\n' +
    '      "Comprobante de pago", "Comprobante de operación", "Pago confirmado",\n' +
    '      "Transferencia exitosa", "Operación exitosa".\n' +
    '    - Origen típico: Mercado Pago, ModoBank, Cuenta DNI, Naranja X, Ualá,\n' +
    '      transferencias bancarias confirmadas (BBVA, Galicia, Personal Pay),\n' +
    '      app del banco.\n' +
    '    - Estructura: muestra un pago concreto con fecha, monto y destinatario,\n' +
    '      no una deuda pendiente.\n' +
    '\n' +
    '· factura: liquidación de un proveedor de servicios o producto que está\n' +
    '    PENDIENTE de pago.\n' +
    '    - Origen típico: Edenor, Edesur, Naturgy, Metrogas, AySA, Telecentro,\n' +
    '      Movistar, Personal, Claro, ARCA/AFIP.\n' +
    '    - Estructura: tiene fecha de emisión, período facturado, monto a pagar,\n' +
    '      y fecha de vencimiento. NO dice "PAGADO".\n' +
    '\n' +
    '· expensas: liquidación mensual del consorcio del edificio.\n' +
    '    - Origen típico: administraciones (Cofano, etc.). Tiene tabla de\n' +
    '      prorrateo por unidad funcional.\n' +
    '    - Estructura: período del mes, total del consorcio, total a pagar por\n' +
    '      la unidad, fecha de vencimiento.\n' +
    '\n' +
    '· abl: impuesto inmobiliario o ABL (Alumbrado, Barrido y Limpieza).\n' +
    '    - Origen típico: AGIP (CABA), ARBA (PBA), municipios.\n' +
    '    - Estructura: cuotas, primer y segundo vencimiento, monto a pagar.\n' +
    '\n' +
    '· otro: cualquier documento que no encaja en los anteriores.\n' +
    '\n' +
    'REGLA DE ORO: un mismo PDF nunca puede ser DOS tipos a la vez. Si dudás\n' +
    'entre comprobante_pago y factura, ganá comprobante_pago únicamente cuando\n' +
    'veas indicadores explícitos de PAGO YA EFECTUADO (texto "PAGADO",\n' +
    '"APROBADA", "EXITOSA"). Si solo hay un monto a pagar y una fecha de\n' +
    'vencimiento, es factura, no comprobante_pago.\n' +
    '\n' +
    '══════════════════════════════════\n' +
    'REGLAS POR TIPO DE DOCUMENTO\n' +
    '══════════════════════════════════\n' +
    '\n' +
    'comprobante_pago:\n' +
    '  · fecha    = fecha en que se realizó el pago\n' +
    '               (ej: "Sábado, 11 de abril de 2026" → "2026-04-11")\n' +
    '  · pagado   = true\n' +
    '  · descripcion = nombre del destinatario o comercio\n' +
    '  · persona  = quien realizó el pago (campo "De")\n' +
    '\n' +
    'factura:\n' +
    '  · fecha    = fecha de VENCIMIENTO — la fecha límite para pagar sin recargo.\n' +
    '               Buscá: "Fecha Vto", "Vto.", "Vencimiento", "Fecha Vto. CAE",\n' +
    '               "1er vencimiento", "Primer vencimiento", "Vto 1",\n' +
    '               "pague hasta", "abone hasta", "válido hasta".\n' +
    '               Si el PDF tiene PRIMER y SEGUNDO vencimiento, usá siempre el\n' +
    '               PRIMER vencimiento (la fecha más temprana de las dos).\n' +
    '               NO uses: fecha de emisión, fecha del documento, fecha del\n' +
    '               período facturado, ni el rango del período (ej: "01/03 al 31/03").\n' +
    '  · pagado   = false\n' +
    '  · descripcion = nombre del emisor + concepto breve + período\n' +
    '               (ej: "Colegio Guadalupe - Sofía - Abril 2026")\n' +
    '  · monto    = total de la factura (campo "TOTAL" o "Total")\n' +
    '  · persona  = alumno/responsable si se puede determinar\n' +
    '\n' +
    'expensas:\n' +
    '  · Buscá la fila de la tabla de prorrateo que corresponda a "COFANO, JUAN PABLO"\n' +
    '    o "Cofano, Juan Pablo".\n' +
    '  · monto    = columna "Total a Pagar" de ESA FILA (no el total general del consorcio)\n' +
    '  · fecha    = fecha de VENCIMIENTO del período.\n' +
    '               Buscá: "Vencimiento", "Fecha límite de pago", "Pague antes del",\n' +
    '               "Vto.", "1er vencimiento". Suele estar destacada en el encabezado.\n' +
    '               NO uses: fecha de emisión de la liquidación ni el período\n' +
    '               facturado (ej: "Feb 2026").\n' +
    '  · pagado   = false\n' +
    '  · descripcion = "Expensas " + nombre del consorcio + " - " + período\n' +
    '               (ej: "Expensas Pje del Signo - Feb 2026")\n' +
    '  · persona  = "Juan"\n' +
    '\n' +
    'abl:\n' +
    '  · fecha    = PRIMER vencimiento (campo "1° VTO", "1er VTO",\n' +
    '               "Primer vencimiento"). Si hay dos columnas de vencimiento,\n' +
    '               usá la primera (la más temprana). NO uses la fecha de\n' +
    '               emisión ni la fecha del período.\n' +
    '  · monto    = SALDO A PAGAR (el monto con descuentos por pago a término ya aplicados)\n' +
    '  · pagado   = false\n' +
    '  · descripcion = "ABL " + dirección + " - Cuota " + nro + "/" + año\n' +
    '               (ej: "ABL Del Signo 4032 - Cuota 04/2026")\n' +
    '  · persona  = titular del inmueble\n' +
    '\n' +
    '══════════════════════════════════\n' +
    'IDENTIFICACIÓN DE FECHAS — REGLA GENERAL\n' +
    '══════════════════════════════════\n' +
    '\n' +
    'Palabras clave que indican VENCIMIENTO (campo `fecha` para factura/expensas/abl):\n' +
    '  "vencimiento", "vto", "vto.", "1° vto", "1er vto", "primer vencimiento",\n' +
    '  "fecha límite de pago", "pague hasta", "abone hasta", "válido hasta",\n' +
    '  "fecha de pago máxima".\n' +
    '  En facturas de servicios (luz, gas, internet, ABL, expensas), la fecha de\n' +
    '  vencimiento suele estar visualmente destacada (caja, recuadro, negritas,\n' +
    '  color diferente) y aparece cerca del nombre del cliente o el monto total.\n' +
    '\n' +
    'Palabras clave que indican EMISIÓN (→ campo `fechaEmision`, NO usar para `fecha`):\n' +
    '  "fecha de emisión", "emitido el", "fecha factura", "fecha del documento",\n' +
    '  "fecha de generación", "fecha impresión".\n' +
    '  El período facturado ("del 01/03 al 31/03") TAMPOCO es fecha de vencimiento.\n' +
    '\n' +
    'PARA tipoDocumento = "comprobante_pago":\n' +
    '  Las reglas de vencimiento NO aplican, aun cuando el comprobante mencione\n' +
    '  fechas de vencimiento del concepto que se está pagando\n' +
    '  (ej: "Pago de factura Edenor vto. 15/04 realizado el 12/04" → la fecha es\n' +
    '  12/04, no 15/04). El campo `fecha` SIEMPRE es la fecha del PAGO efectuado,\n' +
    '  no del concepto pagado. Buscá: "Fecha de pago", "Fecha operación",\n' +
    '  "Fecha de la transacción", "Realizado el", o la fecha principal y más\n' +
    '  destacada del comprobante.\n' +
    '  El campo `fechaEmision` queda null para comprobantes de pago (no aplica\n' +
    '  el concepto de "emisión" en un pago, solo en una factura).\n' +
    '\n' +
    '══════════════════════════════════\n' +
    'CAMPOS DEL JSON\n' +
    '══════════════════════════════════\n' +
    '\n' +
    'tipoDocumento (string): tipo según la lista de arriba\n' +
    '\n' +
    'descripcion (string): descripción clara y concisa del gasto\n' +
    '\n' +
    'fecha (string): YYYY-MM-DD\n' +
    '  · comprobante_pago → fecha en que se efectuó el pago ("Fecha de pago",\n' +
    '    "Fecha operación", o la fecha principal del comprobante).\n' +
    '  · factura / expensas / abl → fecha de VENCIMIENTO (ver sección\n' +
    '    IDENTIFICACIÓN DE FECHAS y las reglas por tipo). NUNCA la fecha de emisión.\n' +
    '  Si NO encontrás la fecha, devolvé null (el usuario la va a completar).\n' +
    '\n' +
    'fechaEmision (string|null): YYYY-MM-DD — fecha en que se EMITIÓ el documento.\n' +
    '  DISTINTA del campo `fecha` (que es vencimiento o pago).\n' +
    '  Buscá: "Fecha de emisión", "Emitido el", "Fecha factura", "Fecha del documento".\n' +
    '  Solo completar si está claramente identificable; si no, devolvé null.\n' +
    '  Para comprobante_pago: siempre null.\n' +
    '\n' +
    'monto (number): monto positivo sin símbolos ni separadores\n' +
    '  CONVERSIÓN: punto=miles, coma=decimal\n' +
    '  "18.000,00" → 18000   "147.498,43" → 147498.43   "66.797,63" → 66797.63\n' +
    '\n' +
    'moneda (string): "ARS" o "USD"\n' +
    '\n' +
    'pagado (boolean): true si el pago ya fue realizado, false si está pendiente\n' +
    '\n' +
    'persona (string): nombre canónico según el mapeo de arriba. "" si no se puede determinar.\n' +
    '\n' +
    'categoriaSugerida (string): categoría del gasto. DEBE ser una de estas ' + cats.length + ' (exacto):\n' +
    '  ' + cats.join(', ') + '\n' +
    '\n' +
    'subcategoriaSugerida (string): subcategoría específica.\n' +
    '  Ejemplos: Educación y chicos→"Colegio Sofi"; Casa→"Expensas";\n' +
    '  Casa→"ABL"; Impuestos y finanzas→"Percepciones tarjeta".\n' +
    '  Dejar vacío si no hay subdivisión útil.\n' +
    '\n' +
    'notas (string): info adicional (período, cuota, etc.)\n' +
    '\n' +
    'numeroComprobante (string|null): número de factura, recibo, o liquidación.\n' +
    '  Buscar campos como "Nro", "Comprobante Nro", "N° Factura", "Recibo N°",\n' +
    '  "Liquidación N°", "Comprobante", "Op. N°", etc.\n' +
    '  Ejemplos: "0001-00045678", "REC-2026-04-001", "A-0003-00012345".\n' +
    '  Si no encontrás un número identificable, devolvé null.\n' +
    '\n' +
    '══════════════════════════════════\n' +
    'FORMATO DE RESPUESTA\n' +
    '══════════════════════════════════\n' +
    '\n' +
    'Devolvé ÚNICAMENTE el JSON en un bloque ```json ... ```. Sin texto antes ni después.\n' +
    '\n' +
    '```json\n' +
    '{\n' +
    '  "tipoDocumento": "...",\n' +
    '  "descripcion": "...",\n' +
    '  "fecha": "YYYY-MM-DD",\n' +
    '  "fechaEmision": "YYYY-MM-DD",\n' +
    '  "monto": 0.00,\n' +
    '  "moneda": "ARS",\n' +
    '  "pagado": false,\n' +
    '  "persona": "...",\n' +
    '  "categoriaSugerida": "...",\n' +
    '  "subcategoriaSugerida": "...",\n' +
    '  "notas": "...",\n' +
    '  "numeroComprobante": "..."\n' +
    '}\n' +
    '```'
  );
}

/**
 * Construye un mapa {cat|subcat: true} con los gastos/ingresos esperados únicos por mes.
 * Excluye Tarjetas (tienen su propio flujo de deduplicación).
 */
function gf_buildWhitelistRecurrentes_() {
  var mapa = {};
  var ss = SpreadsheetApp.getActive();
  var sheets = [GF.SHEET_GASTOS_ESPERADOS, GF.SHEET_INGRESOS_ESPERADOS];
  for (var si = 0; si < sheets.length; si++) {
    var sh = ss.getSheetByName(sheets[si]);
    if (!sh || sh.getLastRow() < 2) continue;
    var rows = gf_readObjectsFromSheet_(sh);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!gf_boolOrDefault_(r['Activo'], false)) continue;
      var cat = String(r['Categoria'] || r['Categoría'] || '').trim();
      var sub = String(r['Subcategoria'] || '').trim();
      if (!cat || !sub) continue;
      if (cat === 'Tarjetas') continue;
      mapa[cat.toLowerCase() + '|' + sub.toLowerCase()] = true;
    }
  }
  return mapa;
}

/**
 * Devuelve true si cat+subcat es un gasto/ingreso esperado mensual único.
 * Usa CacheService (TTL 5 min) para no leer el sheet en cada llamada.
 */
function gf_esRecurrenteUnicaAlMes_(cat, subcat) {
  if (!cat && !subcat) return false;
  var clave = (cat    || '').trim().toLowerCase() + '|' +
              (subcat || '').trim().toLowerCase();
  var cache    = CacheService.getScriptCache();
  var cacheKey = 'GF_whitelist_recurrentes_v1';
  var cached   = cache.get(cacheKey);
  var mapa;
  if (cached) {
    try { mapa = JSON.parse(cached); } catch(e) { mapa = null; }
  }
  if (!mapa) {
    mapa = gf_buildWhitelistRecurrentes_();
    try { cache.put(cacheKey, JSON.stringify(mapa), 300); } catch(e) {}
  }
  return !!mapa[clave];
}

/**
 * Genera un pseudo-número de comprobante determinista para recurrentes mensuales.
 * Formato: YYYY-MM-{subcat}[-{etiq}]-{monto}
 * El prefijo YYYY-MM- sirve como señal para distinguirlo de números reales.
 */
function gf_generarPseudoNumero_(fechaStr, subcat, etiq, monto) {
  var prefix = String(fechaStr || '').substring(0, 7);
  if (!prefix || prefix.length < 7) {
    prefix = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  }
  var subKey = String(subcat || '').trim().replace(/\s+/g, '_') || 'sin_subcategoria';
  var base = prefix + '-' + subKey;
  if (etiq && etiq.trim()) base += '-' + etiq.trim().replace(/\s+/g, '_');
  var montoKey = gf_formatearMontoPseudoNumero_(monto);
  if (montoKey) base += '-' + montoKey;
  return base;
}

function gf_formatearMontoPseudoNumero_(monto) {
  var n = Number(monto);
  if (!isFinite(n)) return '';
  return (Math.round(n * 100) / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace('.', '_');
}

function gf_buscarComprobanteDuplicado_(numeroComprobante) {
  if (!numeroComprobante) return null;
  var buscar = String(numeroComprobante).trim().toLowerCase();
  if (!buscar) return null;

  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(GF.SHEET_HIST);
  if (!sh || sh.getLastRow() < 2) return null;

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var iHist = {};
  headers.forEach(function(h, i) { iHist[String(h).trim()] = i; });

  if (iHist['NumeroComprobante'] === undefined) return null;

  var data = sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues();
  for (var i = 0; i < data.length; i++) {
    var val = String(data[i][iHist['NumeroComprobante']] || '').trim().toLowerCase();
    if (val !== buscar) continue;
    return {
      fecha:        data[i][iHist['Fecha']] instanceof Date
                      ? Utilities.formatDate(data[i][iHist['Fecha']], Session.getScriptTimeZone(), 'yyyy-MM-dd')
                      : String(data[i][iHist['Fecha']] || ''),
      monto:        Number(data[i][iHist['Monto']]      || 0),
      categoria:    String(data[i][iHist['Categoría']]  || ''),
      subcategoria: String(data[i][iHist['Subcategoria']]|| ''),
      descripcion:  String(data[i][iHist['Descripción']]|| '')
    };
  }
  return null;
}
