import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../design-system/Icon';
import { Card, Button } from '../../design-system/components';
import { AddBtn } from './shared';
import { normalizar, type NormRule } from '../../datos/normalizador';
import {
  listarReglas, guardarRegla,
  type ReglaDoc, type GuardarReglaInput,
} from '../../datos/reglasNormalizacion';

const TIPOS: NormRule['tipo'][] = ['prefix', 'suffix', 'replace', 'regex'];

const monoStyle: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 13,
  background: 'var(--gf-gray-50)', borderRadius: 6, padding: '2px 6px',
};

const inputStyle: React.CSSProperties = {
  fontSize: 14, fontFamily: 'var(--font-base)', border: '1px solid var(--gf-gray-200)',
  borderRadius: 8, padding: '7px 10px', width: '100%', boxSizing: 'border-box',
  background: 'var(--color-surface)', color: 'var(--color-text)',
};

const monoInputStyle: React.CSSProperties = {
  ...inputStyle, fontFamily: 'monospace', fontSize: 13,
};

function isRegexInvalido(patron: string): boolean {
  try { new RegExp(patron, 'gi'); return false; }
  catch { return true; }
}

export default function Normalizacion() {
  const [reglas, setReglas] = useState<ReglaDoc[]>([]);
  const [cargando, setCargando] = useState(true);

  // preview
  const [muestra, setMuestra] = useState('COMPRA MERCADOPAGO*KIOSCO 12/03');

  // sheet
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<ReglaDoc | null>(null);
  const [fTipo, setFTipo] = useState<NormRule['tipo']>('replace');
  const [fPatron, setFPatron] = useState('');
  const [fReemplazo, setFReemplazo] = useState('');
  const [fActivo, setFActivo] = useState(true);
  const [fNotas, setFNotas] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setCargando(true);
    setReglas(await listarReglas());
    setCargando(false);
  }

  useEffect(() => { cargar(); }, []);

  function abrirNueva() {
    setEditando(null);
    setFTipo('replace'); setFPatron(''); setFReemplazo(''); setFActivo(true); setFNotas('');
    setErrorMsg(null); setAbierto(true);
  }

  function abrirEdicion(r: ReglaDoc) {
    setEditando(r);
    setFTipo(r.tipo); setFPatron(r.patron); setFReemplazo(r.reemplazo);
    setFActivo(r.activo); setFNotas(r.notas ?? '');
    setErrorMsg(null); setAbierto(true);
  }

  function cerrar() { setAbierto(false); setEditando(null); setErrorMsg(null); }

  async function ejecutar(input: GuardarReglaInput) {
    setGuardando(true); setErrorMsg(null);
    try {
      await guardarRegla(input);
      await cargar();
      cerrar();
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Error al guardar.');
    } finally { setGuardando(false); }
  }

  async function guardar() {
    if (!fPatron.trim()) { setErrorMsg('El patrón es requerido.'); return; }
    await ejecutar({
      accion: editando ? 'editar' : 'crear',
      id: editando?.id,
      tipo: fTipo, patron: fPatron.trim(), reemplazo: fReemplazo,
      activo: fActivo, notas: fNotas.trim() || null,
    });
  }

  async function toggleActivo(r: ReglaDoc) {
    await ejecutar({ accion: 'editar', id: r.id, tipo: r.tipo, patron: r.patron, reemplazo: r.reemplazo, activo: !r.activo, notas: r.notas });
  }

  async function borrar(r: ReglaDoc) {
    if (!confirm(`¿Eliminar la regla "${r.patron}"?`)) return;
    setGuardando(true);
    try { await guardarRegla({ accion: 'eliminar', id: r.id }); await cargar(); }
    catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error.'); }
    finally { setGuardando(false); }
  }

  async function mover(idx: number, dir: -1 | 1) {
    const nueva = [...reglas];
    const otro  = idx + dir;
    if (otro < 0 || otro >= nueva.length) return;
    [nueva[idx], nueva[otro]] = [nueva[otro], nueva[idx]];
    setReglas(nueva); // optimista
    try { await guardarRegla({ accion: 'reordenar', ids: nueva.map(r => r.id) }); }
    catch { await cargar(); } // revert
  }

  // reglas efectivas para preview: activas + si hay sheet abierto, splicea la en-edición
  const reglasEfectivas = useMemo((): (ReglaDoc & { esEditando?: boolean })[] => {
    let base = reglas.filter(r => r.activo);
    if (abierto && fPatron.trim()) {
      const patch: ReglaDoc & { esEditando: true } = {
        id: editando?.id ?? '__preview__',
        tipo: fTipo, patron: fPatron, reemplazo: fReemplazo,
        activo: fActivo, orden: editando?.orden ?? 9999, notas: null,
        esEditando: true,
      };
      if (editando) {
        base = base.map(r => r.id === editando.id ? patch : r);
      } else if (fActivo) {
        base = [...base, patch];
      }
    }
    return base;
  }, [reglas, abierto, fTipo, fPatron, fReemplazo, fActivo, editando]);

  // pasos del preview
  const pasos = useMemo(() => {
    return reglasEfectivas.map((r, i) => {
      const reglaAsNorm: NormRule = { tipo: r.tipo, patron: r.patron, reemplazo: r.reemplazo };
      const resultado = normalizar(muestra, reglasEfectivas.slice(0, i + 1).map(x => ({ tipo: x.tipo, patron: x.patron, reemplazo: x.reemplazo })));
      const invalido  = r.tipo === 'regex' && isRegexInvalido(r.patron);
      return { regla: r, resultado, invalido, norm: reglaAsNorm };
    });
  }, [muestra, reglasEfectivas]);

  const resultadoFinal = pasos.length > 0 ? pasos[pasos.length - 1].resultado : muestra;

  if (cargando) return <p style={{ color: 'var(--color-text-sec)' }}>Cargando…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* preview panel */}
      <Card padding="var(--space-3)">
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 0 8px' }}>Preview paso a paso</p>
        <input
          value={muestra}
          onChange={e => setMuestra(e.target.value)}
          placeholder="Texto de muestra…"
          style={{ ...monoInputStyle, marginBottom: 12 }}
        />
        {pasos.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-sec)', margin: 0 }}>Sin reglas activas.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {pasos.map((p, i) => (
              <div
                key={p.regla.id}
                style={{
                  fontSize: 12, display: 'flex', gap: 8, alignItems: 'baseline',
                  background: p.regla.esEditando ? 'var(--gf-warn-bg, #fef9c3)' : 'transparent',
                  borderRadius: 4, padding: '2px 4px',
                }}
              >
                <span style={{ color: 'var(--gf-gray-400)', minWidth: 18, textAlign: 'right' }}>{i + 1}.</span>
                <span style={{ ...monoStyle, color: 'var(--gf-gray-500)', fontSize: 11 }}>{p.regla.tipo}</span>
                <span style={{ ...monoStyle, fontSize: 11 }}>{p.regla.patron || '—'}</span>
                <span style={{ color: 'var(--gf-gray-400)' }}>→</span>
                <span style={{ fontFamily: 'monospace', fontSize: 12, flex: 1, color: p.resultado !== (i > 0 ? pasos[i - 1].resultado : muestra) ? 'var(--color-accent)' : 'var(--color-text)' }}>
                  {p.resultado}
                </span>
                {p.invalido && <span style={{ fontSize: 10, color: 'var(--gf-err-text)' }}>regex inválido — se ignora</span>}
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--gf-gray-100)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)' }}>Resultado:</span>
          <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>{resultadoFinal}</span>
        </div>
      </Card>

      {/* lista de reglas */}
      <Card padding="0">
        {reglas.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-sec)', padding: '12px 10px' }}>Sin reglas configuradas.</p>
        ) : reglas.map((r, i) => (
          <div
            key={r.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
              borderBottom: i < reglas.length - 1 ? '1px solid var(--gf-gray-100)' : 'none',
              opacity: r.activo ? 1 : 0.5,
            }}
          >
            {/* reordenar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button onClick={() => mover(i, -1)} disabled={i === 0 || guardando} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--gf-gray-400)', lineHeight: 1 }}>▲</button>
              <button onClick={() => mover(i, 1)} disabled={i === reglas.length - 1 || guardando} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--gf-gray-400)', lineHeight: 1 }}>▼</button>
            </div>

            <span style={{ minWidth: 20, fontSize: 11, color: 'var(--gf-gray-400)', textAlign: 'right' }}>{i + 1}</span>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-sec)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{r.tipo}</span>
                <span style={monoStyle}>{r.patron || '—'}</span>
                <span style={{ fontSize: 12, color: 'var(--gf-gray-400)' }}>→</span>
                <span style={monoStyle}>{r.reemplazo === '' ? '∅' : r.reemplazo}</span>
              </div>
              {r.notas && <div style={{ fontSize: 11, color: 'var(--color-text-sec)', marginTop: 2 }}>{r.notas}</div>}
            </div>

            {/* toggle activo */}
            <button
              onClick={() => toggleActivo(r)}
              title={r.activo ? 'Desactivar' : 'Activar'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: r.activo ? 'var(--color-accent)' : 'var(--gf-gray-300)' }}
            >
              <Icon name={r.activo ? 'check' : 'circle-x'} size={16} />
            </button>

            <button onClick={() => abrirEdicion(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--color-text-sec)' }}>
              <Icon name="pencil" size={15} />
            </button>

            <button onClick={() => borrar(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--gf-err-text)' }}>
              <Icon name="trash-2" size={15} />
            </button>
          </div>
        ))}
      </Card>

      <AddBtn onClick={abrirNueva}><Icon name="plus" size={18} /> Nueva regla</AddBtn>

      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Los cambios impactan la clasificación tras recargar la app (el diccionario se hidrata on-boot).
      </p>

      {/* bottom-sheet */}
      {abierto && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={cerrar} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
          <div style={{
            position: 'relative', background: 'var(--color-surface)',
            borderRadius: '18px 18px 0 0', padding: '20px 16px 32px',
            display: 'flex', flexDirection: 'column', gap: 14,
            maxHeight: '85dvh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{editando ? 'Editar regla' : 'Nueva regla'}</span>
              <button onClick={cerrar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-sec)' }}>
                <Icon name="x" size={20} />
              </button>
            </div>

            {/* tipo segmented */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>Tipo</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {TIPOS.map(t => (
                  <button
                    key={t}
                    onClick={() => setFTipo(t)}
                    style={{
                      flex: 1, padding: '6px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                      fontFamily: 'monospace', fontSize: 12, fontWeight: 600,
                      background: fTipo === t ? 'var(--color-accent)' : 'var(--gf-gray-100)',
                      color: fTipo === t ? '#fff' : 'var(--color-text)',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* patrón */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>Patrón *</label>
              <input value={fPatron} onChange={e => setFPatron(e.target.value)} placeholder="texto a buscar" style={monoInputStyle} autoFocus />
              {fTipo === 'regex' && fPatron && isRegexInvalido(fPatron) && (
                <p style={{ fontSize: 12, color: 'var(--gf-err-text)', margin: '4px 0 0' }}>Regex inválido — el servidor también lo rechazará.</p>
              )}
            </div>

            {/* reemplazo */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>Reemplazo <span style={{ fontWeight: 400 }}>(vacío = eliminar)</span></label>
              <input value={fReemplazo} onChange={e => setFReemplazo(e.target.value)} placeholder="∅ = cadena vacía" style={monoInputStyle} />
            </div>

            {/* notas */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-sec)', display: 'block', marginBottom: 5 }}>Notas</label>
              <input value={fNotas} onChange={e => setFNotas(e.target.value)} placeholder="Descripción opcional" style={inputStyle} />
            </div>

            {/* activo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" id="fActivo" checked={fActivo} onChange={e => setFActivo(e.target.checked)} />
              <label htmlFor="fActivo" style={{ fontSize: 14, cursor: 'pointer' }}>Activa</label>
            </div>

            {errorMsg && <p style={{ fontSize: 13, color: 'var(--gf-err-text)', margin: 0 }}>{errorMsg}</p>}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <Button variant="secondary" size="cta" onClick={cerrar} disabled={guardando}>Cancelar</Button>
              <Button variant="primary" size="cta" onClick={guardar} disabled={guardando || !fPatron.trim()}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
