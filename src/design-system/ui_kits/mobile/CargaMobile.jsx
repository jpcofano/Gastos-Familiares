// CargaMobile — dropzone + recent incoming files (comprobantes / resúmenes).
const { Message: CMsg, Button: CBtn, Badge: CBadge } =
  window.GastosFamiliaresDesignSystem_d81a5e;

const C_KIND = { ok: 'check-check', wait: 'loader', warn: 'triangle-alert', err: 'circle-x' };
const C_KIND_COLOR = { ok: 'var(--gf-ok-text)', wait: 'var(--gf-wait-text)', warn: 'var(--gf-warn-text)', err: 'var(--gf-err-text)' };

function CargaMobile({ onAbrir }) {
  const Icon = window.Icon;
  const items = window.M_ENTRANTES;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Dropzone */}
      <button onClick={onAbrir} style={{
        border: '2px dashed var(--gf-gray-300)', borderRadius: 'var(--radius-2xl)', background: '#fff',
        padding: '30px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        cursor: 'pointer', fontFamily: 'var(--font-base)',
      }}>
        <span style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--gf-emerald-50)', color: 'var(--color-accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="file-up" size={24} />
        </span>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>Subir comprobante o resumen</span>
        <span style={{ fontSize: 13, color: 'var(--color-text-sec)', textAlign: 'center' }}>PDF o foto. Extraemos monto, comercio y fecha automáticamente.</span>
        <span style={{ marginTop: 4, display: 'inline-flex', gap: 8 }}>
          <CBadge tone="neutral">PDF</CBadge><CBadge tone="neutral">JPG</CBadge><CBadge tone="neutral">Compartir ↗</CBadge>
        </span>
      </button>

      <CMsg kind="wait" title="1 procesando.">Edenor_factura_06.pdf — extrayendo datos.</CMsg>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Entrantes recientes</div>
        <div style={{ background: '#fff', border: '1px solid var(--color-border-card)', borderRadius: 12, overflow: 'hidden' }}>
          {items.map((it, idx) => (
            <button key={it.id} onClick={onAbrir} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
              borderBottom: idx < items.length - 1 ? '1px solid var(--gf-gray-100)' : 'none',
              background: 'none', border: 'none', borderBottomStyle: idx < items.length - 1 ? 'solid' : 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-base)',
            }}>
              <span style={{ color: C_KIND_COLOR[it.estado], flexShrink: 0, display: 'inline-flex' }}>
                <Icon name={C_KIND[it.estado]} size={20} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.nombre}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-sec)' }}>{it.tipo} · {it.detalle}</span>
              </span>
              <Icon name="chevron-right" size={18} color="var(--gf-gray-300)" />
            </button>
          ))}
        </div>
      </div>

      <CBtn variant="secondary" size="cta" onClick={onAbrir}>Cargar manualmente</CBtn>
      <div style={{ height: 4 }} />
    </div>
  );
}

Object.assign(window, { CargaMobile });
