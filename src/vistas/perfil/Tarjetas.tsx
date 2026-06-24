import { Icon } from '../../design-system/Icon';
import { Card } from '../../design-system/components';
import { AddBtn } from './shared';

// F9.7 — Perfil/Tarjetas, PR visual: configuración propia del catálogo de
// tarjetas físicas — banco/red/término + ciclo de cierre/vencimiento (día del
// mes) + titular. Distinto del visor /tarjetas (solo lectura, todos los
// roles, alcanzable desde Resumen) y de SeccionTarjetas (resúmenes, sigue en
// Cargar). Datos de EJEMPLO — cierreDia/venceDia no existen aún en
// config/familia.tarjetas (real); alta/edición real vía callable admin-only
// es la PR de cableado (F8.0).

interface TarjetaEjemplo { banco: string; red: string; term: string; cierreDia: number; venceDia: number; titular: string; }

const EXAMPLE_TARJETAS: TarjetaEjemplo[] = [
  { banco: 'Galicia', red: 'Visa Signature',    term: '4417', cierreDia: 28, venceDia: 10, titular: 'Juan' },
  { banco: 'Galicia', red: 'Mastercard Black',   term: '8290', cierreDia: 20, venceDia: 3,  titular: 'María' },
  { banco: 'BBVA',    red: 'Visa Signature',     term: '2003', cierreDia: 2,  venceDia: 15, titular: 'Juan' },
  { banco: 'BBVA',    red: 'Mastercard Black',   term: '8856', cierreDia: 20, venceDia: 3,  titular: 'María' },
];

export default function Tarjetas() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card padding="var(--space-2)">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {EXAMPLE_TARJETAS.map((t, i) => (
            <button
              key={`${t.banco}-${t.term}`}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 10px',
                borderBottom: i < EXAMPLE_TARJETAS.length - 1 ? '1px solid var(--gf-gray-100)' : 'none',
                background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-base)',
              }}
            >
              <span style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--gf-ink)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="credit-card" size={16} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{t.banco} · {t.red}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>
                  •••• {t.term} · Cierre día {t.cierreDia} · Vence día {t.venceDia} · {t.titular}
                </div>
              </div>
              <Icon name="chevron-right" size={18} color="var(--gf-gray-300)" />
            </button>
          ))}
        </div>
      </Card>
      <AddBtn><Icon name="plus" size={18} /> Agregar tarjeta</AddBtn>
      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Los resúmenes se ven en <strong>Resumen › Tarjetas</strong>.
      </p>
    </div>
  );
}
