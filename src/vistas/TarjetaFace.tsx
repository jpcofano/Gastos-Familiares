import type { ReactNode } from 'react';
import type { CardStatement, FamiliaConfig } from '../types';
import './TarjetaFace.css';

// F9.7 — cara de tarjeta compartida entre SeccionTarjetas (Cargar, con acciones
// admin: descartar/asignar/revisar) y el visor de solo lectura (/tarjetas).
// Mismo visual que ui_kits/mobile/TarjetasMobile.jsx, con datos reales.

function fmtMonto(n: number, moneda: 'ARS' | 'USD'): string {
  return moneda === 'USD'
    ? `U$S ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtFecha(d: Date | null): string {
  return d ? d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '—';
}

export function BadgeEstadoResumen({ estado }: { estado: string }) {
  return <span className={`rt-badge rt-badge--${estado}`}>{estado}</span>;
}

interface TarjetaFaceProps {
  resumen: CardStatement;
  config: FamiliaConfig | null;
  onDescartar?: () => void;
  descartando?: boolean;
  children?: ReactNode; // área de acciones/estado debajo del footer (solo Cargar)
}

export function TarjetaFace({ resumen, config, onDescartar, descartando, children }: TarjetaFaceProps) {
  const tarjetaCfg = config?.tarjetas.find(t => t.codigo === resumen.tarjetaCodigo);
  const ultimos4   = tarjetaCfg?.ultimos4?.[0];

  return (
    <div className="rt-card">
      <div className="rt-card-face">
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
          <span className="rt-card-red">{resumen.tarjeta || tarjetaCfg?.tipo || ''}</span>
        </div>
        <div className="rt-card-numero">•••• •••• •••• {ultimos4 || '----'}</div>
        <div className="rt-card-fechas">
          <span>Cierre <strong>{fmtFecha(resumen.fechaCierre)}</strong></span>
          <span>Vencimiento <strong>{fmtFecha(resumen.fechaVencimiento)}</strong></span>
        </div>
      </div>
      <div className="rt-card-footer">
        <div className="rt-card-totales">
          <span className="rt-card-eyebrow">Total resumen</span>
          {resumen.totalARS > 0 && <span className="rt-card-monto">{fmtMonto(resumen.totalARS, 'ARS')}</span>}
          {resumen.totalUSD > 0 && <span className="rt-card-monto">{fmtMonto(resumen.totalUSD, 'USD')}</span>}
          {resumen.totalARS === 0 && resumen.totalUSD === 0 && <span className="rt-card-periodo">{resumen.periodo || '—'}</span>}
        </div>
        <BadgeEstadoResumen estado={resumen.estado} />
      </div>
      {children}
    </div>
  );
}
