import type { ReactNode } from 'react';

interface ScreenProps {
  children: ReactNode;
  pad?: boolean;
}

export function Screen({ children, pad = true }: ScreenProps) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--color-bg)', padding: pad ? '16px' : 0 }}>
      <div style={{ maxWidth: 'var(--app-max, 900px)', margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}
