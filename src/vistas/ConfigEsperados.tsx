import { useState, useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { cargarSubcategorias, cargarEtiquetas, type SubcategoriaItem, type EtiquetaItem } from '../datos/catalogos';
import { cargarFamiliaConfig } from '../familia';
import { useItemsEsperados } from '../contexto/ItemsEsperadosContext';
import {
  crearItemEsperado, actualizarItemEsperado,
  desactivarItemEsperado, reactivarItemEsperado, eliminarItemEsperado,
  type NuevoItemEsperado,
} from '../datos/itemsEsperados';
import { useMiembroCtx } from '../contexto/MiembroContext';
import type { ExpectedItem, FamiliaConfig } from '../types';
import './ConfigEsperados.css';

const PERIODICIDADES = ['mensual', 'bimestral', 'trimestral', 'anual', 'unico'] as const;
const PERIODICIDAD_LABEL: Record<string, string> = {
  mensual: 'Mensual', bimestral: 'Bimestral', trimestral: 'Trimestral', anual: 'Anual', unico: 'Único',
};

function fmtMonto(monto: number, moneda: 'ARS' | 'USD'): string {
  const n = monto.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return moneda === 'ARS' ? `$${n}` : `USD ${n}`;
}

/* ── Guard ── */
export default function ConfigEsperados() {
  const { miembro } = useMiembroCtx();
  if (miembro.rol !== 'admin') return <Navigate to="/" replace />;
  return <ConfigEsperadosAdmin />;
}

/* ── Fila de lista ── */
interface ItemListaProps {
  items: ExpectedItem[];
  inactivos?: boolean;
  onEditar: (item: ExpectedItem) => void;
  onDesactivar?: (item: ExpectedItem) => void;
  onReactivar?: (item: ExpectedItem) => void;
  onEliminar: (item: ExpectedItem) => void;
}

function ItemLista({ items, inactivos, onEditar, onDesactivar, onReactivar, onEliminar }: ItemListaProps) {
  if (items.length === 0) {
    return <p className="cfg-estado">{inactivos ? 'Sin inactivos.' : 'Sin ítems en esta pestaña.'}</p>;
  }
  return (
    <ul className="cfg-lista">
      {items.map(item => (
        <li key={item.id} className={`cfg-item${inactivos ? ' cfg-item--inactivo' : ''}`}>
          <div className="cfg-item-info">
            <span className="cfg-item-cat">
              {[item.categoria, item.subcategoria].filter(Boolean).join(' › ')}
            </span>
            {item.persona && <span className="cfg-chip-persona">{item.persona}</span>}
            <span className="cfg-chip-moneda">{item.moneda}</span>
            {item.tarjetaCodigo && <span className="cfg-chip-tarj">{item.tarjetaCodigo}</span>}
            {item.pagoAutomatico && <span className="cfg-chip-auto">automático</span>}
            {item.montoEsperado != null && (
              <span className="cfg-item-monto">{fmtMonto(item.montoEsperado, item.moneda)}</span>
            )}
          </div>
          <div className="cfg-item-acciones">
            {!inactivos && (
              <button className="cfg-btn-sm" onClick={() => onEditar(item)}>Editar</button>
            )}
            {!inactivos && onDesactivar && (
              <button className="cfg-btn-sm cfg-btn-sm--warn" onClick={() => onDesactivar(item)}>
                Desactivar
              </button>
            )}
            {inactivos && onReactivar && (
              <button className="cfg-btn-sm" onClick={() => onReactivar(item)}>Reactivar</button>
            )}
            <button className="cfg-btn-sm cfg-btn-sm--danger" onClick={() => onEliminar(item)}>
              Eliminar
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── Editor de chips ── */
interface ChipEditorProps {
  chips: string[];
  input: string;
  onInputChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (chip: string) => void;
  placeholder?: string;
}

function ChipEditor({ chips, input, onInputChange, onAdd, onRemove, placeholder }: ChipEditorProps) {
  return (
    <div className="cfg-chips-area">
      {chips.map(c => (
        <span key={c} className="cfg-chip-tag">
          {c}
          <button type="button" onClick={() => onRemove(c)} aria-label={`Quitar ${c}`}>×</button>
        </span>
      ))}
      <input
        className="cfg-chips-input"
        type="text"
        value={input}
        placeholder={chips.length === 0 ? (placeholder ?? 'Agregar... (Enter)') : ''}
        onChange={e => onInputChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }}
      />
      <button type="button" className="cfg-chips-add" onClick={onAdd}>+</button>
    </div>
  );
}

/* ── Formulario crear/editar ── */
interface FormItemEsperadoProps {
  item?: ExpectedItem;
  tipo: 'Gasto' | 'Ingreso';
  items: ExpectedItem[];
  subcats: SubcategoriaItem[];
  etiquetas: EtiquetaItem[];
  config: FamiliaConfig;
  onGuardado: () => void;
  onCancelar: () => void;
}

function FormItemEsperado({
  item, tipo, items, subcats, etiquetas, config, onGuardado, onCancelar,
}: FormItemEsperadoProps) {
  const [tipoF,          setTipoF]         = useState<'Gasto' | 'Ingreso'>(item?.tipo ?? tipo);
  const [activo,         setActivo]         = useState(item?.activo ?? true);
  const [categoria,      setCategoria]      = useState(item?.categoria ?? '');
  const [subcategoria,   setSubcategoria]   = useState(item?.subcategoria ?? '');
  const [persona,        setPersona]        = useState(item?.persona ?? '');
  const [moneda,         setMoneda]         = useState<'ARS' | 'USD'>(item?.moneda ?? 'ARS');
  const [tarjetaCodigo,  setTarjetaCodigo]  = useState(item?.tarjetaCodigo ?? '');
  const [montoEsp,       setMontoEsp]       = useState(item?.montoEsperado?.toString() ?? '');
  const [diaVenc,        setDiaVenc]        = useState(item?.diaVencimiento?.toString() ?? '');
  const [periodicidad,   setPeriodicidad]   = useState<string>(item?.periodicidad ?? 'mensual');
  const [pagoAuto,       setPagoAuto]       = useState(item?.pagoAutomatico ?? false);
  const [incluye,        setIncluye]        = useState<string[]>(item?.matchTexto?.incluye ?? []);
  const [excluye,        setExcluye]        = useState<string[]>(item?.matchTexto?.excluye ?? []);
  const [incluyeInput,   setIncluyeInput]   = useState('');
  const [excluyeInput,   setExcluyeInput]   = useState('');
  const [banco,          setBanco]          = useState(item?.banco ?? '');
  const [etiqueta,       setEtiqueta]       = useState(item?.etiqueta ?? '');
  const [notas,          setNotas]          = useState(item?.notas ?? '');
  const [autoCalendario, setAutoCalendario] = useState(item?.autoCalendario ?? false);
  const [guardando,      setGuardando]      = useState(false);
  const [errorMsg,       setErrorMsg]       = useState<string | null>(null);

  const subcatInitRef = useRef(true);

  useEffect(() => {
    if (subcatInitRef.current) { subcatInitRef.current = false; return; }
    setSubcategoria('');
  }, [categoria]);

  const subcatsFiltradas = subcats.filter(s => s.categoriaPadre === categoria);
  const categoriasDisp   = [...config.categorias].sort();
  const miembrosActivos  = Object.entries(config.miembros)
    .filter(([, m]) => m.activo)
    .map(([id, m]) => ({ id, nombre: m.nombre }));

  function addChip(
    val: string,
    list: string[],
    setList: (v: string[]) => void,
    setInput: (v: string) => void,
  ) {
    const chip = val.trim().toLowerCase();
    if (!chip || list.includes(chip)) { setInput(''); return; }
    setList([...list, chip]);
    setInput('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!categoria)    { setErrorMsg('La categoría es obligatoria.');    return; }
    if (!subcategoria) { setErrorMsg('La subcategoría es obligatoria.'); return; }

    const montoNum = montoEsp ? parseFloat(montoEsp.replace(',', '.')) : null;
    if (montoEsp && (montoNum === null || isNaN(montoNum) || montoNum <= 0)) {
      setErrorMsg('El monto esperado debe ser mayor que cero.');
      return;
    }
    const diaNum = diaVenc ? parseInt(diaVenc) : null;
    if (diaVenc && (diaNum === null || isNaN(diaNum) || diaNum < 1 || diaNum > 31)) {
      setErrorMsg('El día de vencimiento debe ser entre 1 y 31.');
      return;
    }

    if (!item) {
      const dup = items.find(i =>
        i.activo &&
        i.tipo === tipoF &&
        i.categoria === (categoria || null) &&
        i.subcategoria === (subcategoria || null) &&
        i.persona === (persona || null) &&
        i.moneda === moneda,
      );
      if (dup) {
        const ok = window.confirm(
          'Ya existe un ítem activo con la misma combinación tipo/categoría/subcategoría/persona/moneda. ¿Continuar de todas formas?',
        );
        if (!ok) return;
      }
    }

    const payload: NuevoItemEsperado = {
      tipo: tipoF,
      activo,
      categoria:      categoria      || null,
      subcategoria:   subcategoria   || null,
      etiqueta:       etiqueta       || null,
      persona:        persona        || null,
      moneda,
      banco:          banco          || null,
      montoEsperado:  montoNum,
      diaVencimiento: diaNum,
      autoCalendario,
      notas:          notas          || null,
      tarjetaCodigo:  tarjetaCodigo  || null,
      matchTexto: (incluye.length > 0 || excluye.length > 0) ? { incluye, excluye } : null,
      periodicidad:   periodicidad as NuevoItemEsperado['periodicidad'],
      pagoAutomatico: pagoAuto,
    };

    setGuardando(true);
    const res = item
      ? await actualizarItemEsperado(item.id, payload)
      : await crearItemEsperado(payload);
    setGuardando(false);

    if (res.ok) onGuardado();
    else setErrorMsg(res.error.message);
  }

  return (
    <div className="cfg-overlay" role="dialog" aria-modal="true">
      <div className="cfg-panel">
        <div className="cfg-panel-header">
          <span className="cfg-panel-titulo">{item ? 'Editar' : 'Nuevo'} esperado</span>
          <button className="cfg-panel-cerrar" onClick={onCancelar} aria-label="Cerrar">✕</button>
        </div>

        <form className="cfg-form" onSubmit={handleSubmit}>

          {/* tipo + activo */}
          <div className="cfg-form-fila">
            <div className="cfg-campo">
              <label>Tipo</label>
              <select value={tipoF} onChange={e => setTipoF(e.target.value as 'Gasto' | 'Ingreso')}>
                <option value="Gasto">Gasto</option>
                <option value="Ingreso">Ingreso</option>
              </select>
            </div>
            <div className="cfg-campo">
              <label>Estado</label>
              <label className="cfg-toggle-fila">
                <input type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)} />
                Activo
              </label>
            </div>
          </div>

          {/* categoría + subcategoría */}
          <div className="cfg-form-fila">
            <div className="cfg-campo">
              <label>Categoría *</label>
              <select value={categoria} onChange={e => setCategoria(e.target.value)} required>
                <option value="">— elegir —</option>
                {categoriasDisp.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="cfg-campo">
              <label>Subcategoría *</label>
              <select
                value={subcategoria}
                onChange={e => setSubcategoria(e.target.value)}
                required
                disabled={!categoria}
              >
                <option value="">— elegir —</option>
                {subcatsFiltradas.map(s => <option key={s.id} value={s.valor}>{s.valor}</option>)}
              </select>
            </div>
          </div>

          {/* persona + moneda */}
          <div className="cfg-form-fila">
            <div className="cfg-campo">
              <label>Persona</label>
              <select value={persona} onChange={e => setPersona(e.target.value)}>
                <option value="">— ninguna —</option>
                {miembrosActivos.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </div>
            <div className="cfg-campo">
              <label>Moneda</label>
              <select value={moneda} onChange={e => setMoneda(e.target.value as 'ARS' | 'USD')}>
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>

          {/* tarjeta */}
          <div className="cfg-campo">
            <label>Tarjeta (opcional)</label>
            <select value={tarjetaCodigo} onChange={e => setTarjetaCodigo(e.target.value)}>
              <option value="">— ninguna —</option>
              {config.tarjetas.map(t => (
                <option key={t.codigo} value={t.codigo}>
                  {t.codigo} — {t.banco} {t.tipo}
                </option>
              ))}
            </select>
          </div>

          {/* monto + día vencimiento */}
          <div className="cfg-form-fila">
            <div className="cfg-campo">
              <label>Monto esperado (opcional)</label>
              <input
                type="text"
                inputMode="decimal"
                value={montoEsp}
                onChange={e => setMontoEsp(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="cfg-campo">
              <label>Día vencimiento (opcional)</label>
              <input
                type="number"
                min={1}
                max={31}
                value={diaVenc}
                onChange={e => setDiaVenc(e.target.value)}
                placeholder="1–31"
              />
            </div>
          </div>

          {/* periodicidad + toggles */}
          <div className="cfg-form-fila">
            <div className="cfg-campo">
              <label>Periodicidad</label>
              <select value={periodicidad} onChange={e => setPeriodicidad(e.target.value)}>
                {PERIODICIDADES.map(p => (
                  <option key={p} value={p}>{PERIODICIDAD_LABEL[p]}</option>
                ))}
              </select>
            </div>
            <div className="cfg-campo">
              <label>Opciones</label>
              <label className="cfg-toggle-fila">
                <input type="checkbox" checked={pagoAuto} onChange={e => setPagoAuto(e.target.checked)} />
                Pago automático
              </label>
              <label className="cfg-toggle-fila">
                <input
                  type="checkbox"
                  checked={autoCalendario}
                  onChange={e => setAutoCalendario(e.target.checked)}
                />
                Auto calendario
              </label>
            </div>
          </div>

          {/* matchTexto */}
          <div className="cfg-campo">
            <label>Textos que incluye (matchTexto)</label>
            <ChipEditor
              chips={incluye}
              input={incluyeInput}
              onInputChange={setIncluyeInput}
              onAdd={() => addChip(incluyeInput, incluye, setIncluye, setIncluyeInput)}
              onRemove={c => setIncluye(incluye.filter(x => x !== c))}
              placeholder="Agregar texto incluye... (Enter)"
            />
          </div>
          <div className="cfg-campo">
            <label>Textos que excluye</label>
            <ChipEditor
              chips={excluye}
              input={excluyeInput}
              onInputChange={setExcluyeInput}
              onAdd={() => addChip(excluyeInput, excluye, setExcluye, setExcluyeInput)}
              onRemove={c => setExcluye(excluye.filter(x => x !== c))}
              placeholder="Agregar texto excluye... (Enter)"
            />
          </div>

          {/* banco + etiqueta */}
          <div className="cfg-form-fila">
            <div className="cfg-campo">
              <label>Banco (opcional)</label>
              <select value={banco} onChange={e => setBanco(e.target.value)}>
                <option value="">— ninguno —</option>
                {config.bancos.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="cfg-campo">
              <label>Etiqueta (opcional)</label>
              <select value={etiqueta} onChange={e => setEtiqueta(e.target.value)}>
                <option value="">— ninguna —</option>
                {etiquetas.map(et => <option key={et.id} value={et.valor}>{et.valor}</option>)}
              </select>
            </div>
          </div>

          {/* notas */}
          <div className="cfg-campo">
            <label>Notas (opcional)</label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} />
          </div>

          {errorMsg && <p className="cfg-form-error" role="alert">{errorMsg}</p>}

          <div className="cfg-form-acciones">
            <button type="button" className="cfg-btn-sec" onClick={onCancelar} disabled={guardando}>
              Cancelar
            </button>
            <button type="submit" className="cfg-btn-pri" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

/* ── Admin panel ── */
function ConfigEsperadosAdmin() {
  const [tab,      setTab]      = useState<'Gasto' | 'Ingreso'>('Gasto');
  const [editando, setEditando] = useState<ExpectedItem | null>(null);
  const [creando,  setCreando]  = useState(false);
  const [subcats,  setSubcats]  = useState<SubcategoriaItem[]>([]);
  const [etiquetas,setEtiquetas]= useState<EtiquetaItem[]>([]);
  const [config,   setConfig]   = useState<FamiliaConfig | null>(null);

  const { items, cargando, error } = useItemsEsperados();

  useEffect(() => {
    Promise.all([cargarSubcategorias(), cargarEtiquetas(), cargarFamiliaConfig()])
      .then(([s, e, fam]) => { setSubcats(s); setEtiquetas(e); if (fam) setConfig(fam); });
  }, []);

  async function handleDesactivar(item: ExpectedItem) {
    const res = await desactivarItemEsperado(item.id);
    if (!res.ok) alert('Error al desactivar: ' + res.error.message);
  }
  async function handleReactivar(item: ExpectedItem) {
    const res = await reactivarItemEsperado(item.id);
    if (!res.ok) alert('Error al reactivar: ' + res.error.message);
  }
  async function handleEliminar(item: ExpectedItem) {
    if (!window.confirm('¿Eliminar permanentemente este ítem? No se puede deshacer.')) return;
    const res = await eliminarItemEsperado(item.id);
    if (!res.ok) alert('Error al eliminar: ' + res.error.message);
  }

  const delTab    = items.filter(i => i.tipo === tab);
  const activos   = delTab.filter(i => i.activo);
  const inactivos = delTab.filter(i => !i.activo);
  const mostrarForm = creando || editando !== null;

  return (
    <div className="cfg">
      <h1 className="cfg-titulo">Gastos y Cobros Esperados</h1>

      <div className="cfg-tabs">
        {(['Gasto', 'Ingreso'] as const).map(t => (
          <button
            key={t}
            className={`cfg-tab${tab === t ? ' cfg-tab--activo' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'Gasto' ? 'Gastos' : 'Ingresos'}
          </button>
        ))}
      </div>

      <div className="cfg-acciones">
        <button
          className="cfg-btn-nuevo"
          onClick={() => { setCreando(true); setEditando(null); }}
        >
          + Nuevo {tab === 'Gasto' ? 'gasto' : 'ingreso'} esperado
        </button>
      </div>

      {cargando && <p className="cfg-estado">Cargando…</p>}
      {error    && <p className="cfg-estado cfg-error">Error: {error}</p>}

      {!cargando && !error && (
        <>
          <ItemLista
            items={activos}
            onEditar={item => { setEditando(item); setCreando(false); }}
            onDesactivar={handleDesactivar}
            onEliminar={handleEliminar}
          />
          {inactivos.length > 0 && (
            <>
              <h3 className="cfg-seccion-sub">Inactivos</h3>
              <ItemLista
                items={inactivos}
                inactivos
                onEditar={item => { setEditando(item); setCreando(false); }}
                onReactivar={handleReactivar}
                onEliminar={handleEliminar}
              />
            </>
          )}
        </>
      )}

      {mostrarForm && config && (
        <FormItemEsperado
          key={editando?.id ?? 'nuevo'}
          item={editando ?? undefined}
          tipo={tab}
          items={items}
          subcats={subcats}
          etiquetas={etiquetas}
          config={config}
          onGuardado={() => { setCreando(false); setEditando(null); reload(); }}
          onCancelar={() => { setCreando(false); setEditando(null); }}
        />
      )}
    </div>
  );
}
