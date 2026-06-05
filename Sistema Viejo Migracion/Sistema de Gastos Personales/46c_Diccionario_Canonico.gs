/**************************************
 * 46c_Diccionario_Canonico.gs — one-shot data fix (Fase 3 / sesión 7)
 *
 * Problema: MAP_0f30adf6 fue corrompido por saves incorrectos.
 * Tenía Etiqueta='JuanARS'/PersonaDefault='' en lugar de MaríaARS/María.
 * MAP_f22bb03d ('Accenture SRL') es un duplicado parcial a desactivar.
 *
 * Pasos:
 *  1. Corregir MAP_0f30adf6 → Etiqueta='MaríaARS', PersonaDefault='María'
 *  2. Insertar fila MaríaUSD con el mismo Patron (si no existe)
 *  3. Desactivar MAP_f22bb03d (Activo=false, no borrar)
 *  4. Reportar que Juan se auto-crea en el próximo import (C8+C9 lo cubren)
 *
 * Uso: Migraciones → [C7] Preview canonizar dict → validar → Aplicar
 **************************************/

function gf_dict_canonico_PREVIEW() {
  _dictCanonico_(true);
}

function gf_dict_canonico_APLICAR_menu_() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    '⚠️ Canonizar Diccionario_Aprendido',
    'Esto va a:\n' +
    '  • Corregir MAP_0f30adf6 → Etiqueta=MaríaARS, PersonaDefault=María\n' +
    '  • Insertar fila MaríaUSD con el mismo Patron (si no existe)\n' +
    '  • Desactivar MAP_f22bb03d (Activo=false)\n\n' +
    '¿Confirmás?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;
  _dictCanonico_(false);
}

function _dictCanonico_(dryRun) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(GF.SHEET_DICT_APRENDIDO);
  if (!sh) {
    SpreadsheetApp.getUi().alert('❌ Diccionario_Aprendido no encontrado. Corré migración 3.0 primero.');
    return;
  }

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx = {};
  headers.forEach(function(h, i) { idx[String(h).trim()] = i; });

  var lines = [dryRun
    ? '=== PREVIEW: canonizar Diccionario_Aprendido ==='
    : '=== APLICAR: canonizar Diccionario_Aprendido ==='];

  var nRows = sh.getLastRow() - 1;
  if (nRows < 1) {
    lines.push('⚠️ Diccionario vacío.');
    SpreadsheetApp.getUi().alert(lines.join('\n'));
    return;
  }

  var allRows = sh.getRange(2, 1, nRows, sh.getLastColumn()).getValues();

  // ── Paso 1: corregir MAP_0f30adf6 ──────────────────────────────────────────
  var row0 = null, row0Idx = -1;
  for (var i = 0; i < allRows.length; i++) {
    if (String(allRows[i][idx['MapeoID']] || '') === 'MAP_0f30adf6') {
      row0 = allRows[i].slice();
      row0Idx = i + 2;
      break;
    }
  }

  lines.push('');
  lines.push('Paso 1 — MAP_0f30adf6:');
  if (!row0) {
    lines.push('  ⚠️ No encontrado. ¿Ya fue corregido o tiene otro MapeoID?');
  } else {
    var patronMaria = String(row0[idx['Patron']] || '');
    lines.push('  Patron:        "' + patronMaria + '"');
    lines.push('  Etiqueta:      "' + String(row0[idx['Etiqueta']] || '') + '" → "MaríaARS"');
    lines.push('  PersonaDefault:"' + String(row0[idx['PersonaDefault']] || '') + '" → "María"');
    if (!dryRun) {
      row0[idx['Etiqueta']]       = 'MaríaARS';
      row0[idx['PersonaDefault']] = 'María';
      sh.getRange(row0Idx, 1, 1, sh.getLastColumn()).setValues([row0]);
      lines.push('  ✅ Corregido.');
    }
  }

  // ── Paso 2: insertar fila MaríaUSD ──────────────────────────────────────────
  lines.push('');
  lines.push('Paso 2 — fila MaríaUSD:');
  if (!row0) {
    lines.push('  Omitido (MAP_0f30adf6 no encontrado).');
  } else {
    var patronMaria_ = String(row0[idx['Patron']] || '');
    var yaExiste = allRows.some(function(r) {
      return String(r[idx['Patron']] || '').toLowerCase() === patronMaria_.toLowerCase() &&
             String(r[idx['Etiqueta']] || '').toLowerCase() === 'maríausd';
    });
    if (yaExiste) {
      lines.push('  ⚠️ Ya existe fila con Patron="' + patronMaria_ + '" y Etiqueta=MaríaUSD. Sin cambios.');
    } else {
      // Buscar MontoEsperado de MaríaUSD en IngresosEsperados
      var montoUSD = null;
      var shIE = ss.getSheetByName(GF.SHEET_INGRESOS_ESPERADOS);
      if (shIE && shIE.getLastRow() >= 2) {
        gf_readObjectsFromSheet_(shIE).forEach(function(r) {
          if (montoUSD !== null) return;
          if (gf_boolOrDefault_(r['Activo'], false) &&
              String(r['Etiqueta'] || '').trim() === 'MaríaUSD') {
            montoUSD = r['MontoEsperado'] || null;
          }
        });
      }
      var catRow = String(row0[idx['Categoría']] || '');
      var subRow = String(row0[idx['Subcategoria']] || '');
      lines.push('  Patron: "' + patronMaria_ + '"');
      lines.push('  Categoria: "' + catRow + '", Subcategoria: "' + subRow + '"');
      lines.push('  Etiqueta: "MaríaUSD", PersonaDefault: "María"');
      if (montoUSD) lines.push('  MontoEsperado (de IngresosEsperados): ' + montoUSD);
      if (!dryRun) {
        var newHdrs = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
        var nIdx = {};
        newHdrs.forEach(function(h, i) { nIdx[String(h).trim()] = i; });
        var newRow = new Array(newHdrs.length).fill('');
        var s = function(col, val) { if (nIdx[col] !== undefined) newRow[nIdx[col]] = val; };
        s('MapeoID',               newId_('MAP'));
        s('Patron',                patronMaria_);
        s('TipoMatch',             'exact');
        s('Categoría',             catRow);
        s('Subcategoria',          subRow);
        s('Etiqueta',              'MaríaUSD');
        s('PersonaDefault',        'María');
        s('Origen',                'Comprobante');
        s('Confianza',             0.95);
        s('UsoCount',              0);
        s('UltimoUso',             new Date());
        s('Activo',                true);
        s('CreadoPor',             Session.getActiveUser().getEmail() || 'Sistema');
        s('CreadoEn',              new Date());
        s('DescripcionNormalizada', patronMaria_);
        sh.appendRow(newRow);
        lines.push('  ✅ Fila MaríaUSD insertada.');
      }
    }
  }

  // ── Paso 3: desactivar MAP_f22bb03d ────────────────────────────────────────
  lines.push('');
  lines.push('Paso 3 — MAP_f22bb03d:');
  var rowF = null, rowFIdx = -1;
  for (var j = 0; j < allRows.length; j++) {
    if (String(allRows[j][idx['MapeoID']] || '') === 'MAP_f22bb03d') {
      rowF = allRows[j].slice();
      rowFIdx = j + 2;
      break;
    }
  }
  if (!rowF) {
    lines.push('  ⚠️ MAP_f22bb03d no encontrado. ¿Ya fue desactivado?');
  } else {
    lines.push('  Patron: "' + String(rowF[idx['Patron']] || '') + '"');
    lines.push('  Activo: "' + String(rowF[idx['Activo']] || '') + '" → false');
    if (!dryRun) {
      rowF[idx['Activo']] = false;
      sh.getRange(rowFIdx, 1, 1, sh.getLastColumn()).setValues([rowF]);
      lines.push('  ✅ Desactivado.');
    }
  }

  // ── Paso 4: entrada de Juan ────────────────────────────────────────────────
  lines.push('');
  lines.push('Paso 4 — Entrada canónica para Juan (JuanARS):');
  lines.push('  La descripción de los PDFs de Juan es diferente a la de María.');
  lines.push('  No se conoce el texto exacto sin parsear un PDF de Juan.');
  lines.push('  Acción: auto-creación en el próximo import de sueldo de Juan.');
  lines.push('  Con C9 activo: INSERT nuevo (no pisa la entrada de María).');

  lines.push('');
  lines.push(dryRun
    ? 'Corré Migraciones → [C7] Aplicar canonizar dict para aplicar.'
    : '=== FIN ===');

  Logger.log(lines.join('\n'));
  SpreadsheetApp.getUi().alert(lines.join('\n'));
}
