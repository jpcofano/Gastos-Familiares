// MobileShell — full app frame: AppBar + scrollable Screen + BottomNav,
// plus the ink hero + drawer + CTA scaffold for capture modals.

function Phone({ children }) {
  return (
    <div style={{ minHeight: '100%', background: '#0d1117', display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
      <div style={{
        width: '100%', maxWidth: 460, height: 880, background: '#fff',
        borderRadius: 22, overflow: 'hidden', position: 'relative',
        boxShadow: '0 0 0 1px rgba(255,255,255,.05), 0 40px 100px rgba(0,0,0,.6)',
        display: 'flex', flexDirection: 'column',
      }}>{children}</div>
    </div>
  );
}

function AppBar({ title, sub, left, right, onBack }) {
  const backBtn = onBack ? (
    <button onClick={onBack} aria-label="Volver" style={{
      width: 34, height: 34, borderRadius: 999, border: 'none', background: 'var(--gf-gray-100)',
      color: 'var(--color-text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', flexShrink: 0,
    }}>
      <Icon name="chevron-left" size={20} />
    </button>
  ) : left;
  return (
    <div style={{
      flex: '0 0 auto', minHeight: 58, background: '#fff', borderBottom: '1px solid var(--gf-gray-100)',
      display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', position: 'relative', zIndex: 2,
    }}>
      {backBtn}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.1 }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

function Screen({ children, pad = true }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--color-bg)', padding: pad ? '16px' : 0 }}>
      {children}
    </div>
  );
}

// Icon — React-owned wrapper around Lucide. React only manages the <span>;
// Lucide replaces the inner <i> with <svg>, which React never reconciles.
// This avoids the removeChild crash from createIcons() mutating live nodes.
function Icon({ name, size = 20, color, style }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const host = ref.current;
    if (!host || !window.lucide) return;
    host.innerHTML = '';
    const el = document.createElement('i');
    el.setAttribute('data-lucide', name);
    host.appendChild(el);
    try { window.lucide.createIcons({ attrs: { width: size, height: size } }); } catch (e) {}
    const svg = host.querySelector('svg');
    if (svg) { svg.style.width = size + 'px'; svg.style.height = size + 'px'; }
  }, [name, size]);
  return <span ref={ref} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, color: color || 'currentColor', flexShrink: 0, ...style }} />;
}

const NAV = [
  { id: 'inicio', label: 'Inicio', icon: 'house' },
  { id: 'resumen', label: 'Resumen', icon: 'list-checks' },
  { id: 'cargar', label: 'Cargar', icon: 'upload' },
  { id: 'perfil', label: 'Perfil', icon: 'user-round' },
];

function BottomNav({ active, onSelect, onFab }) {
  return (
    <div style={{
      flex: '0 0 auto', height: 64, background: '#fff', borderTop: '1px solid var(--gf-gray-150)',
      display: 'flex', alignItems: 'stretch', position: 'relative', zIndex: 2,
    }}>
      {NAV.map((n) => {
        const on = n.id === active;
        return (
          <button key={n.id} onClick={() => onSelect(n.id)} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
            background: 'none', border: 'none', cursor: 'pointer',
            color: on ? 'var(--color-accent)' : 'var(--gf-gray-400)', fontFamily: 'var(--font-base)',
          }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 52, height: 30, borderRadius: 999,
              background: on ? 'var(--gf-emerald-50)' : 'transparent',
              transition: 'background .18s ease',
            }}>
              <Icon name={n.icon} size={21} />
            </span>
            <span style={{ fontSize: 11, fontWeight: on ? 700 : 500 }}>{n.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Capture-flow scaffold (ink hero + drawer + CTA) ───────────────────────────
function FullModal({ children }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'var(--gf-ink)', display: 'flex', flexDirection: 'column' }}>
      {children}
    </div>
  );
}

function ModalBar({ title, onClose }) {
  return (
    <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px 6px', color: '#fff' }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af' }}>{title}</span>
      <button onClick={onClose} style={{ background: 'rgba(255,255,255,.1)', border: 'none', color: '#fff', borderRadius: 999, width: 30, height: 30, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

function Hero({ eyebrow, amount, desc, tags = [] }) {
  return (
    <div style={{
      flex: '0 0 auto', padding: '8px 24px 30px', color: '#fff',
      background: 'linear-gradient(180deg, var(--gf-ink) 0%, var(--gf-ink-soft) 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
    }}>
      {eyebrow && <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--gf-emerald-100)', marginBottom: 12 }}>{eyebrow}</div>}
      <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1, marginBottom: 8, fontVariantNumeric: 'tabular-nums' }}>{amount}</div>
      {desc && <div style={{ fontSize: 16, color: '#9ca3af', marginBottom: 14 }}>{desc}</div>}
      {tags.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {tags.map((t, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 'var(--radius-sm)', padding: '5px 12px', fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,.1)', color: '#e5e7eb' }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function Drawer({ children }) {
  return (
    <div style={{ background: '#fff', borderRadius: '24px 24px 0 0', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ width: 36, height: 4, background: 'var(--gf-gray-200)', borderRadius: 2, margin: '12px auto 0', flexShrink: 0 }} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px 0' }}>{children}</div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '18px 0 4px' }}>{children}</div>;
}

function CtaBar({ children }) {
  return (
    <div style={{ flexShrink: 0, background: '#fff', padding: '12px 24px 16px', borderTop: '1px solid rgba(0,0,0,.06)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {children}
    </div>
  );
}

Object.assign(window, { Icon, Phone, AppBar, Screen, BottomNav, FullModal, ModalBar, Hero, Drawer, SectionLabel, CtaBar });
