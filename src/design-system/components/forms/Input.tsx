import { useState, type InputHTMLAttributes, type ReactNode } from 'react';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label?: ReactNode;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
}

// Input — field de texto/fecha/numérico labeled con el focus ring de la app,
// marcador de obligatorio, hint y estado de error.
export function Input({ label, required = false, optional = false, hint, error, type = 'text', id, style, onFocus, onBlur, ...rest }: InputProps) {
  const [focused, setFocused] = useState(false);
  const fieldId = id ?? (label ? 'in-' + String(label).toLowerCase().replace(/\s+/g, '-') : undefined);
  const borderColor = error ? 'var(--color-danger)' : focused ? 'var(--color-primary)' : 'var(--color-border)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontFamily: 'var(--font-base)' }}>
      {label && (
        <label htmlFor={fieldId} style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-strong)' }}>
          {label}
          {required && <span style={{ color: 'var(--color-danger)', marginLeft: 2 }}>*</span>}
          {optional && <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}> (opcional)</span>}
        </label>
      )}
      <input
        id={fieldId}
        type={type}
        onFocus={e => { setFocused(true); onFocus?.(e); }}
        onBlur={e => { setFocused(false); onBlur?.(e); }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '0.55rem 0.65rem',
          fontFamily: 'var(--font-base)',
          fontSize: '16px',
          color: 'var(--color-text)',
          background: 'var(--color-surface)',
          border: `1px solid ${borderColor}`,
          borderRadius: 'var(--radius-md)',
          outline: 'none',
          boxShadow: focused && !error ? 'var(--focus-ring)' : 'none',
          transition: 'border-color var(--transition), box-shadow var(--transition)',
          ...style,
        }}
        {...rest}
      />
      {error
        ? <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-danger)' }}>{error}</span>
        : hint && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-sec)' }}>{hint}</span>}
    </div>
  );
}
