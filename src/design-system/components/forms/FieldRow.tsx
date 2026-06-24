import type { ChangeEvent, CSSProperties, ReactNode } from 'react';

type Option = string | { value: string; label: string };

interface FieldRowProps {
  label: ReactNode;
  required?: boolean;
  value?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  options?: Option[]; // si está presente, renderiza un <select>
  placeholder?: string;
  readOnly?: boolean;
  last?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}

const inputStyle: CSSProperties = {
  fontSize: '16px', // 16px evita el auto-zoom de iOS
  fontWeight: 600,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  textAlign: 'right',
  width: '100%',
  fontFamily: 'var(--font-base)',
  WebkitAppearance: 'none',
  appearance: 'none',
};

// FieldRow — "field-row" móvil de la legacy: label a la izquierda, valor/input
// alineado a la derecha, 56px de alto, divisor hairline. Mejora sobre el
// original: el label usa --color-text-strong (#374151) en vez del bajo
// contraste #9ca3af.
export function FieldRow({
  label, required = false, value, onChange, options, placeholder, readOnly = false, last = false, children, style,
}: FieldRowProps) {
  const control = children ?? (options ? (
    <select value={value} onChange={onChange} style={{ ...inputStyle, cursor: 'pointer' }}>
      {options.map(o => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o;
        return <option key={opt.value} value={opt.value}>{opt.label}</option>;
      })}
    </select>
  ) : (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      readOnly={readOnly}
      style={{ ...inputStyle, color: readOnly ? 'var(--color-text-sec)' : 'var(--color-text)' }}
    />
  ));

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, minHeight: 56,
      borderBottom: last ? 'none' : '1px solid var(--gf-gray-100)',
      fontFamily: 'var(--font-base)',
      ...style,
    }}>
      <span style={{ fontSize: 15, color: 'var(--color-text-strong)', width: 120, flexShrink: 0 }}>
        {label}{required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
      </span>
      <span style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        {control}
      </span>
    </div>
  );
}
