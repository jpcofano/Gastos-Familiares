// ComprobanteConfirm — confirm data extracted from an uploaded receipt PDF.
const { Money: Mny, StepIndicator: Steps, FieldRow: FR, Message: Msg, Button: B, StatusBadge: SB } =
  window.GastosFamiliaresDesignSystem_d81a5e;

function ComprobanteConfirm({ onClose, onDone }) {
  const { FullModal, ModalBar, Hero, Drawer, SectionLabel, CtaBar } = window;
  const [cat, setCat] = React.useState('Servicios');
  const [persona, setPersona] = React.useState('Juan');
  const [desc, setDesc] = React.useState('Edenor — factura luz');
  const [confirmado, setConfirmado] = React.useState(false);

  return (
    <FullModal>
      <ModalBar title="Confirmar comprobante" onClose={onClose} />
      <Hero
        eyebrow="Comprobante detectado"
        amount={<Mny value={38900} colored={false} />}
        desc="EDENOR S.A."
        tags={['Servicios', 'Vence 28/06', 'ARS']}
      />
      <Drawer>
        <Steps steps={['Subir', 'Revisar', 'Confirmar']} current={confirmado ? 2 : 1} />

        <SectionLabel>Datos extraídos</SectionLabel>
        <FR label="Descripción" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <FR label="Comercio" value="EDENOR S.A." readOnly />
        <FR label="CUIT" value="30-65511620-2" readOnly />
        <FR label="Vencimiento" value="2026-06-28" readOnly last />

        <SectionLabel>Clasificación</SectionLabel>
        <FR label="Categoría" options={['Servicios', 'Vivienda', 'Supermercado', 'Transporte', 'Salud']} value={cat} onChange={(e) => setCat(e.target.value)} />
        <FR label="Persona" options={['Juan', 'María', 'Sofía']} value={persona} onChange={(e) => setPersona(e.target.value)} last />

        <div style={{ margin: '16px 0' }}>
          {confirmado
            ? <Msg kind="ok" title="Confirmado.">Movimiento registrado y conciliado con el esperado “Edenor — luz”.</Msg>
            : <Msg kind="wait" title="Match propuesto.">Coincide con el ítem esperado <strong>Edenor — luz</strong> de Junio. <SB state="por_confirmar" /></Msg>}
        </div>
      </Drawer>
      <CtaBar>
        {confirmado
          ? <B variant="primary" size="cta" onClick={onDone}>Listo</B>
          : <React.Fragment>
              <B variant="green" size="cta" onClick={() => setConfirmado(true)}>Confirmar movimiento</B>
              <B variant="secondary" size="cta" onClick={onClose}>Descartar</B>
            </React.Fragment>}
      </CtaBar>
    </FullModal>
  );
}

Object.assign(window, { ComprobanteConfirm });
