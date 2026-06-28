import { useEffect, useState } from 'react';
import { Icon } from '../../design-system/Icon';
import { Card, Money, Button } from '../../design-system/components';
import { AddBtn } from './shared';
import { useFamiliaConfig } from '../../hooks/useFamiliaConfig';
import { useMovimientosDelMes } from '../../hooks/useMovimientosDelMes';
import {
  cargarSubcategoriasAdmin, cargarEtiquetasAdmin,
  type SubcategoriaAdminItem, type EtiquetaAdminItem,
} from '../../datos/catalogos';
import { colorHash } from '../../datos/agregados';
import {
  crearCategoria, editarCategoria, desactivarCategoria, reactivarCategoria, eliminarCategoria,
  crearSubcategoria, editarSubcategoria, desactivarSubcategoria, reactivarSubcategoria, eliminarSubcategoria,
  crearEtiqueta, editarEtiqueta, desactivarEtiqueta, reactivarEtiqueta, eliminarEtiqueta,
} from '../../datos/configFamilia';
import type { CategoriaItem } from '../../types';

// F9.38 — CRUD real de Categorías/Subcategorías/Etiquetas (admin-only,
// sensible: la usa TODO — movimientos, Dashboard, clasificador, esperados).
// Cada alta/edición/baja pasa por guardarTaxonomia (callable); renombrar
// cascada el label viejo→nuevo en movimientos/diccionario server-side (ver
// docs/CLAUDE.md F9.38) — nunca un write directo a Firestore desde acá.
// useFamiliaConfig/loaders son one-shot: recargamos la página tras guardar,
// mismo patrón que Miembros.tsx.
// Etiquetas son un catálogo GLOBAL plano en el modelo real (sin nesting bajo
// subcategoría — movimientos.etiqueta es independiente de categoria/
// subcategoria) — se muestran en su propia sección, no como 3er nivel
// anidado dentro de cada categoría.

type Resultado = { ok: true; data: unknown } | { ok: false; error: Error };

const inputStyle: React.CSSProperties = {
  fontSize: 14, fontFamily: 'var(--font-base)', border: '1px solid var(--gf-gray-200)',
  borderRadius: 8, padding: '7px 10px', width: '100%', boxSizing: 'border-box',
  background: 'var(--color-surface)', color: 'var(--color-text)',
};

function mesActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function EditRow({ valor, placeholder, onGuardar, onCancelar, guardando, error }: {
  valor: string; placeholder: string;
  onGuardar: (nuevo: string) => void; onCancelar: () => void;
  guardando: boolean; error: string | null;
}) {
  const [texto, setTexto] = useState(valor);
  return (
    <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--gf-gray-50)' }}>
      <input value={texto} onChange={e => setTexto(e.target.value)} placeholder={placeholder} style={inputStyle} autoFocus />
      {error && <p style={{ fontSize: 12, color: 'var(--gf-err-text)', margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" size="sm" onClick={onCancelar} disabled={guardando}>Cancelar</Button>
        <Button variant="primary" size="sm" onClick={() => onGuardar(texto.trim())} disabled={guardando || !texto.trim()}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
      </div>
    </div>
  );
}

function NuevoRow({ placeholder, onGuardar, onCancelar, guardando, error }: {
  placeholder: string; onGuardar: (valor: string) => void; onCancelar: () => void;
  guardando: boolean; error: string | null;
}) {
  const [texto, setTexto] = useState('');
  return (
    <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--gf-gray-50)', borderRadius: 8 }}>
      <input value={texto} onChange={e => setTexto(e.target.value)} placeholder={placeholder} style={inputStyle} autoFocus />
      {error && <p style={{ fontSize: 12, color: 'var(--gf-err-text)', margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" size="sm" onClick={onCancelar} disabled={guardando}>Cancelar</Button>
        <Button variant="primary" size="sm" onClick={() => onGuardar(texto.trim())} disabled={guardando || !texto.trim()}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
      </div>
    </div>
  );
}

export default function Categorias() {
  const { config, cargando: cargandoConfig } = useFamiliaConfig();
  const { movimientos, cargando: cargandoMovs } = useMovimientosDelMes(mesActual());
  const [subcats, setSubcats] = useState<SubcategoriaAdminItem[] | null>(null);
  const [etiquetas, setEtiquetas] = useState<EtiquetaAdminItem[] | null>(null);

  const [catAbierta, setCatAbierta]       = useState<string | null>(null);
  const [catEditando, setCatEditando]     = useState<string | null>(null);
  const [agregandoCat, setAgregandoCat]   = useState(false);
  const [verCatInactivas, setVerCatInactivas] = useState(false);

  const [subEditando, setSubEditando]         = useState<string | null>(null);
  const [agregandoSubPara, setAgregandoSubPara] = useState<string | null>(null); // nombre de categoría

  const [etqEditando, setEtqEditando]     = useState<string | null>(null);
  const [agregandoEtq, setAgregandoEtq]   = useState(false);
  const [verEtqInactivas, setVerEtqInactivas] = useState(false);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cargarSubcategoriasAdmin().then(setSubcats);
    cargarEtiquetasAdmin().then(setEtiquetas);
  }, []);

  if (cargandoConfig || cargandoMovs || !subcats || !etiquetas) {
    return <p style={{ color: 'var(--color-text-sec)' }}>Cargando…</p>;
  }

  const gastos    = movimientos.filter(m => m.tipo === 'Gasto' && !m.excluirDash);
  const todasCats = config?.categorias ?? [];
  const catsActivas   = todasCats.filter(c => c.activo);
  const catsInactivas = todasCats.filter(c => !c.activo);
  const etqActivas    = etiquetas.filter(e => e.activo);
  const etqInactivas   = etiquetas.filter(e => !e.activo);

  function limpiar() { setError(null); }

  async function ejecutar(accion: () => Promise<Resultado>) {
    setGuardando(true);
    setError(null);
    const res = await accion();
    setGuardando(false);
    if (!res.ok) { setError(res.error.message); return; }
    window.location.reload();
  }

  function statsCategoria(nombre: string) {
    const movs = gastos.filter(m => (m.categoria ?? 'Sin categoría') === nombre);
    return { mov: movs.length, gasto: movs.reduce((s, m) => s + m.monto, 0) };
  }

  function renderSubcategoria(s: SubcategoriaAdminItem) {
    if (!s.activo) {
      return (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-sec)', textDecoration: 'line-through' }}>{s.valor}</span>
          <button onClick={() => ejecutar(() => reactivarSubcategoria(s.id))} disabled={guardando} style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-accent)', background: 'none', border: 'none', cursor: 'pointer' }}>Reactivar</button>
        </div>
      );
    }
    if (subEditando === s.id) {
      return (
        <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <EditRow
            valor={s.valor} placeholder="Subcategoría" guardando={guardando} error={error}
            onCancelar={() => { setSubEditando(null); limpiar(); }}
            onGuardar={nuevo => ejecutar(() => editarSubcategoria(s.id, nuevo))}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="sm" onClick={() => ejecutar(() => desactivarSubcategoria(s.id))} disabled={guardando}>Desactivar</Button>
            <Button variant="danger" size="sm" onClick={() => { if (confirm(`¿Eliminar "${s.valor}"? Si tiene movimientos, se va a desactivar en su lugar.`)) ejecutar(() => eliminarSubcategoria(s.id)); }} disabled={guardando}>Eliminar</Button>
          </div>
        </div>
      );
    }
    return (
      <button
        key={s.id}
        onClick={() => { setSubEditando(s.id); limpiar(); }}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-base)' }}
      >
        <span style={{ flex: 1, fontSize: 13 }}>{s.valor}</span>
        <Icon name="chevron-right" size={14} color="var(--gf-gray-300)" />
      </button>
    );
  }

  function renderCategoria(c: CategoriaItem) {
    const subs = subcats!.filter(s => s.categoriaPadre === c.nombre);
    const { mov, gasto } = statsCategoria(c.nombre);
    const expandida = catAbierta === c.id;
    const editando  = catEditando === c.id;

    return (
      <div key={c.id} style={{ borderBottom: '1px solid var(--gf-gray-100)' }}>
        <div
          onClick={() => !editando && setCatAbierta(expandida ? null : c.id)}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 10px', cursor: editando ? 'default' : 'pointer' }}
        >
          <span style={{ width: 14, height: 14, borderRadius: 5, background: colorHash(c.nombre), flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{c.nombre}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>
              {mov} {mov === 1 ? 'movimiento' : 'movimientos'} este mes · {subs.filter(s => s.activo).length} subcat.
            </div>
          </div>
          {gasto > 0 && <Money value={gasto} colored={false} decimals={0} style={{ fontSize: 13 }} />}
          <button
            onClick={e => { e.stopPropagation(); setCatEditando(editando ? null : c.id); limpiar(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-sec)', fontSize: 12, fontWeight: 600 }}
          >
            {editando ? 'Cerrar' : 'Editar'}
          </button>
          <Icon
            name="chevron-down" size={18} color="var(--gf-gray-300)"
            style={{ transition: 'transform .15s', transform: expandida ? 'rotate(180deg)' : 'none' }}
          />
        </div>

        {editando && (
          <>
            <EditRow
              valor={c.nombre} placeholder="Nombre de la categoría" guardando={guardando} error={error}
              onCancelar={() => { setCatEditando(null); limpiar(); }}
              onGuardar={nuevo => ejecutar(() => editarCategoria(c.id, nuevo))}
            />
            <div style={{ padding: '0 10px 12px', display: 'flex', gap: 8 }}>
              <Button variant="secondary" size="sm" onClick={() => ejecutar(() => desactivarCategoria(c.id))} disabled={guardando}>Desactivar</Button>
              <Button variant="danger" size="sm" onClick={() => { if (confirm(`¿Eliminar "${c.nombre}"? Si tiene movimientos o subcategorías, se va a desactivar en su lugar.`)) ejecutar(() => eliminarCategoria(c.id)); }} disabled={guardando}>Eliminar</Button>
            </div>
          </>
        )}

        {expandida && (
          <div style={{ padding: '0 10px 12px 36px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {subs.length === 0 && agregandoSubPara !== c.nombre && (
              <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 0 6px' }}>Sin subcategorías.</p>
            )}
            {subs.map(renderSubcategoria)}
            {agregandoSubPara === c.nombre ? (
              <NuevoRow
                placeholder="Nueva subcategoría" guardando={guardando} error={error}
                onCancelar={() => { setAgregandoSubPara(null); limpiar(); }}
                onGuardar={valor => ejecutar(() => crearSubcategoria(c.nombre, valor))}
              />
            ) : (
              <button
                onClick={() => { setAgregandoSubPara(c.nombre); limpiar(); }}
                style={{ alignSelf: 'flex-start', marginTop: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-accent)', fontSize: 13, fontWeight: 600, padding: '4px 0' }}
              >
                + Agregar subcategoría
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderEtiqueta(e: EtiquetaAdminItem) {
    if (!e.activo) {
      return (
        <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px' }}>
          <span style={{ flex: 1, fontSize: 14, color: 'var(--color-text-sec)', textDecoration: 'line-through' }}>{e.valor}</span>
          <Button variant="secondary" size="sm" onClick={() => ejecutar(() => reactivarEtiqueta(e.id))} disabled={guardando}>Reactivar</Button>
        </div>
      );
    }
    if (etqEditando === e.id) {
      return (
        <div key={e.id} style={{ borderBottom: '1px solid var(--gf-gray-100)' }}>
          <EditRow
            valor={e.valor} placeholder="Etiqueta" guardando={guardando} error={error}
            onCancelar={() => { setEtqEditando(null); limpiar(); }}
            onGuardar={nuevo => ejecutar(() => editarEtiqueta(e.id, nuevo))}
          />
          <div style={{ padding: '0 10px 12px', display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="sm" onClick={() => ejecutar(() => desactivarEtiqueta(e.id))} disabled={guardando}>Desactivar</Button>
            <Button variant="danger" size="sm" onClick={() => { if (confirm(`¿Eliminar "${e.valor}"? Si tiene movimientos, se va a desactivar en su lugar.`)) ejecutar(() => eliminarEtiqueta(e.id)); }} disabled={guardando}>Eliminar</Button>
          </div>
        </div>
      );
    }
    return (
      <button
        key={e.id}
        onClick={() => { setEtqEditando(e.id); limpiar(); }}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px', borderBottom: '1px solid var(--gf-gray-100)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-base)' }}
      >
        <span style={{ flex: 1, fontSize: 14 }}>{e.valor}</span>
        <Icon name="chevron-right" size={16} color="var(--gf-gray-300)" />
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Card padding="var(--space-2)">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {catsActivas.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-sec)', padding: '12px 10px' }}>Sin categorías configuradas.</p>
            ) : catsActivas.map(renderCategoria)}
          </div>
        </Card>

        {agregandoCat ? (
          <Card padding="0">
            <NuevoRow
              placeholder="Nueva categoría" guardando={guardando} error={error}
              onCancelar={() => { setAgregandoCat(false); limpiar(); }}
              onGuardar={nombre => ejecutar(() => crearCategoria(nombre))}
            />
          </Card>
        ) : (
          <AddBtn onClick={() => { setAgregandoCat(true); limpiar(); }}><Icon name="plus" size={18} /> Agregar categoría</AddBtn>
        )}

        {catsInactivas.length > 0 && (
          <div>
            <button
              onClick={() => setVerCatInactivas(v => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 12, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', padding: 0 }}
            >
              {verCatInactivas ? '▾' : '▸'} Inactivas ({catsInactivas.length})
            </button>
            {verCatInactivas && (
              <Card padding="var(--space-2)" style={{ marginTop: 8 }}>
                {catsInactivas.map((c, i) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px', borderBottom: i < catsInactivas.length - 1 ? '1px solid var(--gf-gray-100)' : 'none', opacity: 0.6 }}>
                    <span style={{ flex: 1, fontSize: 14 }}>{c.nombre}</span>
                    <Button variant="secondary" size="sm" onClick={() => ejecutar(() => reactivarCategoria(c.id))} disabled={guardando}>Reactivar</Button>
                  </div>
                ))}
              </Card>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 4px' }}>Etiquetas</p>
        <Card padding="0">
          {etqActivas.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-sec)', padding: '12px 10px' }}>Sin etiquetas configuradas.</p>
          ) : etqActivas.map(renderEtiqueta)}
        </Card>

        {agregandoEtq ? (
          <Card padding="0">
            <NuevoRow
              placeholder="Nueva etiqueta" guardando={guardando} error={error}
              onCancelar={() => { setAgregandoEtq(false); limpiar(); }}
              onGuardar={valor => ejecutar(() => crearEtiqueta(valor))}
            />
          </Card>
        ) : (
          <AddBtn onClick={() => { setAgregandoEtq(true); limpiar(); }}><Icon name="plus" size={18} /> Agregar etiqueta</AddBtn>
        )}

        {etqInactivas.length > 0 && (
          <div>
            <button
              onClick={() => setVerEtqInactivas(v => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 12, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', padding: 0 }}
            >
              {verEtqInactivas ? '▾' : '▸'} Inactivas ({etqInactivas.length})
            </button>
            {verEtqInactivas && (
              <Card padding="var(--space-2)" style={{ marginTop: 8 }}>
                {etqInactivas.map(renderEtiqueta)}
              </Card>
            )}
          </div>
        )}
      </div>

      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Renombrar actualiza automáticamente los movimientos existentes. Un nodo con movimientos
        asociados no se puede eliminar — se desactiva en su lugar y deja de aparecer para elegir,
        pero los movimientos históricos no se tocan.
      </p>
    </div>
  );
}
