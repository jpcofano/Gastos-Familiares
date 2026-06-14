import { useState, useRef } from 'react';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { subirComprobante } from '../datos/comprobantes';
import type { Comprobante } from '../types';
import './Comprobantes.css';

type Resultado =
  | { tipo: 'subido';    comprobante: Comprobante }
  | { tipo: 'duplicado'; comprobante: Comprobante }
  | { tipo: 'error';     mensaje: string };

export default function Comprobantes() {
  const { memberId }   = useMiembroCtx();
  const [archivo,    setArchivo]    = useState<File | null>(null);
  const [subiendo,   setSubiendo]   = useState(false);
  const [resultado,  setResultado]  = useState<Resultado | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
            <span>
              Este comprobante ya estaba cargado: <strong>{c.nombreArchivo}</strong>
            </span>
            <span className={`cmp-estado-badge cmp-estado--${c.estado}`}>{c.estado}</span>
            {c.estado === 'error' && c.errorExtraccion && (
              <span className="cmp-error-detalle">Error de extracción: {c.errorExtraccion}</span>
            )}
          </div>
        );
      })()}
      {resultado?.tipo === 'error' && (
        <div className="cmp-resultado cmp-resultado--err">
          Error al subir: {resultado.mensaje}
        </div>
      )}
    </div>
  );
}
