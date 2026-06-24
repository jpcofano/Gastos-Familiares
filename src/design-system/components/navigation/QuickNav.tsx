import type { CSSProperties, ReactNode } from 'react';

export interface QuickNavItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
}

interface QuickNavProps {
  items?: QuickNavItem[];
  active?: string;
  onSelect?: (id: string) => void;
  style?: CSSProperties;
}

// QuickNav — la barra de chips `.qnav` de la legacy. El chip activo se
// rellena en ink con sombra suave.
export function QuickNav({ items = [], active, onSelect, style }: QuickNavProps) {
  return (
    <div style={{
      display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
      paddingBottom: 14, borderBottom: '1px solid var(--gf-gray-100)',
      fontFamily: 'var(--font-base)',
      ...style,
    }}>
      {items.map(it => {
        const isActive = it.id === active;
        return (
          <button
            key={it.id}
            onClick={() => onSelect?.(it.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 12px',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${isActive ? 'var(--color-ink-action)' : 'var(--color-border)'}`,
              background: isActive ? 'var(--color-ink-action)' : 'var(--color-surface)',
              color: isActive ? '#fff' : 'var(--color-text-strong)',
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              boxShadow: isActive ? 'var(--shadow-card)' : 'none',
              transition: 'border-color .15s, box-shadow .15s, background .15s',
            }}
          >
            {it.icon && <span style={{ fontSize: 14, lineHeight: 1 }}>{it.icon}</span>}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
