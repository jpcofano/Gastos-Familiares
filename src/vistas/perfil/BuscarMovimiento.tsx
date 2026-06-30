import { useState, useMemo } from 'react';
import { useFamiliaConfig } from '../../hooks/useFamiliaConfig';
import { useMovimientosDelMes } from '../../hooks/useMovimientosDelMes';
import { fmtMoney } from '../../datos/money';
import { Icon } from '../../design-system/Icon';
import EditarMovimiento from '../EditarMovimiento';
import type { Movement } from '../../types';

// F9.53 — Buscador de movimientos (admin-only, bajo Configuración familiar).
// Carga movimientos del período seleccionado vía onSnapshot (live). Filtra
// client-side por texto (descripcion/categoria/subcategoria) y por persona.
// Tap en fila → abre EditarMovimiento (mismo componente que en Dashboard/Resumen).

function mesActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function desplazarMes(mes: string, delta: number): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
function formatMes(mes: string): string {
  const [y, m] = mes.split('-');
  return `${MESES_LARGO[Number(m) - 1]} ${y}`;
}

function fmtFecha(d: Date): string {
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

function normalizarTexto(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export default function BuscarMovimiento() {
  const { config } = useFamiliaConfig();
  const [mes, setMes] = useState(mesActual);
  const [busqueda, setBusqueda] = useState('');
  const [personaFiltro, setPersonaFiltro] = useState<string>('');
  const [editando, setEditando] = useState<Movement | null>(null);

  const { movimientos, cargando, error } = useMovimientosDelMes(mes);

  const miembrosActivos = useMemo(
    () => config ? Object.entries(config.miembros).filter(([, m]) => m.activo).map(([id, m]) => ({ id, nombre: m.nombre })) : [],
    [config],
  );

  const nombrePersona = (id: string | null) => {
    if (!id) return 'Familiar';
    return config?.miembros[id]?.nombre ?? id;
  };

  const movsFiltrados = useMemo(() => {
    let lista = [...movimientos].sort((a, b) => b.fecha.getTime() - a.fecha.getTime());

    if (personaFiltro) {
      lista = lista.filter(m => m.persona === personaFiltro || (personaFiltro === '__familiar__' && !m.persona));
    }

    if (busqueda.trim()) {
      const norm = normalizarTexto(busqueda.trim());
      lista = lista.filter(m => {
        const campos = [m.descripcion, m.categoria, m.subcategoria, m.banco, nombrePersona(m.persona)].filter(Boolean).join(' ');
        return normalizarTexto(campos).includes(norm);
      });
    }

    return lista;
  }, [movimientos, busqueda, personaFiltro]);

  if (editando) {
    return (
      <EditarMovimiento
        movimiento={editando}
        onGuardado={() => setEditando(null)}
        onEliminado={() => setEditando(null)}
        onCancelar={() => setEditando(null)}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
      {/* Selector de período */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'var(--gf-gray-100)', borderRadius: 12, padding: '8px 12px' }}>
        <button
          onClick={() => setMes(m => desplazarMes(m, -1))}
          aria-label="Mes anterior"
          style={{ width: 28, height: 28, borderRadius: 999, border: 'none', background: 'var(--color-surface)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >‹</button>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{formatMes(mes)}</span>
        <button
          onClick={() => setMes(m => desplazarMes(m, 1))}
          aria-label="Mes siguiente"
          style={{ width: 28, height: 28, borderRadius: 999, border: 'none', background: 'var(--color-surface)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >›</button>
      </div>

      {/* Campo de búsqueda */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--color-surface)', border: '1px solid var(--color-border-card)', borderRadius: 10, padding: '8px 12px' }}>
        <Icon name="search" size={16} color="var(--gf-gray-400)" />
        <input
          type="text"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por descripción, categoría, banco…"
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, fontFamily: 'var(--font-base)', color: 'var(--color-text)' }}
        />
        {busqueda && (
          <button onClick={() => setBusqueda('')} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2 }}>
            <Icon name="x" size={14} color="var(--gf-gray-400)" />
          </button>
        )}
      </div>

      {/* Chips de persona */}
      {miembrosActivos.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[{ id: '', nombre: 'Todos' }, { id: '__familiar__', nombre: 'Familiar' }, ...miembrosActivos].map(p => {
            const activo = personaFiltro === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setPersonaFiltro(activo ? '' : p.id)}
                style={{
                  padding: '4px 10px', borderRadius: 999, border: '1px solid var(--color-border-card)',
                  background: activo ? 'var(--gf-ink)' : 'var(--color-surface)',
                  color: activo ? '#fff' : 'var(--color-text)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-base)',
                }}
              >{p.nombre}</button>
            );
          })}
        </div>
      )}

      {/* Lista de resultados */}
      {cargando ? (
        <p style={{ textAlign: 'center', color: 'var(--color-text-sec)', padding: '20px 0' }}>Cargando…</p>
      ) : error ? (
        <p style={{ color: 'var(--gf-err-text)', fontSize: 13 }}>Error: {error}</p>
      ) : movsFiltrados.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--color-text-sec)', padding: '20px 0', fontSize: 14 }}>
          {busqueda || personaFiltro ? 'Sin resultados para ese filtro.' : 'Sin movimientos en este período.'}
        </p>
      ) : (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-card)', borderRadius: 12, overflow: 'hidden' }}>
          {movsFiltrados.map((mov, i) => (
            <MovimientoFila
              key={mov.id}
              mov={mov}
              nombrePersona={nombrePersona(mov.persona)}
              last={i === movsFiltrados.length - 1}
              onClick={() => setEditando(mov)}
            />
          ))}
        </div>
      )}

      {movsFiltrados.length > 0 && (
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--gf-gray-400)', margin: 0 }}>
          {movsFiltrados.length} movimiento{movsFiltrados.length !== 1 ? 's' : ''}
          {busqueda || personaFiltro ? ' (filtrado' + (movimientos.length !== movsFiltrados.length ? `, de ${movimientos.length}` : '') + ')' : ''}
        </p>
      )}
    </div>
  );
}

function MovimientoFila({ mov, nombrePersona, last, onClick }: { mov: Movement; nombrePersona: string; last: boolean; onClick: () => void }) {
  const esGasto = mov.tipo === 'Gasto';
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
        borderBottom: last ? 'none' : '1px solid var(--gf-gray-100)',
        background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-base)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {mov.descripcion}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-sec)', marginTop: 2 }}>
          {fmtFecha(mov.fecha)} · {mov.categoria ?? '—'}{mov.subcategoria ? ` › ${mov.subcategoria}` : ''} · {nombrePersona}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: esGasto ? 'var(--gf-expense, var(--gf-out))' : 'var(--gf-income)' }}>
          {esGasto ? '−' : '+'}{fmtMoney(mov.monto, { from: mov.moneda, to: mov.moneda })}
        </div>
        {mov.banco && <div style={{ fontSize: 11, color: 'var(--gf-gray-400)' }}>{mov.banco}</div>}
      </div>
      <Icon name="pencil" size={14} color="var(--gf-gray-300)" />
    </button>
  );
}
