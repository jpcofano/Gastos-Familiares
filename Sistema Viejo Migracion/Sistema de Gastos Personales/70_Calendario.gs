/**************************************
 * 70_Calendario.gs
 * CALENDAR - Recordatorios de pago
 * - Lee Historico
 * - Usa Pagado para borrar/crear eventos
 * - Usa Config!B4:B7
 * - Soporta schema nuevo
 **************************************/

/**************************************
 * PÚBLICAS / MENÚ
 **************************************/

function gf_calendar_syncRecordatoriosMes_() {
  const res = gf_calendar_syncPagosMes_silent_();
  SpreadsheetApp.getUi().alert(
    `Calendar: ${res.creados} creados, ${res.actualizados} actualizados, ${res.borrados} borrados, ${res.saltados} saltados.`
  );
  return res;
}

function gf_calendar_syncRecordatoriosMes_silent_() {
  return gf_calendar_syncPagosMes_silent_();
}

function gf_calendar_syncPagosMes_() {
  const res = gf_calendar_syncPagosMes_silent_();
  SpreadsheetApp.getUi().alert(
    `Calendar: ${res.creados} creados, ${res.actualizados} actualizados, ${res.borrados} borrados, ${res.saltados} saltados.`
  );
  return res;
}

/**************************************
 * SYNC PRINCIPAL
 **************************************/

function gf_calendar_syncPagosMes_silent_() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();

  const STEP_MIN = 15;
  const dayOffset = new Map();

  const shCfg = ss.getSheetByName(GF.SHEET_CONFIG);
  const shHist = ss.getSheetByName(GF.SHEET_HIST);

  if (!shCfg || !shHist) throw new Error('Falta Config o Historico.');

  const mes = gf_toYYYYMM_(shCfg.getRange(GF.CFG_MES_CELL).getValue(), tz);
  if (!mes) throw new Error('Config!B1 inválido. Usá YYYY-MM o una fecha del mes.');

  const calCfg = gf_calendar_getCfg_();
  const cal = calCfg.calendarId
    ? CalendarApp.getCalendarById(calCfg.calendarId)
    : CalendarApp.getDefaultCalendar();

  if (!cal) throw new Error('No pude acceder al calendario (revisá Config!B4).');

  const rows = gf_calendar_collectRowsForMes_(mes);

  let creados = 0;
  let actualizados = 0;
  let borrados = 0;
  let saltados = 0;

  rows.forEach(row => {
    const fecha = row.fecha;
    if (!(fecha instanceof Date)) {
      saltados++;
      return;
    }

    const key = gf_calendar_key_(row.id, fecha);
    const baseStart = gf_calendar_atHHMM_(fecha, calCfg.hhmm);
    const existing = gf_calendar_findEventByKey_(cal, baseStart, key);

    // pagado => borrar si existe
    if (row.pagado) {
      if (existing) {
        existing.deleteEvent();
        borrados++;
      }
      return;
    }

    const dayKey = gf_yyyymmdd_safe_(fecha);
    const slot = dayOffset.get(dayKey) || 0;
    const start = new Date(baseStart.getTime() + slot * STEP_MIN * 60000);
    const end = new Date(start.getTime() + calCfg.durationMin * 60000);
    dayOffset.set(dayKey, slot + 1);

    const title = gf_calendar_buildTitle_(row.descripcion, row.banco, row.moneda, row.monto);
    const description = gf_calendar_buildDescription_({
      key,
      mes: row.mes,
      id: row.id,
      desc: row.descripcion,
      banco: row.banco,
      mon: row.moneda,
      monto: row.monto,
      fecha,
      tz,
      persona: row.persona,
      subtipo: row.subtipo,
      categoria: row.categoria,
      notas: row.notas
    });

    if (existing) {
      existing.setTitle(title);
      existing.setTime(start, end);
      existing.setDescription(description);
      gf_calendar_applyReminders_(existing, calCfg.popupMin);
      actualizados++;
    } else {
      const ev = cal.createEvent(title, start, end, { description });
      gf_calendar_applyReminders_(ev, calCfg.popupMin);
      creados++;
    }
  });

  return { creados, actualizados, borrados, saltados };
}

/**************************************
 * DATASET CALENDAR
 **************************************/

function gf_calendar_collectRowsForMes_(mes) {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const shHist = ss.getSheetByName(GF.SHEET_HIST);
  if (!shHist) return [];

  const t = gf_readSheet_(shHist);
  const idx = gf_buildIdx_(t.headers);

  const iID = idx[gf_norm_('ID')];
  const iTipo = idx[gf_norm_('Tipo')];
  const iSubtipo = idx[gf_norm_('Subtipo')];
  const iFecha = idx[gf_norm_('Fecha')];
  const iMes = idx[gf_norm_('Mes')];
  const iDesc = idx[gf_norm_('Descripción')] ?? idx[gf_norm_('Descripcion')];
  const iBanco = idx[gf_norm_('Banco')];
  const iMon = idx[gf_norm_('Moneda')];
  const iMonto = idx[gf_norm_('Monto')];
  const iPagado = idx[gf_norm_('Pagado')];
  const iPersona = idx[gf_norm_('Persona')];
  const iCat = idx[gf_norm_('Categoría')] ?? idx[gf_norm_('Categoria')];
  const iNotas = idx[gf_norm_('Notas')];
  const iEstado = idx[gf_norm_('EstadoRegistro')];

  const rows = [];

  t.rows.forEach(r => {
    const tipo = String(iTipo != null ? (r[iTipo] || '') : '').trim();
    if (tipo !== 'Gasto') return;

    if (iEstado != null) {
      const estado = String(r[iEstado] || '').trim();
      if (estado === 'Archivado') return;
    }

    const fecha = iFecha != null ? r[iFecha] : null;
    const mesRow = iMes != null
      ? String(r[iMes] || '').trim()
      : (fecha instanceof Date ? Utilities.formatDate(fecha, tz, 'yyyy-MM') : '');

    if (!mesRow || mesRow !== mes) return;
    if (!(fecha instanceof Date)) return;

    const monto = Number(iMonto != null ? r[iMonto] : 0) || 0;
    if (!monto) return;

    const pagado = gf_boolOrDefault_(iPagado != null ? r[iPagado] : false, false);

    rows.push({
      id: String(iID != null ? (r[iID] || '') : '').trim() || gf_generateId_('NOID'),
      tipo,
      subtipo: String(iSubtipo != null ? (r[iSubtipo] || '') : '').trim(),
      fecha,
      mes: mesRow,
      descripcion: String(iDesc != null ? (r[iDesc] || '') : '').trim() || 'Pago',
      banco: String(iBanco != null ? (r[iBanco] || '') : '').trim(),
      moneda: gf_normMon_(iMon != null ? r[iMon] : 'ARS'),
      monto,
      pagado,
      persona: String(iPersona != null ? (r[iPersona] || '') : '').trim(),
      categoria: String(iCat != null ? (r[iCat] || '') : '').trim(),
      notas: String(iNotas != null ? (r[iNotas] || '') : '').trim()
    });
  });

  // orden estable: fecha + id
  rows.sort((a, b) => {
    const da = a.fecha ? a.fecha.getTime() : 0;
    const db = b.fecha ? b.fecha.getTime() : 0;
    if (da !== db) return da - db;
    return a.id.localeCompare(b.id);
  });

  return rows;
}

/**************************************
 * CONFIG CALENDAR
 **************************************/

function gf_calendar_getCfg_() {
  const ss = SpreadsheetApp.getActive();
  const shCfg = ss.getSheetByName(GF.SHEET_CONFIG);

  const calendarId = String(shCfg.getRange(GF.CFG_CAL_ID_CELL).getValue() || '').trim();
  const hhmm = String(shCfg.getRange(GF.CFG_CAL_HHMM_CELL).getValue() || '09:00').trim();
  const popupMin = Number(shCfg.getRange(GF.CFG_CAL_POPUP_CELL).getValue());
  const durationMin = Number(shCfg.getRange(GF.CFG_CAL_DUR_CELL).getValue());

  return {
    calendarId,
    hhmm: hhmm || '09:00',
    popupMin: (isFinite(popupMin) && popupMin >= 0) ? popupMin : 60,
    durationMin: (isFinite(durationMin) && durationMin > 0) ? durationMin : 10
  };
}

/**************************************
 * KEYS / TITLE / DESCRIPTION
 **************************************/

function gf_calendar_key_(id, fecha) {
  const idSafe = String(id || 'SINID').trim() || 'SINID';
  return `GF-PAGO|${idSafe}|${gf_yyyymmdd_safe_(fecha)}`;
}

function gf_calendar_buildTitle_(desc, banco, mon, monto) {
  const p1 = desc || 'Pago';
  const p2 = banco ? ` (${banco})` : '';
  const p3 = ` — ${mon} ${gf_fmtNumber_(monto)}`;
  return `💸 Pagar: ${p1}${p2}${p3}`;
}

function gf_calendar_buildDescription_(o) {
  const ss = SpreadsheetApp.getActive();
  const url = ss.getUrl();
  const f = Utilities.formatDate(o.fecha, o.tz, 'dd/MM/yyyy');

  return [
    `GF_EVENT_KEY: ${o.key}`,
    `Mes: ${o.mes || ''}`,
    `ID: ${o.id || ''}`,
    `Subtipo: ${o.subtipo || ''}`,
    `Persona: ${o.persona || ''}`,
    `Descripción: ${o.desc || ''}`,
    `Categoría: ${o.categoria || ''}`,
    `Banco: ${o.banco || ''}`,
    `Moneda: ${o.mon || ''}`,
    `Monto: ${o.mon} ${gf_fmtNumber_(o.monto)}`,
    `Fecha: ${f}`,
    `Notas: ${o.notas || ''}`,
    `Sheet: ${url}`
  ].join('\n');
}

/**************************************
 * BUSCAR / REMINDERS / FECHA-HORA
 **************************************/

function gf_calendar_findEventByKey_(cal, startDateTime, key) {
  const day = new Date(
    startDateTime.getFullYear(),
    startDateTime.getMonth(),
    startDateTime.getDate()
  );

  const events = cal.getEventsForDay(day);
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const desc = ev.getDescription() || '';
    if (desc.indexOf(`GF_EVENT_KEY: ${key}`) !== -1) return ev;
  }
  return null;
}

function gf_calendar_applyReminders_(event, popupMin) {
  try {
    const reminders = event.getPopupReminders();
    reminders.forEach(m => event.removeReminder(m));
  } catch (e) {}

  if (popupMin != null && isFinite(popupMin) && popupMin >= 0) {
    try {
      event.addPopupReminder(Math.floor(popupMin));
    } catch (e) {}
  }
}

function gf_calendar_atHHMM_(fecha, hhmm) {
  const parts = String(hhmm || '09:00').split(':');
  const hh = Number(parts[0]) || 9;
  const mm = Number(parts[1]) || 0;

  return new Date(
    fecha.getFullYear(),
    fecha.getMonth(),
    fecha.getDate(),
    hh,
    mm,
    0
  );
}

/**************************************
 * THROTTLE / DIRTY FLAG
 **************************************/

function gf_calendar_markDirty_() {
  PropertiesService.getDocumentProperties().setProperty('GF_CAL_DIRTY', '1');
}

function gf_calendar_syncRecordatoriosMes_silent_throttled_() {
  const props = PropertiesService.getDocumentProperties();
  const now = Date.now();

  const MIN_INTERVAL_MIN = 360; // 6 horas
  const last = Number(props.getProperty('GF_CAL_LAST_RUN_MS') || 0);
  const dirty = props.getProperty('GF_CAL_DIRTY') === '1';

  if (!dirty && last && (now - last) < MIN_INTERVAL_MIN * 60000) {
    return { skipped: true, reason: 'throttled' };
  }

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return { skipped: true, reason: 'locked' };

  try {
    const res = gf_calendar_syncRecordatoriosMes_silent_();
    props.setProperty('GF_CAL_LAST_RUN_MS', String(now));
    props.deleteProperty('GF_CAL_DIRTY');
    return res;
  } finally {
    lock.releaseLock();
  }
}

/**************************************
 * TEST / PERMISOS
 **************************************/

function gf_calendar_testAccess_() {
  const calCfg = gf_calendar_getCfg_();
  const cal = calCfg.calendarId
    ? CalendarApp.getCalendarById(calCfg.calendarId)
    : CalendarApp.getDefaultCalendar();

  if (!cal) throw new Error('No se pudo abrir el calendario.');

  const start = new Date();
  start.setMinutes(start.getMinutes() + 10);
  start.setSeconds(0, 0);

  const end = new Date(start.getTime() + 10 * 60000);

  const ev = cal.createEvent(
    '🧪 Test permisos Calendar - Gastos Familia',
    start,
    end,
    { description: 'Evento de prueba. Se borrará automáticamente.' }
  );

  ev.deleteEvent();

  return { ok: true, calendar: cal.getName() };
}

/**************************************
 * HELPERS LOCALES
 **************************************/

function gf_yyyymmdd_safe_(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function gf_fmtNumber_(n) {
  const x = Number(n) || 0;
  return x.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}