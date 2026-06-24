import type { HTMLAttributes, ReactNode } from 'react';

type Variant = 'default' | 'muted' | 'highlight' | 'flat';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  eyebrow?: ReactNode;
  title?: ReactNode;
  padding?: string;
}

const VARIANTS: Record<Variant, { background: string; border: string; boxShadow?: string }> = {
  default:   { background: 'var(--color-surface)', border: '1px solid rgba(17,24,39,0.05)', boxShadow: 'var(--shadow-soft)' },
  muted:     { background: 'var(--color-surface-muted)', border: '1px solid var(--color-border)' },
  highlight: { background: 'var(--color-primary-light)', border: '1px solid var(--gf-emerald)', boxShadow: 'var(--shadow-soft)' },
  flat:      { background: 'var(--color-surface)', border: '1px solid var(--color-border-card)' },
};

// Card — superficie blanca moderna: elevación suave, radio 18px, hairline
// tenue. highlight es el tratamiento esmeralda-tintado ("Equivalente").
export function Card({
  variant = 'default',
  eyebrow,
  title,
  padding = 'var(--space-4)',
  children,
  style,
  ...rest
}: CardProps) {
  const v = VARIANTS[variant] ?? VARIANTS.default;
  return (
    <div
      style={{
        borderRadius: 'var(--radius-card)',
        padding,
        fontFamily: 'var(--font-base)',
        color: 'var(--color-text)',
        ...v,
        ...style,
      }}
      {...rest}
    >
      {eyebrow && (
        <span style={{
          display: 'block',
          fontSize: 'var(--text-2xs)',
          fontWeight: 'var(--weight-bold)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wide)',
          color: 'var(--color-text-sec)',
          marginBottom: title ? '0.15rem' : '0.5rem',
        }}>{eyebrow}</span>
      )}
      {title && (
        <div style={{
          fontSize: 'var(--text-md)',
          fontWeight: 'var(--weight-heavy)',
          color: 'var(--color-text)',
          marginBottom: '0.5rem',
        }}>{title}</div>
      )}
      {children}
    </div>
  );
}
