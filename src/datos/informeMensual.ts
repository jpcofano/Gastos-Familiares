// F9.124 — Informe mensual en PDF. Cierra el placeholder de F9.14 ("está en definición: PDF, email
// o link") con PDF generado en el cliente + share sheet nativa, y descarga como fallback.
//
// Nada de email ni link: el email lo pone el sistema operativo desde el share sheet, y un link
// exigiría Storage público con expiración — superficie de seguridad nueva para un informe que se
// regenera en dos segundos desde datos que ya están cargados.
//
// NO se archiva en Storage ni en Firestore, a diferencia del informe de patrimonio. Aquel documenta
// una *corrida*: un estado que no se puede reconstruir después, y por eso se guarda. Este es una
// proyección de datos vivos que siguen en Firestore; archivarlo generaría copias que se
// desactualizan y contradicen la app.
//
// Motor: pdfmake, el mismo de patrimonioInforme.ts, con sus mismas convenciones de estilos
// (h1/h2/tableHeader/note) y su mismo import dinámico con vfs_fonts.

import { escalaEvolucionDiaria, usdEq, type DashMensual } from './agregados';
import { fmtMoney } from './money';
import { cubierto, type CheckItem } from './checklist';
import type { Movement } from '../types';

type Moneda = 'ARS' | 'USD';

// ── Gastos fijos del mes (§A) ─────────────────────────────────────────────────
// Los nueve estados del checklist se colapsan a tres para el informe: el PDF responde "qué falta
// pagar", no "en qué estado interno está el match". El detalle fino vive en la app, que es donde se
// puede accionar.
export type EstadoFijo = 'pagado' | 'a confirmar' | 'pendiente';

export type FilaFijo = {
  nombre: string;
  esperadoUsd: number | null;
  realUsd: number | null;
  estado: EstadoFijo;
};

export type ResumenFijosMes = {
  filas: FilaFijo[];
  pendientes: number;
  totalPendienteUsd: number;
};

/** Etiqueta de un ítem esperado, con el mismo criterio que usa Comprobantes. */
function nombreItem(ci: CheckItem): string {
  const i = ci.item;
  return i.notas
    || [i.categoria, i.subcategoria].filter(Boolean).join(' › ')
    || i.matchTexto?.incluye[0]
    || i.id;
}

export function construirResumenFijos(checkItems: CheckItem[], tc: number): ResumenFijosMes {
  const filas: FilaFijo[] = [];
  for (const ci of checkItems) {
    if (ci.estado === 'no_aplica') continue;
    const estado: EstadoFijo = cubierto(ci.estado)
      ? 'pagado'
      : (ci.estado === 'por_confirmar' || ci.estado === 'parcial' || ci.estado === 'programado')
        ? 'a confirmar'
        : 'pendiente';
    const realUsd = ci.matches.length > 0
      ? ci.matches.reduce((s: number, m: Movement) => s + usdEq(m, tc), 0)
      : null;
    // `montoEsperado` está en la moneda del ítem; acá adentro todo es USD, como en el resto del
    // módulo. Sin monto esperado la fila igual va: "no sé cuánto" no es lo mismo que "cero".
    const esperadoUsd = ci.item.montoEsperado === null
      ? null
      : ci.item.moneda === 'USD' ? ci.item.montoEsperado : (tc ? ci.item.montoEsperado / tc : null);
    filas.push({ nombre: nombreItem(ci), esperadoUsd, realUsd, estado });
  }
  filas.sort((a, b) => {
    const orden = { pendiente: 0, 'a confirmar': 1, pagado: 2 } as const;
    return orden[a.estado] - orden[b.estado] || a.nombre.localeCompare(b.nombre, 'es');
  });
  const pend = filas.filter(f => f.estado === 'pendiente');
  return {
    filas,
    pendientes: pend.length,
    totalPendienteUsd: pend.reduce((s, f) => s + (f.esperadoUsd ?? 0), 0),
  };
}

// ── Parámetros ────────────────────────────────────────────────────────────────
export type InformeMensualParams = {
  d: DashMensual;
  mes: string;              // 'YYYY-MM'
  tc: number;
  cur: Moneda;
  soloPorcentajes?: boolean;
  fijos?: ResumenFijosMes | null;
};

// ── Helpers de contenido (mismas convenciones que patrimonioInforme.ts) ───────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Content = any;

const h1 = (text: string): Content => ({ text, style: 'h1', margin: [0, 0, 0, 10] });
const h2 = (text: string): Content => ({ text, style: 'h2', margin: [0, 16, 0, 6] });
const note = (text: string): Content => ({ text, style: 'note', margin: [0, 4, 0, 0] });
const pageBreak = (): Content => ({ text: '', pageBreak: 'before' });

function tableOf(headers: string[], rows: Content[][]): Content {
  return {
    table: {
      headerRows: 1,
      widths: headers.map(() => '*'),
      body: [headers.map(h => ({ text: h, style: 'tableHeader' })), ...rows],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 4, 0, 8],
  };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
               'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function mesEnLargo(mes: string): string {
  const [y, m] = mes.split('-');
  const i = Number(m) - 1;
  return `${MESES[i] ?? m} ${y}`;
}

function fmtFechaHora(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Escapa texto para interpolarlo dentro del SVG del gráfico.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Generador ─────────────────────────────────────────────────────────────────
export async function generarInformeMensual(p: InformeMensualParams): Promise<void> {
  const { d, mes, tc, cur, soloPorcentajes, fijos } = p;

  // F9.119/F9.120 — variante sin montos: se sombrea EL formateador, no cada llamada. Así ninguna
  // sección se escapa mostrando el número real por olvido. La base es el gasto del mes y se declara
  // en la portada: un % sin denominador declarado induce a error.
  // Fail-soft por ítem: si un valor falla, ese ítem muestra `—` y el informe sale igual.
  const baseGasto = d.salidasUsd;
  const fmt = soloPorcentajes
    ? (n: number) => {
        try {
          if (!baseGasto || !Number.isFinite(baseGasto) || !Number.isFinite(n)) return '—';
          const q = (n / baseGasto) * 100;
          if (n !== 0 && Math.abs(q) < 1) return q < 0 ? '>-1%' : '<1%';
          return `${Math.abs(q) < 10 ? q.toFixed(1).replace('.', ',') : String(Math.round(q))}%`;
        } catch (e) {
          console.error('[informeMensual] no se pudo porcentualizar un ítem:', e);
          return '—';
        }
      }
    : (n: number) => fmtMoney(n, { from: 'USD', to: cur, tc });

  const content: Content[] = [];

  // F9.124 — fail-soft por SECCIÓN: si una falla, el informe sale igual con esa sección marcada.
  // Perder el PDF entero por una sección rota sería peor que un renglón que dice qué se rompió.
  // Mismo criterio que F9.119 en patrimonioInforme.
  const seccion = (nombre: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      console.error(`[informeMensual] sección "${nombre}" falló:`, e);
      content.push(note(`Sección "${nombre}": no se pudo generar. El resto del informe es válido.`));
    }
  };

  // ── 1. Portada ──────────────────────────────────────────────────────────────
  seccion('portada', () => {
    content.push({ text: 'Gastos Familiares', style: 'portadaTitulo', margin: [0, 140, 0, 0] });
    content.push({ text: 'Informe mensual', style: 'portadaSub' });
    content.push({ text: mesEnLargo(mes), style: 'portadaMes' });
    content.push({ text: `Moneda base: ${cur} · TC usado: ${Math.round(tc).toLocaleString('es-AR')}`, style: 'portadaSub' });
    content.push({ text: `Generado el ${fmtFechaHora(new Date())}`, style: 'portadaSub' });
    if (soloPorcentajes) {
      content.push({
        text: `Variante sin montos: cada valor se expresa como % del gasto del mes.`,
        style: 'portadaSub', italics: true, margin: [0, 14, 0, 0],
      });
    }
  });

  // ── 2. Resumen ──────────────────────────────────────────────────────────────
  seccion('resumen', () => {
    content.push(pageBreak(), h1('1. Resumen del mes'));
    content.push(tableOf(['Concepto', 'Valor'], [
      [{ text: 'Ingresos', fontSize: 9 }, { text: fmt(d.ingresosUsd), fontSize: 9, alignment: 'right' }],
      [{ text: 'Salidas', fontSize: 9 }, { text: fmt(d.salidasUsd), fontSize: 9, alignment: 'right' }],
      [{ text: 'Balance', fontSize: 9, bold: true }, { text: fmt(d.balanceUsd), fontSize: 9, alignment: 'right', bold: true }],
      [{ text: 'Movimientos', fontSize: 9 }, { text: String(d.movimientos), fontSize: 9, alignment: 'right' }],
      [{ text: 'Promedio diario', fontSize: 9 }, { text: fmt(d.promedioDiarioUsd), fontSize: 9, alignment: 'right' }],
      [{ text: 'Días con gasto', fontSize: 9 }, { text: String(d.diasConGasto), fontSize: 9, alignment: 'right' }],
      [{ text: '% fin de semana', fontSize: 9 }, { text: `${d.finDeSemanaPct}%`, fontSize: 9, alignment: 'right' }],
      [{ text: 'Banco dominante', fontSize: 9 }, { text: d.bancoDominante || '—', fontSize: 9, alignment: 'right' }],
    ]));
    content.push({ text: `vs mes anterior ${d.vsMesAnteriorPct}% (${d.vsMesLabel})`, fontSize: 9, margin: [0, 2, 0, 2] });
    if (d.lecturaRapida) content.push({ text: d.lecturaRapida, fontSize: 9, italics: true, margin: [0, 2, 0, 0] });
  });

  // ── 3. Por categoría ────────────────────────────────────────────────────────
  seccion('categorías', () => {
    content.push(h2('2. Por categoría'));
    const cats = [...d.categorias].sort((a, b) => b.usd - a.usd);
    if (cats.length === 0) {
      content.push(note('Sin categorías con gasto en el mes.'));
      return;
    }
    content.push(tableOf(['Categoría', 'Monto', '%'], cats.map(c => ([
      { text: c.nombre, fontSize: 9 },
      { text: fmt(c.usd), fontSize: 9, alignment: 'right' },
      { text: `${Math.round(c.pct)}%`, fontSize: 9, alignment: 'right' },
    ]))));
    content.push({ text: `Top 3 categorías: ${d.top3Pct}% del gasto del mes`, fontSize: 9 });
  });

  // ── 4. Por subcategoría ─────────────────────────────────────────────────────
  seccion('subcategorías', () => {
    content.push(h2('3. Por subcategoría'));
    const subs = [...d.subcategorias].sort((a, b) => b.valor - a.valor);
    if (subs.length === 0) {
      content.push(note('Sin subcategorías con gasto en el mes.'));
      return;
    }
    const MAX = 15;
    const visibles = subs.slice(0, MAX);
    const resto = subs.slice(MAX);
    const filas: Content[][] = visibles.map(s => ([
      { text: s.nombre, fontSize: 9 },
      { text: fmt(s.valor), fontSize: 9, alignment: 'right' },
    ]));
    // El resto se agrega en una fila explícita: prorratearlo o descartarlo en silencio haría que la
    // suma de la tabla no cierre con el total del mes y nadie podría saber por qué.
    if (resto.length > 0) {
      filas.push([
        { text: `Resto (${resto.length})`, fontSize: 9, italics: true },
        { text: fmt(resto.reduce((s, x) => s + x.valor, 0)), fontSize: 9, alignment: 'right', italics: true },
      ]);
    }
    content.push(tableOf(['Subcategoría', 'Monto'], filas));
  });

  // ── 5. Evolución diaria ─────────────────────────────────────────────────────
  seccion('evolución diaria', () => {
    content.push(pageBreak(), h1('4. Evolución diaria'));
    // F9.124 — MISMA escala que la pantalla, importada de agregados.ts. Si esto fuera una copia, el
    // gráfico del PDF y el de la app podrían recortar distinto para el mismo mes.
    const { escalaDia, hayRecorte, diasRecortados } = escalaEvolucionDiaria(d.diaria, d.promedioDiarioUsd);
    const W = 500, H = 130, gap = 2;
    const n = Math.max(d.diaria.length, 1);
    const bw = Math.max((W - gap * (n - 1)) / n, 1);
    const barras = d.diaria.map((v, i) => {
      const h = Math.max(Math.min(v / escalaDia, 1) * H, v > 0 ? 3 : 0);
      const x = i * (bw + gap);
      const recortada = v > escalaDia;
      const color = (i + 1) === d.picoDia.diaNum ? '#DC2626' : '#64748b';
      const barra = `<rect x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}"/>`;
      // Banda de corte: la barra llega al tope, el rayado dice que el valor real está fuera de la
      // escala. Sin esto la barra mentiría por omisión.
      const banda = recortada
        ? `<rect x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="4" fill="#ffffff" opacity="0.75"/>`
        : '';
      return barra + banda;
    }).join('');
    const yProm = H - Math.min(d.promedioDiarioUsd / escalaDia, 1) * H;
    const lineaProm = `<line x1="0" y1="${yProm.toFixed(1)}" x2="${W}" y2="${yProm.toFixed(1)}" stroke="#D97706" stroke-width="1" stroke-dasharray="4 3"/>`;
    // El eje NO lleva números: con la variante sin montos, un eje en USD filtraría por la ventana
    // lo que el resto del informe tapa. La referencia es la línea de promedio, que es relativa.
    const etiqueta = `<text x="2" y="${Math.max(yProm - 3, 9).toFixed(1)}" font-size="8" fill="#D97706">promedio diario</text>`;
    content.push({ svg: `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${barras}${lineaProm}${etiqueta}</svg>`, width: W });
    content.push({ text: `Día pico: ${esc(d.picoDia.fecha)} · ${esc(d.picoDia.dow)}`, fontSize: 9, margin: [0, 6, 0, 0] });
    if (hayRecorte) {
      content.push(note(
        `${diasRecortados === 1 ? '1 día supera' : `${diasRecortados} días superan`} el tope de la escala y se ` +
        `${diasRecortados === 1 ? 'muestra recortado' : 'muestran recortados'}. El monto real está en "Día pico".`
      ));
    }
  });

  // ── 6. Gastos fijos del mes (§A) ────────────────────────────────────────────
  seccion('gastos fijos', () => {
    if (!fijos) return;
    content.push(h2('5. Gastos fijos del mes'));
    if (fijos.filas.length === 0) {
      content.push(note('Sin gastos fijos configurados para este mes.'));
      return;
    }
    content.push(tableOf(['Ítem', 'Esperado', 'Real', 'Estado'], fijos.filas.map(f => ([
      { text: f.nombre, fontSize: 9 },
      { text: f.esperadoUsd === null ? '—' : fmt(f.esperadoUsd), fontSize: 9, alignment: 'right' },
      { text: f.realUsd === null ? '—' : fmt(f.realUsd), fontSize: 9, alignment: 'right' },
      {
        text: f.estado, fontSize: 8, alignment: 'right',
        color: f.estado === 'pagado' ? '#059669' : f.estado === 'a confirmar' ? '#D97706' : '#DC2626',
      },
    ]))));
    if (fijos.pendientes > 0) {
      content.push({
        text: `${fijos.pendientes} ítem${fijos.pendientes !== 1 ? 's' : ''} sin pagar` +
              (fijos.totalPendienteUsd > 0 ? `, ${fmt(fijos.totalPendienteUsd)} estimado` : ''),
        fontSize: 9, bold: true, margin: [0, 2, 0, 0],
      });
    }
  });

  // ── 7. Mayores gastos ───────────────────────────────────────────────────────
  seccion('mayores gastos', () => {
    content.push(h2('6. Mayores gastos'));
    const top = d.porDescripcion.slice(0, 10);
    if (top.length === 0) {
      content.push(note('Sin movimientos de gasto en el mes.'));
      return;
    }
    content.push(tableOf(['#', 'Descripción', 'Monto'], top.map((x, i) => ([
      { text: String(i + 1), fontSize: 9 },
      { text: x.desc, fontSize: 9 },
      { text: fmt(x.usd), fontSize: 9, alignment: 'right' },
    ]))));
  });

  // ── 8. Cierre ───────────────────────────────────────────────────────────────
  // Sin esta línea, un informe guardado de un mes abierto se lee como definitivo.
  content.push(note(
    `Generado desde Gastos Familiares. Los montos reflejan los movimientos cargados al ` +
    `${fmtFechaHora(new Date())}; movimientos cargados después no están incluidos.`
  ));

  // ── BUILD ───────────────────────────────────────────────────────────────────
  // @ts-expect-error — dynamic import, pdfmake tiene tipos opcionales
  const pdfMakeModule = await import('pdfmake/build/pdfmake');
  // @ts-expect-error
  const pdfFontsModule = await import('pdfmake/build/vfs_fonts');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfMake = (pdfMakeModule as any).default ?? pdfMakeModule;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfMake.vfs = ((pdfFontsModule as any).default ?? pdfFontsModule).pdfMake?.vfs;

  const docDefinition = {
    content,
    pageSize: 'A4',
    pageMargins: [40, 50, 40, 50],
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `Gastos Familiares · ${mesEnLargo(mes)}`, fontSize: 7, color: '#94a3b8', margin: [40, 0, 0, 0] },
        { text: `Pág. ${currentPage} / ${pageCount}`, fontSize: 7, color: '#94a3b8', alignment: 'right', margin: [0, 0, 40, 0] },
      ],
    }),
    styles: {
      portadaTitulo: { fontSize: 22, bold: true, alignment: 'center' },
      portadaMes: { fontSize: 15, alignment: 'center', margin: [0, 8, 0, 8] },
      portadaSub: { fontSize: 11, alignment: 'center', color: '#475569', margin: [0, 2, 0, 2] },
      h1: { fontSize: 14, bold: true },
      h2: { fontSize: 11, bold: true, color: '#1e293b' },
      tableHeader: { bold: true, fontSize: 8, fillColor: '#f1f5f9' },
      note: { fontSize: 7.5, color: '#94a3b8', italics: true },
    },
    defaultStyle: { fontSize: 9, lineHeight: 1.3 },
  };

  const blob: Blob = await new Promise(r => pdfMake.createPdf(docDefinition).getBlob(r));
  const nombre = `gastos-${mes}${soloPorcentajes ? '-sin-montos' : ''}.pdf`;
  const file = new File([blob], nombre, { type: 'application/pdf' });

  // Share sheet nativa donde exista (es una PWA en Android: es el camino natural).
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Gastos ${mes}` });
      return;
    } catch (e) {
      // AbortError = el usuario cerró el share sheet. No es un error: no cae a descarga, porque
      // bajarle un archivo a alguien que acaba de cancelar es peor que no hacer nada.
      if ((e as Error).name === 'AbortError') return;
      console.error('[informeMensual] share falló, cae a descarga:', e);
    }
  }

  // Fallback: descarga local (mismo patrón que patrimonioInforme.ts).
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
