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
  { id: 'luz', label: 'Edenor — luz', persona: 'Juan', monto: 38900, moneda: 'ARS', estado: 'por_confirmar', vence: 27, categoria: 'Casa', subcat: 'Luz', etiqueta: 'rutina-casa' },
  { id: 'gas', label: 'Metrogas', persona: 'Juan', monto: 21500, moneda: 'ARS', estado: 'pendiente', vence: 30, categoria: 'Casa', subcat: 'Gas', etiqueta: 'rutina-casa' },
  { id: 'inet', label: 'Internet Fibertel', persona: 'Juan', monto: 29900, moneda: 'ARS', estado: 'vencido', vence: 22, categoria: 'Casa', subcat: 'Internet', etiqueta: 'rutina-casa' },
  { id: 'mono', label: 'Monotributo Juan', persona: 'Juan', monto: 48000, moneda: 'ARS', estado: 'automatico', vence: 20, categoria: 'Impuestos y finanzas', subcat: 'Monotributo', etiqueta: 'rutina-trabajo' },
  { id: 'galvisa', label: 'Galicia Visa', persona: 'María', monto: 1403704, moneda: 'ARS', estado: 'parcial', vence: 30, categoria: 'Tarjetas', subcat: 'Pago Tarjeta', etiqueta: 'Galicia VisaARS' },
  { id: 'bbvavisa', label: 'BBVA Visa Signature', persona: 'Juan', monto: 2018435, moneda: 'ARS', estado: 'pendiente', vence: 16, categoria: 'Tarjetas', subcat: 'Pago Tarjeta', etiqueta: 'Frances VisaARS' },
];

// Historiales separados para Cargar: comprobantes/facturas y resúmenes de tarjeta.
// Cada lista se muestra recortada (4) con "ver todo". estado: ok|wait|warn|err.
const M_COMPROBANTES = [
  { id: 'c1', nombre: 'Edenor_factura_06.pdf', estado: 'wait', detalle: 'Extrayendo datos…', fecha: '24/06' },
  { id: 'c2', nombre: 'Aysa_factura.pdf', estado: 'warn', detalle: 'Falta categoría', fecha: '22/06' },
  { id: 'c3', nombre: 'Metrogas_junio.pdf', estado: 'ok', detalle: 'Gas · $ 18.400', fecha: '20/06' },
  { id: 'c4', nombre: 'Movistar_06.pdf', estado: 'ok', detalle: 'Telefonía · $ 12.999', fecha: '18/06' },
  { id: 'c5', nombre: 'Farmacity_ticket.jpg', estado: 'ok', detalle: 'Salud · $ 27.600', fecha: '17/06' },
  { id: 'c6', nombre: 'Coto_compra.jpg', estado: 'ok', detalle: 'Supermercado · $ 84.200', fecha: '15/06' },
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
