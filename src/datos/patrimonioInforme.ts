import {
  collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp,
  type Timestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import type { Posicion, ActivoFijo, PosicionManual, PatMetrics } from '../types/patrimonio';
import type { SnapshotResumen } from './patrimonio';

// ── Tipos exportados ──────────────────────────────────────────────────────────
export type StressResult = {
  nombre: string;
  perdidaUsd: number;
  perdidaPct: number;
  totalResultante: number;
  total: number;
};

export type OpcionResult = {
  id: string;
  titulo: string;
  descripcion: string;
  liberadoUsd: number;
  total: number;
  riesgos: string[];
  movimientos: { desc: string; deltaUsd: number }[];
  antes: PatMetrics;
  despues: PatMetrics;
};

export type InformeParams = {
  posiciones: Posicion[];
  activosFijos: ActivoFijo[];
  manuales: PosicionManual[];
  historial: SnapshotResumen[];
  tc: number;
  fechaCorrida: string;
  M: PatMetrics;
  stressResults: StressResult[];
  opcionResults: OpcionResult[];
};

export type InformeAnterior = {
  id: string;
  fechaCorrida: string;
  generadoEnISO: string;
  storagePath: string;
  downloadURL: string;
  totalInvertibleUsd: number;
  incluyeSectorial: boolean;
  cantidadAnalisisIA: number;
};

// ── Helpers de formato ────────────────────────────────────────────────────────
const pct = (x: number) => Math.round(x * 100) + '%';
const fmtUsd = (n: number) => `U$S ${Math.round(n).toLocaleString('es-AR')}`;
const fmtFecha = (iso: string) => { const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; };
const semColor = (b: 'verde'|'amarillo'|'rojo') =>
  b === 'verde' ? '#059669' : b === 'amarillo' ? '#D97706' : '#DC2626';
const semDot = (b: 'verde'|'amarillo'|'rojo') =>
  b === 'verde' ? '●' : b === 'amarillo' ? '●' : '●';

function banda(m: 'nombre'|'sector'|'pais'|'cripto'|'hhi', v: number): 'verde'|'amarillo'|'rojo' {
  const MAP = { nombre:[0.05,0.10], sector:[0.25,0.40], pais:[0.40,0.60], cripto:[0.10,0.20], hhi:[0.15,0.25] };
  const [b0,b1] = MAP[m];
  return v <= b0 ? 'verde' : v <= b1 ? 'amarillo' : 'rojo';
}

// ── Constructores de secciones pdfmake ────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Content = any;

function h1(text: string): Content {
  return { text, style: 'h1', margin: [0, 0, 0, 10] };
}
function h2(text: string): Content {
  return { text, style: 'h2', margin: [0, 16, 0, 6] };
}
function note(text: string): Content {
  return { text, style: 'note', margin: [0, 4, 0, 0] };
}
function pageBreak(): Content {
  return { text: '', pageBreak: 'before' };
}

function tableOf(headers: string[], rows: Content[][]): Content {
  return {
    table: {
      headerRows: 1,
      widths: headers.map(() => '*'),
      body: [
        headers.map(h => ({ text: h, style: 'tableHeader' })),
        ...rows,
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 4, 0, 8],
  };
}

function semRow(label: string, sub: string, val: string, b: 'verde'|'amarillo'|'rojo'): Content[] {
  return [
    { text: label, fontSize: 9 },
    { text: sub, fontSize: 8, color: '#64748b' },
    { stack: [{ text: `${semDot(b)} ${val}`, color: semColor(b), bold: true, fontSize: 9 }] },
  ];
}

// ── Cargar informes anteriores ────────────────────────────────────────────────
export async function cargarInformesAnteriores(limite = 10): Promise<InformeAnterior[]> {
  const snap = await getDocs(
    query(collection(db, 'informesPortafolio'), orderBy('generadoEn', 'desc'), limit(limite))
  );
  return snap.docs.map(d => {
    const data = d.data();
    const ts = data.generadoEn as Timestamp | null;
    return {
      id: d.id,
      fechaCorrida: (data.fechaCorrida as string) ?? '',
      generadoEnISO: ts?.toDate?.()?.toISOString() ?? '',
      storagePath: (data.storagePath as string) ?? '',
      downloadURL: (data.downloadURL as string) ?? '',
      totalInvertibleUsd: (data.totalInvertibleUsd as number) ?? 0,
      incluyeSectorial: (data.incluyeSectorial as boolean) ?? false,
      cantidadAnalisisIA: (data.cantidadAnalisisIA as number) ?? 0,
    };
  });
}

// ── Generador y archivador ────────────────────────────────────────────────────
export async function generarYArchivarInforme(params: InformeParams): Promise<InformeAnterior> {
  const { posiciones, activosFijos, manuales, historial, tc, fechaCorrida, M, stressResults, opcionResults } = params;

  const fijosUsd = activosFijos.reduce((s, a) => s + a.valorUsd, 0);
  const patrimTotal = M.total + fijosUsd;
  const corrPrev = historial.length > 1 ? historial[1] : null;
  const deltaInv = corrPrev ? M.total - corrPrev.totalInvertibleUsd : null;
  const generadoEn = new Date().toISOString();

  // Cargar análisis IA cacheados
  const [analisisSnap, sectorialSnap] = await Promise.all([
    getDocs(collection(db, 'analisisPosiciones')),
    getDocs(query(collection(db, 'analisisSectorial'), orderBy('generadoEn', 'desc'), limit(1))),
  ]);
  type AnalisisDoc = { resultado?: Record<string, unknown>; generadoEn?: Timestamp | null; modeloUsado?: string };
  const analisisList = analisisSnap.docs.map(d => ({ ticker: d.id, ...(d.data() as AnalisisDoc) }));
  const sectorial = sectorialSnap.empty ? null : sectorialSnap.docs[0].data();

  // Agrupar posiciones por cuenta para sección 5
  const byCuenta: Record<string, Posicion[]> = {};
  for (const p of posiciones) {
    (byCuenta[p.cuenta] ??= []).push(p);
  }

  // Liquidez por tipo
  const LIQUIDEZ: Record<string, string> = {
    accion: 't+1 a t+3 hábiles', cedear: 't+1 a t+3 hábiles',
    bono: 't+1 hábiles', on: 't+1 hábiles',
    fci: 't+0 / 24h', cripto: 'inmediato (24hs)', cash: 'inmediato',
  };
  const byTipoLiquidez: Record<string, number> = {};
  for (const p of posiciones) {
    (byTipoLiquidez[p.tipo] ??= 0);
    byTipoLiquidez[p.tipo] += p.valorUsd;
  }

  // Semáforos en rojo/amarillo para resumen ejecutivo
  const allSems: { label: string; val: string; b: 'verde'|'amarillo'|'rojo' }[] = [
    { label: `Nombre más grande (${M.nombreTop.ticker})`, val: pct(M.top1), b: banda('nombre', M.top1) },
    { label: `Sector top (${M.sectorTop.nombre})`, val: pct(M.sectorTop.pct), b: banda('sector', M.sectorTop.pct) },
    { label: 'País AR', val: pct(M.paisAr), b: banda('pais', M.paisAr) },
    { label: 'Cripto', val: pct(M.cripto), b: banda('cripto', M.cripto) },
    { label: 'HHI', val: M.hhi.toFixed(2), b: banda('hhi', M.hhi) },
  ];
  const alertas = allSems.filter(s => s.b !== 'verde');

  // ── DOCUMENT DEFINITION ───────────────────────────────────────────────────
  const content: Content[] = [];

  // 1. Portada
  content.push(
    { text: 'Informe de Patrimonio — Familia', style: 'portadaTitulo', margin: [0, 60, 0, 16] },
    { text: `Corrida: ${fmtFecha(fechaCorrida)}`, style: 'portadaSub' },
    { text: `Generado: ${fmtFecha(generadoEn.slice(0, 10))}`, style: 'portadaSub' },
    { text: `TC: $ ${tc.toLocaleString('es-AR')}`, style: 'portadaSub', margin: [0, 2, 0, 20] },
    {
      table: { widths: ['*', '*'], body: [
        [{ text: 'Total financiero', style: 'tableHeader' }, { text: 'Total patrimonio', style: 'tableHeader' }],
        [{ text: fmtUsd(M.total), fontSize: 14, bold: true }, { text: fmtUsd(patrimTotal), fontSize: 14, bold: true }],
      ]}, layout: 'lightHorizontalLines', margin: [0, 0, 0, 0],
    },
  );

  // 2. Resumen ejecutivo
  content.push(pageBreak(), h1('1. Resumen ejecutivo'));
  if (deltaInv !== null && corrPrev) {
    const signo = deltaInv >= 0 ? '+' : '';
    const deltaPct = corrPrev.totalInvertibleUsd > 0 ? deltaInv / corrPrev.totalInvertibleUsd : 0;
    content.push({ text: `Variación vs corrida anterior (${fmtFecha(corrPrev.fechaCorrida)}): ${signo}${fmtUsd(deltaInv)} (${signo}${pct(deltaPct)})`, margin: [0, 0, 0, 8] });
  }
  if (alertas.length === 0) {
    content.push({ text: 'Todos los indicadores en verde.', color: '#059669', bold: true, margin: [0, 0, 0, 8] });
  } else {
    content.push({ text: 'Indicadores fuera de banda verde:', bold: true, margin: [0, 0, 0, 4] });
    content.push(tableOf(['Métrica', 'Valor', 'Banda'],
      alertas.map(a => [
        { text: a.label, fontSize: 9 },
        { text: a.val, bold: true, color: semColor(a.b) },
        { text: a.b === 'amarillo' ? 'Amarillo' : 'Rojo', color: semColor(a.b), bold: true, fontSize: 9 },
      ])
    ));
  }
  const hallazdoDominante = alertas.find(a => a.b === 'rojo') ?? alertas[0];
  if (hallazdoDominante) {
    content.push({ text: `Hallazgo dominante: ${hallazdoDominante.label} en ${hallazdoDominante.val}.`, italics: true, margin: [0, 0, 0, 0] });
  }

  // 3. Evolución
  content.push(h2('2. Evolución entre corridas'));
  if (historial.length > 1) {
    content.push(tableOf(['Fecha', 'Total invertible', 'Δ%'],
      historial.map((s, i) => {
        const prev = historial[i + 1];
        const delta = prev ? s.totalInvertibleUsd - prev.totalInvertibleUsd : null;
        const deltaPct = delta !== null && prev!.totalInvertibleUsd > 0
          ? delta / prev!.totalInvertibleUsd : null;
        return [
          { text: fmtFecha(s.fechaCorrida) + (i === 0 ? ' (hoy)' : ''), fontSize: 9 },
          { text: fmtUsd(s.totalInvertibleUsd), fontSize: 9, alignment: 'right' },
          delta !== null ? { text: (delta >= 0 ? '+' : '') + pct(deltaPct!), color: delta >= 0 ? '#059669' : '#DC2626', fontSize: 9 } : { text: '—', fontSize: 9 },
        ];
      })
    ));
    content.push(note('La variación refleja cambio de valor, no retorno: no descuenta aportes ni retiros entre corridas.'));
  } else {
    content.push({ text: 'Solo una corrida registrada. Próxima corrida mostrará evolución.', style: 'note' });
  }

  // 4. Composición
  content.push(h2('3. Composición'));
  content.push({ text: 'Por sector:', bold: true, fontSize: 9, margin: [0, 4, 0, 2] });
  content.push(tableOf(['Sector', 'USD', '%'],
    Object.entries(M.bySector).sort((a,b) => b[1]-a[1]).map(([k,v]) => [
      { text: k, fontSize: 9 },
      { text: fmtUsd(v), fontSize: 9, alignment: 'right' },
      { text: pct(v / M.total), fontSize: 9, alignment: 'right' },
    ])
  ));
  content.push({ text: 'Por clase de activo:', bold: true, fontSize: 9, margin: [0, 4, 0, 2] });
  content.push(tableOf(['Tipo', 'USD', '%'],
    Object.entries(M.byTipo).sort((a,b) => b[1]-a[1]).map(([k,v]) => [
      { text: k, fontSize: 9 },
      { text: fmtUsd(v), fontSize: 9, alignment: 'right' },
      { text: pct(v / M.total), fontSize: 9, alignment: 'right' },
    ])
  ));
  content.push({ text: `País de riesgo: AR ${pct(M.paisAr)} · Global ${pct(1 - M.paisAr)}`, fontSize: 9, margin: [0, 4, 0, 0] });

  // 5. Tenencias completas
  content.push(pageBreak(), h1('4. Tenencias completas'));
  for (const [cuenta, pos] of Object.entries(byCuenta)) {
    content.push({ text: cuenta, bold: true, fontSize: 10, margin: [0, 8, 0, 2] });
    content.push(tableOf(['Ticker', 'Tipo', 'Sector', 'Cant.', 'USD', '%'],
      pos.map(p => [
        { text: p.ticker + (p.revisar ? ' ⚠' : ''), fontSize: 8, bold: true },
        { text: p.tipo, fontSize: 8 },
        { text: `${p.sector}/${p.pais_riesgo}`, fontSize: 8 },
        { text: p.cantidad != null ? p.cantidad.toLocaleString('es-AR') : '—', fontSize: 8, alignment: 'right' },
        { text: fmtUsd(p.valorUsd), fontSize: 8, alignment: 'right' },
        { text: pct(p.valorUsd / M.total), fontSize: 8, alignment: 'right' },
      ])
    ));
  }
  if (manuales.length > 0) {
    content.push({ text: 'Posiciones manuales', bold: true, fontSize: 10, margin: [0, 8, 0, 2] });
    content.push(tableOf(['Ticker', 'Cuenta', 'Cant.', 'USD', 'Valuado'],
      manuales.map(m => [
        { text: m.ticker, fontSize: 8, bold: true },
        { text: m.cuenta, fontSize: 8 },
        { text: m.cantidad.toLocaleString('es-AR'), fontSize: 8, alignment: 'right' },
        { text: fmtUsd(m.valorUsd), fontSize: 8, alignment: 'right' },
        { text: fmtFecha(m.fechaValuacion), fontSize: 8 },
      ])
    ));
  }
  if (activosFijos.length > 0) {
    content.push({ text: 'Activos fijos — fuera del análisis de riesgo', bold: true, fontSize: 10, margin: [0, 8, 0, 2] });
    content.push(tableOf(['Nombre', 'USD'],
      activosFijos.map(af => [
        { text: af.nombre, fontSize: 8 },
        { text: fmtUsd(af.valorUsd), fontSize: 8, alignment: 'right' },
      ])
    ));
  }

  // 6. Métricas y semáforos
  content.push(pageBreak(), h1('5. Métricas y semáforos'));
  content.push({
    table: { headerRows: 1, widths: ['*', 60, '*', 80],
      body: [
        [
          { text: 'Métrica', style: 'tableHeader' },
          { text: 'Valor', style: 'tableHeader' },
          { text: 'Banda verde / amarillo / rojo', style: 'tableHeader' },
          { text: 'Estado', style: 'tableHeader' },
        ],
        ...([
          { m: 'nombre' as const, label: `Nombre más grande (${M.nombreTop.ticker})`, val: pct(M.top1), band: '≤5% · 5–10% · >10%' },
          { m: 'sector' as const, label: `Sector top (${M.sectorTop.nombre})`, val: pct(M.sectorTop.pct), band: '<25% · 25–40% · >40%' },
          { m: 'pais' as const, label: 'País AR', val: pct(M.paisAr), band: '<40% · 40–60% · >60%' },
          { m: 'cripto' as const, label: 'Cripto (clase)', val: pct(M.cripto), band: '<10% · 10–20% · >20%' },
          { m: 'hhi' as const, label: 'HHI', val: M.hhi.toFixed(3), band: '<0,15 · 0,15–0,25 · >0,25' },
        ]).map(r => {
          const b = banda(r.m, r.m === 'hhi' ? M.hhi : r.m === 'nombre' ? M.top1 : r.m === 'sector' ? M.sectorTop.pct : r.m === 'pais' ? M.paisAr : M.cripto);
          return [
            { text: r.label, fontSize: 8 },
            { text: r.val, fontSize: 9, bold: true },
            { text: r.band, fontSize: 7.5, color: '#64748b' },
            { text: `${semDot(b)} ${b[0].toUpperCase() + b.slice(1)}`, color: semColor(b), bold: true, fontSize: 9 },
          ];
        }),
        [{ text: `Top-3: ${pct(M.top3)} · Top-5: ${pct(M.top5)} · RV: ${pct(M.rvPct)} (informativo, sin semáforo)`, colSpan: 4, fontSize: 8, color: '#64748b' }, {},{},{}],
      ],
    },
    layout: 'lightHorizontalLines', margin: [0, 4, 0, 8],
  });
  content.push(note('El HHI puede dar verde mientras un sector concentra: por eso se miran varias métricas.'));

  // 7. Liquidez
  content.push(h2('6. Liquidez estimada'));
  const liqRows: Content[][] = Object.entries(byTipoLiquidez).map(([tipo, usd]) => [
    { text: tipo, fontSize: 9 },
    { text: fmtUsd(usd), fontSize: 9, alignment: 'right' },
    { text: LIQUIDEZ[tipo] ?? 'a confirmar', fontSize: 9 },
  ]);
  if (manuales.length > 0) {
    const totalManuales = manuales.reduce((s,m) => s+m.valorUsd, 0);
    liqRows.push([{ text: 'manual', fontSize: 9 }, { text: fmtUsd(totalManuales), fontSize: 9, alignment: 'right' }, { text: 'según cuenta origen (a confirmar)', fontSize: 9 }]);
  }
  if (activosFijos.length > 0) {
    const totalFijos = activosFijos.reduce((s,a) => s+a.valorUsd, 0);
    liqRows.push([{ text: 'fijos', fontSize: 9 }, { text: fmtUsd(totalFijos), fontSize: 9, alignment: 'right' }, { text: 'ilíquido', fontSize: 9, color: '#DC2626' }]);
  }
  content.push(tableOf(['Clase', 'USD', 'Días a USD'], liqRows));

  // 8. Escenarios de estrés
  content.push(h2('7. Escenarios de estrés'));
  content.push(tableOf(['Escenario', 'Pérdida USD', '% cartera', 'Resultante USD'],
    stressResults.map(s => [
      { text: s.nombre, fontSize: 9 },
      { text: fmtUsd(s.perdidaUsd), color: '#DC2626', bold: true, fontSize: 9 },
      { text: pct(s.perdidaPct), color: '#DC2626', bold: true, fontSize: 9 },
      { text: fmtUsd(s.totalResultante), fontSize: 9 },
    ])
  ));
  content.push(note('Escenarios ilustrativos con shocks fijos. No son predicciones ni probabilidades.'));

  // 9. Opciones de rebalanceo
  content.push(pageBreak(), h1('8. Opciones de rebalanceo'));
  content.push({ text: 'Opciones medidas, no recomendaciones.', italics: true, margin: [0, 0, 0, 8] });
  for (const o of opcionResults) {
    content.push({ text: `Opción ${o.id}: ${o.titulo}`, bold: true, fontSize: 10, margin: [0, 10, 0, 2] });
    content.push({ text: o.descripcion, fontSize: 9, color: '#475569', margin: [0, 0, 0, 4] });
    if (o.liberadoUsd > 0) {
      content.push(tableOf(['Movimiento', 'Delta USD'],
        o.movimientos.map(m => [
          { text: m.desc, fontSize: 8 },
          { text: (m.deltaUsd >= 0 ? '+' : '') + fmtUsd(m.deltaUsd), color: m.deltaUsd >= 0 ? '#059669' : '#DC2626', fontSize: 8 },
        ])
      ));
    } else {
      content.push({ text: 'Todas las posiciones ya están bajo el target.', fontSize: 8, color: '#64748b', margin: [0,0,0,4] });
    }
    const metricas = [
      { label: `País AR`, av: o.antes.paisAr, dv: o.despues.paisAr, b: 'pais' as const },
      { label: 'Cripto', av: o.antes.cripto, dv: o.despues.cripto, b: 'cripto' as const },
      { label: `Top-1 (${o.despues.nombreTop.ticker})`, av: o.antes.top1, dv: o.despues.top1, b: 'nombre' as const },
      { label: 'HHI', av: o.antes.hhi, dv: o.despues.hhi, b: 'hhi' as const },
    ];
    content.push(tableOf(['Métrica', 'Antes', 'Después'],
      metricas.map(m => {
        const ba = banda(m.b, m.av), bd = banda(m.b, m.dv);
        return [
          { text: m.label, fontSize: 8 },
          { text: `${semDot(ba)} ${pct(m.av)}`, color: semColor(ba), fontSize: 8 },
          { text: `${semDot(bd)} ${pct(m.dv)}`, color: semColor(bd), fontSize: 8, bold: bd !== ba },
        ];
      })
    ));
    content.push({ text: 'Riesgos de esta opción:', bold: true, fontSize: 8, margin: [0, 2, 0, 1] });
    content.push({ ul: o.riesgos, fontSize: 8, color: '#475569', margin: [0, 0, 0, 4] });
  }

  // 10. Análisis IA por posición
  content.push(pageBreak(), h1('9. Análisis por posición (IA)'));
  if (analisisList.length === 0) {
    content.push({ text: 'Sin análisis IA generados a la fecha. Generarlos desde la solapa Tenencias.', style: 'note' });
  } else {
    for (const a of analisisList) {
      const res = a.resultado as Record<string, unknown> ?? {};
      const ts = a.generadoEn as Timestamp | null;
      const fecha = ts?.toDate?.()?.toISOString().slice(0, 10) ?? '';
      content.push({ text: `${a.ticker as string}`, bold: true, fontSize: 10, margin: [0, 10, 0, 1] });
      content.push({ text: `Análisis del ${fmtFecha(fecha)} · Modelo: ${(a.modeloUsado as string) ?? '—'}`, style: 'note', margin: [0, 0, 0, 4] });
      if (res.queEs) content.push({ text: [{ text: 'Qué es: ', bold: true }, String(res.queEs)], fontSize: 8, margin: [0, 2, 0, 2] });
      if (res.situacionActual) content.push({ text: [{ text: 'Situación actual: ', bold: true }, String(res.situacionActual)], fontSize: 8, margin: [0, 2, 0, 2] });
      if (Array.isArray(res.riesgos) && res.riesgos.length > 0)
        content.push({ text: 'Riesgos:', bold: true, fontSize: 8 }, { ul: res.riesgos as string[], fontSize: 8, margin: [0, 0, 0, 2] });
      if (res.rolEnCartera) content.push({ text: [{ text: 'Rol en cartera: ', bold: true }, String(res.rolEnCartera)], fontSize: 8, margin: [0, 2, 0, 2] });
      if (Array.isArray(res.proximosEventos) && res.proximosEventos.length > 0)
        content.push({ text: 'Próximos eventos:', bold: true, fontSize: 8 }, { ul: res.proximosEventos as string[], fontSize: 8, margin: [0, 0, 0, 2] });
    }
  }

  // 11. Panorama sectorial
  content.push(pageBreak(), h1('10. Panorama sectorial (IA)'));
  if (!sectorial) {
    content.push({ text: 'Sin panorama sectorial generado a la fecha. Generarlo desde la solapa Research.', style: 'note' });
  } else {
    const ts = sectorial.generadoEn as Timestamp | null;
    const fecha = ts?.toDate?.()?.toISOString().slice(0, 10) ?? '';
    content.push({ text: `Generado el ${fmtFecha(fecha)} · Modelo: ${(sectorial.modeloUsado as string) ?? '—'}`, style: 'note', margin: [0, 0, 0, 6] });
    const res = sectorial.resultado as string ?? '';
    content.push({ text: res, fontSize: 8, lineHeight: 1.4 });
  }

  // 12. Metodología y límites
  content.push(pageBreak(), h1('11. Metodología y límites'));
  const fuentesCorrida = [...new Set(posiciones.map(p => p.fuente).filter(Boolean))];
  content.push({
    ul: [
      `Fuentes de la corrida: ${fuentesCorrida.join(', ') || '—'}`,
      `Tipo de cambio: $ ${tc.toLocaleString('es-AR')} (fuente: tcDiario de la app)`,
      `Posiciones manuales: ${manuales.length} posiciones valuadas a la fecha indicada en cada una`,
      `Activos fijos: no entran al análisis de riesgo (lente invertible separada)`,
      'Límite: el cambio de valor entre corridas no es retorno real; no descuenta aportes ni retiros (se corregirá en F9.96)',
      'Límite: precios a la fecha de la corrida; la valuación de manuales puede estar desactualizada',
      `Análisis IA: ${analisisList.length} posición(es) con análisis cacheado; la antigüedad varía por ticker`,
    ],
    fontSize: 8, lineHeight: 1.5, margin: [0, 4, 0, 12],
  });
  content.push({ text: 'Disclaimer: Este informe es de uso familiar e informativo, no constituye asesoramiento financiero profesional. Las decisiones de inversión son responsabilidad exclusiva del titular.', fontSize: 7.5, italics: true, color: '#64748b' });

  // ── BUILD PDF ─────────────────────────────────────────────────────────────
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
        { text: 'Confidencial — uso familiar', fontSize: 7, color: '#94a3b8', margin: [40, 0, 0, 0] },
        { text: `Pág. ${currentPage} / ${pageCount}`, fontSize: 7, color: '#94a3b8', alignment: 'right', margin: [0, 0, 40, 0] },
      ],
    }),
    styles: {
      portadaTitulo: { fontSize: 22, bold: true, alignment: 'center' },
      portadaSub: { fontSize: 11, alignment: 'center', color: '#475569', margin: [0, 2, 0, 2] },
      h1: { fontSize: 14, bold: true },
      h2: { fontSize: 11, bold: true, color: '#1e293b' },
      tableHeader: { bold: true, fontSize: 8, fillColor: '#f1f5f9' },
      note: { fontSize: 7.5, color: '#94a3b8', italics: true },
    },
    defaultStyle: { fontSize: 9, lineHeight: 1.3 },
  };

  const blob: Blob = await new Promise((resolve) => pdfMake.createPdf(docDefinition).getBlob(resolve));

  // Descarga local
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `patrimonio-${fechaCorrida}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Upload a Storage
  const storagePath = `patrimonio/informes/${fechaCorrida}-${Date.now()}.pdf`;
  const storageRef = ref(storage, storagePath);
  const { ref: uploadedRef } = await uploadBytes(storageRef, blob, { contentType: 'application/pdf' });
  const downloadURL = await getDownloadURL(uploadedRef);

  // Archivar en Firestore (idempotencia: storagePath único por timestamp)
  const docRef = await addDoc(collection(db, 'informesPortafolio'), {
    fechaCorrida,
    generadoEn: serverTimestamp(),
    storagePath,
    downloadURL,
    totalInvertibleUsd: M.total,
    incluyeSectorial: !!sectorial,
    cantidadAnalisisIA: analisisList.length,
  });

  return {
    id: docRef.id,
    fechaCorrida,
    generadoEnISO: generadoEn,
    storagePath,
    downloadURL,
    totalInvertibleUsd: M.total,
    incluyeSectorial: !!sectorial,
    cantidadAnalisisIA: analisisList.length,
  };
}
