import { useEffect, useState } from 'react';
import { cargarFamiliaConfig } from '../familia';
import type { FamiliaConfig } from '../types';

// One-shot (config/familia es quasi-estática, ver docs/CLAUDE.md → Reglas
// operativas). Reusa el mismo patrón que ya usaban TarjetasViewer/
// ResumenesTarjeta a mano — acá queda como hook compartido.
export function useFamiliaConfig() {
  const [config, setConfig] = useState<FamiliaConfig | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    cargarFamiliaConfig().then(cfg => { setConfig(cfg); setCargando(false); });
  }, []);

  return { config, cargando };
}
