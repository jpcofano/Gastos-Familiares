function gf_logError_(where, err, e) {
  try {
    const ss = SpreadsheetApp.getActive();
    let sh = ss.getSheetByName('Log');
    if (!sh) sh = ss.insertSheet('Log');

    if (sh.getLastRow() === 0) {
      sh.getRange(1,1,1,6).setValues([['Cuando','Dónde','Mensaje','Stack','Sheet','Rango']]);
      sh.setFrozenRows(1);
    }

    const when = new Date();
    const msg = (err && err.message) ? err.message : String(err);
    const stack = (err && err.stack) ? String(err.stack).slice(0, 5000) : '';
    const sheetName = (e && e.range) ? e.range.getSheet().getName() : '';
    const a1 = (e && e.range) ? e.range.getA1Notation() : '';

    sh.appendRow([when, where, msg, stack, sheetName, a1]);
  } catch (_) {
    // no hacemos nada: log es best-effort
  }
}

/**
 * INIT TEMPLATE v6
 * - Define TODOS los formatos fijos (colores ARS/USD, separadores, headers, cards, widths, etc.)
 * - El build solo aplica cosas variables (heatmap, signos, peak, ocultar filas 0, etc.)
 */
function gf_getResumenTemplateKey_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_CONFIG);
  if (!sh) return '6A';

  // Elegimos B9 como selector de estilo
  const v = sh.getRange('B9').getValue();
  const key = String(v || '').trim().toUpperCase();

  const allowed = new Set(['6A','6B','6C','6D','6E']);
  return allowed.has(key) ? key : '6A';
}
function gf_resumenMes_initTemplate_byKey_(key) {
  switch (String(key || '').toUpperCase()) {
    case '6A': return gf_resumenMes_initTemplate_v6A_();
    case '6B': return gf_resumenMes_initTemplate_v6B_();
    case '6C': return gf_resumenMes_initTemplate_v6C_();
    case '6D': return gf_resumenMes_initTemplate_v6D_();
    case '6E': return gf_resumenMes_initTemplate_v6E_();
    default:   return gf_resumenMes_initTemplate_v6A_();
  }
}
function gf_resumenMes_initTemplate_() {
  const ss = SpreadsheetApp.getActive();
  const sh = gf_getOrCreateSheet_(ss, GF.SHEET_RESUMEN);

  sh.setHiddenGridlines(true);
  sh.clearFormats();

  try { sh.getBandings().forEach(b => b.remove()); } catch(e) {}
  sh.setConditionalFormatRules([]);

  // Freeze como tu vista
  sh.setFrozenColumns(2);
  sh.setFrozenRows(6);

  const MAX_COLS = 12;  // A:L
  const MAX_ROWS = 80;

  const bgARS   = '#FFF7ED'; // crema (ARS)
  const bgUSD   = '#EFF6FF'; // celeste (USD)
  const bgTotal = '#FFEFD5'; // más marcado para Total día ($)
  const bgAux   = '#F3F4F6'; // gris suave (Dia)
  const sepCol  = (GF_THEME && GF_THEME.border) ? GF_THEME.border : '#9CA3AF';

  // Base
  const base = sh.getRange(1, 1, MAX_ROWS, MAX_COLS);
  base
    .setFontFamily('Roboto')
    .setFontSize(10)
    .setBackground('#FFFFFF')
    .setFontColor('#111827')
    .setVerticalAlignment('middle');

  // Row heights
  for (let r = 1; r <= MAX_ROWS; r++) sh.setRowHeight(r, r <= 6 ? 28 : 26);

  // Column widths (ajustables)
  sh.setColumnWidth(1, 120); // A Fecha
  sh.setColumnWidth(2, 70);  // B Día (lun/mar)
  sh.setColumnWidth(3, 150); // C BBVA ($)
  sh.setColumnWidth(4, 120); // D BBVA (USD)
  sh.setColumnWidth(5, 150); // E Galicia ($)
  sh.setColumnWidth(6, 120); // F Galicia (USD)
  sh.setColumnWidth(7, 150); // G Personal Pay ($)
  sh.setColumnWidth(8, 140); // H Efectivo ($)
  sh.setColumnWidth(9, 150); // I Total día ($)
  sh.setColumnWidth(10, 60); // J Dia (número)
  sh.setColumnWidth(11, 150); // K Total día (USD)
  sh.setColumnWidth(12, 150); // L Total (USD eq)

  // Barra izquierda A1:B1
  sh.getRange(1, 1, 1, 2)
    .setBackground(GF_THEME.titleBg)
    .setFontColor(GF_THEME.titleFg)
    .setFontWeight('bold')
    .setFontSize(14)
    .setHorizontalAlignment('left');

  // Cards H1:J4 (fondo oscuro)
  sh.getRange(1, 8, 4, 3)
    .setBackground(GF_THEME.titleBg)
    .setFontColor(GF_THEME.titleFg)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // Cards extra K1:L2 (fondo oscuro)
  sh.getRange(1, 11, 2, 2)
    .setBackground(GF_THEME.titleBg)
    .setFontColor(GF_THEME.titleFg)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // Encabezados ingresos (C3:G3)
  sh.getRange(3, 3, 1, 5)
    .setBackground(GF_THEME.headerBg)
    .setFontColor(GF_THEME.headerFg)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // Header tabla diaria (fila 6 A:L)
  sh.getRange(6, 1, 1, MAX_COLS)
    .setBackground(GF_THEME.headerBg)
    .setFontColor(GF_THEME.headerFg)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // Diferenciar headers ARS/USD (sutil, sin perder “gris”)
  // ARS: C,E,G,H,I
  sh.getRange(6, 3, 1, 1).setBackground('#D1D5DB');
  sh.getRange(6, 5, 1, 1).setBackground('#D1D5DB');
  sh.getRange(6, 7, 1, 1).setBackground('#D1D5DB');
  sh.getRange(6, 8, 1, 1).setBackground('#D1D5DB');
  sh.getRange(6, 9, 1, 1).setBackground('#C7CED8'); // Total ARS un poco más marcado

  // USD: D,F,K,L
  sh.getRange(6, 4, 1, 1).setBackground('#BFDBFE');
  sh.getRange(6, 6, 1, 1).setBackground('#BFDBFE');
  sh.getRange(6, 11, 1, 1).setBackground('#BFDBFE');
  sh.getRange(6, 12, 1, 1).setBackground('#BFDBFE');

  // Aux: J
  sh.getRange(6, 10, 1, 1).setBackground('#E5E7EB');

  // Body backgrounds por columna (fila 7 en adelante)
  const bodyRows = MAX_ROWS - 6;
  // ARS columns
  sh.getRange(7, 3, bodyRows, 1).setBackground(bgARS);      // C
  sh.getRange(7, 5, bodyRows, 1).setBackground(bgARS);      // E
  sh.getRange(7, 7, bodyRows, 1).setBackground(bgARS);      // G
  sh.getRange(7, 8, bodyRows, 1).setBackground(bgARS);      // H
  sh.getRange(7, 9, bodyRows, 1).setBackground(bgTotal);    // I Total día ($)

  // USD columns
  sh.getRange(7, 4, bodyRows, 1).setBackground(bgUSD);      // D
  sh.getRange(7, 6, bodyRows, 1).setBackground(bgUSD);      // F
  sh.getRange(7, 11, bodyRows, 1).setBackground(bgUSD);     // K
  sh.getRange(7, 12, bodyRows, 1).setBackground(bgUSD);     // L

  // Aux Dia num
  sh.getRange(7, 10, bodyRows, 1).setBackground(bgAux);     // J

  // Enfatizar columnas clave fijas
  sh.getRange(7, 9, bodyRows, 1).setFontWeight('bold');     // I Total día ($)
  sh.getRange(7, 11, bodyRows, 1).setFontWeight('bold');    // K Total día (USD)
  sh.getRange(7, 10, bodyRows, 1).setFontWeight('bold').setHorizontalAlignment('center'); // J Dia

  // Alineación general (como tu captura)
  sh.getRange(7, 1, bodyRows, MAX_COLS).setHorizontalAlignment('center');

  // Separadores verticales gruesos (derecha de B, D, F, H, J)
  const sepCols = [2, 4, 6, 8, 10];
  sepCols.forEach(c => {
    sh.getRange(1, c, MAX_ROWS, 1)
      .setBorder(false, false, false, true, false, false, sepCol, SpreadsheetApp.BorderStyle.SOLID_THICK);
  });

  // Conditional formatting fijo:
  // 1) Finde (solo A:B para no pisar colores ARS/USD)
  // 2) TOTAL MES (toda la fila, no depende de número de mes)
  const rules = [];

  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND($A7<>"",WEEKDAY($A7,2)>5)`)
      .setBackground('#F3F4F6')
      .setRanges([sh.getRange(7, 1, bodyRows, 2)]) // A:B
      .build()
  );

  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$A7="TOTAL MES"`)
      .setBackground('#E5E7EB')
      .setBold(true)
      .setRanges([sh.getRange(7, 1, bodyRows, MAX_COLS)]) // A:L
      .build()
  );

  sh.setConditionalFormatRules(rules);

  PropertiesService.getDocumentProperties().setProperty('GF_RESUMEN_TEMPLATE_V', '6');
}

// Alias por compatibilidad (si algo viejo la llama sin _)
function gf_resumenMes_initTemplate() {
  return gf_resumenMes_initTemplate_();
}
/*******************************
 * RESUMEN MES — INIT TEMPLATE (5 estilos)
 * A: Warm (como tu imagen)
 * B: Minimal gris/monocromo
 * C: Dark header + líneas finas (más “moderno”)
 * D: Pastel suave (más “friendly”)
 * E: Corporate azul (más “empresa”)
 *******************************/

function gf_resumenMes_initTemplate_v6A_() {
  gf_resumenMes_initTemplate_apply_({
    templateKey: '6A',
    fontFamily: 'Roboto',
    fontSize: 10,

    // Paleta
    titleBg: '#0B1220',
    titleFg: '#FFFFFF',
    cardBg:  '#0B1220',
    cardFg:  '#FFFFFF',

    headerBg: '#D1D5DB',
    headerFg: '#111827',

    // Column colors
    arsBg:   '#FFF7ED',  // crema
    usdBg:   '#EFF6FF',  // celeste
    totalBg: '#FFEFD5',  // total ARS
    auxBg:   '#F3F4F6',  // Dia num

    sepColor: '#C7CBD1',
    sepStyle: SpreadsheetApp.BorderStyle.SOLID_THICK,

    weekendBg: '#F3F4F6',
    totalMesBg:'#E5E7EB',

    // Header tint per group (sutil)
    headerArsBg:  '#D1D5DB',
    headerUsdBg:  '#BFDBFE',
    headerTotalBg:'#C7CED8',
    headerAuxBg:  '#E5E7EB',
  });
}

function gf_resumenMes_initTemplate_v6B_() {
  // Minimal / monocromo: nada de “color por moneda”, solo jerarquía y líneas
  gf_resumenMes_initTemplate_apply_({
    templateKey: '6B',
    fontFamily: 'Roboto',
    fontSize: 10,

    titleBg: '#111827',
    titleFg: '#FFFFFF',
    cardBg:  '#111827',
    cardFg:  '#FFFFFF',

    headerBg: '#F3F4F6',
    headerFg: '#111827',

    arsBg:   '#FFFFFF',
    usdBg:   '#FFFFFF',
    totalBg: '#FAFAFA',
    auxBg:   '#FFFFFF',

    sepColor: '#E5E7EB',
    sepStyle: SpreadsheetApp.BorderStyle.SOLID, // líneas finas

    weekendBg: '#F9FAFB',
    totalMesBg:'#F3F4F6',

    headerArsBg:  '#F3F4F6',
    headerUsdBg:  '#F3F4F6',
    headerTotalBg:'#E5E7EB',
    headerAuxBg:  '#F3F4F6',
  });
}

function gf_resumenMes_initTemplate_v6C_() {
  // Modern / Dark header + columnas con tono MUY leve, separadores finos
  gf_resumenMes_initTemplate_apply_({
    templateKey: '6C',
    fontFamily: 'Roboto',
    fontSize: 10,

    titleBg: '#0F172A',
    titleFg: '#E5E7EB',
    cardBg:  '#0F172A',
    cardFg:  '#E5E7EB',

    headerBg: '#111827',
    headerFg: '#F9FAFB',

    arsBg:   '#FFF8F1', // muy leve
    usdBg:   '#F1F7FF', // muy leve
    totalBg: '#FFE9C9',
    auxBg:   '#111827', // columna Dia num oscura

    sepColor: '#334155',
    sepStyle: SpreadsheetApp.BorderStyle.SOLID, // fino

    weekendBg: '#F3F4F6',
    totalMesBg:'#E2E8F0',

    headerArsBg:  '#111827',
    headerUsdBg:  '#111827',
    headerTotalBg:'#1F2937',
    headerAuxBg:  '#111827',
    auxFg: '#F9FAFB',
  });
}

function gf_resumenMes_initTemplate_v6D_() {
  // Pastel: verde/violáceo suave, cards no tan duras
  gf_resumenMes_initTemplate_apply_({
    templateKey: '6D',
    fontFamily: 'Roboto',
    fontSize: 10,

    titleBg: '#1F2937',
    titleFg: '#FFFFFF',
    cardBg:  '#1F2937',
    cardFg:  '#FFFFFF',

    headerBg: '#E5E7EB',
    headerFg: '#111827',

    arsBg:   '#ECFDF5', // verde muy suave
    usdBg:   '#EEF2FF', // lavanda suave
    totalBg: '#FFE4E6', // rosado suave
    auxBg:   '#F3F4F6',

    sepColor: '#CBD5E1',
    sepStyle: SpreadsheetApp.BorderStyle.SOLID_THICK,

    weekendBg: '#F8FAFC',
    totalMesBg:'#E5E7EB',

    headerArsBg:  '#D1FAE5',
    headerUsdBg:  '#C7D2FE',
    headerTotalBg:'#FBCFE8',
    headerAuxBg:  '#E5E7EB',
  });
}

function gf_resumenMes_initTemplate_v6E_() {
  // Corporate blue: más “empresa”, bordes marcados y azules
  gf_resumenMes_initTemplate_apply_({
    templateKey: '6E',
    fontFamily: 'Arial',
    fontSize: 10,

    titleBg: '#0B2A4A',
    titleFg: '#FFFFFF',
    cardBg:  '#0B2A4A',
    cardFg:  '#FFFFFF',

    headerBg: '#1D4ED8',
    headerFg: '#FFFFFF',

    arsBg:   '#FFFFFF',
    usdBg:   '#E0F2FE',
    totalBg: '#FEF3C7',
    auxBg:   '#F1F5F9',

    sepColor: '#0B2A4A',
    sepStyle: SpreadsheetApp.BorderStyle.SOLID_THICK,

    weekendBg: '#F8FAFC',
    totalMesBg:'#E2E8F0',

    headerArsBg:  '#1D4ED8',
    headerUsdBg:  '#2563EB',
    headerTotalBg:'#1E40AF',
    headerAuxBg:  '#1D4ED8',
  });
}


/**
 * Motor común: aplica layout fijo A:L como tu ResumenMes actual
 * - No mete heatmaps (eso va en build)
 * - Sí mete: weekend (solo A:B) + TOTAL MES (toda la fila)
 */
function gf_resumenMes_initTemplate_apply_(opt) {
  const ss = SpreadsheetApp.getActive();
  const sh = gf_getOrCreateSheet_(ss, GF.SHEET_RESUMEN);

  const MAX_COLS = 12; // A:L
  const MAX_ROWS = 80;

  // Defaults
  const titleBg = opt.titleBg || '#111827';
  const titleFg = opt.titleFg || '#FFFFFF';
  const cardBg  = opt.cardBg  || titleBg;
  const cardFg  = opt.cardFg  || titleFg;

  const headerBg = opt.headerBg || '#D1D5DB';
  const headerFg = opt.headerFg || '#111827';

  const arsBg   = opt.arsBg   || '#FFF7ED';
  const usdBg   = opt.usdBg   || '#EFF6FF';
  const totalBg = opt.totalBg || '#FFEFD5';
  const auxBg   = opt.auxBg   || '#F3F4F6';

  const headerArsBg   = opt.headerArsBg   || headerBg;
  const headerUsdBg   = opt.headerUsdBg   || headerBg;
  const headerTotalBg = opt.headerTotalBg || headerBg;
  const headerAuxBg   = opt.headerAuxBg   || headerBg;

  const sepColor = opt.sepColor || '#9CA3AF';
  const sepStyle = opt.sepStyle || SpreadsheetApp.BorderStyle.SOLID_THICK;

  const weekendBg = opt.weekendBg || '#F3F4F6';
  const totalMesBg = opt.totalMesBg || '#E5E7EB';

  const auxFg = opt.auxFg || '#111827';

  // Reset
  sh.setHiddenGridlines(true);
  sh.clearFormats();
  try { sh.getBandings().forEach(b => b.remove()); } catch(e) {}
  sh.setConditionalFormatRules([]);

  // Freeze
  sh.setFrozenColumns(2);
  sh.setFrozenRows(6);

  // Base range
  const base = sh.getRange(1, 1, MAX_ROWS, MAX_COLS);
  base
    .setFontFamily(opt.fontFamily || 'Roboto')
    .setFontSize(opt.fontSize || 10)
    .setBackground('#FFFFFF')
    .setFontColor('#111827')
    .setVerticalAlignment('middle');

  // Row heights (más eficiente)
  sh.setRowHeights(1, 6, 28);
  sh.setRowHeights(7, MAX_ROWS - 6, 26);

  /*   // Column widths (tu layout)
  sh.setColumnWidth(1, 120);  // A Fecha
  sh.setColumnWidth(2, 70);   // B Día
  sh.setColumnWidth(3, 150);  // C BBVA ($)
  sh.setColumnWidth(4, 120);  // D BBVA (USD)
  sh.setColumnWidth(5, 150);  // E Galicia ($)
  sh.setColumnWidth(6, 120);  // F Galicia (USD)
  sh.setColumnWidth(7, 150);  // G Personal Pay ($)
  sh.setColumnWidth(8, 140);  // H Efectivo ($)
  sh.setColumnWidth(9, 150);  // I Total día ($)
  sh.setColumnWidth(10, 60);  // J Dia
  sh.setColumnWidth(11, 150); // K Total día (USD)
  sh.setColumnWidth(12, 150); // L Total (USD eq) */

  // Column widths (tu layout REAL)
  sh.setColumnWidth(1, 120);  // A Fecha
  sh.setColumnWidth(2, 70);   // B Día (texto lun/mar)
  sh.setColumnWidth(3, 104);  // C BBVA ($)
  sh.setColumnWidth(4, 85);   // D BBVA (USD)
  sh.setColumnWidth(5, 85);   // E Galicia ($)
  sh.setColumnWidth(6, 120);  // F Galicia (USD)
  sh.setColumnWidth(7, 150);  // G Personal Pay ($)
  sh.setColumnWidth(8, 140);  // H Efectivo ($)
  sh.setColumnWidth(9, 150);  // I Total día ($)
  sh.setColumnWidth(10, 31);  // J Dia (número)
  sh.setColumnWidth(11, 150); // K Total día (USD)
  sh.setColumnWidth(12, 150); // L Total (USD eq)
  sh.setColumnWidth(13, 100); // M Helper (acumulado) / oculto

  // Title bar A1:B1
  sh.getRange(1, 1, 1, 2)
    .setBackground(titleBg)
    .setFontColor(titleFg)
    .setFontWeight('bold')
    .setFontSize(14)
    .setHorizontalAlignment('left');

  // Cards H1:J4
  sh.getRange(1, 8, 4, 3)
    .setBackground(cardBg)
    .setFontColor(cardFg)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // Extra card K1:L2
  sh.getRange(1, 11, 2, 2)
    .setBackground(cardBg)
    .setFontColor(cardFg)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // Income header C3:G3
  sh.getRange(3, 3, 1, 5)
    .setBackground('#F3F4F6')
    .setFontColor('#111827')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // Daily header row 6 A:L
  sh.getRange(6, 1, 1, MAX_COLS)
    .setBackground(headerBg)
    .setFontColor(headerFg)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // Header tints
  // ARS cols: C,E,G,H,I
  sh.getRange(6, 3, 1, 1).setBackground(headerArsBg);
  sh.getRange(6, 5, 1, 1).setBackground(headerArsBg);
  sh.getRange(6, 7, 1, 1).setBackground(headerArsBg);
  sh.getRange(6, 8, 1, 1).setBackground(headerArsBg);
  sh.getRange(6, 9, 1, 1).setBackground(headerTotalBg);

  // USD cols: D,F,K,L
  sh.getRange(6, 4, 1, 1).setBackground(headerUsdBg);
  sh.getRange(6, 6, 1, 1).setBackground(headerUsdBg);
  sh.getRange(6, 11, 1, 1).setBackground(headerUsdBg);
  sh.getRange(6, 12, 1, 1).setBackground(headerUsdBg);

  // Aux: J
  sh.getRange(6, 10, 1, 1).setBackground(headerAuxBg);

  // Body column backgrounds (7..)
  const bodyRows = MAX_ROWS - 6;

  // ARS cols
  sh.getRange(7, 3, bodyRows, 1).setBackground(arsBg);
  sh.getRange(7, 5, bodyRows, 1).setBackground(arsBg);
  sh.getRange(7, 7, bodyRows, 1).setBackground(arsBg);
  sh.getRange(7, 8, bodyRows, 1).setBackground(arsBg);
  sh.getRange(7, 9, bodyRows, 1).setBackground(totalBg).setFontWeight('bold'); // Total día ($)

  // USD cols
  sh.getRange(7, 4, bodyRows, 1).setBackground(usdBg);
  sh.getRange(7, 6, bodyRows, 1).setBackground(usdBg);
  sh.getRange(7, 11, bodyRows, 1).setBackground(usdBg).setFontWeight('bold'); // Total día (USD)
  sh.getRange(7, 12, bodyRows, 1).setBackground(usdBg); // Total USD eq

  // Aux: Dia num (J)
  sh.getRange(7, 10, bodyRows, 1)
    .setBackground(auxBg)
    .setFontColor(auxFg)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // Align body
  sh.getRange(7, 1, bodyRows, MAX_COLS).setHorizontalAlignment('center');

  // Separators (derecha de B, D, F, H, J)
  [2, 4, 6, 8, 10].forEach(c => {
    sh.getRange(1, c, MAX_ROWS, 1)
      .setBorder(false, false, false, true, false, false, sepColor, sepStyle);
  });

  // Fixed conditional rules:
  // - weekend only A:B (no pisa colores ARS/USD)
  // - TOTAL MES entire row
  const rules = [];
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND($A7<>"",WEEKDAY($A7,2)>5)`)
      .setBackground(weekendBg)
      .setRanges([sh.getRange(7, 1, bodyRows, 2)])
      .build()
  );
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$A7="TOTAL MES"`)
      .setBackground(totalMesBg)
      .setBold(true)
      .setRanges([sh.getRange(7, 1, bodyRows, MAX_COLS)])
      .build()
  );
  sh.setConditionalFormatRules(rules);

  // Guardar key para que tu check dispare solo cuando cambia de estilo
  PropertiesService.getDocumentProperties().setProperty('GF_RESUMEN_TEMPLATE_V', opt.templateKey || '6');
}
