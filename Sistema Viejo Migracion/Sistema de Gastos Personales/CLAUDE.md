Sistema de Gastos Personales - Contexto del Proyecto
Qué es esto
Sistema de gestión de gastos personales construido sobre Google Sheets + Apps Script.
Backend en .gs, frontend HTML servido por la WebApp, entry point via PWA Firebase (spendly-30947.web.app).
Dos usuarios reales (Juan y María) y dos dependientes sin login (Federico y Sofía).
Sincronización con Apps Script vía clasp. El código se edita localmente, se versiona
con git, y se sube con clasp push. El deployment tiene URL estable (ver sección
"Deployment y acceso").
Versión actual

SCHEMA_VERSION: 2026.04.24.dup-hash
Fase 2.1 aplicada (hojas nuevas, migración de bancos legacy)
Fase 2.1.bis aplicada (detalle de gastos en efectivo en ResumenMes)
Fase 2.2 ✅ COMPLETA: importador tarjetas, cargador comprobantes, Resumen.html, Google Sites (deprecado).
Fase 3 ✅ código completo: 3.0/a/b/c/d/f/h. 3.e CANCELADA (Sites deprecado).
Fase 4: 4.a ✅ 4.b ✅ código listo, pendiente validación. 4.c CANCELADA (Sites deprecado).
Fase 4.5 ✅ COMPLETA: flujo share Drive-based, soporte PDF + imágenes, validado end-to-end.

Deployment y acceso
Apps Script WebApp (deployment estable)

DEPLOYMENT_ID: AKfycbwnrCLNRA2eyAen9xMMGgv_ltqJXoif2Y33EXHoV1lvPN9qt_5ZDeOgzz_tsADG4QJh
URL base: https://script.google.com/macros/s/AKfycbwnrCLNRA2eyAen9xMMGgv_ltqJXoif2Y33EXHoV1lvPN9qt_5ZDeOgzz_tsADG4QJh/exec

CONFIGURACIÓN CRÍTICA DEL DEPLOYMENT:
  Ejecutar como: "Usuario que accede a la aplicación web" (NO "Yo/propietario")
  Acceso: "Cualquier persona con cuenta de Google"
  MOTIVO: con "Ejecutar como: Yo", Session.getActiveUser().getEmail() siempre
  devuelve vacío → requireUser_() siempre falla → ningún endpoint autenticado funciona.
  CONSECUENCIA: cada usuario (Juan, María) necesita acceso de LECTOR al Spreadsheet
  para que el código pueda leer las hojas cuando corre con su identidad.

Para actualizar código contra el mismo deployment (URL estable):
IMPORTANTE: Claude Code NO hace el deploy. Solo hace clasp push y pasa la descripción.
El usuario ejecuta manualmente desde la UI de Apps Script: Implementar → Administrar
implementaciones → lápiz → Nueva versión → Guardar.
O bien: clasp deploy --deploymentId AKfycbwnrCLNRA2eyAen9xMMGgv_ltqJXoif2Y33EXHoV1lvPN9qt_5ZDeOgzz_tsADG4QJh --description "..."
REGLA CRÍTICA: la URL solo cambia si creás un deployment nuevo. Comportamiento:

clasp push → URL NO cambia ✅
"Nueva versión" sobre deployment existente → URL NO cambia ✅
"Nueva implementación" (botón azul en UI) → URL CAMBIA ⚠️ NUNCA USAR
Borrar deployment → URL muere ⚠️

Workflow correcto desde el editor:

Implementar → Administrar implementaciones
Click en el lápiz del deployment activo
Versión → "Nueva versión"
Guardar

Google Sites — DEPRECADO

URL (dejar online, no mantener): https://sites.google.com/view/gasta-en-lo-que-queres/inicio
Entry point real: PWA Firebase → https://spendly-30947.web.app/
El bookmark en los celulares de Juan y María apunta a la PWA de Firebase.

PWA Firebase — botones (public/index.html):
📊 Dashboard            → {APPS_SCRIPT_BASE}?view=dashboard     (target _blank)
📋 Resumen del mes      → {APPS_SCRIPT_BASE}?view=resumen       (target _blank)
💰 Cargar movimiento    → {APPS_SCRIPT_BASE}?view=manual        (target _blank)
🧾 Cargar comprobante   → {APPS_SCRIPT_BASE}?view=comprobantes  (target _blank)
💳 Importar tarjeta     → {APPS_SCRIPT_BASE}?view=tarjetas      (target _blank)
🤖 Chat IA              → # placeholder, deshabilitado visualmente (Fase 5)

Para agregar un view nuevo: crear el HTML en Apps Script + agregar botón en Firebase index.html + firebase deploy.
Views implementadas en la WebApp
Router en 11_WebApp.gs → doGet(e) lee ?view= (o ?v=), busca candidatos
por orden alfabético, sirve el primero que exista como archivo.
URLArchivo HTML servidoEstado?view=tarjetasTarjetas.html✅ funciona?view=comprobantesComprobantes.html✅ funciona?view=resumenResumen.html✅ funciona?view=manualManual.html✅ funciona (Fase 3.d)sin parámetros / cualquier otrofallback HTML (página de estado)funciona
El fallback NO es un error. Cuando se agregue un view nuevo, solo hace falta
crear el HTML con el nombre correspondiente y queda accesible.
Roadmap del proyecto
El proyecto se desarrolla en fases. Cada fase se cierra completamente antes de
pasar a la siguiente. Las fases futuras pueden cambiar de orden o de scope
cuando lleguemos a ellas; este roadmap es la hoja de ruta acordada al día de
hoy, no un compromiso rígido.
Fase 1 — Backend base ✅ COMPLETA
Migrar V3 a la versión actual con hojas nuevas, bancos canónicos, helpers de
usuario, y migración no destructiva de datos legacy.
Fase 2.1 — Hojas y bancos ✅ COMPLETA
Hojas nuevas creadas, migración legacy de bancos aplicada, ResumenMes funciona
con bancos canónicos.
Fase 2.1.bis — Detalle de efectivo en ResumenMes ✅ COMPLETA
Bloque "Gastos en efectivo - detalle" debajo del pivot de ResumenMes.
Fase 2.2 — Importador de tarjetas con diccionario auto-aprendido (EN CURSO)
Subfases:

2.2.a ✅ Diccionario + Importer + seeds
2.2.b ✅ Parser PDF con Claude API (47_Tarjetas_PDF.gs, GF_CLAUDE_MAX_TOKENS=32000)
2.2.c ✅ API endpoints (49_Tarjetas_API.gs): importarPDF, getPendientes,
aprenderMapeos, confirmarResumen (con auto-aprendizaje incluido)
2.2.d ✅ Frontend Tarjetas.html (?view=tarjetas): subir PDF → revisar → confirmar
2.2.e ⚠️ Validación parcial: GAL-VISA OK (78 mov). Pendiente BBVA-VISA-SIG,
BBVA-MASTER-BLK, GAL-MASTER-BLK.
2.2.f ⚠️ Cargador de comprobantes/facturas generado (48b_Comprobantes.gs +
Comprobantes.html). Pendiente validación con 5 PDFs reales.
2.2.g ✅ Google Sites publicado (deprecado — reemplazado por PWA Firebase como entry point).
2.2.h ✅ Resumen.html para ?view=resumen. KPIs ARS+USD eq, sección "Síntesis del día"
(desde Historico filtrado por fecha=hoy), tabla diaria con columna USD eq, detalle
efectivo. Backend: gf_web_getResumenEstructurado_() + gf_web_getPagosHoy_() en
11_WebApp.gs. Wrapper: getResumenData() en 10_Menu_y_Public.gs.

Fase 3 — Refactor del flujo de carga manual y reconversión de Obligaciones
Objetivo: depreciar la lógica vieja donde Obligaciones generaba filas en Carga
al inicio del mes (parcialmente rota), reconvertir Obligaciones a una lista de
"gastos esperados" que se valida contra Historico, armar el HTML de carga
manual que faltaba, y unificar el diccionario de aprendizaje.
Decisiones cerradas para Fase 3 (ver sección "Decisiones cerradas" para detalle):

Obligaciones → GastosEsperados (lista de validación, no genera nada).
IngresosPlantilla → IngresosEsperados (mismo rol).
Match en checklist: Categoría + Subcategoría dentro del mes en curso.
Las subcategorías son específicas (ej: "Colegio Sofi", "Colegio Fede"), no hay
falsos positivos. Persona NO entra al match (Juan y María no se distinguen).
MontoEsperado opcional. Cuando hay, se compara contra el real cargado.
Form unificado Gasto/Ingreso con toggle (no dos HTMLs separados).
Pagado en gasto manual: fechaMovimiento <= hoy → true,
fechaMovimiento > hoy → false. Editable manualmente.
Tarjetas_Diccionario → Diccionario_Aprendido (una hoja, tres orígenes).
Diccionario GFM (legacy V2) se deprecia y borra en 3.0.

Subfase 3.0 — Unificación del diccionario de aprendizaje ⬅ PRIMERA

Renombrar hoja Tarjetas_Diccionario → Diccionario_Aprendido.
Agregar columna Origen, default 'Tarjeta' para todas las filas existentes.
Actualizar GF.SHEET_TARJETAS_DICT → GF.SHEET_DICT_APRENDIDO = 'Diccionario_Aprendido'
  en 00_Config.gs. Dejar alias deprecated para no romper callers legacy.
Actualizar GF_HOJAS_REQUERIDAS_ en 20_Setup_y_Helpers.gs.
Borrar hoja Diccionario GFM (verificar que está vacía o solo tiene defaults;
  confirmar con el usuario antes de borrar).
Crear 46_Diccionario_Aprendido.gs con:
  gf_dictLookup_(desc) → exact primero, luego contains; null si no hay match.
  gf_dictAprender_(desc, cat, subcat, etiqueta, origen) → upsert + UsoCount++.
Adaptar 45_Tarjetas_Diccionario.gs y 49_Tarjetas_API.gs:
  Usar GF.SHEET_DICT_APRENDIDO.
  Al aprender, pasar Origen='Tarjeta' a gf_dictAprender_.
Funciones de migración (patrón gf_migrarBancosLegacy_*):
  gf_renombrarDiccionarioFase3_PREVIEW
  gf_renombrarDiccionarioFase3_APLICAR

Subfase 3.a — Renombrar hojas + reconvertir a "esperados"

En 00_Config.gs renombrar constantes:

GF.SHEET_OBLIG = 'Obligaciones' → GF.SHEET_GASTOS_ESPERADOS = 'GastosEsperados'
GF.SHEET_ING_PLANT = 'IngresosPlantilla' → GF.SHEET_INGRESOS_ESPERADOS = 'IngresosEsperados'


Armar par de funciones de migración no destructiva siguiendo el patrón de
gf_migrarBancosLegacy_*:

gf_renombrarHojasFase3_PREVIEW: muestra qué hojas se van a renombrar y qué
columnas se van a ajustar. No toca nada.
gf_renombrarHojasFase3_APLICAR: renombra las hojas físicas y ajusta el
schema de columnas a: Activo | Categoria | Subcategoria | Etiqueta | Moneda | Banco | MontoEsperado | DiaVencimiento | Notas. Sin Persona (el match es por pool familiar). NO BORRA datos existentes.


Buscar todas las referencias a GF.SHEET_OBLIG y GF.SHEET_ING_PLANT en el
código y actualizarlas a las constantes nuevas.
Marcar como @deprecated (o eliminar si nadie las llama) las funciones rotas:

gf_menu_generarMes_
gf_generarCargaDesdePlantillas_
gf_moveRowsToHistorico_
Helpers fantasma: gf_setupLigero_, gf_ensureSheetSchema_,
gf_findColumnByHeader_, gf_generateId_, gf_setupValidationsLivianas_,
gf_applyBasicSheetFormat_, gf_findColByHeader_.


Quitar entradas de menú (en 10_Menu_y_Public.gs) que llamaban a esas funciones.
Actualizar la lista de hojas en este CLAUDE.md (sección "Hojas del proyecto").

Subfase 3.b — Backend de pendientes del mes

En 11_WebApp.gs: gf_web_getPendientesMes_().

Lee GastosEsperados filtrado por Activa = true.
Lee IngresosEsperados filtrado por Activa = true.
Lee Historico filtrado por mes en curso (mes calendario de hoy, usando
Historico.Fecha que respeta Lectura B).
Para cada fila esperada, busca matches en Historico por
Categoria + Subcategoria (case-insensitive, trim).
Devuelve estructura:



js    {
      ok: true,
      mes: 'Abril 2026',
      gastos: [
        {
          categoria: 'Educación',
          subcategoria: 'Colegio Sofi',
          montoEsperado: 587356,  // null si no hay
          movimientos: [
            { fecha: '2026-04-08', monto: 587356, persona: 'María' }
          ],
          estado: 'cargado'  // 'cargado' | 'falta'
        },
        ...
      ],
      ingresos: [ ... mismo formato ... ]
    }

Wrapper sin guion bajo en 10_Menu_y_Public.gs: api_getPendientesMes().
Aplicar requireUser_() en el endpoint.

Subfase 3.c — Bloque "Pendientes del mes" en Resumen.html

Sección nueva entre los KPIs y el bloque "Pagos de hoy".
Llamar api_getPendientesMes después de getResumenData en el init.
Render: dos sub-bloques colapsables, "Gastos esperados" e "Ingresos esperados".
Cada fila:

Ícono ✅ si estado === 'cargado', ⚠️ si estado === 'falta'.
Texto: Categoria / Subcategoria.
Monto esperado (si existe).
Monto real (suma de movimientos[].monto) cuando hay matches.


Mantener consistencia visual con el resto de Resumen.html (mismas vars CSS,
mismas clases .card, etc.).

Subfase 3.d — HTML ?view=manual con form unificado

Crear Manual.html en la raíz del proyecto Apps Script.
Estructura paso 1 / paso 3 (no hay paso 2 porque no hay parsing intermedio).
Toggle al inicio: Gasto / Ingreso (default Gasto, o leer ?tipo= para
preset).
Campos del form:

Persona: auto desde getCurrentUser().persona (NO Session.getActiveUser().getEmail()).
Editable solo para Federico/Sofía.
Fecha: default hoy, editable.
Banco: dropdown de los 4 canónicos (BBVA, Galicia, Personal Pay, Efectivo).
Obligatorio (cierra la deuda de los 18 sueldos sin banco).
Categoría: input con datalist (valores de Diccionario canónico, Tipo='Categoria').
Subcategoría: input con datalist (valores de Diccionario canónico, Tipo='Subcategoria').
Al cambiar el campo Detalle (debounce 300ms): llamar gf_dictLookup_ con la
descripción; si hay match, pre-rellenar Categoría/Subcategoría/Etiqueta con
indicador visual "✨ pre-clasificado por uso anterior".
Al guardar: llamar gf_dictAprender_ con Origen='Manual'.
Etiqueta: dropdown de las 8 predefinidas (opcional para ingresos).
Detalle: texto libre.
Monto: numérico.
Pagado: checkbox auto-calculado:

Al cambiar Fecha: fecha <= hoy → checked, fecha > hoy → unchecked.
Editable manualmente después.


Notas: texto libre opcional.


Endpoint backend gf_web_guardarManual_(payload) con requireUser_().
Reemplaza al endpoint actual de 95_GastosManuales_WebApp.gs que no tiene
el chequeo (cierra esa deuda técnica).
Wrapper sin guion bajo: api_guardarManual en 10_Menu_y_Public.gs.
Inserta directo en Historico con:

Origen = 'WebApp'
Subtipo = 'Manual' si Gasto, 'Ingreso' si Ingreso (o convención
equivalente que ya use el resto del sistema).


Paso 3: mensaje de OK + botón "Cargar otro" (mismo patrón que Comprobantes.html).

Subfase 3.e — CANCELADA (Sites deprecado, entry point migrado a PWA Firebase)

Subfase 3.f — Refactor de CSS y JS compartido

Crear parciales _styles.html y _scripts.html en la raíz del proyecto.
Extraer al _styles.html:

Variables CSS :root (--bg, --card, --ok-bg, --err-bg, etc.)
Clases .card, .msg y variantes, .btn y variantes, .step/.sn/.sl.


Extraer al _scripts.html:

Helpers JS comunes: showMsg, hideMsg, fmtMonto, esc, setStep,
poblarDatalist.


Incluir en los 4 HTMLs (Tarjetas, Comprobantes, Resumen, Manual) usando
<?!= include('_styles'); ?> y <?!= include('_scripts'); ?>.
La función include() ya existe en 11_WebApp.gs sin uso.
Verificar visualmente que los 4 HTMLs siguen renderizando igual.

Subfase 3.h — Lookup + aprender en flujo de Comprobantes

Comprobantes.html ya parsea con Claude API y extrae descripción.
Antes de mostrar el form en paso 2: llamar api_dictLookup con la descripción
  extraída por Claude. Si hay match, pre-rellenar Categoría/Subcategoría/Etiqueta
  con indicador "✨ pre-clasificado por uso anterior".
Al guardar (paso 3): llamar api_dictAprender con Origen='Comprobante'.
Wrappers sin guion bajo en 10_Menu_y_Public.gs: api_dictLookup, api_dictAprender.

Subfase 3.g — Cleanup transversal de deudas técnicas
No es una subfase aparte: las deudas listadas abajo se cierran dentro de las
subfases 3.0-3.f cuando se toca el código relevante. Documentar en cada commit
qué deudas se cerraron. Lista de deudas heredadas:

gf_procesarTildados_silent_ tenía dos definiciones; la mala fue eliminada
en Fase 2.2. ✅ Cerrado.
Funciones rotas gf_menu_generarMes_, gf_generarCargaDesdePlantillas_,
gf_moveRowsToHistorico_ y helpers fantasma → cierran en 3.a.
GF_THEME.muted, .soft, .totalBg, .negFg no definidos → cierran en
Fase 4 (Dashboards).
95_GastosManuales_WebApp.gs sin requireUser_() → cierra en 3.d.
gf_getPersonaWebApp_ devuelve email crudo en lugar de persona canonizada →
cierra en 3.d (Manual.html usa getCurrentUser().persona).
Checkbox OK/Pagado debe crearse en la fila nueva, no preformateado → revisar
en 3.d para Historico via Manual.html, y en flujos de comprobantes/tarjetas
si aplica.
Validación de Banco obligatorio para ingresos → cierra en 3.d (campo
obligatorio en el form).
Tarjetas_Diccionario aprende con tipoMatch='exact' siempre → ✅ Cerrado en 3.0
  (gf_dictAprender_ soporta exact y contains).
api_confirmarResumen llama api_aprenderMapeos fila por fila → mejora de
performance diferida, no es de Fase 3.
Diccionario GFM (legacy V2) → ✅ Cerrado en 3.0 (borrado con PREVIEW/APLICAR).
Refactor del CSS compartido entre HTMLs → cierra en 3.f.

Fase 4 — Dashboard web moderno (?view=dashboard)
Decisiones cerradas para Fase 4:
  Desktop-first. Lectura de Historico directo (no Vista_Reportes, decisión pragmática).
  Charts vanilla SVG/Canvas — zero CDN, zero librerías externas.
  Toggle moneda dominante: ARS / USD eq (sin nuevo llamado al servidor al cambiar).
  Comparación KPIs vs promedio últimos 12 meses (siempre, no configurable).
  Orden visual fijo: header+filtros → KPIs → gráficos → tablas (colapsables) → acciones.
  Acciones rápidas: links a ?view=manual, ?view=resumen, ?view=tarjetas.
  Tab Anual es el default (tab izquierdo).
  Selector de año en Anual y selector de mes en Mensual (desde lista de meses disponibles
    devuelta por el backend). Cambio de período = nuevo llamado al servidor.

Subfase 4.a ✅ Dashboard base
  Dashboard.html con tabs Mensual/Anual.
  Backend: gf_web_getDashMensualData_() y gf_web_getDashAnualData_(year) en 11_WebApp.gs.
  Wrappers: getDashMensualData() y getDashAnualData(year) en 10_Menu_y_Public.gs.
  KPIs, tablas por categoría/subcategoría/descripción.

Subfase 4.b ✅ Redesign visual + gráficos SVG (código listo, pendiente validación)
  Backend: gf_web_getDashMensualData_(mesYYYYMM) acepta mes opcional (default Config).
    Nuevos campos: byBanco, indicadores (cantMov/topCat/topBanco/topMovDesc/topMovMonto),
    promedioMes12GasArsEq.
  Backend: gf_web_getDashAnualData_(year) ampliado:
    byMes unifica gas+ing por mes (gasArsEq + ingArsEq en cada row).
    promedioMes12GasArsEq = promedio mensual gastos últimos 12 meses (línea referencia).
    availableMonths = lista de meses distintos en Historico (para selector mensual).
  Frontend Dashboard.html rediseñado:
    Header sticky: tabs + selector período + toggle ARS/USD eq.
    Acciones rápidas (qnav) siempre visibles arriba.
    KPIs: valor principal + secundario + delta % vs promedio 12 meses + señal visual.
    Gráficos SVG:
      Anual: barras gastos/mes + línea referencia promedio;
             donut categorías + leyenda;
             barras agrupadas ingresos vs gastos por mes con neto textual.
      Mensual: donut categorías; Top 5 subcategorías; 4 cards indicadores
               (cantMov, topCat, topBanco, topMov).
    Tablas colapsables debajo de gráficos.
  Bugs corregidos en esta sesión:
    fetchAnual referenciaba #zoneActions (no existe) → TypeError antes del
      google.script.run → pantalla colgada en "Cargando datos…". Eliminada la línea.
    initQnav usaba window.location.href que en el sandbox de Apps Script devuelve
      googleusercontent.com en lugar de script.google.com. Fix: webAppBaseUrl se
      pasa server-side via ScriptApp.getService().getUrl() en gf_web_renderView_
      (tpl.webAppBaseUrl). Todos los HTMLs llaman initQnav('<?= webAppBaseUrl ?>').

Subfase 4.c — CANCELADA (Sites deprecado, Dashboard ya activo en PWA Firebase index.html)

Fase 4.5 — PWA Firebase (Firebase Hosting)
La PWA es el entry point único del sistema (reemplaza Google Sites) y además receptora de shares.
URL: https://spendly-30947.web.app/
Estado: código en refactor, pendiente validación end-to-end.
Repo separado: C:\Users\20243359679\OneDrive\Documentos\AppsScript\firebase-gastos\
Firebase project: spendly-30947 (ver .firebaserc)
Deploy: firebase deploy (Firebase Hosting, sin Firestore por ahora)

Flujo actual (Drive-based, NO localStorage):
  1. Celular: usuario abre menú "Compartir" sobre un PDF o imagen.
  2. Elige "Spendly" (la PWA instalada).
  3. SW intercepta POST /share, convierte archivo a base64 en memoria,
     redirect 303 a /receive.html.
  4. receive.js recupera el archivo del SW vía MessageChannel.
  5. receive.js hace un form POST oculto a Apps Script doPost
     (action=share-upload-form) con base64, mimeType, route, etc.
  6. 11_WebApp.gs → gf_web_handleShareUploadFormPost_ →
     gf_share_handleUploadRequest_ (12_ShareTemp.gs):
       guarda archivo en Drive (carpeta Config B20),
       genera shareToken único,
       registra en hoja _ShareTokensTmp.
  7. Apps Script devuelve HTML con redirect a:
     ?view=comprobantes&shareToken=XXX&shareSource=firebase-pwa
  8. Comprobantes.html detecta shareToken (via SHARE_CTX.hasShareToken),
     llama api_getSharePayload(shareToken, 'comprobantes').
  9. Backend (gf_share_getPayloadByToken_ vía wrapper) lee archivo de Drive,
     devuelve base64 + mimeType al frontend.
  10. Pipeline normal de parseo con Claude API (idéntico al flujo manual).

  NOTA: el canal de transferencia es Drive + token, NO localStorage.
  localStorage era el flujo anterior (deprecado). Se elimina en 4.5.a.

Archivos Firebase (public/):
  index.html    → landing pública con links al dashboard y comprobantes + botón instalar PWA.
  app.html      → start_url de la PWA.
  manifest.webmanifest → share_target: POST /share, campo "receipt".
                         Acepta hoy: application/pdf.
                         4.5.b: agregar image/jpeg, image/png, image/webp.
  sw.js         → Service Worker:
                  install: precachea el app shell.
                  fetch POST /share: extrae File del formData, convierte a base64,
                    guarda en pendingSharedFile (variable en memoria del SW),
                    redirect 303 a /receive.html.
                  message GF_GET_SHARED_FILE: devuelve pendingSharedFile por
                    MessageChannel y lo limpia.
                  Valida hoy: rechaza todo lo que no sea application/pdf (~línea 91).
                  4.5.b: aceptar también image/jpeg, image/png, image/webp.
  receive.html  → pantalla de transición ("Recibiendo comprobante…").
  receive.js    → lógica cliente:
                  getSharedFileFromSW(): recupera archivo del SW via MessageChannel.
                  validateSharedFile(): valida tipo (hoy solo PDF).
                    4.5.b: aceptar también imágenes.
                  detectarRuta(fileName): "resumen/tarjeta/visa/master/amex"
                    en el nombre → route='tarjetas', resto → route='comprobantes'.
                    4.5.b: imágenes SIEMPRE van a 'comprobantes'.
                  postToAppsScriptViaForm(payload): form POST oculto a doPost.
                  CÓDIGO MUERTO (pendiente borrar en 4.5.a):
                    uploadSharedFileToAppsScript() — usaba fetch() que falla por CORS,
                    reemplazada por postToAppsScriptViaForm.
                    buildTargetUrl() — solo la usaba uploadSharedFileToAppsScript.

Archivos Apps Script (lado receptor):
  12_ShareTemp.gs: módulo completo de manejo de tokens temporales.
    gf_share_handleUploadRequest_(request): guarda archivo en Drive, genera token,
      registra en _ShareTokensTmp. Hoy rechaza non-PDF (líneas 23-25).
      4.5.b: aceptar application/pdf + image/jpeg + image/png + image/webp.
    gf_share_getPayloadByToken_(shareToken, expectedRoute): lee Drive, devuelve base64.
    gf_share_cleanupExpired_(): marca vencidos, mueve archivos a papelera.
      YA CONECTADA: llamada dentro de gf_automation_tick_ (80_Triggers.gs línea 23)
      y también tiene trigger dedicado cada 6h en gf_installTriggers_.
  11_WebApp.gs:
    doPost: enruta action=share-upload y action=share-upload-form.
    gf_web_handleShareUploadFormPost_: recibe form POST del SW, llama al handler,
      devuelve HTML de redirect. BUG activo: usa window.top.location.replace
      (~línea 1202) → cambiar a window.location.replace (4.5.a item 4).
      También valida mimeType !== 'application/pdf' (4.5.b: ampliar whitelist).
    gf_web_renderView_: pasa tpl.shareContext con hasShareToken, shareToken, shareSource.
  10_Menu_y_Public.gs (PENDIENTE — 4.5.a item 1):
    Falta wrapper api_getSharePayload(shareToken, expectedRoute) que llame a
    gf_share_getPayloadByToken_. Sin este wrapper, Comprobantes.html y
    Tarjetas.html fallan en runtime (regla: google.script.run no puede llamar
    funciones con _ final).
  Comprobantes.html:
    BUG CRÍTICO (4.5.a item 1): iniciarModoShareToken_ llama
      .gf_share_getPayloadByToken_ directamente (~línea 487). Cambiar a
      .api_getSharePayload una vez que el wrapper exista.
    PATH VIEJO (4.5.a item 2): init() tiene rama shareMode=localStorage que llama
      initShareLocalStorage_(). Deprecar y borrar.
    4.5.b: parsearComprobante debe propagar mimeType al backend para que Claude API
      reciba content block correcto (document para PDF, image para imágenes).
  Tarjetas.html:
    BUG CRÍTICO (4.5.a item 1): initShareTarjetasToken_ llama
      .gf_share_getPayloadByToken_ directamente (~línea 677). Mismo fix.
    PATH VIEJO (4.5.a item 2): rama localStorage viva. Deprecar y borrar.
    4.5.b: NO acepta imágenes. Los resúmenes de tarjeta siempre son PDF.

Hoja _ShareTokensTmp (schema de columnas):
  token | route | fileId | fileName | mimeType | sizeBytes |
  createdAt | expiresAt | status | openedAt | source | error
  La hoja se crea automáticamente vía gf_ensureShareTempSheet_()
  en 20_Setup_y_Helpers.gs. No hay que crearla a mano.

Configuración en hoja Config:
  B20 → ID de carpeta Drive para archivos temporales
  B21 → TTL en horas (tiempo de vida de un token antes de expirar)
  B22 → Tamaño máximo en MB

Sub-fases:

Subfase 4.5.a — Fix bugs del flujo share (PENDIENTE)
  1. Crear wrapper api_getSharePayload(shareToken, expectedRoute) en
     10_Menu_y_Public.gs (sección WRAPPERS SIN GUIÓN BAJO). Actualizar
     Comprobantes.html (~línea 487) y Tarjetas.html (~línea 677) para
     llamarlo en lugar de .gf_share_getPayloadByToken_.
  2. Borrar initShareLocalStorage_() y la rama localStorage del init() en
     Comprobantes.html y Tarjetas.html. Dejar solo el path shareToken.
  3. Borrar uploadSharedFileToAppsScript() y buildTargetUrl() de receive.js.
     Simplificar sistema de logs: dejar solo console.log, borrar renderLogs,
     clearLogs, getLogs, saveLogs y el bloque HTML de debug.
  4. Cambiar window.top.location.replace a window.location.replace en el HTML
     de redirect de gf_web_handleShareUploadFormPost_ (11_WebApp.gs ~línea 1202).
     Agregar link clickeable visible como fallback ("Si no redirige, tocá acá").
  5. ✅ YA RESUELTO: gf_share_cleanupExpired_ ya está conectada a gf_automation_tick_
     (80_Triggers.gs línea 23) y tiene trigger dedicado cada 6h en gf_installTriggers_.

Subfase 4.5.b — Soporte para imágenes ✅ COMPLETA (sesión 5)
  MIME types agregados: image/jpeg, image/png, image/webp (además de application/pdf).
  Firebase: manifest.webmanifest, sw.js y receive.js actualizados.
  Apps Script: 12_ShareTemp.gs, 11_WebApp.gs y 48b_Comprobantes.gs actualizados.
  Comprobantes.html: acepta PDF + imágenes, propaga mimeType al backend.
  Tarjetas.html: sin cambios (solo PDF).
  Validado end-to-end con comprobantes Mercado Pago compartidos como imagen desde Android.

Decisiones de diseño vigentes:
  Sin Firestore por ahora: el canal es Drive + token (no localStorage).
  Sin credenciales Firebase en el cliente: la PWA solo hace POST al propio SW.
  El campo en manifest es "receipt" para compatibilidad con Android Chrome Share Target.
  Detección de ruta por nombre del archivo (resumen/tarjeta/visa/master/amex → tarjetas,
    resto → comprobantes). Simple y suficiente para los dos casos reales.
  Flujos manuales intactos: sin shareToken en URL → arranque normal sin cambios.

Pendiente operacional:
  Publicar en dominio propio (hoy: dominio de Firebase Hosting del proyecto).
  Agregar icono definitivo (hoy icon-192 e icon-512 son placeholders).

Fase 5 — Chat IA sobre los datos
97_API_Chat.gs + pantalla de chat en el HTML. Claude API recibe contexto
filtrado de Vista_Reportes y responde preguntas como "cuánto gasté en
delivery este mes" o "comparame restaurantes vs supermercado año a año".
Fase 6 — Insights proactivos (opcional)
Trigger semanal que genera un resumen IA de la semana y lo manda por mail.
Solo si las fases 1-5 funcionan bien y hay apetito de seguir.
Reabrir cuando el sistema esté muy estable en producción (Fase 2 y 3 cerradas,
al menos un mes de uso real sin problemas).
Cosas explícitamente fuera de scope (al menos por ahora)

Tracking de transferencias entre cuentas (cajero a efectivo, etc.)
Tracking de stock/saldo de cuentas bancarias
Soporte para más bancos / fintechs además de los 4 canónicos
Multi-etiqueta por movimiento (decisión: una sola etiqueta por ahora)
Subcategorización automática basada en aprendizaje no supervisado

Decisiones cerradas (NO cuestionar sin checkear con el usuario)
Modelo de datos

"Lectura B bifurcada": un resumen de tarjeta genera DOS tipos de fila en Historico:
  - TarjetaConsumo: Fecha = FechaConsumo (del PDF). Pagado = true.
    FlagResumenMes = false, ExcluirDash = false → aparece en Dashboard, no en ResumenMes.
    Subtipo reemplaza a TarjetaDetalleImportado (migración C.4).
    Reintegros (Tipo=Ingreso, Subtipo=TarjetaReintegro): mismo esquema de fecha.
  - TarjetaPago: Fecha = FechaVencimiento. Pagado = false.
    FlagResumenMes = true, ExcluirDash = true → aparece en ResumenMes, no en Dashboard.
    Auto-generado al confirmar: 1 fila ARS (TotalARS menos PERCEP.AFIP RG 4815 si positivo)
    + 1 fila USD solo si TotalUSD ≠ 0. Categoría='Tarjetas', Subcategoría='[Tarjeta] [Banco]'.
FechaConsumoOriginal sigue guardándose para auditoría en ambos tipos.
"Lectura Z": cada movimiento usa Categoría libre + Subcategoría libre +
Etiqueta opcional + columna Tarjeta separada. La subcategoría NO se usa para
indicar la tarjeta; eso va en la columna Tarjeta dedicada.
Una fila por movimiento en Historico (no agrupado por resumen).
Los pagos genéricos de tarjeta en Obligaciones se DESACTIVARON. A partir de
Fase 2.2, el detalle del importador reemplaza al pago genérico.
Obligaciones ya no genera filas en Carga. Se reconvierte a GastosEsperados
en Fase 3: pasa a ser una lista de validación contra Historico, no un generador.
Mismo concepto para IngresosPlantilla → IngresosEsperados.

Bancos canónicos (los únicos válidos en Historico.Banco)

BBVA (era 'BBVA/Frances' en versiones viejas, ya migrado)
Galicia
Personal Pay
Efectivo (era 'Efectivo/Transf', ya migrado)

Cualquier otro valor en Banco rompe el pivot de ResumenMes. Hay una función
gf_normalizarBanco_() en 20_Setup_y_Helpers.gs que valida.
Hojas del proyecto
Todas referenciadas vía constantes GF.SHEET_* en 00_Config.gs. No crear ni
renombrar hojas fuera de esta lista sin actualizar CLAUDE.md.
Configuración e infraestructura:
GF.SHEET_CONFIG          → 'Config'
GF.SHEET_LOG             → 'Log'
GF.SHEET_USUARIOS        → 'Usuarios'
GF.SHEET_DICT            → 'Diccionario'
GF.SHEET_TC              → 'TC_Diario'
Hojas operacionales (fuente de verdad de movimientos):
GF.SHEET_CARGA           → 'Carga'
GF.SHEET_HIST            → 'Historico'
GF.SHEET_FUT_EVENT       → 'Futuros_Eventuales'
GF.SHEET_GASTOS_MANUAL   → 'Gastos_Manuales'
Vistas y dashboards (lectura de Historico):
GF.SHEET_RESUMEN         → 'ResumenMes'
GF.SHEET_DASH            → 'Dash_Mensual'  (alias legacy para 60_Dash.gs y 11_WebApp.gs)
GF.SHEET_DASH_MENSUAL    → 'Dash_Mensual'
GF.SHEET_DASH_ANUAL      → 'Dash_Anual'
GF.SHEET_VISTA_REPORTES  → 'Vista_Reportes'
Plantillas de validación (renombre planificado en Fase 3.a):
GF.SHEET_OBLIG           → 'Obligaciones' (será GF.SHEET_GASTOS_ESPERADOS → 'GastosEsperados')
GF.SHEET_ING_PLANT       → 'IngresosPlantilla' (será GF.SHEET_INGRESOS_ESPERADOS → 'IngresosEsperados')
Importador de tarjetas (Fase 2.2):
GF.SHEET_TARJETAS_RESUMEN → 'Tarjetas_Resumen'
GF.SHEET_TARJETAS_RAW     → 'Tarjetas_Raw'
GF.SHEET_TARJETAS_MOV     → 'Tarjetas_Movimientos'
GF.SHEET_TARJETAS_DICT    → 'Tarjetas_Diccionario'  // @deprecated Fase 3.0 → usar SHEET_DICT_APRENDIDO
GF.SHEET_DICT_APRENDIDO   → 'Diccionario_Aprendido'  // Fase 3.0: unifica Tarjeta + Manual + Comprobante
GF.SHEET_DICT_NORM        → 'Diccionario_Normalizacion' // C10/C13: reglas de normalización on-read y on-write
GF.SHEET_DASH_CACHE       → 'Dash_Cache'               // C14: cache precalculado del Dashboard, una fila por mes con KPIs+agregados en JSON
Catálogo de tarjetas
4 tarjetas físicas: BBVA Visa Signature, BBVA Mastercard Black, Galicia Visa,
Galicia Mastercard Black. Definidas en GF_TARJETAS_CATALOGO en 00_Config.gs.
Personas
5 personas: Juan, María, Federico (dependiente), Sofía (dependiente). María
tiene 2 emails de login (personal y trabajo) que mapean a la misma persona.
Aliases en GF_PERSONA_ALIASES en 00_Config.gs.
Para checklist de pendientes (Fase 3.b): el match Esperados ↔ Historico NO
considera persona. Juan y María se tratan como un pool único (los pagos del
hogar son indistintos).
Etiquetas (set inicial cerrado)
8 etiquetas predefinidas, una sola etiqueta por movimiento (no multi-tag):
rutina-trabajo, rutina-casa, salida, viaje, salud, regalos, auto, hijos.
Se cargan en la hoja Diccionario con Tipo='Etiqueta'.
Importador de tarjetas (Fase 2.2)

Parser PDF con Claude API (no regex por banco).
GF_CLAUDE_MAX_TOKENS = 32000 (aumentado de 16000 para PDFs con 100+ movimientos).
tarjetaCodigo es opcional en parsearPDF y en api_importarPDF. Si no se provee,
  el backend auto-detecta usando gf_detectarTarjetaCodigo_(banco, tarjeta) que
  matchea lo que extrajo Claude contra GF_TARJETAS_CATALOGO (fuzzy bidireccional).
  El response de api_importarPDF siempre incluye tarjetaCodigo (detectado o manual).
  Si la detección falla, error descriptivo con sugerencia de elegir manualmente.
En Tarjetas.html: selector de tarjeta es opcional (default "Detectar automáticamente").
  El botón se habilita apenas hay PDF. El header del paso 2 muestra "(auto-detectado)"
  cuando no se eligió manualmente.
Detección de duplicados por hash (implementado 2026-04-24):
  gf_calcularHashPDF_(pdfBase64) → SHA-256 hex del contenido base64 (47_Tarjetas_PDF.gs:497).
  gf_checkResumenDuplicado_(hashPDF) → busca en Tarjetas_Resumen por columna HashPDF;
    retorna { duplicado: false } | { duplicado: true, resumenIDDup, resumen: {...} } (línea 519).
  api_importarPDF calcula hash ANTES de llamar a Claude; si duplicado → retorna
    { ok: true, status: 'duplicado', resumen: {...} } sin consumir tokens.
  Si force: true → saltea el check y registra en Observaciones
    "Importación forzada — posible duplicado de [ResumenID]".
  Frontend Tarjetas.html: panel #panelDuplicado con grilla de datos del dup existente
    y dos botones: Cancelar (vuelve al paso 1) / Importar de todas formas (reenvía con force:true).
  La columna HashPDF debe existir en Tarjetas_Resumen (se agrega en el setup).

DEV PER RG 4815 en prompt (regla bifurcada, 2026-04):
  CONSOLIDADO con monto negativo → excluir (igual que SU PAGO).
  DETALLE DEL CONSUMO con monto positivo → tipoLinea="reintegro_percepcion".
El dict prevalece sobre las sugerencias de Claude en imports futuros.
Claude sugiere categoriaSugerida y subcategoriaSugerida por movimiento en el
mismo llamado del parser (sin costo adicional). Se pre-rellena en Raw y en la
tabla de revisión. El dict las sobreescribe si hay match.
4 acciones por raw en la pantalla de revisión:

Incluir normal (default)
Incluir pero no Dash (ExcluirDash=true en Historico)
Excluir totalmente (no va a Historico)
Ignorar (auto, para pagos del mes anterior)


Las percepciones (DB.RG 5617, IVA RG 4240, IIBB PERCEP-CABA) se incluyen
por defecto igual que cualquier movimiento. El usuario las excluye manualmente
en la tabla de revisión o configurando AccionDefault en el dict. (Decisión
2026-04: el auto-exclude era demasiado agresivo para uso real.)
Inventario de Subtipos para movimientos de tarjeta:
  TarjetaConsumo: consumo individual. Fecha=FechaConsumo, Pagado=true,
    FlagResumenMes=false, ExcluirDash=false. Reemplaza a TarjetaDetalleImportado.
  TarjetaReintegro: devolución/percepción revertida (Tipo=Ingreso). Mismo esquema de fecha.
  TarjetaPago: pago total auto-generado al confirmar. Fecha=FechaVencimiento, Pagado=false,
    FlagResumenMes=true, ExcluirDash=true.
  TarjetaDetalleImportado: legacy — migrado a TarjetaConsumo por gf_migrarImputacionTarjetas_APLICAR.
TarjetaConsumo y TarjetaReintegro nacen con Pagado=true.
TarjetaPago nace con Pagado=false; el usuario lo marca al ver el débito en el banco.
Los movimientos en estado 'pending' se confirman igual que 'auto' y 'manual'.

Diccionario de aprendizaje unificado — Diccionario_Aprendido (Fase 3.0 + sesión 7)

Una sola hoja, tres orígenes: Tarjeta / Manual / Comprobante.
Schema: MapeoID | Patron | Categoria | Subcategoria | Etiqueta | Confianza |
  TipoMatch | AccionDefault | UsoCount | UltimoUso | Origen | Notas |
  PersonaDefault | DescripcionNormalizada | PatronOriginal
TipoMatch soportado: exact y contains. Regex fuera de scope.
Match: exact primero; si no hay, contains.

gf_dictLookup_(desc) — sesión 7 (C10):
  Normaliza AMBOS lados (desc entrante + patron del dict) usando reglas de
  Diccionario_Normalizacion antes de comparar. Fallback a raw si no hay match normalizado.
  Carga reglas una sola vez por ejecución (_GF_DICT_NORM_RULES_ cache en módulo).
  Retorna: { mapeoID, categoria, subcategoria, etiqueta, origen, confianza,
             accionDefault, tipoMatch, descripcionNormalizada, personaDefault } | null

gf_dictAprender_(desc, cat, subcat, etiqueta, origen, descNorm, persona) — sesión 7 (C9):
  Clave de 4 campos: (Patron, Etiqueta, PersonaDefault, Origen).
  Si la clave existe → solo incrementa UsoCount/UltimoUso (NUNCA sobreescribe clasificación).
  Si no existe → INSERT nueva fila.
  Guard (C12): si categoria no está en gf_getCategoriasCanonicas_() → Logger.log warn (no bloquea).

Normalización on-read — Diccionario_Normalizacion (C10):
  Hoja con schema: Activo | Tipo | Patron | Reemplazo | Notas
  Tipos de regla: 'prefix' | 'suffix' | 'replace' | 'regex'
  Funciones en 46_Diccionario_Aprendido.gs:
    gf_dict_cargarReglas_()      → carga y cachea reglas por ejecución
    gf_dict_aplicarReglas_(s, r) → aplica array de reglas a un string (pure)
    gf_dict_normalizar_(desc)    → convenience: aplicarReglas + cargarReglas
  Seed inicial (7 reglas activas):
    prefix MERPAGO* → vacío
    prefix DLO*     → vacío
    regex  \s*\d{8,}$ → vacío   (códigos de transacción largos)
    regex  cuotas formato C.XX/YY → vacío
    regex  fechas DD/MM/YYYY → vacío
    regex  período mes-año español ("- Mes YYYY") → vacío
    regex  cuota ABL ("- Cuota MM/YYYY") → vacío
  Pendiente: regla para "Período DD/MM al DD/MM/YYYY" (caso MAP_3fca2e7b
  deja "al" colgando).

Normalización on-write — C13 (sesión 8, 2026-05-08):
  gf_dictAprender_ ahora pasa el Patron por gf_dict_normalizar_ ANTES del INSERT.
  El dict ya no acumula ruido (fechas, cuotas, números de transacción, prefijos).
  Columna nueva PatronOriginal: guarda el Patron crudo pre-normalización para
    trazabilidad. Se llena en cada INSERT y en la migración one-shot.
  Migración aplicada 2026-05-08: 113 filas normalizadas + 4 conflictos skipeados
    (mismo Patron normalizado pero Cat/Subcat distintas, requieren decisión manual).
  Funciones: gf_dict_normalizarPatrons_PREVIEW + gf_dict_normalizarPatrons_APLICAR.
  Menú: Migraciones → [C13] Preview/Aplicar normalizar Patrons.

Consolidación de duplicados — C11:
  gf_dict_proponerConsolidaciones() → PREVIEW: muestra grupos con mismo patron normalizado
  gf_dict_consolidar_APLICAR_menu_() → desactiva duplicados (guarda mayor UsoCount)
  Grupos con categorías distintas se saltean (requieren revisión manual).
  Menú: Migraciones → [C11] Preview/Aplicar consolidaciones.

Categorías canónicas — C12:
  gf_getCategoriasCanonicas_() en 46_Diccionario_Aprendido.gs:
    lee gf_getDiccionarioValores_('Categoria'), fallback a las 13 hardcodeadas.
  GF_CATS_CANONICAS_LIMPIEZA_ eliminada de 46b_Diccionario_Limpieza.gs.
  gf_dictLearn_, api_aprenderMapeos y wrapper aprenderMapeos eliminados (dead code:
    Tarjetas.html nunca los llamó; aprendizaje real siempre fue por api_confirmarResumen).

Prompts de Claude — C9.5:
  Lista de categorías en gf_buildParserPrompt_ (47_Tarjetas_PDF.gs) y
  gf_buildComprobantePrompt_ (48b_Comprobantes.gs) ahora dinámica:
  gf_getDiccionarioValores_('Categoria'). Fallback a las 13 si la hoja está vacía.

Los tres flujos consultan Y escriben al dict al confirmar/guardar:
  - Tarjetas: al confirmar resumen (Origen='Tarjeta')
  - Manual: al guardar el form (Origen='Manual')
  - Comprobantes: al guardar el form (Origen='Comprobante')
El Diccionario canónico (Tipo/Categoria/Subcategoria/Valor/Activo) sigue siendo
  la fuente de validez para etiquetas y catálogo cat/subcat.
  Diccionario_Aprendido es solo asociaciones descripción → clasificación.

Shape de retorno de api_dictLookup (IMPORTANTE — inconsistente con otros endpoints):
  Devuelve directamente el objeto match o null. NO devuelve {ok, match}.
  Match: { mapeoID, categoria, subcategoria, etiqueta, origen, confianza,
           accionDefault, tipoMatch, descripcionNormalizada, personaDefault }
  Sin match: null
  El frontend debe hacer: if (!res) return; — NO if (!res.ok).
  Los demás endpoints sí devuelven {ok, error, ...}. La inconsistencia es conocida
  y documentada. No corregir el backend sin revisar todos los callers
  (Comprobantes.html, Tarjetas.html, Manual.html).

Columna DescripcionNormalizada — alias de display (implementado 2026-04-24):
  Rol: permite que la descripción visible en Historico difiera de la que detectó el parser.
  Ejemplo: parser detecta "Javier González" → alias guardado "Verdulería Javier".
  Patron (clave de match, nunca cambia) = descripción original del parser.
  DescripcionNormalizada = alias de display que se muestra y se guarda en Historico.
  Flujo:
    1. rellenarFormulario() guarda descripcionOriginalDelParser = data.descripcion.
    2. dict lookup devuelve descripcionNormalizada; el frontend pisa fDescripcion.
    3. Al guardar, Historico recibe la descripción visible (normalizada).
    4. api_dictAprender recibe: 1º arg = original (clave), 6º arg = visible (alias).
    5. La próxima vez que llegue la original, se reemplaza automáticamente.
  Migración: correr runMigracionDescNorm() una vez desde el editor antes del primer uso.
    Función: gf_dict_migrarDescripcionNormalizada_() en 46_Diccionario_Aprendido.gs.
    También accesible desde menú: 🔧 Migraciones → Agregar col DescripcionNormalizada.
    Idempotente: seguro correrse múltiples veces.
  Decisión de diseño: matching sigue siendo TipoMatch='exact' por defecto.
    Si se necesita 'contains', editar el sheet manualmente (no hay UI para eso).
  Tarjetas.html: aprendizaje server-side en api_confirmarResumen (49_Tarjetas_API.gs:465).
    No pasa descNormalizada por ahora — diferido a segunda iteración (requiere cambios
    en la tabla de revisión del paso 2 y en params.cambios).
  Archivos tocados: 46_Diccionario_Aprendido.gs, 10_Menu_y_Public.gs,
    Comprobantes.html, Manual.html.

Limpieza 2026-04-24: GastosManuales.html eliminado (huérfano post-rename a Manual.html
  del 18-abr). El routing ?view=manual apunta a ['Manual', 'manual', ...], nunca a GastosManuales.

Cargador de comprobantes y facturas (Fase 2.2.f)

Flujo separado del importador de tarjetas: 1 gasto por PDF, sin Raw ni Resumen.
Claude detecta el tipo de documento (comprobante_pago, factura, expensas, abl, otro)
y extrae: descripción, fecha, monto, moneda, persona, categoría sugerida, pagado.
Regla de fecha:

comprobante_pago → Historico.Fecha = fecha de pago; Pagado = true
factura / expensas / abl → Historico.Fecha = fecha de vencimiento; Pagado = false


Banco siempre lo elige el usuario (Claude no puede inferirlo).
Para expensas: Claude extrae la fila "Cofano, Juan Pablo" de la tabla de
prorrateo y usa la columna "Total a Pagar" de esa fila (no el total del consorcio).
Guarda directo en Historico con Subtipo=EventualDirecto, Origen=WebApp.
Tipo=Ingreso se deriva por categoría: gf_esIngreso_(cat) en 20_Setup_y_Helpers.gs
  compara cat contra GF.CATS_INGRESO = ['Sueldo', 'Ingresos']. Un solo argumento —
  la etiqueta NO entra al check (decisión 2026-05-06; el plan original decía (cat, etiq)
  pero se descartó porque solo la categoría es suficiente).
  gf_esCategoriaIngreso_(cat) queda como alias @deprecated que delega en gf_esIngreso_.
  Alcance estricto: solo lo llama 48b_Comprobantes.gs. El flujo Tarjetas determina
  Tipo por TipoLinea del parser (TarjetaReintegro → Ingreso), independiente de
  CATS_INGRESO. Históricos NO migrados con esta regla.
Archivos: 48b_Comprobantes.gs + Comprobantes.html (?view=comprobantes).

Carga manual de gastos e ingresos (Fase 3.d)

Form unificado con toggle Gasto/Ingreso (no dos HTMLs separados).
Persona auto desde getCurrentUser().persona (canonizada, no email crudo).
Banco obligatorio (4 canónicos).
Pagado se calcula automáticamente por fecha:

fecha <= hoy → Pagado = true
fecha > hoy → Pagado = false
Editable manualmente después.


Va a Historico con Origen=WebApp.

Checklist de pendientes del mes (Fase 3.b/3.c)

Match entre GastosEsperados / IngresosEsperados y Historico por
Categoría + Subcategoría dentro del mes en curso. NO incluye persona.
Las subcategorías son específicas por concepto (ej: "Colegio Sofi", "Colegio
Fede") para evitar falsos positivos.
MontoEsperado es opcional (los gastos variables como luz/gas no tienen monto fijo).
Si hay múltiples movimientos con misma cat+subcat en el mes, se listan todos
como "cargado" sin marca de error.
Render dentro de Resumen.html, no en view aparte.
Hint de monto esperado en formularios (Comprobantes.html + Manual.html):
  tryGastosHint_() + <div id="hintGastos"> debajo del campo fMonto. Muestra
  "💡 Monto esperado: $X" si gf_gastosEsperados_lookup_(cat, subcat) retorna match.
  gf_gastosEsperados_lookup_(cat, subcat) en 11_WebApp.gs: busca la primera fila
  activa en GastosEsperados luego IngresosEsperados que matchee Categoria+Subcategoria
  y tenga MontoEsperado > 0. Devuelve { montoEsperado, moneda } o null.
  Wrapper: api_gastosEsperadosLookup(cat, subcat) en 10_Menu_y_Public.gs.
  NO pre-rellena fMonto — solo hint visual. Se dispara en success handler de
  dictLookup (con o sin match). Se limpia en reset()/volverPaso1().

Arquitectura del Frontend
Routing
Entry point: doGet(e) en 11_WebApp.gs. Lee ?view= (o ?v=), busca
candidatos en orden, usa el primero que exista como archivo en el proyecto.
Ver tabla completa en "Deployment y acceso".
Autenticación
No hay autenticación en el doGet. El HTML se sirve a cualquiera que tenga la
URL. La validación ocurre únicamente en los endpoints posteriores vía
google.script.run, donde requireUser_() verifica que el email del caller
esté en la hoja Usuarios con estado Activo.
Implicación: si alguien tiene la URL puede ver el HTML, pero no puede hacer
nada útil sin pasar requireUser_() en cada llamada al backend.

REGLA DE DEPLOYMENT (crítica para auth):
El deployment DEBE estar en "Ejecutar como: Usuario que accede a la aplicación web".
Con "Ejecutar como: Yo", Session.getActiveUser().getEmail() siempre retorna vacío
y requireUser_() siempre falla. Síntoma: "Error: Usuario no autorizado" en TODOS
los endpoints, de forma consistente o intermitente según el contexto.

Retry en google.script.run para errores de auth:
La primera llamada google.script.run después de abrir la página puede fallar
intermitentemente con "no autorizado" en mobile o en tabs recién abiertas
porque la sesión de Google todavía no terminó de inicializarse.
Patrón aplicado en Dashboard (fetchMensual/fetchAnual) y Comprobantes (llamarParsear_):
reintentar hasta 2 veces con 1500ms de pausa cuando err.message contiene "no autorizado".
Aplicar el mismo patrón a cualquier nuevo endpoint que sea la primera llamada al cargar.
Assets compartidos
Resuelto en Fase 3.f. Los 5 HTMLs (Tarjetas, Comprobantes, Resumen, Manual,
Dashboard) incluyen _styles.html y _scripts.html vía <?!= include('_styles'); ?>
y <?!= include('_scripts'); ?>.

_styles.html: variables CSS :root, clases .card, .msg, .btn, .step/.sn/.sl, .qnav/.qnav-btn.
_scripts.html: showMsg, hideMsg, poblarDatalist, poblarSelect, esc, fmtMonto, setStep, initQnav(base).
  poblarSelect(id, arr, placeholder): popula un <select> con <option> por cada valor del array.

Convenciones mobile-first (Comprobantes.html como referencia)

Patrón visual: hero oscuro (monto/estado arriba) + drawer blanco (form abajo) +
  CTA bar fija al pie con padding-bottom: max(env(safe-area-inset-bottom, 0px), 12px).

Altura de pantalla: usar min-height: 100dvh con fallback min-height: 100vh.
  100dvh respeta la barra dinámica del browser mobile; 100vh es el fallback legacy.

Detección touch (desktop vs mobile): usar JS, NO media queries CSS.
  Razón: el WebView de Samsung dentro de script.google.com (Chrome Custom Tabs) reporta
  valores incorrectos en (hover:none), (pointer:coarse) y media queries de ancho.
  Patrón correcto — ejecutar ANTES del render para evitar flash de layout:
    var isTouch = ('ontouchstart' in window) ||
                  (navigator.maxTouchPoints > 0) ||
                  (navigator.msMaxTouchPoints > 0);
    if (!isTouch) document.body.classList.add('is-desktop');
  Con 'is-desktop': centrar app a 480px. Sin ella: ancho 100%.

Campos de clasificación:
  Categoría → siempre <select> cerrado poblado desde el catálogo canónico.
    Motivo: no contaminar el diccionario maestro con valores libres.
  Subcategoría → <input list="dlSub"> poblado desde STATE.subcategoriasPorCategoria[cat]
    (filtrado) o STATE.subcategorias (completo si no hay categoría). Resetear dlSub
    en volverPaso1() para que no quede filtrado del uso anterior.
  Etiqueta → <input list="dlEtiq"> poblado desde diccionario. NO <select> hardcodeado.

Scriptlets — regla crítica:
  <?!=  (sin escape): para inyectar JSON, HTML parciales o cualquier valor que contenga
        comillas o caracteres especiales. Usar para: JSON.stringify(shareContext),
        JSON.stringify(bootstrap), webAppBaseUrl, include('_styles'), include('_scripts').
  <?=   (con escape HTML): SOLO para strings simples de texto plano sin comillas.
  NUNCA usar <?= para objetos JSON → el escape convierte " en &quot; y rompe el parse.

Patrón webAppBaseUrl (IMPORTANTE — no usar window.location.href para links):
  (ver también: Apps Script gotchas → Quirks del WebView de Samsung)
  El sandbox de Apps Script sirve el HTML desde googleusercontent.com, por lo que
  window.location.href dentro del iframe devuelve una URL de esa CDN, no la URL
  de script.google.com. Si se usa para construir links de navegación, los links
  van a fallar.
  Fix correcto: gf_web_renderView_ asigna tpl.webAppBaseUrl = ScriptApp.getService().getUrl()
  y cada HTML llama initQnav('<?= webAppBaseUrl ?>') al final del script.
  initQnav(base) acepta base opcional; si está vacío cae a window.location.href
  (útil en dev/preview donde ScriptApp.getService() puede no tener deployment).
Comunicación cliente-servidor
Patrón: google.script.run directo, sin Promise wrapper. Consistente en
ambos HTMLs. Dos tipos de error manejados:

withFailureHandler: excepción no capturada en servidor (red, timeout)
if (!res.ok): error de negocio devuelto como { ok: false, error: '...' }

No hay retry, no hay timeout manual, no hay Promise wrapper.
google.script.run NO puede llamar funciones cuyo nombre termina en _.
Todo endpoint que el frontend consuma debe tener un wrapper sin guión bajo en
10_Menu_y_Public.gs (sección "WRAPPERS SIN GUIÓN BAJO").
Estado del cliente
Objeto STATE global centralizado en cada HTML.
Tarjetas.html — state rico con filas editables: resumenID, filas (array
editable), catalogo, personas hardcodeadas (Juan, María, Federico, Sofía),
categorias, subcategorias, etiquetas. Los cambios del usuario se escriben
directo sobre STATE.filas[i] via updateFila(i, campo, valor). Al confirmar,
se serializa STATE.filas y se manda al servidor.
Comprobantes.html — state: { categorias:[], subcategorias:[], etiquetas:[], subcategoriasPorCategoria:{} }.
Los datos del comprobante parseado quedan en los campos del formulario DOM directamente.
Manual.html — state: { tipo, persona, categorias:[], subcategorias:[], etiquetas:[], subcategoriasPorCategoria:{} }.
Dependencias externas
Ninguna. Zero CDN, zero librerías.

CSS vanilla con custom properties
JS vanilla ES5 (var, function, sin arrow functions en varios lugares,
sin async/await)
google.script.run nativo de Apps Script
FileReader API nativa del browser

Estructura de cada HTML
Tarjetas.html (960px max-width):

Header + indicador de pasos (sn1, sn2, sn3)
Paso 1: selector tarjeta + file input + botón
Paso 2 (oculto): sub-header, barra de stats, tabla editable, botones
Paso 3 (oculto): mensaje final + botón "Importar otro"
2 datalists para autocompletar

Comprobantes.html — mobile-first redesign (2026-04-24):
  Layout: screen fullscreen (100dvh) → hero oscuro arriba + drawer blanco debajo
          + CTA bar fija al pie. Clase 'is-desktop' aplicada vía JS centra a 480px en desktop.
  Paso 1 (.screen#paso1): hero estático + drop-zone dentro del drawer + btn "Leer con IA".
  Loading (#pasoLoading): orb violeta animado + 5 pasos progresivos (renderLoadSteps_()).
  Paso 2 (.screen#paso2): hero con monto/fecha/banco en tiempo real + drawer con field-rows.
  Paso 3 (#paso3): pantalla done con receipt-card (monto, meta, tags, descripción).
  Controles de clasificación: fCategoria=<select> cerrado (canónico),
    fSubcategoria=<input list="dlSub"> (filtrado por categoría vía onCategoriaChange_()),
    fEtiqueta=<input list="dlEtiq"> (dinámico desde diccionario — NO <select> hardcodeado).
  Banco defaultea a Efectivo.
  font-size: 16px !important en inputs y selects — previene zoom automático en iOS.
  Input file: visually hidden pero NOT display:none (iOS requiere el elemento presente).
  #stepIndicator oculto con display:none — requerido por setStep() de _scripts.html.

Cómo agregar un view nuevo

Crear el HTML en la raíz del proyecto Apps Script (ej: Manual.html).
Si necesita datos del servidor al cargar, agregar un wrapper sin guion bajo
en 10_Menu_y_Public.gs (ej: api_getDatosManual).
En el HTML, copiar la estructura base de uno de los HTMLs existentes
(header, steps, STATE, patrón google.script.run).
clasp push. El routing de doGet ya lo detecta automáticamente.
Actualizar el deployment con "Nueva versión" (no "Nueva implementación").
Probar en la URL .../exec?view=manual.
Agregar botón en Firebase public/index.html con el link correspondiente y hacer firebase deploy.

Limitaciones conocidas

google.script.run no soporta Promises nativas. Encadenar llamadas requiere
callbacks anidados.
Timeout de 6 minutos de Apps Script. El parser de Claude tarda 60-90s,
OK dentro del límite pero resúmenes muy grandes pueden fallar.
FileReader + base64: el PDF se convierte a base64 en el browser. Para PDFs
muy grandes (>10MB) consume memoria del tab. Los resúmenes de tarjeta son
típicamente <2MB.
No hay persistencia de sesión. Si el usuario cierra/recarga la pestaña
durante la revisión del paso 2, pierde los cambios de la tabla. Los datos
siguen en Raw pero hay que usar test_reconfirmar_PDFReal manualmente.
Apps Script requiere login de Google con cuenta autorizada (ver hoja Usuarios).
getCurrentUser() usa !!row[3] (no === true) para tolerar tanto boolean como string "TRUE" en col Activo.
El catálogo de tarjetas se carga via google.script.run al init. Si tarda,
el botón "Subir" queda deshabilitado con texto "Cargando catálogo..."
(no hay spinner).

Apps Script gotchas

Meta tags en archivos .html son ignorados por el runtime:
  La doc oficial de Google confirma que <meta> tags escritos directamente en archivos
  .html de Apps Script no se aplican. El browser cae al viewport de compatibilidad
  desktop (~980px) y hace zoom-out — síntoma visible: contenido ancho y chico en mobile.
  ÚNICA solución: server-side vía HtmlOutput.addMetaTag().
  Fix aplicado: gf_web_renderView_() en 11_WebApp.gs (línea 134) llama:
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
  Consecuencia: el <meta name="viewport"> que existe en los archivos .html individuales
  es inofensivo pero no tiene efecto — el que cuenta es el del backend.
  Aplica a todos los HTMLs: Comprobantes, Tarjetas, Dashboard, Manual, Resumen
  (todos pasan por gf_web_renderView_()).

Quirks del WebView de Samsung dentro de script.google.com (Chrome Custom Tabs):
  El WebView que abre Apps Script en Android (especialmente desde la PWA de
  Firebase via Chrome Custom Tabs) tiene varios comportamientos no estándar
  que invalidan abordajes web habituales:

  1. Media queries (hover:), (pointer:) y de ancho son poco confiables.
     Síntoma: layout desktop disparado en celulares, franjas oscuras a los lados.
     Solución: detectar touch via JS antes del render
       (ver "Convenciones mobile-first" → "Detección touch").

  2. window.location.href devuelve URL de googleusercontent.com (la CDN del
     sandbox), no de script.google.com.
     Síntoma: links construidos a partir de location.href fallan al navegar.
     Solución: el backend pasa tpl.webAppBaseUrl = ScriptApp.getService().getUrl()
       y los HTMLs llaman initQnav('<?!= webAppBaseUrl ?>')
       (ver "Patrón webAppBaseUrl").

  3. <meta name="viewport"> escrito directamente en el .html es ignorado.
     Solución: HtmlOutput.addMetaTag() en backend
       (ver "Meta tags en archivos .html son ignorados por el runtime").

  En general: cualquier comportamiento mobile que dependa de detección del
  browser debe verificarse en este contexto antes de darlo por validado.
  "Funciona en Chrome del celular" no garantiza que funcione en el WebView
  de Samsung dentro de la PWA.

Convenciones de código

Funciones públicas (las que el usuario llama desde el editor de Apps Script)
se nombran sin guion bajo final: setupAll, getCurrentUser, etc.
Funciones privadas / helpers internos llevan guion bajo final: gf_normalizarBanco_.
Todas las constantes globales del proyecto arrancan con GF_ o viven dentro
del namespace GF.
Los archivos .gs se ordenan alfabéticamente por Apps Script al cargar, por
eso llevan prefijo numérico (00_Config.gs, 20_Setup_y_Helpers.gs, etc.).
google.script.run NO puede llamar funciones cuyo nombre termina en _. Todo
endpoint que el frontend consuma debe tener un wrapper sin guión bajo en
10_Menu_y_Public.gs (sección "WRAPPERS SIN GUIÓN BAJO").
Los prompts a Claude que devuelven JSON deben pedir el bloque json en backticks.
El parser usa mdMatch primero y rawMatch como fallback.

Migración no destructiva
Toda función de setup o migración debe ser NO DESTRUCTIVA. Nunca borrar columnas,
nunca reordenar, nunca tocar filas de datos sin confirmación previa del usuario.
Las migraciones de datos van en funciones aparte que el usuario corre manualmente
(ej: gf_migrarBancosLegacy_PREVIEW y gf_migrarBancosLegacy_APLICAR,
gf_renombrarHojasFase3_PREVIEW y gf_renombrarHojasFase3_APLICAR).
Cuando se transforma un campo existente, preservar el valor original en una columna
paralela para trazabilidad (ej: Patron → normalizado, PatronOriginal → raw pre-normalización).
Reglas de trabajo con Claude Code

Para comandos seguros (clasp push --force, clasp pull, git status, git diff,
git log, clasp deployments) podés ejecutar sin preguntarme cada vez.
NUNCA hacer clasp deploy. Solo hacer clasp push --force y pasarme la descripción
para que yo haga el deploy manualmente desde la UI de Apps Script.
Para git commit, git push, git reset, o cualquier comando destructivo,
pedíme confirmación siempre.
CLAUDE.md es el contrato del proyecto. Podés proponer cambios pero siempre
mostrame el diff antes de commitearlo.
Al final de cada sesión, recordame revisar si CLAUDE.md necesita actualizarse
con las decisiones nuevas que tomamos.
Si en algún momento te pido algo que contradice CLAUDE.md, paráme y preguntame
antes de hacerlo.
Para actualizar código: usar SIEMPRE "Nueva versión" sobre el deployment existente, NUNCA "Nueva implementación".

Workflow esperado

Hago cambios en archivos locales (Claude Code + yo).
Pruebo localmente cuando sea posible.
clasp push para subir a Apps Script.
Si hay cambios que afectan el comportamiento visible de la WebApp,
crear "Nueva versión" en el deployment existente.
El usuario corre las funciones desde el editor de Apps Script para validar.
Si todo OK, git add . && git commit -m "..." && git push para versionar.

Próximo paso inmediato
Estado al 2026-05-14 (sesión 9):

Fase 3: ✅ COMPLETA
Fase 4: ✅ código completo (pendiente validación ?view=dashboard)
Fase 4.5 — PWA Firebase: ✅ COMPLETA

Sesión 7 — Higiene del diccionario (C9 → C12): ✅ aplicada en producción.
Sesión 8 — On-write + consolidación (C13 + C11): ✅ aplicada en producción.
  C13 ✅ Normalización on-write en gf_dictAprender_ + columna PatronOriginal.
         Migración aplicada: 113 filas normalizadas, 4 conflictos skipeados.
  C11 ✅ Consolidación post-C13: grupo "club de gimnasia" (4 filas) consolidado
         en MAP_b3c288b8 (Educación y chicos / Club). Las 4 filas previamente
         tenían categorías distintas; el usuario las unificó manualmente a
         "Educación y chicos" antes del Aplicar.
         Grupo "ladobueno" (2 filas) salteado por categorías distintas — pendiente
         decisión manual (mercado vs restaurante).

Steady-state actual del pipeline:
  PDF → parser → on-write (Patron normalizado + PatronOriginal crudo)
              → on-read (normaliza ambos lados al consultar)
              → si match: clasificación auto + UsoCount++
              → si miss: fallback Esperados / usuario
              → confirmación → upsert dict.
  El dict ya NO acumula ruido. Reglas nuevas de ruido se agregan en
  Diccionario_Normalizacion (queda cubierto on-read sin migrar).

Sesión 9 — Rediseño Dashboard mobile + cache (C14): ✅ código listo, pendiente validación en prod.
  Rediseño Dashboard.html: migrado de desktop-first a mobile-first siguiendo el mock
    design (dashboard-mobile.jsx). Portado a JS vanilla ES5 (sin React/JSX).
    4 commits 1.1-1.4: esqueleto+estilos, render anual, render mensual + drill-down sheet,
    validación.
    Componentes nuevos: HeroBalance, mini-KPIs, IndicadorCards 2×2, MiniBars
    (reemplaza 6 funciones drawXxx), Donut, CatBars (reemplaza tablas), MonthList,
    CategorySheet (bottom sheet drill-down).
    Conservado: tabla "Por descripción" colapsada.
    Sacados del mock: gráfico ingresos-vs-gastos anual, daily trend mensual, TweaksPanel.
    IDs estables: #heroBalance, #miniKpiRow, #indicadoresGrid, #drillSheet+Backdrop,
    #annualByMesCard, #catCard, #catCardMensual, #monthlySubcatCard, #annualMonthListCard,
    #descTableSection, #legacyCompat (off-screen para compat con backend existente).
  C14.a ✅ hoja Dash_Cache (62_DashCache.gs):
    Schema: Mes|UpdatedAt|Status|KpisJSON|ByCatJSON|BySubcatJSON|ByBancoJSON|
            ByDescJSON|ByDiaJSON|IndicadoresJSON|InsightsJSON.
    Helpers: gf_dashCache_leerMes_, guardarMes_, marcarStale_,
             marcarComputing_, recalcularMes_.
    gf_dash_calcularMensual_(): función pura que calcula el payload desde Historico.
    Status: FRESH | STALE | COMPUTING.
  C14.a.fix ✅ cache de TC_Diario en memoria (40_TC_Dolar.gs, commit 2911593):
    Problema: gf_lookupTCPorFecha_ y gf_lookupTCPorMes_ leían TC_Diario completa en
    CADA llamada. gf_web_promedioMes12Gas_ hacía 763 lecturas = 160s por ejecución.
    Fix: _GF_TC_CACHE_ + gf_tc_cargarMapa_() — patrón _GF_DICT_NORM_RULES_.
    1 lectura de hoja por ejecución (script run). gf_dash_calcularMensual_ bajó de
    203s a 12s. Validado con log de profiling.

⚠️ C14 pendiente (próxima sesión):
  C14.b — refactor gf_web_getDashMensualData_ y getDashAnualData_ para leer de
    Dash_Cache primero; calcular en vivo solo si STALE/ausente. promedioMes12 y
    getDashMonthCompare pasan a leer cache en vez de recalcular meses enteros.
  C14.c — invalidación al escribir en Historico (marca-y-delega). Puntos:
    api_confirmarResumen, endpoint comprobantes, gf_web_guardarManual_.
    NOTA: perdió urgencia — con calcularMensual en 12s el cálculo on-demand
    ya no es catastrófico.
  C14.d — trigger horario recálculo mes actual + botones refresh manual (menú +
    ícono ↻ en Dashboard) + keep-alive UrlFetchApp.
  C14.e — backfill one-shot 24 meses.
  C14.f — log de retry en fetchMensual/fetchAnual + verificación de warmup.

Aprendizaje de método (C14.a.fix):
  El análisis estático identificó el mecanismo correcto (lookup que lee hoja completa
  por llamada) pero atribuyó el costo a la función equivocada. Solo el profiling con
  timestamps reveló que el volumen de llamadas estaba en gf_web_promedioMes12Gas_
  (763 lookups), no en las funciones que el análisis estático señalaba primero.
  Lección: el análisis estático da el mecanismo, el profiling da dónde pesa realmente.
  No optimizar por hipótesis — agregar timestamps antes de decidir qué cachear.

⚠️ Backlog manual (no bloquea, cleanup cuando puedas):
  1. Regla nueva en Diccionario_Normalizacion: período "DD/MM al DD/MM/YYYY"
     (caso MAP_3fca2e7b deja "al" colgando).
  2. Bug menor en preview de C13: deduplicar conflictos por Patron normalizado
     (reportaba el grupo Club 3 veces, bug de display no de lógica).
  3. Trigger mensual gf_dict_scan_ruido() vía 65_EmailMensual.gs.
  4. Logger.log de debug en 11_WebApp.gs (doPost, gf_web_renderView_,
     handleShareUploadFormPost_): remover.
  5. Anti-patrón hoja-por-llamada pendiente (no urgente — no están en loops críticos):
     - gf_getDiccionarioValores_ (20_Setup_y_Helpers.gs): lee hoja Diccionario por llamada.
       Callers: 47_Tarjetas_PDF.gs + 48b_Comprobantes.gs (1x por parse, no loop). Tolerable.
     - gf_dictLookup_ (46_Diccionario_Aprendido.gs): lee Diccionario_Aprendido por llamada.
       Caller en loop real: dictApplyToPending (30_Carga_y_Historico.gs, N filas pendientes).
       Aplicar mismo patrón _GF_TC_CACHE_ si el volumen crece.
     - gf_gastosEsperados_lookup_ (11_WebApp.gs): lee GastosEsperados + IngresosEsperados.
       Caller: UI onchange (1x por evento). No loop. Tolerable.

Próxima fase de código: completar C14.b-f (cache Dashboard backend), luego Fase 5 (Chat IA).

Archivos parciales compartidos (no subir a Apps Script como endpoints):
  _styles.html → CSS base compartido entre los 5 HTMLs
  _scripts.html → JS helpers compartidos (showMsg, hideMsg, poblarDatalist, poblarSelect, esc, fmtMonto, setStep, initQnav)