/**************************************
 * 62_DashCache.gs - C14: Cache de Dashboard
 * Hoja Dash_Cache con JSON por celda, una fila por mes.
 * Invalidación: marca-y-delega (STALE). Recálculo lazy en próxima lectura.
 * Red de seguridad: trigger horario recalcula el mes en curso (C14.d).
 **************************************/

// ============ CACHE EN MEMORIA ============

var _GF_DASH_CACHE_MEM_ = null; // null = no cargado; Map<mesYYYYMM, cachedRow>

/**
 * Carga todas las filas de Dash_Cache en un Map en memoria.
 * Una sola lectura de hoja por ejecución (idempotente).
 */
function _gf_dashCache_loadAll_() {
  if (_GF_DASH_CACHE_MEM_ !== null) return _GF_DASH_CACHE_MEM_;
  _GF_DASH_CACHE_MEM_ = new Map();

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_DASH_CACHE);
  if (!sh || sh.getLastRow() < 2) return _GF_DASH_CACHE_MEM_;

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const all = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = all[0];
  const idx = {};
  headers.forEach(function(h, i) { idx[String(h || '').trim()] = i; });
  if (idx['Mes'] === undefined) return _GF_DASH_CACHE_MEM_;

  for (var i = 1; i < all.length; i++) {
    const row = all[i];
    const mesKey = String(row[idx['Mes']] || '').trim();
    if (!mesKey) continue;
    try {
      var kpisBlock = {}, byCat = [], bySubcat = [], byBanco = [], byDesc = [], byDia = [], indicadores = {}, insights = {};
      try { kpisBlock   = JSON.parse(String(row[idx['KpisJSON']]        || '{}') || '{}'); } catch(_) { continue; }
      try { byCat       = JSON.parse(String(row[idx['ByCatJSON']]       || '[]') || '[]'); } catch(_) {}
      try { bySubcat    = JSON.parse(String(row[idx['BySubcatJSON']]    || '[]') || '[]'); } catch(_) {}
      try { byBanco     = JSON.parse(String(row[idx['ByBancoJSON']]     || '[]') || '[]'); } catch(_) {}
      try { byDesc      = JSON.parse(String(row[idx['ByDescJSON']]      || '[]') || '[]'); } catch(_) {}
      try { byDia       = JSON.parse(String(row[idx['ByDiaJSON']]       || '[]') || '[]'); } catch(_) {}
      try { indicadores = JSON.parse(String(row[idx['IndicadoresJSON']] || '{}') || '{}'); } catch(_) {}
      try { insights    = JSON.parse(String(row[idx['InsightsJSON']]    || '{}') || '{}'); } catch(_) {}
      _GF_DASH_CACHE_MEM_.set(mesKey, {
        found:                 true,
        status:                String(row[idx['Status']] || '').trim(),
        updatedAt:             row[idx['UpdatedAt']],
        kpis:                  kpisBlock.kpis                  || {},
        tcRef:                 kpisBlock.tcRef                  || 1,
        promedioMes12GasArsEq: kpisBlock.promedioMes12GasArsEq || 0,
        prevMonth:             kpisBlock.prevMonth              || null,
        byCat:                 byCat,
        bySubcat:              bySubcat,
        byBanco:               byBanco,
        byDesc:                byDesc,
        byDia:                 byDia,
        indicadores:           indicadores,
        insights:              insights
      });
    } catch(_) {}
  }
  return _GF_DASH_CACHE_MEM_;
}

/** Invalida el cache en memoria. Llamar después de cualquier escritura en Dash_Cache. */
function gf_dashCache_invalidarMem_() {
  _GF_DASH_CACHE_MEM_ = null;
}

// ============ LECTURA ============

/**
 * Lee la fila de un mes de Dash_Cache desde el cache en memoria.
 * Una sola lectura de hoja por ejecución (cargada una vez por _gf_dashCache_loadAll_).
 * Devuelve { found, status, updatedAt, kpis, tcRef, promedioMes12GasArsEq,
 *            prevMonth, byCat, bySubcat, byBanco, byDesc, byDia, indicadores, insights }
 * Si no existe o hay JSON corrupto durante la carga, found: false.
 */
function gf_dashCache_leerMes_(mesYYYYMM) {
  const mesKey = String(mesYYYYMM || '').trim();
  if (!mesKey) return { found: false };
  const mem = _gf_dashCache_loadAll_();
  return mem.get(mesKey) || { found: false };
}

// ============ ESCRITURA ============

/**
 * Upsert de la fila del mes en Dash_Cache.
 * payload: objeto con kpis, tcRef, promedioMes12GasArsEq, prevMonth,
 *          byCat, bySubcat, byBanco, byDesc, byDia, indicadores, insights.
 * UpdatedAt = ahora, Status = 'FRESH'.
 * Una sola lectura para buscar la fila; una sola escritura.
 */
function gf_dashCache_guardarMes_(mesYYYYMM, payload) {
  const mesKey = String(mesYYYYMM || '').trim();
  if (!mesKey) throw new Error('gf_dashCache_guardarMes_: mesYYYYMM requerido');

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_DASH_CACHE);
  if (!sh) throw new Error('Hoja Dash_Cache no encontrada. Corré setupAll primero.');

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const all = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = all[0];
  const idx = {};
  headers.forEach(function(h, i) { idx[String(h || '').trim()] = i; });
  const ncols = headers.length;

  const kpisBlock = {
    kpis:                  payload.kpis                  || {},
    tcRef:                 payload.tcRef                  || 1,
    promedioMes12GasArsEq: payload.promedioMes12GasArsEq || 0,
    prevMonth:             payload.prevMonth              || null
  };

  const newRow = new Array(ncols).fill('');
  const set = function(col, val) { if (idx[col] !== undefined) newRow[idx[col]] = val; };
  set('Mes',              mesKey);
  set('UpdatedAt',        new Date());
  set('Status',           'FRESH');
  set('KpisJSON',         JSON.stringify(kpisBlock));
  set('ByCatJSON',        JSON.stringify(payload.byCat        || []));
  set('BySubcatJSON',     JSON.stringify(payload.bySubcat     || []));
  set('ByBancoJSON',      JSON.stringify(payload.byBanco      || []));
  set('ByDescJSON',       JSON.stringify(payload.byDesc       || []));
  set('ByDiaJSON',        JSON.stringify(payload.byDia        || []));
  set('IndicadoresJSON',  JSON.stringify(payload.indicadores  || {}));
  set('InsightsJSON',     JSON.stringify(payload.insights     || {}));

  const mesCol = (idx['Mes'] !== undefined) ? idx['Mes'] : 0;
  for (let i = 1; i < all.length; i++) {
    if (String(all[i][mesCol] || '').trim() === mesKey) {
      sh.getRange(i + 1, 1, 1, ncols).setValues([newRow]);
      Logger.log('[dashCache] guardarMes: ' + mesKey + ' → FRESH (update fila ' + (i + 1) + ')');
      gf_dashCache_invalidarMem_();
      return;
    }
  }

  sh.appendRow(newRow);
  Logger.log('[dashCache] guardarMes: ' + mesKey + ' → FRESH (insert)');
  gf_dashCache_invalidarMem_();
}

/**
 * Marca el mes (o array de meses) como STALE en Dash_Cache.
 * Si la fila no existe, no la crea. Fechas inválidas se ignoran silenciosamente.
 */
function gf_dashCache_marcarStale_(mesOArray) {
  const meses = Array.isArray(mesOArray) ? mesOArray : [mesOArray];
  const unicos = meses.filter(function(m, i, arr) {
    return m && String(m).trim() && arr.indexOf(m) === i;
  });
  if (!unicos.length) return;

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_DASH_CACHE);
  if (!sh || sh.getLastRow() < 2) return;

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const all = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = all[0];
  const idx = {};
  headers.forEach(function(h, i) { idx[String(h || '').trim()] = i; });
  const mesCol    = idx['Mes'];
  const statusCol = idx['Status'];
  if (mesCol === undefined || statusCol === undefined) return;

  for (let i = 1; i < all.length; i++) {
    const rowMes = String(all[i][mesCol] || '').trim();
    if (unicos.indexOf(rowMes) >= 0) {
      sh.getRange(i + 1, statusCol + 1).setValue('STALE');
      Logger.log('[dashCache] marcarStale: ' + rowMes + ' → STALE');
    }
  }
  gf_dashCache_invalidarMem_();
}

/**
 * Marca el mes como COMPUTING en Dash_Cache y actualiza UpdatedAt.
 * Idempotente. Si la fila no existe, no la crea.
 */
function gf_dashCache_marcarComputing_(mesYYYYMM) {
  const mesKey = String(mesYYYYMM || '').trim();
  if (!mesKey) return;

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_DASH_CACHE);
  if (!sh || sh.getLastRow() < 2) return;

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const all = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = all[0];
  const idx = {};
  headers.forEach(function(h, i) { idx[String(h || '').trim()] = i; });
  const mesCol       = idx['Mes'];
  const statusCol    = idx['Status'];
  const updatedAtCol = idx['UpdatedAt'];
  if (mesCol === undefined || statusCol === undefined) return;

  for (let i = 1; i < all.length; i++) {
    if (String(all[i][mesCol] || '').trim() !== mesKey) continue;
    sh.getRange(i + 1, statusCol + 1).setValue('COMPUTING');
    if (updatedAtCol !== undefined) {
      sh.getRange(i + 1, updatedAtCol + 1).setValue(new Date());
    }
    gf_dashCache_invalidarMem_();
    Logger.log('[dashCache] marcarComputing: ' + mesKey);
    return;
  }
}

// ============ CÁLCULO PURO ============

/**
 * Función pura: calcula el payload mensual leyendo Historico directamente.
 * No toca la cache. Misma lógica que gf_web_getDashMensualData_ (extraída).
 * Puede lanzar excepción — el caller debe envolverla en try/catch.
 * En C14.b, gf_web_getDashMensualData_ será refactorizada para llamar a esta.
 */
function gf_dash_calcularMensual_(mesYYYYMM) {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();

  const shCfg = ss.getSheetByName(GF.SHEET_CONFIG);
  const mesKey = mesYYYYMM
    || (shCfg ? gf_toYYYYMM_(shCfg.getRange(GF.CFG_MES_CELL).getValue(), tz) : null)
    || Utilities.formatDate(new Date(), tz, 'yyyy-MM');

  const p     = gf_parseMonth_(mesKey);
  const tcRef = Number(gf_lookupTCPorMes_(mesKey)) || 1;
  const items = gf_collectDetailedItemsForDashMensual_(mesKey, p.start, p.end);

  let ingArs = 0, ingUsd = 0, gasArs = 0, gasUsd = 0;
  const byCat    = new Map();
  const bySubcat = new Map();
  const byDesc   = new Map();
  const byBanco  = new Map();
  const byDia    = new Map();
  let cantMov = 0;
  let weekendGasArsEq = 0;
  let topMovArsEq = 0, topMovDesc = '', topMovMonto = 0, topMovMoneda = 'ARS';

  for (const it of items) {
    const isIngreso = (it.tipo || '').trim() === 'Ingreso';
    const arsEq = Number(it.arsEq) || 0;
    const usdEq = Number(it.usdEq) || 0;

    if (isIngreso) {
      ingArs += Number(it.arsRaw) || 0;
      ingUsd += Number(it.usdRaw) || 0;
      continue;
    }

    gasArs += Number(it.arsRaw) || 0;
    gasUsd += Number(it.usdRaw) || 0;
    cantMov++;

    const cat    = (it.categoria    || 'Sin categoría').toString().trim()    || 'Sin categoría';
    const subcat = (it.subcategoria || 'Sin subcategoría').toString().trim() || 'Sin subcategoría';
    const desc   = (it.descripcion  || 'Sin descripción').toString().trim()  || 'Sin descripción';
    const banco  = (it.banco        || 'Sin banco').toString().trim()        || 'Sin banco';

    const catCur = byCat.get(cat) || { cat, arsEq: 0, usdEq: 0, count: 0 };
    catCur.arsEq += arsEq; catCur.usdEq += usdEq; catCur.count++;
    byCat.set(cat, catCur);

    const subcatKey = cat + '|||' + subcat;
    const subcatCur = bySubcat.get(subcatKey) || { cat, subcat, arsEq: 0, usdEq: 0, count: 0 };
    subcatCur.arsEq += arsEq; subcatCur.usdEq += usdEq; subcatCur.count++;
    bySubcat.set(subcatKey, subcatCur);

    const descCur = byDesc.get(desc) || { desc, cat, arsEq: 0, usdEq: 0, count: 0 };
    descCur.arsEq += arsEq; descCur.usdEq += usdEq; descCur.count++;
    byDesc.set(desc, descCur);

    const bancoCur = byBanco.get(banco) || { banco, arsEq: 0, usdEq: 0, count: 0 };
    bancoCur.arsEq += arsEq; bancoCur.usdEq += usdEq; bancoCur.count++;
    byBanco.set(banco, bancoCur);

    if (it.fecha instanceof Date) {
      const kDay = Utilities.formatDate(it.fecha, tz, 'yyyy-MM-dd');
      const dayCur = byDia.get(kDay) || {
        key: kDay,
        fecha: Utilities.formatDate(it.fecha, tz, 'dd/MM'),
        dia: Number(Utilities.formatDate(it.fecha, tz, 'd')),
        dow: gf_web_weekdayShort_(it.fecha, tz),
        arsEq: 0, usdEq: 0, count: 0
      };
      dayCur.arsEq += arsEq;
      dayCur.usdEq += usdEq;
      dayCur.count++;
      byDia.set(kDay, dayCur);

      const wd = Number(Utilities.formatDate(it.fecha, tz, 'u'));
      if (wd > 5) weekendGasArsEq += arsEq;
    }

    if (arsEq > topMovArsEq) {
      topMovArsEq  = arsEq;
      topMovDesc   = desc;
      topMovMonto  = Number(it.monto) || 0;
      topMovMoneda = it.mon || 'ARS';
    }
  }

  const ingArsEq = ingArs + ingUsd * tcRef;
  const gasArsEq = gasArs + gasUsd * tcRef;
  const netArsEq = ingArsEq - gasArsEq;
  const ingUsdEq = ingUsd + (tcRef ? ingArs / tcRef : 0);
  const gasUsdEq = gasUsd + (tcRef ? gasArs / tcRef : 0);
  const netUsdEq = ingUsdEq - gasUsdEq;

  const byCatArr    = Array.from(byCat.values()).sort(function(a,b) { return b.arsEq - a.arsEq; });
  const topCat      = byCatArr.length ? byCatArr[0].cat : '';
  const byBancoArr  = Array.from(byBanco.values()).sort(function(a,b) { return b.arsEq - a.arsEq; });
  const topBanco    = byBancoArr.length ? byBancoArr[0].banco : '';
  const bySubcatArr = Array.from(bySubcat.values()).sort(function(a,b) { return b.arsEq - a.arsEq; });

  const promedioMes12GasArsEq = gf_web_promedioMes12Gas_(ss, tz, mesKey, tcRef);
  const byDiaArr  = gf_web_fillDashMonthDays_(p, byDia);
  const activeDays = byDiaArr.filter(function(r) { return Number(r.count || 0) > 0; }).length;
  const peakDay    = byDiaArr.reduce(function(best, row) {
    return (!best || row.arsEq > best.arsEq) ? row : best;
  }, null);

  const prevMesKey     = gf_web_previousMonthKey_(mesKey);
  const prev           = gf_web_getDashMonthCompare_(prevMesKey);
  const deltaPrevArsPct = prev.gasArsEq > 0 ? ((gasArsEq - prev.gasArsEq) / prev.gasArsEq) * 100 : null;
  const deltaPrevUsdPct = prev.gasUsdEq > 0 ? ((gasUsdEq - prev.gasUsdEq) / prev.gasUsdEq) * 100 : null;

  const top3CatArsEq   = byCatArr.slice(0, 3).reduce(function(acc, r) { return acc + Number(r.arsEq || 0); }, 0);
  const top3CatUsdEq   = byCatArr.slice(0, 3).reduce(function(acc, r) { return acc + Number(r.usdEq || 0); }, 0);
  const weekendSharePct = gasArsEq > 0 ? Math.round((weekendGasArsEq / gasArsEq) * 100) : 0;
  const avgDailyArsEq  = activeDays > 0 ? (gasArsEq / activeDays) : 0;
  const avgDailyUsdEq  = activeDays > 0 ? (gasUsdEq / activeDays) : 0;

  return {
    mes:        _pendMesLabel_(mesKey),
    mesYYYYMM:  mesKey,
    tcRef:      tcRef,
    kpis: {
      ingArsEq: ingArsEq, gasArsEq: gasArsEq, netArsEq: netArsEq,
      ingUsdEq: ingUsdEq, gasUsdEq: gasUsdEq, netUsdEq: netUsdEq
    },
    promedioMes12GasArsEq: promedioMes12GasArsEq,
    byCat:    byCatArr,
    bySubcat: bySubcatArr,
    byDesc:   Array.from(byDesc.values()).sort(function(a,b) { return b.arsEq - a.arsEq; }),
    byBanco:  byBancoArr,
    byDia:    byDiaArr,
    prevMonth: prev,
    insights: {
      activeDays:      activeDays,
      peakDayLabel:    peakDay ? (peakDay.fecha + ' · ' + peakDay.dow) : '',
      peakDayArsEq:    peakDay ? peakDay.arsEq : 0,
      peakDayUsdEq:    peakDay ? peakDay.usdEq : 0,
      deltaPrevArsPct: deltaPrevArsPct,
      deltaPrevUsdPct: deltaPrevUsdPct,
      weekendSharePct: weekendSharePct,
      top3CatArsPct:   gasArsEq > 0 ? Math.round((top3CatArsEq / gasArsEq) * 100) : 0,
      top3CatUsdPct:   gasUsdEq > 0 ? Math.round((top3CatUsdEq / gasUsdEq) * 100) : 0,
      avgDailyArsEq:   avgDailyArsEq,
      avgDailyUsdEq:   avgDailyUsdEq,
      balanceState:    netArsEq < 0 ? 'Mes en déficit' : 'Mes en superávit'
    },
    indicadores: {
      cantMov:      cantMov,
      topCat:       topCat,
      topBanco:     topBanco,
      topMovDesc:   topMovDesc,
      topMovMonto:  topMovMonto,
      topMovMoneda: topMovMoneda,
      activeDays:   activeDays
    }
  };
}

// ============ RECÁLCULO ============

/**
 * State machine: devuelve el payload del mes desde cache o lo recalcula.
 * FRESH        → retorna cache inmediatamente.
 * STALE        → recalcula y guarda (FRESH).
 * COMPUTING <60s → espera 1.5s y reintenta; si sigue ocupado devuelve cálculo live sin escribir.
 * COMPUTING ≥60s → asume caído, recalcula como STALE.
 * No encontrado  → recalcula.
 */
function gf_dashCache_getOrCalc_(mesYYYYMM) {
  const mesKey = String(mesYYYYMM || '').trim();
  const cached = gf_dashCache_leerMes_(mesKey);

  if (!cached.found) {
    Logger.log('[getOrCalc] ' + mesKey + ' → not found, recalcular');
    return gf_dashCache_recalcularMes_(mesKey);
  }

  if (cached.status === 'FRESH') {
    Logger.log('[getOrCalc] ' + mesKey + ' → FRESH cache hit');
    return cached;
  }

  if (cached.status === 'COMPUTING') {
    const ageMs = (cached.updatedAt instanceof Date)
      ? (Date.now() - cached.updatedAt.getTime())
      : Infinity;
    if (ageMs < 60000) {
      Logger.log('[getOrCalc] ' + mesKey + ' → COMPUTING (<60s), sleep+retry');
      Utilities.sleep(1500);
      gf_dashCache_invalidarMem_(); // forzar re-lectura de hoja tras el sleep
      const retry = gf_dashCache_leerMes_(mesKey);
      if (retry.found && retry.status === 'FRESH') {
        Logger.log('[getOrCalc] ' + mesKey + ' → retry FRESH');
        return retry;
      }
      // Otro proceso sigue computando → devolver cálculo live sin escribir cache
      Logger.log('[getOrCalc] ' + mesKey + ' → retry aún COMPUTING, cálculo live');
      return gf_dash_calcularMensual_(mesKey);
    }
    // COMPUTING viejo (≥60s, probablemente crasheó) → tratar como STALE
    Logger.log('[getOrCalc] ' + mesKey + ' → COMPUTING (≥60s), tratar como STALE');
  }

  // STALE (o status desconocido) → recalcular
  Logger.log('[getOrCalc] ' + mesKey + ' → ' + cached.status + ', recalcular');
  return gf_dashCache_recalcularMes_(mesKey);
}

// ============ ENTRYPOINTS PÚBLICOS ============

/**
 * Calcula todos los meses presentes en Historico (orden cronológico ascendente)
 * y los guarda en Dash_Cache. Salta los meses que ya estén FRESH.
 * Nota: los primeros 12 meses tendrán promedioMes12 aproximado si no hay historial
 * previo en cache. Para exactitud en esos meses, ejecutar dos veces.
 */
function gf_dashCache_backfillTodo_() {
  const ss = SpreadsheetApp.getActive();
  const shH = ss.getSheetByName(GF.SHEET_HIST);
  if (!shH || shH.getLastRow() < 2) {
    Logger.log('[backfillTodo] Historico vacío');
    ss.toast('Historico vacío, nada que calcular.', 'C14 Backfill', 5);
    return { ok: true, procesados: 0, saltados: 0, errores: 0 };
  }

  const headers = shH.getRange(1, 1, 1, shH.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach(function(h, i) { idx[String(h).trim()] = i; });
  const iMes = idx['Mes'];
  if (iMes === undefined) {
    const err = 'Columna Mes no encontrada en Historico';
    Logger.log('[backfillTodo] ' + err);
    ss.toast(err, 'C14 Backfill', 5);
    return { ok: false, error: err };
  }

  const data = shH.getRange(2, 1, shH.getLastRow() - 1, iMes + 1).getValues();
  const mesesSet = new Set();
  data.forEach(function(row) {
    const mes = String(row[iMes] || '').trim();
    if (/^\d{4}-\d{2}$/.test(mes)) mesesSet.add(mes);
  });

  const meses = Array.from(mesesSet).sort(); // viejo → nuevo (para que promedio12 use cache de meses anteriores)
  Logger.log('[backfillTodo] ' + meses.length + ' meses distintos en Historico');

  var procesados = 0, saltados = 0, errores = 0;
  for (var mi = 0; mi < meses.length; mi++) {
    const mes = meses[mi];
    const cached = gf_dashCache_leerMes_(mes);
    if (cached.found && cached.status === 'FRESH') {
      saltados++;
      continue;
    }
    try {
      gf_dashCache_recalcularMes_(mes);
      procesados++;
    } catch(e) {
      Logger.log('[backfillTodo] ERROR en ' + mes + ': ' + e);
      errores++;
    }
  }

  const msg = 'Backfill: ' + procesados + ' calculados, ' + saltados + ' ya frescos, ' + errores + ' errores';
  Logger.log('[backfillTodo] ' + msg);
  ss.toast(msg, 'C14 Backfill', 10);
  return { ok: true, procesados: procesados, saltados: saltados, errores: errores };
}

/**
 * Menú: [C14] Recalcular cache mes actual.
 * Calcula el mes calendario actual y lo guarda en Dash_Cache.
 * C14.d reemplazará esto con un refresh de los últimos 13 meses + confirm dialog.
 */
function gf_dashCache_recalcularMesActual_menu_() {
  const ss = SpreadsheetApp.getActive();
  const mes = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM');
  const t0 = Date.now();
  try {
    gf_dashCache_recalcularMes_(mes);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    ss.toast('Dash_Cache actualizado: ' + mes + ' (' + elapsed + 's)', 'C14', 5);
  } catch(e) {
    SpreadsheetApp.getUi().alert('Error al recalcular cache:\n' + e.message);
  }
}

/**
 * Recalcula un mes desde Historico y guarda el resultado en Dash_Cache.
 * Marca COMPUTING antes de calcular, FRESH al guardar.
 * Devuelve el payload calculado.
 */
function gf_dashCache_recalcularMes_(mesYYYYMM) {
  const mesKey = String(mesYYYYMM || '').trim();
  Logger.log('[dashCache] recalcularMes: inicio ' + mesKey);

  try { gf_dashCache_marcarComputing_(mesKey); } catch(e) {
    Logger.log('[dashCache] marcarComputing falló (no crítico): ' + e);
  }

  const payload = gf_dash_calcularMensual_(mesKey);
  gf_dashCache_guardarMes_(mesKey, payload);
  Logger.log('[dashCache] recalcularMes: fin ' + mesKey);
  return payload;
}
