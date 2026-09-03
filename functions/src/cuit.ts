// F9.155 §2 — Validación de CUIT por dígito verificador, y rescate del CUIT de la contraparte.
//
// Por qué: en las acreditaciones de haberes el CUIT del empleador aparece PELADO —sin la palabra
// "CUIT", sin guiones, en la línea siguiente al nombre— y el esquema viejo no tenía dónde ponerlo
// (`cuit` es el del emisor del documento, que ahí es el banco; `destinoCuit` es el payee, y en un
// cobro el empleador es quien paga). Medido en producción: el modelo igual lo veía, y lo archivaba
// en `numeroOperacion` — los 3 comprobantes de Accenture tienen numeroOperacion "33610006189", que
// es el CUIT, y los 4 de DATANET tienen "34999032089".
//
// El dígito verificador es lo que hace seguro rescatarlo sin depender de etiquetas.

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function soloDigitos(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

/** Módulo 11 sobre los primeros 10 dígitos; el resultado tiene que ser el dígito 11. */
export function esCuitValido(v: unknown): boolean {
  const d = soloDigitos(v);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;      // 00000000000, 11111111111, …
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += Number(d[i]) * PESOS[i];
  const resto = suma % 11;
  const dv = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
  return dv === Number(d[10]);
}

/**
 * Rescata el CUIT de la contraparte cuando el modelo no lo puso en `contraparteCuit`.
 *
 * DELIBERADAMENTE ACOTADO, y esto importa: un número de 11 dígitos cualquiera pasa el módulo 11 con
 * probabilidad ~1/11, así que barrer texto libre buscando "algo que valide" produce falsos positivos.
 * Medido sobre los 133 comprobantes de producción: de 25 `numeroCliente` poblados, 1 valida como
 * CUIT por casualidad (el "11115200536" de una boleta de AySA, cuyo CUIT real es 30709565075).
 *
 * Por eso el rescate:
 *   1. corre SOLO si `direccion === 'entrante'` — el único caso donde el esquema no tenía campo, y
 *      el que excluye al falso positivo de AySA, que es un pago saliente;
 *   2. mira SOLO campos que el propio modelo pobló como identificadores, no texto libre;
 *   3. descarta el CUIT del titular, que no es contraparte de nada.
 */
export function rescatarCuitContraparte(
  datos: Record<string, unknown>,
  cuitsPropios: string[] = [],
): string | null {
  if (datos.direccion !== 'entrante') return null;
  if (datos.contraparteCuit) return null;

  const propios = new Set(cuitsPropios.map(soloDigitos).filter(Boolean));
  // Orden de preferencia: primero los campos pensados para un CUIT, después los que el modelo usa
  // como cajón cuando no tiene dónde ponerlo.
  for (const campo of ['destinoCuit', 'cuit', 'numeroOperacion', 'numeroCliente'] as const) {
    const cand = soloDigitos(datos[campo]);
    if (!esCuitValido(cand)) continue;
    if (propios.has(cand)) continue;
    return cand;
  }
  return null;
}
