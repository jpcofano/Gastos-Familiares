/**************************************
 * 20_Setup_y_Helpers.gs - Fase 2.1
 * Setup no destructivo + helpers + normalización de bancos
 * + migración legacy MANUAL (no se corre sola)
 **************************************/

function setupAll() {
  const ss = SpreadsheetApp.getActive();
  const report = [];
  ensureConfigSheet_(ss, report);

  Object.keys(GF.SHEET_SCHEMAS).forEach(name => {
    report.push(ensureSheetWithSchema_(ss, name, GF.SHEET_SCHEMAS[name]));
  });

  ['ResumenMes','Dash_Mensual','Dash_Anual'].forEach(n => {
    if (!ss.getSheetByName(n)) {
      ss.insertSheet(n);
      report.push({ sheet: n, action: 'created-empty' });
    } else {
      report.push({ sheet: n, action: 'kept' });
    }
  });

  report.push(gf_ensureShareTempSheet_(ss));

  PropertiesService.getDocumentProperties()
    .setProperty(GF.PROP_SCHEMA_VERSION, GF.SCHEMA_VERSION);

  Logger.log('setupAll OK ' + GF.SCHEMA_VERSION);
  Logger.log(JSON.stringify(report, null, 2));
  ss.toast('Setup OK ' + GF.SCHEMA_VERSION, 'GF', 5);
  return report;
}

function ensureSheetWithSchema_(ss, name, schema) {
  let sh = ss.getSheetByName(name);
  const wanted = schema.headers.slice();

  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, wanted.length).setValues([wanted]);
    sh.setFrozenRows(schema.freezeRows || 1);
    styleHeader_(sh, wanted.length);
    if (schema.seed && schema.seed.length) {
      sh.getRange(2, 1, schema.seed.length, schema.seed[0].length).setValues(schema.seed);
    }
    return { sheet: name, action: 'created', headers: wanted.length };
  }

  const lastCol = Math.max(sh.getLastColumn(), 1);
  const current = sh.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(h => String(h || '').trim());
  const missing = wanted.filter(h => current.indexOf(h) === -1);

  if (missing.length === 0) {
    return { sheet: name, action: 'ok', headers: current.length };
  }

  const startCol = lastCol + (current[lastCol - 1] === '' ? 0 : 1);
  const needCols = startCol + missing.length - 1;
  if (sh.getMaxColumns() < needCols) {
    sh.insertColumnsAfter(sh.getMaxColumns(), needCols - sh.getMaxColumns());
  }
  sh.getRange(1, startCol, 1, missing.length).setValues([missing]);
  styleHeader_(sh, sh.getLastColumn());

  if (schema.seed && sh.getLastRow() < 2) {
    sh.getRange(2, 1, schema.seed.length, schema.seed[0].length).setValues(schema.seed);
  }

  return { sheet: name, action: 'migrated-added-cols', added: missing };
}

function ensureConfigSheet_(ss, report) {
  let sh = ss.getSheetByName(GF.SHEET_CONFIG);
  if (!sh) {
    sh = ss.insertSheet(GF.SHEET_CONFIG);
    const rows = [
      ['Mes actual (YYYY-MM)', ''],
      ['TC USD/ARS', ''],
      ['TC actualizado en', ''],
      ['Calendar ID', ''],
      ['Hora evento (HH:MM)', '09:00'],
      ['Popup minutos', 30],
      ['Duración minutos', 30],
      ['Anthropic API Key', ''],
      ['Google Drive PDF Folder ID', '']
    ];
    sh.getRange(1, 1, rows.length, 2).setValues(rows);
    sh.setColumnWidth(1, 220);
    sh.setColumnWidth(2, 320);
    report.push({ sheet: 'Config', action: 'created' });
  } else {
    report.push({ sheet: 'Config', action: 'kept' });
  }

  // Hoja nueva o existente: asegurar filas técnicas sin tocar valores ya cargados
  gf_ensureConfigTarjetas_();
  gf_ensureConfigShareTemp_();
}

function styleHeader_(sh, ncols) {
  sh.getRange(1, 1, 1, ncols)
    .setBackground(GF_THEME.headerBg)
    .setFontColor(GF_THEME.headerFg)
    .setFontWeight('bold')
    .setHorizontalAlignment('left');
}

// ============ NORMALIZACIÓN DE BANCOS ============
function gf_normalizarBanco_(input) {
  if (input == null || input === '') return '';
  const key = String(input).toLowerCase().trim().replace(/\s+/g, ' ');
  if (GF_BANCO_ALIASES[key]) return GF_BANCO_ALIASES[key];
  if (GF_BANCOS_VALIDOS.indexOf(input) !== -1) return input;
  throw new Error('Banco no reconocido: "' + input + '". Válidos: ' + GF_BANCOS_VALIDOS.join(', '));
}

// ============ MIGRACIÓN LEGACY MANUAL (NO se corre sola) ============
/**
 * PASO 1: Vista previa. Corré esta función primero. NO modifica nada.
 * Te devuelve cuántas filas se cambiarían en cada hoja.
 */
function gf_migrarBancosLegacy_PREVIEW() {
  return _migrarBancosLegacy_(true);
}

/**
 * PASO 2: Aplicación real. SOLO corré esto después de revisar el preview
 * y de tener una copia de seguridad del Sheet.
 */
function gf_migrarBancosLegacy_APLICAR() {
  return _migrarBancosLegacy_(false);
}

function _migrarBancosLegacy_(dryRun) {
  const ss = SpreadsheetApp.getActive();
  const hojas = ['Historico','Carga','Gastos_Manuales','Obligaciones','Futuros_Eventuales'];
  const report = { dryRun: dryRun, total: 0, hojas: {} };

  hojas.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) {
      report.hojas[name] = { skipped: 'no existe o vacía' };
      return;
    }
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const colBanco = headers.indexOf('Banco') + 1;
    if (colBanco === 0) {
      report.hojas[name] = { skipped: 'sin columna Banco' };
      return;
    }
    const nRows = sh.getLastRow() - 1;
    const range = sh.getRange(2, colBanco, nRows, 1);
    const values = range.getValues();
    let changed = 0;
    const detalle = {};

    for (let i = 0; i < values.length; i++) {
      const original = values[i][0];
      if (original == null || original === '') continue;
      try {
        const canonico = gf_normalizarBanco_(original);
        if (canonico !== original) {
          detalle[original] = (detalle[original] || 0) + 1;
          values[i][0] = canonico;
          changed++;
        }
      } catch (e) {
        // banco desconocido, lo dejo y lo reporto
        const k = '⚠ DESCONOCIDO: ' + original;
        detalle[k] = (detalle[k] || 0) + 1;
      }
    }

    if (changed > 0 && !dryRun) {
      range.setValues(values);
    }
    report.hojas[name] = { filas: nRows, cambiadas: changed, detalle: detalle };
    report.total += changed;
  });

  Logger.log((dryRun ? '[PREVIEW]' : '[APLICADO]') + ' migrarBancosLegacy');
  Logger.log(JSON.stringify(report, null, 2));
  ss.toast((dryRun ? 'Preview: ' : 'Aplicado: ') + report.total + ' filas', 'Migración', 8);
  return report;
}

// ============ HELPERS USUARIO / SHEETS ============
function getCurrentUser() {
  const email = String(Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  if (!email) return null;
  const sh = SpreadsheetApp.getActive().getSheetByName(GF.SHEET_USUARIOS);
  if (!sh || sh.getLastRow() < 2) return null;

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h || '').trim(); });
  const idx = gf_authBuildHeaderIndex_(headers);
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();

  for (const row of data) {
    const rowEmail = String(row[idx.email] || '').toLowerCase().trim();
    if (rowEmail === email && gf_authBool_(row[idx.activo], false)) {
      return {
        email: String(row[idx.email] || '').trim(),
        persona: String(row[idx.persona] || '').trim(),
        rol: String(row[idx.rol] || '').trim()
      };
    }
  }
  return null;
}

function requireUser_() {
  const u = getCurrentUser();
  if (!u) throw new Error('Usuario no autorizado: ' + Session.getActiveUser().getEmail());
  return u;
}

function gf_authBuildHeaderIndex_(headers) {
  const byName = {};
  headers.forEach(function(h, i) {
    byName[gf_authNormHeader_(h)] = i;
  });

  return {
    email: gf_authFirstHeader_(byName, ['email', 'correo', 'mail', 'usuario'], 0),
    persona: gf_authFirstHeader_(byName, ['persona', 'nombre', 'nombrepersona'], 1),
    rol: gf_authFirstHeader_(byName, ['rol', 'perfil', 'tipo', 'tipousuario'], 2),
    activo: gf_authFirstHeader_(byName, ['activo', 'habilitado', 'estado', 'autorizado'], 3)
  };
}

function gf_authNormHeader_(h) {
  return String(h || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function gf_authFirstHeader_(byName, names, fallback) {
  for (var i = 0; i < names.length; i++) {
    if (byName[names[i]] != null) return byName[names[i]];
  }
  return fallback;
}

function gf_authBool_(v, defaultValue) {
  if (typeof gf_boolOrDefault_ === 'function') {
    return gf_boolOrDefault_(v, defaultValue);
  }
  if (v === '' || v == null) return defaultValue;
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;

  const s = String(v).trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (s === 'TRUE' || s === 'VERDADERO' || s === 'SI') return true;
  if (s === 'FALSE' || s === 'FALSO' || s === 'NO') return false;

  return defaultValue;
}

function gf_diagnosticoAuth() {
  const email = String(Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_USUARIOS);
  const out = {
    emailSession: email,
    sheetUsuarios: GF.SHEET_USUARIOS,
    existeHoja: !!sh,
    headers: [],
    filas: 0,
    matchEmail: false,
    matchActivo: false,
    usuario: null
  };

  if (!sh) {
    Logger.log(JSON.stringify(out, null, 2));
    return out;
  }

  out.filas = Math.max(sh.getLastRow() - 1, 0);
  out.headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h || '').trim(); });

  const idx = gf_authBuildHeaderIndex_(out.headers);
  const data = out.filas
    ? sh.getRange(2, 1, out.filas, sh.getLastColumn()).getValues()
    : [];

  data.forEach(function(row) {
    const rowEmail = String(row[idx.email] || '').toLowerCase().trim();
    if (rowEmail !== email) return;
    out.matchEmail = true;
    out.matchActivo = gf_authBool_(row[idx.activo], false);
  });

  out.usuario = getCurrentUser();
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

function getSheetCtx_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Hoja no encontrada: ' + name);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach((h, i) => { idx[String(h).trim()] = i; });
  return { sheet: sh, headers, idx };
}

function newId_(prefix) {
  return (prefix || 'ID') + '_' + Utilities.getUuid().substring(0, 8);
}

function yyyymm_(d) {
  const dd = (d instanceof Date) ? d : new Date(d);
  return Utilities.formatDate(dd, Session.getScriptTimeZone(), 'yyyy-MM');
}

// ============ ANTHROPIC API KEY (Script Properties) ============
/**
 * Lee la API Key de Config B18, la guarda en Script Properties y borra la celda.
 * Correr UNA VEZ después de pegar la clave en Config B18.
 * Después de esto la celda queda vacía y la clave no es visible en el Sheet.
 */
function gf_guardarAnthropicKey_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_CONFIG);
  if (!sh) throw new Error('Hoja Config no encontrada');

  const cell = sh.getRange(GF.CFG_ANTHROPIC_KEY_CELL);
  const key  = String(cell.getValue() || '').trim();

  if (!key) {
    ss.toast('Celda ' + GF.CFG_ANTHROPIC_KEY_CELL + ' vacía. Pegá la API Key ahí primero.', 'Config', 5);
    return;
  }
  if (!key.startsWith('sk-ant-')) {
    ss.toast('⚠ La clave no parece una Anthropic API Key válida (debe empezar con sk-ant-).', 'Config', 6);
    return;
  }

  PropertiesService.getScriptProperties().setProperty('GF_ANTHROPIC_API_KEY', key);
  cell.clearContent();

  Logger.log('gf_guardarAnthropicKey_: API Key guardada en Script Properties. Celda Config borrada.');
  ss.toast('✅ API Key guardada de forma segura. La celda fue borrada.', 'Config', 6);
}

/**
 * Borra la API Key de Script Properties (por si necesitás remplazarla o revocarla).
 */
function gf_borrarAnthropicKey_() {
  PropertiesService.getScriptProperties().deleteProperty('GF_ANTHROPIC_API_KEY');
  Logger.log('gf_borrarAnthropicKey_: API Key eliminada de Script Properties.');
  SpreadsheetApp.getActive().toast('API Key eliminada. Pegá la nueva en Config y corré gf_guardarAnthropicKey_().', 'Config', 6);
}

// ============ CONFIG: AGREGAR FILAS FALTANTES ============
/**
 * Agrega las filas de Anthropic API Key y PDF Folder ID a la hoja Config
 * si todavía no existen. NO toca ninguna fila existente.
 * Correr manualmente una sola vez, o incluir en setupAll si se desea.
 */
function gf_ensureConfigTarjetas_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_CONFIG);
  if (!sh) throw new Error('Hoja Config no encontrada. Corré setupAll primero.');

  const FILAS_REQUERIDAS = [
    { label: 'Anthropic API Key',          cell: GF.CFG_ANTHROPIC_KEY_CELL },
    { label: 'Google Drive PDF Folder ID', cell: GF.CFG_PDF_FOLDER_CELL   }
  ];

  // Leer etiquetas existentes en columna A
  const lastRow = sh.getLastRow();
  const labelsExistentes = lastRow > 0
    ? sh.getRange(1, 1, lastRow, 1).getValues().map(function(r) {
        return String(r[0] || '').trim().toLowerCase();
      })
    : [];

  // Leer número de fila objetivo de cada celda (ej 'B18' → 18)
  const getRow = function(cellRef) {
    return parseInt(cellRef.replace(/[^0-9]/g, ''), 10);
  };

  let agregadas = 0;
  FILAS_REQUERIDAS.forEach(function(f) {
    const targetRow = getRow(f.cell);
    const yaExiste  = labelsExistentes.some(function(l) {
      return l === f.label.toLowerCase();
    });
    if (yaExiste) return;

    // Expandir hoja si hace falta
    if (sh.getMaxRows() < targetRow) {
      sh.insertRowsAfter(sh.getMaxRows(), targetRow - sh.getMaxRows());
    }
    // Solo escribir si la celda A está vacía
    const celdaA = sh.getRange(targetRow, 1);
    if (!String(celdaA.getValue() || '').trim()) {
      celdaA.setValue(f.label);
      agregadas++;
    }
  });

  const msg = agregadas > 0
    ? agregadas + ' fila(s) agregada(s) en Config.'
    : 'Config ya tenía todas las filas. Nada que agregar.';
  Logger.log('gf_ensureConfigTarjetas_: ' + msg);
  ss.toast(msg, 'Config Tarjetas', 5);
}


// ============ SHARE TEMP: CONFIG + SHEET ============
function gf_share_sheetName_() {
  return (typeof GF !== 'undefined' && GF.SHEET_SHARE_TOKENS_TMP)
    ? GF.SHEET_SHARE_TOKENS_TMP
    : '_ShareTokensTmp';
}

function gf_share_folderCell_() {
  return (typeof GF !== 'undefined' && GF.CFG_SHARE_TEMP_FOLDER_CELL)
    ? GF.CFG_SHARE_TEMP_FOLDER_CELL
    : 'B20';
}

function gf_share_ttlCell_() {
  return (typeof GF !== 'undefined' && GF.CFG_SHARE_TOKEN_TTL_HOURS_CELL)
    ? GF.CFG_SHARE_TOKEN_TTL_HOURS_CELL
    : 'B21';
}

function gf_share_maxSizeCell_() {
  return (typeof GF !== 'undefined' && GF.CFG_SHARE_MAX_SIZE_MB_CELL)
    ? GF.CFG_SHARE_MAX_SIZE_MB_CELL
    : 'B22';
}

function gf_share_headers_() {
  return [
    'token',
    'route',
    'fileId',
    'fileName',
    'mimeType',
    'sizeBytes',
    'createdAt',
    'expiresAt',
    'status',
    'openedAt',
    'source',
    'error'
  ];
}

function gf_ensureConfigShareTemp_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_CONFIG);
  if (!sh) throw new Error('Hoja Config no encontrada. Corré setupAll primero.');

  const filas = [
    { label: 'Share Temp Folder ID', cell: gf_share_folderCell_(), defaultValue: '' },
    { label: 'Share Token TTL horas', cell: gf_share_ttlCell_(), defaultValue: 24 },
    { label: 'Share Max Size MB', cell: gf_share_maxSizeCell_(), defaultValue: 10 }
  ];

  const lastRow = sh.getLastRow();
  const labelsExistentes = lastRow > 0
    ? sh.getRange(1, 1, lastRow, 1).getValues().map(function(r) {
        return String(r[0] || '').trim().toLowerCase();
      })
    : [];

  let agregadas = 0;
  filas.forEach(function(f) {
    const targetRow = parseInt(String(f.cell).replace(/[^0-9]/g, ''), 10);
    const yaExiste = labelsExistentes.some(function(l) {
      return l === String(f.label).trim().toLowerCase();
    });

    if (sh.getMaxRows() < targetRow) {
      sh.insertRowsAfter(sh.getMaxRows(), targetRow - sh.getMaxRows());
    }

    const celdaA = sh.getRange(targetRow, 1);
    const celdaB = sh.getRange(targetRow, 2);

    if (!yaExiste && !String(celdaA.getValue() || '').trim()) {
      celdaA.setValue(f.label);
      agregadas++;
    }
    if (celdaB.isBlank() && f.defaultValue !== '') {
      celdaB.setValue(f.defaultValue);
    }
  });

  sh.setColumnWidth(1, 220);
  sh.setColumnWidth(2, 320);

  const msg = agregadas > 0
    ? agregadas + ' fila(s) de Share Temp agregada(s) en Config.'
    : 'Config Share Temp ya estaba completo.';
  Logger.log('gf_ensureConfigShareTemp_: ' + msg);
  return { ok: true, addedRows: agregadas, message: msg };
}

function gf_ensureShareTempSheet_(ss) {
  ss = ss || SpreadsheetApp.getActive();
  const name = gf_share_sheetName_();
  const headers = gf_share_headers_();
  let sh = ss.getSheetByName(name);

  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    styleHeader_(sh, headers.length);
    try { sh.hideSheet(); } catch (_) {}
    return { sheet: name, action: 'created', headers: headers.length };
  }

  const lastCol = Math.max(sh.getLastColumn(), headers.length, 1);
  const current = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
    return String(h || '').trim();
  });
  const missing = headers.filter(function(h) { return current.indexOf(h) === -1; });

  if (missing.length) {
    if (sh.getMaxColumns() < current.length + missing.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(), current.length + missing.length - sh.getMaxColumns());
    }
    sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
  }

  sh.setFrozenRows(1);
  styleHeader_(sh, Math.max(sh.getLastColumn(), headers.length));
  try { sh.hideSheet(); } catch (_) {}

  return {
    sheet: name,
    action: missing.length ? 'migrated-added-cols' : 'ok',
    added: missing
  };
}

function gf_share_getTempConfig_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_CONFIG);
  if (!sh) throw new Error('Falta hoja Config.');

  const folderId = String(sh.getRange(gf_share_folderCell_()).getValue() || '').trim();
  const ttlHoursRaw = Number(sh.getRange(gf_share_ttlCell_()).getValue());
  const maxSizeRaw = Number(sh.getRange(gf_share_maxSizeCell_()).getValue());

  const ttlHours = (isFinite(ttlHoursRaw) && ttlHoursRaw > 0) ? ttlHoursRaw : 24;
  const maxSizeMB = (isFinite(maxSizeRaw) && maxSizeRaw > 0) ? maxSizeRaw : 10;

  if (!folderId) {
    throw new Error('Config incompleta: falta Share Temp Folder ID en ' + gf_share_folderCell_() + '.');
  }

  return {
    folderId: folderId,
    ttlHours: ttlHours,
    maxSizeMB: maxSizeMB,
    maxSizeBytes: Math.floor(maxSizeMB * 1024 * 1024)
  };
}

function gf_share_getTempFolder_() {
  const cfg = gf_share_getTempConfig_();
  try {
    return DriveApp.getFolderById(cfg.folderId);
  } catch (e) {
    throw new Error('No pude abrir la carpeta temporal de shares. Revisá el ID en Config (' + gf_share_folderCell_() + ').');
  }
}

function gf_share_generateToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function gf_share_getSheetCtx_() {
  const ss = SpreadsheetApp.getActive();
  gf_ensureShareTempSheet_(ss);
  const sh = ss.getSheetByName(gf_share_sheetName_());
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach(function(h, i) {
    idx[String(h || '').trim()] = i;
  });
  return { sheet: sh, headers: headers, idx: idx };
}

function gf_share_findTokenRow_(token) {
  const ctx = gf_share_getSheetCtx_();
  const tokenCol = (ctx.idx['token'] != null) ? (ctx.idx['token'] + 1) : 0;
  if (!tokenCol) throw new Error('La hoja de Share Temp no tiene columna token.');

  const lastRow = ctx.sheet.getLastRow();
  if (lastRow < 2) return null;

  const values = ctx.sheet.getRange(2, tokenCol, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === String(token || '').trim()) {
      return i + 2;
    }
  }
  return null;
}

function gf_share_assertRoute_(route) {
  const r = String(route || '').trim().toLowerCase();
  if (r !== 'comprobantes' && r !== 'tarjetas') {
    throw new Error('Ruta share inválida: ' + route);
  }
  return r;
}

// ============ SEED: DICCIONARIO DE ETIQUETAS ============
/**
 * Carga las 8 etiquetas predefinidas en la hoja Diccionario.
 * No destructiva: no inserta si el Valor ya existe.
 * Correr manualmente desde el editor de Apps Script.
 */
function gf_seedDiccionarioEtiquetas_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_DICT);
  if (!sh) throw new Error('Hoja Diccionario no encontrada. Corré setupAll primero.');

  const ETIQUETAS = [
    'rutina-trabajo',
    'rutina-casa',
    'salida',
    'viaje',
    'salud',
    'regalos',
    'auto',
    'hijos'
  ];

  // Leer valores existentes (columna Valor = índice 3, 1-based = 4)
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach((h, i) => { idx[String(h).trim()] = i; });

  if (idx['Valor'] === undefined || idx['Tipo'] === undefined || idx['Activo'] === undefined) {
    throw new Error('Diccionario: faltan columnas esperadas (Tipo, Valor, Activo)');
  }

  const existing = new Set();
  if (sh.getLastRow() >= 2) {
    const nRows = sh.getLastRow() - 1;
    const data = sh.getRange(2, 1, nRows, sh.getLastColumn()).getValues();
    data.forEach(row => {
      const tipo  = String(row[idx['Tipo']]  || '').trim();
      const valor = String(row[idx['Valor']] || '').trim();
      if (tipo === 'Etiqueta') existing.add(valor);
    });
  }

  const toInsert = ETIQUETAS.filter(e => !existing.has(e));

  if (toInsert.length === 0) {
    Logger.log('gf_seedDiccionarioEtiquetas_: todas las etiquetas ya existen, nada que insertar');
    ss.toast('Etiquetas ya presentes, nada insertado', 'Seed Diccionario', 4);
    return;
  }

  const ncols = headers.length;
  toInsert.forEach(etiqueta => {
    const row = new Array(ncols).fill('');
    row[idx['Tipo']]        = 'Etiqueta';
    row[idx['Categoria']]   = '';
    row[idx['Subcategoria']]= '';
    row[idx['Valor']]       = etiqueta;
    row[idx['Activo']]      = true;
    sh.appendRow(row);
  });

  Logger.log('gf_seedDiccionarioEtiquetas_: insertadas ' + toInsert.length + ' etiquetas: ' + toInsert.join(', '));
  ss.toast('Etiquetas insertadas: ' + toInsert.length, 'Seed Diccionario', 4);
}

// ============ SEED: PERCEPCIONES AUTO-EXCLUIR ============
/**
 * Carga los 3 patrones de percepciones en Tarjetas_Diccionario
 * con AccionDefault='ExcluirTotalmente'.
 * No destructiva: no inserta si el Patron ya existe.
 * Correr manualmente desde el editor de Apps Script.
 */
function gf_seedDiccionarioPercepcionesAutoExclude_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_DICT_APRENDIDO);
  if (!sh) throw new Error('Hoja Diccionario_Aprendido no encontrada. Corré setupAll primero.');

  const PERCEPCIONES = [
    { patron: 'DB.RG 5617',      descLimpia: 'Percepción RG 5617 30%',  notas: 'Auto-excluir: percepción AFIP' },
    { patron: 'IVA RG 4240',     descLimpia: 'Percepción IVA RG 4240',  notas: 'Auto-excluir: percepción IVA' },
    { patron: 'IIBB PERCEP-CABA',descLimpia: 'Percepción IIBB CABA',    notas: 'Auto-excluir: percepción ingresos brutos CABA' }
  ];

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach((h, i) => { idx[String(h).trim()] = i; });

  if (idx['Patron'] === undefined || idx['MapeoID'] === undefined) {
    throw new Error('Tarjetas_Diccionario: faltan columnas esperadas (MapeoID, Patron). Corré setupAll primero.');
  }

  // Leer patrones existentes
  const existing = new Set();
  if (sh.getLastRow() >= 2) {
    const nRows = sh.getLastRow() - 1;
    const patrones = sh.getRange(2, idx['Patron'] + 1, nRows, 1).getValues();
    patrones.forEach(r => {
      const p = String(r[0] || '').trim();
      if (p) existing.add(p.toUpperCase());
    });
  }

  const now = new Date();
  const ncols = headers.length;
  let insertados = 0;

  PERCEPCIONES.forEach(({ patron, descLimpia, notas }) => {
    if (existing.has(patron.toUpperCase())) return;

    const row = new Array(ncols).fill('');
    const set = (col, val) => { if (idx[col] !== undefined) row[idx[col]] = val; };

    set('MapeoID',          newId_('MAP'));
    set('Patron',           patron);
    set('TipoMatch',        'contains');
    set('BancoFiltro',      '');
    set('TarjetaFiltro',    '');
    set('DescripcionLimpia',descLimpia);
    set('Categoría',        '');
    set('Subcategoria',     '');
    set('Etiqueta',         '');
    set('PersonaDefault',   '');
    set('AccionDefault',    'ExcluirTotalmente');
    set('Confianza',        1);
    set('UsoCount',         0);
    set('UltimoUso',        '');
    set('Activo',           true);
    set('CreadoPor',        'Sistema');
    set('CreadoEn',         now);
    set('Notas',            notas);

    sh.appendRow(row);
    insertados++;
  });

  if (insertados === 0) {
    Logger.log('gf_seedDiccionarioPercepcionesAutoExclude_: todos los patrones ya existen');
    ss.toast('Percepciones ya presentes, nada insertado', 'Seed Diccionario', 4);
    return;
  }

  Logger.log('gf_seedDiccionarioPercepcionesAutoExclude_: insertados ' + insertados + ' patrones');
  ss.toast('Percepciones insertadas: ' + insertados, 'Seed Diccionario', 4);
}

// ============ HELPERS RECUPERADOS DE 1_Principal.js (commit e8fd1a6) ============
// Faltaban en el refactor a .gs. Necesarios para ResumenMes, Dash, Calendario.

function gf_norm_(v) {
  return (v ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'');
}

function gf_readSheet_(sh) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: [], rows: [] };
  const values = sh.getRange(1,1,lastRow,lastCol).getValues();
  const headers = values[0];
  const rows = values.slice(1).filter(r => r.some(v => v !== '' && v != null));
  return { headers, rows };
}

function gf_buildIdx_(headers) {
  const idx = {};
  headers.forEach((h,i)=>{ const k = gf_norm_(h); if (k) idx[k]=i; });
  return idx;
}

function gf_getOrCreateSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function gf_ensureHeaders_(sh, headers) {
  const lastCol = Math.max(sh.getLastColumn(), headers.length);
  const row1 = sh.getRange(1,1,1,lastCol).getValues()[0];
  const same = headers.every((h,i)=>gf_norm_(row1[i])===gf_norm_(h));
  if (!same) sh.getRange(1,1,1,headers.length).setValues([headers]);
  sh.setHiddenGridlines(true);
  sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground(GF_THEME.headerBg);
}

function gf_toYYYYMM_(v, tz) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM');
  const s = String(v).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const m1 = s.match(/^(\d{4})\D(\d{1,2})$/);
  if (m1) return `${m1[1]}-${String(Number(m1[2])).padStart(2,'0')}`;
  const m2 = s.match(/^(\d{1,2})\D(\d{4})$/);
  if (m2) return `${m2[2]}-${String(Number(m2[1])).padStart(2,'0')}`;
  return '';
}

function gf_nextMonthYYYYMM_(date, tz) {
  const d = new Date(date.getTime());
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return Utilities.formatDate(d, tz, 'yyyy-MM');
}

function gf_requireHeaders_(actualHeaders, expectedHeaders, sheetName) {
  const act = actualHeaders.map(gf_norm_);
  const missing = expectedHeaders.filter(h => !act.includes(gf_norm_(h)));
  if (missing.length) {
    throw new Error(`En "${sheetName}" faltan headers: ${missing.join(', ')}`);
  }
}

/**
 * Lista las filas de Historico que tienen el banco vacío.
 * No modifica nada, solo imprime en el log.
 */
function gf_listar_historico_sin_banco() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_HIST);
  if (!sh || sh.getLastRow() < 2) {
    Logger.log('Historico vacío o no existe');
    return;
  }

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach((h, i) => { idx[String(h).trim()] = i; });

  const need = ['Banco','Fecha','Descripción','Monto','Moneda','Persona','Tipo','Subtipo','Origen','ID'];
  const missing = need.filter(c => idx[c] === undefined);
  if (missing.length) {
    Logger.log('⚠ Faltan columnas en Historico: ' + missing.join(', '));
    Logger.log('Headers actuales: ' + headers.join(' | '));
    return;
  }

  const lastRow = sh.getLastRow();
  const data = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();

  const sinBanco = [];
  data.forEach((row, i) => {
    const banco = String(row[idx['Banco']] || '').trim();
    const fecha = row[idx['Fecha']];
    const desc  = row[idx['Descripción']];
    // ignoro filas totalmente vacías (sin fecha ni descripción ni monto)
    if (banco === '' && (fecha || desc || row[idx['Monto']])) {
      sinBanco.push({
        sheetRow: i + 2,
        id:       row[idx['ID']],
        fecha:    fecha,
        tipo:     row[idx['Tipo']],
        subtipo:  row[idx['Subtipo']],
        origen:   row[idx['Origen']],
        persona:  row[idx['Persona']],
        desc:     desc,
        monto:    row[idx['Monto']],
        moneda:   row[idx['Moneda']]
      });
    }
  });

  Logger.log('=== Historico SIN banco asignado: ' + sinBanco.length + ' filas ===');
  if (sinBanco.length === 0) {
    Logger.log('✓ No hay filas problemáticas. Todo limpio.');
    return;
  }

  // Agrupar por origen para ver qué workflow las creó
  const porOrigen = {};
  sinBanco.forEach(r => {
    const k = r.origen || '(sin origen)';
    porOrigen[k] = (porOrigen[k] || 0) + 1;
  });
  Logger.log('--- Distribución por Origen ---');
  Object.keys(porOrigen).sort().forEach(k => {
    Logger.log('  ' + k + ': ' + porOrigen[k]);
  });

  // Listado completo
  Logger.log('--- Detalle ---');
  sinBanco.forEach(r => {
    const fechaStr = r.fecha instanceof Date
      ? Utilities.formatDate(r.fecha, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(r.fecha || '');
    Logger.log(
      'fila ' + r.sheetRow +
      ' | ' + fechaStr +
      ' | ' + (r.tipo || '') + '/' + (r.subtipo || '') +
      ' | ' + (r.persona || '') +
      ' | ' + (r.desc || '') +
      ' | ' + (r.moneda || '') + ' ' + (r.monto || '') +
      ' | origen=' + (r.origen || '') +
      ' | ID=' + (r.id || '')
    );
  });
  Logger.log('=== FIN ===');
}

/**************************************
 * FASE 3.a — MIGRACIÓN DE HOJAS
 * Renombra Obligaciones → GastosEsperados
 *          IngresosPlantilla → IngresosEsperados
 * NO DESTRUCTIVA: solo renombra la hoja física, no toca datos.
 **************************************/

// Hojas requeridas por el sistema tras Fase 3.a (excluyendo las legacy deprecated)
const GF_HOJAS_REQUERIDAS_ = [
  'Config', 'Log', 'Usuarios', 'Diccionario', 'TC_Diario',
  'Carga', 'Historico', 'Futuros_Eventuales', 'Gastos_Manuales',
  'ResumenMes', 'Dash_Mensual', 'Dash_Anual', 'Vista_Reportes',
  'GastosEsperados', 'IngresosEsperados',
  'Tarjetas_Resumen', 'Tarjetas_Raw', 'Tarjetas_Movimientos', 'Diccionario_Aprendido',
  'Dash_Cache'
];

// Hojas legacy conocidas, no requeridas por el sistema actual pero que se mantienen
// intencionalmente hasta que la fase correspondiente las procese.
const GF_HOJAS_LEGACY_CONOCIDAS_ = [
  'Tarjetas_Diccionario',  // Fase 3.0: renombrar a Diccionario_Aprendido con migración
  'Diccionario GFM'        // Fase 3.0: borrar (vacía, legacy V2)
];

function _auditarHojas_(ss) {
  const existentes = ss.getSheets().map(s => s.getName());
  const lineas = ['--- Auditoría de hojas del sistema ---'];
  GF_HOJAS_REQUERIDAS_.forEach(nombre => {
    if (existentes.indexOf(nombre) >= 0) {
      lineas.push(`  ✅ ${nombre}`);
    } else {
      lineas.push(`  ❌ FALTA: ${nombre}`);
    }
  });
  // Hojas legacy que deberían haber desaparecido
  ['Obligaciones', 'IngresosPlantilla'].forEach(nombre => {
    if (existentes.indexOf(nombre) >= 0) {
      lineas.push(`  ⚠️ LEGACY aún presente: ${nombre} (pendiente renombrar)`);
    }
  });
  // Hojas que existen pero no están en el catálogo
  const conocidas = GF_HOJAS_REQUERIDAS_
    .concat(['Obligaciones', 'IngresosPlantilla'])
    .concat(GF_HOJAS_LEGACY_CONOCIDAS_);
  const extras = existentes.filter(n => conocidas.indexOf(n) < 0);
  if (extras.length) {
    lineas.push('--- Hojas no reconocidas (no requeridas por el sistema) ---');
    extras.forEach(n => lineas.push(`  ❓ EXTRA: ${n}`));
  }
  return lineas;
}

/**
 * Prepopula GastosEsperados e IngresosEsperados desde las filas activas de
 * Obligaciones/GastosEsperados (schema viejo) e IngresosPlantilla/IngresosEsperados.
 * Lee Categoría/Subcategoria/Etiqueta/MontoDefault/DiaSugerido de las filas con Activo=true.
 * Escribe las filas en el nuevo schema (Activo|Categoria|Subcategoria|Etiqueta|MontoEsperado|DiaVencimiento|Notas).
 * NO destructivo: solo escribe si la hoja destino tiene ≤1 fila (solo header o vacía).
 */
function gf_prepopularEsperados_PREVIEW() {
  _prepopularEsperados_(true);
}
function gf_prepopularEsperados_APLICAR() {
  _prepopularEsperados_(false);
}

function _prepopularEsperados_(dryRun) {
  const ss = SpreadsheetApp.getActive();
  const pares = [
    {
      src:  ['GastosEsperados', 'Obligaciones'],
      dst:  'GastosEsperados',
      tipo: 'Gasto'
    },
    {
      src:  ['IngresosEsperados', 'IngresosPlantilla'],
      dst:  'IngresosEsperados',
      tipo: 'Ingreso'
    }
  ];

  const lineas = [dryRun
    ? '=== PREVIEW: prepopular GastosEsperados / IngresosEsperados ==='
    : '=== APLICAR: prepopular GastosEsperados / IngresosEsperados ==='];

  pares.forEach(function(par) {
    // Buscar hoja fuente (puede tener cualquiera de los dos nombres)
    var shSrc = null;
    par.src.forEach(function(n) { if (!shSrc) shSrc = ss.getSheetByName(n); });
    var shDst = ss.getSheetByName(par.dst);

    if (!shSrc) {
      lineas.push('❌ ' + par.dst + ': no se encontró hoja fuente (' + par.src.join(' / ') + ')');
      return;
    }
    if (!shDst) {
      lineas.push('❌ ' + par.dst + ': hoja destino no existe');
      return;
    }

    // Leer filas activas de la fuente
    const rows = gf_readObjectsFromSheet_(shSrc);
    const activas = rows.filter(function(r) { return gf_boolOrDefault_(r['Activo'], false); });

    // Convertir al nuevo schema
    const nuevas = activas.map(function(r) {
      return {
        'Activo':         true,
        'Categoria':      String(r['Categoría'] || r['Categoria'] || '').trim(),
        'Subcategoria':   String(r['Subcategoria'] || '').trim(),
        'Etiqueta':       String(r['Etiqueta'] || '').trim(),
        'Moneda':         String(r['Moneda'] || 'ARS').trim() || 'ARS',
        'Banco':          String(r['Banco'] || '').trim(),
        'MontoEsperado':  Number(r['MontoDefault']) || '',
        'DiaVencimiento': Number(r['DiaSugerido']) || '',
        'Notas':          String(r['Notas'] || r['Descripción'] || '').trim()
      };
    }).filter(function(r) { return r['Categoria']; }); // descarta filas sin categoría

    lineas.push('');
    lineas.push('--- ' + par.dst + ' (' + activas.length + ' filas activas → ' + nuevas.length + ' con Categoria) ---');

    if (!dryRun) {
      const lastRow = shDst.getLastRow();
      if (lastRow > 1) {
        lineas.push('⚠️ La hoja ya tiene datos (' + (lastRow - 1) + ' filas). No se sobreescribe. Borrá las filas manualmente y volvé a correr.');
        return;
      }
      // Escribir headers si la hoja está vacía
      if (lastRow === 0) {
        shDst.appendRow(GF_GASTOS_ESP_HEADERS);
      }
      if (nuevas.length) {
        gf_writeObjectsToSheet_(shDst, nuevas, { startRow: 2, clear: false });
        lineas.push('✅ ' + nuevas.length + ' filas escritas en ' + par.dst);
      } else {
        lineas.push('⚠️ Sin filas para escribir');
      }
    } else {
      nuevas.forEach(function(r) {
        lineas.push('  · ' + r['Categoria'] + ' / ' + r['Subcategoria'] +
          (r['Etiqueta'] ? ' [' + r['Etiqueta'] + ']' : '') +
          (r['MontoEsperado'] ? ' · $' + r['MontoEsperado'] : '') +
          (r['DiaVencimiento'] ? ' · día ' + r['DiaVencimiento'] : ''));
      });
    }
  });

  lineas.push('');
  lineas.push(dryRun ? 'Corré gf_prepopularEsperados_APLICAR para aplicar.' : '=== FIN ===');
  Logger.log(lineas.join('\n'));
  SpreadsheetApp.getUi().alert(lineas.join('\n'));
}

/**
 * PREVIEW: muestra qué hojas se van a renombrar y audita el estado completo.
 * No modifica nada.
 */
function gf_renombrarHojasFase3_PREVIEW() {
  const ss = SpreadsheetApp.getActive();
  const pares = [
    ['Obligaciones',      'GastosEsperados'],
    ['IngresosPlantilla', 'IngresosEsperados']
  ];
  const lineas = ['=== PREVIEW: renombrar hojas Fase 3.a ==='];
  pares.forEach(([viejo, nuevo]) => {
    const sh = ss.getSheetByName(viejo);
    if (sh) {
      const filas = Math.max(0, sh.getLastRow() - 1);
      lineas.push(`  ✅ "${viejo}" → "${nuevo}"  (${filas} filas de datos)`);
    } else {
      const yaExiste = ss.getSheetByName(nuevo);
      if (yaExiste) {
        lineas.push(`  ⚠️ "${viejo}" no existe; "${nuevo}" ya existe — OK`);
      } else {
        lineas.push(`  ❌ "${viejo}" no existe y "${nuevo}" tampoco — revisá el Sheet`);
      }
    }
  });
  lineas.push('');
  lineas.push(..._auditarHojas_(ss));
  lineas.push('');
  lineas.push('Corré gf_renombrarHojasFase3_APLICAR para aplicar.');
  Logger.log(lineas.join('\n'));
  SpreadsheetApp.getUi().alert(lineas.join('\n'));
}

/**
 * APLICAR: renombra las hojas físicas y verifica el estado final.
 * Solo toca el nombre, no modifica columnas ni datos.
 * Idempotente: si el destino ya existe con ese nombre, lo omite.
 */
function gf_renombrarHojasFase3_APLICAR() {
  const ss = SpreadsheetApp.getActive();
  const pares = [
    ['Obligaciones',      'GastosEsperados'],
    ['IngresosPlantilla', 'IngresosEsperados']
  ];
  const lineas = ['=== APLICAR: renombrar hojas Fase 3.a ==='];
  pares.forEach(([viejo, nuevo]) => {
    const shViejo = ss.getSheetByName(viejo);
    const shNuevo = ss.getSheetByName(nuevo);
    if (shNuevo) {
      lineas.push(`  ⚠️ "${nuevo}" ya existe — omitido`);
    } else if (shViejo) {
      shViejo.setName(nuevo);
      lineas.push(`  ✅ "${viejo}" renombrada a "${nuevo}"`);
    } else {
      lineas.push(`  ❌ "${viejo}" no existe — no se puede renombrar`);
    }
  });
  lineas.push('');
  lineas.push(..._auditarHojas_(ss));
  lineas.push('=== FIN ===');
  Logger.log(lineas.join('\n'));
  SpreadsheetApp.getUi().alert(lineas.join('\n'));
}

/**************************************
 * FASE 3.0 — MIGRACIÓN DICCIONARIO APRENDIDO
 * Renombra Tarjetas_Diccionario → Diccionario_Aprendido
 * Agrega columna Origen con default 'Tarjeta' para filas existentes
 * Borra hoja Diccionario GFM (solo si está vacía)
 **************************************/

function gf_renombrarDiccionarioFase3_PREVIEW() {
  _migrarDiccionario_(true);
}
function gf_renombrarDiccionarioFase3_APLICAR() {
  _migrarDiccionario_(false);
}

function _migrarDiccionario_(dryRun) {
  const ss = SpreadsheetApp.getActive();
  const lineas = [dryRun
    ? '=== PREVIEW: migración Diccionario_Aprendido (Fase 3.0) ==='
    : '=== APLICAR: migración Diccionario_Aprendido (Fase 3.0) ==='];

  // --- Paso 1: renombrar Tarjetas_Diccionario → Diccionario_Aprendido ---
  const shViejo = ss.getSheetByName('Tarjetas_Diccionario');
  const shNuevo = ss.getSheetByName('Diccionario_Aprendido');

  if (shNuevo) {
    lineas.push('⚠️ "Diccionario_Aprendido" ya existe — renombre omitido');
  } else if (shViejo) {
    const filas = Math.max(0, shViejo.getLastRow() - 1);
    lineas.push('✅ "Tarjetas_Diccionario" → "Diccionario_Aprendido"  (' + filas + ' filas de datos)');
    if (!dryRun) shViejo.setName('Diccionario_Aprendido');
  } else {
    lineas.push('❌ "Tarjetas_Diccionario" no existe — revisá el Sheet');
  }

  // --- Paso 2: agregar columna Origen si no existe ---
  const shTarget = dryRun ? (shViejo || shNuevo) : ss.getSheetByName('Diccionario_Aprendido');
  if (shTarget && shTarget.getLastRow() >= 1) {
    const headers = shTarget.getRange(1, 1, 1, shTarget.getLastColumn()).getValues()[0];
    const idx = {};
    headers.forEach(function(h, i) { idx[String(h).trim()] = i; });

    if (idx['Origen'] !== undefined) {
      lineas.push('⚠️ Columna "Origen" ya existe — omitido');
    } else {
      const activoCol = (idx['Activo'] !== undefined) ? idx['Activo'] + 1 : shTarget.getLastColumn();
      const insertCol = activoCol + 1;
      const filas = Math.max(0, shTarget.getLastRow() - 1);
      lineas.push('✅ Agregar columna "Origen" (después de "Activo"), default "Tarjeta" en ' + filas + ' filas');
      if (!dryRun) {
        shTarget.insertColumnAfter(activoCol);
        shTarget.getRange(1, insertCol).setValue('Origen');
        if (filas > 0) {
          const vals = Array(filas).fill(['Tarjeta']);
          shTarget.getRange(2, insertCol, filas, 1).setValues(vals);
        }
      }
    }
  }

  // --- Paso 3: borrar Diccionario GFM si está vacía ---
  const shGFM = ss.getSheetByName('Diccionario GFM');
  if (!shGFM) {
    lineas.push('ℹ️ "Diccionario GFM" no existe — nada que borrar');
  } else {
    const filasGFM = Math.max(0, shGFM.getLastRow() - 1);
    if (filasGFM > 0) {
      lineas.push('⚠️ "Diccionario GFM" tiene ' + filasGFM + ' filas — NO se borra. Revisá manualmente.');
    } else {
      lineas.push('✅ "Diccionario GFM" está vacía — ' + (dryRun ? 'se borrará al aplicar' : 'borrada'));
      if (!dryRun) ss.deleteSheet(shGFM);
    }
  }

  lineas.push('');
  lineas.push(..._auditarHojas_(ss));
  lineas.push(dryRun ? '\nCorré gf_renombrarDiccionarioFase3_APLICAR para aplicar.' : '=== FIN ===');
  Logger.log(lineas.join('\n'));
  SpreadsheetApp.getUi().alert(lineas.join('\n'));
}

// ============ SEED: CATEGORÍA TARJETAS (Bloque C) ============
/**
 * Inserta en el Diccionario canónico la categoría "Tarjetas" y sus 4 subcategorías.
 * No destructiva. Correr desde el editor o incluir en setupAll.
 */
function gf_seedDiccionarioTarjetas_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_DICT);
  if (!sh) throw new Error('Hoja Diccionario no encontrada. Corré setupAll primero.');

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach((h, i) => { idx[String(h).trim()] = i; });
  if (idx['Tipo'] === undefined || idx['Valor'] === undefined || idx['Activo'] === undefined) {
    throw new Error('Diccionario: faltan columnas Tipo, Valor, Activo');
  }

  const ENTRADAS = [
    { tipo: 'Categoria',    categoria: '',         valor: 'Tarjetas' },
    { tipo: 'Subcategoria', categoria: 'Tarjetas', valor: 'Visa Galicia' },
    { tipo: 'Subcategoria', categoria: 'Tarjetas', valor: 'Mastercard Galicia' },
    { tipo: 'Subcategoria', categoria: 'Tarjetas', valor: 'Visa BBVA' },
    { tipo: 'Subcategoria', categoria: 'Tarjetas', valor: 'Mastercard BBVA' },
  ];

  const existing = new Set();
  if (sh.getLastRow() >= 2) {
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    data.forEach(row => {
      const t = String(row[idx['Tipo']]  || '').trim();
      const v = String(row[idx['Valor']] || '').trim();
      existing.add(t + '||' + v);
    });
  }

  const ncols = headers.length;
  let insertados = 0;
  ENTRADAS.forEach(({ tipo, categoria, valor }) => {
    if (existing.has(tipo + '||' + valor)) return;
    const row = new Array(ncols).fill('');
    row[idx['Tipo']]   = tipo;
    row[idx['Valor']]  = valor;
    row[idx['Activo']] = true;
    if (idx['Categoria'] !== undefined) row[idx['Categoria']] = categoria;
    sh.appendRow(row);
    insertados++;
  });

  Logger.log('gf_seedDiccionarioTarjetas_: insertadas ' + insertados + ' entradas');
  ss.toast('Diccionario Tarjetas: ' + insertados + ' entradas insertadas', 'Seed', 4);
}

// ============ MIGRACIÓN: Lectura B bifurcada (Bloque C.4) ============
function gf_migrarImputacionTarjetas_PREVIEW() { gf_migrarImputacionTarjetas_(true); }
function gf_migrarImputacionTarjetas_APLICAR()  { gf_migrarImputacionTarjetas_(false); }

function gf_migrarImputacionTarjetas_(dryRun) {
  const ss  = SpreadsheetApp.getActive();
  const shH = ss.getSheetByName(GF.SHEET_HIST);
  if (!shH) throw new Error('Hoja Historico no encontrada');
  const shRes = ss.getSheetByName(GF.SHEET_TARJETAS_RESUMEN);

  const hHist = shH.getRange(1, 1, 1, shH.getLastColumn()).getValues()[0];
  const iH = {};
  hHist.forEach((h, i) => { iH[String(h).trim()] = i; });

  const need = ['Subtipo','Fecha','FechaConsumoOriginal','Pagado','FlagResumenMes','Mes','Día','ResumenTarjetaID'];
  for (const c of need) {
    if (iH[c] === undefined) throw new Error('Historico: falta columna ' + c);
  }

  const data = shH.getLastRow() > 1
    ? shH.getRange(2, 1, shH.getLastRow() - 1, shH.getLastColumn()).getValues()
    : [];

  const lineas = [dryRun ? '=== PREVIEW migración Lectura B ===' : '=== APLICANDO migración Lectura B ==='];
  let consumosMod = 0;
  const resumenesConPago = new Set();

  // Paso 1: Actualizar filas TarjetaDetalleImportado
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (String(row[iH['Subtipo']] || '').trim() !== 'TarjetaDetalleImportado') continue;

    const fechaConsumo = row[iH['FechaConsumoOriginal']];
    const fechaActual  = row[iH['Fecha']];
    const fechaUsar    = (fechaConsumo instanceof Date) ? fechaConsumo : fechaActual;
    const mesUsar      = (fechaUsar instanceof Date) ? yyyymm_(fechaUsar) : String(row[iH['Mes']] || '');
    const diaUsar      = (fechaUsar instanceof Date) ? fechaUsar.getDate() : row[iH['Día']];
    const resID        = String(row[iH['ResumenTarjetaID']] || '').trim();

    lineas.push('Fila ' + (i + 2) + ': ' + String(row[iH['Descripción'] !== undefined ? iH['Descripción'] : 0] || '').substring(0, 40)
      + ' | Fecha: ' + (fechaActual instanceof Date ? Utilities.formatDate(fechaActual, 'America/Argentina/Buenos_Aires', 'dd/MM/yy') : '?')
      + ' → ' + (fechaUsar instanceof Date ? Utilities.formatDate(fechaUsar, 'America/Argentina/Buenos_Aires', 'dd/MM/yy') : '?'));

    if (!dryRun) {
      shH.getRange(i + 2, iH['Subtipo']        + 1).setValue('TarjetaConsumo');
      shH.getRange(i + 2, iH['Fecha']           + 1).setValue(fechaUsar);
      shH.getRange(i + 2, iH['Pagado']          + 1).setValue(true);
      shH.getRange(i + 2, iH['FlagResumenMes']  + 1).setValue(false);
      shH.getRange(i + 2, iH['Mes']             + 1).setValue(mesUsar);
      shH.getRange(i + 2, iH['Día']             + 1).setValue(diaUsar);
    }

    consumosMod++;
    if (resID) resumenesConPago.add(resID);
  }

  lineas.push('');
  lineas.push('Consumos a modificar: ' + consumosMod);

  // Paso 2: Generar filas TarjetaPago por resumen
  let pagosGenerados = 0;
  if (shRes && resumenesConPago.size > 0) {
    const hRes = shRes.getRange(1, 1, 1, shRes.getLastColumn()).getValues()[0];
    const iRes = {};
    hRes.forEach((h, i) => { iRes[String(h).trim()] = i; });

    const resData = shRes.getLastRow() > 1
      ? shRes.getRange(2, 1, shRes.getLastRow() - 1, shRes.getLastColumn()).getValues()
      : [];

    // Leer IDs de TarjetaPago existentes en Historico para evitar duplicados
    const pagosExistentes = new Set();
    data.forEach(row => {
      if (String(row[iH['Subtipo']] || '').trim() === 'TarjetaPago') {
        const rid = String(row[iH['ResumenTarjetaID']] || '').trim();
        const mon = String(iH['Moneda'] !== undefined ? row[iH['Moneda']] : '').trim();
        if (rid) pagosExistentes.add(rid + '||' + mon);
      }
    });

    const now = new Date();
    const pagoBatch = [];

    for (const resID of resumenesConPago) {
      const resRow = resData.find(r => String(r[iRes['ResumenID']] || '').trim() === resID);
      if (!resRow) { lineas.push('⚠️ ResumenID no encontrado en Tarjetas_Resumen: ' + resID); continue; }

      const totalARS  = Number(iRes['TotalARS'] !== undefined ? resRow[iRes['TotalARS']] : 0) || 0;
      const totalUSD  = Number(iRes['TotalUSD'] !== undefined ? resRow[iRes['TotalUSD']] : 0) || 0;
      const fechaVenc = iRes['FechaVencimiento'] !== undefined ? resRow[iRes['FechaVencimiento']] : null;
      const banco     = String(iRes['Banco']   !== undefined ? resRow[iRes['Banco']]   : '').trim();
      const tarjeta   = String(iRes['Tarjeta'] !== undefined ? resRow[iRes['Tarjeta']] : '').trim();

      if (!(fechaVenc instanceof Date)) { lineas.push('⚠️ FechaVencimiento inválida para ' + resID); continue; }

      // Buscar PERCEP.AFIP 4815 en datos ya procesados para este resumen
      const rePercep = /percep.*4815|4815.*percep/i;
      let percepMonto = 0;
      if (iH['Descripción'] !== undefined && iH['Monto'] !== undefined) {
        data.forEach(r => {
          if (String(r[iH['ResumenTarjetaID']] || '').trim() !== resID) return;
          if (String(r[iH['Subtipo']] || '').trim() !== 'TarjetaDetalleImportado') return;
          const desc = String(r[iH['Descripción']] || '');
          if (rePercep.test(desc)) {
            const m = Number(r[iH['Monto']]) || 0;
            if (m > 0) percepMonto += m;
          }
        });
      }
      const totalARSAjustado = Math.max(0, totalARS - percepMonto);

      function buildPagoMig(moneda, monto, sufijo) {
        const row = new Array(hHist.length).fill('');
        const set = (col, val) => { if (iH[col] !== undefined && val != null) row[iH[col]] = val; };
        set('ID',               newId_('HIS'));
        set('ParentID',         resID);
        set('Tipo',             'Gasto');
        set('Subtipo',          'TarjetaPago');
        set('Origen',           'ImportTarjeta');
        set('Descripción',      'Pago ' + tarjeta + ' ' + banco + ' ' + sufijo);
        set('Categoría',        'Tarjetas');
        set('Subcategoria',     tarjeta + ' ' + banco);
        set('Banco',            banco);
        set('Tarjeta',          tarjeta);
        set('Moneda',           moneda);
        set('Monto',            monto);
        set('Fecha',            fechaVenc);
        set('Día',              fechaVenc.getDate());
        set('Mes',              yyyymm_(fechaVenc));
        set('Pagado',           false);
        set('FlagResumenMes',   true);
        set('ExcluirDash',      true);
        set('EstadoRegistro',   'Importado');
        set('ResumenTarjetaID', resID);
        set('CreatedAt',        now);
        set('UpdatedAt',        now);
        return row;
      }

      if (totalARSAjustado && !pagosExistentes.has(resID + '||ARS')) {
        lineas.push('  → TarjetaPago ARS $' + totalARSAjustado + (percepMonto ? ' (ajustado -$' + percepMonto + ' PERCEP 4815)' : '') + ' | ' + resID);
        pagoBatch.push(buildPagoMig('ARS', totalARSAjustado, 'ARS'));
        pagosGenerados++;
      }
      if (totalUSD && !pagosExistentes.has(resID + '||USD')) {
        lineas.push('  → TarjetaPago USD $' + totalUSD + ' | ' + resID);
        pagoBatch.push(buildPagoMig('USD', totalUSD, 'USD'));
        pagosGenerados++;
      }
    }

    if (!dryRun && pagoBatch.length > 0) {
      shH.getRange(shH.getLastRow() + 1, 1, pagoBatch.length, hHist.length).setValues(pagoBatch);
    }
  }

  lineas.push('Filas TarjetaPago a generar: ' + pagosGenerados);
  lineas.push(dryRun ? '\nCorré gf_migrarImputacionTarjetas_APLICAR para aplicar.' : '=== FIN ===');
  Logger.log(lineas.join('\n'));
  SpreadsheetApp.getUi().alert(lineas.join('\n'));
}

/** Devuelve true si la categoría dada es de tipo Ingreso. */
function gf_esIngreso_(cat) {
  if (!cat) return false;
  return (GF.CATS_INGRESO || []).indexOf(String(cat).trim()) >= 0;
}
/** @deprecated usar gf_esIngreso_ */
function gf_esCategoriaIngreso_(cat) { return gf_esIngreso_(cat); }
