// PerfilMobile — "Tu Perfil / Configuración Familiar" (brief F8.0).
// Card stack: Personal tier (everyone) + Configuración Familiar (admin only).
const { Badge: PBadge, Button: PBtn } = window.GastosFamiliaresDesignSystem_d81a5e;

function Group({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 0 8px 4px' }}>{title}</div>
      <div style={{ background: '#fff', border: '1px solid var(--color-border-card)', borderRadius: 12, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function Item({ icon, title, desc, right, last, onClick }) {
  const Icon = window.Icon;
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px',
      borderBottom: last ? 'none' : '1px solid var(--gf-gray-100)', background: 'none', border: 'none',
      borderBottomStyle: last ? 'none' : 'solid', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-base)',
    }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--gf-gray-100)', color: 'var(--color-text-strong)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name={icon} size={18} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{title}</span>
        {desc && <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-sec)' }}>{desc}</span>}
      </span>
      {right || <Icon name="chevron-right" size={18} color="var(--gf-gray-300)" />}
    </button>
  );
}

// Paleta de colores de miembro (curada, del sistema) para el avatar sin foto.
const AVATAR_COLORS = ['#1f2937', '#1d4ed8', '#065f46', '#9a3412', '#6d28d9', '#be123c'];

// Hoja para editar avatar: subir foto real o elegir color de monograma.
function AvatarSheet({ me, foto, color, onFoto, onColor, onClose }) {
  const Icon = window.Icon;
  const fileRef = React.useRef(null);
  const pickFoto = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => onFoto(r.result);
    r.readAsDataURL(f);
  };
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(17,20,24,.45)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: 'var(--color-surface)', borderRadius: '18px 18px 0 0', padding: '16px 18px 22px', fontFamily: 'var(--font-base)' }}>
        <div style={{ width: 36, height: 4, borderRadius: 999, background: 'var(--gf-gray-200)', margin: '0 auto 14px' }} />
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Foto de perfil</div>

        {/* preview */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          {foto
            ? <img src={foto} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover' }} />
            : <span style={{ width: 72, height: 72, borderRadius: '50%', background: color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 700 }}>{me.nombre.charAt(0)}</span>}
        </div>

        <input ref={fileRef} type="file" accept="image/*" onChange={pickFoto} style={{ display: 'none' }} />
        <button onClick={() => fileRef.current && fileRef.current.click()} style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px',
          borderRadius: 12, border: '1px solid var(--color-border-card)', background: 'var(--color-surface)',
          cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 14, fontWeight: 600, color: 'var(--color-text)',
        }}>
          <Icon name="camera" size={17} /> {foto ? 'Cambiar foto' : 'Subir foto'}
        </button>
        {foto && (
          <button onClick={() => onFoto(null)} style={{
            width: '100%', marginTop: 8, padding: '9px', borderRadius: 12, border: 'none', background: 'transparent',
            cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 13, fontWeight: 600, color: 'var(--gf-expense)',
          }}>Quitar foto</button>
        )}

        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '16px 0 10px' }}>O elegí un color</div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
          {AVATAR_COLORS.map((c) => (
            <button key={c} onClick={() => { onColor(c); onFoto(null); }} aria-label={c} style={{
              width: 38, height: 38, borderRadius: '50%', background: c, cursor: 'pointer',
              border: !foto && color === c ? '3px solid var(--color-text)' : '3px solid transparent',
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PerfilMobile({ onNav }) {
  const Icon = window.Icon;
  const me = window.M_MIEMBRO;
  const [foto, setFoto] = React.useState(null);
  const [color, setColor] = React.useState('var(--gf-ink)');
  const [editAvatar, setEditAvatar] = React.useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* identity header — avatar tappable (foto o color) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 4px 2px' }}>
        <button onClick={() => setEditAvatar(true)} style={{ position: 'relative', padding: 0, border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0, borderRadius: '50%' }}>
          {foto
            ? <img src={foto} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
            : <span style={{ width: 56, height: 56, borderRadius: '50%', background: color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700 }}>{me.nombre.charAt(0)}</span>}
          <span style={{ position: 'absolute', right: -2, bottom: -2, width: 20, height: 20, borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--color-surface)' }}>
            <Icon name="camera" size={11} />
          </span>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{me.nombre}</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-sec)' }}>{me.email}</div>
        </div>
        <PBadge tone="success">{me.rol === 'admin' ? 'Admin' : 'Dependiente'}</PBadge>
      </div>

      <Group title="Personal">
        <Item icon="user-round" title="Mis datos" desc="Nombre, email, alias" />
        <Item icon="bell" title="Notificaciones" desc="Vencimientos y recordatorios" right={(() => {
          const n = window.contarVencProximos ? window.contarVencProximos() : 0;
          return n > 0
            ? <span style={{ minWidth: 20, height: 20, borderRadius: 999, background: 'var(--gf-expense)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>{n}</span>
            : <Icon name="chevron-right" size={18} color="var(--gf-gray-300)" />;
        })()} onClick={() => onNav && onNav('notificaciones')} />
        <Item icon="palette" title="Apariencia" desc="Tema claro" right={<PBadge tone="neutral">Pronto: oscuro</PBadge>} last />
      </Group>

      <Group title="Configuración familiar · admin">
        <Item icon="users-round" title="Miembros" desc="4 personas · 2 admin" onClick={() => onNav && onNav('miembros')} />
        <Item icon="list-checks" title="Pagos esperados" desc="9 ítems recurrentes" onClick={() => onNav && onNav('esperados')} />
        <Item icon="tags" title="Categorías" desc="11 categorías · con subcategorías" onClick={() => onNav && onNav('categorias')} />
        <Item icon="wallet" title="Medios de pago" desc="4 · bancos y billeteras" onClick={() => onNav && onNav('medios')} />
        <Item icon="credit-card" title="Tarjetas" desc="4 tarjetas · cierres y vencimientos" onClick={() => onNav && onNav('tarjetas-cfg')} />
        <Item icon="repeat" title="Tipo de cambio" desc="Manual · $ 1.454 / USD" onClick={() => onNav && onNav('tc')} last />
      </Group>

      <PBtn variant="secondary" size="cta">
        <Icon name="log-out" size={16} /> Cerrar sesión
      </PBtn>
      {editAvatar && <AvatarSheet me={me} foto={foto} color={color === 'var(--gf-ink)' ? '#1f2937' : color} onFoto={setFoto} onColor={setColor} onClose={() => setEditAvatar(false)} />}
      <div style={{ height: 4 }} />
    </div>
  );
}

Object.assign(window, { PerfilMobile });
