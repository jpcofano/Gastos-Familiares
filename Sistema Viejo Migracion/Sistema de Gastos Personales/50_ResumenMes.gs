/**************************************
 * 40_ResumenMes.gs
 * RESUMEN MES - formato exacto del original
 * - Mantiene formato/comportamiento original
 * - Fuente: SOLO Historico
 * - Filtro: FlagResumenMes = true
 **************************************/

function gf_actualizarResumenMes_() {
  const ss = SpreadsheetApp.getActive();
  const shConfig = ss.getSheetByName(GF.SHEET_CONFIG);
  if (!shConfig) throw new Error('Falta Config.');

  const tz = ss.getSpreadsheetTimeZone();
  const mesRaw = shConfig.getRange(GF.CFG_MES_CELL).getValue();
  const mes = gf_toYYYYMM_(mesRaw, tz);
  if (!mes) throw new Error('Config!B1 inválido. Usá YYYY-MM o una fecha del mes.');

  const props = PropertiesService.getDocumentProperties();
  const templateKey = (typeof gf_getResumenTemplateKey_ === 'function')
    ? gf_getResumenTemplateKey_()
    : '6A';

  if (props.getProperty('GF_RESUMEN_TEMPLATE_V') !== templateKey) {
    if (typeof gf_resumenMes_initTemplate_byKey_ === 'function') {
      gf_resumenMes_initTemplate_byKey_(templateKey);
    } else if (typeof gf_resumenMes_initTemplate_ === 'function') {
      gf_resumenMes_initTemplate_();
    }
    props.setProperty('GF_RESUMEN_TEMPLATE_V', templateKey);
  }

  gf_buildResumenMes_lite_(mes);
  if (typeof gf_resumenMes_borrarBordes_C1_J6_ === 'function') {
    gf_resumenMes_borrarBordes_C1_J6_();
  }
}

/** Alias por compatibilidad */
function gf_collectRawForResumenMes_(mesYYYYMM, start, end) {
  return gf_collectResumenMesItems_(mesYYYYMM, start, end);
}

function gf_buildResumenMes_lite_(mesYYYYMM) {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();

  const shR = ss.getSheetByName(GF.SHEET_RESUMEN) || ss.insertSheet(GF.SHEET_RESUMEN);
  shR.clear({ contentsOnly: true }); // conserva formatos del template

  const p = gf_parseMonth_(mesYYYYMM);
  const auditor = gf_isAuditorMode_();

  // Formatos variables (auditor: muestra 0 / normal: oculta 0)
  const fmtARS = auditor
    ? '"$" #,##0;"-$" #,##0;"$" 0;@'
    : '"$" #,##0;"-$" #,##0;;@';

  const fmtUSD = auditor
    ? '"USD" #,##0;"-USD" #,##0;"USD" 0;@'
    : '"USD" #,##0;"-USD" #,##0;;@';

  // TC ref (último del mes o último disponible)
  const tcRef = Number(gf_lookupTCPorMes_(mesYYYYMM)) || 1;

  // 1) Raw - ADAPTADO AL NUEVO MODELO
  const raw = gf_collectResumenMesItems_(mesYYYYMM, p.start, p.end);

  // 2) Ingresos / Gastos
  const ingresos = raw.filter(x => (x.tipo || '').toString().trim() === 'Ingreso');
  const gastos   = raw.filter(x => (x.tipo || '').toString().trim() !== 'Ingreso');

  const normMon = m => ((m || '').toString().toUpperCase().trim() === 'USD') ? 'USD' : 'ARS';

  // Totales ingresos + por persona
  let totalIngArs = 0, totalIngUsd = 0;
  const byPersona = new Map();
  for (const i of ingresos) {
    const mon = normMon(i.mon);
    const monto = Number(i.monto) || 0;
    if (!monto) continue;

    if (mon === 'USD') totalIngUsd += monto; else totalIngArs += monto;

    const persona = (i.persona || 'Sin persona').toString().trim() || 'Sin persona';
    const cur = byPersona.get(persona) || { ars:0, usd:0 };
    if (mon === 'USD') cur.usd += monto; else cur.ars += monto;
    byPersona.set(persona, cur);
  }

  const totalIngArsEq = totalIngArs + totalIngUsd * tcRef;
  const totalIngUsdEq = totalIngUsd + (tcRef ? totalIngArs / tcRef : 0);

  // Totales gastos
  let totalGasArs = 0, totalGasUsd = 0;
  for (const g of gastos) {
    const mon = normMon(g.mon);
    const monto = Number(g.monto) || 0;
    if (!monto) continue;
    if (mon === 'USD') totalGasUsd += monto; else totalGasArs += monto;
  }

  const totalGasArsEq = totalGasArs + totalGasUsd * tcRef;
  const totalGasUsdEq = totalGasUsd + (tcRef ? totalGasArs / tcRef : 0);

  const netArsEq = totalIngArsEq - totalGasArsEq;
  const netUsdEq = totalIngUsdEq - totalGasUsdEq;

  // 3) Bancos (canónicos Fase 2.1)
  const BANK_BBVA = 'BBVA';
  const BANK_EFEC = 'Efectivo';
  const BANK_GAL  = 'Galicia';
  const BANK_PP   = 'Personal Pay';

  const bancosReconocidos = [BANK_EFEC, BANK_BBVA, BANK_GAL, BANK_PP];
  const bankMap = new Map(bancosReconocidos.map(b => [gf_norm_(b), b]));

  // 4) Agregación día
  const yyyymmdd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  const bankArs = new Map(); // yyyy-mm-dd|Banco -> ars
  const bankUsd = new Map(); // yyyy-mm-dd|Banco -> usd
  const dayArs  = new Map(); // yyyy-mm-dd -> ars
  const dayUsd  = new Map(); // yyyy-mm-dd -> usd

  for (const g of gastos) {
    if (!g.fecha) continue;

    const mon = normMon(g.mon);
    const monto = Number(g.monto) || 0;
    if (!monto) continue;

    const kDay = yyyymmdd(g.fecha);

    const bNorm = gf_norm_((g.banco || '').toString().trim());
    const bDisp = bankMap.get(bNorm);

    if (mon === 'USD') {
      dayUsd.set(kDay, (dayUsd.get(kDay) || 0) + monto);
      if (bDisp) {
        const k = `${kDay}|${bDisp}`;
        bankUsd.set(k, (bankUsd.get(k) || 0) + monto);
      }
    } else {
      dayArs.set(kDay, (dayArs.get(kDay) || 0) + monto);
      if (bDisp) {
        const k = `${kDay}|${bDisp}`;
        bankArs.set(k, (bankArs.get(k) || 0) + monto);
      }
    }
  }

  // 5) Layout (valores)
  shR.getRange('A1').setValue(`Resumen ${mesYYYYMM}`);
  shR.getRange('A2').setValue('TC ref (MEP Bolsa)');
  shR.getRange('B2').setValue(tcRef);
  shR.getRange('B2').setNumberFormat('#,##0.00');

  // Exacto como el original: banner sin fecha vacío
  shR.getRange('A4').clearContent();

  // Ingresos
  shR.getRange('C2').setValue('Ingresos del mes');
  shR.getRange(3,3,1,5).setValues([['Persona','Total ($)','Total (USD)','Total ($ eq)','Total (USD eq)']]);

  const personas = Array.from(byPersona.keys()).sort((a,b)=>a.localeCompare(b));
  const incomeRows = personas.map(pers => {
    const v = byPersona.get(pers);
    const arsEq = (v.ars || 0) + (v.usd || 0) * tcRef;
    const usdEq = (v.usd || 0) + (tcRef ? (v.ars || 0) / tcRef : 0);
    return [pers, v.ars || 0, v.usd || 0, arsEq, usdEq];
  });
  if (incomeRows.length) shR.getRange(4,3,incomeRows.length,5).setValues(incomeRows);

  if (incomeRows.length) {
    shR.getRange(4,4,incomeRows.length,1).setNumberFormat(fmtARS);
    shR.getRange(4,5,incomeRows.length,1).setNumberFormat(fmtUSD);
    shR.getRange(4,6,incomeRows.length,1).setNumberFormat(fmtARS);
    shR.getRange(4,7,incomeRows.length,1).setNumberFormat(fmtUSD);
  }

  // Cards H1:J4 (columna G queda libre para tabla de ingresos por persona)
  shR.getRange('H1').setValue('Total ingresos ($ eq)');
  shR.getRange('I1').setValue('Total gastos ($ eq)');
  shR.getRange('J1').setValue('Neto ($ eq)');
  shR.getRange('H2').setValue(totalIngArsEq);
  shR.getRange('I2').setValue(totalGasArsEq);
  shR.getRange('J2').setValue(netArsEq);

  shR.getRange('H3').setValue('Total ingresos (USD eq)');
  shR.getRange('I3').setValue('Total gastos (USD eq)');
  shR.getRange('J3').setValue('Neto (USD eq)');
  shR.getRange('H4').setValue(totalIngUsdEq);
  shR.getRange('I4').setValue(totalGasUsdEq);
  shR.getRange('J4').setValue(netUsdEq);

  shR.getRange('H2:J2').setNumberFormat(fmtARS);
  shR.getRange('H4:J4').setNumberFormat(fmtUSD);

  // KPI extra: Pesos disponibles / Faltante (USD)
  const pesosDisponibles = totalIngArs;
  const faltanteUsd = tcRef ? ((pesosDisponibles - totalGasArs) / tcRef) : 0;

  shR.getRange('K1').setValue('Pesos disponibles ($)');
  shR.getRange('K2').setValue(pesosDisponibles).setNumberFormat(fmtARS);

  shR.getRange('L1').setValue('Faltante (USD)');
  shR.getRange('L2').setValue(faltanteUsd).setNumberFormat(fmtUSD);

  const posColor = '#86EFAC';
  const negColor = '#F87171';
  shR.getRange('J2').setFontColor(netArsEq >= 0 ? posColor : negColor);
  shR.getRange('J4').setFontColor(netUsdEq >= 0 ? posColor : negColor);
  shR.getRange('L2').setFontColor(faltanteUsd >= 0 ? posColor : negColor);

  // 6) Tabla diaria (A:L)
  const headerRow = 6;
  const firstDayRow = 7;

  // Columnas (1-based)
  const colDate      = 1;   // A
  const colDiaTxt    = 2;   // B
  const colBBVA_ARS  = 3;   // C
  const colBBVA_USD  = 4;   // D
  const colGAL_ARS   = 5;   // E
  const colGAL_USD   = 6;   // F
  const colPP_ARS    = 7;   // G
  const colEFEC_ARS  = 8;   // H
  const colTotal_ARS = 9;   // I
  const colDiaNum    = 10;  // J
  const colTotal_USD = 11;  // K
  const colUsdEq     = 12;  // L
  const colCum       = 13;  // M helper acumulado (oculto)

  const headers = [
    'Fecha','Día',
    'BBVA ($)','BBVA (USD)',
    'Galicia ($)','Galicia (USD)',
    'Personal Pay ($)',
    'Efectivo ($)',
    'Total día ($)',
    'Dia',
    'Total día (USD)',
    'Total (USD eq)'
  ];
  shR.getRange(headerRow, 1, 1, headers.length).setValues([headers]);

  const dayRows = [];

  let totBBVA_ARS = 0, totBBVA_USD = 0;
  let totGAL_ARS  = 0, totGAL_USD  = 0;
  let totPP_ARS   = 0;
  let totEFEC_ARS = 0;

  let maxUsdEq = -1;
  let peakRow = -1;

  for (let d = 1; d <= p.daysInMonth; d++) {
    const date = new Date(p.year, p.month0, d);
    const kDay = yyyymmdd(date);

    const bbvaArs = bankArs.get(`${kDay}|${BANK_BBVA}`) || 0;
    const bbvaUsd = bankUsd.get(`${kDay}|${BANK_BBVA}`) || 0;

    const galArs  = bankArs.get(`${kDay}|${BANK_GAL}`)  || 0;
    const galUsd  = bankUsd.get(`${kDay}|${BANK_GAL}`)  || 0;

    const ppArs   = bankArs.get(`${kDay}|${BANK_PP}`)   || 0;
    const efecArs = bankArs.get(`${kDay}|${BANK_EFEC}`) || 0;

    totBBVA_ARS += bbvaArs; totBBVA_USD += bbvaUsd;
    totGAL_ARS  += galArs;  totGAL_USD  += galUsd;
    totPP_ARS   += ppArs;
    totEFEC_ARS += efecArs;

    const arsTotal = (dayArs.get(kDay) || 0);
    const usdTotal = (dayUsd.get(kDay) || 0);
    const usdEq = usdTotal + (tcRef ? (arsTotal / tcRef) : 0);

    const line = [
      date,
      gf_dayNameEs_(date, tz),
      bbvaArs,
      bbvaUsd,
      galArs,
      galUsd,
      ppArs,
      efecArs,
      arsTotal,
      d,
      usdTotal,
      usdEq
    ];

    if (usdEq > maxUsdEq) {
      maxUsdEq = usdEq;
      peakRow = firstDayRow + (d - 1);
    }

    dayRows.push(line);
  }

  if (dayRows.length) {
    shR.getRange(firstDayRow, 1, dayRows.length, headers.length).setValues(dayRows);
  }

  // TOTAL MES
  const totalRow = firstDayRow + p.daysInMonth;
  const totalLine = [
    'TOTAL MES','',
    totBBVA_ARS, totBBVA_USD,
    totGAL_ARS,  totGAL_USD,
    totPP_ARS,
    totEFEC_ARS,
    totalGasArs,
    '',
    totalGasUsd,
    totalGasUsdEq
  ];
  shR.getRange(totalRow, 1, 1, headers.length).setValues([totalLine]);
  // Apéndice: detalle de efectivo del mes (Fase 2.1.bis)
  gf_appendDetalleEfectivo_(shR, mesYYYYMM, totalRow + 3);
  // Formatos numéricos (variables)
  shR.getRange(firstDayRow, colDate, p.daysInMonth, 1).setNumberFormat('dd/MM');

  shR.getRange(firstDayRow, colBBVA_ARS,  p.daysInMonth + 1, 1).setNumberFormat(fmtARS);
  shR.getRange(firstDayRow, colGAL_ARS,   p.daysInMonth + 1, 1).setNumberFormat(fmtARS);
  shR.getRange(firstDayRow, colPP_ARS,    p.daysInMonth + 1, 1).setNumberFormat(fmtARS);
  shR.getRange(firstDayRow, colEFEC_ARS,  p.daysInMonth + 1, 1).setNumberFormat(fmtARS);
  shR.getRange(firstDayRow, colTotal_ARS, p.daysInMonth + 1, 1).setNumberFormat(fmtARS);

  shR.getRange(firstDayRow, colBBVA_USD,  p.daysInMonth + 1, 1).setNumberFormat(fmtUSD);
  shR.getRange(firstDayRow, colGAL_USD,   p.daysInMonth + 1, 1).setNumberFormat(fmtUSD);
  shR.getRange(firstDayRow, colTotal_USD, p.daysInMonth + 1, 1).setNumberFormat(fmtUSD);
  shR.getRange(firstDayRow, colUsdEq,     p.daysInMonth + 1, 1).setNumberFormat(fmtUSD);

  shR.getRange(firstDayRow, colDiaNum, p.daysInMonth, 1).setNumberFormat('0');

  // ===== Variables visuales exactas del original =====
  shR.showColumns(colCum);
  const cumVals = [];
  let run = 0;
  for (let i = 0; i < p.daysInMonth; i++) {
    const usdEq = Number(dayRows[i][11]) || 0;
    run += usdEq;
    cumVals.push([run]);
  }
  if (cumVals.length) {
    shR.getRange(firstDayRow, colCum, cumVals.length, 1).setValues(cumVals);
    shR.getRange(firstDayRow, colCum, cumVals.length, 1).setNumberFormat(fmtUSD);
  }
  shR.hideColumns(colCum);

  const heatRangeArs = shR.getRange(firstDayRow, colTotal_ARS, p.daysInMonth, 1);
  const heatA1Ars = heatRangeArs.getA1Notation();

  const heatRangeUsdEq = shR.getRange(firstDayRow, colUsdEq, p.daysInMonth, 1);
  const heatA1UsdEq = heatRangeUsdEq.getA1Notation();

  let rules = shR.getConditionalFormatRules() || [];
  rules = rules.filter(rule => {
    const rs = rule.getRanges().map(r => r.getA1Notation());
    if (rs.length !== 1) return true;
    return (rs[0] !== heatA1Ars && rs[0] !== heatA1UsdEq);
  });

  const heatRuleArs = SpreadsheetApp.newConditionalFormatRule()
    .setRanges([heatRangeArs])
    .setGradientMinpoint('#FFFFFF')
    .setGradientMaxpoint('#FDBA74')
    .build();

  const heatRuleUsdEq = SpreadsheetApp.newConditionalFormatRule()
    .setRanges([heatRangeUsdEq])
    .setGradientMinpoint('#FFFFFF')
    .setGradientMaxpoint('#FCA5A5')
    .build();

  rules.unshift(heatRuleUsdEq);
  rules.unshift(heatRuleArs);
  shR.setConditionalFormatRules(rules);

  if (peakRow >= firstDayRow) {
    shR.getRange(peakRow, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBorder(true, true, true, true, false, false, '#F59E0B', SpreadsheetApp.BorderStyle.SOLID_THICK);
  }

  // Ocultar días sin movimientos (solo si NO auditor) — no ocultar HOY
  shR.showRows(firstDayRow, p.daysInMonth);

  const today = new Date();
  const isSameMonth = (today.getFullYear() === p.year && today.getMonth() === p.month0);
  const todayDay = isSameMonth ? today.getDate() : -1;

  if (!auditor) {
    const rowsToHide = [];
    const EPS = 1e-9;

    for (let i = 0; i < p.daysInMonth; i++) {
      const row = dayRows[i];
      const dayNum = i + 1;
      if (dayNum === todayDay) continue;

      let hasMovement = false;
      const moneyIdx = [2,3,4,5,6,7,8,10,11];
      for (const j of moneyIdx) {
        const v = Number(row[j]) || 0;
        if (Math.abs(v) > EPS) { hasMovement = true; break; }
      }

      if (!hasMovement) rowsToHide.push(firstDayRow + i);
    }

    if (rowsToHide.length) {
      let start = rowsToHide[0];
      let prev = rowsToHide[0];
      for (let k = 1; k < rowsToHide.length; k++) {
        const cur = rowsToHide[k];
        if (cur === prev + 1) prev = cur;
        else { shR.hideRows(start, prev - start + 1); start = prev = cur; }
      }
      shR.hideRows(start, prev - start + 1);
    }
  }

  // Resaltar HOY exacto como el original
  if (isSameMonth && todayDay >= 1 && todayDay <= p.daysInMonth) {
    const r = firstDayRow + (todayDay - 1);
    const rngHoy = shR.getRange(r, 1, 1, headers.length);

    rngHoy
      .setBackground('#DBEAFE')
      .setFontWeight('bold')
      .setFontSize(12);

    rngHoy.getCell(1, colDiaNum).setFontSize(14);
  }
}

/**************************************
 * DATASET
 * SOLO Historico + FlagResumenMes = true
 **************************************/
function gf_collectResumenMesItems_(mesYYYYMM, start, end) {
  const ss = SpreadsheetApp.getActive();
  const shH = ss.getSheetByName(GF.SHEET_HIST);
  if (!shH) return [];

  const t = gf_readSheet_(shH);
  const idx = gf_buildIdx_(t.headers);

  const iTipo = idx[gf_norm_('Tipo')];
  const iFecha = idx[gf_norm_('Fecha')];
  const iMes = idx[gf_norm_('Mes')];
  const iPersona = idx[gf_norm_('Persona')];
  const iBanco = idx[gf_norm_('Banco')];
  const iMon = idx[gf_norm_('Moneda')];
  const iMonto = idx[gf_norm_('Monto')];
  const iFlagResumen = idx[gf_norm_('FlagResumenMes')];
  const iEstado = idx[gf_norm_('EstadoRegistro')];

  const out = [];

  t.rows.forEach(r => {
    if (iEstado != null) {
      const estado = String(r[iEstado] || '').trim();
      if (estado === 'Archivado') return;
    }

    if (iFlagResumen != null && !gf_boolOrDefault_(r[iFlagResumen], false)) return;

    const fecha = iFecha != null ? r[iFecha] : null;
    const mesRow = iMes != null ? String(r[iMes] || '').trim() : '';

    const inMonth =
      (fecha instanceof Date && fecha >= start && fecha < end) ||
      (mesRow === mesYYYYMM);

    if (!inMonth) return;

    const monto = Number(iMonto != null ? r[iMonto] : 0) || 0;
    if (!monto) return;

    out.push({
      tipo: iTipo != null ? r[iTipo] : 'Gasto',
      fecha: fecha instanceof Date ? fecha : null,
      persona: iPersona != null ? r[iPersona] : '',
      banco: iBanco != null ? r[iBanco] : '',
      mon: iMon != null ? r[iMon] : 'ARS',
      monto
    });
  });

  return out;
}

/**************************************
 * HELPERS LOCALES
 **************************************/
function gf_dayNameEs_(date, tz) {
  const wd = Number(Utilities.formatDate(date, tz, 'u'));
  const names = ['lun','mar','mié','jue','vie','sáb','dom'];
  return names[(wd >= 1 && wd <= 7) ? wd - 1 : 0];
}

function gf_isAuditorMode_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_CONFIG);
  if (!sh) return false;

  const v = sh.getRange('B8').getValue();
  if (v === true) return true;
  if (v === false || v == null) return false;

  const s = String(v).trim().toLowerCase();
  return ['si','sí','true','verdadero','1','auditor','audit','on'].includes(s);
}

function gf_resumenMes_borrarBordes_C1_J6_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_RESUMEN);
  if (!sh) throw new Error('No existe la hoja "ResumenMes".');
  sh.getRange('C1:J6').setBorder(false, false, false, false, false, false);
}

/**
 * Apéndice: detalle de gastos en efectivo del mes.
 * Filtra Historico por Banco='Efectivo' y Mes=mesYYYYMM.
 * Devuelve la última fila escrita (para que el caller sepa dónde seguir).
 *
 * Layout: empieza en startRow, ocupa columnas A:C
 *   Fila startRow:    título "GASTOS EN EFECTIVO - DETALLE"  + total a la derecha
 *   Fila startRow+1:  headers "Día | Descripción | Monto"
 *   Fila startRow+2 en adelante: una fila por gasto
 *   Fila final:       "TOTAL" + suma
 */
function gf_appendDetalleEfectivo_(shR, mesYYYYMM, startRow) {
  const ss = SpreadsheetApp.getActive();
  const shH = ss.getSheetByName(GF.SHEET_HIST);
  if (!shH || shH.getLastRow() < 2) return startRow;

  const headers = shH.getRange(1, 1, 1, shH.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach((h, i) => { idx[String(h).trim()] = i; });

  const need = ['Banco','Fecha','Descripción','Monto','Moneda','Tipo','FlagResumenMes','EstadoRegistro'];
  for (const c of need) {
    if (idx[c] === undefined) {
      Logger.log('gf_appendDetalleEfectivo_: falta columna ' + c);
      return startRow;
    }
  }

  // Parseo del mes pedido
  const [year, month1] = mesYYYYMM.split('-').map(Number);
  const month0 = month1 - 1;

  const data = shH.getRange(2, 1, shH.getLastRow() - 1, shH.getLastColumn()).getValues();

  // Filtrado: Banco='Efectivo' exacto + Tipo='Gasto' + Fecha en el mes pedido + ARS
  const filas = [];
  for (const row of data) {
    const banco = String(row[idx['Banco']] || '').trim();
    if (banco !== 'Efectivo') continue;

    const tipo = String(row[idx['Tipo']] || '').trim();
    if (tipo && tipo !== 'Gasto') continue;

    const fecha = row[idx['Fecha']];
    if (!(fecha instanceof Date)) continue;
    if (fecha.getFullYear() !== year || fecha.getMonth() !== month0) continue;

    const moneda = String(row[idx['Moneda']] || 'ARS').trim().toUpperCase();
    if (moneda !== 'ARS') continue; // efectivo en USD: lo ignoramos por ahora

    const estado = String(row[idx['EstadoRegistro']] || '').trim();
    if (estado === 'Archivado') continue;
    if (!gf_boolOrDefault_(row[idx['FlagResumenMes']], false)) continue;

    const monto = Number(row[idx['Monto']]) || 0;
    if (!monto) continue;

    filas.push({
      fecha: fecha,
      desc:  String(row[idx['Descripción']] || '').trim() || '(sin descripción)',
      monto: monto
    });
  }

  // Ordenar por fecha ascendente
  filas.sort((a, b) => a.fecha - b.fecha);

  const total = filas.reduce((acc, r) => acc + r.monto, 0);
  const fmtARS = '"$"#,##0';

  // Limpiar el rango previo del detalle (por si quedó de una corrida anterior)
  // Limpio desde startRow hasta el final de la hoja, columnas A:C
  const maxRow = shR.getMaxRows();
  if (startRow <= maxRow) {
    shR.getRange(startRow, 1, maxRow - startRow + 1, 3).clearContent().clearFormat();
  }

  // Título
  let r = startRow;
  shR.getRange(r, 1).setValue('GASTOS EN EFECTIVO - DETALLE')
    .setFontWeight('bold')
    .setBackground('#111827')
    .setFontColor('#FFFFFF');
  shR.getRange(r, 2).setBackground('#111827');
  shR.getRange(r, 3).setValue(total)
    .setNumberFormat(fmtARS)
    .setFontWeight('bold')
    .setBackground('#111827')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('right');
  r++;

  if (filas.length === 0) {
    shR.getRange(r, 1).setValue('(sin gastos en efectivo este mes)')
      .setFontStyle('italic')
      .setFontColor('#6B7280');
    return r;
  }

  // Headers
  shR.getRange(r, 1, 1, 3).setValues([['Día','Descripción','Monto']])
    .setFontWeight('bold')
    .setBackground(GF_THEME.headerBg)
    .setFontColor(GF_THEME.headerFg);
  r++;

  // Filas de detalle
  const tz = Session.getScriptTimeZone();
  const rows = filas.map(f => [
    Utilities.formatDate(f.fecha, tz, 'dd/MM'),
    f.desc,
    f.monto
  ]);
  shR.getRange(r, 1, rows.length, 3).setValues(rows);
  shR.getRange(r, 3, rows.length, 1).setNumberFormat(fmtARS);
  r += rows.length;

  // Línea TOTAL
  shR.getRange(r, 1).setValue('TOTAL').setFontWeight('bold');
  shR.getRange(r, 3).setValue(total)
    .setNumberFormat(fmtARS)
    .setFontWeight('bold')
    .setBorder(true, false, false, false, false, false);

  // Anchos
  shR.setColumnWidth(1, 70);
  shR.setColumnWidth(2, 320);
  shR.setColumnWidth(3, 130);

  return r;
}