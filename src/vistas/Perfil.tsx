import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { useItemsEsperados } from '../contexto/ItemsEsperadosContext';
import { useFamiliaConfig } from '../hooks/useFamiliaConfig';
import { cargarTCReciente } from '../datos/tcDiario';
import { mediosVisibles } from '../datos/medios';
import { signOutUsuario } from '../auth';
import { Icon } from '../design-system/Icon';
import { Badge, Button } from '../design-system/components';
import { useTheme, type ThemeMode } from '../datos/theme';
import { useRecordatorios, contarVencProximos } from './perfil/Notificaciones';
import './Perfil.css';

// F9.26 — Perfil, contadores cableados a datos reales: config/familia
// (miembros/categorías/tarjetas), itemsEsperados (real-time), medios.ts
// (F9.23) y /tcDiario (último valor). Identidad (nombre/rol/email) ya era
// real desde F9.2. "Pagos esperados" linkea al ConfigEsperados real (CRUD ya
// funcionando, no se reescribe — decisión explícita, ver docs/CLAUDE.md).
// "Tarjetas" (F9.7) linkea a /perfil/tarjetas: config del catálogo de
// tarjetas físicas — distinto de SeccionTarjetas (resúmenes, en Cargar) y
// del visor /tarjetas (solo lectura).

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 0 8px 4px' }}>{title}</div>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-card)', borderRadius: 12, overflow: 'hidden' }}>{children}</div>
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

// F9.19 — fila propia (div, no <button>) para no anidar el toggle Claro/Oscuro
// dentro del <button> que usa Item para el resto de las filas.
function AparienciaRow({ theme, onChange }: { theme: ThemeMode; onChange: (m: ThemeMode) => void }) {
  return (
    <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', fontFamily: 'var(--font-base)' }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--gf-gray-100)', color: 'var(--color-text-strong)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name="palette" size={18} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>Apariencia</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-sec)' }}>{theme === 'dark' ? 'Tema oscuro' : 'Tema claro'}</span>
      </span>
      <div style={{ display: 'flex', gap: 3, background: 'var(--gf-gray-100)', borderRadius: 999, padding: 3, flexShrink: 0 }}>
        {(['light', 'dark'] as const).map(m => {
          const on = theme === m;
          return (
            <button key={m} onClick={() => onChange(m)} style={{
              padding: '5px 10px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)',
              fontSize: 11, fontWeight: 700, background: on ? 'var(--color-surface)' : 'transparent',
              color: on ? 'var(--color-text)' : 'var(--color-text-sec)', boxShadow: on ? 'var(--shadow-sm)' : 'none',
            }}>{m === 'light' ? 'Claro' : 'Oscuro'}</button>
          );
        })}
      </div>
    </div>
  );
}

export default function Perfil() {
  const { miembro } = useMiembroCtx();
  const esAdmin = miembro.rol === 'admin';
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { config } = useFamiliaConfig();
  const { items } = useItemsEsperados();
  const [tcActual, setTcActual] = useState<number | null>(null);
  const { recordatorios } = useRecordatorios();
  const vencProximos = contarVencProximos(recordatorios);

  useEffect(() => {
    if (esAdmin) cargarTCReciente(1).then(h => setTcActual(h[0]?.tcUsdArs ?? null));
  }, [esAdmin]);

  const miembrosActivos = Object.values(config?.miembros ?? {}).filter(m => m.activo);
  const descMiembros = `${miembrosActivos.length} ${miembrosActivos.length === 1 ? 'persona' : 'personas'} · ${miembrosActivos.filter(m => m.rol === 'admin').length} admin`;
  const itemsActivos = items.filter(i => i.activo).length;
  const descEsperados = `${itemsActivos} ítem${itemsActivos === 1 ? '' : 's'} recurrente${itemsActivos === 1 ? '' : 's'}`;
  const descCategorias = `${config?.categorias.filter(c => c.activo).length ?? 0} categorías`;
  const descMedios = `${mediosVisibles(config?.bancos).length} · bancos y billeteras`;
  const descTarjetas = `${config?.tarjetas.length ?? 0} tarjeta${config?.tarjetas.length === 1 ? '' : 's'} vinculada${config?.tarjetas.length === 1 ? '' : 's'}`;
  const descTC = tcActual != null ? `$ ${tcActual.toLocaleString('es-AR')} / USD` : '—';
  const descNotif = recordatorios.length === 0 ? 'Sin vencimientos próximos' : `${recordatorios.length} próximo${recordatorios.length === 1 ? '' : 's'}`;

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
        <Item icon="user-round" title="Mis datos" desc="Nombre, email, rol" onClick={() => navigate('/perfil/mis-datos')} />
        <Item
          icon="bell" title="Notificaciones" desc={descNotif}
          onClick={() => navigate('/perfil/notificaciones')}
          right={vencProximos > 0 ? (
            <>
              <span style={{ minWidth: 20, height: 20, borderRadius: 999, background: 'var(--gf-out)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{vencProximos}</span>
              <Icon name="chevron-right" size={18} color="var(--gf-gray-300)" />
            </>
          ) : undefined}
        />
        <AparienciaRow theme={theme} onChange={setTheme} />
      </Group>

      {esAdmin && (
        <Group title="Configuración familiar · admin">
          <Item icon="users-round" title="Miembros" desc={descMiembros} onClick={() => navigate('/perfil/miembros')} />
          <Item icon="list-checks" title="Pagos esperados" desc={descEsperados} onClick={() => navigate('/config-esperados')} />
          <Item icon="tags" title="Categorías" desc={descCategorias} onClick={() => navigate('/perfil/categorias')} />
          <Item icon="wallet" title="Medios de pago" desc={descMedios} onClick={() => navigate('/perfil/medios-pago')} />
          <Item icon="credit-card" title="Tarjetas" desc={descTarjetas} onClick={() => navigate('/perfil/tarjetas')} />
          <Item icon="repeat" title="Tipo de cambio" desc={descTC} onClick={() => navigate('/perfil/tc')} last />
        </Group>
      )}

      <Button variant="secondary" size="cta" onClick={() => signOutUsuario()}>
        <Icon name="log-out" size={16} /> Cerrar sesión
      </Button>
      <div style={{ height: 4 }} />
    </div>
  );
}
