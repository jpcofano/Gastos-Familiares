import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { useItemsEsperados } from '../contexto/ItemsEsperadosContext';
import { useMovimientosDelMes } from '../hooks/useMovimientosDelMes';
import { useFamiliaConfig } from '../hooks/useFamiliaConfig';
import { confirmarPagoEsperado, desmarcarPago, registrarPagoChecklist, marcarPagadoSuelto, desmarcarPagadoSuelto } from '../datos/movimientos';
import { actualizarItemEsperado } from '../datos/itemsEsperados';
import { Icon } from '../design-system/Icon';
import { Card, Money, StatusBadge, Badge, Button, BankLogo, MerchantLogo, type EstadoChecklist } from '../design-system/components';
import { fmtMoney } from '../datos/money';
import { cargarTCReciente, tcDeFecha, tcEfectivoDe, type EstadoTcHoy } from '../datos/tcDiario';
import { cargarTCRango } from '../datos/patrimonioOptimizacion';
import { medioCanonico, colorMedio, MEDIOS_FALLBACK } from '../datos/medios';
import { colorHash } from '../datos/agregados';
import { calcularChecklist, cubierto, ACCIONABLE, type CheckItem } from '../datos/checklist';
import { construirAgenda, agendaCubierto, sueltosFuturosDelMes, pendienteAgenda, pendienteDeEntrada, diaDeAgenda, inicioDia, type AgendaEntry } from '../datos/agenda';
import EditarMovimiento from './EditarMovimiento';
import type { Movement, ExpectedItem, FamiliaConfig, MedioPago } from '../types';
import './Resumen.css';

type Moneda = 'ARS' | 'USD';

// F9.102 1a — Card HOY suma una tercera fuente (movimientos reales de caja del día no
// matcheados) además de esperados/sueltos. 'real' es local a esta card: NO entra a
// pendienteAgenda ni al checklist de fijos (ver src/datos/agenda.ts, AgendaEntry).
type HoyEntry = AgendaEntry | { kind: 'real'; mov: Movement };

function hoyEntryCubierto(e: HoyEntry): boolean {
  return e.kind === 'real' ? (e.mov.pagado === true || e.mov.confirmadoPago === true) : agendaCubierto(e);
}

// Lookup banco por nombre (aplicando medioCanonico) para obtener id/color/dominio
function bancoDeNombre(nombre: string, bancos?: MedioPago[]): MedioPago | undefined {
  const lista = bancos ?? MEDIOS_FALLBACK;
  const canonico = medioCanonico(nombre, lista);
  return lista.find(b => b.nombre === canonico);
}

// F9.26 — Resumen cableado a datos reales. "Por día" = caja del mes
// (incluirResumenMes=true, paridad legacy 50_ResumenMes.gs). "Gastos Fijos" =
// checklist real de itemsEsperados — la lógica de match/estado es la que ya
// existía pre-F9.3 (recuperada de git, commit 0bc11e6) y nunca se reescribió,
// solo se re-skineó a las cards de F9.17/F9.18.
// NOTA: el match por persona en ingresos esperados asume persona=memberId en
// movimientos.persona — depende del backfill de F9.24 (scripts/seed/
// backfillPersonaMemberId.ts) para los docs viejos del seed.

// ── Mes helpers ───────────────────────────────────────────────────────────────

function mesActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function desplazarMes(mes: string, delta: number): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
function formatMes(mes: string): string {
  const [y, m] = mes.split('-');
  return `${MESES_LARGO[Number(m) - 1]} ${y}`;
}

const DIA_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function fmtArs(n: number): string { return fmtMoney(n, { from: 'ARS', to: 'ARS' }); }
function fmtUsdEq(n: number): string { return fmtMoney(n, { from: 'USD', to: 'USD' }); }

// ── F9.114 — valuación en USD ────────────────────────────────────────────────
// Regla (docs/prompts/F9.114-valuacion-usd.md §1): lo que YA se movió se valúa al TC de su
// día y queda congelado; lo que TODAVÍA está vivo —esperados no pagados, ingresos del mes
// en curso, que siguen en el banco— al TC de hoy. Antes toda conversión visible usaba el
// literal de fallback (fmtMoney sin tc) o un TC único del mes que caía a 1 sin movimientos
// en USD: el "equivalente USD" quedaba igual al monto en pesos.

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type TcDeMov = (m: Movement) => number;

// `esVivo` = ingreso del mes en curso. Los gastos pagados NUNCA son vivos, ni siquiera en
// el mes en curso: ya se pagaron al dólar de ese día.
function crearTcDeMovimiento(mapaTc: Record<string, number>, tcEfectivo: number, esMesActual: boolean): TcDeMov {
  return m => {
    const esVivo = esMesActual && m.tipo === 'Ingreso';
    if (esVivo) return tcEfectivo;
    return tcDeFecha(mapaTc, isoLocal(m.fecha)) ?? tcEfectivo;
  };
}

// Par ARS/USD de un movimiento: los totales acumulan las DOS monedas por movimiento, en vez
// de dividir el total por un TC único (si no, un día con ingreso y gasto mezcla criterios).
interface Eq { ars: number; usd: number }
const EQ0: Eq = { ars: 0, usd: 0 };
function sumaEq(a: Eq, b: Eq): Eq { return { ars: a.ars + b.ars, usd: a.usd + b.usd }; }

// La dirección USD→ARS sigue mandándola el snapshot del día (m.tcUsdArs): un gasto en USD
// de marzo se muestra en pesos al TC de marzo. tcDeMov entra sólo para ARS→USD y para el
// movimiento en USD SIN snapshot (F9.114 Parte 5) — que antes valía 0 y desaparecía.
function eqDe(m: Movement, tcDeMov: TcDeMov): Eq {
  if (m.moneda === 'ARS') {
    const tc = tcDeMov(m);
    return { ars: m.monto, usd: tc ? m.monto / tc : 0 };
  }
  const tc = m.tcUsdArs ?? tcDeMov(m);
  return { ars: m.monto * tc, usd: m.monto };
}

function arsEq(m: Movement, tcDeMov: TcDeMov): number { return eqDe(m, tcDeMov).ars; }

function sinTcPropio(m: Movement): boolean { return m.moneda === 'USD' && !m.tcUsdArs; }

function nombrePersona(memberId: string | null, config: FamiliaConfig | null): string {
  if (!memberId) return '—';
  return config?.miembros[memberId]?.nombre ?? memberId;
}

// ── KPIs de caja (incluirResumenMes=true) ────────────────────────────────────

interface Kpis {
  ingArsEq: number; gasArsEq: number; netArsEq: number;
  ingUsdEq: number; gasUsdEq: number; netUsdEq: number;
  pesosDisp: number; faltanteUsd: number; tcEfectivo: number;
}

// F9.114 — se acumula POR MOVIMIENTO (cada uno con el TC que le corresponde), no aplicando
// un TC único a los agregados. `tcEfectivo` es el TC de hoy (o su cascada de fallback) y se
// usa sólo para las cifras vivas: cobertura del mes y pendiente de la agenda.
function calcularKpis(movs: Movement[], tcDeMov: TcDeMov, tcEfectivo: number): Kpis {
  let ing = EQ0, gas = EQ0, ingArs = 0, gasArs = 0;
  for (const m of movs) {
    const eq = eqDe(m, tcDeMov);
    if (m.tipo === 'Ingreso') { ing = sumaEq(ing, eq); if (m.moneda === 'ARS') ingArs += m.monto; }
    else { gas = sumaEq(gas, eq); if (m.moneda === 'ARS') gasArs += m.monto; }
  }
  return {
    ingArsEq: ing.ars, gasArsEq: gas.ars, netArsEq: ing.ars - gas.ars,
    ingUsdEq: ing.usd, gasUsdEq: gas.usd, netUsdEq: ing.usd - gas.usd,
    pesosDisp: ingArs, faltanteUsd: tcEfectivo ? (ingArs - gasArs) / tcEfectivo : 0, tcEfectivo,
  };
}

interface DiaAgregado { day: number; date: Date; eq: Eq; banks: Record<string, Eq>; }

function porDia(movs: Movement[], tcDeMov: TcDeMov, medios?: FamiliaConfig['bancos']): DiaAgregado[] {
  const map = new Map<number, DiaAgregado>();
  for (const m of movs) {
    if (m.tipo !== 'Gasto') continue;
    const d = m.fecha.getDate();
    if (!map.has(d)) map.set(d, { day: d, date: m.fecha, eq: EQ0, banks: {} });
    const e = map.get(d)!;
    const v = eqDe(m, tcDeMov);
    const banco = medioCanonico(m.banco ?? 'Sin medio', medios);
    e.eq = sumaEq(e.eq, v);
    e.banks[banco] = sumaEq(e.banks[banco] ?? EQ0, v);
  }
  return [...map.values()].sort((a, b) => a.day - b.day);
}

function porPersonaIngreso(movs: Movement[], tcDeMov: TcDeMov): [string, Eq][] {
  const map: Record<string, Eq> = {};
  for (const m of movs.filter(x => x.tipo === 'Ingreso')) {
    const p = m.persona ?? '—';
    map[p] = sumaEq(map[p] ?? EQ0, eqDe(m, tcDeMov));
  }
  return Object.entries(map).sort((a, b) => b[1].ars - a[1].ars);
}

// ── KPI block (compartido entre secciones) ───────────────────────────────────

// F9.99.6 — semáforo en el NETO (verde si ≥ 0, rojo si < 0); Ingresos/Gastos neutros.
// "Cobertura del mes" = gastos totales ArsEq vs pesos disponibles.
//   Supuesto: gastos USD convertidos a ARS al TC del mes → puede sobreestimar si el dueño
//   paga gastos USD con dólares propios. El cálculo es el definido por el dueño.
// F9.71 — card oscura centrada: Neto grande + eq, Ingresos/Gastos columnas con eq.
function KpiCards({ c, cur }: { c: Kpis; cur: Moneda }) {
  const netBig   = cur === 'ARS' ? c.netArsEq  : c.netUsdEq;
  const netSmall = cur === 'ARS' ? c.netUsdEq  : c.netArsEq;
  const fmt      = cur === 'ARS' ? fmtArs      : fmtUsdEq;
  const fmtOtra  = cur === 'ARS' ? fmtUsdEq    : fmtArs;
  const ingBig   = cur === 'ARS' ? c.ingArsEq  : c.ingUsdEq;
  const ingSmall = cur === 'ARS' ? c.ingUsdEq  : c.ingArsEq;
  const gasBig   = cur === 'ARS' ? c.gasArsEq  : c.gasUsdEq;
  const gasSmall = cur === 'ARS' ? c.gasUsdEq  : c.gasArsEq;
  const netColor = netBig >= 0 ? 'var(--gf-emerald-100)' : 'var(--gf-on-ink-neg)';
  // faltanteArs: gastos totales ArsEq − pesos disponibles (ingresos ARS del mes)
  const faltanteArs = c.gasArsEq - c.pesosDisp;
  const cubierto = faltanteArs <= 0;
  return (
    <>
      <div style={{ background: 'linear-gradient(135deg, var(--gf-ink) 0%, var(--gf-ink-soft) 100%)', borderRadius: 'var(--radius-card)', padding: 'var(--space-4)', color: '#fff', boxShadow: 'var(--shadow-soft)', textAlign: 'center' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'rgba(255,255,255,.55)' }}>Neto del mes</div>
        <div style={{ fontSize: 34, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.5px', lineHeight: 1.05, marginTop: 6, color: netColor }}>
          {netBig >= 0 ? '+' : '−'}{fmt(Math.abs(netBig))}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,.6)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{netBig >= 0 ? '+' : '−'}{fmtOtra(Math.abs(netSmall))}</div>
        <div style={{ display: 'flex', marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.15)' }}>
          {([{ label: 'Ingresos', v: ingBig, eq: ingSmall }, { label: 'Gastos', v: gasBig, eq: gasSmall }] as const).map((x, i) => (
            <div key={x.label} style={{ flex: 1, borderLeft: i > 0 ? '1px solid rgba(255,255,255,.12)' : 'none' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'rgba(255,255,255,.5)' }}>{x.label}</div>
              <div style={{ fontSize: 19, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#fff', marginTop: 3 }}>{fmt(x.v)}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,.55)', fontVariantNumeric: 'tabular-nums', marginTop: 1 }}>{fmtOtra(x.eq)}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Card eyebrow="Pesos disponibles" style={{ flex: 1 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtArs(c.pesosDisp)}</span>
        </Card>
        <Card eyebrow="Cobertura del mes" style={{ flex: 1 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: cubierto ? 'var(--gf-income)' : 'var(--gf-expense)' }}>
            {cubierto
              ? 'Cubierto'
              : `Sin cubrir · −${fmtUsdEq(faltanteArs / c.tcEfectivo)}`}
          </span>
        </Card>
      </div>
    </>
  );
}

// F9.99.8.1 — fila compartida entre "Gastos por día" y la card Hoy: día + chips de banco +
// total grande/chico + chevron expandible. El contenido expandido (children) lo decide cada
// caller: movimientos reales confirmados (Por día) o ítems de agenda con estado (Hoy).
function DiaRowShell({ dayBig, daySub, banks, totalNode, highlight, expanded, onToggle, config, fmtChip, children }: {
  dayBig: string;
  daySub: string;
  banks: [string, Eq][];
  totalNode: ReactNode;
  highlight?: boolean;
  expanded: boolean;
  onToggle: () => void;
  config: FamiliaConfig | null;
  fmtChip: (v: Eq) => string;
  children?: ReactNode;
}) {
  return (
    <Card variant={highlight ? 'highlight' : 'flat'} padding="var(--space-3)">
      <button
        onClick={onToggle}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
      >
        <div style={{ width: 40, flexShrink: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{dayBig}</div>
          <div style={{ fontSize: 10, color: 'var(--gf-gray-400)', textTransform: 'uppercase' }}>{daySub}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {banks.map(([b, v]) => {
            const info = bancoDeNombre(b, config?.bancos);
            return (
              <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--color-text-strong)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '3px 8px 3px 4px' }}>
                <BankLogo id={info?.id ?? b} nombre={info?.nombre ?? b} color={info?.color ?? (colorMedio(b, config?.bancos) ?? colorHash(b))} dominio={info?.dominio} size={17} radius={999} />
                {b} · {fmtChip(v)}
              </span>
            );
          })}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>{totalNode}</div>
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} color="var(--gf-gray-300)" />
      </button>
      {children}
    </Card>
  );
}

// ── Sección: Por día ──────────────────────────────────────────────────────────

function PorDiaSeccion({ movs, porRevisar, config, cur, esAdmin, onEditarMovimiento, checklist, sueltosFuturos, agenda, mes, mapaTc, tcEfectivo, avisoTc, onIrAGastos }: {
  movs: Movement[];
  porRevisar: number;
  onIrAGastos: () => void;
  config: FamiliaConfig | null;
  cur: Moneda;
  esAdmin: boolean;
  onEditarMovimiento?: (mov: Movement) => void;
  checklist: CheckItem[];
  sueltosFuturos: Movement[];
  agenda: AgendaEntry[];
  mes: string;
  mapaTc: Record<string, number>;
  tcEfectivo: number;
  avisoTc: string | null;
}) {
  const hoy = new Date();
  const mesActualHoy = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const esMesActual = mes === mesActualHoy;
  // F9.114 — un único resolutor de TC para toda la sección; nada se convierte a mano.
  const tcDeMov = crearTcDeMovimiento(mapaTc, tcEfectivo, esMesActual);

  const cajaMov = movs.filter(m => m.incluirResumenMes);
  const c = calcularKpis(cajaMov, tcDeMov, tcEfectivo);
  const dias = porDia(cajaMov, tcDeMov, config?.bancos);
  const personas = porPersonaIngreso(cajaMov, tcDeMov);
  const totalMesEq = dias.reduce((s, d) => sumaEq(s, d.eq), EQ0);
  // F9.114 Parte 5 — movimientos en USD sin snapshot propio: ya no valen 0, se valúan con
  // el TC de su fecha, y se dice cuántos son.
  const sinTc = cajaMov.filter(sinTcPropio).length;
  // ARS: como está hoy (ARS principal, USD chico). USD: invertido (USD principal, ARS chico).
  const fmtBig = (e: Eq) => cur === 'ARS' ? fmtArs(e.ars) : fmtUsdEq(e.usd);
  const fmtSmall = (e: Eq) => cur === 'ARS' ? fmtUsdEq(e.usd) : fmtArs(e.ars);
  const [diasExpandidos, setDiasExpandidos] = useState<Set<number>>(new Set());
  const [hoyExpandido, setHoyExpandido] = useState(true);
  // Cifras vivas que no vienen de un movimiento (esperados no pagados): TC de hoy, siempre.
  const eqVivo = (monto: number, moneda: Moneda): Eq => moneda === 'ARS'
    ? { ars: monto, usd: tcEfectivo ? monto / tcEfectivo : 0 }
    : { ars: monto * tcEfectivo, usd: monto };

  // Card HOY (solo para el mes actual). F9.99.8 — unión de:
  //  (a) esperados con diaVencimiento === hoy (comportamiento pre-existente),
  //  (b) esperados en estado 'vencido' (por definición de estadoItem, sin match → no cubiertos),
  //  (c) futuros sueltos (gastos manuales sin plantilla) con fecha === hoy.
  // Vencidos primero, sin duplicar si un ítem cae en (a) y (b) a la vez (no puede pasar: 'vencido'
  // exige diaVencimiento < hoy.getDate()).
  const hoyEsperados: CheckItem[] = [];
  if (esMesActual) {
    const vistos = new Set<string>();
    for (const ci of checklist) if (ci.estado === 'vencido') { hoyEsperados.push(ci); vistos.add(ci.item.id); }
    for (const ci of checklist) if (ci.item.diaVencimiento === hoy.getDate() && !vistos.has(ci.item.id)) hoyEsperados.push(ci);
  }
  const inicioHoy = inicioDia(hoy);
  const sueltosHoy = esMesActual
    ? sueltosFuturos.filter(m => inicioDia(m.fecha).getTime() === inicioHoy.getTime())
    : [];
  // F9.102 1a — tercera fuente: movimientos reales de caja del día que NO son ya matches
  // de algún esperado (mismo dedupe que sueltosFuturosDelMes) ni ya listados como sueltos
  // (esos son los no-pagados de hoy, capturados arriba). En la práctica esto son los gastos
  // de hoy YA pagados que ningún ítem esperado atrapó — ej. un suelto cargado y pagado el
  // mismo día. Van al final: ya están resueltos.
  const matchedIds = new Set(checklist.flatMap(ci => ci.matches.map(m => m.id)));
  const sueltosHoyIds = new Set(sueltosHoy.map(m => m.id));
  const realesHoy = esMesActual
    ? movs.filter(m =>
        m.tipo === 'Gasto' &&
        inicioDia(m.fecha).getTime() === inicioHoy.getTime() &&
        !matchedIds.has(m.id) &&
        !sueltosHoyIds.has(m.id)
      )
    : [];
  const hoyItems: HoyEntry[] = [
    ...hoyEsperados.map(ci => ({ kind: 'esperado', ci } as AgendaEntry)),
    ...sueltosHoy.map(mov => ({ kind: 'suelto', mov } as AgendaEntry)),
    ...realesHoy.map(mov => ({ kind: 'real', mov } as HoyEntry)),
  ];

  // Total de hoy pendiente (ARS eq) para el header de Card HOY, sobre el conjunto ampliado.
  // F9.76 — pendiente/pagado por estado real, no por presencia de match. Un por_confirmar sigue
  // siendo deuda hasta que el pago real lo confirme.
  // F9.102 1b — la rama 'esperado' usa pendienteDeEntrada (monto REAL de los matches cuando
  // por_confirmar/parcial) en vez de leer item.montoEsperado directamente — antes un
  // por_confirmar con montoEsperado null quedaba en $0 pese a tener un match real cargado.
  // F9.114 — el pendiente de un esperado es plata que TODAVÍA no salió → TC de hoy (eqVivo).
  const hoyPendienteEq = hoyItems
    .filter(e => !hoyEntryCubierto(e))
    .reduce((s, e) => {
      if (e.kind !== 'esperado') return sumaEq(s, eqDe(e.mov, tcDeMov));
      return sumaEq(s, eqVivo(pendienteDeEntrada(e), e.ci.item.moneda));
    }, EQ0);
  const todoPagadoHoy = hoyItems.length > 0 && hoyItems.every(hoyEntryCubierto);
  // F9.102 1b — total pagado del día (todos los ítems, incluidos los reales) para mostrar
  // junto al check "Al día" cuando todoPagadoHoy.
  const hoyTotalEq = hoyItems.reduce((s, e) => {
    if (e.kind === 'esperado') return e.ci.matches.reduce((a, m) => sumaEq(a, eqDe(m, tcDeMov)), s);
    return sumaEq(s, eqDe(e.mov, tcDeMov));
  }, EQ0);

  // F9.92.1 — desglose por banco de lo ya conciliado hoy (los pendientes sin match no tienen banco).
  // F9.102 1b — suma también los 'real' (comparten forma con 'suelto': ambos tienen .mov).
  const hoyPorBanco = new Map<string, Eq>();
  for (const e of hoyItems) {
    if (e.kind === 'esperado') {
      const banco = e.ci.matches[0]?.banco;
      if (!banco) continue;
      const monto = e.ci.matches.reduce((s, m) => sumaEq(s, eqDe(m, tcDeMov)), EQ0);
      hoyPorBanco.set(banco, sumaEq(hoyPorBanco.get(banco) ?? EQ0, monto));
    } else {
      if (!hoyEntryCubierto(e) || !e.mov.banco) continue;
      hoyPorBanco.set(e.mov.banco, sumaEq(hoyPorBanco.get(e.mov.banco) ?? EQ0, eqDe(e.mov, tcDeMov)));
    }
  }
  const hoyBancos = [...hoyPorBanco.entries()].sort((a, b) => b[1].ars - a[1].ars);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <KpiCards c={c} cur={cur} />

      {/* F9.114 — la pantalla SIEMPRE dice con qué TC está valuando cuando no es el real de
          /tcDiario, y cuántos movimientos se valuaron sin snapshot propio. */}
      {(avisoTc || sinTc > 0) && (
        <div style={{ margin: '-4px 4px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {avisoTc && <span style={{ fontSize: 11.5, color: 'var(--gf-out)' }}>{avisoTc}</span>}
          {sinTc > 0 && (
            <span style={{ fontSize: 11.5, color: 'var(--gf-gray-400)' }}>
              {sinTc} movimiento{sinTc > 1 ? 's' : ''} en USD sin TC propio — valuado{sinTc > 1 ? 's' : ''} con el TC de esa fecha.
            </span>
          )}
        </div>
      )}

      {/* F9.17 — fila limpia con badge de cantidad, reemplaza el banner amarillo */}
      {/* F9.62 — clickeable: lleva a la solapa Gastos Fijos */}
      {/* F9.92.1 — check verde en vez de badge "0" cuando no hay nada por revisar */}
      {/* F9.99.8 — con pendientes, el texto suma cantidad. F9.99.8.1 — el monto pasa a ser el
          pendiente TOTAL de la agenda (vencidos + por_confirmar a monto real + sueltos), vía
          pendienteAgenda() compartida con GastosFijosSeccion — el disparador (porRevisar===0)
          no cambia. */}
      {/* F9.110 — el banner ya no dice "al día" cuando quedan ítems por confirmar (aunque
          porRevisar, que solo cuenta lo SIN CARGAR, ya esté en 0). Tres estados: pendientes
          por cargar (rojo) · todo confirmado (verde) · nada vencido pero falta confirmar
          (reloj neutro), este último es el caso que antes mentía "al día". */}
      {(() => {
        const cubiertos = agenda.filter(agendaCubierto).length;
        const total = agenda.length;
        const todoConfirmado = porRevisar === 0 && cubiertos === total;
        return (
          <Card variant="flat" padding="var(--space-3)" onClick={onIrAGastos} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            {porRevisar > 0 ? (
              <Icon name="alert-circle" size={17} color="var(--gf-out)" />
            ) : todoConfirmado ? (
              <span style={{ width: 17, height: 17, borderRadius: 999, background: 'var(--gf-income)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="check" size={11} color="#fff" />
              </span>
            ) : (
              <Icon name="clock" size={17} color="var(--gf-gray-400)" />
            )}
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: todoConfirmado ? 'var(--gf-income)' : 'var(--color-text)' }}>
              {porRevisar > 0 ? (
                `Revisar pendientes del mes · ${porRevisar} sin pagar · ${fmtArs(pendienteAgenda(agenda))}`
              ) : todoConfirmado ? (
                `Todo confirmado · ${cubiertos}/${total}`
              ) : (
                <>
                  Nada vencido · {cubiertos}/{total} confirmados
                  {pendienteAgenda(agenda) > 0 && (
                    <span style={{ color: 'var(--color-text-sec)', fontWeight: 500 }}> · {fmtArs(pendienteAgenda(agenda))} a confirmar</span>
                  )}
                </>
              )}
            </span>
          </Card>
        );
      })()}

      {/* F9.99.8.1 — Card Hoy pasa a usar la MISMA fila que "Gastos por día" (DiaRowShell):
          chips de banco, total grande/chico, expandible. El contenido expandido agrega
          estado por ítem (check/reloj/alerta/vencido) y lápiz de edición cuando hay un único
          movimiento real detrás del ítem (esperado con 1 match, o el suelto mismo). */}
      <DiaRowShell
        dayBig={String(hoy.getDate())}
        daySub="HOY"
        banks={hoyBancos}
        totalNode={hoyItems.length === 0 ? null : todoPagadoHoy ? (
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--gf-income)', fontWeight: 700, fontSize: 13 }}>
              <Icon name="check" size={13} color="var(--gf-income)" /> Al día
            </span>
            <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{fmtBig(hoyTotalEq)}</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--gf-expense)' }}>{fmtBig(hoyPendienteEq)}</div>
            <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{fmtSmall(hoyPendienteEq)}</div>
          </>
        )}
        highlight
        expanded={hoyExpandido}
        onToggle={() => setHoyExpandido(v => !v)}
        config={config}
        fmtChip={fmtBig}
      >
        {hoyExpandido && (hoyItems.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-sec)', marginTop: 10 }}>
            {esMesActual ? 'Nada que pagar hoy.' : 'Ver mes actual para pagos de hoy.'}
          </div>
        ) : (
          <div style={{ marginTop: 10, borderTop: '1px solid var(--gf-gray-100)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 0 }}>
            {hoyItems.map((e, i) => {
              const esVencido    = e.kind === 'esperado' && e.ci.estado === 'vencido';
              const pagado       = hoyEntryCubierto(e);
              const porConfirmar = e.kind === 'esperado' && !pagado && (e.ci.estado === 'por_confirmar' || e.ci.estado === 'parcial');
              const etiqueta = e.kind === 'esperado'
                ? ([e.ci.item.categoria, e.ci.item.subcategoria].filter(Boolean).join(' › ') || e.ci.item.notas || '(sin categoría)')
                : (e.mov.descripcion || '(sin descripción)');
              const bancoPago = e.kind === 'esperado' ? e.ci.matches[0]?.banco : (pagado ? e.mov.banco : null);
              const bancoInfo = bancoPago ? bancoDeNombre(bancoPago, config?.bancos) : undefined;
              const key = e.kind === 'esperado' ? e.ci.item.id : e.mov.id;
              const monto = e.kind === 'esperado'
                ? (e.ci.item.montoEsperado != null ? fmtMoney(e.ci.item.montoEsperado, { from: e.ci.item.moneda, to: e.ci.item.moneda }) : '—')
                : fmtMoney(e.mov.monto, { from: e.mov.moneda, to: e.mov.moneda });
              // Lápiz de edición (paridad con la fila de Por día): un suelto o un 'real' son
              // siempre un único movimiento (editable); un esperado con 0 o >1 matches no lo es.
              const editTarget = e.kind !== 'esperado' ? e.mov : (e.ci.matches.length === 1 ? e.ci.matches[0] : null);
              const editable = esAdmin && editTarget != null;
              return (
                <button
                  key={key}
                  onClick={editable ? () => onEditarMovimiento?.(editTarget) : undefined}
                  disabled={!editable}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', width: '100%',
                    borderBottom: i < hoyItems.length - 1 ? '1px solid var(--gf-gray-100)' : 'none',
                    background: 'none', border: 'none', cursor: editable ? 'pointer' : 'default',
                    textAlign: 'left', fontFamily: 'var(--font-base)',
                  }}
                >
                  {pagado && bancoInfo ? (
                    <BankLogo id={bancoInfo.id} nombre={bancoInfo.nombre} color={bancoInfo.color} dominio={bancoInfo.dominio} size={28} radius={7} />
                  ) : (
                    <span style={{ width: 28, height: 28, borderRadius: 7, background: pagado ? 'var(--gf-emerald)' : 'var(--gf-gray-100)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon
                        name={pagado ? 'check' : porConfirmar ? 'alert-circle' : 'clock'}
                        size={14}
                        color={pagado ? '#fff' : porConfirmar ? 'var(--gf-out)' : esVencido ? 'var(--gf-expense)' : 'var(--gf-gray-400)'}
                      />
                    </span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{etiqueta}</div>
                    <div style={{ fontSize: 11, color: esVencido && !pagado ? 'var(--gf-expense)' : 'var(--color-text-sec)', fontWeight: esVencido && !pagado ? 700 : 400 }}>
                      {pagado
                        ? `${e.kind === 'real' ? 'Pagado' : 'Conciliado'}${bancoPago ? ` · ${medioCanonico(bancoPago, config?.bancos)}` : ''}`
                        : porConfirmar ? 'Cargado · a confirmar'
                        : e.kind === 'esperado' && esVencido ? `Venció día ${e.ci.item.diaVencimiento}`
                        : e.kind === 'suelto' ? 'Sin plantilla · a pagar'
                        : 'A pagar'}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0, color: pagado ? 'var(--gf-income)' : 'var(--color-text)' }}>
                    {monto}
                  </div>
                  {editable && <Icon name="pencil" size={12} color="var(--gf-gray-300)" />}
                </button>
              );
            })}
          </div>
        ))}
      </DiaRowShell>

      {personas.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 4px 8px' }}>
            <Icon name="users-round" size={13} color="var(--gf-gray-400)" /> Distribución de ingresos
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {personas.map(([p, eq]) => {
              const nombre = nombrePersona(p, config);
              const col = colorHash(nombre);
              return (
                <div key={p} style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--gf-gray-150)', borderRadius: 'var(--radius-card)', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: col }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-strong)' }}>{nombre}</span>
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtBig(eq)}</div>
                  <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{fmtSmall(eq)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '0 4px 8px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
            <Icon name="calendar-days" size={13} color="var(--gf-gray-400)" /> Gastos por día
          </span>
          <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Total mes <strong style={{ color: 'var(--color-text)' }}>{fmtBig(totalMesEq)}</strong></span>
        </div>
        {dias.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-sec)', margin: '0 4px' }}>Sin gastos de caja este mes.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dias.map(d => {
              const isHoy   = d.date.toDateString() === hoy.toDateString();
              const banks   = Object.entries(d.banks).sort((a, b) => b[1].ars - a[1].ars);
              const expanded = diasExpandidos.has(d.day);
              const movsDelDia = cajaMov.filter(m => m.tipo === 'Gasto' && m.fecha.getDate() === d.day && m.fecha.toDateString() === d.date.toDateString());
              const totalNode = (
                <>
                  <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtBig(d.eq)}</div>
                  <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{fmtSmall(d.eq)}</div>
                </>
              );
              return (
                <DiaRowShell
                  key={d.day}
                  dayBig={String(d.day)}
                  daySub={DIA_ES[d.date.getDay()]}
                  banks={banks}
                  totalNode={totalNode}
                  highlight={isHoy}
                  expanded={expanded}
                  onToggle={() => setDiasExpandidos(prev => { const s = new Set(prev); s.has(d.day) ? s.delete(d.day) : s.add(d.day); return s; })}
                  config={config}
                  fmtChip={fmtBig}
                >
                  {isHoy && <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gf-emerald)', textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 6 }}>Hoy</div>}
                  {expanded && movsDelDia.length > 0 && (
                    <div style={{ marginTop: 8, borderTop: '1px solid var(--gf-gray-100)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 0 }}>
                      {movsDelDia.map((m, i) => (
                        <button
                          key={m.id}
                          onClick={esAdmin ? () => onEditarMovimiento?.(m) : undefined}
                          disabled={!esAdmin}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0',
                            borderBottom: i < movsDelDia.length - 1 ? '1px solid var(--gf-gray-100)' : 'none',
                            background: 'none', border: 'none', cursor: esAdmin ? 'pointer' : 'default',
                            textAlign: 'left', width: '100%', fontFamily: 'var(--font-base)',
                          }}
                        >
                          <MerchantLogo nombre={m.descripcion} size={30} radius={8} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.descripcion}</div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-sec)' }}>
                              {m.banco ? medioCanonico(m.banco, config?.bancos) : ''}
                              {m.subcategoria ? ` · ${m.subcategoria}` : ''}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--gf-out)' }}>
                              {fmtMoney(m.monto, { from: m.moneda, to: m.moneda })}
                            </div>
                            {/* F9.114 — el equivalente en pesos se muestra también cuando el
                                movimiento en USD no trae snapshot propio (antes esa fila valía
                                0 y desaparecía de los totales): se marca "TC estimado". */}
                            {m.moneda === 'USD' && (
                              <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>
                                {fmtArs(arsEq(m, tcDeMov))}
                                {sinTcPropio(m) && <span style={{ marginLeft: 5, color: 'var(--gf-out)' }}>TC estimado</span>}
                              </div>
                            )}
                          </div>
                          {esAdmin && <Icon name="pencil" size={12} color="var(--gf-gray-300)" />}
                        </button>
                      ))}
                    </div>
                  )}
                </DiaRowShell>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ height: 4 }} />
    </div>
  );
}

// ── Sección: Gastos Fijos (checklist de esperados) ───────────────────────────

const TINT: Record<EstadoChecklist, string> = {
  pagado:        'var(--st-pagado-line)',
  por_confirmar: 'var(--st-por-confirmar-line)',
  parcial:       'var(--st-parcial-line)',
  automatico:    'var(--st-automatico-line)',
  pendiente:     'var(--st-pendiente-line)',
  vencido:       'var(--st-vencido-line)',
  programado:    'var(--st-programado-line)',
  no_registrado: 'var(--st-no-registrado-line)',
  no_aplica:     'var(--gf-gray-300)',
};

function MontoInlineEdit({ item }: { item: ExpectedItem }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');

  function startEdit() {
    setVal(item.montoEsperado != null ? String(item.montoEsperado) : '');
    setEditing(true);
  }

  async function commit() {
    setEditing(false);
    const n = parseFloat(val.replace(',', '.'));
    if (!isNaN(n) && n > 0 && n !== item.montoEsperado) {
      await actualizarItemEsperado(item.id, { montoEsperado: n });
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        inputMode="decimal"
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        style={{ width: 90, fontSize: 14, fontVariantNumeric: 'tabular-nums', border: '1px solid var(--gf-gray-300)', borderRadius: 6, padding: '2px 6px', textAlign: 'right' }}
      />
    );
  }
  return (
    <span
      onClick={startEdit}
      title="Editar monto esperado"
      style={{ cursor: 'text', borderBottom: '1px dashed var(--gf-gray-300)' }}
    >
      <Money value={item.montoEsperado ?? 0} currency={item.moneda} colored={false} decimals={0} style={{ fontSize: 15 }} />
    </span>
  );
}

function hoyISOLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDDMM(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function mesDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// F9.99.7 Parte 4.2/4.4 — tarjeta de un ítem del checklist, reutilizada tanto en la lista
// principal como en la sección "Débitos automáticos" (mismos estados/interacciones).
function ItemChecklistCard({ ci, mes, config, esMesActual, onConfirmar, onDesmarcar, onRegistrarPago }: {
  ci: CheckItem;
  mes: string;
  config: FamiliaConfig | null;
  esMesActual: boolean;
  onConfirmar: (item: ExpectedItem, matches: Movement[]) => void;
  onDesmarcar: (matches: Movement[]) => void;
  onRegistrarPago: (item: ExpectedItem, monto: number, fecha: Date) => Promise<void>;
}) {
  const { item, matches, estado } = ci;
  // F9.111 — total de ítems que disputaron algún movimiento de este ítem (unión de `otros`
  // a través de todas las disputas, no solo la primera).
  const disputaCount = new Set(ci.disputas?.flatMap(d => d.otros) ?? []).size;
  const [registrando, setRegistrando] = useState(false);
  const [montoVal, setMontoVal] = useState('');
  const [fechaVal, setFechaVal] = useState('');
  const [guardando, setGuardando] = useState(false);

  const accionable = ACCIONABLE.includes(estado);
  const montoReal = matches.reduce((s, m) => s + Math.abs(m.monto), 0);
  const tieneMatch = estado === 'pagado' || estado === 'parcial' || estado === 'por_confirmar';
  const monto = tieneMatch ? montoReal : (item.montoEsperado ?? 0);
  const etiqueta = [item.categoria, item.subcategoria].filter(Boolean).join(' › ') || item.notas || '(sin categoría)';

  // F9.99.7 Parte 3 — pago adelantado: el mes real del pago (pagadoEn) difiere del mes del ítem.
  const pagadoEn = matches.find(m => m.pagadoEn)?.pagadoEn ?? null;
  const esAdelantado = estado === 'pagado' && pagadoEn != null && mesDe(pagadoEn) !== mes;

  function abrirRegistrar() {
    setMontoVal(item.montoEsperado != null ? String(item.montoEsperado) : '');
    setFechaVal(hoyISOLocal());
    setRegistrando(true);
  }

  async function confirmarRegistro() {
    const n = parseFloat(montoVal.replace(',', '.'));
    if (isNaN(n) || n <= 0) return;
    setGuardando(true);
    await onRegistrarPago(item, n, new Date(fechaVal + 'T12:00:00'));
    setGuardando(false);
    setRegistrando(false);
  }

  return (
    <div style={{ display: 'flex', gap: 10, background: 'var(--color-surface)', border: '1px solid var(--gf-gray-150)', borderRadius: 14, padding: '11px 12px' }}>
      <span style={{ width: 9, height: 9, borderRadius: 999, background: TINT[estado], marginTop: 6, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{etiqueta}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {item.persona && <Badge tone="neutral">{nombrePersona(item.persona, config)}</Badge>}
              <StatusBadge state={estado} />
              {/* F9.111 — empate arbitrado: la ambigüedad se muestra, no se duplica en silencio.
                  El vínculo directo (pase 1) gana siempre y el empate desaparece al asignar. */}
              {disputaCount > 0 && (
                <Badge tone="warning">
                  Ambiguo · lo reclama{disputaCount > 1 ? 'n' : ''} {disputaCount} ítem{disputaCount > 1 ? 's' : ''}
                </Badge>
              )}
            </div>
            {disputaCount > 0 && (
              <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 }}>
                Asignalo a mano al gasto esperado que corresponda para fijarlo.
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            {!tieneMatch && !item.tarjetaCodigo
              ? <MontoInlineEdit item={item} />
              : <Money value={monto} currency={item.moneda} colored={false} decimals={0} style={{ fontSize: 15 }} />
            }
            {estado === 'parcial' && <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>Falta completar</div>}
          </div>
        </div>
        {estado === 'por_confirmar' && (
          <div style={{ marginTop: 9 }}>
            <Button variant="green" size="sm" style={{ width: '100%' }} onClick={() => onConfirmar(item, matches)}>
              <Icon name="check" size={15} /> Confirmar pago
            </Button>
          </div>
        )}
        {estado === 'pagado' && esAdelantado && (
          <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 4 }}>Pagado por adelantado el {fmtDDMM(pagadoEn as Date)}</div>
        )}
        {estado === 'pagado' && esMesActual && matches.length > 0 && (
          <div style={{ marginTop: 9 }}>
            <Button variant="secondary" size="sm" style={{ width: '100%' }} onClick={() => onDesmarcar(matches)}>
              Deshacer
            </Button>
          </div>
        )}
        {/* F9.99.7 Parte 4.4 — cualquier accionable SIN match puede registrarse como pagado directamente */}
        {accionable && matches.length === 0 && !registrando && (
          <div style={{ marginTop: 9 }}>
            <Button variant="secondary" size="sm" style={{ width: '100%' }} onClick={abrirRegistrar}>
              <Icon name="plus" size={14} /> Registrar pago
            </Button>
          </div>
        )}
        {registrando && (
          <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text" inputMode="decimal" autoFocus value={montoVal} onChange={e => setMontoVal(e.target.value)}
                placeholder="Monto" style={{ flex: 1, fontSize: 13, border: '1px solid var(--gf-gray-300)', borderRadius: 8, padding: '6px 8px' }}
              />
              <input
                type="date" value={fechaVal} onChange={e => setFechaVal(e.target.value)}
                style={{ fontSize: 13, border: '1px solid var(--gf-gray-300)', borderRadius: 8, padding: '6px 8px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button variant="green" size="sm" style={{ flex: 1 }} disabled={guardando || !montoVal} onClick={confirmarRegistro}>
                {guardando ? 'Guardando…' : 'Confirmar'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRegistrando(false)}>Cancelar</Button>
            </div>
          </div>
        )}
        {accionable && estado !== 'por_confirmar' && item.diaVencimiento && (
          <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 6 }}>vence día {item.diaVencimiento}</div>
        )}
      </div>
    </div>
  );
}

// F9.99.8 — tarjeta de un futuro suelto (gasto manual sin plantilla) dentro de la agenda del mes.
// Sin estado de la state machine (no es ExpectedItem): check verde solo si confirmadoPago=true.
// F9.99.8.1 — accionable: "Marcar pagado"/"Deshacer" edita el movimiento existente
// (pagado + confirmadoPago) vía marcarPagadoSuelto/desmarcarPagadoSuelto — nunca crea uno nuevo.
function SueltoAgendaCard({ mov, config, onMarcarPagado, onDeshacer }: {
  mov: Movement;
  config: FamiliaConfig | null;
  onMarcarPagado: (mov: Movement) => Promise<void>;
  onDeshacer: (mov: Movement) => Promise<void>;
}) {
  const pagado = mov.confirmadoPago === true;
  const etiqueta = mov.descripcion || '(sin descripción)';
  const [guardando, setGuardando] = useState(false);

  async function marcar() { setGuardando(true); await onMarcarPagado(mov); setGuardando(false); }
  async function deshacer() { setGuardando(true); await onDeshacer(mov); setGuardando(false); }

  return (
    <div style={{ display: 'flex', gap: 10, background: 'var(--color-surface)', border: '1px solid var(--gf-gray-150)', borderRadius: 14, padding: '11px 12px' }}>
      <span style={{ width: 9, height: 9, borderRadius: 999, background: pagado ? TINT.pagado : TINT.pendiente, marginTop: 6, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{etiqueta}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {mov.persona && <Badge tone="neutral">{nombrePersona(mov.persona, config)}</Badge>}
              <Badge tone="neutral">Sin plantilla</Badge>
            </div>
          </div>
          <Money value={mov.monto} currency={mov.moneda} colored={false} decimals={0} style={{ fontSize: 15, flexShrink: 0 }} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 6 }}>
          {pagado ? 'Conciliado' : `Vence ${fmtDDMM(mov.fecha)}`}
        </div>
        {!pagado && (
          <div style={{ marginTop: 9 }}>
            <Button variant="green" size="sm" style={{ width: '100%' }} disabled={guardando} onClick={marcar}>
              <Icon name="check" size={15} /> Marcar pagado
            </Button>
          </div>
        )}
        {pagado && (
          <div style={{ marginTop: 9 }}>
            <Button variant="secondary" size="sm" style={{ width: '100%' }} disabled={guardando} onClick={deshacer}>
              Deshacer
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function GastosFijosSeccion({ agenda, config, onConfirmar, onDesmarcar, onRegistrarPago, onMarcarPagadoSuelto, onDeshacerSuelto, esMesActual, mes }: {
  agenda: AgendaEntry[];
  config: FamiliaConfig | null;
  onConfirmar: (item: ExpectedItem, matches: Movement[]) => void;
  onDesmarcar: (matches: Movement[]) => void;
  onRegistrarPago: (item: ExpectedItem, monto: number, fecha: Date) => Promise<void>;
  onMarcarPagadoSuelto: (mov: Movement) => Promise<void>;
  onDeshacerSuelto: (mov: Movement) => Promise<void>;
  esMesActual: boolean;
  mes: string;
}) {
  const alDia = agenda.filter(agendaCubierto).length;
  // F9.62/F9.99.8 — "pendiente" = pendienteAgenda() compartida con PorDiaSeccion (F9.99.8.1),
  // ver src/datos/agenda.ts.
  const pendiente = pendienteAgenda(agenda);

  // F9.99.7 Parte 4.2 — débitos automáticos: sección propia, mismas tarjetas/estados/acciones.
  // F9.99.8 — los sueltos nunca son pagoAutomatico, quedan siempre en "principales".
  // F9.99.8.1 — principales ya no anexa los sueltos al final: se intercalan con los esperados
  // por día de vencimiento ascendente (diaDeAgenda, sort estable — ítems del mismo día
  // conservan el orden relativo previo por estado).
  const principales = agenda
    .filter(e => e.kind === 'suelto' || !e.ci.item.pagoAutomatico)
    .slice()
    .sort((a, b) => diaDeAgenda(a) - diaDeAgenda(b));
  const automaticos  = agenda.filter((e): e is { kind: 'esperado'; ci: CheckItem } => e.kind === 'esperado' && e.ci.item.pagoAutomatico);
  const cardProps = { mes, config, esMesActual, onConfirmar, onDesmarcar, onRegistrarPago };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <Card eyebrow="Pendiente" style={{ flex: 1 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-expense)', fontVariantNumeric: 'tabular-nums' }}>{fmtArs(pendiente)}</span>
        </Card>
        <Card eyebrow="Confirmados" style={{ flex: '0 0 96px', textAlign: 'center' }}>
          <span style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{alDia}<span style={{ fontSize: 14, color: 'var(--gf-gray-400)' }}>/{agenda.length}</span></span>
        </Card>
      </div>

      {agenda.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-sec)', margin: '0 4px' }}>Sin ítems esperados activos.</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {principales.map(e => e.kind === 'esperado'
              ? <ItemChecklistCard key={e.ci.item.id} ci={e.ci} {...cardProps} />
              : <SueltoAgendaCard key={e.mov.id} mov={e.mov} config={config} onMarcarPagado={onMarcarPagadoSuelto} onDeshacer={onDeshacerSuelto} />
            )}
          </div>
          {automaticos.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '2px 4px 0' }}>
                Débitos automáticos
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {automaticos.map(e => <ItemChecklistCard key={e.ci.item.id} ci={e.ci} {...cardProps} />)}
              </div>
            </>
          )}
        </>
      )}
      <div style={{ height: 4 }} />
    </div>
  );
}

// ── Shell con toggle segmentado ───────────────────────────────────────────────

function ResumenVisual() {
  const location = useLocation();
  const secInicial = (location.state as { sec?: 'dia' | 'fijos' } | null)?.sec ?? 'dia';
  const [sec, setSec] = useState<'dia' | 'fijos'>(secInicial);
  const [mes, setMes] = useState(mesActual);
  const [cur, setCur] = useState<Moneda>('ARS');
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [editandoMovimiento, setEditandoMovimiento] = useState<Movement | null>(null);
  const tabs: { id: 'dia' | 'fijos'; label: string }[] = [{ id: 'dia', label: 'Por día' }, { id: 'fijos', label: 'Gastos Fijos' }];

  // F9.114 — dos fuentes distintas, a propósito:
  //  · mapaTc: fecha → TC, para valuar lo YA movido al dólar de su día (congelado).
  //  · tcHoy: para lo VIVO (esperados no pagados + ingresos del mes en curso).
  // El rango arranca 10 días antes del mes para que el día 1 tenga un TC anterior aunque
  // caiga en fin de semana o feriado (tcDeFecha busca hacia atrás).
  const [mapaTc, setMapaTc] = useState<Record<string, number>>({});
  // F9.117 — estado explícito: mientras carga no se muestra ningún aviso de TC.
  const [tcHoy, setTcHoy] = useState<EstadoTcHoy>({ estado: 'cargando' });

  useEffect(() => {
    const [y, m] = mes.split('-').map(Number);
    const desde = new Date(y, m - 1, 1);
    desde.setDate(desde.getDate() - 10);
    const hasta = new Date(y, m, 0);
    setTcHoy({ estado: 'cargando' });
    cargarTCRango(isoLocal(desde), isoLocal(hasta))
      .then(setMapaTc)
      .catch(err => { console.warn('[Resumen] tcRango falló:', err); setMapaTc({}); });
    cargarTCReciente(1)
      .then(h => {
        const tc = h[0]?.tcUsdArs;
        setTcHoy(tc ? { estado: 'ok', tc } : { estado: 'vacio' });
      })
      .catch(err => { console.error('[Resumen] tcHoy falló:', err); setTcHoy({ estado: 'error' }); });
  }, [mes]);

  const { tc: tcEfectivo, aviso: avisoTc } = tcEfectivoDe(tcHoy);

  const { memberId, miembro } = useMiembroCtx();
  const esAdmin = miembro.rol === 'admin';
  const { config } = useFamiliaConfig();
  const { movimientos, cargando, error } = useMovimientosDelMes(mes);
  const { items } = useItemsEsperados();
  const checklist = calcularChecklist(items, movimientos, mes);
  // F9.62 — "revisar" cuenta solo lo SIN CARGAR (sin movimiento asociado). por_confirmar
  // tiene match (cargado, falta confirmar) y NO entra en este conteo.
  const porRevisar = checklist.filter(c => c.matches.length === 0 && ACCIONABLE.includes(c.estado)).length;
  // F9.99.8 — agenda unificada: checklist (sin cambios) ∪ futuros sueltos sin plantilla.
  const sueltosFuturos = sueltosFuturosDelMes(movimientos, checklist, new Date());
  const agenda = construirAgenda(checklist, sueltosFuturos);

  async function handleConfirmar(item: ExpectedItem, matches: Movement[]) {
    const res = await confirmarPagoEsperado(item, matches);
    if (!res.ok) setErrorAccion(res.error.message);
  }
  async function handleDesmarcar(matches: Movement[]) {
    const res = await desmarcarPago(matches);
    if (!res.ok) setErrorAccion(res.error.message);
  }
  async function handleRegistrarPago(item: ExpectedItem, monto: number, fecha: Date) {
    const res = await registrarPagoChecklist(item, mes, { monto, fecha, creadoPor: memberId, persona: null });
    if (!res.ok) setErrorAccion(res.error.message);
  }
  // F9.99.8.1 — "Marcar pagado"/"Deshacer" de un suelto de agenda, vía SueltoAgendaCard.
  async function handleMarcarPagadoSuelto(mov: Movement) {
    const res = await marcarPagadoSuelto(mov);
    if (!res.ok) setErrorAccion(res.error.message);
  }
  async function handleDeshacerSuelto(mov: Movement) {
    const res = await desmarcarPagadoSuelto(mov);
    if (!res.ok) setErrorAccion(res.error.message);
  }

  if (editandoMovimiento) {
    return (
      <EditarMovimiento
        movimiento={editandoMovimiento}
        onGuardado={() => setEditandoMovimiento(null)}
        onEliminado={() => setEditandoMovimiento(null)}
        onCancelar={() => setEditandoMovimiento(null)}
      />
    );
  }

  return (
    <div className="res">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button onClick={() => setMes(m => desplazarMes(m, -1))} aria-label="Mes anterior" style={{ width: 30, height: 30, borderRadius: 999, border: 'none', background: 'var(--gf-gray-100)', cursor: 'pointer', fontSize: 16 }}>‹</button>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{formatMes(mes)}</span>
        <button onClick={() => setMes(m => desplazarMes(m, 1))} aria-label="Mes siguiente" style={{ width: 30, height: 30, borderRadius: 999, border: 'none', background: 'var(--gf-gray-100)', cursor: 'pointer', fontSize: 16 }}>›</button>
      </div>

      {sec === 'dia' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 3, background: 'var(--gf-gray-200)', borderRadius: 999, padding: 3 }}>
            {(['ARS', 'USD'] as const).map(id => {
              const on = cur === id;
              return (
                <button key={id} onClick={() => setCur(id)} style={{
                  padding: '5px 12px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)',
                  fontSize: 12, fontWeight: 700, background: on ? 'var(--color-surface)' : 'transparent',
                  color: on ? 'var(--color-text)' : 'var(--color-text-sec)', boxShadow: on ? 'var(--shadow-sm)' : 'none', transition: '.15s',
                }}>{id === 'ARS' ? '$ ARS' : 'USD'}</button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, background: 'var(--gf-gray-100)', borderRadius: 999, padding: 4 }}>
        {tabs.map(t => {
          const on = sec === t.id;
          return (
            <button key={t.id} onClick={() => setSec(t.id)} style={{
              flex: 1, padding: '8px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-base)', fontSize: 13, fontWeight: on ? 700 : 500,
              background: on ? 'var(--color-surface)' : 'transparent',
              color: on ? 'var(--color-text)' : 'var(--color-text-sec)',
              boxShadow: on ? 'var(--shadow-sm)' : 'none', transition: 'background .15s, color .15s',
            }}>{t.label}</button>
          );
        })}
      </div>

      {errorAccion && <p style={{ color: 'var(--gf-err-text)', fontSize: 13, margin: '0 4px' }}>{errorAccion}</p>}

      {cargando ? (
        <p style={{ textAlign: 'center', color: 'var(--color-text-sec)', padding: '24px 0' }}>Cargando…</p>
      ) : error ? (
        <p style={{ textAlign: 'center', color: 'var(--gf-err-text)', padding: '24px 0' }}>Error: {error}</p>
      ) : sec === 'dia' ? (
        <PorDiaSeccion movs={movimientos} porRevisar={porRevisar} config={config} cur={cur} esAdmin={esAdmin} onEditarMovimiento={setEditandoMovimiento} checklist={checklist} sueltosFuturos={sueltosFuturos} agenda={agenda} mes={mes} mapaTc={mapaTc} tcEfectivo={tcEfectivo} avisoTc={avisoTc} onIrAGastos={() => setSec('fijos')} />
      ) : (
        <GastosFijosSeccion
          agenda={agenda}
          config={config}
          onConfirmar={handleConfirmar}
          onDesmarcar={handleDesmarcar}
          onRegistrarPago={handleRegistrarPago}
          onMarcarPagadoSuelto={handleMarcarPagadoSuelto}
          onDeshacerSuelto={handleDeshacerSuelto}
          esMesActual={mes === mesActual()}
          mes={mes}
        />
      )}
    </div>
  );
}

// ── Vista principal — guard de rol separado de hooks (P2 fix histórico) ──────

export default function Resumen() {
  const { miembro } = useMiembroCtx();
  if (miembro.rol !== 'admin') return <Navigate to="/" replace />;
  return <ResumenVisual />;
}
