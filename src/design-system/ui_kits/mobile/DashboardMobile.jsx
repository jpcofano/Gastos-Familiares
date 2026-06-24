// DashboardMobile — "Inicio". Vista Mensual (analytics rica, paridad legacy 60_Dash.gs)
// + Anual (histórico). Toggle de moneda ARS/USD: muestra principal + el otro como "eq".
const { Card: DCard } = window.GastosFamiliaresDesignSystem_d81a5e;

// ── currency helpers (montos base en USD) ───────────────────────────────────
function nfes(n) { return Math.round(n).toLocaleString('es-AR'); }
function curBig(usd, cur, tc) { return cur === 'USD' ? 'USD ' + nfes(usd) : '$ ' + nfes(usd * tc); }
function curEq(usd, cur, tc) { return cur === 'USD' ? '$ ' + nfes(usd * tc) + ' eq' : 'USD ' + nfes(usd) + ' eq'; }

function Eyebrow({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{children}</div>;
}

// ── small KPI card ──────────────────────────────────────────────────────────
function Kpi({ eyebrow, value, sub, accent }) {
  return (
    <DCard variant="flat" padding="var(--space-3)" style={{ flex: 1, minWidth: 0 }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4, color: accent || 'var(--color-text)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>{sub}</div>}
    </DCard>
  );
}

// ── Mensual ─────────────────────────────────────────────────────────────────
function DashboardMensual({ cur }) {
  const d = window.M_DASH; const tc = d.tc;
  const donut = (() => {
    let acc = 0;
    const stops = d.categorias.map((c) => { const from = acc; acc += c.pct; return `${c.color} ${from}% ${acc}%`; });
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
        {[{ e: 'Ingresos', v: d.ingresosUsd, c: 'var(--gf-income)' }, { e: 'Salidas', v: d.salidasUsd, c: '#f5a623' }].map((x) => (
          <DCard key={x.e} variant="flat" padding="0" style={{ flex: 1, overflow: 'hidden', textAlign: 'center' }}>
            <div style={{ height: 4, background: x.c }} />
            <div style={{ padding: '12px 10px' }}>
              <Eyebrow>{x.e}</Eyebrow>
              <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{curBig(x.v, cur, tc)}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-sec)', fontVariantNumeric: 'tabular-nums' }}>{curEq(x.v, cur, tc)}</div>
            </div>
          </DCard>
        ))}
      </div>

      {/* KPI grid */}
      <div style={{ display: 'flex', gap: 10 }}>
        <Kpi eyebrow="🧾 Movimientos" value={d.movimientos} sub="en el mes" />
        <Kpi eyebrow="📊 Gasto promedio" value={curBig(d.gastoPromedioUsd, cur, tc)} sub={`${d.diasConGasto} días con gasto`} />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Kpi eyebrow="🏷️ Categoría top" value={d.categoriaTop.nombre} sub={`${d.categoriaTop.pct}% del total`} />
      </div>
      <DCard variant="flat" padding="var(--space-3)">
        <Eyebrow>💸 Mov. más alto</Eyebrow>
        <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{curBig(d.movMasAlto.usd, cur, tc)}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>{d.movMasAlto.desc}</div>
      </DCard>

      {/* Por categoría — donut + lista */}
      <DCard padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Por categoría</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 14 }}>este mes</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
          <div style={{ position: 'relative', width: 104, height: 104, flexShrink: 0, borderRadius: '50%', background: donut }}>
            <div style={{ position: 'absolute', inset: 18, background: 'var(--color-surface)', borderRadius: '50%' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {d.categorias.map((c) => (
              <div key={c.nombre} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--color-text-strong)' }}>{c.nombre}</span>
                <span style={{ fontWeight: 700, color: 'var(--color-text-sec)' }}>{c.pct}%</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, borderTop: '1px solid var(--gf-gray-100)', paddingTop: 12 }}>
          {d.categorias.slice(0, 5).map((c) => (
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
      </DCard>

      {/* Top subcategorías */}
      <DCard padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Top subcategorías</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 14 }}>movimientos del mes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {d.subcategorias.map((s) => (
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
      </DCard>

      {/* Evolución diaria */}
      <DCard padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Evolución diaria</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 14 }}>· pico {d.picoDia.fecha} · {d.picoDia.dow}</div>
        <div style={{ position: 'relative', height: chartH, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
          {/* promedio diario line */}
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
      </DCard>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10 }}>
        <Kpi eyebrow="Días con gasto" value={d.diasConGasto} />
        <Kpi eyebrow="Fin de semana" value={`${d.finDeSemanaPct}%`} sub="del gasto del mes" />
        <Kpi eyebrow="Promedio diario" value={curBig(d.promedioDiarioUsd, cur, tc)} />
      </div>
      <DCard variant="flat" padding="var(--space-3)">
        <Eyebrow>Top 3 categorías</Eyebrow>
        <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>{d.top3Pct}%</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Mes en superávit</div>
      </DCard>

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
      <DCard padding="var(--space-4)">
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
      </DCard>
      <div style={{ height: 4 }} />
    </div>
  );
}

// ── Anual (histórico) ───────────────────────────────────────────────────────
function DashboardAnual({ cur }) {
  const a = window.M_ANUAL; const tc = window.M_DASH.tc;
  const maxSal = Math.max(...a.salidasPorMes);
  const maxIS = Math.max(...a.ingresosPorMes, ...a.salidasPorMes);
  const totalCat = a.categorias.reduce((s, c) => s + c.usd, 0);
  const maxCat = a.categorias[0].usd;
  const maxMM = Math.max(...a.mesAMes.map((m) => m.usd));
  const donut = (() => { let acc = 0; const st = a.categorias.map((c) => { const p = (c.usd / totalCat) * 100; const f = acc; acc += p; return `${c.color} ${f}% ${acc}%`; }); return `conic-gradient(${st.join(', ')})`; })();

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
        {[{ e: 'Ingresos', v: a.ingresosUsd, c: 'var(--gf-income)' }, { e: 'Salidas', v: a.salidasUsd, c: '#f5a623' }].map((x) => (
          <DCard key={x.e} variant="flat" padding="0" style={{ flex: 1, overflow: 'hidden', textAlign: 'center' }}>
            <div style={{ height: 4, background: x.c }} />
            <div style={{ padding: '12px 10px' }}>
              <Eyebrow>{x.e}</Eyebrow>
              <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{curBig(x.v, cur, tc)}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-sec)', fontVariantNumeric: 'tabular-nums' }}>{curEq(x.v, cur, tc)}</div>
            </div>
          </DCard>
        ))}
      </div>

      {/* Salidas por mes */}
      <DCard padding="var(--space-4)">
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
      </DCard>

      {/* Por categoría */}
      <DCard padding="var(--space-4)">
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
            {a.categorias.slice(0, 6).map((c) => (
              <div key={c.nombre} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--color-text-strong)' }}>{c.nombre}</span>
                <span style={{ fontWeight: 700, color: 'var(--color-text-sec)' }}>{Math.round((c.usd / totalCat) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--gf-gray-100)', paddingTop: 12 }}>
          {a.categorias.map((c) => (
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
      </DCard>

      {/* Ingresos y salidas por mes */}
      <DCard padding="var(--space-4)">
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
      </DCard>

      {/* Mes a mes */}
      <DCard padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Mes a mes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {a.mesAMes.map((m) => (
            <div key={m.mes} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 30, flexShrink: 0, fontSize: 12, fontWeight: 700, color: 'var(--color-text-strong)' }}>{m.mes}</span>
              <div style={{ flex: 1, height: 8, background: 'var(--gf-gray-100)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(m.usd / maxMM) * 100}%`, background: 'var(--color-accent)', borderRadius: 4 }} />
              </div>
              <span style={{ width: 64, textAlign: 'right', fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{curBig(m.usd, cur, tc)}</span>
              <span style={{ width: 44, textAlign: 'right', fontSize: 11, fontWeight: 700, color: m.delta == null ? 'var(--gf-gray-300)' : m.delta < 0 ? 'var(--gf-income)' : 'var(--gf-expense)', fontVariantNumeric: 'tabular-nums' }}>{m.delta == null ? '—' : (m.delta > 0 ? '+' : '') + m.delta + '%'}</span>
            </div>
          ))}
        </div>
      </DCard>
      <div style={{ height: 4 }} />
    </div>
  );
}

// ── Shell: header (vista general + moneda + Mensual/Anual + mes) ─────────────
function DashboardMobile({ mes, setMes }) {
  const Ic = window.Icon;
  const [sec, setSec] = React.useState('mensual');
  const [cur, setCur] = React.useState('USD');
  const d = window.M_DASH;
  const curPill = (id) => {
    const on = cur === id;
    return (
      <button key={id} onClick={() => setCur(id)} style={{
        padding: '5px 12px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)',
        fontSize: 12, fontWeight: 700, background: on ? 'var(--color-surface)' : 'transparent',
        color: on ? 'var(--color-text)' : 'var(--color-text-sec)', boxShadow: on ? 'var(--shadow-sm)' : 'none', transition: '.15s',
      }}>{id === 'ARS' ? '$ ARS' : 'USD'}</button>
    );
  };
  const tab = (id, label) => {
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ background: 'var(--gf-gray-100)', borderRadius: 'var(--radius-card)', padding: '14px 14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <Eyebrow>Vista general</Eyebrow>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 1 }}>{d.mesLabel}</div>
          </div>
          <div style={{ display: 'flex', gap: 3, background: 'var(--gf-gray-200)', borderRadius: 999, padding: 3 }}>
            {[curPill('ARS'), curPill('USD')]}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--gf-gray-200)', borderRadius: 14, padding: 4 }}>
          {[tab('mensual', 'Mensual'), tab('anual', 'Anual')]}
        </div>
        <select value={mes} onChange={(e) => setMes(e.target.value)} style={{
          width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontFamily: 'var(--font-base)', fontSize: 15, fontWeight: 600,
          color: 'var(--color-text)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, cursor: 'pointer',
        }}>
          <option value="2026-06">Junio 2026</option>
          <option value="2026-05">Mayo 2026</option>
          <option value="2026-04">Abril 2026</option>
        </select>
      </div>

      {sec === 'mensual' ? <DashboardMensual cur={cur} /> : <DashboardAnual cur={cur} />}
    </div>
  );
}

Object.assign(window, { DashboardMobile });
