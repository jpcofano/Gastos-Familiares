// ResumenMobile — two sections:
//  • Por día  : daily table by bank (legacy 50_ResumenMes.gs parity) + KPIs, $eq y USDeq
//  • Esperados: checklist de pagos esperados con "marcar pagado" (funcionalidad nueva)
const { Money: RMny, StatusBadge: RSB, Badge: RBadge, Button: RBtn, Card: RCard, Message: RMsg } =
  window.GastosFamiliaresDesignSystem_d81a5e;

// ── helpers ───────────────────────────────────────────────────────────────
function rEqArs(x) { return x.moneda === 'ARS' ? x.monto : x.monto * (x.tcUsdArs || window.M_TC); }
const DIA_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function fmtArs(n) { return '$ ' + Math.round(n).toLocaleString('es-AR'); }

function bankColor(nombre) {
  const b = (window.M_BANCOS || []).find((x) => x.nombre === nombre);
  return b ? b.color : 'var(--gf-gray-400)';
}

// ── KPI calc (parity: ingresos/gastos/neto en $eq y USDeq, disponible, faltante) ──
function rCalc(movs) {
  const tc = window.M_TC;
  let ingArs = 0, ingUsd = 0, gasArs = 0, gasUsd = 0;
  for (const x of movs) {
    const m = x.monto;
    if (x.tipo === 'Ingreso') { if (x.moneda === 'USD') ingUsd += m; else ingArs += m; }
    else { if (x.moneda === 'USD') gasUsd += m; else gasArs += m; }
  }
  const ingArsEq = ingArs + ingUsd * tc, gasArsEq = gasArs + gasUsd * tc;
  const ingUsdEq = ingUsd + ingArs / tc, gasUsdEq = gasUsd + gasArs / tc;
  return {
    ingArsEq, gasArsEq, netArsEq: ingArsEq - gasArsEq,
    ingUsdEq, gasUsdEq, netUsdEq: ingUsdEq - gasUsdEq,
    pesosDisp: ingArs, faltanteUsd: (ingArs - gasArs) / tc,
  };
}

// Group expenses by day → { day, date, total$eq, totalUsdEq, perBank: [{banco, ars}] }
function rByDay(movs) {
  const map = new Map();
  for (const x of movs) {
    if (x.tipo !== 'Gasto') continue;
    const d = x.fecha.getDate();
    if (!map.has(d)) map.set(d, { day: d, date: x.fecha, eqArs: 0, usdEqMon: 0, banks: {} });
    const e = map.get(d);
    e.eqArs += rEqArs(x);
    e.banks[x.banco] = (e.banks[x.banco] || 0) + rEqArs(x);
  }
  return [...map.values()].sort((a, b) => a.day - b.day);
}

function PersonaIngreso() {
  const movs = window.M_MOVS.filter((x) => x.tipo === 'Ingreso');
  const map = {};
  for (const x of movs) { map[x.persona] = (map[x.persona] || 0) + rEqArs(x); }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

// ── KPI block (shared) ──────────────────────────────────────────────────────
function KpiCards({ c, cur }) {
  const M = window.GFMoney;
  return (
    <React.Fragment>
      <div style={{ background: 'linear-gradient(135deg, var(--gf-ink) 0%, var(--gf-ink-soft) 100%)', borderRadius: 'var(--radius-card)', padding: 'var(--space-4)', color: '#fff', boxShadow: 'var(--shadow-soft)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'rgba(255,255,255,.55)' }}>Neto del mes</div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          <span style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.5px', color: '#fff' }}>
            {c.netArsEq >= 0 ? '+' : '−'}{M.fromARS(Math.abs(c.netArsEq), cur)}
          </span>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,.7)', fontVariantNumeric: 'tabular-nums' }}>
            {M.otherFromARS(Math.abs(c.netArsEq), cur)}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'rgba(255,255,255,.75)', marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.15)' }}>
          <span>Ingresos {M.fromARS(c.ingArsEq, cur)}</span>
          <span>Gastos {M.fromARS(c.gasArsEq, cur)}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <RCard eyebrow="Disponible (ARS)" style={{ flex: 1 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtArs(c.pesosDisp)}</span>
        </RCard>
        <RCard eyebrow="Resultado (USD)" style={{ flex: 1 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: c.faltanteUsd >= 0 ? 'var(--gf-income)' : 'var(--gf-expense)' }}>
            U$S {Math.round(c.faltanteUsd).toLocaleString('es-AR')}
          </span>
        </RCard>
      </div>
    </React.Fragment>
  );
}

// ── Section: Por día (daily table by bank) ──────────────────────────────────
function PorDia({ cur }) {
  const Ic = window.Icon;
  const M = window.GFMoney;
  const movs = window.M_MOVS;
  const c = rCalc(movs);
  const days = rByDay(movs);
  const personas = PersonaIngreso();
  const totalMesEq = days.reduce((s, d) => s + d.eqArs, 0);
  const hoy = 25; // demo "today"

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <KpiCards c={c} cur={cur} />

      {/* Revisar pendientes — badge con cantidad */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--color-surface)', border: '1px solid var(--gf-gray-150)', borderRadius: 14, padding: '11px 13px' }}>
        <Ic name="alert-circle" size={16} color="var(--gf-out)" />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Revisar pendientes del mes</span>
        <span style={{ marginLeft: 'auto', minWidth: 22, height: 22, borderRadius: 999, background: 'var(--gf-out)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'grid', placeItems: 'center', padding: '0 6px' }}>1</span>
      </div>

      {/* Hoy */}
      <RCard variant="flat" padding="var(--space-3)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
          <Ic name="calendar" size={13} color="var(--gf-gray-400)" /> Hoy — miércoles 25
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-text-sec)', marginTop: 3 }}>Sin movimientos para hoy.</div>
      </RCard>

      {/* Distribución de ingresos */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 4px 8px' }}>
          <Ic name="users-round" size={13} color="var(--gf-gray-400)" /> Distribución de ingresos
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {personas.map(([p, v], i) => {
            const col = (window.M_MIEMBROS.find((m) => m.nombre === p) || {}).color || 'var(--gf-gray-400)';
            return (
              <div key={p} style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--gf-gray-150)', borderRadius: 'var(--radius-card)', padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: col }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-strong)' }}>{p}</span>
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{M.fromARS(v, cur)}</div>
                <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{M.otherFromARS(v, cur)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '0 4px 8px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
            <Ic name="calendar-days" size={13} color="var(--gf-gray-400)" /> Gastos por día
          </span>
          <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Total mes <strong style={{ color: 'var(--color-text)' }}>{M.fromARS(totalMesEq, cur)}</strong></span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {days.map((d) => {
            const isHoy = d.day === hoy;
            const banks = Object.entries(d.banks).sort((a, b) => b[1] - a[1]);
            return (
              <RCard key={d.day} variant={isHoy ? 'highlight' : 'flat'} padding="var(--space-3)">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 40, flexShrink: 0, textAlign: 'center' }}>
                    <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{d.day}</div>
                    <div style={{ fontSize: 10, color: 'var(--gf-gray-400)', textTransform: 'uppercase' }}>{DIA_ES[d.date.getDay()]}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {banks.map(([b, v]) => (
                      <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--color-text-strong)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '3px 8px' }}>
                        <span style={{ width: 7, height: 7, borderRadius: 999, background: bankColor(b) }} />
                        {b} · {fmtArs(v)}
                      </span>
                    ))}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{M.fromARS(d.eqArs, cur)}</div>
                    <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{M.otherFromARS(d.eqArs, cur)}</div>
                  </div>
                </div>
                {isHoy && <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gf-emerald)', textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 6 }}>Hoy</div>}
              </RCard>
            );
          })}
        </div>
      </div>
      <div style={{ height: 4 }} />
    </div>
  );
}

// ── Section: Esperados (checklist con marcar pagado) ────────────────────────
const R_TINT = {
  pagado: ['var(--st-pagado-bg)', 'var(--st-pagado-line)'],
  por_confirmar: ['var(--st-por-confirmar-bg)', 'var(--st-por-confirmar-line)'],
  parcial: ['var(--st-parcial-bg)', 'var(--st-parcial-line)'],
  automatico: ['var(--st-automatico-bg)', 'var(--st-automatico-line)'],
  pendiente: ['var(--st-pendiente-bg)', 'var(--st-pendiente-line)'],
  vencido: ['var(--st-vencido-bg)', 'var(--st-vencido-line)'],
  programado: ['var(--st-programado-bg)', 'var(--st-programado-line)'],
  no_registrado: ['var(--st-no-registrado-bg)', 'var(--st-no-registrado-line)'],
};

function Esperados() {
  const Ic = window.Icon;
  const [items, setItems] = React.useState(window.M_ESPERADOS);
  const marcarPagado = (id) => setItems((prev) => prev.map((i) => i.id === id ? { ...i, estado: 'pagado' } : i));
  const alDia = items.filter((i) => ['pagado', 'automatico'].includes(i.estado)).length;
  const pendiente = items.filter((i) => !['pagado', 'automatico'].includes(i.estado)).reduce((s, i) => s + i.monto, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <RCard eyebrow="Pendiente" style={{ flex: 1 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-expense)', fontVariantNumeric: 'tabular-nums' }}>{fmtArs(pendiente)}</span>
        </RCard>
        <RCard eyebrow="Al día" style={{ flex: '0 0 96px', textAlign: 'center' }}>
          <span style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{alDia}<span style={{ fontSize: 14, color: 'var(--gf-gray-400)' }}>/{items.length}</span></span>
        </RCard>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((i) => {
          const line = (R_TINT[i.estado] || R_TINT.pendiente)[1];
          const accionable = ['pendiente', 'vencido', 'no_registrado', 'por_confirmar'].includes(i.estado);
          return (
            <div key={i.id} style={{ background: 'var(--color-surface)', border: '1px solid var(--gf-gray-150)', borderRadius: 14, padding: '11px 13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: line, flexShrink: 0, marginTop: 6 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{i.label}</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <RBadge tone="neutral">{i.persona}</RBadge>
                      <RSB state={i.estado} />
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <RMny value={i.monto} currency={i.moneda} colored={false} decimals={0} style={{ fontSize: 15 }} />
                  {i.estado === 'parcial' && <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>Falta una cuota</div>}
                </div>
              </div>
              {accionable && (
                <div style={{ marginTop: 9 }}>
                  <RBtn variant="green" size="sm" style={{ width: '100%' }} onClick={() => marcarPagado(i.id)}><Ic name="check" size={15} /> Marcar pagado</RBtn>
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

// ── Shell with segmented toggle ─────────────────────────────────────────────
function ResumenMobile() {
  const [sec, setSec] = React.useState('dia');
  const [cur, setCur] = React.useState('ARS');
  const tabs = [{ id: 'dia', label: 'Por día' }, { id: 'fijos', label: 'Gastos Fijos' }];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--gf-gray-100)', borderRadius: 999, padding: 4, flex: 1 }}>
          {tabs.map((t) => {
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
        {/* toggle ARS/USD — igual que Inicio; en USD se invierte principal/secundario */}
        <div style={{ display: 'flex', gap: 2, background: 'var(--gf-gray-100)', borderRadius: 999, padding: 3, flexShrink: 0 }}>
          {['ARS', 'USD'].map((m) => {
            const on = cur === m;
            return (
              <button key={m} onClick={() => setCur(m)} style={{
                padding: '6px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-base)', fontSize: 12, fontWeight: on ? 700 : 600,
                background: on ? 'var(--gf-ink)' : 'transparent',
                color: on ? '#fff' : 'var(--color-text-sec)',
              }}>{m === 'ARS' ? '$' : 'USD'}</button>
            );
          })}
        </div>
      </div>
      {sec === 'dia' ? <PorDia cur={cur} /> : <Esperados />}
    </div>
  );
}

Object.assign(window, { ResumenMobile });
