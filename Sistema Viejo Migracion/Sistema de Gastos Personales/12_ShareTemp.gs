/**************************************
 * 12_ShareTemp.gs
 * - Upload temporal de PDFs compartidos
 * - Guarda archivo en Drive
 * - Registra token en _ShareTokensTmp
 * - Devuelve payload por token para Comprobantes/Tarjetas
 **************************************/

function gf_share_handleUploadRequest_(request) {
  request = request || {};

  const route = gf_share_assertRoute_(request.route || request.view || 'comprobantes');
  const source = String(request.source || request.shareSource || 'firebase-pwa').trim() || 'firebase-pwa';
  const fileName = gf_share_sanitizeFileName_(request.fileName || request.name || 'archivo.pdf');
  const mimeType = gf_share_normalizeMimeType_(request.mimeType || request.type || 'application/pdf');
  const base64 = gf_share_extractBase64_(request.base64 || request.pdfBase64 || request.fileBase64 || '');
  const cfg = gf_share_getTempConfig_();

  if (!base64) {
    throw new Error('No llegó el archivo base64 en la solicitud share-upload.');
  }

  var GF_SHARE_ALLOWED_MIME_ = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  if (GF_SHARE_ALLOWED_MIME_.indexOf(mimeType) === -1) {
    throw new Error('Tipo no soportado. Se aceptan PDF, JPEG, PNG y WebP.');
  }

  const estimatedSize = gf_share_base64SizeBytes_(base64);
  if (estimatedSize <= 0) {
    throw new Error('No pude determinar el tamaño del archivo compartido.');
  }
  if (estimatedSize > cfg.maxSizeBytes) {
    throw new Error('El archivo supera el máximo permitido de ' + cfg.maxSizeMB + ' MB.');
  }

  const bytes = Utilities.base64Decode(base64);
  const sizeBytes = bytes.length;
  if (!sizeBytes) {
    throw new Error('El archivo compartido llegó vacío.');
  }
  if (sizeBytes > cfg.maxSizeBytes) {
    throw new Error('El archivo supera el máximo permitido de ' + cfg.maxSizeMB + ' MB.');
  }

  const token = gf_share_generateUniqueToken_();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + cfg.ttlHours * 60 * 60 * 1000);
  const folder = gf_share_getTempFolder_();
  const driveFileName = gf_share_buildDriveFileName_(token, route, fileName);

  let file;
  try {
    const blob = Utilities.newBlob(bytes, mimeType, driveFileName);
    file = folder.createFile(blob);
    try {
      file.setDescription(JSON.stringify({
        system: 'Gastos Familia',
        token: token,
        route: route,
        source: source,
        originalName: fileName,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString()
      }));
    } catch (_) {}
  } catch (e) {
    gf_logError_('gf_share_handleUploadRequest_:createFile', e);
    throw new Error('No pude guardar el archivo temporal en Drive.');
  }

  try {
    gf_share_appendTokenRow_({
      token: token,
      route: route,
      fileId: file.getId(),
      fileName: fileName,
      mimeType: mimeType,
      sizeBytes: sizeBytes,
      createdAt: now,
      expiresAt: expiresAt,
      status: 'ready',
      openedAt: '',
      source: source,
      error: ''
    });
  } catch (e) {
    gf_logError_('gf_share_handleUploadRequest_:appendRow', e);
    try { file.setTrashed(true); } catch (_) {}
    throw new Error('No pude registrar el token temporal del archivo compartido.');
  }

  return {
    ok: true,
    shareToken: token,
    route: route,
    fileName: fileName,
    mimeType: mimeType,
    sizeBytes: sizeBytes,
    createdAtMs: now.getTime(),
    expiresAtMs: expiresAt.getTime(),
    source: source
  };
}

function gf_share_getPayloadByToken_(shareToken, expectedRoute) {
  const meta = gf_share_getTokenMeta_(shareToken, expectedRoute);
  const fileId = String(meta.fileId || '').trim();
  if (!fileId) {
    throw new Error('El token no tiene archivo asociado.');
  }

  let file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    gf_share_updateTokenFields_(shareToken, { status: 'error', error: 'Archivo temporal inexistente en Drive' });
    throw new Error('No encontré el archivo temporal asociado al token.');
  }

  const blob = file.getBlob();
  const bytes = blob.getBytes();
  if (!bytes || !bytes.length) {
    gf_share_updateTokenFields_(shareToken, { status: 'error', error: 'Archivo temporal vacío' });
    throw new Error('El archivo temporal está vacío.');
  }

  const base64 = Utilities.base64Encode(bytes);
  const openedAt = new Date();

  gf_share_updateTokenFields_(shareToken, {
    status: 'opened',
    openedAt: openedAt,
    error: ''
  });

  return {
    ok: true,
    token: String(meta.token || shareToken),
    route: String(meta.route || ''),
    fileName: String(meta.fileName || file.getName() || 'archivo.pdf'),
    mimeType: gf_share_normalizeMimeType_(meta.mimeType || blob.getContentType() || 'application/pdf'),
    sizeBytes: Number(meta.sizeBytes) || bytes.length,
    source: String(meta.source || ''),
    base64: base64
  };
}

function gf_share_getTokenMeta_(shareToken, expectedRoute) {
  const token = String(shareToken || '').trim();
  if (!token) throw new Error('Token share vacío.');

  const routeExpected = expectedRoute ? gf_share_assertRoute_(expectedRoute) : '';
  const ctx = gf_share_getSheetCtx_();
  const row = gf_share_findTokenRow_(token);
  if (!row) throw new Error('El token no existe o ya fue eliminado.');

  const values = ctx.sheet.getRange(row, 1, 1, ctx.headers.length).getValues()[0];
  const meta = gf_share_rowToObject_(ctx.headers, values);

  const route = gf_share_assertRoute_(meta.route);
  if (routeExpected && route !== routeExpected) {
    throw new Error('El token pertenece a otra pantalla.');
  }

  const status = String(meta.status || '').trim().toLowerCase();
  if (status === 'expired') {
    throw new Error('El token ya venció.');
  }
  if (status === 'deleted') {
    throw new Error('El token ya fue eliminado.');
  }

  const expiresAt = gf_share_toDate_(meta.expiresAt);
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    gf_share_updateTokenFields_(token, { status: 'expired', error: '' });
    throw new Error('El token venció.');
  }

  return {
    row: row,
    token: token,
    route: route,
    fileId: String(meta.fileId || '').trim(),
    fileName: String(meta.fileName || '').trim(),
    mimeType: String(meta.mimeType || '').trim(),
    sizeBytes: Number(meta.sizeBytes) || 0,
    createdAt: gf_share_toDate_(meta.createdAt),
    expiresAt: expiresAt,
    status: String(meta.status || '').trim(),
    openedAt: gf_share_toDate_(meta.openedAt),
    source: String(meta.source || '').trim(),
    error: String(meta.error || '').trim()
  };
}

function gf_share_cleanupExpired_() {
  const ctx = gf_share_getSheetCtx_();
  const sh = ctx.sheet;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    return { ok: true, reviewed: 0, expired: 0, deletedFiles: 0, rows: 0 };
  }

  const data = sh.getRange(2, 1, lastRow - 1, ctx.headers.length).getValues();
  const nowMs = Date.now();
  let expired = 0;
  let deletedFiles = 0;

  for (var i = 0; i < data.length; i++) {
    const rowNum = i + 2;
    const obj = gf_share_rowToObject_(ctx.headers, data[i]);
    const status = String(obj.status || '').trim().toLowerCase();
    const expiresAt = gf_share_toDate_(obj.expiresAt);
    const fileId = String(obj.fileId || '').trim();

    if (!expiresAt || expiresAt.getTime() >= nowMs) continue;
    if (status === 'expired' || status === 'deleted') continue;

    try {
      if (fileId) {
        try {
          DriveApp.getFileById(fileId).setTrashed(true);
          deletedFiles++;
        } catch (_) {}
      }

      gf_share_updateTokenFieldsByRow_(ctx, rowNum, {
        status: 'expired',
        error: '',
        openedAt: obj.openedAt || ''
      });
      expired++;
    } catch (e) {
      gf_logError_('gf_share_cleanupExpired_', e);
    }
  }

  return {
    ok: true,
    reviewed: data.length,
    expired: expired,
    deletedFiles: deletedFiles,
    rows: data.length
  };
}

function gf_share_debugGetTokenMeta_(shareToken) {
  const meta = gf_share_getTokenMeta_(shareToken);
  return {
    ok: true,
    token: meta.token,
    route: meta.route,
    fileId: meta.fileId,
    fileName: meta.fileName,
    mimeType: meta.mimeType,
    sizeBytes: meta.sizeBytes,
    createdAt: meta.createdAt,
    expiresAt: meta.expiresAt,
    status: meta.status,
    openedAt: meta.openedAt,
    source: meta.source,
    error: meta.error
  };
}

function gf_share_deleteTokenNow_(shareToken) {
  const meta = gf_share_getTokenMeta_(shareToken);
  if (meta.fileId) {
    try { DriveApp.getFileById(meta.fileId).setTrashed(true); } catch (_) {}
  }
  gf_share_updateTokenFields_(shareToken, { status: 'deleted', error: '' });
  return { ok: true, token: meta.token, fileId: meta.fileId };
}

function gf_share_appendTokenRow_(record) {
  const ctx = gf_share_getSheetCtx_();
  const row = ctx.headers.map(function(header) {
    switch (header) {
      case 'token':      return record.token || '';
      case 'route':      return record.route || '';
      case 'fileId':     return record.fileId || '';
      case 'fileName':   return record.fileName || '';
      case 'mimeType':   return record.mimeType || '';
      case 'sizeBytes':  return Number(record.sizeBytes) || 0;
      case 'createdAt':  return record.createdAt || '';
      case 'expiresAt':  return record.expiresAt || '';
      case 'status':     return record.status || 'ready';
      case 'openedAt':   return record.openedAt || '';
      case 'source':     return record.source || '';
      case 'error':      return record.error || '';
      default:           return '';
    }
  });

  ctx.sheet.appendRow(row);
  const rowNum = ctx.sheet.getLastRow();

  const idxCreated = ctx.idx['createdAt'];
  const idxExpires = ctx.idx['expiresAt'];
  if (idxCreated != null) ctx.sheet.getRange(rowNum, idxCreated + 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  if (idxExpires != null) ctx.sheet.getRange(rowNum, idxExpires + 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');

  return rowNum;
}

function gf_share_updateTokenFields_(shareToken, fields) {
  const row = gf_share_findTokenRow_(shareToken);
  if (!row) throw new Error('No encontré el token para actualizar.');
  const ctx = gf_share_getSheetCtx_();
  return gf_share_updateTokenFieldsByRow_(ctx, row, fields);
}

function gf_share_updateTokenFieldsByRow_(ctx, row, fields) {
  fields = fields || {};
  Object.keys(fields).forEach(function(key) {
    if (ctx.idx[key] == null) return;
    ctx.sheet.getRange(row, ctx.idx[key] + 1).setValue(fields[key]);
  });

  ['createdAt', 'expiresAt', 'openedAt'].forEach(function(key) {
    if (ctx.idx[key] == null) return;
    try {
      ctx.sheet.getRange(row, ctx.idx[key] + 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    } catch (_) {}
  });

  return true;
}

function gf_share_generateUniqueToken_() {
  for (var i = 0; i < 10; i++) {
    const token = gf_share_generateToken_();
    if (!gf_share_findTokenRow_(token)) return token;
  }
  throw new Error('No pude generar un token share único.');
}

function gf_share_extractBase64_(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/^data:.*?;base64,(.+)$/i);
  return (m ? m[1] : s).replace(/\s+/g, '');
}

function gf_share_base64SizeBytes_(base64) {
  const s = String(base64 || '').replace(/\s+/g, '');
  if (!s) return 0;
  const padding = s.endsWith('==') ? 2 : (s.endsWith('=') ? 1 : 0);
  return Math.floor((s.length * 3) / 4) - padding;
}

function gf_share_normalizeMimeType_(mimeType) {
  const t = String(mimeType || '').trim().toLowerCase();
  if (!t) return 'application/pdf';
  if (t === 'application/octet-stream') return 'application/pdf';
  return t;
}

function gf_share_sanitizeFileName_(name) {
  const raw = String(name || 'archivo.pdf').trim() || 'archivo.pdf';
  let safe = raw.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '_').replace(/\s+/g, ' ').trim();
  if (!/\.(pdf|jpg|jpeg|png|webp)$/i.test(safe)) safe += '.pdf';
  if (safe.length > 180) {
    const ext = (safe.match(/\.[^.]+$/) || ['.pdf'])[0];
    safe = safe.slice(0, 180 - ext.length) + ext;
  }
  return safe;
}

function gf_share_buildDriveFileName_(token, route, fileName) {
  return 'GF_SHARE_' + String(route || '').toUpperCase() + '_' + token + '_' + gf_share_sanitizeFileName_(fileName);
}

function gf_share_rowToObject_(headers, row) {
  const obj = {};
  headers.forEach(function(h, i) {
    obj[String(h || '').trim()] = row[i];
  });
  return obj;
}

function gf_share_toDate_(value) {
  return (value instanceof Date) ? value : null;
}
