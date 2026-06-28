import { useEffect } from 'react';
import { Icon } from '../../Icon';

// F9.9 — bottom-sheet picker reutilizable, reemplaza los <select> nativos del
// kit (artefacto del SO, no de la app). Se monta sobre el contenedor del
// teléfono (position: fixed sobre el viewport, mismo patrón que FullModal).

export interface SheetOption {
  value: string | number;
  label: string;
}

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  options: SheetOption[];
  value: string | number;
  onPick: (value: string | number) => void;
}

export function Sheet({ open, onClose, title, options, value, onPick }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(17,24,39,.5)' }} />
      <div style={{
        position: 'relative', background: 'var(--color-surface)', borderRadius: '20px 20px 0 0',
        maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-card)',
      }}>
        <div style={{ width: 36, height: 4, background: 'var(--gf-gray-200)', borderRadius: 2, margin: '10px auto 4px', flexShrink: 0 }} />
        {title && (
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', padding: '8px 18px 4px', flexShrink: 0 }}>
            {title}
          </div>
        )}
        <div style={{ overflowY: 'auto', padding: '4px 8px 12px' }}>
          {options.map(opt => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                onClick={() => { onPick(opt.value); onClose(); }}
                style={{
                  width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  minHeight: 44, padding: '11px 14px', borderRadius: 12, border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font-base)', fontSize: 15, fontWeight: active ? 700 : 500, textAlign: 'left',
                  background: active ? 'var(--gf-emerald-50)' : 'transparent', color: 'var(--color-text)',
                }}
              >
                {opt.label}
                {active && <Icon name="check" size={18} color="var(--gf-emerald)" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
