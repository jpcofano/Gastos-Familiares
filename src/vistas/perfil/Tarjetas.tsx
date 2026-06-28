import { useState } from 'react';
import { Icon } from '../../design-system/Icon';
import { Card, Button } from '../../design-system/components';
import { AddBtn } from './shared';
import { useFamiliaConfig } from '../../hooks/useFamiliaConfig';
import { crearTarjeta, editarTarjeta, eliminarTarjeta, type CamposTarjeta } from '../../datos/configFamilia';
import type { TarjetaItem } from '../../types';

// F9.41 — CRUD real de Tarjetas (catálogo físico, admin-only) — cierra el
// bloque de 6 configs editables (F9.36–F9.41, hallazgo de paridad F9.32).
// cierreDia/venceDia/tipoTarjeta ya existían en el modelo desde F9.35 pero
// solo se mostraban (a propósito, para no romper la consistencia "ninguna
// config edita" — ya resuelta). Cada alta/edición/baja pasa por la callable
// guardarTarjeta — nunca un write directo a config/familia (write:false en
// Rules). useFamiliaConfig es one-shot: recargamos la página tras guardar,
// mismo patrón que Miembros/Categorías/Medios de pago.

const TIPO_LABEL: Record<'credito' | 'debito', string> = { credito: 'Crédito', debito: 'Débito' };
const TIPO_COLOR: Record<'credito' | 'debito', string> = { credito: 'var(--gf-emerald)', debito: 'var(--gf-blue-600)' };

const inputStyle: React.CSSProperties = {
  fontSize: 14, fontFamily: 'var(--font-base)', border: '1px solid var(--gf-gray-200)',
  borderRadius: 8, padding: '7px 10px', width: '100%', boxSizing: 'border-box',
  background: 'var(--color-surface)', color: 'var(--color-text)',
};
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.3px' };

interface Draft {
  banco: string; tipo: string; titular: string; cuentaDebito: string;
  numeroCuenta: string; ultimos4Texto: string; cierreDia: string; venceDia: string;
  tipoTarjeta: '' | 'credito' | 'debito';
}

function draftDesde(t?: TarjetaItem): Draft {
  return {
    banco: t?.banco ?? '', tipo: t?.tipo ?? '', titular: t?.titular ?? '', cuentaDebito: t?.cuentaDebito ?? '',
    numeroCuenta: t?.numeroCuenta ?? '', ultimos4Texto: (t?.ultimos4 ?? []).join(', '),
    cierreDia: t?.cierreDia != null ? String(t.cierreDia) : '', venceDia: t?.venceDia != null ? String(t.venceDia) : '',
    tipoTarjeta: t?.tipoTarjeta ?? '',
  };
}

function draftACampos(d: Draft): CamposTarjeta | null {
  const ultimos4 = d.ultimos4Texto.split(',').map(s => s.trim()).filter(Boolean);
  if (ultimos4.some(u => !/^\d{4}$/.test(u))) return null;
  const cierreDia = d.cierreDia.trim() ? Number(d.cierreDia) : undefined;
  const venceDia  = d.venceDia.trim()  ? Number(d.venceDia)  : undefined;
  if (cierreDia != null && (!Number.isInteger(cierreDia) || cierreDia < 1 || cierreDia > 31)) return null;
  if (venceDia != null && (!Number.isInteger(venceDia) || venceDia < 1 || venceDia > 31)) return null;
  return {
    banco: d.banco.trim(), tipo: d.tipo.trim(), titular: d.titular.trim(), cuentaDebito: d.cuentaDebito.trim(),
    numeroCuenta: d.numeroCuenta.trim() || undefined,
    ultimos4: ultimos4.length > 0 ? ultimos4 : undefined,
    cierreDia, venceDia,
    tipoTarjeta: d.tipoTarjeta || undefined,
  };
}

function TarjetaForm({ draft, onChange, onGuardar, onCancelar, guardando, error }: {
  draft: Draft; onChange: (d: Draft) => void; onGuardar: () => void; onCancelar: () => void;
  guardando: boolean; error: string | null;
}) {
  return (
    <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--gf-gray-50)' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <span style={labelStyle}>Banco</span>
          <input value={draft.banco} onChange={e => onChange({ ...draft, banco: e.target.value })} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <span style={labelStyle}>Tipo / red</span>
          <input value={draft.tipo} onChange={e => onChange({ ...draft, tipo: e.target.value })} placeholder="Visa, Mastercard…" style={inputStyle} />
        </div>
      </div>
      <div>
        <span style={labelStyle}>Titular</span>
        <input value={draft.titular} onChange={e => onChange({ ...draft, titular: e.target.value })} style={inputStyle} />
      </div>
      <div>
        <span style={labelStyle}>Cuenta de débito</span>
        <input value={draft.cuentaDebito} onChange={e => onChange({ ...draft, cuentaDebito: e.target.value })} placeholder="C.A. 0000000000" style={inputStyle} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <span style={labelStyle}>N° de cuenta (resúmenes)</span>
          <input value={draft.numeroCuenta} onChange={e => onChange({ ...draft, numeroCuenta: e.target.value })} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <span style={labelStyle}>Últimos 4 (coma)</span>
          <input value={draft.ultimos4Texto} onChange={e => onChange({ ...draft, ultimos4Texto: e.target.value })} placeholder="1234, 5678" style={inputStyle} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <span style={labelStyle}>Cierre (día)</span>
          <input type="number" min={1} max={31} value={draft.cierreDia} onChange={e => onChange({ ...draft, cierreDia: e.target.value })} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <span style={labelStyle}>Vence (día)</span>
          <input type="number" min={1} max={31} value={draft.venceDia} onChange={e => onChange({ ...draft, venceDia: e.target.value })} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <span style={labelStyle}>Tipo</span>
          <select value={draft.tipoTarjeta} onChange={e => onChange({ ...draft, tipoTarjeta: e.target.value as Draft['tipoTarjeta'] })} style={inputStyle}>
            <option value="">—</option>
            <option value="credito">Crédito</option>
            <option value="debito">Débito</option>
          </select>
        </div>
      </div>
      {error && <p style={{ fontSize: 12, color: 'var(--gf-err-text)', margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" size="sm" onClick={onCancelar} disabled={guardando}>Cancelar</Button>
        <Button variant="primary" size="sm" onClick={onGuardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
      </div>
    </div>
  );
}

export default function Tarjetas() {
  const { config, cargando } = useFamiliaConfig();
  const [abierto, setAbierto] = useState<string | 'nueva' | null>(null);
  const [draft, setDraft] = useState<Draft>(draftDesde());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tarjetas = config?.tarjetas ?? [];

  if (cargando) return <p style={{ color: 'var(--color-text-sec)' }}>Cargando…</p>;

  function abrirEditar(t: TarjetaItem) {
    setAbierto(t.codigo);
    setDraft(draftDesde(t));
    setError(null);
  }

  function abrirNueva() {
    setAbierto('nueva');
    setDraft(draftDesde());
    setError(null);
  }

  async function guardar() {
    const campos = draftACampos(draft);
    if (!campos) { setError('Revisá los campos: últimos 4 dígitos, día de cierre/vencimiento (1-31).'); return; }
    setGuardando(true);
    setError(null);
    const res = abierto === 'nueva' ? await crearTarjeta(campos) : await editarTarjeta(abierto!, campos);
    setGuardando(false);
    if (!res.ok) { setError(res.error.message); return; }
    window.location.reload();
  }

  async function borrar(codigo: string) {
    if (!confirm('¿Eliminar esta tarjeta del catálogo? Si tiene resúmenes cargados, va a quedar bloqueado.')) return;
    setGuardando(true);
    setError(null);
    const res = await eliminarTarjeta(codigo);
    setGuardando(false);
    if (!res.ok) { alert(res.error.message); return; }
    window.location.reload();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card padding="var(--space-2)">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {tarjetas.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-sec)', padding: '12px 10px' }}>Sin tarjetas configuradas.</p>
          ) : tarjetas.map((t, i) => {
            const ultimos4 = t.ultimos4 ?? [];
            const editando = abierto === t.codigo;
            return (
              <div key={t.codigo} style={{ borderBottom: i < tarjetas.length - 1 || editando ? '1px solid var(--gf-gray-100)' : 'none' }}>
                <button
                  onClick={() => (editando ? setAbierto(null) : abrirEditar(t))}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 10px',
                    background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-base)',
                  }}
                >
                  <span style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--gf-ink)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name="credit-card" size={16} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{t.banco} · {t.tipo}</span>
                      {t.tipoTarjeta && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: '#fff', background: TIPO_COLOR[t.tipoTarjeta],
                          borderRadius: 999, padding: '2px 7px', textTransform: 'uppercase', letterSpacing: '.3px', flexShrink: 0,
                        }}>{TIPO_LABEL[t.tipoTarjeta]}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>
                      {ultimos4.length > 0 ? `•••• ${ultimos4[0]}${ultimos4.length > 1 ? ` (+${ultimos4.length - 1})` : ''} · ` : ''}{t.titular}
                      {' · Cierre día '}{t.cierreDia ?? '—'}{' · Vence día '}{t.venceDia ?? '—'}
                    </div>
                  </div>
                  <Icon name="chevron-down" size={16} color="var(--gf-gray-300)" style={{ transform: editando ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                </button>
                {editando && (
                  <>
                    <TarjetaForm draft={draft} onChange={setDraft} onGuardar={guardar} onCancelar={() => setAbierto(null)} guardando={guardando} error={error} />
                    <div style={{ padding: '0 10px 12px' }}>
                      <Button variant="danger" size="sm" onClick={() => borrar(t.codigo)} disabled={guardando}>Eliminar tarjeta</Button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {abierto === 'nueva' ? (
        <Card padding="0">
          <TarjetaForm draft={draft} onChange={setDraft} onGuardar={guardar} onCancelar={() => setAbierto(null)} guardando={guardando} error={error} />
        </Card>
      ) : (
        <AddBtn onClick={abrirNueva}><Icon name="plus" size={18} /> Agregar tarjeta</AddBtn>
      )}

      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Los resúmenes se ven en <strong>Resumen › Tarjetas</strong>. Marcar una tarjeta como
        débito se bloquea si ya tiene resúmenes con líneas en cuotas cargadas (débito no genera cuotas).
      </p>
    </div>
  );
}
