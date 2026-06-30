import { Icon } from '../Icon';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';

export function InstallBanner() {
  const { mostrarBanner, instalar, descartar } = useInstallPrompt();

  if (!mostrarBanner) return null;

  return (
    <div
      style={{
        position: 'fixed', left: 12, right: 12, bottom: 76, zIndex: 6,
        background: 'var(--gf-ink)', color: '#fff',
        borderRadius: 16, padding: '12px 14px',
        display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 8px 24px rgba(0,0,0,.35)',
        fontFamily: 'var(--font-base)',
      }}
    >
      <div
        style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: 'var(--gf-emerald)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icon name="download" size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Instalá la app</p>
        <p style={{ margin: 0, fontSize: 12, opacity: .75 }}>
          Accedé más rápido y compartí comprobantes directo desde el celu.
        </p>
      </div>
      <button
        onClick={instalar}
        style={{
          background: 'var(--gf-emerald)', color: '#fff', border: 'none',
          borderRadius: 999, padding: '8px 14px', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', flexShrink: 0, fontFamily: 'var(--font-base)',
        }}
      >
        Instalar
      </button>
      <button
        onClick={descartar}
        aria-label="Cerrar"
        style={{
          background: 'transparent', border: 'none', color: '#fff',
          opacity: .6, cursor: 'pointer', flexShrink: 0, padding: 4,
        }}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
