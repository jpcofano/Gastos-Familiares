import type { ReactNode } from 'react';
import { Icon } from '../Icon';
import { useTheme } from '../../datos/theme';

interface AppBarProps {
  title: ReactNode;
  sub?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  onBack?: () => void;
}

// F9.20 — toggle sol/luna siempre visible (no escondido en Perfil). Mismo
// estado singleton que el de Perfil › Apariencia (datos/theme.ts), así que
// ambos quedan sincronizados sin Context.
function ThemeButton() {
  const { theme, setTheme } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      style={{
        width: 34, height: 34, borderRadius: 999, border: 'none', background: 'var(--gf-gray-100)',
        color: 'var(--color-text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', flexShrink: 0,
      }}
    >
      <Icon name={dark ? 'sun' : 'moon'} size={17} />
    </button>
  );
}

export function AppBar({ title, sub, left, right, onBack }: AppBarProps) {
  const backBtn = onBack ? (
    <button onClick={onBack} aria-label="Volver" style={{
      width: 34, height: 34, borderRadius: 999, border: 'none', background: 'var(--gf-gray-100)',
      color: 'var(--color-text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', flexShrink: 0,
    }}>
      <Icon name="chevron-left" size={20} />
    </button>
  ) : left;

  return (
    <div style={{
      flex: '0 0 auto', minHeight: 58, background: 'var(--color-surface)', borderBottom: '1px solid var(--gf-gray-100)',
      display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', position: 'relative', zIndex: 2,
    }}>
      {backBtn}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.1 }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}
