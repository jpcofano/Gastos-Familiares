// F9.104 — extracción pura desde el HTML de estadisticas.cafci.org.ar (sitio nuevo).
// Sin cheerio/jsdom: un solo atributo, no se justifica sumar un parser de HTML.
// Sin imports de SDK — mismo patrón que matchLogica.ts (testeable sin red ni credenciales).

export interface ItemCarteraCafci {
  nombre: string;
  porcentaje: number;
}

// La cartera viaja en un atributo de datos de un <canvas>, HTML-escapado por el server-render
// de Rails: data-pie-chart-items-value="[{&quot;nombre&quot;:...,&quot;porcentaje&quot;:...}]"
const RE_ATRIBUTO = /data-pie-chart-items-value="([^"]*)"/;

function decodeEntidadesHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function extraerItemsCartera(html: string): ItemCarteraCafci[] {
  const m = html.match(RE_ATRIBUTO);
  if (!m) {
    throw new Error('No se encontró data-pie-chart-items-value en el HTML — la página pudo haber cambiado de estructura.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeEntidadesHtml(m[1]));
  } catch {
    throw new Error('No se pudo parsear el JSON de data-pie-chart-items-value (¿entidades HTML sin decodificar?).');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('data-pie-chart-items-value vino vacío o no es un array.');
  }
  return parsed as ItemCarteraCafci[];
}

// La fecha de CARTERA ("Valores al DD/MM/YYYY" dentro de <div id="cartera">) es distinta de la
// fecha de VALORIZACIÓN del fondo ("información al DD/MM/YYYY" en #titlePage) — auditado contra
// HTML real (Alpha Pesos 344/569, Galileo Acciones 615/2249): ambas fechas pueden diferir en
// semanas. Acotado al bloque #cartera para no matchear la otra por accidente.
const RE_FECHA_CARTERA = /id="cartera"[\s\S]{0,600}?Valores al (\d{2})\/(\d{2})\/(\d{4})/;

export function extraerFechaCartera(html: string): string | null {
  const m = html.match(RE_FECHA_CARTERA);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

// F9.122.1 — GEMELO. La copia canónica es functions/src/cafciHtml.ts; src/datos/patrimonioCafci.ts la
// espeja. Divergir rompe el mapeo en silencio: el seed escribe claves con una normalización y el
// servidor las busca con otra, y el resultado es "el fondo no tiene el papel" en vez de un error.
// Cada regla responde a una forma observada en CAFCI (auditoría F9.122 §0, 2026-08):
//   "YPF - D"                  — sufijo de clase: la clase no cambia el emisor
//   "Cedear Vista Oil Gas"     — '&' ausente respecto del patrón "Vista Oil & Gas"
//   "Grupo Fciero Galicia - B" — puntuación irregular entre fuentes
export function normalizarEspecie(s: string): string {
  return s
    .trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(s\.?a\.?u?\.?|s\.?r\.?l\.?)\b/g, ' ')  // razón social, no identifica al emisor
    .replace(/[^a-z0-9]+/g, ' ')                        // & . - , ( ) → espacio
    .trim()
    .replace(/\s+[a-z]$/, '')                           // sufijo de clase de UNA letra al final
    .replace(/\s+/g, ' ')
    .trim();
}
