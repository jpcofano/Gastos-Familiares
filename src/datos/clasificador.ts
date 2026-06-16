export interface EntradaDict {
  patron: string | null;
  tipoMatch: 'exact' | 'contains';
  categoria: string | null;
  subcategoria: string | null;
  bancoFiltro: string | null;
  tarjetaFiltro: string | null;
  confianza: number;
  activo: boolean;
}

export interface ClasificacionResult {
  categoria: string;
  subcategoria: string | null;
  confianza: number;
}

// Pura: sin SDK. Usada en cliente (vía DiccionarioContext) y reutilizable en Functions.
export function clasificar(
  texto: string,
  entradas: EntradaDict[],
  opts: { banco?: string | null; tarjeta?: string | null } = {},
): ClasificacionResult | null {
  const norm = texto.toLowerCase().trim();
  if (!norm) return null;

  const banco   = opts.banco   ?? null;
  const tarjeta = opts.tarjeta ?? null;

  let mejor: { result: ClasificacionResult; especificidad: number } | null = null;

  for (const e of entradas) {
    if (!e.activo || !e.patron || !e.categoria) continue;

    const patronNorm = e.patron.toLowerCase();
    const matchTexto =
      e.tipoMatch === 'exact'
        ? norm === patronNorm
        : norm.includes(patronNorm);
    if (!matchTexto) continue;

    // Filtros: si el doc tiene filtro y el caller pasó valor → deben coincidir.
    // Si el doc no tiene filtro → acepta cualquier valor del caller.
    if (e.bancoFiltro   && banco   && e.bancoFiltro   !== banco)   continue;
    if (e.tarjetaFiltro && tarjeta && e.tarjetaFiltro !== tarjeta) continue;

    // Especificidad: match exacto tarjeta > banco > tipo de texto
    let especificidad = 0;
    if (e.tarjetaFiltro && tarjeta && e.tarjetaFiltro === tarjeta) especificidad += 4;
    if (e.bancoFiltro   && banco   && e.bancoFiltro   === banco)   especificidad += 2;
    if (e.tipoMatch === 'exact') especificidad += 1;

    if (!mejor || especificidad > mejor.especificidad) {
      mejor = {
        result: { categoria: e.categoria, subcategoria: e.subcategoria ?? null, confianza: e.confianza },
        especificidad,
      };
    }
  }

  return mejor?.result ?? null;
}
