import { useState, useEffect } from 'react';
import { Timestamp } from 'firebase/firestore';
import { cargarTCReciente } from '../datos/tcDiario';
import { TC_DEFAULT } from '../datos/money';
import { Card, MerchantLogo } from '../design-system/components';
import { Icon } from '../design-system/Icon';
import {
  cargarPosicionesVigentes, cargarActivosFijos, cargarPosicionesManuales,
  cargarHistorialSnapshots,
  guardarActivoFijo, eliminarActivoFijo,
  guardarPosicionManual, eliminarPosicionManual,
  type SnapshotResumen,
} from '../datos/patrimonio';
import {
  generarYArchivarInforme, cargarInformesAnteriores,
  type InformeAnterior, type StressResult, type OpcionResult,
} from '../datos/patrimonioInforme';
import {
  analizarPosicion, analizarSectorial, generarAgenda,
  cargarAnalisisPosicion, cargarTodosLosAnalisis, cargarUltimoSectorial, cargarUltimaAgenda,
  cargarConfigIA, guardarConfigIA,
  normalizarEventoProximo,
  generarPromptIA, importarAnalisisIA,
  type AnalisisPosicion, type AnalisisSectorial, type ConfigIA,
  type AgendaMacro, type EventoAgenda, type ModoIA,
} from '../datos/patrimonioIA';
import {
  obtenerSeriesPrecios, calcularOptimizacion, cargarTCRango, dolarizarSerie, correrTests,
  cargarUltimaOptimizacion, guardarOptimizacion,
  type ResultadoOptimizacion, type PuntoPrecio,
} from '../datos/patrimonioOptimizacion';
import type { Posicion, ActivoFijo, PosicionManual, PosicionTipo, PatMetrics } from '../types/patrimonio';
import {
  cargarFlujos, crearFlujo, actualizarFlujo, eliminarFlujo, calcRetorno,
  type FlujoPatrimonio, type NuevoFlujo,
} from '../datos/patrimonioFlujos';
import {
  cargarDecisiones, crearDecision, agregarRevision, revisionPendiente,
  type DecisionPatrimonio, type NuevaDecision, type MetricasSnap,
} from '../datos/patrimonioDecisiones';
import {
  cargarConfigCafci, guardarConfigCafci, cargarUltimasCarteras, cargarMappings,
  sincronizarCafci as sincronizarCafciCallable, calcBenchmark,
  type ConfigCafci, type CafciCartera, type CafciFondoConfig,
} from '../datos/patrimonioCafci';
import PatrimonioIngesta from './PatrimonioIngesta';

// ── Sector crudo → display ────────────────────────────────────────────────────
const SECTOR_DISPLAY: Record<string, string> = {
  energia:             'Energía',
  bancos:              'Bancos',
  cripto:              'Cripto',
  cer_pesos:           'Renta fija',
  deuda_soberana_ar:   'Renta fija',
  deuda_soberana_usd:  'Renta fija',
  on:                  'ONs',
  cash:                'Cash',
  tecnologia:          'Tecnología',
  tech:                'Tecnología',
  consumo:             'Consumo',
  real_estate:         'Real Estate',
  materiales:          'Materiales',
  agro:                'Agro',
  fci:                 'FCI',
  global:              'Global',
};

function sectorDisplay(sector: string, pais_riesgo: string): string {
  const base = SECTOR_DISPLAY[sector] ?? sector;
  if (sector === 'cripto' || sector === 'cash' || sector === 'global') return base;
  return base + (pais_riesgo === 'AR' ? ' AR' : pais_riesgo === 'global' ? ' Global' : '');
}

const SECTOR_COL: Record<string, string> = {
  'Energía AR':       '#f5a623',
  'Energía Global':   '#f7c843',
  'Cripto':           '#f7931a',
  'Renta fija AR':    '#4f8ef7',
  'Renta fija Global':'#7ba7f7',
  'Bancos AR':        '#2bb673',
  'ONs AR':           '#6366f1',
  'Cash':             '#94a3b8',
  'Tecnología Global':'#a855f7',
  'Global':           '#a855f7',
  'Consumo AR':       '#ec4899',
  'FCI AR':           '#14b8a6',
};
function sectorColor(disp: string): string { return SECTOR_COL[disp] ?? '#8b8b8b'; }

// ── Snapshot de métricas para decisiones ──────────────────────────────────────
function buildMetricasSnap(M: PatMetrics, todasPosiciones: Posicion[]): MetricasSnap {
  const byTicker: Record<string, number> = {};
  for (const p of todasPosiciones) byTicker[p.ticker] = (byTicker[p.ticker] ?? 0) + p.valorUsd;
  return {
    totalInvertibleUsd: Math.round(M.total),
    energiaArPct: (M.bySector['Energía AR'] ?? 0) / (M.total || 1),
    paisArPct: M.paisAr,
    criptoPct: M.cripto,
    top1Ticker: M.nombreTop.ticker,
    top1Pct: M.top1,
    hhi: M.hhi,
    valoresTickers: Object.fromEntries(Object.entries(byTicker).map(([k, v]) => [k, Math.round(v)])),
  };
}

const UMBRAL_OTROS = 0.019;

// ── Labels ────────────────────────────────────────────────────────────────────
const TIPO_LABEL: Record<string, string> = {
  accion: 'Acción', bono: 'Bono', on: 'ON', cedear: 'CEDEAR',
  fci: 'FCI', cripto: 'Cripto', cash: 'Cash',
};

// ── Formateo ──────────────────────────────────────────────────────────────────
function fmtUsd(n: number): string { return `U$S ${Math.round(n).toLocaleString('es-AR')}`; }
function fmtArs(n: number, tc: number): string { return `$ ${Math.round(n * tc).toLocaleString('es-AR')}`; }
function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
const pct = (x: number) => Math.round(x * 100) + '%';

// ── Motor de métricas (lente invertible, agrega manuales) ────────────────────

// Convierte PosicionManual a Posicion para métricas
function manualToPosicion(m: PosicionManual): Posicion {
  return {
    ticker: m.ticker, tipo: m.tipo, sector: m.sector,
    pais_riesgo: m.pais_riesgo, cuenta: m.cuenta,
    titular: null, moneda_origen: 'USD', valor_origen: m.valorUsd,
    cantidad: m.cantidad, fuente: 'manual', revisar: false,
    valorUsd: m.valorUsd, tcUsado: null, fechaCorrida: m.fechaValuacion,
  };
}

function calcMetrics(posiciones: Posicion[]): PatMetrics {
  const total = posiciones.reduce((s, p) => s + p.valorUsd, 0);
  const bySector: Record<string, number> = {};
  const byTipo:   Record<string, number> = {};
  const byPais = { AR: 0, global: 0 };

  for (const p of posiciones) {
    const sec = sectorDisplay(p.sector, p.pais_riesgo);
    bySector[sec]  = (bySector[sec]  ?? 0) + p.valorUsd;
    byTipo[p.tipo] = (byTipo[p.tipo] ?? 0) + p.valorUsd;
    byPais[p.pais_riesgo] += p.valorUsd;
  }

  // Concentración por ticker (GLOB CEDEAR + GLOB manual se suman)
  const byTickerAll: Record<string, number> = {};
  const byTickerNoCripto: Record<string, number> = {};
  for (const p of posiciones) {
    byTickerAll[p.ticker] = (byTickerAll[p.ticker] ?? 0) + p.valorUsd;
    if (p.tipo !== 'cripto') byTickerNoCripto[p.ticker] = (byTickerNoCripto[p.ticker] ?? 0) + p.valorUsd;
  }
  const tickerAllEntries    = Object.entries(byTickerAll).sort((a, b) => b[1] - a[1]);
  const tickerNoCriptoEntries = Object.entries(byTickerNoCripto).sort((a, b) => b[1] - a[1]);

  const top1Entry = tickerNoCriptoEntries[0] ?? tickerAllEntries[0] ?? ['—', 0];
  const top1 = total > 0 ? top1Entry[1] / total : 0;
  const top3 = total > 0 ? tickerAllEntries.slice(0, 3).reduce((s, [, v]) => s + v, 0) / total : 0;
  const top5 = total > 0 ? tickerAllEntries.slice(0, 5).reduce((s, [, v]) => s + v, 0) / total : 0;
  const hhi  = total > 0 ? tickerAllEntries.reduce((s, [, v]) => s + (v / total) ** 2, 0) : 0;

  const sectorEntry = Object.entries(bySector).sort((a, b) => b[1] - a[1])[0] ?? ['—', 0];
  const cripto = total > 0 ? (byTipo.cripto ?? 0) / total : 0;
  const rvUsd  = posiciones
    .filter(p => p.tipo === 'accion' || p.tipo === 'cedear' || p.tipo === 'cripto')
    .reduce((s, p) => s + p.valorUsd, 0);

  return {
    total, bySector, byTipo, byPais,
    nombreTop: { ticker: top1Entry[0] },
    top1, top3, top5, hhi,
    sectorTop: { nombre: sectorEntry[0], pct: total > 0 ? sectorEntry[1] / total : 0 },
    paisAr: total > 0 ? byPais.AR / total : 0,
    cripto, rvPct: total > 0 ? rvUsd / total : 0,
  };
}

// ── Semáforos ─────────────────────────────────────────────────────────────────
type BandaNombre = 'nombre' | 'sector' | 'pais' | 'cripto' | 'hhi';
const BANDAS: Record<BandaNombre, [number, number]> = {
  nombre: [0.05, 0.10],
  sector: [0.25, 0.40],
  pais:   [0.40, 0.60],
  cripto: [0.10, 0.20],
  hhi:    [0.15, 0.25],
};
function banda(m: BandaNombre, v: number): 'verde' | 'amarillo' | 'rojo' {
  const [b0, b1] = BANDAS[m];
  return v <= b0 ? 'verde' : v <= b1 ? 'amarillo' : 'rojo';
}
const SEM = {
  verde:    { dot: 'var(--gf-emerald)',  bg: 'var(--gf-emerald-50)' },
  amarillo: { dot: 'var(--gf-out)',      bg: 'var(--gf-gray-100)' },
  rojo:     { dot: 'var(--gf-expense)',  bg: 'var(--gf-gray-100)' },
} as const;

// ── Escenarios de estrés ──────────────────────────────────────────────────────
const STABLECOINS = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD']);
type ShockFn = (p: Posicion) => number;

const STRESS_ESCENARIOS: { id: string; nombre: string; shock: ShockFn }[] = [
  {
    id: 'energia_ar',
    nombre: 'Corrección energía AR',
    shock: p => (p.sector === 'energia' && p.pais_riesgo === 'AR' && p.tipo === 'accion' ? -0.30 : 0),
  },
  {
    id: 'cripto',
    nombre: 'Invierno cripto',
    shock: p => (p.tipo === 'cripto' && !STABLECOINS.has(p.ticker) ? -0.50 : 0),
  },
  {
    id: 'soberano_ar',
    nombre: 'Evento soberano AR',
    shock: p => {
      if (p.pais_riesgo !== 'AR') return 0;
      if (p.tipo === 'accion' || p.tipo === 'cedear') return -0.40;
      if (p.tipo === 'bono' || p.tipo === 'on') return -0.25;
      if (p.tipo === 'fci') return -0.30;
      return 0;
    },
  },
  {
    id: 'tormenta',
    nombre: 'Tormenta perfecta',
    shock: p => {
      let s = 0;
      if (p.pais_riesgo === 'AR') {
        if (p.tipo === 'accion' || p.tipo === 'cedear') s = -0.40;
        else if (p.tipo === 'bono' || p.tipo === 'on') s = -0.25;
        else if (p.tipo === 'fci') s = -0.30;
      }
      if (p.tipo === 'cripto' && !STABLECOINS.has(p.ticker)) s = -0.50;
      return s;
    },
  },
];

function calcStress(posiciones: Posicion[], shockFn: ShockFn) {
  const total = posiciones.reduce((s, p) => s + p.valorUsd, 0);
  const perdidaUsd = posiciones.reduce((s, p) => s + p.valorUsd * shockFn(p), 0);
  return { perdidaUsd, totalResultante: total + perdidaUsd, total };
}

// ── Simulación de opciones de rebalanceo ──────────────────────────────────────
type Corte = { tipo: 'ticker' | 'sector'; key: string; targetPct: number };
type Redespliegue = { ticker: string; tipo: PosicionTipo; sector: string; pais_riesgo: 'AR' | 'global'; fraccion: number };
type OpcionConfig = {
  id: 'A' | 'B' | 'C';
  titulo: string;
  descripcion: string;
  cortes: Corte[];
  redespliegues: Redespliegue[];
  riesgos: string[];
};

const OPCIONES_CONFIG: OpcionConfig[] = [
  {
    id: 'A',
    titulo: 'Recorte mínimo',
    descripcion: 'TRAN al 8% y PAMP al 6%; liberado → RV global',
    cortes: [
      { tipo: 'ticker', key: 'TRAN', targetPct: 0.08 },
      { tipo: 'ticker', key: 'PAMP', targetPct: 0.06 },
    ],
    redespliegues: [
      { ticker: 'RV Global', tipo: 'accion', sector: 'global', pais_riesgo: 'global', fraccion: 1.0 },
    ],
    riesgos: [
      'Costo impositivo: TRAN y PAMP son ganadoras en USD.',
      'Upside resignado si energía AR continúa subiendo.',
      'Nuevo riesgo: exposición a mercado global.',
    ],
  },
  {
    id: 'B',
    titulo: 'Diversificar dentro de AR',
    descripcion: 'Energía AR al 35%; liberado mitad a otros sectores AR, mitad a RV global',
    cortes: [
      { tipo: 'sector', key: 'Energía AR', targetPct: 0.35 },
    ],
    redespliegues: [
      { ticker: 'RV AR otros', tipo: 'accion', sector: 'consumo', pais_riesgo: 'AR', fraccion: 0.5 },
      { ticker: 'RV Global',   tipo: 'accion', sector: 'global',  pais_riesgo: 'global', fraccion: 0.5 },
    ],
    riesgos: [
      'Costo impositivo: posiciones de energía AR son ganadoras.',
      'Diversificación intra-AR no elimina el riesgo soberano.',
      'Complejidad operativa: algunas posiciones en cuentas conjuntas.',
    ],
  },
  {
    id: 'C',
    titulo: 'Giro global',
    descripcion: 'Energía AR al 25% y cripto al 15%; liberado → RV global',
    cortes: [
      { tipo: 'sector', key: 'Energía AR', targetPct: 0.25 },
      { tipo: 'sector', key: 'Cripto',     targetPct: 0.15 },
    ],
    redespliegues: [
      { ticker: 'RV Global', tipo: 'accion', sector: 'global', pais_riesgo: 'global', fraccion: 1.0 },
    ],
    riesgos: [
      'Costo impositivo alto: múltiples posiciones ganadoras.',
      'Upside resignado en energía AR y cripto.',
      'Mayor exposición a riesgo de mercado global y divisa.',
    ],
  },
];

function simularOpcion(posiciones: Posicion[], opcion: OpcionConfig) {
  const total = posiciones.reduce((s, p) => s + p.valorUsd, 0);
  const antes = calcMetrics(posiciones);
  const ajustadas = posiciones.map(p => ({ ...p }));
  let liberadoUsd = 0;
  const movimientos: { desc: string; deltaUsd: number }[] = [];

  for (const c of opcion.cortes) {
    const targets = ajustadas.filter(p =>
      c.tipo === 'ticker'
        ? p.ticker === c.key
        : sectorDisplay(p.sector, p.pais_riesgo) === c.key
    );
    const actualUsd = targets.reduce((s, p) => s + p.valorUsd, 0);
    const targetUsd = c.targetPct * total;
    if (actualUsd > targetUsd) {
      const delta = actualUsd - targetUsd;
      const factor = targetUsd / actualUsd;
      targets.forEach(p => { p.valorUsd = p.valorUsd * factor; });
      liberadoUsd += delta;
      movimientos.push({ desc: c.key, deltaUsd: -delta });
    }
  }

  for (const r of opcion.redespliegues) {
    const monto = liberadoUsd * r.fraccion;
    if (monto > 0) {
      ajustadas.push({
        ticker: r.ticker, tipo: r.tipo, sector: r.sector, pais_riesgo: r.pais_riesgo,
        cuenta: 'Redespliegue', titular: null, moneda_origen: 'USD', valor_origen: monto,
        cantidad: null, fuente: 'simulacion', revisar: false,
        valorUsd: monto, tcUsado: null, fechaCorrida: '',
      });
      movimientos.push({ desc: r.ticker, deltaUsd: monto });
    }
  }

  return { liberadoUsd, movimientos, antes, despues: calcMetrics(ajustadas), total };
}

// ── Barra apilada ─────────────────────────────────────────────────────────────
function CompBar({ M }: { M: PatMetrics }) {
  const [mostrarOtros, setMostrarOtros] = useState(false);
  const segs = Object.entries(M.bySector).sort((a, b) => b[1] - a[1]);
  const mayores = segs.filter(([, v]) => v / M.total >= UMBRAL_OTROS);
  const menores = segs.filter(([, v]) => v / M.total < UMBRAL_OTROS);
  const otrosUsd = menores.reduce((s, [, v]) => s + v, 0);
  return (
    <div>
      <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', marginBottom: 14, background: 'var(--gf-gray-100)' }}>
        {segs.map(([k, v]) => (
          <div key={k} title={k} style={{ width: pct(v / M.total), background: sectorColor(k) }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {mayores.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: sectorColor(k), flexShrink: 0 }} />
            <span style={{ fontWeight: 600 }}>{k}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(v)}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{pct(v / M.total)}</span>
          </div>
        ))}
        {menores.length > 0 && (
          <>
            <div
              onClick={() => setMostrarOtros(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--gf-gray-300)', flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: 'var(--color-text-sec)' }}>Otros ({menores.length})</span>
              <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-sec)' }}>{fmtUsd(otrosUsd)}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{pct(otrosUsd / M.total)}</span>
              <Icon name={mostrarOtros ? 'chevron-up' : 'chevron-down'} size={13} color="var(--gf-gray-400)" />
            </div>
            {mostrarOtros && menores.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, paddingLeft: 17 }}>
                <span style={{ width: 8, height: 8, borderRadius: 3, background: sectorColor(k), flexShrink: 0 }} />
                <span style={{ fontWeight: 600, color: 'var(--color-text-sec)' }}>{k}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-sec)' }}>{fmtUsd(v)}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{pct(v / M.total)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Modal editar / agregar posición manual ────────────────────────────────────
function ModalPosicionManual({
  pm, onGuardar, onEliminar, onClose,
}: {
  pm: PosicionManual | null;
  onGuardar: (pm: PosicionManual) => void;
  onEliminar?: (id: string) => void;
  onClose: () => void;
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [ticker,   setTicker]   = useState(pm?.ticker   ?? '');
  const [nombre,   setNombre]   = useState(pm?.nombre   ?? '');
  const [cantidad, setCantidad] = useState(pm ? String(pm.cantidad) : '');
  const [valorStr, setValorStr] = useState(pm ? String(pm.valorUsd) : '');
  const [fecha,    setFecha]    = useState(pm?.fechaValuacion ?? hoy);
  const [sector,   setSector]   = useState(pm?.sector   ?? 'tech');
  const [notas,    setNotas]    = useState(pm?.notas    ?? '');
  const id = pm?.id ?? ('manual_' + Date.now());
  const valid = ticker.trim().length > 0 && Number(valorStr) > 0 && Number(cantidad) > 0;

  function guardar() {
    if (!valid) return;
    onGuardar({
      id, ticker: ticker.trim().toUpperCase(), nombre: nombre.trim() || ticker.trim().toUpperCase(),
      cantidad: Number(cantidad), valorUsd: Number(valorStr), fechaValuacion: fecha,
      tipo: 'accion', sector: sector.trim() || 'tech', pais_riesgo: 'global',
      cuenta: pm?.cuenta ?? ('Plan empleado ' + ticker.trim().toUpperCase()), notas,
    });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', background: 'var(--color-surface)', borderRadius: '20px 20px 0 0', padding: '22px 18px 36px', maxHeight: '90dvh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>{pm ? 'Editar posición' : 'Nueva posición manual'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={20} color="var(--color-text)" />
          </button>
        </div>
        {([
          { label: 'Ticker', val: ticker, set: setTicker, type: 'text' as const, placeholder: 'ACN' },
          { label: 'Nombre (opcional)', val: nombre, set: setNombre, type: 'text' as const, placeholder: 'Accenture' },
          { label: 'Cantidad', val: cantidad, set: setCantidad, type: 'number' as const, placeholder: '50' },
          { label: 'Valor total (USD)', val: valorStr, set: setValorStr, type: 'number' as const, placeholder: '6870' },
          { label: 'Fecha valuación', val: fecha, set: setFecha, type: 'date' as const, placeholder: '' },
          { label: 'Sector', val: sector, set: setSector, type: 'text' as const, placeholder: 'tech' },
          { label: 'Notas (opcional)', val: notas, set: setNotas, type: 'text' as const, placeholder: '' },
        ]).map(f => (
          <div key={f.label} style={{ marginBottom: 13 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', marginBottom: 5 }}>{f.label}</div>
            <input
              type={f.type} value={f.val} placeholder={f.placeholder}
              onChange={e => f.set(e.target.value)}
              style={{ width: '100%', padding: '11px 13px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', fontSize: 14, fontFamily: 'var(--font-base)', background: 'var(--gf-gray-50)', boxSizing: 'border-box' }}
            />
          </div>
        ))}
        <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginBottom: 14, lineHeight: 1.4 }}>
          Entra al análisis de riesgo (métricas, semáforos). País: global fijo.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {pm && onEliminar && (
            <button onClick={() => onEliminar(pm.id)} style={{ padding: '12px 14px', borderRadius: 11, border: '1px solid rgba(220,38,38,.3)', background: 'rgba(220,38,38,.06)', color: 'var(--gf-expense)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
              <Icon name="trash-2" size={14} color="var(--gf-expense)" />
            </button>
          )}
          <button onClick={onClose} style={{ flex: 1, padding: '12px 14px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={!valid} style={{ flex: 2, padding: '12px 14px', borderRadius: 11, border: 'none', background: valid ? 'var(--color-accent)' : 'var(--gf-gray-200)', color: valid ? '#fff' : 'var(--gf-gray-400)', fontSize: 14, fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'var(--font-base)' }}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Card posiciones manuales ──────────────────────────────────────────────────
function PosicionesManualesCard({ manuales, fechaCorrida, onEdit, onAdd }: {
  manuales: PosicionManual[];
  fechaCorrida: string;
  onEdit: (pm: PosicionManual) => void;
  onAdd: () => void;
}) {
  const total = manuales.reduce((s, m) => s + m.valorUsd, 0);
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Posiciones manuales</span>
        <button onClick={onAdd} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 8, border: 'none', background: 'none', fontSize: 12, fontWeight: 700, color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
          <Icon name="plus" size={13} color="var(--color-accent)" /> Agregar
        </button>
      </div>
      {manuales.map((m, i) => {
        const stale = fechaCorrida && m.fechaValuacion < fechaCorrida;
        return (
          <div key={m.id} style={{ padding: '8px 0', borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{m.ticker}</span>
                <span style={{ fontSize: 12, color: 'var(--color-text-sec)', marginLeft: 6 }}>{m.cantidad} acc · {m.cuenta}</span>
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(m.valorUsd)}</span>
              <button onClick={() => onEdit(m)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <Icon name="pencil" size={14} color="var(--gf-gray-400)" />
              </button>
            </div>
            {stale && (
              <div style={{ fontSize: 10.5, color: 'var(--gf-out)', marginTop: 3 }}>
                Valuación anterior a la última corrida ({fmtFecha(m.fechaValuacion)})
              </div>
            )}
          </div>
        );
      })}
      {manuales.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800, borderTop: '1px solid var(--gf-gray-200)', paddingTop: 8, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
          <span>Total manuales</span>
          <span>{fmtUsd(total)}</span>
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 6, lineHeight: 1.4 }}>
        Entra al análisis · planes de empleado sin API
      </div>
    </Card>
  );
}

// ── Modal editar / agregar activo fijo ────────────────────────────────────────
function ModalActivoFijo({
  af, onGuardar, onEliminar, onClose,
}: {
  af: ActivoFijo | null;
  onGuardar: (af: ActivoFijo) => void;
  onEliminar?: (id: string) => void;
  onClose: () => void;
}) {
  const [nombre,   setNombre]   = useState(af?.nombre   ?? '');
  const [valorStr, setValorStr] = useState(af ? String(af.valorUsd) : '');
  const [notas,    setNotas]    = useState(af?.notas     ?? '');
  const id = af?.id ?? ('fijo_' + Date.now());
  const valid = nombre.trim().length > 0 && Number(valorStr) > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', background: 'var(--color-surface)', borderRadius: '20px 20px 0 0', padding: '22px 18px 36px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>{af ? 'Editar activo' : 'Nuevo activo'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={20} color="var(--color-text)" />
          </button>
        </div>
        {([
          { label: 'Nombre', val: nombre, set: setNombre, type: 'text' as const },
          { label: 'Valor (USD)', val: valorStr, set: setValorStr, type: 'number' as const },
          { label: 'Notas (opcional)', val: notas, set: setNotas, type: 'text' as const },
        ]).map(f => (
          <div key={f.label} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', marginBottom: 5 }}>{f.label}</div>
            <input
              type={f.type} value={f.val}
              onChange={e => f.set(e.target.value)}
              style={{ width: '100%', padding: '11px 13px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', fontSize: 14, fontFamily: 'var(--font-base)', background: 'var(--gf-gray-50)', boxSizing: 'border-box' }}
            />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          {af && onEliminar && (
            <button onClick={() => onEliminar(af.id)} style={{ padding: '12px 14px', borderRadius: 11, border: '1px solid rgba(220,38,38,.3)', background: 'rgba(220,38,38,.06)', color: 'var(--gf-expense)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
              <Icon name="trash-2" size={14} color="var(--gf-expense)" />
            </button>
          )}
          <button onClick={onClose} style={{ flex: 1, padding: '12px 14px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
            Cancelar
          </button>
          <button
            onClick={() => valid && onGuardar({ id, nombre: nombre.trim(), valorUsd: Number(valorStr), pais: af?.pais ?? 'AR', notas })}
            disabled={!valid}
            style={{ flex: 2, padding: '12px 14px', borderRadius: 11, border: 'none', background: valid ? 'var(--color-accent)' : 'var(--gf-gray-200)', color: valid ? '#fff' : 'var(--gf-gray-400)', fontSize: 14, fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'var(--font-base)' }}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Card activos fijos ────────────────────────────────────────────────────────
function ActivosFijosCard({ activosFijos, onEdit, onAdd }: {
  activosFijos: ActivoFijo[];
  onEdit: (af: ActivoFijo) => void;
  onAdd: () => void;
}) {
  const total = activosFijos.reduce((s, a) => s + a.valorUsd, 0);
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Activos fijos</span>
        <button onClick={onAdd} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 8, border: 'none', background: 'none', fontSize: 12, fontWeight: 700, color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
          <Icon name="plus" size={13} color="var(--color-accent)" /> Agregar
        </button>
      </div>
      {activosFijos.map((af, i) => (
        <div key={af.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : 'none' }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{af.nombre}</span>
          <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(af.valorUsd)}</span>
          <button onClick={() => onEdit(af)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <Icon name="pencil" size={14} color="var(--gf-gray-400)" />
          </button>
        </div>
      ))}
      {activosFijos.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800, borderTop: '1px solid var(--gf-gray-200)', paddingTop: 8, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
          <span>Total fijos</span>
          <span>{fmtUsd(total)}</span>
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 6, lineHeight: 1.4 }}>
        Fuera del análisis de riesgo · lente invertible
      </div>
    </Card>
  );
}

// ── Card de opción de rebalanceo ──────────────────────────────────────────────
function OpcionCard({ opcion, posiciones, onRegistrarDecision }: { opcion: OpcionConfig; posiciones: Posicion[]; onRegistrarDecision: () => void }) {
  const { liberadoUsd, movimientos, antes, despues, total } = simularOpcion(posiciones, opcion);
  const metricas: { label: string; av: number; dv: number; b: BandaNombre | null }[] = [
    { label: 'Energía AR',             av: (antes.bySector['Energía AR'] ?? 0) / (antes.total || 1),   dv: (despues.bySector['Energía AR'] ?? 0) / (despues.total || 1),  b: 'sector' },
    { label: 'País AR',                av: antes.paisAr,  dv: despues.paisAr,  b: 'pais'   },
    { label: 'Cripto',                 av: antes.cripto,  dv: despues.cripto,  b: 'cripto' },
    { label: `Top-1 (${despues.nombreTop.ticker})`, av: antes.top1,   dv: despues.top1,   b: 'nombre' },
    { label: 'HHI',                    av: antes.hhi,     dv: despues.hhi,     b: 'hhi'    },
    { label: '% RV',                   av: antes.rvPct,   dv: despues.rvPct,   b: null     },
  ];
  return (
    <Card>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
        <span style={{ width: 26, height: 26, borderRadius: 999, background: 'var(--gf-ink)', color: '#fff', fontSize: 13, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {opcion.id}
        </span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{opcion.titulo}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-sec)', lineHeight: 1.4, marginTop: 2 }}>{opcion.descripcion}</div>
        </div>
      </div>

      {/* Movimientos */}
      {liberadoUsd > 0 ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Movimientos</div>
          {movimientos.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '2px 0', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: m.deltaUsd < 0 ? 'var(--gf-expense)' : 'var(--gf-income)' }}>
                {m.deltaUsd < 0 ? '↓' : '↑'} {m.desc}
              </span>
              <span style={{ color: m.deltaUsd < 0 ? 'var(--gf-expense)' : 'var(--gf-income)', fontWeight: 700 }}>
                {m.deltaUsd < 0 ? '−' : '+'}{fmtUsd(Math.abs(m.deltaUsd))} · {pct(Math.abs(m.deltaUsd) / total)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--gf-gray-400)', marginBottom: 10 }}>
          Todas las posiciones ya están bajo el target.
        </div>
      )}

      {/* Métricas antes → después */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Métricas</div>
        {metricas.map(m => {
          const bA = m.b ? banda(m.b, m.av) : null;
          const bD = m.b ? banda(m.b, m.dv) : null;
          const mejoró = m.b && bA && bD && (
            bD === 'verde' && bA !== 'verde' ||
            bD === 'amarillo' && bA === 'rojo'
          );
          return (
            <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', fontSize: 12.5 }}>
              <span style={{ flex: 1, color: 'var(--color-text-sec)' }}>{m.label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {bA && <span style={{ color: SEM[bA].dot }}>●</span>} {pct(m.av)}
              </span>
              <span style={{ color: 'var(--gf-gray-400)', fontSize: 11 }}>→</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: mejoró ? 700 : 400 }}>
                {bD && <span style={{ color: SEM[bD].dot }}>●</span>} {pct(m.dv)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Riesgos */}
      <div style={{ background: 'var(--gf-gray-50)', borderRadius: 10, padding: '10px 12px' }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>Riesgos de esta opción</div>
        {opcion.riesgos.map((r, i) => (
          <div key={i} style={{ fontSize: 12, color: 'var(--color-text-sec)', lineHeight: 1.4, padding: '1px 0' }}>· {r}</div>
        ))}
      </div>

      {/* Registrar decisión */}
      <button
        onClick={onRegistrarDecision}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 10, padding: '7px 12px', borderRadius: 9, border: '1px solid var(--gf-gray-200)', background: 'none', fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', cursor: 'pointer', fontFamily: 'var(--font-base)' }}
      >
        <Icon name="book-open" size={13} color="var(--color-text-sec)" /> Registrar decisión
      </button>
    </Card>
  );
}

// ── Solapa Resumen ────────────────────────────────────────────────────────────
function ResumenTab({ M, tc, fechaCorrida, activosFijos, historial, flujos, informes, generandoInforme, onGenerarInforme }: {
  M: PatMetrics; tc: number; fechaCorrida: string;
  activosFijos: ActivoFijo[];
  historial: SnapshotResumen[];
  flujos: FlujoPatrimonio[];
  informes: InformeAnterior[];
  generandoInforme: boolean;
  onGenerarInforme: () => void;
}) {
  const fijosUsd   = activosFijos.reduce((s, a) => s + a.valorUsd, 0);
  const patrimTotal = M.total + fijosUsd;
  const corrPrev = historial.length > 1 ? historial[1] : null;
  const deltaInv = corrPrev ? M.total - corrPrev.totalInvertibleUsd : null;

  const riesgos: { k: string; v: number; b: ReturnType<typeof banda>; extra?: string }[] = [
    { k: 'Nombre más grande', v: M.top1, b: banda('nombre', M.top1), extra: M.nombreTop.ticker },
    { k: 'Sector top',        v: M.sectorTop.pct, b: banda('sector', M.sectorTop.pct), extra: M.sectorTop.nombre },
    { k: 'Cripto (clase)',    v: M.cripto, b: banda('cripto', M.cripto) },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 1. Hero negro */}
      <div style={{ background: 'var(--gf-ink)', color: '#fff', borderRadius: 20, padding: '22px 20px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', opacity: .6 }}>
            Portfolio invertible
          </div>
          <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-1px', margin: '4px 0 2px', fontVariantNumeric: 'tabular-nums' }}>
            {fmtUsd(M.total)}
          </div>
          <div style={{ fontSize: 12, opacity: .5, fontVariantNumeric: 'tabular-nums', marginBottom: 8 }}>
            {fmtArs(M.total, tc)}
          </div>
          {deltaInv !== null && corrPrev && (
            <div style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: deltaInv >= 0 ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                {deltaInv >= 0 ? '+' : ''}{fmtUsd(deltaInv)}
              </span>
              <span style={{ opacity: .55, marginLeft: 5 }}>
                ({deltaInv >= 0 ? '+' : ''}{pct(deltaInv / (corrPrev.totalInvertibleUsd || 1))}) · vs {fmtFecha(corrPrev.fechaCorrida)}
              </span>
            </div>
          )}
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,.15)', margin: '14px 0 12px' }} />
        <div style={{ textAlign: 'center', opacity: .65 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 3 }}>
            Patrimonio total
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {fmtUsd(patrimTotal)}
          </div>
          <div style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
            {fmtArs(patrimTotal, tc)} · al {fmtFecha(fechaCorrida)}
          </div>
        </div>
        <div style={{ textAlign: 'center', fontSize: 10, opacity: .35, marginTop: 10 }}>
          TC ${Math.round(tc).toLocaleString('es-AR')}
        </div>
      </div>

      {/* 2. Riesgos */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
          Riesgos principales
          <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--gf-gray-400)', marginLeft: 6 }}>· sobre invertible</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {riesgos.map(r => (
            <div key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: SEM[r.b].bg }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: SEM[r.b].dot, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {r.k}
                {r.extra && <span style={{ color: 'var(--color-text-sec)', fontWeight: 500 }}> · {r.extra}</span>}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{pct(r.v)}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* 3. Composición por sector */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Composición por sector</div>
        <CompBar M={M} />
      </Card>

      {/* 4. Evolución entre corridas */}
      {historial.length > 1 && (() => {
        const retorno = flujos.length > 0 ? calcRetorno(historial, flujos) : null;
        // Mapa: fechaHasta → retorno del período (periodos van de antiguo a reciente)
        const retornoMap = new Map<string, number>(
          retorno?.periodos.map(p => [p.fechaHasta, p.retornoPct]) ?? []
        );
        return (
          <Card>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Evolución</div>
              {retorno && (
                <div style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-sec)' }}>
                  Acumulado: <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{retorno.acumulado >= 0 ? '+' : ''}{pct(retorno.acumulado)}</span>
                </div>
              )}
            </div>
            {historial.map((s, i) => {
              const prev = historial[i + 1];
              const delta = prev ? s.totalInvertibleUsd - prev.totalInvertibleUsd : null;
              const rPct = retornoMap.get(s.fechaCorrida);
              return (
                <div key={s.fechaCorrida} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : 'none', fontSize: 13 }}>
                  <span style={{ color: 'var(--gf-gray-400)', minWidth: 54, fontSize: 12 }}>{fmtFecha(s.fechaCorrida)}</span>
                  <span style={{ flex: 1, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(s.totalInvertibleUsd)}</span>
                  {delta !== null && (
                    <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: delta >= 0 ? 'var(--gf-income)' : 'var(--gf-expense)', fontWeight: 600 }}>
                      {delta >= 0 ? '+' : ''}{pct(delta / (prev!.totalInvertibleUsd || 1))}
                    </span>
                  )}
                  {rPct !== undefined && (
                    <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-sec)', background: 'var(--gf-gray-100)', borderRadius: 6, padding: '2px 6px', fontWeight: 600 }}>
                      {rPct >= 0 ? '+' : ''}{pct(rPct)} aprox.
                    </span>
                  )}
                  {i === 0 && <span style={{ fontSize: 10, background: 'var(--gf-gray-100)', borderRadius: 4, padding: '2px 5px', color: 'var(--gf-gray-400)', fontWeight: 700 }}>HOY</span>}
                </div>
              );
            })}
            <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 8, lineHeight: 1.4 }}>
              {flujos.length > 0
                ? 'Retorno (aprox.) descuenta los flujos registrados en Configuración (Modified Dietz, peso 0,5). Δ% = variación de valor bruta.'
                : 'La variación refleja cambio de valor, no retorno: no descuenta aportes ni retiros. Registrá flujos en Configuración para ver el retorno real.'}
            </div>
          </Card>
        );
      })()}

      {/* 5. Informe PDF */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: informes.length > 0 ? 10 : 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Informe PDF</span>
          <button
            onClick={onGenerarInforme}
            disabled={generandoInforme}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: 'none', background: generandoInforme ? 'var(--gf-gray-200)' : 'var(--color-accent)', color: generandoInforme ? 'var(--gf-gray-400)' : '#fff', fontSize: 12.5, fontWeight: 700, cursor: generandoInforme ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}
          >
            <Icon name="download" size={13} color={generandoInforme ? 'var(--gf-gray-400)' : '#fff'} />
            {generandoInforme ? 'Generando…' : 'Generar informe PDF'}
          </button>
        </div>
        {informes.length > 0 && (
          <>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>Anteriores</div>
            {informes.map((inf, i) => {
              const fecha = inf.generadoEnISO ? fmtFecha(inf.generadoEnISO.slice(0, 10)) : '—';
              return (
                <div key={inf.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : 'none', fontSize: 12.5 }}>
                  <span style={{ flex: 1 }}>
                    <span style={{ fontWeight: 700 }}>Corrida {fmtFecha(inf.fechaCorrida)}</span>
                    <span style={{ color: 'var(--gf-gray-400)', marginLeft: 6, fontSize: 11 }}>· {fecha}</span>
                  </span>
                  {inf.downloadURL && (
                    <a href={inf.downloadURL} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 700, color: 'var(--color-accent)', textDecoration: 'none' }}>
                      <Icon name="download" size={12} color="var(--color-accent)" /> Descargar
                    </a>
                  )}
                </div>
              );
            })}
          </>
        )}
        <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: informes.length > 0 ? 8 : 4, lineHeight: 1.4 }}>
          Bajo demanda · incluye análisis IA cacheados
        </div>
      </Card>
    </div>
  );
}

// ── Solapa Tenencias (consolidada por ticker, desglose por cuenta al tap) ─────
type FilaTenencia =
  | { origen: 'corrida'; pos: Posicion }
  | { origen: 'manual'; pm: PosicionManual };

type ConsolidadoTicker = {
  ticker: string;
  sectorDisp: string;
  totalUsd: number;
  filas: FilaTenencia[];
  tieneManual: boolean;
  tieneRevisar: boolean;
  tieneStale: boolean;
};

function TenenciasTab({ M, posiciones, manuales, fechaCorrida, analisisCache, configIA, onAnalizar }: {
  M: PatMetrics; posiciones: Posicion[]; manuales: PosicionManual[]; fechaCorrida: string;
  analisisCache: Record<string, AnalisisPosicion>;
  configIA: ConfigIA;
  onAnalizar: (ticker: string, contexto: Record<string, unknown>) => void;
}) {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [analizando, setAnalizando] = useState<Set<string>>(new Set());

  // Consolidar por ticker usando valorUsd ya calculado (no re-suma)
  const byTickerMap = new Map<string, ConsolidadoTicker>();
  const todasFilas: FilaTenencia[] = [
    ...posiciones.map(pos => ({ origen: 'corrida' as const, pos })),
    ...manuales.map(pm  => ({ origen: 'manual'  as const, pm  })),
  ];
  for (const fila of todasFilas) {
    const ticker = fila.origen === 'corrida' ? fila.pos.ticker : fila.pm.ticker;
    const val    = fila.origen === 'corrida' ? fila.pos.valorUsd : fila.pm.valorUsd;
    const sec    = fila.origen === 'corrida'
      ? sectorDisplay(fila.pos.sector, fila.pos.pais_riesgo)
      : sectorDisplay(fila.pm.sector, fila.pm.pais_riesgo);
    if (!byTickerMap.has(ticker)) {
      byTickerMap.set(ticker, { ticker, sectorDisp: sec, totalUsd: 0, filas: [], tieneManual: false, tieneRevisar: false, tieneStale: false });
    }
    const entry = byTickerMap.get(ticker)!;
    entry.totalUsd += val;
    entry.filas.push(fila);
    if (fila.origen === 'manual') entry.tieneManual = true;
    if (fila.origen === 'corrida' && fila.pos.revisar) entry.tieneRevisar = true;
    if (fila.origen === 'manual' && fechaCorrida && fila.pm.fechaValuacion < fechaCorrida) entry.tieneStale = true;
  }
  const consolidados = Array.from(byTickerMap.values()).sort((a, b) => b.totalUsd - a.totalUsd);
  const totalInvertible = consolidados.reduce((s, c) => s + c.totalUsd, 0);

  function toggle(ticker: string) {
    setExpandidos(prev => {
      const next = new Set(prev);
      next.has(ticker) ? next.delete(ticker) : next.add(ticker);
      return next;
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Composición por sector */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Composición por sector</div>
        <CompBar M={M} />
      </Card>

      {/* Lista consolidada por ticker */}
      <Card padding="0">
        {consolidados.map((c, idx) => {
          const exp    = expandidos.has(c.ticker);
          const cuentas = new Set(c.filas.map(f => f.origen === 'corrida' ? f.pos.cuenta : f.pm.cuenta)).size;
          const isLast = idx === consolidados.length - 1;
          return (
            <div key={c.ticker}>
              {/* Fila consolidada */}
              <div
                onClick={() => toggle(c.ticker)}
                style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px',
                  borderBottom: (!isLast || exp) ? '1px solid var(--gf-gray-100)' : 'none',
                  cursor: 'pointer' }}
              >
                <MerchantLogo nombre={c.ticker} size={40} radius={8} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{c.ticker}</span>
                    {c.tieneManual && (
                      <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--gf-gray-100)', color: 'var(--color-text-sec)', borderRadius: 4, padding: '2px 5px' }}>MANUAL</span>
                    )}
                    {(c.tieneRevisar || c.tieneStale) && (
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--gf-out)', flexShrink: 0, display: 'inline-block' }} />
                    )}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--color-text-sec)', display: 'flex', gap: 5, alignItems: 'center' }}>
                    <span style={{ width: 7, height: 7, borderRadius: 3, background: sectorColor(c.sectorDisp), flexShrink: 0, display: 'inline-block' }} />
                    {c.sectorDisp}
                    {cuentas > 1 && <span style={{ fontSize: 10.5, color: 'var(--gf-gray-400)' }}>· {cuentas} cuentas</span>}
                  </span>
                </span>
                <span style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(c.totalUsd)}</span>
                  <span style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{pct(c.totalUsd / M.total)}</span>
                </span>
                <Icon name={exp ? 'chevron-up' : 'chevron-down'} size={14} color="var(--gf-gray-400)" />
              </div>

              {/* Acordeón: desglose por cuenta */}
              {exp && (
                <div style={{ background: 'var(--gf-gray-50)', borderBottom: !isLast ? '1px solid var(--gf-gray-100)' : 'none' }}>
                  {c.filas.map((fila, fi) => {
                    const fkey   = fila.origen === 'corrida'
                      ? `${fila.pos.ticker}-${fila.pos.cuenta}-${fi}`
                      : fila.pm.id;
                    const val    = fila.origen === 'corrida' ? fila.pos.valorUsd : fila.pm.valorUsd;
                    const cta    = fila.origen === 'corrida' ? fila.pos.cuenta   : fila.pm.cuenta;
                    const titular = fila.origen === 'corrida' ? fila.pos.titular  : null;
                    const cant   = fila.origen === 'corrida' ? fila.pos.cantidad  : fila.pm.cantidad;
                    const rev    = fila.origen === 'corrida' && fila.pos.revisar;
                    const stale  = fila.origen === 'manual' && fechaCorrida && fila.pm.fechaValuacion < fechaCorrida;
                    const fechaVal = fila.origen === 'manual' ? fila.pm.fechaValuacion : null;
                    return (
                      <div key={fkey} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 14px 9px 22px', borderTop: fi > 0 ? '1px solid var(--gf-gray-100)' : 'none' }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{cta}</span>
                          {titular && <span style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', marginLeft: 5 }}>{titular}</span>}
                          <span style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
                            {cant != null && (
                              <span style={{ fontSize: 11.5, color: 'var(--color-text-sec)' }}>{cant.toLocaleString('es-AR')} nom.</span>
                            )}
                            {fila.origen === 'manual' && (
                              <span style={{ fontSize: 9.5, fontWeight: 700, background: 'var(--gf-gray-200)', color: 'var(--color-text-sec)', borderRadius: 4, padding: '1px 5px' }}>
                                MANUAL · {fmtFecha(fechaVal!)}
                              </span>
                            )}
                            {rev && (
                              <span style={{ fontSize: 9.5, fontWeight: 700, background: 'rgba(245,158,11,.15)', color: 'var(--gf-out)', borderRadius: 4, padding: '1px 5px' }}>REVISAR</span>
                            )}
                            {stale && (
                              <span style={{ fontSize: 9.5, color: 'var(--gf-out)' }}>val. anterior a corrida</span>
                            )}
                          </span>
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0, paddingTop: 2 }}>
                          {fmtUsd(val)}
                        </span>
                      </div>
                    );
                  })}
                  {/* F9.93: Análisis IA por ticker */}
                  <AnalisisIASection
                    ticker={c.ticker}
                    totalUsd={c.totalUsd}
                    totalPortafolio={M.total}
                    sectorDisp={c.sectorDisp}
                    analisis={analisisCache[c.ticker] ?? null}
                    analizando={analizando.has(c.ticker)}
                    configIA={configIA}
                    onAnalizar={(ctx) => {
                      if (analizando.has(c.ticker)) return;
                      setAnalizando(prev => { const n = new Set(prev); n.add(c.ticker); return n; });
                      onAnalizar(c.ticker, ctx);
                      setTimeout(() => setAnalizando(prev => { const n = new Set(prev); n.delete(c.ticker); return n; }), 30000);
                    }}
                    onAbrirChat={(ctx) => {
                      const onDone = () => cargarAnalisisPosicion(c.ticker).then(a => {
                        if (a) setAnalisisCache(prev => ({ ...prev, [c.ticker]: a }));
                      });
                      setModalPromptChat({ modo: 'posicion', ticker: c.ticker, contexto: ctx, onDone });
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {/* Pie: total invertible (debe cuadrar con el hero) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, padding: '0 4px', fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ color: 'var(--gf-gray-400)' }}>Total invertible</span>
        <span>{fmtUsd(totalInvertible)}</span>
      </div>

      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', textAlign: 'center' }}>
        {posiciones.length} posiciones corrida · {manuales.length} manuales · {consolidados.length} tickers · foto al {fmtFecha(fechaCorrida)}
      </div>
    </div>
  );
}

// ── Solapa Riesgo ─────────────────────────────────────────────────────────────
function RiesgoTab({ M, posiciones }: { M: PatMetrics; posiciones: Posicion[] }) {
  const criptoTickers = posiciones.filter(p => p.tipo === 'cripto').map(p => p.ticker).join(' + ') || 'sin cripto';
  const rows: { k: string; sub: string; v: string; b: 'verde' | 'amarillo' | 'rojo'; band: string }[] = [
    { k: 'Nombre más grande', sub: M.nombreTop.ticker + ' · cripto se mide aparte', v: pct(M.top1), b: banda('nombre', M.top1), band: '🟢 ≤5 · 🟡 5–10 · 🔴 >10%' },
    { k: 'Sector top',        sub: M.sectorTop.nombre,                               v: pct(M.sectorTop.pct), b: banda('sector', M.sectorTop.pct), band: '🟢 <25 · 🟡 25–40 · 🔴 >40%' },
    { k: 'País único',        sub: 'Argentina',                                      v: pct(M.paisAr), b: banda('pais', M.paisAr), band: '🟢 <40 · 🟡 40–60 · 🔴 >60%' },
    { k: 'Cripto (clase)',    sub: criptoTickers,                                     v: pct(M.cripto), b: banda('cripto', M.cripto), band: '🟢 <10 · 🟡 10–20 · 🔴 >20%' },
    { k: 'HHI (concentración global)', sub: 'umbral DOJ',                             v: M.hhi.toFixed(2), b: banda('hhi', M.hhi), band: '🟢 <0,15 · 🟡 0,15–0,25 · 🔴 >0,25' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map(r => (
        <Card key={r.k} style={{ background: SEM[r.b].bg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ width: 11, height: 11, borderRadius: 999, background: SEM[r.b].dot, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{r.k}</span>
              <span style={{ fontSize: 11.5, color: 'var(--color-text-sec)' }}>{r.sub}</span>
            </span>
            <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{r.v}</span>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,.06)', letterSpacing: '.2px' }}>
            {r.band}
          </div>
        </Card>
      ))}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Top-3 / Top-5</div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
          Las 3 mayores posiciones son <strong style={{ color: 'var(--color-text)' }}>{pct(M.top3)}</strong> del total; las 5 mayores, <strong style={{ color: 'var(--color-text)' }}>{pct(M.top5)}</strong>.
        </div>
      </Card>
      <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', textAlign: 'center', lineHeight: 1.5 }}>
        El <strong style={{ color: 'var(--color-text-sec)' }}>% en renta variable ({pct(M.rvPct)})</strong> es informativo, sin semáforo:<br />
        la postura busca RV alta, no es un límite a controlar.
      </div>

      {/* Escenarios de estrés */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>¿Qué pasa si...?</div>
        {STRESS_ESCENARIOS.map((e, i) => {
          const { perdidaUsd, totalResultante, total } = calcStress(posiciones, e.shock);
          return (
            <div key={e.id} style={{ padding: '10px 0', borderTop: i === 0 ? '1px solid var(--gf-gray-100)' : '1px solid var(--gf-gray-100)', marginTop: i === 0 ? 10 : 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 5 }}>{e.nombre}</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12.5 }}>
                <span>
                  <span style={{ color: 'var(--gf-gray-400)' }}>Pérdida </span>
                  <strong style={{ color: 'var(--gf-expense)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtUsd(perdidaUsd)} ({pct(perdidaUsd / (total || 1))})
                  </strong>
                </span>
                <span>
                  <span style={{ color: 'var(--gf-gray-400)' }}>Resultante </span>
                  <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(totalResultante)}</strong>
                </span>
              </div>
            </div>
          );
        })}
        <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 10, lineHeight: 1.4 }}>
          Escenarios ilustrativos con shocks fijos; no son predicciones ni probabilidades.
        </div>
      </Card>
    </div>
  );
}

// ── Modal: registrar decisión ─────────────────────────────────────────────────
function ModalRegistrarDecision({
  preload, metricasActuales, onGuardar, onClose,
}: {
  preload?: { opcionReferencia: 'A' | 'B' | 'C' | null; tickers: string[] } | null;
  metricasActuales: MetricasSnap;
  onGuardar: (d: NuevaDecision) => void;
  onClose: () => void;
}) {
  const [titulo, setTitulo] = useState('');
  const [razon, setRazon] = useState('');
  const [tickersStr, setTickersStr] = useState((preload?.tickers ?? []).join(', '));

  const tickers = tickersStr.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
  const valid = titulo.trim().length > 0;

  function guardar() {
    if (!valid) return;
    const filteredValores = Object.fromEntries(tickers.map(t => [t, metricasActuales.valoresTickers[t] ?? 0]));
    const snap: MetricasSnap = { ...metricasActuales, valoresTickers: filteredValores };
    onGuardar({ titulo: titulo.trim(), razon: razon.trim(), tickers, opcionReferencia: preload?.opcionReferencia ?? null, metricasAlCrear: snap });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', background: 'var(--color-surface)', borderRadius: '20px 20px 0 0', padding: '22px 18px 36px', maxHeight: '90dvh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>Registrar decisión</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={20} color="var(--color-text)" />
          </button>
        </div>

        {preload?.opcionReferencia && (
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-accent)', background: 'rgba(6,95,70,.08)', borderRadius: 8, padding: '6px 10px', marginBottom: 14 }}>
            Desde Opción {preload.opcionReferencia}
          </div>
        )}

        {([
          { label: 'Título', val: titulo, set: setTitulo, placeholder: 'Recorte TRAN a ~10%', required: true },
          { label: 'Razón (texto libre)', val: razon, set: setRazon, placeholder: 'Por qué la tomás', required: false },
          { label: 'Tickers involucrados (opcional, separados por coma)', val: tickersStr, set: setTickersStr, placeholder: 'TRAN, PAMP', required: false },
        ]).map(f => (
          <div key={f.label} style={{ marginBottom: 13 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', marginBottom: 5 }}>
              {f.label}{f.required && <span style={{ color: 'var(--gf-expense)' }}> *</span>}
            </div>
            <input
              type="text" value={f.val} placeholder={f.placeholder}
              onChange={e => f.set(e.target.value)}
              style={{ width: '100%', padding: '11px 13px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', fontSize: 14, fontFamily: 'var(--font-base)', background: 'var(--gf-gray-50)', boxSizing: 'border-box' }}
            />
          </div>
        ))}

        <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginBottom: 16, lineHeight: 1.4 }}>
          Foto de métricas actuales: {fmtUsd(metricasActuales.totalInvertibleUsd)} total · HHI {metricasActuales.hhi.toFixed(2)} · Cripto {pct(metricasActuales.criptoPct)}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '12px 14px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={!valid} style={{ flex: 2, padding: '12px 14px', borderRadius: 11, border: 'none', background: valid ? 'var(--color-accent)' : 'var(--gf-gray-200)', color: valid ? '#fff' : 'var(--gf-gray-400)', fontSize: 14, fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'var(--font-base)' }}>
            Registrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: revisar decisión (30d / 90d) ───────────────────────────────────────
function ModalRevision({
  decision, tipo, metricasActuales, onGuardar, onClose,
}: {
  decision: DecisionPatrimonio;
  tipo: '30d' | '90d';
  metricasActuales: MetricasSnap;
  onGuardar: (notas: string, metricas: MetricasSnap) => void;
  onClose: () => void;
}) {
  const [quePaso, setQuePaso] = useState('');
  const [laVolveria, setLaVolveria] = useState('');
  const valid = quePaso.trim().length > 0;

  const entonces = decision.metricasAlCrear;
  const ahora: MetricasSnap = {
    ...metricasActuales,
    valoresTickers: Object.fromEntries(
      decision.tickers.map(t => [t, metricasActuales.valoresTickers[t] ?? 0])
    ),
  };

  function fmtDelta(a: number, b: number, kind: 'usd' | 'pct') {
    const d = b - a;
    const sign = d >= 0 ? '+' : '';
    return kind === 'usd' ? `${sign}${fmtUsd(d)}` : `${sign}${(d * 100).toFixed(1)} pp`;
  }

  const metricas: { label: string; ent: string; hoy: string; delta: string }[] = [
    { label: 'Total invertible', ent: fmtUsd(entonces.totalInvertibleUsd), hoy: fmtUsd(ahora.totalInvertibleUsd), delta: fmtDelta(entonces.totalInvertibleUsd, ahora.totalInvertibleUsd, 'usd') },
    { label: 'Energía AR', ent: pct(entonces.energiaArPct), hoy: pct(ahora.energiaArPct), delta: fmtDelta(entonces.energiaArPct, ahora.energiaArPct, 'pct') },
    { label: 'País AR', ent: pct(entonces.paisArPct), hoy: pct(ahora.paisArPct), delta: fmtDelta(entonces.paisArPct, ahora.paisArPct, 'pct') },
    { label: 'Cripto', ent: pct(entonces.criptoPct), hoy: pct(ahora.criptoPct), delta: fmtDelta(entonces.criptoPct, ahora.criptoPct, 'pct') },
    { label: `Top-1 (${entonces.top1Ticker})`, ent: pct(entonces.top1Pct), hoy: pct(ahora.top1Pct), delta: fmtDelta(entonces.top1Pct, ahora.top1Pct, 'pct') },
    { label: 'HHI', ent: entonces.hhi.toFixed(2), hoy: ahora.hhi.toFixed(2), delta: `${(ahora.hhi - entonces.hhi >= 0 ? '+' : '')}${(ahora.hhi - entonces.hhi).toFixed(2)}` },
  ];

  function guardar() {
    if (!valid) return;
    const notas = laVolveria.trim()
      ? `${quePaso.trim()}\n\n¿La volvería a tomar?\n${laVolveria.trim()}`
      : quePaso.trim();
    onGuardar(notas, ahora);
  }

  const celStyle = (align?: string): React.CSSProperties => ({
    padding: '5px 8px', fontSize: 11, fontVariantNumeric: 'tabular-nums',
    textAlign: (align as React.CSSProperties['textAlign']) ?? 'left',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', background: 'var(--color-surface)', borderRadius: '20px 20px 0 0', padding: '22px 18px 36px', maxHeight: '93dvh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>Revisión {tipo}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={20} color="var(--color-text)" />
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 16 }}>{decision.titulo}</div>

        {/* Tabla entonces → hoy (colores neutros, sin semáforos) */}
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>Entonces → hoy</div>
        <div style={{ border: '1px solid var(--gf-gray-200)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', background: 'var(--gf-gray-100)', fontSize: 9.5, fontWeight: 700, color: 'var(--gf-gray-500)' }}>
            {['Métrica', 'Entonces', 'Hoy', 'Δ'].map((h, i) => (
              <div key={h} style={{ ...celStyle(i > 0 ? 'right' : undefined), padding: '6px 8px' }}>{h}</div>
            ))}
          </div>
          {metricas.map((m, i) => (
            <div key={m.label} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', borderTop: '1px solid var(--gf-gray-100)', background: i % 2 ? 'var(--gf-gray-50)' : 'transparent' }}>
              <div style={{ ...celStyle(), color: 'var(--color-text-sec)', fontSize: 10.5 }}>{m.label}</div>
              <div style={celStyle('right')}>{m.ent}</div>
              <div style={celStyle('right')}>{m.hoy}</div>
              <div style={{ ...celStyle('right'), color: 'var(--color-text-sec)' }}>{m.delta}</div>
            </div>
          ))}
          {decision.tickers.map((t, i) => {
            const valA = entonces.valoresTickers[t] ?? 0;
            const valH = ahora.valoresTickers[t] ?? 0;
            return (
              <div key={t} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', borderTop: '1px solid var(--gf-gray-100)', background: (metricas.length + i) % 2 ? 'var(--gf-gray-50)' : 'transparent' }}>
                <div style={{ ...celStyle(), fontWeight: 700 }}>{t}</div>
                <div style={celStyle('right')}>{fmtUsd(valA)}</div>
                <div style={celStyle('right')}>{fmtUsd(valH)}</div>
                <div style={{ ...celStyle('right'), color: 'var(--color-text-sec)' }}>{fmtDelta(valA, valH, 'usd')}</div>
              </div>
            );
          })}
        </div>

        {/* Preguntas de reflexión */}
        <div style={{ marginBottom: 13 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', marginBottom: 5 }}>
            ¿Qué pasó desde entonces?<span style={{ color: 'var(--gf-expense)' }}> *</span>
          </div>
          <textarea
            value={quePaso} onChange={e => setQuePaso(e.target.value)}
            placeholder="Describí brevemente qué ocurrió con la posición y el mercado"
            rows={3}
            style={{ width: '100%', padding: '11px 13px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', fontSize: 13, fontFamily: 'var(--font-base)', background: 'var(--gf-gray-50)', boxSizing: 'border-box', resize: 'vertical' }}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', marginBottom: 5 }}>
            ¿La volverías a tomar? ¿Por qué?
          </div>
          <textarea
            value={laVolveria} onChange={e => setLaVolveria(e.target.value)}
            placeholder="Reflexión sobre el proceso de decisión"
            rows={3}
            style={{ width: '100%', padding: '11px 13px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', fontSize: 13, fontFamily: 'var(--font-base)', background: 'var(--gf-gray-50)', boxSizing: 'border-box', resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '12px 14px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={!valid} style={{ flex: 2, padding: '12px 14px', borderRadius: 11, border: 'none', background: valid ? 'var(--color-accent)' : 'var(--gf-gray-200)', color: valid ? '#fff' : 'var(--gf-gray-400)', fontSize: 14, fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'var(--font-base)' }}>
            Guardar revisión
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Diario de decisiones (sección dentro de PlanTab) ──────────────────────────
function DiarioDecisiones({ decisiones, onNueva, onIniciarRevision }: {
  decisiones: DecisionPatrimonio[];
  onNueva: () => void;
  onIniciarRevision: (d: DecisionPatrimonio, tipo: '30d' | '90d') => void;
}) {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpandidos(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function fmtTs(ts: { toDate(): Date }) {
    const d = ts.toDate();
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear().toString().slice(2)}`;
  }

  const ESTADO_LABEL: Record<string, string> = {
    abierta: 'abierta', revisada30: 'revisada 30d', revisada90: 'revisada 90d', cerrada: 'cerrada',
  };

  return (
    <Card padding="0">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 14px', borderBottom: decisiones.length > 0 ? '1px solid var(--gf-gray-100)' : 'none' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Diario de decisiones</span>
        <button onClick={onNueva} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: 'none', background: 'var(--gf-gray-100)', fontSize: 12, fontWeight: 700, color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
          <Icon name="plus" size={13} color="var(--color-text)" /> Decisión
        </button>
      </div>

      {decisiones.length === 0 && (
        <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--gf-gray-400)', textAlign: 'center', lineHeight: 1.5 }}>
          Sin decisiones registradas.{'\n'}Usá "+ Decisión" o el botón en cada Opción.
        </div>
      )}

      {decisiones.map((d, idx) => {
        const exp = expandidos.has(d.id);
        const pendiente = revisionPendiente(d);
        const isLast = idx === decisiones.length - 1;
        return (
          <div key={d.id}>
            <div onClick={() => toggle(d.id)} style={{ padding: '10px 14px', borderBottom: (!isLast || exp) ? '1px solid var(--gf-gray-100)' : 'none', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{d.titulo}</span>
                    {d.opcionReferencia && (
                      <span style={{ fontSize: 9.5, fontWeight: 700, background: 'var(--gf-ink)', color: '#fff', borderRadius: 4, padding: '1px 5px' }}>Op. {d.opcionReferencia}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10.5, color: 'var(--gf-gray-400)' }}>{fmtTs(d.creadaEn)}</span>
                    {d.tickers.map(t => (
                      <span key={t} style={{ fontSize: 9.5, fontWeight: 700, background: 'var(--gf-gray-100)', color: 'var(--color-text-sec)', borderRadius: 4, padding: '1px 5px' }}>{t}</span>
                    ))}
                    <span style={{ fontSize: 9.5, fontWeight: 700, background: 'var(--gf-gray-100)', color: 'var(--color-text-sec)', borderRadius: 4, padding: '1px 5px' }}>
                      {ESTADO_LABEL[d.estado] ?? d.estado}
                    </span>
                    {pendiente && (
                      <span style={{ fontSize: 9.5, fontWeight: 700, background: 'rgba(245,158,11,.15)', color: '#b45309', borderRadius: 4, padding: '1px 5px', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Icon name="clock" size={9} color="#b45309" /> revisión {pendiente}
                      </span>
                    )}
                  </div>
                </div>
                <Icon name={exp ? 'chevron-up' : 'chevron-down'} size={14} color="var(--gf-gray-400)" />
              </div>
            </div>

            {exp && (
              <div style={{ background: 'var(--gf-gray-50)', padding: '12px 14px', borderBottom: !isLast ? '1px solid var(--gf-gray-100)' : 'none' }}>
                {d.razon && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 10, lineHeight: 1.5 }}>{d.razon}</div>
                )}

                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>Al registrar</div>
                <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)', marginBottom: 10, lineHeight: 1.7 }}>
                  {fmtUsd(d.metricasAlCrear.totalInvertibleUsd)} total · HHI {d.metricasAlCrear.hhi.toFixed(2)} · Cripto {pct(d.metricasAlCrear.criptoPct)} · País AR {pct(d.metricasAlCrear.paisArPct)}
                  {Object.entries(d.metricasAlCrear.valoresTickers).map(([t, v]) => (
                    <span key={t}> · {t} {fmtUsd(v as number)}</span>
                  ))}
                </div>

                {/* Revisiones previas */}
                {!d.revisiones.some(r => r.tipo === '30d') && d.revisiones.some(r => r.tipo === '90d') && (
                  <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', fontStyle: 'italic', marginBottom: 6 }}>Revisión 30d omitida</div>
                )}
                {d.revisiones.map((r, ri) => (
                  <div key={ri} style={{ marginBottom: 8, padding: '8px 10px', background: 'var(--color-surface)', borderRadius: 8, border: '1px solid var(--gf-gray-200)' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', marginBottom: 3 }}>
                      Revisión {r.tipo} · {fmtTs(r.fecha)}
                    </div>
                    {r.notas && (
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{r.notas}</div>
                    )}
                    <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtUsd(r.metricasAlRevisar.totalInvertibleUsd)} total al revisar · Δ {r.metricasAlRevisar.totalInvertibleUsd - d.metricasAlCrear.totalInvertibleUsd >= 0 ? '+' : ''}{fmtUsd(r.metricasAlRevisar.totalInvertibleUsd - d.metricasAlCrear.totalInvertibleUsd)}
                    </div>
                  </div>
                ))}

                {pendiente && (
                  <button
                    onClick={() => onIniciarRevision(d, pendiente)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, padding: '8px 14px', borderRadius: 9, border: '1px solid rgba(245,158,11,.4)', background: 'rgba(245,158,11,.1)', fontSize: 12, fontWeight: 700, color: '#b45309', cursor: 'pointer', fontFamily: 'var(--font-base)' }}
                  >
                    <Icon name="clock" size={12} color="#b45309" /> Iniciar revisión {pendiente}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}

// ── Solapa Plan ───────────────────────────────────────────────────────────────
function PlanTab({ M, posiciones, decisiones, onRegistrarLibre, onRegistrarDesdeOpcion, onIniciarRevision }: {
  M: PatMetrics; posiciones: Posicion[];
  decisiones: DecisionPatrimonio[];
  onRegistrarLibre: () => void;
  onRegistrarDesdeOpcion: (opcionId: 'A' | 'B' | 'C', tickers: string[]) => void;
  onIniciarRevision: (decision: DecisionPatrimonio, tipo: '30d' | '90d') => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card>
        <div style={{ fontSize: 14, fontWeight: 800 }}>La idea madre</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-sec)', marginTop: 6, lineHeight: 1.5 }}>
          Mantener el <strong style={{ color: 'var(--color-text)' }}>{pct(M.rvPct)} en renta variable</strong>, cambiar su composición.
          No es vender para quedarse en pesos: es repartir la misma apuesta de crecimiento.
        </div>
      </Card>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '2px 2px 0' }}>
        Opciones
      </div>
      {OPCIONES_CONFIG.map(o => {
        const tickersPreload = o.cortes.filter(c => c.tipo === 'ticker').map(c => c.key);
        return (
          <OpcionCard
            key={o.id}
            opcion={o}
            posiciones={posiciones}
            onRegistrarDecision={() => onRegistrarDesdeOpcion(o.id, tickersPreload)}
          />
        );
      })}
      <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--gf-gray-100)', fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
        Estas opciones miden direcciones posibles, no son recomendaciones. Podés combinarlas o ignorarlas.
      </div>
      <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--gf-gray-100)', fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
        No es asesoramiento matriculado. Las posiciones ganadoras en USD tienen costo impositivo al vender; conviene pensar gradual. Parte está en cuentas conjuntas.
      </div>
      <DiarioDecisiones
        decisiones={decisiones}
        onNueva={onRegistrarLibre}
        onIniciarRevision={onIniciarRevision}
      />
    </div>
  );
}

// ── Análisis IA por ticker (dentro del acordeón de Tenencias) ────────────────
function AnalisisIASection({ ticker, totalUsd, totalPortafolio, sectorDisp, analisis, analizando, configIA, onAnalizar, onAbrirChat }: {
  ticker: string; totalUsd: number; totalPortafolio: number; sectorDisp: string;
  analisis: AnalisisPosicion | null;
  analizando: boolean;
  configIA: ConfigIA;
  onAnalizar: (contexto: Record<string, unknown>) => void;
  onAbrirChat: (contexto: Record<string, unknown>) => void;
}) {
  const pct = (x: number) => Math.round(x * 100) + '%';
  const contexto = { ticker, sector: sectorDisp, pesoEnCartera: pct(totalUsd / (totalPortafolio || 1)), valorUsd: Math.round(totalUsd) };

  const diasAntiguo = analisis
    ? Math.floor((Date.now() - new Date(analisis.generadoEnISO).getTime()) / 86400000)
    : null;

  return (
    <div style={{ borderTop: '1px solid var(--gf-gray-100)', padding: '10px 14px 10px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: analisis ? 8 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.3px' }}>
            Análisis IA
          </span>
          {analisis?.origen === 'chat' && (
            <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--gf-gray-500)', background: 'var(--gf-gray-100)', borderRadius: 4, padding: '1px 5px' }}>vía chat</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {analisis && diasAntiguo !== null && (
            <span style={{ fontSize: 10.5, color: 'var(--gf-gray-400)' }}>hace {diasAntiguo}d</span>
          )}
          <button
            onClick={() => onAbrirChat(contexto)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 9px', borderRadius: 8, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: 'var(--color-text-sec)', fontFamily: 'var(--font-base)' }}
          >
            <Icon name="message-circle" size={10} color="var(--color-text-sec)" />
            Chat
          </button>
          <button
            onClick={() => onAnalizar(contexto)}
            disabled={analizando || !configIA.habilitado}
            title={!configIA.habilitado ? 'IA deshabilitada — activar en Research' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 11.5, fontWeight: 700, cursor: (analizando || !configIA.habilitado) ? 'default' : 'pointer', color: !configIA.habilitado ? 'var(--gf-gray-400)' : 'var(--color-accent)', fontFamily: 'var(--font-base)' }}
          >
            <Icon name={analizando ? 'loader' : 'zap'} size={11} color={!configIA.habilitado ? 'var(--gf-gray-400)' : 'var(--color-accent)'} />
            {analizando ? 'Analizando…' : analisis ? 'Regenerar' : 'Generar análisis'}
          </button>
        </div>
      </div>

      {analisis && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {analisis.resultado.queEs && (
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700 }}>Qué es: </span>
              {analisis.resultado.queEs}
            </div>
          )}
          {analisis.resultado.situacionActual && (
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700 }}>Hoy: </span>
              {analisis.resultado.situacionActual}
            </div>
          )}
          {analisis.resultado.riesgos && analisis.resultado.riesgos.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', marginBottom: 2 }}>Riesgos</div>
              {analisis.resultado.riesgos.map((r, i) => (
                <div key={i} style={{ fontSize: 11.5, color: 'var(--color-text-sec)', padding: '1px 0' }}>· {r}</div>
              ))}
            </div>
          )}
          {analisis.resultado.rolEnCartera && (
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700 }}>En cartera: </span>
              {analisis.resultado.rolEnCartera}
            </div>
          )}
          {analisis.resultado.proximosEventos && analisis.resultado.proximosEventos.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', marginBottom: 2 }}>Próximos eventos</div>
              {analisis.resultado.proximosEventos.map((e, i) => (
                <div key={i} style={{ fontSize: 11.5, color: 'var(--color-text-sec)', padding: '1px 0' }}>· {e}</div>
              ))}
            </div>
          )}
          {analisis.resultado.queHariaEnCadaCaso && analisis.resultado.queHariaEnCadaCaso.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', marginBottom: 4 }}>Qué haría en cada caso</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {analisis.resultado.queHariaEnCadaCaso.map((c, i) => (
                  <div key={i} style={{ background: 'var(--gf-gray-50)', border: '1px solid var(--gf-gray-100)', borderRadius: 6, padding: '6px 10px' }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 2 }}>{c.caso}</div>
                    {c.acciones.map((a, j) => (
                      <div key={j} style={{ fontSize: 11.5, color: 'var(--color-text-sec)', padding: '1px 0' }}>· {a}</div>
                    ))}
                    {c.costo && (
                      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 }}>{c.costo}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {analisis.resultado.senalesAVigilar && analisis.resultado.senalesAVigilar.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', marginBottom: 2 }}>Señales a vigilar</div>
              {analisis.resultado.senalesAVigilar.map((s, i) => (
                <div key={i} style={{ fontSize: 11.5, color: 'var(--color-text-sec)', padding: '1px 0' }}>· {s}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers de calendario ──────────────────────────────────────────────────────
const DRIVER_CHIP: Record<string, string> = {
  cer_pesos: 'CER', soberano: 'Soberano', tasas_ar: 'Tasas AR',
  tasas_global: 'Fed', cripto: 'Cripto', energia_ar: 'Tarifas',
  tech_global: 'Tech', resultados: 'Earnings', impositivo: 'Fiscal', otro: 'Macro',
};

type EventoCal = {
  cuandoMs: number | null;
  cuandoDisplay: string;
  texto: string;
  chip: string;
  subtitulo?: string;
  isPast: boolean;
  analisisISO?: string; // antigüedad para eventos de posición
};

function parseCuando(cuando: string | null): { ms: number | null; display: string } {
  if (!cuando) return { ms: null, display: 'Sin fecha' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(cuando)) {
    const ms = new Date(cuando + 'T12:00:00').getTime();
    const [y, m, d] = cuando.split('-');
    return { ms, display: `${d}/${m}/${y}` };
  }
  if (/^\d{4}-\d{2}$/.test(cuando)) {
    const ms = new Date(cuando + '-01T12:00:00').getTime();
    const [y, m] = cuando.split('-');
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return { ms, display: `~${meses[parseInt(m) - 1]} ${y}` };
  }
  return { ms: null, display: cuando };
}

function buildEventosCal(
  analisisCache: Record<string, AnalisisPosicion>,
  agenda: AgendaMacro | null,
): EventoCal[] {
  const ahora = Date.now();
  const hace30 = ahora - 30 * 86400000;
  const eventos: EventoCal[] = [];

  // Eventos de posición
  for (const a of Object.values(analisisCache)) {
    for (const raw of a.resultado.proximosEventos ?? []) {
      const { cuando, evento } = normalizarEventoProximo(raw);
      const { ms, display } = parseCuando(cuando);
      eventos.push({
        cuandoMs: ms,
        cuandoDisplay: display,
        texto: evento,
        chip: a.ticker,
        isPast: ms !== null && ms < hace30,
        analisisISO: a.generadoEnISO,
      });
    }
  }

  // Eventos macro
  if (agenda) {
    for (const e of agenda.eventos) {
      const { ms, display } = parseCuando(e.fecha);
      eventos.push({
        cuandoMs: ms,
        cuandoDisplay: display,
        texto: e.evento,
        chip: DRIVER_CHIP[e.driver] ?? 'Macro',
        subtitulo: e.porQueImporta,
        isPast: ms !== null && ms < hace30,
      });
    }
  }

  // Sort: pasados (atenuados) al final, luego por fecha asc, sin fecha al final del bloque futuro
  eventos.sort((a, b) => {
    if (a.isPast !== b.isPast) return a.isPast ? 1 : -1;
    if (a.cuandoMs === null && b.cuandoMs === null) return 0;
    if (a.cuandoMs === null) return 1;
    if (b.cuandoMs === null) return -1;
    return a.cuandoMs - b.cuandoMs;
  });

  return eventos;
}

// ── Card Calendario de eventos ──────────────────────────────────────────────────
function CalendarioCard({ analisisCache, agenda, configIA, generandoAgenda, onGenerarAgenda, onAbrirChatAgenda }: {
  analisisCache: Record<string, AnalisisPosicion>;
  agenda: AgendaMacro | null;
  configIA: ConfigIA;
  generandoAgenda: boolean;
  onGenerarAgenda: () => void;
  onAbrirChatAgenda?: () => void;
}) {
  const fmtFechaISO = (iso: string) => {
    const d = iso.slice(0, 10).split('-');
    return `${d[2]}/${d[1]}/${d[0]}`;
  };
  const fmtDiasAntig = (iso: string) => {
    const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return `análisis hace ${dias}d`;
  };

  const eventos = buildEventosCal(analisisCache, agenda);
  const tieneEventos = eventos.length > 0;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: tieneEventos ? 10 : 6, gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Calendario de eventos</div>
          {agenda && (
            <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 }}>
              agenda del {fmtFechaISO(agenda.generadoEnISO)} · {agenda.horizonteDias}d
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {onAbrirChatAgenda && (
            <button onClick={onAbrirChatAgenda}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: 'var(--color-text-sec)', fontFamily: 'var(--font-base)' }}>
              <Icon name="message-circle" size={12} color="var(--color-text-sec)" />
              Chat
            </button>
          )}
          <button
            onClick={onGenerarAgenda}
            disabled={generandoAgenda || !configIA.habilitado}
            title={!configIA.habilitado ? 'Habilitar IA primero' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '7px 10px',
              borderRadius: 9, border: 'none',
              background: (!configIA.habilitado || generandoAgenda) ? 'var(--gf-gray-200)' : 'var(--color-accent)',
              color: (!configIA.habilitado || generandoAgenda) ? 'var(--gf-gray-400)' : '#fff',
              fontSize: 12, fontWeight: 700, cursor: (!configIA.habilitado || generandoAgenda) ? 'default' : 'pointer',
              fontFamily: 'var(--font-base)',
            }}
          >
            <Icon name="sparkles" size={13} color={(!configIA.habilitado || generandoAgenda) ? 'var(--gf-gray-400)' : '#fff'} />
            {generandoAgenda ? 'Generando…' : agenda ? 'Actualizar agenda' : 'Actualizar agenda macro'}
          </button>
        </div>
      </div>

      {!tieneEventos && (
        <div style={{ fontSize: 12, color: 'var(--gf-gray-400)' }}>
          Generá análisis de posiciones para poblar el calendario.
        </div>
      )}

      {tieneEventos && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {eventos.map((ev, i) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '7px 0',
                borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : undefined,
                opacity: ev.isPast ? 0.45 : 1,
              }}
            >
              <div style={{ minWidth: 54, fontSize: 10.5, color: 'var(--gf-gray-400)', paddingTop: 1, textAlign: 'right', flexShrink: 0 }}>
                {ev.cuandoDisplay}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, lineHeight: 1.4 }}>{ev.texto}</span>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 99,
                    background: 'var(--gf-gray-100)', color: 'var(--color-text-sec)',
                    fontWeight: 700, flexShrink: 0,
                  }}>{ev.chip}</span>
                </div>
                {ev.subtitulo && (
                  <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2, lineHeight: 1.4 }}>{ev.subtitulo}</div>
                )}
                {ev.analisisISO && (
                  <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 1 }}>{fmtDiasAntig(ev.analisisISO)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Solapa Research ───────────────────────────────────────────────────────────
function ResearchTab({ M, configIA, sectorial, generandoSectorial, analizandoLote, loteProgreso, onGenerarSectorial, onAnalizarLote, analisisCache, agenda, generandoAgenda, onGenerarAgenda, onAbrirChat }: {
  M: PatMetrics;
  configIA: ConfigIA;
  sectorial: AnalisisSectorial | null;
  generandoSectorial: boolean;
  analizandoLote: boolean;
  loteProgreso: { actual: number; total: number; errores: string[] } | null;
  onGenerarSectorial: () => void;
  onAnalizarLote: () => void;
  analisisCache: Record<string, AnalisisPosicion>;
  agenda: AgendaMacro | null;
  generandoAgenda: boolean;
  onGenerarAgenda: () => void;
  onAbrirChat: (modo: ModoIA, ticker: string | undefined, contexto: Record<string, unknown>) => void;
}) {
  const fmtFechaISO = (iso: string) => {
    const d = iso.slice(0, 10);
    const [y,m,dd] = d.split('-');
    return `${dd}/${m}/${y}`;
  };
  const pctStr = (x: number) => Math.round(x * 100) + '%';
  const ctxSectorial = { bySector: M.bySector, byTipo: M.byTipo, paisAr: pctStr(M.paisAr), total: M.total };
  const ctxAgenda = (() => {
    const exp: Record<string, string> = {};
    for (const [s, v] of Object.entries(M.bySector)) exp[s] = pctStr(v / (M.total || 1));
    return { exposicion: exp, total: Math.round(M.total), paisAr: pctStr(M.paisAr), cripto: pctStr(M.cripto) };
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Calendario de eventos */}
      <CalendarioCard
        analisisCache={analisisCache}
        agenda={agenda}
        configIA={configIA}
        generandoAgenda={generandoAgenda}
        onGenerarAgenda={onGenerarAgenda}
        onAbrirChatAgenda={() => onAbrirChat('agenda', undefined, ctxAgenda)}
      />

      {/* Analizar lote */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Analizar toda la cartera</span>
          <button
            onClick={onAnalizarLote}
            disabled={!configIA.habilitado || analizandoLote}
            style={{ padding: '7px 12px', borderRadius: 9, border: 'none', background: (!configIA.habilitado || analizandoLote) ? 'var(--gf-gray-200)' : 'var(--color-accent)', color: (!configIA.habilitado || analizandoLote) ? 'var(--gf-gray-400)' : '#fff', fontSize: 12, fontWeight: 700, cursor: (!configIA.habilitado || analizandoLote) ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}
          >
            {analizandoLote ? 'Analizando…' : 'Analizar lote'}
          </button>
        </div>
        {loteProgreso && (
          <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)' }}>
            {loteProgreso.actual} / {loteProgreso.total} tickers
            {loteProgreso.errores.length > 0 && (
              <span style={{ color: 'var(--gf-expense)', marginLeft: 8 }}>· {loteProgreso.errores.length} errores</span>
            )}
          </div>
        )}
        {loteProgreso && loteProgreso.errores.length > 0 && (
          <div style={{ fontSize: 10.5, color: 'var(--gf-expense)', marginTop: 4 }}>
            {loteProgreso.errores.join(' · ')}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 6, lineHeight: 1.4 }}>
          ~{Object.keys(M.bySector).length * 2} tickers · puede tardar varios minutos · consume API
          {!configIA.habilitado && <span style={{ marginLeft: 5 }}>· activar IA en Configuración</span>}
        </div>
      </Card>

      {/* Panorama sectorial */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: sectorial ? 10 : 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Panorama sectorial</div>
              {sectorial?.origen === 'chat' && (
                <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--gf-gray-500)', background: 'var(--gf-gray-100)', borderRadius: 4, padding: '1px 5px' }}>vía chat</span>
              )}
            </div>
            {sectorial && (
              <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 }}>
                {fmtFechaISO(sectorial.generadoEnISO)} · {sectorial.modeloUsado}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => onAbrirChat('sectorial', undefined, ctxSectorial)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: 'var(--color-text-sec)', fontFamily: 'var(--font-base)' }}>
              <Icon name="message-circle" size={12} color="var(--color-text-sec)" />
              Chat
            </button>
            <button
              onClick={onGenerarSectorial}
              disabled={generandoSectorial || !configIA.habilitado}
              title={!configIA.habilitado ? 'Habilitar IA primero' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 9, border: 'none', background: (!configIA.habilitado || generandoSectorial) ? 'var(--gf-gray-200)' : 'var(--color-accent)', color: (!configIA.habilitado || generandoSectorial) ? 'var(--gf-gray-400)' : '#fff', fontSize: 12, fontWeight: 700, cursor: (!configIA.habilitado || generandoSectorial) ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}
            >
              <Icon name="sparkles" size={13} color={(!configIA.habilitado || generandoSectorial) ? 'var(--gf-gray-400)' : '#fff'} />
              {generandoSectorial ? 'Generando…' : sectorial ? 'Regenerar' : 'Generar panorama'}
            </button>
          </div>
        </div>
        {sectorial ? (
          <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--color-text-sec)', whiteSpace: 'pre-wrap' }}>
            {sectorial.resultado}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--gf-gray-400)' }}>
            Sin panorama sectorial generado. Activar IA o usar "Chat".
          </div>
        )}
      </Card>

      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', textAlign: 'center', lineHeight: 1.5 }}>
        Solo el dueño puede generar análisis IA · el modelo describe, contextualiza y muestra riesgos
        · nunca recomienda comprar, vender ni mantener
      </div>
    </div>
  );
}

// ── Modal: registrar/editar flujo (aporte o retiro) ──────────────────────────
function ModalFlujo({
  flujo, onGuardar, onEliminar, onClose,
}: {
  flujo: FlujoPatrimonio | null;
  onGuardar: (data: NuevoFlujo) => void;
  onEliminar?: () => void;
  onClose: () => void;
}) {
  const [fecha, setFecha] = useState(
    flujo ? flujo.fecha.toDate().toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [tipo, setTipo] = useState<'aporte' | 'retiro'>(flujo?.tipo ?? 'aporte');
  const [montoStr, setMontoStr] = useState(flujo ? String(flujo.montoUsd) : '');
  const [cuenta, setCuenta] = useState(flujo?.cuenta ?? '');
  const [nota, setNota] = useState(flujo?.nota ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const monto = parseFloat(montoStr.replace(',', '.'));
  const valid = fecha.length === 10 && !isNaN(monto) && monto > 0;

  function guardar() {
    if (!valid) return;
    const ts = Timestamp.fromDate(new Date(fecha + 'T12:00:00'));
    onGuardar({ fecha: ts, tipo, montoUsd: monto, cuenta: cuenta.trim() || null, nota: nota.trim() });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', background: 'var(--color-surface)', borderRadius: '20px 20px 0 0', padding: '22px 18px 36px', maxHeight: '90dvh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>{flujo ? 'Editar flujo' : 'Registrar flujo'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={20} color="var(--color-text)" />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {(['aporte', 'retiro'] as const).map(t => (
            <button key={t} onClick={() => setTipo(t)} style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: tipo === t ? '2px solid var(--color-accent)' : '1px solid var(--gf-gray-200)', background: tipo === t ? 'rgba(6,95,70,.06)' : 'var(--gf-gray-50)', fontSize: 13, fontWeight: 700, color: tipo === t ? 'var(--color-accent)' : 'var(--color-text-sec)', cursor: 'pointer', fontFamily: 'var(--font-base)', textTransform: 'capitalize' }}>
              {t}
            </button>
          ))}
        </div>

        {[
          { label: 'Fecha', val: fecha, set: setFecha, type: 'date', placeholder: '' },
          { label: 'Monto (USD)', val: montoStr, set: setMontoStr, type: 'text', placeholder: '1000' },
          { label: 'Cuenta (opcional)', val: cuenta, set: setCuenta, type: 'text', placeholder: 'IOL, Balanz…' },
          { label: 'Nota (opcional)', val: nota, set: setNota, type: 'text', placeholder: 'descripción libre' },
        ].map(f => (
          <div key={f.label} style={{ marginBottom: 13 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', marginBottom: 5 }}>{f.label}</div>
            <input type={f.type} value={f.val} placeholder={f.placeholder} onChange={e => f.set(e.target.value)}
              style={{ width: '100%', padding: '11px 13px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', fontSize: 14, fontFamily: 'var(--font-base)', background: 'var(--gf-gray-50)', boxSizing: 'border-box' }} />
          </div>
        ))}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '12px 14px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={!valid} style={{ flex: 2, padding: '12px 14px', borderRadius: 11, border: 'none', background: valid ? 'var(--color-accent)' : 'var(--gf-gray-200)', color: valid ? '#fff' : 'var(--gf-gray-400)', fontSize: 14, fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'var(--font-base)' }}>
            {flujo ? 'Guardar cambios' : 'Registrar'}
          </button>
        </div>

        {flujo && onEliminar && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--gf-gray-100)', paddingTop: 14 }}>
            {!confirmDelete
              ? <button onClick={() => setConfirmDelete(true)} style={{ width: '100%', padding: '11px', borderRadius: 11, border: '1px solid #fca5a5', background: 'none', fontSize: 13, fontWeight: 700, color: 'var(--gf-expense)', cursor: 'pointer', fontFamily: 'var(--font-base)' }}>Eliminar flujo</button>
              : <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setConfirmDelete(false)} style={{ flex: 1, padding: '11px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', background: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>No</button>
                  <button onClick={onEliminar} style={{ flex: 2, padding: '11px', borderRadius: 11, border: 'none', background: 'var(--gf-expense)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>Confirmar eliminación</button>
                </div>
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ── Card: aportes y retiros ───────────────────────────────────────────────────
function AportesRetirosCard({ flujos, onAdd, onEdit }: {
  flujos: FlujoPatrimonio[];
  onAdd: () => void;
  onEdit: (f: FlujoPatrimonio) => void;
}) {
  const fmtFechaTs = (ts: Timestamp) => { const d = ts.toDate(); const y = d.getFullYear(), m = d.getMonth()+1, dd = d.getDate(); return `${String(dd).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`; };
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: flujos.length > 0 ? 10 : 0 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Aportes y retiros</div>
          {flujos.length === 0 && <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 }}>Sin flujos registrados — el retorno de la evolución no descuenta aportes</div>}
        </div>
        <button onClick={onAdd} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 11px', borderRadius: 9, border: '1px solid var(--gf-gray-200)', background: 'none', fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
          <Icon name="plus" size={13} color="var(--color-text-sec)" /> Agregar
        </button>
      </div>
      {flujos.map((f, i) => (
        <button key={f.id} onClick={() => onEdit(f)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 0', borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-base)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: f.tipo === 'aporte' ? 'var(--gf-income)' : 'var(--gf-expense)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'var(--gf-gray-400)', minWidth: 52 }}>{fmtFechaTs(f.fecha)}</span>
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1, textTransform: 'capitalize' }}>{f.tipo}{f.cuenta ? ` · ${f.cuenta}` : ''}</span>
          <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: f.tipo === 'aporte' ? 'var(--gf-income)' : 'var(--gf-expense)' }}>{f.tipo === 'aporte' ? '+' : '−'}U$S {f.montoUsd.toLocaleString('es-AR')}</span>
          <Icon name="chevron-right" size={14} color="var(--gf-gray-300)" />
        </button>
      ))}
    </Card>
  );
}

// ── Card de fondos CAFCI ──────────────────────────────────────────────────────
function CafciFondosCard({ configCafci, sincronizando, onSincronizar, onGuardar }: {
  configCafci: ConfigCafci;
  sincronizando: boolean;
  onSincronizar: () => void;
  onGuardar: (c: ConfigCafci) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [fondoId, setFondoId] = useState('');
  const [claseId, setClaseId] = useState('');
  const [agregando, setAgregando] = useState(false);

  function addFondo() {
    if (!nombre.trim() || !fondoId.trim() || !claseId.trim()) return;
    const nuevo: CafciFondoConfig = { fondoId: fondoId.trim(), claseId: claseId.trim(), nombre: nombre.trim() };
    onGuardar({ fondos: [...configCafci.fondos, nuevo] });
    setNombre(''); setFondoId(''); setClaseId(''); setAgregando(false);
  }

  const inp: React.CSSProperties = {
    padding: '8px 10px', borderRadius: 8, border: '1px solid var(--gf-gray-200)',
    fontSize: 12.5, fontFamily: 'var(--font-base)', width: '100%', boxSizing: 'border-box',
  };

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Fondos CAFCI (benchmark)</div>
          <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 }}>
            {configCafci.fondos.length} fondo{configCafci.fondos.length !== 1 ? 's' : ''} configurado{configCafci.fondos.length !== 1 ? 's' : ''}
          </div>
        </div>
        <button
          onClick={onSincronizar}
          disabled={sincronizando || configCafci.fondos.length === 0}
          style={{
            padding: '7px 13px', borderRadius: 9, border: 'none',
            cursor: sincronizando || configCafci.fondos.length === 0 ? 'not-allowed' : 'pointer',
            background: sincronizando || configCafci.fondos.length === 0 ? 'var(--gf-gray-100)' : 'var(--color-accent)',
            color: sincronizando || configCafci.fondos.length === 0 ? 'var(--gf-gray-400)' : '#fff',
            fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-base)',
          }}
        >
          {sincronizando ? 'Sincronizando…' : 'Sincronizar'}
        </button>
      </div>
      {configCafci.fondos.length === 0 && !agregando && (
        <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', marginBottom: 10, lineHeight: 1.5 }}>
          Agregá fondos para comparar tu cartera con carteras de fondos CAFCI.
          Necesitás el <strong>fondoId</strong> y <strong>claseId</strong> de la URL de cafci.org.ar.
        </div>
      )}
      {configCafci.fondos.map((f, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: i < configCafci.fondos.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{f.nombre}</div>
            <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 1 }}>fondo {f.fondoId} · clase {f.claseId}</div>
          </div>
          <button onClick={() => onGuardar({ fondos: configCafci.fondos.filter((_, j) => j !== i) })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={14} color="var(--gf-gray-400)" />
          </button>
        </div>
      ))}
      {agregando ? (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <input placeholder="Nombre del fondo" value={nombre} onChange={e => setNombre(e.target.value)} style={inp} />
          <div style={{ display: 'flex', gap: 7 }}>
            <input placeholder="fondoId" value={fondoId} onChange={e => setFondoId(e.target.value)} style={{ ...inp, width: undefined, flex: 1, minWidth: 0 }} />
            <input placeholder="claseId" value={claseId} onChange={e => setClaseId(e.target.value)} style={{ ...inp, width: undefined, flex: 1, minWidth: 0 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={addFondo} disabled={!nombre.trim() || !fondoId.trim() || !claseId.trim()}
              style={{ flex: 1, padding: '8px 0', borderRadius: 9, border: 'none', cursor: 'pointer', background: 'var(--color-accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-base)' }}>
              Agregar
            </button>
            <button onClick={() => setAgregando(false)}
              style={{ flex: 1, padding: '8px 0', borderRadius: 9, border: 'none', cursor: 'pointer', background: 'var(--gf-gray-100)', color: 'var(--color-text-sec)', fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--font-base)' }}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAgregando(true)} style={{ marginTop: configCafci.fondos.length > 0 ? 10 : 0, width: '100%', padding: '8px 0', borderRadius: 9, border: '1.5px dashed var(--gf-gray-200)', background: 'transparent', color: 'var(--gf-gray-400)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
          + Agregar fondo
        </button>
      )}
    </Card>
  );
}

// ── Solapa Benchmark ──────────────────────────────────────────────────────────
function BenchmarkTab({ posiciones, carteras, mappings }: {
  posiciones: Posicion[];
  carteras: CafciCartera[];
  mappings: Record<string, string | null>;
}) {
  if (carteras.length === 0) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Sin datos de fondos</div>
          <div style={{ fontSize: 12.5, color: 'var(--gf-gray-400)', lineHeight: 1.5 }}>
            Configurá al menos un fondo CAFCI en la solapa Config y tocá "Sincronizar" para cargar sus carteras.
          </div>
        </div>
      </Card>
    );
  }

  const possPropias = posiciones.map(p => ({ ticker: p.ticker, valorUsd: p.valorUsd }));
  const { filas, soloenFondos, soloEnPropio } = calcBenchmark(possPropias, carteras, mappings);
  const filasEnAmbos = filas.filter(f => f.propioPct !== null && f.fondosAvgPct > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
          Divergencia vs fondos — {carteras.length} fondo{carteras.length !== 1 ? 's' : ''}
        </div>
        {filasEnAmbos.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--gf-gray-400)', lineHeight: 1.5 }}>
            Sin tickers en común con los fondos. Revisá los mappings de especies en Config una vez que la sincronización corra.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 58px 68px 50px', gap: 4, fontSize: 10, color: 'var(--gf-gray-400)', fontWeight: 700, marginBottom: 6 }}>
              <div>Ticker</div>
              <div style={{ textAlign: 'right' }}>Propio</div>
              <div style={{ textAlign: 'right' }}>Fondos avg</div>
              <div style={{ textAlign: 'right' }}>Δ</div>
            </div>
            {filasEnAmbos.map(f => {
              const delta = (f.propioPct ?? 0) - f.fondosAvgPct;
              const col = Math.abs(delta) > 0.05 ? 'var(--gf-expense)' : Math.abs(delta) > 0.02 ? '#f59e0b' : 'var(--gf-gray-400)';
              return (
                <div key={f.ticker} style={{ display: 'grid', gridTemplateColumns: '1fr 58px 68px 50px', gap: 4, padding: '5px 0', borderBottom: '1px solid var(--gf-gray-100)', fontSize: 12.5, alignItems: 'center' }}>
                  <div style={{ fontWeight: 700 }}>{f.ticker}</div>
                  <div style={{ textAlign: 'right' }}>{(Math.round((f.propioPct ?? 0) * 1000) / 10).toFixed(1)}%</div>
                  <div style={{ textAlign: 'right', color: 'var(--gf-gray-500)' }}>
                    {(Math.round(f.fondosAvgPct * 1000) / 10).toFixed(1)}%
                    {f.fondosMinPct !== f.fondosMaxPct && (
                      <div style={{ fontSize: 9, color: 'var(--gf-gray-300)' }}>
                        {(Math.round(f.fondosMinPct * 1000) / 10).toFixed(1)}–{(Math.round(f.fondosMaxPct * 1000) / 10).toFixed(1)}%
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', color: col, fontWeight: 700 }}>
                    {delta > 0 ? '+' : ''}{(Math.round(delta * 1000) / 10).toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </>
        )}
      </Card>

      {soloenFondos.length > 0 && (
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>En fondos, no en tu cartera</div>
          {soloenFondos.map(f => (
            <div key={f.ticker} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--gf-gray-100)', fontSize: 12.5 }}>
              <span style={{ fontWeight: 600 }}>{f.ticker}</span>
              <span style={{ color: 'var(--gf-gray-500)', fontSize: 11.5 }}>{(Math.round(f.avgPct * 1000) / 10).toFixed(1)}% avg</span>
            </div>
          ))}
        </Card>
      )}

      {soloEnPropio.length > 0 && (
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>En tu cartera, no en fondos</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {soloEnPropio.map(t => (
              <span key={t} style={{ padding: '3px 9px', borderRadius: 20, background: 'var(--gf-gray-100)', fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-sec)' }}>{t}</span>
            ))}
          </div>
        </Card>
      )}

      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', textAlign: 'center', padding: '4px 0' }}>
        {carteras.map(c => c.nombre).join(' · ')} · {carteras[0]?.fechaDatos ?? '—'}
      </div>
    </div>
  );
}

// ── Solapa Configuración ──────────────────────────────────────────────────────
function ConfigTab({ activosFijos, manuales, configIA, fechaCorrida, flujos, configCafci, sincronizandoCafci, onEditFijo, onAddFijo, onEditManual, onAddManual, onToggleIA, onAddFlujo, onEditFlujo, onSincronizarCafci, onGuardarConfigCafci }: {
  activosFijos: ActivoFijo[];
  manuales: PosicionManual[];
  configIA: ConfigIA;
  fechaCorrida: string;
  flujos: FlujoPatrimonio[];
  configCafci: ConfigCafci;
  sincronizandoCafci: boolean;
  onEditFijo: (af: ActivoFijo) => void;
  onAddFijo: () => void;
  onEditManual: (pm: PosicionManual) => void;
  onAddManual: () => void;
  onToggleIA: (val: boolean) => void;
  onAddFlujo: () => void;
  onEditFlujo: (f: FlujoPatrimonio) => void;
  onSincronizarCafci: () => void;
  onGuardarConfigCafci: (c: ConfigCafci) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PosicionesManualesCard manuales={manuales} fechaCorrida={fechaCorrida} onEdit={onEditManual} onAdd={onAddManual} />
      <ActivosFijosCard activosFijos={activosFijos} onEdit={onEditFijo} onAdd={onAddFijo} />
      <AportesRetirosCard flujos={flujos} onAdd={onAddFlujo} onEdit={onEditFlujo} />
      <CafciFondosCard configCafci={configCafci} sincronizando={sincronizandoCafci} onSincronizar={onSincronizarCafci} onGuardar={onGuardarConfigCafci} />
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Análisis IA</div>
            <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 }}>
              {configIA.habilitado ? 'Habilitado · consume API de Anthropic' : 'Deshabilitado · no llama a la API'}
            </div>
          </div>
          <button
            onClick={() => onToggleIA(!configIA.habilitado)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
          >
            <Icon name={configIA.habilitado ? 'toggle-right' : 'toggle-left'} size={28} color={configIA.habilitado ? 'var(--color-accent)' : 'var(--gf-gray-400)'} />
          </button>
        </div>
      </Card>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Actualización de precios</div>
            <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 }}>Próximamente</div>
          </div>
          <Icon name="toggle-left" size={28} color="var(--gf-gray-300)" />
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', marginTop: 10, lineHeight: 1.5 }}>
          Traerá cotizaciones de referencia (cripto y NYSE) con un botón manual. Los precios de referencia NUNCA
          modifican la corrida: se muestran como línea informativa junto al valor oficial. Métricas, semáforos
          e informes siguen calculando sobre la corrida documentada.
        </div>
      </Card>
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Edición manual del portafolio</div>
        <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2, marginBottom: 10 }}>Próximamente</div>
        <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', lineHeight: 1.5 }}>
          Permitirá registrar ajustes manuales trazables (alta/baja/corrección) entre corridas, sin editar la corrida original.
        </div>
      </Card>
    </div>
  );
}

// ── Helper: ticker de portfolio → símbolo Yahoo Finance ──────────────────────
function toYahooTicker(ticker: string, tipo: string, pais_riesgo: string, _moneda: string): string {
  if (ticker.includes('-USD') || ticker.endsWith('.BA')) return ticker;
  if (tipo === 'cripto') return ticker + '-USD';
  if (pais_riesgo === 'AR') return ticker + '.BA';
  return ticker;
}

// ── Solapa Optimización (F9.98) ───────────────────────────────────────────────
function OptimizacionTab({
  posiciones, resultado, calculando, error, onCalcular,
}: {
  posiciones: Array<{ ticker: string; tipo: string; pais_riesgo: string; moneda_origen: string; valorUsd: number }>;
  resultado: ResultadoOptimizacion | null;
  calculando: boolean;
  error: string | null;
  onCalcular: (semanas: number, pesoMax: number) => void;
}) {
  const [semanas, setSemanas] = useState(104);
  const [pesoMax, setPesoMax] = useState(0.15);
  const [showTests, setShowTests] = useState(false);
  const [testResults, setTestResults] = useState<ReturnType<typeof correrTests> | null>(null);

  const aptas = posiciones.filter(p => ['accion', 'cedear', 'cripto'].includes(p.tipo));
  const totalUsd = posiciones.reduce((s, p) => s + p.valorUsd, 0) || 1;

  const btn = { padding: '8px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-base)' } as const;
  const secH = { fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase' as const, letterSpacing: '.4px', marginBottom: 6 };
  const chip = (text: string, col: string, bg: string) => (
    <span style={{ fontSize: 10.5, fontWeight: 700, color: col, background: bg, borderRadius: 5, padding: '2px 6px' }}>{text}</span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Advertencias (siempre visible) */}
      <Card>
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={secH}>Límites de esta optimización</div>
          <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
            · <strong>Series AR cortas:</strong> el tipo de cambio (MEP) solo cubre ~6 meses. Los activos AR se excluyen hasta acumular ≥40 semanas de TC.
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
            · <strong>Correlaciones en crisis:</strong> todos los activos AR colapsan a 1 simultáneamente. Esta optimización complementa — no reemplaza — los escenarios de estrés de la solapa Plan.
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
            · <strong>Sin retornos esperados históricos:</strong> métodos usados (mín. varianza y risk parity) no requieren estimarlos — así se evita sobreponderar lo que ya subió.
          </div>
        </div>
      </Card>

      {/* Parámetros + botón */}
      <Card>
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={secH}>Parámetros</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>
              Ventana:
              <select value={semanas} onChange={e => setSemanas(Number(e.target.value))}
                style={{ marginLeft: 6, fontSize: 12, borderRadius: 6, border: '1px solid var(--gf-gray-200)', padding: '3px 6px', background: 'var(--color-surface)', fontFamily: 'var(--font-base)' }}>
                <option value={52}>52 sem (1 año)</option>
                <option value={104}>104 sem (2 años)</option>
                <option value={156}>156 sem (3 años)</option>
              </select>
            </label>
            <label style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>
              Peso máx.:
              <select value={pesoMax} onChange={e => setPesoMax(Number(e.target.value))}
                style={{ marginLeft: 6, fontSize: 12, borderRadius: 6, border: '1px solid var(--gf-gray-200)', padding: '3px 6px', background: 'var(--color-surface)', fontFamily: 'var(--font-base)' }}>
                <option value={0.10}>10%</option>
                <option value={0.15}>15%</option>
                <option value={0.20}>20%</option>
                <option value={0.25}>25%</option>
                <option value={1.0}>Sin límite</option>
              </select>
            </label>
            <button onClick={() => onCalcular(semanas, pesoMax)} disabled={calculando || aptas.length === 0}
              style={{ ...btn, background: calculando ? 'var(--gf-gray-200)' : 'var(--color-accent)', color: calculando ? 'var(--gf-gray-400)' : '#fff' }}>
              <Icon name={calculando ? 'loader' : 'zap'} size={12} color={calculando ? 'var(--gf-gray-400)' : '#fff'} style={{ marginRight: 5, verticalAlign: 'middle' }} />
              {calculando ? 'Calculando…' : resultado ? 'Recalcular' : 'Calcular optimización'}
            </button>
          </div>
          {error && <div style={{ fontSize: 11.5, color: 'var(--gf-expense)', marginTop: 4 }}>{error}</div>}
        </div>
      </Card>

      {/* Posiciones incluibles */}
      <Card>
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={secH}>Posiciones elegibles</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {aptas.map(p => {
              const sym = toYahooTicker(p.ticker, p.tipo, p.pais_riesgo, p.moneda_origen);
              const sinSerie = resultado?.sinSerieSuficiente?.includes(sym);
              return (
                <span key={p.ticker} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, background: sinSerie ? 'var(--gf-gray-100)' : 'var(--gf-emerald-50, #d1fae5)', borderRadius: 6, padding: '3px 8px', color: sinSerie ? 'var(--gf-gray-400)' : 'var(--gf-emerald)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: sinSerie ? 'var(--gf-gray-300)' : 'var(--gf-emerald)', flexShrink: 0 }} />
                  {sym}
                  {sinSerie && <span style={{ fontSize: 10, color: 'var(--gf-gray-400)' }}>sin serie</span>}
                </span>
              );
            })}
            {aptas.length === 0 && <span style={{ fontSize: 12, color: 'var(--gf-gray-400)' }}>Sin posiciones elegibles</span>}
          </div>
        </div>
      </Card>

      {resultado && (
        <>
          {/* Heatmap de correlaciones */}
          <Card>
            <div style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={secH}>Matriz de correlaciones</div>
                <span style={{ fontSize: 10.5, color: 'var(--gf-gray-400)' }}>{resultado.semanas} sem · shrinkage α=0.2</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }} />
                      {resultado.correlacion.simbolos.map(s => (
                        <th key={s} style={{ padding: '0 4px', fontWeight: 700, color: 'var(--gf-gray-400)', fontSize: 10, maxWidth: 50, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.correlacion.simbolos.map((rowSym, i) => (
                      <tr key={rowSym}>
                        <td style={{ fontWeight: 700, color: 'var(--gf-gray-400)', fontSize: 10, paddingRight: 6, whiteSpace: 'nowrap' }}>{rowSym}</td>
                        {resultado.correlacion.matriz[i].map((v, j) => {
                          const abs = Math.abs(v);
                          const bg = i === j
                            ? 'var(--gf-gray-200)'
                            : `rgba(100,100,100,${(abs * 0.5).toFixed(2)})`;
                          return (
                            <td key={j} style={{ background: bg, padding: '4px 6px', textAlign: 'center', borderRadius: 3, border: '1px solid var(--gf-gray-100)' }}>
                              {i === j ? '—' : v.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          {/* Carteras propuestas */}
          <Card>
            <div style={{ padding: '12px 14px' }}>
              <div style={secH}>Carteras calculadas vs actual</div>
              <div style={{ overflowX: 'auto', marginTop: 6 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--gf-gray-200)' }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 700, color: 'var(--gf-gray-400)', fontSize: 11 }}>Activo</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 700, color: 'var(--gf-gray-400)', fontSize: 11 }}>Actual</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 700, color: 'var(--gf-gray-400)', fontSize: 11 }}>Mín. var.</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 700, color: 'var(--gf-gray-400)', fontSize: 11 }}>Risk P.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.deltasMinVarianza.map(row => {
                      const rpPeso = resultado.riskParity.pesos[row.simbolo] ?? 0;
                      const rpDelta = rpPeso - row.pesoActual;
                      return (
                        <tr key={row.simbolo} style={{ borderBottom: '1px solid var(--gf-gray-100)' }}>
                          <td style={{ padding: '5px 8px', fontWeight: 700 }}>{row.simbolo}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--color-text-sec)' }}>{(row.pesoActual * 100).toFixed(1)}%</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                            <span>{(row.pesoOptimo * 100).toFixed(1)}%</span>
                            <span style={{ fontSize: 10, marginLeft: 4, color: row.delta > 0.01 ? 'var(--gf-emerald)' : row.delta < -0.01 ? 'var(--color-text-sec)' : 'var(--gf-gray-400)' }}>
                              {row.delta > 0 ? '+' : ''}{(row.delta * 100).toFixed(1)}pp
                            </span>
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                            <span>{(rpPeso * 100).toFixed(1)}%</span>
                            <span style={{ fontSize: 10, marginLeft: 4, color: rpDelta > 0.01 ? 'var(--gf-emerald)' : rpDelta < -0.01 ? 'var(--color-text-sec)' : 'var(--gf-gray-400)' }}>
                              {rpDelta > 0 ? '+' : ''}{(rpDelta * 100).toFixed(1)}pp
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '1px solid var(--gf-gray-200)' }}>
                      <td style={{ padding: '4px 8px', fontSize: 11, color: 'var(--gf-gray-400)' }}>Volatilidad (sem.)</td>
                      <td />
                      <td style={{ padding: '4px 8px', textAlign: 'right', fontSize: 11, color: 'var(--gf-gray-400)' }}>{(resultado.minVarianza.volatilidad * 100).toFixed(2)}%</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', fontSize: 11, color: 'var(--gf-gray-400)' }}>{(resultado.riskParity.volatilidad * 100).toFixed(2)}%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {resultado.sinSerieSuficiente.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {resultado.sinSerieSuficiente.map(s => chip(s + ' sin serie', 'var(--gf-gray-400)', 'var(--gf-gray-100)'))}
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--gf-gray-400)' }}>
                Cartera calculada (no prescriptiva) · {new Date(resultado.fechaCalculo).toLocaleDateString('es-AR')}
              </div>
            </div>
          </Card>

          {/* Tests unitarios */}
          <div>
            <button onClick={() => { setShowTests(!showTests); if (!testResults) setTestResults(correrTests()); }}
              style={{ ...btn, background: 'var(--gf-gray-100)', color: 'var(--color-text-sec)', width: '100%' }}>
              {showTests ? 'Ocultar tests matemáticos' : 'Verificar tests unitarios del motor'}
            </button>
            {showTests && testResults && (
              <Card>
                <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {testResults.map(t => (
                    <div key={t.nombre} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 13, lineHeight: 1, marginTop: 1 }}>{t.ok ? '✓' : '✗'}</span>
                      <div>
                        <div style={{ fontSize: 11.5, fontWeight: 700 }}>{t.nombre}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-sec)' }}>{t.detalle}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Modal chat path (F9.99) ────────────────────────────────────────────────────
function ModalPromptChat({
  modo, ticker, contexto, onDone, onClose,
}: {
  modo: ModoIA;
  ticker?: string;
  contexto: Record<string, unknown>;
  onDone: () => void;
  onClose: () => void;
}) {
  const [paso, setPaso] = useState<1 | 2>(1);
  const [promptText, setPromptText] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [contenido, setContenido] = useState('');
  const [validando, setValidando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importado, setImportado] = useState(false);
  const nombreModo = modo === 'posicion' ? `Posición ${ticker}` : modo === 'sectorial' ? 'Sectorial' : 'Agenda macro';

  useEffect(() => {
    setCargando(true);
    setError(null);
    generarPromptIA(modo, contexto, ticker)
      .then(r => setPromptText(r.prompt))
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCargando(false));
  }, []);

  const copiar = () => {
    navigator.clipboard.writeText(promptText);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const descargar = () => {
    const nombre = `prompt-ia-${modo}-${ticker || 'general'}-${new Date().toISOString().slice(0, 10)}.txt`;
    const blob = new Blob([promptText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre; a.click();
    URL.revokeObjectURL(url);
  };

  const validarEImportar = async () => {
    setValidando(true);
    setError(null);
    try {
      await importarAnalisisIA(modo, contenido, ticker);
      setImportado(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setValidando(false);
    }
  };

  const btn = { padding: '9px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-base)' } as const;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: 'var(--color-surface)', borderRadius: '18px 18px 0 0', width: '100%', maxWidth: 480, padding: '20px 16px 32px', display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '90dvh', overflow: 'auto' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Analizar vía chat · {nombreModo}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={18} color="var(--color-text-sec)" />
          </button>
        </div>

        {/* Selector de paso */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--gf-gray-100)', borderRadius: 9, padding: 3 }}>
          {([1, 2] as const).map(p => (
            <button key={p} onClick={() => setPaso(p)} style={{ flex: 1, padding: '7px 4px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12.5, background: paso === p ? 'var(--color-surface)' : 'transparent', color: paso === p ? 'var(--color-text)' : 'var(--gf-gray-400)', fontFamily: 'var(--font-base)' }}>
              Paso {p} · {p === 1 ? 'Prompt' : 'Importar'}
            </button>
          ))}
        </div>

        {paso === 1 && (
          <>
            <div style={{ fontSize: 12, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
              Pegá este prompt en un chat de Claude (claude.ai). Luego volvé al Paso 2 con la respuesta.
            </div>
            {cargando && <div style={{ fontSize: 12, color: 'var(--gf-gray-400)', textAlign: 'center', padding: 16 }}>Generando prompt…</div>}
            {error && <div style={{ fontSize: 12, color: 'var(--gf-expense)' }}>{error}</div>}
            {promptText && (
              <textarea readOnly value={promptText} rows={8}
                style={{ fontSize: 11.5, borderRadius: 8, border: '1px solid var(--gf-gray-200)', padding: '8px 10px', resize: 'vertical', background: 'var(--gf-gray-50)', fontFamily: 'var(--font-base)', color: 'var(--color-text)' }} />
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={copiar} disabled={!promptText} style={{ ...btn, flex: 1, background: copiado ? 'var(--gf-emerald)' : 'var(--gf-gray-100)', color: copiado ? '#fff' : 'var(--color-text)' }}>
                <Icon name={copiado ? 'check' : 'copy'} size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
              <button onClick={descargar} disabled={!promptText} style={{ ...btn, flex: 1, background: 'var(--gf-gray-100)', color: 'var(--color-text)' }}>
                <Icon name="download" size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                Descargar .txt
              </button>
            </div>
            <button onClick={() => setPaso(2)} disabled={!promptText} style={{ ...btn, background: 'var(--color-accent)', color: '#fff' }}>
              Ir al Paso 2 →
            </button>
          </>
        )}

        {paso === 2 && (
          <>
            {importado ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', padding: '12px 0' }}>
                <span style={{ fontSize: 28 }}>✓</span>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Análisis importado</div>
                <button onClick={onDone} style={{ ...btn, background: 'var(--color-accent)', color: '#fff', width: '100%' }}>Cerrar</button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
                  Pegá la respuesta de Claude. Puede incluir los fences {modo === 'sectorial' ? '```markdown' : '```json'} o no.
                </div>
                <textarea value={contenido} onChange={e => { setContenido(e.target.value); setError(null); }} rows={8} placeholder={modo === 'sectorial' ? 'Pegar texto aquí…' : 'Pegar JSON aquí…'}
                  style={{ fontSize: 11.5, borderRadius: 8, border: `1px solid ${error ? 'var(--gf-expense)' : 'var(--gf-gray-200)'}`, padding: '8px 10px', resize: 'vertical', fontFamily: 'var(--font-base)', color: 'var(--color-text)', background: 'var(--color-surface)' }} />
                {error && <div style={{ fontSize: 11.5, color: 'var(--gf-expense)' }}>{error}</div>}
                <button onClick={validarEImportar} disabled={!contenido.trim() || validando}
                  style={{ ...btn, background: validando ? 'var(--gf-gray-200)' : 'var(--color-accent)', color: validando ? 'var(--gf-gray-400)' : '#fff' }}>
                  {validando ? 'Validando…' : 'Validar e importar'}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Vista principal ───────────────────────────────────────────────────────────
const TABS = [
  ['resumen',      'Resumen'],
  ['tenencias',    'Tenencias'],
  ['riesgo',       'Riesgo'],
  ['plan',         'Plan'],
  ['benchmark',    'Bench'],
  ['optimizacion', 'Optim'],
  ['research',     'Research'],
  ['config',       'Config'],
] as const;
type TabId = typeof TABS[number][0];

export default function Patrimonio() {
  const [tab, setTab] = useState<TabId>('resumen');
  const [tc, setTc] = useState(TC_DEFAULT);

  const [posiciones,        setPosiciones]        = useState<Posicion[]>([]);
  const [activosFijos,      setActivosFijos]      = useState<ActivoFijo[]>([]);
  const [posicionesManuales, setPosicionesManuales] = useState<PosicionManual[]>([]);
  const [fechaCorrida,      setFechaCorrida]      = useState('');
  const [historial,         setHistorial]         = useState<SnapshotResumen[]>([]);
  const [loading, setLoading] = useState(true);

  const [informes,          setInformes]         = useState<InformeAnterior[]>([]);
  const [generandoInforme, setGenerandoInforme] = useState(false);

  const [configIA,           setConfigIA]          = useState<ConfigIA>({ habilitado: false });
  const [analisisCache,      setAnalisisCache]      = useState<Record<string, AnalisisPosicion>>({});
  const [sectorial,          setSectorial]          = useState<AnalisisSectorial | null>(null);
  const [generandoSectorial, setGenerandoSectorial] = useState(false);
  const [analizandoLote,     setAnalizandoLote]     = useState(false);
  const [loteProgreso,       setLoteProgreso]       = useState<{ actual: number; total: number; errores: string[] } | null>(null);
  const [agenda,             setAgenda]             = useState<AgendaMacro | null>(null);
  const [generandoAgenda,    setGenerandoAgenda]    = useState(false);

  const [decisiones,          setDecisiones]          = useState<DecisionPatrimonio[]>([]);
  const [showModalDecision,   setShowModalDecision]   = useState(false);
  const [preloadDecision,     setPreloadDecision]     = useState<{ opcionReferencia: 'A' | 'B' | 'C' | null; tickers: string[] } | null>(null);
  const [showModalRevision,   setShowModalRevision]   = useState<{ decision: DecisionPatrimonio; tipo: '30d' | '90d' } | null>(null);

  const [flujos,             setFlujos]             = useState<FlujoPatrimonio[]>([]);
  const [showModalFlujo,   setShowModalFlujo]   = useState(false);
  const [editFlujo,        setEditFlujo]        = useState<FlujoPatrimonio | null>(null);

  const [configCafci,        setConfigCafci]        = useState<ConfigCafci>({ fondos: [] });
  const [cafciCarteras,      setCafciCarteras]      = useState<CafciCartera[]>([]);
  const [cafciMappings,      setCafciMappings]      = useState<Record<string, string | null>>({});
  const [sincronizandoCafci, setSincronizandoCafci] = useState(false);

  // F9.98 — Optimización
  const [optimizacion,          setOptimizacion]          = useState<ResultadoOptimizacion | null>(null);
  const [calculandoOptimizacion, setCalculandoOptimizacion] = useState(false);
  const [errorOptimizacion,     setErrorOptimizacion]     = useState<string | null>(null);

  // F9.99 — Modal chat path
  const [modalPromptChat, setModalPromptChat] = useState<{
    modo: ModoIA;
    ticker?: string;
    contexto: Record<string, unknown>;
    onDone: () => void;
  } | null>(null);

  const [showIngesta,      setShowIngesta]      = useState(false);
  const [showModalFijo,    setShowModalFijo]    = useState(false);
  const [editFijo,         setEditFijo]         = useState<ActivoFijo | null>(null);
  const [showModalManual,  setShowModalManual]  = useState(false);
  const [editManual,       setEditManual]       = useState<PosicionManual | null>(null);

  useEffect(() => {
    cargarTCReciente(1).then(h => { if (h[0]) setTc(h[0].tcUsdArs); });
    cargarConfigIA().then(setConfigIA);
    cargarUltimoSectorial().then(setSectorial);
    cargarUltimaAgenda().then(setAgenda);
    cargarTodosLosAnalisis().then(lista => {
      const cache: Record<string, AnalisisPosicion> = {};
      for (const a of lista) cache[a.ticker] = a;
      setAnalisisCache(cache);
    });
    cargarConfigCafci().then(setConfigCafci);
    cargarUltimasCarteras().then(setCafciCarteras);
    cargarMappings().then(setCafciMappings);
    cargarUltimaOptimizacion().then(setOptimizacion);
  }, []);

  function cargar() {
    setLoading(true);
    Promise.all([
      cargarPosicionesVigentes(),
      cargarActivosFijos(),
      cargarPosicionesManuales(),
      cargarHistorialSnapshots(10),
      cargarInformesAnteriores(5),
      cargarDecisiones(),
      cargarFlujos(),
    ])
      .then(([pos, fijos, manuales, hist, infs, decs, flujos]) => {
        setPosiciones(pos);
        setActivosFijos(fijos);
        setPosicionesManuales(manuales);
        setHistorial(hist);
        setInformes(infs);
        setDecisiones(decs);
        setFlujos(flujos);
        if (pos.length > 0) setFechaCorrida(pos[0].fechaCorrida);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { cargar(); }, []);

  async function handleGuardarFijo(af: ActivoFijo) {
    await guardarActivoFijo(af);
    setActivosFijos(prev => {
      const idx = prev.findIndex(x => x.id === af.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = af; return next; }
      return [...prev, af];
    });
    setShowModalFijo(false);
  }

  async function handleEliminarFijo(id: string) {
    await eliminarActivoFijo(id);
    setActivosFijos(prev => prev.filter(x => x.id !== id));
    setShowModalFijo(false);
  }

  async function handleGuardarManual(pm: PosicionManual) {
    await guardarPosicionManual(pm);
    setPosicionesManuales(prev => {
      const idx = prev.findIndex(x => x.id === pm.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = pm; return next; }
      return [...prev, pm];
    });
    setShowModalManual(false);
  }

  async function handleEliminarManual(id: string) {
    await eliminarPosicionManual(id);
    setPosicionesManuales(prev => prev.filter(x => x.id !== id));
    setShowModalManual(false);
  }

  async function handleGuardarFlujo(data: NuevoFlujo) {
    if (editFlujo) {
      await actualizarFlujo(editFlujo.id, data);
      setFlujos(prev => prev.map(f => f.id === editFlujo.id ? { ...f, ...data } : f));
    } else {
      const nuevo = await crearFlujo(data);
      setFlujos(prev => [nuevo, ...prev].sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis()));
    }
    setShowModalFlujo(false);
  }

  async function handleEliminarFlujo(id: string) {
    await eliminarFlujo(id);
    setFlujos(prev => prev.filter(f => f.id !== id));
    setShowModalFlujo(false);
  }

  async function handleGuardarConfigCafci(c: ConfigCafci) {
    await guardarConfigCafci(c);
    setConfigCafci(c);
  }

  async function handleSincronizarCafci() {
    if (sincronizandoCafci) return;
    setSincronizandoCafci(true);
    try {
      await sincronizarCafciCallable();
      // Recargar carteras tras sincronizar
      const [carteras, mappings] = await Promise.all([cargarUltimasCarteras(), cargarMappings()]);
      setCafciCarteras(carteras);
      setCafciMappings(mappings);
    } catch (e) {
      console.error('[sincronizarCafci]', e);
    } finally {
      setSincronizandoCafci(false);
    }
  }

  // Manuales fusionadas con corrida para métricas (lente invertible incluye manuales)
  const todasPosiciones = [...posiciones, ...posicionesManuales.map(manualToPosicion)];

  async function handleAnalizarPosicion(ticker: string, contexto: Record<string, unknown>) {
    try {
      const result = await analizarPosicion(ticker, contexto);
      setAnalisisCache(prev => ({ ...prev, [ticker]: result }));
    } catch (e) {
      console.error('[analizarPosicion]', e);
    }
  }

  async function handleAnalizarLote() {
    if (!M || analizandoLote) return;
    // Collect tickers from consolidated list
    const byTickerMap: Record<string, { totalUsd: number; sectorDisp: string }> = {};
    for (const p of todasPosiciones) {
      const sec = (() => { const base = SECTOR_DISPLAY[p.sector] ?? p.sector; if (p.sector === 'cripto' || p.sector === 'cash' || p.sector === 'global') return base; return base + (p.pais_riesgo === 'AR' ? ' AR' : ' Global'); })();
      if (!byTickerMap[p.ticker]) byTickerMap[p.ticker] = { totalUsd: 0, sectorDisp: sec };
      byTickerMap[p.ticker].totalUsd += p.valorUsd;
    }
    const tickers = Object.keys(byTickerMap);
    setAnalizandoLote(true);
    setLoteProgreso({ actual: 0, total: tickers.length, errores: [] });
    const errores: string[] = [];
    for (let i = 0; i < tickers.length; i++) {
      const t = tickers[i];
      const { totalUsd, sectorDisp } = byTickerMap[t];
      try {
        const result = await analizarPosicion(t, { ticker: t, sector: sectorDisp, pesoEnCartera: pct(totalUsd / (M.total || 1)), valorUsd: Math.round(totalUsd) });
        setAnalisisCache(prev => ({ ...prev, [t]: result }));
      } catch {
        errores.push(t);
      }
      setLoteProgreso({ actual: i + 1, total: tickers.length, errores: [...errores] });
    }
    setAnalizandoLote(false);
  }

  async function handleGenerarSectorial() {
    if (generandoSectorial) return;
    setGenerandoSectorial(true);
    try {
      const result = await analizarSectorial({ bySector: M?.bySector ?? {}, byTipo: M?.byTipo ?? {}, paisAr: pct(M?.paisAr ?? 0), total: M?.total ?? 0 });
      setSectorial(result);
    } catch (e) {
      console.error('[generarSectorial]', e);
    } finally {
      setGenerandoSectorial(false);
    }
  }

  async function handleGenerarAgenda() {
    if (!M || generandoAgenda) return;
    setGenerandoAgenda(true);
    try {
      // Arma exposición por driver desde bySector normalizado a %
      const exposicion: Record<string, string> = {};
      for (const [sector, val] of Object.entries(M.bySector)) {
        exposicion[sector] = pct(val / (M.total || 1));
      }
      const result = await generarAgenda({ exposicion, total: Math.round(M.total), paisAr: pct(M.paisAr), cripto: pct(M.cripto) });
      setAgenda(result);
    } catch (e) {
      console.error('[generarAgenda]', e);
    } finally {
      setGenerandoAgenda(false);
    }
  }

  async function handleCrearDecision(nueva: NuevaDecision) {
    const d = await crearDecision(nueva);
    setDecisiones(prev => [d, ...prev]);
    setShowModalDecision(false);
  }

  async function handleAgregarRevision(decisionId: string, tipo: '30d' | '90d', notas: string, metricas: MetricasSnap) {
    const estadoNuevo: DecisionPatrimonio['estado'] = tipo === '90d' ? 'revisada90' : 'revisada30';
    const rev = await agregarRevision(decisionId, tipo, notas, metricas, estadoNuevo);
    setDecisiones(prev => prev.map(d =>
      d.id === decisionId ? { ...d, revisiones: [...d.revisiones, rev], estado: estadoNuevo } : d
    ));
    setShowModalRevision(null);
  }

  async function handleToggleIA(val: boolean) {
    const next = { habilitado: val };
    setConfigIA(next);
    await guardarConfigIA(next);
  }

  async function handleGenerarInforme() {
    if (!M || generandoInforme) return;
    setGenerandoInforme(true);
    try {
      const stressResults: StressResult[] = STRESS_ESCENARIOS.map(e => {
        const { perdidaUsd, totalResultante, total } = calcStress(todasPosiciones, e.shock);
        return { nombre: e.nombre, perdidaUsd, perdidaPct: total > 0 ? perdidaUsd / total : 0, totalResultante, total };
      });
      const opcionResults: OpcionResult[] = OPCIONES_CONFIG.map(o => {
        const { liberadoUsd, movimientos, antes, despues, total } = simularOpcion(todasPosiciones, o);
        return { id: o.id, titulo: o.titulo, descripcion: o.descripcion, liberadoUsd, total, riesgos: o.riesgos, movimientos, antes, despues };
      });
      const nuevo = await generarYArchivarInforme({
        posiciones, activosFijos, manuales: posicionesManuales,
        historial, tc, fechaCorrida, M,
        stressResults, opcionResults,
      });
      setInformes(prev => [nuevo, ...prev].slice(0, 5));
    } finally {
      setGenerandoInforme(false);
    }
  }
  const totalManualesUsd = posicionesManuales.reduce((s, m) => s + m.valorUsd, 0);

  const pendingReviewCount = decisiones.filter(d => revisionPendiente(d) !== null).length;

  const M = todasPosiciones.length > 0 ? calcMetrics(todasPosiciones) : null;
  const metricasJson: Record<string, unknown> = M
    ? { top1: M.top1, top3: M.top3, top5: M.top5, hhi: M.hhi, sectorTop: M.sectorTop,
        paisAr: M.paisAr, cripto: M.cripto, rvPct: M.rvPct, total: M.total, totalManualesUsd }
    : {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
          Portafolio
        </div>
        <button
          onClick={() => setShowIngesta(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)', color: 'var(--color-text)' }}
        >
          <Icon name="upload" size={13} color="var(--color-text-sec)" /> Actualizar posiciones
        </button>
      </div>

      {/* Segmentado de solapas */}
      <div style={{ display: 'flex', gap: 3, background: 'var(--gf-gray-100)', borderRadius: 11, padding: 3 }}>
        {TABS.map(([id, label]) => {
          const on = tab === id;
          return (
            <button key={id} onClick={() => setTab(id)} style={{
              flex: id === 'config' ? 'none' : 1,
              padding: id === 'config' ? '8px 10px' : '8px 4px',
              borderRadius: 9, border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-base)', fontSize: 11, fontWeight: on ? 700 : 600,
              background: on ? 'var(--color-surface)' : 'transparent',
              color: on ? 'var(--color-text)' : 'var(--color-text-sec)',
              boxShadow: on ? 'var(--shadow-sm)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {id === 'config'
                ? <Icon name="settings-2" size={15} color={on ? 'var(--color-text)' : 'var(--color-text-sec)'} />
                : id === 'plan' && pendingReviewCount > 0
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {label}
                      <span style={{ width: 6, height: 6, borderRadius: 999, background: '#f59e0b', flexShrink: 0 }} />
                    </span>
                  : label}
            </button>
          );
        })}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-sec)', fontSize: 13 }}>
          Cargando portafolio…
        </div>
      )}

      {!loading && posiciones.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Sin corrida vigente</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-sec)', marginBottom: 20 }}>
            Subí el archivo .txt de posiciones para cargar el portafolio.
          </div>
          <button onClick={() => setShowIngesta(true)} style={{ padding: '12px 24px', borderRadius: 12, border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
            Actualizar posiciones
          </button>
        </div>
      )}

      {!loading && M && (
        <>
          {tab === 'resumen' && (
            <ResumenTab
              M={M} tc={tc} fechaCorrida={fechaCorrida}
              activosFijos={activosFijos}
              historial={historial}
              flujos={flujos}
              informes={informes}
              generandoInforme={generandoInforme}
              onGenerarInforme={handleGenerarInforme}
            />
          )}
          {tab === 'tenencias' && (
            <TenenciasTab
              M={M} posiciones={posiciones} manuales={posicionesManuales} fechaCorrida={fechaCorrida}
              analisisCache={analisisCache}
              configIA={configIA}
              onAnalizar={handleAnalizarPosicion}
            />
          )}
          {tab === 'riesgo'    && <RiesgoTab M={M} posiciones={todasPosiciones} />}
          {tab === 'benchmark' && (
            <BenchmarkTab posiciones={todasPosiciones} carteras={cafciCarteras} mappings={cafciMappings} />
          )}
          {tab === 'plan' && (
            <PlanTab
              M={M} posiciones={todasPosiciones}
              decisiones={decisiones}
              onRegistrarLibre={() => { setPreloadDecision(null); setShowModalDecision(true); }}
              onRegistrarDesdeOpcion={(opcionId, tickers) => { setPreloadDecision({ opcionReferencia: opcionId, tickers }); setShowModalDecision(true); }}
              onIniciarRevision={(decision, tipo) => setShowModalRevision({ decision, tipo })}
            />
          )}
          {tab === 'optimizacion' && (
            <OptimizacionTab
              posiciones={todasPosiciones}
              resultado={optimizacion}
              calculando={calculandoOptimizacion}
              error={errorOptimizacion}
              onCalcular={async (semanas, pesoMax) => {
                setCalculandoOptimizacion(true);
                setErrorOptimizacion(null);
                try {
                  // Derivar símbolos y pesos actuales
                  const sym = todasPosiciones
                    .filter(p => ['accion', 'cedear', 'cripto'].includes(p.tipo))
                    .map(p => toYahooTicker(p.ticker, p.tipo, p.pais_riesgo, p.moneda_origen));
                  const totalUsd = todasPosiciones.reduce((s, p) => s + p.valorUsd, 0) || 1;
                  const pesosActuales: Record<string, number> = {};
                  for (const p of todasPosiciones.filter(p => ['accion','cedear','cripto'].includes(p.tipo))) {
                    const sym2 = toYahooTicker(p.ticker, p.tipo, p.pais_riesgo, p.moneda_origen);
                    pesosActuales[sym2] = (pesosActuales[sym2] ?? 0) + (p.valorUsd / totalUsd);
                  }
                  const uniqueSym = [...new Set(sym)];

                  const { series: rawSeries, faltantes } = await obtenerSeriesPrecios(uniqueSym, semanas);

                  // Dolarizar series ARS usando tcDiario
                  const MIN_OBS = 40;
                  const seriesDolar: Record<string, PuntoPrecio[]> = {};
                  const excluidos: string[] = [...faltantes];

                  // Calcular rango de fechas necesario
                  const hasta = new Date().toISOString().slice(0, 10);
                  const desde = new Date(Date.now() - semanas * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
                  let tcByDate: Record<string, number> = {};

                  const tieneARS = Object.values(rawSeries).some(s => s.moneda === 'ARS');
                  if (tieneARS) {
                    tcByDate = await cargarTCRango(desde, hasta);
                  }

                  for (const [s, serie] of Object.entries(rawSeries)) {
                    if (serie.moneda === 'USD') {
                      seriesDolar[s] = serie.puntos;
                    } else {
                      const { puntos: dolarizados, excluir } = dolarizarSerie(serie.puntos, tcByDate, MIN_OBS);
                      if (excluir) {
                        excluidos.push(s);
                      } else {
                        seriesDolar[s] = dolarizados;
                      }
                    }
                  }

                  const resultado = calcularOptimizacion(seriesDolar, pesosActuales, semanas, pesoMax, MIN_OBS);
                  resultado.sinSerieSuficiente = [...new Set([...resultado.sinSerieSuficiente, ...excluidos])];
                  await guardarOptimizacion(resultado);
                  setOptimizacion(resultado);
                } catch (e) {
                  setErrorOptimizacion(e instanceof Error ? e.message : String(e));
                } finally {
                  setCalculandoOptimizacion(false);
                }
              }}
            />
          )}
          {tab === 'research'  && (
            <ResearchTab
              M={M}
              configIA={configIA}
              sectorial={sectorial}
              generandoSectorial={generandoSectorial}
              analizandoLote={analizandoLote}
              loteProgreso={loteProgreso}
              onGenerarSectorial={handleGenerarSectorial}
              onAnalizarLote={handleAnalizarLote}
              analisisCache={analisisCache}
              agenda={agenda}
              generandoAgenda={generandoAgenda}
              onGenerarAgenda={handleGenerarAgenda}
              onAbrirChat={(modo, ticker, contexto) => {
                const onDone = () => {
                  if (modo === 'sectorial') cargarUltimoSectorial().then(setSectorial);
                  if (modo === 'agenda') cargarUltimaAgenda().then(setAgenda);
                  if (modo === 'posicion' && ticker) {
                    cargarAnalisisPosicion(ticker).then(a => {
                      if (a) setAnalisisCache(prev => ({ ...prev, [ticker]: a }));
                    });
                  }
                };
                setModalPromptChat({ modo, ticker, contexto, onDone });
              }}
            />
          )}
          {tab === 'config' && (
            <ConfigTab
              activosFijos={activosFijos}
              manuales={posicionesManuales}
              configIA={configIA}
              fechaCorrida={fechaCorrida}
              flujos={flujos}
              configCafci={configCafci}
              sincronizandoCafci={sincronizandoCafci}
              onEditFijo={af => { setEditFijo(af); setShowModalFijo(true); }}
              onAddFijo={() => { setEditFijo(null); setShowModalFijo(true); }}
              onEditManual={pm => { setEditManual(pm); setShowModalManual(true); }}
              onAddManual={() => { setEditManual(null); setShowModalManual(true); }}
              onToggleIA={handleToggleIA}
              onAddFlujo={() => { setEditFlujo(null); setShowModalFlujo(true); }}
              onEditFlujo={f => { setEditFlujo(f); setShowModalFlujo(true); }}
              onSincronizarCafci={handleSincronizarCafci}
              onGuardarConfigCafci={handleGuardarConfigCafci}
            />
          )}
        </>
      )}

      <div style={{ height: 4 }} />

      {showIngesta && (
        <PatrimonioIngesta
          posicionesPrevias={posiciones}
          activosFijos={activosFijos}
          totalManualesUsd={totalManualesUsd}
          metricasJson={metricasJson}
          onConfirmado={() => { setShowIngesta(false); cargar(); }}
          onClose={() => setShowIngesta(false)}
        />
      )}

      {showModalFijo && (
        <ModalActivoFijo
          af={editFijo}
          onGuardar={handleGuardarFijo}
          onEliminar={editFijo ? handleEliminarFijo : undefined}
          onClose={() => setShowModalFijo(false)}
        />
      )}

      {showModalManual && (
        <ModalPosicionManual
          pm={editManual}
          onGuardar={handleGuardarManual}
          onEliminar={editManual ? handleEliminarManual : undefined}
          onClose={() => setShowModalManual(false)}
        />
      )}

      {showModalFlujo && (
        <ModalFlujo
          flujo={editFlujo}
          onGuardar={handleGuardarFlujo}
          onEliminar={editFlujo ? () => handleEliminarFlujo(editFlujo.id) : undefined}
          onClose={() => setShowModalFlujo(false)}
        />
      )}

      {showModalDecision && M && (
        <ModalRegistrarDecision
          preload={preloadDecision}
          metricasActuales={buildMetricasSnap(M, todasPosiciones)}
          onGuardar={handleCrearDecision}
          onClose={() => setShowModalDecision(false)}
        />
      )}

      {showModalRevision && M && (
        <ModalRevision
          decision={showModalRevision.decision}
          tipo={showModalRevision.tipo}
          metricasActuales={buildMetricasSnap(M, todasPosiciones)}
          onGuardar={(notas, metricas) =>
            handleAgregarRevision(showModalRevision.decision.id, showModalRevision.tipo, notas, metricas)
          }
          onClose={() => setShowModalRevision(null)}
        />
      )}

      {modalPromptChat && (
        <ModalPromptChat
          modo={modalPromptChat.modo}
          ticker={modalPromptChat.ticker}
          contexto={modalPromptChat.contexto}
          onDone={() => { modalPromptChat.onDone(); setModalPromptChat(null); }}
          onClose={() => setModalPromptChat(null)}
        />
      )}
    </div>
  );
}
