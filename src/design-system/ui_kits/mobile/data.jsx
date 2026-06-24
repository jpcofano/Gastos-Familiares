// Fake data for the mobile UI kit — June 2026.
const M_TC = 1180;
const _m = (d, descripcion, monto, tipo, categoria, persona, banco = 'BBVA', moneda = 'ARS') => ({
  id: descripcion.toLowerCase().replace(/\s+/g, '-') + '-' + d,
  fecha: new Date(2026, 5, d), descripcion, monto, tipo, categoria, persona, banco, moneda,
  tcUsdArs: moneda === 'USD' ? M_TC : null,
});

const M_MOVS = [
  _m(2, 'Sueldo María', 980000, 'Ingreso', 'Ingresos', 'María', 'BBVA'),
  _m(3, 'Alquiler', 420000, 'Gasto', 'Vivienda', 'Juan', 'Galicia'),
  _m(4, 'Supermercado Coto', 89450, 'Gasto', 'Supermercado', 'María', 'BBVA'),
  _m(5, 'Expensas', 134200, 'Gasto', 'Vivienda', 'Juan', 'Galicia'),
  _m(6, 'Edenor — luz', 38900, 'Gasto', 'Servicios', 'Juan', 'Personal Pay'),
  _m(9, 'Honorarios Juan', 1250, 'Ingreso', 'Ingresos', 'Juan', 'Galicia', 'USD'),
  _m(10, 'Nafta YPF', 52300, 'Gasto', 'Transporte', 'Juan', 'MercadoPago'),
  _m(12, 'Farmacia', 24600, 'Gasto', 'Salud', 'María', 'Efectivo'),
  _m(14, 'Colegio Sofía', 186000, 'Gasto', 'Educación', 'María', 'BBVA'),
  _m(18, 'Supermercado Día', 63120, 'Gasto', 'Supermercado', 'María', 'MercadoPago'),
  _m(22, 'Cena restaurante', 71400, 'Gasto', 'Ocio', 'María', 'Efectivo'),
];

// Medios de pago (bancos / billeteras / efectivo) — editables en config.
const M_BANCOS = [
  { id: 'bbva', nombre: 'BBVA', color: '#072146', tipo: 'Banco' },
  { id: 'galicia', nombre: 'Galicia', color: '#ff7300', tipo: 'Banco' },
  { id: 'pp', nombre: 'Personal Pay', color: '#5b2d8e', tipo: 'Billetera' },
  { id: 'mp', nombre: 'MercadoPago', color: '#00a5e6', tipo: 'Billetera' },
  { id: 'efec', nombre: 'Efectivo', color: '#16a34a', tipo: 'Efectivo' },
];

const M_ESPERADOS = [
  { id: 'alq', label: 'Alquiler', persona: 'Juan', monto: 420000, moneda: 'ARS', estado: 'pagado' },
  { id: 'exp', label: 'Expensas', persona: 'Juan', monto: 134200, moneda: 'ARS', estado: 'pagado' },
  { id: 'col', label: 'Colegio Sofía', persona: 'María', monto: 186000, moneda: 'ARS', estado: 'pagado' },
  { id: 'visa', label: 'Tarjeta Visa', persona: 'Juan', monto: 312900, moneda: 'ARS', estado: 'parcial' },
  { id: 'luz', label: 'Edenor — luz', persona: 'Juan', monto: 38900, moneda: 'ARS', estado: 'por_confirmar' },
  { id: 'net', label: 'Netflix', persona: 'Sofía', monto: 7990, moneda: 'ARS', estado: 'automatico' },
  { id: 'gas', label: 'Metrogas', persona: 'Juan', monto: 21500, moneda: 'ARS', estado: 'pendiente' },
  { id: 'inet', label: 'Internet Fibertel', persona: 'Juan', monto: 29900, moneda: 'ARS', estado: 'vencido' },
  { id: 'pre', label: 'Prepaga OSDE', persona: 'María', monto: 168000, moneda: 'ARS', estado: 'no_registrado' },
];

const M_ENTRANTES = [
  { id: 'e1', nombre: 'Edenor_factura_06.pdf', tipo: 'Comprobante', estado: 'wait', detalle: 'Extrayendo datos…' },
  { id: 'e2', nombre: 'Resumen_Visa_junio.pdf', tipo: 'Resumen tarjeta', estado: 'ok', detalle: 'Conciliado · 14 consumos' },
  { id: 'e3', nombre: 'Aysa_factura.pdf', tipo: 'Comprobante', estado: 'warn', detalle: 'Falta categoría' },
];

const M_MIEMBRO = { id: 'maria', nombre: 'María', rol: 'admin', email: 'maria@familia.app' };

const M_MIEMBROS = [
  { id: 'maria', nombre: 'María', rol: 'admin', email: 'maria@familia.app', color: '#065f46' },
  { id: 'juan', nombre: 'Juan', rol: 'admin', email: 'juan@familia.app', color: '#1d4ed8' },
  { id: 'sofia', nombre: 'Sofía', rol: 'dependiente', email: 'sofia@familia.app', color: '#b45309' },
];

// Categorías con color y gasto del mes (eq ARS).
const M_CATEGORIAS_CFG = [
  { id: 'viv', nombre: 'Vivienda', color: '#065f46', mov: 2, gasto: 554200 },
  { id: 'ser', nombre: 'Servicios', color: '#0284c7', mov: 1, gasto: 38900 },
  { id: 'sup', nombre: 'Supermercado', color: '#d97706', mov: 2, gasto: 152570 },
  { id: 'tra', nombre: 'Transporte', color: '#7c3aed', mov: 1, gasto: 52300 },
  { id: 'sal', nombre: 'Salud', color: '#dc2626', mov: 1, gasto: 24600 },
  { id: 'edu', nombre: 'Educación', color: '#0891b2', mov: 1, gasto: 186000 },
  { id: 'oci', nombre: 'Ocio', color: '#db2777', mov: 1, gasto: 71400 },
  { id: 'ing', nombre: 'Ingresos', color: '#16a34a', mov: 2, gasto: 0 },
];

// Tipo de cambio: actual + histórico reciente.
const M_TC_ACTUAL = { valor: 1180, modo: 'manual', actualizado: '22/06/2026' };
const M_TC_HIST = [
  { mes: 'Junio 2026', valor: 1180 },
  { mes: 'Mayo 2026', valor: 1145 },
  { mes: 'Abril 2026', valor: 1120 },
  { mes: 'Marzo 2026', valor: 1090 },
];

// Histórico (Dashboard): gastos por mes (eq ARS) y anual por categoría.
const M_HIST_MESES = [
  { mes: 'Ene', gasto: 842000, mov: 24 },
  { mes: 'Feb', gasto: 910500, mov: 27 },
  { mes: 'Mar', gasto: 788300, mov: 22 },
  { mes: 'Abr', gasto: 1024700, mov: 31 },
  { mes: 'May', gasto: 968200, mov: 29 },
  { mes: 'Jun', gasto: 1079970, mov: 11 },
];
const M_HIST_CAT_ANUAL = {
  anio: 2026,
  total: 5613670,
  cats: [
    { nombre: 'Vivienda', color: '#065f46', gasto: 2218800 },
    { nombre: 'Educación', color: '#0891b2', gasto: 1116000 },
    { nombre: 'Supermercado', color: '#d97706', gasto: 915420 },
    { nombre: 'Servicios', color: '#0284c7', gasto: 412300 },
    { nombre: 'Transporte', color: '#7c3aed', gasto: 313800 },
    { nombre: 'Ocio', color: '#db2777', gasto: 357350 },
    { nombre: 'Salud', color: '#dc2626', gasto: 280000 },
  ],
};

Object.assign(window, { M_TC, M_MOVS, M_BANCOS, M_ESPERADOS, M_ENTRANTES, M_MIEMBRO, M_MIEMBROS, M_CATEGORIAS_CFG, M_TC_ACTUAL, M_TC_HIST, M_HIST_MESES, M_HIST_CAT_ANUAL });

// ── Dashboard "Mensual" (rich analytics, paridad legacy 60_Dash.gs) ──────────
// Montos guardados en USD; el ARS-eq se deriva con dash.tc. Toggle ARS/USD.
const M_DASH = {
  tc: 1485,
  mesLabel: 'Junio 2026',
  balanceUsd: 1526, balancePositivo: true,
  ingresosUsd: 4086, salidasUsd: 2560,
  movimientos: 34,
  gastoPromedioUsd: 75, diasConGasto: 14,
  promedioDiarioUsd: 183,
  finDeSemanaPct: 1, top3Pct: 92,
  bancoDominante: 'Efectivo',
  vsMesAnteriorPct: -45, vsMesLabel: 'Mayo 2026', lecturaRapida: 'Bajó el gasto',
  categoriaTop: { nombre: 'Educación y chicos', pct: 65 },
  movMasAlto: { usd: 871, desc: 'Escuela Philips (ITPA SA) — Federico · Arancel + Taller + Transporte' },
  picoDia: { fecha: '10/06', dow: 'mié', usd: 1563, diaNum: 10 },
  categorias: [
    { nombre: 'Educación y chicos', color: '#4f8ef7', pct: 65, count: 9, usd: 1693 },
    { nombre: 'Casa', color: '#2bb673', pct: 21, count: 7, usd: 537 },
    { nombre: 'Personal', color: '#f5a623', pct: 5, count: 6, usd: 132 },
    { nombre: 'Salud', color: '#8b5cf6', pct: 3, count: 2, usd: 87 },
    { nombre: 'Alimentación cotidiana', color: '#ef5350', pct: 2, count: 7, usd: 60 },
    { nombre: 'Impuestos y finanzas', color: '#06b6d4', pct: 2, count: 3, usd: 51 },
    { nombre: 'Otros', color: '#f97316', pct: 2, count: 2, usd: 48 },
  ],
  subcategorias: [
    { nombre: 'Colegio Federico', color: '#4f8ef7', valor: 871, pct: 34 },
    { nombre: 'Colegio Sofi', color: '#2bb673', valor: 564, pct: 22 },
    { nombre: 'Expensas', color: '#f5a623', valor: 267, pct: 10 },
    { nombre: 'Colegio Fede', color: '#8b5cf6', valor: 152, pct: 6 },
    { nombre: 'Internet y teléfono', color: '#ef5350', valor: 99, pct: 4 },
  ],
  // Serie diaria (USD por día, 30 días). Pico día 10.
  diaria: [40, 0, 55, 0, 70, 30, 0, 0, 45, 1563, 0, 60, 0, 210, 35, 180, 0, 0, 50, 0, 25, 0, 90, 0, 0, 40, 0, 0, 30, 20],
  // Por descripción (top gastos del mes, USD).
  porDescripcion: [
    { desc: 'Escuela Philips — Federico', usd: 871, count: 3 },
    { desc: 'Colegio Sofi — cuota', usd: 564, count: 2 },
    { desc: 'Expensas edificio', usd: 267, count: 1 },
    { desc: 'Internet y teléfono', usd: 99, count: 1 },
    { desc: 'Supermercado', usd: 84, count: 5 },
  ],
};

Object.assign(window, { M_DASH });

// ── Dashboard "Anual" (paridad legacy + mejoras) ────────────────────────────
const M_ANUAL = {
  anio: 2026,
  balanceUsd: 3875, ingresosUsd: 27426, salidasUsd: 23551,
  promedioMensualUsd: 2044, mesMasAlto: 'Mar', mesMasBajo: 'Jul', tendenciaPct: 18,
  mesesConDatos: 6, comparacionInteranualPct: 117, mejorMesAhorro: 'Ene',
  meses: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
  salidasPorMes: [1800, 2100, 3200, 2600, 2400, 2560, 1200, 1900, 2000, 2300, 2100, 1391],
  ingresosPorMes: [3100, 2400, 2800, 2600, 2500, 4086, 1400, 2000, 2100, 2300, 2200, 1936],
  categorias: [
    { nombre: 'Educación y chicos', color: '#4f8ef7', usd: 6925 },
    { nombre: 'Alimentación cotidiana', color: '#ef5350', usd: 4248 },
    { nombre: 'Casa', color: '#2bb673', usd: 4200 },
    { nombre: 'Auto', color: '#8b5cf6', usd: 1418 },
    { nombre: 'Salidas', color: '#f5a623', usd: 1287 },
    { nombre: 'Vacaciones y viajes', color: '#06b6d4', usd: 1267 },
    { nombre: 'Personal', color: '#ec4899', usd: 1075 },
    { nombre: 'Otros', color: '#f97316', usd: 763 },
    { nombre: 'Salud', color: '#14b8a6', usd: 548 },
    { nombre: 'Indumentaria', color: '#a855f7', usd: 412 },
    { nombre: 'Impuestos y finanzas', color: '#0284c7', usd: 173 },
    { nombre: 'Transporte general', color: '#84cc16', usd: 151 },
  ],
  mesAMes: [
    { mes: 'Ene', usd: 1261, delta: null },
    { mes: 'Feb', usd: 2783, delta: 121 },
    { mes: 'Mar', usd: 7329, delta: 163 },
    { mes: 'Abr', usd: 1486, delta: -80 },
    { mes: 'May', usd: 2408, delta: 62 },
    { mes: 'Jun', usd: 2560, delta: 6 },
  ],
};

Object.assign(window, { M_ANUAL });
