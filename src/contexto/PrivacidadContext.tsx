import { createContext, useContext, useState, type ReactNode } from 'react';

// F9.120 — Modo privacidad: tapa los valores absolutos y muestra sólo porcentajes, para poder
// mostrarle la pantalla a alguien sin exponer los montos.
//
// NO persiste, y arranca apagado siempre (decisión del dueño). Para un modo pensado para
// mostrar la pantalla, que quede prendido sin que te des cuenta es peor que tener que
// prenderlo cada vez. Por eso vive en memoria y no en localStorage.
//
// El estado es compartido entre vistas a propósito: si lo prendés en Resumen y navegás a
// Dashboard, seguís tapado. Un toggle por pantalla haría que navegar destape los números.
interface PrivacidadCtx {
  privado: boolean;
  alternar: () => void;
}

const Ctx = createContext<PrivacidadCtx>({ privado: false, alternar: () => {} });

export function PrivacidadProvider({ children }: { children: ReactNode }) {
  const [privado, setPrivado] = useState(false);
  return (
    <Ctx.Provider value={{ privado, alternar: () => setPrivado(v => !v) }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePrivacidad(): PrivacidadCtx {
  return useContext(Ctx);
}

// Un porcentaje sin base declarada no significa nada: cada pantalla define la suya y la
// muestra en el encabezado (ver BasePrivacidad). `base` es el denominador ya resuelto.
export function fmtPct(valor: number, base: number): string {
  if (!base) return '—';
  const p = (valor / base) * 100;
  // Un decimal abajo del 10% — la diferencia entre 3% y 3,4% importa cuando es lo único que se ve.
  const txt = Math.abs(p) < 10 ? p.toFixed(1).replace('.', ',') : String(Math.round(p));
  return `${txt}%`;
}

// Etiqueta de la base, para el encabezado de cada pantalla.
export function BasePrivacidad({ texto }: { texto: string }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', textAlign: 'center', lineHeight: 1.4 }}>
      Modo privacidad · los valores son {texto}
    </div>
  );
}
