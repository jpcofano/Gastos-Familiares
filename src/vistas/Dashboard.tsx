import { useState } from 'react';
import { useMovimientosDelMes } from '../hooks/useMovimientosDelMes';
import { useMiembroCtx } from '../contexto/MiembroContext';
import type { Movement } from '../types';
import './Dashboard.css';

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

function formatMonto(monto: number, tipo: string, moneda: string): string {
  const signo = tipo === 'Ingreso' ? '+' : '-';
  const simbolo = moneda === 'USD' ? 'U$S' : '$';
  return `${signo}${simbolo} ${monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Totales { ingresos: number; gastos: number; balance: number; }

function calcularTotales(movs: Movement[], moneda: 'ARS' | 'USD'): Totales {
  const del = movs.filter(m => m.moneda === moneda);
  const ingresos = del.filter(m => m.tipo === 'Ingreso').reduce((s, m) => s + m.monto, 0);
  const gastos   = del.filter(m => m.tipo === 'Gasto').reduce((s, m) => s + m.monto, 0);
  return { ingresos, gastos, balance: ingresos - gastos };
}

function calcularEquivARS(movs: Movement[]): Totales {
  let ingresos = 0, gastos = 0;
  for (const m of movs) {
    const monto = m.moneda === 'ARS'
      ? m.monto
      : (() => {
          if (!m.tcUsdArs) { console.warn('[Dashboard] tcUsdArs null en', m.id); return 0; }
          return m.monto * m.tcUsdArs;
        })();
    if (m.tipo === 'Ingreso') ingresos += monto;
    else gastos += monto;
  }
  return { ingresos, gastos, balance: ingresos - gastos };
}

function calcularEquivUSD(movs: Movement[]): Totales {
  let ingresos = 0, gastos = 0;
  for (const m of movs) {
    const monto = m.moneda === 'USD'
      ? m.monto
      : (() => {
          if (!m.tcUsdArs) { console.warn('[Dashboard] tcUsdArs null en', m.id); return 0; }
          return m.monto / m.tcUsdArs;
        })();
    if (m.tipo === 'Ingreso') ingresos += monto;
    else gastos += monto;
  }
  return { ingresos, gastos, balance: ingresos - gastos };
}

function fmtARS(n: number): string {
  return `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtUSD(n: number): string {
  return `U$S ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmt(n: number, moneda: 'ARS' | 'USD'): string {
  return moneda === 'ARS' ? fmtARS(n) : fmtUSD(n);
}

function claseBalance(n: number) { return n >= 0 ? 'dash-ingreso' : 'dash-gasto'; }

export default function Dashboard() {
  const { memberId, miembro } = useMiembroCtx();
  const esAdmin = miembro.rol === 'admin';

  const [mes, setMes] = useState(mesActual);

  const { movimientos, cargando, error } = useMovimientosDelMes(
    mes,
    esAdmin ? undefined : memberId,
  );

  const visibles = movimientos
    .filter(m => !m.excluirDash)
    .sort((a, b) => b.fecha.getTime() - a.fecha.getTime());

  const ars     = calcularTotales(visibles, 'ARS');
  const usd     = calcularTotales(visibles, 'USD');
  const eqARS   = calcularEquivARS(visibles);
  const eqUSD   = calcularEquivUSD(visibles);
  const hayUSD  = visibles.some(m => m.moneda === 'USD');

  const titulo = esAdmin ? `Dashboard — ${formatMes(mes)}` : `Mis movimientos — ${formatMes(mes)}`;

  return (
    <div className="dash">
      {/* Selector de mes */}
      <div className="dash-mes-selector">
        <button className="dash-mes-btn" onClick={() => setMes(m => desplazarMes(m, -1))} aria-label="Mes anterior">‹</button>
        <span className="dash-mes-label">{titulo}</span>
        <button className="dash-mes-btn" onClick={() => setMes(m => desplazarMes(m, +1))} aria-label="Mes siguiente">›</button>
      </div>

      {cargando && <p className="dash-estado">Cargando…</p>}
      {error    && <p className="dash-estado dash-error">Error: {error}</p>}

      {!cargando && !error && (
        <>
          {/* Totales */}
          <div className="dash-totales">

            {/* Equivalentes — vista principal */}
            <div className="dash-totales-moneda dash-totales-eq">
              <span className="dash-totales-titulo">Equivalente</span>
              <div className="dash-totales-fila">
                <span>Ingresos</span>
                <span className="dash-ingreso">
                  {fmtARS(eqARS.ingresos)}
                  <span className="dash-eq-sec">{fmtUSD(eqUSD.ingresos)}</span>
                </span>
              </div>
              <div className="dash-totales-fila">
                <span>Gastos</span>
                <span className="dash-gasto">
                  {fmtARS(eqARS.gastos)}
                  <span className="dash-eq-sec">{fmtUSD(eqUSD.gastos)}</span>
                </span>
              </div>
              <div className="dash-totales-fila dash-totales-balance">
                <span>Balance</span>
                <span className={claseBalance(eqARS.balance)}>
                  {fmtARS(eqARS.balance)}
                  <span className="dash-eq-sec">{fmtUSD(eqUSD.balance)}</span>
                </span>
              </div>
            </div>

            {/* Desglose por moneda original */}
            <div className="dash-totales-moneda">
              <span className="dash-totales-titulo">ARS</span>
              <div className="dash-totales-fila">
                <span>Ingresos</span><span className="dash-ingreso">{fmt(ars.ingresos, 'ARS')}</span>
              </div>
              <div className="dash-totales-fila">
                <span>Gastos</span><span className="dash-gasto">{fmt(ars.gastos, 'ARS')}</span>
              </div>
              <div className="dash-totales-fila dash-totales-balance">
                <span>Balance</span>
                <span className={claseBalance(ars.balance)}>{fmt(ars.balance, 'ARS')}</span>
              </div>
            </div>

            {hayUSD && (
              <div className="dash-totales-moneda">
                <span className="dash-totales-titulo">USD</span>
                <div className="dash-totales-fila">
                  <span>Ingresos</span><span className="dash-ingreso">{fmt(usd.ingresos, 'USD')}</span>
                </div>
                <div className="dash-totales-fila">
                  <span>Gastos</span><span className="dash-gasto">{fmt(usd.gastos, 'USD')}</span>
                </div>
                <div className="dash-totales-fila dash-totales-balance">
                  <span>Balance</span>
                  <span className={claseBalance(usd.balance)}>{fmt(usd.balance, 'USD')}</span>
                </div>
              </div>
            )}
          </div>

          {/* Lista */}
          {visibles.length === 0 ? (
            <p className="dash-estado">Sin movimientos para {formatMes(mes)}.</p>
          ) : (
            <table className="dash-tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Descripción</th>
                  <th>Categoría</th>
                  <th className="dash-col-monto">Monto</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map(m => (
                  <tr key={m.id}>
                    <td className="dash-col-fecha">{formatFecha(m.fecha)}</td>
                    <td>{m.descripcion}</td>
                    <td className="dash-col-cat">{m.categoria ?? '—'}</td>
                    <td className={`dash-col-monto ${m.tipo === 'Ingreso' ? 'dash-ingreso' : 'dash-gasto'}`}>
                      {formatMonto(m.monto, m.tipo, m.moneda)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
