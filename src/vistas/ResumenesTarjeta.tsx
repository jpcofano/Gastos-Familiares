import { useState, useEffect, useRef, useCallback } from 'react';
import { descartarEntrada } from '../datos/entrantes';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { useDiccionario } from '../contexto/DiccionarioContext';
import {
  asignarTarjetaResumen,
  suscribirResumenesTarjeta,
  confirmarResumenTarjeta,
  agregarAjusteCuadreManual,
  calcularCuadre,
  reintentarResumen,
  type CuadreResult,
} from '../datos/resumenesTarjeta';
import { cargarSubcategorias, type SubcategoriaItem } from '../datos/catalogos';
import { cargarFamiliaConfig, resolverNombreMiembro } from '../familia';
import type { CardStatement, MovimientoParseado, FamiliaConfig } from '../types';
import { CONFIANZA_UMBRAL } from '../datos/clasificador';
import { Icon } from '../design-system/Icon';
import { TarjetaFace, CaraTarjeta, BadgeEstadoResumen, calcularSplitCuotas, fmtMonto as fmtMontoFace } from './TarjetaFace';
import './ResumenesTarjeta.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMonto(n: number, moneda: 'ARS' | 'USD'): string {
  return moneda === 'USD'
    ? `U$S ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const TIPO_LABEL: Record<string, string> = {
  consumo: 'consumo', cuota: 'cuota', impuesto: 'imp.',
  reintegro_percepcion: 'reintegro', bonificacion: 'bonif.', reverso: 'reverso',
};

// ── Preview ───────────────────────────────────────────────────────────────────

interface PreviewProps {
  resumen: CardStatement;
  config: FamiliaConfig;
  subcats: SubcategoriaItem[];
  memberId: string;
  onConfirmado: () => void;
  onCerrar: () => void;
}

function PreviewResumen({ resumen, config, subcats, memberId, onConfirmado, onCerrar }: PreviewProps) {
  const { clasificar } = useDiccionario();
  const [lineas, setLineas] = useState<MovimientoParseado[]>([]);
  const [guardando,   setGuardando]   = useState(false);
  const [ajustando,   setAjustando]   = useState(false);
  const [errorLocal,  setErrorLocal]  = useState<string | null>(null);
  const inicializadoRef = useRef(false);

  useEffect(() => {
    if (inicializadoRef.current) return;
    inicializadoRef.current = true;
    const iniciales = resumen.movimientosParseados.map(linea => {
      const personaId = linea.personaDetectada
        ? resolverNombreMiembro(linea.personaDetectada, config)
        : null;
      const esImpuesto =
        linea.tipoLinea === 'impuesto' || linea.tipoLinea === 'reintegro_percepcion';
      let categoria: string | null = null;
      let subcategoria: string | null = null;
      if (esImpuesto) {
        categoria = 'Impuestos y finanzas';
      } else {
        const cls = linea.descripcionRaw
          ? clasificar(linea.descripcionRaw, {
              banco:   resumen.banco   || null,
              tarjeta: resumen.tarjetaCodigo || null,
            })
          : null;
        if (cls && cls.confianza >= CONFIANZA_UMBRAL) {
          categoria    = cls.categoria;
          subcategoria = cls.subcategoria ?? null;
        }
      }
      return { ...linea, personaConfirmada: personaId, categoria, subcategoria };
    });
    setLineas(iniciales);
  // resumen.id es estable para la vida de este preview
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumen.id]);

  const actualizar = useCallback((idx: number, cambios: Partial<MovimientoParseado>) => {
    setLineas(prev => prev.map((l, i) => i === idx ? { ...l, ...cambios } : l));
  }, []);

  async function cerrarDiferencia() {
    const umbralARS = Math.min(5000, resumen.totalARS * 0.02);
    const esGrande  = cuadre.diffARS > umbralARS || cuadre.diffUSD > 2;
    if (esGrande) {
      const ok = window.confirm(
        `Diferencia grande (${cuadre.diffARS > 0 ? fmtMonto(cuadre.diffARS, 'ARS') : ''}` +
        `${cuadre.diffUSD > 0 ? ` U$S ${cuadre.diffUSD.toFixed(2)}` : ''}) — puede ser una ` +
        `línea real no leída, no un error de redondeo. ¿Absorber igual?`,
      );
      if (!ok) return;
    }
    setAjustando(true);
    setErrorLocal(null);
    const res = await agregarAjusteCuadreManual(resumen, lineas, memberId);
    setAjustando(false);
    if (!res.ok) setErrorLocal(res.error.message);
  }

  async function confirmar() {
    setGuardando(true);
    setErrorLocal(null);
    const res = await confirmarResumenTarjeta(resumen, lineas, memberId, config);
    setGuardando(false);
    if (!res.ok) { setErrorLocal(res.error.message); return; }
    onConfirmado();
  }

  const miembros = Object.entries(config.miembros).filter(([, m]) => m.activo);
  const cats     = (config.categorias ?? []).filter(c => c.activo).map(c => c.nombre);
  const incluidas = lineas.filter(l => l.incluir).length;
  const sinPersona = lineas.some(
    l => l.incluir && l.tipoLinea === 'consumo' && !l.personaConfirmada,
  );
  const cuadre: CuadreResult = calcularCuadre(lineas, resumen.totalARS, resumen.totalUSD, resumen.ajustesConsolidado);
  const cuadreOk = cuadre.balanceARS && cuadre.balanceUSD;

  return (
    <div className="rt-preview">
      <div className="rt-preview-header">
        <div className="rt-preview-titulo">
          <strong>{resumen.tarjeta}</strong> — {resumen.banco}
          {resumen.titular && <span className="rt-titular"> ({resumen.titular})</span>}
          <span className="rt-periodo"> {resumen.periodo}</span>
        </div>
        <div className="rt-preview-totales">
          {resumen.totalARS > 0 && <span>{fmtMonto(resumen.totalARS, 'ARS')}</span>}
          {resumen.totalUSD > 0 && <span>{fmtMonto(resumen.totalUSD, 'USD')}</span>}
        </div>
        <button className="rt-btn-cerrar" onClick={onCerrar} disabled={guardando}>✕</button>
      </div>

      <div className="rt-preview-info">
        {incluidas} de {lineas.length} líneas seleccionadas
        {sinPersona && (
          <span className="rt-aviso"> · Algunos consumos no tienen persona asignada.</span>
        )}
      </div>

      <div className={`rt-cuadre ${cuadreOk ? 'rt-cuadre--ok' : 'rt-cuadre--error'}`}>
        <div className="rt-cuadre-lineas">
          {resumen.totalARS > 0 && (
            <span className="rt-cuadre-item">
              ARS: {fmtMonto(cuadre.sumaARS, 'ARS')} calculado · {fmtMonto(resumen.totalARS, 'ARS')} PDF
              {cuadre.balanceARS ? ' ✓' : ` ⚠ dif ${fmtMonto(cuadre.diffARS, 'ARS')}`}
            </span>
          )}
          {resumen.totalUSD > 0 && (
            <span className="rt-cuadre-item">
              USD: {fmtMonto(cuadre.sumaUSD, 'USD')} calculado · {fmtMonto(resumen.totalUSD, 'USD')} PDF
              {cuadre.balanceUSD ? ' ✓' : ` ⚠ dif ${fmtMonto(cuadre.diffUSD, 'USD')}`}
            </span>
          )}
        </div>
        {resumen.ajustesConsolidado.length > 0 && (
          <div className="rt-cuadre-ajustes">
            Ajustes consolidado:{' '}
            {resumen.ajustesConsolidado.map((a, i) => (
              <span key={i} className="rt-cuadre-ajuste-item">
                {a.concepto} {a.montoARS !== 0 ? fmtMonto(a.montoARS, 'ARS') : fmtMonto(a.montoUSD, 'USD')}
              </span>
            ))}
          </div>
        )}
        {!cuadreOk && (
          <div className="rt-cuadre-warn">
            <p>El detalle no cuadra con el total a pagar — revisá las líneas antes de confirmar.</p>
            <button
              className="rt-btn rt-btn--sm"
              onClick={cerrarDiferencia}
              disabled={ajustando || guardando}
            >
              {ajustando ? 'Ajustando…' : 'Cerrar diferencia manualmente'}
            </button>
          </div>
        )}
      </div>

      <div className="rt-table-wrap">
        <table className="rt-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha</th>
              <th>Descripción</th>
              <th>Persona</th>
              <th>Categoría</th>
              <th>Subcategoría</th>
              <th>Monto</th>
              <th>Tipo</th>
              <th>Incl.</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((linea, idx) => {
              const subcatsFiltradas = subcats.filter(s => s.categoriaPadre === linea.categoria);
              return (
                <tr key={linea.seq} className={!linea.incluir ? 'rt-row--excluida' : ''}>
                  <td className="rt-col-seq">{linea.seq}</td>
                  <td className="rt-col-fecha">{linea.fechaConsumo ?? '—'}</td>
                  <td className="rt-col-desc" title={linea.descripcionRaw}>
                    {linea.descripcionRaw || '—'}
                    {linea.cuotaTotal > 1 && (
                      <span className="rt-cuota">Cuota {linea.cuotaActual}/{linea.cuotaTotal}</span>
                    )}
                  </td>
                  <td>
                    <select
                      className="rt-select"
                      value={linea.personaConfirmada ?? ''}
                      onChange={e => actualizar(idx, { personaConfirmada: e.target.value || null })}
                    >
                      <option value="">—</option>
                      {miembros.map(([id, m]) => (
                        <option key={id} value={id}>{m.nombre}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="rt-select"
                      value={linea.categoria ?? ''}
                      onChange={e => actualizar(idx, { categoria: e.target.value || null, subcategoria: null })}
                    >
                      <option value="">—</option>
                      {cats.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      className="rt-select"
                      value={linea.subcategoria ?? ''}
                      onChange={e => actualizar(idx, { subcategoria: e.target.value || null })}
                      disabled={!linea.categoria}
                    >
                      <option value="">—</option>
                      {subcatsFiltradas.map(s => (
                        <option key={s.id} value={s.valor}>{s.valor}</option>
                      ))}
                    </select>
                  </td>
                  <td className="rt-col-monto">{fmtMonto(linea.monto, linea.moneda as 'ARS' | 'USD')}</td>
                  <td>
                    <span className={`rt-tipo rt-tipo--${linea.tipoLinea}`}>
                      {TIPO_LABEL[linea.tipoLinea] ?? linea.tipoLinea}
                    </span>
                  </td>
                  <td className="rt-col-incl">
                    <input
                      type="checkbox"
                      checked={linea.incluir}
                      onChange={e => actualizar(idx, { incluir: e.target.checked })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {errorLocal && <p className="rt-error">{errorLocal}</p>}

      <div className="rt-preview-footer">
        <button className="rt-btn" onClick={onCerrar} disabled={guardando}>
          Cancelar
        </button>
        <button
          className="rt-btn rt-btn--primary"
          onClick={confirmar}
          disabled={guardando || lineas.length === 0 || !cuadreOk}
        >
          {guardando
            ? 'Confirmando…'
            : `Confirmar ${incluidas} línea${incluidas !== 1 ? 's' : ''} + 2 totales`}
        </button>
      </div>
    </div>
  );
}

// ── Tarjeta de resumen en la lista ────────────────────────────────────────────

function ResumenCard({
  resumen, config, onVerPreview,
}: { resumen: CardStatement; config: FamiliaConfig | null; onVerPreview: () => void }) {
  const [tarjetaSel,   setTarjetaSel]   = useState(config?.tarjetas[0]?.codigo ?? '');
  const [asignando,    setAsignando]    = useState(false);
  const [errorAsg,     setErrorAsg]     = useState<string | null>(null);
  const [descartando,  setDescartando]  = useState(false);
  const [errDesc,      setErrDesc]      = useState<string | null>(null);
  const [reintentando, setReintentando] = useState(false);

  async function handleDescartar() {
    const n = resumen.movimientosParseados.filter(m => m.incluir).length;
    const msg = resumen.estado === 'confirmado' && n > 0
      ? `¿Descartar este resumen? Se borran sus ${n} movimientos importados y el archivo.`
      : '¿Descartar este resumen? Se borra el archivo.';
    if (!confirm(msg)) return;
    setDescartando(true);
    setErrDesc(null);
    const res = await descartarEntrada('resumen', resumen.id);
    setDescartando(false);
    if (!res.ok) setErrDesc(res.error.message);
  }

  async function handleReintentar() {
    setReintentando(true);
    setErrDesc(null);
    const res = await reintentarResumen(resumen.id);
    setReintentando(false);
    if (!res.ok) setErrDesc(res.error.message);
  }

  async function handleAsignar() {
    if (!config || !tarjetaSel) return;
    setAsignando(true);
    setErrorAsg(null);
    const res = await asignarTarjetaResumen(resumen.id, tarjetaSel, config);
    setAsignando(false);
    if (!res.ok) setErrorAsg(res.error.message);
  }

  const procesando = resumen.estado === 'subido';

  return (
    <TarjetaFace resumen={resumen} config={config} onDescartar={handleDescartar} descartando={descartando}>
      {errDesc && <p className="rt-error-inline">{errDesc}</p>}
      <div className="rt-card-body">
        {resumen.estado === 'subido' && (
          <span className="rt-procesando">Extrayendo PDF…</span>
        )}
        {resumen.estado === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="rt-error-inline" title={resumen.errorExtraccion ?? undefined}>
              Error ({resumen.tipoError ?? 'infra'})
              {(resumen.intentos ?? 0) >= 3 && ' — 3+ intentos, considerar re-subir el PDF'}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="rt-btn rt-btn--sm rt-btn--primary"
                onClick={handleReintentar}
                disabled={reintentando || procesando}
              >
                {reintentando ? 'Reintentando…' : 'Reintentar'}
              </button>
              <button
                className="rt-btn rt-btn--sm"
                onClick={handleDescartar}
                disabled={descartando}
              >
                Descartar
              </button>
            </div>
          </div>
        )}
        {resumen.estado === 'duplicado' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="rt-error-inline">
              Duplicado de {resumen.duplicadoDe?.slice(0, 8) ?? '?'}…
            </span>
            <button
              className="rt-btn rt-btn--sm"
              onClick={handleDescartar}
              disabled={descartando}
            >
              Descartar
            </button>
          </div>
        )}
        {resumen.estado === 'requiere_tarjeta' && config && (
          <div className="rt-asignar-form">
            <select
              className="rt-select"
              value={tarjetaSel}
              onChange={e => setTarjetaSel(e.target.value)}
              disabled={asignando}
            >
              {config.tarjetas.map(t => (
                <option key={t.codigo} value={t.codigo}>
                  {t.banco} — {t.tipo} ({t.titular})
                </option>
              ))}
            </select>
            <button
              className="rt-btn rt-btn--sm rt-btn--primary"
              onClick={handleAsignar}
              disabled={!tarjetaSel || asignando}
            >
              {asignando ? 'Asignando…' : 'Asignar'}
            </button>
            {errorAsg && <span className="rt-error-inline">{errorAsg}</span>}
          </div>
        )}
        {resumen.estado === 'parseado' && (
          <button className="rt-btn rt-btn--sm" onClick={onVerPreview}>
            Revisar ({resumen.movimientosParseados.length} líneas)
          </button>
        )}
        {resumen.estado === 'confirmado' && resumen.movimientosParseados.length > 0 && (
          <span className="rt-confirmado-info">
            {resumen.movimientosParseados.filter(m => m.incluir).length} importados
          </span>
        )}
      </div>
    </TarjetaFace>
  );
}

// ── Fila colapsable de resumen (F9.56) ───────────────────────────────────────

const MONEDAS_ORD = ['ARS', 'USD'] as const;

// Mismo algoritmo que TarjetaFace, sin exportar para no crear dependencia circular
function tintFila(red: string): string {
  const r = red.toLowerCase();
  if (r.includes('visa')) return '#1a1f71';
  if (r.includes('mastercard')) return '#23252b';
  return 'var(--gf-ink)';
}

// F9.56 — fila compacta (~48px) que se expande al tocar. Muestra:
// swatch tintado · Banco · Red · •••• term · Vence · total este mes · badge · chevron.
// Expandida: CaraTarjeta reducida + split este mes / deuda futura + "Ver N consumos →".
function ResumenFila({ resumen, config, onVerPreview }: {
  resumen: CardStatement;
  config: FamiliaConfig | null;
  onVerPreview: () => void;
}) {
  const [expandido, setExpandido] = useState(false);
  const tarjetaCfg = config?.tarjetas.find(t => t.codigo === resumen.tarjetaCodigo);
  const ultimos4   = tarjetaCfg?.ultimos4?.[0];
  const red        = resumen.tarjeta || tarjetaCfg?.tipo || '';
  const banco      = resumen.banco || tarjetaCfg?.banco || '—';
  const tint       = tintFila(red);
  const split      = calcularSplitCuotas(resumen);
  const venceStr   = resumen.fechaVencimiento
    ? resumen.fechaVencimiento.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
    : null;

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-card)', borderRadius: 12, overflow: 'hidden' }}>
      {/* Fila colapsada */}
      <button
        onClick={() => setExpandido(e => !e)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-base)', minHeight: 50 }}
      >
        <span style={{ width: 36, height: 36, borderRadius: 8, background: `linear-gradient(135deg, ${tint} 0%, var(--gf-ink) 100%)`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.5)', letterSpacing: 1 }}>••••</span>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {banco}{red ? ` · ${red}` : ''}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-sec)' }}>
            •••• {ultimos4 ?? '----'}{venceStr ? ` · Vence ${venceStr}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {MONEDAS_ORD.map(m => split.esteMes[m] ? fmtMontoFace(split.esteMes[m]!, m) : null).find(Boolean) ?? (resumen.periodo || '—')}
          </div>
          <BadgeEstadoResumen estado={resumen.estado} />
        </div>
        <Icon name={expandido ? 'chevron-down' : 'chevron-right'} size={14} color="var(--gf-gray-300)" />
      </button>

      {/* Sección expandida */}
      {expandido && (
        <div style={{ borderTop: '1px solid var(--gf-gray-100)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <CaraTarjeta resumen={resumen} config={config} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, background: 'var(--gf-gray-100)', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>Este mes</div>
              {MONEDAS_ORD.map(m => split.esteMes[m] ? (
                <div key={m} style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtMontoFace(split.esteMes[m]!, m)}</div>
              ) : null)}
              {!split.esteMes.ARS && !split.esteMes.USD && <div style={{ fontSize: 13, color: 'var(--color-text-sec)' }}>{resumen.periodo || '—'}</div>}
            </div>
            <div style={{ flex: 1, background: 'var(--gf-gray-100)', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>Deuda futura</div>
              {MONEDAS_ORD.map(m => split.deudaFutura[m] ? (
                <div key={m} style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtMontoFace(split.deudaFutura[m]!, m)}</div>
              ) : null)}
              {!split.deudaFutura.ARS && !split.deudaFutura.USD && <div style={{ fontSize: 13, color: 'var(--color-text-sec)' }}>—</div>}
            </div>
          </div>
          {split.nConsumos > 0 && (
            <button
              onClick={onVerPreview}
              style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 8, padding: '9px 12px', cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 13, fontWeight: 700, color: 'var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              Ver {split.nConsumos} consumo{split.nConsumos !== 1 ? 's' : ''} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sección de tarjetas (embebible en la vista única de carga) ────────────────

interface SeccionTarjetasProps {
  // F9.51 — el landing de share-target abre el preview del resumen recién
  // parseado sin que el usuario tenga que buscarlo en la lista.
  abrirPreview?: string | null;
  onPreviewAbierto?: () => void;
}

const VISIBLES_DEFAULT = 4;

export function SeccionTarjetas({ abrirPreview, onPreviewAbierto }: SeccionTarjetasProps = {}) {
  const { memberId } = useMiembroCtx();

  const [config,   setConfig]   = useState<FamiliaConfig | null>(null);
  const [subcats,  setSubcats]  = useState<SubcategoriaItem[]>([]);
  const [cargando, setCargando] = useState(true);
  const [resumenes, setResumenes] = useState<CardStatement[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [mostrarTodos, setMostrarTodos] = useState(false);

  useEffect(() => {
    Promise.all([cargarFamiliaConfig(), cargarSubcategorias()])
      .then(([cfg, sc]) => {
        if (cfg) setConfig(cfg);
        setSubcats(sc);
        setCargando(false);
      })
      .catch(() => setCargando(false));
  }, []);

  useEffect(() => suscribirResumenesTarjeta(setResumenes), []);

  useEffect(() => {
    if (!abrirPreview) return;
    setPreviewId(abrirPreview);
    onPreviewAbierto?.();
  // onPreviewAbierto es estable por render del padre; solo nos importa abrirPreview
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirPreview]);

  if (cargando) return <p className="rt-cargando">Cargando…</p>;

  const previewResumen = previewId ? resumenes.find(r => r.id === previewId) : null;

  if (previewResumen?.estado === 'parseado' && config) {
    return (
      <div className="rt rt--wide">
        <PreviewResumen
          resumen={previewResumen}
          config={config}
          subcats={subcats}
          memberId={memberId}
          onConfirmado={() => setPreviewId(null)}
          onCerrar={() => setPreviewId(null)}
        />
      </div>
    );
  }

  // F9.56 — período en curso primero (vencimiento más reciente/próximo arriba)
  const resumenesSorted = [...resumenes].sort((a, b) => {
    if (!a.fechaVencimiento) return 1;
    if (!b.fechaVencimiento) return -1;
    return b.fechaVencimiento.getTime() - a.fechaVencimiento.getTime();
  });
  const visibles = mostrarTodos ? resumenesSorted : resumenesSorted.slice(0, VISIBLES_DEFAULT);
  const hayMas   = resumenesSorted.length > VISIBLES_DEFAULT;

  return (
    <section className="rt-seccion">
      <h2 className="rt-subtitulo">Historial — Resúmenes de tarjeta</h2>
      {resumenes.length === 0 ? (
        <p className="rt-vacio">No hay resúmenes cargados.</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibles.map(r => (
              <ResumenFila key={r.id} resumen={r} config={config} onVerPreview={() => setPreviewId(r.id)} />
            ))}
          </div>
          {hayMas && !mostrarTodos && (
            <button
              onClick={() => setMostrarTodos(true)}
              style={{ width: '100%', marginTop: 8, background: 'none', border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--color-text-sec)', cursor: 'pointer', fontFamily: 'var(--font-base)' }}
            >
              Ver todo ({resumenesSorted.length})
            </button>
          )}
        </>
      )}
    </section>
  );
}

// ── Vista standalone (no se usa en routing normal — /tarjetas redirige a /comprobantes) ──

export default function ResumenesTarjeta() {
  return (
    <div className="rt">
      <h1 className="rt-titulo">Resúmenes de tarjeta</h1>
      <SeccionTarjetas />
    </div>
  );
}
