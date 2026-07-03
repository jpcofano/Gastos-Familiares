// Fake data for the mobile UI kit — June 2026. Reseed con el modelo REAL
// (semilla Firestore 2026-06-19). Ver docs/modelo-datos-real.md.
// Taxonomía de 3 niveles: Categoría → Subcategoría → Etiqueta.
const M_TC = 1454; // TC USD→ARS (último MEP, hoja Config/ResumenMes)
const _m = (d, descripcion, monto, tipo, categoria, subcat, persona, banco = 'BBVA', moneda = 'ARS') => ({
  id: descripcion.toLowerCase().replace(/\s+/g, '-') + '-' + d,
  fecha: new Date(2026, 5, d), descripcion, monto, tipo, categoria, subcat, persona, banco, moneda,
  tcUsdArs: moneda === 'USD' ? M_TC : null,
});

const M_MOVS = [
  _m(2, 'Sueldo María', 980000, 'Ingreso', 'Ingresos', 'Sueldo', 'María', 'BBVA'),
  _m(3, 'Expensas Del Signo', 134200, 'Gasto', 'Casa', 'Expensas', 'Juan', 'Personal Pay'),
  _m(4, 'Supermercado Coto', 89450, 'Gasto', 'Alimentación cotidiana', '', 'María', 'BBVA'),
  _m(5, 'Edenor — luz', 38900, 'Gasto', 'Casa', 'Luz', 'Juan', 'BBVA'),
  _m(6, 'Metrogas', 21500, 'Gasto', 'Casa', 'Gas', 'Juan', 'Personal Pay'),
  _m(9, 'Honorarios Juan', 1250, 'Ingreso', 'Ingresos', 'Honorarios', 'Juan', 'Galicia', 'USD'),
  _m(10, 'Nafta YPF', 52300, 'Gasto', 'Auto', 'Cochera', 'Juan', 'Galicia'),
  _m(12, 'Farmacia', 24600, 'Gasto', 'Salud', '', 'María', 'Mercado Pago'),
  _m(14, 'Colegio Federico', 186000, 'Gasto', 'Educación y chicos', 'Colegio Fede', 'María', 'BBVA'),
  _m(16, 'Rugby Federico', 28500, 'Gasto', 'Educación y chicos', 'Actividades extracurriculares', 'Federico', 'Mercado Pago'),
  _m(18, 'Internet Fibertel', 29900, 'Gasto', 'Casa', 'Internet', 'Juan', 'Galicia'),
  _m(22, 'Cena restaurante', 71400, 'Gasto', 'Salidas', '', 'María', 'Galicia'),
  // Pago de hoy (29) que concilia con el esperado 'luz' que vence hoy.
  _m(29, 'Edenor — luz', 38900, 'Gasto', 'Casa', 'Luz', 'Juan', 'Mercado Pago'),
];

// Medios de pago reales (hoja ResumenMes / Obligaciones): banco / billetera / efectivo.
// Efectivo existe en el modelo real → lo mantenemos para paridad, pero como para la
// familia "Efectivo ≈ Mercado Pago", lo plegamos a MP por **alias cosmético**
// (`aliasDe: 'mp'`, `oculto: true`): no se muestra como medio propio, y `medioCanonico()`
// resuelve Efectivo→Mercado Pago al agrupar/etiquetar. El modelo no cambia; es display.
const M_BANCOS = [
  { id: 'bbva', nombre: 'BBVA', color: '#072146', tipo: 'Banco', dominio: 'bbva.com.ar' },
  { id: 'galicia', nombre: 'Galicia', color: '#ff7300', tipo: 'Banco', dominio: 'bancogalicia.com' },
  { id: 'pp', nombre: 'Personal Pay', color: '#5b2d8e', tipo: 'Billetera', dominio: 'personalpay.com.ar' },
  { id: 'mp', nombre: 'Mercado Pago', color: '#00b1ea', tipo: 'Billetera', dominio: 'mercadopago.com.ar' },
  { id: 'efec', nombre: 'Efectivo', color: '#16a34a', tipo: 'Efectivo', dominio: null, aliasDe: 'mp', oculto: true },
];

// Resuelve el nombre de un medio a su canónico (pliega alias cosméticos, p.ej.
// Efectivo → Mercado Pago). Usar en agrupaciones/etiquetas de medio.
const medioCanonico = (nombre) => {
  const m = M_BANCOS.find((b) => b.nombre === nombre);
  if (m && m.aliasDe) {
    const target = M_BANCOS.find((b) => b.id === m.aliasDe);
    return target ? target.nombre : nombre;
  }
  return nombre;
};
window.medioCanonico = medioCanonico;

// Tarjetas reales (hoja Tarjetas_Resumen) — CONFIG: ciclos de cierre/vencimiento.
// Todas crédito. El visor de resúmenes (/tarjetas) es otra vista, solo lectura.
const M_TARJETAS_CFG = [
  { id: 'gal-visa', banco: 'Galicia', red: 'Visa', term: '9474', cierreDia: 22, venceDia: 30, titular: 'María', color: '#1a1f71', tipo: 'credito' },
  { id: 'gal-master', banco: 'Galicia', red: 'Mastercard Black', term: '9714', cierreDia: 22, venceDia: 30, titular: 'María', color: '#eb001b', tipo: 'credito' },
  { id: 'bbva-visa', banco: 'BBVA', red: 'Visa Signature', term: '6678', cierreDia: 7, venceDia: 16, titular: 'Juan', color: '#1a1f71', tipo: 'credito' },
  { id: 'bbva-master', banco: 'BBVA', red: 'Mastercard Black', term: '6679', cierreDia: 7, venceDia: 16, titular: 'Juan', color: '#eb001b', tipo: 'credito' },
];

// Gastos esperados / obligaciones reales (hojas GastosEsperados + Obligaciones).
const M_ESPERADOS = [
  { id: 'colf', label: 'Colegio Federico', persona: 'María', monto: 186000, moneda: 'ARS', estado: 'pagado', categoria: 'Educación y chicos', subcat: 'Colegio Fede', etiqueta: 'hijos' },
  { id: 'cols', label: 'Colegio Sofía', persona: 'María', monto: 168000, moneda: 'ARS', estado: 'pagado', categoria: 'Educación y chicos', subcat: 'Colegio Sofi', etiqueta: 'hijos' },
  { id: 'exp', label: 'Expensas', persona: 'Juan', monto: 134200, moneda: 'ARS', estado: 'pagado', categoria: 'Casa', subcat: 'Expensas', etiqueta: 'rutina-casa' },
  { id: 'luz', label: 'Edenor — luz', persona: 'Juan', monto: 38900, moneda: 'ARS', estado: 'pagado', vence: 29, categoria: 'Casa', subcat: 'Luz', etiqueta: 'rutina-casa', conciliadoCon: 'edenor-—-luz-29' },
  { id: 'gas', label: 'Metrogas', persona: 'Juan', monto: 21500, moneda: 'ARS', estado: 'pendiente', vence: 29, categoria: 'Casa', subcat: 'Gas', etiqueta: 'rutina-casa' },
  { id: 'inet', label: 'Internet Fibertel', persona: 'Juan', monto: 29900, moneda: 'ARS', estado: 'vencido', vence: 22, categoria: 'Casa', subcat: 'Internet', etiqueta: 'rutina-casa' },
  { id: 'mono', label: 'Monotributo Juan', persona: 'Juan', monto: 48000, moneda: 'ARS', estado: 'automatico', vence: 20, categoria: 'Impuestos y finanzas', subcat: 'Monotributo', etiqueta: 'rutina-trabajo' },
  { id: 'galvisa', label: 'Galicia Visa', persona: 'María', monto: 1403704, moneda: 'ARS', estado: 'parcial', vence: 30, categoria: 'Tarjetas', subcat: 'Pago Tarjeta', etiqueta: 'Galicia VisaARS' },
  { id: 'bbvavisa', label: 'BBVA Visa Signature', persona: 'Juan', monto: 2018435, moneda: 'ARS', estado: 'pendiente', vence: 16, categoria: 'Tarjetas', subcat: 'Pago Tarjeta', etiqueta: 'Frances VisaARS' },
];

// Historial de comprobantes/facturas para Cargar. Refleja el card VIVO (F9.60–64):
// estado de vínculo (vinculado|nuevo|proceso|revisar), tipo legible, payee (F9.64:
// factura→emisor, transferencia→destinatario), medio (plataforma), monto, fecha,
// badge de match, tamaño y —en facturas— info de vencimientos.
// El título usa payee; cae al nombre de archivo solo mientras se extrae (proceso).
const M_COMPROBANTES = [
  { id: 'c0', nombre: 'IMG-20260701-WA0015.jpg', tipoDoc: 'transferencia', tipoLabel: 'Transferencia', payee: 'Baggini Juan Francisco', medio: 'Mercado Pago', monto: 45000, fechaFull: '2026-07-01', vinculo: 'vinculado', match: true, kb: 80, detalle: 'Personal', fecha: '01/07' },
  { id: 'c1', nombre: 'Aysa_0111B15526643.pdf', tipoDoc: 'factura', tipoLabel: 'Factura B', payee: 'Agua y Saneamientos Argentinos S.A.', medio: null, monto: 22208.61, fechaFull: '2026-05-30', vinculo: 'vinculado', match: true, kb: 1023, detalle: 'Casa · Agua', fecha: '30/05', vencimientos: { n: 2, segVenc: 22498.48 } },
  { id: 'c2', nombre: 'Edenor_factura_07.pdf', tipoDoc: 'factura', tipoLabel: 'Factura', payee: null, medio: null, monto: null, fechaFull: null, vinculo: 'proceso', match: false, kb: 210, detalle: 'Extrayendo datos…', fecha: '01/07' },
  { id: 'c3', nombre: 'Metrogas_junio.pdf', tipoDoc: 'factura', tipoLabel: 'Factura', payee: 'Metrogas S.A.', medio: null, monto: 18400, fechaFull: '2026-06-20', vinculo: 'revisar', match: false, kb: 96, detalle: 'Falta categoría', fecha: '20/06' },
  { id: 'c4', nombre: 'transf_movistar.jpg', tipoDoc: 'transferencia', tipoLabel: 'Transferencia', payee: 'Telefónica Móviles Arg.', medio: 'Personal Pay', monto: 12999, fechaFull: '2026-06-18', vinculo: 'nuevo', match: false, kb: 64, detalle: 'Telefonía', fecha: '18/06' },
  { id: 'c5', nombre: 'Farmacity_ticket.jpg', tipoDoc: 'factura', tipoLabel: 'Ticket', payee: 'Farmacity', medio: null, monto: 27600, fechaFull: '2026-06-17', vinculo: 'vinculado', match: true, kb: 120, detalle: 'Salud', fecha: '17/06' },
];
const M_RESUMENES_IN = [
  { id: 'r1', nombre: 'Resumen_Visa_junio.pdf', estado: 'ok', detalle: 'Conciliado · 14 consumos', fecha: '16/06' },
  { id: 'r2', nombre: 'Resumen_Master_junio.pdf', estado: 'warn', detalle: 'Revisar 2 consumos', fecha: '16/06' },
  { id: 'r3', nombre: 'Resumen_Amex_mayo.pdf', estado: 'ok', detalle: 'Conciliado · 9 consumos', fecha: '16/05' },
  { id: 'r4', nombre: 'Resumen_Visa_mayo.pdf', estado: 'ok', detalle: 'Conciliado · 12 consumos', fecha: '16/05' },
  { id: 'r5', nombre: 'Resumen_Master_mayo.pdf', estado: 'ok', detalle: 'Conciliado · 7 consumos', fecha: '16/05' },
];

const M_ENTRANTES = [
  { id: 'e1', nombre: 'Edenor_factura_06.pdf', tipo: 'Comprobante', estado: 'wait', detalle: 'Extrayendo datos…' },
  { id: 'e2', nombre: 'Resumen_Visa_junio.pdf', tipo: 'Resumen tarjeta', estado: 'ok', detalle: 'Conciliado · 14 consumos' },
  { id: 'e3', nombre: 'Aysa_factura.pdf', tipo: 'Comprobante', estado: 'warn', detalle: 'Falta categoría' },
];

const M_MIEMBRO = { id: 'maria', nombre: 'María', rol: 'admin', email: 'marialascano@gmail.com' };

// Miembros reales (hoja Usuarios): Juan + María (admin), Federico + Sofía (hijos).
const M_MIEMBROS = [
  { id: 'juan', nombre: 'Juan', rol: 'admin', email: 'jpcofano@gmail.com', color: '#1d4ed8' },
  { id: 'maria', nombre: 'María', rol: 'admin', email: 'marialascano@gmail.com', color: '#065f46' },
  { id: 'fede', nombre: 'Federico', rol: 'dependiente', email: '', color: '#b45309' },
  { id: 'sofia', nombre: 'Sofía', rol: 'dependiente', email: '', color: '#be185d' },
];

// Categorías operativas reales (3 niveles). subcats = subcategorías conocidas de la semilla;
// vacío donde la semilla no las define aún. La Etiqueta es un tag transversal aparte.
const M_CATEGORIAS_CFG = [
  { id: 'edu', nombre: 'Educación y chicos', color: '#4f8ef7', mov: 9, gasto: 2461000, subcats: ['Colegio Fede', 'Colegio Sofi', 'Actividades extracurriculares'] },
  { id: 'casa', nombre: 'Casa', color: '#2bb673', mov: 7, gasto: 781000, subcats: ['Expensas', 'Luz', 'Gas', 'Internet', 'Agua', 'ABL'] },
  { id: 'auto', nombre: 'Auto', color: '#a855f7', mov: 2, gasto: 132000, subcats: ['ABL', 'Cochera'] },
  { id: 'imp', nombre: 'Impuestos y finanzas', color: '#06b6d4', mov: 3, gasto: 96000, subcats: ['Monotributo'] },
  { id: 'tar', nombre: 'Tarjetas', color: '#6366f1', mov: 4, gasto: 0, subcats: ['Pago Tarjeta'] },
  { id: 'ali', nombre: 'Alimentación cotidiana', color: '#ef5350', mov: 7, gasto: 224000, subcats: [] },
  { id: 'sal', nombre: 'Salud', color: '#14b8a6', mov: 2, gasto: 87000, subcats: [] },
  { id: 'sali', nombre: 'Salidas', color: '#f5a623', mov: 3, gasto: 71400, subcats: [] },
  { id: 'per', nombre: 'Personal', color: '#ec4899', mov: 6, gasto: 132000, subcats: [] },
  { id: 'via', nombre: 'Vacaciones y viajes', color: '#0891b2', mov: 0, gasto: 0, subcats: [] },
  { id: 'ing', nombre: 'Ingresos', color: '#16a34a', mov: 4, gasto: 0, subcats: ['Sueldo', 'Honorarios'] },
];

// Tipo de cambio: actual + histórico reciente (rango MEP real, hoja Config/TC_Diario).
// Fuente única = M_TC (igual que GFMoney.tc()); el actual y el mes en curso lo derivan
// para que el mock no pueda divergir. Los meses pasados sí tienen su valor propio.
const M_TC_ACTUAL = { valor: M_TC, modo: 'manual', actualizado: '17/06/2026' };
const M_TC_HIST = [
  { mes: 'Junio 2026', valor: M_TC },
  { mes: 'Mayo 2026', valor: 1402 },
  { mes: 'Abril 2026', valor: 1361 },
  { mes: 'Marzo 2026', valor: 1298 },
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
    { nombre: 'Educación y chicos', color: '#4f8ef7', gasto: 2218800 },
    { nombre: 'Casa', color: '#2bb673', gasto: 1116000 },
    { nombre: 'Alimentación cotidiana', color: '#ef5350', gasto: 915420 },
    { nombre: 'Impuestos y finanzas', color: '#06b6d4', gasto: 412300 },
    { nombre: 'Auto', color: '#a855f7', gasto: 313800 },
    { nombre: 'Salidas', color: '#f5a623', gasto: 357350 },
    { nombre: 'Salud', color: '#14b8a6', gasto: 280000 },
  ],
};

Object.assign(window, { M_TC, M_MOVS, M_BANCOS, M_TARJETAS_CFG, M_ESPERADOS, M_ENTRANTES, M_COMPROBANTES, M_RESUMENES_IN, M_MIEMBRO, M_MIEMBROS, M_CATEGORIAS_CFG, M_TC_ACTUAL, M_TC_HIST, M_HIST_MESES, M_HIST_CAT_ANUAL });

// ── Dashboard "Mensual" (rich analytics, paridad legacy 60_Dash.gs) ──────────
// Montos guardados en USD; el ARS-eq se deriva con dash.tc. Toggle ARS/USD.
const M_DASH = {
  mesLabel: 'Junio 2026',
  balanceUsd: 1526, balancePositivo: true,
  ingresosUsd: 4086, salidasUsd: 2560,
  movimientos: 34,
  gastoPromedioUsd: 75, diasConGasto: 14,
  promedioDiarioUsd: 183,
  finDeSemanaPct: 1, top3Pct: 92,
  bancoDominante: 'Mercado Pago',
  vsMesAnteriorPct: -45, vsMesLabel: 'Mayo 2026', lecturaRapida: 'Bajó el gasto',
  categoriaTop: { nombre: 'Educación y chicos', pct: 65 },
  movMasAlto: { usd: 871, desc: 'Escuela Philips (ITPA SA) — Federico · Arancel + Taller + Transporte' },
  picoDia: { fecha: '10/06', dow: 'mié', usd: 1563, diaNum: 10 },
  categorias: [
    { nombre: 'Educación y chicos', color: '#4f8ef7', pct: 65, count: 9, usd: 1693, subs: [
      { nombre: 'Colegio Federico', usd: 871 }, { nombre: 'Colegio Sofi', usd: 564 },
      { nombre: 'Actividades extra', usd: 152 }, { nombre: 'Útiles y libros', usd: 106 },
    ] },
    { nombre: 'Casa', color: '#2bb673', pct: 21, count: 7, usd: 537, subs: [
      { nombre: 'Expensas', usd: 267 }, { nombre: 'Luz', usd: 180 }, { nombre: 'Internet', usd: 90 },
    ] },
    { nombre: 'Personal', color: '#f5a623', pct: 5, count: 6, usd: 132, subs: [
      { nombre: 'Suscripciones', usd: 60 }, { nombre: 'Varios', usd: 72 },
    ] },
    { nombre: 'Salud', color: '#8b5cf6', pct: 3, count: 2, usd: 87, subs: [
      { nombre: 'Farmacia', usd: 81 }, { nombre: 'Consultas', usd: 6 },
    ] },
    { nombre: 'Alimentación cotidiana', color: '#ef5350', pct: 2, count: 7, usd: 60, subs: [
      { nombre: 'Supermercado', usd: 48 }, { nombre: 'Delivery', usd: 12 },
    ] },
    { nombre: 'Impuestos y finanzas', color: '#06b6d4', pct: 2, count: 3, usd: 51, subs: [
      { nombre: 'Monotributo', usd: 48 }, { nombre: 'Comisiones', usd: 3 },
    ] },
    { nombre: 'Otros', color: '#f97316', pct: 2, count: 2, usd: 48, subs: [
      { nombre: 'Sin categoría', usd: 48 },
    ] },
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
  // mesActualIdx: junio (0-indexed = 5). Meses 0..5 = reales; 6..11 = futuros → proyección.
  mesActualIdx: 5,
  salidasPorMes: [1800, 2100, 3200, 2600, 2400, 2560, 0, 0, 0, 0, 0, 0],
  ingresosPorMes: [3100, 2400, 2800, 2600, 2500, 4086, 0, 0, 0, 0, 0, 0],
  categorias: [
    { nombre: 'Educación y chicos', color: '#4f8ef7', usd: 6925, subs: [
      { nombre: 'Colegio Federico', usd: 3120 }, { nombre: 'Colegio Sofi', usd: 2040 },
      { nombre: 'Actividades', usd: 980 }, { nombre: 'Útiles y libros', usd: 785 },
    ] },
    { nombre: 'Alimentación cotidiana', color: '#ef5350', usd: 4248, subs: [
      { nombre: 'Supermercado', usd: 2810 }, { nombre: 'Verdulería', usd: 720 },
      { nombre: 'Delivery', usd: 718 },
    ] },
    { nombre: 'Casa', color: '#2bb673', usd: 4200, subs: [
      { nombre: 'Expensas', usd: 1880 }, { nombre: 'Servicios', usd: 1240 },
      { nombre: 'Mantenimiento', usd: 680 }, { nombre: 'Hogar', usd: 400 },
    ] },
    { nombre: 'Auto', color: '#8b5cf6', usd: 1418, subs: [
      { nombre: 'Combustible', usd: 760 }, { nombre: 'Seguro', usd: 410 }, { nombre: 'Service', usd: 248 },
    ] },
    { nombre: 'Salidas', color: '#f5a623', usd: 1287, subs: [
      { nombre: 'Restaurantes', usd: 720 }, { nombre: 'Cine y teatro', usd: 340 }, { nombre: 'Bares', usd: 227 },
    ] },
    { nombre: 'Vacaciones y viajes', color: '#06b6d4', usd: 1267, subs: [
      { nombre: 'Pasajes', usd: 820 }, { nombre: 'Alojamiento', usd: 447 },
    ] },
    { nombre: 'Personal', color: '#ec4899', usd: 1075, subs: [
      { nombre: 'Suscripciones', usd: 480 }, { nombre: 'Regalos', usd: 360 }, { nombre: 'Varios', usd: 235 },
    ] },
    { nombre: 'Otros', color: '#f97316', usd: 763, subs: [
      { nombre: 'Sin categoría', usd: 763 },
    ] },
    { nombre: 'Salud', color: '#14b8a6', usd: 548, subs: [
      { nombre: 'Farmacia', usd: 300 }, { nombre: 'Consultas', usd: 248 },
    ] },
    { nombre: 'Indumentaria', color: '#a855f7', usd: 412, subs: [
      { nombre: 'Ropa', usd: 280 }, { nombre: 'Calzado', usd: 132 },
    ] },
    { nombre: 'Impuestos y finanzas', color: '#0284c7', usd: 173, subs: [
      { nombre: 'Comisiones', usd: 98 }, { nombre: 'Impuestos', usd: 75 },
    ] },
    { nombre: 'Transporte general', color: '#84cc16', usd: 151, subs: [
      { nombre: 'SUBE', usd: 90 }, { nombre: 'Taxi / apps', usd: 61 },
    ] },
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

// ── Resúmenes de tarjeta (F9.13/F9.21) ───────────────────────────────────────
// Modelo real: colección `resumenesTarjeta`, cada uno con `periodo` ('YYYY-MM') y
// `movimientosParseados[]`. Cada consumo trae `cuotaActual`/`cuotaTotal`; `monto`
// es la cuota que cae en ESTE resumen (el plan total y la deuda futura se derivan).
// El visor filtra al **mes en curso** (último período) — el histórico es accesible
// con el selector de mes, pero por defecto NO se mezcla.
const M_PERIODO_ACTUAL = '2026-06';
const M_RESUMENES_TARJETA = [
  // ── Junio 2026 (mes en curso) ──────────────────────────────────────────────
  {
    id: 'bbva-visa-2026-06', periodo: '2026-06', banco: 'BBVA', red: 'Visa Signature', tipo: 'Crédito', tint: '#1a1f71',
    term: '6678', cierre: '07/06', vence: '16/06', estado: 'pendiente',
    consumos: [
      { com: 'Despegar', cat: 'Vuelos Madrid', fecha: '24/05', monto: 312000, cuotaActual: 2, cuotaTotal: 6 },
      { com: 'Apple', cat: 'iPhone', fecha: '12/03', monto: 168400, cuotaActual: 4, cuotaTotal: 12 },
      { com: 'Frávega', cat: 'Smart TV 65"', fecha: '28/05', monto: 98500, cuotaActual: 1, cuotaTotal: 9 },
      { com: 'Sodimac', cat: 'Hogar', fecha: '15/05', monto: 61200, cuotaActual: 3, cuotaTotal: 6 },
      { com: 'MercadoLibre', cat: 'Notebook', fecha: '02/06', monto: 144900, cuotaActual: 1, cuotaTotal: 3 },
      { com: 'Coto', cat: 'Supermercado', fecha: '03/06', monto: 184350 },
      { com: 'Jumbo', cat: 'Supermercado', fecha: '18/06', monto: 142800 },
      { com: 'YPF', cat: 'Combustible', fecha: '09/06', monto: 38900 },
      { com: 'Farmacity', cat: 'Salud', fecha: '21/06', monto: 27600 },
    ],
  },
  {
    id: 'gal-visa-2026-06', periodo: '2026-06', banco: 'Galicia', red: 'Visa', tipo: 'Crédito', tint: '#1a1f71',
    term: '9474', cierre: '22/06', vence: '30/06', estado: 'parcial',
    consumos: [
      { com: 'Aerolíneas', cat: 'Vuelos cabotaje', fecha: '11/05', monto: 96200, cuotaActual: 2, cuotaTotal: 3 },
      { com: 'Garbarino', cat: 'Aire acondicionado', fecha: '30/04', monto: 73400, cuotaActual: 3, cuotaTotal: 12 },
      { com: 'Easy', cat: 'Hogar', fecha: '20/05', monto: 41800, cuotaActual: 1, cuotaTotal: 6 },
      { com: 'Carrefour', cat: 'Supermercado', fecha: '07/06', monto: 156300 },
      { com: 'Shell', cat: 'Combustible', fecha: '14/06', monto: 44600 },
      { com: 'Rappi', cat: 'Delivery', fecha: '19/06', monto: 22900 },
      { com: 'Cinemark', cat: 'Salidas', fecha: '23/06', monto: 18400 },
    ],
  },
  {
    id: 'gal-master-2026-06', periodo: '2026-06', banco: 'Galicia', red: 'Mastercard Black', tipo: 'Crédito', tint: '#23252b',
    term: '9714', cierre: '22/06', vence: '30/06', estado: 'pendiente',
    consumos: [
      { com: 'Musimundo', cat: 'Consola', fecha: '05/04', monto: 58900, cuotaActual: 3, cuotaTotal: 9 },
      { com: 'Dexter', cat: 'Indumentaria', fecha: '26/05', monto: 39700, cuotaActual: 1, cuotaTotal: 3 },
      { com: 'Coppel', cat: 'Hogar', fecha: '10/05', monto: 47200, cuotaActual: 2, cuotaTotal: 6 },
      { com: 'Día', cat: 'Supermercado', fecha: '12/06', monto: 88600 },
      { com: 'Farmacity', cat: 'Salud', fecha: '17/06', monto: 31200 },
      { com: 'PedidosYa', cat: 'Delivery', fecha: '22/06', monto: 24300 },
    ],
  },
  {
    id: 'bbva-master-2026-06', periodo: '2026-06', banco: 'BBVA', red: 'Mastercard Black', tipo: 'Crédito', tint: '#23252b',
    term: '6679', cierre: '07/06', vence: '16/06', estado: 'pagado',
    consumos: [
      { com: 'Spotify', cat: 'Suscripción', fecha: '01/06', monto: 5499 },
      { com: 'Netflix', cat: 'Suscripción', fecha: '04/06', monto: 12999 },
      { com: 'Apple', cat: 'iCloud', fecha: '02/06', monto: 3900, cuotaActual: 5, cuotaTotal: 6 },
      { com: 'Starbucks', cat: 'Salidas', fecha: '11/06', monto: 14200 },
      { com: 'YPF', cat: 'Combustible', fecha: '13/06', monto: 36800 },
    ],
  },
  // ── Mayo 2026 (histórico — NO se muestra por defecto) ──────────────────────
  {
    id: 'bbva-visa-2026-05', periodo: '2026-05', banco: 'BBVA', red: 'Visa Signature', tipo: 'Crédito', tint: '#1a1f71',
    term: '6678', cierre: '07/05', vence: '16/05', estado: 'pagado',
    consumos: [
      { com: 'Apple', cat: 'iPhone', fecha: '12/03', monto: 168400, cuotaActual: 3, cuotaTotal: 12 },
      { com: 'Coto', cat: 'Supermercado', fecha: '04/05', monto: 171200 },
      { com: 'YPF', cat: 'Combustible', fecha: '10/05', monto: 41200 },
      { com: 'Farmacity', cat: 'Salud', fecha: '19/05', monto: 23800 },
    ],
  },
  {
    id: 'gal-visa-2026-05', periodo: '2026-05', banco: 'Galicia', red: 'Visa', tipo: 'Crédito', tint: '#1a1f71',
    term: '9474', cierre: '22/05', vence: '30/05', estado: 'pagado',
    consumos: [
      { com: 'Garbarino', cat: 'Aire acondicionado', fecha: '30/04', monto: 73400, cuotaActual: 2, cuotaTotal: 12 },
      { com: 'Carrefour', cat: 'Supermercado', fecha: '08/05', monto: 142900 },
      { com: 'Shell', cat: 'Combustible', fecha: '15/05', monto: 39800 },
    ],
  },
];

Object.assign(window, { M_PERIODO_ACTUAL, M_RESUMENES_TARJETA });

// ── Clasificación y aprendizaje · admin (F8.1–8.4, colección viva) ───────────
// Grupo admin-only que edita lo configurable de Firestore que no tenía UI:
// diccionario (reglas de prellenado), destinos (payees aprendidos, rama-2),
// normalización (limpieza de descripciones on-boot).

// Etiquetas transversales (tag aparte de categoría/subcategoría).
const M_ETIQUETAS = ['hijos', 'rutina-casa', 'rutina-trabajo', 'ocio', 'salud-familia'];

// Diccionario: cada entrada prellena categoría/subcat/persona/moneda cuando el
// `patron` matchea la descripción. `personaDefault` = memberId (o null).
const M_DICCIONARIO = [
  { id: 'd-edenor', patron: 'edenor', tipoMatch: 'contains', categoria: 'Casa', subcategoria: 'Luz', etiqueta: 'rutina-casa', personaDefault: 'juan', monedaDefault: 'ARS', activo: true, confianza: 0.95 },
  { id: 'd-metrogas', patron: 'metrogas', tipoMatch: 'contains', categoria: 'Casa', subcategoria: 'Gas', etiqueta: 'rutina-casa', personaDefault: 'juan', monedaDefault: 'ARS', activo: true, confianza: 0.95 },
  { id: 'd-fibertel', patron: 'fibertel', tipoMatch: 'contains', categoria: 'Casa', subcategoria: 'Internet', etiqueta: 'rutina-casa', personaDefault: 'juan', monedaDefault: null, activo: true, confianza: 0.9 },
  { id: 'd-coto', patron: 'coto', tipoMatch: 'contains', categoria: 'Alimentación cotidiana', subcategoria: null, etiqueta: null, personaDefault: 'maria', monedaDefault: 'ARS', activo: true, confianza: 0.85 },
  { id: 'd-ypf', patron: 'ypf', tipoMatch: 'contains', categoria: 'Auto', subcategoria: 'Cochera', etiqueta: null, personaDefault: 'juan', monedaDefault: null, activo: true, confianza: 0.8 },
  { id: 'd-colfede', patron: 'colegio federico', tipoMatch: 'contains', categoria: 'Educación y chicos', subcategoria: 'Colegio Fede', etiqueta: 'hijos', personaDefault: 'maria', monedaDefault: 'ARS', activo: true, confianza: 0.9 },
  { id: 'd-rugby', patron: 'rugby', tipoMatch: 'contains', categoria: 'Educación y chicos', subcategoria: 'Actividades extracurriculares', etiqueta: 'hijos', personaDefault: 'fede', monedaDefault: null, activo: false, confianza: 0.7 },
];

// Destinos aprendidos: un payee normalizado → ítem esperado (rama-2) o categoría.
// `confianza < 0.7` = ignorado por el matcher (chip ámbar de aviso).
const UMBRAL_DESTINO = 0.7;
const M_DESTINOS = [
  { id: 'de-edenor', destinoNorm: 'EDENOR SA', tipo: 'nombre', confianza: 0.92, itemEsperadoId: 'luz', categoria: null, subcategoria: null, etiqueta: null },
  { id: 'de-metrogas', destinoNorm: 'METROGAS SA', tipo: 'nombre', confianza: 0.9, itemEsperadoId: 'gas', categoria: null, subcategoria: null, etiqueta: null },
  { id: 'de-exp', destinoNorm: '0170099220000012345678', tipo: 'cbu', confianza: 0.88, itemEsperadoId: 'exp', categoria: null, subcategoria: null, etiqueta: null },
  { id: 'de-colfede', destinoNorm: 'colegio.fede.mp', tipo: 'alias', confianza: 0.82, itemEsperadoId: 'colf', categoria: null, subcategoria: null, etiqueta: 'hijos' },
  { id: 'de-aysa', destinoNorm: '30546666561', tipo: 'cuit', confianza: 0.64, itemEsperadoId: null, categoria: 'Casa', subcategoria: 'Agua', etiqueta: 'rutina-casa' },
  { id: 'de-varios', destinoNorm: 'TRANSFERENCIAS VARIAS', tipo: 'nombre', confianza: 0.55, itemEsperadoId: null, categoria: 'Personal', subcategoria: null, etiqueta: null },
];

// Reglas de normalización: limpian la descripción cruda antes de clasificar.
// Se aplican EN ORDEN (orden asc); sólo las `activo:true` corren. Espejo del
// algoritmo real (prefix/suffix/replace/regex). Ver src/datos/normalizador.ts.
const M_REGLAS_NORM = [
  { id: 'n-compra', tipo: 'replace', patron: 'COMPRA ', reemplazo: '', activo: true, orden: 0, notas: 'Saca el prefijo "COMPRA" de las tarjetas.' },
  { id: 'n-mp', tipo: 'replace', patron: 'MERCADOPAGO*', reemplazo: '', activo: true, orden: 1, notas: 'Limpia el asterisco de Mercado Pago.' },
  { id: 'n-fecha', tipo: 'regex', patron: '\\s*\\d{2}/\\d{2}$', reemplazo: '', activo: true, orden: 2, notas: 'Saca la fecha dd/mm del final.' },
  { id: 'n-pago', tipo: 'prefix', patron: 'PAGO ', reemplazo: '', activo: true, orden: 3, notas: null },
  { id: 'n-espacios', tipo: 'replace', patron: '  ', reemplazo: ' ', activo: false, orden: 4, notas: 'Colapsa dobles espacios (desactivada).' },
];

// Espejo de src/datos/normalizador.ts — mismo algoritmo, para el preview paso a paso.
function gfNormalizar(s, rules) {
  if (s == null || s === '') return s;
  let out = String(s);
  for (const r of rules) {
    if (!out) break;
    switch (r.tipo) {
      case 'prefix': if (out.startsWith(r.patron)) out = (r.reemplazo + out.slice(r.patron.length)).trim(); break;
      case 'suffix': if (out.endsWith(r.patron)) out = (out.slice(0, out.length - r.patron.length) + r.reemplazo).trim(); break;
      case 'replace': out = out.split(r.patron).join(r.reemplazo).trim(); break;
      case 'regex': try { out = out.replace(new RegExp(r.patron, 'gi'), r.reemplazo).trim(); } catch (e) { /* inválido, ignorar */ } break;
    }
  }
  return out;
}

Object.assign(window, { M_ETIQUETAS, M_DICCIONARIO, M_DESTINOS, UMBRAL_DESTINO, M_REGLAS_NORM, gfNormalizar });

// ── Logos de comercios (Brandfetch por dominio) ──────────────────────────────
// Brandfetch necesita un DOMINIO; los movimientos traen razón social ("…Norte
// S.A. (Edenor)"). Mapa curado comercio→dominio (match por substring, sin
// acentos). Fallback: heurística slug (.com.ar) y, si falla, monograma. Mapa
// APARTE del diccionario/destinos (no los ensucia). En el repo esto vive como
// una colección/const `comerciosDominios` editable, con la misma resolución.
const M_COMERCIO_DOMINIOS = [
  { dominio: 'edenor.com', match: ['edenor', 'empresa distribuidora y comercializadora norte'] },
  { dominio: 'telecom.com.ar', match: ['telecom'] },
  { dominio: 'personal.com.ar', match: ['personal pay', 'telecom personal'] },
  { dominio: 'movistar.com.ar', match: ['movistar', 'telefonica'] },
  { dominio: 'aysa.com.ar', match: ['aysa', 'agua y saneamientos'] },
  { dominio: 'metrogas.com.ar', match: ['metrogas'] },
  { dominio: 'naturgy.com.ar', match: ['naturgy'] },
  { dominio: 'afip.gob.ar', match: ['afip', 'monotributo'] },
  { dominio: 'fibertel.com.ar', match: ['fibertel'] },
  { dominio: 'farmacity.com.ar', match: ['farmacity'] },
  { dominio: 'coto.com.ar', match: ['coto'] },
  { dominio: 'jumbo.com.ar', match: ['jumbo'] },
  { dominio: 'carrefour.com.ar', match: ['carrefour'] },
  { dominio: 'disco.com.ar', match: ['disco'] },
  { dominio: 'dia.com.ar', match: ['supermercado dia', 'dia %'] },
  { dominio: 'ypf.com', match: ['ypf'] },
  { dominio: 'shell.com.ar', match: ['shell'] },
  { dominio: 'despegar.com', match: ['despegar'] },
  { dominio: 'aerolineas.com.ar', match: ['aerolineas'] },
  { dominio: 'apple.com', match: ['apple', 'itunes', 'icloud'] },
  { dominio: 'mercadolibre.com.ar', match: ['mercadolibre', 'mercado libre'] },
  { dominio: 'mercadopago.com.ar', match: ['mercadopago', 'mercado pago'] },
  { dominio: 'netflix.com', match: ['netflix'] },
  { dominio: 'spotify.com', match: ['spotify'] },
  { dominio: 'rappi.com.ar', match: ['rappi'] },
  { dominio: 'pedidosya.com.ar', match: ['pedidosya', 'pedidos ya'] },
  { dominio: 'starbucks.com.ar', match: ['starbucks'] },
  { dominio: 'sodimac.com.ar', match: ['sodimac'] },
  { dominio: 'easy.com.ar', match: ['easy'] },
  { dominio: 'fravega.com', match: ['fravega'] },
  { dominio: 'garbarino.com', match: ['garbarino'] },
  { dominio: 'musimundo.com', match: ['musimundo'] },
  { dominio: 'cinemark.com.ar', match: ['cinemark', 'cinemark hoyts'] },
  { dominio: 'dexter.com.ar', match: ['dexter'] },
];

// Normaliza para el match: minúsculas, sin acentos, sin puntuación redundante.
const _norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

// comercioDominio(nombre) → dominio o null. 1) mapa curado (substring), 2) null
// (el componente decide el fallback). NO adivina dominios de nombres propios de
// persona (transferencias P2P) para no traer logos equivocados.
function comercioDominio(nombre) {
  const n = _norm(nombre);
  if (!n) return null;
  for (const e of M_COMERCIO_DOMINIOS) {
    if (e.match.some((m) => n.includes(m.replace(' %', '')))) return e.dominio;
  }
  return null;
}

Object.assign(window, { M_COMERCIO_DOMINIOS, comercioDominio });
