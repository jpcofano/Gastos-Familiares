// F9.196 H6 (base §7, diseño 3) — secciones nuevas de la ficha de posición: stops (barra + mini
// gráfico de 60 ruedas), señales y tesis. Las monta FichaPosicion en el orden de §7.
//
// ⛔ Contrato (CLAUDE-PATRIMONIO.md, "Stops y señales"): los stops son NIVELES DE REFERENCIA, no
// órdenes. Sin push, sin campana, sin "acción sugerida". Ningún texto de acá dice qué hacer.
import { useState, type ReactNode } from 'react';
import { Card } from '../design-system/components';
import { Icon } from '../design-system/Icon';
import type { IndicadoresPosicion } from '../types/patrimonio';
import type { DocTesis, Tesis, CampoTesis } from '../datos/compartido/tesis';
import { guardarEdicionTesis } from '../datos/patrimonioTesis';

const fmt = (n: number, dec = 2) => n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtPct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1).replace('.', ',')}%`;
const fmtFecha = (iso: string) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a.slice(2)}`; };
const titulo = { fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: 'var(--gf-gray-400)' } as const;
const sub = { fontSize: 10.5, color: 'var(--gf-gray-400)', lineHeight: 1.45 } as const;

// ── Plegable ──────────────────────────────────────────────────────────────────

export function Plegable({ titulo: t, children, abiertoInicial = false }: { titulo: string; children: ReactNode; abiertoInicial?: boolean }) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  return (
    <div>
      <button
        onClick={() => setAbierto(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, background: 'var(--color-surface)', border: '1px solid var(--gf-gray-100)', borderRadius: 10, padding: '9px 12px', cursor: 'pointer', fontFamily: 'var(--font-base)' }}
      >
        <span style={{ ...titulo, flex: 1, textAlign: 'left' }}>{t}</span>
        <Icon name={abierto ? 'chevron-up' : 'chevron-down'} size={14} color="var(--gf-gray-400)" />
      </button>
      {abierto && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>{children}</div>}
    </div>
  );
}

// ── Stops ─────────────────────────────────────────────────────────────────────

const ESTADO_TXT: Record<string, { txt: string; color: string }> = {
  tocado: { txt: 'en o debajo de un nivel', color: 'var(--gf-expense)' },
  cerca: { txt: 'cerca de un nivel', color: 'var(--gf-out)' },
  ok: { txt: 'lejos de los niveles', color: 'var(--gf-income)' },
  sin_datos: { txt: 'sin datos suficientes', color: 'var(--gf-gray-400)' },
};

/** Barra horizontal con el precio y las marcas de stop ATR, SMA50 y SMA200 (con sus distancias). */
function BarraNiveles({ ind, privado }: { ind: IndicadoresPosicion; privado: boolean }) {
  const st = ind.stops!;
  const marcas = [
    { k: 'Stop ATR', v: st.stopAtr, d: st.distStopAtrPct, color: 'var(--gf-expense)' },
    { k: 'SMA50', v: st.stopSma50, d: st.distSma50Pct, color: 'var(--gf-out)' },
    { k: 'SMA200', v: st.stopSma200, d: st.distSma200Pct, color: 'var(--gf-ink)' },
  ].filter((m): m is { k: string; v: number; d: number | null; color: string } => m.v !== null);
  const valores = [st.cierre, ...marcas.map(m => m.v)];
  const min = Math.min(...valores), max = Math.max(...valores);
  const margen = (max - min) * 0.12 || st.cierre * 0.05;
  const x = (v: number) => `${((v - (min - margen)) / ((max + margen) - (min - margen))) * 100}%`;
  return (
    <div>
      <div style={{ position: 'relative', height: 30, margin: '6px 0 4px' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 14, height: 3, borderRadius: 2, background: 'var(--gf-gray-100)' }} />
        {marcas.map(m => (
          <div key={m.k} title={m.k} style={{ position: 'absolute', left: x(m.v), top: 6, width: 2, height: 19, background: m.color, transform: 'translateX(-1px)' }} />
        ))}
        <div title="Precio" style={{ position: 'absolute', left: x(st.cierre), top: 8, width: 14, height: 14, borderRadius: 999, background: 'var(--color-accent)', border: '2px solid var(--color-surface)', transform: 'translateX(-7px)' }} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11.5 }}>
        <span><strong>Precio</strong> {privado ? '•••' : fmt(st.cierre)}</span>
        {marcas.map(m => (
          <span key={m.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: m.color, display: 'inline-block' }} />
            {m.k} {privado ? '•••' : fmt(m.v)}{m.d !== null && <span style={{ color: 'var(--gf-gray-400)' }}>({fmtPct(m.d)})</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Mini gráfico de las últimas 60 lecturas: cierre, stop ATR escalonado y SMA200. */
function MiniGrafico({ ind }: { ind: IndicadoresPosicion }) {
  const h = ind.historialStops ?? [];
  if (h.length < 2) {
    return <div style={sub}>El gráfico se arma con las lecturas diarias del cron: hoy hay {h.length} de 60.</div>;
  }
  const W = 300, H = 90, P = 4;
  const vals = h.flatMap(l => [l.cierre, l.stopAtr, l.sma200].filter((v): v is number => v !== null));
  const min = Math.min(...vals), max = Math.max(...vals);
  const xs = (i: number) => P + (i / (h.length - 1)) * (W - 2 * P);
  const ys = (v: number) => H - P - ((v - min) / ((max - min) || 1)) * (H - 2 * P);
  const linea = (get: (l: (typeof h)[number]) => number | null, escalonada = false) => {
    let d = '';
    h.forEach((l, i) => {
      const v = get(l);
      if (v === null) return;
      if (!d) d = `M${xs(i)},${ys(v)}`;
      else d += escalonada ? ` H${xs(i)} V${ys(v)}` : ` L${xs(i)},${ys(v)}`;
    });
    return d;
  };
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Cierre, stop ATR y SMA200 de las últimas lecturas">
        <path d={linea(l => l.sma200)} fill="none" stroke="var(--gf-ink)" strokeWidth={1.2} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
        <path d={linea(l => l.stopAtr, true)} fill="none" stroke="var(--gf-expense)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        <path d={linea(l => l.cierre)} fill="none" stroke="var(--color-accent)" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', gap: 12, fontSize: 10.5, color: 'var(--gf-gray-400)', flexWrap: 'wrap' }}>
        <span><span style={{ color: 'var(--color-accent)', fontWeight: 800 }}>—</span> cierre</span>
        <span><span style={{ color: 'var(--gf-expense)', fontWeight: 800 }}>—</span> stop ATR</span>
        <span><span style={{ color: 'var(--gf-ink)', fontWeight: 800 }}>- -</span> SMA200</span>
        <span>{h.length} lecturas · {fmtFecha(h[0].fecha)} a {fmtFecha(h[h.length - 1].fecha)}</span>
      </div>
    </div>
  );
}

export function SeccionStops({ ind, privado }: { ind: IndicadoresPosicion | null; privado: boolean }) {
  const st = ind?.stops;
  if (!ind || !st) return null;
  const e = ESTADO_TXT[st.estado] ?? ESTADO_TXT.sin_datos;
  return (
    <Card padding="12px">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={titulo}>STOPS</div>
        <span style={{ fontSize: 11, fontWeight: 700, color: e.color }}>{e.txt}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, letterSpacing: 0.3, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 4, padding: '2px 6px' }}>
          Niveles de referencia, no órdenes
        </span>
      </div>
      <BarraNiveles ind={ind} privado={privado} />
      {st.motivoStopAtr && (
        <div style={{ ...sub, marginTop: 4 }}>
          Stop ATR sin calcular: {st.motivoStopAtr === 'sin_ohlc' ? 'la fuente no publica máximos y mínimos de esta serie' : 'hacen falta 30 ruedas de historia'}.
        </div>
      )}
      {st.stopAtrDesde && st.stopAtr !== null && <div style={{ ...sub, marginTop: 4 }}>El stop ATR no baja: último ajuste el {fmtFecha(st.stopAtrDesde)}{st.reinicio ? ' (se reinició: la posición cambió)' : ''}.</div>}
      <div style={{ marginTop: 8 }}><MiniGrafico ind={ind} /></div>
      <div style={{ ...sub, marginTop: 6 }}>
        Stop ATR = máximo de cierre de 22 ruedas menos 3 ATR. "Debajo" de una media exige dos cierres seguidos. Son
        referencias para mirar, en la moneda de la serie ({ind.monedaSerie ?? '—'}).
      </div>
    </Card>
  );
}

// ── Señales ───────────────────────────────────────────────────────────────────

export function SeccionSenales({ ind }: { ind: IndicadoresPosicion | null }) {
  const senales = ind?.senales ?? [];
  if (!ind?.stops) return null;
  return (
    <Card padding="12px">
      <div style={{ ...titulo, marginBottom: 8 }}>SEÑALES</div>
      {senales.length === 0 ? <div style={sub}>Sin señales activas.</div> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {senales.map((s, i) => (
            <span key={`${s.id}-${i}`} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, borderRadius: 999, padding: '4px 9px',
              background: s.nivel === 'atencion' ? 'rgba(245,158,11,.14)' : 'var(--gf-gray-50)',
              border: s.nueva ? '1.5px solid var(--gf-out)' : '1px solid transparent', fontWeight: s.nueva ? 700 : 500,
            }}>
              {s.nueva && <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--gf-out)' }}>NUEVA</span>}
              {s.texto}
              <span style={{ color: 'var(--gf-gray-400)', fontWeight: 500 }}>desde {fmtFecha(s.desde)}</span>
            </span>
          ))}
        </div>
      )}
      <div style={{ ...sub, marginTop: 6 }}>Las señales informan; no son recomendaciones. Sin avisos ni notificaciones.</div>
    </Card>
  );
}

// ── Tesis ─────────────────────────────────────────────────────────────────────

function Numero({ label, valor, nota }: { label: string; valor: string; nota?: string | null }) {
  return (
    <div style={{ flex: 1, minWidth: 80, background: 'var(--gf-gray-50)', borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gf-gray-400)', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      {nota && <div style={{ fontSize: 10, color: 'var(--gf-gray-400)' }}>{nota}</div>}
    </div>
  );
}

const MOTIVO_TXT: Record<string, string> = {
  sin_precio: 'sin precio del día',
  sin_tc: 'sin tipo de cambio para pasar de moneda',
  cedear_sin_ratio: 'CEDEAR: falta el ratio con el subyacente',
  sin_moneda: 'el chat no dijo en qué moneda están los fundamentals',
  sin_eps: 'sin EPS de guía',
  eps_no_positivo: 'EPS negativo o cero en la guía',
};

export function SeccionTesis({ ticker, ind, doc, onGuardada }: {
  ticker: string; ind: IndicadoresPosicion | null; doc: DocTesis | null; onGuardada: (d: DocTesis) => void;
}) {
  const [editando, setEditando] = useState(false);
  if (!doc) {
    if (ind?.tipo !== 'accion' && ind?.tipo !== 'cedear') return null;
    return (
      <Card padding="12px">
        <div style={{ ...titulo, marginBottom: 6 }}>TESIS</div>
        <div style={sub}>Todavía no hay tesis para {ticker}: la trae el Chat 2 (parte 2 del informe), con fuentes y fechas.</div>
      </Card>
    );
  }
  const t = doc.tesis;
  const c = ind?.tesisCalculo ?? null;
  const distinto = (k: CampoTesis) => doc.distintoDelChat?.[k] !== undefined
    ? <span style={{ fontSize: 10, color: 'var(--gf-out)', marginLeft: 6 }}>dato del chat distinto: {JSON.stringify(doc.distintoDelChat[k])}</span>
    : null;
  return (
    <Card padding="12px">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <div style={titulo}>TESIS</div>
        {t.fechaDatos && <span style={sub}>datos al {fmtFecha(t.fechaDatos)}</span>}
        <button onClick={() => setEditando(v => !v)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--color-accent)', fontFamily: 'var(--font-base)' }}>
          {editando ? 'Cerrar' : 'Editar'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <Numero label="P/E" valor={c?.pe != null ? fmt(c.pe, 1) : '—'} nota={c?.pe == null && c?.motivo ? MOTIVO_TXT[c.motivo] ?? c.motivo : t.epsPeriodo ? `EPS ${t.epsPeriodo}` : null} />
        <Numero label="Potencial al consenso" valor={c?.potencial != null ? fmtPct(c.potencial) : '—'} nota={t.analistas ? `${t.analistas} analistas${t.recomendacionConsenso ? ` · ${t.recomendacionConsenso}` : ''}` : null} />
        <Numero label="Días al evento" valor={c?.diasAlEvento != null && c.diasAlEvento >= 0 ? String(c.diasAlEvento) : '—'} nota={t.proximoEvento.fecha ? `${t.proximoEvento.tipo === 'balance' ? 'Balance' : t.proximoEvento.texto || 'Evento'} ${fmtFecha(t.proximoEvento.fecha)}` : null} />
      </div>
      {(c?.gatillos ?? t.gatillos.map(g => ({ ...g, cumplido: null as boolean | null }))).length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gf-gray-400)', letterSpacing: 0.3, marginBottom: 3 }}>GATILLOS{distinto('gatillos')}</div>
          {(c?.gatillos ?? t.gatillos.map(g => ({ ...g, cumplido: null as boolean | null }))).map((g, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, fontSize: 12, padding: '2px 0', alignItems: 'baseline' }}>
              <span style={{ fontWeight: 800, color: g.cumplido === true ? 'var(--gf-income)' : g.cumplido === false ? 'var(--gf-expense)' : 'var(--gf-gray-400)' }}>
                {g.cumplido === true ? '✓' : g.cumplido === false ? '✗' : '·'}
              </span>
              <span style={{ flex: 1 }}>{g.texto}</span>
              <span style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{g.valorActual ?? 's/d'} {g.operador} {g.umbral}</span>
            </div>
          ))}
        </div>
      )}
      {[['Corto plazo', 'cortoPlazo'], ['Mediano plazo', 'medianoPlazo'], ['Riesgo principal', 'riesgoPrincipal']].map(([l, k]) => (
        (t as Record<string, unknown>)[k] ? (
          <div key={k} style={{ fontSize: 12, lineHeight: 1.45, marginBottom: 5 }}>
            <strong>{l}:</strong> {String((t as Record<string, unknown>)[k])}{distinto(k as CampoTesis)}
          </div>
        ) : null
      ))}
      {t.fuentes.length > 0 && (
        <div style={{ ...sub, marginTop: 4 }}>Fuentes: {t.fuentes.map(f => `${f.texto}${f.fecha ? ` (${fmtFecha(f.fecha)})` : ''}`).join(' · ')}</div>
      )}
      {(['precioObjetivoConsenso', 'epsGuiaMin', 'epsGuiaMax'] as CampoTesis[]).some(k => doc.distintoDelChat?.[k] !== undefined) && (
        <div style={{ ...sub, marginTop: 4, color: 'var(--gf-out)' }}>
          {(['precioObjetivoConsenso', 'epsGuiaMin', 'epsGuiaMax'] as CampoTesis[]).filter(k => doc.distintoDelChat?.[k] !== undefined)
            .map(k => `${k}: dato del chat distinto: ${JSON.stringify(doc.distintoDelChat[k])}`).join(' · ')}
        </div>
      )}
      <div style={{ ...sub, marginTop: 6 }}>
        Datos del Chat 2, con fuente y fecha. La app calcula P/E, potencial y gatillos con el precio del día. Sin precio
        objetivo propio: el potencial es contra el consenso publicado.
      </div>
      {editando && <EditorTesis doc={doc} onGuardada={d => { onGuardada(d); }} />}
    </Card>
  );
}

/** Editor mínimo: cada campo cambiado queda `editadoPorJuan` y la próxima importación no lo pisa. */
function EditorTesis({ doc, onGuardada }: { doc: DocTesis; onGuardada: (d: DocTesis) => void }) {
  const t = doc.tesis;
  const [b, setB] = useState({
    epsGuiaMin: t.epsGuiaMin?.toString() ?? '', epsGuiaMax: t.epsGuiaMax?.toString() ?? '',
    precioObjetivoConsenso: t.precioObjetivoConsenso?.toString() ?? '', fechaEvento: t.proximoEvento.fecha ?? '',
    cortoPlazo: t.cortoPlazo, medianoPlazo: t.medianoPlazo, riesgoPrincipal: t.riesgoPrincipal,
    gatillos: t.gatillos.map(g => g.valorActual?.toString() ?? ''),
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  const input = { width: '100%', padding: '7px 9px', borderRadius: 8, border: '1px solid var(--gf-gray-200)', fontSize: 13, fontFamily: 'var(--font-base)', boxSizing: 'border-box' as const };

  async function guardar() {
    setGuardando(true); setError(null);
    try {
      let d = doc;
      const cambios: Array<[CampoTesis, unknown]> = [];
      for (const k of ['epsGuiaMin', 'epsGuiaMax', 'precioObjetivoConsenso'] as const) {
        const v = num(b[k]);
        if (v !== null && !Number.isFinite(v)) throw new Error(`${k}: no es un número`);
        if (v !== t[k]) cambios.push([k, v]);
      }
      for (const k of ['cortoPlazo', 'medianoPlazo', 'riesgoPrincipal'] as const) if (b[k] !== t[k]) cambios.push([k, b[k]]);
      if ((b.fechaEvento || null) !== t.proximoEvento.fecha) cambios.push(['proximoEvento', { ...t.proximoEvento, fecha: b.fechaEvento || null }]);
      const gat = t.gatillos.map((g, i) => ({ ...g, valorActual: num(b.gatillos[i]) }));
      if (JSON.stringify(gat) !== JSON.stringify(t.gatillos)) cambios.push(['gatillos', gat]);
      for (const [k, v] of cambios) d = await guardarEdicionTesis(d, k, v as Tesis[typeof k]);
      onGuardada(d);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--gf-gray-100)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={sub}>Lo que cambies queda marcado como tuyo: el próximo Chat 2 no lo pisa (si trae otro dato, lo muestra aparte).</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
        {([['epsGuiaMin', `EPS mín. (${t.monedaFundamentals ?? 'moneda s/d'})`], ['epsGuiaMax', `EPS máx. (${t.monedaFundamentals ?? 'moneda s/d'})`], ['precioObjetivoConsenso', 'Precio objetivo de consenso']] as const).map(([k, l]) => (
          <label key={k} style={{ fontSize: 11, color: 'var(--color-text-sec)' }}>{l}
            <input inputMode="decimal" value={b[k]} onChange={e => setB({ ...b, [k]: e.target.value })} style={input} />
          </label>
        ))}
        <label style={{ fontSize: 11, color: 'var(--color-text-sec)' }}>Fecha del próximo evento
          <input type="date" value={b.fechaEvento} onChange={e => setB({ ...b, fechaEvento: e.target.value })} style={input} />
        </label>
      </div>
      {t.gatillos.map((g, i) => (
        <label key={i} style={{ fontSize: 11, color: 'var(--color-text-sec)' }}>Valor actual — {g.texto} ({g.operador} {g.umbral})
          <input inputMode="decimal" value={b.gatillos[i]} onChange={e => setB({ ...b, gatillos: b.gatillos.map((x, j) => (j === i ? e.target.value : x)) })} style={input} />
        </label>
      ))}
      {([['cortoPlazo', 'Corto plazo'], ['medianoPlazo', 'Mediano plazo'], ['riesgoPrincipal', 'Riesgo principal']] as const).map(([k, l]) => (
        <label key={k} style={{ fontSize: 11, color: 'var(--color-text-sec)' }}>{l}
          <textarea rows={2} value={b[k]} onChange={e => setB({ ...b, [k]: e.target.value })} style={{ ...input, resize: 'vertical' }} />
        </label>
      ))}
      {error && <div style={{ fontSize: 12, color: 'var(--gf-expense)' }}>No se pudo guardar: {error}</div>}
      <button onClick={guardar} disabled={guardando} style={{ alignSelf: 'flex-end', padding: '9px 14px', borderRadius: 10, border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: guardando ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}>
        {guardando ? 'Guardando…' : 'Guardar cambios'}
      </button>
    </div>
  );
}
