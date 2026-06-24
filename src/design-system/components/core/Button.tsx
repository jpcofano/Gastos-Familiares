import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'brand' | 'green' | 'danger' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg' | 'cta';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: Variant;
  size?: Size;
  type?: 'button' | 'submit' | 'reset';
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

const SIZES: Record<Size, { padding: string; fontSize: string; radius: string; height?: string; width?: string }> = {
  sm: { padding: '0.4rem 0.85rem', fontSize: 'var(--text-sm)', radius: 'var(--radius-sm)' },
  md: { padding: '0.6rem 1.1rem',  fontSize: 'var(--text-base)', radius: 'var(--radius-sm)' },
  lg: { padding: '0.85rem 1.4rem', fontSize: 'var(--text-md)', radius: 'var(--radius-md)' },
  cta: { padding: '0', fontSize: '17px', radius: '14px', height: '52px', width: '100%' },
};

const VARIANTS: Record<Variant, { background: string; color: string; border: string }> = {
  primary:   { background: 'var(--color-primary)', color: '#fff', border: '1px solid transparent' },
  brand:     { background: 'var(--color-brand)',   color: '#fff', border: '1px solid transparent' },
  green:     { background: 'var(--color-income)',  color: '#fff', border: '1px solid transparent' },
  danger:    { background: 'var(--color-danger)',  color: '#fff', border: '1px solid transparent' },
  secondary: { background: 'var(--color-surface)', color: 'var(--color-text-strong)', border: '1px solid var(--color-border)' },
  ghost:     { background: 'transparent', color: 'var(--color-primary)', border: '1px solid transparent' },
};

// Button — la acción presionable de la marca. variant mapea al vocabulario
// de botones de la app: primary (acciones de form), brand (shell/header),
// green (ingreso/confirmar), danger (destructivo), secondary, ghost.
export function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  type = 'button',
  iconLeft = null,
  iconRight = null,
  style,
  children,
  ...rest
}: ButtonProps) {
  const s = SIZES[size] ?? SIZES.md;
  const v = VARIANTS[variant] ?? VARIANTS.primary;
  return (
    <button
      type={type}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.45rem',
        fontFamily: 'var(--font-base)',
        fontWeight: 'var(--weight-semibold)',
        lineHeight: 1.1,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background var(--transition), opacity var(--transition), transform 0.1s',
        whiteSpace: 'nowrap',
        padding: s.padding,
        fontSize: s.fontSize,
        borderRadius: s.radius,
        height: s.height,
        width: s.width,
        ...v,
        ...style,
      }}
      {...rest}
    >
      {iconLeft}{children}{iconRight}
    </button>
  );
}
