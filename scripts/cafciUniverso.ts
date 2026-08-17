// F9.143 — construcción del universo del benchmark: join catálogo ⋈ planilla de CAFCI.
//
// Módulo compartido por construirUniversoCafci.ts (escribe) y monitorDerivaCafci.ts (no escribe).
// Vive acá y no en functions/ porque parsear la planilla necesita `xlsx`, que es dependencia del
// root y no de functions/ — meterla ahí para un job trimestral no se justifica.
//
// LA REGLA QUE NO SE PUEDE ROMPER: el patrimonio con el que un fondo pondera es la SUMA DE TODAS
// SUS CLASES. 54 de 60 fondos del segmento tienen más de una, y la planilla trae una fila por
// clase. Ponderar por la clase de la URL subestimaría Superfondo Renta Variable 4,5×.
import xlsx from 'xlsx';

export const URL_PLANILLA = 'https://api.pub.cafci.org.ar/pb_get';
export const URL_CATALOGO = 'https://estadisticas.cafci.org.ar/consulta-de-fondos.json';

// Mismos headers que usa sincronizarCafci (F9.112): un UA recortado dispara el 403 de CloudFront.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'es-AR,es;q=0.9',
};

// Columnas de la planilla, por índice. El encabezado son DOS filas (7 y 8) con celdas combinadas,
// así que `sheet_to_json` con headers no sirve: se lee como matriz y se indexa a mano.
const COL_FONDO = 0;
const COL_PATRIMONIO = 14;  // "Patrimonio / Actual"
const COL_CAFCI = 20;       // "Código CAFCI" = claseId
// NO usar la columna 39 ("Id Fondo CAFCI padre"): parece el fondoId de la ficha y viene VACÍA en
// las 4.236 filas. Medido el 17/08. El fondoId sale del catálogo, no de acá.

export type FondoUniverso = {
  fondoId: string;
  claseId: string;        // claseTop — SOLO para la URL de ficha
  nombre: string;
  cnv: string | null;
  patrimonioArs: number;  // suma de TODAS las clases
  clases: number;
};

export type Universo = {
  fechaPlanilla: string;
  fechaCatalogo: string;
  totalPatrimonioArs: number;
  fondos: FondoUniverso[];       // patrimonio > 0, orden descendente
  fondosSinPatrimonio: number;
};

export async function bajarPlanilla(): Promise<{ buf: Buffer; fecha: string; lastModified: string }> {
  const res = await fetch(URL_PLANILLA, { headers: HEADERS, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`pb_get: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
  const cd = res.headers.get('content-disposition') ?? '';
  // filename="20260814_Planilla_Diaria_A.xlsx" → 2026-08-14
  const m = cd.match(/(\d{4})(\d{2})(\d{2})_Planilla/);
  const fecha = m ? `${m[1]}-${m[2]}-${m[3]}` : 'desconocida';
  return {
    buf: Buffer.from(await res.arrayBuffer()),
    fecha,
    lastModified: res.headers.get('last-modified') ?? '',
  };
}

export async function bajarCatalogo(): Promise<any> {
  const res = await fetch(URL_CATALOGO, { headers: { ...HEADERS, Accept: 'application/json' }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`consulta-de-fondos: HTTP ${res.status}`);
  return res.json();
}

/** Patrimonio por `claseId`, de la planilla. Una fila = una clase. */
export function patrimonioPorClase(buf: Buffer): Map<string, number> {
  const wb = xlsx.read(buf, { type: 'buffer' });
  const aoa = xlsx.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true });
  const out = new Map<string, number>();
  for (const f of aoa) {
    const claseId = f?.[COL_CAFCI] == null ? null : String(f[COL_CAFCI]).trim();
    if (!claseId || !/^\d+$/.test(claseId)) continue;
    out.set(claseId, typeof f[COL_PATRIMONIO] === 'number' ? f[COL_PATRIMONIO] : 0);
    void COL_FONDO;
  }
  return out;
}

/** El join. Determinístico: mismas dos entradas → mismo universo. */
export function construir(catalogo: any, patrimonio: Map<string, number>, fechaPlanilla: string): Universo {
  const seg = (catalogo.fondos ?? []).filter((f: any) =>
    f.tipo_renta?.nombre === 'Renta Variable' &&
    f.region?.nombre === 'Argentina' &&
    f.moneda?.nombre === 'Peso Argentina');

  const todos: FondoUniverso[] = seg.map((f: any) => {
    const clases = (f.clases ?? []).map((c: any) => ({
      claseId: String(c.id),
      patrimonio: patrimonio.get(String(c.id)) ?? 0,
    }));
    // claseTop = la de MAYOR patrimonio, y se usa sólo para armar la URL de ficha. La cartera es
    // del fondo (verificado en F9.142: el bloque es idéntico entre clases del mismo fondo).
    const top = clases.slice().sort((a: any, b: any) => b.patrimonio - a.patrimonio)[0];
    return {
      fondoId: String(f.id),
      claseId: top?.claseId ?? String(f.id),
      nombre: f.nombre,
      cnv: f.codigo_cnv ?? null,
      // ── LA SUMA DE TODAS LAS CLASES, no la de `claseTop` ──
      patrimonioArs: clases.reduce((s: number, c: any) => s + c.patrimonio, 0),
      clases: clases.length,
    };
  });

  const fondos = todos.filter(f => f.patrimonioArs > 0).sort((a, b) => b.patrimonioArs - a.patrimonioArs);
  return {
    fechaPlanilla,
    fechaCatalogo: catalogo.generated_at ?? 'desconocida',
    totalPatrimonioArs: fondos.reduce((s, f) => s + f.patrimonioArs, 0),
    fondos,
    fondosSinPatrimonio: todos.length - fondos.length,
  };
}

export async function universoActual(): Promise<Universo> {
  const [planilla, catalogo] = await Promise.all([bajarPlanilla(), bajarCatalogo()]);
  return construir(catalogo, patrimonioPorClase(planilla.buf), planilla.fecha);
}

/** Primer día hábil de enero, abril, julio y octubre (F9.143 §4). */
export function proximoRebalanceo(desde = new Date()): string {
  const y = desde.getUTCFullYear();
  const meses = [0, 3, 6, 9];
  for (const anio of [y, y + 1]) {
    for (const m of meses) {
      const d = new Date(Date.UTC(anio, m, 1));
      while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
      if (d > desde) return d.toISOString().slice(0, 10);
    }
  }
  return '';
}
