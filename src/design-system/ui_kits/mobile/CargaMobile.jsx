// CargaMobile — dropzone + dos historiales apilados:
//   · Comprobantes y facturas   · Resúmenes de tarjeta
// Cada sección muestra 4 y expande con "Ver todo". Vacío → estado propio.
const { Message: CMsg, Button: CBtn, Badge: CBadge } =
  window.GastosFamiliaresDesignSystem_d81a5e;

const C_KIND = { ok: 'check-check', wait: 'loader', warn: 'triangle-alert', err: 'circle-x' };
const C_KIND_COLOR = { ok: 'var(--gf-ok-text)', wait: 'var(--gf-wait-text)', warn: 'var(--gf-warn-text)', err: 'var(--gf-err-text)' };

function FileRow({ it, last, onAbrir }) {
  const Icon = window.Icon;
  return (
    <button onClick={onAbrir} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
      borderBottom: last ? 'none' : '1px solid var(--gf-gray-100)', background: 'none', border: 'none',
      borderBottomStyle: last ? 'none' : 'solid', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-base)',
    }}>
      <span style={{ color: C_KIND_COLOR[it.estado], flexShrink: 0, display: 'inline-flex' }}>
        <Icon name={C_KIND[it.estado]} size={20} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.nombre}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-sec)' }}>{it.detalle}</span>
      </span>
      {it.fecha && <span style={{ fontSize: 11, color: 'var(--gf-gray-400)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{it.fecha}</span>}
      <Icon name="chevron-right" size={18} color="var(--gf-gray-300)" />
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
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-card)', borderRadius: 12, overflow: 'hidden' }}>
          {visibles.map((it, idx) => (
            <FileRow key={it.id} it={it} last={idx === visibles.length - 1 && total <= 4} onAbrir={onAbrir} />
          ))}
          {total > 4 && (
            <button onClick={() => setVerTodo((v) => !v)} style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '10px 14px', borderTop: '1px solid var(--gf-gray-100)', background: 'var(--gf-gray-50, transparent)',
              border: 'none', borderTopStyle: 'solid', cursor: 'pointer', fontFamily: 'var(--font-base)',
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
  const resumenes = window.M_RESUMENES_IN || [];
  const procesando = [...comprobantes, ...resumenes].filter((x) => x.estado === 'wait').length;

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

      {procesando > 0 && (
        <CMsg kind="wait" title={`${procesando} procesando.`}>Extrayendo datos del archivo subido.</CMsg>
      )}

      <HistorialSeccion
        icon="receipt" titulo="Comprobantes y facturas" items={comprobantes}
        emptyText="Sin comprobantes este mes. Subí una factura o ticket para empezar."
        onAbrir={onAbrir}
      />

      <HistorialSeccion
        icon="credit-card" titulo="Resúmenes de tarjeta" items={resumenes}
        emptyText="Sin resúmenes cargados. Subí el PDF del resumen de tu tarjeta."
        onAbrir={onAbrir}
      />

      <CBtn variant="secondary" size="cta" onClick={onAbrir}>Cargar manualmente</CBtn>
      <div style={{ height: 4 }} />
    </div>
  );
}

Object.assign(window, { CargaMobile });
