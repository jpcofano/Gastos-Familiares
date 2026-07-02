import { useState, useEffect, useRef, useCallback } from 'react';
import { cargarSubcategorias, cargarEtiquetas, type SubcategoriaItem, type EtiquetaItem } from '../datos/catalogos';
import { cargarFamiliaConfig } from '../familia';
import { crearMovimiento, existeNumeroComprobante } from '../datos/movimientos';
import { tcParaFecha } from '../datos/tcDiario';
import { useDiccionario } from '../contexto/DiccionarioContext';
import { CONFIANZA_UMBRAL } from '../datos/clasificador';
import { FullModal, ModalBar, Hero, Drawer, SectionLabel, CtaBar } from '../design-system/shell';
import { FieldRow, RadioChip, Button, Money } from '../design-system/components';
import type { FamiliaConfig, FamiliaMiembro } from '../types';

// F9.34 — re-skin mobile (FullModal/Hero/Drawer/CtaBar, kit ManualGasto.jsx).
// Solo presentación: el form, la validación, crearMovimiento/tcParaFecha/
// clasificador/memberId de abajo quedan intactos — ver F9.26 (restauración
// real de este componente) para la lógica.

const selectStyle: React.CSSProperties = {
  fontSize: 16, fontWeight: 600, border: 'none', outline: 'none', background: 'transparent',
  textAlign: 'right', width: '100%', fontFamily: 'var(--font-base)', cursor: 'pointer',
  WebkitAppearance: 'none', appearance: 'none',
};

interface Preload {
  tipo?: 'Gasto' | 'Ingreso';
  fecha?: string;           // ISO YYYY-MM-DD
  descripcion?: string;
  descripcionOriginal?: string; // F6.4.5 addendum_2 — cruda, para trazabilidad si descripcion viene limpia
  categoria?: string;
  subcategoria?: string;
  etiqueta?: string;
  banco?: string;
  persona?: string;
  moneda?: 'ARS' | 'USD';
  monto?: string;
  itemEsperadoId?: string;
  // F6.3 — link a comprobante
  hashPdf?: string;
  refStoragePdf?: string;
  confirmadoPago?: boolean;
  // F6.4 — alta manual sin comprobante
  esManual?: boolean;
  // F6.8 — destino del pago (propagado desde datosExtraidos)
  destinoCbu?: string | null;
  destinoCuit?: string | null;
  destinoAlias?: string | null;
  destinoNombre?: string | null;
  vencimientos?: Array<{ fecha: string | null; monto: number | null }> | null;
  // F6.x descartar — stamp de procedencia
  origenComprobanteId?: string;
}

function generarNumeroManual(fecha: string, texto: string): string {
  const mes = fecha.slice(0, 7);
  const slug = texto
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 12);
  return `${mes}-${slug || 'manual'}`;
}

interface Props {
  memberId: string;
  miembro: FamiliaMiembro;
  onGuardado: () => void;
  onCancelar: () => void;
  preload?: Preload;
  // F6.9.11 — ruteo a callable server-side (atómico, owner-scoped) en vez de crearMovimiento client-side
  onGuardarPayload?: (payload: Parameters<typeof crearMovimiento>[0]) => Promise<{ ok: boolean; error?: Error }>;
}

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AltaMovimiento({ memberId, miembro, onGuardado, onCancelar, preload, onGuardarPayload }: Props) {
  const esAdmin = miembro.rol === 'admin';
  const { clasificar, cargando: cargandoDict } = useDiccionario();

  const [cargandoCatalogos, setCargandoCatalogos] = useState(true);
  const [subcats,   setSubcats]   = useState<SubcategoriaItem[]>([]);
  const [etiquetas, setEtiquetas] = useState<EtiquetaItem[]>([]);
  const [config,    setConfig]    = useState<FamiliaConfig | null>(null);

  const [fecha,             setFecha]             = useState(preload?.fecha ?? hoyISO());
  const [tipo,              setTipo]              = useState<'Gasto' | 'Ingreso'>(preload?.tipo ?? 'Gasto');
  const [descripcion,       setDescripcion]       = useState(preload?.descripcion ?? '');
  const [monto,             setMonto]             = useState(preload?.monto ?? '');
  const [moneda,            setMoneda]            = useState<'ARS' | 'USD'>(preload?.moneda ?? 'ARS');
  const [categoria,         setCategoria]         = useState(preload?.categoria ?? '');
  const [subcategoria,      setSubcategoria]      = useState(preload?.subcategoria ?? '');
  const [etiqueta,          setEtiqueta]          = useState(preload?.etiqueta ?? '');
  const [banco,             setBanco]             = useState(preload?.banco ?? '');
  const [persona,           setPersona]           = useState(preload?.persona ?? memberId);
  const [incluirResumenMes, setIncluirResumenMes] = useState(
    () => (preload?.fecha ?? hoyISO()) > hoyISO()
  );

  const subcatInitCatRef = useRef(preload?.categoria ?? null); // categoría preloadeada: no limpiar mientras coincida
  const suggestionRef    = useRef(false); // señal para que el reset no borre la subcategoría sugerida

  const [tcUsdArs,    setTcUsdArs]    = useState<number | null>(null);
  const [tcCargando,  setTcCargando]  = useState(false);
  const [guardando,   setGuardando]   = useState(false);
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);
  const [dupWarning,  setDupWarning]  = useState(false);
  const pendingPayload = useRef<Parameters<typeof crearMovimiento>[0] | null>(null);

  useEffect(() => {
    Promise.all([cargarSubcategorias(), cargarEtiquetas(), cargarFamiliaConfig()])
      .then(([s, e, fam]) => {
        setSubcats(s);
        setEtiquetas(e);
        if (fam) {
          setConfig(fam);
          if (esAdmin && !preload?.persona) {
            const primero = Object.keys(fam.miembros).find(k => fam.miembros[k].activo);
            if (primero) setPersona(primero);
          }
        }
        setCargandoCatalogos(false);
      });
  }, [esAdmin]);

  // Reset subcategoria cuando cambia la categoría (saltar mount inicial y cambios de sugerencia)
  useEffect(() => {
    // No limpiar mientras categoria siga siendo el valor preloadeado.
    // Cubre el doble-fire de React Strict Mode que agotaba el flag booleano anterior.
    if (subcatInitCatRef.current !== null && categoria === subcatInitCatRef.current) return;
    subcatInitCatRef.current = null; // consumido: desde aquí cualquier cambio limpia
    if (suggestionRef.current) { suggestionRef.current = false; return; }
    setSubcategoria('');
  }, [categoria]);

  // Sugerencia de categoría/subcategoría/moneda desde el diccionario al cambiar descripción
  useEffect(() => {
    if (cargandoCatalogos || cargandoDict) return;
    if (categoria !== '') return; // no pisar elección del usuario
    const norm = descripcion.trim();
    if (!norm) return;
    const sug = clasificar(norm);
    if (!sug || sug.confianza < CONFIANZA_UMBRAL) return;
    suggestionRef.current = true;
    setCategoria(sug.categoria);
    if (sug.subcategoria) setSubcategoria(sug.subcategoria);
    if (sug.monedaDefault && moneda === 'ARS') setMoneda(sug.monedaDefault);
  }, [descripcion, cargandoCatalogos, cargandoDict, clasificar, moneda]);

  // Lookup TC al cambiar fecha o moneda
  useEffect(() => {
    if (moneda === 'ARS') { setTcUsdArs(null); return; }
    setTcCargando(true);
    tcParaFecha(new Date(fecha + 'T12:00:00')).then(tc => {
      setTcUsdArs(tc);
      if (tc === null) console.warn('[AltaMovimiento] tcUsdArs null para', fecha);
      setTcCargando(false);
    });
  }, [fecha, moneda]);

  const subcatsFiltradas = subcats.filter(s => s.categoriaPadre === categoria);
  const categoriasDisp   = config ? config.categorias.filter(c => c.activo).map(c => c.nombre).sort() : [];
  const bancosDisp       = config ? config.bancos.map(b => b.nombre) : [];
  const miembrosActivos  = config
    ? Object.entries(config.miembros)
        .filter(([, m]) => m.activo)
        .map(([id, m]) => ({ id, nombre: m.nombre }))
    : [];

  const ejecutarGuardar = useCallback(async (payload: Parameters<typeof crearMovimiento>[0]) => {
    setGuardando(true);
    const resultado = onGuardarPayload
      ? await onGuardarPayload(payload)
      : await crearMovimiento(payload);
    setGuardando(false);
    if (resultado.ok) {
      onGuardado();
    } else {
      setErrorMsg(resultado.error?.message ?? 'Error al guardar');
    }
  }, [onGuardado, onGuardarPayload]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setDupWarning(false);

    if (!categoria)    { setErrorMsg('La categoría es obligatoria.');    return; }
    if (!subcategoria) { setErrorMsg('La subcategoría es obligatoria.'); return; }

    const montoNum = parseFloat(monto.replace(',', '.'));
    if (isNaN(montoNum) || montoNum <= 0) {
      setErrorMsg('El monto debe ser mayor que cero.');
      return;
    }

    // F9.63 — estado de pago derivado de la fecha FINAL del movimiento (post-edición),
    // no del preload. fecha ≤ hoy → pagado/confirmado; futura → pendiente. Un solo booleano
    // alimenta `pagado` y `confirmadoPago` (fuente única de la regla en el front).
    const pagadoPorFecha = fecha <= hoyISO();
    const payload: Parameters<typeof crearMovimiento>[0] = {
      fecha:             new Date(fecha + 'T12:00:00'),
      tipo,
      descripcion,
      descripcionOriginal: preload?.descripcionOriginal,
      monto:             montoNum,
      moneda,
      tcUsdArs:          tcUsdArs,
      categoria,
      subcategoria,
      etiqueta:          etiqueta  || null,
      banco:             banco     || null,
      persona,
      creadoPor:         memberId,
      incluirResumenMes,
      itemEsperadoId:    preload?.itemEsperadoId,
      hashPdf:           preload?.hashPdf,
      refStoragePdf:     preload?.refStoragePdf,
      pagado:            pagadoPorFecha,
      confirmadoPago:    pagadoPorFecha,
      destinoCbu:           preload?.destinoCbu            ?? null,
      destinoCuit:          preload?.destinoCuit           ?? null,
      destinoAlias:         preload?.destinoAlias          ?? null,
      destinoNombre:        preload?.destinoNombre         ?? null,
      vencimientos:         preload?.vencimientos          ?? null,
      origenComprobanteId:  preload?.origenComprobanteId,
      // F6.9.11 — usados solo por la callable (vía onGuardarPayload); crearMovimiento los ignora
      fechaMs: new Date(fecha + 'T12:00:00').getTime(),
      mes:     `${new Date(fecha + 'T12:00:00').getFullYear()}-${String(new Date(fecha + 'T12:00:00').getMonth() + 1).padStart(2, '0')}`,
    };

    if (preload?.esManual) {
      const numero = generarNumeroManual(fecha, descripcion || categoria);
      payload.numeroComprobante = numero;
      const existe = await existeNumeroComprobante(numero);
      if (existe) {
        pendingPayload.current = payload;
        setDupWarning(true);
        return;
      }
    }

    await ejecutarGuardar(payload);
  };

  if (cargandoCatalogos) {
    return (
      <FullModal>
        <ModalBar title="Nuevo movimiento" onClose={onCancelar} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
          Cargando catálogos…
        </div>
      </FullModal>
    );
  }

  const montoNum = Number(monto.replace(',', '.')) || 0;
  const tags = [moneda, ...(banco ? [banco] : []), incluirResumenMes ? 'En resumen' : null].filter((t): t is string => Boolean(t));

  return (
    <FullModal>
      <ModalBar title={preload?.esManual ? 'Alta manual' : 'Nuevo movimiento'} onClose={onCancelar} />
      <Hero
        eyebrow={tipo === 'Gasto' ? 'Gasto manual' : 'Ingreso manual'}
        amount={<Money value={montoNum} currency={moneda} tipo={tipo} />}
        desc={descripcion || categoria || undefined}
        tags={tags}
      />
      <form onSubmit={handleSubmit} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Drawer>
          <FieldRow label="Fecha" last={false}>
            <input
              id="alta-fecha"
              type="date"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
              required
              style={selectStyle}
            />
          </FieldRow>

          <div style={{ padding: '14px 0', borderBottom: '1px solid var(--gf-gray-100)' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)', display: 'block', marginBottom: 8 }}>Tipo</span>
            <RadioChip options={['Gasto', 'Ingreso']} value={tipo} onChange={v => setTipo(v as 'Gasto' | 'Ingreso')} name="tipo" />
          </div>

          <FieldRow
            label="Descripción"
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            placeholder="¿En qué?"
            required
          />

          <FieldRow label="Monto" required>
            <input
              id="alta-monto"
              type="text"
              inputMode="decimal"
              value={monto}
              onChange={e => setMonto(e.target.value)}
              placeholder="0.00"
              required
              style={selectStyle}
            />
          </FieldRow>

          <FieldRow label="Moneda">
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <select id="alta-moneda" value={moneda} onChange={e => setMoneda(e.target.value as 'ARS' | 'USD')} style={selectStyle}>
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
              {moneda === 'USD' && (
                <span style={{ fontSize: 11, color: 'var(--gf-gray-400)' }}>
                  {tcCargando ? 'Buscando TC…' : tcUsdArs !== null ? `TC $${tcUsdArs.toLocaleString('es-AR')}` : 'Sin TC — se guardará null'}
                </span>
              )}
            </div>
          </FieldRow>

          <FieldRow label="Categoría" required>
            <select id="alta-cat" value={categoria} onChange={e => setCategoria(e.target.value)} required style={selectStyle}>
              <option value="">— elegir —</option>
              {categoriasDisp.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </FieldRow>

          <FieldRow label="Subcategoría" required>
            <select id="alta-subcat" value={subcategoria} onChange={e => setSubcategoria(e.target.value)} required disabled={!categoria} style={selectStyle}>
              <option value="">— elegir —</option>
              {subcatsFiltradas.map(s => <option key={s.id} value={s.valor}>{s.valor}</option>)}
            </select>
          </FieldRow>

          <FieldRow label="Etiqueta">
            <select id="alta-etiq" value={etiqueta} onChange={e => setEtiqueta(e.target.value)} style={selectStyle}>
              <option value="">— ninguna —</option>
              {etiquetas.map(et => <option key={et.id} value={et.valor}>{et.valor}</option>)}
            </select>
          </FieldRow>

          <FieldRow label="Banco">
            <select id="alta-banco" value={banco} onChange={e => setBanco(e.target.value)} style={selectStyle}>
              <option value="">— ninguno —</option>
              {bancosDisp.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </FieldRow>

          {esAdmin ? (
            <FieldRow label="Persona">
              <select id="alta-persona" value={persona} onChange={e => setPersona(e.target.value)} style={selectStyle}>
                {miembrosActivos.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </FieldRow>
          ) : (
            <FieldRow label="Persona" value={miembro.nombre} readOnly />
          )}

          <SectionLabel>Estado</SectionLabel>
          <FieldRow label="Incluir en resumen del mes" last>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <span style={{ fontSize: 15, color: 'var(--color-text-sec)', fontWeight: 600 }}>{incluirResumenMes ? 'Sí' : 'No'}</span>
              <input
                id="alta-incluir"
                type="checkbox"
                checked={incluirResumenMes}
                onChange={e => setIncluirResumenMes(e.target.checked)}
                style={{ width: 20, height: 20, accentColor: 'var(--color-accent)', cursor: 'pointer' }}
              />
            </label>
          </FieldRow>
          <div style={{ height: 12 }} />
        </Drawer>

        <CtaBar>
          {errorMsg && <p style={{ color: 'var(--gf-err-text)', fontSize: 13, margin: 0 }} role="alert">{errorMsg}</p>}

          {dupWarning ? (
            <>
              <p style={{ fontSize: 13, color: 'var(--color-text-sec)', margin: 0 }} role="alert">
                Ya hay un movimiento con este número. ¿Cargar igual?
              </p>
              <Button type="button" variant="secondary" size="cta" onClick={() => setDupWarning(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                size="cta"
                disabled={guardando}
                onClick={() => { if (pendingPayload.current) ejecutarGuardar(pendingPayload.current); }}
              >
                {guardando ? 'Guardando…' : 'Cargar igual'}
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
            </>
          )}
        </CtaBar>
      </form>
    </FullModal>
  );
}
