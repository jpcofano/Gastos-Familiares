import { useState, useEffect, useRef, useCallback } from 'react';
import { descartarEntrada } from '../datos/entrantes';
import { useMiembroCtx } from '../contexto/MiembroContext';
import { useDiccionario } from '../contexto/DiccionarioContext';
import {
  asignarTarjetaResumen,
  suscribirResumenesTarjeta,
  confirmarResumenTarjeta,
  resumenYaGeneroMovimientos,
  agregarAjusteCuadreManual,
  MOTIVO_AJUSTE_MIN,
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

// F9.157 §2 — los seis valores de `tipoLinea`, para el selector. El orden es el del tipo en
// src/types/index.ts: primero los que son gasto, después los tres que `tipoDeLinea` mapea a Ingreso.
const TIPOS_LINEA: MovimientoParseado['tipoLinea'][] = [
  'consumo', 'cuota', 'impuesto', 'reintegro_percepcion', 'bonificacion', 'reverso',
];

// F9.157 §2 — el `esImpuesto` que fuerza la categoría. Sale de `tipoLinea`, así que al editarlo a
// mano hay que volver a preguntarlo: si no, una línea que deja de ser impuesto se queda con
// "Impuestos y finanzas" pegada de la clasificación inicial.
const lineaEsImpuesto = (t: MovimientoParseado['tipoLinea']) =>
  t === 'impuesto' || t === 'reintegro_percepcion';

/**
 * F9.166 — qué estados pueden abrir el preview. Los seis, decididos uno por uno en vez de dejar
 * que caigan al `else` por descarte:
 *   subido            NO — todavía se está extrayendo, no hay líneas que mostrar.
 *   parseado          SÍ — el caso de siempre: revisar y confirmar.
 *   confirmado        SÍ — para mirar lo importado y, si hace falta, re-confirmar (F9.158 §1).
 *   error             NO — la extracción falló, no hay líneas.
 *   requiere_tarjeta  NO — sin `tarjetaCodigo`, `confirmarResumenTarjeta` no puede correr; la
 *                          card ofrece el asignador inline, que es el camino correcto.
 *   duplicado         NO — es copia de otro resumen; confirmarlo duplicaría movimientos.
 *
 * El bug que cerró F9.166: el gate del preview aceptaba solo `parseado` pero el botón
 * "Ver N consumos" se ofrecía para cualquier estado con consumos, así que en `confirmado` el
 * botón no hacía nada y el "Re-confirmar" de F9.158 era inalcanzable. Ahora el botón y el gate
 * preguntan lo MISMO, que es la única forma de que no se vuelvan a separar.
 */
export function puedeVerPreview(estado: CardStatement['estado']): boolean {
  return estado === 'parseado' || estado === 'confirmado';
}

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

  // F9.157 §2 — extraída del useEffect de inicialización para poder reusarla cuando el usuario
  // edita `tipoLinea`: la categoría es un DERIVADO de tipoLinea y antes solo se calculaba una vez.
  const categoriaSugerida = useCallback((
    tipoLinea: MovimientoParseado['tipoLinea'],
    descripcionRaw: string | null | undefined,
  ): { categoria: string | null; subcategoria: string | null } => {
    if (lineaEsImpuesto(tipoLinea)) return { categoria: 'Impuestos y finanzas', subcategoria: null };
    const cls = descripcionRaw
      ? clasificar(descripcionRaw, { banco: resumen.banco || null, tarjeta: resumen.tarjetaCodigo || null })
      : null;
    return cls && cls.confianza >= CONFIANZA_UMBRAL
      ? { categoria: cls.categoria, subcategoria: cls.subcategoria ?? null }
      : { categoria: null, subcategoria: null };
  }, [clasificar, resumen.banco, resumen.tarjetaCodigo]);

  useEffect(() => {
    if (inicializadoRef.current) return;
    inicializadoRef.current = true;
    const iniciales = resumen.movimientosParseados.map(linea => {
      const personaId = linea.personaDetectada
        ? resolverNombreMiembro(linea.personaDetectada, config)
        : null;
      const { categoria, subcategoria } = categoriaSugerida(linea.tipoLinea, linea.descripcionRaw);
      return { ...linea, personaConfirmada: personaId, categoria, subcategoria };
    });
    setLineas(iniciales);
  // resumen.id es estable para la vida de este preview
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumen.id]);

  const actualizar = useCallback((idx: number, cambios: Partial<MovimientoParseado>) => {
    setLineas(prev => prev.map((l, i) => i === idx ? { ...l, ...cambios } : l));
  }, []);

  // F9.161 §4 — el motivo pasa a ser obligatorio.
  //
  // Auditado: los 10 ajustes que había en producción decían todos "Diferencia no identificada", así
  // que cada uso enterraba un bug distinto sin dejar rastro. Cuatro de los treinta resúmenes tenían
  // un descuadre real tapado acá (de 33.035,55 a 2.878.033,12) y ninguno se podía diagnosticar
  // después: el `window.confirm` que ya existía advertía y no frenaba nada.
  //
  // De las tres opciones —advertencia, motivo obligatorio, sacarlo de la vista— va la del medio.
  // Sacarlo dejaría resúmenes imposibles de confirmar (el escape hace falta de verdad); una
  // advertencia más es lo que ya falló cuatro veces. Escribir el motivo cuesta más que mirar qué
  // sección no cierra, que es exactamente el incentivo que faltaba.
  async function cerrarDiferencia() {
    const umbralARS = Math.min(5000, resumen.totalARS * 0.02);
    const esGrande  = cuadre.diffARS > umbralARS || cuadre.diffUSD > 2;
    const motivo = window.prompt(
      `Diferencia de ${cuadre.diffARS > 0 ? fmtMonto(cuadre.diffARS, 'ARS') : ''}` +
      `${cuadre.diffUSD > 0 ? ` U$S ${cuadre.diffUSD.toFixed(2)}` : ''}.\n\n` +
      (esGrande
        ? 'Es GRANDE: casi seguro es una línea real no leída, no un redondeo.\n\n'
        : '') +
      '¿Qué estás tapando? Escribilo para poder diagnosticarlo después ' +
      `(mínimo ${MOTIVO_AJUSTE_MIN} caracteres).`,
      '',
    );
    if (motivo === null) return;                       // cancelar no escribe nada
    setAjustando(true);
    setErrorLocal(null);
    const res = await agregarAjusteCuadreManual(resumen, lineas, memberId, motivo);
    setAjustando(false);
    if (!res.ok) setErrorLocal(res.error.message);
  }

  // F9.158 §1 — cuántos movimientos reemplazaría esta confirmación. Se lee al abrir el preview para
  // que el botón diga la verdad ANTES de tocarlo, en vez de descubrirlo con un error.
  const [yaGenero, setYaGenero] = useState<{ total: number; editados: number } | null>(null);
  useEffect(() => {
    let cancelado = false;
    resumenYaGeneroMovimientos(resumen).then(r => { if (!cancelado) setYaGenero(r); });
    return () => { cancelado = true; };
  }, [resumen]);

  async function confirmar() {
    // F9.158 §1 — re-confirmar reemplaza; el usuario tiene que verlo con el número delante. Sin
    // esto, confirmar dos veces duplicaba todo en silencio (F9.156 §4: 8 movimientos duplicados).
    const reemplazar = (yaGenero?.total ?? 0) > 0;
    if (reemplazar) {
      const perdidos = yaGenero!.editados > 0
        ? `

ATENCIÓN: ${yaGenero!.editados} de esos movimientos fueron editados a mano después de importados (categoría, persona, etiqueta). Esas ediciones se pierden.`
        : '';
      const ok = confirm(
        `Este resumen ya generó ${yaGenero!.total} movimientos. Re-confirmar los BORRA y los vuelve a crear ` +
        `con las líneas de ahora.${perdidos}

¿Continuar?`,
      );
      if (!ok) return;
    }
    setGuardando(true);
    setErrorLocal(null);
    const res = await confirmarResumenTarjeta(resumen, lineas, memberId, config, { reemplazar });
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
  const cuadre: CuadreResult = calcularCuadre(
    lineas, resumen.totalARS, resumen.totalUSD, resumen.ajustesConsolidado, resumen);
  const cuadreOk = cuadre.balanceARS && cuadre.balanceUSD;

  // F9.166 §1.a — un preview de resumen YA CONFIRMADO no puede parecer una carga pendiente.
  // Quien lo abre para mirar no tiene que re-confirmar por inercia creyendo que está completando
  // algo: re-confirmar BORRA los movimientos existentes y los vuelve a crear.
  const yaConfirmado = resumen.estado === 'confirmado';

  return (
    <div className={`rt-preview${yaConfirmado ? ' rt-preview--confirmado' : ''}`}>
      {yaConfirmado && (
        <div className="rt-preview-yaconf">
          <Icon name="check-check" size={15} />
          <span>
            <strong>Este resumen ya está confirmado</strong>
            {resumen.confirmadoEn && ` desde el ${resumen.confirmadoEn.toLocaleDateString('es-AR')}`}
            {yaGenero && yaGenero.total > 0 && ` — generó ${yaGenero.total} movimiento${yaGenero.total !== 1 ? 's' : ''}`}
            . Estás mirándolo, no cargándolo.
          </span>
        </div>
      )}
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
              ARS: {fmtMonto(cuadre.sumaARS, 'ARS')} calculado · {fmtMonto(cuadre.objetivoARS, 'ARS')}{' '}
              {cuadre.noDebitadoARS !== 0 ? 'neto' : 'PDF'}
              {cuadre.balanceARS ? ' ✓' : ` ⚠ dif ${fmtMonto(cuadre.diffARS, 'ARS')}`}
            </span>
          )}
          {resumen.totalUSD > 0 && (
            <span className="rt-cuadre-item">
              USD: {fmtMonto(cuadre.sumaUSD, 'USD')} calculado · {fmtMonto(cuadre.objetivoUSD, 'USD')}{' '}
              {cuadre.noDebitadoUSD !== 0 ? 'neto' : 'PDF'}
              {cuadre.balanceUSD ? ' ✓' : ` ⚠ dif ${fmtMonto(cuadre.diffUSD, 'USD')}`}
            </span>
          )}
        </div>
        {(cuadre.noDebitadoARS !== 0 || cuadre.noDebitadoUSD !== 0) && (
          /* F9.161 §4 — con el objetivo movido hay que mostrar las TRES cifras. Un cuadre en verde
             porque alguien bajó el objetivo no puede verse igual que uno en verde porque las
             cuentas dan: es la lección de "cerrar diferencia". */
          <div className="rt-cuadre-neto">
            <strong>Se cuadra contra el neto, no contra el total del PDF.</strong>
            {cuadre.noDebitadoARS !== 0 && (
              <span className="rt-cuadre-item">
                ARS: {fmtMonto(resumen.totalARS, 'ARS')} PDF − {fmtMonto(cuadre.noDebitadoARS, 'ARS')} no
                debitado = {fmtMonto(cuadre.objetivoARS, 'ARS')} neto
              </span>
            )}
            {cuadre.noDebitadoUSD !== 0 && (
              <span className="rt-cuadre-item">
                USD: {fmtMonto(resumen.totalUSD, 'USD')} PDF − {fmtMonto(cuadre.noDebitadoUSD, 'USD')} no
                debitado = {fmtMonto(cuadre.objetivoUSD, 'USD')} neto
              </span>
            )}
            <span className="rt-cuadre-item">El movimiento de pago de la tarjeta sale por el neto.</span>
          </div>
        )}
        {cuadre.decisionAjustes.decision === 'ignora' && (
          /* F9.163 §2 — el ajuste del consolidado quedó FUERA del cuadre porque el banco lo usó
             para terminar de saldar el mes anterior. Se dice en pantalla con la aritmética a la
             vista: una decisión automática que no se ve es la misma clase de problema que
             "cerrar diferencia". */
          <div className="rt-cuadre-neto">
            <strong>El ajuste del consolidado no entra: es del período anterior.</strong>
            <span className="rt-cuadre-item">
              saldo anterior {fmtMonto(resumen.saldoAnteriorARS ?? 0, 'ARS')} + pagos{' '}
              {fmtMonto(resumen.pagosDelPeriodoARS ?? 0, 'ARS')} ={' '}
              {fmtMonto(cuadre.decisionAjustes.a, 'ARS')} — el crédito completó ese pago.
            </span>
          </div>
        )}
        {cuadre.decisionAjustes.decision === 'sin_decidir' && resumen.ajustesConsolidado.some(a => a.origen !== 'manual') && (
          /* Abstención: se computa como siempre y se avisa. No adivinamos. */
          <div className="rt-cuadre-neto">
            <strong>Ajuste del consolidado sin verificar.</strong>
            <span className="rt-cuadre-item">{cuadre.decisionAjustes.motivo}. Entra al cuadre como siempre.</span>
          </div>
        )}
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
              {ajustando ? 'Ajustando…' : 'Cerrar diferencia (pide motivo)'}
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
              <th title="El banco no cobra esta línea: baja el total a pagar">No deb.</th>
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
                    {/* F9.157 §2 — antes era un <span> de solo lectura y la única forma de arreglar
                        una línea mal clasificada era destildar `incluir`, que borraba el consumo
                        entero. `tipoLinea` decide el SIGNO (tipoDeLinea → Gasto/Ingreso) y el signo
                        del cuadre, así que una línea mal clasificada resta en vez de sumar.
                        Medido: 4 de 6 apariciones del seguro del auto salieron como ingreso, y la
                        misma descripción sale bien en otros resúmenes — es errático, no del prompt. */}
                    <select
                      className={`rt-tipo rt-tipo--${linea.tipoLinea}`}
                      value={linea.tipoLinea}
                      onChange={e => {
                        const tipoLinea = e.target.value as MovimientoParseado['tipoLinea'];
                        // La categoría es un derivado de `tipoLinea`: se recalcula SOLO cuando el
                        // cambio cruza la frontera impuesto↔no-impuesto, que es cuando queda
                        // inconsistente. Si no cruza, se respeta lo que el usuario haya elegido.
                        const cruza = lineaEsImpuesto(linea.tipoLinea) !== lineaEsImpuesto(tipoLinea);
                        actualizar(idx, cruza
                          ? { tipoLinea, ...categoriaSugerida(tipoLinea, linea.descripcionRaw) }
                          : { tipoLinea });
                      }}
                    >
                      {TIPOS_LINEA.map(t => (
                        <option key={t} value={t}>{TIPO_LABEL[t] ?? t}</option>
                      ))}
                    </select>
                  </td>
                  <td className="rt-col-incl">
                    <input
                      type="checkbox"
                      checked={linea.incluir}
                      onChange={e => actualizar(idx, { incluir: e.target.checked })}
                    />
                  </td>
                  <td className="rt-col-incl">
                    {/* F9.161 §4 — INDEPENDIENTE de "Incl.". Destildar "Incl." solo evita crear el
                        movimiento; marcar acá dice que el banco NO cobra la línea, así que baja el
                        objetivo del cuadre Y el monto del movimiento-total. Conflacionarlos bajaría
                        el objetivo por plata que el banco sí cobra (F9.160 §3.5: de las 5 líneas
                        con `incluir:false`, solo 2 eran "no se debita"). */}
                    <input
                      type="checkbox"
                      checked={linea.noDebitado === true}
                      title="El banco no cobra esta línea (ej: percepción del régimen pagada con dólares propios)"
                      onChange={e => actualizar(idx, { noDebitado: e.target.checked })}
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
            : (yaGenero?.total ?? 0) > 0
            /* F9.158 §1 — el botón dice lo que va a pasar: reemplazar, no agregar. */
            ? `Re-confirmar (reemplaza ${yaGenero!.total} movimiento${yaGenero!.total !== 1 ? 's' : ''})`
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
          {split.nConsumos > 0 && puedeVerPreview(resumen.estado) && (
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

  if (previewResumen && puedeVerPreview(previewResumen.estado) && config) {
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
