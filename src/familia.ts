import { getDoc, doc, type DocumentData } from 'firebase/firestore';
import { db } from './firebase';
import type { CategoriaItem, FamiliaConfig, FamiliaMiembro, MedioPago } from './types';

// Primera conversión Timestamp→Date del proyecto. El patrón se repite en F4.
export function docAFamiliaConfig(data: DocumentData): FamiliaConfig {
  return {
    miembros:      data.miembros as Record<string, FamiliaMiembro>,
    categorias:    data.categorias as CategoriaItem[],   // F9.38 — string[] → CategoriaItem[]
    bancos:        data.bancos as MedioPago[],   // F9.36 — string[] → MedioPago[]
    tarjetas:      data.tarjetas,
    calendarEmail: data.calendarEmail ?? null,
    calendarSync:  data.calendarSync === true,
    actualizadoEn: data.actualizadoEn?.toDate() ?? new Date(0),
  };
}

export async function cargarFamiliaConfig(): Promise<FamiliaConfig | null> {
  const snap = await getDoc(doc(db, 'config', 'familia'));
  if (!snap.exists()) return null;
  return docAFamiliaConfig(snap.data());
}

function normNombre(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Resuelve un nombre crudo (ej: titular en PDF) a memberId vía alias[].
// Paso 1: igualdad exacta. Paso 2: inclusión como fallback tolerante.
// El nombre canónico (miembro.nombre) cuenta como alias implícito.
export function resolverNombreMiembro(
  nombreCrudo: string,
  config: FamiliaConfig,
): string | null {
  if (!nombreCrudo) return null;
  const input = normNombre(nombreCrudo);
  if (!input) return null;

  for (const [memberId, miembro] of Object.entries(config.miembros)) {
    if (!miembro.activo) continue;
    const aliases = [...(miembro.alias ?? []), normNombre(miembro.nombre)];
    if (aliases.some(a => a === input)) return memberId;
  }

  for (const [memberId, miembro] of Object.entries(config.miembros)) {
    if (!miembro.activo) continue;
    const aliases = [...(miembro.alias ?? []), normNombre(miembro.nombre)];
    if (aliases.some(a => input.includes(a) || a.includes(input))) return memberId;
  }

  return null;
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
