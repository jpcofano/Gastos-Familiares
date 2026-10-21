// F9.196 H6 (base §7, diseño 3) — secciones nuevas de la ficha de posición: stops (barra + mini
// gráfico de 60 ruedas), señales y tesis. Las monta FichaPosicion en el orden de §7.
//
// ⛔ Contrato (CLAUDE-PATRIMONIO.md, "Stops y señales"): los stops son NIVELES DE REFERENCIA, no
// órdenes. Sin push, sin campana, sin "acción sugerida". Ningún texto de acá dice qué hacer.
import { useState, type ReactNode } from 'react';
import { Card } from '../design-system/components';
import { Icon } from '../design-system/Icon';
import type { IndicadoresPosicion } from '../types/patrimonio';
import {
  calcularTesis, claveGatillo, editarTesis, editarValorGatillo, aceptarDatoDelChat, aceptarGatilloDelChat,
  type DocTesis, type CampoTesis,
} from '../datos/compartido/tesis';
import { guardarTesis } from '../datos/patrimonioTesis';
import { distANivel, hoyART, taparMontos } from '../datos/patrimonioAccionesAMirar';
import { leerNumero } from '../datos/patrimonioNumeros';

const fmt = (n: number, dec = 2) => n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtPct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1).replace('.', ',')}%`;
const fmtFecha = (iso: string) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a.slice(2)}`; };
const titulo = { fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: 'var(--gf-gray-400)' } as const;
const sub = { fontSize: 10.5, color: 'var(--gf-gray-400)', lineHeight: 1.45, overflowWrap: 'anywhere' } as const;

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
  ok: { txt: 'lejos del stop ATR y de la SMA200', color: 'var(--gf-income)' },
  sin_datos: { txt: 'sin datos suficientes', color: 'var(--gf-gray-400)' },
};

/**
 * Barra horizontal con el precio y las marcas de stop ATR, SMA50 y SMA200. La distancia va en el
 * formato de §7: nivel ÷ precio − 1 (−6,9% = el precio tendría que caer 6,9% para llegar al nivel).
 */
function BarraNiveles({ ind, privado }: { ind: IndicadoresPosicion; privado: boolean }) {
  const st = ind.stops!;
  const marcas = [
    { k: 'Stop ATR', v: st.stopAtr, d: st.distStopAtrPct, color: 'var(--gf-expense)' },
    { k: 'SMA50', v: st.stopSma50, d: st.distSma50Pct, color: 'var(--gf-out)' },
    { k: 'SMA200', v: st.stopSma200, d: st.distSma200Pct, color: 'var(--gf-ink)' },
  ].filter((m): m is { k: string; v: number; d: number | null; color: string } => m.v !== null);
  const valores = [st.cierre, ...marcas.map(m => m.v)];
  const min = Math.min(...valores), max = Math.max(...valores);
  const margen = (max - min) * 0.12 || Math.abs(st.cierre) * 0.05 || 1;
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
            {m.k} {privado ? '•••' : fmt(m.v)}{m.d !== null && <span style={{ color: 'var(--gf-gray-400)' }}>({fmtPct(distANivel(m.d))})</span>}
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
  // Todos iguales: la línea va al medio, no pegada al borde.
  const ys = (v: number) => (max === min ? H / 2 : H - P - ((v - min) / (max - min)) * (H - 2 * P));
  const linea = (get: (l: (typeof h)[number]) => number | null, escalonada = false) => {
    let d = '';
    let corte = true;   // un null corta la línea: no se traza una recta sobre el hueco
    h.forEach((l, i) => {
      const v = get(l);
      if (v === null) { corte = true; return; }
      if (corte) d += `${d ? ' ' : ''}M${xs(i)},${ys(v)}`;
      else d += escalonada ? ` H${xs(i)} V${ys(v)}` : ` L${xs(i)},${ys(v)}`;
      corte = false;
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
        Stop ATR = máximo de cierre de 22 ruedas menos 3 ATR. "Debajo" de una media exige dos cierres seguidos. El
        porcentaje es la distancia del precio al nivel. Son referencias para mirar, en la moneda de la serie
        ({ind.monedaSerie ?? '—'}), con el cierre del {fmtFecha(st.fechaLectura)}.
      </div>
    </Card>
  );
}

// ── Señales ───────────────────────────────────────────────────────────────────

export function SeccionSenales({ ind, privado = false }: { ind: IndicadoresPosicion | null; privado?: boolean }) {
  const senales = ind?.senales ?? [];
  if (!ind?.stops) return null;
  return (
    <Card padding="12px">
      <div style={{ ...titulo, marginBottom: 8 }}>SEÑALES</div>
      {senales.length === 0 ? <div style={sub}>Sin señales activas.</div> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {senales.map((s, i) => (
            <span key={`${s.id}-${i}`} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', maxWidth: '100%', overflowWrap: 'anywhere',
              fontSize: 11.5, borderRadius: 12, padding: '4px 9px',
              background: s.nivel === 'atencion' ? 'rgba(245,158,11,.14)' : 'var(--gf-gray-50)',
              border: s.nueva ? '1.5px solid var(--gf-out)' : '1px solid transparent', fontWeight: s.nueva ? 700 : 500,
            }}>
              {s.nueva && <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--gf-out)' }}>NUEVA</span>}
              {privado ? taparMontos(s.texto) : s.texto}
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
    <div style={{ flex: '1 1 90px', minWidth: 0, background: 'var(--gf-gray-50)', borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gf-gray-400)', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      {nota && <div style={{ fontSize: 10, color: 'var(--gf-gray-400)', overflowWrap: 'anywhere' }}>{nota}</div>}
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

const CAMPO_TXT: Partial<Record<CampoTesis, string>> = {
  monedaFundamentals: 'Moneda de los fundamentals', epsGuiaMin: 'EPS mínimo', epsGuiaMax: 'EPS máximo', epsPeriodo: 'Período del EPS',
  precioObjetivoConsenso: 'Precio objetivo de consenso', analistas: 'Analistas', recomendacionConsenso: 'Recomendación de consenso',
  gatillos: 'Gatillos', proximoEvento: 'Próximo evento', cortoPlazo: 'Corto plazo', medianoPlazo: 'Mediano plazo',
  riesgoPrincipal: 'Riesgo principal', fuentes: 'Fuentes', fechaDatos: 'Fecha de los datos',
};

/** Un valor del chat, legible (sin JSON crudo). */
function legible(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'sin dato';
  if (typeof v === 'number') return fmt(v, Number.isInteger(v) ? 0 : 2);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? 'elemento' : 'elementos'}`;
  const o = v as Record<string, unknown>;
  if ('fecha' in o) return `${o.fecha ? fmtFecha(String(o.fecha)) : 'sin fecha'}${o.texto ? ` · ${o.texto}` : ''}`;
  return Object.values(o).map(x => String(x)).join(' · ');
}

const btnLink = { background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 10.5, fontWeight: 700, color: 'var(--color-accent)', fontFamily: 'var(--font-base)' } as const;

export function SeccionTesis({ ticker, ind, doc, tc, privado = false, onGuardada }: {
  ticker: string; ind: IndicadoresPosicion | null; doc: DocTesis | null;
  /** MEP de hoy (cartera viva), para pasar el precio a la moneda de los fundamentals. */
  tc?: number | null;
  privado?: boolean;
  onGuardada: (d: DocTesis) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
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
  // Se recalcula acá con la tesis vigente (también lo editado recién) y el último cierre; el
  // cálculo del cron queda de respaldo si no hay precio.
  const precio = ind?.precio ?? null;
  const tcUsado = tc ?? null;
  const c = precio !== null && ind?.monedaSerie
    ? calcularTesis(t, { valor: precio, moneda: ind.monedaSerie }, { tc: tcUsado, hoy: hoyART(), esCedear: ind.tipo === 'cedear' })
    : ind?.tesisCalculo ?? null;
  const fechaPrecio = precio !== null ? ind?.fechaUltimoPrecio ?? null : ind?.tesisCalculo?.fecha ?? null;

  async function guardar(nuevo: DocTesis, msj: string) {
    setAviso(null);
    try {
      const d = await guardarTesis(doc!, nuevo);
      onGuardada(d);
      setAviso(msj);
    } catch (e) {
      setAviso(`No se pudo guardar: ${String((e as Error)?.message ?? e)}`);
    }
  }
  const distinto = (k: CampoTesis) => doc.distintoDelChat?.[k] !== undefined ? (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--gf-out)', marginLeft: 6, overflowWrap: 'anywhere' }}>
      dato del chat distinto: {legible(doc.distintoDelChat[k])}
      <button style={btnLink} onClick={() => guardar(aceptarDatoDelChat(doc, k), 'Listo: quedó el dato del chat.')}>usar el del chat</button>
    </span>
  ) : null;
  const gatillos = c?.gatillos ?? t.gatillos.map(g => ({ ...g, cumplido: null as boolean | null }));
  const camposNum: CampoTesis[] = ['precioObjetivoConsenso', 'epsGuiaMin', 'epsGuiaMax'];
  return (
    <Card padding="12px">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={titulo}>TESIS</div>
        {t.fechaDatos && <span style={sub}>datos al {fmtFecha(t.fechaDatos)}</span>}
        <button onClick={() => { setEditando(v => !v); setAviso(null); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--color-accent)', fontFamily: 'var(--font-base)' }}>
          {editando ? 'Cerrar' : 'Editar'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <Numero label="P/E" valor={c?.pe != null ? fmt(c.pe, 1) : '—'} nota={c?.pe == null && c?.motivo ? MOTIVO_TXT[c.motivo] ?? c.motivo : t.epsPeriodo ? `EPS ${t.epsPeriodo}` : null} />
        <Numero label="Potencial al consenso" valor={c?.potencial != null ? fmtPct(c.potencial) : '—'} nota={t.analistas ? `${t.analistas} analistas${t.recomendacionConsenso ? ` · ${t.recomendacionConsenso}` : ''}` : null} />
        <Numero label="Días al evento" valor={c?.diasAlEvento != null && c.diasAlEvento >= 0 ? String(c.diasAlEvento) : '—'} nota={t.proximoEvento.fecha ? `${t.proximoEvento.tipo === 'balance' ? 'Balance' : t.proximoEvento.texto || 'Evento'} ${fmtFecha(t.proximoEvento.fecha)}` : null} />
      </div>
      {distinto('proximoEvento') && <div style={{ marginBottom: 6 }}><span style={sub}>Próximo evento:</span>{distinto('proximoEvento')}</div>}
      {gatillos.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gf-gray-400)', letterSpacing: 0.3, marginBottom: 3 }}>GATILLOS{distinto('gatillos')}</div>
          {gatillos.map((g, i) => {
            const k = claveGatillo(g);
            const dist = doc.gatillosDistintos?.[k];
            return (
              <div key={i} style={{ fontSize: 12, padding: '2px 0' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 800, color: g.cumplido === true ? 'var(--gf-income)' : g.cumplido === false ? 'var(--gf-expense)' : 'var(--gf-gray-400)' }}>
                    {g.cumplido === true ? '✓' : g.cumplido === false ? '✗' : '·'}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{g.texto}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{g.valorActual ?? 's/d'} {g.operador} {g.umbral}</span>
                </div>
                {dist !== undefined && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--gf-out)', paddingLeft: 16 }}>
                    dato del chat distinto: {legible(dist)}
                    <button style={btnLink} onClick={() => guardar(aceptarGatilloDelChat(doc, k), 'Listo: quedó el dato del chat.')}>usar el del chat</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {([['Corto plazo', 'cortoPlazo'], ['Mediano plazo', 'medianoPlazo'], ['Riesgo principal', 'riesgoPrincipal']] as const).map(([l, k]) => (
        t[k] ? (
          <div key={k} style={{ fontSize: 12, lineHeight: 1.45, marginBottom: 5, overflowWrap: 'anywhere' }}>
            <strong>{l}:</strong> {t[k]}{distinto(k)}
          </div>
        ) : null
      ))}
      {t.fuentes.length > 0 && (
        <div style={{ ...sub, marginTop: 4 }}>Fuentes: {t.fuentes.map(f => `${f.texto}${f.fecha ? ` (${fmtFecha(f.fecha)})` : ''}`).join(' · ')}</div>
      )}
      {camposNum.some(k => doc.distintoDelChat?.[k] !== undefined) && (
        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {camposNum.filter(k => doc.distintoDelChat?.[k] !== undefined).map(k => (
            <div key={k}><span style={sub}>{CAMPO_TXT[k]}:</span>{distinto(k)}</div>
          ))}
        </div>
      )}
      {aviso && <div style={{ fontSize: 12, marginTop: 6, color: aviso.startsWith('No se pudo') ? 'var(--gf-expense)' : 'var(--gf-income)' }}>{aviso}</div>}
      <div style={{ ...sub, marginTop: 6 }}>
        Datos del Chat 2, con fuente y fecha. La app calcula P/E, potencial y gatillos con el último cierre
        {fechaPrecio ? ` (${fmtFecha(fechaPrecio)})` : ''}{!privado && precio !== null ? `, ${ind?.monedaSerie === 'USD' ? 'US$' : '$'} ${fmt(precio)}` : ''}
        {ind?.monedaSerie && t.monedaFundamentals && ind.monedaSerie !== t.monedaFundamentals ? `, pasado con el MEP${tcUsado ? ` de $ ${fmt(tcUsado, 0)}` : ' (sin dato)'}` : ''}.
        Sin precio objetivo propio: el potencial es contra el consenso publicado.
      </div>
      {editando && (
        <EditorTesis doc={doc} onGuardada={d => { onGuardada(d); setEditando(false); setAviso('Guardado. Lo que cambiaste queda como tuyo.'); }} />
      )}
    </Card>
  );
}

/** Editor mínimo: cada campo cambiado queda `editadoPorJuan` (un gatillo, de a uno) y se guarda todo junto. */
function EditorTesis({ doc, onGuardada }: { doc: DocTesis; onGuardada: (d: DocTesis) => void }) {
  const t = doc.tesis;
  const [b, setB] = useState({
    epsGuiaMin: t.epsGuiaMin?.toString() ?? '', epsGuiaMax: t.epsGuiaMax?.toString() ?? '',
    precioObjetivoConsenso: t.precioObjetivoConsenso?.toString() ?? '', fechaEvento: t.proximoEvento.fecha ?? '',
    cortoPlazo: t.cortoPlazo ?? '', medianoPlazo: t.medianoPlazo ?? '', riesgoPrincipal: t.riesgoPrincipal ?? '',
    gatillos: t.gatillos.map(g => g.valorActual?.toString() ?? ''),
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 16px: en iOS, un input de menos hace zoom al enfocarlo.
  const input = { width: '100%', padding: '7px 9px', borderRadius: 8, border: '1px solid var(--gf-gray-200)', fontSize: 16, fontFamily: 'var(--font-base)', boxSizing: 'border-box' as const };
  const moneda = t.monedaFundamentals ?? 'moneda s/d';

  async function guardar() {
    setGuardando(true); setError(null);
    try {
      let d = doc;
      const leer = (s: string, rotulo: string) => {
        const r = leerNumero(s);
        if ('error' in r) throw new Error(`${rotulo}: ${r.error}`);
        return r.valor;
      };
      for (const k of ['epsGuiaMin', 'epsGuiaMax', 'precioObjetivoConsenso'] as const) {
        const v = leer(b[k], CAMPO_TXT[k]!);
        if (v !== t[k]) d = editarTesis(d, k, v);
      }
      for (const k of ['cortoPlazo', 'medianoPlazo', 'riesgoPrincipal'] as const) if (b[k] !== (t[k] ?? '')) d = editarTesis(d, k, b[k]);
      if ((b.fechaEvento || null) !== t.proximoEvento.fecha) d = editarTesis(d, 'proximoEvento', { ...t.proximoEvento, fecha: b.fechaEvento || null });
      t.gatillos.forEach((g, i) => {
        const v = leer(b.gatillos[i], `Valor de «${g.texto}»`);
        if (v !== g.valorActual) d = editarValorGatillo(d, claveGatillo(g), v);
      });
      if (d === doc) { onGuardada(doc); return; }
      onGuardada(await guardarTesis(doc, d));
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--gf-gray-100)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={sub}>Lo que cambies queda marcado como tuyo: el próximo Chat 2 no lo pisa (si trae otro dato, lo muestra aparte y podés volver al del chat).</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
        {([['epsGuiaMin', `EPS mín. (${moneda})`], ['epsGuiaMax', `EPS máx. (${moneda})`], ['precioObjetivoConsenso', `Precio objetivo de consenso (${moneda})`]] as const).map(([k, l]) => (
          <label key={k} style={{ fontSize: 11, color: 'var(--color-text-sec)' }}>{l}
            <input inputMode="decimal" value={b[k]} onChange={e => setB({ ...b, [k]: e.target.value })} style={input} />
          </label>
        ))}
        <label style={{ fontSize: 11, color: 'var(--color-text-sec)' }}>Fecha del próximo evento
          <input type="date" value={b.fechaEvento} onChange={e => setB({ ...b, fechaEvento: e.target.value })} style={input} />
        </label>
      </div>
      {t.gatillos.map((g, i) => (
        <label key={i} style={{ fontSize: 11, color: 'var(--color-text-sec)', overflowWrap: 'anywhere' }}>Valor actual — {g.texto} ({g.operador} {g.umbral})
          {/* inputMode text: el teclado decimal de iOS y de muchos Android no tiene signo menos. */}
          <input inputMode="text" value={b.gatillos[i]} onChange={e => setB({ ...b, gatillos: b.gatillos.map((x, j) => (j === i ? e.target.value : x)) })} style={input} />
        </label>
      ))}
      {([['cortoPlazo', 'Corto plazo'], ['medianoPlazo', 'Mediano plazo'], ['riesgoPrincipal', 'Riesgo principal']] as const).map(([k, l]) => (
        <label key={k} style={{ fontSize: 11, color: 'var(--color-text-sec)' }}>{l}
          <textarea rows={2} value={b[k]} onChange={e => setB({ ...b, [k]: e.target.value })} style={{ ...input, resize: 'vertical' }} />
        </label>
      ))}
      {error && <div style={{ fontSize: 12, color: 'var(--gf-expense)', overflowWrap: 'anywhere' }}>No se pudo guardar: {error}</div>}
      <button onClick={guardar} disabled={guardando} style={{ alignSelf: 'flex-end', padding: '9px 14px', borderRadius: 10, border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: guardando ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}>
        {guardando ? 'Guardando…' : 'Guardar cambios'}
      </button>
    </div>
  );
}
