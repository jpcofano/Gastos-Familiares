import type { HTMLAttributes } from 'react';

type Tone = 'neutral' | 'info' | 'sky' | 'success' | 'warning' | 'danger';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

const TONES: Record<Tone, { background: string; color: string }> = {
  neutral: { background: 'var(--gf-gray-100)', color: 'var(--gf-gray-500)' },
  info:    { background: 'var(--gf-blue-100)', color: 'var(--gf-blue-700)' },
  sky:     { background: '#e0f2fe', color: '#0369a1' },
  success: { background: '#dcfce7', color: 'var(--gf-income-700)' },
  warning: { background: '#fef3c7', color: '#b45309' },
  danger:  { background: '#ffe4e6', color: 'var(--gf-expense-700)' },
};

// Badge — pill/tag uppercase chico. Tone-based para etiquetas genéricas
// (p.ej. "pago tarjeta"). Para los estados del checklist de esperados usar
// <StatusBadge> en vez de esto.
export function Badge({ tone = 'neutral', children, style, ...rest }: BadgeProps) {
  const t = TONES[tone] ?? TONES.neutral;
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: 'var(--font-base)',
        fontSize: 'var(--text-2xs)',
        fontWeight: 'var(--weight-bold)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-label)',
        padding: '0.15em 0.45em',
        borderRadius: 'var(--radius-xs)',
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
        ...t,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
