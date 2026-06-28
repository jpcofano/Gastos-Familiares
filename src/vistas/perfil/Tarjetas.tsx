import { Icon } from '../../design-system/Icon';
import { Card } from '../../design-system/components';
import { AddBtn } from './shared';
import { useFamiliaConfig } from '../../hooks/useFamiliaConfig';

// F9.26 — Perfil/Tarjetas cableado a config/familia.tarjetas real (catálogo
// de tarjetas físicas).
// F9.35 — cierreDia/venceDia/tipoTarjeta ya existen en el modelo (opcionales,
// sin valor inventado — F9.7/F9.12 los mockeaban, F9.26 los sacó por no ser
// reales todavía). Se muestran cuando están cargados; "—" si no. Edición
// sigue pendiente (ningún config de Perfil edita todavía, ver F9.32).

const TIPO_LABEL: Record<'credito' | 'debito', string> = { credito: 'Crédito', debito: 'Débito' };
const TIPO_COLOR: Record<'credito' | 'debito', string> = { credito: 'var(--gf-emerald)', debito: 'var(--gf-blue-600)' };

export default function Tarjetas() {
  const { config, cargando } = useFamiliaConfig();
  const tarjetas = config?.tarjetas ?? [];

  if (cargando) return <p style={{ color: 'var(--color-text-sec)' }}>Cargando…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card padding="var(--space-2)">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {tarjetas.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-sec)', padding: '12px 10px' }}>Sin tarjetas configuradas.</p>
          ) : tarjetas.map((t, i) => {
            const ultimos4 = t.ultimos4 ?? [];
            return (
              <button
                key={t.codigo}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 10px',
                  borderBottom: i < tarjetas.length - 1 ? '1px solid var(--gf-gray-100)' : 'none',
                  background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-base)',
                }}
              >
                <span style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--gf-ink)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name="credit-card" size={16} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{t.banco} · {t.tipo}</span>
                    {t.tipoTarjeta && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: '#fff', background: TIPO_COLOR[t.tipoTarjeta],
                        borderRadius: 999, padding: '2px 7px', textTransform: 'uppercase', letterSpacing: '.3px', flexShrink: 0,
                      }}>{TIPO_LABEL[t.tipoTarjeta]}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>
                    {ultimos4.length > 0 ? `•••• ${ultimos4[0]}${ultimos4.length > 1 ? ` (+${ultimos4.length - 1})` : ''} · ` : ''}{t.titular}
                    {' · Cierre día '}{t.cierreDia ?? '—'}{' · Vence día '}{t.venceDia ?? '—'}
                  </div>
                </div>
                <Icon name="chevron-right" size={18} color="var(--gf-gray-300)" />
              </button>
            );
          })}
        </div>
      </Card>
      <AddBtn><Icon name="plus" size={18} /> Agregar tarjeta</AddBtn>
      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Los resúmenes se ven en <strong>Resumen › Tarjetas</strong>.
      </p>
    </div>
  );
}
