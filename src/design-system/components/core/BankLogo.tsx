import { useState } from 'react';

interface BankLogoProps {
  id: string;
  nombre: string;
  color: string;
  dominio?: string;
  size?: number;
  radius?: number;
}

const BRANDFETCH_CLIENT_ID = import.meta.env.VITE_BRANDFETCH_CLIENT_ID as string | undefined;

type Stage = 'brandfetch' | 'local' | 'mono';

function stageInicial(dominio?: string): Stage {
  if (!dominio) return 'mono';
  return BRANDFETCH_CLIENT_ID ? 'brandfetch' : 'local';
}

// BankLogo — logo cuadrado de un medio de pago (banco/billetera). F9.20:
// con dominio, intenta Brandfetch CDN → archivo local /assets/medios/{id}.svg
// → monograma de color. Sin dominio (o sin Client ID) salta directo al
// fallback que corresponda — evita el ícono roto de un medio sin logo.
export function BankLogo({ id, nombre, color, dominio, size = 34, radius = 9 }: BankLogoProps) {
  const [stage, setStage] = useState<Stage>(() => stageInicial(dominio));

  if (stage === 'mono') {
    return (
      <span style={{
        width: size, height: size, borderRadius: radius, background: color, color: '#fff',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.38, fontWeight: 700, flexShrink: 0,
      }}>
        {nombre.charAt(0)}
      </span>
    );
  }

  const src = stage === 'brandfetch'
    ? `https://cdn.brandfetch.io/domain/${dominio}/w/120/h/120?c=${BRANDFETCH_CLIENT_ID}`
    : `/assets/medios/${id}.svg`;

  return (
    <img
      src={src}
      alt={nombre}
      onError={() => setStage(stage === 'brandfetch' ? 'local' : 'mono')}
      style={{
        width: size, height: size, borderRadius: radius, objectFit: 'contain',
        background: '#fff', border: '1px solid var(--gf-gray-150)', flexShrink: 0,
      }}
    />
  );
}
