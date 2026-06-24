import type { HTMLAttributes, ReactNode } from 'react';

type Tone = 'neutral' | 'emerald' | 'ink';

interface PageKickerProps extends HTMLAttributes<HTMLSpanElement> {
  icon?: ReactNode;
  tone?: Tone;
}

const TONES: Record<Tone, { background: string; color: string }> = {
  neutral: { background: 'var(--gf-gray-100)', color: 'var(--color-text-strong)' },
  emerald: { background: 'var(--gf-emerald-50)', color: 'var(--gf-emerald)' },
  ink:     { background: 'var(--color-ink-action)', color: '#fff' },
};

// PageKicker — el pill `.page-kicker` de la legacy: eyebrow chico arriba de
// un título de página. Ícono/glyph opcional al frente.
export function PageKicker({ icon, children, tone = 'neutral', style, ...rest }: PageKickerProps) {
  const t = TONES[tone] ?? TONES.neutral;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '6px 10px',
        borderRadius: 'var(--radius-pill)',
        fontFamily: 'var(--font-base)',
        fontSize: 'var(--text-xs)',
        fontWeight: 700,
        ...t,
        ...style,
      }}
      {...rest}
    >
      {icon && <span style={{ lineHeight: 1 }}>{icon}</span>}
      {children}
    </span>
  );
}
