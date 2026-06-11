import { getDoc, doc, type DocumentData } from 'firebase/firestore';
import { db } from './firebase';
import type { FamiliaConfig, FamiliaMiembro } from './types';

// Primera conversión Timestamp→Date del proyecto. El patrón se repite en F4.
export function docAFamiliaConfig(data: DocumentData): FamiliaConfig {
  return {
    miembros:      data.miembros as Record<string, FamiliaMiembro>,
    categorias:    data.categorias as string[],
    bancos:        data.bancos as string[],
    tarjetas:      data.tarjetas,
    actualizadoEn: data.actualizadoEn?.toDate() ?? new Date(0),
  };
}

export async function cargarFamiliaConfig(): Promise<FamiliaConfig | null> {
  const snap = await getDoc(doc(db, 'config', 'familia'));
  if (!snap.exists()) return null;
  return docAFamiliaConfig(snap.data());
}

export function resolverMiembro(
  email: string,
  config: FamiliaConfig,
): { memberId: string; miembro: FamiliaMiembro } | null {
  const emailNorm = email.trim().toLowerCase();

  const matches = Object.entries(config.miembros).filter(([, m]) =>
    m.emails.some(e => e.trim().toLowerCase() === emailNorm),
  );

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    console.warn('[resolverMiembro] Email matchea más de un miembro:', email, '→ tomando el primero');
  }

  const [memberId, miembro] = matches[0];
  if (!miembro.activo) return null;
  return { memberId, miembro };
}
