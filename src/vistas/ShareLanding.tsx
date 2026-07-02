import { useEffect, useState } from 'react';
import { Icon } from '../design-system/Icon';
import './ShareLanding.css';

// F9.51 — pantalla de recepción que cubre el arranque en frío de Comprobantes
// cuando llega por Web Share Target (?share=1). Fase no avanza por timers —
// la calcula Comprobantes.tsx a partir del estado real.
// F9.66 — rediseño: espera full-screen (space-between), documento animado grande,
// indicadores compactos pre-clasificado (ámbar, temprano) / match (verde, al terminar).

export interface BadgeFactura {
  titulo: string;
  sub: string;
  match: boolean;
}

export interface FacturaLanding {
  monto: number | null;
  moneda: 'ARS' | 'USD';
  comercio: string | null;
  vence: string | null;
  categoria: string | null; // "Servicios · Luz" — null si no hay sugerencia
  badge: BadgeFactura;
}

export interface MontoPorMoneda {
  moneda: 'ARS' | 'USD';
  monto: number;
}

export interface ResumenLanding {
  consumos: number;
  enCuotas: number;
  totales: MontoPorMoneda[];
  esteMes: MontoPorMoneda[];
  deudaFutura: MontoPorMoneda[];
}

interface ShareLandingProps {
  nombreArchivo: string;
  tamano: number;
  fase: number; // 0-4
  tipo: 'factura' | 'resumen' | null;
  factura?: FacturaLanding;
  resumen?: ResumenLanding;
  error?: string | null;
  onCargarManual: () => void;
  onReady: () => void;
  onClose: () => void;
}

function fmtMonto(n: number, moneda: 'ARS' | 'USD'): string {
  const v = Math.round(n).toLocaleString('es-AR');
  return moneda === 'USD' ? `U$S ${v}` : `$ ${v}`;
}

const FOOTER_TEXTO = [
  'Recibiendo archivo…',
  'Leyendo el documento…',
  'Clasificando…',
  'Extrayendo datos…',
];

// Documento animado: grande (152×190) durante el escaneo, chico (92×116) cuando listo.
function LandingDoc({ scanning, listo, esResumen }: { scanning: boolean; listo: boolean; esResumen: boolean }) {
  const w = listo ? 92 : 152;
  const h = listo ? 116 : 190;
  const lineWidths = listo ? [80, 95, 65, 88, 55] : [80, 95, 65, 88, 55, 72];
  return (
    <div style={{
      position: 'relative', width: w, height: h, flexShrink: 0,
      transition: 'width .5s ease, height .5s ease',
      animation: scanning && !listo ? 'gfFloat 3s ease-in-out infinite' : 'none',
    }}>
      {!listo && (
        <>
          <span style={{ position: 'absolute', inset: '50% auto auto 50%', width: w, height: w, marginLeft: -w/2, marginTop: -w/2, borderRadius: '50%', border: '1.5px solid var(--color-accent)', animation: 'gfRing 2.4s ease-out infinite' }} />
          <span style={{ position: 'absolute', inset: '50% auto auto 50%', width: w, height: w, marginLeft: -w/2, marginTop: -w/2, borderRadius: '50%', border: '1.5px solid rgba(12,143,98,.35)', animation: 'gfRing 2.4s ease-out .8s infinite' }} />
        </>
      )}
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        borderRadius: listo ? 11 : 14, background: '#fff', overflow: 'hidden',
        boxShadow: listo ? '0 8px 24px rgba(0,0,0,.35)' : '0 22px 60px rgba(0,0,0,.5)',
        display: 'flex', flexDirection: 'column', gap: listo ? 4 : 7,
        padding: listo ? '10px 9px' : '16px 14px', transition: 'all .5s ease',
      }}>
        <span style={{ width: listo ? 24 : 36, height: listo ? 24 : 36, borderRadius: listo ? 6 : 9, background: 'var(--gf-emerald-50)', color: 'var(--color-accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: listo ? 1 : 2, flexShrink: 0, transition: 'all .4s ease' }}>
          <Icon name={esResumen ? 'credit-card' : 'file-text'} size={listo ? 13 : 18} />
        </span>
        {lineWidths.map((wpct, i) => (
          <span key={i} style={{ height: listo ? 4.5 : 6, width: wpct + '%', borderRadius: 4, background: i === 0 ? 'var(--gf-gray-200)' : 'var(--gf-gray-100)', animation: !listo ? `gfShimmer 1.6s ease-in-out ${i * 0.1}s infinite` : 'none' }} />
        ))}
        {!listo && (
          <div style={{ marginTop: 4, borderRadius: 6, background: 'var(--gf-emerald-50)', height: 18, display: 'flex', alignItems: 'center', padding: '0 8px', gap: 6 }}>
            <span style={{ height: 5, width: 40, borderRadius: 4, background: 'rgba(12,143,98,.3)', animation: 'gfShimmer 1.6s ease-in-out infinite' }} />
            <span style={{ flex: 1 }} />
            <span style={{ height: 5, width: 28, borderRadius: 4, background: 'var(--color-accent)', animation: 'gfShimmer 1.6s ease-in-out .3s infinite' }} />
          </div>
        )}
        {!listo && <span style={{ position: 'absolute', left: 0, right: 0, height: 30, background: 'linear-gradient(180deg, transparent, rgba(12,143,98,.28) 50%, transparent)', borderTop: '1.5px solid var(--color-accent)', animation: 'gfScan 2s ease-in-out infinite' }} />}
        {listo && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.85)' }}>
            <span style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', animation: 'gfRiseIn .4s ease both' }}>
              <Icon name="check" size={20} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// Indicador compacto icon-forward para pre-clasificado y match.
function LandingInd({ icon, label, tone }: { icon: string; label: string; tone: 'amber' | 'green' | 'neutral' }) {
  const S = {
    amber:   { bg: 'rgba(245,158,11,.16)', border: '1px solid rgba(245,158,11,.30)', color: '#fbbf24' },
    green:   { bg: 'rgba(12,143,98,.16)',  border: '1px solid var(--gf-emerald-line)', color: 'var(--gf-emerald-100)' },
    neutral: { bg: 'rgba(255,255,255,.08)', border: '1px solid transparent', color: '#9ca3af' },
  }[tone];
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 10, padding: '9px 14px', background: S.bg, border: S.border, animation: 'gfRiseIn .35s ease both' }}>
      <Icon name={icon} size={15} color={S.color} />
      <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{label}</span>
    </div>
  );
}

export default function ShareLanding({
  fase, tipo, factura, resumen, error, onCargarManual, onReady, onClose,
}: ShareLandingProps) {
  const esResumen = tipo === 'resumen';
  const clasificado = fase >= 2;
  const extrayendo  = fase >= 3;
  const listo       = fase >= 4 && !error;

  useEffect(() => {
    if (!listo) return;
    const t = setTimeout(onReady, 900);
    return () => clearTimeout(t);
  }, [listo, onReady]);

  // Count-up del monto — arranca cuando llega el valor real, no por timer.
  const objetivo = esResumen ? resumen?.totales[0]?.monto ?? null : factura?.monto ?? null;
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (objetivo == null) { setVal(0); return; }
    let raf: number;
    let start: number | undefined;
    const dur = 800;
    const tick = (t: number) => {
      if (start == null) start = t;
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      setVal(objetivo * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [objetivo]);

  const monedaHero = esResumen ? (resumen?.totales[0]?.moneda ?? 'ARS') : (factura?.moneda ?? 'ARS');

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 70, background: 'var(--gf-ink)',
      display: 'flex', flexDirection: 'column', color: '#fff',
      backgroundImage: 'radial-gradient(120% 78% at 50% 0%, var(--gf-ink-soft) 0%, var(--gf-ink) 58%)',
    }}>
      {/* Top bar */}
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 4px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--gf-emerald-100)' }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--color-accent)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>GF</span>
          Gastos Familiares
        </span>
        <button onClick={onClose} aria-label="Cancelar" style={{ background: 'rgba(255,255,255,.1)', border: 'none', color: '#fff', borderRadius: 999, width: 30, height: 30, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="x" size={16} />
        </button>
      </div>

      {/* Cuerpo — F9.66: space-between durante espera, centered al terminar */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: !listo ? 'space-between' : 'center',
        gap: !listo ? 0 : 16, padding: '26px 26px 30px',
      }}>
        {error ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
            <span style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(239,68,68,.18)', color: '#fca5a5', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="circle-x" size={22} />
            </span>
            <p style={{ fontSize: 14, color: '#fff', maxWidth: 280, margin: 0 }}>{error}</p>
            <button
              onClick={onCargarManual}
              style={{ background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '11px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
            >
              Cargar manual
            </button>
          </div>
        ) : (
          <>
            {/* ── RAMA FACTURA · ESPERA ── */}
            {!esResumen && !listo && (
              <>
                <div style={{ height: 26, display: 'flex', alignItems: 'center' }}>
                  {clasificado ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(12,143,98,.2)', border: '1px solid var(--gf-emerald-line)', color: 'var(--gf-emerald-100)', borderRadius: 999, padding: '5px 13px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', animation: 'gfRiseIn .4s ease both' }}>
                      <Icon name="receipt" size={13} />Comprobante
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--gf-emerald-100)' }}>Compartido a Gastos</span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
                  <LandingDoc scanning listo={false} esResumen={false} />
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 16.5, fontWeight: 700, color: '#fff' }}>Leyendo tu comprobante</div>
                    <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 5 }}>Extraemos importe, comercio y fecha…</div>
                  </div>
                </div>
                <div style={{ minHeight: 42, display: 'flex', alignItems: 'center' }}>
                  {clasificado && factura?.categoria && (
                    <LandingInd icon="sparkles" label={`Pre-clasificado · ${factura.categoria}`} tone="amber" />
                  )}
                </div>
              </>
            )}

            {/* ── RAMA FACTURA · LISTO ── */}
            {!esResumen && listo && factura && (
              <>
                <LandingDoc scanning={false} listo esResumen={false} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 7 }}>Comprobante detectado</div>
                  <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-1.5px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{fmtMonto(val, monedaHero)}</div>
                  {factura.comercio && <div style={{ fontSize: 15, fontWeight: 600, color: '#e5e7eb', marginTop: 6 }}>{factura.comercio}</div>}
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {factura.categoria && <LandingInd icon="sparkles" label="Pre-clasificado" tone="amber" />}
                  <LandingInd
                    icon={factura.badge.match ? 'git-compare' : 'plus'}
                    label={factura.badge.match ? 'Gasto esperado' : 'Movimiento nuevo'}
                    tone={factura.badge.match ? 'green' : 'neutral'}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {[factura.categoria, factura.vence ? `Vence ${factura.vence.slice(0, 5)}` : null, factura.moneda]
                    .filter(Boolean).map((c, i) => (
                      <span key={i} style={{ fontSize: 12.5, fontWeight: 600, color: '#e5e7eb', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 9, padding: '7px 12px' }}>{c}</span>
                    ))}
                </div>
                {factura.badge.match && factura.badge.sub && (
                  <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>{factura.badge.sub}</div>
                )}
              </>
            )}

            {/* ── RAMA RESUMEN · ESPERA ── */}
            {esResumen && !listo && (
              <>
                <div style={{ height: 26, display: 'flex', alignItems: 'center' }}>
                  {clasificado ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(12,143,98,.2)', border: '1px solid var(--gf-emerald-line)', color: 'var(--gf-emerald-100)', borderRadius: 999, padding: '5px 13px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', animation: 'gfRiseIn .4s ease both' }}>
                      <Icon name="credit-card" size={13} />Resumen de tarjeta
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--gf-emerald-100)' }}>Compartido a Gastos</span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
                  <LandingDoc scanning listo={false} esResumen />
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 16.5, fontWeight: 700, color: '#fff' }}>Leyendo tu resumen</div>
                    <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 5 }}>Extraemos consumos, cuotas y totales…</div>
                  </div>
                </div>
                <div style={{ minHeight: 42, display: 'flex', alignItems: 'center', gap: 9 }}>
                  {extrayendo && resumen && (
                    <>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.08)', borderRadius: 9, padding: '7px 12px', fontSize: 12.5, fontWeight: 600 }}>
                        <Icon name="list" size={14} color="var(--gf-emerald-100)" />{resumen.consumos} consumos
                      </span>
                      {resumen.enCuotas > 0 && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.08)', borderRadius: 9, padding: '7px 12px', fontSize: 12.5, fontWeight: 600 }}>
                          <Icon name="layers" size={14} color="var(--gf-emerald-100)" />{resumen.enCuotas} en cuotas
                        </span>
                      )}
                    </>
                  )}
                </div>
              </>
            )}

            {/* ── RAMA RESUMEN · LISTO ── */}
            {esResumen && listo && resumen && (
              <>
                <LandingDoc scanning={false} listo esResumen />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 7 }}>Total del resumen</div>
                  <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-1.5px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{fmtMonto(val, monedaHero)}</div>
                  {resumen.totales.length > 1 && (
                    <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 4 }}>+ {fmtMonto(resumen.totales[1].monto, resumen.totales[1].moneda)}</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 9, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.08)', borderRadius: 9, padding: '7px 12px', fontSize: 12.5, fontWeight: 600 }}>
                    <Icon name="list" size={14} color="var(--gf-emerald-100)" />{resumen.consumos} consumos
                  </span>
                  {resumen.enCuotas > 0 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.08)', borderRadius: 9, padding: '7px 12px', fontSize: 12.5, fontWeight: 600 }}>
                      <Icon name="layers" size={14} color="var(--gf-emerald-100)" />{resumen.enCuotas} en cuotas
                    </span>
                  )}
                </div>
                {resumen.esteMes.length > 0 && (
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: '#9ca3af', textAlign: 'center', marginBottom: 1 }}>Se divide en</div>
                    {resumen.esteMes.map((r, i) => (
                      <div key={`esteMes-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 11, borderRadius: 13, padding: '12px 15px', background: 'rgba(12,143,98,.16)', border: '1px solid var(--gf-emerald-line)' }}>
                        <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-accent)', color: '#fff' }}>
                          <Icon name="calendar-check" size={15} />
                        </span>
                        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: '#fff' }}>A pagar este mes{resumen.esteMes.length > 1 ? ` (${r.moneda})` : ''}</span>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{fmtMonto(r.monto, r.moneda)}</span>
                      </div>
                    ))}
                    {resumen.deudaFutura.map((r, i) => (
                      <div key={`deudaFutura-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 11, borderRadius: 13, padding: '12px 15px', background: 'rgba(255,255,255,.06)', border: '1px solid transparent' }}>
                        <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.1)', color: 'var(--gf-emerald-100)' }}>
                          <Icon name="clock" size={15} />
                        </span>
                        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500, color: '#fff' }}>Deuda futura (cuotas){resumen.deudaFutura.length > 1 ? ` (${r.moneda})` : ''}</span>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{fmtMonto(r.monto, r.moneda)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Pie */}
      {!error && (
        <div style={{ flexShrink: 0, padding: '0 26px 24px' }}>
          <div style={{ height: 4, borderRadius: 999, background: 'rgba(255,255,255,.1)', overflow: 'hidden', marginBottom: 11 }}>
            <div style={{ height: '100%', width: (((fase + 1) / 5) * 100) + '%', background: 'var(--color-accent)', borderRadius: 999, transition: 'width .5s ease' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, fontSize: 13, color: '#9ca3af' }}>
            {!listo && <span style={{ width: 13, height: 13, border: '2px solid rgba(255,255,255,.25)', borderTopColor: 'var(--gf-emerald-100)', borderRadius: '50%', animation: 'gfSpin .7s linear infinite' }} />}
            {listo
              ? (esResumen ? 'Listo — revisá y conciliá el resumen' : 'Listo — abriendo para confirmar')
              : FOOTER_TEXTO[fase] ?? FOOTER_TEXTO[FOOTER_TEXTO.length - 1]}
          </div>
        </div>
      )}
    </div>
  );
}
