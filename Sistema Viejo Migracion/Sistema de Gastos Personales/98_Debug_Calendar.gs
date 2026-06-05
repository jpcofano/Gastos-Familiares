function gf_calendar_debugMes() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const shCfg = ss.getSheetByName(GF.SHEET_CONFIG);
  const shHist = ss.getSheetByName(GF.SHEET_HIST);
  if (!shCfg || !shHist) throw new Error('Falta Config o Historico.');

  const mes = gf_toYYYYMM_(shCfg.getRange(GF.CFG_MES_CELL).getValue(), tz);
  if (!mes) throw new Error('Config!B1 inválido. Usá YYYY-MM o una fecha del mes.');

  const t = gf_readSheet_(shHist);
  const idx = gf_buildIdx_(t.headers);

  const iTipo   = idx[gf_norm_('Tipo')];
  const iFecha  = idx[gf_norm_('Fecha')];
  const iMes    = idx[gf_norm_('Mes')];
  const iMonto  = idx[gf_norm_('Monto')];
  const iPagado = idx[gf_norm_('Pagado')];

  const c = { total: 0, noGasto: 0, sinFecha: 0, otroMes: 0, monto0: 0, pagado: 0, candidatos: 0 };

  for (const r of t.rows) {
    c.total++;

    const tipo = (iTipo != null ? r[iTipo] : '').toString().trim();
    if (tipo !== 'Gasto') { c.noGasto++; continue; }

    const fecha = (iFecha != null ? r[iFecha] : null);
    if (!(fecha instanceof Date)) { c.sinFecha++; continue; }

    const mesRow = (iMes != null && r[iMes])
      ? (r[iMes] || '').toString().trim()
      : Utilities.formatDate(fecha, tz, 'yyyy-MM');

    if (mesRow !== mes) { c.otroMes++; continue; }

    const monto = Number(iMonto != null ? r[iMonto] : 0) || 0;
    if (!monto) { c.monto0++; continue; }

    const pagVal = (iPagado != null ? r[iPagado] : false);
    const pagado = (pagVal === true) || (String(pagVal).toUpperCase() === 'TRUE') || (pagVal === 1);
    if (pagado) { c.pagado++; continue; }

    c.candidatos++;
  }

  console.log('Mes objetivo:', mes);
  console.log('Conteo:', JSON.stringify(c, null, 2));
  return { mes, ...c };
}

function gf_authorizeCalendar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(); // debe ser script vinculado a la planilla
  if (!ss) throw new Error('Abrí la planilla y ejecutá esto desde Extensiones → Apps Script.');

  // Lee Config!B4:B7 como ya hace tu Calendar
  const calCfg = gf_calendar_getCfg_(); // lee Config!B4 :contentReference[oaicite:1]{index=1}

  const cal = calCfg.calendarId
    ? CalendarApp.getCalendarById(calCfg.calendarId)
    : CalendarApp.getDefaultCalendar();

  if (!cal) throw new Error(`No pude acceder al calendario. Revisá Config!B4 (valor: "${calCfg.calendarId}").`);

  // Crea y borra un evento de prueba (fuerza permiso de escritura)
  const start = new Date();
  const end = new Date(start.getTime() + 60 * 1000);
  const ev = cal.createEvent('GF_AUTH_TEST (se borra solo)', start, end, {
    description: 'Evento de prueba para autorizar Calendar. Se borra automáticamente.'
  });
  ev.deleteEvent();

  // Sin UI: log + return
  console.log('Permisos OK. Calendario:', cal.getName(), 'ID:', calCfg.calendarId || '(default)');
  return { ok: true, calendarName: cal.getName(), calendarId: calCfg.calendarId || '(default)' };
}
