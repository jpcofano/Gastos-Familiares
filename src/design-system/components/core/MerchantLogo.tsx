import { useState, useEffect } from 'react';
import { logoDeComercio } from '../../../datos/comerciosLogos';

export function MerchantLogo({ nombre, size = 30, radius = 8 }: { nombre: string; size?: number; radius?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [fail, setFail] = useState(false);

  useEffect(() => {
    let ok = true;
    setFail(false);
    setUrl(null);
    logoDeComercio(nombre).then(u => { if (ok) setUrl(u); });
    return () => { ok = false; };
  }, [nombre]);

  if (!url || fail) {
    return (
      <span style={{
        width: size, height: size, borderRadius: radius,
        background: 'var(--gf-gray-100)', color: 'var(--gf-gray-500)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, fontSize: Math.round(size * 0.4), fontWeight: 700,
      }}>
        {(nombre || '?').trim().charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={nombre}
      onError={() => setFail(true)}
      style={{ width: size, height: size, borderRadius: radius, objectFit: 'contain', background: '#fff', border: '1px solid var(--gf-gray-150)', flexShrink: 0 }}
    />
  );
}
