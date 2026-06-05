/**************************************
 * 49_Tarjetas_API.gs - Fase 2.2.c
 * Endpoints públicos que el frontend consume via google.script.run.
 * Une el parser PDF, el importer y el confirmar en flujos completos.
 *
 * Funciones públicas (llamadas desde WebApp):
 *   api_importarPDF(params)        — parsea PDF, crea resumen, importa movimientos
 *   api_aprenderMapeos(mapeoArray) — aprende/actualiza mapeos en el diccionario
 *   api_confirmarResumen(params)   — confirma un resumen y empuja a Historico
 *   api_getPendientes(params)      — devuelve Raw pendientes de un resumen
 **************************************/

/**
 * Endpoint principal: parsea el PDF, crea el resumen en Tarjetas_Resumen
 * e importa los movimientos en Tarjetas_Raw (con auto-match incluido).
 *
 * @param {Object} params
 * @param {string} params.pdfBase64      PDF en base64
 * @param {string} params.tarjetaCodigo  Código del catálogo (ej: 'GAL-VISA')
 * @returns {{
 *   ok: boolean,
 *   resumenID: string,
 *   resumen: Object,
 *   insertados: number,
 *   duplicados: number,
 *   autoMatched: number,
 *   sinMapeo: number,
 *   error?: string
 * }}
 */
function api_importarPDF(params) {
  try {
    requireUser_();

    if (!params || !params.pdfBase64) throw new Error('pdfBase64 requerido');

    // ── 0. Verificar duplicado por hash ANTES de llamar a Claude ────────────
    const hashPDF = gf_calcularHashPDF_(params.pdfBase64);
    if (!params.force) {
      const dupCheck = gf_checkResumenDuplicado_(hashPDF);
      if (dupCheck.duplicado) {
        Logger.log('api_importarPDF: duplicado detectado por hash → ' + dupCheck.resumenIDDup);
        return {
          ok:     true,
          status: 'duplicado',
          resumen: dupCheck.resumen
        };
      }
    }

    // ── 1. Parsear con Claude (tarjetaCodigo opcional) ───────────────────────
    const parsed = parsearPDF(params.pdfBase64, params.tarjetaCodigo || null);
    const { resumen, movimientos } = parsed;

    // ── 2. Resolver tarjetaCodigo (manual o auto-detectado) ──────────────────
    var tarjetaCodigo = params.tarjetaCodigo || null;
    if (!tarjetaCodigo) {
      tarjetaCodigo = gf_detectarTarjetaCodigo_(resumen.banco, resumen.tarjeta);
      if (!tarjetaCodigo) {
        throw new Error(
          'No pude detectar la tarjeta del PDF. ' +
          'Banco: "' + (resumen.banco || '?') + '", ' +
          'Tarjeta: "' + (resumen.tarjeta || '?') + '". ' +
          'Seleccioná manualmente en el selector.'
        );
      }
      Logger.log('api_importarPDF: tarjeta auto-detectada → ' + tarjetaCodigo);
    }

    // ── 3. Construir resumenID y verificar duplicado ─────────────────────────
    const tarjetaInfo = GF_TARJETAS_CATALOGO.filter(
      function(t) { return t[0] === tarjetaCodigo; }
    )[0] || [];
    const banco         = tarjetaInfo[1] || '';
    const tarjetaNombre = tarjetaInfo[2] || '';
    const cuentaDebito  = tarjetaInfo[3] || resumen.cuentaDebito || '';

    // ResumenID determinístico: tarjeta + nroResumen (evita crear duplicados al re-subir)
    const resumenID = tarjetaCodigo + '_' + String(resumen.nroResumen || newId_('RES')).replace(/\s+/g, '');

    const ss   = SpreadsheetApp.getActive();
    const shRes = ss.getSheetByName(GF.SHEET_TARJETAS_RESUMEN);
    if (!shRes) throw new Error('Hoja Tarjetas_Resumen no encontrada');

    const hRes = shRes.getRange(1, 1, 1, shRes.getLastColumn()).getValues()[0];
    const iRes = {};
    hRes.forEach(function(h, i) { iRes[String(h).trim()] = i; });

    // Verificar si ya existe
    let yaExiste = false;
    if (shRes.getLastRow() >= 2 && iRes['ResumenID'] !== undefined) {
      const ids = shRes.getRange(2, iRes['ResumenID'] + 1, shRes.getLastRow() - 1, 1).getValues();
      yaExiste  = ids.some(function(r) { return String(r[0]).trim() === resumenID; });
    }

    // ── 3. Crear fila en Tarjetas_Resumen (si no existe) ────────────────────
    const now     = new Date();
    const usuario = Session.getActiveUser().getEmail() || 'WebApp';

    if (!yaExiste) {
      const fechaCierre  = gf_parseDate_(resumen.fechaCierre);
      const fechaVenc    = gf_parseDate_(resumen.fechaVencimiento);
      const mesResumen   = fechaVenc ? yyyymm_(fechaVenc) : '';

      const resRow = new Array(hRes.length).fill('');
      var setRes = function(col, val) {
        if (iRes[col] !== undefined && val !== undefined && val !== null) resRow[iRes[col]] = val;
      };

      setRes('ResumenID',           resumenID);
      setRes('TarjetaCodigo',       tarjetaCodigo);
      setRes('Banco',               banco);
      setRes('Tarjeta',             tarjetaNombre);
      setRes('Moneda',              'ARS');
      setRes('MesResumen',          mesResumen);
      setRes('FechaCierre',         fechaCierre || '');
      setRes('FechaVencimiento',    fechaVenc   || '');
      setRes('CuentaDebitoDetalle', cuentaDebito);
      setRes('TotalARS',            resumen.totalARS     || 0);
      setRes('TotalUSD',            resumen.totalUSD     || 0);
      setRes('PagoMinimoARS',       resumen.pagoMinimoARS|| 0);
      setRes('EstadoImport',        'pendiente_revision');
      setRes('ImportadoEn',         now);
      setRes('ImportadoPor',        usuario);
      setRes('HashPDF',             hashPDF);
      var obs = 'Titular: ' + (resumen.titular || '');
      if (params.force) {
        var dupExistente = gf_checkResumenDuplicado_(hashPDF);
        if (dupExistente.duplicado) {
          obs += ' | Importación forzada — posible duplicado de ' + dupExistente.resumenIDDup;
        } else {
          obs += ' | Importación forzada';
        }
      }
      setRes('Observaciones',       obs);

      shRes.appendRow(resRow);
      Logger.log('api_importarPDF: resumen creado ' + resumenID);
    } else {
      Logger.log('api_importarPDF: resumen ya existe, se reutiliza ' + resumenID);
    }

    // ── 4. Mapear movimientos al formato de gf_importarMovimientos_ ──────────
    const movsMapeados = movimientos.map(function(m) {
      return {
        seq:              m.seq,
        tipoLinea:        m.tipoLinea        || 'consumo',
        fechaConsumo:     gf_parseDate_(m.fechaConsumo),
        descripcionRaw:   m.descripcionRaw   || '',
        nroCupon:         m.nroCupon         || '',
        cuotaActual:      m.cuotaActual       !== undefined ? m.cuotaActual  : 0,
        cuotaTotal:       m.cuotaTotal        !== undefined ? m.cuotaTotal   : 0,
        moneda:           m.moneda            || 'ARS',
        monto:            m.monto             || 0,
        personaDetectada: m.personaDetectada  || '',
        esBonificacion:      !!m.esBonificacion,
        esReverso:           !!m.esReverso,
        esImpuesto:          !!m.esImpuesto,
        esPagoAnterior:      !!m.esPagoAnterior,
        categoriaSugerida:   m.categoriaSugerida   || '',
        subcategoriaSugerida:m.subcategoriaSugerida || '',
        notas:               ''
      };
    });

    // ── 5. Importar (dedup + auto-match) ─────────────────────────────────────
    const importResult = gf_importarMovimientos_(resumenID, movsMapeados);

    return {
      ok:            true,
      resumenID:     resumenID,
      tarjetaCodigo: tarjetaCodigo,
      resumen:       resumen,
      insertados:    importResult.insertados,
      duplicados:    importResult.duplicados,
      autoMatched:   importResult.autoMatched,
      sinMapeo:      importResult.sinMapeo
    };

  } catch (e) {
    Logger.log('api_importarPDF ERROR: ' + e.message + '\n' + e.stack);
    return { ok: false, error: e.message };
  }
}

/**
 * Devuelve las filas de Tarjetas_Raw de un resumen para que el frontend
 * las muestre en la pantalla de revisión.
 * Filtra por resumenID; opcionalmente filtra por estado.
 *
 * @param {Object} params
 * @param {string}   params.resumenID
 * @param {string[]} [params.estados]  Filtro de EstadoMatch (ej: ['pending','auto'])
 *                                     Si no se pasa, devuelve todos.
 * @returns {{ ok: boolean, filas: Array<Object>, error?: string }}
 */
function api_getPendientes(params) {
  try {
    requireUser_();
    if (!params || !params.resumenID) throw new Error('resumenID requerido');

    const sh = SpreadsheetApp.getActive().getSheetByName(GF.SHEET_TARJETAS_RAW);
    if (!sh || sh.getLastRow() < 2) return { ok: true, filas: [] };

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const idx = {};
    headers.forEach(function(h, i) { idx[String(h).trim()] = i; });

    const nRows = sh.getLastRow() - 1;
    const rows  = sh.getRange(2, 1, nRows, sh.getLastColumn()).getValues();

    const estadosFiltro = (params.estados && params.estados.length) ? params.estados : null;

    const tz = Session.getScriptTimeZone();
    const filas = [];

    rows.forEach(function(row, i) {
      if (String(row[idx['ResumenID']] || '').trim() !== params.resumenID) return;

      const estado = String(row[idx['EstadoMatch']] || '').trim();
      if (estadosFiltro && estadosFiltro.indexOf(estado) === -1) return;

      // Serializar fecha a string para pasar al frontend
      var fechaConsumoVal = idx['FechaConsumo'] !== undefined ? row[idx['FechaConsumo']] : '';
      var fechaConsumoStr = '';
      if (fechaConsumoVal instanceof Date) {
        fechaConsumoStr = Utilities.formatDate(fechaConsumoVal, tz, 'yyyy-MM-dd');
      } else if (fechaConsumoVal) {
        fechaConsumoStr = String(fechaConsumoVal);
      }

      filas.push({
        sheetRow:        i + 2,
        rawID:           String(row[idx['RawID']]           || ''),
        seq:             Number(row[idx['Seq']]             || 0),
        tipoLinea:       String(row[idx['TipoLinea']]       || ''),
        fechaConsumo:    fechaConsumoStr,
        descripcionRaw:  String(row[idx['DescripcionRaw']]  || ''),
        cuotaActual:     Number(row[idx['CuotaActual']]     || 0),
        cuotaTotal:      Number(row[idx['CuotaTotal']]      || 0),
        moneda:          String(row[idx['Moneda']]          || 'ARS'),
        monto:           Number(row[idx['Monto']]           || 0),
        personaDetectada:String(row[idx['PersonaDetectada']]|| ''),
        estadoMatch:     estado,
        mapeoID:         String(row[idx['MapeoID']]         || ''),
        confianza:       Number(row[idx['Confianza']]       || 0),
        descLimpia:      String(row[idx['DescripcionLimpia']]|| ''),
        categoria:       String(row[idx['Categoría']]       || ''),
        subcategoria:    String(row[idx['Subcategoria']]    || ''),
        etiqueta:        String(row[idx['Etiqueta']]        || ''),
        personaFinal:    String(row[idx['PersonaFinal']]    || ''),
        accionUsuario:   String(row[idx['AccionUsuario']]   || ''),
        esBonificacion:  !!row[idx['EsBonificacion']],
        esReverso:       !!row[idx['EsReverso']],
        esImpuesto:      !!row[idx['EsImpuesto']]
      });
    });

    return { ok: true, filas: filas };

  } catch (e) {
    Logger.log('api_getPendientes ERROR: ' + e.message);
    return { ok: false, error: e.message, filas: [] };
  }
}


/**
 * Confirma un resumen: empuja las filas aprobadas a Historico + Tarjetas_Movimientos.
 * Antes de confirmar, aplica los cambios de AccionUsuario que el frontend haya
 * enviado (ediciones finales del usuario en la pantalla de revisión).
 *
 * @param {Object} params
 * @param {string} params.resumenID
 * @param {Array<{rawID: string, accionUsuario: string, personaFinal?: string,
 *                descLimpia?: string, categoria?: string, subcategoria?: string,
 *                etiqueta?: string}>} [params.cambios]
 *   Cambios finales del usuario (opcionales; si ya los guardó vía api_aprenderMapeos, no hace falta)
 * @returns {{ ok: boolean, confirmados: number, excluidos: number,
 *             ignorados: number, errores: number, error?: string }}
 */
function api_confirmarResumen(params) {
  try {
    requireUser_();
    if (!params || !params.resumenID) throw new Error('resumenID requerido');

    // Aplicar cambios finales si el frontend los manda en este mismo call
    if (params.cambios && params.cambios.length > 0) {
      const ss    = SpreadsheetApp.getActive();
      const shRaw = ss.getSheetByName(GF.SHEET_TARJETAS_RAW);
      if (shRaw && shRaw.getLastRow() >= 2) {
        const rawHeaders = shRaw.getRange(1, 1, 1, shRaw.getLastColumn()).getValues()[0];
        const iRaw = {};
        rawHeaders.forEach(function(h, i) { iRaw[String(h).trim()] = i; });

        if (iRaw['RawID'] !== undefined) {
          const nRaw  = shRaw.getLastRow() - 1;
          const rawIDs = shRaw.getRange(2, iRaw['RawID'] + 1, nRaw, 1).getValues();

          params.cambios.forEach(function(c) {
            for (var j = 0; j < rawIDs.length; j++) {
              if (String(rawIDs[j][0]).trim() !== c.rawID) continue;
              var sheetRow = j + 2;
              var setR = function(col, val) {
                if (iRaw[col] !== undefined && val !== undefined) {
                  shRaw.getRange(sheetRow, iRaw[col] + 1).setValue(val);
                }
              };
              if (c.accionUsuario  !== undefined) setR('AccionUsuario',   c.accionUsuario);
              if (c.personaFinal   !== undefined) setR('PersonaFinal',    c.personaFinal);
              if (c.descLimpia     !== undefined) setR('DescripcionLimpia', c.descLimpia);
              if (c.categoria      !== undefined) setR('Categoría',       c.categoria);
              if (c.subcategoria   !== undefined) setR('Subcategoria',    c.subcategoria);
              if (c.etiqueta       !== undefined) setR('Etiqueta',        c.etiqueta);
              // Marcar como manual si se editó
              if (c.accionUsuario !== undefined || c.descLimpia !== undefined) {
                setR('EstadoMatch', 'manual');
              }
              break;
            }
          });
        }
      }
    }

    // Auto-aprender mapeos de las filas incluidas que tengan categoría
    const shRaw2 = SpreadsheetApp.getActive().getSheetByName(GF.SHEET_TARJETAS_RAW);
    if (shRaw2 && shRaw2.getLastRow() >= 2) {
      var rawH2 = shRaw2.getRange(1, 1, 1, shRaw2.getLastColumn()).getValues()[0];
      var iR2 = {};
      rawH2.forEach(function(h, i) { iR2[String(h).trim()] = i; });

      var nR2 = shRaw2.getLastRow() - 1;
      var rawRows2 = shRaw2.getRange(2, 1, nR2, shRaw2.getLastColumn()).getValues();

      var mapeos = [];
      rawRows2.forEach(function(row) {
        if (String(row[iR2['ResumenID']] || '').trim() !== params.resumenID) return;
        var accion = String(row[iR2['AccionUsuario']] || '').trim();
        if (accion === 'ExcluirTotalmente' || accion === 'Ignorar') return;

        var desc    = String(row[iR2['DescripcionRaw']]   || '').trim();
        var cat     = String(row[iR2['Categoría']]        || '').trim();
        if (!desc || !cat) return;

        mapeos.push({
          patron:         desc,
          tipoMatch:      'exact',
          descLimpia:     String(row[iR2['DescripcionLimpia']] || desc).trim(),
          categoria:      cat,
          subcategoria:   String(row[iR2['Subcategoria']]  || '').trim(),
          etiqueta:       String(row[iR2['Etiqueta']]      || '').trim(),
          personaDefault: String(row[iR2['PersonaFinal']]  || '').trim(),
          accionDefault:  accion === 'IncluirNoDash' ? 'IncluirNoDash' : '',
          confianza:      0.9
        });
      });

      var aprendidos = 0;
      mapeos.forEach(function(m) {
        try {
          gf_dictAprender_(m.patron, m.categoria, m.subcategoria, m.etiqueta, 'Tarjeta');
          aprendidos++;
        } catch(e) {
          Logger.log('api_confirmarResumen: error aprendiendo "' + m.patron + '": ' + e.message);
        }
      });
      if (aprendidos > 0) {
        Logger.log('api_confirmarResumen: aprendidos ' + aprendidos + ' mapeos via gf_dictAprender_');
      }
    }

    // Confirmar
    const result = confirmarResumen(params.resumenID);
    return { ok: true, confirmados: result.confirmados, excluidos: result.excluidos,
             ignorados: result.ignorados, errores: result.errores,
             aprendidos: (mapeos && mapeos.length) || 0 };

  } catch (e) {
    Logger.log('api_confirmarResumen ERROR: ' + e.message);
    return { ok: false, error: e.message, confirmados: 0, excluidos: 0, ignorados: 0, errores: 0 };
  }
}

/**
 * Importa todos los PDFs nuevos de la carpeta de Drive configurada en Config B19.
 * "Nuevo" = archivos cuyo nombre no matchea ningún ResumenID ya existente.
 *
 * Convención de nombre de archivo para detectar la tarjeta:
 *   El nombre debe contener uno de los códigos del catálogo:
 *   BBVA-VISA-SIG, BBVA-MASTER-BLK, GAL-VISA, GAL-MASTER-BLK
 *   Ejemplo: "2026-03_GAL-VISA.pdf" o "GAL-VISA_2026-03.pdf"
 *
 * Si el nombre no contiene un código reconocido, el archivo se loggea
 * como "no procesado" y se continúa con el siguiente.
 *
 * @returns {{ ok: boolean, procesados: number, omitidos: number,
 *             errores: number, detalle: Array<Object> }}
 */
function api_importarPDFsDesdeDrive() {
  try {
    requireUser_();

    const sh = SpreadsheetApp.getActive().getSheetByName(GF.SHEET_CONFIG);
    if (!sh) throw new Error('Hoja Config no encontrada');

    const folderID = String(sh.getRange(GF.CFG_PDF_FOLDER_CELL).getValue() || '').trim();
    if (!folderID) {
      throw new Error(
        'Google Drive PDF Folder ID no configurado. ' +
        'Ingresalo en Config celda ' + GF.CFG_PDF_FOLDER_CELL
      );
    }

    const folder = DriveApp.getFolderById(folderID);
    const codigos = GF_TARJETAS_CATALOGO.map(function(t) { return t[0]; });

    // Cargar ResumenIDs ya existentes para dedup a nivel de resumen
    const shRes = SpreadsheetApp.getActive().getSheetByName(GF.SHEET_TARJETAS_RESUMEN);
    const resumenesExistentes = new Set();
    if (shRes && shRes.getLastRow() >= 2) {
      const hRes = shRes.getRange(1, 1, 1, shRes.getLastColumn()).getValues()[0];
      const colResumenID = hRes.map(function(h) { return String(h).trim(); }).indexOf('ResumenID');
      if (colResumenID >= 0) {
        const ids = shRes.getRange(2, colResumenID + 1, shRes.getLastRow() - 1, 1).getValues();
        ids.forEach(function(r) {
          var v = String(r[0] || '').trim();
          if (v) resumenesExistentes.add(v);
        });
      }
    }

    const files = folder.getFilesByType(MimeType.PDF);
    const detalle = [];
    var procesados = 0, omitidos = 0, errores = 0;

    while (files.hasNext()) {
      var file = files.next();
      var nombre = file.getName();

      // Detectar tarjetaCodigo desde el nombre del archivo
      var tarjetaCodigo = null;
      for (var i = 0; i < codigos.length; i++) {
        if (nombre.toUpperCase().indexOf(codigos[i].toUpperCase()) !== -1) {
          tarjetaCodigo = codigos[i];
          break;
        }
      }

      if (!tarjetaCodigo) {
        Logger.log('api_importarPDFsDesdeDrive: nombre sin código reconocido: ' + nombre);
        detalle.push({ archivo: nombre, resultado: 'omitido', razon: 'código de tarjeta no detectado en el nombre' });
        omitidos++;
        continue;
      }

      // Convertir a base64
      var pdfBase64;
      try {
        var blob = file.getBlob();
        pdfBase64 = Utilities.base64Encode(blob.getBytes());
      } catch (e) {
        detalle.push({ archivo: nombre, resultado: 'error', razon: 'no se pudo leer el archivo: ' + e.message });
        errores++;
        continue;
      }

      // Importar
      try {
        var result = api_importarPDF({ pdfBase64: pdfBase64, tarjetaCodigo: tarjetaCodigo });
        if (!result.ok) throw new Error(result.error || 'error desconocido');

        detalle.push({
          archivo:     nombre,
          resultado:   'ok',
          resumenID:   result.resumenID,
          insertados:  result.insertados,
          duplicados:  result.duplicados,
          autoMatched: result.autoMatched,
          sinMapeo:    result.sinMapeo
        });
        procesados++;
      } catch (e) {
        Logger.log('api_importarPDFsDesdeDrive: error procesando ' + nombre + ': ' + e.message);
        detalle.push({ archivo: nombre, resultado: 'error', razon: e.message });
        errores++;
      }
    }

    const resumen = { ok: true, procesados: procesados, omitidos: omitidos, errores: errores, detalle: detalle };
    Logger.log('api_importarPDFsDesdeDrive: ' + JSON.stringify(resumen));
    SpreadsheetApp.getActive().toast(
      'Drive: ' + procesados + ' procesados | ' + omitidos + ' omitidos | ' + errores + ' errores',
      'Importador Drive', 8
    );
    return resumen;

  } catch (e) {
    Logger.log('api_importarPDFsDesdeDrive ERROR: ' + e.message);
    return { ok: false, error: e.message, procesados: 0, omitidos: 0, errores: 0, detalle: [] };
  }
}

// ── Helper privado ────────────────────────────────────────────────────────────

/**
 * Parsea una fecha YYYY-MM-DD (string) a Date.
 * @param {string|null} str
 * @returns {Date|null}
 */
function gf_parseDate_(str) {
  if (!str) return null;
  if (str instanceof Date) return str;
  var s = String(str).trim();
  // Acepta YYYY-MM-DD
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}
