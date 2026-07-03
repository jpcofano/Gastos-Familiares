import { useState, useEffect } from 'react';
import { cargarTCReciente } from '../datos/tcDiario';
import { TC_DEFAULT } from '../datos/money';
import { Card, MerchantLogo } from '../design-system/components';

// F9.84 — Vista privada de portafolio de inversiones.
// Gateada a jpcofano@gmail.com (esAdmin + email exacto) en AppShell.
// Datos mock de la foto real ~USD 100k al 01/07/2026 (§5 del prompt).
// Motor de métricas determinístico en front (§2); semáforos UCITS/HHI (§3).
// Solapa Resumen implementada con Variante A (hero oscuro + composición por sector).

// ── Tipo Posicion (contrato §1, NO reusar tipos de gastos) ──────────────────
type Posicion = {
  cuenta: string;
  ticker: string;
  nombre: string;
  tipo: 'accion' | 'bono' | 'on' | 'cedear' | 'fci' | 'cripto' | 'cash';
  sector: string;
  pais: 'AR' | 'global';
  monedaOrigen: 'ARS' | 'USD';
  valorUsd: number;
  revisar?: boolean;
};

// ── Datos mock (foto real 01/07/2026, §5) ───────────────────────────────────
// Copiados de PAT_POS en PatrimonioMobile.jsx con campo valorUsd.
const PAT_POS: Posicion[] = [
  { cuenta: 'Balanz 1120830', ticker: 'TRAN',  nombre: 'Transener',             tipo: 'accion', sector: 'Energía AR',    pais: 'AR',     monedaOrigen: 'ARS', valorUsd: 17800 },
  { cuenta: 'Balanz 1120830', ticker: 'PAMP',  nombre: 'Pampa Energía',          tipo: 'accion', sector: 'Energía AR',    pais: 'AR',     monedaOrigen: 'ARS', valorUsd: 11100 },
  { cuenta: 'Acciones',       ticker: 'YPFD',  nombre: 'YPF',                   tipo: 'accion', sector: 'Energía AR',    pais: 'AR',     monedaOrigen: 'ARS', valorUsd: 10000 },
  { cuenta: 'Acciones',       ticker: 'VIST',  nombre: 'Vista Energy',           tipo: 'accion', sector: 'Energía AR',    pais: 'AR',     monedaOrigen: 'ARS', valorUsd: 7800 },
  { cuenta: 'Acciones',       ticker: 'TGSU2', nombre: 'Transportadora Gas Sur', tipo: 'accion', sector: 'Energía AR',    pais: 'AR',     monedaOrigen: 'ARS', valorUsd: 3500 },
  { cuenta: 'Acciones',       ticker: 'CEPU',  nombre: 'Central Puerto',         tipo: 'accion', sector: 'Energía AR',    pais: 'AR',     monedaOrigen: 'ARS', valorUsd: 2800 },
  { cuenta: 'Cripto',         ticker: 'BTC',   nombre: 'Bitcoin',                tipo: 'cripto', sector: 'Cripto',        pais: 'global', monedaOrigen: 'USD', valorUsd: 20000 },
  { cuenta: 'Cripto',         ticker: 'ETH',   nombre: 'Ethereum',               tipo: 'cripto', sector: 'Cripto',        pais: 'global', monedaOrigen: 'USD', valorUsd: 10000 },
  { cuenta: 'Balanz 402665',  ticker: 'TX26',  nombre: 'Boncer TX26',            tipo: 'bono',   sector: 'Renta fija AR', pais: 'AR',     monedaOrigen: 'ARS', valorUsd: 13000 },
  { cuenta: 'Balanz 402665',  ticker: 'GD30',  nombre: 'Global 2030',            tipo: 'bono',   sector: 'Renta fija AR', pais: 'AR',     monedaOrigen: 'USD', valorUsd: 6700 },
  { cuenta: 'Balanz 402665',  ticker: 'BMA',   nombre: 'Banco Macro',            tipo: 'accion', sector: 'Bancos AR',     pais: 'AR',     monedaOrigen: 'ARS', valorUsd: 5500 },
  { cuenta: 'Acciones',       ticker: 'GOLD',  nombre: 'Barrick Gold',           tipo: 'cedear', sector: 'Global',        pais: 'global', monedaOrigen: 'ARS', valorUsd: 900 },
  { cuenta: 'Acciones',       ticker: 'CVX',   nombre: 'Chevron',                tipo: 'cedear', sector: 'Global',        pais: 'global', monedaOrigen: 'ARS', valorUsd: 900 },
  { cuenta: 'Acciones',       ticker: 'VZ',    nombre: 'Verizon',                tipo: 'cedear', sector: 'Global',        pais: 'global', monedaOrigen: 'ARS', valorUsd: 800 },
  { cuenta: 'Acciones',       ticker: 'GLOB',  nombre: 'Globant',                tipo: 'cedear', sector: 'Global',        pais: 'global', monedaOrigen: 'ARS', valorUsd: 700 },
];

const PAT_META = { fecha: '01/07/2026', declaradoUsd: 111000 };

const SECTOR_COL: Record<string, string> = {
  'Energía AR':     '#f5a623',
  'Cripto':         '#f7931a',
  'Renta fija AR':  '#4f8ef7',
  'Bancos AR':      '#2bb673',
  'Global':         '#a855f7',
};

const TIPO_LABEL: Record<string, string> = {
  accion: 'Acción', bono: 'Bono', on: 'ON', cedear: 'CEDEAR',
  fci: 'FCI', cripto: 'Cripto', cash: 'Cash',
};

// ── Formateo ─────────────────────────────────────────────────────────────────
function fmtUsd(n: number): string {
  return `U$S ${Math.round(n).toLocaleString('es-AR')}`;
}
function fmtArs(n: number, tc: number): string {
  return `$ ${Math.round(n * tc).toLocaleString('es-AR')}`;
}
const pct = (x: number) => Math.round(x * 100) + '%';

// ── Motor de métricas (§2, determinístico) ───────────────────────────────────
type PatMetrics = {
  total: number;
  bySector: Record<string, number>;
  byTipo: Record<string, number>;
  byPais: { AR: number; global: number };
  orden: Posicion[];
  nombreTop: Posicion;
  top1: number;
  top3: number;
  top5: number;
  hhi: number;
  sectorTop: { nombre: string; pct: number };
  paisAr: number;
  cripto: number;
  rvPct: number;
};

function calcMetrics(): PatMetrics {
  const total = PAT_POS.reduce((s, p) => s + p.valorUsd, 0);
  const bySector: Record<string, number> = {};
  const byTipo: Record<string, number> = {};
  const byPais = { AR: 0, global: 0 };

  for (const p of PAT_POS) {
    bySector[p.sector] = (bySector[p.sector] ?? 0) + p.valorUsd;
    byTipo[p.tipo]     = (byTipo[p.tipo]     ?? 0) + p.valorUsd;
    byPais[p.pais]    += p.valorUsd;
  }

  const orden = [...PAT_POS].sort((a, b) => b.valorUsd - a.valorUsd);
  // Top-1 "nombre más grande" excluye cripto (la cripto se mide como CLASE con banda propia)
  const nombreTop = [...PAT_POS].filter(p => p.tipo !== 'cripto').sort((a, b) => b.valorUsd - a.valorUsd)[0];
  const top1 = nombreTop.valorUsd / total;
  const top3 = orden.slice(0, 3).reduce((s, p) => s + p.valorUsd, 0) / total;
  const top5 = orden.slice(0, 5).reduce((s, p) => s + p.valorUsd, 0) / total;
  const hhi  = PAT_POS.reduce((s, p) => s + Math.pow(p.valorUsd / total, 2), 0);

  const sectorEntry = Object.entries(bySector).sort((a, b) => b[1] - a[1])[0];
  const cripto = (byTipo.cripto ?? 0) / total;
  const rvUsd  = PAT_POS
    .filter(p => p.tipo === 'accion' || p.tipo === 'cedear' || p.tipo === 'cripto')
    .reduce((s, p) => s + p.valorUsd, 0);

  return {
    total, bySector, byTipo, byPais, orden, nombreTop,
    top1, top3, top5, hhi,
    sectorTop: { nombre: sectorEntry[0], pct: sectorEntry[1] / total },
    paisAr: byPais.AR / total,
    cripto, rvPct: rvUsd / total,
  };
}

// ── Semáforos (§3, bandas UCITS 5/10/40 + HHI DOJ) ──────────────────────────
type BandaNombre = 'nombre' | 'sector' | 'pais' | 'cripto' | 'hhi';
const BANDAS: Record<BandaNombre, [number, number]> = {
  nombre: [0.05, 0.10],
  sector: [0.25, 0.40],
  pais:   [0.40, 0.60],
  cripto: [0.10, 0.20],
  hhi:    [0.15, 0.25],
};
function banda(metrica: BandaNombre, v: number): 'verde' | 'amarillo' | 'rojo' {
  const [b0, b1] = BANDAS[metrica];
  return v <= b0 ? 'verde' : v <= b1 ? 'amarillo' : 'rojo';
}
const SEM = {
  verde:    { dot: 'var(--gf-emerald)',  label: 'En banda',     bg: 'var(--gf-emerald-50)' },
  amarillo: { dot: 'var(--gf-out)',      label: 'Atención',     bg: 'rgba(245,158,11,.12)' },
  rojo:     { dot: 'var(--gf-expense)',  label: 'Concentrado',  bg: 'rgba(220,38,38,.10)'  },
} as const;

// ── Barra apilada por sector ──────────────────────────────────────────────────
function CompBar({ M }: { M: PatMetrics }) {
  const segs = Object.entries(M.bySector).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', marginBottom: 14, background: 'var(--gf-gray-100)' }}>
        {segs.map(([k, v]) => (
          <div key={k} title={k} style={{ width: pct(v / M.total), background: SECTOR_COL[k] }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {segs.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: SECTOR_COL[k], flexShrink: 0 }} />
            <span style={{ fontWeight: 600 }}>{k}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(v)}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{pct(v / M.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Bienes fuera del portafolio ───────────────────────────────────────────────
const PAT_BIENES = [
  { label: 'Departamento (Del Signo)', usd: 220000 },
  { label: 'Auto', usd: 10000 },
];

// ── Solapa Resumen — Variante A fija (F9.84.1) ───────────────────────────────
// 1. Hero negro · 2. 3 riesgos semáforo · 3. Primeras 3 palancas · 4. Patrimonio total
function ResumenTab({ M, tc }: { M: PatMetrics; tc: number }) {
  const bienesUsd = PAT_BIENES.reduce((s, b) => s + b.usd, 0);
  const patrimTotal = M.total + bienesUsd;

  const riesgos: { k: string; v: number; b: ReturnType<typeof banda>; extra?: string }[] = [
    { k: 'Nombre más grande', v: M.top1, b: banda('nombre', M.top1), extra: M.nombreTop.ticker },
    { k: 'Sector top', v: M.sectorTop.pct, b: banda('sector', M.sectorTop.pct), extra: M.sectorTop.nombre },
    { k: 'Cripto (clase)', v: M.cripto, b: banda('cripto', M.cripto) },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 1. Hero negro */}
      <div style={{ background: 'var(--gf-ink)', color: '#fff', borderRadius: 20, padding: '22px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', opacity: .7 }}>
          Valor del portafolio
        </div>
        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-1px', margin: '4px 0 2px', fontVariantNumeric: 'tabular-nums' }}>
          {fmtUsd(M.total)}
        </div>
        <div style={{ fontSize: 13, opacity: .7, fontVariantNumeric: 'tabular-nums' }}>
          {fmtArs(M.total, tc)} · al {PAT_META.fecha}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.12)' }}>
          <span>
            <span style={{ display: 'block', fontSize: 11, opacity: .6 }}>Argentina</span>
            <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pct(M.paisAr)}</span>
          </span>
          <span>
            <span style={{ display: 'block', fontSize: 11, opacity: .6 }}>Cripto</span>
            <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pct(M.cripto)}</span>
          </span>
          <span>
            <span style={{ display: 'block', fontSize: 11, opacity: .6 }}>% Renta variable</span>
            <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pct(M.rvPct)}</span>
          </span>
        </div>
      </div>

      {/* 2. Riesgos principales — 3 chips semáforo (HeadlineSem) */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Riesgos principales</div>
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

      {/* 3. Recomendaciones — primeras 3 palancas */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 2px 8px' }}>
          Recomendaciones
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PAT_PALANCAS.slice(0, 3).map(p => (
            <Card key={p.n}>
              <div style={{ display: 'flex', gap: 12 }}>
                <span style={{ width: 26, height: 26, borderRadius: 999, background: 'var(--gf-ink)', color: '#fff', fontSize: 13, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {p.n}
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>{p.titulo}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--color-text-sec)', marginTop: 4, lineHeight: 1.45 }}>{p.texto}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* 4. Patrimonio total (pie, chico) */}
      <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--gf-gray-100)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
          Patrimonio total
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: 'var(--color-text-sec)' }}>Portafolio</span>
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(M.total)}</span>
          </div>
          {PAT_BIENES.map(b => (
            <div key={b.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--color-text-sec)' }}>{b.label}</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(b.usd)}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800, borderTop: '1px solid var(--gf-gray-200)', paddingTop: 6, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
          <span>Total</span>
          <span>{fmtUsd(patrimTotal)}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 4, lineHeight: 1.4 }}>
          {fmtArs(patrimTotal, tc)} · bienes fuera del análisis de riesgo
        </div>
      </div>
    </div>
  );
}

// ── Solapa Tenencias ──────────────────────────────────────────────────────────
function TenenciasTab({ M }: { M: PatMetrics }) {
  const segs = Object.entries(M.bySector).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Composición por sector arriba */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Composición por sector</div>
        <CompBar M={M} />
      </Card>
      {segs.map(([sec, secTotal]) => (
        <div key={sec}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '0 2px' }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: SECTOR_COL[sec], flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--color-text-strong)' }}>{sec}</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>
              {fmtUsd(secTotal)} · {pct(secTotal / M.total)}
            </span>
          </div>
          <Card padding="0">
            {PAT_POS
              .filter(p => p.sector === sec)
              .sort((a, b) => b.valorUsd - a.valorUsd)
              .map((p, i, arr) => (
                <div key={p.ticker} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', borderBottom: i < arr.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
                  <MerchantLogo nombre={p.nombre} size={40} radius={8} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nombre}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--color-text-sec)' }}>{TIPO_LABEL[p.tipo]} · {p.pais === 'AR' ? 'Argentina' : 'Global'} · {p.monedaOrigen}</span>
                  </span>
                  <span style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(p.valorUsd)}</span>
                    <span style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{pct(p.valorUsd / M.total)}</span>
                  </span>
                </div>
              ))}
          </Card>
        </div>
      ))}
      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', textAlign: 'center' }}>
        {PAT_POS.length} posiciones · foto al {PAT_META.fecha}
      </div>
    </div>
  );
}

// ── Solapa Riesgo (semáforos + métricas §3) ───────────────────────────────────
function RiesgoTab({ M }: { M: PatMetrics }) {
  const rows: { k: string; sub: string; v: string; b: 'verde' | 'amarillo' | 'rojo'; band: string }[] = [
    { k: 'Nombre más grande', sub: M.nombreTop.ticker + ' · cripto se mide aparte', v: pct(M.top1), b: banda('nombre', M.top1), band: '🟢 ≤5 · 🟡 5–10 · 🔴 >10%' },
    { k: 'Sector top',        sub: M.sectorTop.nombre,                               v: pct(M.sectorTop.pct), b: banda('sector', M.sectorTop.pct), band: '🟢 <25 · 🟡 25–40 · 🔴 >40%' },
    { k: 'País único',        sub: 'Argentina',                                      v: pct(M.paisAr), b: banda('pais', M.paisAr), band: '🟢 <40 · 🟡 40–60 · 🔴 >60%' },
    { k: 'Cripto (clase)',    sub: 'BTC + ETH',                                      v: pct(M.cripto), b: banda('cripto', M.cripto), band: '🟢 <10 · 🟡 10–20 · 🔴 >20%' },
    { k: 'HHI (concentración global)', sub: 'umbral DOJ',                            v: M.hhi.toFixed(2), b: banda('hhi', M.hhi), band: '🟢 <0,15 · 🟡 0,15–0,25 · 🔴 >0,25' },
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
    </div>
  );
}

// ── Solapa Plan (§4) ──────────────────────────────────────────────────────────
const PAT_PALANCAS = [
  { n: 1, titulo: 'Recortar los nombres únicos más grandes',  texto: 'TRAN y PAMP concentran el mayor riesgo por dólar. Recortarlos primero saca varianza sin bajar el retorno esperado.' },
  { n: 2, titulo: 'Separar reguladas de productoras',         texto: 'Dentro de energía: reguladas (TRAN, TGS) vs productoras (YPF, VIST, PAMP). Son dos riesgos distintos hoy mezclados.' },
  { n: 3, titulo: 'Redesplegar a otros sectores AR',          texto: 'Consumo, agro, real estate, materiales — sectores que hoy casi no tenés, para diversificar dentro de Argentina.' },
  { n: 4, titulo: 'Sumar renta variable global',              texto: 'Podés operar afuera y tenés cuenta en USD. Mismo nivel de RV, menos riesgo-país. Probablemente la palanca de mayor impacto.' },
];

function PlanTab({ M }: { M: PatMetrics }) {
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
        Palancas de rebalanceo
      </div>
      {PAT_PALANCAS.map(p => (
        <Card key={p.n}>
          <div style={{ display: 'flex', gap: 12 }}>
            <span style={{ width: 26, height: 26, borderRadius: 999, background: 'var(--gf-ink)', color: '#fff', fontSize: 13, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {p.n}
            </span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>{p.titulo}</div>
              <div style={{ fontSize: 12.5, color: 'var(--color-text-sec)', marginTop: 4, lineHeight: 1.45 }}>{p.texto}</div>
            </div>
          </div>
        </Card>
      ))}
      <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--gf-gray-100)', fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
        No es asesoramiento matriculado. Son ganadores en USD → vender tiene costo impositivo, conviene pensar gradual. Parte está en cuentas conjuntas.
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

  useEffect(() => {
    cargarTCReciente(1).then(h => { if (h[0]) setTc(h[0].tcUsdArs); });
  }, []);

  const M = calcMetrics();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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

      {tab === 'resumen'   && <ResumenTab   M={M} tc={tc} />}
      {tab === 'tenencias' && <TenenciasTab M={M} />}
      {tab === 'riesgo'    && <RiesgoTab    M={M} />}
      {tab === 'plan'      && <PlanTab      M={M} />}
      <div style={{ height: 4 }} />
    </div>
  );
}
