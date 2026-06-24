import { useEffect, useState } from 'react';
import { suscribirResumenesTarjeta } from '../datos/resumenesTarjeta';
import { cargarFamiliaConfig } from '../familia';
import type { CardStatement, FamiliaConfig } from '../types';
import { TarjetaFace } from './TarjetaFace';
import './TarjetasViewer.css';

// F9.7 — /tarjetas: visor de SOLO LECTURA de resúmenes ya cargados. Separado
// del flujo de subida/revisión/confirmación, que sigue viviendo en Cargar
// (SeccionTarjetas, sin cambios — F6.7 addendum 1 no se reabre). Mismos datos
// reales (suscribirResumenesTarjeta), misma cara de tarjeta (TarjetaFace,
// compartida con SeccionTarjetas), sin acciones (sin descartar/asignar/revisar).

export default function TarjetasViewer() {
  const [config, setConfig] = useState<FamiliaConfig | null>(null);
  const [resumenes, setResumenes] = useState<CardStatement[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    cargarFamiliaConfig().then(cfg => { setConfig(cfg); setCargando(false); });
  }, []);

  useEffect(() => suscribirResumenesTarjeta(setResumenes), []);

  return (
    <div className="tv">
      <h1 className="tv-titulo">Tarjetas</h1>
      <p className="tv-sub">Resúmenes cargados — solo lectura. Para subir o revisar, usá Carga.</p>
      {cargando ? (
        <p className="tv-estado">Cargando…</p>
      ) : resumenes.length === 0 ? (
        <p className="tv-estado">No hay resúmenes cargados.</p>
      ) : (
        <div className="tv-lista">
          {resumenes.map(r => (
            <TarjetaFace key={r.id} resumen={r} config={config} />
          ))}
        </div>
      )}
    </div>
  );
}
