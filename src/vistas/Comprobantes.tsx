import { useState } from 'react';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { Icon } from '../design-system/Icon';
import { Message, Button, Badge, Money, StepIndicator, FieldRow, RadioChip } from '../design-system/components';
import { FullModal, ModalBar, Hero, Drawer, SectionLabel, CtaBar } from '../design-system/shell';
import { SeccionTarjetas } from './ResumenesTarjeta';
import './Comprobantes.css';

// F9.3 — Cargar, PR visual: maqueta con datos de EJEMPLO siguiendo CargaMobile.jsx
// + los modales ComprobanteConfirm.jsx / ManualGasto.jsx del kit. NO toca Firestore
// ni Storage ni Functions — el dropzone no sube nada real, los modales no llaman
// subirEntrante/cargarMovimientoDesdeComprobante/crearMovimiento. Eso es la PR de
// cableado siguiente (la lógica real ya existe en datos/entrantes.ts, datos/
// comprobantes.ts y AltaMovimiento.tsx — queda desconectada de esta pantalla hasta
// esa PR, no se borró). Tarjetas (SeccionTarjetas, real) sigue viviendo acá abajo,
// admin-only, como antes de F9.3 — Carga sigue siendo la solapa unificada de
// comprobantes + resúmenes de tarjeta (decisión F6.7 addendum 1, no se reabre).

type EstadoEntrante = 'ok' | 'wait' | 'warn' | 'err';

interface EntranteEjemplo { id: string; nombre: string; tipo: string; estado: EstadoEntrante; detalle: string; }

const EXAMPLE_ENTRANTES: EntranteEjemplo[] = [
  { id: 'e1', nombre: 'Edenor_factura_06.pdf',   tipo: 'Comprobante',    estado: 'wait', detalle: 'Extrayendo datos…' },
  { id: 'e2', nombre: 'Resumen_Visa_junio.pdf',  tipo: 'Resumen tarjeta', estado: 'ok',   detalle: 'Conciliado · 14 consumos' },
  { id: 'e3', nombre: 'Aysa_factura.pdf',        tipo: 'Comprobante',    estado: 'warn', detalle: 'Falta categoría' },
];

const ICON_POR_ESTADO: Record<EstadoEntrante, string> = { ok: 'check-check', wait: 'loader', warn: 'triangle-alert', err: 'circle-x' };
const COLOR_POR_ESTADO: Record<EstadoEntrante, string> = { ok: 'var(--gf-ok-text)', wait: 'var(--gf-wait-text)', warn: 'var(--gf-warn-text)', err: 'var(--gf-err-text)' };

// ── Modal: Confirmar comprobante ─────────────────────────────────────────────

function ComprobanteConfirmModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [cat, setCat] = useState('Servicios');
  const [persona, setPersona] = useState('Juan');
  const [desc, setDesc] = useState('Edenor — factura luz');
  const [confirmado, setConfirmado] = useState(false);

  return (
    <FullModal>
      <ModalBar title="Confirmar comprobante" onClose={onClose} />
      <Hero
        eyebrow="Comprobante detectado"
        amount={<Money value={38900} colored={false} />}
        desc="EDENOR S.A."
        tags={['Servicios', 'Vence 28/06', 'ARS']}
      />
      <Drawer>
        <StepIndicator steps={['Subir', 'Revisar', 'Confirmar']} current={confirmado ? 2 : 1} />

        <SectionLabel>Datos extraídos</SectionLabel>
        <FieldRow label="Descripción" value={desc} onChange={e => setDesc(e.target.value)} />
        <FieldRow label="Comercio" value="EDENOR S.A." readOnly />
        <FieldRow label="CUIT" value="30-65511620-2" readOnly />
        <FieldRow label="Vencimiento" value="2026-06-28" readOnly last />

        <SectionLabel>Clasificación</SectionLabel>
        <FieldRow label="Categoría" options={['Servicios', 'Vivienda', 'Supermercado', 'Transporte', 'Salud']} value={cat} onChange={e => setCat(e.target.value)} />
        <FieldRow label="Persona" options={['Juan', 'María', 'Sofía']} value={persona} onChange={e => setPersona(e.target.value)} last />

        <div style={{ margin: '16px 0' }}>
          {confirmado
            ? <Message kind="ok" title="Confirmado.">Movimiento registrado y conciliado con el esperado "Edenor — luz".</Message>
            : <Message kind="wait" title="Match propuesto.">Coincide con el ítem esperado <strong>Edenor — luz</strong> de Junio.</Message>}
        </div>
      </Drawer>
      <CtaBar>
        {confirmado
          ? <Button variant="primary" size="cta" onClick={onDone}>Listo</Button>
          : <>
              <Button variant="green" size="cta" onClick={() => setConfirmado(true)}>Confirmar movimiento</Button>
              <Button variant="secondary" size="cta" onClick={onClose}>Descartar</Button>
            </>}
      </CtaBar>
    </FullModal>
  );
}

// ── Modal: Alta manual ────────────────────────────────────────────────────────

function ManualGastoModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [tipo, setTipo] = useState<'Gasto' | 'Ingreso'>('Gasto');
  const [moneda, setMoneda] = useState<'ARS' | 'USD'>('ARS');
  const [monto, setMonto] = useState('12500');
  const [cat, setCat] = useState('Supermercado');
  const [pagado, setPagado] = useState(true);
  const montoNum = Number(monto) || 0;

  return (
    <FullModal>
      <ModalBar title="Nuevo movimiento" onClose={onClose} />
      <Hero
        eyebrow={tipo === 'Gasto' ? 'Gasto manual' : 'Ingreso manual'}
        amount={<Money value={montoNum} currency={moneda} tipo={tipo} />}
        desc={cat}
        tags={[moneda, pagado ? 'Pagado' : 'A pagar']}
      />
      <Drawer>
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)' }}>Tipo</span>
            <RadioChip options={['Gasto', 'Ingreso']} value={tipo} onChange={v => setTipo(v as 'Gasto' | 'Ingreso')} name="tipo" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)' }}>Moneda</span>
            <RadioChip options={['ARS', 'USD']} value={moneda} onChange={v => setMoneda(v as 'ARS' | 'USD')} name="moneda" />
          </div>
        </div>

        <SectionLabel>Detalle</SectionLabel>
        <FieldRow label="Descripción" placeholder="Ej. Supermercado Coto" />
        <FieldRow label="Monto" value={monto} onChange={e => setMonto(e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" />
        <FieldRow label="Fecha" value="2026-06-22" readOnly />
        <FieldRow label="Categoría" options={['Supermercado', 'Vivienda', 'Servicios', 'Transporte', 'Salud', 'Ocio']} value={cat} onChange={e => setCat(e.target.value)} />
        <FieldRow label="Persona" options={['Juan', 'María', 'Sofía']} value="María" onChange={() => {}} last />

        <SectionLabel>Estado</SectionLabel>
        <FieldRow label="¿Ya pagado?" last>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <span style={{ fontSize: 15, color: 'var(--color-text-sec)', fontWeight: 600 }}>{pagado ? 'Sí' : 'No'}</span>
            <input type="checkbox" checked={pagado} onChange={e => setPagado(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--color-accent)', cursor: 'pointer' }} />
          </label>
        </FieldRow>
        <div style={{ height: 12 }} />
      </Drawer>
      <CtaBar>
        <Button variant="primary" size="cta" onClick={onDone}>Guardar movimiento</Button>
      </CtaBar>
    </FullModal>
  );
}

// ── Vista principal ───────────────────────────────────────────────────────────

function EntranteRow({ it, onClick }: { it: EntranteEjemplo; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
      background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-base)',
    }}>
      <span style={{ color: COLOR_POR_ESTADO[it.estado], flexShrink: 0, display: 'inline-flex' }}>
        <Icon name={ICON_POR_ESTADO[it.estado]} size={20} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.nombre}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-sec)' }}>{it.tipo} · {it.detalle}</span>
      </span>
      <Icon name="chevron-right" size={18} color="var(--gf-gray-300)" />
    </button>
  );
}

export default function Comprobantes() {
  const { miembro } = useMiembroCtx();
  const esAdmin = miembro.rol === 'admin';
  const [modal, setModal] = useState<'comprobante' | 'manual' | null>(null);

  return (
    <div className="cmp">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <button onClick={() => setModal('comprobante')} style={{
          border: '2px dashed var(--gf-gray-300)', borderRadius: 'var(--radius-2xl)', background: '#fff',
          padding: '30px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          cursor: 'pointer', fontFamily: 'var(--font-base)', width: '100%',
        }}>
          <span style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--gf-emerald-50)', color: 'var(--color-accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="file-up" size={24} />
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>Subir comprobante o resumen</span>
          <span style={{ fontSize: 13, color: 'var(--color-text-sec)', textAlign: 'center' }}>PDF o foto. Extraemos monto, comercio y fecha automáticamente.</span>
          <span style={{ marginTop: 4, display: 'inline-flex', gap: 8 }}>
            <Badge tone="neutral">PDF</Badge><Badge tone="neutral">JPG</Badge><Badge tone="neutral">Compartir ↗</Badge>
          </span>
        </button>

        <Message kind="wait" title="1 procesando.">Edenor_factura_06.pdf — extrayendo datos.</Message>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Entrantes recientes</div>
          <div style={{ background: '#fff', border: '1px solid var(--color-border-card)', borderRadius: 12, overflow: 'hidden' }}>
            {EXAMPLE_ENTRANTES.map((it, idx) => (
              <div key={it.id} style={{ borderBottom: idx < EXAMPLE_ENTRANTES.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
                <EntranteRow it={it} onClick={() => setModal('comprobante')} />
              </div>
            ))}
          </div>
        </div>

        <Button variant="secondary" size="cta" onClick={() => setModal('manual')}>Cargar manualmente</Button>
        <div style={{ height: 4 }} />

        {esAdmin && <SeccionTarjetas />}
      </div>

      {modal === 'comprobante' && <ComprobanteConfirmModal onClose={() => setModal(null)} onDone={() => setModal(null)} />}
      {modal === 'manual' && <ManualGastoModal onClose={() => setModal(null)} onDone={() => setModal(null)} />}
    </div>
  );
}
