import { useState, useEffect } from 'react';

export type ThemeMode = 'light' | 'dark';

const KEY = 'gf-theme';

function getStoredTheme(): ThemeMode | null {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : null;
}

// Estado módulo-singleton (no Context): el toggle del AppBar (siempre montado,
// F9.20) y el de Perfil › Apariencia leen/escriben el mismo estado sin
// necesitar un Provider — alcanza con que ambos llamen a useTheme().
let current: ThemeMode = getStoredTheme() ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const listeners = new Set<() => void>();

export function applyInitialTheme(): void {
  document.documentElement.setAttribute('data-theme', current);
}

export function setTheme(theme: ThemeMode): void {
  current = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(KEY, theme);
  listeners.forEach(fn => fn());
}

export function useTheme() {
  const [theme, setLocal] = useState(current);
  useEffect(() => {
    const fn = () => setLocal(current);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return { theme, setTheme };
}
