// F9.26 — agregados DERIVADOS para Dashboard, calculados on-read desde
// `movimientos` (nunca persistidos — ver docs/F9.25_auditoria_agregados.md).
// Cada función es pura: recibe Movement[] ya filtrado por mes/persona (los
// hooks useMovimientosDelMes/useMovimientosDelAnio hacen el filtro real,
// scoped por Rules) y devuelve el shape que ya consumía Dashboard.tsx con
// datos de ejemplo. La conversión usa el tcUsdArs propio de cada movimiento
// (no un TC único global) — mismo criterio que el Resumen real pre-F9.3.
import type { Movement, FamiliaConfig } from '../types';
import { medioCanonico } from './medios';

// ── Paleta de categorías (hash determinístico, no hay color en el modelo) ──
const PALETA_CAT = [
  '#4f8ef7', '#2bb673', '#f5a623', '#8b5cf6', '#ef5350',
  '#06b6d4', '#ec4899', '#14b8a6', '#a855f7', '#84cc16', '#0284c7',
];
// Hash determinístico nombre→color de la paleta. Reusado para categorías
// (acá) y para personas (Resumen.tsx) — no hay color propio en el modelo.
export function colorHash(nombre: string): string {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  return PALETA_CAT[h % PALETA_CAT.length];
}
const colorCategoria = colorHash;

function usdEq(m: Movement, fallbackTc = 0): number {
  if (m.moneda === 'USD') return m.monto;
  const tc = m.tcUsdArs ?? fallbackTc;
  if (!tc) return 0;
  return m.monto / tc;
}
function arsEq(m: Movement): number {
  if (m.moneda === 'ARS') return m.monto;
  if (!m.tcUsdArs) return 0;
  return m.monto * m.tcUsdArs;
}

function nombrePersona(memberId: string | null, config: FamiliaConfig | null): string {
  if (!memberId || !config) return memberId ?? '';
  return config.miembros[memberId]?.nombre ?? memberId;
}

const MESES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DIA_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function labelMes(mes: string): string {
  const [y, m] = mes.split('-');
  return `${MESES_LARGO[Number(m) - 1]} ${y}`;
}

export function mesAnterior(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Shapes (mismos que consumía Dashboard.tsx con EXAMPLE_DASH/ANUAL) ──────

export interface CategoriaSlice { nombre: string; color: string; pct: number; count: number; usd: number; subs: { nombre: string; usd: number }[]; }
export interface SubcategoriaSlice { nombre: string; color: string; valor: number; pct: number; }
export interface DescripcionSlice { desc: string; usd: number; count: number; }

export interface DashMensual {
  tc: number;
  mesLabel: string;
  balanceUsd: number; balancePositivo: boolean;
  ingresosUsd: number; salidasUsd: number;
  movimientos: number;
  gastoPromedioUsd: number; diasConGasto: number;
  promedioDiarioUsd: number;
  finDeSemanaPct: number; top3Pct: number;
  bancoDominante: string;
  vsMesAnteriorPct: number; vsMesLabel: string; lecturaRapida: string;
  categoriaTop: { nombre: string; pct: number };
  movMasAlto: { usd: number; desc: string; id: string | null };
  picoDia: { fecha: string; dow: string; usd: number; diaNum: number };
  categorias: CategoriaSlice[];
  subcategorias: SubcategoriaSlice[];
  diaria: number[];
  porDescripcion: DescripcionSlice[];
}

export interface AnualSubcategoria { nombre: string; usd: number; pct: number; }
export interface AnualCategoria { nombre: string; color: string; usd: number; subcategorias: AnualSubcategoria[]; }
export interface MesAMes { mes: string; usd: number; delta: number | null; }

export interface DashAnual {
  anio: number;
  balanceUsd: number; ingresosUsd: number; salidasUsd: number;
  promedioMensualUsd: number; mesMasAlto: string; mesMasBajo: string; tendenciaPct: number;
  mesesConDatos: number; comparacionInteranualPct: number | null; mejorMesAhorro: string;
  meses: string[];
  salidasPorMes: number[];
  ingresosPorMes: number[];
  // F9.57 — meses futuros del año en curso: proyección lineal de los meses transcurridos
  // (ver _linreg más abajo). mesActualIdx: índice 0-based del último mes "real"
  // (mes en curso para el año actual; 11 para años pasados completos).
  mesActualIdx: number;
  salidasProyeccion: number[];
  ingresosProyeccion: number[];
  proyeccionRestoAnioUsd: number;
  categorias: AnualCategoria[];
  mesAMes: MesAMes[];
}

// F9.57 — regresión lineal simple (mínimos cuadrados) sobre una serie, x = índice.
function _linreg(ys: number[]): { slope: number; intercept: number } {
  const n = ys.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: ys[0] };
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) { sumX += i; sumY += ys[i]; sumXY += i * ys[i]; sumXX += i * i; }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// Proyecta los meses futuros (índices > mesActualIdx) extrapolando la recta ajustada
// sobre los meses reales (0..mesActualIdx), con piso 0. Meses reales quedan en 0.
function proyectarMeses(serie: number[], mesActualIdx: number): number[] {
  const reales = serie.slice(0, mesActualIdx + 1);
  const { slope, intercept } = _linreg(reales);
  const proyeccion = new Array(12).fill(0);
  for (let i = mesActualIdx + 1; i < 12; i++) proyeccion[i] = Math.max(0, intercept + slope * i);
  return proyeccion;
}

// ── Mensual ─────────────────────────────────────────────────────────────────

// F9.40 — contrato de scope (ver docs/CLAUDE.md "Dashboard = devengado ·
// Resumen = caja"): Dashboard es DEVENGADO — imputa el gasto a cuándo se hizo
// el consumo y EXCLUYE los pagos de tarjeta consolidados (`excluirDash`).
// Resumen (PorDiaSeccion en Resumen.tsx) es CAJA — toma lo efectivamente
// pagado en el mes, filtrando por `incluirResumenMes` en vez de `excluirDash`.
// Ambos scopes NO reconcilian entre sí por diseño — no son la misma plata
// medida dos veces, son dos preguntas distintas ("¿qué consumí?" vs "¿qué
// pagué?"). El validador del seed (F9.40) los chequea por separado, nunca uno
// contra el otro.
export function agregarMensual(
  movs: Movement[],
  mes: string,
  config: FamiliaConfig | null,
  movsMesAnterior: Movement[],
): DashMensual {
  const visibles = movs.filter(m => !m.excluirDash);
  const gastos = visibles.filter(m => m.tipo === 'Gasto');
  const ingresos = visibles.filter(m => m.tipo === 'Ingreso');

  // TC representativo: el más reciente entre los movimientos del mes.
  // Se calcula primero para usarlo como fallback en movimientos ARS sin tcUsdArs.
  const conTc = visibles.filter(m => m.tcUsdArs).sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
  const tc = conTc[0]?.tcUsdArs ?? 1;

  const ingresosUsd = ingresos.reduce((s, m) => s + usdEq(m, tc), 0);
  const salidasUsd = gastos.reduce((s, m) => s + usdEq(m, tc), 0);
  const balanceUsd = ingresosUsd - salidasUsd;

  const diasConGastoSet = new Set(gastos.map(m => m.fecha.getDate()));
  const [, mNum] = mes.split('-').map(Number);
  const diasEnMes = new Date(Number(mes.split('-')[0]), mNum, 0).getDate();
  const hoy = new Date();
  const esMesActual = mes === `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const diasTranscurridos = esMesActual ? hoy.getDate() : diasEnMes;

  const finDeSemanaUsd = gastos.filter(m => [0, 6].includes(m.fecha.getDay())).reduce((s, m) => s + usdEq(m, tc), 0);

  // Por categoría
  const catMap = new Map<string, { usd: number; count: number }>();
  const catSubMap = new Map<string, Map<string, number>>();
  for (const m of gastos) {
    const cat = m.categoria ?? 'Sin categoría';
    const cur = catMap.get(cat) ?? { usd: 0, count: 0 };
    cur.usd += usdEq(m, tc); cur.count++;
    catMap.set(cat, cur);
    const sub = m.subcategoria ?? 'Sin subcategoría';
    if (!catSubMap.has(cat)) catSubMap.set(cat, new Map());
    const csubs = catSubMap.get(cat)!;
    csubs.set(sub, (csubs.get(sub) ?? 0) + usdEq(m, tc));
  }
  const categorias: CategoriaSlice[] = [...catMap.entries()]
    .map(([nombre, c]) => ({
      nombre, color: colorCategoria(nombre), usd: c.usd, count: c.count,
      pct: salidasUsd > 0 ? Math.round((c.usd / salidasUsd) * 100) : 0,
      subs: [...(catSubMap.get(nombre) ?? new Map()).entries()]
        .map(([snombre, susd]) => ({ nombre: snombre, usd: susd }))
        .sort((a, b) => b.usd - a.usd),
    }))
    .sort((a, b) => b.usd - a.usd);

  // Por subcategoría (top 5)
  const subMap = new Map<string, number>();
  for (const m of gastos) {
    const sub = m.subcategoria ?? 'Sin subcategoría';
    subMap.set(sub, (subMap.get(sub) ?? 0) + usdEq(m, tc));
  }
  const subcategorias: SubcategoriaSlice[] = [...subMap.entries()]
    .map(([nombre, valor]) => ({ nombre, color: colorCategoria(nombre), valor, pct: salidasUsd > 0 ? Math.round((valor / salidasUsd) * 100) : 0 }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 5);

  // Por descripción (top 5)
  const descMap = new Map<string, { usd: number; count: number }>();
  for (const m of gastos) {
    const cur = descMap.get(m.descripcion) ?? { usd: 0, count: 0 };
    cur.usd += usdEq(m, tc); cur.count++;
    descMap.set(m.descripcion, cur);
  }
  const porDescripcion: DescripcionSlice[] = [...descMap.entries()]
    .map(([desc, d]) => ({ desc, usd: d.usd, count: d.count }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 5);

  // Diaria + pico día
  const diaria = new Array(diasEnMes).fill(0);
  for (const m of gastos) diaria[m.fecha.getDate() - 1] += usdEq(m, tc);
  let picoIdx = 0;
  for (let i = 1; i < diaria.length; i++) if (diaria[i] > diaria[picoIdx]) picoIdx = i;
  const picoDate = new Date(Number(mes.split('-')[0]), mNum - 1, picoIdx + 1);

  // Banco dominante (alias canónico — Efectivo cuenta como Mercado Pago, F9.23)
  const bancoMap = new Map<string, number>();
  for (const m of gastos) {
    if (!m.banco) continue;
    const b = medioCanonico(m.banco, config?.bancos);
    bancoMap.set(b, (bancoMap.get(b) ?? 0) + usdEq(m, tc));
  }
  const bancoDominante = [...bancoMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

  // Mov más alto
  const movMasAltoRaw = [...gastos].sort((a, b) => usdEq(b, tc) - usdEq(a, tc))[0];
  const movMasAlto = movMasAltoRaw
    ? { usd: usdEq(movMasAltoRaw, tc), desc: `${movMasAltoRaw.descripcion}${movMasAltoRaw.persona ? ' — ' + nombrePersona(movMasAltoRaw.persona, config) : ''}`, id: movMasAltoRaw.id }
    : { usd: 0, desc: '—', id: null };

  // Vs. mes anterior (se usa el mismo TC representativo del mes actual como aproximación)
  const salidasAnteriorUsd = movsMesAnterior.filter(m => !m.excluirDash && m.tipo === 'Gasto').reduce((s, m) => s + usdEq(m, tc), 0);
  const vsMesAnteriorPct = salidasAnteriorUsd > 0 ? Math.round(((salidasUsd - salidasAnteriorUsd) / salidasAnteriorUsd) * 100) : 0;
  const lecturaRapida = salidasAnteriorUsd === 0 ? 'Sin datos del mes anterior' : vsMesAnteriorPct < 0 ? 'Bajó el gasto' : vsMesAnteriorPct > 0 ? 'Subió el gasto' : 'Gasto estable';

  const top3Usd = categorias.slice(0, 3).reduce((s, c) => s + c.usd, 0);

  return {
    tc,
    mesLabel: labelMes(mes),
    balanceUsd, balancePositivo: balanceUsd >= 0,
    ingresosUsd, salidasUsd,
    movimientos: visibles.length,
    gastoPromedioUsd: diasConGastoSet.size > 0 ? salidasUsd / diasConGastoSet.size : 0,
    diasConGasto: diasConGastoSet.size,
    promedioDiarioUsd: diasTranscurridos > 0 ? salidasUsd / diasTranscurridos : 0,
    finDeSemanaPct: salidasUsd > 0 ? Math.round((finDeSemanaUsd / salidasUsd) * 100) : 0,
    top3Pct: salidasUsd > 0 ? Math.round((top3Usd / salidasUsd) * 100) : 0,
    bancoDominante,
    vsMesAnteriorPct, vsMesLabel: labelMes(mesAnterior(mes)), lecturaRapida,
    categoriaTop: categorias[0] ? { nombre: categorias[0].nombre, pct: categorias[0].pct } : { nombre: '—', pct: 0 },
    movMasAlto,
    picoDia: { fecha: picoDate.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }), dow: DIA_ES[picoDate.getDay()], usd: diaria[picoIdx] ?? 0, diaNum: picoIdx + 1 },
    categorias,
    subcategorias,
    diaria,
    porDescripcion,
  };
}

// ── Anual ─────────────────────────────────────────────────────────────────

export function agregarAnual(movs: Movement[], anio: number, movsAnioAnterior: Movement[]): DashAnual {
  const visibles = movs.filter(m => !m.excluirDash);
  const gastos = visibles.filter(m => m.tipo === 'Gasto');
  const ingresos = visibles.filter(m => m.tipo === 'Ingreso');

  // TC representativo del año (más reciente con TC propio), usado como fallback para movs ARS sin TC.
  const conTc = visibles.filter(m => m.tcUsdArs).sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
  const tc = conTc[0]?.tcUsdArs ?? 0;

  const ingresosUsd = ingresos.reduce((s, m) => s + usdEq(m, tc), 0);
  const salidasUsd = gastos.reduce((s, m) => s + usdEq(m, tc), 0);

  const salidasPorMes = new Array(12).fill(0);
  const ingresosPorMes = new Array(12).fill(0);
  for (const m of gastos) salidasPorMes[Number(m.mes.split('-')[1]) - 1] += usdEq(m, tc);
  for (const m of ingresos) ingresosPorMes[Number(m.mes.split('-')[1]) - 1] += usdEq(m, tc);

  const mesesConDatosIdx = [...new Set(visibles.map(m => Number(m.mes.split('-')[1]) - 1))].sort((a, b) => a - b);
  const mesesConDatos = mesesConDatosIdx.length;

  // F9.57 — mes actual = mes en curso del año mostrado (0-indexed); años pasados
  // completos => 11 (los 12 meses son "reales"). Meses 0..mesActualIdx = reales;
  // > mesActualIdx = futuros, proyectados por regresión lineal sobre los reales.
  const hoy = new Date();
  const mesActualIdx = anio < hoy.getFullYear() ? 11 : anio === hoy.getFullYear() ? hoy.getMonth() : -1;

  const salidasReales = salidasPorMes.slice(0, mesActualIdx + 1);
  const salidasProyeccion = proyectarMeses(salidasPorMes, mesActualIdx);
  const ingresosProyeccion = proyectarMeses(ingresosPorMes, mesActualIdx);
  const proyeccionRestoAnioUsd = salidasProyeccion.reduce((s, v) => s + v, 0);

  const promedioMensualUsd = salidasReales.length > 0 ? salidasReales.reduce((s, v) => s + v, 0) / salidasReales.length : 0;

  let mesMasAltoIdx = 0, mesMasBajoIdx = 0;
  for (let i = 0; i <= mesActualIdx; i++) {
    if (salidasPorMes[i] > salidasPorMes[mesMasAltoIdx]) mesMasAltoIdx = i;
    if (salidasPorMes[i] < salidasPorMes[mesMasBajoIdx]) mesMasBajoIdx = i;
  }

  // Tendencia: pendiente mensual de la regresión sobre los meses reales ÷ su
  // promedio — nunca promedia contra los ceros de los meses futuros.
  const { slope: slopeSalidas } = _linreg(salidasReales);
  const tendenciaPct = promedioMensualUsd > 0 ? Math.round((slopeSalidas / promedioMensualUsd) * 100) : 0;

  const salidasAnioAnteriorUsd = movsAnioAnterior.filter(m => !m.excluirDash && m.tipo === 'Gasto').reduce((s, m) => s + usdEq(m, tc), 0);
  const comparacionInteranualPct = salidasAnioAnteriorUsd > 0
    ? Math.round(((salidasUsd - salidasAnioAnteriorUsd) / salidasAnioAnteriorUsd) * 100)
    : null;

  let mejorMesIdx = mesesConDatosIdx[0] ?? 0;
  for (const i of mesesConDatosIdx) {
    if ((ingresosPorMes[i] - salidasPorMes[i]) > (ingresosPorMes[mejorMesIdx] - salidasPorMes[mejorMesIdx])) mejorMesIdx = i;
  }

  const catMap = new Map<string, number>();
  const subMap = new Map<string, Map<string, number>>();
  for (const m of gastos) {
    const cat = m.categoria ?? 'Sin categoría';
    catMap.set(cat, (catMap.get(cat) ?? 0) + usdEq(m, tc));
    const sub = m.subcategoria ?? 'Sin subcategoría';
    if (!subMap.has(cat)) subMap.set(cat, new Map());
    const subs = subMap.get(cat)!;
    subs.set(sub, (subs.get(sub) ?? 0) + usdEq(m, tc));
  }
  const totalCatUsd = [...catMap.values()].reduce((s, v) => s + v, 0);
  const categorias: AnualCategoria[] = [...catMap.entries()]
    .map(([nombre, usd]) => {
      const subs = [...(subMap.get(nombre) ?? new Map()).entries()]
        .map(([snombre, susd]) => ({ nombre: snombre, usd: susd, pct: totalCatUsd > 0 ? Math.round((susd / totalCatUsd) * 100) : 0 }))
        .sort((a, b) => b.usd - a.usd);
      return { nombre, color: colorCategoria(nombre), usd, subcategorias: subs };
    })
    .sort((a, b) => b.usd - a.usd);

  const mesAMes: MesAMes[] = mesesConDatosIdx.map((i, idx) => {
    const prevIdx = idx > 0 ? mesesConDatosIdx[idx - 1] : null;
    const delta = prevIdx != null && salidasPorMes[prevIdx] > 0
      ? Math.round(((salidasPorMes[i] - salidasPorMes[prevIdx]) / salidasPorMes[prevIdx]) * 100)
      : null;
    return { mes: MESES_ES[i], usd: salidasPorMes[i], delta };
  });

  return {
    anio,
    balanceUsd: ingresosUsd - salidasUsd, ingresosUsd, salidasUsd,
    promedioMensualUsd,
    mesMasAlto: MESES_ES[mesMasAltoIdx], mesMasBajo: MESES_ES[mesMasBajoIdx],
    tendenciaPct,
    mesesConDatos, comparacionInteranualPct,
    mejorMesAhorro: MESES_ES[mejorMesIdx],
    meses: MESES_ES,
    salidasPorMes, ingresosPorMes,
    mesActualIdx, salidasProyeccion, ingresosProyeccion, proyeccionRestoAnioUsd,
    categorias,
    mesAMes,
  };
}
