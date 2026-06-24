import type { HTMLAttributes, ReactNode } from 'react';

export type EstadoChecklist =
  | 'pagado' | 'por_confirmar' | 'parcial' | 'automatico'
  | 'pendiente' | 'vencido' | 'programado' | 'no_registrado' | 'no_aplica';

interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  state?: EstadoChecklist;
  label?: ReactNode;
}

const STATES: Record<EstadoChecklist, { bg: string; tx: string; label: string }> = {
  pagado:        { bg: 'var(--st-pagado-badge-bg)',        tx: 'var(--st-pagado-badge-tx)',        label: 'Pagado' },
  por_confirmar: { bg: 'var(--st-por-confirmar-badge-bg)', tx: 'var(--st-por-confirmar-badge-tx)', label: 'Por confirmar' },
  parcial:       { bg: 'var(--st-parcial-badge-bg)',       tx: 'var(--st-parcial-badge-tx)',       label: 'Parcial' },
  automatico:    { bg: 'var(--st-automatico-badge-bg)',    tx: 'var(--st-automatico-badge-tx)',    label: 'Automático' },
  pendiente:     { bg: 'var(--st-pendiente-badge-bg)',     tx: 'var(--st-pendiente-badge-tx)',     label: 'Pendiente' },
  vencido:       { bg: 'var(--st-vencido-badge-bg)',       tx: 'var(--st-vencido-badge-tx)',       label: 'Vencido' },
  programado:    { bg: 'var(--st-programado-badge-bg)',    tx: 'var(--st-programado-badge-tx)',    label: 'Programado' },
  no_registrado: { bg: 'var(--st-no-registrado-badge-bg)', tx: 'var(--st-no-registrado-badge-tx)', label: 'No registrado' },
  no_aplica:     { bg: 'var(--gf-gray-100)',               tx: 'var(--gf-gray-400)',               label: 'No aplica' },
};

// StatusBadge — la pill de estado del checklist de pagos (Resumen).
// Los 9 estados calzan 1:1 con la state machine ya implementada en
// src/vistas/Resumen.tsx (EstadoItem).
export function StatusBadge({ state = 'pendiente', label, style, ...rest }: StatusBadgeProps) {
  const s = STATES[state] ?? STATES.pendiente;
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: 'var(--font-base)',
        fontSize: 'var(--text-2xs)',
        fontWeight: 'var(--weight-bold)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-label)',
        padding: '0.15em 0.45em',
        borderRadius: 'var(--radius-xs)',
        whiteSpace: 'nowrap',
        background: s.bg,
        color: s.tx,
        ...style,
      }}
      {...rest}
    >
      {label ?? s.label}
    </span>
  );
}
