// F9.107 §4.1 — verificación de parseMonto/formatMonto. Corre con:
//   npx tsx scripts/verificarMonto.ts
// No hay runner de tests en el repo; mismo patrón que scripts/verificarRiesgo.ts: una línea
// OK/FAIL por caso y exit code 1 si algo falla.
import { parseMonto, formatMonto } from '../src/design-system/utils/monto';

type Caso = { name: string; ok: boolean; detail: string };
const casos: Caso[] = [];
function chequear(name: string, ok: boolean, detail: string) { casos.push({ name, ok, detail }); }

function parsea(entrada: string, esperado: number | null) {
  const real = parseMonto(entrada);
  const ok = Object.is(real, esperado) || (real !== null && esperado !== null && Math.abs(real - esperado) < 1e-9);
  chequear(`parse ${JSON.stringify(entrada)}`, ok, `esperado ${esperado} · real ${real}`);
}

function formatea(n: number, decimals: number | undefined, esperado: string) {
  const real = decimals === undefined ? formatMonto(n) : formatMonto(n, decimals);
  chequear(`format ${n}${decimals === undefined ? '' : `/${decimals}`}`, real === esperado,
    `esperado ${JSON.stringify(esperado)} · real ${JSON.stringify(real)}`);
}

// ── Tabla de §2.3 — los 6 casos que hoy corrompen datos ──────────────────────
parsea('184245.43',   184245.43);
parsea('184245,43',   184245.43);
parsea('184.245,43',  184245.43);   // hoy persiste 184.245
parsea('184,245.43',  184245.43);   // hoy persiste 184.245
parsea('$184.245,43', 184245.43);   // hoy persiste NaN
parsea('1.234',       1234);        // D4: separador de miles

// ── Casos borde de §4.1 ──────────────────────────────────────────────────────
parsea('',            null);
parsea('abc',         null);
parsea(',',           null);
parsea('0',           0);
parsea('-5,50',       -5.5);
parsea('1.234.567,89', 1234567.89);

// ── Extras: símbolos, espacios raros, basura ─────────────────────────────────
parsea('U$S 1.234,56', 1234.56);
parsea('US$1,234.56',  1234.56);
parsea('  1 234,56 ',  1234.56);              // espacio común
parsea('1 234,56', 1234.56);             // NBSP (copiado de PDF/Excel)
parsea('1 234,56', 1234.56);             // espacio fino
parsea('-$100',        -100);
parsea('$-100',        -100);
parsea('.5',           0.5);                  // sin dígitos a la izquierda → decimal
parsea('1.2345',       1.2345);               // 4 dígitos a la derecha → decimal
parsea('12.345.678',   12345678);             // separador repetido → todos de miles
parsea('1450',         1450);                 // TC típico
parsea('1450,75',      1450.75);
parsea('12a34',        null);
parsea('1.2.3,4.5',    null);                 // ambiguo irrecuperable
parsea('--5',          5);                    // doble signo se cancela
parsea('$',            null);
parsea('NaN',          null);
parsea('Infinity',     null);

// ── formatMonto ──────────────────────────────────────────────────────────────
formatea(184245.43, undefined, '184.245,43');
formatea(1234, undefined,      '1.234,00');
formatea(-5.5, undefined,      '-5,50');
formatea(0, undefined,         '0,00');
formatea(1234.5, 0,            '1.234,5');    // decimals es mínimo, no máximo: no miente
formatea(1234, 0,              '1.234');
formatea(NaN, undefined,       '');
formatea(Infinity, undefined,  '');

// ── Ida y vuelta: lo formateado se vuelve a parsear al mismo número ──────────
{
  const nums = [0, 1, 1234, 184245.43, -5.5, 1450.75, 1234567.89];
  const rotos = nums.filter(n => parseMonto(formatMonto(n)) !== n);
  chequear('round-trip format→parse', rotos.length === 0,
    rotos.length === 0 ? `${nums.length} números` : `fallan: ${rotos.join(', ')}`);
}

// ── Nunca tira, con cualquier basura ─────────────────────────────────────────
{
  const basura = ['', ' ', '$', ',', '.', '-', '--', 'abc', '1e5', '∞', '1,2,3', '....', null as unknown as string];
  let tiro = '';
  for (const b of basura) {
    try { parseMonto(b); } catch (e) { tiro = `${JSON.stringify(b)}: ${e}`; break; }
  }
  chequear('parseMonto nunca tira', tiro === '', tiro || `${basura.length} entradas basura`);
}

let pass = 0, fail = 0;
for (const c of casos) {
  console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name} - ${c.detail}`);
  c.ok ? pass++ : fail++;
}
console.log(`\n${pass} OK / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
