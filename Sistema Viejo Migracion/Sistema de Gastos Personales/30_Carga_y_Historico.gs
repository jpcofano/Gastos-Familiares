/**************************************
 * 30_Carga_y_Historico.gs
 * - Movimiento Carga -> Historico
 * - Writer genérico a Historico
 *
 * @deprecated gf_menu_generarMes_, gf_generarCargaDesdePlantillas_,
 *   gf_moveRowsToHistorico_ — rotas desde Fase 2; se eliminan en Fase 3.
 *   Obligaciones/IngresosPlantilla pasan a ser GastosEsperados/IngresosEsperados
 *   (lista de validación, no generador). Ver CLAUDE.md Fase 3.a.
 **************************************/

/**************************************
 * @deprecated GENERAR MES (roto, pendiente eliminar en Fase 3)
 **************************************/

function gf_menu_generarMes_() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();

  // liviano, no destructivo
  gf_setupLigero_({ applyFormats: true, applyValidations: true });

  const shConfig = ss.getSheetByName(GF.SHEET_CONFIG);
  if (!shConfig) throw new Error('Falta Config.');

  // usa Config!B1 si ya está; si no, propone próximo mes
  let mes = gf_toYYYYMM_(shConfig.getRange(GF.CFG_MES_CELL).getValue(), tz);
  if (!mes) {
    mes = gf_nextMonthYYYYMM_(new Date(), tz);
    shConfig.getRange(GF.CFG_MES_CELL).setValue(mes);
  }

  const res = gf_generarCargaDesdePlantillas_(mes);

  SpreadsheetApp.getUi().alert(
    `Carga generada para ${mes}.\n` +
    `Filas creadas: ${res.rowsWritten}`
  );
  return res;
}

function gf_generarCargaDesdePlantillas_(mesYYYYMM) {
  const ss = SpreadsheetApp.getActive();

  const shCarga = ss.getSheetByName(GF.SHEET_CARGA);
  const shObl = ss.getSheetByName(GF.SHEET_OBLIG);
  const shIng = ss.getSheetByName(GF.SHEET_ING_PLANT);

  if (!shCarga) throw new Error('Falta hoja Carga.');
  if (!shObl) throw new Error(`Falta hoja ${GF.SHEET_OBLIG}.`);
  if (!shIng) throw new Error(`Falta hoja ${GF.SHEET_ING_PLANT}.`);

  // asegurar schemas por si el usuario no corrió setup recién
  gf_ensureSheetSchema_(shCarga, GF.SHEET_SCHEMAS[GF.SHEET_CARGA], { applyFormats: true });
  gf_ensureSheetSchema_(shObl, GF.SHEET_SCHEMAS[GF.SHEET_OBLIG], { applyFormats: true });
  gf_ensureSheetSchema_(shIng, GF.SHEET_SCHEMAS[GF.SHEET_ING_PLANT], { applyFormats: true });

  const usuario = gf_getUsuarioActual_();

  const oblRows = gf_readObjectsFromSheet_(shObl)
    .filter(r => gf_boolOrDefault_(r['Activo'], false))
    .map(r => gf_buildCargaObjFromObligacion_(r, mesYYYYMM, usuario));

  const ingRows = gf_readObjectsFromSheet_(shIng)
    .filter(r => gf_boolOrDefault_(r['Activo'], false))
    .map(r => gf_buildCargaObjFromIngreso_(r, mesYYYYMM, usuario));

  const out = [...oblRows, ...ingRows];

  // limpia solo contenidos, no formato
  gf_clearSheetDataRows_(shCarga);

  if (out.length) {
    gf_writeObjectsToSheet_(shCarga, out, { startRow: 2, clear: false });
  }

  gf_setupValidationsLivianas_();
  gf_applyBasicSheetFormat_(shCarga, GF.SHEET_SCHEMAS[GF.SHEET_CARGA]);

  return { ok: true, rowsWritten: out.length };
}

function gf_buildCargaObjFromObligacion_(src, mesYYYYMM, usuario) {
  const tipo = String(src['Tipo'] || 'Gasto').trim() || 'Gasto';
  const subtipo = String(
    src['Subtipo'] || (tipo === 'Ingreso' ? 'IngresoMensual' : 'ObligacionMensual')
  ).trim();

  const dia = gf_numberOrBlank_(src['DiaSugerido']);
  const fecha = dia ? gf_dateFromMesDia_(mesYYYYMM, dia) : '';

  const obligId = String(src['ObligacionID'] || '').trim();
  const rowId = obligId
    ? `CARGA_${obligId}_${mesYYYYMM}`
    : gf_generateId_('CARGA');

  return {
    'ID': rowId,
    'ParentID': obligId || '',
    'Tipo': tipo,
    'Subtipo': subtipo,
    'Origen': 'Carga',
    'Persona': src['PersonaDefault'] || '',
    'Descripción': src['Descripción'] || '',
    'Categoría': src['Categoría'] || '',
    'Subcategoria': src['Subcategoria'] || '',
    'Etiqueta': src['Etiqueta'] || '',
    'Banco': src['Banco'] || '',
    'Cuenta': src['Cuenta'] || '',
    'Moneda': gf_normMon_(src['Moneda'] || 'ARS'),
    'Monto': gf_numberOrBlank_(src['MontoDefault']),
    'Día': dia || '',
    'Fecha': fecha || '',
    'OK': false,
    'Pagado': gf_boolOrDefault_(src['PagadoDefault'], false),
    'FlagResumenMes': gf_boolOrDefault_(src['FlagResumenMesDefault'], true),
    'ExcluirDash': gf_boolOrDefault_(src['ExcluirDashDefault'], false),
    'EstadoRegistro': 'Pendiente',
    'ResumenTarjetaID': '',
    'Usuario': usuario,
    'Notas': src['Notas'] || ''
  };
}

function gf_buildCargaObjFromIngreso_(src, mesYYYYMM, usuario) {
  const dia = gf_numberOrBlank_(src['DiaSugerido']);
  const fecha = dia ? gf_dateFromMesDia_(mesYYYYMM, dia) : '';

  const ingId = String(src['IngresoID'] || '').trim();
  const rowId = ingId
    ? `CARGA_${ingId}_${mesYYYYMM}`
    : gf_generateId_('CARGA');

  return {
    'ID': rowId,
    'ParentID': ingId || '',
    'Tipo': 'Ingreso',
    'Subtipo': 'IngresoMensual',
    'Origen': 'Carga',
    'Persona': src['Persona'] || '',
    'Descripción': src['Descripción'] || '',
    'Categoría': src['Categoría'] || 'Ingresos',
    'Subcategoria': src['Subcategoria'] || '',
    'Etiqueta': src['Etiqueta'] || '',
    'Banco': src['Banco'] || '',
    'Cuenta': '',
    'Moneda': gf_normMon_(src['Moneda'] || 'ARS'),
    'Monto': gf_numberOrBlank_(src['MontoDefault']),
    'Día': dia || '',
    'Fecha': fecha || '',
    'OK': false,
    'Pagado': false,
    'FlagResumenMes': gf_boolOrDefault_(src['FlagResumenMesDefault'], true),
    'ExcluirDash': false,
    'EstadoRegistro': 'Pendiente',
    'ResumenTarjetaID': '',
    'Usuario': usuario,
    'Notas': src['Notas'] || ''
  };
}

/**************************************
 * ON EDIT / AUTO MOVE
 **************************************/

function onEdit(e) {
  gf_onEditCore_(e);
}

function gf_onEditInstallable_(e) {
  gf_onEditCore_(e);
}

function gf_onEditCore_(e) {
  try {
    if (!e || !e.range) return;

    const sh = e.range.getSheet();
    if (sh.getName() !== GF.SHEET_CARGA) return;

    const lock = LockService.getDocumentLock();
    if (!lock.tryLock(5000)) return;

    try {
      gf_processDiaEdits_(e);
      gf_processCheckedEdits_(e);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    gf_logError_('gf_onEditCore_', err, e);
  }
}

function gf_processDiaEdits_(e) {
  const sh = e.range.getSheet();

  const diaCol = gf_findColumnByHeader_(sh, 'Día');
  const fechaCol = gf_findColumnByHeader_(sh, 'Fecha');
  if (diaCol < 1 || fechaCol < 1) return;

  const r = e.range;
  const touchesDia = (r.getColumn() <= diaCol && (r.getColumn() + r.getNumColumns() - 1) >= diaCol);
  if (!touchesDia) return;

  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const shCfg = ss.getSheetByName(GF.SHEET_CONFIG);
  const mes = shCfg ? gf_toYYYYMM_(shCfg.getRange(GF.CFG_MES_CELL).getValue(), tz) : '';
  if (!mes) return;

  const startRow = Math.max(2, r.getRow());
  const endRow = r.getRow() + r.getNumRows() - 1;
  const numRows = endRow - startRow + 1;
  if (numRows <= 0) return;

  const diaVals = sh.getRange(startRow, diaCol, numRows, 1).getValues();
  const out = diaVals.map(([v]) => {
    const n = gf_numberOrBlank_(v);
    if (!n) return [''];
    const d = gf_dateFromMesDia_(mes, n);
    return [d || ''];
  });

  sh.getRange(startRow, fechaCol, numRows, 1).setValues(out);
  sh.getRange(startRow, fechaCol, numRows, 1).setNumberFormat('dd/MM/yyyy');
}

function gf_processCheckedEdits_(e) {
  const sh = e.range.getSheet();
  const okCol = gf_findColumnByHeader_(sh, 'OK');
  if (okCol < 1) return;

  const r = e.range;
  const touchesOK = (r.getColumn() <= okCol && (r.getColumn() + r.getNumColumns() - 1) >= okCol);
  if (!touchesOK) return;

  const startRow = Math.max(2, r.getRow());
  const endRow = r.getRow() + r.getNumRows() - 1;
  const numRows = endRow - startRow + 1;
  if (numRows <= 0) return;

  const okVals = sh.getRange(startRow, okCol, numRows, 1).getValues();
  const rowsToMove = [];

  for (let i = 0; i < okVals.length; i++) {
    if (gf_boolOrDefault_(okVals[i][0], false)) {
      rowsToMove.push(startRow + i);
    }
  }

  if (!rowsToMove.length) return;

  try {
    gf_moveRowsToHistorico_(rowsToMove);
  } catch (err) {
    gf_logError_('gf_processCheckedEdits_', err, e);
  }
}

/**************************************
 * PROCESAR TILDADOS
 **************************************/

function gf_procesarTildados_() {
  const moved = gf_procesarTildados_silent_();
  SpreadsheetApp.getUi().alert(
    moved
      ? `Movidas ${moved} filas a Histórico.`
      : 'No hay filas tildadas para mover.'
  );
  return moved;
}

function gf_procesarTildados_silent_() {
  const ss = SpreadsheetApp.getActive();
  const shCarga = ss.getSheetByName(GF.SHEET_CARGA);
  if (!shCarga) throw new Error('Falta hoja Carga.');

  const okCol = gf_findColumnByHeader_(shCarga, 'OK');
  if (okCol < 1) return 0;

  const lastRow = shCarga.getLastRow();
  if (lastRow < 2) return 0;

  const okVals = shCarga.getRange(2, okCol, lastRow - 1, 1).getValues();
  const rowsToMove = [];

  for (let i = 0; i < okVals.length; i++) {
    if (gf_boolOrDefault_(okVals[i][0], false)) {
      rowsToMove.push(i + 2);
    }
  }

  if (!rowsToMove.length) return 0;
  gf_moveRowsToHistorico_(rowsToMove);
  return rowsToMove.length;
}

/**************************************
 * CARGA -> HISTORICO
 **************************************/

function gf_moveRowsToHistorico_(rowNumbers) {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();

  const shConfig = ss.getSheetByName(GF.SHEET_CONFIG);
  const shCarga = ss.getSheetByName(GF.SHEET_CARGA);
  const shHist = ss.getSheetByName(GF.SHEET_HIST);

  if (!shConfig || !shCarga || !shHist) {
    throw new Error('Faltan Config/Carga/Historico.');
  }

  gf_ensureSheetSchema_(shCarga, GF.SHEET_SCHEMAS[GF.SHEET_CARGA], { applyFormats: false });
  gf_ensureSheetSchema_(shHist, GF.SHEET_SCHEMAS[GF.SHEET_HIST], { applyFormats: false });

  const mesConfig = gf_toYYYYMM_(shConfig.getRange(GF.CFG_MES_CELL).getValue(), tz);
  if (!mesConfig) throw new Error('Config!B1 inválido.');

  const headersCarga = gf_getSheetHeaders_(shCarga);
  const movedAt = new Date();

  const cargaObjs = rowNumbers
    .slice()
    .sort((a, b) => a - b)
    .map(rowNum => {
      const row = shCarga.getRange(rowNum, 1, 1, headersCarga.length).getValues()[0];
      return gf_rowToObject_(headersCarga, row);
    });

  const histObjs = cargaObjs.map(obj => gf_buildHistoricoObjFromCargaObj_(obj, mesConfig, movedAt));

  gf_writeObjectsToSheet_(shHist, histObjs, { startRow: shHist.getLastRow() + 1, clear: false });

  // borra filas desde abajo para no romper índices
  rowNumbers.slice().sort((a, b) => b - a).forEach(r => shCarga.deleteRow(r));

  // marca calendar como dirty si existe helper
  try {
    if (typeof gf_calendar_markDirty_ === 'function') gf_calendar_markDirty_();
  } catch (e) {
    gf_logError_('gf_calendar_markDirty_', e);
  }

  return histObjs.length;
}

function gf_buildHistoricoObjFromCargaObj_(obj, mesConfig, movedAt) {
  let fecha = obj['Fecha'] instanceof Date ? obj['Fecha'] : '';
  const dia = gf_numberOrBlank_(obj['Día']);

  if (!fecha && dia) {
    fecha = gf_dateFromMesDia_(mesConfig, dia) || '';
  }

  const mesOp = fecha instanceof Date
    ? Utilities.formatDate(fecha, Session.getScriptTimeZone(), 'yyyy-MM')
    : mesConfig;

  const tc = fecha instanceof Date
    ? gf_lookupTCPorFecha_(fecha)
    : gf_lookupTCPorMes_(mesOp);

  return gf_normalizeHistoricoInput_(obj, {
    fallbackMes: mesConfig,
    fechaOverride: fecha || '',
    mesOverride: mesOp,
    movidoEn: movedAt,
    tcOverride: tc,
    estadoDefault: 'Registrado',
    origenDefault: 'Carga'
  });
}

/**************************************
 * WRITER GENÉRICO A HISTORICO
 * Para usar desde WebApp en el próximo paso
 **************************************/

function gf_writeHistoricoMovimientos_(items, opts) {
  opts = opts || {};

  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();

  const shHist = ss.getSheetByName(GF.SHEET_HIST);
  const shCfg = ss.getSheetByName(GF.SHEET_CONFIG);

  if (!shHist || !shCfg) throw new Error('Faltan Historico o Config.');

  gf_requireHeaders_(
    gf_getSheetHeaders_(shHist),
    GF.SHEET_SCHEMAS[GF.SHEET_HIST].headers,
    GF.SHEET_HIST
  );

  const mesConfig = gf_toYYYYMM_(shCfg.getRange(GF.CFG_MES_CELL).getValue(), tz);
  if (!mesConfig) throw new Error('Config!B1 inválido.');

  const arr = Array.isArray(items) ? items : [items];
  const now = new Date();

  const normalized = arr.map(item => gf_normalizeHistoricoInput_(item, {
    fallbackMes: mesConfig,
    movidoEn: now,
    estadoDefault: opts.estadoDefault || 'Registrado',
    origenDefault: opts.origenDefault || 'Sistema'
  }));

  gf_writeObjectsToSheet_(shHist, normalized, { startRow: shHist.getLastRow() + 1, clear: false });

  try {
    if (typeof gf_calendar_markDirty_ === 'function') gf_calendar_markDirty_();
  } catch (e) {
    gf_logError_('gf_calendar_markDirty_', e);
  }

  return {
    ok: true,
    inserted: normalized.length,
    ids: normalized.map(x => x['ID'])
  };
}

function gf_normalizeHistoricoInput_(input, opts) {
  opts = opts || {};

  const now = opts.movidoEn || new Date();
  const usuario = gf_inputGet_(input, ['Usuario'], gf_getUsuarioActual_());

  let fecha = gf_inputGet_(input, ['Fecha'], '');
  const dia = gf_numberOrBlank_(gf_inputGet_(input, ['Día', 'Dia'], ''));
  const mesDestino = gf_inputGet_(input, ['Mes', 'MesDestino'], opts.fallbackMes || '');

  if (!(fecha instanceof Date) && dia && mesDestino) {
    fecha = gf_dateFromMesDia_(mesDestino, dia) || '';
  }

  if (opts.fechaOverride) fecha = opts.fechaOverride;

  const mesFinal = opts.mesOverride || (
    fecha instanceof Date
      ? Utilities.formatDate(fecha, Session.getScriptTimeZone(), 'yyyy-MM')
      : (mesDestino || opts.fallbackMes || '')
  );

  const tcFinal = (opts.tcOverride != null)
    ? opts.tcOverride
    : (
        fecha instanceof Date
          ? gf_lookupTCPorFecha_(fecha)
          : gf_lookupTCPorMes_(mesFinal)
      );

  const tipo = String(gf_inputGet_(input, ['Tipo'], 'Gasto') || 'Gasto').trim() || 'Gasto';
  const subtipo = String(
    gf_inputGet_(input, ['Subtipo'], tipo === 'Ingreso' ? 'IngresoMensual' : 'Otro') || ''
  ).trim() || 'Otro';

  const id = String(gf_inputGet_(input, ['ID'], '') || '').trim() || newId_('MOV');

  return {
    'ID': id,
    'ParentID': gf_inputGet_(input, ['ParentID'], ''),
    'Tipo': tipo,
    'Subtipo': subtipo,
    'Origen': gf_inputGet_(input, ['Origen'], opts.origenDefault || 'Sistema'),
    'Persona': gf_inputGet_(input, ['Persona'], ''),
    'Descripción': gf_inputGet_(input, ['Descripción', 'Descripcion'], ''),
    'Categoría': gf_inputGet_(input, ['Categoría', 'Categoria'], ''),
    'Subcategoria': gf_inputGet_(input, ['Subcategoria'], ''),
    'Etiqueta': gf_inputGet_(input, ['Etiqueta'], ''),
    'Banco': gf_inputGet_(input, ['Banco'], ''),
    'Cuenta': gf_inputGet_(input, ['Cuenta'], ''),
    'Moneda': gf_normMon_(gf_inputGet_(input, ['Moneda'], 'ARS')),
    'Monto': gf_numberOrBlank_(gf_inputGet_(input, ['Monto'], '')),
    'Día': dia || '',
    'Fecha': fecha instanceof Date ? fecha : '',
    'Pagado': gf_boolOrDefault_(gf_inputGet_(input, ['Pagado'], false), false),
    'FlagResumenMes': gf_boolOrDefault_(gf_inputGet_(input, ['FlagResumenMes'], false), false),
    'ExcluirDash': gf_boolOrDefault_(gf_inputGet_(input, ['ExcluirDash'], false), false),
    'EstadoRegistro': gf_inputGet_(input, ['EstadoRegistro'], opts.estadoDefault || 'Registrado'),
    'ResumenTarjetaID': gf_inputGet_(input, ['ResumenTarjetaID'], ''),
    'Usuario': usuario,
    'Notas': gf_inputGet_(input, ['Notas'], ''),
    'Mes': mesFinal,
    'MovidoEn': now,
    'TC_USDARS': Number(tcFinal) || 1,
    'NumeroComprobante': gf_inputGet_(input, ['NumeroComprobante'], ''),
    'CreatedAt': gf_inputGet_(input, ['CreatedAt'], now),
    'UpdatedAt': now
  };
}

/**************************************
 * HELPERS DE SHEETS/OBJETOS
 **************************************/

function gf_getSheetHeaders_(sh) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  return sh.getRange(1, 1, 1, lastCol).getValues()[0];
}

function gf_rowToObject_(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    obj[h] = row[i];
  });
  return obj;
}

function gf_readObjectsFromSheet_(sh) {
  const data = gf_readSheet_(sh);
  return data.rows.map(r => gf_rowToObject_(data.headers, r));
}

function gf_objectToRow_(headers, obj) {
  return headers.map(h => {
    const v = obj[h];
    return v === undefined ? '' : v;
  });
}

function gf_writeObjectsToSheet_(sh, objects, opts) {
  opts = opts || {};
  const startRow = opts.startRow || 2;
  const clear = opts.clear === true;

  const headers = gf_getSheetHeaders_(sh);
  const rows = objects.map(obj => gf_objectToRow_(headers, obj));

  if (clear) gf_clearSheetDataRows_(sh);

  if (!rows.length) return 0;

  const needRows = startRow + rows.length - 1;
  if (needRows > sh.getMaxRows()) {
    sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());
  }

  sh.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
  return rows.length;
}

function gf_clearSheetDataRows_(sh) {
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(sh.getLastColumn(), 1);
  if (lastRow >= 2) {
    sh.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }
}

/**************************************
 * HELPERS DE INPUT / NORMALIZACIÓN
 **************************************/

function gf_inputGet_(input, names, defaultValue) {
  for (let i = 0; i < names.length; i++) {
    const key = names[i];
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      return input[key];
    }
  }
  return defaultValue;
}

function gf_boolOrDefault_(v, defaultValue) {
  if (v === '' || v == null) return defaultValue;
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;

  const s = String(v).trim().toUpperCase();
  if (s === 'TRUE' || s === 'VERDADERO' || s === 'SI' || s === 'SÍ') return true;
  if (s === 'FALSE' || s === 'FALSO' || s === 'NO') return false;

  return defaultValue;
}

function gf_numberOrBlank_(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  return isFinite(n) ? n : '';
}

function gf_normMon_(v) {
  return String(v || '').toUpperCase().trim() === 'USD' ? 'USD' : 'ARS';
}

function gf_getUsuarioActual_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

/**************************************
 * HELPERS DE FECHAS
 * Si ya los tenés en otro archivo, dejá una sola copia
 **************************************/

function gf_parseMonth_(mesYYYYMM) {
  const [y, m] = String(mesYYYYMM).split('-').map(Number);
  const year = y;
  const month0 = m - 1;
  const start = new Date(year, month0, 1);
  const end = new Date(year, month0 + 1, 1);
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  return { year, month0, start, end, daysInMonth };
}

function gf_dateFromMesDia_(mesYYYYMM, dia) {
  const p = gf_parseMonth_(mesYYYYMM);
  const d = Number(dia);
  if (!isFinite(d)) return null;
  const dd = Math.floor(d);
  if (dd < 1 || dd > p.daysInMonth) return null;
  return new Date(p.year, p.month0, dd);
}
