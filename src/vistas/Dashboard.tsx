import { useState } from 'react';
import { Card, Sheet, Message, type SheetOption } from '../design-system/components';
import { Icon } from '../design-system/Icon';
import { fmtMoney } from '../datos/money';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { useMovimientosDelMes } from '../hooks/useMovimientosDelMes';
import { useMovimientosDelAnio } from '../hooks/useMovimientosDelAnio';
import { useFamiliaConfig } from '../hooks/useFamiliaConfig';
import { agregarMensual, agregarAnual, mesAnterior, type DashMensual, type DashAnual } from '../datos/agregados';
import './Dashboard.css';

// F9.26 — Dashboard cableado a datos reales (movimientos + config/familia),
// agregados on-read vía datos/agregados.ts (ver docs/F9.25_auditoria_agregados.md
// — ningún número se persiste). Reemplaza el mock de F9.3.

type Moneda = 'ARS' | 'USD';

// ── Helpers de moneda (montos base en USD; toggle ARS/USD) — delegan en el
// helper único fmtMoney (F9.8), sin TC propio ni sufijo "eq" ─────────────────

function nfes(n: number): string { return Math.round(n).toLocaleString('es-AR'); }
function curBig(usd: number, cur: Moneda, tc: number): string {
  return fmtMoney(usd, { from: 'USD', to: cur, tc });
}
function curEq(usd: number, cur: Moneda, tc: number): string {
  return fmtMoney(usd, { from: 'USD', to: cur === 'USD' ? 'ARS' : 'USD', tc });
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
  const [compartirInfo, setCompartirInfo] = useState(false);
  // F9.16 — top 6 + "Otras" (agrupa el resto), misma lista para la barra apilada y el ranking
  const catTop6 = d.categorias.slice(0, 6);
  const catResto = d.categorias.slice(6);
  const catOtras = catResto.length > 0
    ? { nombre: 'Otras', color: 'var(--gf-gray-300)', pct: catResto.reduce((s, c) => s + c.pct, 0), count: catResto.reduce((s, c) => s + c.count, 0), usd: catResto.reduce((s, c) => s + c.usd, 0) }
    : null;
  const catLista = catOtras ? [...catTop6, catOtras] : catTop6;
  const maxDia = Math.max(...d.diaria, 1);
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
        {[{ e: 'Ingresos', v: d.ingresosUsd, c: 'var(--gf-income)' }, { e: 'Salidas', v: d.salidasUsd, c: 'var(--gf-out)' }].map(x => (
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

      {/* Tira secundaria compacta (F9.10): Movimientos / Gasto prom. / Cat. top en una sola card */}
      <Card variant="flat" padding="0" style={{ display: 'flex' }}>
        {[
          { eyebrow: 'Movimientos', value: d.movimientos, sub: 'en el mes' },
          { eyebrow: 'Gasto prom.', value: curBig(d.gastoPromedioUsd, cur, tc), sub: `${d.diasConGasto} días` },
          { eyebrow: 'Cat. top', value: d.categoriaTop.nombre, sub: `${d.categoriaTop.pct}% del total` },
        ].map((x, i) => (
          <div key={x.eyebrow} style={{ flex: 1, minWidth: 0, padding: '10px 8px', textAlign: 'center', borderLeft: i > 0 ? '1px solid var(--gf-gray-100)' : 'none' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.eyebrow}</div>
            <div style={{ fontSize: 15, fontWeight: 800, marginTop: 3, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.value}</div>
            <div style={{ fontSize: 10.5, color: 'var(--color-text-sec)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.sub}</div>
          </div>
        ))}
      </Card>
      <Card variant="flat" padding="var(--space-3)">
        <Eyebrow icon="trending-up">Mov. más alto</Eyebrow>
        <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{curBig(d.movMasAlto.usd, cur, tc)}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>{d.movMasAlto.desc}</div>
      </Card>

      {/* Por categoría — donut + lista */}
      <Card padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Por categoría</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 14 }}>este mes</div>
        <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', marginBottom: 14 }}>
          {catLista.map(c => (
            <div key={c.nombre} style={{ width: `${c.pct}%`, background: c.color }} title={`${c.nombre} · ${c.pct}%`} />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {catLista.map(c => (
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
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <div style={{ height: 22, borderRadius: 5, background: s.color, width: `${s.pct * 2.6}%`, minWidth: 8 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexShrink: 0, width: 116, justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{curBig(s.valor, cur, tc)}</span>
                  <span style={{ fontSize: 11, color: 'var(--gf-gray-400)', width: 30, textAlign: 'right' }}>{s.pct}%</span>
                </div>
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
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${(d.promedioDiarioUsd / maxDia) * chartH}px`, borderTop: '1.5px dashed var(--gf-out)', zIndex: 1 }}>
            <span style={{ position: 'absolute', top: -14, left: 0, fontSize: 9, color: 'var(--gf-out)', fontWeight: 600 }}>promedio diario</span>
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

      {/* F9.14 — placeholder, mecanismo a definir */}
      <button onClick={() => setCompartirInfo(true)} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', boxSizing: 'border-box',
        padding: '12px 16px', borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', cursor: 'pointer',
        fontFamily: 'var(--font-base)', fontSize: 14, fontWeight: 700, color: 'var(--color-text)', background: 'var(--color-surface)',
      }}>
        <Icon name="share-2" size={16} color="var(--color-text-sec)" />
        Compartir informe
      </button>
      {compartirInfo && (
        <Message kind="wait" title="Próximamente.">
          Compartir el informe mensual está en definición (PDF, email o link). Por ahora es un placeholder visual.
        </Message>
      )}
      <div style={{ height: 4 }} />
    </div>
  );
}

// ── Anual (histórico) ─────────────────────────────────────────────────────────

function DashboardAnual({ a, tc, cur }: { a: DashAnual; tc: number; cur: Moneda }) {
  const [openCat, setOpenCat] = useState<string | null>(null);
  const maxSal = Math.max(...a.salidasPorMes, 1);
  const maxIS = Math.max(...a.ingresosPorMes, ...a.salidasPorMes, 1);
  const totalCat = a.categorias.reduce((s, c) => s + c.usd, 0);
  const maxCat = a.categorias[0]?.usd ?? 1;
  const maxMM = Math.max(...a.mesAMes.map(m => m.usd), 1);

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
        {[{ e: 'Ingresos', v: a.ingresosUsd, c: 'var(--gf-income)' }, { e: 'Salidas', v: a.salidasUsd, c: 'var(--gf-out)' }].map(x => (
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
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gf-expense)', background: 'var(--gf-expense-50)', borderRadius: 999, padding: '3px 9px' }}>tendencia {a.tendenciaPct > 0 ? '+' : ''}{a.tendenciaPct}%</span>
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
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Por categoría</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>del año</div>
          </div>
          <span style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{cur === 'USD' ? 'U$S ' + nfes(totalCat) : '$' + nfes(totalCat * tc / 1000) + 'k'}</span>
        </div>
        <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', margin: '14px 0' }}>
          {a.categorias.map(c => (
            <div key={c.nombre} style={{ width: `${(c.usd / totalCat) * 100}%`, background: c.color }} title={`${c.nombre} · ${Math.round((c.usd / totalCat) * 100)}%`} />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {a.categorias.map(c => {
            const open = openCat === c.nombre;
            return (
              <div key={c.nombre}>
                <div
                  onClick={() => setOpenCat(open ? null : c.nombre)}
                  role="button" tabIndex={0}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 3, cursor: 'pointer' }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 600 }}>{c.nombre}</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{curBig(c.usd, cur, tc)}</span>
                  <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} color="var(--gf-gray-400)" />
                </div>
                <div style={{ height: 6, background: 'var(--gf-gray-100)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(c.usd / maxCat) * 100}%`, background: c.color, borderRadius: 3, opacity: 0.85 }} />
                </div>
                {open && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, margin: '8px 0 2px 17px' }}>
                    {c.subcategorias.map(s => (
                      <div key={s.nombre} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 84, flexShrink: 0, fontSize: 11.5, color: 'var(--color-text-sec)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.nombre}</span>
                        <div style={{ flex: 1, height: 5, background: 'var(--gf-gray-100)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${s.pct}%`, background: c.color, opacity: 0.6, borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 11.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{curBig(s.usd, cur, tc)}</span>
                        <span style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', width: 30, textAlign: 'right', flexShrink: 0 }}>{s.pct}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Ingresos y salidas por mes */}
      <Card padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Ingresos y salidas por mes</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: 'var(--color-text-sec)', margin: '6px 0 12px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--gf-income)' }} />Ingresos</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--gf-out)' }} />Salidas</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 104 }}>
          {a.meses.map((m, i) => (
            <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 88, width: '100%', justifyContent: 'center' }}>
                <div style={{ width: '42%', height: `${Math.max((a.ingresosPorMes[i] / maxIS) * 88, 2)}px`, background: 'var(--gf-income)', borderRadius: '2px 2px 0 0' }} />
                <div style={{ width: '42%', height: `${Math.max((a.salidasPorMes[i] / maxIS) * 88, 2)}px`, background: 'var(--gf-out)', borderRadius: '2px 2px 0 0' }} />
              </div>
              <div style={{ fontSize: 8.5, color: 'var(--gf-gray-400)' }}>{m.charAt(0)}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <Kpi eyebrow="Meses con datos" value={a.mesesConDatos} />
          <Kpi eyebrow="Comp. interanual" value={a.comparacionInteranualPct == null ? '—' : `${a.comparacionInteranualPct}%`} />
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

function mesActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function mesesDisponibles(n = 12): { value: string; label: string }[] {
  const hoy = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { value, label: `${MESES_LARGO[d.getMonth()]} ${d.getFullYear()}` };
  });
}

function aniosDisponibles(n = 4): number[] {
  const actual = new Date().getFullYear();
  return Array.from({ length: n }, (_, i) => actual - i);
}

export default function Dashboard() {
  const { memberId, miembro } = useMiembroCtx();
  const esAdmin = miembro.rol === 'admin';
  const persona = esAdmin ? undefined : memberId;

  const [mes, setMes] = useState(mesActual);
  const [anio, setAnio] = useState(() => new Date().getFullYear());
  const [sec, setSec] = useState<'mensual' | 'anual'>('mensual');
  const [cur, setCur] = useState<Moneda>('USD');
  const [sheetOpen, setSheetOpen] = useState(false);

  const { config } = useFamiliaConfig();
  const { movimientos: movsMes,     cargando: cargandoMes }    = useMovimientosDelMes(mes, persona);
  const { movimientos: movsMesPrev, cargando: cargandoMesPrev } = useMovimientosDelMes(mesAnterior(mes), persona);
  const { movimientos: movsAnio,     cargando: cargandoAnio }    = useMovimientosDelAnio(anio, persona);
  const { movimientos: movsAnioPrev, cargando: cargandoAnioPrev } = useMovimientosDelAnio(anio - 1, persona);

  const cargandoSec = sec === 'mensual' ? (cargandoMes || cargandoMesPrev) : (cargandoAnio || cargandoAnioPrev);

  const dashMensual = agregarMensual(movsMes, mes, config, movsMesPrev);
  const dashAnual = agregarAnual(movsAnio, anio, movsAnioPrev);
  const tcAnual = [...movsAnio].filter(m => m.tcUsdArs).sort((a, b) => b.fecha.getTime() - a.fecha.getTime())[0]?.tcUsdArs ?? dashMensual.tc;

  const periodosMes = mesesDisponibles();
  const periodosAnio = aniosDisponibles();
  const periodoLabel = sec === 'mensual' ? (periodosMes.find(p => p.value === mes)?.label ?? mes) : String(anio);
  const periodoOptions: SheetOption[] = sec === 'mensual'
    ? periodosMes.map(p => ({ value: p.value, label: p.label }))
    : periodosAnio.map(a => ({ value: a, label: String(a) }));
  const periodoValue: string | number = sec === 'mensual' ? mes : anio;
  const onPeriodoPick = (v: string | number) => { if (sec === 'mensual') setMes(String(v)); else setAnio(Number(v)); };

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
      <div style={{ background: 'var(--gf-gray-100)', borderRadius: 'var(--radius-card)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => setSheetOpen(true)} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '7px 10px 7px 12px', borderRadius: 999, border: 'none',
            cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 15, fontWeight: 800,
            color: 'var(--color-text)', background: 'var(--color-surface)', boxShadow: 'var(--shadow-soft)',
          }}>
            {periodoLabel}
            <Icon name="chevron-down" size={15} color="var(--gf-gray-400)" />
          </button>
          <div style={{ display: 'flex', gap: 3, background: 'var(--gf-gray-200)', borderRadius: 999, padding: 3 }}>
            {(['ARS', 'USD'] as const).map(curPill)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--gf-gray-200)', borderRadius: 14, padding: 4 }}>
          {tab('mensual', 'Mensual')}{tab('anual', 'Anual')}
        </div>
      </div>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={sec === 'mensual' ? 'Elegir mes' : 'Elegir año'}
        options={periodoOptions}
        value={periodoValue}
        onPick={onPeriodoPick}
      />

      {cargandoSec ? (
        <p style={{ textAlign: 'center', color: 'var(--color-text-sec)', padding: '24px 0' }}>Cargando…</p>
      ) : sec === 'mensual' ? (
        dashMensual.movimientos === 0
          ? <p style={{ textAlign: 'center', color: 'var(--color-text-sec)', padding: '24px 0' }}>Sin movimientos en {periodoLabel}.</p>
          : <DashboardMensual d={dashMensual} cur={cur} />
      ) : (
        dashAnual.mesesConDatos === 0
          ? <p style={{ textAlign: 'center', color: 'var(--color-text-sec)', padding: '24px 0' }}>Sin movimientos en {anio}.</p>
          : <DashboardAnual a={dashAnual} tc={tcAnual} cur={cur} />
      )}
    </div>
  );
}
