import { useState, useEffect, useRef, useCallback } from 'react';
import { cargarSubcategorias, cargarEtiquetas, type SubcategoriaItem, type EtiquetaItem } from '../datos/catalogos';
import { cargarFamiliaConfig } from '../familia';
import { crearMovimiento, existeNumeroComprobante } from '../datos/movimientos';
import { tcParaFecha } from '../datos/tcDiario';
import { useDiccionario } from '../contexto/DiccionarioContext';
import { CONFIANZA_UMBRAL } from '../datos/clasificador';
import type { FamiliaConfig, FamiliaMiembro } from '../types';
import './AltaMovimiento.css';

interface Preload {
  tipo?: 'Gasto' | 'Ingreso';
  fecha?: string;           // ISO YYYY-MM-DD
  descripcion?: string;
  descripcionOriginal?: string; // F6.4.5 addendum_2 — cruda, para trazabilidad si descripcion viene limpia
  categoria?: string;
  subcategoria?: string;
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
}

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AltaMovimiento({ memberId, miembro, onGuardado, onCancelar, preload }: Props) {
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
  const [etiqueta,          setEtiqueta]          = useState('');
  const [banco,             setBanco]             = useState('');
  const [persona,           setPersona]           = useState(preload?.persona ?? memberId);
  const [incluirResumenMes, setIncluirResumenMes] = useState(true);

  const subcatInitRef  = useRef(true);
  const suggestionRef  = useRef(false); // señal para que el reset no borre la subcategoría sugerida

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
    if (subcatInitRef.current) { subcatInitRef.current = false; return; }
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
  const categoriasDisp   = config ? [...config.categorias].sort() : [];
  const bancosDisp       = config ? config.bancos : [];
  const miembrosActivos  = config
    ? Object.entries(config.miembros)
        .filter(([, m]) => m.activo)
        .map(([id, m]) => ({ id, nombre: m.nombre }))
    : [];

  const ejecutarGuardar = useCallback(async (payload: Parameters<typeof crearMovimiento>[0]) => {
    setGuardando(true);
    const resultado = await crearMovimiento(payload);
    setGuardando(false);
    if (resultado.ok) {
      onGuardado();
    } else {
      setErrorMsg(resultado.error.message);
    }
  }, [onGuardado]);

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

    const payload: Parameters<typeof crearMovimiento>[0] = {
      fecha:             new Date(fecha + 'T12:00:00'),
      tipo,
      descripcion,
      descripcionOriginal: preload?.descripcionOriginal,
      monto:             montoNum,
      moneda,
      tcUsdArs:          moneda === 'USD' ? tcUsdArs : null,
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
      confirmadoPago:    preload?.confirmadoPago,
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
      <div className="alta-overlay">
        <div className="alta-panel">
          <p className="alta-estado">Cargando catálogos…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="alta-overlay" role="dialog" aria-modal="true" aria-label="Nuevo movimiento">
      <div className="alta-panel">
        <div className="alta-header">
          <span className="alta-titulo">Nuevo movimiento</span>
          <button className="alta-cerrar" onClick={onCancelar} aria-label="Cerrar">✕</button>
        </div>

        <form className="alta-form" onSubmit={handleSubmit}>

          <div className="alta-campo">
            <label htmlFor="alta-fecha">Fecha</label>
            <input
              id="alta-fecha"
              type="date"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
              required
            />
          </div>

          <div className="alta-campo">
            <label>Tipo</label>
            <div className="alta-radio-opciones">
              {(['Gasto', 'Ingreso'] as const).map(t => (
                <label key={t} className={`alta-radio${tipo === t ? ' seleccionado' : ''}`}>
                  <input
                    type="radio"
                    name="tipo"
                    value={t}
                    checked={tipo === t}
                    onChange={() => setTipo(t)}
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>

          <div className="alta-campo">
            <label htmlFor="alta-desc">Descripción</label>
            <input
              id="alta-desc"
              type="text"
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              placeholder="¿En qué?"
              required
            />
          </div>

          <div className="alta-campo alta-fila-dos">
            <div>
              <label htmlFor="alta-monto">Monto</label>
              <input
                id="alta-monto"
                type="text"
                inputMode="decimal"
                value={monto}
                onChange={e => setMonto(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <div>
              <label htmlFor="alta-moneda">Moneda</label>
              <select
                id="alta-moneda"
                value={moneda}
                onChange={e => setMoneda(e.target.value as 'ARS' | 'USD')}
              >
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
              {moneda === 'USD' && (
                <span className="alta-tc-hint">
                  {tcCargando
                    ? 'Buscando TC…'
                    : tcUsdArs !== null
                      ? `TC $${tcUsdArs.toLocaleString('es-AR')}`
                      : 'Sin TC — se guardará null'}
                </span>
              )}
            </div>
          </div>

          <div className="alta-campo">
            <label htmlFor="alta-cat">
              Categoría <span className="alta-req">*</span>
            </label>
            <select
              id="alta-cat"
              value={categoria}
              onChange={e => setCategoria(e.target.value)}
              required
            >
              <option value="">— elegir —</option>
              {categoriasDisp.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="alta-campo">
            <label htmlFor="alta-subcat">
              Subcategoría <span className="alta-req">*</span>
            </label>
            <select
              id="alta-subcat"
              value={subcategoria}
              onChange={e => setSubcategoria(e.target.value)}
              required
              disabled={!categoria}
            >
              <option value="">— elegir —</option>
              {subcatsFiltradas.map(s => (
                <option key={s.id} value={s.valor}>{s.valor}</option>
              ))}
            </select>
          </div>

          <div className="alta-campo">
            <label htmlFor="alta-etiq">
              Etiqueta <span className="alta-opc">(opcional)</span>
            </label>
            <select
              id="alta-etiq"
              value={etiqueta}
              onChange={e => setEtiqueta(e.target.value)}
            >
              <option value="">— ninguna —</option>
              {etiquetas.map(et => (
                <option key={et.id} value={et.valor}>{et.valor}</option>
              ))}
            </select>
          </div>

          <div className="alta-campo">
            <label htmlFor="alta-banco">
              Banco <span className="alta-opc">(opcional)</span>
            </label>
            <select
              id="alta-banco"
              value={banco}
              onChange={e => setBanco(e.target.value)}
            >
              <option value="">— ninguno —</option>
              {bancosDisp.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          {esAdmin ? (
            <div className="alta-campo">
              <label htmlFor="alta-persona">Persona</label>
              <select
                id="alta-persona"
                value={persona}
                onChange={e => setPersona(e.target.value)}
              >
                {miembrosActivos.map(m => (
                  <option key={m.id} value={m.id}>{m.nombre}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="alta-campo">
              <label>Persona</label>
              <input type="text" value={miembro.nombre} readOnly className="alta-readonly" />
            </div>
          )}

          <div className="alta-campo alta-toggle-fila">
            <label htmlFor="alta-incluir">Incluir en resumen del mes</label>
            <input
              id="alta-incluir"
              type="checkbox"
              checked={incluirResumenMes}
              onChange={e => setIncluirResumenMes(e.target.checked)}
            />
          </div>

          {errorMsg && <p className="alta-error" role="alert">{errorMsg}</p>}

          {dupWarning && (
            <div className="alta-dup-aviso" role="alert">
              <p>Ya hay un movimiento con este número. ¿Cargar igual?</p>
              <div className="alta-dup-acciones">
                <button
                  type="button"
                  className="alta-btn-sec"
                  onClick={() => setDupWarning(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="alta-btn-pri"
                  disabled={guardando}
                  onClick={() => {
                    if (pendingPayload.current) ejecutarGuardar(pendingPayload.current);
                  }}
                >
                  {guardando ? 'Guardando…' : 'Cargar igual'}
                </button>
              </div>
            </div>
          )}

          {!dupWarning && (
            <div className="alta-acciones">
              <button
                type="button"
                className="alta-btn-sec"
                onClick={onCancelar}
                disabled={guardando}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="alta-btn-pri"
                disabled={guardando}
              >
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          )}

        </form>
      </div>
    </div>
  );
}
