import { useEffect, useState } from 'react';
import { Icon } from '../design-system/Icon';
import './ShareLanding.css';

// F9.51 — pantalla de recepción que cubre el arranque en frío de Comprobantes
// cuando llega por Web Share Target (?share=1). Layout/copy porteados de
// ui_kits/mobile/ShareLanding.jsx; a diferencia del kit, `fase` no avanza por
// timers — la calcula Comprobantes.tsx a partir del estado real de
// entrantes/comprobantes/resumenesTarjeta (ver calcularFaseCompartido allí).
// 0 recibido · 1 leyendo · 2 clasificado (tipo conocido) · 3 extrayendo
// (datos en camino) · 4 listo.

export interface BadgeFactura {
  titulo: string;
  sub: string;
  match: boolean; // true = estilo "coincide" (esmeralda), false = neutral
}

export interface FacturaLanding {
  monto: number | null;
  moneda: 'ARS' | 'USD';
  comercio: string | null;
  vence: string | null; // ya formateado DD/MM/YYYY
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

export default function ShareLanding({
  nombreArchivo, tamano, fase, tipo, factura, resumen, error, onCargarManual, onReady, onClose,
}: ShareLandingProps) {
  const esResumen = tipo === 'resumen';
  const clasificado = fase >= 2;
  const extrayendo  = fase >= 3;
  const listo       = fase >= 4 && !error;

  // Encadena al confirm real poco después de llegar a "listo" — la misma
  // pausa que en el kit, para que el usuario vea el resultado antes de saltar.
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

      {/* Documento + barrido + tipo detectado */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 24px 0' }}>
        <div style={{ height: 26, display: 'flex', alignItems: 'center' }}>
          {clasificado ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(12,143,98,.2)', border: '1px solid var(--gf-emerald-line)', color: 'var(--gf-emerald-100)', borderRadius: 999, padding: '5px 13px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', animation: 'gfRiseIn .4s ease both' }}>
              <Icon name={esResumen ? 'credit-card' : 'receipt'} size={13} />
              {esResumen ? 'Resumen de tarjeta' : 'Comprobante'}
            </span>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--gf-emerald-100)' }}>Compartido a Gastos</span>
          )}
        </div>
        <div style={{ position: 'relative', width: 96, height: 120, marginTop: 12 }}>
          <span style={{ position: 'absolute', inset: '50% auto auto 50%', width: 96, height: 96, marginLeft: -48, marginTop: -48, borderRadius: '50%', border: '1.5px solid var(--color-accent)', animation: 'gfRing 2.4s ease-out infinite' }} />
          <div style={{ position: 'relative', width: 96, height: 120, borderRadius: 11, background: '#fff', overflow: 'hidden', boxShadow: '0 18px 48px rgba(0,0,0,.45)', display: 'flex', flexDirection: 'column', gap: 5, padding: '12px 10px' }}>
            <span style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--gf-emerald-50)', color: 'var(--color-accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 2 }}>
              <Icon name={esResumen ? 'credit-card' : 'file-text'} size={15} />
            </span>
            {[78, 92, 60, 84, 50].map((w, i) => (
              <span key={i} style={{ height: 5.5, width: w + '%', borderRadius: 4, background: i === 0 ? 'var(--gf-gray-200)' : 'var(--gf-gray-100)' }} />
            ))}
            {!listo && <span style={{ position: 'absolute', left: 0, right: 0, height: 24, background: 'linear-gradient(180deg, transparent, rgba(12,143,98,.30) 50%, transparent)', borderTop: '1.5px solid var(--color-accent)', animation: 'gfScan 1.5s ease-in-out infinite' }} />}
          </div>
        </div>
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, maxWidth: '88%', background: 'rgba(255,255,255,.08)', borderRadius: 999, padding: '6px 13px', whiteSpace: 'nowrap' }}>
          <Icon name={esResumen ? 'credit-card' : 'file-text'} size={13} color="var(--gf-emerald-100)" />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombreArchivo}</span>
          <span style={{ fontSize: 11.5, color: '#9ca3af', flexShrink: 0 }}>· {(tamano / 1024).toFixed(0)} KB</span>
        </div>
      </div>

      {/* Cuerpo */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', padding: '14px 26px 4px' }}>
        {error ? (
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
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
            <div style={{ textAlign: 'center', opacity: extrayendo ? 1 : 0.35, transition: 'opacity .4s' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 4 }}>
                {esResumen ? 'Total del resumen' : 'Importe detectado'}
              </div>
              <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: '-1.5px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{fmtMonto(val, monedaHero)}</div>
              {esResumen && resumen && resumen.totales.length > 1 && (
                <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 4 }}>
                  + {fmtMonto(resumen.totales[1].monto, resumen.totales[1].moneda)}
                </div>
              )}
            </div>

            {/* RAMA FACTURA */}
            {!esResumen && factura && (
              <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[{ icon: 'store', label: 'Comercio', val: factura.comercio }, { icon: 'calendar', label: 'Vence', val: factura.vence }].map((f, i) => (
                  f.val && (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'rgba(255,255,255,.06)', borderRadius: 13, padding: '11px 14px', opacity: extrayendo ? 1 : 0, transform: extrayendo ? 'none' : 'translateY(8px)', transition: `all .4s ${i * 0.08}s` }}>
                      <span style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(12,143,98,.18)', color: 'var(--gf-emerald-100)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name={f.icon} size={15} />
                      </span>
                      <span style={{ flex: 1, fontSize: 12, color: '#9ca3af' }}>{f.label}</span>
                      <span style={{ fontSize: 14.5, fontWeight: 700, color: '#fff' }}>{f.val}</span>
                    </div>
                  )
                ))}
                <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px', borderRadius: 14, background: factura.badge.match ? 'rgba(12,143,98,.16)' : 'rgba(255,255,255,.06)', border: factura.badge.match ? '1px solid var(--gf-emerald-line)' : '1px solid transparent', opacity: listo ? 1 : 0, transform: listo ? 'none' : 'translateY(8px)', transition: 'all .45s' }}>
                  <span style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: factura.badge.match ? 'var(--color-accent)' : 'rgba(255,255,255,.1)', color: factura.badge.match ? '#fff' : 'var(--gf-emerald-100)' }}>
                    <Icon name={factura.badge.match ? 'git-compare' : 'plus'} size={16} />
                  </span>
                  <span style={{ flex: 1, lineHeight: 1.3 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: '#fff' }}>{factura.badge.titulo}</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#9ca3af' }}>{factura.badge.sub}</span>
                  </span>
                </div>
              </div>
            )}

            {/* RAMA RESUMEN */}
            {esResumen && resumen && (
              <div style={{ marginTop: 16, opacity: extrayendo ? 1 : 0, transform: extrayendo ? 'none' : 'translateY(8px)', transition: 'all .45s' }}>
                <div style={{ display: 'flex', gap: 9, justifyContent: 'center', marginBottom: 14 }}>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: listo ? 1 : 0, transition: 'opacity .4s' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 1 }}>Se divide en</div>
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
              </div>
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
