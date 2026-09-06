// F9.163 §2 — la identidad contable que decide si un ajuste del consolidado entra al cuadre.
//
// EL PROBLEMA. `ajustesConsolidado` guarda los créditos que el PDF muestra en el bloque del
// encabezado (CR.RG, CANJE PUNTOS, DEV PER). A veces el banco los usó para terminar de saldar el
// mes ANTERIOR —y entonces no tienen nada que hacer en el cuadre de éste— y a veces son una
// deducción del período ACTUAL, y entonces hacen falta. El mismo concepto, con el mismo nombre,
// se comporta al revés según el mes.
//
// LA REGLA, sobre el bloque consolidado:
//
//     A = saldoAnterior + pagosDelPeriodo
//     B = A + Σ(ajustes de origen 'pdf')
//
//     |A| ≤ tolerancia  → el pago saldó SOLO el mes anterior; el crédito es de este período → COMPUTA
//     |B| ≤ tolerancia  → el pago no alcanzaba y el crédito lo completó; ya está contado    → IGNORA
//     ninguna           → NO SE DECIDE: se computa como hoy y se marca para revisión
//
// POR QUÉ LA TERCERA RAMA. Ocho casos son pocos para confiar ciegamente en una identidad. Cuando
// ni A ni B dan cero, el modo de falla seguro es no decidir: se mantiene el comportamiento actual.
// Nada de desempatar por proximidad o por signo — inventar un desempate es cómo nació el bug que
// F9.162 refutó.
//
// F9.162 midió esto contra los 8 resúmenes con ajustes de PDF: la identidad acierta 8 de 8, y una
// de las dos ramas da CERO EXACTO en cada uno, nunca las dos.

import type { AjusteConsolidado } from '../types';

/**
 * Tolerancia en pesos. Elegida con los datos, no a ojo: sobre los 8 resúmenes con ajustes de PDF
 * la rama ganadora da 0,00 exacto y la perdedora nunca baja de 8.386,01 (el caso más apretado es
 * `b553ddf1`). Cualquier valor entre 0 y ~8.000 clasifica igual; 1 peso deja tres órdenes de
 * magnitud de margen contra el caso más cercano y no se traga ningún ambiguo.
 * Ver `scripts/auditF9163b.ts` para la distribución medida.
 */
export const TOLERANCIA_IDENTIDAD_ARS = 1;

export interface ConsolidadoResumen {
  saldoAnteriorARS?: number | null;
  pagosDelPeriodoARS?: number | null;
}

export type DecisionAjustes =
  | { decision: 'computa'; motivo: string; a: number; b: number }
  | { decision: 'ignora';  motivo: string; a: number; b: number }
  | { decision: 'sin_decidir'; motivo: string; a: number | null; b: number | null };

/**
 * Decide qué hacer con los ajustes `origen: 'pdf'` de un resumen.
 *
 * Los `origen: 'manual'` NO entran acá: son los de "cerrar diferencia" y F9.161 §4 ya decidió que
 * son evidencia, no dato. El caller los pasa igual al cuadre.
 */
export function decidirAjustesConsolidado(
  ajustes: AjusteConsolidado[],
  cons: ConsolidadoResumen | null | undefined,
  tolerancia: number = TOLERANCIA_IDENTIDAD_ARS,
): DecisionAjustes {
  const delPdf = (ajustes ?? []).filter(a => a.origen !== 'manual');
  if (delPdf.length === 0) {
    return { decision: 'computa', motivo: 'no hay ajustes de PDF', a: 0, b: 0 };
  }
  const saldo = cons?.saldoAnteriorARS;
  const pagos = cons?.pagosDelPeriodoARS;
  if (typeof saldo !== 'number' || typeof pagos !== 'number') {
    return {
      decision: 'sin_decidir',
      motivo: 'el resumen no trae saldoAnterior/pagosDelPeriodo (extraído antes de F9.163)',
      a: null, b: null,
    };
  }
  const a = saldo + pagos;
  const b = a + delPdf.reduce((acc, x) => acc + Number(x.montoARS ?? 0), 0);
  if (Math.abs(a) <= tolerancia) {
    return { decision: 'computa', motivo: 'A≈0: el pago saldó solo el mes anterior', a, b };
  }
  if (Math.abs(b) <= tolerancia) {
    return { decision: 'ignora', motivo: 'B≈0: el crédito completó el pago del mes anterior', a, b };
  }
  return {
    decision: 'sin_decidir',
    motivo: 'ni A ni B dan cero: la identidad no aplica a este resumen',
    a, b,
  };
}

/**
 * Los ajustes que efectivamente entran al cuadre.
 *
 * `sin_decidir` computa igual que hoy — abstenerse significa no cambiar nada, no descartar.
 */
export function ajustesComputables(
  ajustes: AjusteConsolidado[],
  cons: ConsolidadoResumen | null | undefined,
  tolerancia: number = TOLERANCIA_IDENTIDAD_ARS,
): { ajustes: AjusteConsolidado[]; decision: DecisionAjustes } {
  const decision = decidirAjustesConsolidado(ajustes, cons, tolerancia);
  if (decision.decision !== 'ignora') return { ajustes: ajustes ?? [], decision };
  // Se ignoran SOLO los de PDF; los manuales sobreviven.
  return { ajustes: (ajustes ?? []).filter(a => a.origen === 'manual'), decision };
}
