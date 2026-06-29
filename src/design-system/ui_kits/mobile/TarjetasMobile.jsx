// TarjetasMobile — visor de resúmenes de tarjeta (solo lectura).
// F9.12: tipo de tarjeta + cara tintada por marca.
// F9.13: cuotas — split "este mes / deuda futura" + detalle de consumos con
//        badge "Cuota X/Y", monto de la cuota y total del plan. Los totales se
//        derivan de los consumos para que los números cierren.
// F9.22: el dato vive en data.jsx (`M_RESUMENES_TARJETA`, con `periodo`). El
//        visor abre en el **mes en curso** (`M_PERIODO_ACTUAL`); el histórico
//        solo aparece si el usuario cambia de mes — nunca mezclado por defecto.
const { Money: TMny, Badge: TBadge, StatusBadge: TSB } =
  window.GastosFamiliaresDesignSystem_d81a5e;

// periodo 'YYYY-MM' → 'Junio 2026'
const T_MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
function periodoLabel(p) {
  const [a, m] = String(p).split('-');
  return `${T_MESES[+m - 1]} ${a}`;
}
function periodoCorto(p) {
  const [a, m] = String(p).split('-');
  return `${T_MESES[+m - 1].slice(0, 3)} ${a.slice(2)}`;
}

// ── métricas derivadas de los consumos (los números deben cerrar) ─────────────
function metrics(consumos) {
  let esteMes = 0, deudaFutura = 0, enCuotas = 0;
  for (const c of consumos) {
    esteMes += c.monto;
    if (c.cuotaTotal > 1) {
      enCuotas += 1;
      deudaFutura += c.monto * (c.cuotaTotal - c.cuotaActual);
    }
  }
  return { esteMes, deudaFutura, enCuotas, total: consumos.length };
}

function CardRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ color: 'rgba(255,255,255,.6)' }}>{label}</span>
      <span style={{ color: '#fff', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

// Cara de tarjeta tintada por marca (compartida lista + detalle).
function CardFace({ c, radiusTop = 16 }) {
  return (
    <div style={{ background: `linear-gradient(135deg, ${c.tint} 0%, var(--gf-ink) 100%)`, padding: '16px 18px', color: '#fff', borderRadius: `${radiusTop}px ${radiusTop}px 0 0` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{c.banco}</span>
          <div style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 8, fontSize: 9.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,.85)', background: 'rgba(255,255,255,.16)', borderRadius: 999, padding: '2px 7px', verticalAlign: 'middle' }}>{c.tipo}</div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.85)' }}>{c.red}</span>
      </div>
      <div style={{ fontSize: 15, letterSpacing: '2px', fontVariantNumeric: 'tabular-nums', marginBottom: 14, color: '#e5e7eb' }}>•••• •••• •••• {c.term}</div>
      <CardRow label="Cierre" value={c.cierre} />
      <CardRow label="Vencimiento" value={c.vence} />
    </div>
  );
}

// Pill "Cuota X/Y" — neutral, no compite con los estados de pago.
function CuotaBadge({ a, t }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700,
      color: 'var(--gf-out)', background: 'color-mix(in srgb, var(--gf-out) 12%, transparent)',
      borderRadius: 999, padding: '2px 8px', letterSpacing: '.2px', whiteSpace: 'nowrap',
    }}>
      <window.Icon name="layers" size={11} /> Cuota {a}/{t}
    </span>
  );
}

// ── Lista de resúmenes ────────────────────────────────────────────────────────
function CardCard({ c, onOpen }) {
  const m = metrics(c.consumos);
  return (
    <button onClick={onOpen} style={{
      display: 'block', width: '100%', textAlign: 'left', padding: 0, border: 'none', cursor: 'pointer',
      borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)', fontFamily: 'var(--font-base)', background: 'transparent',
    }}>
      <CardFace c={c} />
      {/* pie del resumen: split este mes / deuda futura */}
      <div style={{ background: 'var(--color-surface)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--color-border-card)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px' }}>A pagar este mes</div>
          <TMny value={m.esteMes} colored={false} decimals={0} size="var(--text-lg)" />
          <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>
            {m.total} consumos{m.enCuotas > 0 ? ` · ${m.enCuotas} en cuotas` : ''}
          </div>
          {m.deudaFutura > 0 && (
            <div style={{ fontSize: 12, color: 'var(--gf-out)', fontWeight: 600, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              + {window.GFMoney.ars(m.deudaFutura)} en cuotas futuras
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <TSB state={c.estado} />
          <window.Icon name="chevron-right" size={18} color="var(--gf-gray-300)" />
        </div>
      </div>
    </button>
  );
}

// ── Detalle de un resumen: split + consumos con cuotas ────────────────────────
function CardDetail({ c, onBack }) {
  const m = metrics(c.consumos);
  // cuotas primero, después por fecha
  const orden = [...c.consumos].sort((a, b) => (b.cuotaTotal > 1) - (a.cuotaTotal > 1));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button onClick={onBack} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', background: 'none', border: 'none',
        cursor: 'pointer', color: 'var(--color-text-sec)', fontFamily: 'var(--font-base)', fontSize: 13, fontWeight: 600, padding: 0,
      }}>
        <window.Icon name="chevron-left" size={16} /> Resúmenes
      </button>

      <div style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
        <CardFace c={c} />
        {/* split total: este mes vs deuda futura */}
        <div style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border-card)', display: 'flex' }}>
          <div style={{ flex: 1, padding: '12px 16px' }}>
            <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px' }}>A pagar este mes</div>
            <TMny value={m.esteMes} colored={false} decimals={0} size="var(--text-lg)" />
          </div>
          <div style={{ width: 1, background: 'var(--color-border-card)' }} />
          <div style={{ flex: 1, padding: '12px 16px' }}>
            <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px' }}>Deuda futura en cuotas</div>
            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: m.deudaFutura > 0 ? 'var(--gf-out)' : 'var(--color-text-sec)', fontVariantNumeric: 'tabular-nums' }}>
              {m.deudaFutura > 0 ? window.GFMoney.ars(m.deudaFutura) : '—'}
            </div>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 2 }}>
        Consumos · {m.total}
      </div>

      <div style={{ background: 'var(--color-surface)', borderRadius: 14, boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
        {orden.map((x, i) => {
          const cuotas = x.cuotaTotal > 1;
          const plan = cuotas ? x.monto * x.cuotaTotal : 0;
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '12px 14px',
              borderTop: i ? '1px solid var(--color-border-card)' : 'none',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-strong)' }}>{x.com}</span>
                  {cuotas && <CuotaBadge a={x.cuotaActual} t={x.cuotaTotal} />}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>{x.cat} · {x.fecha}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-strong)', fontVariantNumeric: 'tabular-nums' }}>
                  {window.GFMoney.ars(x.monto)}
                </div>
                {cuotas && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-sec)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                    plan {window.GFMoney.ars(plan)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ height: 4 }} />
    </div>
  );
}

// Chip selector de período — mes en curso primero, histórico detrás.
function PeriodoSwitcher({ periodos, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2, margin: '0 -2px' }}>
      {periodos.map((p, i) => {
        const on = p === value;
        return (
          <button key={p} onClick={() => onChange(p)} style={{
            flexShrink: 0, border: 'none', cursor: 'pointer', borderRadius: 999, padding: '6px 13px',
            fontFamily: 'var(--font-base)', fontSize: 12.5, fontWeight: on ? 700 : 600, whiteSpace: 'nowrap',
            color: on ? '#fff' : 'var(--color-text-sec)',
            background: on ? 'var(--gf-ink)' : 'var(--gf-gray-100)',
          }}>
            {periodoCorto(p)}{i === 0 ? ' · en curso' : ''}
          </button>
        );
      })}
    </div>
  );
}

function TarjetasMobile() {
  const ALL = window.M_RESUMENES_TARJETA || [];
  // períodos disponibles, más reciente primero
  const periodos = [...new Set(ALL.map((c) => c.periodo))].sort().reverse();
  const actual = window.M_PERIODO_ACTUAL || periodos[0];
  const [periodo, setPeriodo] = React.useState(actual);
  const [sel, setSel] = React.useState(null);

  const card = sel && ALL.find((c) => c.id === sel);
  if (card) return <CardDetail c={card} onBack={() => setSel(null)} />;

  // Por defecto SOLO el mes en curso; el histórico requiere cambiar de período.
  const visibles = ALL.filter((c) => c.periodo === periodo);
  const esActual = periodo === actual;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>
          Resúmenes de tarjeta · {periodoLabel(periodo)}
        </div>
        {periodos.length > 1 && <PeriodoSwitcher periodos={periodos} value={periodo} onChange={(p) => { setPeriodo(p); setSel(null); }} />}
      </div>
      {!esActual && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text-sec)', background: 'var(--gf-gray-100)', borderRadius: 10, padding: '8px 12px' }}>
          <window.Icon name="history" size={14} /> Estás viendo un mes pasado.
          <button onClick={() => setPeriodo(actual)} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-accent)', fontWeight: 700, fontFamily: 'var(--font-base)', fontSize: 12 }}>Volver al actual</button>
        </div>
      )}
      {visibles.map((c) => (
        <CardCard key={c.id} c={c} onOpen={() => setSel(c.id)} />
      ))}
      <div style={{ height: 4 }} />
    </div>
  );
}

Object.assign(window, { TarjetasMobile });
