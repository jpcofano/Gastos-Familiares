// F9.161 §2 — el guard determinístico del signo.
//
// Regla: un renglón con `montoFirmado > 0` que aparece en un bloque de CONSUMOS no puede tener
// `tipoLinea` de la familia de ingresos. Si el modelo lo clasifica así, se corrige a "consumo".
//
// Por qué existe: en F9.160 el prompt mandaba `CAJA SEG-PROMO` (+168.542,00, sección "Consumos
// Maria Lascano") como `reintegro_percepcion`, así que el subtotal de esa sección quedaba corto
// por el DOBLE del monto y el dueño lo tapaba con "cerrar diferencia". El prompt ya se corrigió;
// esto garantiza el resultado cuando el prompt igual se equivoque. Mismo reparto de
// responsabilidades que `fechasVencimiento.ts` en F9.154 §1.b.
//
// Módulo puro, sin imports del SDK (mismo criterio que `matchLogica.ts` y `cafciHtml.ts`), para
// que el self-test corra con `npx tsx` sin arrastrar `admin.initializeApp()`.

/** Los tres `tipoLinea` que `tipoDeLinea()` (src/datos/resumenesTarjeta.ts) suma como Ingreso. */
export const TIPOS_INGRESO = ['reintegro_percepcion', 'bonificacion', 'reverso'] as const;

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * ¿La sección es un bloque de consumos?
 *
 * Los bloques donde un crédito ES legítimo —"Sus pagos y ajustes realizados", el CONSOLIDADO de
 * Galicia, los impuestos— se excluyen explícitamente ANTES de mirar la palabra "consumo", porque
 * el consolidado de Galicia a veces se titula "CONSOLIDADO DE CONSUMOS" y ahí un reintegro del
 * período anterior es correcto. La lista de exclusión gana siempre.
 */
export function esSeccionDeConsumos(seccion: string | null | undefined): boolean {
  if (!seccion) return false;              // sin sección no hay regla: el guard no actúa
  const s = norm(seccion);
  if (s.includes('consolidado'))            return false;
  if (s.includes('pagos y ajustes'))        return false;
  if (s.includes('impuesto'))               return false;
  if (s.includes('interes'))                return false;
  return s.includes('consumo');
}

export interface LineaConSigno {
  descripcionRaw?: string;
  tipoLinea?: string;
  monto?: number;
  montoFirmado?: number | null;
  seccion?: string | null;
  esBonificacion?: boolean;
  esReverso?: boolean;
}

export interface CorreccionSigno {
  seq: number;
  descripcionRaw: string;
  seccion: string;
  montoFirmado: number;
  tipoLineaAntes: string;
}

/**
 * Corrige a "consumo" las líneas de la familia de ingresos que llevan importe POSITIVO dentro de
 * una sección de consumos. Devuelve copias; no muta la entrada.
 *
 * NO actúa cuando:
 *  - `montoFirmado` es null/ausente (línea vieja, o el modelo no lo emitió) — sin el dato no hay
 *    regla, y adivinar por la descripción es exactamente lo que este guard vino a reemplazar;
 *  - `montoFirmado <= 0` — es un crédito legítimo (el caso `COTO DIGITAL SUC 056 CRED`, −8.870,44);
 *  - la sección no es de consumos o es null.
 *
 * `esBonificacion`/`esReverso` se bajan junto con `tipoLinea`: son el espejo booleano del mismo
 * dato, y dejarlos prendidos sobre un "consumo" deja la línea contradiciéndose a sí misma.
 */
export function corregirSignoConsumos<T extends LineaConSigno>(
  lineas: T[],
): { lineas: T[]; correcciones: CorreccionSigno[] } {
  const correcciones: CorreccionSigno[] = [];
  const out = lineas.map((l, i) => {
    const firmado = l.montoFirmado;
    if (typeof firmado !== 'number' || firmado <= 0) return l;
    if (!esSeccionDeConsumos(l.seccion)) return l;
    if (!(TIPOS_INGRESO as readonly string[]).includes(l.tipoLinea ?? '')) return l;
    correcciones.push({
      seq: i + 1,
      descripcionRaw: l.descripcionRaw ?? '',
      seccion: l.seccion as string,
      montoFirmado: firmado,
      tipoLineaAntes: l.tipoLinea as string,
    });
    return { ...l, tipoLinea: 'consumo', esBonificacion: false, esReverso: false };
  });
  return { lineas: out, correcciones };
}
