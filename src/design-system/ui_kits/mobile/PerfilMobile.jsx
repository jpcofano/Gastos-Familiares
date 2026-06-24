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

function PerfilMobile({ onNav }) {
  const Icon = window.Icon;
  const me = window.M_MIEMBRO;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* identity header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 4px 2px' }}>
        <span style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--gf-ink)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, flexShrink: 0 }}>{me.nombre.charAt(0)}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{me.nombre}</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-sec)' }}>{me.email}</div>
        </div>
        <PBadge tone="success">{me.rol === 'admin' ? 'Admin' : 'Dependiente'}</PBadge>
      </div>

      <Group title="Personal">
        <Item icon="user-round" title="Mis datos" desc="Nombre, email, alias" />
        <Item icon="bell" title="Notificaciones" desc="Vencimientos y recordatorios" />
        <Item icon="palette" title="Apariencia" desc="Tema claro" right={<PBadge tone="neutral">Pronto: oscuro</PBadge>} last />
      </Group>

      <Group title="Configuración familiar · admin">
        <Item icon="users-round" title="Miembros" desc="3 personas · 2 admin" onClick={() => onNav && onNav('miembros')} />
        <Item icon="list-checks" title="Pagos esperados" desc="9 ítems recurrentes" onClick={() => onNav && onNav('esperados')} />
        <Item icon="tags" title="Categorías" desc="8 categorías" onClick={() => onNav && onNav('categorias')} />
        <Item icon="wallet" title="Medios de pago" desc="5 · bancos, billeteras, efectivo" onClick={() => onNav && onNav('medios')} />
        <Item icon="credit-card" title="Tarjetas" desc="3 tarjetas vinculadas" onClick={() => onNav && onNav('tarjetas')} />
        <Item icon="repeat" title="Tipo de cambio" desc="Manual · $ 1.180 / USD" onClick={() => onNav && onNav('tc')} last />
      </Group>

      <PBtn variant="secondary" size="cta">
        <Icon name="log-out" size={16} /> Cerrar sesión
      </PBtn>
      <div style={{ height: 4 }} />
    </div>
  );
}

Object.assign(window, { PerfilMobile });
