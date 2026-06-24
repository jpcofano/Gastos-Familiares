import { Icon } from '../../design-system/Icon';
import { Card, Money } from '../../design-system/components';
import { AddBtn } from './shared';

// F9.3 — Perfil/Categorías, PR visual: maqueta con datos de EJEMPLO siguiendo
// PerfilScreens.jsx (CategoriasMobile). Sin Firestore — config/familia.categorias
// real es de solo lectura hoy; edición admin (callable) es la PR de cableado.

interface CategoriaEjemplo { id: string; nombre: string; color: string; mov: number; gasto: number; }

const EXAMPLE_CATEGORIAS: CategoriaEjemplo[] = [
  { id: 'viv', nombre: 'Vivienda',      color: '#065f46', mov: 2, gasto: 554200 },
  { id: 'ser', nombre: 'Servicios',     color: '#0284c7', mov: 1, gasto: 38900 },
  { id: 'sup', nombre: 'Supermercado',  color: '#d97706', mov: 2, gasto: 152570 },
  { id: 'tra', nombre: 'Transporte',    color: '#7c3aed', mov: 1, gasto: 52300 },
  { id: 'sal', nombre: 'Salud',         color: '#dc2626', mov: 1, gasto: 24600 },
  { id: 'edu', nombre: 'Educación',     color: '#0891b2', mov: 1, gasto: 186000 },
  { id: 'oci', nombre: 'Ocio',          color: '#db2777', mov: 1, gasto: 71400 },
  { id: 'ing', nombre: 'Ingresos',      color: '#16a34a', mov: 2, gasto: 0 },
];

export default function Categorias() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card padding="var(--space-2)">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {EXAMPLE_CATEGORIAS.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 10px', borderBottom: i < EXAMPLE_CATEGORIAS.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
              <span style={{ width: 14, height: 14, borderRadius: 5, background: c.color, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{c.nombre}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>{c.mov} {c.mov === 1 ? 'movimiento' : 'movimientos'} este mes</div>
              </div>
              {c.gasto > 0 && <Money value={c.gasto} colored={false} style={{ fontSize: 13 }} />}
              <Icon name="chevron-right" size={18} color="var(--gf-gray-300)" />
            </div>
          ))}
        </div>
      </Card>
      <AddBtn><Icon name="plus" size={18} /> Agregar categoría</AddBtn>
    </div>
  );
}
