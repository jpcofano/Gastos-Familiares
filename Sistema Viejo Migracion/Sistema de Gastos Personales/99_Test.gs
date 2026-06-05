function gfm_test_abrir() {
  gfm_open_();
}

function gfm_test_diccionario() {
  gfm_ensureSheet_();
  gfm_ensureDictionarySheet_();
  gfm_syncDictionary_();
}

function gfm_test_opciones() {
  const res = gfm_getFormOptions_();
  Logger.log(JSON.stringify(res, null, 2));
}

function gfm_test_guardar() {
  const res = gfm_guardarGastoManual_({
    descripcion: 'Carrefour prueba',
    monto: 15000,
    moneda: 'ARS',
    categoria: 'Supermercado',
    etiquetas: 'super, prueba',
    notas: 'Prueba manual'
  });
  Logger.log(JSON.stringify(res, null, 2));
}

function gf_diagnostico_bancos() {
  const ss = SpreadsheetApp.getActive();
  const hojas = ['Historico','Carga','Gastos_Manuales','Obligaciones','Futuros_Eventuales'];
  
  hojas.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) {
      Logger.log(name + ': vacía o no existe');
      return;
    }
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const colBanco = headers.indexOf('Banco') + 1;
    if (colBanco === 0) {
      Logger.log(name + ': sin columna Banco');
      return;
    }
    const values = sh.getRange(2, colBanco, sh.getLastRow() - 1, 1).getValues();
    const conteo = {};
    values.forEach(row => {
      const v = String(row[0] || '(vacío)').trim() || '(vacío)';
      conteo[v] = (conteo[v] || 0) + 1;
    });
    Logger.log('--- ' + name + ' ---');
    Object.keys(conteo).sort().forEach(k => {
      const ok = (k === '(vacío)' || GF_BANCOS_VALIDOS.indexOf(k) !== -1) ? '✓' : '⚠';
      Logger.log('  ' + ok + ' "' + k + '": ' + conteo[k]);
    });
  });
}

function gf_diagnostico() {
  Logger.log('=== DIAGNÓSTICO GF ===');
  
  // 1) ¿Existe GF?
  try {
    Logger.log('GF.VERSION = ' + GF.VERSION);
    Logger.log('GF.SCHEMA_VERSION = ' + GF.SCHEMA_VERSION);
  } catch (e) {
    Logger.log('❌ GF no está definido: ' + e.message);
    return;
  }
  
  // 2) ¿Existe la hoja Usuarios?
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_USUARIOS);
  if (!sh) {
    Logger.log('❌ Hoja Usuarios no existe');
    return;
  }
  Logger.log('✓ Hoja Usuarios existe, filas: ' + sh.getLastRow());
  
  // 3) ¿Qué hay en Usuarios?
  if (sh.getLastRow() >= 2) {
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
    Logger.log('Contenido Usuarios:');
    data.forEach((row, i) => {
      Logger.log('  fila ' + (i + 2) + ': email=' + row[0] + ' | persona=' + row[1] + ' | rol=' + row[2] + ' | activo=' + row[3]);
    });
  }
  
  // 4) ¿Quién soy yo según Apps Script?
  const email = Session.getActiveUser().getEmail();
  Logger.log('Mi email según Session: "' + email + '"');
  
  if (!email) {
    Logger.log('⚠ Session.getActiveUser().getEmail() devolvió vacío.');
    Logger.log('  Esto pasa si el script no tiene permisos para ver tu email.');
    Logger.log('  Si es así, getCurrentUser() siempre va a devolver null.');
    return;
  }
  
  // 5) Probar getCurrentUser
  try {
    const u = getCurrentUser();
    if (u) {
      Logger.log('✓ getCurrentUser() devolvió: ' + JSON.stringify(u));
    } else {
      Logger.log('⚠ getCurrentUser() devolvió null. El email "' + email + '" no está en la hoja Usuarios o tiene Activo=false.');
    }
  } catch (e) {
    Logger.log('❌ getCurrentUser() tiró error: ' + e.message);
  }
  
  Logger.log('=== FIN DIAGNÓSTICO ===');
}

function test_parsearPDFReal() {
  // Pegá el base64 del PDF acá, o leelo desde Drive
  const folder = DriveApp.getFolderById(
    SpreadsheetApp.getActive()
      .getSheetByName('Config')
      .getRange('B19').getValue()
  );
  
  // Toma el primer PDF que encuentre
  const file = folder.getFilesByType(MimeType.PDF).next();
  const b64  = Utilities.base64Encode(file.getBlob().getBytes());
  
  Logger.log('Archivo: ' + file.getName());
  
  // Detectar código desde nombre
  const codigos = ['GAL-VISA','GAL-MASTER-BLK','BBVA-VISA-SIG','BBVA-MASTER-BLK'];
  const nombre  = file.getName().toUpperCase();
  const codigo  = codigos.find(c => nombre.includes(c));
  
  if (!codigo) { Logger.log('NOMBRE SIN CÓDIGO RECONOCIDO'); return; }
  
  const result = parsearPDF(b64, codigo);
  Logger.log('=== RESUMEN ===');
  Logger.log(JSON.stringify(result.resumen, null, 2));
  Logger.log('=== MOVIMIENTOS: ' + result.movimientos.length + ' ===');
  result.movimientos.forEach(function(m) {
    Logger.log(m.seq + ' | ' + m.tipoLinea + ' | ' + m.fechaConsumo + 
               ' | ' + m.descripcionRaw + ' | ' + m.moneda + ' ' + m.monto +
               ' | persona=' + m.personaDetectada);
  });
}

function gf_testShareFolderAccess() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('Config');
  const folderId = String(sh.getRange('B20').getValue() || '').trim();

  Logger.log({ folderId });

  const folder = DriveApp.getFolderById(folderId);
  Logger.log({
    name: folder.getName(),
    id: folder.getId()
  });

  const file = folder.createFile(
    Utilities.newBlob('test ok', 'text/plain', 'test-share.txt')
  );

  Logger.log({
    createdFileId: file.getId(),
    createdFileName: file.getName()
  });
}

function gf_testCreatePdfBlob() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('Config');
  const folderId = String(sh.getRange('B20').getValue() || '').trim();
  const folder = DriveApp.getFolderById(folderId);

  const base64 = 'JVBERi0xLjQK';
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, 'application/pdf', 'test.pdf');

  const file = folder.createFile(blob);

  Logger.log({
    fileId: file.getId(),
    name: file.getName(),
    size: file.getSize()
  });
}