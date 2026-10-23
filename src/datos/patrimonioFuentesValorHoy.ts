// F9.196 nota de revisión 4 — los avisos del "Valor de hoy". El hero muestra solo "⚠ N avisos" y la
// sección "Fuentes del valor de hoy" (Configuración) el detalle. PURO: lo prueba verificarF9196.
//
// ⛔ Contrato (CLAUDE-PATRIMONIO): las inconsistencias se muestran, no se corrigen solas. Acá solo se
// cuentan para el hero; ninguna se esconde.
import { diasHabilesEntre } from './compartido/patrimonioFlujosAuto';

/** Lo que se usa de `carteraViva/ultima`. Todo opcional: un documento viejo puede no tener algún campo. */
export type DocFuentesValorHoy = {
  calculadaEnISO?: string | null;
  frescura?: string[] | null;
  tcViejo?: boolean | null;
  inconsistencias?: string[] | null;
  cuentas?: Array<{ cuenta: string; fuente?: string | null; leidoEn?: string | null; error?: string | null }> | null;
};

export type AvisoValorHoy =
  | { tipo: 'fechas_distintas'; texto: string }
  | { tipo: 'error_cuenta'; texto: string }
  | { tipo: 'fuente_vieja'; texto: string }
  | { tipo: 'tc_viejo'; texto: string }
  | { tipo: 'sin_lectura_cripto'; texto: string }
  | { tipo: 'inconsistencia'; texto: string };

/** Fecha en Argentina de un ISO; null si no es una fecha válida (un documento raro no rompe la pantalla). */
export const fechaArgValida = (iso: string | null | undefined): string | null => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Date(ms - 3 * 3600_000).toISOString().slice(0, 10) : null;
};
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

/**
 * La fecha de la línea "Cripto: lectura dd/mm" (o "hoy …" → la del cálculo), con el año del cálculo
 * (o el anterior, si el mes es posterior: una lectura de diciembre vista en enero).
 */
export function fechaLecturaCripto(frescura: string[], hoy: string): string | null {
  const l = frescura.find(x => x.startsWith('Cripto: lectura'));
  if (!l) return null;
  if (/Cripto: lectura hoy/.test(l)) return hoy;
  const m = /Cripto: lectura (\d{2})\/(\d{2})/.exec(l);
  if (!m) return null;
  const anio = Number(hoy.slice(0, 4)) - (Number(m[2]) > Number(hoy.slice(5, 7)) ? 1 : 0);
  return `${anio}-${m[2]}-${m[1]}`;
}

/** Más de esto (en días hábiles) entre la lectura de una cuenta con API y el cálculo = fuente vieja. */
export const DIAS_HABILES_FUENTE_VIEJA = 1;

/**
 * Los avisos del valor de hoy:
 * - cada cuenta con caja y tenencia de fechas distintas (la línea de frescura con "⚠ fechas distintas");
 * - cada cuenta con `error` (si ya no está en `inconsistencias[]`, donde la pone `armarCarteraViva`);
 * - cada cuenta con API (no por archivo) leída hace más de 1 día hábil (si no tiene error: ese ya se cuenta);
 * - el MEP viejo (`tcViejo`);
 * - la falta de lectura cripto (no hay línea "Cripto: lectura …" en la frescura), o una lectura
 *   cripto de más de 1 día hábil;
 * - cada `inconsistencias[]`.
 */
export function avisosValorHoy(cv: DocFuentesValorHoy | null | undefined): AvisoValorHoy[] {
  if (!cv) return [];
  const frescura = Array.isArray(cv.frescura) ? cv.frescura : [];
  const out: AvisoValorHoy[] = [];
  for (const l of frescura) if (l.includes('⚠ fechas distintas')) out.push({ tipo: 'fechas_distintas', texto: l });
  const hoy = fechaArgValida(cv.calculadaEnISO);
  const inconsistencias = Array.isArray(cv.inconsistencias) ? cv.inconsistencias : [];
  for (const c of Array.isArray(cv.cuentas) ? cv.cuentas : []) {
    if (c.error) {
      // `armarCarteraViva` ya pone esta misma falla en `inconsistencias[]`: no se cuenta dos veces.
      const yaEsta = inconsistencias.some(x => x.startsWith(`${c.cuenta}: la última sincronización falló`));
      if (!yaEsta) out.push({ tipo: 'error_cuenta', texto: `${c.cuenta}: la última sincronización falló (${c.error})` });
      continue;
    }
    // Solo las cuentas con API de verdad (PPI, Bitfinex): un "Mis Instrumentos" de hace días no es
    // una fuente vieja (la app lo revalúa con el precio del día; se resube solo si hubo operaciones).
    const leida = fechaArgValida(c.leidoEn);
    if (c.fuente === 'api' && rotuloFuenteCuenta(c.fuente, c.cuenta, frescura) === 'API' && leida && hoy) {
      if (diasHabilesEntre(leida, hoy) > DIAS_HABILES_FUENTE_VIEJA) out.push({ tipo: 'fuente_vieja', texto: `${c.cuenta} (leída el ${ddmm(leida)})` });
    }
  }
  if (cv.tcViejo) out.push({ tipo: 'tc_viejo', texto: 'MEP de respaldo (viejo o sin dato)' });
  const cripto = hoy ? fechaLecturaCripto(frescura, hoy) : null;
  if (!frescura.some(l => l.startsWith('Cripto: lectura'))) out.push({ tipo: 'sin_lectura_cripto', texto: 'Cripto: sin lectura de precios' });
  else if (cripto && hoy && diasHabilesEntre(cripto, hoy) > DIAS_HABILES_FUENTE_VIEJA) out.push({ tipo: 'fuente_vieja', texto: `Cripto (lectura del ${ddmm(cripto)})` });
  for (const x of inconsistencias) out.push({ tipo: 'inconsistencia', texto: x });
  return out;
}

/** "API" / "archivo" / "carga" / "manual", para la tabla por cuenta. */
export function rotuloFuenteCuenta(fuente: string | null | undefined, cuenta: string, frescura: string[] | null | undefined): string {
  if (fuente === 'manual') return 'manual';
  if (fuente === 'corrida') return 'carga';
  if (fuente === 'api') {
    // Las cuentas por archivo (Balanz) también entran como 'api' en la cartera viva: se distinguen por su línea de frescura.
    const l = (frescura ?? []).find(x => x.startsWith(`${cuenta}:`));
    return l && /tenencia del/.test(l) ? 'archivo' : 'API';
  }
  return '—';
}
