/**************************************
 * 95_GastosManuales_WebApp.gs
 * - Manual directo -> Historico
 * - Eventual directo -> Historico
 * - Eventual futuro mes actual -> Carga
 * - Eventual futuro otro mes -> Futuros_Eventuales
 * - Aprendizaje Diccionario
 **************************************/

/**************************************
 * API WEBAPP / HTML
 **************************************/

function gf_web_getBootstrap_() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const shCfg = ss.getSheetByName(GF.SHEET_CONFIG);

  const mes = shCfg
    ? gf_toYYYYMM_(shCfg.getRange(GF.CFG_MES_CELL).getValue(), tz)
    : '';

  return {
    ok: true,
    mesActual: mes,
    usuario: gf_getPersonaWebApp_(),
    enums: {
      tipo: GF.ENUMS.TIPO,
      subtipo: GF.ENUMS.SUBTIPO,
      moneda: GF.ENUMS.MONEDA,
      estado: GF.ENUMS.ESTADO_REGISTRO
    },
    diccionario: gf_web_buildDiccionario_(),
    links: {
      resumenMes: '#',
      dash: '#'
    }
  };
}

function gf_web_buildDiccionario_() {
  let categorias   = gf_getDiccionarioValores_('Categoria');
  let subcategorias = gf_getDiccionarioValores_('Subcategoria');
  const etiquetas  = gf_getDiccionarioValores_('Etiqueta');

  // Si el Diccionario canónico está vacío, extraer valores únicos desde Diccionario_Aprendido
  if (!categorias.length || !subcategorias.length) {
    try {
      const ss = SpreadsheetApp.getActive();
      const sh = ss.getSheetByName(GF.SHEET_DICT_APRENDIDO);
      if (sh && sh.getLastRow() > 1) {
        const rows = gf_readObjectsFromSheet_(sh);
        const uniq = function(arr) {
          return arr.filter(function(v, i, a) { return v && a.indexOf(v) === i; }).sort();
        };
        if (!categorias.length) {
          categorias = uniq(rows.map(function(r) { return String(r['Categoría'] || '').trim(); }));
        }
        if (!subcategorias.length) {
          subcategorias = uniq(rows.map(function(r) { return String(r['Subcategoria'] || '').trim(); }));
        }
      }
    } catch (_) {}
  }

  // Mapa subcategorias por categoria (para filtrar datalist al cambiar el select)
  var subcategoriasPorCategoria = {};
  try {
    var ss2 = SpreadsheetApp.getActive();
    var shDict = ss2.getSheetByName(GF.SHEET_DICT);
    if (shDict && shDict.getLastRow() > 1) {
      var dictRows = gf_readObjectsFromSheet_(shDict);
      dictRows.filter(function(r) {
        return String(r['Tipo']||'').trim() === 'Subcategoria' &&
               gf_boolOrDefault_(r['Activo'], true) &&
               String(r['Valor']||'').trim();
      }).forEach(function(r) {
        var cat = String(r['Categoria']||'').trim();
        var val = String(r['Valor']||'').trim();
        if (cat) {
          if (!subcategoriasPorCategoria[cat]) subcategoriasPorCategoria[cat] = [];
          subcategoriasPorCategoria[cat].push(val);
        }
      });
    }
  } catch (_) {}

  return {
    categorias: categorias,
    subcategorias: subcategorias,
    etiquetas: etiquetas,
    subcategoriasPorCategoria: subcategoriasPorCategoria
  };
}

function gf_web_guardarManual_(payload) {
  try {
    const u = requireUser_();
    payload = payload || {};

    const tipo     = (String(payload.tipo || '').trim() === 'Ingreso') ? 'Ingreso' : 'Gasto';
    const subtipo  = 'Manual';

    const descripcion = String(payload.descripcion || '').trim();
    if (!descripcion) throw new Error('Falta descripción.');

    const monto = Number(payload.monto) || 0;
    if (monto <= 0) throw new Error('Monto debe ser mayor a 0.');

    const banco = String(payload.banco || '').trim();
    if (!banco) throw new Error('Banco es obligatorio.');

    const fecha = gf_parseFlexibleDate_(payload.fecha || '');
    if (!(fecha instanceof Date)) throw new Error('Fecha inválida.');

    // Persona: override del form (para Federico/Sofía) o persona del user logueado
    const persona = String(payload.persona || u.persona || '').trim() || u.persona;

    // Pagado: lo manda el form (checkbox), o se calcula por fecha si no viene
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const fechaD = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    const pagadoDefault = fechaD <= hoy;
    const pagado = (payload.pagado !== undefined && payload.pagado !== null)
      ? !!payload.pagado
      : pagadoDefault;

    const now = new Date();
    const categoria = String(payload.categoria || '').trim();
    const subcategoria = String(payload.subcategoria || '').trim();
    const etiqueta = String(payload.etiqueta || '').trim();
    const fechaKey = Utilities.formatDate(fecha, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const numeroComprobante = gf_generarPseudoNumero_(fechaKey, subcategoria, etiqueta, monto);

    const mov = {
      'ID':               newId_('MAN'),
      'Tipo':             tipo,
      'Subtipo':          subtipo,
      'Origen':           'WebApp',
      'Persona':          persona,
      'Descripción':      descripcion,
      'Categoría':        categoria,
      'Subcategoria':     subcategoria,
      'Etiqueta':         etiqueta,
      'Banco':            banco,
      'Moneda':           (String(payload.moneda || 'ARS').trim().toUpperCase() === 'USD') ? 'USD' : 'ARS',
      'Monto':            monto,
      'Fecha':            fecha,
      'Pagado':           pagado,
      'FlagResumenMes':   tipo === 'Ingreso' ? false : !pagado,
      'ExcluirDash':      false,
      'EstadoRegistro':   'Registrado',
      'ResumenTarjetaID': '',
      'Notas':            String(payload.notas || '').trim(),
      'NumeroComprobante': numeroComprobante,
      'Usuario':          u.persona,
      'CreatedAt':        now,
      'UpdatedAt':        now
    };

    gf_writeHistoricoMovimientos_(mov, { origenDefault: 'WebApp', estadoDefault: 'Registrado' });

    return { ok: true, id: mov['ID'] };
  } catch (err) {
    gf_logError_('gf_web_guardarManual_', err);
    return { ok: false, error: err.message || String(err) };
  }
}

function gf_web_guardarEventualDirecto_(payload) {
  try {
    const mov = gf_buildEventualDirectoHistoricoInput_(payload || {});
    const res = gf_writeHistoricoMovimientos_(mov, {
      origenDefault: 'WebApp',
      estadoDefault: 'Registrado'
    });

    gf_aprenderMovimientoEnDiccionario_(mov);

    return {
      ok: true,
      tipo: 'EventualDirecto',
      inserted: res.inserted,
      ids: res.ids
    };
  } catch (err) {
    gf_logError_('gf_web_guardarEventualDirecto_', err);
    return { ok: false, error: err.message || String(err) };
  }
}

function gf_web_guardarEventualFuturo_(payload) {
  try {
    const res = gf_guardarEventualFuturoSegunMes_(payload || {});
    return res;
  } catch (err) {
    gf_logError_('gf_web_guardarEventualFuturo_', err);
    return { ok: false, error: err.message || String(err) };
  }
}

// aliases cómodos por si el HTML viejo usa otros nombres
function gf_guardarManualWeb_(payload) {
  return gf_web_guardarManual_(payload);
}
function gf_guardarEventualDirectoWeb_(payload) {
  return gf_web_guardarEventualDirecto_(payload);
}
function gf_guardarEventualFuturoWeb_(payload) {
  return gf_web_guardarEventualFuturo_(payload);
}

/**************************************
 * BUILDERS
 **************************************/

function gf_buildManualHistoricoInput_(payload) {
  const base = gf_normalizeWebPayloadBase_(payload, { requireFecha: false });

  if (!base.descripcion) throw new Error('Falta descripción.');
  if (!(Number(base.monto) > 0)) throw new Error('Monto inválido.');

  return {
    'ID': gf_generateId_('MAN'),
    'ParentID': '',
    'Tipo': 'Gasto',
    'Subtipo': 'Manual',
    'Origen': 'WebApp',
    'Persona': base.persona,
    'Descripción': base.descripcion,
    'Categoría': base.categoria,
    'Subcategoria': base.subcategoria,
    'Etiqueta': base.etiqueta,
    'Banco': 'Efectivo',
    'Cuenta': '',
    'Moneda': base.moneda,
    'Monto': base.monto,
    'Día': '',
    'Fecha': base.fecha || new Date(),
    'Pagado': true,
    'FlagResumenMes': false,
    'ExcluirDash': false,
    'EstadoRegistro': 'Registrado',
    'ResumenTarjetaID': '',
    'Usuario': base.usuario,
    'Notas': base.notas
  };
}

function gf_buildEventualDirectoHistoricoInput_(payload) {
  const base = gf_normalizeWebPayloadBase_(payload, { requireFecha: false });

  if (!base.descripcion) throw new Error('Falta descripción.');
  if (!(Number(base.monto) > 0)) throw new Error('Monto inválido.');

  return {
    'ID': gf_generateId_('EVD'),
    'ParentID': '',
    'Tipo': 'Gasto',
    'Subtipo': 'EventualDirecto',
    'Origen': 'WebApp',
    'Persona': base.persona,
    'Descripción': base.descripcion,
    'Categoría': base.categoria,
    'Subcategoria': base.subcategoria,
    'Etiqueta': base.etiqueta,
    'Banco': base.banco || 'Efectivo',
    'Cuenta': base.cuenta || '',
    'Moneda': base.moneda,
    'Monto': base.monto,
    'Día': '',
    'Fecha': base.fecha || new Date(),
    'Pagado': true,
    'FlagResumenMes': true,
    'ExcluirDash': false,
    'EstadoRegistro': 'Registrado',
    'ResumenTarjetaID': '',
    'Usuario': base.usuario,
    'Notas': base.notas
  };
}

function gf_buildEventualFuturoCargaInput_(payload, mesActual) {
  const base = gf_normalizeWebPayloadBase_(payload, { requireFecha: true });
  const fecha = base.fecha;
  if (!(fecha instanceof Date)) throw new Error('Fecha inválida.');

  const dia = fecha.getDate();

  return {
    'ID': gf_generateId_('EVF'),
    'ParentID': '',
    'Tipo': 'Gasto',
    'Subtipo': 'EventualFuturo',
    'Origen': 'WebApp',
    'Persona': base.persona,
    'Descripción': base.descripcion,
    'Categoría': base.categoria,
    'Subcategoria': base.subcategoria,
    'Etiqueta': base.etiqueta,
    'Banco': base.banco || 'Efectivo',
    'Cuenta': base.cuenta || '',
    'Moneda': base.moneda,
    'Monto': base.monto,
    'Día': dia,
    'Fecha': fecha,
    'OK': false,
    'Pagado': false,
    'FlagResumenMes': true,
    'ExcluirDash': false,
    'EstadoRegistro': 'Pendiente',
    'ResumenTarjetaID': '',
    'Usuario': base.usuario,
    'Notas': base.notas
  };
}

function gf_buildEventualFuturoSheetInput_(payload) {
  const base = gf_normalizeWebPayloadBase_(payload, { requireFecha: true });
  const fecha = base.fecha;
  if (!(fecha instanceof Date)) throw new Error('Fecha inválida.');

  const mesDestino = Utilities.formatDate(
    fecha,
    Session.getScriptTimeZone(),
    'yyyy-MM'
  );

  return {
    'ID': gf_generateId_('EVF'),
    'Tipo': 'Gasto',
    'Subtipo': 'EventualFuturo',
    'Origen': 'WebApp',
    'Persona': base.persona,
    'Descripción': base.descripcion,
    'Categoría': base.categoria,
    'Subcategoria': base.subcategoria,
    'Etiqueta': base.etiqueta,
    'Banco': base.banco || 'Efectivo',
    'Cuenta': base.cuenta || '',
    'Moneda': base.moneda,
    'Monto': base.monto,
    'FechaPlanificada': fecha,
    'MesDestino': mesDestino,
    'FlagResumenMes': true,
    'ExcluirDash': false,
    'EstadoRegistro': 'Planificado',
    'Usuario': base.usuario,
    'Notas': base.notas,
    'CreatedAt': new Date(),
    'UpdatedAt': new Date()
  };
}

/**************************************
 * EVENTUAL FUTURO: decide destino
 **************************************/

function gf_guardarEventualFuturoSegunMes_(payload) {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const shCfg = ss.getSheetByName(GF.SHEET_CONFIG);

  if (!shCfg) throw new Error('Falta Config.');

  const mesActual = gf_toYYYYMM_(shCfg.getRange(GF.CFG_MES_CELL).getValue(), tz);
  if (!mesActual) throw new Error('Config!B1 inválido.');

  const base = gf_normalizeWebPayloadBase_(payload, { requireFecha: true });
  const fecha = base.fecha;
  if (!(fecha instanceof Date)) throw new Error('Fecha inválida.');

  const mesDestino = Utilities.formatDate(fecha, tz, 'yyyy-MM');

  // mismo mes actual -> Carga
  if (mesDestino === mesActual) {
    const mov = gf_buildEventualFuturoCargaInput_(payload, mesActual);
    const res = gf_writeCargaMovimientos_([mov]);

    gf_aprenderMovimientoEnDiccionario_(mov);

    return {
      ok: true,
      tipo: 'EventualFuturo',
      destino: 'Carga',
      inserted: res.inserted,
      ids: res.ids
    };
  }

  // otro mes -> Futuros_Eventuales
  const obj = gf_buildEventualFuturoSheetInput_(payload);
  const res = gf_writeFuturosEventuales_([obj]);

  gf_aprenderMovimientoEnDiccionario_(obj);

  return {
    ok: true,
    tipo: 'EventualFuturo',
    destino: GF.SHEET_FUT_EVENT,
    inserted: res.inserted,
    ids: res.ids
  };
}

/**************************************
 * WRITE CARGA
 **************************************/

function gf_writeCargaMovimientos_(items) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_CARGA);
  if (!sh) throw new Error('Falta hoja Carga.');

  gf_ensureSheetSchema_(sh, GF.SHEET_SCHEMAS[GF.SHEET_CARGA], { applyFormats: true });

  const arr = Array.isArray(items) ? items : [items];
  const normalized = arr.map(gf_normalizeCargaInput_);

  gf_writeObjectsToSheet_(sh, normalized, {
    startRow: sh.getLastRow() + 1,
    clear: false
  });

  gf_setupValidationsLivianas_();

  return {
    ok: true,
    inserted: normalized.length,
    ids: normalized.map(x => x['ID'])
  };
}

function gf_normalizeCargaInput_(input) {
  return {
    'ID': gf_inputGet_(input, ['ID'], gf_generateId_('CARGA')),
    'ParentID': gf_inputGet_(input, ['ParentID'], ''),
    'Tipo': gf_inputGet_(input, ['Tipo'], 'Gasto'),
    'Subtipo': gf_inputGet_(input, ['Subtipo'], 'Otro'),
    'Origen': gf_inputGet_(input, ['Origen'], 'WebApp'),
    'Persona': gf_inputGet_(input, ['Persona'], gf_getPersonaWebApp_()),
    'Descripción': gf_inputGet_(input, ['Descripción', 'Descripcion'], ''),
    'Categoría': gf_inputGet_(input, ['Categoría', 'Categoria'], ''),
    'Subcategoria': gf_inputGet_(input, ['Subcategoria'], ''),
    'Etiqueta': gf_inputGet_(input, ['Etiqueta'], ''),
    'Banco': gf_inputGet_(input, ['Banco'], ''),
    'Cuenta': gf_inputGet_(input, ['Cuenta'], ''),
    'Moneda': gf_normMon_(gf_inputGet_(input, ['Moneda'], 'ARS')),
    'Monto': gf_numberOrBlank_(gf_inputGet_(input, ['Monto'], '')),
    'Día': gf_numberOrBlank_(gf_inputGet_(input, ['Día', 'Dia'], '')),
    'Fecha': gf_inputGet_(input, ['Fecha'], ''),
    'OK': gf_boolOrDefault_(gf_inputGet_(input, ['OK'], false), false),
    'Pagado': gf_boolOrDefault_(gf_inputGet_(input, ['Pagado'], false), false),
    'FlagResumenMes': gf_boolOrDefault_(gf_inputGet_(input, ['FlagResumenMes'], true), true),
    'ExcluirDash': gf_boolOrDefault_(gf_inputGet_(input, ['ExcluirDash'], false), false),
    'EstadoRegistro': gf_inputGet_(input, ['EstadoRegistro'], 'Pendiente'),
    'ResumenTarjetaID': gf_inputGet_(input, ['ResumenTarjetaID'], ''),
    'Usuario': gf_inputGet_(input, ['Usuario'], gf_getPersonaWebApp_()),
    'Notas': gf_inputGet_(input, ['Notas'], '')
  };
}

/**************************************
 * WRITE FUTUROS_EVENTUALES
 **************************************/

function gf_writeFuturosEventuales_(items) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_FUT_EVENT);
  if (!sh) throw new Error('Falta hoja Futuros_Eventuales.');

  gf_ensureSheetSchema_(sh, GF.SHEET_SCHEMAS[GF.SHEET_FUT_EVENT], { applyFormats: true });

  const arr = Array.isArray(items) ? items : [items];

  gf_writeObjectsToSheet_(sh, arr, {
    startRow: sh.getLastRow() + 1,
    clear: false
  });

  const fechaCol = gf_findColumnByHeader_(sh, 'FechaPlanificada');
  if (fechaCol > 0 && sh.getLastRow() > 1) {
    sh.getRange(2, fechaCol, sh.getLastRow() - 1, 1).setNumberFormat('dd/MM/yyyy');
  }

  return {
    ok: true,
    inserted: arr.length,
    ids: arr.map(x => x['ID'])
  };
}

/**************************************
 * DICCIONARIO
 **************************************/

function gf_getDiccionarioValores_(tipo) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_DICT);
  if (!sh) return [];

  const rows = gf_readObjectsFromSheet_(sh);

  return rows
    .filter(r =>
      String(r['Tipo'] || '').trim() === tipo &&
      gf_boolOrDefault_(r['Activo'], true) &&
      String(r['Valor'] || '').trim()
    )
    .map(r => String(r['Valor']).trim())
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => a.localeCompare(b));
}

function gf_aprenderMovimientoEnDiccionario_(mov) {
  const categoria = String(mov['Categoría'] || mov['Categoria'] || '').trim();
  const subcategoria = String(mov['Subcategoria'] || '').trim();
  const etiqueta = String(mov['Etiqueta'] || '').trim();

  if (categoria) {
    gf_upsertDiccionarioItem_({
      Tipo: 'Categoria',
      Categoria: categoria,
      Subcategoria: '',
      Valor: categoria,
      Activo: true
    });
  }

  if (subcategoria) {
    gf_upsertDiccionarioItem_({
      Tipo: 'Subcategoria',
      Categoria: categoria,
      Subcategoria: subcategoria,
      Valor: subcategoria,
      Activo: true
    });
  }

  if (etiqueta) {
    gf_upsertDiccionarioItem_({
      Tipo: 'Etiqueta',
      Categoria: categoria,
      Subcategoria: subcategoria,
      Valor: etiqueta,
      Activo: true
    });
  }
}

function gf_upsertDiccionarioItem_(item) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_DICT);
  if (!sh) return;

  gf_ensureSheetSchema_(sh, GF.SHEET_SCHEMAS[GF.SHEET_DICT], { applyFormats: true });

  const rows = gf_readObjectsFromSheet_(sh);

  const key = [
    gf_norm_(item.Tipo),
    gf_norm_(item.Categoria),
    gf_norm_(item.Subcategoria),
    gf_norm_(item.Valor)
  ].join('|');

  const existing = rows.find(r => {
    const k = [
      gf_norm_(r['Tipo']),
      gf_norm_(r['Categoria']),
      gf_norm_(r['Subcategoria']),
      gf_norm_(r['Valor'])
    ].join('|');
    return k === key;
  });

  if (existing) return;

  gf_writeObjectsToSheet_(sh, [item], {
    startRow: sh.getLastRow() + 1,
    clear: false
  });
}

/**************************************
 * NORMALIZACIÓN PAYLOAD
 **************************************/

function gf_normalizeWebPayloadBase_(payload, opts) {
  opts = opts || {};

  const usuario = gf_getPersonaWebApp_();
  const descripcion = String(
    gf_inputGet_(payload, ['Descripción', 'Descripcion', 'descripcion'], '')
  ).trim();

  const categoria = String(
    gf_inputGet_(payload, ['Categoría', 'Categoria', 'categoria'], '')
  ).trim();

  const subcategoria = String(
    gf_inputGet_(payload, ['Subcategoria', 'subcategoria'], '')
  ).trim();

  const etiqueta = String(
    gf_inputGet_(payload, ['Etiqueta', 'etiqueta'], '')
  ).trim();

  const banco = String(
    gf_inputGet_(payload, ['Banco', 'banco'], '')
  ).trim();

  const cuenta = String(
    gf_inputGet_(payload, ['Cuenta', 'cuenta'], '')
  ).trim();

  const moneda = gf_normMon_(
    gf_inputGet_(payload, ['Moneda', 'moneda'], 'ARS')
  );

  const monto = Number(gf_inputGet_(payload, ['Monto', 'monto'], 0)) || 0;

  const notas = String(
    gf_inputGet_(payload, ['Notas', 'notas'], '')
  ).trim();

  const personaPayload = String(
    gf_inputGet_(payload, ['Persona', 'persona'], '')
  ).trim();

  const persona = usuario || personaPayload || 'Usuario WebApp';

  const fechaRaw = gf_inputGet_(payload, ['Fecha', 'fecha', 'FechaPlanificada'], '');
  const fecha = gf_parseFlexibleDate_(fechaRaw);

  if (opts.requireFecha && !(fecha instanceof Date)) {
    throw new Error('Falta una fecha válida.');
  }

  return {
    usuario,
    persona,
    descripcion,
    categoria,
    subcategoria,
    etiqueta,
    banco,
    cuenta,
    moneda,
    monto,
    notas,
    fecha
  };
}

function gf_parseFlexibleDate_(v) {
  if (!v) return '';
  if (v instanceof Date && !isNaN(v.getTime())) return v;

  const s = String(v).trim();

  // yyyy-mm-dd
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  // dd/mm/yyyy
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d;
}

/**************************************
 * PERSONA / USUARIO
 **************************************/

function gf_getPersonaWebApp_() {
  try {
    const email = Session.getActiveUser().getEmail() || '';
    if (email) return email;
  } catch (e) {}
  return '';
}
