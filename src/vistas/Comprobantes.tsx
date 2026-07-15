import { useState, useRef, useEffect } from 'react';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { confirmarRama1, cargarMovimientoDesdeComprobante, buscarObligacionesAbiertas, confirmadoPagoPorFecha, esObligacionDoc, type ObligacionAbierta } from '../datos/comprobantes';
import { subirEntrante, suscribirEntrantes, resolverEntranteAmbiguo, descartarEntrada, descartarEntranteCompleto } from '../datos/entrantes';
import { leerYBorrarArchivoCompartido } from '../datos/shareTargetIdb';
import { useComprobantes } from '../hooks/useComprobantes';
import { useResumenesTarjeta } from '../hooks/useResumenesTarjeta';
import { useItemsEsperados } from '../contexto/ItemsEsperadosContext';
import { useDiccionario } from '../contexto/DiccionarioContext';
import { CONFIANZA_UMBRAL } from '../datos/clasificador';
import { Icon } from '../design-system/Icon';
import { Card, Badge, Message, Button } from '../design-system/components';
import { Fab } from '../design-system/shell';
import AltaMovimiento from './AltaMovimiento';
import { SeccionTarjetas } from './ResumenesTarjeta';
import { calcularSplitCuotas } from './TarjetaFace';
import ShareLanding, { type FacturaLanding, type ResumenLanding, type BadgeFactura } from './ShareLanding';
import type { Comprobante, Entrante, ExpectedItem, DatosExtraidos, PropuestaMatch, CardStatement } from '../types';
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

// F9.99.7 Parte 2 — picker: cada obligación futura se muestra con su mes inequívoco.
const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
function formatMesCorto(mes: string): string {
  const [y, m] = mes.split('-');
  return `${MESES_LARGO[Number(m) - 1]} ${y}`;
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

// ── Helpers de datos ──────────────────────────────────────────────────────────

// Payee legible del comprobante: factura → emisor (comercioRazonSocial);
// transferencia/pago → destinatario (destinoNombre). Gateado por tipo, NO con ??:
// una billetera (Mercado Pago) llena comercioRazonSocial con su marca y taparía el destino.
function payeeDeDatos(d: DatosExtraidos): string | undefined {
  const esPagoDoc = d.tipoDocumento === 'transferencia' || d.tipoDocumento === 'comprobante_pago';
  return esPagoDoc
    ? (d.destinoNombre ?? d.comercioRazonSocial ?? undefined)
    : (d.comercioRazonSocial ?? d.destinoNombre ?? undefined);
}

// ── Resumen de datosExtraidos ─────────────────────────────────────────────────

function DatosResumen({ d }: { d: DatosExtraidos }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 13, color: 'var(--color-text-sec)', marginTop: 6 }}>
      <span style={{ fontWeight: 700, color: 'var(--color-text-strong)', textTransform: 'capitalize' }}>{d.tipoDocumento.replace(/_/g, ' ')}</span>
      {payeeDeDatos(d) && <span>{payeeDeDatos(d)}</span>}
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
  // F9.51 — el landing de share-target salta directo a "Revisar y cargar"
  // cuando la propuesta es rama 2/3, sin que el usuario tenga que tocarlo.
  autoAbrir?: boolean;
}

function PropuestaCard({ comp, items, memberId, miembro, esAdmin, autoAbrir }: PropuestaProps) {
  const pm = comp.propuestaMatch;
  const d  = comp.datosExtraidos;
  const { clasificar, cargando: cargandoDict } = useDiccionario();
  const [confirmando,   setConfirmando]   = useState(false);
  const [mostrarAlta,   setMostrarAlta]   = useState(false);
  const [candidatoSel,  setCandidatoSel]  = useState<string>('');
  const [errorLocal,    setErrorLocal]    = useState<string | null>(null);
  const [mostrarPicker, setMostrarPicker] = useState(false);
  const [pickerItem,    setPickerItem]    = useState<string>('');
  const [pickerCargando, setPickerCargando] = useState(false);
  // F9.99.7 Parte 2 — obligaciones abiertas del ítem elegido (mismo mes + todos los futuros)
  const [obligaciones,  setObligaciones]  = useState<ObligacionAbierta[]>([]);
  const [obligacionSel, setObligacionSel] = useState<string>('');
  const [buscandoObligaciones, setBuscandoObligaciones] = useState(false);
  const autoConfirmadoRef = useRef(false);
  const autoAbiertoRef = useRef(false);

  useEffect(() => {
    if (!autoAbrir || autoAbiertoRef.current) return;
    autoAbiertoRef.current = true;
    setMostrarAlta(true);
  }, [autoAbrir]);

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
      const esDebil  = pm.reconciliacionDebil === true;
      return (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Badge tone={esDebil ? 'warning' : 'info'}>{esDebil ? 'Posible pago de factura' : 'Pagó una obligación'}</Badge>
          <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>{esDebil ? 'Coincidencia por nombre — confirmá si corresponde' : 'Este pago salda una obligación abierta — elegí cuál movimiento'}</span>
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
  const descripcionCruda = payeeDeDatos(d);
  const sugerencia       = descripcionCruda ? clasificar(descripcionCruda) : null;
  const sugerenciaValida = sugerencia && sugerencia.confianza >= CONFIANZA_UMBRAL ? sugerencia : null;
  const descripcionFinal = sugerenciaValida?.descripcionLimpia ?? descripcionCruda;

  const preloadBase = {
    tipo:                'Gasto' as const,
    fecha:               d.vencimientos?.[0]?.fecha ?? d.fecha ?? undefined,
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
    // F9.75 — obligaciones (factura*, recibo_servicio) NO se pagan por vencimiento; el pago llega
    // después. Solo pagos/tickets confirman por fecha. (El server recalcula; esto mantiene el
    // preload coherente con lo que se va a guardar.)
    confirmadoPago:      !esObligacionDoc(d.tipoDocumento) && confirmadoPagoPorFecha(d.vencimientos?.[0]?.fecha ?? d.fecha),
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

  // F9.79 — badge Pre-clasificado + Gasto esperado persiste del splash al Hero del confirm
  const badgePropuesta = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
      {(pm.categoriaPrellena || sugerenciaValida) && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(217,119,6,.15)',
          border: '1px solid rgba(245,158,11,.55)', borderRadius: 999, padding: '6px 13px 6px 7px' }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(245,158,11,.9)', color: '#1a1205',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkles" size={12} />
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#fff' }}>Pre-clasificado</span>
        </span>
      )}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7,
        background: pm.rama === 2 ? 'rgba(12,143,98,.2)' : 'rgba(255,255,255,.08)',
        border: pm.rama === 2 ? '1px solid var(--gf-emerald-line)' : '1px solid rgba(255,255,255,.18)',
        borderRadius: 999, padding: '6px 13px 6px 7px' }}>
        <span style={{ width: 22, height: 22, borderRadius: '50%',
          background: pm.rama === 2 ? 'var(--color-accent)' : 'var(--gf-gray-300)',
          color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={pm.rama === 2 ? 'git-compare' : 'plus'} size={12} />
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#fff' }}>
          {pm.rama === 2 ? (pm.esAdicional ? 'Pago adicional' : 'Gasto esperado') : 'Movimiento nuevo'}
        </span>
      </span>
    </span>
  );

  // F9.82 — picker "Conciliar con gasto esperado": solo admin + pago + ramas 2/3
  const esPagoDoc = d.tipoDocumento === 'transferencia' || d.tipoDocumento === 'comprobante_pago';
  const itemsGasto = items.filter(i => i.activo && i.tipo === 'Gasto' && i.moneda === d.moneda);
  const labelItem  = (i: ExpectedItem) =>
    i.notas || i.matchTexto?.incluye[0] || [i.categoria, i.subcategoria].filter(Boolean).join(' › ') || i.id;
  const fechaComp = d.vencimientos?.[0]?.fecha ?? d.fecha;
  const mesComp = fechaComp ? fechaComp.slice(0, 7) : new Date().toISOString().slice(0, 7);

  // F9.99.7 Parte 2 — al elegir el ítem, busca sus obligaciones abiertas (mismo mes + futuras)
  // para que el usuario elija cuál salda este pago, en vez de asumir el mes del comprobante.
  useEffect(() => {
    if (!pickerItem) { setObligaciones([]); setObligacionSel(''); return; }
    let cancelado = false;
    setBuscandoObligaciones(true);
    setObligacionSel('');
    buscarObligacionesAbiertas(pickerItem, mesComp).then(obs => {
      if (cancelado) return;
      setObligaciones(obs);
      setBuscandoObligaciones(false);
    });
    return () => { cancelado = true; };
  }, [pickerItem, mesComp]);

  async function handleConciliar() {
    if (!pickerItem) return;
    setPickerCargando(true);
    setErrorLocal(null);
    if (obligaciones.length > 0) {
      if (!obligacionSel) { setPickerCargando(false); return; }
      const res = await confirmarRama1(comp, obligacionSel, pickerItem);
      setPickerCargando(false);
      if (!res.ok) setErrorLocal(res.error.message);
    } else {
      const itemEsp = items.find(i => i.id === pickerItem);
      const payload = {
        ...preloadBase,
        itemEsperadoId: pickerItem,
        categoria:      itemEsp?.categoria  ?? preloadBase.categoria,
        subcategoria:   itemEsp?.subcategoria ?? preloadBase.subcategoria,
        banco:          undefined,
      };
      const res = await cargarMovimientoDesdeComprobante(comp.id, payload);
      setPickerCargando(false);
      if (!res.ok) setErrorLocal(res.error.message);
      else setMostrarPicker(false);
    }
  }

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {(pm.categoriaPrellena || sugerenciaValida) && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 8, padding: '6px 11px', background: 'rgba(245,158,11,.10)', border: '1px solid rgba(245,158,11,.25)', fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
            <Icon name="sparkles" size={13} color="#d97706" />
            {pm.categoriaPrellena ?? sugerenciaValida?.categoria ?? 'Pre-clasificado'}
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 8, padding: '6px 11px', background: pm.rama === 2 ? 'rgba(12,143,98,.10)' : 'var(--gf-gray-100)', border: pm.rama === 2 ? '1px solid var(--gf-emerald-line)' : '1px solid transparent', fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
          <Icon name={pm.rama === 2 ? 'git-compare' : 'plus'} size={13} color={pm.rama === 2 ? 'var(--color-accent)' : 'var(--color-text-sec)'} />
          {pm.rama === 2
            ? (pm.esAdicional ? 'Pago adicional' : 'Gasto esperado')
            : 'Movimiento nuevo'}
        </span>
      </div>

      {/* F9.82 — picker para pagos sin obligación detectada automáticamente */}
      {esAdmin && esPagoDoc && !mostrarAlta && (
        <Button variant="ghost" size="sm" onClick={() => { setMostrarPicker(p => !p); setPickerItem(''); setErrorLocal(null); }}>
          <Icon name="git-compare" size={13} /> Conciliar con gasto esperado
        </Button>
      )}
      {mostrarPicker && esAdmin && esPagoDoc && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', background: 'var(--gf-gray-50)', borderRadius: 10, border: '1px solid var(--gf-gray-100)' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)' }}>Elegí el gasto esperado que paga este comprobante</span>
          <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {itemsGasto.map(i => (
              <label key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '5px 0', borderBottom: '1px solid var(--gf-gray-100)', cursor: 'pointer' }}>
                <input type="radio" name={`picker-${comp.id}`} value={i.id} checked={pickerItem === i.id} onChange={() => setPickerItem(i.id)} />
                <span style={{ flex: 1 }}>
                  {labelItem(i)}
                  {i.montoEsperado != null && <span style={{ color: 'var(--gf-gray-400)', marginLeft: 6 }}>{fmtMonto(i.montoEsperado, i.moneda)}</span>}
                </span>
              </label>
            ))}
          </div>
          {/* F9.99.7 Parte 2 — mismo mes + todos los futuros, cada uno con su mes visible */}
          {pickerItem && buscandoObligaciones && (
            <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Buscando obligaciones abiertas…</span>
          )}
          {pickerItem && !buscandoObligaciones && obligaciones.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2, paddingTop: 8, borderTop: '1px solid var(--gf-gray-100)' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)' }}>¿Qué mes salda este pago?</span>
              {obligaciones.map(o => (
                <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 0', cursor: 'pointer' }}>
                  <input type="radio" name={`picker-mes-${comp.id}`} value={o.id} checked={obligacionSel === o.id} onChange={() => setObligacionSel(o.id)} />
                  <span>{formatMesCorto(o.mes)}</span>
                </label>
              ))}
            </div>
          )}
          {pickerItem && !buscandoObligaciones && obligaciones.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>No hay obligación abierta para este ítem — se va a crear un movimiento nuevo.</span>
          )}
          {errorLocal && <span style={{ fontSize: 12, color: 'var(--gf-err-text)' }}>{errorLocal}</span>}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="primary" size="sm"
              disabled={!pickerItem || pickerCargando || buscandoObligaciones || (obligaciones.length > 0 && !obligacionSel)}
              onClick={handleConciliar}
            >
              {pickerCargando ? 'Conciliando…' : 'Confirmar'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMostrarPicker(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      {!mostrarAlta && !mostrarPicker && (
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
          badgePropuesta={badgePropuesta}
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
  comp, items, memberId, miembro, esAdmin, autoAbrir,
}: {
  comp:     Comprobante;
  items:    ExpectedItem[];
  memberId: string;
  miembro:  import('../types').FamiliaMiembro;
  esAdmin:  boolean;
  autoAbrir?: boolean;
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
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(comp.datosExtraidos && payeeDeDatos(comp.datosExtraidos)) || comp.nombreArchivo}</span>
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
        <PropuestaCard comp={comp} items={items} memberId={memberId} miembro={miembro} esAdmin={esAdmin} autoAbrir={autoAbrir} />
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
  const [resolviendo,  setResolviendo]  = useState(false);
  const [descartando,  setDescartando]  = useState(false);
  const [errLocal,     setErrLocal]     = useState<string | null>(null);

  async function resolver(tipo: 'comprobante' | 'resumen') {
    setResolviendo(true);
    setErrLocal(null);
    const res = await resolverEntranteAmbiguo(e.hash, tipo);
    setResolviendo(false);
    if (!res.ok) setErrLocal(res.error.message);
  }

  async function descartar() {
    if (!confirm('Se borra el archivo y su documento destino no confirmado. No afecta datos ya vinculados. ¿Continuar?')) return;
    setDescartando(true);
    setErrLocal(null);
    const res = await descartarEntranteCompleto(e.hash);
    setDescartando(false);
    if (!res.ok) setErrLocal(res.error.message);
    // si ok, onSnapshot elimina el card de la bandeja
  }

  const nombre = e.nombreArchivo ?? e.hash.slice(0, 16) + '…';
  const kb     = e.tamano != null ? `${(e.tamano / 1024).toFixed(0)} KB` : '';
  const puedeDscartar = esAdmin && (e.estado === 'ruteado' || e.estado === 'error');

  return (
    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--gf-gray-100)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BadgeEntrante estado={e.estado} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombre}</span>
        {kb && <span style={{ fontSize: 11, color: 'var(--gf-gray-400)', flexShrink: 0 }}>{kb}</span>}
        {puedeDscartar && (
          <Button variant="secondary" size="sm" disabled={descartando} onClick={descartar}>
            {descartando ? 'Descartando…' : 'Descartar'}
          </Button>
        )}
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

      {errLocal && e.estado !== 'ambiguo' && (
        <span style={{ display: 'block', fontSize: 12, color: 'var(--gf-err-text)', marginTop: 6 }}>{errLocal}</span>
      )}
    </div>
  );
}

// ── ShareLanding (F9.51) — deriva fase/datos reales a partir de los mismos
// listeners que ya alimentan la bandeja y el historial. No hay timers: cada
// fase la dispara un dato real que llega por onSnapshot.
// 0 recibido · 1 leyendo (subiendo / sin destino aún) · 2 clasificado (tipo
// conocido, doc destino todavía no visible) · 3 extrayendo (doc visible, sin
// resultado) · 4 listo.

function fmtFechaIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function construirBadgeFactura(pm: PropuestaMatch, items: ExpectedItem[]): BadgeFactura {
  switch (pm.rama) {
    case 0:
      return { titulo: 'Ya cargado', sub: 'Este archivo ya había generado un movimiento', match: false };
    case 1:
      return { titulo: 'Pagó una factura', sub: 'Se concilia con una obligación abierta', match: true };
    case 2: {
      const item = pm.itemEsperadoId ? items.find(i => i.id === pm.itemEsperadoId) : undefined;
      const nombre = item
        ? ([item.categoria, item.subcategoria].filter(Boolean).join(' › ') || item.notas || 'gasto esperado')
        : 'gasto esperado';
      return pm.esAdicional
        ? { titulo: 'Pago adicional', sub: `Suma a ${nombre}`, match: true }
        : { titulo: 'Gasto esperado', sub: `Coincide con ${nombre}`, match: true };
    }
    default:
      return { titulo: 'Movimiento nuevo', sub: 'Se agrega como gasto del mes', match: false };
  }
}

function construirResumenLanding(resumen: CardStatement): ResumenLanding {
  const split = calcularSplitCuotas(resumen);
  const MONEDAS = ['ARS', 'USD'] as const;
  return {
    consumos:   split.nConsumos,
    enCuotas:   split.nEnCuotas,
    totales:    [{ moneda: 'ARS' as const, monto: resumen.totalARS }, { moneda: 'USD' as const, monto: resumen.totalUSD }].filter(t => t.monto > 0),
    esteMes:    MONEDAS.filter(m => split.esteMes[m]).map(m => ({ moneda: m, monto: split.esteMes[m]! })),
    deudaFutura: MONEDAS.filter(m => split.deudaFutura[m]).map(m => ({ moneda: m, monto: split.deudaFutura[m]! })),
  };
}

interface FaseCompartido {
  fase: number; // 0-4
  tipo: 'factura' | 'resumen' | null;
  error: string | null;
  comp?: Comprobante;
  resumen?: CardStatement;
}

function calcularFaseCompartido(
  hash: string | null,
  entrantes: Entrante[],
  comprobantes: Comprobante[],
  resumenes: CardStatement[],
): FaseCompartido {
  if (!hash) return { fase: 0, tipo: null, error: null };
  const entrante = entrantes.find(e => e.hash === hash);
  if (entrante?.estado === 'error') {
    return { fase: 1, tipo: null, error: entrante.motivoDeteccion ?? 'No pudimos procesar el archivo.' };
  }
  const destino = entrante?.destino;
  if (!destino) return { fase: 1, tipo: null, error: null };

  const tipo: 'factura' | 'resumen' = destino.coleccion === 'comprobantes' ? 'factura' : 'resumen';

  if (tipo === 'factura') {
    const comp = comprobantes.find(c => c.id === destino.id);
    if (!comp) return { fase: 2, tipo, error: null };
    if (comp.estado === 'error') {
      return { fase: 3, tipo, error: comp.errorExtraccion ?? 'No pudimos extraer los datos del comprobante.', comp };
    }
    if (!comp.datosExtraidos || !comp.propuestaMatch) return { fase: 3, tipo, error: null, comp };
    return { fase: 4, tipo, error: null, comp };
  }

  const resumen = resumenes.find(r => r.id === destino.id);
  if (!resumen) return { fase: 2, tipo, error: null };
  if (resumen.estado === 'error') {
    return { fase: 3, tipo, error: resumen.errorExtraccion ?? 'No pudimos extraer el resumen.', resumen };
  }
  if (resumen.estado === 'requiere_tarjeta') {
    return { fase: 3, tipo, error: 'Hace falta asignar la tarjeta — completalo en Tarjetas, abajo.', resumen };
  }
  if (resumen.estado === 'subido') return { fase: 3, tipo, error: null, resumen };
  return { fase: 4, tipo, error: null, resumen }; // parseado | confirmado
}

// ── Vista principal ───────────────────────────────────────────────────────────

type ResultadoEnvio =
  | { tipo: 'enviado';   nombre: string }
  | { tipo: 'duplicado'; nombre: string }
  | { tipo: 'error';     mensaje: string };

interface ArchivoCompartido {
  hash: string | null;
  nombreArchivo: string;
  tamano: number;
  errorSubida: string | null;
}

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

  // Lista — onSnapshot
  const { comprobantes, cargando: cargandoLista, error: errorLista } = useComprobantes(memberId, esAdmin);
  const { resumenes } = useResumenesTarjeta();
  const { items } = useItemsEsperados();
  const [mostrarAltaManual,    setMostrarAltaManual]    = useState(false);
  const [expandirHistorial,    setExpandirHistorial]    = useState(false);

  // ── ShareLanding (F9.51) — cubre el arranque en frío cuando llega por
  // Web Share Target. Se monta apenas IDB devuelve el File; sus fases las
  // dispara el progreso real (subida → router → extracción), no timers.
  const [compartido, setCompartido] = useState<ArchivoCompartido | null>(null);
  const [autoAbrirCompId, setAutoAbrirCompId] = useState<string | null>(null);
  const [abrirResumenId,  setAbrirResumenId]  = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('share')) return;
    window.history.replaceState({}, '', window.location.pathname);
    leerYBorrarArchivoCompartido().then(file => {
      if (!file) return; // refresh sin archivo en IDB → Comprobantes normal, sin romper
      const TIPOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
      if (!TIPOS.includes(file.type)) {
        setResultado({ tipo: 'error', mensaje: `Tipo no permitido: ${file.type}` });
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setResultado({ tipo: 'error', mensaje: 'El archivo supera los 10 MB.' });
        return;
      }
      setCompartido({ hash: null, nombreArchivo: file.name, tamano: file.size, errorSubida: null });
      subirEntrante(file, memberId, 'share_target')
        .then(res => {
          if (!res.ok) { setCompartido(c => c && { ...c, errorSubida: res.error.message }); return; }
          setCompartido(c => c && { ...c, hash: res.entrante.hash });
        })
        .catch(err => setCompartido(c => c && { ...c, errorSubida: (err as Error).message }));
    }).catch(() => {});
  }, [memberId]);

  const faseCompartido = calcularFaseCompartido(compartido?.hash ?? null, entrantes, comprobantes, resumenes);

  // Entrante ambiguo: el landing no puede decidir por el usuario (es admin-only,
  // ver EntranteCard) — se cierra solo y la bandeja de abajo queda para resolverlo.
  useEffect(() => {
    if (!compartido?.hash) return;
    const entrante = entrantes.find(e => e.hash === compartido.hash);
    if (entrante?.estado === 'ambiguo') setCompartido(null);
  }, [compartido?.hash, entrantes]);

  const facturaLanding: FacturaLanding | undefined =
    faseCompartido.tipo === 'factura' && faseCompartido.comp?.datosExtraidos && faseCompartido.comp.propuestaMatch
      ? {
          monto:     faseCompartido.comp.datosExtraidos.montoTotal,
          moneda:    faseCompartido.comp.datosExtraidos.moneda,
          comercio:  payeeDeDatos(faseCompartido.comp.datosExtraidos) ?? null,
          vence:     fmtFechaIso(faseCompartido.comp.datosExtraidos.vencimientos?.[0]?.fecha ?? faseCompartido.comp.datosExtraidos.fecha),
          categoria: [faseCompartido.comp.propuestaMatch.categoriaPrellena, faseCompartido.comp.propuestaMatch.subcategoriaPrellena].filter(Boolean).join(' · ') || null,
          badge:     construirBadgeFactura(faseCompartido.comp.propuestaMatch, items),
        }
      : undefined;

  const resumenLanding: ResumenLanding | undefined =
    faseCompartido.tipo === 'resumen' && faseCompartido.resumen && faseCompartido.fase >= 4
      ? construirResumenLanding(faseCompartido.resumen)
      : undefined;

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
        {/* F9.56 — solo visible cuando hay ≥1 ítem pendiente de confirmar.
            Los ruteados cuyo destino ya está vinculado/confirmado se ocultan:
            salieron de la bandeja y están en el historial. */}
        {(() => {
          const bandejaEntrantes = entrantes.filter(e => {
            if (e.estado !== 'ruteado') return true;
            if (!e.destino) return true;
            if (e.destino.coleccion === 'comprobantes') {
              const comp = comprobantes.find(c => c.id === e.destino!.id);
              return !comp || comp.estado !== 'vinculado';
            }
            if (e.destino.coleccion === 'resumenesTarjeta') {
              const res = resumenes.find(r => r.id === e.destino!.id);
              return !res || res.estado !== 'confirmado';
            }
            return true;
          });
          if (bandejaEntrantes.length === 0) return null;
          return (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Bandeja de entrada</div>
              <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-card)', borderRadius: 12, overflow: 'hidden' }}>
                {bandejaEntrantes.map((e, i) => (
                  <div key={e.hash} style={{ borderBottom: i < bandejaEntrantes.length - 1 ? undefined : 'none' }}>
                    <EntranteCard e={e} esAdmin={esAdmin} />
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── Lista ──────────────────────────────────────────────────────── */}
        {/* F9.99.6 — primeros 5 por defecto; "Ver más" expande; "Ver menos" colapsa */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Historial — Comprobantes y facturas</div>
          {cargandoLista && <p style={{ fontSize: 13, color: 'var(--color-text-sec)' }}>Cargando…</p>}
          {errorLista    && <p style={{ fontSize: 13, color: 'var(--gf-err-text)' }}>Error: {errorLista}</p>}
          {!cargandoLista && comprobantes.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--color-text-sec)' }}>Sin comprobantes aún.</p>
          )}
          {(() => {
            const LIMITE = 5;
            const visibles = expandirHistorial ? comprobantes : comprobantes.slice(0, LIMITE);
            const restantes = comprobantes.length - LIMITE;
            return (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {visibles.map(comp => (
                    <ComprobanteCard
                      key={comp.id}
                      comp={comp}
                      items={items}
                      memberId={memberId}
                      miembro={miembro}
                      esAdmin={esAdmin}
                      autoAbrir={autoAbrirCompId === comp.id}
                    />
                  ))}
                </div>
                {!expandirHistorial && restantes > 0 && (
                  <button
                    onClick={() => setExpandirHistorial(true)}
                    style={{ marginTop: 8, width: '100%', padding: '10px 0', borderRadius: 8, border: '1px solid var(--color-border-card)', background: 'var(--color-surface)', fontSize: 13, fontWeight: 600, color: 'var(--color-text-sec)', cursor: 'pointer' }}
                  >
                    Ver más ({restantes} restantes)
                  </button>
                )}
                {expandirHistorial && comprobantes.length > LIMITE && (
                  <button
                    onClick={() => setExpandirHistorial(false)}
                    style={{ marginTop: 8, width: '100%', padding: '10px 0', borderRadius: 8, border: '1px solid var(--color-border-card)', background: 'var(--color-surface)', fontSize: 13, fontWeight: 600, color: 'var(--color-text-sec)', cursor: 'pointer' }}
                  >
                    Ver menos
                  </button>
                )}
              </>
            );
          })()}
        </div>

        {/* ── Resúmenes de tarjeta (solo admin) ──────────────────────────── */}
        {esAdmin && (
          <SeccionTarjetas
            abrirPreview={abrirResumenId}
            onPreviewAbierto={() => setAbrirResumenId(null)}
          />
        )}

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

      {/* ── ShareLanding (F9.51) — cubre el arranque cuando llega por share-target ── */}
      {compartido && (
        <ShareLanding
          nombreArchivo={compartido.nombreArchivo}
          tamano={compartido.tamano}
          fase={faseCompartido.fase}
          tipo={faseCompartido.tipo}
          factura={facturaLanding}
          resumen={resumenLanding}
          error={compartido.errorSubida ?? faseCompartido.error}
          onClose={() => setCompartido(null)}
          onCargarManual={() => { setCompartido(null); setMostrarAltaManual(true); }}
          onReady={() => {
            if (faseCompartido.tipo === 'factura' && faseCompartido.comp) {
              const rama = faseCompartido.comp.propuestaMatch?.rama;
              if (rama === 2 || rama === 3) setAutoAbrirCompId(faseCompartido.comp.id);
            } else if (faseCompartido.tipo === 'resumen' && faseCompartido.resumen?.estado === 'parseado') {
              setAbrirResumenId(faseCompartido.resumen.id);
            }
            setCompartido(null);
          }}
        />
      )}
    </div>
  );
}
