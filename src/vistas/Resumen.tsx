import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { movimientosDelMes, confirmarPagoEsperado, desmarcarPago } from '../datos/movimientos';
import { itemsEsperadosActivos } from '../datos/itemsEsperados';
import { useMiembroCtx } from '../contexto/MiembroContext';
import type { Movement, ExpectedItem } from '../types';
import './Resumen.css';

// ── Mes helpers ───────────────────────────────────────────────────────────────

function mesActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function desplazarMes(mes: string, delta: number): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function formatMes(mes: string): string {
  const [y, m] = mes.split('-');
  return `${MESES[parseInt(m) - 1]} ${y}`;
}

function formatFecha(d: Date): string {
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

// ── Totales ───────────────────────────────────────────────────────────────────

interface Totales { ingresos: number; gastos: number; balance: number; }

function calcEquivARS(movs: Movement[]): Totales {
  let ingresos = 0, gastos = 0;
  for (const m of movs) {
    const monto = m.moneda === 'ARS' ? m.monto
      : m.tcUsdArs ? m.monto * m.tcUsdArs
      : (console.warn('[Resumen] tcUsdArs null en', m.id), 0);
    if (m.tipo === 'Ingreso') ingresos += monto;
    else gastos += monto;
  }
  return { ingresos, gastos, balance: ingresos - gastos };
}

function calcEquivUSD(movs: Movement[]): Totales {
  let ingresos = 0, gastos = 0;
  for (const m of movs) {
    const monto = m.moneda === 'USD' ? m.monto
      : m.tcUsdArs ? m.monto / m.tcUsdArs
      : (console.warn('[Resumen] tcUsdArs null en', m.id), 0);
    if (m.tipo === 'Ingreso') ingresos += monto;
    else gastos += monto;
  }
  return { ingresos, gastos, balance: ingresos - gastos };
}

function calcTotalesMoneda(movs: Movement[], moneda: 'ARS' | 'USD'): Totales {
  const del = movs.filter(m => m.moneda === moneda);
  const ingresos = del.filter(m => m.tipo === 'Ingreso').reduce((s, m) => s + m.monto, 0);
  const gastos   = del.filter(m => m.tipo === 'Gasto').reduce((s, m) => s + m.monto, 0);
  return { ingresos, gastos, balance: ingresos - gastos };
}

function fmtARS(n: number): string {
  return `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtUSD(n: number): string {
  return `U$S ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtMonto(n: number, moneda: 'ARS' | 'USD'): string {
  return moneda === 'ARS' ? fmtARS(n) : fmtUSD(n);
}
function claseBalance(n: number) { return n >= 0 ? 'res-ingreso' : 'res-gasto'; }

// ── Checklist — match de movimientos ─────────────────────────────────────────

function movimientosDelItem(item: ExpectedItem, movs: Movement[]): Movement[] {
  // Rama 0: vínculo directo por itemEsperadoId (manda sobre todo)
  const directos = movs.filter(m => m.itemEsperadoId === item.id);
  if (directos.length > 0) return directos;

  // Rama 1: tarjeta por código — identidad fuerte, no categoria/subcategoria
  if (item.tarjetaCodigo) {
    return movs.filter(m =>
      m.subtipo === 'TarjetaPago' &&
      m.tarjetaCodigo === item.tarjetaCodigo &&
      m.moneda === item.moneda,
    );
  }

  // Rama 2: matchTexto manda (relaja cat/subcat) — o, sin matchTexto, clave cat+subcat
  return movs.filter(m => {
    if (m.tipo !== item.tipo) return false;
    if (m.moneda !== item.moneda) return false;
    if (item.matchTexto) {
      const desc = (m.descripcion ?? '').toLowerCase();
      const inc = item.matchTexto.incluye.some(t => desc.includes(t));
      const exc = item.matchTexto.excluye.some(t => desc.includes(t));
      return inc && !exc;
    }
    if (item.categoria    !== null && m.categoria    !== item.categoria)    return false;
    if (item.subcategoria !== null && m.subcategoria !== item.subcategoria) return false;
    if (item.tipo === 'Ingreso' && item.persona !== null && m.persona !== item.persona) return false;
    return true;
  });
}

// ── State machine ─────────────────────────────────────────────────────────────

type EstadoItem =
  | 'pagado' | 'por_confirmar' | 'parcial' | 'automatico'
  | 'pendiente' | 'vencido'
  | 'programado'
  | 'no_registrado'
  | 'no_aplica';

function aplicaEnMes(item: ExpectedItem, _mes: string): boolean {
  switch (item.periodicidad) {
    case 'mensual': return true;
    // TODO: requiere mes-ancla para periodicidades no mensuales
    case 'bimestral':
    case 'trimestral':
    case 'anual':
    case 'unico':
      return true;
    default: return true;
  }
}

function estadoItem(
  item: ExpectedItem,
  matches: Movement[],
  mesActualStr: string,
  mes: string,
): EstadoItem {
  if (!aplicaEnMes(item, mes)) return 'no_aplica';
  if (matches.length > 0) {
    if (mes < mesActualStr) return 'pagado';  // meses cerrados: match = pagado (sin confirmar)
    const confirmados = matches.filter(m => m.confirmadoPago);
    if (confirmados.length > 0) {
      const montoConf = confirmados.reduce((s, m) => s + Math.abs(m.monto), 0);
      if (item.montoEsperado != null && montoConf < item.montoEsperado * 0.99) return 'parcial';
      return 'pagado';
    }
    return 'por_confirmar';  // hay match pero falta confirmación
  }
  if (item.pagoAutomatico) return 'automatico';
  if (mes > mesActualStr) return 'programado';
  if (mes < mesActualStr) return 'no_registrado';
  if (item.diaVencimiento && item.diaVencimiento < new Date().getDate()) return 'vencido';
  return 'pendiente';
}

function cubierto(estado: EstadoItem): boolean {
  return estado === 'pagado' || estado === 'automatico';
}

const ORDEN_ESTADO: Record<EstadoItem, number> = {
  vencido: 0, pendiente: 1, por_confirmar: 2, parcial: 3,
  no_registrado: 4, programado: 5, automatico: 6,
  pagado: 7, no_aplica: 8,
};

const BADGE_LABEL: Record<EstadoItem, string> = {
  pagado:        'pagado',
  por_confirmar: 'por confirmar',
  parcial:       'parcial',
  automatico:    'automático',
  pendiente:     'pendiente',
  vencido:       'vencido',
  programado:    'programado',
  no_registrado: 'no registrado',
  no_aplica:     'no aplica',
};

// ── Subcomponentes ────────────────────────────────────────────────────────────

function TarjBadge() {
  return <span className="res-badge-tarjeta">pago tarjeta</span>;
}

function EstadoBadge({ estado }: { estado: EstadoItem }) {
  return (
    <span className={`res-badge-estado res-badge-estado--${estado}`}>
      {BADGE_LABEL[estado]}
    </span>
  );
}

interface CheckItemRowProps {
  item: ExpectedItem;
  matches: Movement[];
  estado: EstadoItem;
  esMesActual: boolean;
  onConfirmar: () => void;
  onDesmarcar: () => void;
}

function CheckItemRow({ item, matches, estado, esMesActual, onConfirmar, onDesmarcar }: CheckItemRowProps) {
  const montoReal     = matches.reduce((s, m) => s + m.monto, 0);
  const etiqueta      = [item.categoria, item.subcategoria].filter(Boolean).join(' › ');
  const tieneMatch    = estado === 'pagado' || estado === 'parcial' || estado === 'por_confirmar';
  const puedeConfirmar = estado === 'por_confirmar';
  const puedeDeshacer  = estado === 'pagado' && esMesActual;

  return (
    <div className={`res-check-item res-check-item--${estado}`}>
      <div className="res-check-main">
        <EstadoBadge estado={estado} />
        <span className="res-check-label">{etiqueta || '(sin categoría)'}</span>
        {item.persona && <span className="res-check-persona">{item.persona}</span>}
        <span className="res-check-moneda">{item.moneda}</span>
      </div>
      <div className="res-check-montos">
        {tieneMatch && (
          <span className={item.tipo === 'Ingreso' ? 'res-ingreso' : 'res-gasto'}>
            {fmtMonto(montoReal, item.moneda)}
            {matches.length > 1 && <span className="res-check-multi"> ({matches.length} movs.)</span>}
          </span>
        )}
        {item.montoEsperado !== null && tieneMatch && (
          <span className="res-check-esperado">esp. {fmtMonto(item.montoEsperado, item.moneda)}</span>
        )}
        {item.montoEsperado !== null && !tieneMatch && estado !== 'automatico' && (
          <span className="res-check-esperado">{fmtMonto(item.montoEsperado, item.moneda)}</span>
        )}
        {(estado === 'pendiente' || estado === 'vencido') && item.diaVencimiento && (
          <span className="res-check-vence">vence día {item.diaVencimiento}</span>
        )}
        {puedeConfirmar && (
          <button className="res-btn-registrar" onClick={onConfirmar} type="button">
            Confirmar pago
          </button>
        )}
        {puedeDeshacer && (
          <button className="res-btn-deshacer" onClick={onDesmarcar} type="button">
            deshacer
          </button>
        )}
      </div>
    </div>
  );
}

// ── Vista principal ───────────────────────────────────────────────────────────
// Separar guard de hooks para no violar reglas de React (P2 fix)

export default function Resumen() {
  const { miembro } = useMiembroCtx();
  if (miembro.rol !== 'admin') return <Navigate to="/" replace />;
  return <ResumenAdmin />;
}

function ResumenAdmin() {
  const [mes, setMes]               = useState(mesActual);
  const [refetch, setRefetch]       = useState(0);
  const [cargando, setCargando]     = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [movimientos, setMovimientos] = useState<Movement[]>([]);
  const [items, setItems]           = useState<ExpectedItem[]>([]);

  useEffect(() => {
    itemsEsperadosActivos().then(res => {
      if (res.ok) setItems(res.data);
      else setError(res.error.message);
    });
  }, []);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError(null);
    movimientosDelMes(mes).then(res => {
      if (cancelado) return;
      if (res.ok) setMovimientos(res.data);
      else setError(res.error.message);
      setCargando(false);
    });
    return () => { cancelado = true; };
  }, [mes, refetch]);

  // ── Caja del mes (incluirResumenMes=true)
  const cajaMov = movimientos
    .filter(m => m.incluirResumenMes)
    .sort((a, b) => b.fecha.getTime() - a.fecha.getTime());

  const cajaIngresos = cajaMov.filter(m => m.tipo === 'Ingreso');
  const cajaGastos   = cajaMov.filter(m => m.tipo === 'Gasto');

  const eqARS  = calcEquivARS(cajaMov);
  const eqUSD  = calcEquivUSD(cajaMov);
  const arsT   = calcTotalesMoneda(cajaMov, 'ARS');
  const usdT   = calcTotalesMoneda(cajaMov, 'USD');
  const hayUSD = cajaMov.some(m => m.moneda === 'USD');

  // ── Checklist
  const mesHoy        = mesActual();
  const gastosItems   = items.filter(i => i.tipo === 'Gasto');
  const ingresosItems = items.filter(i => i.tipo === 'Ingreso');

  function checkData(item: ExpectedItem) {
    const matches = movimientosDelItem(item, movimientos);
    const estado  = estadoItem(item, matches, mesHoy, mes);
    return { item, matches, estado };
  }

  const gastosCheck = gastosItems.map(checkData).sort((a, b) =>
    ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado],
  );
  const ingresosCheck = ingresosItems.map(checkData).sort((a, b) =>
    ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado],
  );

  const gastosReg   = gastosCheck.filter(c => cubierto(c.estado)).length;
  const ingresosReg = ingresosCheck.filter(c => cubierto(c.estado)).length;

  async function handleConfirmar(item: ExpectedItem, matches: Movement[]) {
    const res = await confirmarPagoEsperado(item, matches);
    if (res.ok) setRefetch(n => n + 1);
    else setError(res.error.message);
  }

  async function handleDesmarcar(matches: Movement[]) {
    const res = await desmarcarPago(matches);
    if (res.ok) setRefetch(n => n + 1);
    else setError(res.error.message);
  }

  return (
    <div className="res">
      {/* Selector de mes */}
      <div className="res-mes-selector">
        <button className="res-mes-btn" onClick={() => setMes(m => desplazarMes(m, -1))} aria-label="Mes anterior">‹</button>
        <span className="res-mes-label">{formatMes(mes)}</span>
        <button className="res-mes-btn" onClick={() => setMes(m => desplazarMes(m, +1))} aria-label="Mes siguiente">›</button>
      </div>

      {cargando && <p className="res-estado">Cargando…</p>}
      {error    && <p className="res-estado res-error">Error: {error}</p>}

      {!cargando && !error && (
        <>
          {/* ── Caja del mes ─────────────────────────────── */}
          <section className="res-seccion">
            <h2 className="res-seccion-titulo">Caja — {formatMes(mes)}</h2>

            <div className="res-totales">
              <div className="res-totales-card res-totales-eq">
                <span className="res-totales-titulo">Equivalente</span>
                <div className="res-totales-fila">
                  <span>Ingresos</span>
                  <span className="res-ingreso">{fmtARS(eqARS.ingresos)}<span className="res-eq-sec">{fmtUSD(eqUSD.ingresos)}</span></span>
                </div>
                <div className="res-totales-fila">
                  <span>Gastos</span>
                  <span className="res-gasto">{fmtARS(eqARS.gastos)}<span className="res-eq-sec">{fmtUSD(eqUSD.gastos)}</span></span>
                </div>
                <div className="res-totales-fila res-totales-balance">
                  <span>Balance</span>
                  <span className={claseBalance(eqARS.balance)}>{fmtARS(eqARS.balance)}<span className="res-eq-sec">{fmtUSD(eqUSD.balance)}</span></span>
                </div>
              </div>

              <div className="res-totales-card">
                <span className="res-totales-titulo">ARS</span>
                <div className="res-totales-fila"><span>Ingresos</span><span className="res-ingreso">{fmtARS(arsT.ingresos)}</span></div>
                <div className="res-totales-fila"><span>Gastos</span><span className="res-gasto">{fmtARS(arsT.gastos)}</span></div>
                <div className="res-totales-fila res-totales-balance"><span>Balance</span><span className={claseBalance(arsT.balance)}>{fmtARS(arsT.balance)}</span></div>
              </div>

              {hayUSD && (
                <div className="res-totales-card">
                  <span className="res-totales-titulo">USD</span>
                  <div className="res-totales-fila"><span>Ingresos</span><span className="res-ingreso">{fmtUSD(usdT.ingresos)}</span></div>
                  <div className="res-totales-fila"><span>Gastos</span><span className="res-gasto">{fmtUSD(usdT.gastos)}</span></div>
                  <div className="res-totales-fila res-totales-balance"><span>Balance</span><span className={claseBalance(usdT.balance)}>{fmtUSD(usdT.balance)}</span></div>
                </div>
              )}
            </div>

            {cajaMov.length === 0 ? (
              <p className="res-estado">Sin movimientos de caja para {formatMes(mes)}.</p>
            ) : (
              <>
                {cajaIngresos.length > 0 && (
                  <div className="res-grupo">
                    <h3 className="res-grupo-titulo">Ingresos ({cajaIngresos.length})</h3>
                    <table className="res-tabla">
                      <tbody>
                        {cajaIngresos.map(m => (
                          <tr key={m.id}>
                            <td className="res-col-fecha">{formatFecha(m.fecha)}</td>
                            <td>{m.descripcion}</td>
                            <td className="res-col-monto res-ingreso">+{fmtMonto(m.monto, m.moneda)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {cajaGastos.length > 0 && (
                  <div className="res-grupo">
                    <h3 className="res-grupo-titulo">Gastos ({cajaGastos.length})</h3>
                    <table className="res-tabla">
                      <tbody>
                        {cajaGastos.map(m => (
                          <tr key={m.id}>
                            <td className="res-col-fecha">{formatFecha(m.fecha)}</td>
                            <td>
                              {m.descripcion}
                              {m.subtipo === 'TarjetaPago' && <TarjBadge />}
                            </td>
                            <td className="res-col-monto res-gasto">-{fmtMonto(m.monto, m.moneda)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>

          {/* ── Checklist de esperados ────────────────────── */}
          <section className="res-seccion">
            <h2 className="res-seccion-titulo">Checklist de esperados</h2>

            <div className="res-checklist-bloques">
              <div className="res-checklist-bloque">
                <h3 className="res-checklist-titulo">
                  Gastos esperados
                  <span className="res-checklist-contador">{gastosReg} de {gastosItems.length} cubiertos</span>
                </h3>
                {gastosCheck.length === 0
                  ? <p className="res-estado">Sin gastos esperados activos.</p>
                  : gastosCheck.map(({ item, matches, estado }) => (
                      <CheckItemRow
                        key={item.id}
                        item={item}
                        matches={matches}
                        estado={estado}
                        esMesActual={mes === mesHoy}
                        onConfirmar={() => handleConfirmar(item, matches)}
                        onDesmarcar={() => handleDesmarcar(matches)}
                      />
                    ))
                }
              </div>

              <div className="res-checklist-bloque">
                <h3 className="res-checklist-titulo">
                  Ingresos esperados
                  <span className="res-checklist-contador">{ingresosReg} de {ingresosItems.length} cubiertos</span>
                </h3>
                {ingresosCheck.length === 0
                  ? <p className="res-estado">Sin ingresos esperados activos.</p>
                  : ingresosCheck.map(({ item, matches, estado }) => (
                      <CheckItemRow
                        key={item.id}
                        item={item}
                        matches={matches}
                        estado={estado}
                        esMesActual={mes === mesHoy}
                        onConfirmar={() => handleConfirmar(item, matches)}
                        onDesmarcar={() => handleDesmarcar(matches)}
                      />
                    ))
                }
              </div>
            </div>
          </section>
        </>
      )}

    </div>
  );
}
