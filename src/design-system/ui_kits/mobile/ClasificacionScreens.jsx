// Clasificación y aprendizaje · admin — Diccionario, Destinos, Normalización.
// Reproduce las pantallas vivas de F8.1–8.4 (src/vistas/perfil/{Diccionario,
// Destinos,Normalizacion}.tsx) en el lenguaje del kit: Card/Button del design
// system, bottom-sheet que cubre el Phone (position:absolute inset:0), toggle
// activo, reordenar, preview paso a paso. Datos: M_DICCIONARIO / M_DESTINOS /
// M_REGLAS_NORM (data.jsx). El backend real es callable admin-only.
const { Card: CCard, Button: CBtn } = window.GastosFamiliaresDesignSystem_d81a5e;

const clsInput = {
  fontSize: 14, fontFamily: 'var(--font-base)', border: '1px solid var(--gf-gray-200)',
  borderRadius: 8, padding: '8px 11px', width: '100%', boxSizing: 'border-box',
  background: 'var(--color-surface)', color: 'var(--color-text)',
};
const clsSelect = { ...clsInput, appearance: 'auto' };
const clsMono = { ...clsInput, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 };
const monoChip = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, background: 'var(--gf-gray-100)', borderRadius: 6, padding: '2px 7px', color: 'var(--color-text-strong)' };

function ClsAddBtn({ children, onClick }) {
  const Icon = window.Icon;
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: '14px', borderRadius: 'var(--radius-card)', border: '1.5px dashed var(--gf-gray-300)',
      background: 'transparent', color: 'var(--color-accent)', fontFamily: 'var(--font-base)',
      fontSize: 14, fontWeight: 600, cursor: 'pointer',
    }}>
      <Icon name="plus" size={18} /> {children}
    </button>
  );
}

function Chip({ children, warn }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, borderRadius: 999, padding: '2px 8px',
      background: warn ? 'var(--gf-amber-50, #fef3c7)' : 'var(--gf-gray-100)',
      color: warn ? 'var(--gf-amber-700, #b45309)' : 'var(--color-text-sec)',
    }}>{children}</span>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 11, color: 'var(--color-text-sec)', margin: '4px 0 0' }}>{hint}</p>}
    </div>
  );
}

function Segmented({ options, value, onPick, mono }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} onClick={() => onPick(o.value)} style={{
            flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontFamily: mono ? 'ui-monospace, monospace' : 'var(--font-base)', fontSize: mono ? 12 : 13, fontWeight: 600,
            background: on ? 'var(--color-accent)' : 'var(--gf-gray-100)', color: on ? '#fff' : 'var(--color-text)',
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

// Bottom-sheet que cubre todo el Phone (Screen no está posicionado → absolute
// resuelve contra Phone, position:relative). Mismo patrón que AvatarSheet.
function ClsSheet({ title, onClose, children, footer }) {
  const Icon = window.Icon;
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(17,20,24,.45)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--color-surface)', borderRadius: '18px 18px 0 0', padding: '18px 16px 20px',
        display: 'flex', flexDirection: 'column', gap: 13, maxHeight: '86%', fontFamily: 'var(--font-base)',
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 999, background: 'var(--gf-gray-200)', margin: '-4px auto 2px', flexShrink: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-sec)', display: 'inline-flex' }}><Icon name="x" size={20} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13, overflowY: 'auto' }}>{children}</div>
        <div style={{ display: 'flex', gap: 10, flexShrink: 0, paddingTop: 2 }}>{footer}</div>
      </div>
    </div>
  );
}

function RowActions({ activo, onToggle, onEdit, onDelete }) {
  const Icon = window.Icon;
  return (
    <React.Fragment>
      {onToggle && (
        <button onClick={onToggle} title={activo ? 'Desactivar' : 'Activar'} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: activo ? 'var(--color-accent)' : 'var(--gf-gray-300)', display: 'inline-flex' }}>
          <Icon name={activo ? 'check' : 'circle-x'} size={16} />
        </button>
      )}
      <button onClick={onEdit} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--color-text-sec)', display: 'inline-flex' }}><Icon name="pencil" size={15} /></button>
      <button onClick={onDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--gf-expense)', display: 'inline-flex' }}><Icon name="trash-2" size={15} /></button>
    </React.Fragment>
  );
}

const nombreMiembro = (id) => (window.M_MIEMBROS.find((m) => m.id === id) || {}).nombre || id;

// ── Diccionario ─────────────────────────────────────────────────────────────
const TIPO_MATCH = { contains: 'contiene', exact: 'exacto' };
function DiccionarioMobile() {
  const cats = window.M_CATEGORIAS_CFG;
  const [items, setItems] = React.useState(() => window.M_DICCIONARIO.map((x) => ({ ...x })));
  const [q, setQ] = React.useState('');
  const [sheet, setSheet] = React.useState(null); // {edit?, f}
  const empty = { patron: '', tipoMatch: 'contains', categoria: '', subcategoria: '', etiqueta: '', personaDefault: '', monedaDefault: '' };
  const [f, setF] = React.useState(empty);

  const open = (e) => { setF(e ? { ...empty, ...e, categoria: e.categoria || '', subcategoria: e.subcategoria || '', etiqueta: e.etiqueta || '', personaDefault: e.personaDefault || '', monedaDefault: e.monedaDefault || '' } : empty); setSheet({ edit: e || null }); };
  const close = () => setSheet(null);
  const save = () => {
    const rec = { ...f, subcategoria: f.subcategoria || null, etiqueta: f.etiqueta || null, personaDefault: f.personaDefault || null, monedaDefault: f.monedaDefault || null };
    if (sheet.edit) setItems((p) => p.map((x) => x.id === sheet.edit.id ? { ...x, ...rec } : x));
    else setItems((p) => [...p, { ...rec, id: 'd-' + Date.now(), activo: true, confianza: 0.9 }]);
    close();
  };
  const toggle = (e) => setItems((p) => p.map((x) => x.id === e.id ? { ...x, activo: !x.activo } : x));
  const del = (e) => { if (confirm(`¿Eliminar la regla "${e.patron}"?`)) setItems((p) => p.filter((x) => x.id !== e.id)); };

  const ql = q.toLowerCase();
  const vis = items.filter((e) => !ql || (e.patron || '').toLowerCase().includes(ql) || (e.categoria || '').toLowerCase().includes(ql))
    .sort((a, b) => (a.patron || '').localeCompare(b.patron || '', 'es-AR', { sensitivity: 'base' }));
  const subOpts = (cats.find((c) => c.nombre === f.categoria) || {}).subcats || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por patrón o categoría…" style={clsInput} />
      <CCard padding="0">
        {vis.length === 0
          ? <p style={{ fontSize: 13, color: 'var(--color-text-sec)', padding: '12px 12px', margin: 0 }}>{q ? 'Sin resultados.' : 'Sin entradas en el diccionario.'}</p>
          : vis.map((e, i) => (
          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 12px', borderBottom: i < vis.length - 1 ? '1px solid var(--gf-gray-100)' : 'none', opacity: e.activo ? 1 : 0.55 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.patron || '—'}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>{e.categoria}{e.subcategoria ? ` › ${e.subcategoria}` : ''}</div>
              <div style={{ display: 'flex', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                <Chip>{TIPO_MATCH[e.tipoMatch] || e.tipoMatch}</Chip>
                {e.confianza != null && <Chip>{Math.round(e.confianza * 100)}%</Chip>}
                {e.personaDefault && <Chip>{nombreMiembro(e.personaDefault)}</Chip>}
                {e.monedaDefault && <Chip>{e.monedaDefault}</Chip>}
              </div>
            </div>
            <RowActions activo={e.activo} onToggle={() => toggle(e)} onEdit={() => open(e)} onDelete={() => del(e)} />
          </div>
        ))}
      </CCard>
      <ClsAddBtn onClick={() => open(null)}>Agregar regla</ClsAddBtn>
      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Los cambios impactan el prellenado de sugerencias tras recargar la app (el diccionario se carga al iniciar).
      </p>

      {sheet && (
        <ClsSheet title={sheet.edit ? 'Editar regla' : 'Nueva regla'} onClose={close}
          footer={<React.Fragment>
            <CBtn variant="secondary" size="cta" onClick={close}>Cancelar</CBtn>
            <CBtn variant="primary" size="cta" disabled={!f.patron.trim() || !f.categoria} onClick={save}>Guardar</CBtn>
          </React.Fragment>}>
          <Field label="Patrón *"><input value={f.patron} onChange={(e) => setF({ ...f, patron: e.target.value })} placeholder="ej: edenor" style={clsInput} autoFocus /></Field>
          <Field label="Tipo de match"><Segmented value={f.tipoMatch} onPick={(v) => setF({ ...f, tipoMatch: v })} options={[{ value: 'contains', label: 'contiene' }, { value: 'exact', label: 'exacto' }]} /></Field>
          <Field label="Categoría *">
            <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value, subcategoria: '' })} style={clsSelect}>
              <option value="">— Elegir —</option>
              {cats.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
            </select>
          </Field>
          <Field label="Subcategoría">
            <select value={f.subcategoria} onChange={(e) => setF({ ...f, subcategoria: e.target.value })} style={clsSelect} disabled={!f.categoria}>
              <option value="">— Ninguna —</option>
              {subOpts.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Etiqueta">
            <select value={f.etiqueta} onChange={(e) => setF({ ...f, etiqueta: e.target.value })} style={clsSelect}>
              <option value="">— Ninguna —</option>
              {window.M_ETIQUETAS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Persona por defecto">
            <select value={f.personaDefault} onChange={(e) => setF({ ...f, personaDefault: e.target.value })} style={clsSelect}>
              <option value="">— Ninguna —</option>
              {window.M_MIEMBROS.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>
          </Field>
          <Field label="Moneda por defecto"><Segmented value={f.monedaDefault} onPick={(v) => setF({ ...f, monedaDefault: v })} options={[{ value: '', label: '—' }, { value: 'ARS', label: 'ARS' }, { value: 'USD', label: 'USD' }]} /></Field>
        </ClsSheet>
      )}
    </div>
  );
}

// ── Destinos ────────────────────────────────────────────────────────────────
const TIPO_DEST = { cbu: 'CBU', cuit: 'CUIT', alias: 'alias', nombre: 'nombre' };
function DestinosMobile() {
  const UMBRAL = window.UMBRAL_DESTINO;
  const cats = window.M_CATEGORIAS_CFG;
  const esperados = window.M_ESPERADOS;
  const [items, setItems] = React.useState(() => window.M_DESTINOS.map((x) => ({ ...x })));
  const [q, setQ] = React.useState('');
  const [sheet, setSheet] = React.useState(null);
  const empty = { destinoRaw: '', itemEsperadoId: '', categoria: '', subcategoria: '', etiqueta: '', confianza: '' };
  const [f, setF] = React.useState(empty);

  const open = (d) => { setF(d ? { destinoRaw: '', itemEsperadoId: d.itemEsperadoId || '', categoria: d.categoria || '', subcategoria: d.subcategoria || '', etiqueta: d.etiqueta || '', confianza: String(d.confianza) } : empty); setSheet({ edit: d || null }); };
  const close = () => setSheet(null);
  const save = () => {
    const base = { itemEsperadoId: f.itemEsperadoId || null, categoria: f.categoria || null, subcategoria: f.subcategoria || null, etiqueta: f.etiqueta || null };
    if (!base.itemEsperadoId && !base.categoria) { alert('Se requiere ítem esperado o categoría.'); return; }
    if (sheet.edit) {
      const conf = parseFloat(f.confianza);
      setItems((p) => p.map((x) => x.id === sheet.edit.id ? { ...x, ...base, confianza: isNaN(conf) ? x.confianza : conf } : x));
    } else {
      if (!f.destinoRaw.trim()) { alert('El destino es requerido.'); return; }
      setItems((p) => [...p, { ...base, id: 'de-' + Date.now(), destinoNorm: f.destinoRaw.trim().toUpperCase(), tipo: 'nombre', confianza: 0.9 }]);
    }
    close();
  };
  const del = (d) => { if (confirm(`¿Eliminar el destino "${d.destinoNorm}"?`)) setItems((p) => p.filter((x) => x.id !== d.id)); };

  const nombreItem = (id) => (esperados.find((i) => i.id === id) || {}).label;
  const ql = q.toLowerCase();
  const vis = items.filter((d) => !ql || d.destinoNorm.toLowerCase().includes(ql) || (d.categoria || '').toLowerCase().includes(ql) || (nombreItem(d.itemEsperadoId) || '').toLowerCase().includes(ql))
    .sort((a, b) => a.destinoNorm.localeCompare(b.destinoNorm, 'es-AR', { sensitivity: 'base' }));
  const subOpts = (cats.find((c) => c.nombre === f.categoria) || {}).subcats || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por destino, categoría o ítem…" style={clsInput} />
      <CCard padding="0">
        {vis.length === 0
          ? <p style={{ fontSize: 13, color: 'var(--color-text-sec)', padding: '12px 12px', margin: 0 }}>{q ? 'Sin resultados.' : 'Sin destinos aprendidos.'}</p>
          : vis.map((d, i) => {
            const item = nombreItem(d.itemEsperadoId);
            const bajo = d.confianza < UMBRAL;
            return (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 12px', borderBottom: i < vis.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{d.destinoNorm}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                    {item
                      ? <React.Fragment><window.Icon name="link" size={12} color="var(--color-accent)" /> {item}</React.Fragment>
                      : ([d.categoria, d.subcategoria].filter(Boolean).join(' › ') || '—')}
                  </div>
                  <div style={{ display: 'flex', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                    <Chip>{TIPO_DEST[d.tipo] || d.tipo}</Chip>
                    <Chip warn={bajo}>{Math.round(d.confianza * 100)}%{bajo ? ' ⚠' : ''}</Chip>
                  </div>
                </div>
                <RowActions onEdit={() => open(d)} onDelete={() => del(d)} />
              </div>
            );
          })}
      </CCard>
      <ClsAddBtn onClick={() => open(null)}>Agregar destino</ClsAddBtn>
      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Un destino vinculado a un ítem esperado prefillará ese ítem (rama 2) en el próximo comprobante que matchee ese payee.
        Destinos con confianza &lt; {Math.round(UMBRAL * 100)}% son ignorados por el matcher.
      </p>

      {sheet && (
        <ClsSheet title={sheet.edit ? 'Editar destino' : 'Nuevo destino'} onClose={close}
          footer={<React.Fragment>
            <CBtn variant="secondary" size="cta" onClick={close}>Cancelar</CBtn>
            <CBtn variant="primary" size="cta" onClick={save}>Guardar</CBtn>
          </React.Fragment>}>
          {sheet.edit
            ? <Field label="Destino (inmutable)"><div style={{ fontSize: 14, padding: '8px 11px', background: 'var(--gf-gray-50)', borderRadius: 8, color: 'var(--color-text-sec)', display: 'flex', alignItems: 'center', gap: 8, fontVariantNumeric: 'tabular-nums' }}>{sheet.edit.destinoNorm} <Chip>{TIPO_DEST[sheet.edit.tipo]}</Chip></div></Field>
            : <Field label="Destino *" hint="Se normaliza automáticamente en el servidor."><input value={f.destinoRaw} onChange={(e) => setF({ ...f, destinoRaw: e.target.value })} placeholder="CBU (22 díg), CUIT (11), alias o nombre" style={clsInput} autoFocus /></Field>}
          <Field label="Ítem esperado">
            <select value={f.itemEsperadoId} onChange={(e) => setF({ ...f, itemEsperadoId: e.target.value })} style={clsSelect}>
              <option value="">— sin vínculo —</option>
              {esperados.map((it) => <option key={it.id} value={it.id}>{it.label}</option>)}
            </select>
          </Field>
          <Field label="Categoría">
            <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value, subcategoria: '' })} style={clsSelect}>
              <option value="">— Ninguna —</option>
              {cats.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
            </select>
          </Field>
          <Field label="Subcategoría">
            <select value={f.subcategoria} onChange={(e) => setF({ ...f, subcategoria: e.target.value })} style={clsSelect} disabled={!f.categoria}>
              <option value="">— Ninguna —</option>
              {subOpts.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Etiqueta">
            <select value={f.etiqueta} onChange={(e) => setF({ ...f, etiqueta: e.target.value })} style={clsSelect}>
              <option value="">— Ninguna —</option>
              {window.M_ETIQUETAS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          {sheet.edit && (
            <Field label={`Confianza (0–1) — umbral del matcher: ${UMBRAL}`}>
              <input type="number" min={0} max={1} step={0.05} value={f.confianza} onChange={(e) => setF({ ...f, confianza: e.target.value })} style={{ ...clsInput, width: 110 }} />
            </Field>
          )}
        </ClsSheet>
      )}
    </div>
  );
}

// ── Normalización ───────────────────────────────────────────────────────────
const NORM_TIPOS = ['prefix', 'suffix', 'replace', 'regex'];
const regexInvalido = (p) => { try { new RegExp(p, 'gi'); return false; } catch (e) { return true; } };
function NormalizacionMobile() {
  const [reglas, setReglas] = React.useState(() => [...window.M_REGLAS_NORM.map((x) => ({ ...x }))].sort((a, b) => a.orden - b.orden));
  const [muestra, setMuestra] = React.useState('COMPRA MERCADOPAGO*KIOSCO 12/03');
  const [sheet, setSheet] = React.useState(null);
  const empty = { tipo: 'replace', patron: '', reemplazo: '', activo: true, notas: '' };
  const [f, setF] = React.useState(empty);

  const open = (r) => { setF(r ? { tipo: r.tipo, patron: r.patron, reemplazo: r.reemplazo, activo: r.activo, notas: r.notas || '' } : empty); setSheet({ edit: r || null }); };
  const close = () => setSheet(null);
  const save = () => {
    if (!f.patron.trim()) { alert('El patrón es requerido.'); return; }
    const rec = { tipo: f.tipo, patron: f.patron.trim(), reemplazo: f.reemplazo, activo: f.activo, notas: f.notas.trim() || null };
    if (sheet.edit) setReglas((p) => p.map((x) => x.id === sheet.edit.id ? { ...x, ...rec } : x));
    else setReglas((p) => [...p, { ...rec, id: 'n-' + Date.now(), orden: p.length }]);
    close();
  };
  const toggle = (r) => setReglas((p) => p.map((x) => x.id === r.id ? { ...x, activo: !x.activo } : x));
  const del = (r) => { if (confirm(`¿Eliminar la regla "${r.patron}"?`)) setReglas((p) => p.filter((x) => x.id !== r.id)); };
  const mover = (idx, dir) => setReglas((p) => {
    const j = idx + dir; if (j < 0 || j >= p.length) return p;
    const n = [...p]; [n[idx], n[j]] = [n[j], n[idx]]; return n;
  });

  // Preview paso a paso: reglas activas, spliceando la en-edición si el sheet está abierto.
  let efectivas = reglas.filter((r) => r.activo);
  if (sheet && f.patron.trim()) {
    const patch = { id: (sheet.edit && sheet.edit.id) || '__preview__', tipo: f.tipo, patron: f.patron, reemplazo: f.reemplazo, activo: f.activo, esEditando: true };
    if (sheet.edit) efectivas = efectivas.map((r) => r.id === sheet.edit.id ? patch : r);
    else if (f.activo) efectivas = [...efectivas, patch];
  }
  const pasos = efectivas.map((r, i) => ({
    regla: r,
    resultado: window.gfNormalizar(muestra, efectivas.slice(0, i + 1)),
    invalido: r.tipo === 'regex' && regexInvalido(r.patron),
  }));
  const resultadoFinal = pasos.length ? pasos[pasos.length - 1].resultado : muestra;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <CCard>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-sec)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 0 8px' }}>Preview paso a paso</p>
        <input value={muestra} onChange={(e) => setMuestra(e.target.value)} placeholder="Texto de muestra…" style={{ ...clsMono, marginBottom: 12 }} />
        {pasos.length === 0
          ? <p style={{ fontSize: 13, color: 'var(--color-text-sec)', margin: 0 }}>Sin reglas activas.</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {pasos.map((p, i) => {
                const prev = i > 0 ? pasos[i - 1].resultado : muestra;
                return (
                  <div key={p.regla.id} style={{ fontSize: 12, display: 'flex', gap: 7, alignItems: 'baseline', background: p.regla.esEditando ? 'var(--gf-amber-50, #fef3c7)' : 'transparent', borderRadius: 4, padding: '2px 4px' }}>
                    <span style={{ color: 'var(--gf-gray-400)', minWidth: 16, textAlign: 'right' }}>{i + 1}.</span>
                    <span style={{ ...monoChip, fontSize: 10.5, background: 'var(--gf-gray-50)', color: 'var(--gf-gray-500)' }}>{p.regla.tipo}</span>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, flex: 1, color: p.resultado !== prev ? 'var(--color-accent)' : 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.resultado}</span>
                    {p.invalido && <span style={{ fontSize: 10, color: 'var(--gf-expense)' }}>regex inválido</span>}
                  </div>
                );
              })}
            </div>}
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--gf-gray-100)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)' }}>Resultado:</span>
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 700 }}>{resultadoFinal}</span>
        </div>
      </CCard>

      <CCard padding="0">
        {reglas.length === 0
          ? <p style={{ fontSize: 13, color: 'var(--color-text-sec)', padding: '12px 12px', margin: 0 }}>Sin reglas configuradas.</p>
          : reglas.map((r, i) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 12px', borderBottom: i < reglas.length - 1 ? '1px solid var(--gf-gray-100)' : 'none', opacity: r.activo ? 1 : 0.5 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button onClick={() => mover(i, -1)} disabled={i === 0} style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', padding: 0, color: 'var(--gf-gray-400)', lineHeight: 1, fontSize: 11, opacity: i === 0 ? 0.3 : 1 }}>▲</button>
              <button onClick={() => mover(i, 1)} disabled={i === reglas.length - 1} style={{ background: 'none', border: 'none', cursor: i === reglas.length - 1 ? 'default' : 'pointer', padding: 0, color: 'var(--gf-gray-400)', lineHeight: 1, fontSize: 11, opacity: i === reglas.length - 1 ? 0.3 : 1 }}>▼</button>
            </div>
            <span style={{ minWidth: 16, fontSize: 11, color: 'var(--gf-gray-400)', textAlign: 'right' }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-sec)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{r.tipo}</span>
                <span style={monoChip}>{r.patron || '—'}</span>
                <span style={{ fontSize: 12, color: 'var(--gf-gray-400)' }}>→</span>
                <span style={monoChip}>{r.reemplazo === '' ? '∅' : r.reemplazo}</span>
              </div>
              {r.notas && <div style={{ fontSize: 11, color: 'var(--color-text-sec)', marginTop: 3 }}>{r.notas}</div>}
            </div>
            <RowActions activo={r.activo} onToggle={() => toggle(r)} onEdit={() => open(r)} onDelete={() => del(r)} />
          </div>
        ))}
      </CCard>
      <ClsAddBtn onClick={() => open(null)}>Nueva regla</ClsAddBtn>
      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Los cambios impactan la clasificación tras recargar la app (el diccionario se hidrata on-boot).
      </p>

      {sheet && (
        <ClsSheet title={sheet.edit ? 'Editar regla' : 'Nueva regla'} onClose={close}
          footer={<React.Fragment>
            <CBtn variant="secondary" size="cta" onClick={close}>Cancelar</CBtn>
            <CBtn variant="primary" size="cta" disabled={!f.patron.trim()} onClick={save}>Guardar</CBtn>
          </React.Fragment>}>
          <Field label="Tipo"><Segmented mono value={f.tipo} onPick={(v) => setF({ ...f, tipo: v })} options={NORM_TIPOS.map((t) => ({ value: t, label: t }))} /></Field>
          <Field label="Patrón *" hint={f.tipo === 'regex' && f.patron && regexInvalido(f.patron) ? '⚠ Regex inválido — el servidor también lo rechazará.' : null}>
            <input value={f.patron} onChange={(e) => setF({ ...f, patron: e.target.value })} placeholder="texto a buscar" style={clsMono} autoFocus />
          </Field>
          <Field label="Reemplazo (vacío = eliminar)"><input value={f.reemplazo} onChange={(e) => setF({ ...f, reemplazo: e.target.value })} placeholder="∅ = cadena vacía" style={clsMono} /></Field>
          <Field label="Notas"><input value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} placeholder="Descripción opcional" style={clsInput} /></Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} /> Activa
          </label>
        </ClsSheet>
      )}
    </div>
  );
}

Object.assign(window, { DiccionarioMobile, DestinosMobile, NormalizacionMobile });
