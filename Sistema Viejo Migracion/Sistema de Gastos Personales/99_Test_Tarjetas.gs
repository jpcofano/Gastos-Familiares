/**************************************
 * 99_Test_Tarjetas.gs - Fase 2.2.a Tanda 2
 * Tests end-to-end con datos hardcodeados.
 * SOLO para desarrollo. No correr en producción con datos reales.
 *
 * Funciones públicas (correr desde el editor de Apps Script):
 *   test_importarYConfirmar_BBVA_Master_2603()  — flujo completo end-to-end
 *   test_solo_lookup()                          — prueba dictLookup_ aislado
 *   test_limpiar_test_data()                    — borra las filas de test de todas las hojas
 **************************************/

// ── Constantes del test ────────────────────────────────────────────────────────
const TEST_RESUMEN_ID    = 'TEST-BBVA-MASTER-2603';
const TEST_TARJETA_COD   = 'BBVA-MASTER-BLK';
const TEST_BANCO         = 'BBVA';
const TEST_TARJETA       = 'Mastercard Black';
const TEST_MES_RESUMEN   = '2026-03';
const TEST_FECHA_CIERRE  = new Date(2026, 2, 10);   // 2026-03-10
const TEST_FECHA_VENC    = new Date(2026, 2, 20);   // 2026-03-20  (Lectura B: esta es Historico.Fecha)
const TEST_CUENTA_DEBITO = 'C.A. 0203124134';

/**
 * Movimientos hardcodeados del BBVA Mastercard Black - marzo 2026.
 * Incluye: consumo normal, consumo con cuotas, percepción (auto-excluir),
 * reintegro de percepción, y pago del mes anterior (ignorar).
 */
const TEST_MOVIMIENTOS = [
  {
    tipoLinea:       'consumo',
    fechaConsumo:    new Date(2026, 1, 5),    // 2026-02-05
    descripcionRaw:  'SUPERMERCADO COTO',
    moneda:          'ARS',
    monto:           15800,
    personaDetectada:'Juan'
  },
  {
    tipoLinea:       'consumo',
    fechaConsumo:    new Date(2026, 1, 12),   // 2026-02-12
    descripcionRaw:  'FARMACITY',
    moneda:          'ARS',
    monto:           4200,
    personaDetectada:'María'
  },
  {
    tipoLinea:       'cuota',
    fechaConsumo:    new Date(2026, 0, 20),   // 2026-01-20 (consumo original)
    descripcionRaw:  'NETFLIX 2/12',
    nroCupon:        '00123',
    cuotaActual:     2,
    cuotaTotal:      12,
    moneda:          'ARS',
    monto:           1490,
    personaDetectada:'Juan'
  },
  {
    tipoLinea:       'impuesto',
    fechaConsumo:    new Date(2026, 1, 5),    // mismo día que el Coto
    descripcionRaw:  'IIBB PERCEP-CABA SUPERMERCADO COTO',
    moneda:          'ARS',
    monto:           316,
    personaDetectada:''
  },
  {
    tipoLinea:       'impuesto',
    fechaConsumo:    new Date(2026, 1, 5),
    descripcionRaw:  'IVA RG 4240 21% SUPERMERCADO COTO',
    moneda:          'ARS',
    monto:           3318,
    personaDetectada:''
  },
  {
    tipoLinea:       'reintegro_percepcion',
    fechaConsumo:    new Date(2026, 2, 1),    // 2026-03-01
    descripcionRaw:  'DEV.IMP PERCEP RG 2023',
    moneda:          'ARS',
    monto:           1200,
    personaDetectada:'Juan'
  },
  {
    tipoLinea:       'pago_anterior',
    fechaConsumo:    new Date(2026, 1, 20),   // 2026-02-20
    descripcionRaw:  'PAGO RESUMEN ANTERIOR',
    moneda:          'ARS',
    monto:           85000,
    esPagoAnterior:  true,
    personaDetectada:''
  }
];

/**
 * Test end-to-end completo:
 * 1. Inserta fila en Tarjetas_Resumen
 * 2. Importa movimientos (gf_importarMovimientos_) → escribe en Raw + auto-match
 * 3. Muestra resumen en log antes de confirmar
 * 4. Confirma el resumen (confirmarResumen) → escribe en Historico + Tarjetas_Movimientos
 * 5. Loggea resultado final para validación manual
 *
 * NOTA: El pago_anterior y las percepciones NO deben aparecer en Historico.
 * El reintegro de percepción SÍ debe aparecer como Tipo=Ingreso, Subtipo=TarjetaReintegro.
 */
function test_importarYConfirmar_BBVA_Master_2603() {
  Logger.log('=== TEST: importar + confirmar BBVA Master 2026-03 ===');

  // ── PASO 1: crear fila de resumen ──────────────────────────────────────────
  const ss = SpreadsheetApp.getActive();
  const shRes = ss.getSheetByName(GF.SHEET_TARJETAS_RESUMEN);
  if (!shRes) throw new Error('Hoja Tarjetas_Resumen no encontrada');

  const hRes = shRes.getRange(1, 1, 1, shRes.getLastColumn()).getValues()[0];
  const iRes = {};
  hRes.forEach((h, i) => { iRes[String(h).trim()] = i; });

  // Chequear si ya existe el resumen de test
  let resumenYaExiste = false;
  if (shRes.getLastRow() >= 2) {
    const ids = shRes.getRange(2, iRes['ResumenID'] + 1, shRes.getLastRow() - 1, 1).getValues();
    resumenYaExiste = ids.some(r => String(r[0]).trim() === TEST_RESUMEN_ID);
  }

  if (!resumenYaExiste) {
    const resRow = new Array(hRes.length).fill('');
    const setRes = (col, val) => { if (iRes[col] !== undefined) resRow[iRes[col]] = val; };
    setRes('ResumenID',           TEST_RESUMEN_ID);
    setRes('TarjetaCodigo',       TEST_TARJETA_COD);
    setRes('Banco',               TEST_BANCO);
    setRes('Tarjeta',             TEST_TARJETA);
    setRes('Moneda',              'ARS');
    setRes('MesResumen',          TEST_MES_RESUMEN);
    setRes('FechaCierre',         TEST_FECHA_CIERRE);
    setRes('FechaVencimiento',    TEST_FECHA_VENC);
    setRes('CuentaDebitoDetalle', TEST_CUENTA_DEBITO);
    setRes('TotalARS',            TEST_MOVIMIENTOS
      .filter(m => !m.esPagoAnterior && m.tipoLinea !== 'reintegro_percepcion')
      .reduce((s, m) => s + (m.monto || 0), 0));
    setRes('EstadoImport',        'pendiente_revision');
    setRes('ImportadoEn',         new Date());
    setRes('ImportadoPor',        Session.getActiveUser().getEmail() || 'test');
    shRes.appendRow(resRow);
    Logger.log('PASO 1: fila de resumen creada (' + TEST_RESUMEN_ID + ')');
  } else {
    Logger.log('PASO 1: resumen ya existe, se reutiliza');
  }

  // ── PASO 2: importar movimientos ───────────────────────────────────────────
  Logger.log('PASO 2: importando ' + TEST_MOVIMIENTOS.length + ' movimientos...');
  const importResult = gf_importarMovimientos_(TEST_RESUMEN_ID, TEST_MOVIMIENTOS);
  Logger.log('PASO 2 resultado: ' + JSON.stringify(importResult));

  // ── PASO 3: mostrar estado de Raw antes de confirmar ──────────────────────
  Logger.log('PASO 3: estado de Raw antes de confirmar:');
  test_logRawState_(TEST_RESUMEN_ID);

  // ── PASO 4: confirmar ──────────────────────────────────────────────────────
  Logger.log('PASO 4: confirmando resumen...');
  const confirmResult = confirmarResumen(TEST_RESUMEN_ID);
  Logger.log('PASO 4 resultado: ' + JSON.stringify(confirmResult));

  // ── PASO 5: validación final ───────────────────────────────────────────────
  Logger.log('PASO 5: validación en Historico:');
  test_logHistoricoState_(TEST_RESUMEN_ID);

  Logger.log('=== FIN TEST ===');
  Logger.log('Verificar manualmente:');
  Logger.log('  ✓ Historico: SUPERMERCADO COTO y FARMACITY → Tipo=Gasto, Fecha=2026-03-20, Mes=2026-03');
  Logger.log('  ✓ Historico: NETFLIX 2/12 → Tipo=Gasto, Fecha=2026-03-20');
  Logger.log('  ✓ Historico: DEV.IMP PERCEP → Tipo=Ingreso, Subtipo=TarjetaReintegro');
  Logger.log('  ✗ NO en Historico: IIBB PERCEP-CABA (ExcluirTotalmente)');
  Logger.log('  ✗ NO en Historico: IVA RG 4240 (ExcluirTotalmente)');
  Logger.log('  ✗ NO en Historico: PAGO RESUMEN ANTERIOR (pago_anterior → Ignorar si AccionUsuario=Ignorar, o ExcluirTotalmente si es percepción)');

  return { importResult, confirmResult };
}

/**
 * Prueba aislada de gf_dictLookup_ sin escribir nada.
 * Útil para verificar que el diccionario matchea correctamente.
 */
function test_solo_lookup() {
  Logger.log('=== TEST: dictLookup_ aislado ===');

  const casos = [
    { desc: 'SUPERMERCADO COTO', banco: 'BBVA', tarjeta: 'BBVA-MASTER-BLK' },
    { desc: 'IIBB PERCEP-CABA SUPERMERCADO COTO', banco: 'BBVA', tarjeta: '' },
    { desc: 'IVA RG 4240 21% ALGO', banco: '', tarjeta: '' },
    { desc: 'DB.RG 5617 30% ALGO', banco: '', tarjeta: '' },
    { desc: 'FARMACITY', banco: 'BBVA', tarjeta: '' },
    { desc: 'DESCRIPCION SIN MAPEO XYZ 999', banco: '', tarjeta: '' }
  ];

  casos.forEach(c => {
    const hit = gf_dictLookup_(c.desc, c.banco, c.tarjeta);
    if (hit) {
      Logger.log('MATCH [' + hit.tipoMatch + '] "' + c.desc + '" → ' +
        'accion=' + (hit.accionDefault || 'incluir') +
        ', cat=' + hit.categoria +
        ', desc=' + hit.descLimpia);
    } else {
      Logger.log('NO MATCH: "' + c.desc + '"');
    }
  });

  Logger.log('=== FIN test_solo_lookup ===');
}

/**
 * Borra todas las filas de test de Tarjetas_Resumen, Tarjetas_Raw,
 * Tarjetas_Movimientos e Historico.
 * Identifica las filas por TEST_RESUMEN_ID en las columnas ResumenID / ParentID.
 * NO DESTRUCTIVO para datos reales.
 */
function test_limpiar_test_data() {
  Logger.log('=== LIMPIEZA de datos de test (' + TEST_RESUMEN_ID + ') ===');
  const ss = SpreadsheetApp.getActive();

  // Pares [nombreHoja, columnaID, valorBuscado]
  const targets = [
    { nombre: GF.SHEET_TARJETAS_RESUMEN, col: 'ResumenID',  valor: TEST_RESUMEN_ID },
    { nombre: GF.SHEET_TARJETAS_RAW,     col: 'ResumenID',  valor: TEST_RESUMEN_ID },
    { nombre: GF.SHEET_TARJETAS_MOV,     col: 'ResumenID',  valor: TEST_RESUMEN_ID },
    { nombre: GF.SHEET_HIST,             col: 'ParentID',   valor: TEST_RESUMEN_ID }
  ];

  targets.forEach(({ nombre, col, valor }) => {
    const sh = ss.getSheetByName(nombre);
    if (!sh || sh.getLastRow() < 2) {
      Logger.log(nombre + ': vacía, nada que borrar');
      return;
    }

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const colIdx = headers.map(h => String(h).trim()).indexOf(col);
    if (colIdx === -1) {
      Logger.log(nombre + ': columna ' + col + ' no encontrada');
      return;
    }

    const nRows = sh.getLastRow() - 1;
    const vals = sh.getRange(2, colIdx + 1, nRows, 1).getValues();

    // Recolectar filas a borrar (de abajo hacia arriba para no desplazar índices)
    const toDelete = [];
    for (let i = nRows - 1; i >= 0; i--) {
      if (String(vals[i][0]).trim() === valor) toDelete.push(i + 2);
    }

    toDelete.forEach(row => sh.deleteRow(row));
    Logger.log(nombre + ': ' + toDelete.length + ' filas eliminadas');
  });

  Logger.log('=== FIN LIMPIEZA ===');
}

// ── Test end-to-end con PDF real ──────────────────────────────────────────────

/**
 * Test end-to-end con el PDF real de GAL-VISA desde Drive.
 *
 * Pre-requisitos:
 *   1. Config B19 debe tener el ID de la carpeta de Drive con los PDFs.
 *   2. La carpeta debe contener un archivo cuyo nombre incluya "GAL-VISA" (ej: GAL-VISA_2026-03.pdf).
 *   3. La API Key de Anthropic debe estar guardada en Script Properties (gf_guardarAnthropicKey_).
 *
 * El resumenID generado se guarda en Script Properties bajo 'TEST_LAST_PDF_RESUMEN_ID'
 * para que test_limpiar_PDFReal_data() pueda encontrarlo.
 *
 * Pasos:
 *   1. Lee el PDF de Drive
 *   2. Llama api_importarPDF → parsea con Claude, escribe en Raw
 *   3. Loggea las filas Raw del resumen
 *   4. Confirma el resumen → escribe en Historico + Tarjetas_Movimientos
 *   5. Loggea las filas de Historico para validación manual
 */
function test_endToEnd_PDFReal_GaliciaVisa() {
  Logger.log('=== TEST: end-to-end PDF real GAL-VISA desde Drive ===');

  // ── PASO 1: leer el PDF de Drive ───────────────────────────────────────────
  const ss     = SpreadsheetApp.getActive();
  const shCfg  = ss.getSheetByName(GF.SHEET_CONFIG);
  if (!shCfg) throw new Error('Hoja Config no encontrada');

  const folderID = String(shCfg.getRange(GF.CFG_PDF_FOLDER_CELL).getValue() || '').trim();
  if (!folderID) throw new Error(
    'Config ' + GF.CFG_PDF_FOLDER_CELL + ' vacío. Ingresá el ID de la carpeta de Drive.'
  );

  Logger.log('PASO 1: buscando PDFs en carpeta ' + folderID);
  const folder  = DriveApp.getFolderById(folderID);
  const archivos = folder.getFilesByType(MimeType.PDF);

  var pdfFile = null;
  while (archivos.hasNext()) {
    var f = archivos.next();
    if (f.getName().toUpperCase().indexOf('GAL-VISA') !== -1) {
      pdfFile = f;
      break;
    }
  }
  if (!pdfFile) throw new Error('No se encontró ningún archivo con "GAL-VISA" en el nombre dentro de la carpeta.');
  Logger.log('PASO 1: archivo encontrado → ' + pdfFile.getName());

  const pdfBase64 = Utilities.base64Encode(pdfFile.getBlob().getBytes());
  Logger.log('PASO 1: base64 generado (' + pdfBase64.length + ' chars)');

  // ── PASO 2: importar (parsea + escribe Raw) ────────────────────────────────
  Logger.log('PASO 2: llamando api_importarPDF (esto demora ~30-90 seg)...');
  const importResult = api_importarPDF({ pdfBase64: pdfBase64, tarjetaCodigo: 'GAL-VISA' });
  Logger.log('PASO 2 resultado: ' + JSON.stringify(importResult));

  if (!importResult.ok) {
    Logger.log('ERROR en importación: ' + importResult.error);
    return importResult;
  }

  const resumenID = importResult.resumenID;
  Logger.log('PASO 2: resumenID = ' + resumenID);

  // Guardar resumenID para poder limpiarlo después
  PropertiesService.getScriptProperties().setProperty('TEST_LAST_PDF_RESUMEN_ID', resumenID);
  Logger.log('(resumenID guardado en Script Properties para cleanup)');

  // ── PASO 3: estado de Raw antes de confirmar ───────────────────────────────
  Logger.log('PASO 3: estado de Raw:');
  test_logRawState_(resumenID);

  // ── PASO 4: confirmar ──────────────────────────────────────────────────────
  Logger.log('PASO 4: confirmando resumen...');
  const confirmResult = confirmarResumen(resumenID);
  Logger.log('PASO 4 resultado: ' + JSON.stringify(confirmResult));

  // ── PASO 5: validación en Historico ───────────────────────────────────────
  Logger.log('PASO 5: filas en Historico:');
  test_logHistoricoState_(resumenID);

  Logger.log('=== FIN TEST end-to-end PDFReal ===');
  Logger.log('Para limpiar los datos de prueba: corré test_limpiar_PDFReal_data()');

  return { importResult: importResult, confirmResult: confirmResult };
}

/**
 * Elimina las filas generadas por test_endToEnd_PDFReal_GaliciaVisa() de las 4 hojas.
 * Lee el resumenID desde Script Properties ('TEST_LAST_PDF_RESUMEN_ID').
 * NO toca datos reales.
 */
/**
 * Re-confirma el último resumen importado SIN volver a parsear el PDF.
 * Útil para testear cambios en la lógica de confirmar/aprender sin gastar tokens.
 *
 * Pasos:
 *   1. Lee resumenID desde Script Properties (TEST_LAST_PDF_RESUMEN_ID)
 *   2. Borra las filas previas de Historico y Tarjetas_Movimientos para ese resumen
 *   3. Resetea EstadoMatch en Raw a 'auto' para que el confirm las procese
 *   4. Llama a api_confirmarResumen (incluye auto-aprendizaje)
 */
function test_reconfirmar_PDFReal() {
  var resumenID = PropertiesService.getScriptProperties()
    .getProperty('TEST_LAST_PDF_RESUMEN_ID');

  if (!resumenID) {
    Logger.log('No hay TEST_LAST_PDF_RESUMEN_ID guardado. Corré test_endToEnd_PDFReal_GaliciaVisa primero.');
    return;
  }

  Logger.log('=== test_reconfirmar_PDFReal: ' + resumenID + ' ===');
  var ss = SpreadsheetApp.getActive();

  // ── 1. Limpiar Historico y Tarjetas_Movimientos ───────────────────────────
  [
    { nombre: GF.SHEET_HIST,        col: 'ParentID'  },
    { nombre: GF.SHEET_TARJETAS_MOV, col: 'ResumenID' }
  ].forEach(function(t) {
    var sh = ss.getSheetByName(t.nombre);
    if (!sh || sh.getLastRow() < 2) return;
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var colIdx  = headers.map(function(h) { return String(h).trim(); }).indexOf(t.col);
    if (colIdx === -1) return;
    var nRows = sh.getLastRow() - 1;
    var vals  = sh.getRange(2, colIdx + 1, nRows, 1).getValues();
    var toDelete = [];
    for (var i = nRows - 1; i >= 0; i--) {
      if (String(vals[i][0]).trim() === resumenID) toDelete.push(i + 2);
    }
    toDelete.forEach(function(row) { sh.deleteRow(row); });
    Logger.log(t.nombre + ': ' + toDelete.length + ' filas borradas');
  });

  // ── 2. Resetear EstadoMatch en Raw a 'auto' ───────────────────────────────
  var shRaw = ss.getSheetByName(GF.SHEET_TARJETAS_RAW);
  if (shRaw && shRaw.getLastRow() >= 2) {
    var headers = shRaw.getRange(1, 1, 1, shRaw.getLastColumn()).getValues()[0];
    var iRaw = {};
    headers.forEach(function(h, i) { iRaw[String(h).trim()] = i; });

    var nRows = shRaw.getLastRow() - 1;
    var rows  = shRaw.getRange(2, 1, nRows, shRaw.getLastColumn()).getValues();
    var reseteadas = 0;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][iRaw['ResumenID']] || '').trim() !== resumenID) continue;
      shRaw.getRange(i + 2, iRaw['EstadoMatch'] + 1).setValue('auto');
      reseteadas++;
    }
    Logger.log('Raw: ' + reseteadas + ' filas reseteadas a EstadoMatch=auto');
  }

  // ── 3. Confirmar (ahora incluye auto-aprendizaje) ─────────────────────────
  Logger.log('Llamando api_confirmarResumen...');
  var result = api_confirmarResumen({ resumenID: resumenID });
  Logger.log('Resultado: ' + JSON.stringify(result));
  Logger.log('=== FIN test_reconfirmar_PDFReal ===');
  return result;
}

function test_limpiar_PDFReal_data() {
  const resumenID = PropertiesService.getScriptProperties()
    .getProperty('TEST_LAST_PDF_RESUMEN_ID');

  if (!resumenID) {
    Logger.log('No hay TEST_LAST_PDF_RESUMEN_ID guardado. Corré el test primero.');
    return;
  }

  Logger.log('=== LIMPIEZA de datos PDFReal (' + resumenID + ') ===');
  const ss = SpreadsheetApp.getActive();

  const targets = [
    { nombre: GF.SHEET_TARJETAS_RESUMEN, col: 'ResumenID', valor: resumenID },
    { nombre: GF.SHEET_TARJETAS_RAW,     col: 'ResumenID', valor: resumenID },
    { nombre: GF.SHEET_TARJETAS_MOV,     col: 'ResumenID', valor: resumenID },
    { nombre: GF.SHEET_HIST,             col: 'ParentID',  valor: resumenID }
  ];

  targets.forEach(function(t) {
    var sh = ss.getSheetByName(t.nombre);
    if (!sh || sh.getLastRow() < 2) { Logger.log(t.nombre + ': vacía'); return; }

    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var colIdx  = headers.map(function(h) { return String(h).trim(); }).indexOf(t.col);
    if (colIdx === -1) { Logger.log(t.nombre + ': columna ' + t.col + ' no encontrada'); return; }

    var nRows = sh.getLastRow() - 1;
    var vals  = sh.getRange(2, colIdx + 1, nRows, 1).getValues();
    var toDelete = [];
    for (var i = nRows - 1; i >= 0; i--) {
      if (String(vals[i][0]).trim() === t.valor) toDelete.push(i + 2);
    }
    toDelete.forEach(function(row) { sh.deleteRow(row); });
    Logger.log(t.nombre + ': ' + toDelete.length + ' filas eliminadas');
  });

  PropertiesService.getScriptProperties().deleteProperty('TEST_LAST_PDF_RESUMEN_ID');
  Logger.log('=== FIN LIMPIEZA ===');
}

// ── Helpers de logging para los tests ────────────────────────────────────────
function test_logRawState_(resumenID) {
  const sh = SpreadsheetApp.getActive().getSheetByName(GF.SHEET_TARJETAS_RAW);
  if (!sh || sh.getLastRow() < 2) { Logger.log('  Raw vacía'); return; }

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach((h, i) => { idx[String(h).trim()] = i; });

  const nRows = sh.getLastRow() - 1;
  const rows = sh.getRange(2, 1, nRows, sh.getLastColumn()).getValues();

  rows.forEach((row, i) => {
    if (String(row[idx['ResumenID']] || '').trim() !== resumenID) return;
    Logger.log('  Raw fila ' + (i + 2) + ': ' +
      '"' + (row[idx['DescripcionRaw']] || '') + '"' +
      ' estado=' + (row[idx['EstadoMatch']] || '') +
      ' accion=' + (row[idx['AccionUsuario']] || '(incluir)') +
      ' monto=' + (row[idx['Monto']] || 0));
  });
}

function test_logHistoricoState_(resumenID) {
  const sh = SpreadsheetApp.getActive().getSheetByName(GF.SHEET_HIST);
  if (!sh || sh.getLastRow() < 2) { Logger.log('  Historico vacío'); return; }

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach((h, i) => { idx[String(h).trim()] = i; });

  const nRows = sh.getLastRow() - 1;
  const rows = sh.getRange(2, 1, nRows, sh.getLastColumn()).getValues();

  rows.forEach((row, i) => {
    if (String(row[idx['ParentID']] || '').trim() !== resumenID) return;
    const tz = Session.getScriptTimeZone();
    const fecha = row[idx['Fecha']];
    const fechaStr = fecha instanceof Date
      ? Utilities.formatDate(fecha, tz, 'yyyy-MM-dd') : String(fecha || '');
    Logger.log('  Hist fila ' + (i + 2) + ': ' +
      '"' + (row[idx['Descripción']] || '') + '"' +
      ' tipo=' + (row[idx['Tipo']] || '') +
      '/' + (row[idx['Subtipo']] || '') +
      ' fecha=' + fechaStr +
      ' mes=' + (row[idx['Mes']] || '') +
      ' monto=' + (row[idx['Monto']] || 0) +
      ' excluirDash=' + (row[idx['ExcluirDash']] || false));
  });
}
