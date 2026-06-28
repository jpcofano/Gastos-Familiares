import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { useItemsEsperados } from '../contexto/ItemsEsperadosContext';
import { useMovimientosDelMes } from '../hooks/useMovimientosDelMes';
import { useFamiliaConfig } from '../hooks/useFamiliaConfig';
import { confirmarPagoEsperado, desmarcarPago } from '../datos/movimientos';
import { Icon } from '../design-system/Icon';
import { Card, Money, StatusBadge, Badge, Button, type EstadoChecklist } from '../design-system/components';
import { fmtMoney } from '../datos/money';
import { medioCanonico, colorMedio } from '../datos/medios';
import { colorHash } from '../datos/agregados';
import type { Movement, ExpectedItem, FamiliaConfig } from '../types';
import './Resumen.css';

type Moneda = 'ARS' | 'USD';

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

// ── Checklist de esperados (lógica real, recuperada de git 0bc11e6) ─────────

function movimientosDelItem(item: ExpectedItem, movs: Movement[]): Movement[] {
  // Rama 0: vínculo directo por itemEsperadoId (manda sobre todo)
  const directos = movs.filter(m => m.itemEsperadoId === item.id);
  if (directos.length > 0) return directos;

  // Rama 1: tarjeta por código — identidad fuerte, no categoria/subcategoria
  if (item.tarjetaCodigo) {
    return movs.filter(m => m.subtipo === 'TarjetaPago' && m.tarjetaCodigo === item.tarjetaCodigo && m.moneda === item.moneda);
  }

  // Rama 2: matchTexto manda (relaja cat/subcat) — o, sin matchTexto, clave cat+subcat
  return movs.filter(m => {
    if (m.tipo !== item.tipo) return false;
    if (m.moneda !== item.moneda) return false;
    if (item.matchTexto) {
      const desc = (m.descripcion ?? '').toLowerCase();
      const inc = item.matchTexto.incluye.some(t => desc.includes(t));
      const exc = item.matchTexto.excluye.some(t => desc.includes(t));
      return inc && !exc;
    }
    if (item.categoria !== null && m.categoria !== item.categoria) return false;
    if (item.subcategoria !== null && m.subcategoria !== item.subcategoria) return false;
    if (item.tipo === 'Ingreso' && item.persona !== null && m.persona !== item.persona) return false;
    return true;
  });
}

function aplicaEnMes(_item: ExpectedItem, _mes: string): boolean {
  // TODO: periodicidades no mensuales necesitan mes-ancla (ver docs/CLAUDE.md). Placeholder: aplica siempre.
  return true;
}

function estadoItem(item: ExpectedItem, matches: Movement[], mesActualStr: string, mes: string): EstadoChecklist {
  if (!aplicaEnMes(item, mes)) return 'no_aplica';
  if (matches.length > 0) {
    if (mes < mesActualStr) return 'pagado';
    const confirmados = matches.filter(m => m.confirmadoPago);
    if (confirmados.length > 0) {
      const montoConf = confirmados.reduce((s, m) => s + Math.abs(m.monto), 0);
      if (item.montoEsperado != null && montoConf < item.montoEsperado * 0.99) return 'parcial';
      return 'pagado';
    }
    return 'por_confirmar';
  }
  if (item.pagoAutomatico) return 'automatico';
  if (mes > mesActualStr) return 'programado';
  if (mes < mesActualStr) return 'no_registrado';
  if (item.diaVencimiento && item.diaVencimiento < new Date().getDate()) return 'vencido';
  return 'pendiente';
}

function cubierto(estado: EstadoChecklist): boolean { return estado === 'pagado' || estado === 'automatico'; }

const ORDEN_ESTADO: Record<EstadoChecklist, number> = {
  vencido: 0, pendiente: 1, por_confirmar: 2, parcial: 3,
  no_registrado: 4, programado: 5, automatico: 6,
  pagado: 7, no_aplica: 8,
};

interface CheckItem { item: ExpectedItem; matches: Movement[]; estado: EstadoChecklist; }

function calcularChecklist(items: ExpectedItem[], movs: Movement[], mes: string): CheckItem[] {
  const mesHoy = mesActual();
  return items
    .filter(i => i.activo)
    .map(item => {
      const matches = movimientosDelItem(item, movs);
      return { item, matches, estado: estadoItem(item, matches, mesHoy, mes) };
    })
    .sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]);
}

const ACCIONABLE: EstadoChecklist[] = ['pendiente', 'vencido', 'no_registrado', 'por_confirmar'];

// ── KPI block (compartido entre secciones) ───────────────────────────────────

function KpiCards({ c, cur }: { c: Kpis; cur: Moneda }) {
  const netBig = cur === 'ARS' ? c.netArsEq : c.netUsdEq;
  const netSmall = cur === 'ARS' ? c.netUsdEq : c.netArsEq;
  const fmtBig = cur === 'ARS' ? fmtArs : fmtUsdEq;
  const fmtSmall = cur === 'ARS' ? fmtUsdEq : fmtArs;
  const ingBig = cur === 'ARS' ? c.ingArsEq : c.ingUsdEq;
  const gasBig = cur === 'ARS' ? c.gasArsEq : c.gasUsdEq;
  // Disponible (ARS) y Resultado (USD) son magnitudes distintas, no equivalentes entre sí
  // (no hay conversión válida una a la otra) — "invertir" en USD reordena cuál va primero,
  // no convierte cifras.
  const cardDisponible = (
    <Card eyebrow="Disponible (ARS)" style={{ flex: 1 }}>
      <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtArs(c.pesosDisp)}</span>
    </Card>
  );
  const cardResultado = (
    <Card eyebrow="Resultado (USD)" style={{ flex: 1 }}>
      <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: c.faltanteUsd >= 0 ? 'var(--gf-income)' : 'var(--gf-expense)' }}>
        {fmtUsdEq(c.faltanteUsd)}
      </span>
    </Card>
  );
  return (
    <>
      {/* F9.17 — "Neto del mes" como card ink, rima con el hero de Balance del Dashboard */}
      <div style={{ background: 'linear-gradient(135deg, var(--gf-ink) 0%, var(--gf-ink-soft) 100%)', borderRadius: 'var(--radius-card)', padding: 'var(--space-4)', boxShadow: 'var(--shadow-soft)', color: '#fff' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'rgba(255,255,255,.6)', marginBottom: 8 }}>Neto del mes</div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
          <span style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.5px', color: '#fff' }}>
            {netBig >= 0 ? '+' : '−'}{fmtBig(Math.abs(netBig))}
          </span>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,.7)', fontVariantNumeric: 'tabular-nums' }}>
            {fmtSmall(Math.abs(netSmall))}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'rgba(255,255,255,.7)', marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.15)' }}>
          <span>Ingresos {fmtBig(ingBig)}</span>
          <span>Gastos {fmtBig(gasBig)}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        {cur === 'ARS' ? <>{cardDisponible}{cardResultado}</> : <>{cardResultado}{cardDisponible}</>}
      </div>
    </>
  );
}

// ── Sección: Por día ──────────────────────────────────────────────────────────

function PorDiaSeccion({ movs, porRevisar, config, cur }: { movs: Movement[]; porRevisar: number; config: FamiliaConfig | null; cur: Moneda }) {
  const cajaMov = movs.filter(m => m.incluirResumenMes);
  const c = calcularKpis(cajaMov);
  const dias = porDia(cajaMov, config?.bancos);
  const personas = porPersonaIngreso(cajaMov);
  const totalMesEq = dias.reduce((s, d) => s + d.eqArs, 0);
  const hoy = new Date();
  const movsHoy = cajaMov.filter(m => m.tipo === 'Gasto' && m.fecha.toDateString() === hoy.toDateString());
  const totalHoy = movsHoy.reduce((s, m) => s + arsEq(m), 0);
  // ARS: como está hoy (ARS principal, USD chico). USD: invertido (USD principal, ARS chico).
  const fmtBig = (ars: number) => cur === 'ARS' ? fmtArs(ars) : fmtMoney(ars, { from: 'ARS', to: 'USD' });
  const fmtSmall = (ars: number) => cur === 'ARS' ? fmtMoney(ars, { from: 'ARS', to: 'USD' }) : fmtArs(ars);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <KpiCards c={c} cur={cur} />

      {/* F9.17 — fila limpia con badge de cantidad, reemplaza el banner amarillo */}
      <Card variant="flat" padding="var(--space-3)" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="alert-circle" size={17} color="var(--gf-out)" />
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Revisar pendientes del mes</span>
        <span style={{ minWidth: 22, height: 22, borderRadius: 999, background: 'var(--gf-out)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>{porRevisar}</span>
      </Card>

      <Card variant="flat" padding="var(--space-3)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
          <Icon name="calendar" size={13} color="var(--gf-gray-400)" /> Hoy — {hoy.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit' })}
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-text-sec)', marginTop: 3 }}>
          {movsHoy.length === 0 ? 'Sin movimientos para hoy.' : `${movsHoy.length} ${movsHoy.length === 1 ? 'movimiento' : 'movimientos'} · ${fmtArs(totalHoy)}`}
        </div>
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
              const isHoy = d.date.toDateString() === hoy.toDateString();
              const banks = Object.entries(d.banks).sort((a, b) => b[1] - a[1]);
              return (
                <Card key={d.day} variant={isHoy ? 'highlight' : 'flat'} padding="var(--space-3)">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, flexShrink: 0, textAlign: 'center' }}>
                      <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{d.day}</div>
                      <div style={{ fontSize: 10, color: 'var(--gf-gray-400)', textTransform: 'uppercase' }}>{DIA_ES[d.date.getDay()]}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {banks.map(([b, v]) => (
                        <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--color-text-strong)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '3px 8px' }}>
                          <span style={{ width: 7, height: 7, borderRadius: 999, background: colorMedio(b, config?.bancos) ?? colorHash(b) }} />
                          {b} · {fmtBig(v)}
                        </span>
                      ))}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtBig(d.eqArs)}</div>
                      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{fmtSmall(d.eqArs)}</div>
                    </div>
                  </div>
                  {isHoy && <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gf-emerald)', textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 6 }}>Hoy</div>}
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

function GastosFijosSeccion({ checklist, config, onConfirmar, onDesmarcar, esMesActual }: {
  checklist: CheckItem[];
  config: FamiliaConfig | null;
  onConfirmar: (item: ExpectedItem, matches: Movement[]) => void;
  onDesmarcar: (matches: Movement[]) => void;
  esMesActual: boolean;
}) {
  const alDia = checklist.filter(c => cubierto(c.estado)).length;
  const pendiente = checklist.filter(c => !cubierto(c.estado) && c.item.montoEsperado != null).reduce((s, c) => s + (c.item.montoEsperado ?? 0), 0);

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
                      <Money value={monto} currency={item.moneda} colored={false} decimals={0} style={{ fontSize: 15 }} />
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
  const [sec, setSec] = useState<'dia' | 'fijos'>('dia');
  const [mes, setMes] = useState(mesActual);
  const [cur, setCur] = useState<Moneda>('ARS');
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const tabs: { id: 'dia' | 'fijos'; label: string }[] = [{ id: 'dia', label: 'Por día' }, { id: 'fijos', label: 'Gastos Fijos' }];

  const { config } = useFamiliaConfig();
  const { movimientos, cargando, error } = useMovimientosDelMes(mes);
  const { items } = useItemsEsperados();
  const checklist = calcularChecklist(items, movimientos, mes);
  const porRevisar = checklist.filter(c => ACCIONABLE.includes(c.estado)).length;

  async function handleConfirmar(item: ExpectedItem, matches: Movement[]) {
    const res = await confirmarPagoEsperado(item, matches);
    if (!res.ok) setErrorAccion(res.error.message);
  }
  async function handleDesmarcar(matches: Movement[]) {
    const res = await desmarcarPago(matches);
    if (!res.ok) setErrorAccion(res.error.message);
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
        <PorDiaSeccion movs={movimientos} porRevisar={porRevisar} config={config} cur={cur} />
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
