import type { ReactNode } from 'react';
import { Icon } from '../Icon';

// Scaffold del modal full-screen de captura (hero ink + drawer + CTA bar).
// Estructura lista para F9.3 (Confirmar comprobante / Alta manual) — sin
// cablear datos reales todavía.

export function FullModal({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'var(--gf-ink)', display: 'flex', flexDirection: 'column' }}>
      {children}
    </div>
  );
}

export function ModalBar({ title, onClose }: { title: ReactNode; onClose: () => void }) {
  return (
    <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px 6px', color: '#fff' }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af' }}>{title}</span>
      <button onClick={onClose} aria-label="Cerrar" style={{ background: 'rgba(255,255,255,.1)', border: 'none', color: '#fff', borderRadius: 999, width: 30, height: 30, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

interface HeroProps {
  eyebrow?: ReactNode;
  amount: ReactNode;
  desc?: ReactNode;
  tags?: ReactNode[];
}

export function Hero({ eyebrow, amount, desc, tags = [] }: HeroProps) {
  return (
    <div style={{
      flex: '0 0 auto', padding: '8px 24px 30px', color: '#fff',
      background: 'linear-gradient(180deg, var(--gf-ink) 0%, var(--gf-ink-soft) 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
    }}>
      {eyebrow && <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--gf-emerald-100)', marginBottom: 12 }}>{eyebrow}</div>}
      <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1, marginBottom: 8, fontVariantNumeric: 'tabular-nums' }}>{amount}</div>
      {desc && <div style={{ fontSize: 16, color: '#9ca3af', marginBottom: 14 }}>{desc}</div>}
      {tags.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {tags.map((t, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 'var(--radius-sm)', padding: '5px 12px', fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,.1)', color: '#e5e7eb' }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Drawer({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: 'var(--color-surface)', borderRadius: '24px 24px 0 0', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ width: 36, height: 4, background: 'var(--gf-gray-200)', borderRadius: 2, margin: '12px auto 0', flexShrink: 0 }} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px 0' }}>{children}</div>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '18px 0 4px' }}>{children}</div>;
}

export function CtaBar({ children }: { children: ReactNode }) {
  return (
    <div style={{ flexShrink: 0, background: 'var(--color-surface)', padding: '12px 24px 16px', borderTop: '1px solid var(--color-border-card)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {children}
    </div>
  );
}
