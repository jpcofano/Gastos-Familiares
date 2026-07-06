import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { useItemsEsperados } from '../contexto/ItemsEsperadosContext';
import { useMovimientosDelMes } from '../hooks/useMovimientosDelMes';
import { useFamiliaConfig } from '../hooks/useFamiliaConfig';
import { confirmarPagoEsperado, desmarcarPago } from '../datos/movimientos';
import { actualizarItemEsperado } from '../datos/itemsEsperados';
import { Icon } from '../design-system/Icon';
import { Card, Money, StatusBadge, Badge, Button, BankLogo, MerchantLogo, type EstadoChecklist } from '../design-system/components';
import { fmtMoney } from '../datos/money';
import { medioCanonico, colorMedio, MEDIOS_FALLBACK } from '../datos/medios';
import { colorHash } from '../datos/agregados';
import { calcularChecklist, cubierto, ACCIONABLE, type CheckItem } from '../datos/checklist';
import EditarMovimiento from './EditarMovimiento';
import type { Movement, ExpectedItem, FamiliaConfig, MedioPago } from '../types';
import './Resumen.css';

type Moneda = 'ARS' | 'USD';

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

function arsEq(m: Movement): number { return m.moneda === 'ARS' ? m.monto : (m.tcUsdArs ? m.monto * m.tcUsdArs : 0); }

function nombrePersona(memberId: string | null, config: FamiliaConfig | null): string {
  if (!memberId) return '—';
  return config?.miembros[memberId]?.nombre ?? memberId;
}

// ── KPIs de caja (incluirResumenMes=true) ────────────────────────────────────

interface Kpis {
  ingArsEq: number; gasArsEq: number; netArsEq: number;
  ingUsdEq: number; gasUsdEq: number; netUsdEq: number;
  pesosDisp: number; faltanteUsd: number; tc: number;
}

function calcularKpis(movs: Movement[]): Kpis {
  let ingArs = 0, ingUsd = 0, gasArs = 0, gasUsd = 0;
  for (const m of movs) {
    if (m.tipo === 'Ingreso') { if (m.moneda === 'USD') ingUsd += m.monto; else ingArs += m.monto; }
    else { if (m.moneda === 'USD') gasUsd += m.monto; else gasArs += m.monto; }
  }
  // tc representativo para los "eq": el más reciente entre los movimientos en USD del mes
  const conTc = movs.filter(m => m.moneda === 'USD' && m.tcUsdArs).sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
  const tc = conTc[0]?.tcUsdArs ?? 1;
  const ingArsEq = ingArs + ingUsd * tc, gasArsEq = gasArs + gasUsd * tc;
  const ingUsdEq = ingUsd + (tc ? ingArs / tc : 0), gasUsdEq = gasUsd + (tc ? gasArs / tc : 0);
  return {
    ingArsEq, gasArsEq, netArsEq: ingArsEq - gasArsEq,
    ingUsdEq, gasUsdEq, netUsdEq: ingUsdEq - gasUsdEq,
    pesosDisp: ingArs, faltanteUsd: tc ? (ingArs - gasArs) / tc : 0, tc,
  };
}

interface DiaAgregado { day: number; date: Date; eqArs: number; banks: Record<string, number>; }

function porDia(movs: Movement[], medios?: FamiliaConfig['bancos']): DiaAgregado[] {
  const map = new Map<number, DiaAgregado>();
  for (const m of movs) {
    if (m.tipo !== 'Gasto') continue;
    const d = m.fecha.getDate();
    if (!map.has(d)) map.set(d, { day: d, date: m.fecha, eqArs: 0, banks: {} });
    const e = map.get(d)!;
    const v = arsEq(m);
    const banco = medioCanonico(m.banco ?? 'Sin medio', medios);
    e.eqArs += v;
    e.banks[banco] = (e.banks[banco] ?? 0) + v;
  }
  return [...map.values()].sort((a, b) => a.day - b.day);
}

function porPersonaIngreso(movs: Movement[]): [string, number][] {
  const map: Record<string, number> = {};
  for (const m of movs.filter(x => x.tipo === 'Ingreso')) {
    const p = m.persona ?? '—';
    map[p] = (map[p] ?? 0) + arsEq(m);
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

// ── KPI block (compartido entre secciones) ───────────────────────────────────

// F9.55 — "Pesos disponibles" = ingresos ARS del mes (fijo en ARS, sin toggle).
// "Falta cubrir (USD)" = (Σ esperadosArsEq − pesosDisp) / tc:
//   > 0 → rojo (falta plata); ≤ 0 → verde "Cubierto".
// Estas dos tarjetas NO dependen del toggle ARS/USD — siempre muestran su moneda fija.
// F9.71 — card oscura centrada: Neto grande + eq, Ingresos/Gastos columnas con eq.
function KpiCards({ c, cur, faltaCubrirUsd, nSinMonto }: { c: Kpis; cur: Moneda; faltaCubrirUsd: number; nSinMonto: number }) {
  const netBig = cur === 'ARS' ? c.netArsEq : c.netUsdEq;
  const netSmall = cur === 'ARS' ? c.netUsdEq : c.netArsEq;
  const fmt = cur === 'ARS' ? fmtArs : fmtUsdEq;
  const fmtOtra = cur === 'ARS' ? fmtUsdEq : fmtArs;
  const ingBig = cur === 'ARS' ? c.ingArsEq : c.ingUsdEq;
  const ingSmall = cur === 'ARS' ? c.ingUsdEq : c.ingArsEq;
  const gasBig = cur === 'ARS' ? c.gasArsEq : c.gasUsdEq;
  const gasSmall = cur === 'ARS' ? c.gasUsdEq : c.gasArsEq;
  const esCubierto = faltaCubrirUsd <= 0;
  const cubiertoParcial = esCubierto && nSinMonto > 0;
  return (
    <>
      <div style={{ background: 'linear-gradient(135deg, var(--gf-ink) 0%, var(--gf-ink-soft) 100%)', borderRadius: 'var(--radius-card)', padding: 'var(--space-4)', color: '#fff', boxShadow: 'var(--shadow-soft)', textAlign: 'center' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'rgba(255,255,255,.55)' }}>Neto del mes</div>
        <div style={{ fontSize: 34, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.5px', lineHeight: 1.05, marginTop: 6 }}>
          {netBig >= 0 ? '+' : '−'}{fmt(Math.abs(netBig))}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,.6)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{netBig >= 0 ? '+' : '−'}{fmtOtra(Math.abs(netSmall))}</div>
        <div style={{ display: 'flex', marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.15)' }}>
          {([{ label: 'Ingresos', v: ingBig, eq: ingSmall, col: 'var(--gf-emerald-100)' }, { label: 'Gastos', v: gasBig, eq: gasSmall, col: '#fca5a5' }] as const).map((x, i) => (
            <div key={x.label} style={{ flex: 1, borderLeft: i > 0 ? '1px solid rgba(255,255,255,.12)' : 'none' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'rgba(255,255,255,.5)' }}>{x.label}</div>
              <div style={{ fontSize: 19, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: x.col, marginTop: 3 }}>{fmt(x.v)}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,.55)', fontVariantNumeric: 'tabular-nums', marginTop: 1 }}>{fmtOtra(x.eq)}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Card eyebrow="Pesos disponibles" style={{ flex: 1 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtArs(c.pesosDisp)}</span>
        </Card>
        <Card eyebrow="Falta cubrir (USD)" style={{ flex: 1 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: esCubierto ? (cubiertoParcial ? '#b45309' : 'var(--gf-income)') : 'var(--gf-expense)' }}>
            {esCubierto ? (cubiertoParcial ? 'Cubierto*' : 'Cubierto') : fmtUsdEq(faltaCubrirUsd)}
          </span>
        </Card>
      </div>
    </>
  );
}

// ── Sección: Por día ──────────────────────────────────────────────────────────

function PorDiaSeccion({ movs, porRevisar, config, cur, esAdmin, onEditarMovimiento, checklist, mes, onIrAGastos }: {
  movs: Movement[];
  porRevisar: number;
  onIrAGastos: () => void;
  config: FamiliaConfig | null;
  cur: Moneda;
  esAdmin: boolean;
  onEditarMovimiento?: (mov: Movement) => void;
  checklist: CheckItem[];
  mes: string;
}) {
  const cajaMov = movs.filter(m => m.incluirResumenMes);
  const c = calcularKpis(cajaMov);
  const dias = porDia(cajaMov, config?.bancos);
  const personas = porPersonaIngreso(cajaMov);
  const totalMesEq = dias.reduce((s, d) => s + d.eqArs, 0);
  const hoy = new Date();
  // ARS: como está hoy (ARS principal, USD chico). USD: invertido (USD principal, ARS chico).
  const fmtBig = (ars: number) => cur === 'ARS' ? fmtArs(ars) : fmtMoney(ars, { from: 'ARS', to: 'USD' });
  const fmtSmall = (ars: number) => cur === 'ARS' ? fmtMoney(ars, { from: 'ARS', to: 'USD' }) : fmtArs(ars);
  const [diasExpandidos, setDiasExpandidos] = useState<Set<number>>(new Set());

  // Card HOY: esperados que vencen hoy (solo para el mes actual)
  const mesActualHoy = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const esMesActual = mes === mesActualHoy;
  const hoyItems = esMesActual
    ? checklist.filter(ci => ci.item.diaVencimiento === hoy.getDate())
    : [];

  // F9.55 — "Falta cubrir (USD)": Σ esperados ARS-eq del mes ÷ tc − pesosDisp.
  // F9.99.5 — excluye ítems ya cubiertos; nSinMonto = no cubiertos sin monto (ámbar).
  const noCubiertos = checklist.filter(ci => !cubierto(ci.estado));
  const nSinMonto = noCubiertos.filter(ci => ci.item.montoEsperado == null).length;
  const esperadosArsEq = noCubiertos.reduce((s, ci) => {
    const m = ci.item.montoEsperado;
    if (m == null) return s;
    return ci.item.moneda === 'ARS' ? s + m : s + m * c.tc;
  }, 0);
  const faltaCubrirUsd = c.tc > 0 ? (esperadosArsEq - c.pesosDisp) / c.tc : 0;

  // Total de hoy pendiente (ARS eq) para el header de Card HOY
  // F9.76 — pendiente/pagado por estado real, no por presencia de match. Un por_confirmar sigue
  // siendo deuda hasta que el pago real lo confirme.
  const hoyPendienteArsEq = hoyItems
    .filter(ci => !cubierto(ci.estado))
    .reduce((s, ci) => {
      const m = ci.item.montoEsperado;
      if (m == null) return s;
      return ci.item.moneda === 'ARS' ? s + m : s + m * c.tc;
    }, 0);
  const todoPagadoHoy = hoyItems.length > 0 && hoyItems.every(ci => cubierto(ci.estado));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <KpiCards c={c} cur={cur} faltaCubrirUsd={faltaCubrirUsd} nSinMonto={nSinMonto} />

      {/* F9.17 — fila limpia con badge de cantidad, reemplaza el banner amarillo */}
      {/* F9.62 — clickeable: lleva a la solapa Gastos Fijos */}
      <Card variant="flat" padding="var(--space-3)" onClick={onIrAGastos} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <Icon name="alert-circle" size={17} color="var(--gf-out)" />
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Revisar pendientes del mes</span>
        <span style={{ minWidth: 22, height: 22, borderRadius: 999, background: 'var(--gf-out)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>{porRevisar}</span>
      </Card>

      <Card variant="flat" padding="var(--space-3)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: hoyItems.length > 0 ? 10 : 4 }}>
          <Icon name="calendar" size={13} color="var(--gf-gray-400)" />
          <span style={{ flex: 1 }}>Hoy — {hoy.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit' })}</span>
          {hoyItems.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: todoPagadoHoy ? 'var(--gf-income)' : 'var(--gf-expense)', textTransform: 'none', letterSpacing: 0 }}>
              {todoPagadoHoy ? 'Todo pagado' : `$ ${hoyPendienteArsEq.toLocaleString('es-AR', { maximumFractionDigits: 0 })} a pagar`}
            </span>
          )}
        </div>
        {hoyItems.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-sec)' }}>
            {esMesActual ? 'Nada que pagar hoy.' : 'Ver mes actual para pagos de hoy.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {hoyItems.map((ci, i) => {
              const pagado       = cubierto(ci.estado); // pagado | automatico
              const porConfirmar = !pagado && (ci.estado === 'por_confirmar' || ci.estado === 'parcial');
              const etiqueta = [ci.item.categoria, ci.item.subcategoria].filter(Boolean).join(' › ') || ci.item.notas || '(sin categoría)';
              const bancoPago = ci.matches[0]?.banco;
              const bancoInfo = bancoPago ? bancoDeNombre(bancoPago, config?.bancos) : undefined;
              return (
                <div key={ci.item.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                  borderBottom: i < hoyItems.length - 1 ? '1px solid var(--gf-gray-100)' : 'none',
                }}>
                  {pagado && bancoInfo ? (
                    <BankLogo id={bancoInfo.id} nombre={bancoInfo.nombre} color={bancoInfo.color} dominio={bancoInfo.dominio} size={28} radius={7} />
                  ) : (
                    <span style={{ width: 28, height: 28, borderRadius: 7, background: pagado ? 'var(--gf-emerald)' : 'var(--gf-gray-100)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon
                        name={pagado ? 'check' : porConfirmar ? 'alert-circle' : 'clock'}
                        size={14}
                        color={pagado ? '#fff' : porConfirmar ? 'var(--gf-out)' : 'var(--gf-gray-400)'}
                      />
                    </span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{etiqueta}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-sec)' }}>
                      {pagado
                        ? `Conciliado${bancoPago ? ` · ${medioCanonico(bancoPago, config?.bancos)}` : ''}`
                        : porConfirmar ? 'Cargado · a confirmar' : 'A pagar'}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0, color: pagado ? 'var(--gf-income)' : 'var(--color-text)' }}>
                    {ci.item.montoEsperado != null ? fmtMoney(ci.item.montoEsperado, { from: ci.item.moneda, to: ci.item.moneda }) : '—'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {personas.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 4px 8px' }}>
            <Icon name="users-round" size={13} color="var(--gf-gray-400)" /> Distribución de ingresos
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {personas.map(([p, v]) => {
              const nombre = nombrePersona(p, config);
              const col = colorHash(nombre);
              return (
                <div key={p} style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--gf-gray-150)', borderRadius: 'var(--radius-card)', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: col }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-strong)' }}>{nombre}</span>
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtBig(v)}</div>
                  <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{fmtSmall(v)}</div>
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
              const banks   = Object.entries(d.banks).sort((a, b) => b[1] - a[1]);
              const expanded = diasExpandidos.has(d.day);
              const movsDelDia = cajaMov.filter(m => m.tipo === 'Gasto' && m.fecha.getDate() === d.day && m.fecha.toDateString() === d.date.toDateString());
              return (
                <Card key={d.day} variant={isHoy ? 'highlight' : 'flat'} padding="var(--space-3)">
                  <button
                    onClick={() => setDiasExpandidos(prev => { const s = new Set(prev); s.has(d.day) ? s.delete(d.day) : s.add(d.day); return s; })}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                  >
                    <div style={{ width: 40, flexShrink: 0, textAlign: 'center' }}>
                      <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{d.day}</div>
                      <div style={{ fontSize: 10, color: 'var(--gf-gray-400)', textTransform: 'uppercase' }}>{DIA_ES[d.date.getDay()]}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {banks.map(([b, v]) => {
                        const info = bancoDeNombre(b, config?.bancos);
                        return (
                          <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--color-text-strong)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '3px 8px 3px 4px' }}>
                            <BankLogo
                              id={info?.id ?? b}
                              nombre={info?.nombre ?? b}
                              color={info?.color ?? (colorMedio(b, config?.bancos) ?? colorHash(b))}
                              dominio={info?.dominio}
                              size={17}
                              radius={999}
                            />
                            {b} · {fmtBig(v)}
                          </span>
                        );
                      })}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtBig(d.eqArs)}</div>
                      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{fmtSmall(d.eqArs)}</div>
                    </div>
                    <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} color="var(--gf-gray-300)" />
                  </button>
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
                            {m.moneda === 'USD' && m.tcUsdArs && (
                              <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>
                                {fmtArs(arsEq(m))}
                              </div>
                            )}
                          </div>
                          {esAdmin && <Icon name="pencil" size={12} color="var(--gf-gray-300)" />}
                        </button>
                      ))}
                    </div>
                  )}
                </Card>
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

function GastosFijosSeccion({ checklist, config, onConfirmar, onDesmarcar, esMesActual }: {
  checklist: CheckItem[];
  config: FamiliaConfig | null;
  onConfirmar: (item: ExpectedItem, matches: Movement[]) => void;
  onDesmarcar: (matches: Movement[]) => void;
  esMesActual: boolean;
}) {
  const alDia = checklist.filter(c => cubierto(c.estado)).length;
  // F9.62 — "pendiente" suma TODO lo no pagado: si el ítem tiene un movimiento sin confirmar
  // (por_confirmar/parcial) usa el monto REAL del movimiento; si no, el montoEsperado. Ítems
  // sin monto ni match no aportan (no hay número que sumar).
  const pendiente = checklist
    .filter(c => !cubierto(c.estado))
    .reduce((s, c) => {
      const noConfirmado = c.estado === 'por_confirmar' || c.estado === 'parcial';
      const montoReal = c.matches.reduce((a, m) => a + Math.abs(m.monto), 0);
      return s + (noConfirmado ? montoReal : (c.item.montoEsperado ?? 0));
    }, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <Card eyebrow="Pendiente" style={{ flex: 1 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-expense)', fontVariantNumeric: 'tabular-nums' }}>{fmtArs(pendiente)}</span>
        </Card>
        <Card eyebrow="Al día" style={{ flex: '0 0 96px', textAlign: 'center' }}>
          <span style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{alDia}<span style={{ fontSize: 14, color: 'var(--gf-gray-400)' }}>/{checklist.length}</span></span>
        </Card>
      </div>

      {checklist.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-sec)', margin: '0 4px' }}>Sin ítems esperados activos.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {checklist.map(({ item, matches, estado }) => {
            const accionable = ACCIONABLE.includes(estado);
            const montoReal = matches.reduce((s, m) => s + Math.abs(m.monto), 0);
            const tieneMatch = estado === 'pagado' || estado === 'parcial' || estado === 'por_confirmar';
            const monto = tieneMatch ? montoReal : (item.montoEsperado ?? 0);
            const etiqueta = [item.categoria, item.subcategoria].filter(Boolean).join(' › ') || item.notas || '(sin categoría)';
            return (
              <div key={item.id} style={{ display: 'flex', gap: 10, background: 'var(--color-surface)', border: '1px solid var(--gf-gray-150)', borderRadius: 14, padding: '11px 12px' }}>
                <span style={{ width: 9, height: 9, borderRadius: 999, background: TINT[estado], marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{etiqueta}</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {item.persona && <Badge tone="neutral">{nombrePersona(item.persona, config)}</Badge>}
                        <StatusBadge state={estado} />
                      </div>
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
                  {estado === 'pagado' && esMesActual && matches.length > 0 && (
                    <div style={{ marginTop: 9 }}>
                      <Button variant="secondary" size="sm" style={{ width: '100%' }} onClick={() => onDesmarcar(matches)}>
                        Deshacer
                      </Button>
                    </div>
                  )}
                  {accionable && estado !== 'por_confirmar' && item.diaVencimiento && (
                    <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 6 }}>vence día {item.diaVencimiento}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
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

  const { miembro } = useMiembroCtx();
  const esAdmin = miembro.rol === 'admin';
  const { config } = useFamiliaConfig();
  const { movimientos, cargando, error } = useMovimientosDelMes(mes);
  const { items } = useItemsEsperados();
  const checklist = calcularChecklist(items, movimientos, mes);
  // F9.62 — "revisar" cuenta solo lo SIN CARGAR (sin movimiento asociado). por_confirmar
  // tiene match (cargado, falta confirmar) y NO entra en este conteo.
  const porRevisar = checklist.filter(c => c.matches.length === 0 && ACCIONABLE.includes(c.estado)).length;

  async function handleConfirmar(item: ExpectedItem, matches: Movement[]) {
    const res = await confirmarPagoEsperado(item, matches);
    if (!res.ok) setErrorAccion(res.error.message);
  }
  async function handleDesmarcar(matches: Movement[]) {
    const res = await desmarcarPago(matches);
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
        <PorDiaSeccion movs={movimientos} porRevisar={porRevisar} config={config} cur={cur} esAdmin={esAdmin} onEditarMovimiento={setEditandoMovimiento} checklist={checklist} mes={mes} onIrAGastos={() => setSec('fijos')} />
      ) : (
        <GastosFijosSeccion
          checklist={checklist}
          config={config}
          onConfirmar={handleConfirmar}
          onDesmarcar={handleDesmarcar}
          esMesActual={mes === mesActual()}
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
