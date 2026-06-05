var _GF_TC_CACHE_ = null;

/**
 * Carga TC_Diario una vez por ejecución y lo cachea.
 * Devuelve array de [[Date, tc], ...] (mismo shape que getValues).
 */
function gf_tc_cargarMapa_() {
  if (_GF_TC_CACHE_ !== null) return _GF_TC_CACHE_;
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(GF.SHEET_TC);
  if (!sh || sh.getLastRow() < 2) {
    _GF_TC_CACHE_ = [];
    return _GF_TC_CACHE_;
  }
  _GF_TC_CACHE_ = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  return _GF_TC_CACHE_;
}

function gf_fetchMEP_Bolsa_() {
  const url = 'https://dolarapi.com/v1/dolares/bolsa';
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Error HTTP ${code} al pedir MEP: ${resp.getContentText()}`);
  }

  const data = JSON.parse(resp.getContentText());
  const venta = Number(data.venta);
  if (!isFinite(venta) || venta <= 0) throw new Error('MEP inválido (venta)');

  return {
    tc: venta,
    fechaActualizacion: data.fechaActualizacion || ''
  };
}

/**
 * Trigger diario 09:00 (recomendado):
 * - Actualiza Config!B2 con el MEP
 * - Upsert diario en TC_Diario (por fecha)
 */
function gf_registrarTCMEP_enTablaDiaria_() {
  const ss = SpreadsheetApp.getActive();
  const shCfg = ss.getSheetByName(GF.SHEET_CONFIG) || gf_getOrCreateSheet_(ss, GF.SHEET_CONFIG);
  const sh = ss.getSheetByName(GF.SHEET_TC) || gf_getOrCreateSheet_(ss, GF.SHEET_TC);

  gf_ensureHeaders_(sh, ['Fecha','TC_USDARS','ActualizadoEn']);
  sh.setFrozenRows(1);

  const mep = gf_fetchMEP_Bolsa_();

  // Config
  shCfg.getRange(GF.CFG_TC_CELL).setValue(mep.tc);
  shCfg.getRange('A3').setValue('Última actualización TC').setFontWeight('bold');
  shCfg.getRange(GF.CFG_TC_TS_CELL).setValue(mep.fechaActualizacion || new Date());

  // Upsert en TC_Diario
  const now = new Date();
  const fecha = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // sin hora
  const lastRow = sh.getLastRow();

  let targetRow = lastRow + 1;
  if (lastRow >= 2) {
    const dates = sh.getRange(2,1,lastRow-1,1).getValues().flat();
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i];
      if (!(d instanceof Date)) continue;
      const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (dd.getTime() === fecha.getTime()) { targetRow = i + 2; break; }
    }
  }

  sh.getRange(targetRow,1,1,3).setValues([[fecha, mep.tc, new Date()]]);
  sh.getRange(2,1,Math.max(1,sh.getLastRow()-1),1).setNumberFormat('dd/MM/yyyy');
  sh.getRange(2,2,Math.max(1,sh.getLastRow()-1),1).setNumberFormat('#,##0');
}

/**
 * Asegura que exista TC_Diario con al menos 1 registro.
 * Si no existe o está vacío, intenta traer MEP y registrar.
 */
function gf_ensureTCDisponible_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_TC);
  if (sh && sh.getLastRow() >= 2) return;

  // si no hay datos, registramos ahora (pedirá permisos la primera vez)
  try {
    gf_registrarTCMEP_enTablaDiaria_();
  } catch (e) {
    // si falla, al menos dejamos Config!B2 con 1 para evitar crashes
    const shCfg = ss.getSheetByName(GF.SHEET_CONFIG) || gf_getOrCreateSheet_(ss, GF.SHEET_CONFIG);
    const v = Number(shCfg.getRange(GF.CFG_TC_CELL).getValue());
    if (!isFinite(v) || v <= 0) shCfg.getRange(GF.CFG_TC_CELL).setValue(1);
  }
}

/**
 * TC por fecha:
 * - exacto si existe
 * - si no existe, último anterior disponible
 * - fallback: Config!B2
 */
function gf_lookupTCPorFecha_(fecha) {
  const fallback = gf_getTCActualDesdeConfig_();
  const target = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  const vals = gf_tc_cargarMapa_();
  if (!vals.length) return fallback;
  let best = null;
  for (const [d, tc] of vals) {
    if (!(d instanceof Date)) continue;
    const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (dd.getTime() === target.getTime()) return Number(tc) || fallback;
    if (dd.getTime() < target.getTime()) best = Number(tc) || best;
  }
  return best || fallback;
}

/**
 * TC por mes (YYYY-MM):
 * - devuelve el TC del último día disponible dentro del mes
 * - si no hay registros en ese mes: último anterior al mes
 * - si el mes es futuro: último disponible
 */
function gf_lookupTCPorMes_(mesYYYYMM) {
  const fallback = gf_getTCActualDesdeConfig_();
  const { start, end } = gf_parseMonth_(mesYYYYMM);
  const vals = gf_tc_cargarMapa_();
  if (!vals.length) return fallback;
  let bestInMonth = null;
  let bestInMonthDate = null;

  let bestBefore = null;
  let bestBeforeDate = null;

  // también sirve para meses futuros: "bestBefore" termina siendo el último disponible
  for (const [d, tc] of vals) {
    if (!(d instanceof Date)) continue;
    const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const tcv = Number(tc);

    if (dd >= start && dd < end) {
      if (!bestInMonthDate || dd.getTime() > bestInMonthDate.getTime()) {
        bestInMonthDate = dd;
        bestInMonth = (isFinite(tcv) && tcv > 0) ? tcv : bestInMonth;
      }
    }
    if (dd < start) {
      if (!bestBeforeDate || dd.getTime() > bestBeforeDate.getTime()) {
        bestBeforeDate = dd;
        bestBefore = (isFinite(tcv) && tcv > 0) ? tcv : bestBefore;
      }
    }
    // si es futuro, el último registro total será el "bestBefore" respecto del start futuro
  }

  return bestInMonth || bestBefore || fallback;
}
function gf_getTCActualDesdeConfig_() {
  const ss = SpreadsheetApp.getActive();
  const shCfg = ss.getSheetByName(GF.SHEET_CONFIG);
  if (!shCfg) return 1;
  const tc = Number(shCfg.getRange(GF.CFG_TC_CELL).getValue());
  return (isFinite(tc) && tc > 0) ? tc : 1;
}
