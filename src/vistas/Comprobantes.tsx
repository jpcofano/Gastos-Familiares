import { useState, useRef } from 'react';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { subirComprobante, confirmarRama1, marcarVinculado } from '../datos/comprobantes';
import { useComprobantes } from '../hooks/useComprobantes';
import { useItemsEsperados } from '../contexto/ItemsEsperadosContext';
import AltaMovimiento from './AltaMovimiento';
import type { Comprobante, ExpectedItem, DatosExtraidos } from '../types';
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
  const [confirmando,    setConfirmando]    = useState(false);
  const [mostrarAlta,    setMostrarAlta]    = useState(false);
  const [candidatoSel,   setCandidatoSel]   = useState<string>('');
  const [errorLocal,     setErrorLocal]     = useState<string | null>(null);

  if (!pm || !d) return null;

  // Rama 0: ya vinculado
  if (pm.rama === 0) {
    return (
      <div className="cmp-propuesta cmp-propuesta--0">
        <span className="cmp-propuesta-label">Ya vinculado al movimiento</span>
        <code className="cmp-mov-id">{pm.movimientoId?.slice(0, 12)}…</code>
      </div>
    );
  }

  const esperado = pm.itemEsperadoId
    ? items.find(i => i.id === pm.itemEsperadoId)
    : undefined;
  const esperadoLabel = esperado
    ? [esperado.categoria, esperado.subcategoria].filter(Boolean).join(' › ')
    : pm.itemEsperadoId?.slice(0, 12);

  // Rama 1: movimiento ya existe
  if (pm.rama === 1) {
    // Múltiples candidatos
    if (!pm.movimientoId && pm.candidatos && pm.candidatos.length > 0) {
      const movCands = pm.candidatos.filter(c => c.tipo === 'movimiento');
      return (
        <div className="cmp-propuesta cmp-propuesta--1">
          <span className="cmp-propuesta-label">Múltiples movimientos candidatos — seleccioná:</span>
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
                <code>{c.id.slice(0, 16)}…</code>
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
              if (res.ok) { /* onSnapshot actualiza la lista */ }
              else setErrorLocal(res.error.message);
            }}
          >
            {confirmando ? 'Confirmando…' : 'Confirmar selección'}
          </button>
        </div>
      );
    }

    // Candidato único
    return (
      <div className="cmp-propuesta cmp-propuesta--1">
        <span className="cmp-propuesta-label">Movimiento detectado</span>
        {pm.movimientoId && <code className="cmp-mov-id">{pm.movimientoId.slice(0, 16)}…</code>}
        {esperadoLabel && <span className="cmp-nota">Esperado: {esperadoLabel}</span>}
        {errorLocal && <span className="cmp-error-local">{errorLocal}</span>}
        <button
          className="cmp-btn-confirmar"
          disabled={!pm.movimientoId || confirmando}
          onClick={async () => {
            if (!pm.movimientoId) return;
            setConfirmando(true);
            setErrorLocal(null);
            const res = await confirmarRama1(comp, pm.movimientoId, pm.itemEsperadoId);
            setConfirmando(false);
            if (res.ok) { /* onSnapshot actualiza la lista */ }
            else setErrorLocal(res.error.message);
          }}
        >
          {confirmando ? 'Confirmando…' : 'Confirmar pago'}
        </button>
      </div>
    );
  }

  // Ramas 2 y 3: crear movimiento
  const preloadBase = {
    tipo:          'Gasto'  as const,
    fecha:         d.fecha  ?? undefined,
    descripcion:   d.comercioRazonSocial ?? undefined,
    moneda:        d.moneda,
    monto:         d.montoTotal != null ? String(d.montoTotal) : undefined,
    hashPdf:       comp.hashPdf,
    refStoragePdf: comp.refStoragePdf,
  };

  if (pm.rama === 2) {
    const preload = {
      ...preloadBase,
      categoria:     esperado?.categoria    ?? undefined,
      subcategoria:  esperado?.subcategoria ?? undefined,
      persona:       esperado?.persona      ?? undefined,
      itemEsperadoId: pm.itemEsperadoId,
      confirmadoPago: true,
    };
    return (
      <div className="cmp-propuesta cmp-propuesta--2">
        <span className="cmp-propuesta-label">
          Esperado detectado{esperadoLabel ? `: ${esperadoLabel}` : ''}
        </span>
        {!mostrarAlta && (
          <button className="cmp-btn-confirmar" onClick={() => setMostrarAlta(true)}>
            Crear movimiento vinculado
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

  // Rama 3
  return (
    <div className="cmp-propuesta cmp-propuesta--3">
      <span className="cmp-propuesta-label">Sin match detectado — alta manual</span>
      {!mostrarAlta && (
        <button className="cmp-btn-confirmar" onClick={() => setMostrarAlta(true)}>
          Cargar movimiento
        </button>
      )}
      {mostrarAlta && (
        <AltaMovimiento
          key={comp.id}
          memberId={memberId}
          miembro={miembro}
          preload={preloadBase}
          onGuardado={async () => {
            await marcarVinculado(comp.id);
            setMostrarAlta(false);
            onAccion();
          }}
          onCancelar={() => setMostrarAlta(false)}
        />
      )}
    </div>
  );
}

// ── Tarjeta de comprobante ────────────────────────────────────────────────────

function ComprobanteCard({
  comp, items, memberId, miembro,
}: {
  comp:     Comprobante;
  items:    ExpectedItem[];
  memberId: string;
  miembro:  import('../types').FamiliaMiembro;
}) {
  return (
    <div className={`cmp-card cmp-card--${comp.estado}`}>
      <div className="cmp-card-header">
        <BadgeEstado estado={comp.estado} />
        <span className="cmp-card-nombre">{comp.nombreArchivo}</span>
        <span className="cmp-card-size">{(comp.tamano / 1024).toFixed(0)} KB</span>
      </div>
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

// ── Vista principal ───────────────────────────────────────────────────────────

type ResultadoSubida =
  | { tipo: 'subido';    comprobante: Comprobante }
  | { tipo: 'duplicado'; comprobante: Comprobante }
  | { tipo: 'error';     mensaje: string };

export default function Comprobantes() {
  const { memberId, miembro } = useMiembroCtx();

  // Upload
  const [archivo,   setArchivo]   = useState<File | null>(null);
  const [subiendo,  setSubiendo]  = useState(false);
  const [resultado, setResultado] = useState<ResultadoSubida | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Lista — onSnapshot
  const { comprobantes, cargando: cargandoLista, error: errorLista } = useComprobantes();
  const { items } = useItemsEsperados();

  async function handleSubir() {
    if (!archivo) return;
    setSubiendo(true);
    setResultado(null);
    const res = await subirComprobante(archivo, memberId);
    setSubiendo(false);
    if (!res.ok) {
      setResultado({ tipo: 'error', mensaje: res.error.message });
    } else if (res.duplicado) {
      setResultado({ tipo: 'duplicado', comprobante: res.comprobante });
    } else {
      setResultado({ tipo: 'subido', comprobante: res.comprobante });
      setArchivo(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="cmp">
      <h1 className="cmp-titulo">Comprobantes</h1>

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
          {subiendo ? 'Subiendo…' : 'Subir comprobante'}
        </button>
      </div>

      {resultado?.tipo === 'subido' && (
        <div className="cmp-resultado cmp-resultado--ok">
          Subido: <strong>{resultado.comprobante.nombreArchivo}</strong>
          <span className="cmp-estado-badge cmp-estado--subido">subido</span>
          <span className="cmp-nota">La function de extracción lo procesará en breve.</span>
        </div>
      )}
      {resultado?.tipo === 'duplicado' && (() => {
        const c = resultado.comprobante;
        return (
          <div className={`cmp-resultado cmp-resultado--${c.estado === 'error' ? 'err' : 'dup'}`}>
            <span>Ya cargado: <strong>{c.nombreArchivo}</strong></span>
            <span className={`cmp-estado-badge cmp-estado--${c.estado}`}>{c.estado}</span>
            {c.estado === 'error' && c.errorExtraccion && (
              <span className="cmp-error-detalle">{c.errorExtraccion}</span>
            )}
          </div>
        );
      })()}
      {resultado?.tipo === 'error' && (
        <div className="cmp-resultado cmp-resultado--err">
          Error al subir: {resultado.mensaje}
        </div>
      )}

      {/* ── Lista ──────────────────────────────────────────────────────── */}
      <section className="cmp-lista">
        <h2 className="cmp-lista-titulo">Historial</h2>
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
          />
        ))}
      </section>
    </div>
  );
}
