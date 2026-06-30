import { useState, useEffect, useRef } from 'react';
import { cargarSubcategorias, type SubcategoriaItem } from '../datos/catalogos';
import { cargarFamiliaConfig } from '../familia';
import { llamarEditarMovimiento, llamarEliminarMovimiento, type CambiosMovimiento } from '../datos/movimientos';
import { tcParaFecha } from '../datos/tcDiario';
import { mediosVisibles } from '../datos/medios';
import { FullModal, ModalBar, Hero, Drawer, SectionLabel, CtaBar } from '../design-system/shell';
import { FieldRow, RadioChip, Button, Money } from '../design-system/components';
import { Icon } from '../design-system/Icon';
import type { Movement, FamiliaConfig } from '../types';

// F9.53 — Editor de movimientos existentes (admin-only). Carga el movimiento
// preseleccionado, permite editar los campos del spec (no agrega campos nuevos:
// descripcion, monto, fecha, tipo, moneda, categoria, subcat, persona, medio).
// Guardar → editarMovimiento callable; Eliminar (con confirmación) →
// eliminarMovimiento callable. Aviso ámbar si viene de resumen de tarjeta.

const selectStyle: React.CSSProperties = {
  fontSize: 16, fontWeight: 600, border: 'none', outline: 'none', background: 'transparent',
  textAlign: 'right', width: '100%', fontFamily: 'var(--font-base)', cursor: 'pointer',
  WebkitAppearance: 'none', appearance: 'none',
};

interface Props {
  movimiento: Movement;
  onGuardado: () => void;
  onEliminado: () => void;
  onCancelar: () => void;
}

export default function EditarMovimiento({ movimiento: m, onGuardado, onEliminado, onCancelar }: Props) {
  const [cargando, setCargando]     = useState(true);
  const [subcats,  setSubcats]      = useState<SubcategoriaItem[]>([]);
  const [config,   setConfig]       = useState<FamiliaConfig | null>(null);

  const isoFecha = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const [fecha,       setFecha]       = useState(isoFecha(m.fecha));
  const [tipo,        setTipo]        = useState<'Gasto' | 'Ingreso'>(m.tipo);
  const [descripcion, setDescripcion] = useState(m.descripcion);
  const [monto,       setMonto]       = useState(String(m.monto));
  const [moneda,      setMoneda]      = useState<'ARS' | 'USD'>(m.moneda);
  const [categoria,   setCategoria]   = useState(m.categoria ?? '');
  const [subcategoria,setSubcategoria]= useState(m.subcategoria ?? '');
  const [banco,       setBanco]       = useState(m.banco ?? '');
  const [persona,     setPersona]     = useState(m.persona ?? '');

  const [tcUsdArs,   setTcUsdArs]    = useState<number | null>(m.tcUsdArs);
  const [tcCargando, setTcCargando]  = useState(false);
  const [guardando,  setGuardando]   = useState(false);
  const [eliminando, setEliminando]  = useState(false);
  const [confirmar,  setConfirmar]   = useState(false);
  const [errorMsg,   setErrorMsg]    = useState<string | null>(null);

  const subcatInitCatRef = useRef(m.categoria ?? null);

  useEffect(() => {
    Promise.all([cargarSubcategorias(), cargarFamiliaConfig()])
      .then(([s, fam]) => {
        setSubcats(s);
        if (fam) setConfig(fam);
        setCargando(false);
      });
  }, []);

  // Reset subcat cuando cambia categoría (saltear el valor inicial)
  useEffect(() => {
    if (subcatInitCatRef.current !== null && categoria === subcatInitCatRef.current) return;
    subcatInitCatRef.current = null;
    setSubcategoria('');
  }, [categoria]);

  // TC cuando cambia fecha o moneda
  useEffect(() => {
    if (moneda === 'ARS') { setTcUsdArs(null); return; }
    setTcCargando(true);
    tcParaFecha(new Date(fecha + 'T12:00:00')).then(tc => {
      setTcUsdArs(tc);
      setTcCargando(false);
    });
  }, [fecha, moneda]);

  const subcatsFiltradas  = subcats.filter(s => s.categoriaPadre === categoria);
  const categoriasDisp    = config ? config.categorias.filter(c => c.activo).map(c => c.nombre).sort() : [];
  const bancosDisp        = config ? mediosVisibles(config.bancos).map(b => b.nombre) : [];
  const miembrosActivos   = config
    ? Object.entries(config.miembros).filter(([, mb]) => mb.activo).map(([id, mb]) => ({ id, nombre: mb.nombre }))
    : [];

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const montoNum = parseFloat(monto.replace(',', '.'));
    if (isNaN(montoNum) || montoNum <= 0) { setErrorMsg('El monto debe ser mayor que cero.'); return; }

    const cambios: CambiosMovimiento = {};

    if (descripcion.trim() !== m.descripcion) cambios.descripcion = descripcion.trim();
    if (montoNum !== m.monto)                 cambios.monto = montoNum;
    if (fecha !== isoFecha(m.fecha))           cambios.fecha = fecha;
    if (tipo !== m.tipo)                       cambios.tipo = tipo;
    if (moneda !== m.moneda)                   cambios.moneda = moneda;
    if (categoria !== (m.categoria ?? ''))     cambios.categoria = categoria || null;
    if (subcategoria !== (m.subcategoria ?? '')) cambios.subcat = subcategoria || null;
    if (persona !== (m.persona ?? ''))         cambios.persona = persona || null;
    if (banco !== (m.banco ?? ''))             cambios.medio = banco || null;

    if (Object.keys(cambios).length === 0) { onGuardado(); return; }

    setGuardando(true);
    const res = await llamarEditarMovimiento(m.id, cambios);
    setGuardando(false);
    if (res.ok) { onGuardado(); }
    else { setErrorMsg(res.error?.message ?? 'Error al guardar'); }
  };

  const handleEliminar = async () => {
    setEliminando(true);
    const res = await llamarEliminarMovimiento(m.id);
    setEliminando(false);
    if (res.ok) { onEliminado(); }
    else { setErrorMsg(res.error?.message ?? 'Error al eliminar'); setConfirmar(false); }
  };

  if (cargando) {
    return (
      <FullModal>
        <ModalBar title="Editar movimiento" onClose={onCancelar} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
          Cargando catálogos…
        </div>
      </FullModal>
    );
  }

  const montoNum = Number(monto.replace(',', '.')) || 0;
  const tags = [moneda, ...(banco ? [banco] : [])].filter(Boolean) as string[];
  const esDeTarjeta = Boolean(m.resumenTarjetaId);

  return (
    <FullModal>
      <ModalBar title="Editar movimiento" onClose={onCancelar} />
      <Hero
        eyebrow={tipo === 'Gasto' ? 'Editando gasto' : 'Editando ingreso'}
        amount={<Money value={montoNum} currency={moneda} tipo={tipo} />}
        desc={descripcion || categoria || undefined}
        tags={tags}
      />
      <form onSubmit={handleGuardar} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Drawer>
          {esDeTarjeta && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', background: 'var(--gf-amber-50, #fffbeb)', borderBottom: '1px solid var(--gf-gray-100)', borderRadius: '4px 4px 0 0' }}>
              <Icon name="triangle-alert" size={15} color="var(--gf-amber-600, #d97706)" style={{ marginTop: 1, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--gf-amber-700, #b45309)', fontWeight: 500 }}>
                Este movimiento viene de un resumen de tarjeta. Podés editarlo igual, pero hacelo con cuidado — los totales se recalculan solos.
              </span>
            </div>
          )}

          <FieldRow label="Fecha" last={false}>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required style={selectStyle} />
          </FieldRow>

          <div style={{ padding: '14px 0', borderBottom: '1px solid var(--gf-gray-100)' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)', display: 'block', marginBottom: 8 }}>Tipo</span>
            <RadioChip options={['Gasto', 'Ingreso']} value={tipo} onChange={v => setTipo(v as 'Gasto' | 'Ingreso')} name="editar-tipo" />
          </div>

          <FieldRow label="Descripción" value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="¿En qué?" required />

          <FieldRow label="Monto" required>
            <input
              type="text" inputMode="decimal" value={monto}
              onChange={e => setMonto(e.target.value)}
              placeholder="0.00" required style={selectStyle}
            />
          </FieldRow>

          <FieldRow label="Moneda">
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <select value={moneda} onChange={e => setMoneda(e.target.value as 'ARS' | 'USD')} style={selectStyle}>
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
              {moneda === 'USD' && (
                <span style={{ fontSize: 11, color: 'var(--gf-gray-400)' }}>
                  {tcCargando ? 'Buscando TC…' : tcUsdArs !== null ? `TC $${tcUsdArs.toLocaleString('es-AR')}` : 'Sin TC'}
                </span>
              )}
            </div>
          </FieldRow>

          <FieldRow label="Categoría" required>
            <select value={categoria} onChange={e => setCategoria(e.target.value)} required style={selectStyle}>
              <option value="">— elegir —</option>
              {categoriasDisp.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </FieldRow>

          <FieldRow label="Subcategoría">
            <select value={subcategoria} onChange={e => setSubcategoria(e.target.value)} disabled={!categoria} style={selectStyle}>
              <option value="">— ninguna —</option>
              {subcatsFiltradas.map(s => <option key={s.id} value={s.valor}>{s.valor}</option>)}
            </select>
          </FieldRow>

          <FieldRow label="Banco">
            <select value={banco} onChange={e => setBanco(e.target.value)} style={selectStyle}>
              <option value="">— ninguno —</option>
              {bancosDisp.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </FieldRow>

          <FieldRow label="Persona" last>
            <select value={persona} onChange={e => setPersona(e.target.value)} style={selectStyle}>
              <option value="">— familiar —</option>
              {miembrosActivos.map(mb => <option key={mb.id} value={mb.id}>{mb.nombre}</option>)}
            </select>
          </FieldRow>
          <div style={{ height: 12 }} />

          <SectionLabel>Datos originales</SectionLabel>
          <FieldRow label="Subtipo" value={m.subtipo} readOnly />
          <FieldRow label="Origen"  value={m.origen}  readOnly last />
          <div style={{ height: 12 }} />
        </Drawer>

        <CtaBar>
          {errorMsg && <p style={{ color: 'var(--gf-err-text)', fontSize: 13, margin: 0 }} role="alert">{errorMsg}</p>}

          {confirmar ? (
            <>
              <p style={{ fontSize: 13, color: 'var(--color-text-sec)', margin: 0 }} role="alert">
                ¿Eliminar este movimiento? Esta acción no se puede deshacer.
              </p>
              <Button type="button" variant="secondary" size="cta" onClick={() => setConfirmar(false)} disabled={eliminando}>
                Cancelar
              </Button>
              <Button type="button" variant="primary" size="cta" onClick={handleEliminar} disabled={eliminando}
                style={{ background: 'var(--gf-err-text)', borderColor: 'var(--gf-err-text)' }}>
                {eliminando ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </>
          ) : (
            <>
              <Button type="submit" variant="primary" size="cta" disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </Button>
              <Button type="button" variant="secondary" size="cta" onClick={onCancelar} disabled={guardando}>
                Cancelar
              </Button>
              <button
                type="button"
                onClick={() => setConfirmar(true)}
                disabled={guardando}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gf-err-text)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-base)', padding: '4px 0' }}
              >
                <Icon name="trash-2" size={14} /> Eliminar
              </button>
            </>
          )}
        </CtaBar>
      </form>
    </FullModal>
  );
}
