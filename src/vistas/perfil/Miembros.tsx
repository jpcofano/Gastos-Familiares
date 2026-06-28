import { useState } from 'react';
import { Icon } from '../../design-system/Icon';
import { Card, Badge, Button } from '../../design-system/components';
import { AddBtn, Avatar } from './shared';
import { useFamiliaConfig } from '../../hooks/useFamiliaConfig';
import { colorHash } from '../../datos/agregados';
import { crearMiembro, editarMiembro, desactivarMiembro, reactivarMiembro } from '../../datos/configFamilia';
import type { FamiliaMiembro } from '../../types';

// F9.37 — CRUD real de Miembros (admin-only, sensible: toca roles/permisos).
// Cada alta/edición/baja pasa por guardarMiembro (callable), que sincroniza
// miembros[] Y /autorizados en la misma transacción (ver docs/CLAUDE.md —
// desincronizarlos rompe el login o reabre escalada de privilegios). Acá no
// se hace ningún write directo a Firestore.
// MiembroContext/useFamiliaConfig son one-shot — recargamos la página después
// de guardar (mismo patrón que Mis datos) en vez de inventar un refresh manual.

interface Draft { nombre: string; emailsTexto: string; rol: 'admin' | 'dependiente'; }

function draftDesde(m?: FamiliaMiembro): Draft {
  return { nombre: m?.nombre ?? '', emailsTexto: m?.emails.join(', ') ?? '', rol: m?.rol ?? 'dependiente' };
}

const inputStyle: React.CSSProperties = {
  fontSize: 15, fontFamily: 'var(--font-base)', border: '1px solid var(--gf-gray-200)',
  borderRadius: 8, padding: '8px 11px', width: '100%', boxSizing: 'border-box',
  background: 'var(--color-surface)', color: 'var(--color-text)',
};

function MiembroForm({ draft, onChange, onGuardar, onCancelar, guardando, error }: {
  draft: Draft; onChange: (d: Draft) => void; onGuardar: () => void; onCancelar: () => void;
  guardando: boolean; error: string | null;
}) {
  return (
    <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--gf-gray-50)' }}>
      <input value={draft.nombre} onChange={e => onChange({ ...draft, nombre: e.target.value })} placeholder="Nombre" style={inputStyle} />
      <input value={draft.emailsTexto} onChange={e => onChange({ ...draft, emailsTexto: e.target.value })} placeholder="Emails separados por coma" style={inputStyle} />
      <select value={draft.rol} onChange={e => onChange({ ...draft, rol: e.target.value as Draft['rol'] })} style={inputStyle}>
        <option value="dependiente">Dependiente</option>
        <option value="admin">Admin</option>
      </select>
      {error && <p style={{ fontSize: 12, color: 'var(--gf-err-text)', margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" size="sm" onClick={onCancelar} disabled={guardando}>Cancelar</Button>
        <Button variant="primary" size="sm" onClick={onGuardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
      </div>
    </div>
  );
}

export default function Miembros() {
  const { config, cargando } = useFamiliaConfig();
  const [abierto, setAbierto] = useState<string | 'nuevo' | null>(null);
  const [draft, setDraft] = useState<Draft>(draftDesde());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verInactivos, setVerInactivos] = useState(false);
  const [accionando, setAccionando] = useState<string | null>(null);

  const todos = Object.entries(config?.miembros ?? {});
  const activos = todos.filter(([, m]) => m.activo);
  const inactivos = todos.filter(([, m]) => !m.activo);

  if (cargando) return <p style={{ color: 'var(--color-text-sec)' }}>Cargando…</p>;

  function abrirEditar(id: string, m: FamiliaMiembro) {
    setAbierto(id);
    setDraft(draftDesde(m));
    setError(null);
  }

  function abrirNuevo() {
    setAbierto('nuevo');
    setDraft(draftDesde());
    setError(null);
  }

  async function guardar() {
    const nombre = draft.nombre.trim();
    const emails = draft.emailsTexto.split(',').map(e => e.trim()).filter(Boolean);
    if (!nombre) { setError('El nombre es obligatorio.'); return; }
    if (emails.length === 0) { setError('Al menos un email es obligatorio.'); return; }

    setGuardando(true);
    setError(null);
    const res = abierto === 'nuevo'
      ? await crearMiembro(nombre, emails, draft.rol)
      : await editarMiembro(abierto!, nombre, emails, draft.rol);
    setGuardando(false);
    if (!res.ok) { setError(res.error.message); return; }
    window.location.reload();
  }

  async function desactivar(id: string) {
    if (!confirm('¿Desactivar este miembro? Pierde acceso a la app; sus movimientos históricos quedan intactos.')) return;
    setAccionando(id);
    const res = await desactivarMiembro(id);
    setAccionando(null);
    if (!res.ok) { alert(res.error.message); return; }
    window.location.reload();
  }

  async function reactivar(id: string) {
    setAccionando(id);
    const res = await reactivarMiembro(id);
    setAccionando(null);
    if (!res.ok) { alert(res.error.message); return; }
    window.location.reload();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card padding="var(--space-2)">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {activos.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-sec)', padding: '12px 10px' }}>Sin miembros activos.</p>
          ) : activos.map(([id, m], i) => (
            <div key={id} style={{ borderBottom: i < activos.length - 1 || abierto === id ? '1px solid var(--gf-gray-100)' : 'none' }}>
              <button
                onClick={() => (abierto === id ? setAbierto(null) : abrirEditar(id, m))}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 10px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-base)' }}
              >
                <Avatar nombre={m.nombre} color={colorHash(m.nombre)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{m.nombre}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-sec)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.emails[0] ?? '—'}</div>
                </div>
                <Badge tone={m.rol === 'admin' ? 'success' : 'neutral'}>{m.rol === 'admin' ? 'Admin' : 'Dependiente'}</Badge>
                <Icon name="chevron-down" size={16} color="var(--gf-gray-300)" style={{ transform: abierto === id ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
              </button>
              {abierto === id && (
                <>
                  <MiembroForm draft={draft} onChange={setDraft} onGuardar={guardar} onCancelar={() => setAbierto(null)} guardando={guardando} error={error} />
                  <div style={{ padding: '0 10px 12px' }}>
                    <Button variant="danger" size="sm" onClick={() => desactivar(id)} disabled={accionando === id}>
                      {accionando === id ? 'Desactivando…' : 'Desactivar miembro'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </Card>

      {abierto === 'nuevo' ? (
        <Card padding="0">
          <MiembroForm draft={draft} onChange={setDraft} onGuardar={guardar} onCancelar={() => setAbierto(null)} guardando={guardando} error={error} />
        </Card>
      ) : (
        <AddBtn onClick={abrirNuevo}><Icon name="plus" size={18} /> Invitar miembro</AddBtn>
      )}

      {inactivos.length > 0 && (
        <div>
          <button
            onClick={() => setVerInactivos(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 12, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', padding: 0 }}
          >
            {verInactivos ? '▾' : '▸'} Inactivos ({inactivos.length})
          </button>
          {verInactivos && (
            <Card padding="var(--space-2)" style={{ marginTop: 8 }}>
              {inactivos.map(([id, m], i) => (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px', borderBottom: i < inactivos.length - 1 ? '1px solid var(--gf-gray-100)' : 'none', opacity: 0.6 }}>
                  <Avatar nombre={m.nombre} color={colorHash(m.nombre)} />
                  <div style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{m.nombre}</div>
                  <Button variant="secondary" size="sm" onClick={() => reactivar(id)} disabled={accionando === id}>
                    {accionando === id ? 'Reactivando…' : 'Reactivar'}
                  </Button>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Los <strong>admin</strong> gestionan miembros, esperados y categorías. Los <strong>dependientes</strong> solo cargan y ven sus movimientos.
      </p>
    </div>
  );
}
