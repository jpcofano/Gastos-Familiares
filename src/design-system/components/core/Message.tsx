import type { HTMLAttributes, ReactNode } from 'react';

type Kind = 'ok' | 'err' | 'warn' | 'wait';

interface MessageProps extends HTMLAttributes<HTMLDivElement> {
  kind?: Kind;
  title?: ReactNode;
}

const KINDS: Record<Kind, { bg: string; line: string; text: string }> = {
  ok:   { bg: 'var(--gf-ok-bg)',   line: 'var(--gf-ok-line)',   text: 'var(--gf-ok-text)' },
  err:  { bg: 'var(--gf-err-bg)',  line: 'var(--gf-err-line)',  text: 'var(--gf-err-text)' },
  warn: { bg: 'var(--gf-warn-bg)', line: 'var(--gf-warn-line)', text: 'var(--gf-warn-text)' },
  wait: { bg: 'var(--gf-wait-bg)', line: 'var(--gf-wait-line)', text: 'var(--gf-wait-text)' },
};

// Message — el banner de estado de la legacy (ok/err/warn/wait).
export function Message({ kind = 'ok', title, children, style, ...rest }: MessageProps) {
  const k = KINDS[kind] ?? KINDS.ok;
  return (
    <div
      role={kind === 'err' ? 'alert' : 'status'}
      style={{
        fontFamily: 'var(--font-base)',
        fontSize: 'var(--text-sm)',
        lineHeight: 1.5,
        borderRadius: 10,
        padding: '12px 14px',
        background: k.bg,
        border: `1px solid ${k.line}`,
        color: k.text,
        ...style,
      }}
      {...rest}
    >
      {title && <strong style={{ fontWeight: 700 }}>{title} </strong>}
      {children}
    </div>
  );
}
