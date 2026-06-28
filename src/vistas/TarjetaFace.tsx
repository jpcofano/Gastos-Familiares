import type { ReactNode } from 'react';
import type { CardStatement, FamiliaConfig, MovimientoParseado } from '../types';
import { Icon } from '../design-system/Icon';
import './TarjetaFace.css';

// F9.7 — cara de tarjeta compartida entre SeccionTarjetas (Cargar, con acciones
// admin: descartar/asignar/revisar) y el visor de solo lectura (/tarjetas).
// Mismo visual que ui_kits/mobile/TarjetasMobile.jsx, con datos reales.

export function fmtMonto(n: number, moneda: 'ARS' | 'USD'): string {
  return moneda === 'USD'
    ? `U$S ${n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtFecha(d: Date | null): string {
  return d ? d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '—';
}

// F9.12 — tinte de la cara por marca (Visa navy / Mastercard casi-negro), derivado
// del texto de red ya existente (sin campo nuevo en el modelo). Solo color de
// fondo — no reproduce logos de marca.
function tintPorRed(red: string): string {
  const r = red.toLowerCase();
  if (r.includes('visa')) return '#1a1f71';
  if (r.includes('mastercard')) return '#23252b';
  return 'var(--gf-ink)';
}

export function BadgeEstadoResumen({ estado }: { estado: string }) {
  return <span className={`rt-badge rt-badge--${estado}`}>{estado}</span>;
}

// F9.21 — "A pagar este mes" vs. "deuda futura en cuotas", derivado de los
// consumos (tipoLinea consumo/cuota; excluye impuestos/reintegros/bonif/
// reverso). cuotaActual/cuotaTotal/monto ya existen en MovimientoParseado —
// sin tocar Firestore. Si cuotaTotal=1 (hoy, todo lo no migrado) no hay
// deuda futura y el total = suma simple de consumos, igual que antes.
export interface SplitCuotas {
  lineas: MovimientoParseado[];
  nConsumos: number;
  nEnCuotas: number;
  esteMes: Partial<Record<'ARS' | 'USD', number>>;
  deudaFutura: Partial<Record<'ARS' | 'USD', number>>;
}

export function calcularSplitCuotas(resumen: CardStatement): SplitCuotas {
  const lineas = resumen.movimientosParseados.filter(m => m.tipoLinea === 'consumo' || m.tipoLinea === 'cuota');
  const esteMes: Partial<Record<'ARS' | 'USD', number>> = {};
  const deudaFutura: Partial<Record<'ARS' | 'USD', number>> = {};
  for (const l of lineas) {
    esteMes[l.moneda] = (esteMes[l.moneda] ?? 0) + l.monto;
    if (l.cuotaTotal > 1) {
      deudaFutura[l.moneda] = (deudaFutura[l.moneda] ?? 0) + l.monto * (l.cuotaTotal - l.cuotaActual);
    }
  }
  return { lineas, nConsumos: lineas.length, nEnCuotas: lineas.filter(l => l.cuotaTotal > 1).length, esteMes, deudaFutura };
}

const MONEDAS = ['ARS', 'USD'] as const;

interface CaraTarjetaProps {
  resumen: CardStatement;
  config: FamiliaConfig | null;
  onDescartar?: () => void;
  descartando?: boolean;
}

// Solo la cara visual (banco/red/últimos4/cierre-vencimiento) — sin footer.
// La usa TarjetaFace (lista) y el detalle del resumen (F9.21), que necesita
// la cara sola, separada del bloque de totales.
export function CaraTarjeta({ resumen, config, onDescartar, descartando }: CaraTarjetaProps) {
  const tarjetaCfg = config?.tarjetas.find(t => t.codigo === resumen.tarjetaCodigo);
  const ultimos4   = tarjetaCfg?.ultimos4?.[0];
  const red        = resumen.tarjeta || tarjetaCfg?.tipo || '';
  const tint       = tintPorRed(red);

  return (
    <div className="rt-card-face" style={{ background: `linear-gradient(135deg, ${tint} 0%, var(--gf-ink) 100%)` }}>
      {onDescartar && (
        <button
          className="rt-card-descartar"
          onClick={onDescartar}
          disabled={descartando}
          title="Descartar resumen"
        >
          {descartando ? '…' : '✕'}
        </button>
      )}
      <div className="rt-card-face-top">
        <span className="rt-card-banco">{resumen.banco || tarjetaCfg?.banco || '—'}</span>
        {red && <span className="rt-card-red">{red}</span>}
      </div>
      <div className="rt-card-numero">•••• •••• •••• {ultimos4 || '----'}</div>
      <div className="rt-card-fechas">
        <span>Cierre <strong>{fmtFecha(resumen.fechaCierre)}</strong></span>
        <span>Vencimiento <strong>{fmtFecha(resumen.fechaVencimiento)}</strong></span>
      </div>
    </div>
  );
}

interface TarjetaFaceProps {
  resumen: CardStatement;
  config: FamiliaConfig | null;
  onDescartar?: () => void;
  descartando?: boolean;
  onAbrir?: () => void; // F9.21 — visor: la tarjeta es tappable, abre el detalle
  children?: ReactNode; // área de acciones/estado debajo del footer (solo Cargar)
}

export function TarjetaFace({ resumen, config, onDescartar, descartando, onAbrir, children }: TarjetaFaceProps) {
  const split = calcularSplitCuotas(resumen);
  const sinDatos = !split.esteMes.ARS && !split.esteMes.USD;

  // F9.35 — coherencia: débito no debería tener líneas en cuotas. No bloqueante
  // (no hay resúmenes reales de débito todavía para validar contra esto) — solo log.
  const tarjetaCfg = config?.tarjetas.find(t => t.codigo === resumen.tarjetaCodigo);
  if (tarjetaCfg?.tipoTarjeta === 'debito' && split.nEnCuotas > 0) {
    console.warn(`[TarjetaFace] resumen ${resumen.id}: tarjeta débito con ${split.nEnCuotas} línea(s) en cuotas (inesperado)`);
  }

  return (
    <div className="rt-card">
      <CaraTarjeta resumen={resumen} config={config} onDescartar={onDescartar} descartando={descartando} />
      <div
        className="rt-card-footer"
        onClick={onAbrir}
        role={onAbrir ? 'button' : undefined}
        tabIndex={onAbrir ? 0 : undefined}
        style={onAbrir ? { cursor: 'pointer' } : undefined}
      >
        <div className="rt-card-totales">
          <span className="rt-card-eyebrow">A pagar este mes</span>
          {MONEDAS.map(m => split.esteMes[m] ? <span key={m} className="rt-card-monto">{fmtMonto(split.esteMes[m]!, m)}</span> : null)}
          {sinDatos && <span className="rt-card-periodo">{resumen.periodo || '—'}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <BadgeEstadoResumen estado={resumen.estado} />
          {onAbrir && <Icon name="chevron-right" size={16} color="var(--gf-gray-300)" />}
        </div>
      </div>
      {split.nConsumos > 0 && (
        <div className="rt-card-cuotas">
          <div>
            {split.nConsumos} {split.nConsumos === 1 ? 'consumo' : 'consumos'}
            {split.nEnCuotas > 0 && ` · ${split.nEnCuotas} en cuotas`}
          </div>
          {MONEDAS.map(m => split.deudaFutura[m] ? (
            <div key={m} className="rt-card-deuda-futura">
              + {fmtMonto(split.deudaFutura[m]!, m)} en cuotas futuras
            </div>
          ) : null)}
        </div>
      )}
      {children}
    </div>
  );
}
