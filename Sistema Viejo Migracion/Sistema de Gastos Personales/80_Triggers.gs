/**************************************
 * TRIGGERS
 **************************************/

// gf_procesarTildados_silent_ vive en 30_Carga_y_Historico.gs (versión canónica).
// Esta definición fue eliminada para evitar el override por orden alfabético.

function gf_automation_tick_() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return;
  try {
    let moved = 0;
    try { moved = gf_procesarTildados_silent_(); } catch (e) { gf_logError_('gf_procesarTildados_silent_', e); }
    if (moved) try { gf_calendar_markDirty_(); } catch (e) { gf_logError_('gf_calendar_markDirty_', e); }
    try { gf_actualizarResumenMes_(); } catch (e) { gf_logError_('gf_actualizarResumenMes_', e); }
    try { gf_actualizarDash_(); } catch (e) { gf_logError_('gf_actualizarDash_', e); }
    try {
      if (typeof gf_calendar_syncRecordatoriosMes_silent_throttled_ === 'function') gf_calendar_syncRecordatoriosMes_silent_throttled_();
      else if (typeof gf_calendar_syncRecordatoriosMes_silent_ === 'function') gf_calendar_syncRecordatoriosMes_silent_();
    } catch (e) { gf_logError_('gf_calendar_syncRecordatoriosMes_', e); }

    // Limpieza best-effort de tokens/archivos temporales vencidos
    try {
      if (typeof gf_share_cleanupExpired_ === 'function') gf_share_cleanupExpired_();
    } catch (e) {
      gf_logError_('gf_share_cleanupExpired_', e);
    }
  } finally {
    lock.releaseLock();
  }
}

function gf_installTriggers_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Ejecutá esto desde el Spreadsheet.');
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction();
    if (['gf_onEditInstallable_','gf_automation_tick_','gf_registrarTCMEP_enTablaDiaria_','gf_share_cleanupExpired_'].includes(fn)) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('gf_onEditInstallable_').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('gf_automation_tick_').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('gf_registrarTCMEP_enTablaDiaria_').timeBased().everyDays(1).atHour(9).nearMinute(0).create();
  ScriptApp.newTrigger('gf_share_cleanupExpired_').timeBased().everyHours(6).create();
}
