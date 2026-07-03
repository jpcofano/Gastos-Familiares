// PatrimonioMobile — vista PRIVADA de patrimonio de inversión (gated jpcofano).
// Datos MOCK calcados de docs/patrimonio/ (foto real ~USD 111k). En el repo saldrán
// de la colección `posiciones` (contrato .txt → app valida/carga; conversión ARS→USD
// vía tcDiario). Vara = USD. El sistema PROPONE/MIDE/MUESTRA riesgo, no alarma.
// Solapas: Resumen (foto) · Tenencias · Riesgo (concentración+semáforos) · Plan (rebalanceo+research).
// El Resumen tiene 3 VARIANTES A/B/C para elegir dirección.
const { Card: PCard, Badge: PBadge, Button: PBtn } = window.GastosFamiliaresDesignSystem_d81a5e;

// ── Posiciones mock (valor_usd ya convertido, como haría la app) ─────────────
// tipo ∈ accion|bono|on|cedear|fci|cripto|cash · pais ∈ AR|global · sector para agrupar
const PAT_POS = [
  { cuenta: 'Balanz 1120830', ticker: 'TRAN',  nombre: 'Transener',      tipo: 'accion', sector: 'Energía AR', pais: 'AR', mon: 'ARS', usd: 17800 },
  { cuenta: 'Balanz 1120830', ticker: 'PAMP',  nombre: 'Pampa Energía',  tipo: 'accion', sector: 'Energía AR', pais: 'AR', mon: 'ARS', usd: 11100 },
  { cuenta: 'Acciones',       ticker: 'YPFD',  nombre: 'YPF',            tipo: 'accion', sector: 'Energía AR', pais: 'AR', mon: 'ARS', usd: 10000 },
  { cuenta: 'Acciones',       ticker: 'VIST',  nombre: 'Vista Energy',   tipo: 'accion', sector: 'Energía AR', pais: 'AR', mon: 'ARS', usd: 7800 },
  { cuenta: 'Acciones',       ticker: 'TGSU2', nombre: 'Transportadora Gas Sur', tipo: 'accion', sector: 'Energía AR', pais: 'AR', mon: 'ARS', usd: 3500 },
  { cuenta: 'Acciones',       ticker: 'CEPU',  nombre: 'Central Puerto', tipo: 'accion', sector: 'Energía AR', pais: 'AR', mon: 'ARS', usd: 2800 },
  { cuenta: 'Cripto',         ticker: 'BTC',   nombre: 'Bitcoin',        tipo: 'cripto', sector: 'Cripto',     pais: 'global', mon: 'USD', usd: 20000 },
  { cuenta: 'Cripto',         ticker: 'ETH',   nombre: 'Ethereum',       tipo: 'cripto', sector: 'Cripto',     pais: 'global', mon: 'USD', usd: 10000 },
  { cuenta: 'Balanz 402665',  ticker: 'TX26',  nombre: 'Boncer TX26',    tipo: 'bono',   sector: 'Renta fija AR', pais: 'AR', mon: 'ARS', usd: 13000 },
  { cuenta: 'Balanz 402665',  ticker: 'GD30',  nombre: 'Global 2030',    tipo: 'bono',   sector: 'Renta fija AR', pais: 'AR', mon: 'USD', usd: 6700 },
  { cuenta: 'Balanz 402665',  ticker: 'BMA',   nombre: 'Banco Macro',    tipo: 'accion', sector: 'Bancos AR',  pais: 'AR', mon: 'ARS', usd: 5500 },
  { cuenta: 'Acciones',       ticker: 'GOLD',  nombre: 'Barrick Gold',   tipo: 'cedear', sector: 'Global',     pais: 'global', mon: 'ARS', usd: 900 },
  { cuenta: 'Acciones',       ticker: 'CVX',   nombre: 'Chevron',        tipo: 'cedear', sector: 'Global',     pais: 'global', mon: 'ARS', usd: 900 },
  { cuenta: 'Acciones',       ticker: 'VZ',    nombre: 'Verizon',        tipo: 'cedear', sector: 'Global',     pais: 'global', mon: 'ARS', usd: 800 },
  { cuenta: 'Acciones',       ticker: 'GLOB',  nombre: 'Globant',        tipo: 'cedear', sector: 'Global',     pais: 'global', mon: 'ARS', usd: 700 },
];
const PAT_META = { fecha: '01/07/2026', declaradoUsd: 111000 };

const SECTOR_COL = {
  'Energía AR':     '#f5a623',
  'Cripto':         '#f7931a',
  'Renta fija AR':  '#4f8ef7',
  'Bancos AR':      '#2bb673',
  'Global':         '#a855f7',
};
const TIPO_LABEL = { accion: 'Acción', bono: 'Bono', on: 'ON', cedear: 'CEDEAR', fci: 'FCI', cripto: 'Cripto', cash: 'Cash' };

// ── Motor de métricas (determinístico, calcado del contrato) ─────────────────
function usePatMetrics() {
  const total = PAT_POS.reduce((s, p) => s + p.usd, 0);
  const bySector = {}, byTipo = {}, byPais = { AR: 0, global: 0 };
  for (const p of PAT_POS) {
    bySector[p.sector] = (bySector[p.sector] || 0) + p.usd;
    byTipo[p.tipo] = (byTipo[p.tipo] || 0) + p.usd;
    byPais[p.pais] += p.usd;
  }
  const orden = [...PAT_POS].sort((a, b) => b.usd - a.usd);
  // "Nombre más grande" = mayor tenencia individual de renta variable/renta fija.
  // La cripto se mide como CLASE (banda propia), no como nombre único → se excluye acá.
  const nombreTop = [...PAT_POS].filter((p) => p.tipo !== 'cripto').sort((a, b) => b.usd - a.usd)[0];
  const top1 = nombreTop.usd / total;
  const top3 = orden.slice(0, 3).reduce((s, p) => s + p.usd, 0) / total;
  const top5 = orden.slice(0, 5).reduce((s, p) => s + p.usd, 0) / total;
  const hhi = PAT_POS.reduce((s, p) => s + Math.pow(p.usd / total, 2), 0);
  const sectorTop = Object.entries(bySector).sort((a, b) => b[1] - a[1])[0];
  const cripto = (byTipo.cripto || 0) / total;
  const rvUsd = PAT_POS.filter((p) => p.tipo === 'accion' || p.tipo === 'cripto' || p.tipo === 'cedear').reduce((s, p) => s + p.usd, 0);
  return {
    total, bySector, byTipo, byPais, orden, nombreTop,
    top1, top3, top5, hhi,
    sectorTop: { nombre: sectorTop[0], pct: sectorTop[1] / total },
    paisAr: byPais.AR / total,
    cripto, rvPct: rvUsd / total,
  };
}

// Bandas de semáforo (UCITS 5/10/40; HHI DOJ). Devuelve 'verde'|'amarillo'|'rojo'.
function banda(metrica, v) {
  const B = {
    nombre: [0.05, 0.10],
    sector: [0.25, 0.40],
    pais:   [0.40, 0.60],
    cripto: [0.10, 0.20],
    hhi:    [0.15, 0.25],
  }[metrica];
  return v <= B[0] ? 'verde' : v <= B[1] ? 'amarillo' : 'rojo';
}
const SEM = {
  verde:    { dot: 'var(--gf-emerald)', tone: 'success', label: 'En banda', bg: 'var(--gf-emerald-50)' },
  amarillo: { dot: 'var(--gf-out)',     tone: 'warning', label: 'Atención',  bg: 'rgba(245,158,11,.12)' },
  rojo:     { dot: 'var(--gf-expense)', tone: 'danger',  label: 'Concentrado', bg: 'rgba(220,38,38,.10)' },
};
const pct = (x) => Math.round(x * 100) + '%';

// ── Barra de composición apilada (por sector) ────────────────────────────────
function CompBar({ M }) {
  const segs = Object.entries(M.bySector).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', marginBottom: 14, background: 'var(--gf-gray-100)' }}>
        {segs.map(([k, v]) => <div key={k} title={k} style={{ width: pct(v / M.total), background: SECTOR_COL[k] }} />)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {segs.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: SECTOR_COL[k] }} />
            <span style={{ fontWeight: 600 }}>{k}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{window.GFMoney.usd(v)}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{pct(v / M.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeadlineSem({ M }) {
  const rows = [
    { k: 'Nombre más grande', v: M.top1, b: banda('nombre', M.top1), extra: M.nombreTop.ticker },
    { k: 'Sector top', v: M.sectorTop.pct, b: banda('sector', M.sectorTop.pct), extra: M.sectorTop.nombre },
    { k: 'Cripto (clase)', v: M.cripto, b: banda('cripto', M.cripto) },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r) => (
        <div key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: SEM[r.b].bg }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: SEM[r.b].dot, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{r.k}{r.extra ? <span style={{ color: 'var(--color-text-sec)', fontWeight: 500 }}> · {r.extra}</span> : null}</span>
          <span style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{pct(r.v)}</span>
        </div>
      ))}
    </div>
  );
}

// ── VARIANTE A — Hero oscuro + composición por sector ────────────────────────
function ResumenA({ M }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: 'var(--gf-ink)', color: '#fff', borderRadius: 20, padding: '22px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', opacity: .7 }}>Valor del portafolio</div>
        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-1px', margin: '4px 0 2px', fontVariantNumeric: 'tabular-nums' }}>{window.GFMoney.usd(M.total)}</div>
        <div style={{ fontSize: 13, opacity: .7, fontVariantNumeric: 'tabular-nums' }}>{window.GFMoney.ars(M.total * window.GFMoney.tc())}</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.12)' }}>
          <span><span style={{ display: 'block', fontSize: 11, opacity: .6 }}>Argentina</span><span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pct(M.paisAr)}</span></span>
          <span><span style={{ display: 'block', fontSize: 11, opacity: .6 }}>Cripto</span><span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pct(M.cripto)}</span></span>
          <span><span style={{ display: 'block', fontSize: 11, opacity: .6 }}>% Renta variable</span><span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pct(M.rvPct)}</span></span>
        </div>
      </div>
      <PCard>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Composición por sector</div>
        <CompBar M={M} />
      </PCard>
    </div>
  );
}

// ── VARIANTE B — Total centrado + semáforos headline + composición ───────────
function ResumenB({ M }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ textAlign: 'center', padding: '6px 0 2px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--gf-gray-400)' }}>Valor del portafolio</div>
        <div style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>{window.GFMoney.usd(M.total)}</div>
        <div style={{ fontSize: 13, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{window.GFMoney.ars(M.total * window.GFMoney.tc())} · al {PAT_META.fecha}</div>
      </div>
      <HeadlineSem M={M} />
      <PCard>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Composición por sector</div>
        <CompBar M={M} />
      </PCard>
    </div>
  );
}

// ── VARIANTE C — Riesgo-forward: hallazgo central arriba ─────────────────────
function ResumenC({ M }) {
  const b = banda('sector', M.sectorTop.pct);
  const s = SEM[b];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: s.bg, borderRadius: 20, padding: '20px', border: `1px solid ${s.dot}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ width: 12, height: 12, borderRadius: 999, background: s.dot }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>Hallazgo central · concentración</span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.4 }}>
          {pct(M.sectorTop.pct)} en {M.sectorTop.nombre} — el bloque dominante.
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-sec)', marginTop: 6, lineHeight: 1.45 }}>
          4 nombres (TRAN, PAMP, YPFD, VIST) comparten sector y país. Reducir riesgo "gratis" sin bajar el % de renta variable.
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${s.dot}33` }}>
          <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-.5px', fontVariantNumeric: 'tabular-nums' }}>{window.GFMoney.usd(M.total)}</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>valor total · {pct(M.rvPct)} en RV</span>
        </div>
      </div>
      <PCard>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Composición por sector</div>
        <CompBar M={M} />
      </PCard>
    </div>
  );
}

// ── Solapa Tenencias ─────────────────────────────────────────────────────────
function TenenciasTab({ M }) {
  const segs = Object.entries(M.bySector).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {segs.map(([sec, secTotal]) => (
        <div key={sec}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '0 2px' }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: SECTOR_COL[sec] }} />
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--color-text-strong)' }}>{sec}</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{window.GFMoney.usd(secTotal)} · {pct(secTotal / M.total)}</span>
          </div>
          <PCard padding="0">
            {PAT_POS.filter((p) => p.sector === sec).sort((a, b) => b.usd - a.usd).map((p, i, arr) => (
              <div key={p.ticker} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', borderBottom: i < arr.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
                <span style={{ width: 40, height: 34, borderRadius: 8, background: 'var(--gf-gray-100)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, letterSpacing: '.3px', flexShrink: 0, color: 'var(--color-text-strong)' }}>{p.ticker}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nombre}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--color-text-sec)' }}>{TIPO_LABEL[p.tipo]} · {p.pais === 'AR' ? 'Argentina' : 'Global'} · {p.mon}</span>
                </span>
                <span style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{window.GFMoney.usd(p.usd)}</span>
                  <span style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{pct(p.usd / M.total)}</span>
                </span>
              </div>
            ))}
          </PCard>
        </div>
      ))}
      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', textAlign: 'center' }}>{PAT_POS.length} posiciones · foto al {PAT_META.fecha}</div>
    </div>
  );
}

// ── Solapa Riesgo (concentración + semáforos + métricas) ─────────────────────
function RiesgoTab({ M }) {
  const rows = [
    { k: 'Nombre más grande', sub: M.nombreTop.ticker + ' · cripto se mide aparte', v: pct(M.top1), b: banda('nombre', M.top1), band: '🟢 ≤5 · 🟡 5–10 · 🔴 >10%' },
    { k: 'Sector top', sub: M.sectorTop.nombre, v: pct(M.sectorTop.pct), b: banda('sector', M.sectorTop.pct), band: '🟢 <25 · 🟡 25–40 · 🔴 >40%' },
    { k: 'País único', sub: 'Argentina', v: pct(M.paisAr), b: banda('pais', M.paisAr), band: '🟢 <40 · 🟡 40–60 · 🔴 >60%' },
    { k: 'Cripto (clase)', sub: 'BTC + ETH', v: pct(M.cripto), b: banda('cripto', M.cripto), band: '🟢 <10 · 🟡 10–20 · 🔴 >20%' },
    { k: 'HHI (concentración global)', sub: 'umbral DOJ', v: M.hhi.toFixed(2), b: banda('hhi', M.hhi), band: '🟢 <0,15 · 🟡 0,15–0,25 · 🔴 >0,25' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map((r) => (
        <PCard key={r.k} style={{ background: SEM[r.b].bg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ width: 11, height: 11, borderRadius: 999, background: SEM[r.b].dot, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{r.k}</span>
              <span style={{ fontSize: 11.5, color: 'var(--color-text-sec)' }}>{r.sub}</span>
            </span>
            <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{r.v}</span>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,.06)', letterSpacing: '.2px' }}>{r.band}</div>
        </PCard>
      ))}
      <PCard>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Top-3 / Top-5</div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
          Las 3 mayores posiciones son <strong style={{ color: 'var(--color-text)' }}>{pct(M.top3)}</strong> del total; las 5 mayores, <strong style={{ color: 'var(--color-text)' }}>{pct(M.top5)}</strong>.
        </div>
      </PCard>
      <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', textAlign: 'center', lineHeight: 1.5 }}>
        El <strong style={{ color: 'var(--color-text-sec)' }}>% en renta variable ({pct(M.rvPct)})</strong> es informativo, sin semáforo:<br />la postura busca RV alta, no es un límite a controlar.
      </div>
    </div>
  );
}

// ── Solapa Plan (rebalanceo + research) ──────────────────────────────────────
const PAT_PALANCAS = [
  { n: 1, titulo: 'Recortar los nombres únicos más grandes', texto: 'TRAN y PAMP concentran el mayor riesgo por dólar. Recortarlos primero saca varianza sin bajar el retorno esperado.' },
  { n: 2, titulo: 'Separar reguladas de productoras', texto: 'Dentro de energía: reguladas (TRAN, TGS) vs productoras (YPF, VIST, PAMP). Son dos riesgos distintos hoy mezclados.' },
  { n: 3, titulo: 'Redesplegar a otros sectores AR', texto: 'Consumo, agro, real estate, materiales — sectores que hoy casi no tenés, para diversificar dentro de Argentina.' },
  { n: 4, titulo: 'Sumar renta variable global', texto: 'Podés operar afuera y tenés cuenta en USD. Mismo nivel de RV, menos riesgo-país. Probablemente la palanca de mayor impacto.' },
];
function PlanTab({ M }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PCard>
        <div style={{ fontSize: 14, fontWeight: 800 }}>La idea madre</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-sec)', marginTop: 6, lineHeight: 1.5 }}>
          Mantener el <strong style={{ color: 'var(--color-text)' }}>{pct(M.rvPct)} en renta variable</strong>, cambiar su composición. No es vender para quedarse en pesos: es repartir la misma apuesta de crecimiento.
        </div>
      </PCard>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '2px 2px 0' }}>Palancas de rebalanceo</div>
      {PAT_PALANCAS.map((p) => (
        <PCard key={p.n}>
          <div style={{ display: 'flex', gap: 12 }}>
            <span style={{ width: 26, height: 26, borderRadius: 999, background: 'var(--gf-ink)', color: '#fff', fontSize: 13, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{p.n}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>{p.titulo}</div>
              <div style={{ fontSize: 12.5, color: 'var(--color-text-sec)', marginTop: 4, lineHeight: 1.45 }}>{p.texto}</div>
            </div>
          </div>
        </PCard>
      ))}
      <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--gf-gray-100)', fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
        No es asesoramiento matriculado. Son ganadores en USD → vender tiene costo impositivo, conviene pensar gradual. Parte está en cuenta conjunta.
      </div>
    </div>
  );
}

function PatrimonioMobile() {
  const M = usePatMetrics();
  const [tab, setTab] = React.useState('resumen');
  const [variante, setVariante] = React.useState(() => localStorage.getItem('gf-pat-variante') || 'A');
  const setVar = (v) => { setVariante(v); try { localStorage.setItem('gf-pat-variante', v); } catch (e) {} };

  const tabs = [['resumen', 'Resumen'], ['tenencias', 'Tenencias'], ['riesgo', 'Riesgo'], ['plan', 'Plan']];
  const seg = (id, label) => {
    const on = tab === id;
    return (
      <button key={id} onClick={() => setTab(id)} style={{
        flex: 1, padding: '8px 4px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)',
        fontSize: 12.5, fontWeight: on ? 700 : 600, background: on ? 'var(--color-surface)' : 'transparent',
        color: on ? 'var(--color-text)' : 'var(--color-text-sec)', boxShadow: on ? 'var(--shadow-sm)' : 'none',
      }}>{label}</button>
    );
  };
  const varSeg = (v) => {
    const on = variante === v;
    return (
      <button key={v} onClick={() => setVar(v)} style={{
        width: 30, height: 26, borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)',
        fontSize: 12, fontWeight: 800, background: on ? 'var(--gf-ink)' : 'var(--gf-gray-100)', color: on ? '#fff' : 'var(--color-text-sec)',
      }}>{v}</button>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 3, background: 'var(--gf-gray-100)', borderRadius: 11, padding: 3 }}>
        {tabs.map(([id, l]) => seg(id, l))}
      </div>

      {tab === 'resumen' && (
        <React.Fragment>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Variante</span>
            <div style={{ display: 'flex', gap: 5, marginLeft: 'auto' }}>{['A', 'B', 'C'].map(varSeg)}</div>
          </div>
          {variante === 'A' ? <ResumenA M={M} /> : variante === 'B' ? <ResumenB M={M} /> : <ResumenC M={M} />}
        </React.Fragment>
      )}
      {tab === 'tenencias' && <TenenciasTab M={M} />}
      {tab === 'riesgo' && <RiesgoTab M={M} />}
      {tab === 'plan' && <PlanTab M={M} />}
      <div style={{ height: 4 }} />
    </div>
  );
}

Object.assign(window, { PatrimonioMobile });
