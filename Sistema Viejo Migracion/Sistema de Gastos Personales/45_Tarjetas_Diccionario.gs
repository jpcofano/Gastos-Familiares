/**************************************
 * 45_Diccionario_Aprendido.gs - Fase 2.2.a / actualizado Fase 3.0
 * Lookup, learn y apply-to-pending sobre Diccionario_Aprendido (ex Diccionario_Aprendido).
 *
 * Funciones públicas:
 *   dictApplyToPending()  — aplica el diccionario a todas las Raw pendientes
 *
 * Helpers privados:
 *   gf_dictLookup_(descRaw, banco, tarjeta)
 *   gf_dictLearn_(params)
 *   gf_dictIncrUsage_(sh, rowIdx, headers)
 **************************************/

// Orden de prioridad de match (más restrictivo primero)
const GF_DICT_MATCH_ORDER = ['exact', 'prefix', 'contains', 'regex'];

// AccionDefault cuando no hay nada especificado
const GF_DICT_ACCION_DEFAULT = '';

/**
 * Busca en Diccionario_Aprendido el mejor mapeo para una descripción raw.
 *
 * @param {string} descRaw        Descripción original del resumen de tarjeta
 * @param {string} [banco]        Banco canónico ('BBVA', 'Galicia', etc.) para filtrar BancoFiltro
 * @param {string} [tarjeta]      Código de tarjeta ('BBVA-VISA-SIG', etc.) para filtrar TarjetaFiltro
 * @returns {{mapeoID, descLimpia, categoria, subcategoria, etiqueta,
 *            personaDefault, accionDefault, confianza, tipoMatch, rowIdx}|null}
 */
function gf_dictLookup_(descRaw, banco, tarjeta) {
  if (!descRaw) return null;

  const sh = SpreadsheetApp.getActive().getSheetByName(GF.SHEET_DICT_APRENDIDO);
  if (!sh || sh.getLastRow() < 2) return null;

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach((h, i) => { idx[String(h).trim()] = i; });

  const nRows = sh.getLastRow() - 1;
  const rows = sh.getRange(2, 1, nRows, sh.getLastColumn()).getValues();

  const rawNorm = descRaw.trim().toLowerCase();

  // Candidatos por tipo de match, para elegir el más preciso
  const candidates = {}; // tipoMatch -> mejor candidato

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Solo activos
    if (idx['Activo'] !== undefined && !gf_boolOrDefault_(row[idx['Activo']], true)) continue;

    // Filtro por banco (si la entrada de dict tiene BancoFiltro)
    const bancoFiltro = idx['BancoFiltro'] !== undefined ? String(row[idx['BancoFiltro']] || '').trim() : '';
    if (bancoFiltro && banco && bancoFiltro !== banco) continue;

    // Filtro por tarjeta (si la entrada de dict tiene TarjetaFiltro)
    const tarjetaFiltro = idx['TarjetaFiltro'] !== undefined ? String(row[idx['TarjetaFiltro']] || '').trim() : '';
    if (tarjetaFiltro && tarjeta && tarjetaFiltro !== tarjeta) continue;

    const patron = String(row[idx['Patron']] || '').trim();
    if (!patron) continue;

    const tipoMatch = String(row[idx['TipoMatch']] || 'contains').trim().toLowerCase();
    const patronNorm = patron.toLowerCase();

    let matched = false;
    try {
      switch (tipoMatch) {
        case 'exact':
          matched = (rawNorm === patronNorm);
          break;
        case 'prefix':
          matched = rawNorm.startsWith(patronNorm);
          break;
        case 'contains':
          matched = rawNorm.includes(patronNorm);
          break;
        case 'regex':
          matched = new RegExp(patron, 'i').test(descRaw);
          break;
      }
    } catch (e) {
      // regex inválido: lo saltamos
      Logger.log('gf_dictLookup_: regex inválido en MapeoID=' + row[idx['MapeoID']] + ' — ' + e.message);
      continue;
    }

    if (!matched) continue;

    // Guardamos solo el primer candidato de cada tipo de match
    if (!candidates[tipoMatch]) {
      candidates[tipoMatch] = { row, rowIdx: i };
    }
  }

  // Elegir el más preciso según el orden definido
  for (const tipo of GF_DICT_MATCH_ORDER) {
    if (!candidates[tipo]) continue;
    const { row, rowIdx } = candidates[tipo];
    return {
      mapeoID:       String(row[idx['MapeoID']]        || ''),
      descLimpia:    String(row[idx['DescripcionLimpia']] || ''),
      categoria:     String(row[idx['Categoría']]       || ''),
      subcategoria:  String(row[idx['Subcategoria']]    || ''),
      etiqueta:      String(row[idx['Etiqueta']]        || ''),
      personaDefault:String(row[idx['PersonaDefault']]  || ''),
      accionDefault: String(row[idx['AccionDefault']]   || GF_DICT_ACCION_DEFAULT),
      confianza:     Number(row[idx['Confianza']]       || 0),
      tipoMatch:     tipo,
      rowIdx:        rowIdx  // 0-based, relativo a datos (fila 2 en la hoja)
    };
  }

  return null;
}


/**
 * Incrementa UsoCount y UltimoUso en una fila del diccionario.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sh   Hoja Diccionario_Aprendido
 * @param {number} rowIdx   Índice 0-based relativo a datos (fila 2 = rowIdx 0)
 * @param {Object} idx      Mapa header→columna (0-based)
 */
function gf_dictIncrUsage_(sh, rowIdx, idx) {
  const sheetRow = rowIdx + 2;
  if (idx['UsoCount'] === undefined || idx['UltimoUso'] === undefined) return;

  const usoCel  = sh.getRange(sheetRow, idx['UsoCount']  + 1);
  const lastCel = sh.getRange(sheetRow, idx['UltimoUso'] + 1);

  usoCel.setValue((Number(usoCel.getValue()) || 0) + 1);
  lastCel.setValue(new Date());
}

/**
 * Aplica el diccionario a todas las filas de Tarjetas_Raw con EstadoMatch='pending'.
 * Función pública, el usuario la corre manualmente desde Apps Script.
 *
 * @returns {{total: number, matched: number, unmatched: number}}
 */
function dictApplyToPending() {
  const ss = SpreadsheetApp.getActive();
  const shRaw  = ss.getSheetByName(GF.SHEET_TARJETAS_RAW);
  const shDict = ss.getSheetByName(GF.SHEET_DICT_APRENDIDO);

  if (!shRaw || shRaw.getLastRow() < 2) {
    Logger.log('dictApplyToPending: Tarjetas_Raw vacía o inexistente');
    ss.toast('Sin filas pendientes', 'Diccionario', 4);
    return { total: 0, matched: 0, unmatched: 0 };
  }

  const hRaw = shRaw.getRange(1, 1, 1, shRaw.getLastColumn()).getValues()[0];
  const iRaw = {};
  hRaw.forEach((h, i) => { iRaw[String(h).trim()] = i; });

  // Necesitamos estas columnas
  const need = ['EstadoMatch','DescripcionRaw','RawID'];
  for (const c of need) {
    if (iRaw[c] === undefined) throw new Error('Tarjetas_Raw: falta columna ' + c);
  }

  const nRows = shRaw.getLastRow() - 1;
  const allRows = shRaw.getRange(2, 1, nRows, shRaw.getLastColumn()).getValues();

  // Cargar headers del dict para gf_dictIncrUsage_
  let iDict = {};
  if (shDict && shDict.getLastRow() >= 1) {
    const hDict = shDict.getRange(1, 1, 1, shDict.getLastColumn()).getValues()[0];
    hDict.forEach((h, i) => { iDict[String(h).trim()] = i; });
  }

  let matched = 0;
  let unmatched = 0;
  const pending = [];

  // Identificar filas pendientes
  for (let i = 0; i < allRows.length; i++) {
    const estado = String(allRows[i][iRaw['EstadoMatch']] || '').trim();
    if (estado === 'pending') pending.push(i);
  }

  for (const i of pending) {
    const row = allRows[i];
    const descRaw  = String(row[iRaw['DescripcionRaw']] || '').trim();
    const banco    = iRaw['Banco']   !== undefined ? String(row[iRaw['Banco']]   || '').trim() : '';
    const tarjeta  = iRaw['Tarjeta'] !== undefined ? String(row[iRaw['Tarjeta']] || '').trim() : '';

    const hit = gf_dictLookup_(descRaw, banco, tarjeta);

    if (hit) {
      // Actualizar fila en Raw
      const sheetRow = i + 2;

      const setRaw = (col, val) => {
        if (iRaw[col] !== undefined) {
          shRaw.getRange(sheetRow, iRaw[col] + 1).setValue(val);
        }
      };

      setRaw('EstadoMatch',      'auto');
      setRaw('MapeoID',          hit.mapeoID);
      setRaw('Confianza',        hit.confianza);
      setRaw('DescripcionLimpia',hit.descLimpia   || descRaw);
      setRaw('Categoría',        hit.categoria);
      setRaw('Subcategoria',     hit.subcategoria);
      setRaw('Etiqueta',         hit.etiqueta);
      if (hit.personaDefault) setRaw('PersonaFinal', hit.personaDefault);
      if (hit.accionDefault)  setRaw('AccionUsuario', hit.accionDefault);

      // Incrementar uso en el diccionario
      if (shDict && iDict['UsoCount'] !== undefined) {
        gf_dictIncrUsage_(shDict, hit.rowIdx, iDict);
      }

      matched++;
    } else {
      unmatched++;
    }
  }

  const result = { total: pending.length, matched, unmatched };
  Logger.log('dictApplyToPending: ' + JSON.stringify(result));
  ss.toast(
    'Pendientes: ' + pending.length + ' | Mapeados: ' + matched + ' | Sin mapeo: ' + unmatched,
    'Diccionario', 6
  );
  return result;
}
