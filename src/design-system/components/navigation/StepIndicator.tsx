import { Fragment, type CSSProperties, type ReactNode } from 'react';

interface StepIndicatorProps {
  steps?: ReactNode[];
  current?: number; // 0-based
  style?: CSSProperties;
}

// StepIndicator — header de flujo multi-paso (Comprobantes / Manual).
// Mejora sobre el .sn/.sl legacy: agrega un track de progreso conector
// para que la posición se lea de un vistazo, no solo por color del punto.
export function StepIndicator({ steps = [], current = 0, style }: StepIndicatorProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, fontFamily: 'var(--font-base)', ...style }}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const dotBg = done ? 'var(--color-accent)' : active ? 'var(--color-ink-action)' : 'var(--gf-gray-200)';
        const dotColor = done || active ? '#fff' : 'var(--gf-gray-500)';
        return (
          <Fragment key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, background: dotBg, color: dotColor,
              }}>
                {done ? '✓' : i + 1}
              </span>
              <span style={{
                fontSize: 'var(--text-xs)',
                color: active ? 'var(--color-text)' : 'var(--color-text-sec)',
                fontWeight: active ? 700 : 400,
                whiteSpace: 'nowrap',
              }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span style={{
                flex: 1, height: 2, minWidth: 16, margin: '0 8px',
                background: i < current ? 'var(--color-accent)' : 'var(--gf-gray-200)',
                borderRadius: 2,
              }} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
