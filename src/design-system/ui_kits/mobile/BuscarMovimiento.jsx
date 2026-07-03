// BuscarMovimiento — pantalla colgada de Configuración para encontrar un
// movimiento ya cargado y editarlo/eliminarlo (abre EditarMovimiento). Solo admin.
// Buscador por texto (descripción / categoría / subcat / persona) + filtros rápidos
// (mes implícito = el cargado; chips de persona; toggle "solo tarjeta"). La lista es
// tappable; cada fila abre el editor precargado.
const { Badge: BBadge, Money: BMny } = window.GastosFamiliaresDesignSystem_d81a5e;

// Une los movimientos sueltos (M_MOVS) con los consumos de tarjeta del período en
// curso (M_RESUMENES_TARJETA) — en la app real todos son `movimientos`. Los de
// tarjeta quedan marcados `esTarjeta` para mostrar el aviso al editar.
function _construirMovs() {
  const out = [];
  for (const m of (window.M_MOVS || [])) {
    out.push({ id: m.id, descripcion: m.descripcion, monto: m.monto, moneda: m.moneda, tipo: m.tipo, categoria: m.categoria, subcat: m.subcat || '', persona: m.persona || '', banco: m.banco, fecha: m.fecha, esTarjeta: false });
  }
  for (const r of (window.M_RESUMENES_TARJETA || []).filter((x) => x.periodo === (window.M_PERIODO_ACTUAL || '2026-06'))) {
    const titular = (window.M_TARJETAS_CFG.find((t) => t.banco === r.banco && r.red.startsWith(t.red.split(' ')[0])) || {}).titular || '';
    for (const c of r.consumos) {
      const [dd, mm] = (c.fecha || '01/06').split('/');
      out.push({ id: `${r.id}-${c.com}-${dd}`, descripcion: c.com + (c.cuotaTotal ? ` · cuota ${c.cuotaActual}/${c.cuotaTotal}` : ''), monto: c.monto, moneda: 'ARS', tipo: 'Gasto', categoria: c.cat, subcat: '', persona: titular, banco: `${r.banco} ${r.red}`, fecha: new Date(2026, Number(mm) - 1, Number(dd)), esTarjeta: true });
    }
  }
  return out.sort((a, b) => (b.fecha?.getTime?.() || 0) - (a.fecha?.getTime?.() || 0));
}

function BuscarMovimiento() {
  const Icon = window.Icon;
  const { EditarMovimiento } = window;
  const [lista, setLista] = React.useState(_construirMovs);
  const [q, setQ] = React.useState('');
  const [persona, setPersona] = React.useState('Todos');
  const [soloTarjeta, setSoloTarjeta] = React.useState(false);
  const [edit, setEdit] = React.useState(null);
  const [flash, setFlash] = React.useState(null); // {tipo:'save'|'del', desc}

  const personas = ['Todos', ...new Set((window.M_MIEMBROS || []).map((m) => m.nombre))];

  const norm = (s) => (s || '').toLowerCase();
  const filtrados = lista.filter((m) => {
    if (soloTarjeta && !m.esTarjeta) return false;
    if (persona !== 'Todos' && m.persona !== persona) return false;
    if (!q.trim()) return true;
    const t = norm(q);
    return [m.descripcion, m.categoria, m.subcat, m.persona, m.banco].some((f) => norm(f).includes(t));
  });

  const guardar = (upd) => {
    setLista((prev) => prev.map((m) => m.id === upd.id ? { ...m, ...upd, fecha: typeof upd.fecha === 'string' ? new Date(upd.fecha + 'T00:00:00') : upd.fecha } : m));
    setEdit(null); setFlash({ tipo: 'save', desc: upd.descripcion }); setTimeout(() => setFlash(null), 2600);
  };
  const eliminar = (id) => {
    const m = lista.find((x) => x.id === id);
    setLista((prev) => prev.filter((x) => x.id !== id));
    setEdit(null); setFlash({ tipo: 'del', desc: m ? m.descripcion : '' }); setTimeout(() => setFlash(null), 2600);
  };

  const catColor = (nombre) => ((window.M_CATEGORIAS_CFG || []).find((c) => c.nombre === nombre) || {}).color || 'var(--gf-gray-300)';
  const fmtDia = (f) => f instanceof Date ? `${f.getDate()}/${String(f.getMonth() + 1).padStart(2, '0')}` : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Buscador */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--color-surface)', border: '1px solid var(--gf-gray-200)', borderRadius: 12, padding: '10px 13px' }}>
        <Icon name="search" size={18} color="var(--gf-gray-400)" />
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por descripción, categoría, persona…"
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-base)', fontSize: 14, color: 'var(--color-text)' }}
        />
        {q && <button onClick={() => setQ('')} aria-label="Limpiar" style={{ border: 'none', background: 'var(--gf-gray-100)', borderRadius: 999, width: 22, height: 22, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="x" size={13} color="var(--gf-gray-400)" /></button>}
      </div>

      {/* Filtros rápidos */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
        {personas.map((p) => {
          const on = persona === p;
          return (
            <button key={p} onClick={() => setPersona(p)} style={{
              padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 12.5, fontWeight: on ? 700 : 600,
              border: on ? '1px solid var(--gf-ink)' : '1px solid var(--gf-gray-200)',
              background: on ? 'var(--gf-ink)' : 'var(--color-surface)', color: on ? '#fff' : 'var(--color-text-sec)',
            }}>{p}</button>
          );
        })}
        <button onClick={() => setSoloTarjeta((v) => !v)} style={{
          marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 12.5, fontWeight: soloTarjeta ? 700 : 600,
          border: soloTarjeta ? '1px solid var(--color-accent)' : '1px solid var(--gf-gray-200)',
          background: soloTarjeta ? 'var(--gf-emerald-50)' : 'var(--color-surface)', color: soloTarjeta ? 'var(--color-accent)' : 'var(--color-text-sec)',
        }}><Icon name="credit-card" size={14} /> Tarjeta</button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--gf-gray-400)', margin: '0 2px' }}>{filtrados.length} {filtrados.length === 1 ? 'movimiento' : 'movimientos'}</div>

      {/* Lista */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtrados.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--color-text-sec)' }}>
            <Icon name="search-x" size={26} color="var(--gf-gray-300)" />
            <div style={{ fontSize: 13, marginTop: 8 }}>Sin resultados para «{q}».</div>
          </div>
        )}
        {filtrados.map((m) => (
          <button key={m.id} onClick={() => setEdit(m)} style={{
            display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', cursor: 'pointer',
            background: 'var(--color-surface)', border: '1px solid var(--gf-gray-150)', borderRadius: 14, padding: '11px 13px', fontFamily: 'var(--font-base)',
          }}>
            <span style={{ width: 38, flexShrink: 0, textAlign: 'center' }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text)' }}>{m.fecha instanceof Date ? m.fecha.getDate() : ''}</span>
              <span style={{ fontSize: 9, color: 'var(--gf-gray-400)', textTransform: 'uppercase' }}>jun</span>
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.descripcion}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <span style={{ width: 8, height: 8, borderRadius: 3, background: catColor(m.categoria), flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--color-text-sec)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.categoria}{m.subcat ? ` · ${m.subcat}` : ''}</span>
                {m.esTarjeta && <Icon name="credit-card" size={12} color="var(--gf-gray-400)" />}
              </span>
            </span>
            <span style={{ textAlign: 'right', flexShrink: 0 }}>
              <BMny value={m.monto} currency={m.moneda} tipo={m.tipo} decimals={0} style={{ fontSize: 14 }} />
              <span style={{ display: 'block', fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 1 }}>{m.persona || 'Familiar'}</span>
            </span>
            <Icon name="chevron-right" size={17} color="var(--gf-gray-300)" />
          </button>
        ))}
      </div>
      <div style={{ height: 4 }} />

      {flash && (
        <div style={{ position: 'absolute', left: 16, right: 16, bottom: 78, zIndex: 55, display: 'flex', alignItems: 'center', gap: 9, background: 'var(--gf-ink)', color: '#fff', borderRadius: 12, padding: '11px 14px', boxShadow: '0 10px 30px rgba(0,0,0,.3)', animation: 'gfRiseIn .3s ease both' }}>
          <Icon name={flash.tipo === 'del' ? 'trash-2' : 'check'} size={16} color="var(--gf-emerald-100)" />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{flash.tipo === 'del' ? 'Movimiento eliminado' : 'Cambios guardados'}</span>
        </div>
      )}

      {edit && EditarMovimiento && (
        <EditarMovimiento mov={edit} onClose={() => setEdit(null)} onSave={guardar} onDelete={eliminar} />
      )}
    </div>
  );
}

Object.assign(window, { BuscarMovimiento });
