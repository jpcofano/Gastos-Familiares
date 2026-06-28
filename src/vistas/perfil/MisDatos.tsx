import { useState } from 'react';
import { useMiembroCtx } from '../../contexto/MiembroContext';
import { Card, Button, Badge } from '../../design-system/components';
import { actualizarMiPerfil } from '../../datos/configFamilia';

// F9.36 — segundo CRUD real: cada miembro edita SU PROPIO nombre visible
// (dependiente edita lo suyo, no necesita ser admin — la callable
// actualizarMiPerfil solo toca miembros.{memberId propio}). Email es de
// solo lectura: es la identidad de login atada a /autorizados, cambiarla es
// un flujo de seguridad aparte. Apariencia/tema ya se edita desde Perfil
// directamente (AparienciaRow) — no se duplica acá.

const inputStyle: React.CSSProperties = {
  fontSize: 16, fontFamily: 'var(--font-base)', border: '1px solid var(--gf-gray-200)',
  borderRadius: 8, padding: '9px 12px', width: '100%', boxSizing: 'border-box',
  background: 'var(--color-surface)', color: 'var(--color-text)',
};

export default function MisDatos() {
  const { miembro } = useMiembroCtx();
  const [nombre, setNombre] = useState(miembro.nombre);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const dirty = nombre.trim() !== miembro.nombre && nombre.trim().length > 0;

  async function guardar() {
    setGuardando(true);
    setError(null);
    const res = await actualizarMiPerfil(nombre.trim());
    setGuardando(false);
    if (!res.ok) { setError(res.error.message); return; }
    setOk(true);
    // MiembroContext es one-shot (se resuelve al loguearse) — recargar para
    // que el nombre nuevo se vea en el header y el resto de la app.
    setTimeout(() => window.location.reload(), 800);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card padding="var(--space-3)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', marginBottom: 6 }}>Nombre visible</label>
            <input value={nombre} onChange={e => setNombre(e.target.value)} maxLength={60} style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', marginBottom: 6 }}>Email</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontSize: 14, color: 'var(--color-text-sec)' }}>{miembro.emails[0] ?? '—'}</span>
              <Badge tone="neutral">Solo lectura</Badge>
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', marginBottom: 6 }}>Rol</label>
            <Badge tone="success">{miembro.rol === 'admin' ? 'Admin' : 'Dependiente'}</Badge>
          </div>
        </div>
      </Card>

      {error && <p style={{ fontSize: 13, color: 'var(--gf-err-text)', margin: '0 4px' }}>{error}</p>}
      {ok && <p style={{ fontSize: 13, color: 'var(--gf-ok-text)', margin: '0 4px' }}>Guardado — actualizando…</p>}

      {dirty && !ok && (
        <Button variant="primary" size="cta" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </Button>
      )}
    </div>
  );
}
