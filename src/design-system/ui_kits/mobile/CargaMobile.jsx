// CargaMobile — dropzone + dos historiales apilados:
//   · Comprobantes y facturas   · Resúmenes de tarjeta
// Cada sección muestra 4 y expande con "Ver todo". Vacío → estado propio.
const { Message: CMsg, Button: CBtn, Badge: CBadge } =
  window.GastosFamiliaresDesignSystem_d81a5e;

const C_KIND = { ok: 'check-check', wait: 'loader', warn: 'triangle-alert', err: 'circle-x' };
const C_KIND_COLOR = { ok: 'var(--gf-ok-text)', wait: 'var(--gf-wait-text)', warn: 'var(--gf-warn-text)', err: 'var(--gf-err-text)' };

// Métricas de un resumen (mismas que el visor de Tarjetas — los números cierran).
function cMetrics(consumos) {
  let esteMes = 0, deudaFutura = 0, enCuotas = 0;
  for (const c of (consumos || [])) {
    esteMes += c.monto;
    if (c.cuotaTotal > 1) { enCuotas += 1; deudaFutura += c.monto * (c.cuotaTotal - c.cuotaActual); }
  }
  return { esteMes, deudaFutura, enCuotas, total: (consumos || []).length };
}

// Fila colapsada de resumen de tarjeta: compacta por defecto, expande inline a la
// cara completa + split. Mantiene la estética de tarjeta pero sin ocupar toda la
// pantalla por cada resumen. Tap en la fila → abre/cierra.
function ResumenColapsado({ c, onAbrir }) {
  const Icon = window.Icon;
  const M = window.GFMoney;
  const TSB = window.GastosFamiliaresDesignSystem_d81a5e.StatusBadge;
  const [open, setOpen] = React.useState(false);
  const m = cMetrics(c.consumos);
  return (
    <div style={{ borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-card)', background: 'var(--color-surface)' }}>
      {/* Cabecera compacta — swatch tintado a la izquierda */}
      <button onClick={() => setOpen((v) => !v)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', background: 'none', border: 'none',
        cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-base)',
      }}>
        <span style={{ width: 34, height: 24, borderRadius: 5, flexShrink: 0, background: `linear-gradient(135deg, ${c.tint} 0%, var(--gf-ink) 100%)`, display: 'inline-flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 3 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,.45)' }} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.banco} · {c.red}</span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-text-sec)', fontVariantNumeric: 'tabular-nums' }}>•••• {c.term} · vence {c.vence}</span>
        </span>
        <span style={{ textAlign: 'right', flexShrink: 0 }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text)' }}>{M.ars(m.esteMes)}</span>
          <span style={{ display: 'block', fontSize: 10, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.3px' }}>este mes</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <TSB state={c.estado} />
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={17} color="var(--gf-gray-300)" />
        </span>
      </button>

      {/* Cuerpo expandido — cara completa + split + acceso al detalle */}
      {open && (
        <div style={{ borderTop: '1px solid var(--color-border-card)', animation: 'gfRiseIn .22s ease both' }}>
          <div style={{ background: `linear-gradient(135deg, ${c.tint} 0%, var(--gf-ink) 100%)`, padding: '11px 14px', color: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{c.banco} · <span style={{ fontWeight: 600, color: 'rgba(255,255,255,.85)' }}>{c.red}</span></span>
              <span style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,.85)' }}>•••• {c.term}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'rgba(255,255,255,.8)' }}>
              <span>Cierre {c.cierre}</span><span>Vence {c.vence}</span>
            </div>
          </div>
          <div style={{ display: 'flex' }}>
            <div style={{ flex: 1, padding: '9px 14px' }}>
              <div style={{ fontSize: 9.5, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px' }}>Este mes</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{M.ars(m.esteMes)}</div>
            </div>
            <div style={{ width: 1, background: 'var(--color-border-card)' }} />
            <div style={{ flex: 1, padding: '9px 14px' }}>
              <div style={{ fontSize: 9.5, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px' }}>Deuda futura</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: m.deudaFutura > 0 ? 'var(--gf-out)' : 'var(--color-text-sec)', fontVariantNumeric: 'tabular-nums' }}>{m.deudaFutura > 0 ? M.ars(m.deudaFutura) : '—'}</div>
            </div>
          </div>
          <button onClick={() => onAbrir && onAbrir(c)} style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px',
            borderTop: '1px solid var(--color-border-card)', background: 'transparent', border: 'none', borderTopStyle: 'solid',
            cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 12, fontWeight: 600, color: 'var(--color-accent)',
          }}>
            Ver {m.total} consumos <Icon name="chevron-right" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// Sección de resúmenes de tarjeta: filas colapsadas, 4 visibles + "Ver todo".
function ResumenesSeccion({ items, onAbrir }) {
  const Icon = window.Icon;
  const [verTodo, setVerTodo] = React.useState(false);
  const total = items.length;
  const visibles = verTodo ? items : items.slice(0, 4);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8, padding: '0 2px' }}>
        <Icon name="credit-card" size={13} color="var(--gf-gray-400)" /> Resúmenes de tarjeta
        {total > 0 && <span style={{ marginLeft: 'auto', color: 'var(--gf-gray-300)', fontWeight: 600 }}>{total}</span>}
      </div>
      {total === 0 ? (
        <div style={{ background: 'var(--color-surface)', border: '1px dashed var(--gf-gray-200)', borderRadius: 12, padding: '18px 14px', textAlign: 'center', fontSize: 13, color: 'var(--color-text-sec)' }}>
          Sin resúmenes cargados. Subí el PDF del resumen de tu tarjeta.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visibles.map((c) => <ResumenColapsado key={c.id} c={c} onAbrir={onAbrir} />)}
          {total > 4 && (
            <button onClick={() => setVerTodo((v) => !v)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px',
              background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)',
              fontSize: 12.5, fontWeight: 600, color: 'var(--color-accent)',
            }}>
              {verTodo ? 'Ver menos' : `Ver todo (${total})`}
              <Icon name={verTodo ? 'chevron-up' : 'chevron-down'} size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Estado de vínculo del comprobante (chip arriba a la izquierda, como el vivo).
const C_VINCULO = {
  vinculado: { label: 'Vinculado', bg: 'var(--st-pagado-badge-bg)', tx: 'var(--st-pagado-badge-tx)' },
  nuevo: { label: 'Nuevo', bg: 'var(--st-por-confirmar-badge-bg)', tx: 'var(--st-por-confirmar-badge-tx)' },
  proceso: { label: 'Procesando', bg: 'var(--st-pendiente-badge-bg)', tx: 'var(--st-pendiente-badge-tx)' },
  revisar: { label: 'Revisar', bg: 'var(--st-parcial-badge-bg)', tx: 'var(--st-parcial-badge-tx)' },
};
const cFmtMonto = (n) => '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

// Card de comprobante — refleja el historial vivo (F9.60–64): chip de vínculo +
// título = payee (F9.64) + fila tipo · medio · monto · fecha + info de vencimientos +
// badge de match. Toda la card es tappable (abre el detalle).
function FileRow({ it, onAbrir }) {
  const Icon = window.Icon;
  const v = C_VINCULO[it.vinculo] || C_VINCULO.proceso;
  const enProceso = it.vinculo === 'proceso';
  const titulo = it.payee || it.nombre;
  return (
    <button onClick={onAbrir} style={{
      width: '100%', display: 'block', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-base)',
      background: 'var(--color-surface)', border: '1px solid var(--color-border-card)', borderRadius: 16, padding: '13px 15px',
    }}>
      {/* Fila 1: chip vínculo · título (payee) · tamaño · borrar */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: v.tx, background: v.bg, borderRadius: 6, padding: '3px 7px' }}>{v.label}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 700, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titulo}</span>
        {it.kb != null && <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--gf-gray-400)' }}>{it.kb} KB</span>}
        <span onClick={(e) => { e.stopPropagation(); }} role="button" aria-label="Quitar" style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 999, background: 'var(--gf-gray-100)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="x" size={13} color="var(--gf-gray-400)" />
        </span>
      </span>

      {/* Fila 2: tipo · payee-plataforma · monto · fecha  (o detalle si está en proceso) */}
      {enProceso ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7, fontSize: 12.5, color: 'var(--color-text-sec)' }}>
          <Icon name="loader" size={13} color="var(--gf-gray-400)" /> {it.detalle}
        </span>
      ) : (
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginTop: 7 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>{it.tipoLabel}</span>
          {it.medio && <span style={{ fontSize: 13, color: 'var(--color-text-sec)' }}>{it.medio}</span>}
          {it.monto != null && <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{cFmtMonto(it.monto)}</span>}
          {it.fechaFull && <span style={{ fontSize: 12.5, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{it.fechaFull}</span>}
        </span>
      )}

      {/* Fila 3 (facturas con vencimientos): 2º vencimiento */}
      {it.vencimientos && (
        <span style={{ display: 'block', marginTop: 5, fontSize: 12, color: 'var(--gf-gray-400)' }}>
          {it.vencimientos.n} vencimientos — 2º venc: {cFmtMonto(it.vencimientos.segVenc)}
        </span>
      )}

      {/* Fila 4: badge de match */}
      {!enProceso && (
        it.match ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 10.5, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--gf-emerald-deep, var(--color-accent))', background: 'var(--gf-emerald-50)', borderRadius: 8, padding: '5px 9px' }}>
            <Icon name="git-compare" size={12} /> Cumplió un gasto esperado
          </span>
        ) : it.vinculo === 'revisar' ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 10.5, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--st-parcial-badge-tx)', background: 'var(--st-parcial-badge-bg)', borderRadius: 8, padding: '5px 9px' }}>
            <Icon name="triangle-alert" size={12} /> {it.detalle}
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 10.5, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 8, padding: '5px 9px' }}>
            <Icon name="plus" size={12} /> Movimiento nuevo
          </span>
        )
      )}
    </button>
  );
}

function HistorialSeccion({ icon, titulo, items, emptyText, onAbrir }) {
  const Icon = window.Icon;
  const [verTodo, setVerTodo] = React.useState(false);
  const total = items.length;
  const visibles = verTodo ? items : items.slice(0, 4);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8, padding: '0 2px' }}>
        <Icon name={icon} size={13} color="var(--gf-gray-400)" />
        {titulo}
        {total > 0 && <span style={{ marginLeft: 'auto', color: 'var(--gf-gray-300)', fontWeight: 600 }}>{total}</span>}
      </div>
      {total === 0 ? (
        <div style={{ background: 'var(--color-surface)', border: '1px dashed var(--gf-gray-200)', borderRadius: 12, padding: '18px 14px', textAlign: 'center', fontSize: 13, color: 'var(--color-text-sec)' }}>
          {emptyText}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visibles.map((it) => (
            <FileRow key={it.id} it={it} onAbrir={onAbrir} />
          ))}
          {total > 4 && (
            <button onClick={() => setVerTodo((v) => !v)} style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '9px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)',
              fontSize: 12.5, fontWeight: 600, color: 'var(--color-accent)',
            }}>
              {verTodo ? 'Ver menos' : `Ver todo (${total})`}
              <Icon name={verTodo ? 'chevron-up' : 'chevron-down'} size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CargaMobile({ onAbrir }) {
  const Icon = window.Icon;
  const comprobantes = window.M_COMPROBANTES || [];
  const procesando = comprobantes.filter((x) => x.vinculo === 'proceso').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Dropzone (común a ambos tipos) */}
      <button onClick={onAbrir} style={{
        border: '2px dashed var(--gf-gray-300)', borderRadius: 'var(--radius-2xl)', background: 'var(--color-surface)',
        padding: '26px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        cursor: 'pointer', fontFamily: 'var(--font-base)',
      }}>
        <span style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--gf-emerald-50)', color: 'var(--color-accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="file-up" size={24} />
        </span>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>Subir comprobante o resumen</span>
        <span style={{ fontSize: 13, color: 'var(--color-text-sec)', textAlign: 'center' }}>PDF o foto. Extraemos monto, comercio y fecha automáticamente.</span>
        <span style={{ marginTop: 4, display: 'inline-flex', gap: 8 }}>
          <CBadge tone="neutral">PDF</CBadge><CBadge tone="neutral">JPG</CBadge>
        </span>
      </button>

      <HistorialSeccion
        icon="receipt" titulo="Comprobantes y facturas" items={comprobantes}
        emptyText="Sin comprobantes este mes. Subí una factura o ticket para empezar."
        onAbrir={onAbrir}
      />

      <ResumenesSeccion items={window.M_RESUMENES_TARJETA || []} onAbrir={onAbrir} />

      <CBtn variant="secondary" size="cta" onClick={onAbrir}>Cargar manualmente</CBtn>
      <div style={{ height: 4 }} />
    </div>
  );
}

Object.assign(window, { CargaMobile });
