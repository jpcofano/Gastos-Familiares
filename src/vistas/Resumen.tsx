import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { useItemsEsperados } from '../contexto/ItemsEsperadosContext';
import { useMovimientosDelMes } from '../hooks/useMovimientosDelMes';
import { useFamiliaConfig } from '../hooks/useFamiliaConfig';
import { confirmarPagoEsperado, desmarcarPago, registrarPagoChecklist, marcarPagadoSuelto, desmarcarPagadoSuelto } from '../datos/movimientos';
import { actualizarItemEsperado } from '../datos/itemsEsperados';
import { Icon } from '../design-system/Icon';
import { Card, Money, MoneyInput, StatusBadge, Badge, Button, BankLogo, MerchantLogo, type EstadoChecklist } from '../design-system/components';
import { fmtMoney } from '../datos/money';
import { cargarTCReciente, tcDeFecha, tcEfectivoDe, type EstadoTcHoy } from '../datos/tcDiario';
import { usePrivacidad, fmtPct, BasePrivacidad } from '../contexto/PrivacidadContext';
import { cargarTCRango } from '../datos/patrimonioOptimizacion';
import { medioCanonico, colorMedio, MEDIOS_FALLBACK } from '../datos/medios';
import { colorHash } from '../datos/agregados';
import { calcularChecklist, cubierto, ACCIONABLE, type CheckItem } from '../datos/checklist';
import { construirAgenda, agendaCubierto, sueltosFuturosDelMes, pendienteAgenda, diaDeAgenda, inicioDia, type AgendaEntry } from '../datos/agenda';
import EditarMovimiento from './EditarMovimiento';
import type { Movement, ExpectedItem, FamiliaConfig, MedioPago } from '../types';
import './Resumen.css';

type Moneda = 'ARS' | 'USD';

// F9.132.2 — acá vivían `HoyEntry` y `hoyEntryCubierto`, el tipo unión que mezclaba entradas de
// agenda con movimientos reales para alimentar la Card HOY. Las dos cards se construyen ahora
// sobre `Movement` directo: no hace falta un tipo que unifique tres formas distintas de "lo de hoy".

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

// F9.132.1 cambio C — MONTO REAL, en la moneda en la que se movió la plata. `Eq` es una
// CONVERSIÓN: para un gasto en pesos calcula un `usd` que nadie transfirió, y mostrarlo como si
// fuera un monto real hace que un banco que solo movió pesos aparezca con dólares.
// El dato de moneda original existe y es confiable (`Movement.moneda` + `Movement.monto`), así que
// la separación se puede hacer sin inventar nada. Un `MontoReal` NO se suma entre monedas.
interface MontoReal { ars: number; usd: number }
const REAL0: MontoReal = { ars: 0, usd: 0 };
function sumarReal(a: MontoReal, moneda: Moneda, monto: number): MontoReal {
  return moneda === 'ARS' ? { ars: a.ars + monto, usd: a.usd } : { ars: a.ars, usd: a.usd + monto };
}
function totalReal(movs: Movement[]): MontoReal {
  return movs.reduce((s, m) => sumarReal(s, m.moneda, m.monto), REAL0);
}
function agruparReal(movs: Movement[], clave: (m: Movement) => string): Map<string, MontoReal> {
  const map = new Map<string, MontoReal>();
  for (const m of movs) map.set(clave(m), sumarReal(map.get(clave(m)) ?? REAL0, m.moneda, m.monto));
  return map;
}

function sinTcPropio(m: Movement): boolean { return m.moneda === 'USD' && !m.tcUsdArs; }

// F9.132.2 cambio 1 — fecha con la que un movimiento se considera exigible: la primera de
// `vencimientos[].fecha` cuando el comprobante la trajo, si no la fecha del movimiento.
// Medido sobre los impagos del 7/8/2026: AYSA no tiene `vencimientos` (cae a `m.fecha`) y
// Empresa Distribuidora sí, con `2026-08-07` — el mismo día. Las dos ramas están vivas.
// Se normaliza a inicio de día para poder comparar contra `inicioHoy` sin arrastrar la hora.
function fechaEfectivaMov(m: Movement): Date {
  const venc = m.vencimientos;
  if (Array.isArray(venc) && venc.length > 0 && venc[0]?.fecha) {
    const d = new Date(`${String(venc[0].fecha).slice(0, 10)}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }
  return inicioDia(m.fecha);
}

function nombrePersona(memberId: string | null, config: FamiliaConfig | null): string {
  if (!memberId) return '—';
  return config?.miembros[memberId]?.nombre ?? memberId;
}

// F9.133 §1 — `excluirDash: true` marca un AGREGADO ESTRUCTURAL: el pago de tarjeta consolidado y
// las percepciones consolidadas que el importador genera para cuadrar el resumen. No tienen
// `persona` porque no les corresponde tener una — no es que falte cargarla.
// Mostrarlos como "Sin asignar" convierte una decisión de modelo en un hueco de carga inexistente,
// y de paso esconde el hueco verdadero adentro del ruido: sobre 2026-06/07/08 eran 22 de los 60
// movimientos sin persona. Helper único acá, no un `if` en cada consumidor.
function etiquetaPersona(m: Movement, config: FamiliaConfig | null): string {
  if (m.excluirDash) return 'Agregado';
  return m.persona ? nombrePersona(m.persona, config) : 'Sin asignar';
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
  // F9.120 — con modo privacidad todo se expresa como % del ingreso del mes, que es la base
  // declarada de esta pantalla. El equivalente en la otra moneda se omite: sería el mismo %.
  const { privado } = usePrivacidad();
  const base = c.ingArsEq;
  // Con privacidad se toman SIEMPRE las cifras en ARS-eq: son las que comparten base con el
  // denominador. Porcentualizar el valor en USD contra una base en pesos daría cualquier cosa.
  const enArs    = privado || cur === 'ARS';
  const netBig   = enArs ? c.netArsEq  : c.netUsdEq;
  const netSmall = enArs ? c.netUsdEq  : c.netArsEq;
  const fmt      = privado ? ((n: number) => fmtPct(n, base)) : (cur === 'ARS' ? fmtArs : fmtUsdEq);
  const fmtOtra  = privado ? (() => '')                       : (cur === 'ARS' ? fmtUsdEq : fmtArs);
  const ingBig   = enArs ? c.ingArsEq  : c.ingUsdEq;
  const ingSmall = enArs ? c.ingUsdEq  : c.ingArsEq;
  const gasBig   = enArs ? c.gasArsEq  : c.gasUsdEq;
  const gasSmall = enArs ? c.gasUsdEq  : c.gasArsEq;
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
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{privado ? fmtPct(c.pesosDisp, base) : fmtArs(c.pesosDisp)}</span>
        </Card>
        <Card eyebrow="Cobertura del mes" style={{ flex: 1 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: cubierto ? 'var(--gf-income)' : 'var(--gf-expense)' }}>
            {cubierto
              ? 'Cubierto'
              : `Sin cubrir · −${privado ? fmtPct(faltanteArs, base) : fmtUsdEq(faltanteArs / c.tcEfectivo)}`}
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

// F9.132.2 — fila de la Card 1. Es un MOVIMIENTO impago, no una entrada de agenda: todas las
// filas de la card comparten estado (`pagado: false`), así que el semáforo por ítem que traía
// de F9.99.8.1 no distinguía nada. Lo único que varía es si ya venció.
// El `monto` llega ya formateado por el caller: es el único que sabe si el modo privacidad
// está activo, y todo lo que imprime plata tiene que pasar por un formateador que lo conozca
// (F9.123, F9.124 §5, F9.132, F9.132.1 — quinta vez en la serie).
function FilaAPagar({ m, config, conBorde, esAdmin, onEditar, monto, pie, vencido }: {
  m: Movement;
  config: FamiliaConfig | null;
  conBorde: boolean;
  esAdmin: boolean;
  onEditar?: (mov: Movement) => void;
  monto: string;
  pie: string;
  vencido?: boolean;
}) {
  // Gana el banco del MOVIMIENTO: es de dónde sale la plata. `item.banco` sólo sirve de
  // fallback para un pendiente sin match, que no vive en esta card.
  const info = m.banco ? bancoDeNombre(m.banco, config?.bancos) : undefined;
  return (
    <button
      onClick={esAdmin ? () => onEditar?.(m) : undefined}
      disabled={!esAdmin}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', width: '100%',
        borderBottom: conBorde ? '1px solid var(--gf-gray-100)' : 'none',
        background: 'none', border: 'none', cursor: esAdmin ? 'pointer' : 'default',
        textAlign: 'left', fontFamily: 'var(--font-base)',
      }}
    >
      {info ? (
        <BankLogo id={info.id} nombre={info.nombre} color={info.color} dominio={info.dominio} size={28} radius={7} />
      ) : (
        <span style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--gf-gray-100)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="clock" size={14} color={vencido ? 'var(--gf-expense)' : 'var(--gf-gray-400)'} />
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {m.descripcion || '(sin descripción)'}
        </div>
        <div style={{ fontSize: 11, color: vencido ? 'var(--gf-expense)' : 'var(--color-text-sec)', fontWeight: vencido ? 700 : 400 }}>
          {pie}{m.banco ? ` · ${medioCanonico(m.banco, config?.bancos)}` : ''}
        </div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{monto}</div>
      {esAdmin && <Icon name="pencil" size={12} color="var(--gf-gray-300)" />}
    </button>
  );
}

const fmtDiaCorto = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;

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
  const { privado } = usePrivacidad();
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
  // F9.120 — modo privacidad: la base de Resumen es el ingreso del mes (lo natural acá: cuánto
  // de lo que entró se lleva cada cosa). Se declara en el encabezado — un 43% sin base no
  // significa nada. El equivalente en la otra moneda se omite: en % sería el mismo número.
  const fmtBig = (e: Eq) => privado ? fmtPct(e.ars, c.ingArsEq) : (cur === 'ARS' ? fmtArs(e.ars) : fmtUsdEq(e.usd));
  const fmtSmall = (e: Eq) => privado ? '' : (cur === 'ARS' ? fmtUsdEq(e.usd) : fmtArs(e.ars));
  // F9.132.1 cambio C — REVIERTE el cambio 2 de F9.132 (bancos en USD equivalente). Montos REALES:
  // pesos y dólares, cada uno en su moneda de origen, y la que está en cero no se muestra — un
  // banco que solo movió pesos no puede mostrar `U$S 0`.
  // Con privacidad activa sale un único % contra la base declarada de la pantalla: porcentualizar
  // dos monedas por separado daría dos números que no se pueden comparar entre sí.
  const fmtReal = (r: MontoReal): string => {
    if (privado) return fmtPct(r.ars + r.usd * tcEfectivo, c.ingArsEq);
    const partes: string[] = [];
    if (r.ars !== 0) partes.push(fmtArs(r.ars));
    if (r.usd !== 0) partes.push(fmtUsdEq(r.usd));
    return partes.length > 0 ? partes.join(' · ') : fmtArs(0);
  };
  const fmtChipReal = (r: MontoReal) => fmtReal(r);
  const [diasExpandidos, setDiasExpandidos] = useState<Set<number>>(new Set());
  const [hoyExpandido, setHoyExpandido] = useState(true);
  const [gastadoExpandido, setGastadoExpandido] = useState(true);
  const inicioHoy = inicioDia(hoy);

  // F9.132.2 cambio 1 — acá vivía la construcción de `hoyItems` (F9.99.8): la unión de esperados
  // con `diaVencimiento === hoy`, esperados en estado 'vencido', sueltos del día y reales del día,
  // con sus totales `hoyPendienteEq` / `hoyTotalEq` / `hoyBancos`. Se borra entera, no se deja
  // "por las dudas": la rejilla de `diaVencimiento` dejaba la card vacía todos los días salvo el
  // 20, y desde F9.132.1 (`banks={[]}`) la mitad de esos cálculos ya no llegaba a la pantalla.
  // Las dos cards se construyen ahora directamente sobre `cajaMov`, abajo.

  // ── F9.132.1 — CARD 2: lo que YA se gastó hoy ───────────────────────────────
  // MISMA fuente que la fila HOY de "Gastos por día": `cajaMov` filtrado al día. No es preferencia
  // estética, es la corrección del bug: `hoyItems` tenía dos rejillas que dejaban caer movimientos
  // en el medio. Un gasto de hoy que matcheó un esperado quedaba fuera de `realesHoy` (por
  // `matchedIds`) y TAMBIÉN fuera de `hoyEsperados` cuando el ítem tenía `diaVencimiento: null` —
  // que es el caso de los 7 resúmenes de tarjeta del 7/8/2026. Resultado medido: "Nada que pagar
  // hoy" con cuatro bancos y $ 11.085.000 en la fila de al lado. Compartiendo fuente con `porDia`
  // eso no puede volver a pasar por construcción.
  // F9.132.2 cambio 2 — filtro `pagado === true`. Sin él, en cuanto la Card 1 dejó de mirar
  // `diaVencimiento` los dos impagos del día (AYSA y Empresa Distribuidora) aparecían en las
  // DOS cards y sumaban en los dos totales. Las cards son excluyentes por construcción: misma
  // fuente, mismo filtro de día, y `pagado` como único discriminante.
  const gastadoHoy = cajaMov
    .filter(m => m.tipo === 'Gasto' && inicioDia(m.fecha).getTime() === inicioHoy.getTime() && m.pagado === true)
    .sort((a, b) => arsEq(b, tcDeMov) - arsEq(a, tcDeMov));
  const gastadoHoyTotal = totalReal(gastadoHoy);
  const gastadoPorBanco = [...agruparReal(gastadoHoy, m => medioCanonico(m.banco ?? 'Sin medio', config?.bancos)).entries()]
    .sort((a, b) => b[1].ars - a[1].ars);

  // ── F9.132.2 — CARD 1: lo que TODAVÍA hay que pagar hoy ─────────────────────
  // F9.132.2 cambio 1 — se corta la dependencia de `hoyItems`, que arrastraba el filtro por
  // `diaVencimiento`: ese campo está poblado en 1 de 22 ítems activos, así que la card estaba
  // vacía todos los días salvo el 20. Ahora comparte fuente con `porDia` y con la Card 2
  // —`cajaMov` filtrado al día— y el único filtro que la separa de la Card 2 es `pagado`.
  //   Criterio de "a pagar": `pagado === false`. Los `pagado: true` sin confirmar NO entran:
  // esa plata ya salió y lo que falta es confirmarla, que es otro problema; meterlos acá haría
  // que el total volviera a significar dos cosas.
  //   La partición se hace por `m.fecha` (no por fecha efectiva) para que Card 1 + Card 2 dé
  // exacto el total de la fila HOY: cualquier otro criterio abre un hueco entre las dos.
  const delDia = cajaMov.filter(m => m.tipo === 'Gasto' && inicioDia(m.fecha).getTime() === inicioHoy.getTime());
  const aPagarHoy = delDia
    .filter(m => m.pagado !== true)
    .sort((a, b) => arsEq(b, tcDeMov) - arsEq(a, tcDeMov));
  const aPagarTotal: MontoReal = totalReal(aPagarHoy);
  // F9.132.2 cambio 3 — se revierte `banks={[]}`: ahora hay movimiento detrás de cada fila, y el
  // banco del movimiento es de dónde sale la plata. (`item.banco` queda como fallback para el
  // pendiente sin match, que no vive en esta card.)
  const aPagarPorBanco = [...agruparReal(aPagarHoy, m => medioCanonico(m.banco ?? 'Sin medio', config?.bancos)).entries()]
    .sort((a, b) => b[1].ars - a[1].ars);

  // Vencidos: impagos de días ANTERIORES. Sección propia y subtotal propio — no se suman al
  // total del encabezado, que es el de hoy. Son dos plata distintas, dos números.
  // Acá sí manda la fecha efectiva: un gasto cargado el 4 que vence el 10 no está vencido.
  // Solo en el mes actual: bajo el rótulo HOY, "vencido" tiene que medirse contra hoy. Mirando
  // julio en septiembre, todo julio está vencido y la sección no diría nada.
  const aPagarVencidos = !esMesActual ? [] : cajaMov
    .filter(m => m.tipo === 'Gasto' && m.pagado !== true && fechaEfectivaMov(m).getTime() < inicioHoy.getTime())
    .sort((a, b) => fechaEfectivaMov(a).getTime() - fechaEfectivaMov(b).getTime());
  const aPagarVencidosTotal: MontoReal = totalReal(aPagarVencidos);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* F9.120 — la base del porcentaje se declara acá: un 43% sin base no significa nada. */}
      {privado && <BasePrivacidad texto="% de los ingresos del mes" />}

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
                `Revisar pendientes del mes · ${porRevisar} sin pagar · ${(privado ? fmtPct(pendienteAgenda(agenda), c.ingArsEq) : fmtArs(pendienteAgenda(agenda)))}`
              ) : todoConfirmado ? (
                `Todo confirmado · ${cubiertos}/${total}`
              ) : (
                <>
                  Nada vencido · {cubiertos}/{total} confirmados
                  {pendienteAgenda(agenda) > 0 && (
                    <span style={{ color: 'var(--color-text-sec)', fontWeight: 500 }}> · {(privado ? fmtPct(pendienteAgenda(agenda), c.ingArsEq) : fmtArs(pendienteAgenda(agenda)))} a confirmar</span>
                  )}
                </>
              )}
            </span>
          </Card>
        );
      })()}

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

      {/* F9.132.1 cambio A — la card vuelve ARRIBA, a la posicion previa a F9.132. Se probo
          abajo y no sirve: lo del dia es lo primero que se busca al abrir la app. No volver a
          moverla sin pedido explicito. `hoyExpandido` conserva su default. */}
      {/* F9.99.8.1 — Card Hoy usa la MISMA fila que "Gastos por día" (DiaRowShell): chips de
          banco, total grande/chico, expandible.
          F9.132.1 — CARD 1: solo lo que TODAVÍA hay que pagar. El total ya no alterna de
          significado (era `hoyPendienteEq` o `hoyTotalEq` según el estado, sin decir cuál): acá
          siempre es "a pagar", y lo gastado tiene su propia card abajo con su propio total.
          F9.132.2 — las filas ahora son MOVIMIENTOS impagos, no entradas de agenda: el estado
          (check/reloj/alerta) sobraba porque todas las filas comparten el mismo, `pagado: false`.
          Y `banks` vuelve a estar poblado: hay movimiento detrás de cada fila, así que hay banco.
          F9.132.1 cambio C — `fmtChip` usa montos REALES (pesos y dólares por moneda de origen),
          revirtiendo el USD equivalente del cambio 2 de F9.132. */}
      <DiaRowShell
        dayBig={String(hoy.getDate())}
        daySub="HOY"
        banks={aPagarPorBanco}
        totalNode={
          <>
            <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: aPagarHoy.length > 0 ? 'var(--gf-expense)' : 'var(--color-text)' }}>
              {fmtReal(aPagarTotal)}
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gf-gray-400)' }}>a pagar</div>
            {/* El subtotal de vencidos va AL LADO del de hoy y etiquetado, nunca sumado: son
                dos plata distintas y el encabezado es el de hoy. */}
            {aPagarVencidos.length > 0 && (
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-expense)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                +{fmtReal(aPagarVencidosTotal)} vencido
              </div>
            )}
          </>
        }
        highlight
        expanded={hoyExpandido}
        onToggle={() => setHoyExpandido(v => !v)}
        config={config}
        fmtChip={fmtChipReal}
      >
        {hoyExpandido && (
          <div style={{ marginTop: 10, borderTop: '1px solid var(--gf-gray-100)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 0 }}>
            {aPagarHoy.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--color-text-sec)' }}>
                {esMesActual ? 'Nada que pagar hoy.' : 'Ver mes actual para pagos de hoy.'}
              </div>
            ) : aPagarHoy.map((m, i) => (
              <FilaAPagar
                key={m.id}
                m={m}
                config={config}
                conBorde={i < aPagarHoy.length - 1}
                esAdmin={esAdmin}
                onEditar={onEditarMovimiento}
                monto={privado ? fmtPct(arsEq(m, tcDeMov), c.ingArsEq) : fmtMoney(m.monto, { from: m.moneda, to: m.moneda })}
                pie="A pagar"
              />
            ))}

            {/* Sección propia para los vencidos: su propio encabezado y su propio subtotal.
                Mezclarlos con los de hoy haría que el total del encabezado significara dos
                cosas otra vez, que es exactamente el bug que F9.132.1 vino a cerrar. */}
            {aPagarVencidos.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--gf-gray-150)' }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--gf-expense)' }}>
                    Vencido · {aPagarVencidos.length}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--gf-expense)' }}>
                    {fmtReal(aPagarVencidosTotal)}
                  </span>
                </div>
                {aPagarVencidos.map((m, i) => (
                  <FilaAPagar
                    key={m.id}
                    m={m}
                    config={config}
                    conBorde={i < aPagarVencidos.length - 1}
                    esAdmin={esAdmin}
                    onEditar={onEditarMovimiento}
                    monto={privado ? fmtPct(arsEq(m, tcDeMov), c.ingArsEq) : fmtMoney(m.monto, { from: m.moneda, to: m.moneda })}
                    pie={`Venció ${fmtDiaCorto(fechaEfectivaMov(m))}`}
                    vencido
                  />
                ))}
              </>
            )}
          </div>
        )}
      </DiaRowShell>

      {/* F9.132.1 — CARD 2, propia y debajo de la Card 1. Son dos plata distintas y dos totales
          distintos: una tiene que salir, la otra ya salió, y no se suman. El título de cada card lo
          dice sin tener que abrirlas.
          Fila propia y no la compartida de F9.99.8.1: ésa se organiza por ítem/banco/estado, y
          forzarla a un uso por persona la deformaría — se rompen las dos. */}
      <DiaRowShell
        dayBig={String(hoy.getDate())}
        daySub="GASTADO"
        banks={gastadoPorBanco}
        totalNode={
          <>
            <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtReal(gastadoHoyTotal)}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gf-gray-400)' }}>gastado hoy</div>
          </>
        }
        expanded={gastadoExpandido}
        onToggle={() => setGastadoExpandido(v => !v)}
        config={config}
        fmtChip={fmtChipReal}
      >
        {gastadoExpandido && (gastadoHoy.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-sec)', marginTop: 10 }}>
            {esMesActual ? 'Todavía no salió plata hoy.' : 'Ver mes actual para los gastos de hoy.'}
          </div>
        ) : (
          <div style={{ marginTop: 10, borderTop: '1px solid var(--gf-gray-100)', paddingTop: 6 }}>
            {gastadoHoy.map(m => (
              <button
                key={m.id}
                onClick={esAdmin ? () => onEditarMovimiento?.(m) : undefined}
                disabled={!esAdmin}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0', width: '100%',
                  background: 'none', border: 'none', borderBottom: '1px solid var(--gf-gray-100)',
                  cursor: esAdmin ? 'pointer' : 'default', textAlign: 'left', fontFamily: 'var(--font-base)', fontSize: 12.5,
                }}
              >
                <span style={{ fontWeight: 600, flexShrink: 0, color: m.excluirDash ? 'var(--gf-gray-400)' : undefined }}>
                  {/* F9.133 §1 — "Agregado" para los estructurales, "Sin asignar" solo para el hueco
                      real. Un gasto sin dueño es información y la fila se muestra igual; lo que no
                      puede pasar es que un agregado del importador se lea como carga faltante. */}
                  {etiquetaPersona(m, config)}
                </span>
                <span style={{ flex: 1, minWidth: 0, color: 'var(--color-text-sec)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.descripcion || '(sin descripción)'}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, flexShrink: 0 }}>
                  {fmtReal(sumarReal(REAL0, m.moneda, m.monto))}
                </span>
              </button>
            ))}
          </div>
        ))}
      </DiaRowShell>

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
  const [val, setVal] = useState<number | null>(null);

  function startEdit() {
    setVal(item.montoEsperado ?? null);
    setEditing(true);
  }

  async function commit(n: number | null) {
    setEditing(false);
    // F9.107 — sin parseo acá: `val` ya es número. Si no parseó (null) no se guarda nada.
    if (n !== null && n > 0 && n !== item.montoEsperado) {
      await actualizarItemEsperado(item.id, { montoEsperado: n });
    }
  }

  if (editing) {
    return (
      <MoneyInput
        autoFocus
        value={val}
        moneda={item.moneda}
        onChange={setVal}
        onBlur={() => commit(val)}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(false); }}
        style={{ width: 90, fontSize: 14, border: '1px solid var(--gf-gray-300)', borderRadius: 6, padding: '2px 6px' }}
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
function ItemChecklistCard({ ci, mes, config, esMesActual, onConfirmar, onDesmarcar, onRegistrarPago, basePriv }: {
  ci: CheckItem;
  mes: string;
  config: FamiliaConfig | null;
  esMesActual: boolean;
  basePriv: number;
  onConfirmar: (item: ExpectedItem, matches: Movement[]) => void;
  onDesmarcar: (matches: Movement[]) => void;
  onRegistrarPago: (item: ExpectedItem, monto: number, fecha: Date) => Promise<void>;
}) {
  const { item, matches, estado } = ci;
  const { privado } = usePrivacidad();
  // F9.111 — total de ítems que disputaron algún movimiento de este ítem (unión de `otros`
  // a través de todas las disputas, no solo la primera).
  const disputaCount = new Set(ci.disputas?.flatMap(d => d.otros) ?? []).size;
  const [registrando, setRegistrando] = useState(false);
  const [montoVal, setMontoVal] = useState<number | null>(null);
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
    setMontoVal(item.montoEsperado ?? null);
    setFechaVal(hoyISOLocal());
    setRegistrando(true);
  }

  async function confirmarRegistro() {
    const n = montoVal;
    if (n === null || n <= 0) return;
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
            {/* F9.120 — con privacidad no se muestra el monto ni el campo editable: un input
                con el número real adentro haría inútil el modo. */}
            {privado
              ? <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtPct(monto, basePriv)}</span>
              : !tieneMatch && !item.tarjetaCodigo
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
              <MoneyInput
                autoFocus value={montoVal} onChange={setMontoVal} moneda={item.moneda}
                placeholder="Monto" style={{ flex: 1, fontSize: 13, border: '1px solid var(--gf-gray-300)', borderRadius: 8, padding: '6px 8px' }}
              />
              <input
                type="date" value={fechaVal} onChange={e => setFechaVal(e.target.value)}
                style={{ fontSize: 13, border: '1px solid var(--gf-gray-300)', borderRadius: 8, padding: '6px 8px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button variant="green" size="sm" style={{ flex: 1 }} disabled={guardando || montoVal === null || montoVal <= 0} onClick={confirmarRegistro}>
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
function SueltoAgendaCard({ mov, config, onMarcarPagado, onDeshacer, basePriv }: {
  mov: Movement;
  config: FamiliaConfig | null;
  basePriv: number;
  onMarcarPagado: (mov: Movement) => Promise<void>;
  onDeshacer: (mov: Movement) => Promise<void>;
}) {
  const pagado = mov.confirmadoPago === true;
  const { privado } = usePrivacidad();
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
          {privado
            ? <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtPct(mov.monto, basePriv)}</span>
            : <Money value={mov.monto} currency={mov.moneda} colored={false} decimals={0} style={{ fontSize: 15, flexShrink: 0 }} />}
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

function GastosFijosSeccion({ agenda, config, onConfirmar, onDesmarcar, onRegistrarPago, onMarcarPagadoSuelto, onDeshacerSuelto, esMesActual, mes, basePriv }: {
  agenda: AgendaEntry[];
  config: FamiliaConfig | null;
  basePriv: number;
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
  // F9.120 — misma base que la solapa "Por día": % del ingreso del mes.
  const { privado } = usePrivacidad();
  const fmtMonto = (n: number) => privado ? fmtPct(n, basePriv) : fmtArs(n);

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
  const cardProps = { mes, config, esMesActual, onConfirmar, onDesmarcar, onRegistrarPago, basePriv };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {privado && <BasePrivacidad texto="% de los ingresos del mes" />}
      <div style={{ display: 'flex', gap: 10 }}>
        <Card eyebrow="Pendiente" style={{ flex: 1 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-expense)', fontVariantNumeric: 'tabular-nums' }}>{fmtMonto(pendiente)}</span>
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
              : <SueltoAgendaCard key={e.mov.id} mov={e.mov} config={config} basePriv={basePriv} onMarcarPagado={onMarcarPagadoSuelto} onDeshacer={onDeshacerSuelto} />
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
      .catch(err => { console.warn('[Resumen] tcHoy falló:', err); setTcHoy({ estado: 'error', err }); });
  }, [mes]);

  const { tc: tcEfectivo, aviso: avisoTc } = tcEfectivoDe(tcHoy);
  const { privado: privadoShell, alternar: alternarPrivado } = usePrivacidad();

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

  // F9.120 — base declarada de Resumen: el ingreso del mes en ARS-eq, calculado con el MISMO
  // criterio de valuación que los KPIs (mismo tcDeMov) para que las dos solapas hablen del
  // mismo total y no aparezcan dos denominadores distintos en la misma pantalla.
  const baseIngresoMes = (() => {
    const tcDeMov = crearTcDeMovimiento(mapaTc, tcEfectivo, mes === mesActual());
    return movimientos
      .filter(m => m.incluirResumenMes && m.tipo === 'Ingreso')
      .reduce((s, m) => s + arsEq(m, tcDeMov), 0);
  })();

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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {/* F9.120 — toggle de privacidad al lado del de moneda. No persiste: arranca apagado
              siempre, para que no quede prendido sin que te des cuenta. */}
          <button
            onClick={alternarPrivado}
            aria-label={privadoShell ? 'Mostrar montos' : 'Ocultar montos'}
            title={privadoShell ? 'Mostrar montos' : 'Ocultar montos'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 999,
              border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 12, fontWeight: 700,
              background: privadoShell ? 'var(--gf-ink)' : 'var(--gf-gray-200)',
              color: privadoShell ? '#fff' : 'var(--color-text-sec)', transition: '.15s',
            }}
          >
            <Icon name={privadoShell ? 'eye-off' : 'eye'} size={13} color={privadoShell ? '#fff' : 'var(--color-text-sec)'} />
            %
          </button>
          <div style={{ display: 'flex', gap: 3, background: 'var(--gf-gray-200)', borderRadius: 999, padding: 3 }}>
            {/* F9.120/F9.119 — con los montos tapados el toggle de moneda no cambia nada;
                dejarlo habilitado sugiere lo contrario. */}
            {(['ARS', 'USD'] as const).map(id => {
              const on = cur === id;
              return (
                <button key={id} onClick={() => setCur(id)} disabled={privadoShell} title={privadoShell ? 'Sin efecto con los montos ocultos' : undefined} style={{
                  padding: '5px 12px', borderRadius: 999, border: 'none', cursor: privadoShell ? 'default' : 'pointer', fontFamily: 'var(--font-base)',
                  fontSize: 12, fontWeight: 700, background: on && !privadoShell ? 'var(--color-surface)' : 'transparent',
                  color: on ? 'var(--color-text)' : 'var(--color-text-sec)', boxShadow: on && !privadoShell ? 'var(--shadow-sm)' : 'none', transition: '.15s',
                  opacity: privadoShell ? .45 : 1,
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
          basePriv={baseIngresoMes}
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
