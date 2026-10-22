// F9.196.1 Addendum 1 — lo que el cliente hace con las respuestas y los errores de los callables de
// la cartera viva (sincronizar PPI, sincronizar Bitfinex, recalcular). PURO (sin Firebase): lo
// prueba scripts/verificarF9196.ts.

/**
 * A — el texto para mostrar de un error de callable. Firebase devuelve `internal` sin texto cuando
 * la Function se cae, se corta por timeout o tira algo que no es HttpsError: en ese caso se explica.
 */
export function mensajeDeErrorCallable(e: unknown): string {
  const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : '';
  const msg = String((e as Error)?.message ?? e ?? '').trim();
  const sinTexto = !msg || msg.toLowerCase() === 'internal';
  if (code.endsWith('internal') && sinTexto) {
    return 'No respondió la función (error interno sin detalle): puede haberse cortado por tiempo o estar desplegándose. Probá de nuevo en un minuto; si sigue, mirá los logs de Functions.';
  }
  if (code.endsWith('deadline-exceeded')) {
    return 'La función tardó más de lo que espera la app: puede haber terminado igual. Esperá un minuto y recargá antes de volver a intentar.';
  }
  return msg || 'error sin detalle';
}
