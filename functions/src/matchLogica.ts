// Tipos mínimos espejo de src/types/index.ts — sin imports de SDK.
// Sync manual si los tipos del cliente cambian (ver nota en CLAUDE.md).

export interface MatchTexto {
  incluye: string[];
  excluye: string[];
}

export interface DatosExtractosMin {
  tipoDocumento: string;
  montoTotal: number | null;
  moneda: 'ARS' | 'USD';
  fecha: string | null;           // ISO YYYY-MM-DD
  comercioRazonSocial: string | null;
  vencimientos?: Array<{ fecha: string | null; monto: number | null }>;
  // F6.8
  destinoCbu?: string | null;
  destinoAlias?: string | null;
  destinoNombre?: string | null;
}

export interface MovimientoMin {
  id: string;
  monto: number;
  moneda: 'ARS' | 'USD';
  tipo: 'Gasto' | 'Ingreso';
  fecha: Date;
  mes: string;
  descripcion: string;
  itemEsperadoId: string | null;
}

export interface ItemEsperadoMin {
  id: string;
  tipo: 'Gasto' | 'Ingreso';
  moneda: 'ARS' | 'USD';
  activo: boolean;
  matchTexto: MatchTexto | null;
}

export interface PropuestaMatch {
  rama: 0 | 1 | 2 | 3;
  movimientoId?: string;
  itemEsperadoId?: string;
  candidatos?: Array<{ tipo: 'movimiento' | 'esperado'; id: string; score?: number }>;
  calculadoEn: Date;
  // F6.8
  origenDestino?: boolean;
  esAdicional?: boolean;
  categoriaPrellena?: string | null;
  subcategoriaPrellena?: string | null;
  etiquetaPrellena?: string | null;
  dedupInfo?: { movId: string; mes: string | null; monto: number | null; item?: string | null };
}

// CBU/CVU argentino = 22 dígitos exactos
const RE_CBU   = /^\d{22}$/;
// Alias Banco Central: 6-20 chars alfanuméricos + puntos/guiones/underscores
const RE_ALIAS = /^[a-z0-9._-]{6,20}$/;

export function normalizarDestino(raw: string): { tipo: 'cbu' | 'alias' | 'nombre'; norm: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const soloDigitos = s.replace(/\D/g, '');
  if (RE_CBU.test(soloDigitos)) return { tipo: 'cbu', norm: soloDigitos };
  const aliasNorm = s.toLowerCase().trim();
  if (RE_ALIAS.test(aliasNorm)) return { tipo: 'alias', norm: aliasNorm };
  const nombre = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  if (nombre.length >= 3) return { tipo: 'nombre', norm: nombre };
  return null;
}

const TOLERANCIA_MONTO = 0.05;
const VENTANA_MS       = 7 * 24 * 60 * 60 * 1000;

/**
 * Espeja la lógica de matchTexto de movimientosDelItem() en src/vistas/Resumen.tsx.
 * Sync manual si la lógica del cliente cambia.
 */
export function evaluarMatchTexto(texto: string, mt: MatchTexto): boolean {
  const t = texto.toLowerCase();
  return mt.incluye.some(p => t.includes(p)) && !mt.excluye.some(p => t.includes(p));
}

function montoScore(montoMov: number, datos: DatosExtractosMin): number {
  const abs = Math.abs(montoMov);
  const T   = TOLERANCIA_MONTO;

  if (datos.montoTotal !== null && datos.montoTotal > 0) {
    const diff = Math.abs(abs - datos.montoTotal) / datos.montoTotal;
    if (diff === 0) return 10;  // exacto
    if (diff <= T)  return 7;   // dentro de ±5%
  }

  // Fallback F6.2.2: vencimientos[1+] (2do venc con recargo)
  if (datos.vencimientos && datos.vencimientos.length > 1) {
    for (let i = 1; i < datos.vencimientos.length; i++) {
      const vm = datos.vencimientos[i].monto;
      if (vm !== null && vm > 0) {
        const diff = Math.abs(abs - vm) / vm;
        if (diff <= T) return 4;  // vencimiento alternativo — score menor
      }
    }
  }

  return 0;
}

function textoScore(comercio: string, descripcion: string): number {
  const desc   = descripcion.toLowerCase();
  const tokens = comercio.toLowerCase().split(/\s+/).filter(t => t.length >= 4);
  return tokens.some(t => desc.includes(t)) ? 1 : 0;
}

export function matchConMovimientos(
  datos: DatosExtractosMin,
  movs: MovimientoMin[],
  mesComp: string,
): Array<{ mov: MovimientoMin; score: number }> {
  const comercio  = datos.comercioRazonSocial ?? '';
  const fechaComp = datos.fecha ? new Date(datos.fecha + 'T12:00:00') : null;
  const resultados: Array<{ mov: MovimientoMin; score: number }> = [];

  for (const m of movs) {
    if (m.moneda !== datos.moneda) continue;
    if (m.tipo !== 'Gasto')        continue;  // comprobantes son gastos

    // Temporal: mismo mes OR fecha ±7d (unión, NO corte duro)
    const esMisMes  = mesComp !== '' && m.mes === mesComp;
    const esFechaOk = fechaComp !== null &&
      Math.abs(m.fecha.getTime() - fechaComp.getTime()) <= VENTANA_MS;

    if (!esMisMes && !esFechaOk) continue;

    const ms = montoScore(m.monto, datos);
    if (ms === 0) continue;

    const fs = esFechaOk ? 2 : 1;  // fecha dentro de ventana = +2, solo mismo mes = +1
    const ts = comercio ? textoScore(comercio, m.descripcion) : 0;

    resultados.push({ mov: m, score: ms + fs + ts });
  }

  return resultados.sort((a, b) => b.score - a.score);
}

export function matchConEsperados(
  datos: DatosExtractosMin,
  items: ItemEsperadoMin[],
): ItemEsperadoMin[] {
  if (!datos.comercioRazonSocial) return [];
  const comercio = datos.comercioRazonSocial.toLowerCase();

  return items.filter(item => {
    if (!item.activo)   return false;
    if (item.moneda !== datos.moneda) return false;
    if (!item.matchTexto || item.matchTexto.incluye.length === 0) return false;
    return evaluarMatchTexto(comercio, item.matchTexto);
  });
}

export function calcularPropuesta(
  datos: DatosExtractosMin,
  movs: MovimientoMin[],
  items: ItemEsperadoMin[],
  mesComp: string,
): PropuestaMatch {
  const ahora    = new Date();
  const movCands = matchConMovimientos(datos, movs, mesComp);

  if (movCands.length === 1) {
    const mov          = movCands[0].mov;
    const itemsMatch   = matchConEsperados(datos, items);
    const itemEsperadoId = mov.itemEsperadoId ?? itemsMatch[0]?.id;
    return {
      rama: 1,
      movimientoId: mov.id,
      ...(itemEsperadoId ? { itemEsperadoId } : {}),
      calculadoEn: ahora,
    };
  }

  if (movCands.length > 1) {
    return {
      rama: 1,
      candidatos: movCands.map(c => ({ tipo: 'movimiento' as const, id: c.mov.id, score: c.score })),
      calculadoEn: ahora,
    };
  }

  const itemsMatch = matchConEsperados(datos, items);

  if (itemsMatch.length >= 1) {
    return {
      rama: 2,
      itemEsperadoId: itemsMatch[0].id,
      ...(itemsMatch.length > 1 ? {
        candidatos: itemsMatch.map(i => ({ tipo: 'esperado' as const, id: i.id })),
      } : {}),
      calculadoEn: ahora,
    };
  }

  return { rama: 3, calculadoEn: ahora };
}
