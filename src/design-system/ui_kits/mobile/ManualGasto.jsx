// ManualGasto — blank manual entry of a movement, ink hero + drawer.
const { FieldRow: FR2, RadioChip: RC, Button: B2, Money: Mny2 } =
  window.GastosFamiliaresDesignSystem_d81a5e;

function ManualGasto({ onClose, onDone }) {
  const { FullModal, ModalBar, Hero, Drawer, SectionLabel, CtaBar } = window;
  const [tipo, setTipo] = React.useState('Gasto');
  const [moneda, setMoneda] = React.useState('ARS');
  const [monto, setMonto] = React.useState('12500');
  const [cat, setCat] = React.useState('Supermercado');
  const [pagado, setPagado] = React.useState(true);

  const montoNum = Number(monto) || 0;

  return (
    <FullModal>
      <ModalBar title="Nuevo movimiento" onClose={onClose} />
      <Hero
        eyebrow={tipo === 'Gasto' ? 'Gasto manual' : 'Ingreso manual'}
        amount={<Mny2 value={montoNum} currency={moneda} tipo={tipo} />}
        desc={cat}
        tags={[moneda, pagado ? 'Pagado' : 'A pagar']}
      />
      <Drawer>
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)' }}>Tipo</span>
            <RC options={['Gasto', 'Ingreso']} value={tipo} onChange={setTipo} name="tipo" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)' }}>Moneda</span>
            <RC options={['ARS', 'USD']} value={moneda} onChange={setMoneda} name="moneda" />
          </div>
        </div>

        <SectionLabel>Detalle</SectionLabel>
        <FR2 label="Descripción" placeholder="Ej. Supermercado Coto" />
        <FR2 label="Monto" value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" />
        <FR2 label="Fecha" value="2026-06-22" readOnly />
        <FR2 label="Categoría" options={['Supermercado', 'Vivienda', 'Servicios', 'Transporte', 'Salud', 'Ocio']} value={cat} onChange={(e) => setCat(e.target.value)} />
        <FR2 label="Persona" options={['Juan', 'María', 'Sofía']} value="María" onChange={() => {}} last />

        <SectionLabel>Estado</SectionLabel>
        <FR2 label="¿Ya pagado?" last>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <span style={{ fontSize: 15, color: 'var(--color-text-sec)', fontWeight: 600 }}>{pagado ? 'Sí' : 'No'}</span>
            <input type="checkbox" checked={pagado} onChange={(e) => setPagado(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--color-accent)', cursor: 'pointer' }} />
          </label>
        </FR2>
        <div style={{ height: 12 }} />
      </Drawer>
      <CtaBar>
        <B2 variant="primary" size="cta" onClick={onDone}>Guardar movimiento</B2>
      </CtaBar>
    </FullModal>
  );
}

Object.assign(window, { ManualGasto });
