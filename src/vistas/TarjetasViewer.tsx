import { useEffect, useMemo, useState } from 'react';
import { suscribirResumenesTarjeta } from '../datos/resumenesTarjeta';
import { cargarFamiliaConfig } from '../familia';
import type { CardStatement, FamiliaConfig, MovimientoParseado } from '../types';
import { Icon } from '../design-system/Icon';
import { TarjetaFace, CaraTarjeta, calcularSplitCuotas, fmtMonto } from './TarjetaFace';
import './TarjetasViewer.css';

// F9.7 — /tarjetas: visor de SOLO LECTURA de resúmenes ya cargados. Separado
// del flujo de subida/revisión/confirmación, que sigue viviendo en Cargar
// (SeccionTarjetas, sin cambios — F6.7 addendum 1 no se reabre). Mismos datos
// reales (suscribirResumenesTarjeta), misma cara de tarjeta (TarjetaFace,
// compartida con SeccionTarjetas), sin acciones (sin descartar/asignar/revisar).
// F9.21 — la tarjeta es tappable: abre el detalle (back interno "‹ Resúmenes",
// no toca el bottom-nav) con el split "este mes / deuda futura en cuotas" y la
// lista de consumos. cuotaActual/cuotaTotal/monto ya existen en el modelo real.
// F9.22 — fix: por defecto solo se ve el mes en curso (período más reciente).
// El histórico se accede con el selector de chips; nunca se mezclan períodos.

const MONEDAS = ['ARS', 'USD'] as const;

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function labelPeriodo(p: string): string {
  const [y, m] = p.split('-');
  const nombre = MESES_ES[Number(m) - 1];
  if (!nombre) return p;
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${y}`;
}

function fmtFechaCorta(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

function ConsumoRow({ l }: { l: MovimientoParseado }) {
  const enCuotas = l.cuotaTotal > 1;
  const sub = [l.categoria, fmtFechaCorta(l.fechaConsumo)].filter(Boolean).join(' · ');
  return (
    <div className="tv-consumo-row">
      <div className="tv-consumo-izq">
        <div className="tv-consumo-comercio">
          {l.descripcionRaw || '—'}
          {enCuotas && (
            <span className="tv-badge-cuota">
              <Icon name="layers" size={11} /> Cuota {l.cuotaActual}/{l.cuotaTotal}
            </span>
          )}
        </div>
        {sub && <div className="tv-consumo-sub">{sub}</div>}
      </div>
      <div className="tv-consumo-der">
        <div className="tv-consumo-monto">{fmtMonto(l.monto, l.moneda)}</div>
        {enCuotas && <div className="tv-consumo-plan">plan {fmtMonto(l.monto * l.cuotaTotal, l.moneda)}</div>}
      </div>
    </div>
  );
}

function DetalleResumen({ resumen, config, onVolver }: { resumen: CardStatement; config: FamiliaConfig | null; onVolver: () => void }) {
  const split = calcularSplitCuotas(resumen);
  const lineas = [...split.lineas].sort((a, b) => (a.cuotaTotal > 1 ? 0 : 1) - (b.cuotaTotal > 1 ? 0 : 1));
  const monedasConDatos = MONEDAS.filter(m => split.esteMes[m]);

  return (
    <div className="tv-detalle">
      <button className="tv-volver" onClick={onVolver}>
        <Icon name="chevron-left" size={16} /> Resúmenes
      </button>
      <CaraTarjeta resumen={resumen} config={config} />
      {monedasConDatos.map(m => (
        <div key={m} className="tv-split">
          <div className="tv-split-item">
            <span className="tv-split-label">A pagar este mes</span>
            <span className="tv-split-monto">{fmtMonto(split.esteMes[m]!, m)}</span>
          </div>
          <div className="tv-split-item tv-split-item--right">
            <span className="tv-split-label">Deuda futura en cuotas</span>
            <span className="tv-split-monto tv-split-monto--out">{split.deudaFutura[m] ? fmtMonto(split.deudaFutura[m]!, m) : '—'}</span>
          </div>
        </div>
      ))}
      <div className="tv-consumos">
        {lineas.map(l => <ConsumoRow key={l.seq} l={l} />)}
      </div>
    </div>
  );
}

export default function TarjetasViewer() {
  const [config, setConfig] = useState<FamiliaConfig | null>(null);
  const [resumenes, setResumenes] = useState<CardStatement[]>([]);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<CardStatement | null>(null);
  const [periodoSel, setPeriodoSel] = useState<string | null>(null);

  useEffect(() => {
    cargarFamiliaConfig().then(cfg => { setConfig(cfg); setCargando(false); });
  }, []);

  useEffect(() => suscribirResumenesTarjeta(setResumenes), []);

  const periodos = useMemo(() => [...new Set(resumenes.map(r => r.periodo))].sort().reverse(), [resumenes]);
  const periodoActivo = periodoSel ?? periodos[0] ?? null;
  const esMesPasado = periodoActivo !== null && periodoActivo !== periodos[0];
  const resumenesDelPeriodo = resumenes.filter(r => r.periodo === periodoActivo);

  if (abierto) {
    return (
      <div className="tv">
        <DetalleResumen resumen={abierto} config={config} onVolver={() => setAbierto(null)} />
      </div>
    );
  }

  return (
    <div className="tv">
      <h1 className="tv-titulo">Tarjetas</h1>
      <p className="tv-sub">Resúmenes cargados — solo lectura. Para subir o revisar, usá Carga.</p>

      {periodos.length > 1 && (
        <div className="tv-periodos">
          {periodos.map((p, i) => {
            const on = p === periodoActivo;
            return (
              <button key={p} className={`tv-chip${on ? ' tv-chip--on' : ''}`} onClick={() => setPeriodoSel(p)}>
                {labelPeriodo(p)}{i === 0 && <span className="tv-chip-curso"> · en curso</span>}
              </button>
            );
          })}
        </div>
      )}

      {esMesPasado && (
        <div className="tv-aviso-pasado">
          Estás viendo un mes pasado
          <button onClick={() => setPeriodoSel(null)}>Volver al actual</button>
        </div>
      )}

      {cargando ? (
        <p className="tv-estado">Cargando…</p>
      ) : resumenesDelPeriodo.length === 0 ? (
        <p className="tv-estado">No hay resúmenes cargados{periodoActivo ? ` para ${labelPeriodo(periodoActivo)}` : ''}.</p>
      ) : (
        <div className="tv-lista">
          {resumenesDelPeriodo.map(r => (
            <TarjetaFace key={r.id} resumen={r} config={config} onAbrir={() => setAbierto(r)} />
          ))}
        </div>
      )}
    </div>
  );
}
