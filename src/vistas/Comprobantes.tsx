import { useState, useRef, useEffect } from 'react';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { confirmarRama1, cargarMovimientoDesdeComprobante, confirmadoPagoPorFecha } from '../datos/comprobantes';
import { subirEntrante, suscribirEntrantes, resolverEntranteAmbiguo, descartarEntrada } from '../datos/entrantes';
import { leerYBorrarArchivoCompartido } from '../datos/shareTargetIdb';
import { useComprobantes } from '../hooks/useComprobantes';
import { useItemsEsperados } from '../contexto/ItemsEsperadosContext';
import { useDiccionario } from '../contexto/DiccionarioContext';
import { CONFIANZA_UMBRAL } from '../datos/clasificador';
import { Icon } from '../design-system/Icon';
import { Card, Badge, Message, Button } from '../design-system/components';
import { Fab } from '../design-system/shell';
import AltaMovimiento from './AltaMovimiento';
import { SeccionTarjetas } from './ResumenesTarjeta';
import type { Comprobante, Entrante, ExpectedItem, DatosExtraidos } from '../types';
import './Comprobantes.css';

// F9.34 — re-skin mobile (kit CargaMobile.jsx) sobre la lógica real restaurada
// en F9.26 (commit 6acf084, pre-F9.3): ramas de match 0-3, reconciliación por
// payee, scoping admin/dependiente, descartar, FAB unificado. Solo cambia la
// presentación — cero cambios de comportamiento.

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMonto(n: number | null | undefined, moneda: string): string {
  if (n == null) return '—';
  return moneda === 'USD'
    ? `U$S ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ESTADO_COMP_TONE = { subido: 'info', extraido: 'warning', vinculado: 'success', error: 'danger' } as const;
const ESTADO_ENTR_TONE = { pendiente: 'neutral', ruteado: 'success', ambiguo: 'warning', error: 'danger' } as const;

function BadgeEstado({ estado }: { estado: string }) {
  const tone = (ESTADO_COMP_TONE as Record<string, 'info' | 'warning' | 'success' | 'danger'>)[estado] ?? 'neutral';
  return <Badge tone={tone}>{estado}</Badge>;
}

function BadgeEntrante({ estado }: { estado: string }) {
  const tone = (ESTADO_ENTR_TONE as Record<string, 'neutral' | 'success' | 'warning' | 'danger'>)[estado] ?? 'neutral';
  return <Badge tone={tone}>{estado}</Badge>;
}

// F6.9.8 — etiqueta persistente de la razón del match en el card ya resuelto.
// Lee propuestaMatch (sobrevive al estado vinculado: confirmarRama1/cargarMovimientoDesdeComprobante
// solo tocan `estado`) para conservar el "por qué" después de resolver.
function RazonVinculado({ pm }: { pm: Comprobante['propuestaMatch'] }) {
  if (!pm) return null;
  let texto: string;
  let tone: 'info' | 'success' | 'neutral';
  switch (pm.rama) {
    case 0: texto = 'Ya cargado'; tone = 'neutral'; break;
    case 1: texto = pm.origenReconciliacion ? 'Pagó una factura' : 'Vinculado a un movimiento'; tone = 'info'; break;
    case 2: texto = pm.esAdicional ? 'Pago adicional' : 'Cumplió un gasto esperado'; tone = 'success'; break;
    case 3: texto = 'Cargado como nuevo'; tone = 'success'; break;
    default: return null;
  }
  return <Badge tone={tone}>{texto}</Badge>;
}

// ── Resumen de datosExtraidos ─────────────────────────────────────────────────

function DatosResumen({ d }: { d: DatosExtraidos }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 13, color: 'var(--color-text-sec)', marginTop: 6 }}>
      <span style={{ fontWeight: 700, color: 'var(--color-text-strong)', textTransform: 'capitalize' }}>{d.tipoDocumento.replace(/_/g, ' ')}</span>
      {d.comercioRazonSocial && <span>{d.comercioRazonSocial}</span>}
      {d.montoTotal != null && <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{fmtMonto(d.montoTotal, d.moneda)}</span>}
      {d.fecha && <span>{d.fecha}</span>}
      {d.vencimientos && d.vencimientos.length > 1 && (
        <span style={{ width: '100%' }}>
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
  esAdmin: boolean;
}

function PropuestaCard({ comp, items, memberId, miembro, esAdmin }: PropuestaProps) {
  const pm = comp.propuestaMatch;
  const d  = comp.datosExtraidos;
  const { clasificar, cargando: cargandoDict } = useDiccionario();
  const [confirmando,  setConfirmando]  = useState(false);
  const [mostrarAlta,  setMostrarAlta]  = useState(false);
  const [candidatoSel, setCandidatoSel] = useState<string>('');
  const [errorLocal,   setErrorLocal]   = useState<string | null>(null);
  const autoConfirmadoRef = useRef(false);

  // Rama 1 candidato único: vincular automáticamente, sin acción del usuario
  // Rama 1 (conciliación de obligaciones) es admin-only por decisión (F6.9.11) — se gatea acá.
  useEffect(() => {
    if (!esAdmin) return;
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

  // Rama 0: dedup por hash — este archivo ya generó un movimiento, no hay nada nuevo
  if (pm.rama === 0) {
    const di = pm.dedupInfo;
    return (
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Badge tone="neutral">Ya cargado</Badge>
        <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>
          Este archivo ya había generado un movimiento — no se cargó de nuevo
          {di?.mes && ` · ${di.mes}`}
          {di?.monto != null && ` · ${fmtMonto(di.monto, d.moneda ?? 'ARS')}`}
        </span>
      </div>
    );
  }

  // Rama 1: movimiento ya existe — conciliación de obligaciones es admin-only (F6.9.11)
  if (pm.rama === 1) {
    if (!esAdmin) {
      return (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Badge tone="info">Pagó una obligación</Badge>
          <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Coincide con una obligación — un admin la concilia</span>
        </div>
      );
    }

    // Múltiples candidatos: elección real del usuario
    if (!pm.movimientoId && pm.candidatos && pm.candidatos.length > 0) {
      const movCands = pm.candidatos.filter(c => c.tipo === 'movimiento');
      return (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Badge tone="info">Pagó una obligación</Badge>
          <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Este pago salda una obligación abierta — elegí cuál movimiento</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {movCands.map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--gf-gray-100)' }}>
                <input type="radio" name={`cand-${comp.id}`} value={c.id} checked={candidatoSel === c.id} onChange={() => setCandidatoSel(c.id)} />
                <span style={{ flex: 1 }}>
                  {c.descripcion ?? `${c.id.slice(0, 16)}…`}
                  {c.monto != null && ` · ${fmtMonto(c.monto, c.moneda ?? 'ARS')}`}
                  {c.fecha && ` · ${c.fecha}`}
                </span>
                {c.score != null && <span style={{ fontSize: 11, color: 'var(--gf-gray-400)' }}>score {c.score}</span>}
              </label>
            ))}
          </div>
          {errorLocal && <span style={{ fontSize: 12, color: 'var(--gf-err-text)' }}>{errorLocal}</span>}
          <Button
            variant="primary" size="sm"
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
          </Button>
        </div>
      );
    }

    // Candidato único: auto-vinculando en background (ver useEffect arriba)
    // En el flujo de comprobantes la rama 1 es SIEMPRE reconciliación por payee.
    return (
      <div style={{ marginTop: 8 }}>
        {errorLocal ? (
          <span style={{ fontSize: 12, color: 'var(--gf-err-text)' }}>{errorLocal}</span>
        ) : pm.origenReconciliacion ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Badge tone="info">Pagó una factura</Badge>
            <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>
              {confirmando ? 'Reconciliando con la obligación abierta…' : 'Saldó una obligación abierta — no se creó un movimiento nuevo'}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>{confirmando ? 'Vinculando…' : 'Vinculado a un movimiento existente'}</span>
        )}
      </div>
    );
  }

  // Ramas 2 y 3: para el usuario el gesto es idéntico — alta pre-clasificada
  // payee del comprobante: factura → emisor (comercioRazonSocial); transferencia/pago → destinatario (destinoNombre).
  // Gateado por tipo, NO con ??: una billetera (Mercado Pago) llena comercioRazonSocial con su marca
  // (truthy), lo que bloquearía el fallback. En pagos el payee es SIEMPRE el destinatario.
  const esPagoDoc = d.tipoDocumento === 'transferencia' || d.tipoDocumento === 'comprobante_pago';
  const descripcionCruda = esPagoDoc
    ? (d.destinoNombre   ?? d.comercioRazonSocial ?? undefined)
    : (d.comercioRazonSocial ?? d.destinoNombre   ?? undefined);
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
    categoria:           pm.categoriaPrellena    ?? sugerenciaValida?.categoria    ?? undefined,
    subcategoria:        pm.subcategoriaPrellena ?? sugerenciaValida?.subcategoria ?? undefined,
    etiqueta:            pm.etiquetaPrellena     ?? sugerenciaValida?.etiqueta     ?? undefined,
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
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Badge tone="success">
          {pm.rama === 2
            ? (pm.esAdicional ? 'Pago adicional de un gasto esperado' : 'Cumple un gasto esperado')
            : 'Movimiento nuevo'}
        </Badge>
        {(pm.categoriaPrellena || sugerenciaValida) && <Badge tone="info">Pre-clasificado</Badge>}
      </div>
      {!mostrarAlta && (
        <Button variant="primary" size="sm" disabled={cargandoDict} onClick={() => setMostrarAlta(true)}>
          {cargandoDict ? 'Cargando…' : 'Revisar y cargar'}
        </Button>
      )}
      {mostrarAlta && (
        <AltaMovimiento
          key={comp.id}
          memberId={memberId}
          miembro={miembro}
          preload={preload}
          onGuardarPayload={async (payload) => {
            const res = await cargarMovimientoDesdeComprobante(comp.id, payload);
            return { ok: res.ok, error: res.ok ? undefined : res.error };
          }}
          onGuardado={() => setMostrarAlta(false)}
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
    <Card variant="flat" padding="var(--space-3)" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BadgeEstado estado={comp.estado} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{comp.nombreArchivo}</span>
        <span style={{ fontSize: 11, color: 'var(--gf-gray-400)', flexShrink: 0 }}>{(comp.tamano / 1024).toFixed(0)} KB</span>
        {esAdmin && (
          <button
            onClick={handleDescartar}
            disabled={descartando}
            title="Descartar comprobante"
            style={{ width: 22, height: 22, borderRadius: 999, border: 'none', background: 'var(--gf-gray-100)', color: 'var(--gf-gray-500)', cursor: 'pointer', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}
          >
            {descartando ? '…' : '✕'}
          </button>
        )}
      </div>
      {advertencia  && <p style={{ fontSize: 12, color: 'var(--gf-warn-text)', marginTop: 6 }}>{advertencia}</p>}
      {errDescartar && <p style={{ fontSize: 12, color: 'var(--gf-err-text)', marginTop: 6 }}>{errDescartar}</p>}
      {comp.datosExtraidos && <DatosResumen d={comp.datosExtraidos} />}
      {comp.estado === 'error' && comp.errorExtraccion && (
        <p style={{ fontSize: 12, color: 'var(--gf-err-text)', marginTop: 6 }}>{comp.errorExtraccion}</p>
      )}
      {comp.estado === 'extraido' && comp.propuestaMatch && (
        <PropuestaCard comp={comp} items={items} memberId={memberId} miembro={miembro} esAdmin={esAdmin} />
      )}
      {comp.estado === 'extraido' && !comp.propuestaMatch && (
        <p style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 6 }}>Calculando match…</p>
      )}
      {comp.estado === 'vinculado' && comp.propuestaMatch && (
        <div style={{ marginTop: 8 }}>
          <RazonVinculado pm={comp.propuestaMatch} />
        </div>
      )}
    </Card>
  );
}

// ── Bandeja de entrada ────────────────────────────────────────────────────────

function EntranteCard({ e, esAdmin }: { e: Entrante; esAdmin: boolean }) {
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
    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--gf-gray-100)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BadgeEntrante estado={e.estado} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombre}</span>
        {kb && <span style={{ fontSize: 11, color: 'var(--gf-gray-400)', flexShrink: 0 }}>{kb}</span>}
      </div>

      {e.motivoDeteccion && <p style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 4 }}>{e.motivoDeteccion}</p>}

      {e.estado === 'ruteado' && e.destino && (
        <p style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 4 }}>→ <strong>{e.destino.coleccion}</strong></p>
      )}

      {e.estado === 'ambiguo' && esAdmin && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-strong)' }}>¿Qué es este archivo?</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="sm" disabled={resolviendo} onClick={() => resolver('comprobante')}>Comprobante</Button>
            <Button variant="secondary" size="sm" disabled={resolviendo} onClick={() => resolver('resumen')}>Resumen tarjeta</Button>
          </div>
          {errLocal && <span style={{ fontSize: 12, color: 'var(--gf-err-text)' }}>{errLocal}</span>}
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
  const { comprobantes, cargando: cargandoLista, error: errorLista } = useComprobantes(memberId, esAdmin);
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Dropzone ───────────────────────────────────────────────────── */}
        <label htmlFor="cmp-file" style={{
          position: 'relative',
          border: '2px dashed var(--gf-gray-300)', borderRadius: 'var(--radius-2xl)', background: 'var(--color-surface)',
          padding: '30px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          cursor: 'pointer', fontFamily: 'var(--font-base)', width: '100%', boxSizing: 'border-box',
        }}>
          <input
            id="cmp-file"
            ref={inputRef}
            type="file"
            accept="application/pdf,image/*"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
            onChange={e => {
              setArchivo(e.target.files?.[0] ?? null);
              setResultado(null);
            }}
          />
          <span style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--gf-emerald-50)', color: 'var(--color-accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="file-up" size={24} />
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>Subir comprobante o resumen</span>
          <span style={{ fontSize: 13, color: 'var(--color-text-sec)', textAlign: 'center' }}>PDF o foto, máx. 10 MB. Extraemos monto, comercio y fecha automáticamente.</span>
          <span style={{ marginTop: 4, display: 'inline-flex', gap: 8 }}>
            <Badge tone="neutral">PDF</Badge><Badge tone="neutral">JPG</Badge>
          </span>
        </label>

        {archivo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-sec)' }}>{archivo.name} — {(archivo.size / 1024).toFixed(0)} KB</span>
            <Button variant="primary" size="sm" onClick={handleSubir} disabled={subiendo}>{subiendo ? 'Subiendo…' : 'Subir'}</Button>
          </div>
        )}

        {resultado?.tipo === 'enviado' && (
          <Message kind="ok" title="En bandeja.">{resultado.nombre} — será ruteado en breve.</Message>
        )}
        {resultado?.tipo === 'duplicado' && (
          <Message kind="warn" title="Ya estaba cargado.">{resultado.nombre} — no se procesa de nuevo (mismo archivo).</Message>
        )}
        {resultado?.tipo === 'error' && (
          <Message kind="err" title="Error al subir.">{resultado.mensaje}</Message>
        )}

        {/* ── Bandeja de entrada ─────────────────────────────────────────── */}
        {entrantes.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Bandeja de entrada</div>
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-card)', borderRadius: 12, overflow: 'hidden' }}>
              {entrantes.map((e, i) => (
                <div key={e.hash} style={{ borderBottom: i < entrantes.length - 1 ? undefined : 'none' }}>
                  <EntranteCard e={e} esAdmin={esAdmin} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Lista ──────────────────────────────────────────────────────── */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Historial — Comprobantes y facturas</div>
          {cargandoLista && <p style={{ fontSize: 13, color: 'var(--color-text-sec)' }}>Cargando…</p>}
          {errorLista    && <p style={{ fontSize: 13, color: 'var(--gf-err-text)' }}>Error: {errorLista}</p>}
          {!cargandoLista && comprobantes.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--color-text-sec)' }}>Sin comprobantes aún.</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {comprobantes.map(comp => (
              <ComprobanteCard key={comp.id} comp={comp} items={items} memberId={memberId} miembro={miembro} esAdmin={esAdmin} />
            ))}
          </div>
        </div>

        {/* ── Resúmenes de tarjeta (solo admin) ──────────────────────────── */}
        {esAdmin && <SeccionTarjetas />}

        <div style={{ height: 4 }} />
      </div>

      {/* ── Alta manual (overlay; se abre con el FAB +) ─────────────────── */}
      {mostrarAltaManual && (
        <AltaMovimiento
          memberId={memberId}
          miembro={miembro}
          preload={{ esManual: true }}
          onGuardado={() => setMostrarAltaManual(false)}
          onCancelar={() => setMostrarAltaManual(false)}
        />
      )}

      {/* F9.22/F9.26 — el FAB vive solo en Cargar y abre Alta Manual */}
      <Fab onClick={() => setMostrarAltaManual(true)} />
    </div>
  );
}
