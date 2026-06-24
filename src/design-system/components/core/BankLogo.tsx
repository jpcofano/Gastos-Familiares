import { useState } from 'react';

interface BankLogoProps {
  id: string;
  nombre: string;
  color: string;
  size?: number;
  radius?: number;
}

// BankLogo — logo cuadrado de un medio de pago (banco/billetera/efectivo).
// Intenta /assets/medios/{id}.svg; si no existe (404 → onError) cae a un
// chip de color con la inicial del nombre. F9.5 — no dibujar logos de marca
// a mano; los SVG oficiales se suben después a public/assets/medios/.
export function BankLogo({ id, nombre, color, size = 34, radius = 9 }: BankLogoProps) {
  const [error, setError] = useState(false);

  if (error) {
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

  return (
    <img
      src={`/assets/medios/${id}.svg`}
      alt={nombre}
      onError={() => setError(true)}
      style={{
        width: size, height: size, borderRadius: radius, objectFit: 'contain',
        background: '#fff', border: '1px solid var(--gf-gray-150)', flexShrink: 0,
      }}
    />
  );
}
