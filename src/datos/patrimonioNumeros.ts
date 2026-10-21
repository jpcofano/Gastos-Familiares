// F9.196 H6 — lectura de números escritos a mano en la ficha (editor de tesis). PURO.

/**
 * Lee un número como lo escribe alguien en Argentina: "45000", "45000,5", "1.234,56" o "2.5". Un
 * "45.000" (punto y tres cifras, sin coma) es ambiguo —¿45 mil o 45?— y se rechaza en vez de adivinar.
 */
export function leerNumero(s: string): { valor: number | null } | { error: string } {
  const x = s.trim().replace(/\s/g, '');
  if (x === '') return { valor: null };
  let norm: string;
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(x)) norm = x.replace(/\./g, '').replace(',', '.');      // 1.234,56
  else if (/^-?\d+,\d+$/.test(x)) norm = x.replace(',', '.');                                    // 45,5
  else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(x)) return { error: `«${s}» es ambiguo: escribilo sin punto de miles (45000) o con coma decimal (45,5)` };
  else if (/^-?\d+(\.\d+)?$/.test(x)) norm = x;                                                    // 45000 · 2.5 · 0.125
  else return { error: `«${s}» no es un número` };
  return { valor: Number(norm) };
}
