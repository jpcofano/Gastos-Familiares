// ShareLanding — pantalla in-app de recepción cuando se comparte un archivo a la PWA
// (Web Share Target). El SO arranca la app en frío (splash NATIVO = manifest
// background_color + ícono, no customizable), redirige a /comprobantes?share=1 y ESTA
// pantalla cubre el arranque: lee el archivo de IndexedDB, lo clasifica y lo procesa.
//
// El SO comparte SIEMPRE a un único destino (/share-target): no se puede pre-rutear por
// contenido. Por eso es UN solo landing que DETECTA el tipo y se bifurca:
//   · factura/comprobante → monto protagonista + datos detectados + badge de destino
//                           (Gasto esperado · match | Movimiento nuevo)
//   · resumen de tarjeta  → cuerpo propio: total + N consumos + cuotas + split
//                           este-mes / deuda-futura (decisión F9.21)
//
// Props: { tipo?: 'factura'|'resumen' (forzar; default 'factura'), onReady, onClose }
// Fases reales (las maneja F9.50 con el progreso async): recibido → leyendo →
// clasificado(badge) → extrayendo → listo → onReady().

const SL_FACTURA = {
  nombre: 'Edenor-factura-junio.pdf', peso: '248 KB',
  monto: 38900, comercio: 'EDENOR S.A.', fecha: '28/06/2026',
  match: { nombre: 'Edenor — luz', periodo: 'Junio' }, // null = movimiento nuevo
};
const SL_RESUMEN = {
  nombre: 'Visa-resumen-junio.pdf', peso: '512 KB',
  banco: 'Visa Galicia', total: 247350, consumos: 14, enCuotas: 3,
  esteMes: 158200, deudaFutura: 89150,
};

function ShareLanding({ tipo = 'factura', onReady, onClose }) {
  const Icon = window.Icon;
  const esResumen = tipo === 'resumen';
  const data = esResumen ? SL_RESUMEN : SL_FACTURA;

  // Máquina de fases: 0 recibido · 1 leyendo · 2 clasificado · 3 extrayendo · 4 listo
  const [fase, setFase] = React.useState(0);
  React.useEffect(() => {
    const durs = [650, 1000, 850, 1150, 600];
    if (fase >= 5) { onReady && onReady(); return; }
    const t = setTimeout(() => setFase((f) => f + 1), durs[fase]);
    return () => clearTimeout(t);
  }, [fase]);

  const clasificado = fase >= 2;
  const extrayendo = fase >= 3;
  const listo = fase >= 4;

  // Monto en vivo (count-up) para la rama factura
  const [val, setVal] = React.useState(0);
  React.useEffect(() => {
    if (!extrayendo) return;
    const objetivo = esResumen ? data.total : data.monto;
    let raf, start;
    const dur = 800;
    const tick = (t) => {
      if (start == null) start = t;
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      setVal(objetivo * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [extrayendo]);

  const fmt = (n) => '$' + Math.round(n).toLocaleString('es-AR');

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 60, background: 'var(--gf-ink)',
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
          <span style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.nombre}</span>
          <span style={{ fontSize: 11.5, color: '#9ca3af', flexShrink: 0 }}>· {data.peso}</span>
        </div>
      </div>

      {/* Cuerpo: monto protagonista (siempre) + rama */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', padding: '14px 26px 4px' }}>
        <div style={{ textAlign: 'center', opacity: extrayendo ? 1 : 0.35, transition: 'opacity .4s' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 4 }}>
            {esResumen ? 'Total del resumen' : 'Importe detectado'}
          </div>
          <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: '-1.5px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{fmt(val)}</div>
        </div>

        {/* RAMA FACTURA: campos detectados + badge de destino */}
        {!esResumen && (
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[{ icon: 'store', label: 'Comercio', val: data.comercio }, { icon: 'calendar', label: 'Vence', val: data.fecha }].map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'rgba(255,255,255,.06)', borderRadius: 13, padding: '11px 14px', opacity: extrayendo ? 1 : 0, transform: extrayendo ? 'none' : 'translateY(8px)', transition: `all .4s ${i * 0.08}s` }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(12,143,98,.18)', color: 'var(--gf-emerald-100)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name={f.icon} size={15} />
                </span>
                <span style={{ flex: 1, fontSize: 12, color: '#9ca3af' }}>{f.label}</span>
                <span style={{ fontSize: 14.5, fontWeight: 700, color: '#fff' }}>{f.val}</span>
              </div>
            ))}
            {/* Badge de destino */}
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px', borderRadius: 14, background: data.match ? 'rgba(12,143,98,.16)' : 'rgba(255,255,255,.06)', border: data.match ? '1px solid var(--gf-emerald-line)' : '1px solid transparent', opacity: listo ? 1 : 0, transform: listo ? 'none' : 'translateY(8px)', transition: 'all .45s' }}>
              <span style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: data.match ? 'var(--color-accent)' : 'rgba(255,255,255,.1)', color: data.match ? '#fff' : 'var(--gf-emerald-100)' }}>
                <Icon name={data.match ? 'git-compare' : 'plus'} size={16} />
              </span>
              <span style={{ flex: 1, lineHeight: 1.3 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: '#fff' }}>{data.match ? 'Gasto esperado' : 'Movimiento nuevo'}</span>
                <span style={{ display: 'block', fontSize: 12, color: '#9ca3af' }}>{data.match ? `Coincide con ${data.match.nombre} · ${data.match.periodo}` : 'Se agrega como gasto del mes'}</span>
              </span>
            </div>
          </div>
        )}

        {/* RAMA RESUMEN DE TARJETA: cuerpo propio */}
        {esResumen && (
          <div style={{ marginTop: 16, opacity: extrayendo ? 1 : 0, transform: extrayendo ? 'none' : 'translateY(8px)', transition: 'all .45s' }}>
            <div style={{ display: 'flex', gap: 9, justifyContent: 'center', marginBottom: 14 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.08)', borderRadius: 9, padding: '7px 12px', fontSize: 12.5, fontWeight: 600 }}>
                <Icon name="list" size={14} color="var(--gf-emerald-100)" />{data.consumos} consumos
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.08)', borderRadius: 9, padding: '7px 12px', fontSize: 12.5, fontWeight: 600 }}>
                <Icon name="layers" size={14} color="var(--gf-emerald-100)" />{data.enCuotas} en cuotas
              </span>
            </div>
            {/* split este-mes / deuda-futura */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: listo ? 1 : 0, transition: 'opacity .4s' }}>
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
          </div>
        )}
      </div>

      {/* Pie */}
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
