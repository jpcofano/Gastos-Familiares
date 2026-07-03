// ShareLanding — pantalla in-app de recepción cuando se comparte un archivo a la PWA
// (Web Share Target). El SO arranca la app en frío, redirige a /comprobantes?share=1 y
// ESTA pantalla cubre el arranque: lee el archivo de IndexedDB, lo clasifica y lo procesa.
//
// La parte LENTA es la extracción de datos: las fases previas (recibido/leyendo/
// clasificando) pasan casi instantáneas. Por eso el diseño LLENA la espera con un
// documento animado grande + esqueleto de los campos que se van completando, y muestra
// temprano lo que ya está disponible (tipo + pre-clasificado). Cuando termina:
// monto grande + comercio + dos indicadores (pre-clasificado ámbar · gasto esperado
// verde) + chips (categoría · vence · moneda). Auto-avanza al confirm (sin tap, sin delay).
//
// Props: { tipo?: 'factura'|'resumen', onReady, onClose }

const SL_FACTURA = {
  monto: 38900, comercio: 'EDENOR S.A.', fecha: '28/06/2026', categoria: 'Casa · Luz', moneda: 'ARS',
  match: { nombre: 'Edenor — luz', periodo: 'Junio' }, // null = movimiento nuevo
};
const SL_RESUMEN = {
  banco: 'Visa Galicia', total: 247350, consumos: 14, enCuotas: 3,
  esteMes: 158200, deudaFutura: 89150,
};

// Documento animado — recibo/factura estilizado, más grande y prolijo que el viejo.
// scanning = barrido + anillo de pulso; al terminar queda quieto y con un check.
function SLDoc({ scanning, listo, esResumen }) {
  const Icon = window.Icon;
  const w = listo ? 92 : 152;
  const h = listo ? 116 : 190;
  return (
    <div style={{ position: 'relative', width: w, height: h, transition: 'width .5s cubic-bezier(.4,0,.2,1), height .5s cubic-bezier(.4,0,.2,1)' }}>
      {scanning && <span style={{ position: 'absolute', inset: '50% auto auto 50%', width: w, height: w, marginLeft: -w / 2, marginTop: -w / 2, borderRadius: '50%', border: '1.5px solid var(--color-accent)', animation: 'gfRing 2.4s ease-out infinite' }} />}
      {scanning && <span style={{ position: 'absolute', inset: '50% auto auto 50%', width: w, height: w, marginLeft: -w / 2, marginTop: -w / 2, borderRadius: '50%', border: '1.5px solid var(--color-accent)', animation: 'gfRing 2.4s ease-out infinite 1.2s' }} />}
      <div style={{
        position: 'relative', width: w, height: h, borderRadius: 13, background: '#fff', overflow: 'hidden',
        boxShadow: '0 20px 52px rgba(0,0,0,.5)', padding: '11px 11px', display: 'flex', flexDirection: 'column', gap: 6,
        animation: scanning ? 'gfFloat 3.4s ease-in-out infinite' : 'none', transition: 'all .5s',
      }}>
        {/* cabecera: marca + título */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--gf-emerald-50)', color: 'var(--color-accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name={esResumen ? 'credit-card' : 'receipt'} size={13} />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
            <span style={{ height: 4, width: '70%', borderRadius: 3, background: 'var(--gf-gray-300)' }} />
            <span style={{ height: 3.5, width: '45%', borderRadius: 3, background: 'var(--gf-gray-100)' }} />
          </span>
        </div>
        <span style={{ height: 1, background: 'var(--gf-gray-100)', margin: '1px 0' }} />
        {/* líneas de detalle */}
        {[88, 66, 78].map((wd, i) => (
          <span key={i} style={{ height: 4, width: wd + '%', borderRadius: 3, background: 'var(--gf-gray-100)' }} />
        ))}
        {/* fila de total resaltada */}
        <span style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <span style={{ height: 5, width: '34%', borderRadius: 3, background: 'var(--gf-gray-200)' }} />
          <span style={{ height: 9, width: '42%', borderRadius: 3, background: 'var(--gf-emerald-50)', border: '1px solid var(--gf-emerald-100)' }} />
        </span>
        {/* barrido de escaneo */}
        {scanning && <span style={{ position: 'absolute', left: 0, right: 0, height: 26, background: 'linear-gradient(180deg, transparent, rgba(12,143,98,.32) 50%, transparent)', borderTop: '1.5px solid var(--color-accent)', animation: 'gfScan 1.5s ease-in-out infinite' }} />}
      </div>
      {/* check al terminar */}
      {listo && (
        <span style={{ position: 'absolute', right: -7, bottom: -7, width: 30, height: 30, borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 16px rgba(0,0,0,.4)', animation: 'gfRiseIn .4s ease both' }} className="gf-badge-pop">
          <Icon name="check" size={17} />
        </span>
      )}
    </div>
  );
}

// Indicador compacto icon-forward (pre-clasificado ámbar · gasto esperado verde).
function SLInd({ icon, label, tone }) {
  const Icon = window.Icon;
  const T = tone === 'amber'
    ? { tint: 'rgba(217,119,6,.15)', line: 'rgba(245,158,11,.55)', iconBg: 'rgba(245,158,11,.9)', iconTx: '#1a1205' }
    : tone === 'green'
      ? { tint: 'rgba(12,143,98,.18)', line: 'var(--gf-emerald-line)', iconBg: 'var(--color-accent)', iconTx: '#fff' }
      : { tint: 'rgba(255,255,255,.08)', line: 'rgba(255,255,255,.14)', iconBg: 'rgba(255,255,255,.14)', iconTx: 'var(--gf-emerald-100)' };
  return (
    <span className="gf-badge-pop" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px 7px 8px', borderRadius: 999, background: T.tint, border: `1px solid ${T.line}` }}>
      <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: T.iconBg, color: T.iconTx }}>
        <Icon name={icon} size={15} />
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>{label}</span>
    </span>
  );
}

function ShareLanding({ tipo = 'factura', onReady, onClose }) {
  const Icon = window.Icon;
  const esResumen = tipo === 'resumen';
  const data = esResumen ? SL_RESUMEN : SL_FACTURA;

  // Máquina de fases: 0 recibido · 1 leyendo · 2 clasificado · 3 extrayendo · 4 listo.
  // La extracción (fase 3) es la más larga: es lo que de verdad tarda.
  const [fase, setFase] = React.useState(0);
  React.useEffect(() => {
    const durs = [500, 650, 700, 1700, 700];
    if (fase >= 5) { onReady && onReady(); return; }
    const t = setTimeout(() => setFase((f) => f + 1), durs[fase]);
    return () => clearTimeout(t);
  }, [fase]);

  const clasificado = fase >= 2;
  const extrayendo = fase >= 3;
  const listo = fase >= 4;

  // Monto count-up (arranca al quedar listo)
  const [val, setVal] = React.useState(0);
  React.useEffect(() => {
    if (!listo) return;
    const objetivo = esResumen ? data.total : data.monto;
    let raf, start;
    const dur = 900;
    const tick = (t) => {
      if (start == null) start = t;
      const k = Math.min(1, (t - start) / dur);
      setVal(objetivo * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [listo]);

  const fmt = (n) => '$ ' + Math.round(n).toLocaleString('es-AR');
  const skel = (w, h) => ({ height: h, width: w, borderRadius: 8, background: 'rgba(255,255,255,.14)', animation: 'gfShimmer 1.3s ease-in-out infinite' });

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 60, background: 'var(--gf-ink)',
      display: 'flex', flexDirection: 'column', color: '#fff',
      backgroundImage: 'radial-gradient(120% 78% at 50% 0%, var(--gf-ink-soft) 0%, var(--gf-ink) 58%)',
    }}>
      {/* Header */}
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 6px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--color-accent)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>GF</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Gastos Familiares</span>
        </span>
        <button onClick={onClose} aria-label="Cancelar" style={{ background: 'rgba(255,255,255,.1)', border: 'none', color: '#fff', borderRadius: 999, width: 32, height: 32, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="x" size={16} />
        </button>
      </div>

      {/* Main — todo centrado; llena la espera con documento + esqueleto */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: !listo ? 'space-between' : 'center', gap: !listo ? 0 : 16, padding: '26px 26px 30px' }}>
        {/* chip de tipo */}
        <span style={{ height: 24, display: 'flex', alignItems: 'center' }}>
          {clasificado ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(12,143,98,.2)', border: '1px solid var(--gf-emerald-line)', color: 'var(--gf-emerald-100)', borderRadius: 999, padding: '5px 13px', fontSize: 11.5, fontWeight: 800, letterSpacing: '.5px', textTransform: 'uppercase', animation: 'gfRiseIn .4s ease both' }}>
              <Icon name={esResumen ? 'credit-card' : 'receipt'} size={13} />
              {esResumen ? 'Resumen de tarjeta' : 'Comprobante'}
            </span>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--gf-emerald-100)' }}>Compartido a Gastos</span>
          )}
        </span>

        {/* RAMA FACTURA */}
        {!esResumen && !listo && (
          /* ESPERA — scanner: chip arriba · {documento + caption} centro · pre-clasificado abajo */
          <React.Fragment>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
              <SLDoc scanning={true} listo={false} esResumen={false} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 16.5, fontWeight: 700, color: '#fff' }}>Leyendo tu comprobante</div>
                <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 5 }}>Extraemos importe, comercio y fecha…</div>
              </div>
            </div>
            <div style={{ minHeight: 42, display: 'flex', alignItems: 'center' }}>
              {clasificado && <SLInd icon="sparkles" label={`Pre-clasificado · ${data.categoria}`} tone="amber" />}
            </div>
          </React.Fragment>
        )}

        {!esResumen && listo && (
          /* LISTO — resultado */
          <React.Fragment>
            <SLDoc scanning={false} listo={true} esResumen={false} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 7 }}>Comprobante detectado</div>
              <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-1.5px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{fmt(val)}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#e5e7eb', marginTop: 6 }}>{data.comercio}</div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <SLInd icon="sparkles" label="Pre-clasificado" tone="amber" />
              <SLInd icon={data.match ? 'git-compare' : 'plus'} label={data.match ? 'Gasto esperado' : 'Movimiento nuevo'} tone={data.match ? 'green' : 'neutral'} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {[data.categoria, `Vence ${data.fecha.slice(0, 5)}`, data.moneda].map((c, i) => (
                <span key={i} style={{ fontSize: 12.5, fontWeight: 600, color: '#e5e7eb', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 9, padding: '7px 12px' }}>{c}</span>
              ))}
            </div>
            {data.match && (
              <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: -6 }}>Coincide con <span style={{ color: 'var(--gf-emerald-100)', fontWeight: 600 }}>{data.match.nombre} · {data.match.periodo}</span></div>
            )}
          </React.Fragment>
        )}

        {/* RAMA RESUMEN */}
        {esResumen && !listo && (
          /* ESPERA — {documento + caption} centro · chips de consumos abajo (llena la pantalla) */
          <React.Fragment>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
              <SLDoc scanning={true} listo={false} esResumen={true} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 16.5, fontWeight: 700, color: '#fff' }}>Leyendo tu resumen</div>
                <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 5 }}>Detectamos consumos, cuotas y vencimiento…</div>
              </div>
            </div>
            <div style={{ minHeight: 42, display: 'flex', gap: 9, justifyContent: 'center', opacity: clasificado ? 1 : 0, transition: 'opacity .4s' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.08)', borderRadius: 9, padding: '7px 12px', fontSize: 12.5, fontWeight: 600 }}>
                <Icon name="list" size={14} color="var(--gf-emerald-100)" />{data.consumos} consumos
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.08)', borderRadius: 9, padding: '7px 12px', fontSize: 12.5, fontWeight: 600 }}>
                <Icon name="layers" size={14} color="var(--gf-emerald-100)" />{data.enCuotas} en cuotas
              </span>
            </div>
          </React.Fragment>
        )}

        {esResumen && listo && (
          /* LISTO — total + chips + split */
          <React.Fragment>
            <SLDoc scanning={false} listo={true} esResumen={true} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 7 }}>Total del resumen</div>
              <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-1.5px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{fmt(val)}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#e5e7eb', marginTop: 6 }}>{data.banco}</div>
            </div>
            <div style={{ display: 'flex', gap: 9, justifyContent: 'center' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.08)', borderRadius: 9, padding: '7px 12px', fontSize: 12.5, fontWeight: 600 }}>
                <Icon name="list" size={14} color="var(--gf-emerald-100)" />{data.consumos} consumos
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.08)', borderRadius: 9, padding: '7px 12px', fontSize: 12.5, fontWeight: 600 }}>
                <Icon name="layers" size={14} color="var(--gf-emerald-100)" />{data.enCuotas} en cuotas
              </span>
            </div>
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 1 }}>Se divide en</div>
              {[{ icon: 'calendar-check', label: 'A pagar este mes', val: data.esteMes, hi: true }, { icon: 'clock', label: 'Deuda futura (cuotas)', val: data.deudaFutura }].map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, borderRadius: 13, padding: '12px 15px', background: r.hi ? 'rgba(12,143,98,.16)' : 'rgba(255,255,255,.06)', border: r.hi ? '1px solid var(--gf-emerald-line)' : '1px solid transparent' }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: r.hi ? 'var(--color-accent)' : 'rgba(255,255,255,.1)', color: r.hi ? '#fff' : 'var(--gf-emerald-100)' }}>
                    <Icon name={r.icon} size={15} />
                  </span>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: r.hi ? 700 : 500, color: '#fff' }}>{r.label}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.val)}</span>
                </div>
              ))}
            </div>
          </React.Fragment>
        )}
      </div>

      {/* Pie — progreso + fase */}
      <div style={{ flexShrink: 0, padding: '0 26px 24px' }}>
        <div style={{ height: 4, borderRadius: 999, background: 'rgba(255,255,255,.1)', overflow: 'hidden', marginBottom: 11 }}>
          <div style={{ height: '100%', width: ((fase / 5) * 100) + '%', background: 'var(--color-accent)', borderRadius: 999, transition: 'width .5s ease' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, fontSize: 13, color: '#9ca3af' }}>
          {!listo && <span style={{ width: 13, height: 13, border: '2px solid rgba(255,255,255,.25)', borderTopColor: 'var(--gf-emerald-100)', borderRadius: '50%', animation: 'gfSpin .7s linear infinite' }} />}
          {fase === 0 && 'Recibiendo archivo…'}
          {fase === 1 && 'Leyendo el documento…'}
          {fase === 2 && 'Clasificando…'}
          {fase === 3 && 'Extrayendo datos…'}
          {listo && (esResumen ? 'Listo — revisá y conciliá el resumen' : 'Listo — abriendo para confirmar')}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ShareLanding });
