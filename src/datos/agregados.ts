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

function usdEq(m: Movement): number {
  if (m.moneda === 'USD') return m.monto;
  if (!m.tcUsdArs) return 0;
  return m.monto / m.tcUsdArs;
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

export interface CategoriaSlice { nombre: string; color: string; pct: number; count: number; usd: number; }
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
  categorias: AnualCategoria[];
  mesAMes: MesAMes[];
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

  const ingresosUsd = ingresos.reduce((s, m) => s + usdEq(m), 0);
  const salidasUsd = gastos.reduce((s, m) => s + usdEq(m), 0);
  const balanceUsd = ingresosUsd - salidasUsd;

  // TC representativo para el toggle ARS/USD: el más reciente entre los
  // movimientos del mes (no hay un TC único real — cada mov tiene el suyo).
  const conTc = visibles.filter(m => m.tcUsdArs).sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
  const tc = conTc[0]?.tcUsdArs ?? 1;

  const diasConGastoSet = new Set(gastos.map(m => m.fecha.getDate()));
  const [, mNum] = mes.split('-').map(Number);
  const diasEnMes = new Date(Number(mes.split('-')[0]), mNum, 0).getDate();
  const hoy = new Date();
  const esMesActual = mes === `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const diasTranscurridos = esMesActual ? hoy.getDate() : diasEnMes;

  const finDeSemanaUsd = gastos.filter(m => [0, 6].includes(m.fecha.getDay())).reduce((s, m) => s + usdEq(m), 0);

  // Por categoría
  const catMap = new Map<string, { usd: number; count: number }>();
  for (const m of gastos) {
    const cat = m.categoria ?? 'Sin categoría';
    const cur = catMap.get(cat) ?? { usd: 0, count: 0 };
    cur.usd += usdEq(m); cur.count++;
    catMap.set(cat, cur);
  }
  const categorias: CategoriaSlice[] = [...catMap.entries()]
    .map(([nombre, c]) => ({ nombre, color: colorCategoria(nombre), usd: c.usd, count: c.count, pct: salidasUsd > 0 ? Math.round((c.usd / salidasUsd) * 100) : 0 }))
    .sort((a, b) => b.usd - a.usd);

  // Por subcategoría (top 5)
  const subMap = new Map<string, number>();
  for (const m of gastos) {
    const sub = m.subcategoria ?? 'Sin subcategoría';
    subMap.set(sub, (subMap.get(sub) ?? 0) + usdEq(m));
  }
  const subcategorias: SubcategoriaSlice[] = [...subMap.entries()]
    .map(([nombre, valor]) => ({ nombre, color: colorCategoria(nombre), valor, pct: salidasUsd > 0 ? Math.round((valor / salidasUsd) * 100) : 0 }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 5);

  // Por descripción (top 5)
  const descMap = new Map<string, { usd: number; count: number }>();
  for (const m of gastos) {
    const cur = descMap.get(m.descripcion) ?? { usd: 0, count: 0 };
    cur.usd += usdEq(m); cur.count++;
    descMap.set(m.descripcion, cur);
  }
  const porDescripcion: DescripcionSlice[] = [...descMap.entries()]
    .map(([desc, d]) => ({ desc, usd: d.usd, count: d.count }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 5);

  // Diaria + pico día
  const diaria = new Array(diasEnMes).fill(0);
  for (const m of gastos) diaria[m.fecha.getDate() - 1] += usdEq(m);
  let picoIdx = 0;
  for (let i = 1; i < diaria.length; i++) if (diaria[i] > diaria[picoIdx]) picoIdx = i;
  const picoDate = new Date(Number(mes.split('-')[0]), mNum - 1, picoIdx + 1);

  // Banco dominante (alias canónico — Efectivo cuenta como Mercado Pago, F9.23)
  const bancoMap = new Map<string, number>();
  for (const m of gastos) {
    if (!m.banco) continue;
    const b = medioCanonico(m.banco, config?.bancos);
    bancoMap.set(b, (bancoMap.get(b) ?? 0) + usdEq(m));
  }
  const bancoDominante = [...bancoMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

  // Mov más alto
  const movMasAltoRaw = [...gastos].sort((a, b) => usdEq(b) - usdEq(a))[0];
  const movMasAlto = movMasAltoRaw
    ? { usd: usdEq(movMasAltoRaw), desc: `${movMasAltoRaw.descripcion}${movMasAltoRaw.persona ? ' — ' + nombrePersona(movMasAltoRaw.persona, config) : ''}`, id: movMasAltoRaw.id }
    : { usd: 0, desc: '—', id: null };

  // Vs. mes anterior
  const salidasAnteriorUsd = movsMesAnterior.filter(m => !m.excluirDash && m.tipo === 'Gasto').reduce((s, m) => s + usdEq(m), 0);
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

  const ingresosUsd = ingresos.reduce((s, m) => s + usdEq(m), 0);
  const salidasUsd = gastos.reduce((s, m) => s + usdEq(m), 0);

  const salidasPorMes = new Array(12).fill(0);
  const ingresosPorMes = new Array(12).fill(0);
  for (const m of gastos) salidasPorMes[Number(m.mes.split('-')[1]) - 1] += usdEq(m);
  for (const m of ingresos) ingresosPorMes[Number(m.mes.split('-')[1]) - 1] += usdEq(m);

  const mesesConDatosIdx = [...new Set(visibles.map(m => Number(m.mes.split('-')[1]) - 1))].sort((a, b) => a - b);
  const mesesConDatos = mesesConDatosIdx.length;

  const promedioMensualUsd = mesesConDatos > 0 ? salidasUsd / mesesConDatos : 0;

  let mesMasAltoIdx = mesesConDatosIdx[0] ?? 0, mesMasBajoIdx = mesesConDatosIdx[0] ?? 0;
  for (const i of mesesConDatosIdx) {
    if (salidasPorMes[i] > salidasPorMes[mesMasAltoIdx]) mesMasAltoIdx = i;
    if (salidasPorMes[i] < salidasPorMes[mesMasBajoIdx]) mesMasBajoIdx = i;
  }

  // Tendencia: variación entre el primer y el último mes con datos del año
  const primero = mesesConDatosIdx[0];
  const ultimo = mesesConDatosIdx[mesesConDatosIdx.length - 1];
  const tendenciaPct = (primero != null && ultimo != null && primero !== ultimo && salidasPorMes[primero] > 0)
    ? Math.round(((salidasPorMes[ultimo] - salidasPorMes[primero]) / salidasPorMes[primero]) * 100)
    : 0;

  const salidasAnioAnteriorUsd = movsAnioAnterior.filter(m => !m.excluirDash && m.tipo === 'Gasto').reduce((s, m) => s + usdEq(m), 0);
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
    catMap.set(cat, (catMap.get(cat) ?? 0) + usdEq(m));
    const sub = m.subcategoria ?? 'Sin subcategoría';
    if (!subMap.has(cat)) subMap.set(cat, new Map());
    const subs = subMap.get(cat)!;
    subs.set(sub, (subs.get(sub) ?? 0) + usdEq(m));
  }
  const categorias: AnualCategoria[] = [...catMap.entries()]
    .map(([nombre, usd]) => {
      const subs = [...(subMap.get(nombre) ?? new Map()).entries()]
        .map(([snombre, susd]) => ({ nombre: snombre, usd: susd, pct: usd > 0 ? Math.round((susd / usd) * 100) : 0 }))
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
    categorias,
    mesAMes,
  };
}
