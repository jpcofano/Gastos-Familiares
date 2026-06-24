import { Icon } from '../../design-system/Icon';
import { Card, Badge } from '../../design-system/components';
import { AddBtn, Avatar } from './shared';

// F9.3 — Perfil/Miembros, PR visual: maqueta con datos de EJEMPLO siguiendo
// PerfilScreens.jsx (MiembrosMobile). Sin Firestore — gestión real de
// config/familia.miembros + /autorizados (callable, F8.0) es la PR de cableado.

interface MiembroEjemplo { id: string; nombre: string; email: string; rol: 'admin' | 'dependiente'; color: string; }

const EXAMPLE_MIEMBROS: MiembroEjemplo[] = [
  { id: 'maria', nombre: 'María', email: 'maria@familia.app', rol: 'admin', color: '#065f46' },
  { id: 'juan',  nombre: 'Juan',  email: 'juan@familia.app',  rol: 'admin', color: '#1d4ed8' },
  { id: 'sofia', nombre: 'Sofía', email: 'sofia@familia.app', rol: 'dependiente', color: '#b45309' },
];

export default function Miembros() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card padding="var(--space-2)">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {EXAMPLE_MIEMBROS.map((m, i) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 10px', borderBottom: i < EXAMPLE_MIEMBROS.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
              <Avatar nombre={m.nombre} color={m.color} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{m.nombre}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-sec)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</div>
              </div>
              <Badge tone={m.rol === 'admin' ? 'success' : 'neutral'}>{m.rol === 'admin' ? 'Admin' : 'Dependiente'}</Badge>
            </div>
          ))}
        </div>
      </Card>
      <AddBtn><Icon name="plus" size={18} /> Invitar miembro</AddBtn>
      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Los <strong>admin</strong> gestionan miembros, esperados y categorías. Los <strong>dependientes</strong> solo cargan y ven sus movimientos.
      </p>
    </div>
  );
}
