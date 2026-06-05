/**************************************
 * 10_Menu_y_Public.gs
 * - Menú
 * - Wrappers públicos
 * - Utilidades admin/manuales
 **************************************/

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('💳 Gastos Familia');

  menu
    .addItem('🛠️ Setup', 'setupAll')
    .addSeparator()
    .addSubMenu(
      ui.createMenu('🔧 Migraciones')
        .addItem('🔍 [3.0] Preview dict unificado', 'gf_renombrarDiccionarioFase3_PREVIEW')
        .addItem('✅ [3.0] Aplicar dict unificado', 'gf_renombrarDiccionarioFase3_APLICAR')
        .addItem('🔍 [3.0] Preview seed desde Historico', 'gf_seedDictDesdeHistorico_PREVIEW')
        .addItem('✅ [3.0] Aplicar seed desde Historico', 'gf_seedDictDesdeHistorico_APLICAR')
        .addSeparator()
        .addItem('🔍 [3.a] Preview renombrar hojas', 'gf_renombrarHojasFase3_PREVIEW')
        .addItem('✅ [3.a] Aplicar renombrar hojas', 'gf_renombrarHojasFase3_APLICAR')
        .addSeparator()
        .addItem('🔍 [3.a] Preview prepopular Esperados', 'gf_prepopularEsperados_PREVIEW')
        .addItem('✅ [3.a] Aplicar prepopular Esperados', 'gf_prepopularEsperados_APLICAR')
        .addSeparator()
        .addItem('✅ Agregar col DescripcionNormalizada (alias)', 'runMigracionDescNorm')
        .addSeparator()
        .addItem('🔍 [Limpieza] Preview Diccionario_Aprendido', 'gf_dict_limpieza_PREVIEW')
        .addItem('✅ [Limpieza] Aplicar limpieza Diccionario', 'gf_dict_limpieza_APLICAR_menu_')
        .addSeparator()
        .addItem('🔍 [C7] Preview canonizar dict', 'gf_dict_canonico_PREVIEW')
        .addItem('✅ [C7] Aplicar canonizar dict', 'gf_dict_canonico_APLICAR_menu_')
        .addSeparator()
        .addItem('✅ [C10] Seed reglas normalización', 'gf_seedNormalizacion_APLICAR')
        .addSeparator()
        .addItem('🔍 [C11] Preview consolidar dict', 'gf_dict_proponerConsolidaciones')
        .addItem('✅ [C11] Aplicar consolidaciones', 'gf_dict_consolidar_APLICAR_menu_')
        .addSeparator()
        .addItem('🔍 [C13] Preview normalizar Patrons', 'gf_dict_migrar_aPatronesNormalizados_PREVIEW')
        .addItem('✅ [C13] Aplicar normalizar Patrons', 'gf_dict_migrar_aPatronesNormalizados_APLICAR')
        .addSeparator()
        .addItem('🔄 [C14] Recalcular cache mes actual', 'gf_dashCache_recalcularMesActual_menu_')
        .addItem('📦 [C14] Backfill cache todos los meses', 'dashCache_backfillTodo')
    )
    .addSeparator()
    .addItem('✅ Procesar tildados', 'gf_procesarTildados_')
    .addSeparator()
    .addItem('📄 Actualizar ResumenMes', 'gf_actualizarResumenMes_')
    .addItem('📊 Actualizar Dash', 'gf_actualizarDash_')
    .addItem('🔄 Actualizar Resumen + Dash', 'gf_actualizarSalidas_')
    .addSeparator()
    .addItem('💱 Actualizar TC ahora', 'gf_registrarTCMEP_enTablaDiaria_')
    .addItem('📅 Instalar triggers', 'gf_installTriggers_')
    .addSeparator()
    .addSubMenu(
      ui.createMenu('🃏 Tarjetas')
        .addItem('🌐 Abrir importador de tarjetas', 'gf_menu_abrirImportadorTarjetas_')
        .addItem('📁 Importar PDFs desde Drive', 'api_importarPDFsDesdeDrive')
        .addSeparator()
        .addItem('🔁 Aplicar diccionario a pendientes', 'dictApplyToPending')
        .addSeparator()
        .addItem('⚙️ Agregar filas API Key y Drive en Config', 'gf_ensureConfigTarjetas_')
        .addItem('🔑 Guardar API Key de forma segura', 'gf_guardarAnthropicKey_')
        .addItem('🗑️ Borrar API Key guardada', 'gf_borrarAnthropicKey_')
        .addItem('🌱 Seed etiquetas en Diccionario', 'gf_seedDiccionarioEtiquetas_')
        .addItem('🚫 Seed percepciones auto-excluir', 'gf_seedDiccionarioPercepcionesAutoExclude_')
    )
    .addSeparator()
    .addItem('🧾 Abrir cargador de comprobantes', 'gf_menu_abrirComprobantes_')
    .addItem('🌐 Abrir WebApp (link)', 'gf_menu_mostrarWebAppUrl_')
    .addItem('🧪 Test bootstrap WebApp', 'gf_menu_testBootstrapWebApp_')
    .addToUi();
}

function gf_menu_abrirComprobantes_() {
  const url = ScriptApp.getService().getUrl();
  if (!url) {
    SpreadsheetApp.getUi().alert('La WebApp no está publicada. Publicala desde Implementar > Implementaciones.');
    return;
  }
  SpreadsheetApp.getUi().alert('Abrí esta URL en el navegador:\n\n' + url + '?view=comprobantes');
}

function gf_menu_abrirImportadorTarjetas_() {
  const url = ScriptApp.getService().getUrl();
  if (!url) {
    SpreadsheetApp.getUi().alert('La WebApp no está publicada. Publicala desde Implementar > Implementaciones.');
    return;
  }
  const fullUrl = url + '?view=tarjetas';
  SpreadsheetApp.getUi().alert('Abrí esta URL en el navegador:\n\n' + fullUrl);
}

function gf_actualizarSalidas_() {
  gf_actualizarResumenMes_();
  gf_actualizarDash_();
  SpreadsheetApp.getUi().alert('ResumenMes y Dash actualizados.');
}

function gf_menu_mostrarWebAppUrl_() {
  const url = ScriptApp.getService().getUrl() || '';
  const msg = url
    ? `URL actual de la WebApp:\n\n${url}`
    : 'Este proyecto todavía no tiene URL de WebApp activa. Publicala desde Implementar.';
  SpreadsheetApp.getUi().alert(msg);
}

function gf_menu_testBootstrapWebApp_() {
  const res = gf_public_getBootstrap_();
  SpreadsheetApp.getUi().alert(
    'Bootstrap OK\n' +
    `Mes actual: ${res.mesActual || '(vacío)'}\n` +
    `Usuario: ${res.usuario || '(sin usuario)'}\n` +
    `Categorías: ${(res.diccionario && res.diccionario.categorias || []).length}`
  );
}

/**************************************
 * WRAPPERS PÚBLICOS PARA HTML/WEBAPP
 * Mantener finitos y delgados
 **************************************/

function gf_public_getBootstrap_() {
  return gf_web_getBootstrap_();
}

function gf_public_guardarManual_(payload) {
  return gf_web_guardarManual_(payload);
}

function gf_public_guardarEventualDirecto_(payload) {
  return gf_web_guardarEventualDirecto_(payload);
}

function gf_public_guardarEventualFuturo_(payload) {
  return gf_web_guardarEventualFuturo_(payload);
}

function gf_public_getCargaMesActual_() {
  return gf_web_getCargaMesActual_();
}

function gf_public_getResumenData_() {
  return gf_web_getResumenData_();
}

function gf_public_getDashData_() {
  return gf_web_getDashData_();
}

function gf_public_getDiccionario_(tipo) {
  return {
    ok: true,
    tipo: tipo || '',
    valores: gf_getDiccionarioValores_(tipo || '')
  };
}

function gf_public_ping_() {
  return {
    ok: true,
    now: new Date(),
    version: GF.VERSION,
    user: gf_getPersonaWebApp_()
  };
}

/**************************************
 * WRAPPERS PÚBLICOS — IMPORTADOR TARJETAS
 **************************************/

function gf_public_importarPDF_(params) {
  return api_importarPDF(params);
}

function gf_public_getPendientes_(params) {
  return api_getPendientes(params);
}

function gf_public_confirmarResumen_(params) {
  return api_confirmarResumen(params);
}

function gf_public_getTarjetasCatalogo_() {
  return {
    ok: true,
    catalogo: GF_TARJETAS_CATALOGO.map(function(t) {
      return { codigo: t[0], banco: t[1], tarjeta: t[2], cuenta: t[3] };
    })
  };
}

/**************************************
 * WRAPPERS SIN GUIÓN BAJO — requeridos por google.script.run
 * (las funciones terminadas en _ no son accesibles desde el cliente)
 **************************************/

function getTarjetasCatalogo(params)  { return gf_public_getTarjetasCatalogo_(); }
function importarPDF(params)          { return gf_public_importarPDF_(params); }
function getPendientes(params)        { return gf_public_getPendientes_(params); }
function confirmarResumenWeb(params)  { return gf_public_confirmarResumen_(params); }

// Comprobantes
function parsearComprobante(params)   { return api_parsearComprobante(params); }
function guardarComprobante(params)   { return api_guardarComprobante(params); }

// Resumen
function getResumenData()             { return gf_web_getResumenEstructurado_(); }
function getPendientesData()          { return requireUser_(), gf_web_getPendientesMes_(); }

// Dashboard
function getDashMensualData(mes)      { return requireUser_(), gf_web_getDashMensualData_(mes); }
function getDashAnualData(year)       { return requireUser_(), gf_web_getDashAnualData_(year); }

// Manual
function api_guardarManual(payload)  { return gf_web_guardarManual_(payload); }

// Diccionario_Aprendido
function api_dictLookup(desc)                                   { requireUser_(); return gf_dictLookup_(desc); }
function api_dictAprender(desc, cat, subcat, etiq, origen, descNormalizada, persona) { requireUser_(); return gf_dictAprender_(desc, cat, subcat, etiq, origen, descNormalizada, persona); }
function api_gastosEsperadosLookup(cat, subcat, personaHint)   { requireUser_(); return gf_gastosEsperados_lookup_(cat, subcat, personaHint || ''); }

// Share temporal (PWA)
function api_getSharePayload(shareToken, expectedRoute) { return gf_share_getPayloadByToken_(shareToken, expectedRoute); }

// Dashboard cache
function dashCache_backfillTodo() { return gf_dashCache_backfillTodo_(); }


/**************************************
 * COMPATIBILIDAD CON NOMBRES VIEJOS
 **************************************/

function gf_guardarManual_(payload) {
  return gf_public_guardarManual_(payload);
}

function gf_guardarEventualDirecto_(payload) {
  return gf_public_guardarEventualDirecto_(payload);
}

function gf_guardarEventualFuturo_(payload) {
  return gf_public_guardarEventualFuturo_(payload);
}