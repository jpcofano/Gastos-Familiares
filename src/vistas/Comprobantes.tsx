import { useState, useRef, useEffect } from 'react';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { confirmarRama1, cargarMovimientoDesdeComprobante, confirmarSueltoDesdeComprobante, buscarObligacionesAbiertas, confirmadoPagoPorFecha, esObligacionDoc, type ObligacionAbierta } from '../datos/comprobantes';
import { subirEntrante, suscribirEntrantes, resolverEntranteAmbiguo, descartarEntrada, descartarEntranteCompleto } from '../datos/entrantes';
import { leerYBorrarArchivoCompartido } from '../datos/shareTargetIdb';
import { useComprobantes } from '../hooks/useComprobantes';
import { useResumenesTarjeta } from '../hooks/useResumenesTarjeta';
import { useMovimientosDelMes } from '../hooks/useMovimientosDelMes';
import { useItemsEsperados } from '../contexto/ItemsEsperadosContext';
import { useDiccionario } from '../contexto/DiccionarioContext';
import { CONFIANZA_UMBRAL } from '../datos/clasificador';
import { calcularChecklist, mesActualStr } from '../datos/checklist';
import { construirAgenda, sueltosFuturosDelMes, pendientesOrdenados, type AgendaEntry, type GrupoAgenda } from '../datos/agenda';
import { desvincularDestinoItem } from '../datos/destinos';
import { actualizarItemEsperado } from '../datos/itemsEsperados';
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

// F9.106 — mes editable en la card de confirmación: rango [mesPago-1 .. mesPago+3], mismo
// ancho que la ventana de reconciliación server-side.
function sumarMeses(mes: string, delta: number): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Mueve una fecha ISO al mes destino, preservando el día (clamped a los días del mes destino).
function ajustarFechaAlMes(fechaISO: string, mesDestino: string): string {
  const dia = Number(fechaISO.slice(8, 10)) || 1;
  const [y, m] = mesDestino.split('-').map(Number);
  const diaClamp = Math.min(dia, new Date(y, m, 0).getDate());
  return `${mesDestino}-${String(diaClamp).padStart(2, '0')}`;
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
function RazonVinculado({ pm, d, items }: { pm: Comprobante['propuestaMatch']; d?: DatosExtraidos; items: ExpectedItem[] }) {
  if (!pm) return null;
  let texto: string;
  let tone: 'info' | 'success' | 'neutral';
  switch (pm.rama) {
    case 0: texto = 'Ya cargado'; tone = 'neutral'; break;
    case 1: texto = pm.origenReconciliacion ? 'Pagó una factura' : 'Vinculado a un movimiento'; tone = 'info'; break;
    case 2: {
      if (pm.origenSuelto) { texto = 'Saldó un gasto suelto'; tone = 'success'; break; }
      if (pm.esAdicional)  { texto = 'Pago adicional';        tone = 'success'; break; }
      // F9.106 — distingue la alta silenciosa (confianza ≥ UMBRAL_AUTO) de la confirmada a mano
      const mesPago = d ? (d.vencimientos?.[0]?.fecha ?? d.fecha) : null;
      if (pm.requiereConfirmacion === false && mesPago) {
        const item = pm.itemEsperadoId ? items.find(i => i.id === pm.itemEsperadoId) : undefined;
        const label = item ? ([item.categoria, item.subcategoria].filter(Boolean).join(' › ') || item.notas || item.id) : 'gasto esperado';
        texto = `Asignado automáticamente a ${label} · ${formatMesCorto(mesPago.slice(0, 7))}`;
        tone = 'success';
        break;
      }
      texto = 'Cumplió un gasto esperado'; tone = 'success'; break;
    }
    case 3: texto = pm.origenSuelto ? 'Saldó un gasto suelto' : 'Cargado como nuevo'; tone = 'success'; break;
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
  // F9.99.9 — agenda unificada (checklist ∪ sueltos), fuente del picker de conciliación
  // manual — ver src/datos/agenda.ts. F9.108: array de grupos, uno por mes (mes actual +
  // mes siguiente), para poder ofrecer también obligaciones del mes que viene.
  agenda: GrupoAgenda[];
  memberId: string;
  miembro: import('../types').FamiliaMiembro;
  esAdmin: boolean;
  // F9.51 — el landing de share-target salta directo a "Revisar y cargar"
  // cuando la propuesta es rama 2/3, sin que el usuario tenga que tocarlo.
  autoAbrir?: boolean;
}

// F9.99.9 — etiqueta + monto de un candidato de la agenda (esperado o suelto) para el picker.
function labelAgenda(e: AgendaEntry): string {
  return e.kind === 'esperado'
    ? (e.ci.item.notas || e.ci.item.matchTexto?.incluye[0] || [e.ci.item.categoria, e.ci.item.subcategoria].filter(Boolean).join(' › ') || e.ci.item.id)
    : (e.mov.descripcion || '(sin descripción)');
}
function montoAgenda(e: AgendaEntry): { monto: number | null; moneda: 'ARS' | 'USD' } {
  return e.kind === 'esperado'
    ? { monto: e.ci.item.montoEsperado, moneda: e.ci.item.moneda }
    : { monto: e.mov.monto, moneda: e.mov.moneda };
}
function candKey(e: AgendaEntry, mes: string): string {
  return e.kind === 'esperado' ? `esperado:${mes}:${e.ci.item.id}` : `suelto:${e.mov.id}`;
}
// F9.108 — candidatos pendientes de un grupo (mes), filtrados a Gasto + misma moneda del
// comprobante; los cubiertos ya no se ofrecen (pendientesOrdenados los excluye).
// F9.119 — el filtro a `tipo === 'Gasto'` dejaba los cobros esperados fuera del picker: el
// modelo, la UI de Perfil y el matcheo del checklist ya los soportaban, pero no había forma de
// asignarles un comprobante. Ahora se ofrecen los dos y el tipo del movimiento lo define el
// ítem elegido (ver `preload` más abajo).
function candidatosDeGrupo(entradas: AgendaEntry[], moneda: string): AgendaEntry[] {
  return pendientesOrdenados(entradas.filter(e => e.kind === 'esperado'
    ? e.ci.item.moneda === moneda
    : e.mov.moneda === moneda));
}
// F9.108 — parseo robusto de la selección del picker: los itemId pueden contener ':', no
// se puede partir a ciegas por el primer ':' (reemplaza el parseo previo que sí lo hacía).
function parsePickerSel(sel: string): { kind: 'esperado' | 'suelto' | null; mes: string; id: string } {
  if (sel.startsWith('esperado:')) {
    const resto = sel.slice('esperado:'.length);
    const i = resto.indexOf(':');
    return { kind: 'esperado', mes: resto.slice(0, i), id: resto.slice(i + 1) };
  }
  if (sel.startsWith('suelto:')) return { kind: 'suelto', mes: '', id: sel.slice('suelto:'.length) };
  return { kind: null, mes: '', id: '' };
}

function PropuestaCard({ comp, items, agenda, memberId, miembro, esAdmin, autoAbrir }: PropuestaProps) {
  const pm = comp.propuestaMatch;
  const d  = comp.datosExtraidos;
  const { clasificar, cargando: cargandoDict } = useDiccionario();
  const [confirmando,   setConfirmando]   = useState(false);
  const [mostrarAlta,   setMostrarAlta]   = useState(false);
  const [candidatoSel,  setCandidatoSel]  = useState<string>('');
  const [errorLocal,    setErrorLocal]    = useState<string | null>(null);
  const [mostrarPicker, setMostrarPicker] = useState(false);
  // F9.99.9 — candidato del picker, prefijado por tipo: "esperado:<itemId>" | "suelto:<movId>"
  // (antes solo guardaba el itemEsperadoId; ahora la agenda mezcla dos tipos de candidato).
  const [pickerSel,     setPickerSel]     = useState<string>('');
  const [pickerCargando, setPickerCargando] = useState(false);
  // F9.99.7 Parte 2 — obligaciones abiertas del ítem elegido (mismo mes + todos los futuros)
  const [obligaciones,  setObligaciones]  = useState<ObligacionAbierta[]>([]);
  const [obligacionSel, setObligacionSel] = useState<string>('');
  const [buscandoObligaciones, setBuscandoObligaciones] = useState(false);
  // F9.99.9 — rama 2 con múltiples esperados matcheados por texto: el usuario elige, no se
  // asigna a ciegas (antes tomaba itemsMatch[0] en silencio).
  const [rama2Sel, setRama2Sel] = useState<string>('');
  // F9.106 — mes editable en la card de confirmación (banda 0.7-0.9); vacío = usar el default
  // calculado (mes del 1er vencimiento). Auto-silenciosa (≥0.9): flag de error para fallback manual.
  const [mesElegido,    setMesElegido]    = useState<string>('');
  // F9.108 — sin obligación abierta: fuerza el itemEsperadoId al derivar al alta prellenada
  // (el callable de alta manual no admite payload a mano, ver handleConciliar más abajo).
  const [esperadoForzado, setEsperadoForzado] = useState<string>('');
  // F9.109 — "Asignar como movimiento nuevo": el usuario dice que el gasto esperado propuesto
  // (rama 2) NO corresponde. Prioridad sobre esperadoForzado — es una corrección explícita.
  const [desvincular, setDesvincular] = useState(false);
  const [avisoDesaprendizaje, setAvisoDesaprendizaje] = useState<string | null>(null);
  const [errorAutoSilencioso, setErrorAutoSilencioso] = useState<string | null>(null);
  const [autoFallidoManual,   setAutoFallidoManual]   = useState(false);
  const autoConfirmadoRef = useRef(false);
  const autoAbiertoRef = useRef(false);
  const autoSilencioRef = useRef(false);

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

  // F9.106 — rama 2 con confianza ≥ UMBRAL_AUTO: alta silenciosa, sin card ni tap del usuario.
  useEffect(() => {
    if (pm?.rama !== 2 || pm.requiereConfirmacion !== false) return;
    if (autoSilencioRef.current) return;
    autoSilencioRef.current = true;
    setMostrarAlta(true);
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

  // F9.106 — mes de pago default (1er vencimiento, fallback emisión) + override manual del
  // usuario en la banda de confirmación (0.7-0.9). fechaEfectiva mueve solo el mes, preserva el día.
  const fechaOriginal   = d.vencimientos?.[0]?.fecha ?? d.fecha ?? null;
  const mesPagoDefault  = fechaOriginal ? fechaOriginal.slice(0, 7) : new Date().toISOString().slice(0, 7);
  const mesPagoEfectivo = mesElegido || mesPagoDefault;
  const fechaEfectiva   = fechaOriginal && mesPagoEfectivo !== mesPagoDefault
    ? ajustarFechaAlMes(fechaOriginal, mesPagoEfectivo)
    : fechaOriginal;

  const preloadBase = {
    tipo:                'Gasto' as const,
    fecha:               fechaEfectiva ?? undefined,
    descripcion:         descripcionFinal,
    descripcionOriginal: (descripcionCruda && descripcionFinal !== descripcionCruda) ? descripcionCruda : undefined,
    moneda:              d.moneda,
    monto:               d.montoTotal != null ? String(d.montoTotal) : undefined,
    hashPdf:             comp.hashPdf,
    refStoragePdf:       comp.refStoragePdf,
    // F9.133 §3 — último eslabón de la precedencia `item.persona → preload.persona → memberId`.
    // Acá NO hay ítem esperado en juego (rama 3, alta suelta), así que quien opera es la mejor
    // aproximación disponible; las ramas con ítem la sobrescriben más abajo.
    persona:             memberId,
    categoria:           pm.categoriaPrellena    ?? sugerenciaValida?.categoria    ?? undefined,
    subcategoria:        pm.subcategoriaPrellena ?? sugerenciaValida?.subcategoria ?? undefined,
    etiqueta:            pm.etiquetaPrellena     ?? sugerenciaValida?.etiqueta     ?? undefined,
    banco:               'Efectivo' as const,
    // F9.75 — obligaciones (factura*, recibo_servicio) NO se pagan por vencimiento; el pago llega
    // después. Solo pagos/tickets confirman por fecha. (El server recalcula; esto mantiene el
    // preload coherente con lo que se va a guardar.)
    confirmadoPago:      !esObligacionDoc(d.tipoDocumento) && confirmadoPagoPorFecha(fechaEfectiva),
    // F6.8 — destino propagado para que aprenderDestino() aprenda al confirmar
    destinoCbu:          d.destinoCbu    ?? null,
    destinoCuit:         d.destinoCuit   ?? null,
    destinoAlias:        d.destinoAlias  ?? null,
    destinoNombre:       d.destinoNombre ?? null,
    vencimientos:        d.vencimientos  ?? null,
    // F6.x descartar — stamp de procedencia para distinguir de rama 1
    origenComprobanteId: comp.id,
  };

  // F9.99.9 — rama 2 con múltiples esperados matcheados por texto (pm.candidatos): el usuario
  // elige cuál corresponde en vez de asignarse a ciegas a itemsMatch[0] (pm.itemEsperadoId).
  // Con un solo candidato (caso común) esto no agrega ningún paso — camino feliz intacto.
  const rama2CandidatosTipoEsperado = pm.rama === 2 ? (pm.candidatos ?? []).filter(c => c.tipo === 'esperado') : [];
  const necesitaElegirRama2 = rama2CandidatosTipoEsperado.length > 1;
  const itemEsperadoEfectivo = necesitaElegirRama2 ? (rama2Sel || undefined) : pm.itemEsperadoId;

  const esperado = itemEsperadoEfectivo ? items.find(i => i.id === itemEsperadoEfectivo) : undefined;
  // F9.109 — nombre del ítem para mostrar SIEMPRE que haya un itemEsperadoEfectivo (antes solo
  // aparecía en la banda de confianza 0.7-0.9 o en el texto del modo auto; en rama 2 por
  // matchTexto el usuario decidía a ciegas). Fallback al id crudo si el ítem no está en `items`
  // (inactivo/borrado) — nunca vacío.
  const labelEsperado = esperado
    ? ([esperado.categoria, esperado.subcategoria].filter(Boolean).join(' › ') || esperado.notas || esperado.id)
    : (itemEsperadoEfectivo || 'gasto esperado');

  // F9.109 — `desvincular` ("Asignar como movimiento nuevo") tiene prioridad sobre todo lo
  // demás, incluido `esperadoForzado` de F9.108: es la corrección explícita del usuario.
  const itemForzado = esperadoForzado ? items.find(i => i.id === esperadoForzado) : undefined;
  const preload = desvincular
    ? { ...preloadBase, itemEsperadoId: undefined }
    : esperadoForzado
    ? {
        ...preloadBase,
        banco:          undefined,
        itemEsperadoId: esperadoForzado,
        // F9.119 — el tipo lo manda el ítem elegido: asignar un comprobante a un cobro
        // esperado tiene que crear un Ingreso, no un Gasto.
        tipo:           itemForzado?.tipo         ?? preloadBase.tipo,
        categoria:      itemForzado?.categoria    ?? preloadBase.categoria,
        subcategoria:   itemForzado?.subcategoria ?? preloadBase.subcategoria,
        // F9.133 §3 — ver el comentario de `preloadBase.persona`.
        persona:        itemForzado?.persona      ?? preloadBase.persona,
      }
    : pm.rama === 2
    ? {
        ...preloadBase,
        banco:          undefined,
        tipo:           esperado?.tipo         ?? preloadBase.tipo,
        categoria:      esperado?.categoria    ?? undefined,
        subcategoria:   esperado?.subcategoria ?? undefined,
        itemEsperadoId: itemEsperadoEfectivo,
        // F9.133 §3 — la persona del ÍTEM le gana a la de quien opera. Sin esto, un admin que carga
        // el comprobante del gasto de otro lo deja atribuido a sí mismo: el campo queda poblado, no
        // aparece como hueco, y ATRIBUYE MAL EN SILENCIO — peor que dejarlo vacío. Medido en
        // producción: 2 movimientos de "Micro Rugby" quedaron en Juan cuando el ítem dice Federico.
        // `item.persona` está poblada en 8 de 24 ítems y hasta acá no se leía nunca.
        persona:        esperado?.persona      ?? preloadBase.persona,
      }
    : preloadBase;

  // F9.106 — "Obligación de {mes}" reemplaza el genérico "Gasto esperado" (visibilidad del mes
  // de pago pedida por el dueño); "Pago adicional" se mantiene solo para el caso real (§3 fila 3).
  // F9.109 — `desvincular` fuerza "Movimiento nuevo" (refleja lo que se va a guardar); rama 2
  // suma siempre el nombre del ítem (chip + badge del Hero, antes solo visible en la banda de
  // confianza 0.7-0.9 o en texto sin botones del modo auto).
  const labelRama2 = desvincular
    ? 'Movimiento nuevo'
    : pm.rama === 2
    ? `${pm.esAdicional ? 'Pago adicional' : `Obligación de ${formatMesCorto(mesPagoEfectivo)}`}${itemEsperadoEfectivo ? ` · ${labelEsperado}` : ''}`
    : 'Movimiento nuevo';

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
          {labelRama2}
        </span>
      </span>
    </span>
  );

  // F9.99.9/F9.108 — picker "Conciliar con gasto esperado" / "Asignar a otro gasto": disponible
  // para TODO documento de gasto (antes solo transferencia/comprobante_pago), rama 3 y rama 2
  // (secundario/colapsado). Candidatos = agenda unificada de dos meses (mes actual + siguiente),
  // uno por grupo (ver render); los cubiertos (pagado/automático/confirmado) ya no se ofrecen.
  const { kind: pickerKind, mes: pickerMes, id: pickerId } = parsePickerSel(pickerSel);

  // F9.99.7 Parte 2 — al elegir un esperado, busca sus obligaciones abiertas (mismo mes + futuras,
  // F9.99.9 Parte 4: piso mesComp−1) para que el usuario elija cuál salda este pago. Un suelto
  // es un único movimiento — no tiene "qué mes", se confirma directo (ver handleConciliar).
  // F9.108 — el mes de referencia es el de la FILA elegida (pickerMes), no el del comprobante:
  // una fila de agosto sigue mostrando obligaciones abiertas de julio (buscarObligacionesAbiertas
  // pisa en mesDesde−1), cada una con su propio mes visible en el sub-picker.
  useEffect(() => {
    if (pickerKind !== 'esperado' || !pickerId) { setObligaciones([]); setObligacionSel(''); return; }
    let cancelado = false;
    setBuscandoObligaciones(true);
    setObligacionSel('');
    buscarObligacionesAbiertas(pickerId, pickerMes || mesPagoDefault).then(obs => {
      if (cancelado) return;
      setObligaciones(obs);
      setBuscandoObligaciones(false);
    });
    return () => { cancelado = true; };
  }, [pickerKind, pickerId, pickerMes, mesPagoDefault]);

  async function handleConciliar() {
    if (!pickerSel) return;
    setPickerCargando(true);
    setErrorLocal(null);
    // F9.99.9 — suelto: confirma el movimiento existente (pagado+confirmadoPago), nunca crea uno nuevo.
    if (pickerKind === 'suelto') {
      const res = await confirmarSueltoDesdeComprobante(comp, pickerId);
      setPickerCargando(false);
      if (!res.ok) setErrorLocal(res.error.message);
      else setMostrarPicker(false);
      return;
    }
    if (obligaciones.length > 0) {
      if (!obligacionSel) { setPickerCargando(false); return; }
      const res = await confirmarRama1(comp, obligacionSel, pickerId);
      setPickerCargando(false);
      if (!res.ok) setErrorLocal(res.error.message);
    } else {
      // F9.108 — sin obligación abierta: NO se arma el payload a mano. El callable exige
      // creadoPor/monto:number/fechaMs/mes (index.ts:1756-1770) y preloadBase no los tiene
      // (esta rama fallaba siempre con invalid-argument). Se deriva al alta prellenada, que es
      // el único lugar que arma el payload válido y resuelve TC para USD.
      setMesElegido(pickerMes || mesPagoDefault);
      setEsperadoForzado(pickerId);
      setPickerCargando(false);
      setMostrarPicker(false);
      setMostrarAlta(true);
      return;
    }
  }

  // F9.109 — desaprendizaje fail-soft: el movimiento YA se guardó (se llama solo si res.ok);
  // esto nunca puede bloquear ni deshacer esa carga. Dos correcciones independientes, cada
  // una en su propio try/catch — la falla de una no cancela la otra.
  // `d`/`pm` ya están narrowed (no-undefined) acá por el guard de arriba, pero TS no
  // preserva ese narrowing dentro de una función anidada — se fijan en consts aparte para
  // que su tipo quede resuelto de una vez (sin `| undefined`).
  const datosCorreccion = d;
  const pmCorreccion = pm;
  async function corregirAprendizaje(itemId: string) {
    let fallo = false;
    try {
      await desvincularDestinoItem([datosCorreccion.destinoCbu, datosCorreccion.destinoCuit, datosCorreccion.destinoAlias, datosCorreccion.destinoNombre], itemId);
    } catch (e) {
      console.error('[F9.109] desvincularDestinoItem falló:', e);
      fallo = true;
    }
    // matchTexto: solo si el match no vino por destino (origen texto) — origenDestino ya
    // se corrige con desvincularDestinoItem de arriba.
    if (pmCorreccion.origenDestino !== true) {
      try {
        const item  = items.find(i => i.id === itemId);
        const texto = [datosCorreccion.comercioRazonSocial, datosCorreccion.destinoNombre].filter(Boolean).join(' ').toLowerCase();
        const token = (payeeDeDatos(datosCorreccion) ?? '').trim().toLowerCase();
        if (item?.matchTexto && token && texto.includes(token) && !item.matchTexto.excluye.includes(token)) {
          const res = await actualizarItemEsperado(itemId, {
            matchTexto: { incluye: item.matchTexto.incluye, excluye: [...item.matchTexto.excluye, token] },
          });
          if (!res.ok) { console.error('[F9.109] actualizarItemEsperado falló:', res.error); fallo = true; }
        }
      } catch (e) {
        console.error('[F9.109] corrección de matchTexto falló:', e);
        fallo = true;
      }
    }
    if (fallo) setAvisoDesaprendizaje('El movimiento se guardó, pero no se pudo registrar la corrección.');
  }

  // F9.106 — confianza ≥ UMBRAL_AUTO (rama 2 vía destino): alta silenciosa, sin card ni tap.
  // Si onErrorAuto dispara, autoFallidoManual cae a modoAuto=false y muestra el camino manual.
  const modoAuto = pm.rama === 2 && pm.requiereConfirmacion === false && !autoFallidoManual;

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {modoAuto ? (
        <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>
          Asignando automáticamente a {labelEsperado} · {formatMesCorto(mesPagoEfectivo)}…
        </span>
      ) : (
      <>
      {errorAutoSilencioso && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Badge tone="warning">No se pudo asignar automáticamente</Badge>
          <span style={{ fontSize: 12, color: 'var(--gf-err-text)' }}>{errorAutoSilencioso}</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {(pm.categoriaPrellena || sugerenciaValida) && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 8, padding: '6px 11px', background: 'rgba(245,158,11,.10)', border: '1px solid rgba(245,158,11,.25)', fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
            <Icon name="sparkles" size={13} color="#d97706" />
            {pm.categoriaPrellena ?? sugerenciaValida?.categoria ?? 'Pre-clasificado'}
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 8, padding: '6px 11px', background: pm.rama === 2 ? 'rgba(12,143,98,.10)' : 'var(--gf-gray-100)', border: pm.rama === 2 ? '1px solid var(--gf-emerald-line)' : '1px solid transparent', fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
          <Icon name={pm.rama === 2 ? 'git-compare' : 'plus'} size={13} color={pm.rama === 2 ? 'var(--color-accent)' : 'var(--color-text-sec)'} />
          {labelRama2}
        </span>
      </div>

      {/* F9.106 — banda de confianza 0.7-0.9 (match por destino): "a qué gasto y de qué mes",
          ambos editables — mes acá, gasto esperado vía "Asignar a otro gasto" (picker existente). */}
      {pm.rama === 2 && pm.origenDestino && pm.requiereConfirmacion === true && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', background: 'var(--gf-gray-50)', borderRadius: 10, border: '1px solid var(--gf-gray-100)' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-strong)' }}>
            Asignar a: {esperado ? ([esperado.categoria, esperado.subcategoria].filter(Boolean).join(' › ') || esperado.notas || esperado.id) : 'gasto esperado'} · Mes: {formatMesCorto(mesPagoEfectivo)}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <select
              value={mesPagoEfectivo}
              onChange={e => setMesElegido(e.target.value)}
              style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            >
              {[-1, 0, 1, 2, 3].map(delta => {
                const m = sumarMeses(mesPagoDefault, delta);
                return <option key={m} value={m}>{formatMesCorto(m)}</option>;
              })}
            </select>
            <span style={{ fontSize: 11, color: 'var(--gf-gray-400)' }}>Confianza {Math.round((pm.confianza ?? 0) * 100)}%</span>
          </div>
        </div>
      )}

      {/* F9.99.9 — rama 2 con múltiples esperados: el usuario elige antes de seguir (no corta
          el camino feliz — con un único candidato esto no se renderiza). */}
      {pm.rama === 2 && necesitaElegirRama2 && !rama2Sel && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', background: 'var(--gf-gray-50)', borderRadius: 10, border: '1px solid var(--gf-gray-100)' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)' }}>Coincide con varios gastos esperados — elegí cuál</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {rama2CandidatosTipoEsperado.map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '5px 0', borderBottom: '1px solid var(--gf-gray-100)', cursor: 'pointer' }}>
                <input type="radio" name={`r2-${comp.id}`} value={c.id} onChange={() => setRama2Sel(c.id)} />
                <span style={{ flex: 1 }}>
                  {c.descripcion ?? c.id}
                  {c.monto != null && <span style={{ color: 'var(--gf-gray-400)', marginLeft: 6 }}>{fmtMonto(c.monto, c.moneda ?? d.moneda)}</span>}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* F9.99.9 — picker de conciliación manual, ampliado a cualquier doc de gasto (rama 3) y
          disponible como acción secundaria en rama 2 ("Asignar a otro gasto"). Candidatos =
          agenda unificada del mes actual (esperados + sueltos), no solo plantillas. */}
      {esAdmin && !mostrarAlta && (!necesitaElegirRama2 || rama2Sel) && (
        <Button variant="ghost" size="sm" onClick={() => { setMostrarPicker(p => !p); setPickerSel(''); setErrorLocal(null); }}>
          <Icon name="git-compare" size={13} /> {pm.rama === 2 ? 'Asignar a otro gasto' : 'Conciliar con gasto esperado'}
        </Button>
      )}
      {/* F9.109 — tercera salida cuando la rama 2 propone un gasto esperado que NO corresponde:
          carga el movimiento suelto (sin itemEsperadoId) y desaprende el vínculo al guardar. */}
      {esAdmin && pm.rama === 2 && !!itemEsperadoEfectivo && !mostrarAlta && (
        <Button variant="ghost" size="sm" onClick={() => { setDesvincular(true); setMostrarPicker(false); setMostrarAlta(true); }}>
          <Icon name="plus" size={13} /> Asignar como movimiento nuevo
        </Button>
      )}
      {mostrarPicker && esAdmin && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', background: 'var(--gf-gray-50)', borderRadius: 10, border: '1px solid var(--gf-gray-100)' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)' }}>Elegí qué gasto salda este comprobante</span>
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {agenda.map((grupo, idx) => {
              const candidatos = candidatosDeGrupo(grupo.entradas, d.moneda);
              const esMesSiguiente = idx === 1;
              return (
                <div key={grupo.mes} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: idx > 0 ? 6 : 0, paddingTop: idx > 0 ? 6 : 0, borderTop: idx > 0 ? '1px solid var(--gf-gray-100)' : undefined }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-sec)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                    {esMesSiguiente ? `Mes siguiente · ${formatMesCorto(grupo.mes)}` : `Este mes · ${formatMesCorto(grupo.mes)}`}
                  </span>
                  {esMesSiguiente && (
                    <span style={{ fontSize: 11, color: 'var(--gf-gray-400)' }}>Si esta factura se paga el mes que viene, elegí acá.</span>
                  )}
                  {candidatos.length === 0 && (
                    <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Nada pendiente en {formatMesCorto(grupo.mes)}.</span>
                  )}
                  {candidatos.map(e => {
                    const key = candKey(e, grupo.mes);
                    const vencidoE = e.kind === 'esperado' && e.ci.estado === 'vencido';
                    const { monto, moneda } = montoAgenda(e);
                    return (
                      <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '5px 0', borderBottom: '1px solid var(--gf-gray-100)', cursor: 'pointer' }}>
                        <input type="radio" name={`picker-${comp.id}`} value={key} checked={pickerSel === key} onChange={() => setPickerSel(key)} />
                        <Icon name={vencidoE ? 'alert-circle' : 'clock'} size={13} color={vencidoE ? 'var(--gf-expense)' : 'var(--gf-gray-400)'} />
                        <span style={{ flex: 1 }}>
                          {labelAgenda(e)}
                          {e.kind === 'suelto' && <Badge tone="neutral">Sin plantilla</Badge>}
                          {vencidoE && <span style={{ color: 'var(--gf-expense)', marginLeft: 6, fontWeight: 700 }}>Venció día {e.ci.item.diaVencimiento}</span>}
                          {monto != null && <span style={{ color: 'var(--gf-gray-400)', marginLeft: 6 }}>{fmtMonto(monto, moneda)}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {/* F9.99.7 Parte 2 — mismo mes + todos los futuros, cada uno con su mes visible; solo
              aplica a esperados (un suelto es un único movimiento, sin ambigüedad de mes). */}
          {pickerKind === 'esperado' && buscandoObligaciones && (
            <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Buscando obligaciones abiertas…</span>
          )}
          {pickerKind === 'esperado' && !buscandoObligaciones && obligaciones.length > 0 && (
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
          {pickerKind === 'esperado' && !buscandoObligaciones && obligaciones.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>No hay obligación abierta para este ítem — se va a crear un movimiento nuevo.</span>
          )}
          {errorLocal && <span style={{ fontSize: 12, color: 'var(--gf-err-text)' }}>{errorLocal}</span>}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="primary" size="sm"
              disabled={!pickerSel || pickerCargando || (pickerKind === 'esperado' && (buscandoObligaciones || (obligaciones.length > 0 && !obligacionSel)))}
              onClick={handleConciliar}
            >
              {pickerCargando ? 'Conciliando…' : 'Confirmar'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMostrarPicker(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      {!mostrarAlta && !mostrarPicker && (!necesitaElegirRama2 || rama2Sel) && (
        <Button variant="primary" size="sm" disabled={cargandoDict} onClick={() => setMostrarAlta(true)}>
          {cargandoDict ? 'Cargando…' : 'Revisar y cargar'}
        </Button>
      )}
      </>
      )}
      {/* F9.109 — junto al alta: aclara que la corrección de aprendizaje va a acompañar la carga. */}
      {desvincular && mostrarAlta && (
        <span style={{ fontSize: 11, color: 'var(--gf-gray-400)' }}>No lo vamos a volver a proponer como {labelEsperado}.</span>
      )}
      {avisoDesaprendizaje && (
        <span style={{ fontSize: 12, color: 'var(--gf-warn-text)' }}>{avisoDesaprendizaje}</span>
      )}
      {mostrarAlta && (
        <AltaMovimiento
          key={comp.id}
          memberId={memberId}
          miembro={miembro}
          preload={preload}
          badgePropuesta={badgePropuesta}
          autoConfirmar={modoAuto}
          onErrorAuto={modoAuto ? (msg) => {
            setErrorAutoSilencioso(msg);
            setAutoFallidoManual(true);
            setMostrarAlta(false);
          } : undefined}
          onGuardarPayload={async (payload) => {
            const res = await cargarMovimientoDesdeComprobante(comp.id, payload);
            // F9.109 — desaprendizaje fail-soft: solo si el movimiento se guardó bien y el
            // usuario pidió explícitamente "Asignar como movimiento nuevo".
            if (res.ok && desvincular && itemEsperadoEfectivo) {
              void corregirAprendizaje(itemEsperadoEfectivo);
            }
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
  comp, items, agenda, memberId, miembro, esAdmin, autoAbrir,
}: {
  comp:     Comprobante;
  items:    ExpectedItem[];
  agenda:   GrupoAgenda[];
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
        <PropuestaCard comp={comp} items={items} agenda={agenda} memberId={memberId} miembro={miembro} esAdmin={esAdmin} autoAbrir={autoAbrir} />
      )}
      {comp.estado === 'extraido' && !comp.propuestaMatch && (
        <p style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 6 }}>Calculando match…</p>
      )}
      {comp.estado === 'vinculado' && comp.propuestaMatch && (
        <div style={{ marginTop: 8 }}>
          <RazonVinculado pm={comp.propuestaMatch} d={comp.datosExtraidos} items={items} />
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

  // F9.99.9 — agenda del mes actual (checklist ∪ sueltos futuros), fuente del picker de
  // conciliación manual (decisión del dueño: alcance = mes actual + vencidos, NO la ventana
  // amplia [mes−1..mes+3] que usa el match automático). No-admin igual llama al hook (no puede
  // condicionar hooks), pero el picker está gateado a esAdmin — el resultado no se usa.
  // F9.108 — mes siguiente sumado al picker (grupo separado, rotulado, debajo del mes
  // actual): una factura del mes que viene no tenía candidato antes de este cambio.
  const mesAct = mesActualStr();
  const mesSig = sumarMeses(mesAct, 1);
  const { movimientos: movsMesActual } = useMovimientosDelMes(mesAct, esAdmin ? undefined : memberId);
  const { movimientos: movsMesSig }    = useMovimientosDelMes(mesSig, esAdmin ? undefined : memberId);
  const checklistMesActual = calcularChecklist(items, movsMesActual, mesAct);
  const checklistMesSig    = calcularChecklist(items, movsMesSig, mesSig);
  const agendaPicker: GrupoAgenda[] = [
    { mes: mesAct, entradas: construirAgenda(checklistMesActual, sueltosFuturosDelMes(movsMesActual, checklistMesActual, new Date())) },
    { mes: mesSig, entradas: construirAgenda(checklistMesSig,   sueltosFuturosDelMes(movsMesSig,   checklistMesSig,   new Date())) },
  ];

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
                      agenda={agendaPicker}
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
