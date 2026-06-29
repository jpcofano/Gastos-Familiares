import { useEffect, useState } from 'react';
import { suscribirResumenesTarjeta } from '../datos/resumenesTarjeta';
import type { CardStatement } from '../types';

// Realtime (mismo patrón que TarjetasViewer/ResumenesTarjeta, acá como hook
// compartido para Notificaciones).
export function useResumenesTarjeta() {
  const [resumenes, setResumenes] = useState<CardStatement[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const unsub = suscribirResumenesTarjeta(rs => { setResumenes(rs); setCargando(false); });
    return unsub;
  }, []);

  return { resumenes, cargando };
}
