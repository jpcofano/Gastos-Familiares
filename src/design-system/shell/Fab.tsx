import { Icon } from '../Icon';

interface FabProps {
  onClick: () => void;
  label?: string;
}

export function Fab({ onClick, label = 'Nuevo movimiento' }: FabProps) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        position: 'fixed', right: 16, bottom: 80, zIndex: 5,
        width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: 'var(--color-accent)', color: '#fff', boxShadow: '0 8px 24px rgba(6,95,70,.45)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        transition: 'transform .1s',
      }}
    >
      <Icon name="plus" size={26} />
    </button>
  );
}
