import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { Icon } from '../design-system/Icon';
import { Card, Money, StatusBadge, Badge, Button, Message, type EstadoChecklist } from '../design-system/components';
import './Resumen.css';

// F9.3 — Resumen, PR visual: maqueta con datos de EJEMPLO siguiendo
// ResumenMobile.jsx del kit. Dos secciones: "Por día" (tabla diaria por
// banco, paridad legacy 50_ResumenMes.gs — gap que F9.0b había marcado como
// faltante) y "Gastos Fijos" (re-skin del checklist de esperados). NO toca
// Firestore ni Functions — "Marcar pagado" acá es estado local de ejemplo;
// el cableado a confirmarPagoEsperado/desmarcarPago real es la PR siguiente.

// ── Datos de ejemplo (mismo shape que ui_kits/mobile/data.jsx) ───────────────

interface ExampleMov {
  fecha: Date;
  descripcion: string;
  monto: number;
  tipo: 'Ingreso' | 'Gasto';
  persona: string;
  banco: string;
  moneda: 'ARS' | 'USD';
  tcUsdArs: number | null;
}

const TC = 1180;

function mov(d: number, descripcion: string, monto: number, tipo: 'Ingreso' | 'Gasto', persona: string, banco = 'BBVA', moneda: 'ARS' | 'USD' = 'ARS'): ExampleMov {
  return { fecha: new Date(2026, 5, d), descripcion, monto, tipo, persona, banco, moneda, tcUsdArs: moneda === 'USD' ? TC : null };
}

const EXAMPLE_MOVS: ExampleMov[] = [
  mov(2, 'Sueldo María', 980000, 'Ingreso', 'María', 'BBVA'),
  mov(3, 'Alquiler', 420000, 'Gasto', 'Juan', 'Galicia'),
  mov(4, 'Supermercado Coto', 89450, 'Gasto', 'María', 'BBVA'),
  mov(5, 'Expensas', 134200, 'Gasto', 'Juan', 'Galicia'),
  mov(6, 'Edenor — luz', 38900, 'Gasto', 'Juan', 'Personal Pay'),
  mov(9, 'Honorarios Juan', 1250, 'Ingreso', 'Juan', 'Galicia', 'USD'),
  mov(10, 'Nafta YPF', 52300, 'Gasto', 'Juan', 'MercadoPago'),
  mov(12, 'Farmacia', 24600, 'Gasto', 'María', 'Efectivo'),
  mov(14, 'Colegio Sofía', 186000, 'Gasto', 'María', 'BBVA'),
  mov(18, 'Supermercado Día', 63120, 'Gasto', 'María', 'MercadoPago'),
  mov(22, 'Cena restaurante', 71400, 'Gasto', 'María', 'Efectivo'),
];

const BANCO_COLOR: Record<string, string> = {
  BBVA: '#072146', Galicia: '#ff7300', 'Personal Pay': '#5b2d8e', MercadoPago: '#00a5e6', Efectivo: '#16a34a',
};
const MIEMBRO_COLOR: Record<string, string> = { María: '#065f46', Juan: '#1d4ed8', Sofía: '#b45309' };

interface ExampleEsperado {
  id: string; label: string; persona: string; monto: number; moneda: 'ARS' | 'USD'; estado: EstadoChecklist;
}

const EXAMPLE_ESPERADOS: ExampleEsperado[] = [
  { id: 'alq',  label: 'Alquiler',        persona: 'Juan',  monto: 420000, moneda: 'ARS', estado: 'pagado' },
  { id: 'exp',  label: 'Expensas',        persona: 'Juan',  monto: 134200, moneda: 'ARS', estado: 'pagado' },
  { id: 'col',  label: 'Colegio Sofía',   persona: 'María', monto: 186000, moneda: 'ARS', estado: 'pagado' },
  { id: 'visa', label: 'Tarjeta Visa',    persona: 'Juan',  monto: 312900, moneda: 'ARS', estado: 'parcial' },
  { id: 'luz',  label: 'Edenor — luz',    persona: 'Juan',  monto: 38900,  moneda: 'ARS', estado: 'por_confirmar' },
  { id: 'net',  label: 'Netflix',         persona: 'Sofía', monto: 7990,   moneda: 'ARS', estado: 'automatico' },
  { id: 'gas',  label: 'Metrogas',        persona: 'Juan',  monto: 21500,  moneda: 'ARS', estado: 'pendiente' },
  { id: 'inet', label: 'Internet Fibertel', persona: 'Juan', monto: 29900, moneda: 'ARS', estado: 'vencido' },
  { id: 'pre',  label: 'Prepaga OSDE',    persona: 'María', monto: 168000, moneda: 'ARS', estado: 'no_registrado' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function eqArs(x: ExampleMov): number { return x.moneda === 'ARS' ? x.monto : x.monto * (x.tcUsdArs ?? TC); }
const DIA_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function fmtArs(n: number): string { return '$ ' + Math.round(n).toLocaleString('es-AR'); }

interface Kpis {
  ingArsEq: number; gasArsEq: number; netArsEq: number;
  netUsdEq: number; pesosDisp: number; faltanteUsd: number;
}

function calcularKpis(movs: ExampleMov[]): Kpis {
  let ingArs = 0, ingUsd = 0, gasArs = 0, gasUsd = 0;
  for (const x of movs) {
    if (x.tipo === 'Ingreso') { if (x.moneda === 'USD') ingUsd += x.monto; else ingArs += x.monto; }
    else { if (x.moneda === 'USD') gasUsd += x.monto; else gasArs += x.monto; }
  }
  const ingArsEq = ingArs + ingUsd * TC, gasArsEq = gasArs + gasUsd * TC;
  const ingUsdEq = ingUsd + ingArs / TC, gasUsdEq = gasUsd + gasArs / TC;
  return {
    ingArsEq, gasArsEq, netArsEq: ingArsEq - gasArsEq,
    netUsdEq: ingUsdEq - gasUsdEq,
    pesosDisp: ingArs, faltanteUsd: (ingArs - gasArs) / TC,
  };
}

interface DiaAgregado { day: number; date: Date; eqArs: number; banks: Record<string, number>; }

function porDia(movs: ExampleMov[]): DiaAgregado[] {
  const map = new Map<number, DiaAgregado>();
  for (const x of movs) {
    if (x.tipo !== 'Gasto') continue;
    const d = x.fecha.getDate();
    if (!map.has(d)) map.set(d, { day: d, date: x.fecha, eqArs: 0, banks: {} });
    const e = map.get(d)!;
    const v = eqArs(x);
    e.eqArs += v;
    e.banks[x.banco] = (e.banks[x.banco] ?? 0) + v;
  }
  return [...map.values()].sort((a, b) => a.day - b.day);
}

function porPersonaIngreso(movs: ExampleMov[]): [string, number][] {
  const map: Record<string, number> = {};
  for (const x of movs.filter(m => m.tipo === 'Ingreso')) map[x.persona] = (map[x.persona] ?? 0) + eqArs(x);
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

// ── KPI block (compartido entre secciones) ───────────────────────────────────

function KpiCards({ c }: { c: Kpis }) {
  return (
    <>
      <Card variant="highlight" eyebrow="Neto del mes">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
          <span style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.5px', color: c.netArsEq >= 0 ? 'var(--gf-income)' : 'var(--gf-expense)' }}>
            {c.netArsEq >= 0 ? '+' : '−'}{fmtArs(Math.abs(c.netArsEq))}
          </span>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-sec)', fontVariantNumeric: 'tabular-nums' }}>
            ≈ U$S {Math.round(Math.abs(c.netUsdEq)).toLocaleString('es-AR')} eq
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--color-text-sec)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--gf-emerald-100)' }}>
          <span>Ingresos {fmtArs(c.ingArsEq)}</span>
          <span>Gastos {fmtArs(c.gasArsEq)}</span>
        </div>
      </Card>
      <div style={{ display: 'flex', gap: 10 }}>
        <Card eyebrow="Pesos disponibles" style={{ flex: 1 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtArs(c.pesosDisp)}</span>
        </Card>
        <Card eyebrow="Faltante (USD)" style={{ flex: 1 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: c.faltanteUsd >= 0 ? 'var(--gf-income)' : 'var(--gf-expense)' }}>
            U$S {Math.round(c.faltanteUsd).toLocaleString('es-AR')}
          </span>
        </Card>
      </div>
    </>
  );
}

// ── Sección: Por día ──────────────────────────────────────────────────────────

function PorDiaSeccion() {
  const c = calcularKpis(EXAMPLE_MOVS);
  const dias = porDia(EXAMPLE_MOVS);
  const personas = porPersonaIngreso(EXAMPLE_MOVS);
  const totalMesEq = dias.reduce((s, d) => s + d.eqArs, 0);
  const hoy = 22; // demo

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <KpiCards c={c} />

      <Message kind="warn" title="Revisar pendientes del mes.">Faltan ítems por cargar. <strong>1</strong></Message>

      <Card variant="flat" padding="var(--space-3)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
          <Icon name="calendar" size={13} color="var(--gf-gray-400)" /> Hoy — martes 22
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-text-sec)', marginTop: 3 }}>Sin movimientos para hoy.</div>
      </Card>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 4px 8px' }}>
          <Icon name="users-round" size={13} color="var(--gf-gray-400)" /> Distribución de ingresos
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {personas.map(([p, v], i) => {
            const col = MIEMBRO_COLOR[p] ?? 'var(--gf-gray-400)';
            return (
              <div key={p} style={{ flex: 1, background: i % 2 ? 'var(--gf-emerald-50)' : '#eef4ff', border: `1px solid ${col}22`, borderRadius: 'var(--radius-card)', padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: col }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-strong)' }}>{p}</span>
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtArs(v)}</div>
                <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>U$S {Math.round(v / TC).toLocaleString('es-AR')} eq</div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '0 4px 8px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
            <Icon name="calendar-days" size={13} color="var(--gf-gray-400)" /> Gastos por día
          </span>
          <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Total mes <strong style={{ color: 'var(--color-text)' }}>{fmtArs(totalMesEq)}</strong></span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {dias.map(d => {
            const isHoy = d.day === hoy;
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
                        <span style={{ width: 7, height: 7, borderRadius: 999, background: BANCO_COLOR[b] ?? 'var(--gf-gray-400)' }} />
                        {b} · {fmtArs(v)}
                      </span>
                    ))}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtArs(d.eqArs)}</div>
                    <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>U$S {Math.round(d.eqArs / TC).toLocaleString('es-AR')} eq</div>
                  </div>
                </div>
                {isHoy && <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gf-emerald)', textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 6 }}>Hoy</div>}
              </Card>
            );
          })}
        </div>
      </div>
      <div style={{ height: 4 }} />
    </div>
  );
}

// ── Sección: Gastos Fijos (checklist de esperados) ───────────────────────────

const TINT: Record<EstadoChecklist, [string, string]> = {
  pagado:        ['var(--st-pagado-bg)',        'var(--st-pagado-line)'],
  por_confirmar: ['var(--st-por-confirmar-bg)', 'var(--st-por-confirmar-line)'],
  parcial:       ['var(--st-parcial-bg)',       'var(--st-parcial-line)'],
  automatico:    ['var(--st-automatico-bg)',    'var(--st-automatico-line)'],
  pendiente:     ['var(--st-pendiente-bg)',     'var(--st-pendiente-line)'],
  vencido:       ['var(--st-vencido-bg)',       'var(--st-vencido-line)'],
  programado:    ['var(--st-programado-bg)',    'var(--st-programado-line)'],
  no_registrado: ['var(--st-no-registrado-bg)', 'var(--st-no-registrado-line)'],
  no_aplica:     ['var(--gf-gray-100)',         'var(--gf-gray-300)'],
};

const ACCIONABLE: EstadoChecklist[] = ['pendiente', 'vencido', 'no_registrado', 'por_confirmar'];

function GastosFijosSeccion() {
  const [items, setItems] = useState(EXAMPLE_ESPERADOS);
  const marcarPagado = (id: string) => setItems(prev => prev.map(i => i.id === id ? { ...i, estado: 'pagado' as const } : i));
  const alDia = items.filter(i => i.estado === 'pagado' || i.estado === 'automatico').length;
  const pendiente = items.filter(i => i.estado !== 'pagado' && i.estado !== 'automatico').reduce((s, i) => s + i.monto, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <Card eyebrow="Pendiente" style={{ flex: 1 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-expense)', fontVariantNumeric: 'tabular-nums' }}>{fmtArs(pendiente)}</span>
        </Card>
        <Card eyebrow="Al día" style={{ flex: '0 0 96px', textAlign: 'center' }}>
          <span style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{alDia}<span style={{ fontSize: 14, color: 'var(--gf-gray-400)' }}>/{items.length}</span></span>
        </Card>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(i => {
          const [bg, line] = TINT[i.estado];
          const accionable = ACCIONABLE.includes(i.estado);
          return (
            <div key={i.id} style={{ background: bg, borderLeft: `3px solid ${line}`, borderRadius: 12, padding: '11px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{i.label}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Badge tone="neutral">{i.persona}</Badge>
                    <StatusBadge state={i.estado} />
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <Money value={i.monto} currency={i.moneda} colored={false} style={{ fontSize: 15 }} />
                  {i.estado === 'parcial' && <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>Falta una cuota</div>}
                </div>
              </div>
              {accionable && (
                <div style={{ marginTop: 9 }}>
                  <Button variant="green" size="sm" style={{ width: '100%' }} onClick={() => marcarPagado(i.id)}>
                    <Icon name="check" size={15} /> Marcar pagado
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ height: 4 }} />
    </div>
  );
}

// ── Shell con toggle segmentado ───────────────────────────────────────────────

function ResumenVisual() {
  const [sec, setSec] = useState<'dia' | 'fijos'>('dia');
  const tabs: { id: 'dia' | 'fijos'; label: string }[] = [{ id: 'dia', label: 'Por día' }, { id: 'fijos', label: 'Gastos Fijos' }];

  return (
    <div className="res">
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
      {sec === 'dia' ? <PorDiaSeccion /> : <GastosFijosSeccion />}
    </div>
  );
}

// ── Vista principal — guard de rol separado de hooks (P2 fix histórico) ──────

export default function Resumen() {
  const { miembro } = useMiembroCtx();
  if (miembro.rol !== 'admin') return <Navigate to="/" replace />;
  return <ResumenVisual />;
}
