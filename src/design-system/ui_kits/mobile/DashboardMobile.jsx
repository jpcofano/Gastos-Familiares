// DashboardMobile — "Inicio". Vista Mensual (analytics rica, paridad legacy 60_Dash.gs)
// + Anual (histórico). Toggle de moneda ARS/USD: muestra principal + el otro como "eq".
const { Card: DCard } = window.GastosFamiliaresDesignSystem_d81a5e;

// ── currency helpers (montos base en USD) ───────────────────────────────────
function curBig(usd, cur) { return window.GFMoney.fromUSD(usd, cur); }
function curOther(usd, cur) { return window.GFMoney.otherFromUSD(usd, cur); }

function Eyebrow({ children, icon }) {
  const Ic = window.Icon;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
      {icon && <Ic name={icon} size={13} color="var(--gf-gray-400)" />}
      {children}
    </div>
  );
}

// ── small KPI card (centrada) ────────────────────────────────────────────────
function Kpi({ eyebrow, value, sub, accent, icon }) {
  const Ic = window.Icon;
  return (
    <DCard variant="flat" padding="var(--space-3)" style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
        {icon && <Ic name={icon} size={13} color="var(--gf-gray-400)" />}{eyebrow}
      </div>
      <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4, color: accent || 'var(--color-text)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>{sub}</div>}
    </DCard>
  );
}

// Treemap squarificado: reparte `values` (desc) en un rect W×H minimizando aspect ratio.
// Devuelve [{x,y,w,h}] en las mismas unidades que W,H. (algoritmo squarify clásico)
function squarify(values, W, H) {
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const areas = values.map((v) => (v / total) * (W * H));
  const out = new Array(values.length);
  const worst = (row, side) => {
    const s = row.reduce((a, b) => a + b, 0);
    const rmax = Math.max(...row), rmin = Math.min(...row);
    return Math.max((side * side * rmax) / (s * s), (s * s) / (side * side * rmin));
  };
  let rect = { x: 0, y: 0, w: W, h: H }, i = 0;
  while (i < areas.length) {
    const side = Math.min(rect.w, rect.h);
    let row = [areas[i]], j = i + 1;
    while (j < areas.length && worst(row.concat(areas[j]), side) <= worst(row, side)) { row = row.concat(areas[j]); j++; }
    const rowSum = row.reduce((a, b) => a + b, 0), thick = rowSum / side;
    let off = 0;
    for (let k = 0; k < row.length; k++) {
      const len = (row[k] / rowSum) * side;
      out[i + k] = rect.w >= rect.h
        ? { x: rect.x, y: rect.y + off, w: thick, h: len }
        : { x: rect.x + off, y: rect.y, w: len, h: thick };
      off += len;
    }
    rect = rect.w >= rect.h
      ? { x: rect.x + thick, y: rect.y, w: rect.w - thick, h: rect.h }
      : { x: rect.x, y: rect.y + thick, w: rect.w, h: rect.h - thick };
    i = j;
  }
  return out;
}

// Color de la categoría #i: toma la paleta configurable (CSS var --gf-cat-i, set por el
// tweak "Paleta de gráficos") con fallback al hex del dato. La 9ª+ cae en gris.
function catColorVar(i, fallback) {
  return i < 8 ? `var(--gf-cat-${i}, ${fallback || 'var(--gf-gray-300)'})` : 'var(--gf-gray-300)';
}

// ── Por categoría — 3 tipos de gráfico (Lista / Dona Top-4 / Treemap) ────────
// Lista y Treemap drillean a subcategoría (tap categoría). % siempre sobre el total.
function PorCategoria({ d, cur }) {
  const Ic = window.Icon;
  const [tipo, setTipo] = React.useState(() => localStorage.getItem('gf-chart-tipo') || 'lista');
  const set = (t) => { setTipo(t); try { localStorage.setItem('gf-chart-tipo', t); } catch (e) {} };
  const [openCat, setOpenCat] = React.useState(null);   // lista: categoría expandida
  const [zoomCat, setZoomCat] = React.useState(null);   // treemap: categoría en drill
  const cats = d.categorias;
  const topCats = cats.slice(0, 6), restCats = cats.slice(6);
  const otras = restCats.reduce((s, c) => ({ usd: s.usd + c.usd, count: s.count + c.count, pct: s.pct + c.pct }), { usd: 0, count: 0, pct: 0 });
  const totalUsd = cats.reduce((s, c) => s + c.usd, 0);
  const pctTot = (usd) => Math.round((usd / totalUsd) * 100);

  const seg = (id, icon, label) => {
    const on = tipo === id;
    return (
      <button key={id} onClick={() => set(id)} aria-label={label} title={label} style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 8, border: 'none', cursor: 'pointer',
        fontFamily: 'var(--font-base)', fontSize: 11.5, fontWeight: on ? 700 : 600,
        background: on ? 'var(--color-surface)' : 'transparent', color: on ? 'var(--color-text)' : 'var(--color-text-sec)',
        boxShadow: on ? 'var(--shadow-sm)' : 'none',
      }}><Ic name={icon} size={14} />{label}</button>
    );
  };

  const pctChip = (usd) => (
    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px', fontVariantNumeric: 'tabular-nums' }}>{pctTot(usd)}%</span>
  );

  // ── Dona Top-4 + Otras ──
  const renderDona = () => {
    const top4 = cats.slice(0, 4);
    const rest = cats.slice(4);
    const restUsd = rest.reduce((s, c) => s + c.usd, 0);
    const slices = top4.map((c, i) => ({ nombre: c.nombre, usd: c.usd, color: catColorVar(i, c.color) }));
    if (restUsd > 0) slices.push({ nombre: 'Otras', usd: restUsd, color: 'var(--gf-gray-300)' });
    let acc = 0;
    const stops = slices.map((s) => { const a = acc / totalUsd * 100, b = (acc + s.usd) / totalUsd * 100; acc += s.usd; return `${s.color} ${a}% ${b}%`; });
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 4 }}>
        <div style={{ position: 'relative', width: 124, height: 124, flexShrink: 0 }}>
          <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: `conic-gradient(${stops.join(', ')})` }} />
          <div style={{ position: 'absolute', inset: 30, borderRadius: '50%', background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.3px' }}>Top 4</span>
            <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{Math.round(top4.reduce((s, c) => s + c.usd, 0) / totalUsd * 100)}%</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {slices.map((s) => (
            <div key={s.nombre} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.nombre}</span>
              <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{Math.round(s.usd / totalUsd * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ── Treemap (drilleable) ──
  const renderTreemap = () => {
    const zc = zoomCat != null ? cats.find((c) => c.nombre === zoomCat) : null;
    const subs = zc && zc.subs ? zc.subs : null;
    const items = subs
      ? subs.map((s, i) => ({ nombre: s.nombre, usd: s.usd, color: catColorVar(cats.indexOf(zc), zc.color), pct: pctTot(s.usd) }))
      : cats.map((c, i) => ({ nombre: c.nombre, usd: c.usd, color: catColorVar(i, c.color), pct: pctTot(c.usd), cat: c }));
    const W = 100, H = 46;
    const layout = squarify(items.map((c) => c.usd), W, H);
    return (
      <div>
        {zc && (
          <button onClick={() => setZoomCat(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--gf-gray-100)', border: 'none', borderRadius: 999, padding: '5px 11px 5px 8px', fontSize: 12, fontWeight: 700, color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-base)', marginBottom: 10 }}>
            <Ic name="chevron-left" size={15} /> {zc.nombre}
          </button>
        )}
        <div style={{ position: 'relative', width: '100%', aspectRatio: '100 / 46', borderRadius: 10, overflow: 'hidden' }}>
          {items.map((c, i) => {
            const t = layout[i];
            const big = (t.w / W) > 0.16 && (t.h / H) > 0.22;
            const clickable = !subs && c.cat && c.cat.subs && c.cat.subs.length > 0;
            return (
              <div key={c.nombre} onClick={clickable ? () => setZoomCat(c.cat.nombre) : undefined} title={`${c.nombre} · ${c.pct}%`} style={{
                position: 'absolute', left: `${t.x}%`, top: `${t.y / H * 100}%`, width: `${t.w}%`, height: `${t.h / H * 100}%`,
                background: c.color, border: '1.5px solid var(--color-surface)', padding: '5px 7px', overflow: 'hidden',
                display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', cursor: clickable ? 'pointer' : 'default',
              }}>
                {big && <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', lineHeight: 1.15, textShadow: '0 1px 2px rgba(0,0,0,.25)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nombre}</span>}
                {big && <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,.85)', fontVariantNumeric: 'tabular-nums' }}>{c.pct}%</span>}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', textAlign: 'center', marginTop: 8 }}>{zc ? 'Subcategorías de ' + zc.nombre : 'Tocá una categoría para ver sus subcategorías'}</div>
      </div>
    );
  };

  // ── Lista (default, drilleable) ──
  const renderLista = () => (
    <React.Fragment>
      <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', marginBottom: 16, background: 'var(--gf-gray-100)' }}>
        {cats.map((c, i) => (
          <div key={c.nombre} title={`${c.nombre} · ${pctTot(c.usd)}%`} style={{ width: `${c.pct}%`, background: catColorVar(i, c.color) }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {topCats.map((c, i) => {
          const subs = c.subs || [];
          const abierta = openCat === c.nombre;
          const maxSub = subs.length ? Math.max(...subs.map((s) => s.usd)) : 1;
          return (
            <div key={c.nombre}>
              <button onClick={() => subs.length && setOpenCat(abierta ? null : c.nombre)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: subs.length ? 'pointer' : 'default', fontFamily: 'var(--font-base)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 4 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: catColorVar(i, c.color), flexShrink: 0 }} />
                  <span style={{ fontWeight: 600 }}>{c.nombre}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{c.count}</span>
                  {subs.length > 0 && <Ic name={abierta ? 'chevron-down' : 'chevron-right'} size={14} color="var(--gf-gray-300)" />}
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{curBig(c.usd, cur)}</span>
                    {pctChip(c.usd)}
                  </span>
                </div>
                <div style={{ height: 6, background: 'var(--gf-gray-100)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${c.pct}%`, background: catColorVar(i, c.color), borderRadius: 3 }} />
                </div>
              </button>
              {abierta && subs.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, margin: '9px 0 4px 17px', paddingLeft: 11, borderLeft: '2px solid var(--gf-gray-100)' }}>
                  {subs.map((s) => (
                    <div key={s.nombre}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 3 }}>
                        <span style={{ color: 'var(--color-text-sec)' }}>{s.nombre}</span>
                        <span style={{ marginLeft: 'auto', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-strong)' }}>{curBig(s.usd, cur)}</span>
                        <span style={{ width: 34, textAlign: 'right', fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{pctTot(s.usd)}%</span>
                      </div>
                      <div style={{ height: 4, background: 'var(--gf-gray-100)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${(s.usd / maxSub) * 100}%`, background: catColorVar(i, c.color), borderRadius: 3, opacity: 0.55 }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {restCats.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, paddingTop: 4, borderTop: '1px solid var(--gf-gray-100)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--gf-gray-300)', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, color: 'var(--color-text-sec)' }}>Otras</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{restCats.length}</span>
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-sec)' }}>{curBig(otras.usd, cur)}</span>
              {pctChip(otras.usd)}
            </span>
          </div>
        )}
      </div>
    </React.Fragment>
  );

  return (
    <DCard padding="var(--space-4)">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Por categoría</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>este mes</div>
        </div>
        <div style={{ display: 'flex', gap: 2, background: 'var(--gf-gray-100)', borderRadius: 10, padding: 3, flexShrink: 0 }}>
          {seg('lista', 'list', 'Lista')}
          {seg('dona', 'chart-pie', 'Dona')}
          {seg('treemap', 'layout-grid', 'Treemap')}
        </div>
      </div>
      {tipo === 'lista' ? renderLista() : tipo === 'dona' ? renderDona() : renderTreemap()}
    </DCard>
  );
}

// ── Mensual ─────────────────────────────────────────────────────────────────
function DashboardMensual({ cur }) {
  const Ic = window.Icon;
  const d = window.M_DASH;
  const topCats = d.categorias.slice(0, 6);
  const restCats = d.categorias.slice(6);
  const otras = restCats.reduce((s, c) => ({ usd: s.usd + c.usd, count: s.count + c.count, pct: s.pct + c.pct }), { usd: 0, count: 0, pct: 0 });
  const maxDia = Math.max(...d.diaria);
  const maxSub = Math.max(...d.subcategorias.map((s) => s.valor));
  const chartH = 120;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Balance del período */}
      <div style={{ background: 'linear-gradient(135deg, var(--gf-ink) 0%, var(--gf-ink-soft) 100%)', borderRadius: 'var(--radius-card)', padding: '22px 18px', textAlign: 'center', color: '#fff', boxShadow: 'var(--shadow-soft)' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>Balance del período</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: d.balancePositivo ? 'var(--gf-emerald-100)' : '#fca5a5' }}>{d.balancePositivo ? '↑ positivo' : '↓ negativo'}</span>
        </div>
        <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{curBig(d.balanceUsd, cur)}</div>
        <div style={{ fontSize: 14, color: '#9ca3af', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{curOther(d.balanceUsd, cur)}</div>
      </div>

      {/* Ingresos / Salidas */}
      <div style={{ display: 'flex', gap: 10 }}>
        {[{ e: 'Ingresos', v: d.ingresosUsd, c: 'var(--gf-income)' }, { e: 'Salidas', v: d.salidasUsd, c: 'var(--gf-out)' }].map((x) => (
          <DCard key={x.e} variant="flat" padding="0" style={{ flex: 1, overflow: 'hidden', textAlign: 'center' }}>
            <div style={{ height: 4, background: x.c }} />
            <div style={{ padding: '12px 10px' }}>
              <Eyebrow>{x.e}</Eyebrow>
              <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{curBig(x.v, cur)}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-sec)', fontVariantNumeric: 'tabular-nums' }}>{curOther(x.v, cur)}</div>
            </div>
          </DCard>
        ))}
      </div>

      {/* Tira secundaria compacta: 3 KPIs en una sola card dividida */}
      <DCard variant="flat" padding="0">
        <div style={{ display: 'flex' }}>
          {[
            { label: 'Movimientos', value: String(d.movimientos), sub: 'en el mes' },
            { label: 'Gasto prom.', value: curBig(d.gastoPromedioUsd, cur), sub: `${d.diasConGasto} días` },
            { label: 'Cat. top', value: d.categoriaTop.nombre, sub: `${d.categoriaTop.pct}% del total` },
          ].map((c, i) => (
            <div key={c.label} style={{ flex: 1, minWidth: 0, padding: '12px 10px', textAlign: 'center', borderLeft: i > 0 ? '1px solid var(--gf-gray-100)' : 'none' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</div>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.value}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-sec)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.sub}</div>
            </div>
          ))}
        </div>
      </DCard>
      <DCard variant="flat" padding="var(--space-3)">
        <Eyebrow icon="trending-up">Mov. más alto</Eyebrow>
        <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{curBig(d.movMasAlto.usd, cur)}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>{d.movMasAlto.desc}</div>
      </DCard>

      {/* Por categoría — paleta + tipo de gráfico configurable (Lista / Dona / Treemap) */}
      <PorCategoria d={d} cur={cur} />

      {/* Top subcategorías — ranking por monto, estilo lista de categorías (dot + nombre a la izq). */}
      <DCard padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Top subcategorías</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 14 }}>movimientos del mes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {d.subcategorias.map((s) => (
            <div key={s.nombre}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 4 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.nombre}</span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{curBig(s.valor, cur)}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px', fontVariantNumeric: 'tabular-nums' }}>{s.pct}%</span>
                </span>
              </div>
              <div style={{ height: 13, background: 'var(--gf-gray-100)', borderRadius: 7, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max((s.valor / maxSub) * 100, 4)}%`, background: s.color, borderRadius: 7 }} />
              </div>
            </div>
          ))}
        </div>
      </DCard>

      {/* Evolución diaria */}
      <DCard padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Evolución diaria</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 14 }}>· pico {d.picoDia.fecha} · {d.picoDia.dow}</div>
        <div style={{ position: 'relative', height: chartH, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
          {/* promedio diario line */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${(d.promedioDiarioUsd / maxDia) * chartH}px`, borderTop: '1.5px dashed var(--gf-out)', zIndex: 1 }}>
            <span style={{ position: 'absolute', top: -14, left: 0, fontSize: 9, color: 'var(--gf-out)', fontWeight: 600 }}>promedio diario</span>
          </div>
          {d.diaria.map((v, i) => {
            const peak = (i + 1) === d.picoDia.diaNum;
            return <div key={i} style={{ flex: 1, height: `${Math.max((v / maxDia) * chartH, v > 0 ? 3 : 0)}px`, background: peak ? 'var(--gf-expense)' : '#9cb3e8', borderRadius: '2px 2px 0 0' }} title={`Día ${i + 1}: USD ${v}`} />;
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--gf-gray-400)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
          <span>01</span><span>05</span><span>10</span><span>15</span><span>20</span><span>25</span><span>30</span>
        </div>
      </DCard>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10 }}>
        <Kpi eyebrow="Días con gasto" value={d.diasConGasto} />
        <Kpi eyebrow="Fin de semana" value={`${d.finDeSemanaPct}%`} sub="del gasto del mes" />
        <Kpi eyebrow="Promedio diario" value={curBig(d.promedioDiarioUsd, cur)} />
      </div>
      <DCard variant="flat" padding="var(--space-3)">
        <Eyebrow>Top 3 categorías</Eyebrow>
        <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>{d.top3Pct}%</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Mes en superávit</div>
      </DCard>

      {/* Insight cards */}
      <div style={{ display: 'flex', gap: 10 }}>
        <Kpi eyebrow="Banco dominante" value={d.bancoDominante} />
        <Kpi eyebrow="Día pico" value={`${d.picoDia.fecha} · ${d.picoDia.dow}`} sub={curBig(d.picoDia.usd, cur)} />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Kpi eyebrow="Vs mes anterior" value={`${d.vsMesAnteriorPct}%`} sub={d.vsMesLabel} accent={d.vsMesAnteriorPct < 0 ? 'var(--gf-income)' : 'var(--gf-expense)'} />
        <Kpi eyebrow="Lectura rápida" value={d.lecturaRapida} />
      </div>

      {/* Por descripción */}
      <DCard padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Por descripción</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 12 }}>mayores gastos del mes</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {d.porDescripcion.map((x, i) => (
            <div key={x.desc} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: i < d.porDescripcion.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
              <span style={{ width: 14, flexShrink: 0, fontSize: 12, fontWeight: 700, color: 'var(--gf-gray-400)', textAlign: 'center' }}>{i + 1}</span>
              <window.MerchantLogo nombre={x.desc} size={30} radius={8} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.desc}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px', flexShrink: 0 }}>{x.count}</span>
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 13, flexShrink: 0 }}>{curBig(x.usd, cur)}</span>
            </div>
          ))}
        </div>
      </DCard>
      {/* Compartir informe (placeholder — se define el mecanismo: PDF / email / link) */}
      <button onClick={() => alert('Compartir informe — a definir (PDF / email / link)')} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', boxSizing: 'border-box',
        padding: '12px 16px', borderRadius: 12, border: '1px solid var(--color-border)', background: 'var(--color-surface)',
        cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 14, fontWeight: 700, color: 'var(--color-text)',
      }}>
        <Ic name="share-2" size={16} color="var(--color-text)" />
        Compartir informe
      </button>
      <div style={{ height: 4 }} />
    </div>
  );
}

// Regresión lineal (mínimos cuadrados) sobre y[0..n-1] → {m, b} de y = m·x + b.
function _linreg(ys) {
  const n = ys.length;
  if (n < 2) return { m: 0, b: ys[0] || 0 };
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxy += i * ys[i]; sxx += i * i; }
  const denom = n * sxx - sx * sx;
  const m = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const b = (sy - m * sx) / n;
  return { m, b };
}

// "Salidas por mes" del año: meses transcurridos = real; meses futuros = proyección
// de la tendencia (recta de regresión sobre los meses con gasto). Las barras de
// proyección van fantasma (contorno punteado) para no confundir estimación con dato.
function SalidasPorMes({ a, cur }) {
  const Ic = window.Icon;
  const idx = (typeof a.mesActualIdx === 'number') ? a.mesActualIdx : a.salidasPorMes.length - 1;
  const reales = a.salidasPorMes.slice(0, idx + 1);
  const { m, b } = _linreg(reales);
  // Serie completa: real donde hay dato, proyección (recta, piso 0) en el futuro.
  const serie = a.salidasPorMes.map((v, i) => i <= idx
    ? { v, proj: false }
    : { v: Math.max(Math.round(m * i + b), 0), proj: true });
  const maxV = Math.max(...serie.map((s) => s.v), 1);
  const idxMax = reales.indexOf(Math.max(...reales));

  // Tendencia = pendiente mensual sobre el promedio de los meses reales (no el -97% que
  // salía al promediar contra los ceros del futuro).
  const promReal = reales.reduce((s, v) => s + v, 0) / Math.max(reales.length, 1);
  const tendPct = promReal > 0 ? Math.round((m / promReal) * 100) : 0;
  const tendUp = tendPct >= 0;
  const projTotal = serie.filter((s) => s.proj).reduce((s, x) => s + x.v, 0);

  return (
    <DCard padding="var(--space-4)">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>Salidas por mes</div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 700, color: tendUp ? 'var(--gf-expense)' : 'var(--gf-income)', background: tendUp ? 'var(--gf-expense-50)' : 'var(--gf-income-50, #ecfdf5)', borderRadius: 999, padding: '3px 9px' }}>
          <Ic name={tendUp ? 'trending-up' : 'trending-down'} size={12} /> {tendUp ? '+' : ''}{tendPct}%/mes
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 110, marginTop: 14 }}>
        {serie.map((s, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: '100%', height: `${Math.max((s.v / maxV) * 88, s.proj ? 2 : 3)}px`, borderRadius: '3px 3px 0 0',
              background: s.proj ? 'transparent' : (i === idxMax ? 'var(--color-accent)' : '#9cb3e8'),
              border: s.proj ? '1.5px dashed #b9c6ea' : 'none',
            }} title={`${a.meses[i]}: USD ${s.v}${s.proj ? ' (proyección)' : ''}`} />
            <div style={{ fontSize: 8.5, color: s.proj ? 'var(--gf-gray-300)' : 'var(--gf-gray-400)' }}>{a.meses[i].charAt(0)}</div>
          </div>
        ))}
      </div>
      {/* leyenda real vs proyección */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, fontSize: 10.5, color: 'var(--color-text-sec)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: '#9cb3e8' }} /> Real ({reales.length} {reales.length === 1 ? 'mes' : 'meses'})</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, border: '1.5px dashed #b9c6ea' }} /> Proyección</span>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <Kpi eyebrow="Prom. mensual" value={curBig(Math.round(promReal), cur)} />
        <Kpi eyebrow="Mes más alto" value={a.meses[idxMax]} />
        <Kpi eyebrow="Proy. resto año" value={curBig(projTotal, cur)} />
      </div>
    </DCard>
  );
}

// ── Anual (histórico) ───────────────────────────────────────────────────────
function DashboardAnual({ cur }) {
  const a = window.M_ANUAL;
  const Ic = window.Icon;
  const [openCat, setOpenCat] = React.useState(null);
  const maxSal = Math.max(...a.salidasPorMes);
  const maxIS = Math.max(...a.ingresosPorMes, ...a.salidasPorMes);
  const totalCat = a.categorias.reduce((s, c) => s + c.usd, 0);
  const maxCat = a.categorias[0].usd;
  const maxMM = Math.max(...a.mesAMes.map((m) => m.usd));
  const donut = (() => { let acc = 0; const st = a.categorias.map((c) => { const p = (c.usd / totalCat) * 100; const f = acc; acc += p; return `${c.color} ${f}% ${acc}%`; }); return `conic-gradient(${st.join(', ')})`; })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Balance anual */}
      <div style={{ background: 'linear-gradient(135deg, var(--gf-ink) 0%, var(--gf-ink-soft) 100%)', borderRadius: 'var(--radius-card)', padding: '22px 18px', textAlign: 'center', color: '#fff', boxShadow: 'var(--shadow-soft)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)', marginBottom: 8 }}>Balance del año · {a.anio}</div>
        <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{curBig(a.balanceUsd, cur)}</div>
        <div style={{ fontSize: 14, color: '#9ca3af', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{curOther(a.balanceUsd, cur)}</div>
      </div>

      {/* Ingresos / Salidas */}
      <div style={{ display: 'flex', gap: 10 }}>
        {[{ e: 'Ingresos', v: a.ingresosUsd, c: 'var(--gf-income)' }, { e: 'Salidas', v: a.salidasUsd, c: 'var(--gf-out)' }].map((x) => (
          <DCard key={x.e} variant="flat" padding="0" style={{ flex: 1, overflow: 'hidden', textAlign: 'center' }}>
            <div style={{ height: 4, background: x.c }} />
            <div style={{ padding: '12px 10px' }}>
              <Eyebrow>{x.e}</Eyebrow>
              <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{curBig(x.v, cur)}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-sec)', fontVariantNumeric: 'tabular-nums' }}>{curOther(x.v, cur)}</div>
            </div>
          </DCard>
        ))}
      </div>

      {/* Salidas por mes — meses transcurridos reales + futuros = proyección de la tendencia */}
      <SalidasPorMes a={a} cur={cur} />

      {/* Por categoría */}
      <DCard padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Por categoría</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 14 }}>del año</div>
        {/* barra apilada + total */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 700 }}>Total</span>
          <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{curBig(totalCat, cur)}</span>
        </div>
        <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', marginBottom: 16, background: 'var(--gf-gray-100)' }}>
          {a.categorias.map((c) => (
            <div key={c.nombre} title={`${c.nombre} · ${Math.round((c.usd / totalCat) * 100)}%`} style={{ width: `${(c.usd / totalCat) * 100}%`, background: c.color }} />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {a.categorias.map((c) => {
            const abierta = openCat === c.nombre;
            const subs = c.subs || [];
            const maxSub = subs.length ? Math.max(...subs.map((s) => s.usd)) : 1;
            return (
              <div key={c.nombre}>
                <button onClick={() => subs.length && setOpenCat(abierta ? null : c.nombre)} style={{
                  width: '100%', display: 'block', textAlign: 'left', background: 'none', border: 'none', padding: 0,
                  cursor: subs.length ? 'pointer' : 'default', fontFamily: 'var(--font-base)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 3 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{c.nombre}</span>
                    {subs.length > 0 && <Ic name={abierta ? 'chevron-down' : 'chevron-right'} size={14} color="var(--gf-gray-300)" />}
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text)' }}>{curBig(c.usd, cur)}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px', fontVariantNumeric: 'tabular-nums' }}>{Math.round((c.usd / totalCat) * 100)}%</span>
                    </span>
                  </div>
                  <div style={{ height: 6, background: 'var(--gf-gray-100)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(c.usd / maxCat) * 100}%`, background: c.color, borderRadius: 3, opacity: 0.85 }} />
                  </div>
                </button>
                {abierta && subs.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, margin: '9px 0 4px 17px', paddingLeft: 11, borderLeft: '2px solid var(--gf-gray-100)' }}>
                    {subs.map((s) => (
                      <div key={s.nombre}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 3 }}>
                          <span style={{ color: 'var(--color-text-sec)' }}>{s.nombre}</span>
                          <span style={{ marginLeft: 'auto', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-strong)' }}>{curBig(s.usd, cur)}</span>
                          <span style={{ width: 38, textAlign: 'right', fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{(() => { const p = (s.usd / totalCat) * 100; return p < 1 ? '<1%' : Math.round(p) + '%'; })()}</span>
                        </div>
                        <div style={{ height: 4, background: 'var(--gf-gray-100)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${(s.usd / maxSub) * 100}%`, background: c.color, borderRadius: 3, opacity: 0.55 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DCard>

      {/* Ingresos y salidas por mes */}
      <DCard padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800 }}>Ingresos y salidas por mes</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: 'var(--color-text-sec)', margin: '6px 0 12px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--gf-income)' }} />Ingresos</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--gf-out)' }} />Salidas</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, border: '1.5px dashed var(--gf-gray-300)' }} />Proyección</span>
        </div>
        {(() => {
          const idxA = (typeof a.mesActualIdx === 'number') ? a.mesActualIdx : a.salidasPorMes.length - 1;
          const regI = _linreg(a.ingresosPorMes.slice(0, idxA + 1));
          const regS = _linreg(a.salidasPorMes.slice(0, idxA + 1));
          const proj = (reg, i) => Math.max(Math.round(reg.m * i + reg.b), 0);
          const serieI = a.ingresosPorMes.map((v, i) => i <= idxA ? v : proj(regI, i));
          const serieS = a.salidasPorMes.map((v, i) => i <= idxA ? v : proj(regS, i));
          const maxISp = Math.max(...serieI, ...serieS, 1);
          return (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 104 }}>
              {a.meses.map((m, i) => {
                const fut = i > idxA;
                return (
                  <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 88, width: '100%', justifyContent: 'center' }}>
                      <div title={`${m} ingresos: USD ${serieI[i]}${fut ? ' (proy.)' : ''}`} style={{ width: '42%', height: `${Math.max((serieI[i] / maxISp) * 88, 2)}px`, borderRadius: '2px 2px 0 0', background: fut ? 'transparent' : 'var(--gf-income)', border: fut ? '1.5px dashed color-mix(in srgb, var(--gf-income) 55%, var(--gf-gray-300))' : 'none' }} />
                      <div title={`${m} salidas: USD ${serieS[i]}${fut ? ' (proy.)' : ''}`} style={{ width: '42%', height: `${Math.max((serieS[i] / maxISp) * 88, 2)}px`, borderRadius: '2px 2px 0 0', background: fut ? 'transparent' : 'var(--gf-out)', border: fut ? '1.5px dashed color-mix(in srgb, var(--gf-out) 55%, var(--gf-gray-300))' : 'none' }} />
                    </div>
                    <div style={{ fontSize: 8.5, color: fut ? 'var(--gf-gray-300)' : 'var(--gf-gray-400)' }}>{m.charAt(0)}</div>
                  </div>
                );
              })}
            </div>
          );
        })()}
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <Kpi eyebrow="Meses con datos" value={a.mesesConDatos} />
          <Kpi eyebrow="Comp. interanual" value={`${a.comparacionInteranualPct}%`} />
          <Kpi eyebrow="Mejor mes ahorro" value={a.mejorMesAhorro} />
        </div>
      </DCard>

      {/* Mes a mes */}
      <DCard padding="var(--space-4)">
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Mes a mes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {a.mesAMes.map((m) => (
            <div key={m.mes} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 30, flexShrink: 0, fontSize: 12, fontWeight: 700, color: 'var(--color-text-strong)' }}>{m.mes}</span>
              <div style={{ flex: 1, height: 8, background: 'var(--gf-gray-100)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(m.usd / maxMM) * 100}%`, background: 'var(--color-accent)', borderRadius: 4 }} />
              </div>
              <span style={{ width: 64, textAlign: 'right', fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{curBig(m.usd, cur)}</span>
              <span style={{ width: 44, textAlign: 'right', fontSize: 11, fontWeight: 700, color: m.delta == null ? 'var(--gf-gray-300)' : m.delta < 0 ? 'var(--gf-income)' : 'var(--gf-expense)', fontVariantNumeric: 'tabular-nums' }}>{m.delta == null ? '—' : (m.delta > 0 ? '+' : '') + m.delta + '%'}</span>
            </div>
          ))}
        </div>
      </DCard>
      <div style={{ height: 4 }} />
    </div>
  );
}

// ── Shell: header (vista general + moneda + Mensual/Anual + mes) ─────────────
function DashboardMobile({ mes, setMes }) {
  const Ic = window.Icon;
  const Sheet = window.Sheet;
  const [sec, setSec] = React.useState('mensual');
  const [cur, setCur] = React.useState('USD');
  const [anio, setAnio] = React.useState('2026');
  const [periodOpen, setPeriodOpen] = React.useState(false);
  const d = window.M_DASH;
  const MES_OPTS = [{ value: '2026-06', label: 'Junio 2026' }, { value: '2026-05', label: 'Mayo 2026' }, { value: '2026-04', label: 'Abril 2026' }];
  const ANIO_OPTS = [{ value: '2026', label: '2026' }, { value: '2025', label: '2025' }, { value: '2024', label: '2024' }];
  const periodOpts = sec === 'anual' ? ANIO_OPTS : MES_OPTS;
  const periodVal = sec === 'anual' ? anio : mes;
  const periodLabel = (periodOpts.find((o) => o.value === periodVal) || {}).label || (sec === 'anual' ? anio : d.mesLabel);
  const curPill = (id) => {
    const on = cur === id;
    return (
      <button key={id} onClick={() => setCur(id)} style={{
        padding: '5px 12px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)',
        fontSize: 12, fontWeight: 700, background: on ? 'var(--color-surface)' : 'transparent',
        color: on ? 'var(--color-text)' : 'var(--color-text-sec)', boxShadow: on ? 'var(--shadow-sm)' : 'none', transition: '.15s',
      }}>{id === 'ARS' ? '$ ARS' : 'USD'}</button>
    );
  };
  const tab = (id, label) => {
    const on = sec === id;
    return (
      <button key={id} onClick={() => setSec(id)} style={{
        flex: 1, padding: '9px 12px', borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)',
        fontSize: 14, fontWeight: on ? 700 : 500, background: on ? 'var(--color-surface)' : 'transparent',
        color: on ? 'var(--color-text)' : 'var(--color-text-sec)', boxShadow: on ? 'var(--shadow-sm)' : 'none', transition: '.15s',
      }}>{label}</button>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header compacto: período (abre bottom-sheet) + moneda, y toggle Mensual/Anual */}
      <div style={{ background: 'var(--gf-gray-100)', borderRadius: 'var(--radius-card)', padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <button onClick={() => setPeriodOpen(true)} style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px 7px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
            background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)', fontFamily: 'var(--font-base)',
          }}>
            <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.2px', color: 'var(--color-text)' }}>{periodLabel}</span>
            <Ic name="chevron-down" size={16} color="var(--color-text-sec)" />
          </button>
          <div style={{ display: 'flex', gap: 3, background: 'var(--gf-gray-200)', borderRadius: 999, padding: 3 }}>
            {[curPill('ARS'), curPill('USD')]}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--gf-gray-200)', borderRadius: 14, padding: 4 }}>
          {[tab('mensual', 'Mensual'), tab('anual', 'Anual')]}
        </div>
      </div>

      <Sheet open={periodOpen} onClose={() => setPeriodOpen(false)} title={sec === 'anual' ? 'Elegir año' : 'Elegir mes'}
        options={periodOpts} value={periodVal}
        onPick={(v) => (sec === 'anual' ? setAnio(v) : setMes(v))} />

      {sec === 'mensual' ? <DashboardMensual cur={cur} /> : <DashboardAnual cur={cur} />}
    </div>
  );
}

Object.assign(window, { DashboardMobile });
