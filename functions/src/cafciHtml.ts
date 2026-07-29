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
