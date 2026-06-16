import { normalizar, type NormRule } from './normalizador';

export const CONFIANZA_UMBRAL     = 0.7;  // threshold para prellenar sugerencia
export const CONFIANZA_INCREMENTO = 0.1;  // bump cuando el usuario corrige (sync con functions/src/index.ts)

export interface EntradaDict {
  patron: string | null;
  tipoMatch: 'exact' | 'contains';
  descripcionLimpia: string | null;
  categoria: string | null;
  subcategoria: string | null;
  personaDefault: string | null;
  monedaDefault: 'ARS' | 'USD' | null;
  bancoFiltro: string | null;
  tarjetaFiltro: string | null;
  confianza: number;
  activo: boolean;
}

export interface ClasificacionResult {
  descripcionLimpia: string | null;
  categoria: string;
  subcategoria: string | null;
  personaDefault: string | null;
  monedaDefault: 'ARS' | 'USD' | null;
  confianza: number;
}

// Pura: sin SDK. Usada en cliente (vía DiccionarioContext) y reutilizable en Functions.
export function clasificar(
  texto: string,
  entradas: EntradaDict[],
  reglas: NormRule[],
  opts: { banco?: string | null; tarjeta?: string | null } = {},
): ClasificacionResult | null {
  const textoNormalizado = normalizar(texto.trim(), reglas);
  const norm = textoNormalizado.toLowerCase();
  if (!norm) return null;

  const banco   = opts.banco   ?? null;
  const tarjeta = opts.tarjeta ?? null;

  let mejor: { result: ClasificacionResult; especificidad: number } | null = null;

  for (const e of entradas) {
    if (!e.activo || !e.patron || !e.categoria) continue;

    // El patron guardado ya viene normalizado (on-write), pero se renormaliza acá también:
    // robustece el lookup si las reglas cambian sin migrar datos viejos (igual que el sistema viejo).
    const patronNorm = normalizar(e.patron, reglas).toLowerCase();
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
        result: {
          descripcionLimpia: e.descripcionLimpia ?? textoNormalizado,
          categoria:         e.categoria,
          subcategoria:      e.subcategoria ?? null,
          personaDefault:    e.personaDefault ?? null,
          monedaDefault:     e.monedaDefault ?? null,
          confianza:         e.confianza,
        },
        especificidad,
      };
    }
  }

  return mejor?.result ?? null;
}
