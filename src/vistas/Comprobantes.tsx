import { useState, useRef, useEffect } from 'react';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { confirmarRama1, marcarVinculado, confirmadoPagoPorFecha } from '../datos/comprobantes';
import { subirEntrante, suscribirEntrantes, resolverEntranteAmbiguo, descartarEntrada } from '../datos/entrantes';
import { leerYBorrarArchivoCompartido } from '../datos/shareTargetIdb';
import { useComprobantes } from '../hooks/useComprobantes';
import { useItemsEsperados } from '../contexto/ItemsEsperadosContext';
import { useDiccionario } from '../contexto/DiccionarioContext';
import { CONFIANZA_UMBRAL } from '../datos/clasificador';
import AltaMovimiento from './AltaMovimiento';
import { SeccionTarjetas } from './ResumenesTarjeta';
import type { Comprobante, Entrante, ExpectedItem, DatosExtraidos } from '../types';
import './Comprobantes.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMonto(n: number | null | undefined, moneda: string): string {
  if (n == null) return '—';
  return moneda === 'USD'
    ? `U$S ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function BadgeEstado({ estado }: { estado: string }) {
  return (
    <span className={`cmp-estado-badge cmp-estado--${estado}`}>{estado}</span>
  );
}

// ── Resumen de datosExtraidos ─────────────────────────────────────────────────

function DatosResumen({ d }: { d: DatosExtraidos }) {
  return (
    <div className="cmp-datos">
      <span className="cmp-datos-tipo">{d.tipoDocumento}</span>
      {d.comercioRazonSocial && <span>{d.comercioRazonSocial}</span>}
      {d.montoTotal != null && <span className="cmp-datos-monto">{fmtMonto(d.montoTotal, d.moneda)}</span>}
      {d.fecha && <span className="cmp-datos-fecha">{d.fecha}</span>}
      {d.vencimientos && d.vencimientos.length > 1 && (
        <span className="cmp-nota">
          {d.vencimientos.length} vencimientos — 2º venc: {fmtMonto(d.vencimientos[1].monto, d.moneda)}
        </span>
      )}
    </div>
  );
}

// ── Propuesta por rama ────────────────────────────────────────────────────────

interface PropuestaProps {
  comp: Comprobante;
  items: ExpectedItem[];
  memberId: string;
  miembro: import('../types').FamiliaMiembro;
}

function PropuestaCard({ comp, items, memberId, miembro }: PropuestaProps) {
  const pm = comp.propuestaMatch;
  const d  = comp.datosExtraidos;
  const { clasificar, cargando: cargandoDict } = useDiccionario();
  const [confirmando,  setConfirmando]  = useState(false);
  const [mostrarAlta,  setMostrarAlta]  = useState(false);
  const [candidatoSel, setCandidatoSel] = useState<string>('');
  const [errorLocal,   setErrorLocal]   = useState<string | null>(null);
  const autoConfirmadoRef = useRef(false);

  // Rama 1 candidato único: vincular automáticamente, sin acción del usuario
  useEffect(() => {
    if (pm?.rama !== 1 || !pm.movimientoId) return;
    if (autoConfirmadoRef.current) return;
    autoConfirmadoRef.current = true;
    setConfirmando(true);
    confirmarRama1(comp, pm.movimientoId, pm.itemEsperadoId).then(res => {
      setConfirmando(false);
      if (!res.ok) setErrorLocal(res.error.message);
      // si ok, onSnapshot actualiza el card a estado vinculado
    });
  // comp.id es estable para la vida de este card
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp.id]);

  if (!pm || !d) return null;

  // Rama 0: ya cargado
  if (pm.rama === 0) {
    return (
      <div className="cmp-propuesta cmp-propuesta--0">
        <span className="cmp-propuesta-label">Ya cargado</span>
      </div>
    );
  }

  // Rama 1: movimiento ya existe
  if (pm.rama === 1) {
    // Múltiples candidatos: elección real del usuario
    if (!pm.movimientoId && pm.candidatos && pm.candidatos.length > 0) {
      const movCands = pm.candidatos.filter(c => c.tipo === 'movimiento');
      return (
        <div className="cmp-propuesta cmp-propuesta--1">
          <span className="cmp-propuesta-label">Seleccioná el movimiento correspondiente</span>
          <div className="cmp-candidatos">
            {movCands.map(c => (
              <label key={c.id} className="cmp-candidato">
                <input
                  type="radio"
                  name={`cand-${comp.id}`}
                  value={c.id}
                  checked={candidatoSel === c.id}
                  onChange={() => setCandidatoSel(c.id)}
                />
                <span className="cmp-candidato-info">
                  {c.descripcion ?? `${c.id.slice(0, 16)}…`}
                  {c.monto != null && ` · ${fmtMonto(c.monto, c.moneda ?? 'ARS')}`}
                  {c.fecha && ` · ${c.fecha}`}
                </span>
                {c.score != null && <span className="cmp-score">score {c.score}</span>}
              </label>
            ))}
          </div>
          {errorLocal && <span className="cmp-error-local">{errorLocal}</span>}
          <button
            className="cmp-btn-confirmar"
            disabled={!candidatoSel || confirmando}
            onClick={async () => {
              if (!candidatoSel) return;
              setConfirmando(true);
              setErrorLocal(null);
              const res = await confirmarRama1(comp, candidatoSel, pm.itemEsperadoId);
              setConfirmando(false);
              if (!res.ok) setErrorLocal(res.error.message);
            }}
          >
            {confirmando ? 'Confirmando…' : 'Confirmar selección'}
          </button>
        </div>
      );
    }

    // Candidato único: auto-vinculando en background (ver useEffect arriba)
    return (
      <div className="cmp-propuesta cmp-propuesta--1">
        {errorLocal
          ? <span className="cmp-error-local">{errorLocal}</span>
          : <span className="cmp-propuesta-label">{confirmando ? 'Vinculando…' : 'Ya cargado'}</span>
        }
      </div>
    );
  }

  // Ramas 2 y 3: para el usuario el gesto es idéntico — alta pre-clasificada
  const descripcionCruda = d.comercioRazonSocial ?? undefined;
  const sugerencia       = descripcionCruda ? clasificar(descripcionCruda) : null;
  const sugerenciaValida = sugerencia && sugerencia.confianza >= CONFIANZA_UMBRAL ? sugerencia : null;
  const descripcionFinal = sugerenciaValida?.descripcionLimpia ?? descripcionCruda;

  const esPago = d.tipoDocumento === 'transferencia' || d.tipoDocumento === 'comprobante_pago';

  const preloadBase = {
    tipo:                'Gasto' as const,
    fecha:               d.fecha         ?? undefined,
    descripcion:         descripcionFinal,
    descripcionOriginal: (descripcionCruda && descripcionFinal !== descripcionCruda) ? descripcionCruda : undefined,
    moneda:              d.moneda,
    monto:               d.montoTotal != null ? String(d.montoTotal) : undefined,
    hashPdf:             comp.hashPdf,
    refStoragePdf:       comp.refStoragePdf,
    persona:             memberId,
    categoria:           sugerenciaValida?.categoria    ?? undefined,
    subcategoria:        sugerenciaValida?.subcategoria ?? undefined,
    etiqueta:            sugerenciaValida?.etiqueta     ?? undefined,
    banco:               'Efectivo' as const,
    confirmadoPago:      esPago ? confirmadoPagoPorFecha(d.fecha) : false,
    // F6.8 — destino propagado para que aprenderDestino() aprenda al confirmar
    destinoCbu:          d.destinoCbu    ?? null,
    destinoCuit:         d.destinoCuit   ?? null,
    destinoAlias:        d.destinoAlias  ?? null,
    destinoNombre:       d.destinoNombre ?? null,
    vencimientos:        d.vencimientos  ?? null,
    // F6.x descartar — stamp de procedencia para distinguir de rama 1
    origenComprobanteId: comp.id,
  };

  const esperado = pm.itemEsperadoId ? items.find(i => i.id === pm.itemEsperadoId) : undefined;

  const preload = pm.rama === 2
    ? {
        ...preloadBase,
        banco:          undefined,
        categoria:      esperado?.categoria    ?? undefined,
        subcategoria:   esperado?.subcategoria ?? undefined,
        itemEsperadoId: pm.itemEsperadoId,
      }
    : preloadBase;

  return (
    <div className="cmp-propuesta cmp-propuesta--accion">
      {sugerenciaValida && <span className="cmp-preclasificado">Pre-clasificado</span>}
      {!mostrarAlta && (
        <button
          className="cmp-btn-confirmar"
          disabled={cargandoDict}
          onClick={() => setMostrarAlta(true)}
        >
          {cargandoDict ? 'Cargando…' : 'Revisar y cargar'}
        </button>
      )}
      {mostrarAlta && (
        <AltaMovimiento
          key={comp.id}
          memberId={memberId}
          miembro={miembro}
          preload={preload}
          onGuardado={async () => {
            await marcarVinculado(comp.id);
            setMostrarAlta(false);
          }}
          onCancelar={() => setMostrarAlta(false)}
        />
      )}
    </div>
  );
}

// ── Tarjeta de comprobante ────────────────────────────────────────────────────

function ComprobanteCard({
  comp, items, memberId, miembro, esAdmin,
}: {
  comp:     Comprobante;
  items:    ExpectedItem[];
  memberId: string;
  miembro:  import('../types').FamiliaMiembro;
  esAdmin:  boolean;
}) {
  const [descartando,   setDescartando]   = useState(false);
  const [errDescartar,  setErrDescartar]  = useState<string | null>(null);
  const [advertencia,   setAdvertencia]   = useState<string | null>(null);

  async function handleDescartar() {
    if (!confirm('¿Descartar este comprobante? Se borra el archivo y su movimiento si fue creado desde este comprobante.')) return;
    setDescartando(true);
    setErrDescartar(null);
    const res = await descartarEntrada('comprobante', comp.id);
    setDescartando(false);
    if (!res.ok) { setErrDescartar(res.error.message); return; }
    if (res.data.advertenciaDestino) {
      setAdvertencia('Destino aprendido — revisá /destinos manualmente si querés limpiarlo.');
    }
  }

  return (
    <div className={`cmp-card cmp-card--${comp.estado}`}>
      <div className="cmp-card-header">
        <BadgeEstado estado={comp.estado} />
        <span className="cmp-card-nombre">{comp.nombreArchivo}</span>
        <span className="cmp-card-size">{(comp.tamano / 1024).toFixed(0)} KB</span>
        {esAdmin && (
          <button
            className="cmp-btn-descartar"
            onClick={handleDescartar}
            disabled={descartando}
            title="Descartar comprobante"
          >
            {descartando ? '…' : '✕'}
          </button>
        )}
      </div>
      {advertencia  && <p className="cmp-advertencia">{advertencia}</p>}
      {errDescartar && <p className="cmp-error-detalle">{errDescartar}</p>}
      {comp.datosExtraidos && <DatosResumen d={comp.datosExtraidos} />}
      {comp.estado === 'error' && comp.errorExtraccion && (
        <p className="cmp-error-detalle">{comp.errorExtraccion}</p>
      )}
      {comp.estado === 'extraido' && comp.propuestaMatch && (
        <PropuestaCard comp={comp} items={items} memberId={memberId} miembro={miembro} />
      )}
      {comp.estado === 'extraido' && !comp.propuestaMatch && (
        <p className="cmp-nota">Calculando match…</p>
      )}
    </div>
  );
}

// ── Bandeja de entrada ────────────────────────────────────────────────────────

function BadgeEntrante({ estado }: { estado: string }) {
  return <span className={`cmp-estado-badge bnd-estado--${estado}`}>{estado}</span>;
}

function EntranteCard({
  e,
  esAdmin,
}: {
  e: Entrante;
  esAdmin: boolean;
}) {
  const [resolviendo, setResolviendo] = useState(false);
  const [errLocal,    setErrLocal]    = useState<string | null>(null);

  async function resolver(tipo: 'comprobante' | 'resumen') {
    setResolviendo(true);
    setErrLocal(null);
    const res = await resolverEntranteAmbiguo(e.hash, tipo);
    setResolviendo(false);
    if (!res.ok) setErrLocal(res.error.message);
  }

  const nombre = e.nombreArchivo ?? e.hash.slice(0, 16) + '…';
  const kb     = e.tamano != null ? `${(e.tamano / 1024).toFixed(0)} KB` : '';

  return (
    <div className={`bnd-card bnd-card--${e.estado}`}>
      <div className="bnd-card-header">
        <BadgeEntrante estado={e.estado} />
        <span className="bnd-nombre">{nombre}</span>
        {kb && <span className="bnd-size">{kb}</span>}
      </div>

      {e.motivoDeteccion && (
        <p className="bnd-motivo">{e.motivoDeteccion}</p>
      )}

      {e.estado === 'ruteado' && e.destino && (
        <p className="bnd-destino">
          → <span className="bnd-col">{e.destino.coleccion}</span>
        </p>
      )}

      {e.estado === 'ambiguo' && esAdmin && (
        <div className="bnd-resolver">
          <span className="bnd-resolver-label">¿Qué es este archivo?</span>
          <div className="bnd-resolver-btns">
            <button
              className="bnd-btn bnd-btn--comp"
              disabled={resolviendo}
              onClick={() => resolver('comprobante')}
            >
              Comprobante
            </button>
            <button
              className="bnd-btn bnd-btn--res"
              disabled={resolviendo}
              onClick={() => resolver('resumen')}
            >
              Resumen tarjeta
            </button>
          </div>
          {errLocal && <span className="cmp-error-local">{errLocal}</span>}
        </div>
      )}
    </div>
  );
}

// ── Vista principal ───────────────────────────────────────────────────────────

type ResultadoEnvio =
  | { tipo: 'enviado';   nombre: string }
  | { tipo: 'duplicado'; nombre: string }
  | { tipo: 'error';     mensaje: string };

export default function Comprobantes() {
  const { memberId, miembro } = useMiembroCtx();
  const esAdmin = miembro.rol === 'admin';

  // Upload
  const [archivo,   setArchivo]   = useState<File | null>(null);
  const [subiendo,  setSubiendo]  = useState(false);
  const [resultado, setResultado] = useState<ResultadoEnvio | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Bandeja
  const [entrantes, setEntrantes] = useState<Entrante[]>([]);
  useEffect(() => suscribirEntrantes(memberId, esAdmin, setEntrantes), [memberId, esAdmin]);

  // Share-target (F6.6 → F6.7): redirige a entrantes con origen:'share_target'
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('share')) return;
    window.history.replaceState({}, '', window.location.pathname);
    leerYBorrarArchivoCompartido().then(file => {
      if (!file) return;
      const TIPOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
      if (!TIPOS.includes(file.type)) {
        setResultado({ tipo: 'error', mensaje: `Tipo no permitido: ${file.type}` });
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setResultado({ tipo: 'error', mensaje: 'El archivo supera los 10 MB.' });
        return;
      }
      setSubiendo(true);
      setResultado(null);
      subirEntrante(file, memberId, 'share_target')
        .then(res => {
          setSubiendo(false);
          if (!res.ok)         setResultado({ tipo: 'error',     mensaje: res.error.message });
          else if (res.duplicado) setResultado({ tipo: 'duplicado', nombre: res.entrante.nombreArchivo ?? file.name });
          else                 setResultado({ tipo: 'enviado',   nombre: file.name });
        })
        .catch(err => {
          setSubiendo(false);
          setResultado({ tipo: 'error', mensaje: (err as Error).message });
        });
    }).catch(() => {});
  }, [memberId]);

  // Lista — onSnapshot
  const { comprobantes, cargando: cargandoLista, error: errorLista } = useComprobantes();
  const { items } = useItemsEsperados();
  const [mostrarAltaManual, setMostrarAltaManual] = useState(false);

  async function handleSubir() {
    if (!archivo) return;
    setSubiendo(true);
    setResultado(null);
    const res = await subirEntrante(archivo, memberId, 'app');
    setSubiendo(false);
    if (!res.ok) {
      setResultado({ tipo: 'error', mensaje: res.error.message });
    } else if (res.duplicado) {
      setResultado({ tipo: 'duplicado', nombre: res.entrante.nombreArchivo ?? archivo.name });
    } else {
      setResultado({ tipo: 'enviado', nombre: archivo.name });
      setArchivo(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="cmp">
      <h1 className="cmp-titulo">Carga</h1>

      {/* ── Upload ─────────────────────────────────────────────────────── */}
      <div className="cmp-subida">
        <label className="cmp-label" htmlFor="cmp-file">
          Seleccioná un archivo (PDF o imagen, máx. 10 MB)
        </label>
        <input
          id="cmp-file"
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          className="cmp-input"
          onChange={e => {
            setArchivo(e.target.files?.[0] ?? null);
            setResultado(null);
          }}
        />
        {archivo && (
          <p className="cmp-archivo-sel">
            {archivo.name} — {(archivo.size / 1024).toFixed(0)} KB
          </p>
        )}
        <button
          className="cmp-btn"
          onClick={handleSubir}
          disabled={!archivo || subiendo}
        >
          {subiendo ? 'Subiendo…' : 'Subir'}
        </button>
      </div>

      {resultado?.tipo === 'enviado' && (
        <div className="cmp-resultado cmp-resultado--ok">
          <strong>{resultado.nombre}</strong> en bandeja — será ruteado en breve.
        </div>
      )}
      {resultado?.tipo === 'duplicado' && (
        <div className="cmp-resultado cmp-resultado--dup">
          Ya existe: <strong>{resultado.nombre}</strong>
        </div>
      )}
      {resultado?.tipo === 'error' && (
        <div className="cmp-resultado cmp-resultado--err">
          Error al subir: {resultado.mensaje}
        </div>
      )}

      {/* ── Bandeja de entrada ─────────────────────────────────────────── */}
      {entrantes.length > 0 && (
        <section className="bnd-seccion">
          <h2 className="cmp-lista-titulo">Bandeja de entrada</h2>
          {entrantes.map(e => (
            <EntranteCard key={e.hash} e={e} esAdmin={esAdmin} />
          ))}
        </section>
      )}

      {/* ── Alta manual ────────────────────────────────────────────────── */}
      <div className="cmp-alta-manual">
        {!mostrarAltaManual ? (
          <button className="cmp-btn-manual" onClick={() => setMostrarAltaManual(true)}>
            Cargar movimiento manual
          </button>
        ) : (
          <AltaMovimiento
            memberId={memberId}
            miembro={miembro}
            preload={{ esManual: true }}
            onGuardado={() => setMostrarAltaManual(false)}
            onCancelar={() => setMostrarAltaManual(false)}
          />
        )}
      </div>

      {/* ── Lista ──────────────────────────────────────────────────────── */}
      <section className="cmp-lista">
        <h2 className="cmp-lista-titulo">Historial — Comprobantes y facturas</h2>
        {cargandoLista && <p className="cmp-nota">Cargando…</p>}
        {errorLista    && <p className="cmp-error-detalle">Error: {errorLista}</p>}
        {!cargandoLista && comprobantes.length === 0 && (
          <p className="cmp-nota">Sin comprobantes aún.</p>
        )}
        {comprobantes.map(comp => (
          <ComprobanteCard
            key={comp.id}
            comp={comp}
            items={items}
            memberId={memberId}
            miembro={miembro}
            esAdmin={esAdmin}
          />
        ))}
      </section>

      {/* ── Resúmenes de tarjeta (solo admin) ──────────────────────────── */}
      {esAdmin && <SeccionTarjetas />}
    </div>
  );
}
