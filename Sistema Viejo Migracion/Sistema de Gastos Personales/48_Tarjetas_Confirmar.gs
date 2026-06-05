/**************************************
 * 48_Tarjetas_Confirmar.gs - Fase 2.2.a Tanda 2
 * Confirma un resumen de tarjeta: toma lias filas de Tarjetas_Raw
 * y las empuja a Historico + Tarjetas_Movimientos (Lectura B).
 *
 * Función pública:
 *   confirmarResumen(resumenID)
 *
 * Helpers privados:
 *   gf_confirmarResumen_(resumenID)
 *   gf_buildHistoricoRow_(rawRow, iRaw, resumen, iRes, histHeaders)
 *   gf_buildMovRow_(rawRow, iRaw, resumen, iRes, historicoID, movHeaders)
 **************************************/

/**
 * Punto de entrada público. El usuario lo corre desde el editor de Apps Script
 * pasando el ResumenID como argumento, o lo llama desde otro script.
 *
 * @param {string} resumenID
 */
function confirmarResumen(resumenID) {
  if (!resumenID) throw new Error('confirmarResumen: resumenID requerido');
  const result = gf_confirmarResumen_(resumenID);
  Logger.log('confirmarResumen resultado: ' + JSON.stringify(result));
  SpreadsheetApp.getActive().toast(
    'Confirmados: ' + result.confirmados +
    ' | Excluidos: ' + result.excluidos +
    ' | Ignorados: ' + result.ignorados +
    ' | Errores: ' + result.errores,
    'Confirmar Resumen', 10
  );
  return result;
}

/**
 * Lógica principal de confirmación.
 *
 * Lectura B:
 *   - Historico.Fecha           = FechaVencimiento del resumen (mes de imputación)
 *   - Historico.FechaConsumoOriginal = FechaConsumo de la fila Raw (fecha real)
 *   - Historico.Mes             = yyyyMM(FechaVencimiento)
 *
 * Acciones por AccionUsuario en Raw:
 *   - ''  / 'IncluirNoDash'   → escribe en Historico + Tarjetas_Movimientos
 *   - 'ExcluirTotalmente'     → no escribe en Historico, marca Raw confirmed
 *   - 'Ignorar'               → marca Raw ignored, no escribe nada
 *
 * TipoLinea especiales:
 *   - 'reintegro_percepcion'  → Tipo='Ingreso', Subtipo='TarjetaReintegro'
 *   - resto                   → Tipo='Gasto',   Subtipo='TarjetaDetalleImportado'
 *
 * @param {string} resumenID
 * @returns {{confirmados, excluidos, ignorados, errores}}
 */
function gf_confirmarResumen_(resumenID) {
  const ss = SpreadsheetApp.getActive();

  // ── Cargar Tarjetas_Resumen ────────────────────────────────────────────────
  const shRes = ss.getSheetByName(GF.SHEET_TARJETAS_RESUMEN);
  if (!shRes) throw new Error('Hoja Tarjetas_Resumen no encontrada');

  const hRes = shRes.getRange(1, 1, 1, shRes.getLastColumn()).getValues()[0];
  const iRes = {};
  hRes.forEach((h, i) => { iRes[String(h).trim()] = i; });

  if (iRes['ResumenID'] === undefined) throw new Error('Tarjetas_Resumen: falta columna ResumenID');

  let resumen = null;
  let resumenSheetRow = -1;
  if (shRes.getLastRow() >= 2) {
    const nRes = shRes.getLastRow() - 1;
    const resRows = shRes.getRange(2, 1, nRes, shRes.getLastColumn()).getValues();
    for (let i = 0; i < resRows.length; i++) {
      if (String(resRows[i][iRes['ResumenID']]).trim() === resumenID) {
        resumen = resRows[i];
        resumenSheetRow = i + 2;
        break;
      }
    }
  }
  if (!resumen) throw new Error('ResumenID no encontrado en Tarjetas_Resumen: ' + resumenID);

  // FechaVencimiento es la Fecha canónica (Lectura B)
  const fechaVenc = resumen[iRes['FechaVencimiento']];
  if (!(fechaVenc instanceof Date)) {
    throw new Error('FechaVencimiento inválida para resumenID: ' + resumenID);
  }
  const mesImputacion = yyyymm_(fechaVenc);

  const banco   = String(resumen[iRes['Banco']]   || '').trim();
  const tarjeta = String(resumen[iRes['Tarjeta']] || '').trim();
  const cuentaDebito = iRes['CuentaDebitoDetalle'] !== undefined
    ? String(resumen[iRes['CuentaDebitoDetalle']] || '').trim()
    : '';

  // ── Cargar Tarjetas_Raw para este resumen ─────────────────────────────────
  const shRaw = ss.getSheetByName(GF.SHEET_TARJETAS_RAW);
  if (!shRaw) throw new Error('Hoja Tarjetas_Raw no encontrada');

  const hRaw = shRaw.getRange(1, 1, 1, shRaw.getLastColumn()).getValues()[0];
  const iRaw = {};
  hRaw.forEach((h, i) => { iRaw[String(h).trim()] = i; });

  const needRaw = ['RawID','ResumenID','EstadoMatch','AccionUsuario','DescripcionRaw'];
  for (const c of needRaw) {
    if (iRaw[c] === undefined) throw new Error('Tarjetas_Raw: falta columna ' + c);
  }

  const nRaw = shRaw.getLastRow() - 1;
  if (nRaw < 1) throw new Error('Tarjetas_Raw está vacía');
  const rawRows = shRaw.getRange(2, 1, nRaw, shRaw.getLastColumn()).getValues();

  // Filtrar filas de este resumen que están listas para confirmar
  const ESTADOS_PROCESABLES = ['pending', 'auto', 'manual', 'confirmed'];
  const toProcess = [];
  rawRows.forEach((row, i) => {
    if (String(row[iRaw['ResumenID']] || '').trim() !== resumenID) return;
    const estado = String(row[iRaw['EstadoMatch']] || '').trim();
    if (ESTADOS_PROCESABLES.indexOf(estado) === -1) return;
    toProcess.push({ row, sheetRow: i + 2 });
  });

  if (toProcess.length === 0) {
    Logger.log('gf_confirmarResumen_: no hay filas procesables para ' + resumenID);
    return { confirmados: 0, excluidos: 0, ignorados: 0, errores: 0 };
  }

  // ── Cargar hojas destino ───────────────────────────────────────────────────
  const shHist = ss.getSheetByName(GF.SHEET_HIST);
  if (!shHist) throw new Error('Hoja Historico no encontrada');
  const histHeaders = shHist.getRange(1, 1, 1, shHist.getLastColumn()).getValues()[0];
  const iHist = {};
  histHeaders.forEach((h, i) => { iHist[String(h).trim()] = i; });

  const shMov = ss.getSheetByName(GF.SHEET_TARJETAS_MOV);
  if (!shMov) throw new Error('Hoja Tarjetas_Movimientos no encontrada');
  const movHeaders = shMov.getRange(1, 1, 1, shMov.getLastColumn()).getValues()[0];
  const iMov = {};
  movHeaders.forEach((h, i) => { iMov[String(h).trim()] = i; });

  const now = new Date();
  const usuario = Session.getActiveUser().getEmail() || 'Sistema';

  let confirmados = 0, excluidos = 0, ignorados = 0, errores = 0;
  const histBatch = [];
  const movBatch  = [];
  const rawUpdates = []; // {sheetRow, estado, historicoID}

  for (const { row, sheetRow } of toProcess) {
    const accion = String(row[iRaw['AccionUsuario']] || '').trim();

    if (accion === 'Ignorar') {
      rawUpdates.push({ sheetRow, estado: 'ignored', historicoID: '' });
      ignorados++;
      continue;
    }

    if (accion === 'ExcluirTotalmente') {
      rawUpdates.push({ sheetRow, estado: 'confirmed', historicoID: '' });
      excluidos++;
      continue;
    }

    // Incluir (normal o IncluirNoDash)
    try {
      const historicoID = newId_('HIS');

      const histRow = gf_buildHistoricoRow_(
        row, iRaw, resumen, iRes,
        histHeaders, iHist,
        { historicoID, fechaVenc, mesImputacion, banco, tarjeta, cuentaDebito,
          excluirDash: (accion === 'IncluirNoDash'),
          now, usuario, resumenID }
      );
      histBatch.push(histRow);

      const movRow = gf_buildMovRow_(
        row, iRaw, resumen, iRes,
        movHeaders, iMov,
        { historicoID, fechaVenc, mesImputacion, banco, tarjeta, cuentaDebito, now }
      );
      movBatch.push(movRow);

      rawUpdates.push({ sheetRow, estado: 'confirmed', historicoID });
      confirmados++;
    } catch (e) {
      Logger.log('gf_confirmarResumen_: error en fila ' + sheetRow + ': ' + e.message);
      errores++;
    }
  }

  // ── Escritura en batch ─────────────────────────────────────────────────────
  if (histBatch.length > 0) {
    const firstHistRow = shHist.getLastRow() + 1;
    shHist.getRange(firstHistRow, 1, histBatch.length, histHeaders.length).setValues(histBatch);
  }

  if (movBatch.length > 0) {
    const firstMovRow = shMov.getLastRow() + 1;
    shMov.getRange(firstMovRow, 1, movBatch.length, movHeaders.length).setValues(movBatch);
  }

  // ── Invalidar Dash_Cache para meses afectados ──────────────────────────────
  // Solo filas con ExcluirDash=false impactan el Dashboard (TarjetaConsumo, TarjetaReintegro).
  // TarjetaPago (ExcluirDash=true) no se invalida.
  if (histBatch.length > 0 && iHist['ExcluirDash'] !== undefined && iHist['Mes'] !== undefined) {
    var mesesAfectados = [];
    histBatch.forEach(function(row) {
      if (!gf_boolOrDefault_(row[iHist['ExcluirDash']], false)) {
        var mes = String(row[iHist['Mes']] || '').trim();
        if (mes && mesesAfectados.indexOf(mes) === -1) mesesAfectados.push(mes);
      }
    });
    if (mesesAfectados.length > 0) {
      try { gf_dashCache_marcarStale_(mesesAfectados); } catch(e) {
        Logger.log('[confirmarResumen] marcarStale falló (no crítico): ' + e);
      }
    }
  }

  // ── Auto-generar filas TarjetaPago ─────────────────────────────────────────
  const pagoRows = gf_buildPagoRows_(
    histBatch, iHist, resumen, iRes,
    histHeaders, { fechaVenc, banco, tarjeta, resumenID, now, usuario }
  );
  if (pagoRows.length > 0) {
    const firstPagoRow = shHist.getLastRow() + 1;
    shHist.getRange(firstPagoRow, 1, pagoRows.length, histHeaders.length).setValues(pagoRows);
  }

  // ── Actualizar Raw (EstadoMatch + HistoricoID si corresponde) ──────────────
  for (const upd of rawUpdates) {
    if (iRaw['EstadoMatch'] !== undefined) {
      shRaw.getRange(upd.sheetRow, iRaw['EstadoMatch'] + 1).setValue(upd.estado);
    }
    // Guardamos HistoricoID en Notas si no hay columna dedicada (la hay en Mov pero no en Raw)
    // No se agrega columna, se deja trazabilidad en Tarjetas_Movimientos.
  }

  // ── Actualizar EstadoImport en Tarjetas_Resumen ────────────────────────────
  if (resumenSheetRow > 0 && iRes['EstadoImport'] !== undefined) {
    shRes.getRange(resumenSheetRow, iRes['EstadoImport'] + 1).setValue('aplicado');
  }

  return { confirmados, excluidos, ignorados, errores, pagosGenerados: pagoRows.length };
}

/**
 * Construye una fila lista para insertar en Historico.
 */
function gf_buildHistoricoRow_(row, iRaw, resumen, iRes, histHeaders, iHist, opts) {
  const { historicoID, fechaVenc, mesImputacion, banco, tarjeta, cuentaDebito,
          excluirDash, now, usuario, resumenID } = opts;

  const tipoLinea = String(row[iRaw['TipoLinea']] || 'consumo').trim();
  const esReintegro = (tipoLinea === 'reintegro_percepcion');

  const tipo    = esReintegro ? 'Ingreso' : 'Gasto';
  const subtipo = esReintegro ? 'TarjetaReintegro' : 'TarjetaConsumo';

  const descLimpia = iRaw['DescripcionLimpia'] !== undefined
    ? String(row[iRaw['DescripcionLimpia']] || '').trim()
    : '';
  const descripcion = descLimpia || String(row[iRaw['DescripcionRaw']] || '').trim();

  const persona = iRaw['PersonaFinal'] !== undefined
    ? String(row[iRaw['PersonaFinal']] || '').trim()
    : '';

  const fechaConsumo = (iRaw['FechaConsumo'] !== undefined && row[iRaw['FechaConsumo']] instanceof Date)
    ? row[iRaw['FechaConsumo']] : null;
  const fechaUsar = fechaConsumo || fechaVenc;
  const diaUsar   = fechaUsar instanceof Date ? fechaUsar.getDate() : '';
  const mesUsar   = fechaUsar instanceof Date ? yyyymm_(fechaUsar) : mesImputacion;

  const histRow = new Array(histHeaders.length).fill('');
  const set = (col, val) => {
    if (iHist[col] !== undefined && val !== undefined && val !== null) histRow[iHist[col]] = val;
  };

  set('ID',                   historicoID);
  set('ParentID',             resumenID);
  set('Tipo',                 tipo);
  set('Subtipo',              subtipo);
  set('Origen',               'ImportTarjeta');
  set('Persona',              persona);
  set('Descripción',          descripcion);
  set('Categoría',            iRaw['Categoría']    !== undefined ? row[iRaw['Categoría']]    : '');
  set('Subcategoria',         iRaw['Subcategoria'] !== undefined ? row[iRaw['Subcategoria']] : '');
  set('Etiqueta',             iRaw['Etiqueta']     !== undefined ? row[iRaw['Etiqueta']]     : '');
  set('Banco',                banco);
  set('Cuenta',               cuentaDebito);
  set('Moneda',               iRaw['Moneda']  !== undefined ? row[iRaw['Moneda']]  : 'ARS');
  set('Monto',                iRaw['Monto']   !== undefined ? row[iRaw['Monto']]   : 0);
  set('Día',                  diaUsar);
  set('Fecha',                fechaUsar);               // Lectura B bifurcada: fecha de consumo (fallback: vencimiento)
  set('Pagado',               true);
  set('FlagResumenMes',       false);
  set('ExcluirDash',          excluirDash);
  set('EstadoRegistro',       'Importado');
  set('ResumenTarjetaID',     resumenID);
  set('Tarjeta',              tarjeta);
  set('Usuario',              usuario);
  set('Mes',                  mesUsar);
  set('FechaConsumoOriginal', iRaw['FechaConsumo'] !== undefined ? row[iRaw['FechaConsumo']] : '');
  set('CreatedAt',            now);
  set('UpdatedAt',            now);

  return histRow;
}

/**
 * Construye una fila lista para insertar en Tarjetas_Movimientos.
 */
function gf_buildMovRow_(row, iRaw, resumen, iRes, movHeaders, iMov, opts) {
  const { historicoID, fechaVenc, mesImputacion, banco, tarjeta, cuentaDebito, now } = opts;

  const movRow = new Array(movHeaders.length).fill('');
  const set = (col, val) => {
    if (iMov[col] !== undefined && val !== undefined && val !== null) movRow[iMov[col]] = val;
  };

  const descLimpia = iRaw['DescripcionLimpia'] !== undefined
    ? String(row[iRaw['DescripcionLimpia']] || '').trim()
    : '';

  set('MovID',               newId_('MOV'));
  set('RawID',               iRaw['RawID']          !== undefined ? row[iRaw['RawID']]          : '');
  set('ResumenID',           iRaw['ResumenID']       !== undefined ? row[iRaw['ResumenID']]       : '');
  set('HashMovimiento',      iRaw['HashMovimiento']  !== undefined ? row[iRaw['HashMovimiento']]  : '');
  set('FechaConsumo',        iRaw['FechaConsumo']    !== undefined ? row[iRaw['FechaConsumo']]    : '');
  set('FechaImputacion',     fechaVenc);              // Lectura B
  set('MesImputacion',       mesImputacion);
  set('Persona',             iRaw['PersonaFinal']    !== undefined ? row[iRaw['PersonaFinal']]    : '');
  set('Descripción',         descLimpia || (iRaw['DescripcionRaw'] !== undefined ? row[iRaw['DescripcionRaw']] : ''));
  set('DescripcionRaw',      iRaw['DescripcionRaw']  !== undefined ? row[iRaw['DescripcionRaw']]  : '');
  set('Categoría',           iRaw['Categoría']       !== undefined ? row[iRaw['Categoría']]       : '');
  set('Subcategoria',        iRaw['Subcategoria']    !== undefined ? row[iRaw['Subcategoria']]    : '');
  set('Etiqueta',            iRaw['Etiqueta']        !== undefined ? row[iRaw['Etiqueta']]        : '');
  set('Banco',               banco);
  set('Tarjeta',             tarjeta);
  set('CuentaDebitoDetalle', cuentaDebito);
  set('Moneda',              iRaw['Moneda']          !== undefined ? row[iRaw['Moneda']]          : 'ARS');
  set('Monto',               iRaw['Monto']           !== undefined ? row[iRaw['Monto']]           : 0);
  set('CuotaActual',         iRaw['CuotaActual']     !== undefined ? row[iRaw['CuotaActual']]     : '');
  set('CuotaTotal',          iRaw['CuotaTotal']      !== undefined ? row[iRaw['CuotaTotal']]      : '');
  set('HistoricoID',         historicoID);
  set('CreatedAt',           now);

  return movRow;
}

/**
 * Construye las filas TarjetaPago a partir del resumen confirmado.
 * Retorna array de filas listas para insertar en Historico.
 */
function gf_buildPagoRows_(histBatch, iHist, resumen, iRes, histHeaders, opts) {
  const { fechaVenc, banco, tarjeta, resumenID, now, usuario } = opts;

  const totalARS = Number(iRes['TotalARS'] !== undefined ? resumen[iRes['TotalARS']] : 0) || 0;
  const totalUSD = Number(iRes['TotalUSD'] !== undefined ? resumen[iRes['TotalUSD']] : 0) || 0;

  if (!totalARS && !totalUSD) return [];

  // Buscar PERCEP.AFIP 4815 en los consumos confirmados (monto positivo = cargo)
  let percepMonto = 0;
  if (iHist['Descripción'] !== undefined && iHist['Monto'] !== undefined) {
    const rePercep = /percep.*4815|4815.*percep/i;
    for (const fila of histBatch) {
      const desc = String(fila[iHist['Descripción']] || '');
      if (rePercep.test(desc)) {
        const m = Number(fila[iHist['Monto']]) || 0;
        if (m > 0) percepMonto += m;
      }
    }
  }
  const totalARSAjustado = Math.max(0, totalARS - percepMonto);

  const rows = [];

  function buildPago(moneda, monto, sufijo) {
    const row = new Array(histHeaders.length).fill('');
    const set = (col, val) => {
      if (iHist[col] !== undefined && val !== undefined && val !== null) row[iHist[col]] = val;
    };
    const subcatParts = tarjeta.replace(/\s+/g, ' ').trim() + ' ' + banco + moneda;
    set('ID',               newId_('HIS'));
    set('ParentID',         resumenID);
    set('Tipo',             'Gasto');
    set('Subtipo',          'TarjetaPago');
    set('Origen',           'ImportTarjeta');
    set('Persona',          '');
    set('Descripción',      'Pago ' + tarjeta + ' ' + banco + ' ' + sufijo);
    set('Categoría',        'Tarjetas');
    set('Subcategoria',     'Pago Tarjeta');
    set('Etiqueta',         subcatParts);
    set('Banco',            banco);
    set('Tarjeta',          tarjeta);
    set('Moneda',           moneda);
    set('Monto',            monto);
    set('Fecha',            fechaVenc);
    set('Día',              fechaVenc instanceof Date ? fechaVenc.getDate() : '');
    set('Mes',              fechaVenc instanceof Date ? yyyymm_(fechaVenc) : '');
    set('Pagado',           false);
    set('FlagResumenMes',   true);
    set('ExcluirDash',      true);
    set('EstadoRegistro',   'Importado');
    set('ResumenTarjetaID', resumenID);
    set('Usuario',          usuario);
    set('CreatedAt',        now);
    set('UpdatedAt',        now);
    return row;
  }

  if (totalARSAjustado) rows.push(buildPago('ARS', totalARSAjustado, 'ARS'));
  if (totalUSD)         rows.push(buildPago('USD', totalUSD,         'USD'));

  return rows;
}
