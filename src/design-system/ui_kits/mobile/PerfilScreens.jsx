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
                <SMny value={it.monto} currency={it.moneda} colored={false} decimals={0} style={{ fontSize: 14 }} />
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
  const [open, setOpen] = React.useState(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SCard padding="var(--space-2)">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((c, i) => {
            const subs = c.subcats || [];
            const isOpen = open === c.id;
            const last = i === items.length - 1;
            return (
            <div key={c.id} style={{ borderBottom: !last ? '1px solid var(--gf-gray-100)' : 'none' }}>
              <button onClick={() => subs.length && setOpen(isOpen ? null : c.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 10px', border: 'none', background: 'transparent', cursor: subs.length ? 'pointer' : 'default', fontFamily: 'var(--font-base)', textAlign: 'left' }}>
              <span style={{ width: 14, height: 14, borderRadius: 5, background: c.color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>{c.nombre}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>{c.mov} {c.mov === 1 ? 'movimiento' : 'movimientos'}{subs.length ? ` · ${subs.length} subcat.` : ''}</div>
              </div>
              {c.gasto > 0 && <SMny value={c.gasto} colored={false} decimals={0} style={{ fontSize: 13 }} />}
              <Icon name={subs.length ? 'chevron-down' : 'chevron-right'} size={18} color="var(--gf-gray-300)" style={{ transition: 'transform .15s', transform: isOpen ? 'rotate(180deg)' : 'none' }} />
              </button>
              {isOpen && subs.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '2px 12px 14px 36px' }}>
                  {subs.map((s) => (
                    <span key={s} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-strong)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '4px 11px', whiteSpace: 'nowrap' }}>{s}</span>
                  ))}
                </div>
              )}
            </div>
            );
          })}
        </div>
      </SCard>
      <AddBtn>Agregar categoría</AddBtn>
    </div>
  );
}

// ── Tipo de cambio ────────────────────────────────────────────────────────
// Tipo de cambio — paridad con el vivo (F9.39): valor actual + badge de origen
// (Automático/Manual), formulario fecha+valor de carga/corrección manual, e
// histórico con badge por entrada. Fuente única tcDiario (acá M_TC_ACTUAL/M_TC_HIST).
function TipoCambioMobile() {
  const tc = window.M_TC_ACTUAL;
  const { Badge: SBadge, Button: SBtn } = window.GastosFamiliaresDesignSystem_d81a5e;
  const hoy = '2026-06-28';
  const [fecha, setFecha] = React.useState(hoy);
  const [valor, setValor] = React.useState('');
  const origenBadge = (o) => o === 'manual'
    ? <SBadge tone="warning">Manual</SBadge>
    : <SBadge tone="info">Automático</SBadge>;
  const inputStyle = { fontSize: 14, fontFamily: 'var(--font-base)', border: '1px solid var(--gf-gray-200)', borderRadius: 8, padding: '8px 11px', background: 'var(--color-surface)', color: 'var(--color-text)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SCard variant="highlight" eyebrow="TC USD → ARS (último MEP)">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 36, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.5px' }}>$ {tc.valor.toLocaleString('es-AR')}</span>
          <span style={{ fontSize: 14, color: 'var(--color-text-sec)' }}>/ USD</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Actualizado el {tc.actualizado}</span>
          {origenBadge(tc.modo)}
        </div>
      </SCard>

      <SCard>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)' }}>Cargar / corregir TC manual</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
            Respaldo del refresco automático (dolarapi-MEP). Pisa el valor de ese día puntual — el cron del día siguiente vuelve a poner el automático.
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            <input type="number" inputMode="decimal" placeholder="$ por USD" value={valor} onChange={(e) => setValor(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
          </div>
          <SBtn variant="primary" size="cta" disabled={!valor}>Guardar TC</SBtn>
        </div>
      </SCard>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 0 8px 4px' }}>Histórico (últimos {window.M_TC_HIST.length})</div>
        <SCard padding="var(--space-2)">
          {window.M_TC_HIST.map((h, i) => (
            <div key={h.mes} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '11px 10px', borderBottom: i < window.M_TC_HIST.length - 1 ? '1px solid var(--gf-gray-100)' : 'none', fontSize: 14 }}>
              <span style={{ color: 'var(--color-text-strong)' }}>{h.mes}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {origenBadge(i === 0 ? tc.modo : 'auto')}
                <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>$ {h.valor.toLocaleString('es-AR')}</span>
              </div>
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
  const BankLogo = window.BankLogo;
  const items = (window.M_BANCOS || []).filter((b) => !b.oculto);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SCard padding="var(--space-2)">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((b, i) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 10px', borderBottom: i < items.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
              <BankLogo id={b.id} nombre={b.nombre} color={b.color} dominio={b.dominio} />
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

// ── Tarjetas (config propia) ──────────────────────────────────────────────
// Config de TUS tarjetas: ciclos de cierre/vencimiento, titular. NO es el visor
// de resúmenes (/tarjetas), que es solo lectura y se llega desde Resumen.
function TarjetasConfigMobile() {
  const Icon = window.Icon;
  const items = window.M_TARJETAS_CFG;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SCard padding="var(--space-2)">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 10px', borderBottom: i < items.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
              <span style={{ width: 34, height: 34, borderRadius: 9, background: c.color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="credit-card" size={18} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{c.banco} · {c.red}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-sec)', fontVariantNumeric: 'tabular-nums' }}>•••• {c.term} · cierra día {c.cierreDia} · vence día {c.venceDia}</div>
              </div>
              <Icon name="chevron-right" size={18} color="var(--gf-gray-300)" />
            </div>
          ))}
        </div>
      </SCard>
      <AddBtn>Agregar tarjeta</AddBtn>
      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Las tarjetas definen los ciclos de cierre y vencimiento. Los resúmenes se ven en
        <strong> Resumen › Tarjetas</strong>.
      </p>
    </div>
  );
}

Object.assign(window, { MiembrosMobile, EsperadosConfigMobile, CategoriasMobile, TipoCambioMobile, MediosPagoMobile, TarjetasConfigMobile });

// ── Notificaciones · recordatorios de vencimientos (derivados) ────────────────
// Deriva de M_ESPERADOS (no pagados, con `vence`) + M_TARJETAS_CFG (`venceDia`).
// "Hoy" = 28 (demo). Estado por proximidad: vencido / hoy / próximo.
const N_HOY = 28;
function buildRecordatorios() {
  const out = [];
  for (const e of (window.M_ESPERADOS || [])) {
    if (['pagado', 'automatico'].includes(e.estado) || e.vence == null) continue;
    out.push({ id: 'esp-' + e.id, dia: e.vence, label: e.label, monto: e.monto, moneda: e.moneda, tipo: 'esperado', sub: e.categoria });
  }
  for (const t of (window.M_TARJETAS_CFG || [])) {
    out.push({ id: 'tar-' + t.id, dia: t.venceDia, label: `${t.banco} ${t.red}`, monto: null, moneda: 'ARS', tipo: 'tarjeta', sub: `Vence el ${t.venceDia} · ••${t.term}` });
  }
  return out.sort((a, b) => a.dia - b.dia);
}
function estadoVenc(dia) {
  if (dia < N_HOY) return { k: 'vencido', label: 'Vencido', tone: 'danger', line: 'var(--gf-expense)' };
  if (dia === N_HOY) return { k: 'hoy', label: 'Hoy', tone: 'warning', line: 'var(--gf-out)' };
  return { k: 'prox', label: `En ${dia - N_HOY} días`, tone: 'neutral', line: 'var(--gf-gray-300)' };
}
window.contarVencProximos = () => buildRecordatorios().filter((r) => r.dia <= N_HOY).length;

function NotificacionesMobile() {
  const Icon = window.Icon;
  const recs = buildRecordatorios();
  const urgentes = recs.filter((r) => r.dia <= N_HOY);
  const proximos = recs.filter((r) => r.dia > N_HOY);
  const [calSync, setCalSync] = React.useState(true);
  const esAdmin = (window.M_MIEMBRO || {}).rol === 'admin';
  const Toggle = ({ on, onToggle }) => (
    <button onClick={onToggle} aria-pressed={on} style={{
      width: 44, height: 26, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0,
      background: on ? 'var(--gf-ink)' : 'var(--gf-gray-300)', position: 'relative', transition: 'background .15s', padding: 0,
    }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: 'var(--shadow-sm)' }} />
    </button>
  );
  const Row = ({ r, last }) => {
    const st = estadoVenc(r.dia);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: last ? 'none' : '1px solid var(--gf-gray-100)' }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: st.line, flexShrink: 0 }} />
        <span style={{ width: 34, flexShrink: 0, textAlign: 'center' }}>
          <span style={{ display: 'block', fontSize: 17, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{r.dia}</span>
          <span style={{ fontSize: 9, color: 'var(--gf-gray-400)', textTransform: 'uppercase' }}>jun</span>
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name={r.tipo === 'tarjeta' ? 'credit-card' : 'receipt'} size={13} color="var(--gf-gray-400)" />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
          </span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>{r.sub}</span>
        </span>
        <span style={{ textAlign: 'right', flexShrink: 0 }}>
          {r.monto != null && <span style={{ display: 'block', fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{window.GFMoney.ars(r.monto)}</span>}
          <SBadge tone={st.tone}>{st.label}</SBadge>
        </span>
      </div>
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--gf-gray-100)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="calendar-check" size={19} color="var(--gf-ink)" />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>Eventos en Google Calendar</span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-sec)', marginTop: 1 }}>Crea los vencimientos en el calendario de pagos de la familia.</span>
          </span>
          {esAdmin
            ? <Toggle on={calSync} onToggle={() => setCalSync((v) => !v)} />
            : <SBadge tone={calSync ? 'success' : 'neutral'}>{calSync ? 'Activo' : 'Inactivo'}</SBadge>}
        </div>
        {!esAdmin && (
          <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--gf-gray-100)' }}>
            Calendario compartido · lo activa un administrador.
          </div>
        )}
      </SCard>
      {urgentes.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8, padding: '0 2px' }}>Vencidos y de hoy · {urgentes.length}</div>
          <SCard padding="0">{urgentes.map((r, i) => <Row key={r.id} r={r} last={i === urgentes.length - 1} />)}</SCard>
        </div>
      )}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8, padding: '0 2px' }}>Próximos</div>
        {proximos.length === 0
          ? <SCard><span style={{ fontSize: 13, color: 'var(--color-text-sec)' }}>Sin vencimientos próximos.</span></SCard>
          : <SCard padding="0">{proximos.map((r, i) => <Row key={r.id} r={r} last={i === proximos.length - 1} />)}</SCard>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', textAlign: 'center', lineHeight: 1.5 }}>
        Los recordatorios se calculan de tus pagos esperados y tarjetas.<br />Los avisos push (por usuario) llegan cuando instalás la app.
      </div>
      <div style={{ height: 4 }} />
    </div>
  );
}

Object.assign(window, { NotificacionesMobile });
