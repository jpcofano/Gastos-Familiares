import type { CSSProperties, ReactNode } from 'react';

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function shift(mes: string, delta: number): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmt(mes: string): string {
  const [y, m] = mes.split('-');
  return `${MESES[parseInt(m, 10) - 1]} ${y}`;
}

interface MonthSelectorProps {
  value: string; // 'YYYY-MM'
  onChange?: (mes: string) => void;
  label?: ReactNode;
  style?: CSSProperties;
}

// MonthSelector — stepper ‹ Mes AAAA › usado arriba de Dashboard y Resumen.
export function MonthSelector({ value, onChange, label, style }: MonthSelectorProps) {
  const btn: CSSProperties = {
    background: 'transparent',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    width: '2rem',
    height: '2rem',
    fontSize: '1.25rem',
    lineHeight: 1,
    cursor: 'pointer',
    color: 'var(--color-brand)',
    fontFamily: 'var(--font-base)',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontFamily: 'var(--font-base)', ...style }}>
      <button type="button" aria-label="Mes anterior" style={btn} onClick={() => onChange?.(shift(value, -1))}>‹</button>
      <span style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', minWidth: 160, textAlign: 'center', color: 'var(--color-text)' }}>
        {label ?? fmt(value)}
      </span>
      <button type="button" aria-label="Mes siguiente" style={btn} onClick={() => onChange?.(shift(value, +1))}>›</button>
    </div>
  );
}
