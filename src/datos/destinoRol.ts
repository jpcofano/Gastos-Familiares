// F9.176 — rol de un destino, lado cliente. Módulo sin dependencias (ni Firebase ni React) para que
// la regla del formulario se pueda verificar desde un script (scripts/verificarF9176.ts).
import type { RolDestino } from '../types';

// Roles de un destino, en el orden en que los ofrece el formulario.
export const ROLES_DESTINO: { valor: RolDestino; label: string; ayuda: string }[] = [
  { valor: 'comercio',   label: 'Comercio',      ayuda: 'La contraparte real: resuelve el ítem esperado.' },
  { valor: 'medio_pago', label: 'Medio de pago', ayuda: 'Un procesador (ej. Personal Pay): no resuelve ítem; indica el medio.' },
  { valor: 'pagador',    label: 'Pagador',       ayuda: 'Quien te paga un ingreso: no resuelve documentos salientes.' },
  { valor: 'propio',     label: 'Propio',        ayuda: 'CUIT/CBU de la familia: nunca es contraparte.' },
];

/** Gemelo de `rolSinClasificacion` en functions/src/matchLogica.ts. */
export function rolSinClasificacion(rol: RolDestino | '' | null | undefined): boolean {
  return rol === 'medio_pago' || rol === 'propio';
}

/** §3 — campos de clasificación del formulario, limpios si el rol no los admite. */
export interface ClasificacionForm { item: string; categoria: string; subcategoria: string; etiqueta: string }
export function clasificacionParaRol(rol: RolDestino | '', f: ClasificacionForm): ClasificacionForm {
  return rolSinClasificacion(rol) ? { item: '', categoria: '', subcategoria: '', etiqueta: '' } : f;
}
