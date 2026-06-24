// TarjetasMobile — credit-card statements (resúmenes de tarjeta).
const { Money: TMny, Badge: TBadge, StatusBadge: TSB } =
  window.GastosFamiliaresDesignSystem_d81a5e;

const T_CARDS = [
  { id: 'visa', banco: 'Galicia', red: 'Visa', term: '4417', cierre: '28/06', vence: '10/07', total: 312900, estado: 'parcial', consumos: 14 },
  { id: 'amex', banco: 'Amex', red: 'American Express', term: '2003', cierre: '02/07', vence: '15/07', total: 184500, estado: 'pendiente', consumos: 9 },
  { id: 'master', banco: 'BBVA', red: 'Mastercard', term: '8856', cierre: '20/06', vence: '03/07', total: 96320, estado: 'pagado', consumos: 6 },
];

function CardRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ color: 'rgba(255,255,255,.6)' }}>{label}</span>
      <span style={{ color: '#fff', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function TarjetasMobile() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Resúmenes de tarjeta · Junio</div>
      {T_CARDS.map((c) => (
        <div key={c.id} style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
          {/* card face */}
          <div style={{ background: 'linear-gradient(135deg, var(--gf-ink) 0%, var(--gf-ink-soft) 100%)', padding: '16px 18px', color: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{c.banco}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gf-emerald-100)' }}>{c.red}</span>
            </div>
            <div style={{ fontSize: 15, letterSpacing: '2px', fontVariantNumeric: 'tabular-nums', marginBottom: 14, color: '#e5e7eb' }}>•••• •••• •••• {c.term}</div>
            <CardRow label="Cierre" value={c.cierre} />
            <CardRow label="Vencimiento" value={c.vence} />
          </div>
          {/* statement summary */}
          <div style={{ background: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--color-border-card)' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px' }}>Total resumen</div>
              <TMny value={c.total} colored={false} size="var(--text-lg)" />
              <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}> · {c.consumos} consumos</span>
            </div>
            <TSB state={c.estado} />
          </div>
        </div>
      ))}
      <div style={{ height: 4 }} />
    </div>
  );
}

Object.assign(window, { TarjetasMobile });
