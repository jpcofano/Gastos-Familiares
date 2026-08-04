// F9.107 — parser y formateador de montos tipeados por humanos.
//
// El bug que motiva este módulo: `parseFloat(monto.replace(',', '.'))` reemplaza SOLO la
// primera ocurrencia, así que "184.245,43" se guardaba como 184,245 — tres órdenes de
// magnitud abajo, sin excepción y sin aviso. Acá el contrato es explícito: o se interpreta
// de forma inequívoca, o devuelve null y el llamador decide (nunca cae a 0).

const SEPARADORES = /^[\d.,]*$/;
// \s no cubre NBSP ni el espacio fino que llegan pegados desde PDF o Excel.
const ESPACIOS    = /[\s  ]/g;
const MONEDA      = /^(u\$s|us\$|usd|ars|\$)/i;

/**
 * Parsea un monto tipeado por un humano. Tolera es-AR (1.234,56), en-US (1,234.56),
 * símbolos de moneda y espacios (incl. NBSP y espacio fino).
 *
 * Regla de desambiguación cuando hay UN solo separador y una sola vez: con exactamente
 * 3 dígitos a la derecha y al menos 1 a la izquierda se lee como separador de miles
 * ("1.234" → 1234), que es la convención es-AR. Todos los call sites son montos y tipo
 * de cambio (~1450), nunca fracciones de 3 decimales.
 *
 * Devuelve null si no se puede interpretar. Nunca tira.
 */
export function parseMonto(raw: string): number | null {
  if (typeof raw !== 'string') return null;

  let s = raw.trim().replace(ESPACIOS, '');
  if (!s) return null;

  // El signo puede venir antes o después del símbolo: "-$100" y "$-100" son lo mismo.
  let negativo = false;
  const comerSigno = () => {
    while (s[0] === '-' || s[0] === '+') {
      if (s[0] === '-') negativo = !negativo;
      s = s.slice(1);
    }
  };
  comerSigno();
  s = s.replace(MONEDA, '');
  comerSigno();

  if (!SEPARADORES.test(s)) return null;
  if (!/\d/.test(s)) return null;

  const ultimaComa  = s.lastIndexOf(',');
  const ultimoPunto = s.lastIndexOf('.');

  let decimal: string | null = null;
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    // Ambos presentes: el posterior es el decimal, el otro es de miles.
    decimal = ultimaComa > ultimoPunto ? ',' : '.';
  } else if (ultimaComa >= 0 || ultimoPunto >= 0) {
    const sep = ultimaComa >= 0 ? ',' : '.';
    const veces = s.split(sep).length - 1;
    if (veces === 1) {
      const [izq, der] = s.split(sep);
      // 3 dígitos a la derecha y algo a la izquierda → miles (convención es-AR).
      const esMiles = der.length === 3 && izq.length >= 1;
      decimal = esMiles ? null : sep;
    } else {
      decimal = null; // repetido → todos de miles
    }
  }

  const normalizado = decimal === null
    ? s.replace(/[.,]/g, '')
    : s.replace(decimal === ',' ? /\./g : /,/g, '').replace(decimal, '.');

  const n = Number(normalizado);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

/**
 * Formatea a es-AR sin símbolo de moneda: 184245.43 → "184.245,43".
 *
 * `decimals` es el mínimo, no el máximo: si el número trae más precisión que la pedida se
 * muestra completa. Un input que redondea lo que muestra pero persiste otra cosa es la
 * misma clase de mentira silenciosa que este módulo viene a arreglar.
 */
export function formatMonto(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '';
  const propios = decimalesDe(n);
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: Math.max(decimals, propios),
  });
}

// Cuántos decimales tiene el número realmente, tope 10 (límite de toLocaleString).
function decimalesDe(n: number): number {
  const s = String(Math.abs(n));
  if (s.includes('e') || s.includes('E')) return 10;
  const punto = s.indexOf('.');
  return punto < 0 ? 0 : Math.min(10, s.length - punto - 1);
}
