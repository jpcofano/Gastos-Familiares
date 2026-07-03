// MobileShell — full app frame: AppBar + scrollable Screen + BottomNav,
// plus the ink hero + drawer + CTA scaffold for capture modals.

function Phone({ children }) {
  return (
    <div style={{ minHeight: '100%', background: '#0d1117', display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
      <div style={{
        width: '100%', maxWidth: 460, height: 880, background: 'var(--color-surface)',
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
      flex: '0 0 auto', minHeight: 58, background: 'var(--color-surface)', borderBottom: '1px solid var(--gf-gray-100)',
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

// BankLogo — logo oficial del medio de pago. Orden de intento:
//   1) Brandfetch CDN por dominio (si window.BRANDFETCH_CLIENT_ID está seteado),
//   2) archivo local assets/medios/<id>.(svg|png|webp),
//   3) chip-monograma con color de marca (fallback).
// NUNCA dibujamos logos de marca a mano.
function BankLogo({ id, nombre, color, dominio, size = 34, radius = 9 }) {
  const cid = window.BRANDFETCH_CLIENT_ID;
  const sources = [];
  if (cid && dominio) sources.push(`https://cdn.brandfetch.io/domain/${dominio}/w/120/h/120?c=${cid}`);
  if (id && dominio) for (const ext of ['svg', 'png', 'webp']) sources.push(`assets/medios/${id}.${ext}`);
  const [i, setI] = React.useState(0);
  const failed = i >= sources.length;
  if (failed || sources.length === 0) {
    return (
      <span style={{
        width: size, height: size, borderRadius: radius, background: color || 'var(--gf-gray-400)', color: '#fff',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        fontSize: Math.round(size * 0.38), fontWeight: 700,
      }}>{(nombre || '?').charAt(0)}</span>
    );
  }
  return (
    <img
      src={sources[i]}
      alt={nombre || ''}
      onError={() => setI((n) => n + 1)}
      style={{ width: size, height: size, borderRadius: radius, objectFit: 'contain', background: '#fff', border: '1px solid var(--gf-gray-150)', flexShrink: 0 }}
    />
  );
}

// MerchantLogo — logo del comercio de un movimiento. Resuelve nombre→dominio
// (window.comercioDominio, mapa curado) y reusa la CDN de Brandfetch; si no hay
// dominio (o falla) cae a un monograma con la inicial. Nunca dibuja marcas a mano.
function MerchantLogo({ nombre, size = 30, radius = 8 }) {
  const cid = window.BRANDFETCH_CLIENT_ID;
  const dominio = window.comercioDominio ? window.comercioDominio(nombre) : null;
  const sources = [];
  if (cid && dominio) sources.push(`https://cdn.brandfetch.io/domain/${dominio}/w/120/h/120?c=${cid}`);
  const [i, setI] = React.useState(0);
  React.useEffect(() => { setI(0); }, [nombre]);
  const failed = i >= sources.length;
  if (failed || sources.length === 0) {
    return (
      <span style={{
        width: size, height: size, borderRadius: radius, background: 'var(--gf-gray-100)', color: 'var(--gf-gray-500)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        fontSize: Math.round(size * 0.4), fontWeight: 700,
      }}>{(nombre || '?').trim().charAt(0).toUpperCase()}</span>
    );
  }
  return (
    <img
      src={sources[i]}
      alt={nombre || ''}
      onError={() => setI((n) => n + 1)}
      style={{ width: size, height: size, borderRadius: radius, objectFit: 'contain', background: '#fff', border: '1px solid var(--gf-gray-150)', flexShrink: 0 }}
    />
  );
}

// Sheet — bottom-sheet picker (reemplaza los <select> nativos del SO).
// Se posiciona absolute dentro del Phone (position:relative) y desliza desde abajo.
function Sheet({ open, onClose, title, options, value, onPick }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(17,24,39,.45)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', animation: 'gfSheetFade .18s ease' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: '20px 20px 0 0', padding: '10px 0 18px', boxShadow: '0 -10px 40px rgba(0,0,0,.25)' }}>
        <div style={{ width: 38, height: 4, borderRadius: 999, background: 'var(--gf-gray-200)', margin: '0 auto 10px' }} />
        {title && <div style={{ padding: '0 20px 8px', fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', textTransform: 'uppercase', letterSpacing: '.4px' }}>{title}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 360, overflowY: 'auto' }}>
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button key={o.value} onClick={() => { onPick(o.value); onClose(); }} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', border: 'none',
                background: on ? 'var(--gf-gray-100)' : 'transparent', cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 16,
                fontWeight: on ? 700 : 500, color: 'var(--color-text-strong)', textAlign: 'left',
              }}>
                <span>{o.label}</span>
                {on && <Icon name="check" size={18} color="#065f46" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
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
      flex: '0 0 auto', height: 64, background: 'var(--color-surface)', borderTop: '1px solid var(--gf-gray-150)',
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

function Hero({ eyebrow, amount, desc, tags = [], badge }) {
  return (
    <div style={{
      flex: '0 0 auto', padding: '8px 24px 30px', color: '#fff',
      background: 'linear-gradient(180deg, var(--gf-ink) 0%, var(--gf-ink-soft) 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
    }}>
      {eyebrow && <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--gf-emerald-100)', marginBottom: 12 }}>{eyebrow}</div>}
      <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1, marginBottom: 8, fontVariantNumeric: 'tabular-nums' }}>{amount}</div>
      {desc && <div style={{ fontSize: 16, color: '#9ca3af', marginBottom: 14 }}>{desc}</div>}
      {badge && <div style={{ marginBottom: tags.length > 0 ? 12 : 0 }}>{badge}</div>}
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

Object.assign(window, { Icon, BankLogo, MerchantLogo, Sheet, Phone, AppBar, Screen, BottomNav, FullModal, ModalBar, Hero, Drawer, SectionLabel, CtaBar });
