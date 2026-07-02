import { useEffect, useState } from 'react';
import { Icon } from '../../design-system/Icon';
import { Card, Button } from '../../design-system/components';
import { AddBtn } from './shared';
import { useFamiliaConfig } from '../../hooks/useFamiliaConfig';
import { useItemsEsperados } from '../../contexto/ItemsEsperadosContext';
import {
  cargarSubcategoriasAdmin, cargarEtiquetasAdmin,
  type SubcategoriaAdminItem, type EtiquetaAdminItem,
} from '../../datos/catalogos';
import {
  listarDestinos, upsertDestino, eliminarDestino,
  type DestinoDoc, type UpsertDestinoInput,
} from '../../datos/destinos';

const UMBRAL = 0.7;

const inputStyle: React.CSSProperties = {
  fontSize: 14, fontFamily: 'var(--font-base)', border: '1px solid var(--gf-gray-200)',
  borderRadius: 8, padding: '7px 10px', width: '100%', boxSizing: 'border-box',
  background: 'var(--color-surface)', color: 'var(--color-text)',
};
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' };

const TIPO_LABELS: Record<string, string> = { cbu: 'CBU', cuit: 'CUIT', alias: 'alias', nombre: 'nombre' };

function chipStyle(warn: boolean): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 600, borderRadius: 999, padding: '2px 7px',
    background: warn ? 'var(--gf-warn-bg, #fef9c3)' : 'var(--gf-gray-100)',
    color: warn ? 'var(--gf-warn-text, #92400e)' : 'var(--color-text-sec)',
  };
}

export default function Destinos() {
  const { config } = useFamiliaConfig();
  const { items } = useItemsEsperados();

  const [destinos, setDestinos] = useState<DestinoDoc[]>([]);
  const [cargando, setCargando] = useState(true);
  const [subcats, setSubcats] = useState<SubcategoriaAdminItem[]>([]);
  const [etiquetas, setEtiquetas] = useState<EtiquetaAdminItem[]>([]);

  const [busqueda, setBusqueda] = useState('');
  const [editando, setEditando] = useState<DestinoDoc | null>(null);
  const [abierto, setAbierto] = useState(false);

  // form (alta)
  const [fRaw, setFRaw] = useState('');
  // form (alta + edición)
  const [fItem, setFItem] = useState('');
  const [fCategoria, setFCategoria] = useState('');
  const [fSubcat, setFSubcat] = useState('');
  const [fEtiqueta, setFEtiqueta] = useState('');
  const [fConfianza, setFConfianza] = useState('');

  const [guardando, setGuardando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    const lista = await listarDestinos();
    lista.sort((a, b) => a.destinoNorm.localeCompare(b.destinoNorm, 'es-AR', { sensitivity: 'base' }));
    setDestinos(lista);
    setCargando(false);
  }

  useEffect(() => {
    cargar();
    cargarSubcategoriasAdmin().then(setSubcats);
    cargarEtiquetasAdmin().then(setEtiquetas);
  }, []);

  function abrirNuevo() {
    setEditando(null);
    setFRaw(''); setFItem(''); setFCategoria(''); setFSubcat(''); setFEtiqueta(''); setFConfianza('');
    setErrorMsg(null);
    setAbierto(true);
  }

  function abrirEdicion(d: DestinoDoc) {
    setEditando(d);
    setFItem(d.itemEsperadoId ?? '');
    setFCategoria(d.categoria ?? '');
    setFSubcat(d.subcategoria ?? '');
    setFEtiqueta(d.etiqueta ?? '');
    setFConfianza(String(d.confianza));
    setErrorMsg(null);
    setAbierto(true);
  }

  function cerrar() { setAbierto(false); setEditando(null); setErrorMsg(null); }

  async function guardar() {
    const item = fItem || null;
    const cat  = fCategoria || null;
    if (!item && !cat) { setErrorMsg('Se requiere ítem esperado o categoría.'); return; }

    const payload: UpsertDestinoInput = {
      itemEsperadoId: item,
      categoria:      cat,
      subcategoria:   fSubcat || null,
      etiqueta:       fEtiqueta || null,
    };

    if (editando) {
      payload.id = editando.id;
      const conf = parseFloat(fConfianza);
      if (!isNaN(conf)) payload.confianza = conf;
    } else {
      if (!fRaw.trim()) { setErrorMsg('El destino (CBU/CUIT/alias/nombre) es requerido.'); return; }
      payload.destinoRaw = fRaw.trim();
    }

    setGuardando(true);
    setErrorMsg(null);
    try {
      await upsertDestino(payload);
      await cargar();
      cerrar();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al guardar.';
      setErrorMsg(msg);
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(d: DestinoDoc) {
    if (!confirm(`¿Eliminar el destino "${d.destinoNorm}"?`)) return;
    try {
      await eliminarDestino(d.id);
      setDestinos(prev => prev.filter(x => x.id !== d.id));
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error al eliminar.');
    }
  }

  const itemsActivos = (items ?? []).filter(i => i.activo !== false);
  const catsActivas  = (config?.categorias ?? []).filter(c => c.activo);
  const subcatsFiltradas = subcats.filter(s => s.activo && s.categoriaPadre === fCategoria);

  const busqLow = busqueda.toLowerCase();
  const visibles = destinos.filter(d => {
    if (!busqLow) return true;
    if (d.destinoNorm.toLowerCase().includes(busqLow)) return true;
    if ((d.categoria ?? '').toLowerCase().includes(busqLow)) return true;
    const itemNombre = itemsActivos.find(i => i.id === d.itemEsperadoId)?.nombre ?? '';
    return itemNombre.toLowerCase().includes(busqLow);
  });

  if (cargando) return <p style={{ color: 'var(--color-text-sec)' }}>Cargando…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      <input
        value={busqueda}
        onChange={e => setBusqueda(e.target.value)}
        placeholder="Buscar por destino, categoría o ítem…"
        style={inputStyle}
      />

      <Card padding="0">
        {visibles.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-sec)', padding: '12px 10px' }}>
            {busqueda ? 'Sin resultados.' : 'Sin destinos aprendidos.'}
          </p>
        ) : visibles.map((d, i) => {
          const itemNombre = itemsActivos.find(it => it.id === d.itemEsperadoId)?.nombre;
          const bajUmbral  = d.confianza < UMBRAL;
          return (
            <div
              key={d.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                borderBottom: i < visibles.length - 1 ? '1px solid var(--gf-gray-100)' : 'none',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.destinoNorm}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>
                  {itemNombre
                    ? `🔗 ${itemNombre}`
                    : [d.categoria, d.subcategoria].filter(Boolean).join(' › ') || '—'
                  }
                </div>
                <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                  <span style={chipStyle(false)}>{TIPO_LABELS[d.tipo] ?? d.tipo}</span>
                  <span style={chipStyle(bajUmbral)} title={bajUmbral ? 'Bajo umbral — el matcher lo ignora' : undefined}>
                    {Math.round(d.confianza * 100)}%{bajUmbral ? ' ⚠' : ''}
                  </span>
                </div>
              </div>

              <button
                onClick={() => abrirEdicion(d)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--color-text-sec)' }}
              >
                <Icon name="pencil" size={15} />
              </button>

              <button
                onClick={() => borrar(d)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--gf-err-text)' }}
              >
                <Icon name="trash-2" size={15} />
              </button>
            </div>
          );
        })}
      </Card>

      <AddBtn onClick={abrirNuevo}>
        <Icon name="plus" size={18} /> Agregar destino
      </AddBtn>

      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Un destino vinculado a un ítem esperado prefillará ese ítem (rama 2) en el próximo comprobante que matchee ese payee.
        Destinos con confianza &lt; {UMBRAL * 100}% son ignorados por el matcher.
      </p>

      {/* bottom-sheet */}
      {abierto && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={cerrar} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
          <div style={{
            position: 'relative', background: 'var(--color-surface)',
            borderRadius: '18px 18px 0 0', padding: '20px 16px 32px',
            display: 'flex', flexDirection: 'column', gap: 14,
            maxHeight: '85dvh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{editando ? 'Editar destino' : 'Nuevo destino'}</span>
              <button onClick={cerrar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-sec)' }}>
                <Icon name="x" size={20} />
              </button>
            </div>

            {editando ? (
              /* edición: destino read-only */
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>Destino (inmutable)</label>
                <div style={{ fontSize: 14, padding: '7px 10px', background: 'var(--gf-gray-50)', borderRadius: 8, color: 'var(--color-text-sec)' }}>
                  {editando.destinoNorm} <span style={chipStyle(false)}>{TIPO_LABELS[editando.tipo]}</span>
                </div>
              </div>
            ) : (
              /* alta: destino editable */
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>Destino *</label>
                <input value={fRaw} onChange={e => setFRaw(e.target.value)} placeholder="CBU (22 díg), CUIT (11), alias o nombre" style={inputStyle} autoFocus />
                <p style={{ fontSize: 11, color: 'var(--color-text-sec)', margin: '4px 0 0' }}>Se normaliza automáticamente en el servidor.</p>
              </div>
            )}

            {/* ítem esperado */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>Ítem esperado</label>
              <select value={fItem} onChange={e => setFItem(e.target.value)} style={selectStyle}>
                <option value="">— sin vínculo —</option>
                {itemsActivos.map(it => <option key={it.id} value={it.id}>{it.nombre}</option>)}
              </select>
            </div>

            {/* categoría */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>Categoría</label>
              <select value={fCategoria} onChange={e => { setFCategoria(e.target.value); setFSubcat(''); }} style={selectStyle}>
                <option value="">— Ninguna —</option>
                {catsActivas.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
              </select>
            </div>

            {/* subcategoría */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>Subcategoría</label>
              <select value={fSubcat} onChange={e => setFSubcat(e.target.value)} style={selectStyle} disabled={!fCategoria}>
                <option value="">— Ninguna —</option>
                {subcatsFiltradas.map(s => <option key={s.id} value={s.valor}>{s.valor}</option>)}
              </select>
            </div>

            {/* etiqueta */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>Etiqueta</label>
              <select value={fEtiqueta} onChange={e => setFEtiqueta(e.target.value)} style={selectStyle}>
                <option value="">— Ninguna —</option>
                {etiquetas.filter(e => e.activo).map(et => <option key={et.id} value={et.valor}>{et.valor}</option>)}
              </select>
            </div>

            {/* confianza — solo en edición */}
            {editando && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>
                  Confianza (0–1) — umbral del matcher: {UMBRAL}
                </label>
                <input
                  type="number" min={0} max={1} step={0.05}
                  value={fConfianza}
                  onChange={e => setFConfianza(e.target.value)}
                  style={{ ...inputStyle, width: 100 }}
                />
              </div>
            )}

            {errorMsg && <p style={{ fontSize: 13, color: 'var(--gf-err-text)', margin: 0 }}>{errorMsg}</p>}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <Button variant="secondary" size="cta" onClick={cerrar} disabled={guardando}>Cancelar</Button>
              <Button variant="primary" size="cta" onClick={guardar} disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
