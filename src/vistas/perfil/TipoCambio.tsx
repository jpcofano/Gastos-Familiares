import { useState } from 'react';
import { Card, RadioChip } from '../../design-system/components';

// F9.3 — Perfil/Tipo de cambio, PR visual: maqueta con datos de EJEMPLO
// siguiendo PerfilScreens.jsx (TipoCambioMobile). El TC real ya se resuelve
// automáticamente por fecha (/tcDiario, poblado por Function) — esta pantalla
// es para el override manual puntual, que es backlog (ver docs/CLAUDE.md);
// el toggle manual/automático de acá es local, no persiste nada todavía.

const EXAMPLE_TC_ACTUAL = { valor: 1180, modo: 'manual' as const, actualizado: '22/06/2026' };
const EXAMPLE_TC_HIST = [
  { mes: 'Junio 2026', valor: 1180 },
  { mes: 'Mayo 2026',  valor: 1145 },
  { mes: 'Abril 2026', valor: 1120 },
  { mes: 'Marzo 2026', valor: 1090 },
];

export default function TipoCambio() {
  const [modo, setModo] = useState<string>(EXAMPLE_TC_ACTUAL.modo);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card variant="highlight" eyebrow="Tipo de cambio · USD → ARS">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 36, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.5px' }}>$ {EXAMPLE_TC_ACTUAL.valor.toLocaleString('es-AR')}</span>
          <span style={{ fontSize: 14, color: 'var(--color-text-sec)' }}>/ USD</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 4 }}>Actualizado el {EXAMPLE_TC_ACTUAL.actualizado}</div>
      </Card>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)' }}>Modo de actualización</span>
          <RadioChip
            options={[{ value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Automático (API)' }]}
            value={modo}
            onChange={setModo}
            name="tcmodo"
          />
          <span style={{ fontSize: 12, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
            {modo === 'manual'
              ? 'Cargás el valor a mano cada mes. Se usa para convertir movimientos en USD a ARS.'
              : 'Se toma la cotización del dólar al cierre de cada día automáticamente.'}
          </span>
        </div>
      </Card>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 0 8px 4px' }}>Histórico</div>
        <Card padding="var(--space-2)">
          {EXAMPLE_TC_HIST.map((h, i) => (
            <div key={h.mes} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 10px', borderBottom: i < EXAMPLE_TC_HIST.length - 1 ? '1px solid var(--gf-gray-100)' : 'none', fontSize: 14 }}>
              <span style={{ color: 'var(--color-text-strong)' }}>{h.mes}</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>$ {h.valor.toLocaleString('es-AR')}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
