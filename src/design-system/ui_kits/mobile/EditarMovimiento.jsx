// EditarMovimiento — editar / eliminar un movimiento YA cargado. Solo admin.
// Reusa el scaffold de captura (FullModal/Hero/Drawer/CtaBar) pero PRECARGADO
// con el movimiento. Todos los campos editables: tipo, moneda, descripción, monto,
// fecha, categoría → subcategoría (cascada), persona (dueño) y medio de pago.
// Borrar pide confirmación. Movimientos de tarjeta/cuotas muestran aviso (editarles
// monto/fecha puede descuadrar la conciliación y el split este-mes/deuda-futura).
const { FieldRow: EFR, RadioChip: ERC, Button: EBtn, Money: EMny, Badge: EBadge } =
  window.GastosFamiliaresDesignSystem_d81a5e;

const PERSONA_FAMILIAR = 'Familiar (compartido)';
function _toISO(f) {
  if (!f) return '2026-06-01';
  if (f instanceof Date) { const z = (n) => String(n).padStart(2, '0'); return `${f.getFullYear()}-${z(f.getMonth() + 1)}-${z(f.getDate())}`; }
  return f;
}

function EditarMovimiento({ mov, onClose, onSave, onDelete }) {
  const { FullModal, ModalBar, Hero, Drawer, SectionLabel, CtaBar, Icon } = window;
  const cats = window.M_CATEGORIAS_CFG || [];
  const miembros = window.M_MIEMBROS || [];
  const bancos = (window.M_BANCOS || []).filter((b) => !b.oculto);

  const [tipo, setTipo] = React.useState(mov.tipo || 'Gasto');
  const [moneda, setMoneda] = React.useState(mov.moneda || 'ARS');
  const [desc, setDesc] = React.useState(mov.descripcion || '');
  const [monto, setMonto] = React.useState(String(mov.monto ?? ''));
  const [fecha, setFecha] = React.useState(_toISO(mov.fecha));
  const [cat, setCat] = React.useState(mov.categoria || '');
  const [subcat, setSubcat] = React.useState(mov.subcat || '');
  const [persona, setPersona] = React.useState(mov.persona || '');
  const [medio, setMedio] = React.useState(mov.banco || (bancos[0] && bancos[0].nombre) || '');
  const [confirmDel, setConfirmDel] = React.useState(false);

  const montoNum = Number(monto) || 0;
  const subOpts = ((cats.find((c) => c.nombre === cat) || {}).subcats) || [];
  const esTarjeta = !!mov.esTarjeta;

  // Cascada: si cambia la categoría y la subcat actual ya no aplica, la limpio.
  React.useEffect(() => {
    if (subcat && !subOpts.includes(subcat)) setSubcat('');
  }, [cat]); // eslint-disable-line

  const orig = React.useRef({ tipo: mov.tipo, moneda: mov.moneda, desc: mov.descripcion, monto: String(mov.monto ?? ''), fecha: _toISO(mov.fecha), cat: mov.categoria, subcat: mov.subcat || '', persona: mov.persona || '', medio: mov.banco || '' });
  const dirty = JSON.stringify({ tipo, moneda, desc, monto, fecha, cat, subcat, persona, medio }) !== JSON.stringify(orig.current);

  const personaVal = persona || PERSONA_FAMILIAR;
  const personaOpts = [...miembros.map((m) => m.nombre), PERSONA_FAMILIAR];

  const guardar = () => {
    onSave && onSave({ ...mov, tipo, moneda, descripcion: desc, monto: montoNum, fecha, categoria: cat, subcat, persona, banco: medio });
  };

  return (
    <FullModal>
      <ModalBar title="Editar movimiento" onClose={onClose} />
      <Hero
        eyebrow={tipo === 'Gasto' ? 'Gasto' : 'Ingreso'}
        amount={<EMny value={montoNum} currency={moneda} tipo={tipo} />}
        desc={desc || 'Sin descripción'}
        tags={[moneda, medio, persona || 'Familiar'].filter(Boolean)}
      />
      <Drawer>
        {esTarjeta && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'var(--st-parcial-bg, #fef3c7)', border: '1px solid var(--st-parcial-line, #f59e0b)', borderRadius: 12, padding: '11px 13px', marginTop: 12 }}>
            <Icon name="credit-card" size={16} color="#b45309" style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--color-text-strong)' }}>
              Viene de un <strong>resumen de tarjeta</strong>. Cambiar monto o fecha puede descuadrar la conciliación y el split este-mes / deuda-futura.
            </span>
          </div>
        )}

        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)' }}>Tipo</span>
            <ERC options={['Gasto', 'Ingreso']} value={tipo} onChange={setTipo} name="e-tipo" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)' }}>Moneda</span>
            <ERC options={['ARS', 'USD']} value={moneda} onChange={setMoneda} name="e-moneda" />
          </div>
        </div>

        <SectionLabel>Detalle</SectionLabel>
        <EFR label="Descripción" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ej. Colegio Federico" />
        <EFR label="Monto" value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="0" />
        <EFR label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        <EFR label="Categoría" options={cats.map((c) => c.nombre)} value={cat} onChange={(e) => setCat(e.target.value)} />
        {subOpts.length > 0
          ? <EFR label="Subcategoría" options={['—', ...subOpts]} value={subcat || '—'} onChange={(e) => setSubcat(e.target.value === '—' ? '' : e.target.value)} />
          : <EFR label="Subcategoría" value={subcat} onChange={(e) => setSubcat(e.target.value)} placeholder="Opcional" />}
        <EFR label="Persona" options={personaOpts} value={personaVal} onChange={(e) => setPersona(e.target.value === PERSONA_FAMILIAR ? '' : e.target.value)} />
        <EFR label="Medio de pago" options={bancos.map((b) => b.nombre)} value={medio} onChange={(e) => setMedio(e.target.value)} last />

        <button onClick={() => setConfirmDel(true)} style={{
          width: '100%', marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '12px', borderRadius: 12, border: '1px solid var(--gf-expense)', background: 'transparent',
          color: 'var(--gf-expense)', fontFamily: 'var(--font-base)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
        }}>
          <Icon name="trash-2" size={16} /> Eliminar movimiento
        </button>
        <div style={{ height: 14 }} />
      </Drawer>
      <CtaBar>
        <EBtn variant="primary" size="cta" disabled={!dirty} onClick={guardar}>Guardar cambios</EBtn>
      </CtaBar>

      {confirmDel && (
        <div onClick={() => setConfirmDel(false)} style={{ position: 'absolute', inset: 0, zIndex: 70, background: 'rgba(17,20,24,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 340, background: 'var(--color-surface)', borderRadius: 18, padding: '20px', textAlign: 'center', fontFamily: 'var(--font-base)' }}>
            <span style={{ width: 46, height: 46, borderRadius: '50%', background: 'var(--st-vencido-bg, #fee2e2)', color: 'var(--gf-expense)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <Icon name="trash-2" size={22} />
            </span>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', marginBottom: 6 }}>¿Eliminar este movimiento?</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-sec)', lineHeight: 1.5, marginBottom: 18 }}>
              «{desc || 'Sin descripción'}» por <strong>{window.GFMoney ? window.GFMoney.ars(montoNum) : montoNum}</strong>. No se puede deshacer.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <EBtn variant="secondary" size="cta" style={{ flex: 1 }} onClick={() => setConfirmDel(false)}>Cancelar</EBtn>
              <button onClick={() => { setConfirmDel(false); onDelete && onDelete(mov.id); }} style={{
                flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: 'var(--gf-expense)', color: '#fff',
                fontFamily: 'var(--font-base)', fontSize: 15, fontWeight: 700, cursor: 'pointer',
              }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </FullModal>
  );
}

Object.assign(window, { EditarMovimiento });
