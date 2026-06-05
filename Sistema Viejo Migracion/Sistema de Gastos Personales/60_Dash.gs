function gf_actualizarDash_() {
  const ss = SpreadsheetApp.getActive();
  gf_ensureTCDisponible_();

  gf_buildDash_();
  gf_styleDashModern_(ss.getSheetByName(GF.SHEET_DASH));
}

function gf_buildDash_() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const shD = gf_getOrCreateSheet_(ss, GF.SHEET_DASH);
  shD.clear({ contentsOnly: true });

  shD.getRange(1, 1).setValue('Gastos por mes (Histórico)');
  shD.getRange(1, 6).setValue('Gastos anuales por categoría (Histórico)');
  shD.getRange(2, 1, 1, 4).setValues([['Mes', 'Total (ARS)', 'Total (USD)', 'Movimientos']]);
  shD.getRange(2, 6, 1, 4).setValues([['Categoría', 'Total (ARS)', 'Total (USD)', 'Movimientos']]);

  shD.getRange(2, 11).setValue('Año').setFontWeight('bold').setFontColor(GF_THEME.muted);
  shD.getRange(2, 12).setValue(new Date().getFullYear()).setNumberFormat('0');

  const shH = ss.getSheetByName(GF.SHEET_HIST);
  if (!shH) return;

  const t = gf_readSheet_(shH);
  const idx = gf_buildIdx_(t.headers);

  const iTipo = idx[gf_norm_('Tipo')];
  const iFecha = idx[gf_norm_('Fecha')];
  const iMes = idx[gf_norm_('Mes')];
  const iMon = idx[gf_norm_('Moneda')];
  const iMonto = idx[gf_norm_('Monto')];
  const iCat = idx[gf_norm_('Categoría')] ?? idx[gf_norm_('Categoria')];
  const iTc = idx[gf_norm_('TC_USDARS')];
  const iExcl = idx[gf_norm_('ExcluirDash')];
  const iEstado = idx[gf_norm_('EstadoRegistro')];

  const byMes = new Map();
  for (const r of t.rows) {
    const tipo = (r[iTipo] ?? '').toString().trim();
    if (tipo !== 'Gasto') continue;
    if (iExcl != null && gf_boolOrDefault_(r[iExcl], false)) continue;
    if (iEstado != null && String(r[iEstado] || '').trim() === 'Archivado') continue;

    const d = r[iFecha];
    if (!(d instanceof Date)) continue;

    const mes = (r[iMes] ?? '').toString().trim() || Utilities.formatDate(d, tz, 'yyyy-MM');
    const mon = (r[iMon] ?? 'ARS').toString().toUpperCase().trim() || 'ARS';
    const monto = Number(r[iMonto]) || 0;

    let tc = Number(iTc != null ? r[iTc] : NaN);
    if (!isFinite(tc) || tc <= 0) tc = gf_lookupTCPorFecha_(d);

    const conv = gf_convert_(monto, mon, tc);

    const cur = byMes.get(mes) || { ars: 0, usd: 0, count: 0 };
    cur.ars += conv.ars;
    cur.usd += conv.usd;
    cur.count++;
    byMes.set(mes, cur);
  }

  const mesKeys = Array.from(byMes.keys()).sort((a, b) => a.localeCompare(b));
  const mesRows = mesKeys.map(m => [m, byMes.get(m).ars, byMes.get(m).usd, byMes.get(m).count]);
  if (mesRows.length) shD.getRange(3, 1, mesRows.length, 4).setValues(mesRows);

  const year = Number(shD.getRange(2, 12).getValue()) || new Date().getFullYear();
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);

  const byCat = new Map();
  for (const r of t.rows) {
    const tipo = (r[iTipo] ?? '').toString().trim();
    if (tipo !== 'Gasto') continue;
    if (iExcl != null && gf_boolOrDefault_(r[iExcl], false)) continue;
    if (iEstado != null && String(r[iEstado] || '').trim() === 'Archivado') continue;

    const d = r[iFecha];
    if (!(d instanceof Date)) continue;
    if (d < start || d >= end) continue;

    const cat = (iCat != null ? r[iCat] : '') || 'Sin categoría';
    const mon = (r[iMon] ?? 'ARS').toString().toUpperCase().trim() || 'ARS';
    const monto = Number(r[iMonto]) || 0;

    let tc = Number(iTc != null ? r[iTc] : NaN);
    if (!isFinite(tc) || tc <= 0) tc = gf_lookupTCPorFecha_(d);

    const conv = gf_convert_(monto, mon, tc);

    const cur = byCat.get(cat) || { ars: 0, usd: 0, count: 0 };
    cur.ars += conv.ars;
    cur.usd += conv.usd;
    cur.count++;
    byCat.set(cat, cur);
  }

  const catKeys = Array.from(byCat.keys()).sort((a, b) => byCat.get(b).ars - byCat.get(a).ars);
  const catRows = catKeys.map(c => [c, byCat.get(c).ars, byCat.get(c).usd, byCat.get(c).count]);
  if (catRows.length) shD.getRange(3, 6, catRows.length, 4).setValues(catRows);

  shD.getRange(3, 2, Math.max(1, mesRows.length), 1).setNumberFormat('"ARS" #,##0');
  shD.getRange(3, 3, Math.max(1, mesRows.length), 1).setNumberFormat('"USD" #,##0');
  shD.getRange(3, 7, Math.max(1, catRows.length), 1).setNumberFormat('"ARS" #,##0');
  shD.getRange(3, 8, Math.max(1, catRows.length), 1).setNumberFormat('"USD" #,##0');

  shD.setColumnWidth(1, 110);
  shD.setColumnWidth(2, 140);
  shD.setColumnWidth(3, 140);
  shD.setColumnWidth(4, 110);
  shD.setColumnWidth(6, 240);
  shD.setColumnWidth(7, 140);
  shD.setColumnWidth(8, 140);
  shD.setColumnWidth(9, 110);
  shD.setFrozenRows(2);
}

function gf_actualizarDashMensual_() {
  const ss = SpreadsheetApp.getActive();
  const shConfig = ss.getSheetByName(GF.SHEET_CONFIG);
  if (!shConfig) throw new Error('Falta Config.');

  const tz = ss.getSpreadsheetTimeZone();
  const mesRaw = shConfig.getRange(GF.CFG_MES_CELL).getValue();
  const mes = gf_toYYYYMM_(mesRaw, tz);
  if (!mes) throw new Error('Config!B1 inválido. Usá YYYY-MM o una fecha del mes.');

  gf_ensureTCDisponible_();
  gf_buildDashMensual_(mes);
}

function gf_buildDashMensual_(mesYYYYMM) {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const sheetName = `DashMensual ${mesYYYYMM}`;
  const sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

  sh.clear({ contentsOnly: true });
  sh.clearFormats();
  sh.setHiddenGridlines(true);

  const p = gf_parseMonth_(mesYYYYMM);
  const tcRef = Number(gf_lookupTCPorMes_(mesYYYYMM)) || 1;
  const items = gf_collectDetailedItemsForDashMensual_(mesYYYYMM, p.start, p.end);

  let ingresosArs = 0;
  let ingresosUsd = 0;
  let gastosArs = 0;
  let gastosUsd = 0;

  const byCat = new Map();
  const byDesc = new Map();

  for (const it of items) {
    const isIngreso = (it.tipo || '').toString().trim() === 'Ingreso';
    if (isIngreso) {
      ingresosArs += Number(it.arsRaw) || 0;
      ingresosUsd += Number(it.usdRaw) || 0;
      continue;
    }

    gastosArs += Number(it.arsRaw) || 0;
    gastosUsd += Number(it.usdRaw) || 0;

    const cat = (it.categoria || 'Sin categoría').toString().trim() || 'Sin categoría';
    const desc = (it.descripcion || 'Sin descripción').toString().trim() || 'Sin descripción';

    const catCur = byCat.get(cat) || { arsEq: 0, usdEq: 0, count: 0 };
    catCur.arsEq += Number(it.arsEq) || 0;
    catCur.usdEq += Number(it.usdEq) || 0;
    catCur.count++;
    byCat.set(cat, catCur);

    const descCur = byDesc.get(desc) || { arsEq: 0, usdEq: 0, count: 0 };
    descCur.arsEq += Number(it.arsEq) || 0;
    descCur.usdEq += Number(it.usdEq) || 0;
    descCur.count++;
    byDesc.set(desc, descCur);
  }

  const totalIngArsEq = ingresosArs + ingresosUsd * tcRef;
  const totalGasArsEq = gastosArs + gastosUsd * tcRef;
  const totalIngUsdEq = ingresosUsd + (tcRef ? ingresosArs / tcRef : 0);
  const totalGasUsdEq = gastosUsd + (tcRef ? gastosArs / tcRef : 0);

  const netoArsEq = totalIngArsEq - totalGasArsEq;
  const netoUsdEq = totalIngUsdEq - totalGasUsdEq;
  const pesosDisponibles = ingresosArs - gastosArs;
  const faltanteUsdArsOnly = (tcRef ? (ingresosArs - gastosArs) / tcRef : 0) - gastosUsd;

  sh.getRange('A1:F1').merge()
    .setValue(`Dashboard mensual ${mesYYYYMM}`)
    .setBackground(GF_THEME.titleBg)
    .setFontColor(GF_THEME.titleFg)
    .setFontWeight('bold')
    .setFontSize(14)
    .setHorizontalAlignment('left');

  sh.getRange('A2:F4')
    .setBackground('#D9D9D9')
    .setFontWeight('bold')
    .setBorder(true, true, true, true, true, true, '#A3A3A3', SpreadsheetApp.BorderStyle.SOLID);

  sh.getRange('A2:F4').setValues([
    ['TC ref', tcRef, 'Ingresos ARS', totalIngArsEq, 'Gastos ARS', totalGasArsEq],
    ['Ingresos USD', totalIngUsdEq, 'Gastos USD', totalGasUsdEq, 'Neto ($ eq)', netoArsEq],
    ['Pesos disponibles', pesosDisponibles, 'Faltante (USD) ARS-only', faltanteUsdArsOnly, 'Neto (USD eq)', netoUsdEq]
  ]);

  sh.getRange('B2').setNumberFormat('#,##0.00');
  sh.getRange('D2').setNumberFormat('"$" #,##0');
  sh.getRange('F2').setNumberFormat('"$" #,##0');
  sh.getRange('B3').setNumberFormat('"USD" #,##0');
  sh.getRange('D3').setNumberFormat('"USD" #,##0');
  sh.getRange('F3').setNumberFormat('"$" #,##0;[Red]-"$" #,##0');
  sh.getRange('B4').setNumberFormat('"$" #,##0;[Red]-"$" #,##0');
  sh.getRange('D4').setNumberFormat('"USD" #,##0;[Red]-"USD" #,##0');
  sh.getRange('F4').setNumberFormat('"USD" #,##0;[Red]-"USD" #,##0');

  const shResumen = ss.getSheetByName(GF.SHEET_RESUMEN);
  if (shResumen) {
    const url = ss.getUrl() + '#gid=' + shResumen.getSheetId();
    sh.getRange('A5').setFormula(`=HYPERLINK("${url}";"Ir a Resumen")`);
    sh.getRange('A5').setFontWeight('bold');
  }

  const catRows = Array.from(byCat.keys())
    .map(k => [k, byCat.get(k).arsEq, byCat.get(k).usdEq])
    .sort((a, b) => b[1] - a[1]);

  sh.getRange('A7:C7').setValues([['Categoría', 'Total ($ eq)', 'Total (USD eq)']]);
  sh.getRange('A7:C7')
    .setBackground(GF_THEME.titleBg)
    .setFontColor(GF_THEME.titleFg)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  if (catRows.length) {
    sh.getRange(8, 1, catRows.length, 3).setValues(catRows);
    sh.getRange(8, 2, catRows.length, 1).setNumberFormat('"$" #,##0');
    sh.getRange(8, 3, catRows.length, 1).setNumberFormat('"USD" #,##0');
  }

  const descRows = Array.from(byDesc.keys())
    .map(k => [k, byDesc.get(k).arsEq, byDesc.get(k).usdEq])
    .sort((a, b) => b[1] - a[1]);

  sh.getRange('E7:G7').setValues([['Descripción', 'Total ($ eq)', 'Total (USD eq)']]);
  sh.getRange('E7:G7')
    .setBackground(GF_THEME.titleBg)
    .setFontColor(GF_THEME.titleFg)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  if (descRows.length) {
    sh.getRange(8, 5, descRows.length, 3).setValues(descRows);
    sh.getRange(8, 6, descRows.length, 1).setNumberFormat('"$" #,##0');
    sh.getRange(8, 7, descRows.length, 1).setNumberFormat('"USD" #,##0');
  }

  const maxRows = Math.max(catRows.length, descRows.length);
  if (maxRows > 0) {
    sh.getRange(7, 1, maxRows + 1, 3).setBorder(true, true, true, true, true, true, '#D1D5DB', SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(7, 5, maxRows + 1, 3).setBorder(true, true, true, true, true, true, '#D1D5DB', SpreadsheetApp.BorderStyle.SOLID);
  }

  sh.setColumnWidth(1, 230);
  sh.setColumnWidth(2, 180);
  sh.setColumnWidth(3, 180);
  sh.setColumnWidth(4, 220);
  sh.setColumnWidth(5, 320);
  sh.setColumnWidth(6, 180);
  sh.setColumnWidth(7, 180);

  sh.setFrozenRows(7);
}

function gf_collectDetailedItemsForDashMensual_(mesYYYYMM, start, end) {
  const ss = SpreadsheetApp.getActive();
  const out = [];

  function pushFrom(sh, isHist) {
    if (!sh) return;
    const t = gf_readSheet_(sh);
    const idx = gf_buildIdx_(t.headers);

    const iTipo = idx[gf_norm_('Tipo')];
    const iFecha = idx[gf_norm_('Fecha')];
    const iMes = idx[gf_norm_('Mes')];
    const iDesc = idx[gf_norm_('Descripción')] ?? idx[gf_norm_('Descripcion')];
    const iCat = idx[gf_norm_('Categoría')] ?? idx[gf_norm_('Categoria')];
    const iSubcat = idx[gf_norm_('Subcategoria')];
    const iBanco = idx[gf_norm_('Banco')];
    const iMon = idx[gf_norm_('Moneda')];
    const iMonto = idx[gf_norm_('Monto')];
    const iTc = idx[gf_norm_('TC_USDARS')];
    const iExcl = idx[gf_norm_('ExcluirDash')];
    const iEstado = idx[gf_norm_('EstadoRegistro')];

    for (const r of t.rows) {
      if (iExcl != null && gf_boolOrDefault_(r[iExcl], false)) continue;
      if (iEstado != null && String(r[iEstado] || '').trim() === 'Archivado') continue;

      const tipo = (iTipo != null ? r[iTipo] : '') || 'Gasto';
      const fecha = iFecha != null ? r[iFecha] : null;
      const mesRow = (isHist && iMes != null ? r[iMes] : '') || '';

      let inMonth = false;
      if (fecha instanceof Date) inMonth = (fecha >= start && fecha < end);
      else if (isHist && String(mesRow).trim() === mesYYYYMM) inMonth = true;
      else if (!isHist && !fecha) inMonth = true;
      if (!inMonth) continue;

      const moneda = ((iMon != null ? r[iMon] : 'ARS') || 'ARS').toString().toUpperCase().trim();
      const monto = Number(iMonto != null ? r[iMonto] : 0) || 0;
      if (!monto) continue;

      let tc = Number(iTc != null ? r[iTc] : NaN);
      if (!isFinite(tc) || tc <= 0) {
        tc = (fecha instanceof Date) ? gf_lookupTCPorFecha_(fecha) : gf_lookupTCPorMes_(mesYYYYMM);
      }

      const arsRaw = moneda === 'USD' ? 0 : monto;
      const usdRaw = moneda === 'USD' ? monto : 0;
      const arsEq = moneda === 'USD' ? monto * tc : monto;
      const usdEq = moneda === 'USD' ? monto : (tc ? monto / tc : 0);

      out.push({
        tipo: String(tipo).trim(),
        fecha: fecha instanceof Date ? fecha : null,
        descripcion: iDesc != null ? r[iDesc] : '',
        categoria: iCat != null ? r[iCat] : '',
        subcategoria: iSubcat != null ? r[iSubcat] : '',
        banco: iBanco != null ? r[iBanco] : '',
        mon: moneda,
        monto,
        tc,
        arsRaw,
        usdRaw,
        arsEq,
        usdEq
      });
    }
  }

  pushFrom(ss.getSheetByName(GF.SHEET_HIST), true);
  pushFrom(ss.getSheetByName(GF.SHEET_CARGA), false);
  return out;
}

function gf_applyBaseTheme_(sh) {
  sh.setHiddenGridlines(true);
  const rng = sh.getDataRange();
  rng.setFontFamily('Roboto').setFontSize(10).setBackground(GF_THEME.sheetBg).setFontColor(GF_THEME.headerFg);
  const lastRow = Math.max(1, Math.min(sh.getMaxRows(), 200));
  sh.setRowHeights(1, lastRow, 26);
}

function gf_styleHeaderRow_(sh, headerRow, fromCol, toCol) {
  sh.getRange(headerRow, fromCol, 1, toCol - fromCol + 1)
    .setBackground(GF_THEME.headerBg)
    .setFontColor(GF_THEME.headerFg)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, true, true, GF_THEME.border, SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeight(headerRow, 28);
}

function gf_styleTitleBar_(sh) {
  const lastCol = Math.max(1, sh.getLastColumn());
  const full = sh.getRange(1, 1, 1, lastCol);

  try { full.breakApart(); } catch (e) {}

  full
    .setBackground(GF_THEME.titleBg)
    .setFontColor(GF_THEME.titleFg)
    .setFontWeight('bold')
    .setFontSize(14)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  const mergeCols = Math.min(2, lastCol);
  try { sh.getRange(1, 1, 1, mergeCols).merge(); } catch (e) {}

  sh.setRowHeight(1, 34);
}

function gf_applyBanding_(range) {
  try { range.getSheet().getBandings().forEach(b => b.remove()); } catch (e) {}
  range.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
}

function gf_findRowWithHeaders_(sh, headers, maxRows = 200) {
  const lastRow = Math.min(sh.getLastRow(), maxRows);
  const lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return null;

  const vals = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const norm = v => (v ?? '').toString().trim().toLowerCase();

  for (let r = 0; r < vals.length; r++) {
    const row = vals[r].map(norm);
    const ok = headers.every(h => row.includes(h.toLowerCase()));
    if (ok) return r + 1;
  }
  return null;
}

function gf_findCellExact_(sh, text, maxRows = 600, maxCols = 20) {
  const lastRow = Math.min(sh.getLastRow(), maxRows);
  const lastCol = Math.min(sh.getLastColumn(), maxCols);
  if (lastRow < 1 || lastCol < 1) return null;

  const vals = sh.getRange(1, 1, lastRow, lastCol).getValues();
  for (let r = 0; r < vals.length; r++) {
    for (let c = 0; c < vals[0].length; c++) {
      if ((vals[r][c] ?? '').toString().trim() === text) return { row: r + 1, col: c + 1 };
    }
  }
  return null;
}

function gf_styleResumenMesModern_(sh) {
  if (!sh) return;
  gf_applyBaseTheme_(sh);
  gf_styleTitleBar_(sh);

  const lastCol = Math.max(1, sh.getLastColumn());

  const incomeHdr = gf_findRowWithHeaders_(sh, ['Persona', 'Total (ARS)', 'Total (USD)'], 80);
  if (incomeHdr) {
    gf_styleHeaderRow_(sh, incomeHdr, 1, 3);

    const top = Math.max(3, incomeHdr - 1);
    const bottom = Math.min(sh.getLastRow(), incomeHdr + 12);
    sh.getRange(top, 1, bottom - top + 1, Math.min(6, lastCol))
      .setBorder(true, true, true, true, true, true, GF_THEME.border, SpreadsheetApp.BorderStyle.SOLID)
      .setBackground(GF_THEME.soft);

    sh.getRange(5, 5, 2, 2)
      .setBorder(true, true, true, true, true, true, GF_THEME.border, SpreadsheetApp.BorderStyle.SOLID)
      .setBackground('#FFFFFF');
  }

  const expHdr = gf_findRowWithHeaders_(sh, ['Fecha', 'Día'], 500) || gf_findRowWithHeaders_(sh, ['Fecha', 'Dia'], 500);
  if (expHdr) {
    gf_styleHeaderRow_(sh, expHdr, 1, lastCol);

    const totalCell = gf_findCellExact_(sh, 'TOTAL MES');
    const endRow = totalCell ? totalCell.row : sh.getLastRow();
    gf_applyBanding_(sh.getRange(expHdr, 1, Math.max(1, endRow - expHdr + 1), lastCol));

    if (totalCell) {
      sh.getRange(totalCell.row, 1, 1, lastCol)
        .setBackground(GF_THEME.totalBg)
        .setFontWeight('bold')
        .setBorder(true, true, true, true, true, true, GF_THEME.border, SpreadsheetApp.BorderStyle.SOLID);
      sh.setRowHeight(totalCell.row, 30);
    }

    const rules = sh.getConditionalFormatRules() || [];
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=AND($A${expHdr + 1}<>"",WEEKDAY($A${expHdr + 1},2)>5)`)
        .setBackground('#F3F4F6')
        .setRanges([sh.getRange(expHdr + 1, 1, Math.max(1, endRow - expHdr), lastCol)])
        .build()
    );
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenNumberLessThan(0)
        .setFontColor(GF_THEME.negFg)
        .setRanges([sh.getRange(expHdr + 1, 1, Math.max(1, endRow - expHdr), lastCol)])
        .build()
    );
    sh.setConditionalFormatRules(rules);

    sh.setFrozenRows(expHdr);
    sh.setFrozenColumns(2);
  }
}

function gf_styleDashModern_(sh) {
  if (!sh) return;
  gf_applyBaseTheme_(sh);

  const lastCol = Math.max(1, sh.getLastColumn());
  const lastRow = Math.max(1, sh.getLastRow());

  sh.setRowHeight(1, 34);
  for (let c = 1; c <= lastCol; c++) {
    const v = (sh.getRange(1, c).getValue() ?? '').toString().trim();
    if (!v) continue;
    sh.getRange(1, c).setFontWeight('bold').setFontSize(13);
    sh.getRange(1, c, 1, Math.min(4, lastCol - c + 1))
      .setBorder(false, false, true, false, false, false, GF_THEME.border, SpreadsheetApp.BorderStyle.SOLID_THICK);
  }

  gf_styleHeaderRow_(sh, 2, 1, 4);
  gf_styleHeaderRow_(sh, 2, 6, 9);

  if (lastRow > 2) gf_applyBanding_(sh.getRange(2, 1, lastRow - 1, lastCol));
  sh.setFrozenRows(2);
}

function gf_convert_(monto, moneda, tc) {
  const mon = (moneda || 'ARS').toString().toUpperCase().trim();
  if (mon === 'USD') return { ars: monto * tc, usd: monto };
  return { ars: monto, usd: tc ? (monto / tc) : 0 };
}