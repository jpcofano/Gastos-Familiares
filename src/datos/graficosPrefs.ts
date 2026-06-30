import { useState } from 'react';

// F9.55 — 9 paletas × 8 colores. Los colores se asignan por rango de gasto
// (índice 0 = mayor gasto), no por hash del nombre de la categoría.
// Paleta almacenada en localStorage con KEY_PALETA.
export const CHART_PALETTES: { nombre: string; colores: string[] }[] = [
  { nombre: 'Marca',          colores: ['#4f8ef7', '#2bb673', '#f5a623', '#8b5cf6', '#ef5350', '#06b6d4', '#ec4899', '#14b8a6'] },
  { nombre: 'Editorial',      colores: ['#1d3557', '#457b9d', '#a8dadc', '#2a9d8f', '#e9c46a', '#f4a261', '#e63946', '#264653'] },
  { nombre: 'Vívido',         colores: ['#ff6b6b', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5', '#f15bb5', '#00bbf9', '#00f5d4'] },
  { nombre: 'Pastel',         colores: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff'] },
  { nombre: 'Tierra',         colores: ['#6b4226', '#9c6644', '#c49a6c', '#d9b99b', '#a0522d', '#cd853f', '#deb887', '#8b6914'] },
  { nombre: 'Fríos',          colores: ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#023e8a', '#0096c7', '#48cae4', '#caf0f8'] },
  { nombre: 'Cálidos',        colores: ['#9d0208', '#d62828', '#f77f00', '#fcbf49', '#e85d04', '#f48c06', '#faa307', '#ffba08'] },
  { nombre: 'Mono esmeralda', colores: ['#004b23', '#006400', '#007200', '#008000', '#38b000', '#70e000', '#9ef01a', '#ccff33'] },
  { nombre: 'Daltónico-safe', colores: ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#999999'] },
];

const KEY_PALETA = 'gf-chart-paleta';

export function usePaletaIdx(): [number, (i: number) => void] {
  const [idx, setIdx] = useState<number>(() => {
    const s = localStorage.getItem(KEY_PALETA);
    const n = s !== null ? Number(s) : 0;
    return Number.isFinite(n) && n >= 0 && n < CHART_PALETTES.length ? n : 0;
  });
  const set = (i: number) => {
    setIdx(i);
    localStorage.setItem(KEY_PALETA, String(i));
  };
  return [idx, set];
}
