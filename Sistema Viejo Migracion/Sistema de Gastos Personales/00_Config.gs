/**************************************
 * 00_Config.gs - Fase 2.1
 * V3 base + hojas V2 + importador tarjetas + Lectura B
 **************************************/

const GF_BASE_MOV_HEADERS = [
  'ID','ParentID','Tipo','Subtipo','Origen','Persona','Descripción',
  'Categoría','Subcategoria','Etiqueta','Banco','Cuenta','Moneda','Monto',
  'Día','Fecha','Pagado','FlagResumenMes','ExcluirDash','EstadoRegistro',
  'ResumenTarjetaID','Tarjeta','Usuario','Notas'
];

const GF_CARGA_HEADERS = [
  'ID','ParentID','Tipo','Subtipo','Origen','Persona','Descripción',
  'Categoría','Subcategoria','Etiqueta','Banco','Cuenta','Moneda','Monto',
  'Día','Fecha','OK','Pagado','FlagResumenMes','ExcluirDash','EstadoRegistro',
  'ResumenTarjetaID','Tarjeta','Usuario','Notas'
];

const GF_HIST_HEADERS = [
  ...GF_BASE_MOV_HEADERS,
  'Mes','MovidoEn','TC_USDARS','FechaConsumoOriginal','CreatedAt','UpdatedAt','NumeroComprobante'
];

const GF_OBLIG_HEADERS = [
  'Activo','ObligacionID','Tipo','Subtipo','PersonaDefault','Descripción',
  'Categoría','Subcategoria','Etiqueta','Banco','Cuenta','Moneda',
  'MontoDefault','DiaSugerido','FlagResumenMesDefault','ExcluirDashDefault',
  'PagadoDefault','AutoCalendar','Notas'
];

const GF_ING_HEADERS = [
  'Activo','IngresoID','Persona','Descripción','Categoría','Subcategoria',
  'Etiqueta','Banco','Moneda','MontoDefault','DiaSugerido',
  'FlagResumenMesDefault','Notas'
];

// Fase 3.a: headers de las hojas renombradas
// Sin Persona: el match es por pool familiar (Juan+María juntos). Ver CLAUDE.md Fase 3.
const GF_GASTOS_ESP_HEADERS = [
  'Activo','Categoria','Subcategoria','Etiqueta','Moneda','Banco','MontoEsperado','DiaVencimiento','Notas'
];
const GF_INGRESOS_ESP_HEADERS = [
  'Activo','Categoria','Subcategoria','Etiqueta','Moneda','Banco','MontoEsperado','DiaVencimiento','Notas','Persona'
];

const GF_DICT_HEADERS = ['Tipo','Categoria','Subcategoria','Valor','Activo'];

const GF_DICT_NORM_HEADERS = ['Activo','Tipo','Patron','Reemplazo','Notas'];

// Seed inicial de reglas de normalización (resultado del scan 2026-05)
const GF_DICT_NORM_SEED = [
  // Prefijos de procesadores de pago — ruido puro, no identifican al comercio
  [true, 'prefix', 'MERPAGO*', '', 'Mercado Pago cobros — 91 entradas dict (2026-05)'],
  [true, 'prefix', 'DLO*',     '', 'DoorDash/DLO procesador — 10 entradas dict (2026-05)'],
  // Sufijos de tracking IDs largos (autopistas, gym, etc.) — 8+ dígitos al final
  [true, 'regex',  '\\s*\\d{8,}$', '', 'Códigos de transacción al final (autopistas, gym)'],
  // Sufijos de cuota BBVA — C.02/03 o C2/6 al final (parser no siempre los quita)
  [true, 'regex',  '\\s*C\\.?\\d{1,2}/\\d{1,2}$', '', 'Cuota BBVA al final: C.02/03 o C2/6 (2026-05)'],
  // Fechas DD/MM/YYYY o DD/MM/YY embebidas en la descripción
  [true, 'regex',  '\\s*\\d{1,2}/\\d{1,2}/\\d{2,4}', '', 'Fecha DD/MM/YYYY en descripción (2026-05)'],
  // Sufijo mes-año en español — Comprobantes: "- Feb 2026", "- Febrero 2026"
  [true, 'regex',  '\\s*-\\s*(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\\.?\\s*\\d{4}$', '', 'Período mes-año en español al final (Comprobantes, 2026-05)'],
  // Sufijo cuota ABL/genérico — "- Cuota 04/2026"
  [true, 'regex',  '\\s*-\\s*cuota\\s+\\d+/\\d+$', '', 'Sufijo cuota al final: "- Cuota 04/2026" (2026-05)']
];

const GF_FUT_EVENT_HEADERS = [
  'ID','Tipo','Subtipo','Origen','Persona','Descripción','Categoría',
  'Subcategoria','Etiqueta','Banco','Cuenta','Moneda','Monto',
  'FechaPlanificada','MesDestino','FlagResumenMes','ExcluirDash',
  'EstadoRegistro','Usuario','Notas','CreatedAt','UpdatedAt'
];

const GF_TC_HEADERS = ['Fecha','TC_USDARS','ActualizadoEn'];
const GF_LOG_HEADERS = ['Cuando','Dónde','Mensaje','Stack','Sheet','Rango'];

const GF_SHARE_TOKENS_TMP_HEADERS = [
  'token','route','fileId','fileName','mimeType','sizeBytes',
  'createdAt','expiresAt','status','openedAt','source','error'
];

const GF_GASTOS_MANUAL_HEADERS = [
  'ID','Fecha','Persona','Descripción','Banco','Moneda','Monto',
  'Categoría','Subcategoria','Etiqueta','Notas','CargadoPor','TC_USDARS',
  'Mes','IncluidoEnReportes','HistoricoID','CreatedAt'
];

const GF_TARJETAS_RESUMEN_HEADERS = [
  'ResumenID','TarjetaCodigo','Banco','Tarjeta','Moneda',
  'MesResumen','FechaCierre','FechaVencimiento','CuentaDebitoDetalle',
  'TotalARS','TotalUSD','PagoMinimoARS',
  'EstadoImport','ImportadoEn','ImportadoPor','HashPDF','Observaciones'
];

const GF_TARJETAS_RAW_HEADERS = [
  'RawID','ResumenID','Seq','TipoLinea','FechaConsumo','DescripcionRaw',
  'NroCupon','CuotaActual','CuotaTotal','Moneda','Monto',
  'PersonaDetectada','EsBonificacion','EsReverso','EsImpuesto','EsPagoAnterior',
  'HashMovimiento','EstadoMatch','MapeoID','Confianza',
  'DescripcionLimpia','Categoría','Subcategoria','Etiqueta','PersonaFinal',
  'AccionUsuario','ImportadoEn','ImportadoPor','Notas'
];
// AccionUsuario valores válidos: ''(incluir normal) | 'IncluirNoDash' | 'ExcluirTotalmente' | 'Ignorar'

const GF_TARJETAS_MOV_HEADERS = [
  'MovID','RawID','ResumenID','HashMovimiento',
  'FechaConsumo','FechaImputacion','MesImputacion',
  'Persona','Descripción','DescripcionRaw',
  'Categoría','Subcategoria','Etiqueta',
  'Banco','Tarjeta','CuentaDebitoDetalle','Moneda','Monto','TC_USDARS',
  'CuotaActual','CuotaTotal','HistoricoID','CreatedAt'
];

const GF_TARJETAS_DICT_HEADERS = [
  'MapeoID','Patron','TipoMatch','BancoFiltro','TarjetaFiltro',
  'DescripcionLimpia','Categoría','Subcategoria','Etiqueta',
  'PersonaDefault','AccionDefault','Confianza','UsoCount','UltimoUso',
  'Activo','CreadoPor','CreadoEn','Notas'
]; // @deprecated — mismo que GF_DICT_APRENDIDO_HEADERS, mantenido para alias legacy

// Fase 3.0: schema unificado Diccionario_Aprendido (Tarjeta + Manual + Comprobante)
// AccionDefault valores válidos: ''(incluir normal) | 'IncluirNoDash' | 'ExcluirTotalmente' | 'Ignorar'
// Origen valores válidos: 'Tarjeta' | 'Manual' | 'Comprobante' | 'Historico'
const GF_DICT_APRENDIDO_HEADERS = [
  'MapeoID','Patron','PatronOriginal','TipoMatch','BancoFiltro','TarjetaFiltro',
  'DescripcionLimpia','Categoría','Subcategoria','Etiqueta',
  'PersonaDefault','AccionDefault','Confianza','UsoCount','UltimoUso',
  'Activo','Origen','CreadoPor','CreadoEn','Notas'
];

const GF_DASH_CACHE_HEADERS = [
  'Mes','UpdatedAt','Status','KpisJSON','ByCatJSON',
  'BySubcatJSON','ByBancoJSON','ByDescJSON','ByDiaJSON',
  'IndicadoresJSON','InsightsJSON'
];

const GF_VISTA_REPORTES_HEADERS = [
  'Origen','Suborigen','ID','Fecha','Mes','Tipo','Subtipo','Persona',
  'Descripción','Categoría','Subcategoria','Etiqueta','Banco','Tarjeta',
  'Moneda','Monto','TC_USDARS','Monto_ARS_EQ','Monto_USD_EQ',
  'FlagResumenMes','ExcluirDash','EstadoRegistro','Usuario'
];

// ============ BANCOS VÁLIDOS (canónicos) ============
// TODO(C10): migrate to Diccionario sheet (Tipo='Banco') when needed.
const GF_BANCOS_VALIDOS = ['BBVA','Galicia','Personal Pay','Efectivo'];

const GF_BANCO_ALIASES = {
  'bbva': 'BBVA',
  'bbva/frances': 'BBVA',
  'bbva frances': 'BBVA',
  'bbva francés': 'BBVA',
  'banco bbva': 'BBVA',
  'galicia': 'Galicia',
  'banco galicia': 'Galicia',
  'personal pay': 'Personal Pay',
  'personalpay': 'Personal Pay',
  'pp': 'Personal Pay',
  'efectivo': 'Efectivo',
  'efectivo/transf': 'Efectivo',
  'efectivo / transf': 'Efectivo',
  'efectivo transf': 'Efectivo',
  'transferencia': 'Efectivo',
  'transf': 'Efectivo',
  'efectivo y transf': 'Efectivo'
};

// ============ CATÁLOGO DE TARJETAS ============
const GF_TARJETAS_CATALOGO = [
  ['BBVA-VISA-SIG',   'BBVA',    'Visa Signature',   'C.A. 0203124134', 'Pago Visa BBVA Signature'],
  ['BBVA-MASTER-BLK', 'BBVA',    'Mastercard Black', 'C.A. 0203124134', 'Pago Master BBVA Black'],
  ['GAL-VISA',        'Galicia', 'Visa',             'C.A. 0406142030', 'Pago Visa Galicia'],
  ['GAL-MASTER-BLK',  'Galicia', 'Mastercard Black', 'C.A. 0406142034', 'Pago Master Galicia Black']
];

// ============ USUARIOS ============
const GF_USUARIOS_HEADERS = ['Email','Persona','Rol','Activo','Notas'];

const GF_USUARIOS_SEED = [
  ['jpcofano@gmail.com',          'Juan',     'admin',       true, 'Owner'],
  ['marialascano@gmail.com',      'María',    'admin',       true, 'Personal'],
  ['maria.lascano@accenture.com', 'María',    'admin',       true, 'Trabajo'],
  ['',                            'Federico', 'dependiente', true, 'Hijo'],
  ['',                            'Sofía',    'dependiente', true, 'Hija']
];

const GF_PERSONA_ALIASES = {
  'maria lascano':          'María',
  'lascano,maria':          'María',
  'lascano maria':          'María',
  'juan pablo cofano':      'Juan',
  'cofano,juan':            'Juan',
  'juan cofano':            'Juan',
  'federico n cofano':      'Federico',
  'federico nicolas cofano':'Federico',
  'sofia cofano':           'Sofía',
  'sofía cofano':           'Sofía'
};

const GF = {
  VERSION: '2026.04.16.fase2_1_sharetemp',
  SCHEMA_VERSION: '2026.04.16.fase2_1_sharetemp',

  SHEET_CONFIG: 'Config',
  SHEET_CARGA: 'Carga',
  SHEET_HIST: 'Historico',
  SHEET_RESUMEN: 'ResumenMes',
  SHEET_DASH: 'Dash_Mensual',       // alias para callers legacy (60_Dash.gs, 11_WebApp.gs)
  SHEET_DASH_MENSUAL: 'Dash_Mensual',
  SHEET_DASH_ANUAL: 'Dash_Anual',
  SHEET_TC: 'TC_Diario',
  SHEET_OBLIG: 'Obligaciones',           // @deprecated Fase 3.a → usar SHEET_GASTOS_ESPERADOS
  SHEET_ING_PLANT: 'IngresosPlantilla',  // @deprecated Fase 3.a → usar SHEET_INGRESOS_ESPERADOS
  SHEET_GASTOS_ESPERADOS: 'GastosEsperados',
  SHEET_INGRESOS_ESPERADOS: 'IngresosEsperados',
  SHEET_DICT: 'Diccionario',
  SHEET_LOG: 'Log',
  SHEET_SHARE_TOKENS_TMP: '_ShareTokensTmp',
  SHEET_FUT_EVENT: 'Futuros_Eventuales',
  SHEET_GASTOS_MANUAL: 'Gastos_Manuales',
  SHEET_TARJETAS_RESUMEN: 'Tarjetas_Resumen',
  SHEET_TARJETAS_RAW: 'Tarjetas_Raw',
  SHEET_TARJETAS_MOV: 'Tarjetas_Movimientos',
  SHEET_TARJETAS_DICT: 'Tarjetas_Diccionario',  // @deprecated Fase 3.0 → usar SHEET_DICT_APRENDIDO
  SHEET_DICT_APRENDIDO: 'Diccionario_Aprendido',
  SHEET_DASH_CACHE: 'Dash_Cache',
  SHEET_DICT_NORM:      'Diccionario_Normalizacion',
  SHEET_VISTA_REPORTES: 'Vista_Reportes',
  SHEET_USUARIOS: 'Usuarios',

  CFG_MES_CELL: 'B1',
  CFG_TC_CELL: 'B2',
  CFG_TC_TS_CELL: 'B3',
  CFG_CAL_ID_CELL: 'B4',
  CFG_CAL_HHMM_CELL: 'B5',
  CFG_CAL_POPUP_CELL: 'B6',
  CFG_CAL_DUR_CELL: 'B7',
  CFG_ANTHROPIC_KEY_CELL: 'B18',
  CFG_PDF_FOLDER_CELL: 'B19',
  CFG_SHARE_TEMP_FOLDER_CELL: 'B20',
  CFG_SHARE_TOKEN_TTL_HOURS_CELL: 'B21',
  CFG_SHARE_MAX_SIZE_MB_CELL: 'B22',

  PROP_SCHEMA_VERSION: 'GF_SCHEMA_VERSION',

  ENUMS: {
    TIPO: ['Gasto','Ingreso'],
    SUBTIPO: ['ObligacionMensual','IngresoMensual','Manual','EventualDirecto',
      'EventualFuturo','TarjetaResumen','TarjetaDetalleImportado',
      'TarjetaImpuesto','TarjetaReintegro','Otro'],
    ORIGEN: ['Carga','WebApp','ImportTarjeta','Migracion','ManualSheet','Sistema'],
    MONEDA: ['ARS','USD'],
    ESTADO_REGISTRO: ['Pendiente','Registrado','Importado','Planificado','Reemplazado','Archivado'],
    ROL_USUARIO: ['admin','viewer','dependiente'],
    TIPO_LINEA_RAW: ['consumo','cuota','impuesto','pago_anterior','bonificacion','reverso','reintegro_percepcion'],
    ESTADO_MATCH: ['pending','auto','manual','ignored','confirmed'],
    TIPO_MATCH: ['exact','prefix','contains','regex'],
    ESTADO_IMPORT: ['pendiente_revision','confirmado','aplicado','archivado']
  },

  // TODO(C10): migrate to Diccionario sheet (Tipo='CategoriaIngreso') when needed.
  CATS_INGRESO: ['Sueldo', 'Ingresos'],

  SHEET_SCHEMAS: {
    'Carga':                { headers: GF_CARGA_HEADERS,            freezeRows: 1 },
    'Historico':            { headers: GF_HIST_HEADERS,             freezeRows: 1 },
    'Obligaciones':         { headers: GF_OBLIG_HEADERS,            freezeRows: 1 }, // legacy, renombrar en Fase 3.a
    'IngresosPlantilla':    { headers: GF_ING_HEADERS,              freezeRows: 1 }, // legacy, renombrar en Fase 3.a
    'GastosEsperados':      { headers: GF_GASTOS_ESP_HEADERS,       freezeRows: 1 },
    'IngresosEsperados':    { headers: GF_INGRESOS_ESP_HEADERS,     freezeRows: 1 },
    'Diccionario':          { headers: GF_DICT_HEADERS,             freezeRows: 1 },
    'Futuros_Eventuales':   { headers: GF_FUT_EVENT_HEADERS,        freezeRows: 1 },
    'TC_Diario':            { headers: GF_TC_HEADERS,               freezeRows: 1 },
    'Log':                  { headers: GF_LOG_HEADERS,              freezeRows: 1 },
    '_ShareTokensTmp':      { headers: GF_SHARE_TOKENS_TMP_HEADERS, freezeRows: 1 },
    'Gastos_Manuales':      { headers: GF_GASTOS_MANUAL_HEADERS,    freezeRows: 1 },
    'Tarjetas_Resumen':     { headers: GF_TARJETAS_RESUMEN_HEADERS, freezeRows: 1 },
    'Tarjetas_Raw':         { headers: GF_TARJETAS_RAW_HEADERS,     freezeRows: 1 },
    'Tarjetas_Movimientos': { headers: GF_TARJETAS_MOV_HEADERS,     freezeRows: 1 },
    'Tarjetas_Diccionario':   { headers: GF_TARJETAS_DICT_HEADERS,    freezeRows: 1 }, // legacy
    'Diccionario_Aprendido':  { headers: GF_DICT_APRENDIDO_HEADERS,  freezeRows: 1 },
    'Diccionario_Normalizacion': { headers: GF_DICT_NORM_HEADERS,   freezeRows: 1, seed: GF_DICT_NORM_SEED },
    'Vista_Reportes':       { headers: GF_VISTA_REPORTES_HEADERS,   freezeRows: 1 },
    'Dash_Cache':           { headers: GF_DASH_CACHE_HEADERS,        freezeRows: 1 },
    'Usuarios':             { headers: GF_USUARIOS_HEADERS,         freezeRows: 1, seed: GF_USUARIOS_SEED }
  }
};

const GF_THEME = {
  titleBg: '#111827', titleFg: '#FFFFFF',
  headerBg: '#F3F4F6', headerFg: '#111827',
  border: '#E5E7EB', sheetBg: '#FFFFFF'
};
