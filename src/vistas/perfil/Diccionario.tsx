import { useEffect, useState } from 'react';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Icon } from '../../design-system/Icon';
import { Card, Button } from '../../design-system/components';
import { AddBtn } from './shared';
import { useFamiliaConfig } from '../../hooks/useFamiliaConfig';
import { useMiembroCtx } from '../../contexto/MiembroContext';
import {
  cargarSubcategoriasAdmin, cargarEtiquetasAdmin,
  type SubcategoriaAdminItem, type EtiquetaAdminItem,
} from '../../datos/catalogos';
import type { EntradaDict } from '../../datos/clasificador';

type EntradaConId = EntradaDict & { id: string };

const inputStyle: React.CSSProperties = {
  fontSize: 14, fontFamily: 'var(--font-base)', border: '1px solid var(--gf-gray-200)',
  borderRadius: 8, padding: '7px 10px', width: '100%', boxSizing: 'border-box',
  background: 'var(--color-surface)', color: 'var(--color-text)',
};

const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' };

const TIPO_MATCH_LABELS: Record<string, string> = { contains: 'contiene', exact: 'exacto' };

function chipStyle(activo: boolean): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 600, borderRadius: 999, padding: '2px 7px',
    background: activo ? 'var(--gf-gray-100)' : 'var(--gf-gray-50)',
    color: 'var(--color-text-sec)',
  };
}

export default function Diccionario() {
  const { config } = useFamiliaConfig();
  const { memberId } = useMiembroCtx();

  const [entradas, setEntradas] = useState<EntradaConId[]>([]);
  const [cargando, setCargando] = useState(true);
  const [subcats, setSubcats] = useState<SubcategoriaAdminItem[]>([]);
  const [etiquetas, setEtiquetas] = useState<EtiquetaAdminItem[]>([]);

  const [busqueda, setBusqueda] = useState('');
  const [editando, setEditando] = useState<EntradaConId | null>(null);
  const [abierto, setAbierto] = useState(false); // true = bottom-sheet visible

  // form state
  const [fPatron, setFPatron] = useState('');
  const [fTipoMatch, setFTipoMatch] = useState<'contains' | 'exact'>('contains');
  const [fCategoria, setFCategoria] = useState('');
  const [fSubcat, setFSubcat] = useState('');
  const [fEtiqueta, setFEtiqueta] = useState('');
  const [fPersona, setFPersona] = useState('');
  const [fMoneda, setFMoneda] = useState<'ARS' | 'USD' | ''>('');

  const [guardando, setGuardando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    const snap = await getDocs(collection(db, 'diccionario'));
    const lista: EntradaConId[] = snap.docs.map(d => ({
      id: d.id,
      ...(d.data() as EntradaDict),
    }));
    lista.sort((a, b) => (a.patron ?? '').localeCompare(b.patron ?? '', 'es-AR', { sensitivity: 'base' }));
    setEntradas(lista);
    setCargando(false);
  }

  useEffect(() => {
    cargar();
    cargarSubcategoriasAdmin().then(setSubcats);
    cargarEtiquetasAdmin().then(setEtiquetas);
  }, []);

  function abrirNueva() {
    setEditando(null);
    setFPatron(''); setFTipoMatch('contains'); setFCategoria('');
    setFSubcat(''); setFEtiqueta(''); setFPersona(''); setFMoneda('');
    setErrorMsg(null);
    setAbierto(true);
  }

  function abrirEdicion(e: EntradaConId) {
    setEditando(e);
    setFPatron(e.patron ?? '');
    setFTipoMatch(e.tipoMatch ?? 'contains');
    setFCategoria(e.categoria ?? '');
    setFSubcat(e.subcategoria ?? '');
    setFEtiqueta(e.etiqueta ?? '');
    setFPersona(e.personaDefault ?? '');
    setFMoneda(e.monedaDefault ?? '');
    setErrorMsg(null);
    setAbierto(true);
  }

  function cerrar() { setAbierto(false); setEditando(null); setErrorMsg(null); }

  async function guardar() {
    if (!fPatron.trim()) { setErrorMsg('El patrón es requerido.'); return; }
    if (!fCategoria) { setErrorMsg('La categoría es requerida.'); return; }
    setGuardando(true);
    setErrorMsg(null);
    try {
      const campos = {
        patron:          fPatron.trim(),
        tipoMatch:       fTipoMatch,
        categoria:       fCategoria,
        subcategoria:    fSubcat || null,
        etiqueta:        fEtiqueta || null,
        personaDefault:  fPersona || null,
        monedaDefault:   fMoneda || null,
      };
      if (editando) {
        await updateDoc(doc(db, 'diccionario', editando.id), campos);
      } else {
        await addDoc(collection(db, 'diccionario'), {
          ...campos,
          descripcionLimpia: null,
          bancoFiltro:    null,
          tarjetaFiltro:  null,
          activo:         true,
          confianza:      0.9,
          origen:         'Manual',
          creadoPor:      memberId,
          creadoEn:       serverTimestamp(),
        });
      }
      await cargar();
      cerrar();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Error al guardar.');
    } finally {
      setGuardando(false);
    }
  }

  async function toggleActivo(e: EntradaConId) {
    await updateDoc(doc(db, 'diccionario', e.id), { activo: !e.activo });
    setEntradas(prev => prev.map(x => x.id === e.id ? { ...x, activo: !x.activo } : x));
  }

  async function borrar(e: EntradaConId) {
    if (!confirm(`¿Eliminar la regla "${e.patron}"?`)) return;
    await deleteDoc(doc(db, 'diccionario', e.id));
    setEntradas(prev => prev.filter(x => x.id !== e.id));
  }

  const busqLow = busqueda.toLowerCase();
  const visibles = entradas.filter(e =>
    (!busqLow || (e.patron ?? '').toLowerCase().includes(busqLow) || (e.categoria ?? '').toLowerCase().includes(busqLow))
  );

  const catsActivas = (config?.categorias ?? []).filter(c => c.activo);
  const subcatsFiltradas = subcats.filter(s => s.activo && s.categoriaPadre === fCategoria);
  const miembrosActivos = config
    ? Object.entries(config.miembros).filter(([, m]) => m.activo).map(([id, m]) => ({ id, nombre: m.nombre }))
    : [];

  if (cargando) return <p style={{ color: 'var(--color-text-sec)' }}>Cargando…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* buscador */}
      <input
        value={busqueda}
        onChange={e => setBusqueda(e.target.value)}
        placeholder="Buscar por patrón o categoría…"
        style={inputStyle}
      />

      {/* lista */}
      <Card padding="0">
        {visibles.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-sec)', padding: '12px 10px' }}>
            {busqueda ? 'Sin resultados.' : 'Sin entradas en el diccionario.'}
          </p>
        ) : visibles.map((e, i) => (
          <div
            key={e.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              borderBottom: i < visibles.length - 1 ? '1px solid var(--gf-gray-100)' : 'none',
              opacity: e.activo ? 1 : 0.55,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.patron ?? '—'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>
                {e.categoria}{e.subcategoria ? ` › ${e.subcategoria}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                <span style={chipStyle(e.activo)}>{TIPO_MATCH_LABELS[e.tipoMatch] ?? e.tipoMatch}</span>
                {e.confianza != null && (
                  <span style={chipStyle(e.activo)}>{Math.round(e.confianza * 100)}%</span>
                )}
                {e.personaDefault && (
                  <span style={chipStyle(e.activo)}>{e.personaDefault}</span>
                )}
                {e.monedaDefault && (
                  <span style={chipStyle(e.activo)}>{e.monedaDefault}</span>
                )}
              </div>
            </div>

            {/* toggle activo */}
            <button
              onClick={() => toggleActivo(e)}
              title={e.activo ? 'Desactivar' : 'Activar'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: e.activo ? 'var(--color-accent)' : 'var(--gf-gray-300)' }}
            >
              <Icon name={e.activo ? 'check' : 'circle-x'} size={16} />
            </button>

            {/* editar */}
            <button
              onClick={() => abrirEdicion(e)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--color-text-sec)' }}
            >
              <Icon name="pencil" size={15} />
            </button>

            {/* borrar */}
            <button
              onClick={() => borrar(e)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--gf-err-text)' }}
            >
              <Icon name="trash-2" size={15} />
            </button>
          </div>
        ))}
      </Card>

      <AddBtn onClick={abrirNueva}>
        <Icon name="plus" size={18} /> Agregar regla
      </AddBtn>

      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Los cambios impactan el prellenado de sugerencias tras recargar la app (el diccionario se carga al iniciar).
      </p>

      {/* bottom-sheet */}
      {abierto && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        }}>
          {/* backdrop */}
          <div onClick={cerrar} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />

          <div style={{
            position: 'relative', background: 'var(--color-surface)',
            borderRadius: '18px 18px 0 0', padding: '20px 16px 32px',
            display: 'flex', flexDirection: 'column', gap: 14,
            maxHeight: '85dvh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>
                {editando ? 'Editar regla' : 'Nueva regla'}
              </span>
              <button onClick={cerrar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-sec)' }}>
                <Icon name="x" size={20} />
              </button>
            </div>

            {/* patrón */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>Patrón *</label>
              <input value={fPatron} onChange={e => setFPatron(e.target.value)} placeholder="ej: edesur" style={inputStyle} autoFocus />
            </div>

            {/* tipoMatch segmented */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>Tipo de match</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['contains', 'exact'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setFTipoMatch(t)}
                    style={{
                      flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                      fontFamily: 'var(--font-base)', fontSize: 13, fontWeight: 600,
                      background: fTipoMatch === t ? 'var(--color-accent)' : 'var(--gf-gray-100)',
                      color: fTipoMatch === t ? '#fff' : 'var(--color-text)',
                    }}
                  >
                    {TIPO_MATCH_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            {/* categoría */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>Categoría *</label>
              <select value={fCategoria} onChange={e => { setFCategoria(e.target.value); setFSubcat(''); }} style={selectStyle}>
                <option value="">— Elegir —</option>
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

            {/* persona */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>Persona por defecto</label>
              <select value={fPersona} onChange={e => setFPersona(e.target.value)} style={selectStyle}>
                <option value="">— Ninguna —</option>
                {miembrosActivos.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </div>

            {/* moneda */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>Moneda por defecto</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['', 'ARS', 'USD'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setFMoneda(m)}
                    style={{
                      flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                      fontFamily: 'var(--font-base)', fontSize: 13, fontWeight: 600,
                      background: fMoneda === m ? 'var(--color-accent)' : 'var(--gf-gray-100)',
                      color: fMoneda === m ? '#fff' : 'var(--color-text)',
                    }}
                  >
                    {m || '—'}
                  </button>
                ))}
              </div>
            </div>

            {errorMsg && <p style={{ fontSize: 13, color: 'var(--gf-err-text)', margin: 0 }}>{errorMsg}</p>}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <Button variant="secondary" size="cta" onClick={cerrar} disabled={guardando}>Cancelar</Button>
              <Button variant="primary" size="cta" onClick={guardar} disabled={guardando || !fPatron.trim() || !fCategoria}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
