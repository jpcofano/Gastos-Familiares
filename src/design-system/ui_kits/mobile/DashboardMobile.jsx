// DashboardMobile — "Inicio". Vista Mensual (analytics rica, paridad legacy 60_Dash.gs)
// + Anual (histórico). Toggle de moneda ARS/USD: muestra principal + el otro como "eq".
const { Card: DCard } = window.GastosFamiliaresDesignSystem_d81a5e;

// ── currency helpers (montos base en USD) ───────────────────────────────────
function curBig(usd, cur) { return window.GFMoney.fromUSD(usd, cur); }
function curOther(usd, cur) { return window.GFMoney.otherFromUSD(usd, cur); }

function Eyebrow({ children, icon }) {
  const Ic = window.Icon;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
      {icon && <Ic name={icon} size={13} color="var(--gf-gray-400)" />}
      {children}
    </div>
  );
}

// ── small KPI card ──────────────────────────────────────────────────────────
function Kpi({ eyebrow, value, sub, accent, icon }) {
  return (
    <DCard variant="flat" padding="var(--space-3)" style={{ flex: 1, minWidth: 0 }}>
      <Eyebrow icon={icon}>{eyebrow}</Eyebrow>
      <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4, color: accent || 'var(--color-text)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>{sub}</div>}
    </DCard>
  );
}

// ── Mensual ─────────────────────────────────────────────────────────────────
function DashboardMensual({ cur }) {
  const Ic = window.Icon;
  const d = window.M_DASH;
  const topCats = d.categorias.slice(0, 6);
  const restCats = d.categorias.slice(6);
  const otras = restCats.reduce((s, c) => ({ usd: s.usd + c.usd, count: s.count + c.count, pct: s.pct + c.pct }), { usd: 0, count: 0, pct: 0 });
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
        <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{curBig(d.balanceUsd, cur)}</div>
        <div style={{ fontSize: 14, color: '#9ca3af', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{curOther(d.balanceUsd, cur)}</div>
      </div>

      {/* Ingresos / Salidas */}
      <div style={{ display: 'flex', gap: 10 }}>
        {[{ e: 'Ingresos', v: d.ingresosUsd, c: 'var(--gf-income)' }, { e: 'Salidas', v: d.salidasUsd, c: 'var(--gf-out)' }].map((x) => (
          <DCard key={x.e} variant="flat" padding="0" style={{ flex: 1, overflow: 'hidden', textAlign: 'center' }}>
            <div style={{ height: 4, background: x.c }} />
            <div style={{ padding: '12px 10px' }}>
              <Eyebrow>{x.e}</Eyebrow>
              <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{curBig(x.v, cur)}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-sec)', fontVariantNumeric: 'tabular-nums' }}>{curOther(x.v, cur)}</div>
            </div>
          </DCard>
        ))}
      </div>

      {/* Tira secundaria compacta: 3 KPIs en una sola card dividida */}
      <DCard variant="flat" padding="0">
        <div style={{ display: 'flex' }}>
          {[
            { label: 'Movimientos', value: String(d.movimientos), sub: 'en el mes' },
            { label: 'Gasto prom.', value: curBig(d.gastoPromedioUsd, cur), sub: `${d.diasConGasto} días` },
            { label: 'Cat. top', value: d.categoriaTop.nombre, sub: `${d.categoriaTop.pct}% del total` },
          ].map((c, i) => (
            <div key={c.label} style={{ flex: 1, minWidth: 0, padding: '12px 10px', borderLeft: i > 0 ? '1px solid var(--gf-gray-100)' : 'none' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</div>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.value}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-sec)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.sub}</div>
            </div>
          ))}
        </div>
      </DCard>
      <DCard variant="flat" padding="var(--space-3)">
        <Eyebrow icon="trending-up">Mov. más alto</Eyebrow>
        <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{curBig(d.movMasAlto.usd, cur)}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>{d.movMasAlto.desc}</div>
      </DCard>

      {/* Por categoría — barra apilada + ranking */}
      <DCard padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Por categoría</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 14 }}>este mes</div>
        {/* barra apilada: distribución completa de un vistazo */}
        <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', marginBottom: 16, background: 'var(--gf-gray-100)' }}>
          {d.categorias.map((c) => (
            <div key={c.nombre} title={`${c.nombre} · ${c.pct}%`} style={{ width: `${c.pct}%`, background: c.color }} />
          ))}
        </div>
        {/* ranking: top 6 + "Otras" para el resto */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {topCats.map((c) => (
            <div key={c.nombre}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 4 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 600 }}>{c.nombre}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{c.count}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{curBig(c.usd, cur)}</span>
              </div>
              <div style={{ height: 6, background: 'var(--gf-gray-100)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${c.pct}%`, background: c.color, borderRadius: 3 }} />
              </div>
            </div>
          ))}
          {restCats.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, paddingTop: 4, borderTop: '1px solid var(--gf-gray-100)' }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--gf-gray-300)', flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: 'var(--color-text-sec)' }}>Otras</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{restCats.length}</span>
              <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-sec)' }}>{curBig(otras.usd, cur)}</span>
            </div>
          )}
        </div>
      </DCard>

      {/* Top subcategorías */}
      <DCard padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Top subcategorías</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 14 }}>movimientos del mes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(() => {
            const maxSub = Math.max(...d.subcategorias.map((s) => s.valor), 1);
            return d.subcategorias.map((s) => (
              <div key={s.nombre} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 96, flexShrink: 0, fontSize: 12.5, color: 'var(--color-text-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right' }}>{s.nombre}</span>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <div style={{ flex: 1, height: 22, background: 'var(--gf-gray-100)', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: s.color, width: `${Math.max((s.valor / maxSub) * 100, 5)}%`, borderRadius: 5 }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexShrink: 0, width: 116, justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{window.GFMoney.fromUSD(s.valor, cur)}</span>
                    <span style={{ fontSize: 11, color: 'var(--gf-gray-400)', width: 30, textAlign: 'right' }}>{s.pct}%</span>
                  </div>
                </div>
              </div>
            ));
          })()}
        </div>
      </DCard>

      {/* Evolución diaria */}
      <DCard padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Evolución diaria</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 14 }}>· pico {d.picoDia.fecha} · {d.picoDia.dow}</div>
        <div style={{ position: 'relative', height: chartH, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
          {/* promedio diario line */}
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
      </DCard>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10 }}>
        <Kpi eyebrow="Días con gasto" value={d.diasConGasto} />
        <Kpi eyebrow="Fin de semana" value={`${d.finDeSemanaPct}%`} sub="del gasto del mes" />
        <Kpi eyebrow="Promedio diario" value={curBig(d.promedioDiarioUsd, cur)} />
      </div>
      <DCard variant="flat" padding="var(--space-3)">
        <Eyebrow>Top 3 categorías</Eyebrow>
        <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>{d.top3Pct}%</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Mes en superávit</div>
      </DCard>

      {/* Insight cards */}
      <div style={{ display: 'flex', gap: 10 }}>
        <Kpi eyebrow="Banco dominante" value={d.bancoDominante} />
        <Kpi eyebrow="Día pico" value={`${d.picoDia.fecha} · ${d.picoDia.dow}`} sub={curBig(d.picoDia.usd, cur)} />
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
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{curBig(x.usd, cur)}</span>
            </div>
          ))}
        </div>
      </DCard>
      {/* Compartir informe (placeholder — se define el mecanismo: PDF / email / link) */}
      <button onClick={() => alert('Compartir informe — a definir (PDF / email / link)')} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', boxSizing: 'border-box',
        padding: '12px 16px', borderRadius: 12, border: '1px solid var(--color-border)', background: 'var(--color-surface)',
        cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 14, fontWeight: 700, color: 'var(--color-text)',
      }}>
        <Ic name="share-2" size={16} color="var(--color-text)" />
        Compartir informe
      </button>
      <div style={{ height: 4 }} />
    </div>
  );
}

// ── Anual (histórico) ───────────────────────────────────────────────────────
function DashboardAnual({ cur }) {
  const a = window.M_ANUAL;
  const Ic = window.Icon;
  const [openCat, setOpenCat] = React.useState(null);
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
        <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{curBig(a.balanceUsd, cur)}</div>
        <div style={{ fontSize: 14, color: '#9ca3af', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{curOther(a.balanceUsd, cur)}</div>
      </div>

      {/* Ingresos / Salidas */}
      <div style={{ display: 'flex', gap: 10 }}>
        {[{ e: 'Ingresos', v: a.ingresosUsd, c: 'var(--gf-income)' }, { e: 'Salidas', v: a.salidasUsd, c: 'var(--gf-out)' }].map((x) => (
          <DCard key={x.e} variant="flat" padding="0" style={{ flex: 1, overflow: 'hidden', textAlign: 'center' }}>
            <div style={{ height: 4, background: x.c }} />
            <div style={{ padding: '12px 10px' }}>
              <Eyebrow>{x.e}</Eyebrow>
              <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{curBig(x.v, cur)}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-sec)', fontVariantNumeric: 'tabular-nums' }}>{curOther(x.v, cur)}</div>
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
          <Kpi eyebrow="Promedio mensual" value={curBig(a.promedioMensualUsd, cur)} />
          <Kpi eyebrow="Mes más alto" value={a.mesMasAlto} />
          <Kpi eyebrow="Mes más bajo" value={a.mesMasBajo} />
        </div>
      </DCard>

      {/* Por categoría */}
      <DCard padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Por categoría</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 14 }}>del año</div>
        {/* barra apilada + total */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 700 }}>Total</span>
          <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{curBig(totalCat, cur)}</span>
        </div>
        <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', marginBottom: 16, background: 'var(--gf-gray-100)' }}>
          {a.categorias.map((c) => (
            <div key={c.nombre} title={`${c.nombre} · ${Math.round((c.usd / totalCat) * 100)}%`} style={{ width: `${(c.usd / totalCat) * 100}%`, background: c.color }} />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {a.categorias.map((c) => {
            const abierta = openCat === c.nombre;
            const subs = c.subs || [];
            const maxSub = subs.length ? Math.max(...subs.map((s) => s.usd)) : 1;
            return (
              <div key={c.nombre}>
                <button onClick={() => subs.length && setOpenCat(abierta ? null : c.nombre)} style={{
                  width: '100%', display: 'block', textAlign: 'left', background: 'none', border: 'none', padding: 0,
                  cursor: subs.length ? 'pointer' : 'default', fontFamily: 'var(--font-base)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 3 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{c.nombre}</span>
                    {subs.length > 0 && <Ic name={abierta ? 'chevron-down' : 'chevron-right'} size={14} color="var(--gf-gray-300)" />}
                    <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text)' }}>{curBig(c.usd, cur)}</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--gf-gray-100)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(c.usd / maxCat) * 100}%`, background: c.color, borderRadius: 3, opacity: 0.85 }} />
                  </div>
                </button>
                {abierta && subs.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, margin: '9px 0 4px 17px', paddingLeft: 11, borderLeft: '2px solid var(--gf-gray-100)' }}>
                    {subs.map((s) => (
                      <div key={s.nombre}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 3 }}>
                          <span style={{ color: 'var(--color-text-sec)' }}>{s.nombre}</span>
                          <span style={{ marginLeft: 'auto', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-strong)' }}>{curBig(s.usd, cur)}</span>
                          <span style={{ width: 34, textAlign: 'right', fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{Math.round((s.usd / c.usd) * 100)}%</span>
                        </div>
                        <div style={{ height: 4, background: 'var(--gf-gray-100)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${(s.usd / maxSub) * 100}%`, background: c.color, borderRadius: 3, opacity: 0.55 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DCard>

      {/* Ingresos y salidas por mes */}
      <DCard padding="var(--space-4)">
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
              <span style={{ width: 64, textAlign: 'right', fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{curBig(m.usd, cur)}</span>
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
  const Sheet = window.Sheet;
  const [sec, setSec] = React.useState('mensual');
  const [cur, setCur] = React.useState('USD');
  const [anio, setAnio] = React.useState('2026');
  const [periodOpen, setPeriodOpen] = React.useState(false);
  const d = window.M_DASH;
  const MES_OPTS = [{ value: '2026-06', label: 'Junio 2026' }, { value: '2026-05', label: 'Mayo 2026' }, { value: '2026-04', label: 'Abril 2026' }];
  const ANIO_OPTS = [{ value: '2026', label: '2026' }, { value: '2025', label: '2025' }, { value: '2024', label: '2024' }];
  const periodOpts = sec === 'anual' ? ANIO_OPTS : MES_OPTS;
  const periodVal = sec === 'anual' ? anio : mes;
  const periodLabel = (periodOpts.find((o) => o.value === periodVal) || {}).label || (sec === 'anual' ? anio : d.mesLabel);
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
      {/* Header compacto: período (abre bottom-sheet) + moneda, y toggle Mensual/Anual */}
      <div style={{ background: 'var(--gf-gray-100)', borderRadius: 'var(--radius-card)', padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <button onClick={() => setPeriodOpen(true)} style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px 7px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
            background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)', fontFamily: 'var(--font-base)',
          }}>
            <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.2px', color: 'var(--color-text)' }}>{periodLabel}</span>
            <Ic name="chevron-down" size={16} color="var(--color-text-sec)" />
          </button>
          <div style={{ display: 'flex', gap: 3, background: 'var(--gf-gray-200)', borderRadius: 999, padding: 3 }}>
            {[curPill('ARS'), curPill('USD')]}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--gf-gray-200)', borderRadius: 14, padding: 4 }}>
          {[tab('mensual', 'Mensual'), tab('anual', 'Anual')]}
        </div>
      </div>

      <Sheet open={periodOpen} onClose={() => setPeriodOpen(false)} title={sec === 'anual' ? 'Elegir año' : 'Elegir mes'}
        options={periodOpts} value={periodVal}
        onPick={(v) => (sec === 'anual' ? setAnio(v) : setMes(v))} />

      {sec === 'mensual' ? <DashboardMensual cur={cur} /> : <DashboardAnual cur={cur} />}
    </div>
  );
}

Object.assign(window, { DashboardMobile });
