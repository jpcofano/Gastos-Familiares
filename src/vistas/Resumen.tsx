import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { movimientosDelMes } from '../datos/movimientos';
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

// ── Checklist ─────────────────────────────────────────────────────────────────

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

type EstadoItem = 'registrado' | 'pendiente' | 'vencido';

function estadoItem(item: ExpectedItem, matches: Movement[], mesActualStr: string, mes: string): EstadoItem {
  if (matches.length > 0) return 'registrado';
  if (mes === mesActualStr && item.diaVencimiento && item.diaVencimiento < new Date().getDate()) return 'vencido';
  return 'pendiente';
}

// ── Subcomponentes ────────────────────────────────────────────────────────────

function TarjBadge() {
  return <span className="res-badge-tarjeta">pago tarjeta</span>;
}

function EstadoBadge({ estado }: { estado: EstadoItem }) {
  return <span className={`res-badge-estado res-badge-estado--${estado}`}>{estado}</span>;
}

interface CheckItemRowProps {
  item: ExpectedItem;
  matches: Movement[];
  estado: EstadoItem;
}

function CheckItemRow({ item, matches, estado }: CheckItemRowProps) {
  const montoReal = matches.reduce((s, m) => s + m.monto, 0);
  const etiqueta = [item.categoria, item.subcategoria].filter(Boolean).join(' › ');

  return (
    <div className={`res-check-item res-check-item--${estado}`}>
      <div className="res-check-main">
        <EstadoBadge estado={estado} />
        <span className="res-check-label">{etiqueta || '(sin categoría)'}</span>
        {item.persona && <span className="res-check-persona">{item.persona}</span>}
        <span className="res-check-moneda">{item.moneda}</span>
      </div>
      <div className="res-check-montos">
        {estado === 'registrado' && (
          <span className={item.tipo === 'Ingreso' ? 'res-ingreso' : 'res-gasto'}>
            {fmtMonto(montoReal, item.moneda)}
            {matches.length > 1 && <span className="res-check-multi"> ({matches.length} movs.)</span>}
          </span>
        )}
        {item.montoEsperado !== null && estado === 'registrado' && (
          <span className="res-check-esperado">esp. {fmtMonto(item.montoEsperado, item.moneda)}</span>
        )}
        {item.montoEsperado !== null && estado !== 'registrado' && (
          <span className="res-check-esperado">{fmtMonto(item.montoEsperado, item.moneda)}</span>
        )}
        {estado !== 'registrado' && item.diaVencimiento && (
          <span className="res-check-vence">vence día {item.diaVencimiento}</span>
        )}
      </div>
    </div>
  );
}

// ── Vista principal ───────────────────────────────────────────────────────────

export default function Resumen() {
  const { miembro } = useMiembroCtx();
  if (miembro.rol !== 'admin') return <Navigate to="/" replace />;

  const [mes, setMes]               = useState(mesActual);
  const [cargando, setCargando]     = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [movimientos, setMovimientos] = useState<Movement[]>([]);
  const [items, setItems]           = useState<ExpectedItem[]>([]);

  // Items: fetch una vez (no dependen del mes)
  useEffect(() => {
    itemsEsperadosActivos().then(res => {
      if (res.ok) setItems(res.data);
      else setError(res.error.message);
    });
  }, []);

  // Movimientos: fetch por mes
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
  }, [mes]);

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
  const mesHoy = mesActual();
  const gastosItems   = items.filter(i => i.tipo === 'Gasto');
  const ingresosItems = items.filter(i => i.tipo === 'Ingreso');

  function checkData(item: ExpectedItem) {
    const matches = movimientosDelItem(item, movimientos);
    const estado  = estadoItem(item, matches, mesHoy, mes);
    return { item, matches, estado };
  }

  const gastosCheck   = gastosItems.map(checkData).sort((a, b) => {
    const ord: Record<EstadoItem, number> = { vencido: 0, pendiente: 1, registrado: 2 };
    return ord[a.estado] - ord[b.estado];
  });
  const ingresosCheck = ingresosItems.map(checkData).sort((a, b) => {
    const ord: Record<EstadoItem, number> = { vencido: 0, pendiente: 1, registrado: 2 };
    return ord[a.estado] - ord[b.estado];
  });

  const gastosReg   = gastosCheck.filter(c => c.estado === 'registrado').length;
  const ingresosReg = ingresosCheck.filter(c => c.estado === 'registrado').length;

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

            {/* Totales */}
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

            {/* Lista agrupada */}
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
                            <td className="res-col-monto res-ingreso">
                              +{fmtMonto(m.monto, m.moneda)}
                            </td>
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
                            <td className="res-col-monto res-gasto">
                              -{fmtMonto(m.monto, m.moneda)}
                            </td>
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
              {/* Gastos */}
              <div className="res-checklist-bloque">
                <h3 className="res-checklist-titulo">
                  Gastos esperados
                  <span className="res-checklist-contador">{gastosReg} de {gastosItems.length} registrados</span>
                </h3>
                {gastosCheck.length === 0
                  ? <p className="res-estado">Sin gastos esperados activos.</p>
                  : gastosCheck.map(({ item, matches, estado }) => (
                      <CheckItemRow key={item.id} item={item} matches={matches} estado={estado} />
                    ))
                }
              </div>

              {/* Ingresos */}
              <div className="res-checklist-bloque">
                <h3 className="res-checklist-titulo">
                  Ingresos esperados
                  <span className="res-checklist-contador">{ingresosReg} de {ingresosItems.length} registrados</span>
                </h3>
                {ingresosCheck.length === 0
                  ? <p className="res-estado">Sin ingresos esperados activos.</p>
                  : ingresosCheck.map(({ item, matches, estado }) => (
                      <CheckItemRow key={item.id} item={item} matches={matches} estado={estado} />
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
