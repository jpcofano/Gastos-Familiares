import { Icon } from '../../design-system/Icon';
import { Card } from '../../design-system/components';
import { AddBtn } from './shared';

// F9.3 — Perfil/Medios de pago, PR visual: maqueta con datos de EJEMPLO
// siguiendo PerfilScreens.jsx (MediosPagoMobile). Sin Firestore —
// config/familia.bancos real es de solo lectura hoy; edición admin
// (callable) es la PR de cableado.

interface MedioEjemplo { id: string; nombre: string; color: string; tipo: string; }

const EXAMPLE_MEDIOS: MedioEjemplo[] = [
  { id: 'bbva',    nombre: 'BBVA',          color: '#072146', tipo: 'Banco' },
  { id: 'galicia', nombre: 'Galicia',       color: '#ff7300', tipo: 'Banco' },
  { id: 'pp',      nombre: 'Personal Pay',  color: '#5b2d8e', tipo: 'Billetera' },
  { id: 'mp',      nombre: 'MercadoPago',   color: '#00a5e6', tipo: 'Billetera' },
  { id: 'efec',    nombre: 'Efectivo',      color: '#16a34a', tipo: 'Efectivo' },
];

export default function MediosPago() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card padding="var(--space-2)">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {EXAMPLE_MEDIOS.map((b, i) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 10px', borderBottom: i < EXAMPLE_MEDIOS.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
              <span style={{ width: 34, height: 34, borderRadius: 9, background: b.color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13, fontWeight: 700 }}>{b.nombre.charAt(0)}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{b.nombre}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>{b.tipo}</div>
              </div>
              <Icon name="chevron-right" size={18} color="var(--gf-gray-300)" />
            </div>
          ))}
        </div>
      </Card>
      <AddBtn><Icon name="plus" size={18} /> Agregar medio de pago</AddBtn>
      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Los medios de pago alimentan el desglose diario por banco del Resumen.
      </p>
    </div>
  );
}
