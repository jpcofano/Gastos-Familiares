/**************************************
 * 46_Diccionario_Aprendido.gs — Fase 3.0
 * Diccionario unificado: Tarjeta + Manual + Comprobante.
 *
 * API pública (sin guion bajo — llamables desde frontend):
 *   gf_dictLookup_(desc)                          → match o null
 *   gf_dictAprender_(desc, cat, subcat, etiq, org, descNorm, persona) → mapeoID
 *
 * Internamente usa GF.SHEET_DICT_APRENDIDO ('Diccionario_Aprendido').
 * El alias GF.SHEET_TARJETAS_DICT sigue funcionando hasta que
 * 45_Tarjetas_Diccionario.gs migre completamente.
 *
 * Seed desde Historico:
 *   gf_seedDictDesdeHistorico_PREVIEW()
 *   gf_seedDictDesdeHistorico_APLICAR()
 **************************************/

// ── Normalización on-read (C10) ──────────────────────────────────────────────
// Reglas cargadas desde Diccionario_Normalizacion. Cache por ejecución.

var _GF_DICT_NORM_RULES_ = null;

function gf_dict_cargarReglas_() {
  if (_GF_DICT_NORM_RULES_ !== null) return _GF_DICT_NORM_RULES_;
  var sh = SpreadsheetApp.getActive().getSheetByName(GF.SHEET_DICT_NORM);
  if (!sh || sh.getLastRow() < 2) { _GF_DICT_NORM_RULES_ = []; return []; }
  var hdrs = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var ci = {};
  hdrs.forEach(function(h, i) { ci[String(h).trim()] = i; });
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  _GF_DICT_NORM_RULES_ = data
    .filter(function(r) { return gf_boolOrDefault_(r[ci['Activo']], true); })
    .map(function(r) {
      return {
        tipo:      String(r[ci['Tipo']]      || '').trim().toLowerCase(),
        patron:    String(r[ci['Patron']]    || '').trim(),
        reemplazo: String(r[ci['Reemplazo']] || '').trim()
      };
    })
    .filter(function(r) { return r.patron; });
  return _GF_DICT_NORM_RULES_;
}

function gf_dict_aplicarReglas_(desc, rules) {
  var s = String(desc || '').trim();
  for (var i = 0; i < rules.length; i++) {
    if (!s) break;
    var r   = rules[i];
    var pUp = r.patron.toUpperCase();
    var sUp = s.toUpperCase();
    switch (r.tipo) {
      case 'prefix':
        if (sUp.indexOf(pUp) === 0)
          s = (r.reemplazo + s.substring(r.patron.length)).trim();
        break;
      case 'suffix':
        if (sUp.length >= pUp.length && sUp.lastIndexOf(pUp) === sUp.length - pUp.length)
          s = (s.substring(0, s.length - r.patron.length) + r.reemplazo).trim();
        break;
      case 'replace':
        s = s.replace(
          new RegExp(r.patron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
          r.reemplazo
        ).trim();
        break;
      case 'regex':
        try { s = s.replace(new RegExp(r.patron, 'gi'), r.reemplazo).trim(); }
        catch(e) { /* invalid regex — skip */ }
        break;
    }
  }
  return s;
}

/** Normaliza una descripción aplicando las reglas de Diccionario_Normalizacion. */
function gf_dict_normalizar_(desc) {
  return gf_dict_aplicarReglas_(desc, gf_dict_cargarReglas_());
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista canónica de categorías del proyecto.
 * Fuente: hoja Diccionario (Tipo='Categoria', Activo=TRUE).
 * Fallback hardcodeado si la hoja está vacía.
 */
function gf_getCategoriasCanonicas_() {
  var cats = gf_getDiccionarioValores_('Categoria');
  if (!cats.length) cats = [
    'Casa','Auto','Alimentación cotidiana','Salidas','Vacaciones y viajes',
    'Salud','Educación y chicos','Personal','Indumentaria',
    'Impuestos y finanzas','Transporte general','Tarjetas','Ingresos'
  ];
  return cats;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca en Diccionario_Aprendido el mejor match para una descripción.
 * Prueba exact primero, luego contains. Normaliza ambos lados con las reglas
 * de Diccionario_Normalizacion, con fallback al raw si no hay reglas cargadas.
 *
 * @param {string} desc  Descripción a buscar
 * @returns {{mapeoID, categoria, subcategoria, etiqueta, origen, confianza,
 *            accionDefault, tipoMatch, descripcionNormalizada} | null}
 */
function gf_dictLookup_(desc) {
  if (!desc) return null;

  const sh = SpreadsheetApp.getActive().getSheetByName(GF.SHEET_DICT_APRENDIDO);
  if (!sh || sh.getLastRow() < 2) return null;

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach(function(h, i) { idx[String(h).trim()] = i; });

  const nRows = sh.getLastRow() - 1;
  const rows = sh.getRange(2, 1, nRows, sh.getLastColumn()).getValues();

  var normRules  = gf_dict_cargarReglas_();
  var descRaw    = desc.trim().toLowerCase();
  var descNorm   = gf_dict_aplicarReglas_(desc.trim(), normRules).toLowerCase();

  var bestExact    = null;
  var bestContains = null;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (idx['Activo'] !== undefined && !gf_boolOrDefault_(row[idx['Activo']], true)) continue;

    var patron = String(row[idx['Patron']] || '').trim();
    if (!patron) continue;

    var tipoMatch  = String(row[idx['TipoMatch']] || 'contains').trim().toLowerCase();
    var patronRaw  = patron.toLowerCase();
    var patronNorm = gf_dict_aplicarReglas_(patron, normRules).toLowerCase();

    if (tipoMatch === 'exact') {
      if ((descNorm === patronNorm || descRaw === patronRaw) && !bestExact)
        bestExact = { row: row, rowIdx: i };
    } else if (tipoMatch === 'contains') {
      if ((descNorm.includes(patronNorm) || descRaw.includes(patronRaw)) && !bestContains)
        bestContains = { row: row, rowIdx: i };
    }
  }

  var best = bestExact || bestContains;
  if (!best) return null;

  var r = best.row;
  return {
    mapeoID:               String(r[idx['MapeoID']]                || ''),
    categoria:             String(r[idx['Categoría']]              || ''),
    subcategoria:          String(r[idx['Subcategoria']]           || ''),
    etiqueta:              String(r[idx['Etiqueta']]               || ''),
    origen:                String(r[idx['Origen']]                 || ''),
    confianza:             Number(r[idx['Confianza']]              || 0),
    accionDefault:         String(r[idx['AccionDefault']]          || ''),
    tipoMatch:             bestExact ? 'exact' : 'contains',
    rowIdx:                best.rowIdx,
    // Si la columna no existe todavía (migración pendiente), devuelve ''.
    descripcionNormalizada: String(r[idx['DescripcionNormalizada']] || ''),
    personaDefault:         String(r[idx['PersonaDefault']]         || '')
  };
}

/**
 * Upsert en Diccionario_Aprendido con normalización on-write.
 * El Patron guardado es siempre la versión normalizada de la descripción.
 * El valor crudo queda en PatronOriginal para trazabilidad.
 * Dedup por (Patron normalizado, Etiqueta, PersonaDefault, Origen): si ya existe,
 * solo incrementa UsoCount/UltimoUso — nunca sobreescribe clasificación.
 *
 * @param {string} desc              Descripción original del parser (se normaliza y guarda como Patron)
 * @param {string} categoria
 * @param {string} subcategoria
 * @param {string} etiqueta
 * @param {string} origen            'Tarjeta' | 'Manual' | 'Comprobante'
 * @param {string} [descNormalizada] Alias de display opcional.
 * @param {string} [persona]
 * @returns {string} mapeoID
 */
function gf_dictAprender_(desc, categoria, subcategoria, etiqueta, origen, descNormalizada, persona) {
  if (!desc) return '';

  // Guard: warn if categoria is non-empty and not in the canonical list.
  if (categoria && gf_getCategoriasCanonicas_().indexOf(categoria) === -1) {
    Logger.log('[warn] gf_dictAprender_: categoría no canónica "' + categoria +
               '" para patron "' + String(desc).substring(0, 50) + '"');
  }

  // On-write normalization: guardar Patron limpio, preservar crudo en PatronOriginal.
  var patronCrudo = desc.trim();
  var patronNorm  = gf_dict_normalizar_(patronCrudo) || patronCrudo;

  const sh = SpreadsheetApp.getActive().getSheetByName(GF.SHEET_DICT_APRENDIDO);
  if (!sh) throw new Error('Hoja Diccionario_Aprendido no encontrada. Corré la migración Fase 3.0.');

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach(function(h, i) { idx[String(h).trim()] = i; });

  // Auto-agregar columna PatronOriginal si no existe aún.
  if (idx['PatronOriginal'] === undefined) {
    var newPatOrigCol = sh.getLastColumn() + 1;
    sh.getRange(1, newPatOrigCol).setValue('PatronOriginal');
    idx['PatronOriginal'] = newPatOrigCol - 1;
  }

  // Clave de dedup usa el Patron normalizado (no el crudo).
  const descNorm     = patronNorm.toLowerCase();
  const etiqNormK    = (etiqueta || '').trim().toLowerCase();
  const personaNormK = (persona  || '').trim().toLowerCase();
  const origenNormK  = (origen   || '').trim().toLowerCase();
  const now = new Date();

  // Buscar fila existente cuya clave (Patron normalizado, Etiqueta, PersonaDefault, Origen) coincida.
  var targetRow = -1;
  var existingMapeoID = '';
  if (sh.getLastRow() >= 2) {
    const nRows = sh.getLastRow() - 1;
    const rows = sh.getRange(2, 1, nRows, sh.getLastColumn()).getValues();
    for (var i = 0; i < rows.length; i++) {
      var tipoMatch  = String(rows[i][idx['TipoMatch']]      || '').trim().toLowerCase();
      var patron     = String(rows[i][idx['Patron']]         || '').trim().toLowerCase();
      var etiqRow    = String(rows[i][idx['Etiqueta']]       || '').trim().toLowerCase();
      var personaRow = String(rows[i][idx['PersonaDefault']] || '').trim().toLowerCase();
      var origenRow  = String(rows[i][idx['Origen']]         || '').trim().toLowerCase();
      if (tipoMatch === 'exact' &&
          patron     === descNorm    &&
          etiqRow    === etiqNormK   &&
          personaRow === personaNormK &&
          origenRow  === origenNormK) {
        targetRow = i + 2;
        existingMapeoID = String(rows[i][idx['MapeoID']] || '');
        break;
      }
    }
  }

  if (targetRow > 0) {
    // Clave exacta encontrada → solo incrementar contadores (no sobrescribir clasificación).
    var rowData = sh.getRange(targetRow, 1, 1, sh.getLastColumn()).getValues()[0];
    var set = function(col, val) {
      if (idx[col] !== undefined && val !== undefined) rowData[idx[col]] = val;
    };
    set('UsoCount',  (Number(rowData[idx['UsoCount']]) || 0) + 1);
    set('UltimoUso', now);
    if (descNormalizada && descNormalizada.trim()) {
      set('DescripcionNormalizada', descNormalizada.trim());
    }
    sh.getRange(targetRow, 1, 1, sh.getLastColumn()).setValues([rowData]);
    return existingMapeoID;
  }

  // Crear fila nueva con Patron normalizado.
  const mapeoID = newId_('MAP');
  var numCols = Object.keys(idx).reduce(function(m, k) { return Math.max(m, idx[k]); }, 0) + 1;
  const newRow = new Array(numCols).fill('');
  var setN = function(col, val) {
    if (idx[col] !== undefined && val !== undefined) newRow[idx[col]] = val;
  };
  setN('MapeoID',               mapeoID);
  setN('Patron',                patronNorm);
  setN('PatronOriginal',        patronCrudo !== patronNorm ? patronCrudo : '');
  setN('TipoMatch',             'exact');
  setN('Categoría',             categoria    || '');
  setN('Subcategoria',          subcategoria || '');
  setN('Etiqueta',              etiqueta     || '');
  setN('Origen',                origen       || '');
  setN('PersonaDefault',        (persona && persona.trim()) ? persona.trim() : '');
  setN('Confianza',             0.9);
  setN('UsoCount',              1);
  setN('UltimoUso',             now);
  setN('Activo',                true);
  setN('CreadoPor',             Session.getActiveUser().getEmail() || 'Sistema');
  setN('CreadoEn',              now);
  setN('DescripcionNormalizada', (descNormalizada && descNormalizada.trim()) ? descNormalizada.trim() : patronNorm);
  sh.appendRow(newRow);
  return mapeoID;
}

/**************************************
 * SEED REGLAS DE NORMALIZACIÓN
 * Inserta las reglas de GF_DICT_NORM_SEED en Diccionario_Normalizacion.
 * Idempotente: no duplica si el Patron ya existe.
 * Correr desde el editor o desde el menú si la hoja ya fue creada vacía.
 **************************************/

function gf_seedNormalizacion_APLICAR() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(GF.SHEET_DICT_NORM);
  if (!sh) {
    sh = ss.insertSheet(GF.SHEET_DICT_NORM);
    sh.getRange(1, 1, 1, GF_DICT_NORM_HEADERS.length).setValues([GF_DICT_NORM_HEADERS]);
    sh.setFrozenRows(1);
  }

  // Leer patrones existentes para no duplicar
  var existing = [];
  if (sh.getLastRow() >= 2) {
    var hdrs = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var ci = {};
    hdrs.forEach(function(h, i) { ci[String(h).trim()] = i; });
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().forEach(function(r) {
      existing.push(String(r[ci['Patron']] || '').trim().toLowerCase());
    });
  }

  var insertadas = 0;
  GF_DICT_NORM_SEED.forEach(function(seed) {
    var patron = String(seed[2] || '').trim();
    if (!patron) return;
    if (existing.indexOf(patron.toLowerCase()) !== -1) return; // ya existe
    sh.appendRow(seed);
    insertadas++;
    // Invalidar cache para que próximas llamadas lean las reglas nuevas
    _GF_DICT_NORM_RULES_ = null;
  });

  var msg = insertadas + ' regla(s) insertada(s). Total existentes: ' + existing.length + '.';
  Logger.log('gf_seedNormalizacion_APLICAR: ' + msg);
  SpreadsheetApp.getUi().alert(msg);
}

/**************************************
 * C13 — MIGRACIÓN ONE-SHOT: normalizar Patrons existentes
 * Normaliza el Patron de cada fila activa cuyo Patron difiere de gf_dict_normalizar_(Patron).
 * Guarda el crudo en PatronOriginal (solo si la columna existe o se crea aquí).
 * Detecta conflictos: dos filas que normalizan al mismo Patron con Cat/Subcat distintas
 * → las lista pero NO las toca (el usuario las resuelve manualmente o via C11).
 **************************************/

function gf_dict_migrar_aPatronesNormalizados_PREVIEW() {
  _dictMigrarPatrones_(true);
}

function gf_dict_migrar_aPatronesNormalizados_APLICAR() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    '⚠️ Normalizar Patrons existentes',
    'Actualiza la columna Patron al valor normalizado (sin fechas, cuotas, códigos).\n' +
    'Guarda el valor original en PatronOriginal.\n' +
    'Filas con conflicto (mismo Patron normalizado, Cat distinta) no se tocan.\n\n¿Confirmás?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;
  _dictMigrarPatrones_(false);
}

function _dictMigrarPatrones_(dryRun) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(GF.SHEET_DICT_APRENDIDO);
  if (!sh || sh.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('Diccionario_Aprendido vacío.');
    return;
  }

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx = {};
  headers.forEach(function(h, i) { idx[String(h).trim()] = i; });

  // Asegurar columna PatronOriginal.
  if (idx['PatronOriginal'] === undefined) {
    if (!dryRun) {
      var newCol = sh.getLastColumn() + 1;
      sh.getRange(1, newCol).setValue('PatronOriginal');
      idx['PatronOriginal'] = newCol - 1;
    } else {
      // En PREVIEW se indica que la columna se crearía.
      idx['PatronOriginal'] = -1; // sentinel: no existe aún
    }
  }

  var nRows = sh.getLastRow() - 1;
  var rows  = sh.getRange(2, 1, nRows, sh.getLastColumn()).getValues();

  // Recolectar candidatos a cambio.
  var cambios = []; // { sheetRow, patronViejo, patronNuevo, cat, mapeoID }
  for (var i = 0; i < rows.length; i++) {
    if (!gf_boolOrDefault_(rows[i][idx['Activo']], true)) continue;
    var patron = String(rows[i][idx['Patron']] || '').trim();
    if (!patron) continue;
    var norm = gf_dict_normalizar_(patron) || patron;
    if (norm === patron) continue; // ya está limpio
    cambios.push({
      sheetRow:    i + 2,
      patronViejo: patron,
      patronNuevo: norm,
      cat:         String(rows[i][idx['Categoría']] || '').trim(),
      subcat:      String(rows[i][idx['Subcategoria']] || '').trim(),
      mapeoID:     String(rows[i][idx['MapeoID']] || '')
    });
  }

  // Detectar conflictos: mismo Patron normalizado, Cat/Subcat distintas.
  var porNorm = {};
  cambios.forEach(function(c) {
    var k = c.patronNuevo.toLowerCase();
    if (!porNorm[k]) porNorm[k] = [];
    porNorm[k].push(c);
  });
  // También incluir filas YA limpias que tengan el mismo Patron normalizado que algún cambio.
  for (var j = 0; j < rows.length; j++) {
    if (!gf_boolOrDefault_(rows[j][idx['Activo']], true)) continue;
    var p = String(rows[j][idx['Patron']] || '').trim();
    if (!p) continue;
    var n = gf_dict_normalizar_(p) || p;
    if (n === p) {
      var kk = n.toLowerCase();
      if (porNorm[kk]) {
        porNorm[kk].push({
          sheetRow:    j + 2,
          patronViejo: p,
          patronNuevo: n,
          cat:         String(rows[j][idx['Categoría']] || '').trim(),
          subcat:      String(rows[j][idx['Subcategoria']] || '').trim(),
          mapeoID:     String(rows[j][idx['MapeoID']] || ''),
          yaLimpio:    true
        });
      }
    }
  }

  var conflictos = [];
  var sinConflicto = [];
  cambios.forEach(function(c) {
    var k = c.patronNuevo.toLowerCase();
    var grupo = porNorm[k] || [];
    var cats = grupo.map(function(x) { return (x.cat + '|' + x.subcat).toLowerCase(); });
    var unicas = cats.filter(function(v, i, a) { return a.indexOf(v) === i; });
    if (unicas.length > 1) {
      conflictos.push({ key: k, grupo: grupo });
    } else {
      sinConflicto.push(c);
    }
  });

  // --- Reporte ---
  var lines = [dryRun
    ? '=== PREVIEW normalizar Patrons (' + cambios.length + ' cambios, ' + conflictos.length + ' conflictos) ==='
    : '=== APLICAR normalizar Patrons (' + cambios.length + ' cambios, ' + conflictos.length + ' conflictos) ==='];
  lines.push('');

  if (!dryRun && idx['PatronOriginal'] === -1) {
    // shouldn't happen (column was added above in !dryRun path), but guard
  }
  if (dryRun && idx['PatronOriginal'] === -1) {
    lines.push('⚠️  Columna PatronOriginal no existe — se crearía al aplicar.');
    lines.push('');
  }

  if (sinConflicto.length) {
    lines.push('── Cambios a aplicar (' + sinConflicto.length + ') ──');
    sinConflicto.forEach(function(c) {
      lines.push('  [' + c.mapeoID + '] "' + c.patronViejo + '"');
      lines.push('    → "' + c.patronNuevo + '" [' + c.cat + ']');
    });
    lines.push('');
  }

  if (conflictos.length) {
    lines.push('── ⚠️ CONFLICTOS (' + conflictos.length + ') — mismo Patron normalizado, Cat/Subcat distintas ──');
    lines.push('   Acción del Aplicar: SKIP — ninguna fila se toca.');
    lines.push('');
    conflictos.forEach(function(cf, ci) {
      lines.push('CONFLICTO ' + (ci + 1) + ' — Patron normalizado: "' + cf.key + '"');
      cf.grupo.forEach(function(x) {
        var row = rows[x.sheetRow - 2];
        var etiq    = String(row[idx['Etiqueta']]       || '').trim();
        var persona = String(row[idx['PersonaDefault']] || '').trim();
        var origen  = String(row[idx['Origen']]         || '').trim();
        var uso     = String(row[idx['UsoCount']]       || '0');
        var activo  = gf_boolOrDefault_(row[idx['Activo']], true) ? 'TRUE' : 'FALSE';
        lines.push('  [' + x.mapeoID + ']');
        lines.push('    Patron actual:    "' + x.patronViejo + '"');
        lines.push('    Patron propuesto: "' + x.patronNuevo + '"');
        lines.push('    Categoría:    ' + x.cat);
        lines.push('    Subcategoría: ' + x.subcat);
        lines.push('    Etiqueta:     ' + (etiq    || '(vacío)'));
        lines.push('    Persona:      ' + (persona || '(vacío)'));
        lines.push('    Origen:       ' + (origen  || '(vacío)'));
        lines.push('    UsoCount:     ' + uso);
        lines.push('    Activo:       ' + activo);
      });
      lines.push('');
    });
  }

  // --- Aplicar ---
  var actualizados = 0;
  if (!dryRun) {
    // Construir set de mapeoIDs conflictivos para skipearlos.
    var conflictSet = {};
    conflictos.forEach(function(cf) {
      cf.grupo.forEach(function(x) { conflictSet[x.mapeoID] = true; });
    });

    sinConflicto.forEach(function(c) {
      if (conflictSet[c.mapeoID]) return;
      var rowData = sh.getRange(c.sheetRow, 1, 1, sh.getLastColumn()).getValues()[0];
      // Guardar original (solo si PatronOriginal está vacío — no pisar si ya tiene valor).
      if (idx['PatronOriginal'] >= 0 && !String(rowData[idx['PatronOriginal']] || '').trim()) {
        rowData[idx['PatronOriginal']] = c.patronViejo;
      }
      rowData[idx['Patron']] = c.patronNuevo;
      sh.getRange(c.sheetRow, 1, 1, sh.getLastColumn()).setValues([rowData]);
      actualizados++;
    });
    lines.push('✅ Actualizadas: ' + actualizados + ' filas.');
    lines.push('⚠️  Conflictos sin tocar: ' + conflictos.length + ' grupos → revisar manualmente.');
  } else {
    lines.push('Corré Migraciones → [C13] Aplicar para aplicar los cambios sin conflicto.');
  }

  var output = lines.join('\n');
  Logger.log(output);

  // Escribir a hoja Log para no cortar por límite de ui.alert.
  var shLog = ss.getSheetByName(GF.SHEET_LOG);
  if (shLog) {
    var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    shLog.appendRow([ts, dryRun ? 'C13 PREVIEW' : 'C13 APLICAR', output]);
    SpreadsheetApp.getUi().alert(
      (dryRun ? 'PREVIEW' : 'APLICAR') + ' completado.\n' +
      'Cambios candidatos: ' + sinConflicto.length + '\n' +
      'Conflictos (sin tocar): ' + conflictos.length + '\n\n' +
      'Detalle completo en hoja Log → última fila.'
    );
  } else {
    // Fallback: mostrar solo el resumen + conflictos en el alert.
    var resumen = lines.slice(0, 3).join('\n') + '\n\n';
    if (conflictos.length) {
      var cfLines = [];
      conflictos.forEach(function(cf) {
        cfLines.push('CONFLICTO "' + cf.key + '":');
        cf.grupo.forEach(function(x) {
          cfLines.push('  [' + x.mapeoID + '] ' + x.cat + '/' + x.subcat + ' uso:' +
            (rows[x.sheetRow - 2][idx['UsoCount']] || 0));
        });
      });
      resumen += cfLines.join('\n');
    }
    SpreadsheetApp.getUi().alert(resumen.substring(0, 1800));
  }
}

/**************************************
 * C11 — CONSOLIDACIÓN DE DUPLICADOS
 * Agrupa entradas activas por patron normalizado.
 * PREVIEW: muestra candidatos. APLICAR: desactiva duplicados (guarda el de mayor UsoCount).
 * Grupos con categorías distintas se saltean (revisión manual).
 **************************************/

function gf_dict_proponerConsolidaciones() {
  _dictConsolidaciones_(true);
}

function gf_dict_consolidar_APLICAR_menu_() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    '⚠️ Consolidar Diccionario_Aprendido',
    'Desactiva entradas duplicadas (mismo comercio, patron distinto).\n' +
    'Solo consolida grupos donde la categoría es la misma.\n' +
    'Grupos con categorías distintas se saltean.\n\n¿Confirmás?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;
  _dictConsolidaciones_(false);
}

function _dictConsolidaciones_(dryRun) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(GF.SHEET_DICT_APRENDIDO);
  if (!sh || sh.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('Diccionario_Aprendido vacío.');
    return;
  }

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx = {};
  headers.forEach(function(h, i) { idx[String(h).trim()] = i; });

  var nRows = sh.getLastRow() - 1;
  var rows  = sh.getRange(2, 1, nRows, sh.getLastColumn()).getValues();

  // Solo activas
  var activas = [];
  rows.forEach(function(r, i) {
    if (gf_boolOrDefault_(r[idx['Activo']], true))
      activas.push({ row: r, sheetRow: i + 2 });
  });

  // Agrupar por normalized patron
  var grupos = {};
  activas.forEach(function(e) {
    var patron = String(e.row[idx['Patron']] || '').trim();
    if (!patron) return;
    var key = gf_dict_normalizar_(patron).toLowerCase().trim();
    if (!key) return;
    if (!grupos[key]) grupos[key] = [];
    grupos[key].push(e);
  });

  var candidatos = Object.keys(grupos).filter(function(k) { return grupos[k].length > 1; });
  var lines = [dryRun
    ? '=== PREVIEW consolidar dict (' + candidatos.length + ' grupos) ==='
    : '=== APLICAR consolidar dict (' + candidatos.length + ' grupos) ==='];
  lines.push('');

  var desactivados = 0;
  var saltados     = 0;

  candidatos.forEach(function(key) {
    var grupo = grupos[key];
    lines.push('── [' + key + '] (' + grupo.length + ') ──');

    // Categorías únicas del grupo
    var cats = grupo.map(function(e) {
      return String(e.row[idx['Categoría']] || '').trim().toLowerCase();
    }).filter(function(c, i, a) { return a.indexOf(c) === i; });

    var mismaCategoria = cats.length <= 1;

    grupo.forEach(function(e) {
      lines.push('  · [uso:' + (e.row[idx['UsoCount']] || 0) + '] [' +
        (e.row[idx['Categoría']] || '') + '] ' + (e.row[idx['Patron']] || ''));
    });

    if (!mismaCategoria) {
      lines.push('  ⚠️ Categorías distintas — salteado');
      saltados++;
      return;
    }

    // Ganador: mayor UsoCount; empate → UltimoUso más reciente
    grupo.sort(function(a, b) {
      var uA = Number(a.row[idx['UsoCount']] || 0);
      var uB = Number(b.row[idx['UsoCount']] || 0);
      if (uB !== uA) return uB - uA;
      var dA = a.row[idx['UltimoUso']] ? new Date(a.row[idx['UltimoUso']]).getTime() : 0;
      var dB = b.row[idx['UltimoUso']] ? new Date(b.row[idx['UltimoUso']]).getTime() : 0;
      return dB - dA;
    });

    var ganador = grupo[0];
    lines.push('  ✅ Ganador: "' + (ganador.row[idx['Patron']] || '') +
               '" (uso:' + (ganador.row[idx['UsoCount']] || 0) + ')');

    if (!dryRun) {
      for (var i = 1; i < grupo.length; i++) {
        var loser = grupo[i];
        var rowData = loser.row.slice();
        rowData[idx['Activo']] = false;
        sh.getRange(loser.sheetRow, 1, 1, sh.getLastColumn()).setValues([rowData]);
        desactivados++;
      }
    } else {
      lines.push('  → ' + (grupo.length - 1) + ' entrada(s) se desactivarían');
    }
  });

  lines.push('');
  if (dryRun) {
    lines.push('Grupos consolidables: ' + (candidatos.length - saltados) +
               ' · Salteados: ' + saltados);
    lines.push('Corré Migraciones → [C11] Aplicar consolidaciones para aplicar.');
  } else {
    lines.push('Desactivados: ' + desactivados + ' · Salteados: ' + saltados);
  }

  var output = lines.join('\n');
  Logger.log(output);
  var ui = SpreadsheetApp.getUi();
  ui.alert(output.length > 1500
    ? output.substring(0, 1500) + '\n...(ver Logger para el resto)'
    : output);
}

/**************************************
 * SEED DESDE HISTORICO
 * Lee Historico, agrupa por Descripción normalizada,
 * se queda con la combo cat/subcat/etiqueta más frecuente,
 * e inserta en Diccionario_Aprendido las que tengan ≥ MIN_USOS
 * y no existan ya (no pisa entradas existentes).
 **************************************/

function gf_seedDictDesdeHistorico_PREVIEW() {
  _seedDictDesdeHistorico_(true);
}
function gf_seedDictDesdeHistorico_APLICAR() {
  _seedDictDesdeHistorico_(false);
}

/**
 * Seed directo desde GastosEsperados e IngresosEsperados.
 * Por cada fila activa crea una entrada en Diccionario_Aprendido usando
 * Subcategoria como Patron (TipoMatch='contains'), con su Categoria y Etiqueta.
 * No pisa entradas que ya existan (mismo Patron exact/contains).
 */
function _seedDictDesdeHistorico_(dryRun) {
  const ss   = SpreadsheetApp.getActive();
  const shD  = ss.getSheetByName(GF.SHEET_DICT_APRENDIDO);
  const shGE = ss.getSheetByName(GF.SHEET_GASTOS_ESPERADOS);
  const shIE = ss.getSheetByName(GF.SHEET_INGRESOS_ESPERADOS);

  const lineas = [dryRun
    ? '=== PREVIEW: seed Diccionario_Aprendido desde GastosEsperados/IngresosEsperados ==='
    : '=== APLICAR: seed Diccionario_Aprendido desde GastosEsperados/IngresosEsperados ==='];

  if (!shD) {
    lineas.push('❌ Diccionario_Aprendido no encontrado. Corré migración 3.0 primero.');
    SpreadsheetApp.getUi().alert(lineas.join('\n'));
    return;
  }

  // Leer entradas activas de ambas hojas
  var candidatos = [];
  [[shGE, 'GastosEsperados'], [shIE, 'IngresosEsperados']].forEach(function(par) {
    var sh = par[0];
    if (!sh || sh.getLastRow() < 2) return;
    gf_readObjectsFromSheet_(sh).forEach(function(r) {
      if (!gf_boolOrDefault_(r['Activo'], false)) return;
      var cat  = String(r['Categoria'] || r['Categoría'] || '').trim();
      var sub  = String(r['Subcategoria'] || '').trim();
      var etiq = String(r['Etiqueta'] || '').trim();
      if (cat && sub) candidatos.push({ cat: cat, sub: sub, etiq: etiq });
    });
  });

  if (!candidatos.length) {
    lineas.push('⚠️ Sin filas activas en GastosEsperados ni IngresosEsperados.');
    SpreadsheetApp.getUi().alert(lineas.join('\n'));
    return;
  }

  // Leer patrones existentes para no pisar
  var existentes = {};
  if (shD.getLastRow() >= 2) {
    const hD = shD.getRange(1, 1, 1, shD.getLastColumn()).getValues()[0];
    const iD = {};
    hD.forEach(function(h, i) { iD[String(h).trim()] = i; });
    if (iD['Patron'] !== undefined) {
      shD.getRange(2, iD['Patron'] + 1, shD.getLastRow() - 1, 1).getValues()
        .forEach(function(r) { existentes[String(r[0] || '').trim().toLowerCase()] = true; });
    }
  }

  // Filtrar los que ya existen (patron = subcategoria normalizada)
  var nuevos = candidatos.filter(function(c) {
    return !existentes[c.sub.toLowerCase()];
  });

  lineas.push('Total activos en Esperados: ' + candidatos.length);
  lineas.push('Ya existen en dict: ' + (candidatos.length - nuevos.length));
  lineas.push('A insertar: ' + nuevos.length);
  lineas.push('');

  nuevos.forEach(function(c) {
    lineas.push('  ' + c.sub + ' → ' + c.cat + (c.etiq ? ' [' + c.etiq + ']' : ''));
  });

  if (!dryRun && nuevos.length) {
    nuevos.forEach(function(c) {
      // Insertar directo con appendRow para poder usar TipoMatch='contains'
      // (gf_dictAprender_ usa 'exact'; acá queremos 'contains' para que
      //  "Colegio Sofi" matchee aunque el usuario tipee solo "colegio")
      var sh = shD;
      var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      var idx = {};
      headers.forEach(function(h, i) { idx[String(h).trim()] = i; });
      var newRow = new Array(headers.length).fill('');
      var set = function(col, val) { if (idx[col] !== undefined) newRow[idx[col]] = val; };
      set('MapeoID',      newId_('MAP'));
      set('Patron',       c.sub);
      set('TipoMatch',    'contains');
      set('Categoría',    c.cat);
      set('Subcategoria', c.sub);
      set('Etiqueta',     c.etiq);
      set('Origen',       'Historico');
      set('Confianza',    0.9);
      set('UsoCount',     0);
      set('UltimoUso',    new Date());
      set('Activo',       true);
      set('CreadoPor',    'Sistema');
      set('CreadoEn',     new Date());
      sh.appendRow(newRow);
    });
    lineas.push('✅ ' + nuevos.length + ' entradas insertadas con Origen="Historico", TipoMatch="contains"');
  }

  lineas.push(dryRun ? '\nCorré gf_seedDictDesdeHistorico_APLICAR para insertar.' : '=== FIN ===');
  Logger.log(lineas.join('\n'));
  SpreadsheetApp.getUi().alert(lineas.join('\n'));
}

/**************************************
 * MIGRACIÓN: columna DescripcionNormalizada
 * Agregar columna al final de Diccionario_Aprendido.
 * Idempotente: no duplica si ya existe.
 * Correr una sola vez desde el editor de Apps Script.
 **************************************/

function runMigracionDescNorm() {
  gf_dict_migrarDescripcionNormalizada_();
}

function gf_dict_migrarDescripcionNormalizada_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(GF.SHEET_DICT_APRENDIDO);
  if (!sh) {
    Logger.log('gf_dict_migrarDescripcionNormalizada_: hoja Diccionario_Aprendido no encontrada.');
    SpreadsheetApp.getUi().alert('❌ Hoja Diccionario_Aprendido no encontrada. Corré la migración 3.0 primero.');
    return;
  }
  const cols = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                 .map(function(h) { return String(h).trim(); });
  if (cols.indexOf('DescripcionNormalizada') !== -1) {
    Logger.log('gf_dict_migrarDescripcionNormalizada_: columna ya existe — sin cambios.');
    SpreadsheetApp.getUi().alert('✅ La columna DescripcionNormalizada ya existe. Sin cambios.');
    return;
  }
  const newCol = sh.getLastColumn() + 1;
  sh.getRange(1, newCol).setValue('DescripcionNormalizada');
  Logger.log('gf_dict_migrarDescripcionNormalizada_: columna agregada en col ' + newCol);
  SpreadsheetApp.getUi().alert('✅ Columna DescripcionNormalizada agregada en columna ' + newCol + '.\nLas filas existentes quedan vacías y se poblan orgánicamente al usar el sistema.');
}
