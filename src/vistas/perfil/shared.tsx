import type { ReactNode } from 'react';

// Helpers compartidos entre las sub-pantallas de Perfil (Miembros, Categorías,
// Medios de pago) — portados de PerfilScreens.jsx.

export function Avatar({ nombre, color, size = 42 }: { nombre: string; color: string; size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', background: color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 700, flexShrink: 0 }}>
      {nombre.charAt(0)}
    </span>
  );
}

export function AddBtn({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: '14px', borderRadius: 'var(--radius-card)', border: '1.5px dashed var(--gf-gray-300)',
      background: 'transparent', color: 'var(--color-accent)', fontFamily: 'var(--font-base)',
      fontSize: 14, fontWeight: 600, cursor: 'pointer',
    }}>
      {children}
    </button>
  );
}
