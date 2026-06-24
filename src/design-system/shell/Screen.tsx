import type { ReactNode } from 'react';

interface ScreenProps {
  children: ReactNode;
  pad?: boolean;
}

export function Screen({ children, pad = true }: ScreenProps) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--color-bg)', padding: pad ? '16px' : 0 }}>
      {children}
    </div>
  );
}
