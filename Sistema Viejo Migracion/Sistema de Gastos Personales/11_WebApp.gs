/**************************************
 * 11_WebApp.gs
 * - doGet liviano
 * - doPost para share temporal
 * - sin setup automático
 * - endpoints de lectura para el front
 **************************************/

function doGet(e) {
  try {
    const view = gf_web_getView_(e);
    const urlParams = (e && e.parameter) ? e.parameter : {};

    // doGet NO llama setup
    // solo intenta renderizar HTML existente
    return gf_web_renderView_(view, urlParams);
  } catch (err) {
    gf_logError_('doGet', err);
    return HtmlService
      .createHtmlOutput(
        '<h3>Error al abrir la WebApp</h3>' +
        `<pre>${gf_web_escapeHtml_(err.message || String(err))}</pre>`
      )
      .setTitle('Gastos Familia');
  }
}

function doPost(e) {
  try {
    const action = gf_web_getAction_(e);
    Logger.log('[doPost] action=%s', action);

    switch (action) {
      case 'share-upload':
        return gf_web_handleShareUploadPost_(e);

      case 'share-upload-form':
        Logger.log('[doPost] entrando a share-upload-form');
        return gf_web_handleShareUploadFormPost_(e);

      default:
        Logger.log('[doPost] accion no reconocida: %s', action);
        return gf_web_jsonOutput_({
          ok: false,
          error: `Acción POST no soportada: ${action || '(vacía)'}`,
          action: action || ''
        });
    }
  } catch (err) {
    Logger.log('[doPost] ERROR: %s', err.message || String(err));
    gf_logError_('doPost', err);
    return gf_web_jsonOutput_({
      ok: false,
      error: err.message || String(err)
    });
  }
}

function gf_web_handleShareUploadPost_(e) {
  if (typeof gf_share_handleUploadRequest_ !== 'function') {
    throw new Error('Falta gf_share_handleUploadRequest_. Agregá el módulo de share temporal antes de usar este endpoint.');
  }

  const request = gf_web_readPostPayload_(e);
  const responseMode = String(request.responseMode || request.response_mode || 'redirect').trim().toLowerCase();
  const source = String(request.source || request.shareSource || 'firebase-pwa').trim() || 'firebase-pwa';

  const result = gf_share_handleUploadRequest_(request);
  const ok = !!(result && result.ok);

  if (responseMode === 'json') {
    return gf_web_jsonOutput_(result || { ok: false, error: 'Respuesta vacía del handler share-upload.' });
  }

  return gf_web_buildSharePostResponseHtml_(ok ? null : (result && result.error), {
    ok: ok,
    route: ok ? String(result.route || request.route || 'comprobantes') : String(request.route || 'comprobantes'),
    shareToken: ok ? String(result.shareToken || '') : '',
    source: source,
    title: ok ? 'Abriendo archivo compartido…' : 'No pude abrir el archivo compartido'
  });
}

function gf_web_getView_(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  return String(p.view || p.v || 'index').trim().toLowerCase();
}

function gf_web_getAction_(e) {
  const p = (e && e.parameter) ? e.parameter : {};

  if (p.action != null && String(p.action).trim()) {
    return String(p.action).trim().toLowerCase();
  }

  const body = gf_web_tryReadJsonBody_(e);
  if (body && body.action != null && String(body.action).trim()) {
    return String(body.action).trim().toLowerCase();
  }

  return '';
}

function gf_web_renderView_(view, urlParams) {
  urlParams = urlParams || {};
  const candidates = gf_web_getHtmlCandidates_(view);
  Logger.log('[renderView] view=%s candidates=%s token=%s', view, candidates.join(','), urlParams.shareToken || '');

  for (let i = 0; i < candidates.length; i++) {
    const fileName = candidates[i];
    try {
      Logger.log('[renderView] intentando archivo: %s', fileName);
      const tpl = HtmlService.createTemplateFromFile(fileName);
      Logger.log('[renderView] template creado OK');

      Logger.log('[renderView] llamando safeBootstrap...');
      tpl.bootstrap = gf_web_safeBootstrap_();
      Logger.log('[renderView] bootstrap OK');

      tpl.viewName = view;
      tpl.urlParams = urlParams;
      try { tpl.webAppBaseUrl = ScriptApp.getService().getUrl(); } catch (_) { tpl.webAppBaseUrl = ''; }
      tpl.shareContext = {
        hasShareToken: !!(urlParams.shareToken),
        shareToken: String(urlParams.shareToken || ''),
        shareSource: String(urlParams.shareSource || '')
      };
      Logger.log('[renderView] shareContext.hasShareToken=%s', tpl.shareContext.hasShareToken);

      Logger.log('[renderView] llamando tpl.evaluate...');
      const output = tpl.evaluate()
        .setTitle('Gastos Familia')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
      Logger.log('[renderView] evaluate OK, devolviendo output');
      return output;
    } catch (e) {
      Logger.log('[renderView] ERROR en %s: %s', fileName, e.message || String(e));
      try { gf_logError_('gf_web_renderView_[' + fileName + ']', e); } catch (_) {}
    }
  }

  Logger.log('[renderView] todos los candidatos fallaron, devolviendo fallback');
  return HtmlService
    .createHtmlOutput(gf_web_buildFallbackHtml_(view))
    .setTitle('Gastos Familia')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function gf_web_getHtmlCandidates_(view) {
  const base = {
    index: ['Index', 'index', 'WebApp', 'app'],
    manual: ['Manual', 'manual', 'Index', 'index'],
    dashboard: ['Dashboard', 'dashboard', 'Index', 'index'],
    tarjetas: ['Tarjetas', 'tarjetas'],
    comprobantes: ['Comprobantes', 'comprobantes'],
    resumen: ['Resumen', 'resumen']
  };

  return base[view] || ['Index', 'index', 'WebApp', 'app'];
}

function gf_web_safeBootstrap_() {
  try {
    return gf_web_getBootstrap_();
  } catch (e) {
    gf_logError_('gf_web_safeBootstrap_', e);
    return {
      ok: false,
      error: e.message || String(e),
      mesActual: '',
      usuario: '',
      diccionario: {
        categorias: [],
        subcategorias: [],
        etiquetas: []
      }
    };
  }
}

function gf_web_buildFallbackHtml_(view) {
  const b = gf_web_safeBootstrap_();
  const mes = gf_web_escapeHtml_(b.mesActual || '');
  const usuario = gf_web_escapeHtml_(b.usuario || '');
  const error = b.ok ? '' : `<p style="color:#b91c1c;">${gf_web_escapeHtml_(b.error || '')}</p>`;

  return `
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
          .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; max-width: 720px; }
          h2 { margin-top: 0; }
          .muted { color: #6b7280; }
          code { background: #f3f4f6; padding: 2px 6px; border-radius: 6px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Gastos Familia</h2>
          <p class="muted">Vista: <code>${gf_web_escapeHtml_(view)}</code></p>
          <p><strong>Mes actual:</strong> ${mes || '(vacío)'}</p>
          <p><strong>Usuario:</strong> ${usuario || '(sin usuario)'}</p>
          ${error}
          <p class="muted">
            No encontré un archivo HTML para renderizar esta vista.
            La capa servidor está activa y lista para conectarse al front.
          </p>
        </div>
      </body>
    </html>
  `;
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function gf_web_escapeHtml_(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function gf_web_jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj || {}))
    .setMimeType(ContentService.MimeType.JSON);
}

function gf_web_tryReadJsonBody_(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return null;
    const raw = String(e.postData.contents || '').trim();
    if (!raw) return null;
    if (raw[0] !== '{' && raw[0] !== '[') return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function gf_web_readPostPayload_(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const named = (e && e.parameters) ? e.parameters : {};
  const jsonBody = gf_web_tryReadJsonBody_(e);

  if (jsonBody && typeof jsonBody === 'object' && !Array.isArray(jsonBody)) {
    return jsonBody;
  }

  const payload = {};

  Object.keys(params).forEach(function(key) {
    payload[key] = params[key];
  });

  Object.keys(named).forEach(function(key) {
    if (payload[key] != null) return;
    const arr = named[key];
    payload[key] = Array.isArray(arr) ? arr[0] : arr;
  });

  return payload;
}

function gf_web_buildShareOpenUrl_(route, shareToken, source) {
  const baseUrl = String(ScriptApp.getService().getUrl() || '').trim();
  if (!baseUrl) throw new Error('No pude obtener la URL de la Web App para abrir la vista compartida.');

  const view = encodeURIComponent(String(route || 'comprobantes'));
  const token = encodeURIComponent(String(shareToken || ''));
  const src = encodeURIComponent(String(source || 'firebase-pwa'));

  return `${baseUrl}?view=${view}&shareToken=${token}&shareSource=${src}`;
}

function gf_web_buildSharePostResponseHtml_(errorMsg, opts) {
  opts = opts || {};
  const ok = !!opts.ok;
  const title = gf_web_escapeHtml_(opts.title || 'Procesando archivo compartido…');
  const detail = ok
    ? 'Archivo recibido correctamente. Abriendo la vista correspondiente…'
    : `No pude procesar el archivo compartido: ${gf_web_escapeHtml_(errorMsg || 'Error desconocido.')}`;

  let targetUrl = '';
  if (ok) {
    targetUrl = gf_web_buildShareOpenUrl_(opts.route, opts.shareToken, opts.source);
  }

  const safeUrl = gf_web_escapeHtml_(targetUrl);
  const redirectScript = ok
    ? `
        <script>
          window.location.replace(${JSON.stringify(targetUrl)});
        </script>
      `
    : '';

  return HtmlService
    .createHtmlOutput(`
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${title}</title>
          <style>
            body {
              margin: 0;
              padding: 24px;
              font-family: Arial, sans-serif;
              background: #0f172a;
              color: #e5e7eb;
            }
            .card {
              max-width: 720px;
              margin: 40px auto;
              background: #111827;
              border: 1px solid rgba(255,255,255,.08);
              border-radius: 16px;
              padding: 24px;
            }
            h2 { margin-top: 0; }
            p { line-height: 1.5; }
            a { color: #93c5fd; }
            .err { color: #fca5a5; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>${title}</h2>
            <p class="${ok ? '' : 'err'}">${detail}</p>
            ${ok ? `<p>Si no redirige automáticamente, abrí <a href="${safeUrl}">este enlace</a>.</p>` : ''}
          </div>
          ${redirectScript}
        </body>
      </html>
    `)
    .setTitle('Gastos Familia')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**************************************
 * LECTURAS PARA EL FRONT
 **************************************/

function gf_web_getCargaMesActual_() {
  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName(GF.SHEET_CARGA);
    if (!sh) return { ok: true, rows: [] };

    const rows = gf_readObjectsFromSheet_(sh);

    const out = rows
      .filter(r => String(r['EstadoRegistro'] || '').trim() !== 'Archivado')
      .map(r => ({
        id: r['ID'] || '',
        tipo: r['Tipo'] || '',
        subtipo: r['Subtipo'] || '',
        persona: r['Persona'] || '',
        descripcion: r['Descripción'] || '',
        categoria: r['Categoría'] || '',
        subcategoria: r['Subcategoria'] || '',
        etiqueta: r['Etiqueta'] || '',
        banco: r['Banco'] || '',
        cuenta: r['Cuenta'] || '',
        moneda: r['Moneda'] || 'ARS',
        monto: Number(r['Monto']) || 0,
        dia: r['Día'] || '',
        fecha: gf_web_dateToIso_(r['Fecha']),
        ok: gf_boolOrDefault_(r['OK'], false),
        pagado: gf_boolOrDefault_(r['Pagado'], false),
        flagResumenMes: gf_boolOrDefault_(r['FlagResumenMes'], false),
        excluirDash: gf_boolOrDefault_(r['ExcluirDash'], false),
        estado: r['EstadoRegistro'] || '',
        notas: r['Notas'] || ''
      }));

    return { ok: true, rows: out };
  } catch (err) {
    gf_logError_('gf_web_getCargaMesActual_', err);
    return { ok: false, error: err.message || String(err), rows: [] };
  }
}

function gf_web_getResumenData_() {
  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName(GF.SHEET_RESUMEN);
    if (!sh) return { ok: true, values: [] };

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 1 || lastCol < 1) return { ok: true, values: [] };

    const values = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    return { ok: true, values };
  } catch (err) {
    gf_logError_('gf_web_getResumenData_', err);
    return { ok: false, error: err.message || String(err), values: [] };
  }
}

function gf_web_getResumenEstructurado_() {
  try {
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone();

    const shCfg = ss.getSheetByName(GF.SHEET_CONFIG);
    const mes = shCfg ? gf_toYYYYMM_(shCfg.getRange(GF.CFG_MES_CELL).getValue(), tz) : '';

    const sh = ss.getSheetByName(GF.SHEET_RESUMEN);
    if (!sh || sh.getLastRow() < 7) return { ok: true, vacia: true, mes };

    const lastRow = sh.getLastRow();
    const lastCol = Math.max(sh.getLastColumn(), 12);
    const v = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();

    // Layout fijo (ver 50_ResumenMes.gs):
    // A1 = título, B2 = TC ref
    // H2/I2/J2 = ing/gas/neto ARS eq
    // H4/I4/J4 = ing/gas/neto USD eq
    // C3 = header personas, C4..C5 = personas (max 2 con ingresos en este proyecto)
    // Row 6 = header tabla diaria, Row 7+ = datos diarios
    const titulo = String(v[0][0] || '');
    const tcRef  = String(v[1][1] || '');
    // Row 2 (idx 1): ARS eq  — Row 4 (idx 3): USD eq
    const ingArs = String(v[1][7] || '');
    const gasArs = String(v[1][8] || '');
    const netArs = String(v[1][9] || '');
    const ingUsd = v.length > 3 ? String(v[3][7] || '') : '';
    const gasUsd = v.length > 3 ? String(v[3][8] || '') : '';
    const netUsd = v.length > 3 ? String(v[3][9] || '') : '';

    // Personas con ingresos (filas 4-5, idx 3-4, cols C-F = idx 2-5)
    const personas = [];
    for (var pi = 3; pi <= 4; pi++) {
      if (pi >= v.length) break;
      const nombre = String(v[pi][2] || '').trim();
      if (!nombre) break;
      personas.push({
        persona: nombre,
        ars:    String(v[pi][3] || ''),
        arsEq:  String(v[pi][5] || ''),
        usdEq:  String(v[pi][6] || '')
      });
    }

    // Tabla diaria: desde idx 6 (row 7)
    // Cols: A=fecha B=dia C=BBVA_ARS D=BBVA_USD E=GAL_ARS F=GAL_USD G=PP_ARS H=EFEC_ARS I=total_ARS J=diaNum K=total_USD L=usdEq
    const filasdia = [];
    var totalMes = null;
    var efectivoTituloIdx = -1;

    for (var i = 6; i < v.length; i++) {
      const col0 = String(v[i][0] || '').trim();
      if (col0 === 'TOTAL MES') {
        totalMes = {
          bbvaArs:  String(v[i][2] || ''),
          galArs:   String(v[i][4] || ''),
          ppArs:    String(v[i][6] || ''),
          efecArs:  String(v[i][7] || ''),
          totalArs: String(v[i][8] || ''),
          totalUsd: String(v[i][10] || ''),
          usdEq:    String(v[i][11] || '')
        };
        continue;
      }
      if (col0 === 'GASTOS EN EFECTIVO - DETALLE') {
        efectivoTituloIdx = i;
        break;
      }
      if (!col0) continue;
      if (!v[i][8] && !v[i][10]) continue;
      filasdia.push({
        fecha:    col0,
        dia:      String(v[i][1] || ''),
        bbvaArs:  String(v[i][2] || ''),
        galArs:   String(v[i][4] || ''),
        ppArs:    String(v[i][6] || ''),
        efecArs:  String(v[i][7] || ''),
        totalArs: String(v[i][8] || ''),
        totalUsd: String(v[i][10] || ''),
        usdEq:    String(v[i][11] || '')
      });
    }

    // Detalle efectivo
    const efectivoFilas = [];
    var efectivoTotal = '';
    if (efectivoTituloIdx > 0) {
      efectivoTotal = String(v[efectivoTituloIdx][2] || '');
      for (var j = efectivoTituloIdx + 2; j < v.length; j++) {
        const dia  = String(v[j][0] || '').trim();
        if (!dia || dia === 'Día') continue;
        if (dia === 'TOTAL') break;
        const desc = String(v[j][1] || '').trim();
        const mon  = String(v[j][2] || '').trim();
        if (!desc && !mon) continue;
        efectivoFilas.push({ dia: dia, desc: desc, monto: mon });
      }
    }

    // Pagos de hoy: leemos Historico filtrado por fecha = hoy
    const pagosHoy = gf_web_getPagosHoy_(ss, tz);

    return {
      ok: true, vacia: false,
      titulo: titulo, mes: mes, tcRef: tcRef,
      cards: { ingArs: ingArs, gasArs: gasArs, netArs: netArs,
               ingUsd: ingUsd, gasUsd: gasUsd, netUsd: netUsd },
      personas: personas,
      filasdia: filasdia,
      totalMes: totalMes,
      efectivoTotal: efectivoTotal,
      efectivoFilas: efectivoFilas,
      pagosHoy: pagosHoy,
      actualizadoEn: Utilities.formatDate(new Date(), tz, 'dd/MM HH:mm')
    };
  } catch (err) {
    gf_logError_('gf_web_getResumenEstructurado_', err);
    return { ok: false, error: err.message || String(err) };
  }
}

function gf_web_getPagosHoy_(ss, tz) {
  try {
    const shH = ss.getSheetByName(GF.SHEET_HIST);
    if (!shH || shH.getLastRow() < 2) return [];

    const today = new Date();
    const todayStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');

    const headers = shH.getRange(1, 1, 1, shH.getLastColumn()).getValues()[0];
    const idx = {};
    headers.forEach(function(h, i) { idx[String(h).trim()] = i; });

    const need = ['Fecha','Descripción','Monto','Moneda','Banco','Tipo','FlagResumenMes','EstadoRegistro'];
    for (var n = 0; n < need.length; n++) {
      if (idx[need[n]] === undefined) return [];
    }

    const data = shH.getRange(2, 1, shH.getLastRow() - 1, shH.getLastColumn()).getValues();
    const out = [];

    for (var i = 0; i < data.length; i++) {
      const row = data[i];
      const estado = String(row[idx['EstadoRegistro']] || '').trim();
      if (estado === 'Archivado') continue;

      const flag = row[idx['FlagResumenMes']];
      if (flag === false || String(flag).toLowerCase() === 'false') continue;

      const tipo = String(row[idx['Tipo']] || '').trim();
      if (tipo === 'Ingreso') continue;

      const fecha = row[idx['Fecha']];
      if (!(fecha instanceof Date)) continue;
      if (Utilities.formatDate(fecha, tz, 'yyyy-MM-dd') !== todayStr) continue;

      const monto = Number(row[idx['Monto']]) || 0;
      if (!monto) continue;

      out.push({
        desc:   String(row[idx['Descripción']] || '').trim() || '(sin descripción)',
        monto:  monto,
        moneda: String(row[idx['Moneda']] || 'ARS').trim().toUpperCase(),
        banco:  String(row[idx['Banco']]  || '').trim()
      });
    }

    return out;
  } catch(e) {
    return [];
  }
}

function gf_web_getPendientesMes_() {
  try {
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone();

    const shCfg = ss.getSheetByName(GF.SHEET_CONFIG);
    const mesYYYYMM = shCfg
      ? gf_toYYYYMM_(shCfg.getRange(GF.CFG_MES_CELL).getValue(), tz)
      : Utilities.formatDate(new Date(), tz, 'yyyy-MM');
    const mesLabel = mesYYYYMM
      ? _pendMesLabel_(mesYYYYMM)
      : Utilities.formatDate(new Date(), tz, 'MMMM yyyy');

    // Leer esperados
    const shGE = ss.getSheetByName(GF.SHEET_GASTOS_ESPERADOS);
    const shIE = ss.getSheetByName(GF.SHEET_INGRESOS_ESPERADOS);
    const gastosEsp   = shGE ? gf_readObjectsFromSheet_(shGE) : [];
    const ingresosEsp = shIE ? gf_readObjectsFromSheet_(shIE) : [];

    // Leer Historico del mes en curso
    const shH = ss.getSheetByName(GF.SHEET_HIST);
    const histMes = _pendLeerHistoricoMes_(shH, mesYYYYMM, tz);

    // Procesar cada lista
    const gastos   = _pendProcesar_(
      gastosEsp.filter(r => gf_boolOrDefault_(r['Activo'], false)),
      histMes, 'Gasto'
    );
    const ingresos = _pendProcesar_(
      ingresosEsp.filter(r => gf_boolOrDefault_(r['Activo'], false)),
      histMes, 'Ingreso'
    );

    return { ok: true, mes: mesLabel, gastos: gastos, ingresos: ingresos };
  } catch (err) {
    gf_logError_('gf_web_getPendientesMes_', err);
    return { ok: false, error: err.message || String(err) };
  }
}

function gf_gastosEsperados_lookup_(cat, subcat, personaHint) {
  try {
    const ss   = SpreadsheetApp.getActive();
    const norm = function(s) { return String(s || '').trim().toLowerCase(); };
    const catN     = norm(cat);
    const subcatN  = norm(subcat);
    const personaN = norm(personaHint || '');
    if (!catN && !subcatN) return null;

    var candidates = [];
    const sheets = [GF.SHEET_GASTOS_ESPERADOS, GF.SHEET_INGRESOS_ESPERADOS];
    for (var si = 0; si < sheets.length; si++) {
      const sh = ss.getSheetByName(sheets[si]);
      if (!sh || sh.getLastRow() < 2) continue;
      const rows = gf_readObjectsFromSheet_(sh);
      for (var i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!gf_boolOrDefault_(r['Activo'], false)) continue;

        // Toleramos header con tilde (schema legacy) y sin tilde (schema nuevo Fase 3.a)
        const rCat = norm(r['Categoria'] || r['Categoría'] || '');
        if (catN    && rCat                             !== catN)    continue;
        if (subcatN && norm(r['Subcategoria'] || '') !== subcatN) continue;

        // MontoEsperado = schema Fase 3.a; MontoDefault = schema legacy Obligaciones
        const monto = Number(r['MontoEsperado'] || r['MontoDefault']) || 0;

        candidates.push({
          montoEsperado: monto || null,
          moneda:        String(r['Moneda']        || 'ARS').trim(),
          banco:         String(r['Banco']         || '').trim(),
          etiqueta:      String(r['Etiqueta']      || '').trim(),
          persona:       String(r['Persona']       || r['PersonaDefault'] || '').trim(),
          categoria:     String(r['Categoria']     || r['Categoría']      || '').trim(),
          subcategoria:  String(r['Subcategoria']  || '').trim(),
          tarjeta:       String(r['Tarjeta']       || '').trim(),
          descripcion:   String(r['Descripción']   || r['Descripcion']    || '').trim(),
          id:            String(r['ID']            || r['ObligacionID']   || r['IngresoID'] || '').trim()
        });
      }
    }

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // Múltiples candidatos — intentar desambiguar con personaHint
    if (personaN) {
      var byPersona = candidates.filter(function(c) {
        return norm(c.persona) === personaN;
      });
      if (byPersona.length === 1) {
        Logger.log('gf_gastosEsperados_lookup_: ' + candidates.length + ' candidatos, personaHint="' + (personaHint||'') + '" → 1 match');
        return byPersona[0];
      }
    }

    // Si todos los candidatos tienen mismo banco + moneda, retornar el primero (seguro)
    var first = candidates[0];
    var consistent = candidates.every(function(c) {
      return norm(c.banco) === norm(first.banco) && norm(c.moneda) === norm(first.moneda);
    });
    if (consistent) {
      Logger.log('gf_gastosEsperados_lookup_: ' + candidates.length + ' candidatos consistentes (banco+moneda), retornando primero');
      return first;
    }

    Logger.log('gf_gastosEsperados_lookup_: ' + candidates.length + ' candidatos ambiguos, personaHint="' + (personaHint||'') + '" → null');
    return null;
  } catch (e) {
    return null;
  }
}

function _pendMesLabel_(mesYYYYMM) {
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const parts = String(mesYYYYMM).split('-');
  const m = parseInt(parts[1], 10);
  return (meses[m - 1] || parts[1]) + ' ' + parts[0];
}

function _pendLeerHistoricoMes_(shH, mesYYYYMM, tz) {
  if (!shH || shH.getLastRow() < 2) return [];
  const headers = shH.getRange(1, 1, 1, shH.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach(function(h, i) { idx[String(h).trim()] = i; });

  const need = ['Fecha','Tipo','Categoría','Subcategoria','Monto','Persona','EstadoRegistro'];
  for (var n = 0; n < need.length; n++) {
    if (idx[need[n]] === undefined) return [];
  }

  const data = shH.getRange(2, 1, shH.getLastRow() - 1, shH.getLastColumn()).getValues();
  const out = [];
  data.forEach(function(row) {
    const estado = String(row[idx['EstadoRegistro']] || '').trim();
    if (estado === 'Archivado') return;

    const fecha = row[idx['Fecha']];
    if (!(fecha instanceof Date)) return;
    const fMes = Utilities.formatDate(fecha, tz, 'yyyy-MM');
    if (fMes !== mesYYYYMM) return;

    out.push({
      fecha:        Utilities.formatDate(fecha, tz, 'dd/MM'),
      tipo:         String(row[idx['Tipo']] || '').trim(),
      categoria:    String(row[idx['Categoría']] || '').trim().toLowerCase(),
      subcategoria: String(row[idx['Subcategoria']] || '').trim().toLowerCase(),
      etiqueta:     String(idx['Etiqueta'] !== undefined ? (row[idx['Etiqueta']] || '') : '').trim().toLowerCase(),
      monto:        Number(row[idx['Monto']]) || 0,
      persona:      String(row[idx['Persona']] || '').trim()
    });
  });
  return out;
}

function _pendProcesar_(esperados, histMes, tipoFiltro) {
  return esperados.map(function(esp) {
    // Toleramos 'Categoría' (schema viejo de Obligaciones) y 'Categoria' (schema nuevo)
    const cat  = String(esp['Categoria'] || esp['Categoría'] || '').trim().toLowerCase();
    const sub  = String(esp['Subcategoria'] || '').trim().toLowerCase();
    const etq  = String(esp['Etiqueta'] || '').trim().toLowerCase();
    const montoEsp = Number(esp['MontoEsperado'] || esp['MontoDefault']) || null;

    const matches = histMes.filter(function(h) {
      return h.tipo.toLowerCase() === tipoFiltro.toLowerCase()
          && h.categoria    === cat
          && h.subcategoria === sub
          && (!etq || h.etiqueta === etq);
    });

    const montoReal = matches.reduce(function(acc, h) { return acc + h.monto; }, 0);

    return {
      categoria:     String(esp['Categoria']    || '').trim(),
      subcategoria:  String(esp['Subcategoria'] || '').trim(),
      montoEsperado: montoEsp,
      movimientos:   matches.map(function(h) {
        return { fecha: h.fecha, monto: h.monto, persona: h.persona };
      }),
      montoReal:     matches.length ? montoReal : null,
      estado:        matches.length ? 'cargado' : 'falta'
    };
  });
}


function gf_web_getDashMensualData_(mesParam) {
  try {
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone();

    const shCfg = ss.getSheetByName(GF.SHEET_CONFIG);
    const mesYYYYMM = mesParam
      || (shCfg ? gf_toYYYYMM_(shCfg.getRange(GF.CFG_MES_CELL).getValue(), tz) : null)
      || Utilities.formatDate(new Date(), tz, 'yyyy-MM');

    // C14.b: delegar al state machine de cache. FRESH → cache hit; STALE/absent → recalcular.
    const d = gf_dashCache_getOrCalc_(mesYYYYMM);
    return {
      ok:                    true,
      mes:                   _pendMesLabel_(mesYYYYMM),
      mesYYYYMM:             mesYYYYMM,
      tcRef:                 d.tcRef,
      kpis:                  d.kpis,
      promedioMes12GasArsEq: d.promedioMes12GasArsEq,
      byCat:                 d.byCat,
      bySubcat:              d.bySubcat,
      byDesc:                d.byDesc,
      byBanco:               d.byBanco,
      byDia:                 d.byDia,
      prevMonth:             d.prevMonth,
      insights:              d.insights,
      indicadores:           d.indicadores
    };
  } catch (err) {
    gf_logError_('gf_web_getDashMensualData_', err);
    return { ok: false, error: err.message || String(err) };
  }
}

function gf_web_previousMonthKey_(mesYYYYMM) {
  const p = gf_parseMonth_(mesYYYYMM);
  const d = new Date(p.year, p.month0, 1);
  d.setMonth(d.getMonth() - 1);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
}

function gf_web_getDashMonthCompare_(mesYYYYMM) {
  // C14.b: cache-first (FRESH o STALE aceptados — no dispara recálculo, evita recursión).
  // Si el mes no está en cache, fallback a scan de Historico (comportamiento original).
  try {
    const cached = gf_dashCache_leerMes_(mesYYYYMM);
    if (cached.found && cached.kpis) {
      const k = cached.kpis;
      return {
        mesYYYYMM: mesYYYYMM,
        ingArsEq:  Number(k.ingArsEq) || 0,
        ingUsdEq:  Number(k.ingUsdEq) || 0,
        gasArsEq:  Number(k.gasArsEq) || 0,
        gasUsdEq:  Number(k.gasUsdEq) || 0,
        netArsEq:  Number(k.netArsEq) || 0,
        netUsdEq:  Number(k.netUsdEq) || 0
      };
    }

    // No está en cache → fallback a Historico
    const p = gf_parseMonth_(mesYYYYMM);
    const items = gf_collectDetailedItemsForDashMensual_(mesYYYYMM, p.start, p.end);
    let ingArsEq = 0, ingUsdEq = 0, gasArsEq = 0, gasUsdEq = 0;
    items.forEach(function(it) {
      const isIngreso = (it.tipo || '').trim() === 'Ingreso';
      if (isIngreso) {
        ingArsEq += Number(it.arsEq) || 0;
        ingUsdEq += Number(it.usdEq) || 0;
      } else {
        gasArsEq += Number(it.arsEq) || 0;
        gasUsdEq += Number(it.usdEq) || 0;
      }
    });
    return {
      mesYYYYMM: mesYYYYMM,
      ingArsEq: ingArsEq,
      ingUsdEq: ingUsdEq,
      gasArsEq: gasArsEq,
      gasUsdEq: gasUsdEq,
      netArsEq: ingArsEq - gasArsEq,
      netUsdEq: ingUsdEq - gasUsdEq
    };
  } catch (e) {
    Logger.log('[dashMonthCompare] ERROR ' + mesYYYYMM + ': ' + e);
    return { mesYYYYMM: mesYYYYMM, ingArsEq: 0, ingUsdEq: 0, gasArsEq: 0, gasUsdEq: 0, netArsEq: 0, netUsdEq: 0 };
  }
}

function gf_web_fillDashMonthDays_(p, byDiaMap) {
  const out = [];
  byDiaMap = byDiaMap || new Map();
  for (let d = 1; d <= p.daysInMonth; d++) {
    const key = `${p.year}-${String(p.month0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const row = byDiaMap.get(key) || { key: key, fecha: String(d).padStart(2, '0') + '/' + String(p.month0 + 1).padStart(2, '0'), dia: d, dow: '', arsEq: 0, usdEq: 0, count: 0 };
    out.push(row);
  }
  return out;
}

function gf_web_weekdayShort_(date, tz) {
  const map = { Mon:'lun', Tue:'mar', Wed:'mié', Thu:'jue', Fri:'vie', Sat:'sáb', Sun:'dom' };
  const en = Utilities.formatDate(date, tz, 'EEE');
  return map[en] || String(en || '').toLowerCase();
}

function gf_web_promedioMes12Gas_(ss, tz, mesActualYYYYMM, tcRef) {
  // C14.b: cache-first, read-only. Lee los 12 meses previos de Dash_Cache (FRESH o STALE).
  // Meses ausentes se omiten (no hay fallback a Historico — evita recursión en calcularMensual_).
  // En cold-start puede devolver 0; correr dashCache_backfillTodo() primero para exactitud.
  try {
    const partes = String(mesActualYYYYMM).split('-');
    const anio = parseInt(partes[0], 10);
    const mes  = parseInt(partes[1], 10);

    var total = 0, count = 0;
    for (var i = 1; i <= 12; i++) {
      var d = new Date(anio, mes - 1 - i, 1);
      var mk = Utilities.formatDate(d, tz, 'yyyy-MM');
      var cached = gf_dashCache_leerMes_(mk);
      if (cached.found && cached.kpis) {
        var gasArsEq = Number((cached.kpis || {}).gasArsEq) || 0;
        if (gasArsEq > 0) { total += gasArsEq; count++; }
      }
      // ausente → omitir (sin fallback a Historico)
    }
    return count > 0 ? Math.round(total / count) : 0;
  } catch(e) {
    Logger.log('[promedioMes12Gas] ERROR: ' + e);
    return 0;
  }
}


function gf_web_getDashAnualData_(year) {
  try {
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone();

    const targetYear = Number(year) || new Date().getFullYear();
    const start = new Date(targetYear, 0, 1);
    const end   = new Date(targetYear + 1, 0, 1);
    const prevStart = new Date(targetYear - 1, 0, 1);
    const prevEnd   = new Date(targetYear, 0, 1);

    const shH = ss.getSheetByName(GF.SHEET_HIST);
    if (!shH || shH.getLastRow() < 2) {
      return { ok: true, year: targetYear, years: [targetYear], availableMonths: [],
               kpis: {}, byMes: [], byMesYear: [], byCat: [], byDesc: [], ingresos: [],
               promedioMes12GasArsEq: 0, annualInsights: {} };
    }

    const t = gf_readSheet_(shH);
    const idx = gf_buildIdx_(t.headers);

    const iTipo  = idx[gf_norm_('Tipo')];
    const iFecha = idx[gf_norm_('Fecha')];
    const iMon   = idx[gf_norm_('Moneda')];
    const iMonto = idx[gf_norm_('Monto')];
    const iCat   = idx[gf_norm_('Categoría')] ?? idx[gf_norm_('Categoria')];
    const iDesc  = idx[gf_norm_('Descripción')] ?? idx[gf_norm_('Descripcion')];
    const iTc    = idx[gf_norm_('TC_USDARS')];
    const iExcl  = idx[gf_norm_('ExcluirDash')];
    const iEst   = idx[gf_norm_('EstadoRegistro')];

    const yearsSet      = new Set();
    const allMonthsSet  = new Set();
    const byMesMap      = new Map();
    const byMesYearMap  = new Map();
    const byCat         = new Map();
    const byDesc        = new Map();
    const byMesIng      = new Map();
    const byMesProm     = new Map();

    let ingArsEq = 0, ingUsdEq = 0, gasArsEq = 0, gasUsdEq = 0;
    let prevIngArsEq = 0, prevIngUsdEq = 0, prevGasArsEq = 0, prevGasUsdEq = 0;

    for (const r of t.rows) {
      if (iExcl != null && gf_boolOrDefault_(r[iExcl], false)) continue;
      if (iEst  != null && String(r[iEst]  || '').trim() === 'Archivado') continue;

      const tipo = (r[iTipo] ?? '').toString().trim();
      if (tipo !== 'Gasto' && tipo !== 'Ingreso') continue;

      const d = r[iFecha];
      if (!(d instanceof Date)) continue;

      yearsSet.add(d.getFullYear());
      allMonthsSet.add(Utilities.formatDate(d, tz, 'yyyy-MM'));

      const mon   = (r[iMon] ?? 'ARS').toString().toUpperCase().trim() || 'ARS';
      const monto = Number(r[iMonto]) || 0;
      if (!monto) continue;

      let tc = Number(iTc != null ? r[iTc] : NaN);
      if (!isFinite(tc) || tc <= 0) tc = gf_lookupTCPorFecha_(d);

      const arsEq  = mon === 'USD' ? monto * tc : monto;
      const usdEq  = mon === 'USD' ? monto : (tc ? monto / tc : 0);
      const mesKey = Utilities.formatDate(d, tz, 'yyyy-MM');

      const mesRow = byMesMap.get(mesKey) || { mes: mesKey, gasArsEq: 0, gasUsdEq: 0, ingArsEq: 0, ingUsdEq: 0, count: 0 };
      if (tipo === 'Gasto') { mesRow.gasArsEq += arsEq; mesRow.gasUsdEq += usdEq; mesRow.count++; }
      else                  { mesRow.ingArsEq += arsEq; mesRow.ingUsdEq += usdEq; }
      byMesMap.set(mesKey, mesRow);

      if (d >= prevStart && d < prevEnd) {
        if (tipo === 'Gasto') { prevGasArsEq += arsEq; prevGasUsdEq += usdEq; byMesProm.set(mesKey, (byMesProm.get(mesKey) || 0) + arsEq); }
        else                  { prevIngArsEq += arsEq; prevIngUsdEq += usdEq; }
      }

      if (d >= start && d < end) {
        const yearRow = byMesYearMap.get(mesKey) || { mes: mesKey, gasArsEq: 0, gasUsdEq: 0, ingArsEq: 0, ingUsdEq: 0, count: 0 };
        if (tipo === 'Gasto') {
          gasArsEq += arsEq; gasUsdEq += usdEq;
          yearRow.gasArsEq += arsEq; yearRow.gasUsdEq += usdEq; yearRow.count++;

          const cat  = (iCat  != null ? r[iCat]  : '') || 'Sin categoría';
          const desc = (iDesc != null ? r[iDesc]  : '') || 'Sin descripción';
          const catCur  = byCat.get(cat)   || { cat, arsEq: 0, usdEq: 0, count: 0 };
          catCur.arsEq  += arsEq; catCur.usdEq  += usdEq; catCur.count++;  byCat.set(cat, catCur);
          const descCur = byDesc.get(desc) || { desc, cat, arsEq: 0, usdEq: 0, count: 0 };
          descCur.arsEq += arsEq; descCur.usdEq += usdEq; descCur.count++; byDesc.set(desc, descCur);
        } else {
          ingArsEq += arsEq; ingUsdEq += usdEq;
          yearRow.ingArsEq += arsEq; yearRow.ingUsdEq += usdEq;
          const cur = byMesIng.get(mesKey) || { mes: mesKey, arsEq: 0, usdEq: 0, count: 0 };
          cur.arsEq += arsEq; cur.usdEq += usdEq; cur.count++;
          byMesIng.set(mesKey, cur);
        }
        byMesYearMap.set(mesKey, yearRow);
      }
    }

    const promTotal  = Array.from(byMesProm.values()).reduce(function(a,b){ return a+b; }, 0);
    const promMeses  = byMesProm.size || 1;
    const promedioMes12GasArsEq = Math.round(promTotal / promMeses);

    const availableMonths = Array.from(allMonthsSet).sort().reverse().map(function(m) {
      const pts = m.split('-');
      const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      return { value: m, label: (meses[parseInt(pts[1],10)-1] || pts[1]) + ' ' + pts[0] };
    });

    const byMesYear = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${targetYear}-${String(m).padStart(2, '0')}`;
      byMesYear.push(byMesYearMap.get(key) || { mes: key, gasArsEq: 0, gasUsdEq: 0, ingArsEq: 0, ingUsdEq: 0, count: 0 });
    }

    const activeMonths = byMesYear.filter(function(r){ return Number(r.gasArsEq || 0) > 0 || Number(r.ingArsEq || 0) > 0; }).length;
    const deficitMonths = byMesYear.filter(function(r){ return (Number(r.ingArsEq || 0) - Number(r.gasArsEq || 0)) < 0 && (Number(r.ingArsEq || 0) > 0 || Number(r.gasArsEq || 0) > 0); }).length;
    const avgGasArsEq = activeMonths ? Math.round(gasArsEq / activeMonths) : 0;
    const avgGasUsdEq = activeMonths ? (gasUsdEq / activeMonths) : 0;
    const coveragePct = gasArsEq > 0 ? Math.round((ingArsEq / gasArsEq) * 100) : 0;
    const vsPrevYearGasArsPct = prevGasArsEq > 0 ? ((gasArsEq - prevGasArsEq) / prevGasArsEq) * 100 : null;
    const vsPrevYearGasUsdPct = prevGasUsdEq > 0 ? ((gasUsdEq - prevGasUsdEq) / prevGasUsdEq) * 100 : null;

    let bestMonth = '', worstMonth = '';
    let bestBalanceArsEq = null, worstBalanceArsEq = null, bestBalanceUsdEq = null, worstBalanceUsdEq = null;
    byMesYear.forEach(function(r) {
      const balArs = Number(r.ingArsEq || 0) - Number(r.gasArsEq || 0);
      const balUsd = Number(r.ingUsdEq || 0) - Number(r.gasUsdEq || 0);
      if (bestBalanceArsEq == null || balArs > bestBalanceArsEq) {
        bestBalanceArsEq = balArs; bestBalanceUsdEq = balUsd; bestMonth = r.mes;
      }
      if (worstBalanceArsEq == null || balArs < worstBalanceArsEq) {
        worstBalanceArsEq = balArs; worstBalanceUsdEq = balUsd; worstMonth = r.mes;
      }
    });

    return {
      ok: true,
      year: targetYear,
      years: Array.from(yearsSet).sort(),
      availableMonths: availableMonths,
      kpis: { ingArsEq: ingArsEq, gasArsEq: gasArsEq, netArsEq: ingArsEq - gasArsEq,
              ingUsdEq: ingUsdEq, gasUsdEq: gasUsdEq, netUsdEq: ingUsdEq - gasUsdEq },
      promedioMes12GasArsEq: promedioMes12GasArsEq,
      annualInsights: {
        activeMonths: activeMonths,
        deficitMonths: deficitMonths,
        avgGasArsEq: avgGasArsEq,
        avgGasUsdEq: avgGasUsdEq,
        coveragePct: coveragePct,
        vsPrevYearGasArsPct: vsPrevYearGasArsPct,
        vsPrevYearGasUsdPct: vsPrevYearGasUsdPct,
        bestMonth: bestMonth,
        bestBalanceArsEq: bestBalanceArsEq || 0,
        bestBalanceUsdEq: bestBalanceUsdEq || 0,
        worstMonth: worstMonth,
        worstBalanceArsEq: worstBalanceArsEq || 0,
        worstBalanceUsdEq: worstBalanceUsdEq || 0,
        prevYearGasArsEq: prevGasArsEq,
        prevYearGasUsdEq: prevGasUsdEq,
        prevYearIngArsEq: prevIngArsEq,
        prevYearIngUsdEq: prevIngUsdEq
      },
      byMes:    Array.from(byMesMap.values()).sort(function(a,b){ return a.mes.localeCompare(b.mes); }),
      byMesYear: byMesYear,
      byCat:    Array.from(byCat.values()).sort(function(a,b){ return b.arsEq - a.arsEq; }),
      byDesc:   Array.from(byDesc.values()).sort(function(a,b){ return b.arsEq - a.arsEq; }),
      ingresos: Array.from(byMesIng.values()).sort(function(a,b){ return a.mes.localeCompare(b.mes); })
    };
  } catch (err) {
    gf_logError_('gf_web_getDashAnualData_', err);
    return { ok: false, error: err.message || String(err) };
  }
}

function gf_web_getDashData_() {
  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName(GF.SHEET_DASH);
    if (!sh) return { ok: true, values: [] };

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 1 || lastCol < 1) return { ok: true, values: [] };

    const values = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    return { ok: true, values };
  } catch (err) {
    gf_logError_('gf_web_getDashData_', err);
    return { ok: false, error: err.message || String(err), values: [] };
  }
}

/**************************************
 * HELPERS WEB
 **************************************/

function gf_web_dateToIso_(v) {
  if (!(v instanceof Date) || isNaN(v.getTime())) return '';
  return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function gf_web_handleShareUploadFormPost_(e) {
  try {
    const p = (e && e.parameter) ? e.parameter : {};

    const fileName = String(p.fileName || 'comprobante.pdf').trim();
    const mimeType = String(p.mimeType || 'application/pdf').trim();
    const route = String(p.route || p.targetView || 'comprobantes').trim().toLowerCase();
    const size = Number(p.size || 0) || 0;
    const base64 = String(p.base64 || '').trim();
    const source = String(p.source || 'firebase-pwa').trim();

    if (!base64) throw new Error('Falta base64.');
    var allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowed.indexOf(mimeType) === -1) throw new Error('Tipo no soportado: ' + mimeType + '.');

    const fakeEvent = {
      parameter: {
        ...p,
        action: 'share-upload',
        route: route,
        responseMode: 'json'
      },
      postData: {
        contents: JSON.stringify({
          action: 'share-upload',
          source: source,
          route: route,
          responseMode: 'json',
          fileName: fileName,
          mimeType: mimeType,
          size: size,
          base64: base64
        }),
        type: 'application/json'
      }
    };

    const jsonText = gf_web_handleShareUploadPost_(fakeEvent).getContent();
    const data = JSON.parse(jsonText);

    if (!data || !data.ok || !data.shareToken) {
      throw new Error((data && data.error) || 'No se pudo generar el shareToken.');
    }

    const finalRoute = String(data.route || route || 'comprobantes');
    Logger.log('[share-upload-form] token=%s route=%s source=%s', data.shareToken, finalRoute, source);

    // Renderizar la vista final directamente — sin redirect.
    const renderOutput = gf_web_renderView_(finalRoute, {
      shareToken: data.shareToken,
      shareSource: source
    });
    return renderOutput;

  } catch (err) {
    gf_logError_('gf_web_handleShareUploadFormPost_', err);

    return HtmlService.createHtmlOutput(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Error</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; }
            pre {
              white-space: pre-wrap;
              word-break: break-word;
              background: #f5f5f5;
              padding: 12px;
              border-radius: 8px;
            }
          </style>
        </head>
        <body>
          <h2>Error al procesar el PDF</h2>
          <pre>${String(err.message || err)}</pre>
        </body>
      </html>
    `).setTitle('Error');
  }
}