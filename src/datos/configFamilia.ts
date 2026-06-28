import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import type { MedioPago } from '../types';

// F9.36 — config/familia tiene write:false en Rules (ver docs/CLAUDE.md →
// Decisiones cerradas): toda escritura pasa por estas callables admin-only
// (Admin SDK), nunca un setDoc/updateDoc directo del cliente.

type Resultado<T> = { ok: true; data: T } | { ok: false; error: Error };

export async function actualizarMediosPago(medios: MedioPago[]): Promise<Resultado<void>> {
  try {
    const fn = httpsCallable(functions, 'actualizarMediosPago');
    await fn({ medios });
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// F9.39 — respaldo manual de /tcDiario (complementa el cron F9.30 de
// actualizarTCDiario). Mismo doc/shape, origen:'manual' distingue la fuente.
export async function actualizarTCManual(fecha: string, tcUsdArs: number): Promise<Resultado<void>> {
  try {
    const fn = httpsCallable(functions, 'actualizarTCManual');
    await fn({ fecha, tcUsdArs });
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export async function actualizarMiPerfil(nombre: string): Promise<Resultado<void>> {
  try {
    const fn = httpsCallable(functions, 'actualizarMiPerfil');
    await fn({ nombre });
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// F9.37 — CRUD de Miembros. Una sola callable (guardarMiembro) por la
// atomicidad miembros[]+/autorizados (ver docs/CLAUDE.md) — el cliente solo
// elige la acción.
export async function crearMiembro(nombre: string, emails: string[], rol: 'admin' | 'dependiente'): Promise<Resultado<{ memberId: string }>> {
  try {
    const fn = httpsCallable(functions, 'guardarMiembro');
    const res = await fn({ accion: 'crear', nombre, emails, rol });
    return { ok: true, data: res.data as { memberId: string } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export async function editarMiembro(memberId: string, nombre: string, emails: string[], rol: 'admin' | 'dependiente'): Promise<Resultado<void>> {
  try {
    const fn = httpsCallable(functions, 'guardarMiembro');
    await fn({ accion: 'editar', memberId, nombre, emails, rol });
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export async function desactivarMiembro(memberId: string): Promise<Resultado<void>> {
  try {
    const fn = httpsCallable(functions, 'guardarMiembro');
    await fn({ accion: 'desactivar', memberId });
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export async function reactivarMiembro(memberId: string): Promise<Resultado<void>> {
  try {
    const fn = httpsCallable(functions, 'guardarMiembro');
    await fn({ accion: 'reactivar', memberId });
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

// F9.38 — CRUD de Categorías/Subcategorías/Etiquetas. Una sola callable
// (guardarTaxonomia) por nivel+acción, igual patrón que guardarMiembro — el
// cliente solo elige qué hacer, el cascade de renombrado (movimientos +
// diccionario) vive server-side.
async function llamarTaxonomia(payload: Record<string, unknown>): Promise<Resultado<{ id?: string }>> {
  try {
    const fn = httpsCallable(functions, 'guardarTaxonomia');
    const res = await fn(payload);
    return { ok: true, data: res.data as { id?: string } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export const crearCategoria      = (nombre: string)               => llamarTaxonomia({ nivel: 'categoria', accion: 'crear', nombre });
export const editarCategoria     = (id: string, nombre: string)   => llamarTaxonomia({ nivel: 'categoria', accion: 'editar', id, nombre });
export const desactivarCategoria = (id: string)                   => llamarTaxonomia({ nivel: 'categoria', accion: 'desactivar', id });
export const reactivarCategoria  = (id: string)                   => llamarTaxonomia({ nivel: 'categoria', accion: 'reactivar', id });
export const eliminarCategoria   = (id: string)                   => llamarTaxonomia({ nivel: 'categoria', accion: 'eliminar', id });

export const crearSubcategoria      = (categoriaPadre: string, valor: string) => llamarTaxonomia({ nivel: 'subcategoria', accion: 'crear', categoriaPadre, valor });
export const editarSubcategoria     = (id: string, valor: string)             => llamarTaxonomia({ nivel: 'subcategoria', accion: 'editar', id, valor });
export const desactivarSubcategoria = (id: string)                            => llamarTaxonomia({ nivel: 'subcategoria', accion: 'desactivar', id });
export const reactivarSubcategoria  = (id: string)                            => llamarTaxonomia({ nivel: 'subcategoria', accion: 'reactivar', id });
export const eliminarSubcategoria   = (id: string)                            => llamarTaxonomia({ nivel: 'subcategoria', accion: 'eliminar', id });

export const crearEtiqueta      = (valor: string)             => llamarTaxonomia({ nivel: 'etiqueta', accion: 'crear', valor });
export const editarEtiqueta     = (id: string, valor: string) => llamarTaxonomia({ nivel: 'etiqueta', accion: 'editar', id, valor });
export const desactivarEtiqueta = (id: string)                => llamarTaxonomia({ nivel: 'etiqueta', accion: 'desactivar', id });
export const reactivarEtiqueta  = (id: string)                => llamarTaxonomia({ nivel: 'etiqueta', accion: 'reactivar', id });
export const eliminarEtiqueta   = (id: string)                => llamarTaxonomia({ nivel: 'etiqueta', accion: 'eliminar', id });
