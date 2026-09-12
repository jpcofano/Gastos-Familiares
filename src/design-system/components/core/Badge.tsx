import type { HTMLAttributes } from 'react';

type Tone = 'neutral' | 'info' | 'sky' | 'success' | 'successDeep' | 'warning' | 'danger';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

// F9.170 §3 — los tonos pasan a tokens --st-*. Antes cuatro de los seis tenían el
// fondo hardcodeado en claro (#e0f2fe, #dcfce7, #fef3c7, #ffe4e6) con el texto en
// un token que SÍ se remapea: en oscuro `danger` quedaba #fca5a5 sobre #ffe4e6 y
// `info` #1d4ed8 sobre #15294a. Ilegibles los dos. (F9.169 tokenizó las pills de
// TarjetaFace.css, no estas.)
//
// La jerarquía es el borde, no la saturación: los tonos "cerrados" van a fondo
// pastel sin contorno y `warning` es el único que lleva uno. En una lista larga,
// un solo tono con borde alcanza para que el ojo lo encuentre. El `transparent`
// de los demás no es decorativo: mantiene a las siete pills de la misma altura.
const TONES: Record<Tone, { background: string; color: string; border: string }> = {
  // --gf-gray-500 sobre --gf-gray-100 daba 4,39:1 en claro: no llega al piso de 4,5:1 (el texto
  // es 11px bold, no cuenta como "large"). Con --gf-gray-700 da 9,4:1 y en oscuro 8,0:1. Importa
  // más desde el §2: `vinculado` es neutral, así que este tono está en toda tarjeta resuelta.
  neutral:     { background: 'var(--gf-gray-100)',               color: 'var(--gf-gray-700)',               border: '1px solid transparent' },
  info:        { background: 'var(--st-automatico-badge-bg)',    color: 'var(--st-automatico-badge-tx)',    border: '1px solid transparent' },
  sky:         { background: 'var(--st-por-confirmar-badge-bg)', color: 'var(--st-por-confirmar-badge-tx)', border: '1px solid transparent' },
  success:     { background: 'var(--st-pagado-badge-bg)',        color: 'var(--st-pagado-badge-tx)',        border: '1px solid transparent' },
  successDeep: { background: 'var(--tone-success-deep-bg)',      color: 'var(--tone-success-deep-tx)',      border: '1px solid transparent' },
  warning:     { background: 'var(--st-parcial-badge-bg)',       color: 'var(--st-parcial-badge-tx)',       border: '1px solid var(--st-parcial-line)' },
  danger:      { background: 'var(--st-no-registrado-badge-bg)', color: 'var(--st-no-registrado-badge-tx)', border: '1px solid transparent' },
};

// Badge — pill/tag uppercase chico. Tone-based para etiquetas genéricas
// (p.ej. "pago tarjeta"). Para los estados del checklist de esperados usar
// <StatusBadge> en vez de esto.
export function Badge({ tone = 'neutral', children, style, ...rest }: BadgeProps) {
  const t = TONES[tone] ?? TONES.neutral;
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
        lineHeight: 1.4,
        ...t,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
