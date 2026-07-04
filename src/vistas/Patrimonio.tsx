import { useState, useEffect } from 'react';
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
import type { Posicion, ActivoFijo, PosicionManual, PosicionTipo } from '../types/patrimonio';
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
type PatMetrics = {
  total: number;
  bySector: Record<string, number>;
  byTipo: Record<string, number>;
  byPais: { AR: number; global: number };
  nombreTop: { ticker: string };   // top no-cripto agregado por ticker
  top1: number; top3: number; top5: number; hhi: number;
  sectorTop: { nombre: string; pct: number };
  paisAr: number; cripto: number; rvPct: number;
};

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
  const segs = Object.entries(M.bySector).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', marginBottom: 14, background: 'var(--gf-gray-100)' }}>
        {segs.map(([k, v]) => (
          <div key={k} title={k} style={{ width: pct(v / M.total), background: sectorColor(k) }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {segs.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: sectorColor(k), flexShrink: 0 }} />
            <span style={{ fontWeight: 600 }}>{k}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(v)}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{pct(v / M.total)}</span>
          </div>
        ))}
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
function OpcionCard({ opcion, posiciones }: { opcion: OpcionConfig; posiciones: Posicion[] }) {
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
    </Card>
  );
}

// ── Solapa Resumen ────────────────────────────────────────────────────────────
function ResumenTab({ M, tc, fechaCorrida, activosFijos, manuales, historial, onEditFijo, onAddFijo, onEditManual, onAddManual }: {
  M: PatMetrics; tc: number; fechaCorrida: string;
  activosFijos: ActivoFijo[];
  manuales: PosicionManual[];
  historial: SnapshotResumen[];
  onEditFijo: (af: ActivoFijo) => void;
  onAddFijo: () => void;
  onEditManual: (pm: PosicionManual) => void;
  onAddManual: () => void;
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
      {/* 1. Hero negro — lente total */}
      <div style={{ background: 'var(--gf-ink)', color: '#fff', borderRadius: 20, padding: '22px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', opacity: .7 }}>
          Patrimonio total
        </div>
        <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-1px', margin: '4px 0 2px', fontVariantNumeric: 'tabular-nums' }}>
          {fmtUsd(patrimTotal)}
        </div>
        <div style={{ fontSize: 12.5, opacity: .65, fontVariantNumeric: 'tabular-nums' }}>
          {fmtArs(patrimTotal, tc)} · al {fmtFecha(fechaCorrida)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.12)', flexWrap: 'wrap' }}>
          {[
            { label: 'Invertible', val: fmtUsd(M.total) },
            { label: 'Fijos', val: fmtUsd(fijosUsd) },
            { label: 'Cripto ¹', val: pct(M.cripto) },
            { label: 'Arg. ¹', val: pct(M.paisAr) },
          ].map(({ label, val }) => (
            <span key={label}>
              <span style={{ display: 'block', fontSize: 10.5, opacity: .6 }}>{label}</span>
              <span style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{val}</span>
            </span>
          ))}
        </div>
        <div style={{ fontSize: 10, opacity: .4, marginTop: 8 }}>¹ sobre portfolio invertible</div>
      </div>

      {/* 1b. Variación vs corrida anterior */}
      {deltaInv !== null && corrPrev && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ color: deltaInv >= 0 ? 'var(--gf-income)' : 'var(--gf-expense)', fontWeight: 700 }}>
            {deltaInv >= 0 ? '+' : ''}{fmtUsd(deltaInv)}
          </span>
          <span style={{ color: 'var(--gf-gray-400)' }}>
            ({deltaInv >= 0 ? '+' : ''}{pct(deltaInv / (corrPrev.totalInvertibleUsd || 1))}) · vs corrida {fmtFecha(corrPrev.fechaCorrida)}
          </span>
        </div>
      )}

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

      {/* 4. Evolución entre corridas */}
      {historial.length > 1 && (
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Evolución</div>
          {historial.map((s, i) => {
            const prev = historial[i + 1];
            const delta = prev ? s.totalInvertibleUsd - prev.totalInvertibleUsd : null;
            return (
              <div key={s.fechaCorrida} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : 'none', fontSize: 13 }}>
                <span style={{ color: 'var(--gf-gray-400)', minWidth: 54, fontSize: 12 }}>{fmtFecha(s.fechaCorrida)}</span>
                <span style={{ flex: 1, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(s.totalInvertibleUsd)}</span>
                {delta !== null && (
                  <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: delta >= 0 ? 'var(--gf-income)' : 'var(--gf-expense)', fontWeight: 600 }}>
                    {delta >= 0 ? '+' : ''}{pct(delta / (prev!.totalInvertibleUsd || 1))}
                  </span>
                )}
                {i === 0 && <span style={{ fontSize: 10, background: 'var(--gf-gray-100)', borderRadius: 4, padding: '2px 5px', color: 'var(--gf-gray-400)', fontWeight: 700 }}>HOY</span>}
              </div>
            );
          })}
          <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 8, lineHeight: 1.4 }}>
            La variación refleja cambio de valor, no retorno: no descuenta aportes ni retiros entre corridas.
          </div>
        </Card>
      )}

      {/* 5. Posiciones manuales */}
      <PosicionesManualesCard manuales={manuales} fechaCorrida={fechaCorrida} onEdit={onEditManual} onAdd={onAddManual} />

      {/* 6. Activos fijos */}
      <ActivosFijosCard activosFijos={activosFijos} onEdit={onEditFijo} onAdd={onAddFijo} />
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

function TenenciasTab({ M, posiciones, manuales, fechaCorrida }: {
  M: PatMetrics; posiciones: Posicion[]; manuales: PosicionManual[]; fechaCorrida: string;
}) {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

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
                  {/* Gancho F9.93: ancla de análisis IA por ticker */}
                  <div data-f993-ticker={c.ticker} style={{ display: 'none' }} />
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

// ── Solapa Plan ───────────────────────────────────────────────────────────────
function PlanTab({ M, posiciones }: { M: PatMetrics; posiciones: Posicion[] }) {
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
      {OPCIONES_CONFIG.map(o => (
        <OpcionCard key={o.id} opcion={o} posiciones={posiciones} />
      ))}
      <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--gf-gray-100)', fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
        Estas opciones miden direcciones posibles, no son recomendaciones. Podés combinarlas o ignorarlas.
      </div>
      <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--gf-gray-100)', fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
        No es asesoramiento matriculado. Las posiciones ganadoras en USD tienen costo impositivo al vender; conviene pensar gradual. Parte está en cuentas conjuntas.
      </div>
    </div>
  );
}

// ── Vista principal ───────────────────────────────────────────────────────────
const TABS = [
  ['resumen',   'Resumen'],
  ['tenencias', 'Tenencias'],
  ['riesgo',    'Riesgo'],
  ['plan',      'Plan'],
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

  const [showIngesta,      setShowIngesta]      = useState(false);
  const [showModalFijo,    setShowModalFijo]    = useState(false);
  const [editFijo,         setEditFijo]         = useState<ActivoFijo | null>(null);
  const [showModalManual,  setShowModalManual]  = useState(false);
  const [editManual,       setEditManual]       = useState<PosicionManual | null>(null);

  useEffect(() => {
    cargarTCReciente(1).then(h => { if (h[0]) setTc(h[0].tcUsdArs); });
  }, []);

  function cargar() {
    setLoading(true);
    Promise.all([
      cargarPosicionesVigentes(),
      cargarActivosFijos(),
      cargarPosicionesManuales(),
      cargarHistorialSnapshots(10),
    ])
      .then(([pos, fijos, manuales, hist]) => {
        setPosiciones(pos);
        setActivosFijos(fijos);
        setPosicionesManuales(manuales);
        setHistorial(hist);
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

  // Manuales fusionadas con corrida para métricas (lente invertible incluye manuales)
  const todasPosiciones = [...posiciones, ...posicionesManuales.map(manualToPosicion)];
  const totalManualesUsd = posicionesManuales.reduce((s, m) => s + m.valorUsd, 0);

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
              flex: 1, padding: '8px 4px', borderRadius: 9, border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-base)', fontSize: 12.5, fontWeight: on ? 700 : 600,
              background: on ? 'var(--color-surface)' : 'transparent',
              color: on ? 'var(--color-text)' : 'var(--color-text-sec)',
              boxShadow: on ? 'var(--shadow-sm)' : 'none',
            }}>
              {label}
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
              activosFijos={activosFijos} manuales={posicionesManuales}
              historial={historial}
              onEditFijo={af => { setEditFijo(af); setShowModalFijo(true); }}
              onAddFijo={() => { setEditFijo(null); setShowModalFijo(true); }}
              onEditManual={pm => { setEditManual(pm); setShowModalManual(true); }}
              onAddManual={() => { setEditManual(null); setShowModalManual(true); }}
            />
          )}
          {tab === 'tenencias' && <TenenciasTab M={M} posiciones={posiciones} manuales={posicionesManuales} fechaCorrida={fechaCorrida} />}
          {tab === 'riesgo'    && <RiesgoTab M={M} posiciones={todasPosiciones} />}
          {tab === 'plan'      && <PlanTab M={M} posiciones={todasPosiciones} />}
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
    </div>
  );
}
