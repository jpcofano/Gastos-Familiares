import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { signOutUsuario } from '../auth';
import { Icon } from '../design-system/Icon';
import { Badge, Button } from '../design-system/components';
import './Perfil.css';

// F9.3 — Perfil, PR visual: maqueta siguiendo PerfilMobile.jsx (brief F8.0).
// Identidad (nombre/rol/email) es real — ya estaba en el placeholder de F9.2,
// no es "dato de ejemplo". Los contadores de la lista de Configuración familiar
// ("3 personas · 2 admin", etc.) sí son de ejemplo — no hay hooks de conteo
// todavía. "Pagos esperados" linkea al ConfigEsperados real (CRUD ya
// funcionando, no se reescribe para igualar un mock de solo-lectura — decisión
// explícita, ver docs/CLAUDE.md). "Tarjetas" linkea a /comprobantes: Tarjetas
// vive dentro de Cargar (SeccionTarjetas), no es pantalla propia.

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 0 8px 4px' }}>{title}</div>
      <div style={{ background: '#fff', border: '1px solid var(--color-border-card)', borderRadius: 12, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function Item({ icon, title, desc, right, last, onClick }: { icon: string; title: string; desc?: string; right?: ReactNode; last?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px',
      borderBottom: last ? 'none' : '1px solid var(--gf-gray-100)', background: 'none', border: 'none',
      cursor: onClick ? 'pointer' : 'default', textAlign: 'left', fontFamily: 'var(--font-base)',
    }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--gf-gray-100)', color: 'var(--color-text-strong)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name={icon} size={18} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{title}</span>
        {desc && <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-sec)' }}>{desc}</span>}
      </span>
      {right ?? (onClick && <Icon name="chevron-right" size={18} color="var(--gf-gray-300)" />)}
    </button>
  );
}

export default function Perfil() {
  const { miembro } = useMiembroCtx();
  const esAdmin = miembro.rol === 'admin';
  const navigate = useNavigate();

  return (
    <div className="perfil">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 4px 2px' }}>
        <span style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--gf-ink)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, flexShrink: 0 }}>
          {miembro.nombre.charAt(0)}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{miembro.nombre}</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-sec)' }}>{miembro.emails[0]}</div>
        </div>
        <Badge tone="success">{esAdmin ? 'Admin' : 'Dependiente'}</Badge>
      </div>

      <Group title="Personal">
        <Item icon="user-round" title="Mis datos" desc="Nombre, email, alias" />
        <Item icon="bell" title="Notificaciones" desc="Vencimientos y recordatorios" />
        <Item icon="palette" title="Apariencia" desc="Tema claro" right={<Badge tone="neutral">Pronto: oscuro</Badge>} last />
      </Group>

      {esAdmin && (
        <Group title="Configuración familiar · admin">
          <Item icon="users-round" title="Miembros" desc="3 personas · 2 admin" onClick={() => navigate('/perfil/miembros')} />
          <Item icon="list-checks" title="Pagos esperados" desc="9 ítems recurrentes" onClick={() => navigate('/config-esperados')} />
          <Item icon="tags" title="Categorías" desc="8 categorías" onClick={() => navigate('/perfil/categorias')} />
          <Item icon="wallet" title="Medios de pago" desc="5 · bancos, billeteras, efectivo" onClick={() => navigate('/perfil/medios-pago')} />
          <Item icon="credit-card" title="Tarjetas" desc="vive en Cargar" onClick={() => navigate('/comprobantes')} />
          <Item icon="repeat" title="Tipo de cambio" desc="Manual · $ 1.180 / USD" onClick={() => navigate('/perfil/tc')} last />
        </Group>
      )}

      <Button variant="secondary" size="cta" onClick={() => signOutUsuario()}>
        <Icon name="log-out" size={16} /> Cerrar sesión
      </Button>
      <div style={{ height: 4 }} />
    </div>
  );
}
