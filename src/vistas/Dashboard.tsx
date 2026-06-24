import { useState } from 'react';
import { Card } from '../design-system/components';
import { Icon } from '../design-system/Icon';
import './Dashboard.css';

// F9.3 — Dashboard (Inicio), PR visual: maqueta con datos de EJEMPLO siguiendo
// DashboardMobile.jsx del UI kit (paridad legacy 60_Dash.gs: neto/ingresos/gastos
// en eq, gastos por categoría, por descripción, histórico mensual/anual). NO toca
// Firestore ni Functions — el cableado a datos reales es una PR aparte (gaps ya
// identificados en F9.0c: agregación por categoría/descripción e histórico no
// existen todavía como hooks).

type Moneda = 'ARS' | 'USD';

interface CategoriaSlice { nombre: string; color: string; pct: number; count: number; usd: number; }
interface SubcategoriaSlice { nombre: string; color: string; valor: number; pct: number; }
interface DescripcionSlice { desc: string; usd: number; count: number; }

interface DashMensual {
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
  movMasAlto: { usd: number; desc: string };
  picoDia: { fecha: string; dow: string; usd: number; diaNum: number };
  categorias: CategoriaSlice[];
  subcategorias: SubcategoriaSlice[];
  diaria: number[];
  porDescripcion: DescripcionSlice[];
}

interface AnualCategoria { nombre: string; color: string; usd: number; }
interface MesAMes { mes: string; usd: number; delta: number | null; }

interface DashAnual {
  anio: number;
  balanceUsd: number; ingresosUsd: number; salidasUsd: number;
  promedioMensualUsd: number; mesMasAlto: string; mesMasBajo: string; tendenciaPct: number;
  mesesConDatos: number; comparacionInteranualPct: number; mejorMesAhorro: string;
  meses: string[];
  salidasPorMes: number[];
  ingresosPorMes: number[];
  categorias: AnualCategoria[];
  mesAMes: MesAMes[];
}

// ── Datos de ejemplo (mismo shape/valores que ui_kits/mobile/data.jsx) ───────

const EXAMPLE_DASH: DashMensual = {
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
    { nombre: 'Educación y chicos',      color: '#4f8ef7', pct: 65, count: 9, usd: 1693 },
    { nombre: 'Casa',                    color: '#2bb673', pct: 21, count: 7, usd: 537 },
    { nombre: 'Personal',                color: '#f5a623', pct: 5,  count: 6, usd: 132 },
    { nombre: 'Salud',                   color: '#8b5cf6', pct: 3,  count: 2, usd: 87 },
    { nombre: 'Alimentación cotidiana',  color: '#ef5350', pct: 2,  count: 7, usd: 60 },
    { nombre: 'Impuestos y finanzas',    color: '#06b6d4', pct: 2,  count: 3, usd: 51 },
    { nombre: 'Otros',                   color: '#f97316', pct: 2,  count: 2, usd: 48 },
  ],
  subcategorias: [
    { nombre: 'Colegio Federico',       color: '#4f8ef7', valor: 871, pct: 34 },
    { nombre: 'Colegio Sofi',           color: '#2bb673', valor: 564, pct: 22 },
    { nombre: 'Expensas',               color: '#f5a623', valor: 267, pct: 10 },
    { nombre: 'Colegio Fede',           color: '#8b5cf6', valor: 152, pct: 6 },
    { nombre: 'Internet y teléfono',    color: '#ef5350', valor: 99,  pct: 4 },
  ],
  diaria: [40, 0, 55, 0, 70, 30, 0, 0, 45, 1563, 0, 60, 0, 210, 35, 180, 0, 0, 50, 0, 25, 0, 90, 0, 0, 40, 0, 0, 30, 20],
  porDescripcion: [
    { desc: 'Escuela Philips — Federico', usd: 871, count: 3 },
    { desc: 'Colegio Sofi — cuota',       usd: 564, count: 2 },
    { desc: 'Expensas edificio',          usd: 267, count: 1 },
    { desc: 'Internet y teléfono',        usd: 99,  count: 1 },
    { desc: 'Supermercado',               usd: 84,  count: 5 },
  ],
};

const EXAMPLE_ANUAL: DashAnual = {
  anio: 2026,
  balanceUsd: 3875, ingresosUsd: 27426, salidasUsd: 23551,
  promedioMensualUsd: 2044, mesMasAlto: 'Mar', mesMasBajo: 'Jul', tendenciaPct: 18,
  mesesConDatos: 6, comparacionInteranualPct: 117, mejorMesAhorro: 'Ene',
  meses: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
  salidasPorMes:   [1800, 2100, 3200, 2600, 2400, 2560, 1200, 1900, 2000, 2300, 2100, 1391],
  ingresosPorMes:  [3100, 2400, 2800, 2600, 2500, 4086, 1400, 2000, 2100, 2300, 2200, 1936],
  categorias: [
    { nombre: 'Educación y chicos',     color: '#4f8ef7', usd: 6925 },
    { nombre: 'Alimentación cotidiana', color: '#ef5350', usd: 4248 },
    { nombre: 'Casa',                   color: '#2bb673', usd: 4200 },
    { nombre: 'Auto',                   color: '#8b5cf6', usd: 1418 },
    { nombre: 'Salidas',                color: '#f5a623', usd: 1287 },
    { nombre: 'Vacaciones y viajes',    color: '#06b6d4', usd: 1267 },
    { nombre: 'Personal',               color: '#ec4899', usd: 1075 },
    { nombre: 'Otros',                  color: '#f97316', usd: 763 },
    { nombre: 'Salud',                  color: '#14b8a6', usd: 548 },
    { nombre: 'Indumentaria',           color: '#a855f7', usd: 412 },
    { nombre: 'Impuestos y finanzas',   color: '#0284c7', usd: 173 },
    { nombre: 'Transporte general',     color: '#84cc16', usd: 151 },
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

// ── Helpers de moneda (montos base en USD; toggle ARS/USD + "eq" secundario) ──

function nfes(n: number): string { return Math.round(n).toLocaleString('es-AR'); }
function curBig(usd: number, cur: Moneda, tc: number): string {
  return cur === 'USD' ? 'USD ' + nfes(usd) : '$ ' + nfes(usd * tc);
}
function curEq(usd: number, cur: Moneda, tc: number): string {
  return cur === 'USD' ? '$ ' + nfes(usd * tc) + ' eq' : 'USD ' + nfes(usd) + ' eq';
}

function Eyebrow({ icon, children }: { icon?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
      {icon && <Icon name={icon} size={13} color="var(--gf-gray-400)" />}
      {children}
    </div>
  );
}

function Kpi({ icon, eyebrow, value, sub, accent }: { icon?: string; eyebrow: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; accent?: string }) {
  return (
    <Card variant="flat" padding="var(--space-3)" style={{ flex: 1, minWidth: 0 }}>
      <Eyebrow icon={icon}>{eyebrow}</Eyebrow>
      <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4, color: accent ?? 'var(--color-text)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}

// ── Mensual ───────────────────────────────────────────────────────────────────

function DashboardMensual({ d, cur }: { d: DashMensual; cur: Moneda }) {
  const tc = d.tc;
  const donut = (() => {
    let acc = 0;
    const stops = d.categorias.map(c => { const from = acc; acc += c.pct; return `${c.color} ${from}% ${acc}%`; });
    if (acc < 100) stops.push(`var(--gf-gray-200) ${acc}% 100%`);
    return `conic-gradient(${stops.join(', ')})`;
  })();
  const maxDia = Math.max(...d.diaria);
  const chartH = 120;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Balance del período */}
      <div style={{ background: 'linear-gradient(135deg, var(--gf-ink) 0%, var(--gf-ink-soft) 100%)', borderRadius: 'var(--radius-card)', padding: '22px 18px', textAlign: 'center', color: '#fff', boxShadow: 'var(--shadow-soft)' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>Balance del período</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: d.balancePositivo ? 'var(--gf-emerald-100)' : '#fca5a5' }}>{d.balancePositivo ? '↑ positivo' : '↓ negativo'}</span>
        </div>
        <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{curBig(d.balanceUsd, cur, tc)}</div>
        <div style={{ fontSize: 14, color: '#9ca3af', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{curEq(d.balanceUsd, cur, tc)}</div>
      </div>

      {/* Ingresos / Salidas */}
      <div style={{ display: 'flex', gap: 10 }}>
        {[{ e: 'Ingresos', v: d.ingresosUsd, c: 'var(--gf-income)' }, { e: 'Salidas', v: d.salidasUsd, c: '#f5a623' }].map(x => (
          <Card key={x.e} variant="flat" padding="0" style={{ flex: 1, overflow: 'hidden', textAlign: 'center' }}>
            <div style={{ height: 4, background: x.c }} />
            <div style={{ padding: '12px 10px' }}>
              <Eyebrow>{x.e}</Eyebrow>
              <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{curBig(x.v, cur, tc)}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-sec)', fontVariantNumeric: 'tabular-nums' }}>{curEq(x.v, cur, tc)}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* KPI grid */}
      <div style={{ display: 'flex', gap: 10 }}>
        <Kpi icon="receipt" eyebrow="Movimientos" value={d.movimientos} sub="en el mes" />
        <Kpi icon="bar-chart-3" eyebrow="Gasto promedio" value={curBig(d.gastoPromedioUsd, cur, tc)} sub={`${d.diasConGasto} días con gasto`} />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Kpi icon="tag" eyebrow="Categoría top" value={d.categoriaTop.nombre} sub={`${d.categoriaTop.pct}% del total`} />
      </div>
      <Card variant="flat" padding="var(--space-3)">
        <Eyebrow icon="trending-up">Mov. más alto</Eyebrow>
        <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{curBig(d.movMasAlto.usd, cur, tc)}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>{d.movMasAlto.desc}</div>
      </Card>

      {/* Por categoría — donut + lista */}
      <Card padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Por categoría</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 14 }}>este mes</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
          <div style={{ position: 'relative', width: 104, height: 104, flexShrink: 0, borderRadius: '50%', background: donut }}>
            <div style={{ position: 'absolute', inset: 18, background: 'var(--color-surface)', borderRadius: '50%' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {d.categorias.map(c => (
              <div key={c.nombre} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--color-text-strong)' }}>{c.nombre}</span>
                <span style={{ fontWeight: 700, color: 'var(--color-text-sec)' }}>{c.pct}%</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, borderTop: '1px solid var(--gf-gray-100)', paddingTop: 12 }}>
          {d.categorias.slice(0, 5).map(c => (
            <div key={c.nombre}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 4 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 600 }}>{c.nombre}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{c.count}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{curBig(c.usd, cur, tc)}</span>
              </div>
              <div style={{ height: 6, background: 'var(--gf-gray-100)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${c.pct}%`, background: c.color, borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Top subcategorías */}
      <Card padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Top subcategorías</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 14 }}>movimientos del mes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {d.subcategorias.map(s => (
            <div key={s.nombre} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 96, flexShrink: 0, fontSize: 12.5, color: 'var(--color-text-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right' }}>{s.nombre}</span>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ height: 22, borderRadius: 5, background: s.color, width: `${s.pct * 2.6}%`, minWidth: 8 }} />
                <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{s.valor}</span>
                <span style={{ fontSize: 11, color: 'var(--gf-gray-400)' }}>{s.pct}%</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Evolución diaria */}
      <Card padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Evolución diaria</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 14 }}>· pico {d.picoDia.fecha} · {d.picoDia.dow}</div>
        <div style={{ position: 'relative', height: chartH, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${(d.promedioDiarioUsd / maxDia) * chartH}px`, borderTop: '1.5px dashed #f5a623', zIndex: 1 }}>
            <span style={{ position: 'absolute', top: -14, left: 0, fontSize: 9, color: '#f5a623', fontWeight: 600 }}>promedio diario</span>
          </div>
          {d.diaria.map((v, i) => {
            const peak = (i + 1) === d.picoDia.diaNum;
            return <div key={i} style={{ flex: 1, height: `${Math.max((v / maxDia) * chartH, v > 0 ? 3 : 0)}px`, background: peak ? 'var(--gf-expense)' : '#9cb3e8', borderRadius: '2px 2px 0 0' }} title={`Día ${i + 1}: USD ${v}`} />;
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--gf-gray-400)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
          <span>01</span><span>05</span><span>10</span><span>15</span><span>20</span><span>25</span><span>30</span>
        </div>
      </Card>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10 }}>
        <Kpi eyebrow="Días con gasto" value={d.diasConGasto} />
        <Kpi eyebrow="Fin de semana" value={`${d.finDeSemanaPct}%`} sub="del gasto del mes" />
        <Kpi eyebrow="Promedio diario" value={curBig(d.promedioDiarioUsd, cur, tc)} />
      </div>
      <Card variant="flat" padding="var(--space-3)">
        <Eyebrow>Top 3 categorías</Eyebrow>
        <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>{d.top3Pct}%</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Mes en superávit</div>
      </Card>

      {/* Insight cards */}
      <div style={{ display: 'flex', gap: 10 }}>
        <Kpi eyebrow="Banco dominante" value={d.bancoDominante} />
        <Kpi eyebrow="Día pico" value={`${d.picoDia.fecha} · ${d.picoDia.dow}`} sub={curBig(d.picoDia.usd, cur, tc)} />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Kpi eyebrow="Vs mes anterior" value={`${d.vsMesAnteriorPct}%`} sub={d.vsMesLabel} accent={d.vsMesAnteriorPct < 0 ? 'var(--gf-income)' : 'var(--gf-expense)'} />
        <Kpi eyebrow="Lectura rápida" value={d.lecturaRapida} />
      </div>

      {/* Por descripción */}
      <Card padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Por descripción</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 12 }}>mayores gastos del mes</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {d.porDescripcion.map((x, i) => (
            <div key={x.desc} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: i < d.porDescripcion.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
              <span style={{ width: 18, fontSize: 12, fontWeight: 700, color: 'var(--gf-gray-400)' }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.desc}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{x.count}</span>
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{curBig(x.usd, cur, tc)}</span>
            </div>
          ))}
        </div>
      </Card>
      <div style={{ height: 4 }} />
    </div>
  );
}

// ── Anual (histórico) ─────────────────────────────────────────────────────────

function DashboardAnual({ a, tc, cur }: { a: DashAnual; tc: number; cur: Moneda }) {
  const maxSal = Math.max(...a.salidasPorMes);
  const maxIS = Math.max(...a.ingresosPorMes, ...a.salidasPorMes);
  const totalCat = a.categorias.reduce((s, c) => s + c.usd, 0);
  const maxCat = a.categorias[0].usd;
  const maxMM = Math.max(...a.mesAMes.map(m => m.usd));
  const donut = (() => {
    let acc = 0;
    const st = a.categorias.map(c => { const p = (c.usd / totalCat) * 100; const f = acc; acc += p; return `${c.color} ${f}% ${acc}%`; });
    return `conic-gradient(${st.join(', ')})`;
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Balance anual */}
      <div style={{ background: 'linear-gradient(135deg, var(--gf-ink) 0%, var(--gf-ink-soft) 100%)', borderRadius: 'var(--radius-card)', padding: '22px 18px', textAlign: 'center', color: '#fff', boxShadow: 'var(--shadow-soft)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)', marginBottom: 8 }}>Balance del año · {a.anio}</div>
        <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{curBig(a.balanceUsd, cur, tc)}</div>
        <div style={{ fontSize: 14, color: '#9ca3af', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{curEq(a.balanceUsd, cur, tc)}</div>
      </div>

      {/* Ingresos / Salidas */}
      <div style={{ display: 'flex', gap: 10 }}>
        {[{ e: 'Ingresos', v: a.ingresosUsd, c: 'var(--gf-income)' }, { e: 'Salidas', v: a.salidasUsd, c: '#f5a623' }].map(x => (
          <Card key={x.e} variant="flat" padding="0" style={{ flex: 1, overflow: 'hidden', textAlign: 'center' }}>
            <div style={{ height: 4, background: x.c }} />
            <div style={{ padding: '12px 10px' }}>
              <Eyebrow>{x.e}</Eyebrow>
              <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{curBig(x.v, cur, tc)}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-sec)', fontVariantNumeric: 'tabular-nums' }}>{curEq(x.v, cur, tc)}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Salidas por mes */}
      <Card padding="var(--space-4)">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Salidas por mes</div>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gf-expense)', background: 'var(--gf-expense-50)', borderRadius: 999, padding: '3px 9px' }}>tendencia +{a.tendenciaPct}%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 110, marginTop: 14 }}>
          {a.salidasPorMes.map((v, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ width: '100%', height: `${Math.max((v / maxSal) * 88, 3)}px`, background: a.meses[i] === a.mesMasAlto ? 'var(--color-accent)' : '#9cb3e8', borderRadius: '3px 3px 0 0' }} title={`${a.meses[i]}: USD ${v}`} />
              <div style={{ fontSize: 8.5, color: 'var(--gf-gray-400)' }}>{a.meses[i].charAt(0)}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <Kpi eyebrow="Promedio mensual" value={curBig(a.promedioMensualUsd, cur, tc)} />
          <Kpi eyebrow="Mes más alto" value={a.mesMasAlto} />
          <Kpi eyebrow="Mes más bajo" value={a.mesMasBajo} />
        </div>
      </Card>

      {/* Por categoría */}
      <Card padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Por categoría</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 14 }}>del año</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
          <div style={{ position: 'relative', width: 104, height: 104, flexShrink: 0, borderRadius: '50%', background: donut }}>
            <div style={{ position: 'absolute', inset: 18, background: 'var(--color-surface)', borderRadius: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--gf-gray-400)' }}>total</span>
              <span style={{ fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{cur === 'USD' ? 'U$S ' + nfes(totalCat) : '$' + nfes(totalCat * tc / 1000) + 'k'}</span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {a.categorias.slice(0, 6).map(c => (
              <div key={c.nombre} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--color-text-strong)' }}>{c.nombre}</span>
                <span style={{ fontWeight: 700, color: 'var(--color-text-sec)' }}>{Math.round((c.usd / totalCat) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--gf-gray-100)', paddingTop: 12 }}>
          {a.categorias.map(c => (
            <div key={c.nombre}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 3 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 600 }}>{c.nombre}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{curBig(c.usd, cur, tc)}</span>
              </div>
              <div style={{ height: 6, background: 'var(--gf-gray-100)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(c.usd / maxCat) * 100}%`, background: c.color, borderRadius: 3, opacity: 0.85 }} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Ingresos y salidas por mes */}
      <Card padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Ingresos y salidas por mes</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: 'var(--color-text-sec)', margin: '6px 0 12px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--gf-income)' }} />Ingresos</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: '#f5a623' }} />Salidas</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 104 }}>
          {a.meses.map((m, i) => (
            <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 88, width: '100%', justifyContent: 'center' }}>
                <div style={{ width: '42%', height: `${Math.max((a.ingresosPorMes[i] / maxIS) * 88, 2)}px`, background: 'var(--gf-income)', borderRadius: '2px 2px 0 0' }} />
                <div style={{ width: '42%', height: `${Math.max((a.salidasPorMes[i] / maxIS) * 88, 2)}px`, background: '#f5a623', borderRadius: '2px 2px 0 0' }} />
              </div>
              <div style={{ fontSize: 8.5, color: 'var(--gf-gray-400)' }}>{m.charAt(0)}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <Kpi eyebrow="Meses con datos" value={a.mesesConDatos} />
          <Kpi eyebrow="Comp. interanual" value={`${a.comparacionInteranualPct}%`} />
          <Kpi eyebrow="Mejor mes ahorro" value={a.mejorMesAhorro} />
        </div>
      </Card>

      {/* Mes a mes */}
      <Card padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Mes a mes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {a.mesAMes.map(m => (
            <div key={m.mes} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 30, flexShrink: 0, fontSize: 12, fontWeight: 700, color: 'var(--color-text-strong)' }}>{m.mes}</span>
              <div style={{ flex: 1, height: 8, background: 'var(--gf-gray-100)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(m.usd / maxMM) * 100}%`, background: 'var(--color-accent)', borderRadius: 4 }} />
              </div>
              <span style={{ width: 64, textAlign: 'right', fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{curBig(m.usd, cur, tc)}</span>
              <span style={{ width: 44, textAlign: 'right', fontSize: 11, fontWeight: 700, color: m.delta == null ? 'var(--gf-gray-300)' : m.delta < 0 ? 'var(--gf-income)' : 'var(--gf-expense)', fontVariantNumeric: 'tabular-nums' }}>
                {m.delta == null ? '—' : (m.delta > 0 ? '+' : '') + m.delta + '%'}
              </span>
            </div>
          ))}
        </div>
      </Card>
      <div style={{ height: 4 }} />
    </div>
  );
}

// ── Vista principal ───────────────────────────────────────────────────────────

const MESES_DISPONIBLES = ['2026-06', '2026-05', '2026-04'];
const MESES_LABEL: Record<string, string> = { '2026-06': 'Junio 2026', '2026-05': 'Mayo 2026', '2026-04': 'Abril 2026' };

export default function Dashboard() {
  const [mes, setMes] = useState('2026-06');
  const [sec, setSec] = useState<'mensual' | 'anual'>('mensual');
  const [cur, setCur] = useState<Moneda>('USD');

  const curPill = (id: Moneda) => {
    const on = cur === id;
    return (
      <button key={id} onClick={() => setCur(id)} style={{
        padding: '5px 12px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)',
        fontSize: 12, fontWeight: 700, background: on ? 'var(--color-surface)' : 'transparent',
        color: on ? 'var(--color-text)' : 'var(--color-text-sec)', boxShadow: on ? 'var(--shadow-sm)' : 'none', transition: '.15s',
      }}>{id === 'ARS' ? '$ ARS' : 'USD'}</button>
    );
  };
  const tab = (id: 'mensual' | 'anual', label: string) => {
    const on = sec === id;
    return (
      <button key={id} onClick={() => setSec(id)} style={{
        flex: 1, padding: '9px 12px', borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)',
        fontSize: 14, fontWeight: on ? 700 : 500, background: on ? 'var(--color-surface)' : 'transparent',
        color: on ? 'var(--color-text)' : 'var(--color-text-sec)', boxShadow: on ? 'var(--shadow-sm)' : 'none', transition: '.15s',
      }}>{label}</button>
    );
  };

  return (
    <div className="dash">
      <div style={{ background: 'var(--gf-gray-100)', borderRadius: 'var(--radius-card)', padding: '14px 14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <Eyebrow>Vista general</Eyebrow>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 1 }}>{EXAMPLE_DASH.mesLabel}</div>
          </div>
          <div style={{ display: 'flex', gap: 3, background: 'var(--gf-gray-200)', borderRadius: 999, padding: 3 }}>
            {(['ARS', 'USD'] as const).map(curPill)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--gf-gray-200)', borderRadius: 14, padding: 4 }}>
          {tab('mensual', 'Mensual')}{tab('anual', 'Anual')}
        </div>
        <select value={mes} onChange={e => setMes(e.target.value)} style={{
          width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontFamily: 'var(--font-base)', fontSize: 15, fontWeight: 600,
          color: 'var(--color-text)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, cursor: 'pointer',
        }}>
          {MESES_DISPONIBLES.map(m => <option key={m} value={m}>{MESES_LABEL[m]}</option>)}
        </select>
      </div>

      {sec === 'mensual'
        ? <DashboardMensual d={EXAMPLE_DASH} cur={cur} />
        : <DashboardAnual a={EXAMPLE_ANUAL} tc={EXAMPLE_DASH.tc} cur={cur} />}
    </div>
  );
}
