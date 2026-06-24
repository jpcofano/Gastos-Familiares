// Perfil sub-screens: Miembros, Esperados (config), Categorías, Tipo de cambio.
// Modern config screens — elevated cards, generous spacing.
const { Card: SCard, Badge: SBadge, StatusBadge: SSB, Money: SMny, Button: SBtn } =
  window.GastosFamiliaresDesignSystem_d81a5e;

function Avatar({ nombre, color, size = 42 }) {
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', background: color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 700, flexShrink: 0 }}>
      {nombre.charAt(0)}
    </span>
  );
}

function AddBtn({ children, onClick }) {
  const Icon = window.Icon;
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: '14px', borderRadius: 'var(--radius-card)', border: '1.5px dashed var(--gf-gray-300)',
      background: 'transparent', color: 'var(--color-accent)', fontFamily: 'var(--font-base)',
      fontSize: 14, fontWeight: 600, cursor: 'pointer',
    }}>
      <Icon name="plus" size={18} /> {children}
    </button>
  );
}

// ── Miembros ──────────────────────────────────────────────────────────────
function MiembrosMobile() {
  const Icon = window.Icon;
  const items = window.M_MIEMBROS;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SCard padding="var(--space-2)">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((m, i) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 10px', borderBottom: i < items.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
              <Avatar nombre={m.nombre} color={m.color} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{m.nombre}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-sec)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</div>
              </div>
              <SBadge tone={m.rol === 'admin' ? 'success' : 'neutral'}>{m.rol === 'admin' ? 'Admin' : 'Dependiente'}</SBadge>
            </div>
          ))}
        </div>
      </SCard>
      <AddBtn>Invitar miembro</AddBtn>
      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Los <strong>admin</strong> gestionan miembros, esperados y categorías. Los <strong>dependientes</strong> solo cargan y ven sus movimientos.
      </p>
    </div>
  );
}

// ── Esperados (config) ────────────────────────────────────────────────────
function EsperadosConfigMobile() {
  const Icon = window.Icon;
  const items = window.M_ESPERADOS;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SCard padding="var(--space-2)">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((it, i) => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 10px', borderBottom: i < items.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>{it.label}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <SBadge tone="neutral">{it.persona}</SBadge>
                  <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Mensual{it.estado === 'automatico' ? ' · automático' : ''}</span>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <SMny value={it.monto} currency={it.moneda} colored={false} style={{ fontSize: 14 }} />
              </div>
              <Icon name="chevron-right" size={18} color="var(--gf-gray-300)" />
            </div>
          ))}
        </div>
      </SCard>
      <AddBtn>Agregar pago esperado</AddBtn>
    </div>
  );
}

// ── Categorías ────────────────────────────────────────────────────────────
function CategoriasMobile() {
  const Icon = window.Icon;
  const items = window.M_CATEGORIAS_CFG;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SCard padding="var(--space-2)">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 10px', borderBottom: i < items.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
              <span style={{ width: 14, height: 14, borderRadius: 5, background: c.color, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{c.nombre}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>{c.mov} {c.mov === 1 ? 'movimiento' : 'movimientos'} este mes</div>
              </div>
              {c.gasto > 0 && <SMny value={c.gasto} colored={false} style={{ fontSize: 13 }} />}
              <Icon name="chevron-right" size={18} color="var(--gf-gray-300)" />
            </div>
          ))}
        </div>
      </SCard>
      <AddBtn>Agregar categoría</AddBtn>
    </div>
  );
}

// ── Tipo de cambio ────────────────────────────────────────────────────────
function TipoCambioMobile() {
  const tc = window.M_TC_ACTUAL;
  const hist = window.M_TC_HIST;
  const [modo, setModo] = React.useState(tc.modo);
  const { RadioChip } = window.GastosFamiliaresDesignSystem_d81a5e;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SCard variant="highlight" eyebrow="Tipo de cambio · USD → ARS">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 36, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.5px' }}>$ {tc.valor.toLocaleString('es-AR')}</span>
          <span style={{ fontSize: 14, color: 'var(--color-text-sec)' }}>/ USD</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 4 }}>Actualizado el {tc.actualizado}</div>
      </SCard>

      <SCard>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)' }}>Modo de actualización</span>
          <RadioChip options={[{ value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Automático (API)' }]} value={modo} onChange={setModo} name="tcmodo" />
          <span style={{ fontSize: 12, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
            {modo === 'manual' ? 'Cargás el valor a mano cada mes. Se usa para convertir movimientos en USD a ARS.' : 'Se toma la cotización del dólar al cierre de cada día automáticamente.'}
          </span>
        </div>
      </SCard>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 0 8px 4px' }}>Histórico</div>
        <SCard padding="var(--space-2)">
          {hist.map((h, i) => (
            <div key={h.mes} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 10px', borderBottom: i < hist.length - 1 ? '1px solid var(--gf-gray-100)' : 'none', fontSize: 14 }}>
              <span style={{ color: 'var(--color-text-strong)' }}>{h.mes}</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>$ {h.valor.toLocaleString('es-AR')}</span>
            </div>
          ))}
        </SCard>
      </div>
    </div>
  );
}

// ── Medios de pago (bancos / billeteras / efectivo) ─────────────────
function MediosPagoMobile() {
  const Icon = window.Icon;
  const items = window.M_BANCOS;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SCard padding="var(--space-2)">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((b, i) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 10px', borderBottom: i < items.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
              <span style={{ width: 34, height: 34, borderRadius: 9, background: b.color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13, fontWeight: 700 }}>{b.nombre.charAt(0)}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{b.nombre}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>{b.tipo}</div>
              </div>
              <Icon name="chevron-right" size={18} color="var(--gf-gray-300)" />
            </div>
          ))}
        </div>
      </SCard>
      <AddBtn>Agregar medio de pago</AddBtn>
      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Los medios de pago alimentan el desglose diario por banco del Resumen.
      </p>
    </div>
  );
}

Object.assign(window, { MiembrosMobile, EsperadosConfigMobile, CategoriasMobile, TipoCambioMobile, MediosPagoMobile });
