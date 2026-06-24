import { useState, type ReactNode, type SelectHTMLAttributes } from 'react';

type Option = string | { value: string; label: string };

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label?: ReactNode;
  required?: boolean;
  options?: Option[];
  placeholder?: string;
  hint?: ReactNode;
  id?: string;
}

// Select — dropdown nativo labeled, mismo estilo que Input.
export function Select({ label, required = false, options = [], placeholder, value, onChange, disabled = false, hint, id, style, ...rest }: SelectProps) {
  const [focused, setFocused] = useState(false);
  const fieldId = id ?? (label ? 'sel-' + String(label).toLowerCase().replace(/\s+/g, '-') : undefined);
  const norm = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontFamily: 'var(--font-base)' }}>
      {label && (
        <label htmlFor={fieldId} style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-strong)' }}>
          {label}
          {required && <span style={{ color: 'var(--color-danger)', marginLeft: 2 }}>*</span>}
        </label>
      )}
      <select
        id={fieldId}
        value={value}
        onChange={onChange}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '0.55rem 0.65rem',
          fontFamily: 'var(--font-base)',
          fontSize: '16px',
          color: 'var(--color-text)',
          background: 'var(--color-surface)',
          border: `1px solid ${focused ? 'var(--color-primary)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-md)',
          outline: 'none',
          boxShadow: focused ? 'var(--focus-ring)' : 'none',
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'border-color var(--transition), box-shadow var(--transition)',
          ...style,
        }}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {norm.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-sec)' }}>{hint}</span>}
    </div>
  );
}
