import type { CSSProperties } from 'react';

type Option = string | { value: string; label: string };

interface RadioChipProps {
  options?: Option[];
  value?: string;
  onChange?: (value: string) => void;
  name?: string;
  style?: CSSProperties;
}

// RadioChip — selector segmentado tipo chip (Gasto/Ingreso, ARS/USD del Alta).
// El chip elegido toma borde + tinte + texto en color primario.
export function RadioChip({ options = [], value, onChange, name, style }: RadioChipProps) {
  const norm = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <div role="radiogroup" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', ...style }}>
      {norm.map(o => {
        const selected = o.value === value;
        return (
          <label
            key={o.value}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
              padding: '0.45rem 0.85rem',
              fontFamily: 'var(--font-base)',
              fontSize: 'var(--text-base)',
              fontWeight: selected ? 'var(--weight-semibold)' : 'var(--weight-regular)',
              color: selected ? 'var(--color-primary-dark)' : 'var(--color-text)',
              border: `1px solid ${selected ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: selected ? 'var(--color-primary-light)' : 'var(--color-surface)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              userSelect: 'none',
              transition: 'background var(--transition), border-color var(--transition)',
            }}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={selected}
              onChange={() => onChange?.(o.value)}
              style={{ display: 'none' }}
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
