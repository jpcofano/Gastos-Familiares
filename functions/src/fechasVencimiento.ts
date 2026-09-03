// F9.154 §1.b — Guard determinístico del año de los vencimientos.
//
// Por qué existe: el prompt le pedía al modelo resolver el año ausente de `vencimientos[].fecha` con
// el mismo criterio que la emisión ("la ocurrencia más reciente que NO sea futura"). Para un
// vencimiento eso es al revés de la realidad: vencer en el futuro es lo normal. Con hoy = 2026-09-03,
// "Vence el 08/09" cumpliendo la regla da 2025-09-08, y `mesDePago()` archivó $283.024,45 de Edenor
// en septiembre de 2025 (F9.154-pre). Metrogas, el mismo día y con la misma pantalla, desobedeció la
// regla y acertó: 5 de 6 aciertan desobedeciendo, 1 falla obedeciendo.
//
// El prompt ya quedó corregido (§1.a), pero un prompt es una sugerencia. Esto es el piso
// determinístico: sin modelo, sin ambigüedad, y deja rastro en el log de lo que reescribe.

export type Vencimiento = { fecha?: string | null; monto?: number | null };

export type CorreccionVencimiento = {
  indice: number;
  antes: string;
  despues: string;
  diasAntes: number;
  diasDespues: number;
};

// Umbral en días. Elegido contra la distribución real de producción (132 comprobantes, 26
// vencimientos con fecha): el más lejano hacia adelante está a 19 días de la subida y el más lejano
// hacia atrás a 1 día. Cero casos por encima de 90 días. 183 deja ~10x de margen sobre el máximo
// observado, así que un plan de pagos o una cuota semestral legítima no lo dispara.
export const UMBRAL_DIAS_VENCIMIENTO = 183;

const DIA_MS = 24 * 60 * 60 * 1000;

// Mediodía UTC para que ningún corrimiento de zona horaria mueva el día.
function aDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [, y, mes, dia] = m;
  const d = new Date(Date.UTC(Number(y), Number(mes) - 1, Number(dia), 12, 0, 0));
  // Rechaza fechas imposibles que el constructor normaliza (ej. 2026-02-30 → 2026-03-02).
  if (d.getUTCMonth() !== Number(mes) - 1 || d.getUTCDate() !== Number(dia)) return null;
  return d;
}

function iso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function distanciaDias(fechaIso: string, referencia: Date): number | null {
  const d = aDate(fechaIso);
  if (!d) return null;
  return Math.round((d.getTime() - referencia.getTime()) / DIA_MS);
}

/**
 * Reescribe el año de `fechaIso` al que deje ese día/mes MÁS CERCA de `referencia` en valor
 * absoluto, mirando el año anterior, el mismo y el siguiente. Devuelve la fecha original si no
 * encuentra nada mejor (o si es un 29/02 que no existe en el año candidato).
 */
export function anioMasCercano(fechaIso: string, referencia: Date): string {
  const original = aDate(fechaIso);
  if (!original) return fechaIso;
  const mes = original.getUTCMonth();
  const dia = original.getUTCDate();

  let mejor = original;
  let mejorDist = Math.abs(original.getTime() - referencia.getTime());

  for (const anio of [referencia.getUTCFullYear() - 1, referencia.getUTCFullYear(), referencia.getUTCFullYear() + 1]) {
    const cand = new Date(Date.UTC(anio, mes, dia, 12, 0, 0));
    // 29 de febrero en año no bisiesto: el constructor lo corre al 1 de marzo. Se descarta.
    if (cand.getUTCMonth() !== mes || cand.getUTCDate() !== dia) continue;
    const dist = Math.abs(cand.getTime() - referencia.getTime());
    if (dist < mejorDist) { mejor = cand; mejorDist = dist; }
  }
  return iso(mejor);
}

/**
 * Corrige, si hace falta, el año de cada vencimiento. `referencia` es la fecha en que se subió el
 * comprobante: es el único anclaje temporal confiable que tenemos (el documento puede no traer
 * emisión — 6 de 132 comprobantes tienen `fecha: null`).
 *
 * Solo toca las fechas que quedan a más de `umbralDias` de la referencia. Lo que está cerca no se
 * discute, aunque el año no sea el que uno elegiría: no es tarea de este guard adivinar.
 */
export function corregirAnioVencimientos(
  vencimientos: Vencimiento[],
  referencia: Date,
  umbralDias: number = UMBRAL_DIAS_VENCIMIENTO,
): { vencimientos: Vencimiento[]; correcciones: CorreccionVencimiento[] } {
  const correcciones: CorreccionVencimiento[] = [];
  const salida = vencimientos.map((v, indice) => {
    if (!v || typeof v.fecha !== 'string') return v;
    const diasAntes = distanciaDias(v.fecha, referencia);
    if (diasAntes === null || Math.abs(diasAntes) <= umbralDias) return v;

    const despues = anioMasCercano(v.fecha, referencia);
    if (despues === v.fecha) return v;

    const diasDespues = distanciaDias(despues, referencia) ?? 0;
    // Solo reescribe si de verdad acerca: nunca empeora una fecha.
    if (Math.abs(diasDespues) >= Math.abs(diasAntes)) return v;

    correcciones.push({ indice, antes: v.fecha, despues, diasAntes, diasDespues });
    return { ...v, fecha: despues };
  });
  return { vencimientos: salida, correcciones };
}
