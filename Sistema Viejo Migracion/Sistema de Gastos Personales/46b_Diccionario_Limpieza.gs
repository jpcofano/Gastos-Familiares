/**************************************
 * 46b_Diccionario_Limpieza.gs — Pase 2
 * Limpieza one-shot del Diccionario_Aprendido.
 *
 * Uso desde el editor de Apps Script:
 *   1. Correr gf_dict_limpieza_PREVIEW() → revisar Logger.log
 *   2. Correr gf_dict_limpieza_APLICAR({ confirmado: true }) → aplica cambios
 *
 * NO tiene entradas de menú automáticas.
 * PREVIEW es read-only (nunca modifica datos).
 * APLICAR requiere { confirmado: true } explícito.
 **************************************/

// Categorías canónicas: delegado a gf_getCategoriasCanonicas_() (46_Diccionario_Aprendido.gs)

// Mapeo acordado con el usuario: cat no canónica (lowercase) → cat canónica
var GF_CATS_RENAME_MAP_LIMPIEZA_ = {
  'servicios': 'Casa',
  'impuesto':  'Impuestos y finanzas',
  'deporte':   'Educación y chicos',
  'ingreso':   'Ingresos'
};

// Regex: detecta Date.toString() — ej "Fri Sep 11 2026 00:00:00 GMT-0300..."
var GF_RE_BASURA_LIMPIEZA_    = /^[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d/;

// Regex: sufijo de monto al final del patrón — ej "( 28886,17)" o "(28886.17)"
var GF_RE_MONTO_SUFIJO_LIMPIEZA_ = /\(\s*[\d.,]+\s*\)\s*$/;


// ══════════════════════════════════════════════════════════════
// PARTE 1 — PREVIEW (read-only, solo loguea)
// ══════════════════════════════════════════════════════════════

function gf_dict_limpieza_PREVIEW() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(GF.SHEET_DICT_APRENDIDO);
  if (!sh || sh.getLastRow() < 2) {
    Logger.log('gf_dict_limpieza_PREVIEW: hoja Diccionario_Aprendido vacía o inexistente.');
    return;
  }

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx = {};
  headers.forEach(function(h, i) { idx[String(h).trim()] = i; });

  var nRows = sh.getLastRow() - 1;
  var data  = sh.getRange(2, 1, nRows, sh.getLastColumn()).getValues();

  var log  = [];
  var norm = function(s) { return String(s || '').trim().toLowerCase(); };

  var catsNorm = gf_getCategoriasCanonicas_().map(norm);

  log.push('══════════════════════════════════════════════════════════════');
  log.push('gf_dict_limpieza_PREVIEW — ' + new Date().toISOString());
  log.push('Total filas en hoja: ' + nRows);
  log.push('══════════════════════════════════════════════════════════════');

  // ── SECCIÓN A: Categorías no canónicas ──────────────────────────────────────
  var renamesAuto = [];
  var revisar     = [];

  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (!gf_boolOrDefault_(r[idx['Activo']], true)) continue;
    var cat     = String(r[idx['Categoría']] || '').trim();
    var catNorm = norm(cat);
    if (!cat) continue;
    if (catsNorm.indexOf(catNorm) !== -1) continue;

    var entry = {
      mapeoID: String(r[idx['MapeoID']]      || ''),
      patron:  String(r[idx['Patron']]       || ''),
      subcat:  String(r[idx['Subcategoria']] || ''),
      uso:     Number(r[idx['UsoCount']])    || 0,
      cat:     cat
    };

    if (GF_CATS_RENAME_MAP_LIMPIEZA_.hasOwnProperty(catNorm)) {
      entry.catNueva = GF_CATS_RENAME_MAP_LIMPIEZA_[catNorm];
      renamesAuto.push(entry);
    } else {
      revisar.push(entry);
    }
  }

  log.push('');
  log.push('═════ SECCIÓN A — Categorías no canónicas ═════');
  log.push('Total filas con cat no canónica (activas): ' + (renamesAuto.length + revisar.length));
  log.push('');
  log.push('Renames automáticos disponibles (vía mapeo acordado):');
  if (renamesAuto.length === 0) {
    log.push('  (ninguno)');
  } else {
    renamesAuto.forEach(function(e) {
      log.push('  [' + e.mapeoID + '] "' + e.cat + '" → renombrar a "' + e.catNueva + '"');
      log.push('    Patron: ' + e.patron);
      log.push('    SubCat: ' + e.subcat);
      log.push('    UsoCount: ' + e.uso);
    });
  }
  log.push('');
  log.push('REVISAR MANUALMENTE (no hay mapeo automático):');
  if (revisar.length === 0) {
    log.push('  (ninguno)');
  } else {
    revisar.forEach(function(e) {
      log.push('  [' + e.mapeoID + '] "' + e.cat + '" → ?');
      log.push('    Patron: ' + e.patron);
    });
  }

  // ── SECCIÓN B: Mapeos basura ─────────────────────────────────────────────────
  var basura = [];
  for (var j = 0; j < data.length; j++) {
    var r = data[j];
    if (!gf_boolOrDefault_(r[idx['Activo']], true)) continue;
    var patron = String(r[idx['Patron']] || '').trim();
    if (!patron) continue;
    if (!GF_RE_BASURA_LIMPIEZA_.test(patron)) continue;
    basura.push({
      mapeoID: String(r[idx['MapeoID']]   || ''),
      patron:  patron,
      cat:     String(r[idx['Categoría']] || ''),
      uso:     Number(r[idx['UsoCount']]) || 0
    });
  }

  log.push('');
  log.push('═════ SECCIÓN B — Mapeos basura ═════');
  log.push('Total: ' + basura.length);
  basura.forEach(function(e) {
    log.push('  [' + e.mapeoID + '] patrón parsea como Date');
    log.push('    Patron: ' + e.patron.substring(0, 80));
    log.push('    Cat: ' + e.cat);
    log.push('    UsoCount: ' + e.uso);
  });

  // ── SECCIÓN C: Duplicados con monto en patrón ────────────────────────────────
  var grupos     = {};
  var gruposKeys = [];

  for (var k = 0; k < data.length; k++) {
    var r = data[k];
    if (!gf_boolOrDefault_(r[idx['Activo']], true)) continue;
    var patron = String(r[idx['Patron']] || '').trim();
    if (!GF_RE_MONTO_SUFIJO_LIMPIEZA_.test(patron)) continue;

    var patronBase = patron.replace(GF_RE_MONTO_SUFIJO_LIMPIEZA_, '').trim();
    var gKey       = patronBase.toLowerCase();

    if (!grupos.hasOwnProperty(gKey)) {
      grupos[gKey] = { patronBase: patronBase, filas: [] };
      gruposKeys.push(gKey);
    }
    grupos[gKey].filas.push({
      rowIdx:  k,
      mapeoID: String(r[idx['MapeoID']]   || ''),
      patron:  patron,
      uso:     Number(r[idx['UsoCount']]) || 0,
      ultimo:  r[idx['UltimoUso']] ? new Date(r[idx['UltimoUso']]).getTime() : 0
    });
  }

  var gruposDup  = gruposKeys.filter(function(gk) { return grupos[gk].filas.length > 1; });
  var gruposSolo = gruposKeys.filter(function(gk) { return grupos[gk].filas.length === 1; });
  var totalDesactC = gruposDup.reduce(function(s, gk) { return s + grupos[gk].filas.length - 1; }, 0);

  log.push('');
  log.push('═════ SECCIÓN C — Duplicados con monto en patrón ═════');
  log.push('Grupos con >1 fila (se consolidan en APLICAR): ' + gruposDup.length);

  if (gruposSolo.length > 0) {
    log.push('Filas con monto en patrón pero sin duplicado (solo 1 fila — no se tocan): ' + gruposSolo.length);
    gruposSolo.forEach(function(gk) {
      var g = grupos[gk];
      log.push('  (único) "' + g.patronBase + '" — [' + g.filas[0].mapeoID + '] ' + g.filas[0].patron);
    });
  }
  log.push('');

  gruposDup.forEach(function(gk, gi) {
    var g     = grupos[gk];
    var filas = g.filas.slice().sort(function(a, b) {
      return (b.uso !== a.uso) ? b.uso - a.uso : b.ultimo - a.ultimo;
    });
    var ganadora  = filas[0];
    var totalUso  = filas.reduce(function(s, f) { return s + f.uso; }, 0);

    log.push('GRUPO ' + (gi + 1) + ' — Patrón base: "' + g.patronBase + '"');
    log.push('  Filas en grupo: ' + filas.length + '  |  UsoCount total: ' + totalUso);
    filas.forEach(function(f) {
      var tag = (f.mapeoID === ganadora.mapeoID) ? ' ← GANADORA' : '';
      log.push('    [' + f.mapeoID + '] ' + f.patron + ' — uso ' + f.uso + tag);
    });
    log.push('  Acción APLICAR:');
    log.push('    - Conservar [' + ganadora.mapeoID + '], Patron limpio: "' + g.patronBase + '", UsoCount=' + totalUso);
    log.push('    - Desactivar (' + (filas.length - 1) + ' filas):');
    filas.slice(1).forEach(function(f) {
      log.push('      [' + f.mapeoID + '] → Activo=FALSE');
    });
    log.push('');
  });

  // ── SECCIÓN D: Subcategorías no canónicas (informativo) ─────────────────────
  var dictSh = ss.getSheetByName(GF.SHEET_DICT);
  var subcatsCanon = {};
  if (dictSh && dictSh.getLastRow() >= 2) {
    var dH = dictSh.getRange(1, 1, 1, dictSh.getLastColumn()).getValues()[0];
    var dI = {};
    dH.forEach(function(h, ci) { dI[String(h).trim()] = ci; });
    var dRows = dictSh.getRange(2, 1, dictSh.getLastRow() - 1, dictSh.getLastColumn()).getValues();
    dRows.forEach(function(dr) {
      var tipo = norm(dr[dI['Tipo']] || '');
      if (tipo === 'subcategoria' && gf_boolOrDefault_(dr[dI['Activo']], true)) {
        var val = String(dr[dI['Valor']] || '').trim();
        if (val) subcatsCanon[norm(val)] = true;
      }
    });
  }

  var subcatFreq = {};
  for (var m = 0; m < data.length; m++) {
    var r = data[m];
    if (!gf_boolOrDefault_(r[idx['Activo']], true)) continue;
    var sc = String(r[idx['Subcategoria']] || '').trim();
    if (!sc || subcatsCanon[norm(sc)]) continue;
    subcatFreq[sc] = (subcatFreq[sc] || 0) + 1;
  }

  var subcatList = Object.keys(subcatFreq).map(function(sk) {
    return { subcat: sk, count: subcatFreq[sk] };
  }).sort(function(a, b) { return b.count - a.count; });

  log.push('═════ SECCIÓN D — Subcategorías no canónicas (informativo, NO se tocan) ═════');
  log.push('Top ' + Math.min(10, subcatList.length) + ' subcategorías no canónicas por frecuencia:');
  if (subcatList.length === 0) {
    log.push('  (todas las subcategorías son canónicas)');
  } else {
    subcatList.slice(0, 10).forEach(function(e) {
      log.push('  "' + e.subcat + '" (' + e.count + ' filas)');
    });
  }

  // ── RESUMEN ──────────────────────────────────────────────────────────────────
  log.push('');
  log.push('═════ RESUMEN ═════');
  log.push('Cambios que APLICAR ejecutaría:');
  log.push('  - ' + renamesAuto.length + ' renames de categoría');
  log.push('  - ' + basura.length + ' mapeos basura desactivados');
  log.push('  - ' + gruposDup.length + ' grupos consolidados (' + totalDesactC + ' filas marcadas inactivas)');
  log.push('  - 0 cambios en subcategorías (informativo solamente)');
  log.push('');
  log.push('NO SE MODIFICARON DATOS.');
  log.push('Corré gf_dict_limpieza_APLICAR({ confirmado: true }) para aplicar.');
  log.push('══════════════════════════════════════════════════════════════');

  Logger.log(log.join('\n'));
}


// Wrapper para menú: muestra dialog de confirmación antes de pasar { confirmado: true }
function gf_dict_limpieza_APLICAR_menu_() {
  var ui   = SpreadsheetApp.getUi();
  var resp = ui.alert(
    '⚠️ Limpieza Diccionario_Aprendido',
    '¿Ya revisaste el PREVIEW en Logger.log y querés aplicar los cambios?\n\nEsta acción modifica datos (renames, desactivaciones, consolidaciones).',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp !== ui.Button.OK) { Logger.log('gf_dict_limpieza_APLICAR: cancelado desde menú.'); return; }
  gf_dict_limpieza_APLICAR({ confirmado: true });
}


// ══════════════════════════════════════════════════════════════
// PARTE 2 — APLICAR (modifica datos; requiere { confirmado: true })
// ══════════════════════════════════════════════════════════════

function gf_dict_limpieza_APLICAR(opts) {
  if (!opts || opts.confirmado !== true) {
    var msg = 'Esta función modifica datos. Pasar { confirmado: true } después de revisar PREVIEW.';
    Logger.log(msg);
    SpreadsheetApp.getUi().alert(msg);
    return;
  }

  var sh = SpreadsheetApp.getActive().getSheetByName(GF.SHEET_DICT_APRENDIDO);
  if (!sh || sh.getLastRow() < 2) {
    Logger.log('gf_dict_limpieza_APLICAR: hoja Diccionario_Aprendido vacía o inexistente.');
    return;
  }

  // Leer estado fresco de la hoja (no cache de PREVIEW)
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx = {};
  headers.forEach(function(h, i) { idx[String(h).trim()] = i; });

  var nRows   = sh.getLastRow() - 1;
  var data    = sh.getRange(2, 1, nRows, sh.getLastColumn()).getValues();
  var today   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var norm    = function(s) { return String(s || '').trim().toLowerCase(); };
  var cCol    = function(name) { return idx[name] !== undefined ? idx[name] + 1 : -1; };

  var colActivo    = cCol('Activo');
  var colCategoria = cCol('Categoría');
  var colPatron    = cCol('Patron');
  var colUsoCount  = cCol('UsoCount');
  var colUltimo    = cCol('UltimoUso');
  var colNotas     = cCol('Notas');

  var catsNorm     = gf_getCategoriasCanonicas_().map(norm);
  var log          = [];
  var renames      = 0;
  var desactBasura = 0;
  var desactDup    = 0;
  var grupos_cons  = 0;

  log.push('═══ gf_dict_limpieza_APLICAR — ' + today + ' ═══');

  // ── a) Renames de categoría ──────────────────────────────────────────────────
  log.push('');
  log.push('── a) Renames de categoría ──');
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (!gf_boolOrDefault_(r[idx['Activo']], true)) continue;
    var cat     = String(r[idx['Categoría']] || '').trim();
    var catNorm = norm(cat);
    if (catsNorm.indexOf(catNorm) !== -1) continue;
    if (!GF_CATS_RENAME_MAP_LIMPIEZA_.hasOwnProperty(catNorm)) continue; // REVISAR MANUALMENTE

    var catNueva = GF_CATS_RENAME_MAP_LIMPIEZA_[catNorm];
    var sRow     = i + 2;
    if (colCategoria > 0) sh.getRange(sRow, colCategoria).setValue(catNueva);
    data[i][idx['Categoría']] = catNueva;
    log.push('  [' + String(r[idx['MapeoID']] || '') + '] "' + cat + '" → "' + catNueva + '"');
    renames++;
  }
  if (renames === 0) log.push('  (ninguno)');
  SpreadsheetApp.flush();

  // ── b) Mapeos basura ─────────────────────────────────────────────────────────
  log.push('');
  log.push('── b) Mapeos basura desactivados ──');
  for (var j = 0; j < data.length; j++) {
    var r = data[j];
    if (!gf_boolOrDefault_(r[idx['Activo']], true)) continue;
    var patron = String(r[idx['Patron']] || '').trim();
    if (!patron || !GF_RE_BASURA_LIMPIEZA_.test(patron)) continue;

    var sRow       = j + 2;
    var mapeoID    = String(r[idx['MapeoID']] || '');
    var notaActual = String(r[idx['Notas']]   || '').trim();
    var nota       = 'Desactivado por limpieza ' + today + ': patrón inválido';
    var notaFinal  = notaActual ? notaActual + ' | ' + nota : nota;

    if (colActivo > 0) sh.getRange(sRow, colActivo).setValue(false);
    if (colNotas  > 0) sh.getRange(sRow, colNotas).setValue(notaFinal);
    data[j][idx['Activo']] = false;
    log.push('  [' + mapeoID + '] Patron: ' + patron.substring(0, 60));
    desactBasura++;
  }
  if (desactBasura === 0) log.push('  (ninguno)');
  SpreadsheetApp.flush();

  // ── c) Consolidar duplicados con monto ───────────────────────────────────────
  log.push('');
  log.push('── c) Consolidar duplicados con monto ──');

  var grupos     = {};
  var gruposKeys = [];

  for (var k = 0; k < data.length; k++) {
    var r = data[k];
    if (!gf_boolOrDefault_(r[idx['Activo']], true)) continue;
    var patron = String(r[idx['Patron']] || '').trim();
    if (!GF_RE_MONTO_SUFIJO_LIMPIEZA_.test(patron)) continue;

    var patronBase = patron.replace(GF_RE_MONTO_SUFIJO_LIMPIEZA_, '').trim();
    var gKey       = patronBase.toLowerCase();
    if (!grupos.hasOwnProperty(gKey)) {
      grupos[gKey] = { patronBase: patronBase, filas: [] };
      gruposKeys.push(gKey);
    }
    grupos[gKey].filas.push({
      rowIdx:  k,
      mapeoID: String(r[idx['MapeoID']]   || ''),
      uso:     Number(r[idx['UsoCount']]) || 0,
      ultimo:  r[idx['UltimoUso']] ? new Date(r[idx['UltimoUso']]).getTime() : 0,
      notas:   String(r[idx['Notas']]     || '').trim()
    });
  }

  gruposKeys.forEach(function(gKey) {
    var g = grupos[gKey];
    if (g.filas.length < 2) return; // sin duplicados — no tocar

    g.filas.sort(function(a, b) {
      return (b.uso !== a.uso) ? b.uso - a.uso : b.ultimo - a.ultimo;
    });

    var ganadora  = g.filas[0];
    var perdedoras = g.filas.slice(1);
    var totalUso  = g.filas.reduce(function(s, f) { return s + f.uso; }, 0);
    var maxUltimo = g.filas.reduce(function(m, f) { return f.ultimo > m ? f.ultimo : m; }, 0);

    var gSRow = ganadora.rowIdx + 2;
    if (colPatron   > 0) sh.getRange(gSRow, colPatron).setValue(g.patronBase);
    if (colUsoCount > 0) sh.getRange(gSRow, colUsoCount).setValue(totalUso);
    if (colUltimo   > 0 && maxUltimo > 0) sh.getRange(gSRow, colUltimo).setValue(new Date(maxUltimo));

    log.push('  GRUPO "' + g.patronBase + '" — ' + g.filas.length + ' filas, UsoCount total ' + totalUso);
    log.push('    Ganadora [' + ganadora.mapeoID + ']: Patron limpio, UsoCount=' + totalUso);

    perdedoras.forEach(function(f) {
      var fSRow    = f.rowIdx + 2;
      var nota     = 'Consolidado en ' + ganadora.mapeoID + ' por gf_dict_limpieza ' + today;
      var notaFinal = f.notas ? f.notas + ' | ' + nota : nota;
      if (colActivo > 0) sh.getRange(fSRow, colActivo).setValue(false);
      if (colNotas  > 0) sh.getRange(fSRow, colNotas).setValue(notaFinal);
      log.push('    Desactivada [' + f.mapeoID + ']: Activo=FALSE');
      desactDup++;
    });

    grupos_cons++;
  });

  if (grupos_cons === 0) log.push('  (ninguno)');
  SpreadsheetApp.flush();

  // ── RESUMEN FINAL ────────────────────────────────────────────────────────────
  log.push('');
  log.push('═══ RESUMEN FINAL ═══');
  log.push('Renames aplicados:        ' + renames);
  log.push('Basura desactivada:       ' + desactBasura);
  log.push('Grupos consolidados:      ' + grupos_cons + ' (' + desactDup + ' filas inactivas)');
  log.push('Total filas modificadas:  ' + (renames + desactBasura + desactDup + grupos_cons));
  log.push('═══════════════════════════════════════════');

  Logger.log(log.join('\n'));
}
