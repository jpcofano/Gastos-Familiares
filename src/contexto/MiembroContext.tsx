import { createContext, useContext } from 'react';
import type { FamiliaMiembro } from '../types';

export interface MiembroCtx {
  memberId: string;
  miembro: FamiliaMiembro;
}

export const MiembroContext = createContext<MiembroCtx | null>(null);

export function useMiembroCtx(): MiembroCtx {
  const ctx = useContext(MiembroContext);
  if (!ctx) throw new Error('useMiembroCtx fuera de MiembroContext.Provider');
  return ctx;
}
