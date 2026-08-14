import { useEffect, useState } from 'react';
import { Icon } from '../../design-system/Icon';
import { Card, BankLogo, Button } from '../../design-system/components';
import { AddBtn } from './shared';
import { useFamiliaConfig } from '../../hooks/useFamiliaConfig';
import { actualizarMediosPago } from '../../datos/configFamilia';
import type { MedioPago } from '../../types';

// F9.36 — primer CRUD real de Perfil (patrón base: leer config real, editar en
// estado local, guardar con la callable admin-only, optimistic + rollback si
// falla). Efectivo (F9.23: alias cosmético de Mercado Pago) nunca aparece en
// la lista editable ni se puede borrar el medio al que está aliasado — el
// invariante se fuerza también server-side (actualizarMediosPago), no solo acá.

const inputStyle: React.CSSProperties = {
  fontSize: 14, fontFamily: 'var(--font-base)', border: '1px solid var(--gf-gray-200)',
  borderRadius: 8, padding: '7px 10px', background: 'var(--color-surface)', color: 'var(--color-text)',
};

function generarId(existentes: Set<string>): string {
  let id = `medio-${Date.now().toString(36)}`;
  while (existentes.has(id)) id = `medio-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
  return id;
}

// F9.139 §5 — se fue la prop `bloqueado`: existía solo para impedir borrar Mercado Pago mientras
// Efectivo lo aliaseaba, y Efectivo ya no existe. Entra `onPorDefecto`.
function MedioRow({ medio, onChange, onEliminar, onPorDefecto }: {
  medio: MedioPago; onChange: (m: MedioPago) => void; onEliminar: () => void; onPorDefecto: () => void;
}) {
  return (
    <div style={{ padding: '12px 10px', borderBottom: '1px solid var(--gf-gray-100)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <BankLogo id={medio.id} nombre={medio.nombre} color={medio.color} dominio={medio.dominio} size={32} />
        <input
          value={medio.nombre}
          onChange={e => onChange({ ...medio, nombre: e.target.value })}
          placeholder="Nombre"
          style={{ ...inputStyle, flex: 1 }}
        />
        <input
          type="color"
          value={medio.color}
          onChange={e => onChange({ ...medio, color: e.target.value })}
          title="Color"
          style={{ width: 32, height: 32, border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0 }}
        />
        <button
          onClick={onEliminar}
          title="Eliminar"
          style={{
            width: 26, height: 26, borderRadius: 999, border: 'none', flexShrink: 0,
            background: '#ffe4e6', color: 'var(--gf-expense-700)',
            cursor: 'pointer', fontSize: 12,
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, paddingLeft: 42, alignItems: 'center' }}>
        <select value={medio.tipo} onChange={e => onChange({ ...medio, tipo: e.target.value as MedioPago['tipo'] })} style={{ ...inputStyle, flex: '0 0 130px' }}>
          <option value="Banco">Banco</option>
          <option value="Billetera">Billetera</option>
        </select>
        <input
          value={medio.dominio ?? ''}
          onChange={e => onChange({ ...medio, dominio: e.target.value || undefined })}
          placeholder="dominio.com (logo)"
          style={{ ...inputStyle, flex: 1 }}
        />
      </div>
      {/* F9.139 §5 — radio, no checkbox: el default es exclusivo. El `name` compartido deja que
          el propio grupo garantice la exclusividad en el DOM, además del handler. */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 7, paddingLeft: 42, fontSize: 12.5, cursor: 'pointer', color: medio.porDefecto ? 'var(--color-text-strong)' : 'var(--color-text-sec)' }}>
        <input
          type="radio"
          name="medio-por-defecto"
          checked={medio.porDefecto === true}
          onChange={onPorDefecto}
          style={{ cursor: 'pointer' }}
        />
        Medio por defecto
      </label>
    </div>
  );
}

export default function MediosPago() {
  const { config, cargando } = useFamiliaConfig();
  const [medios, setMedios]   = useState<MedioPago[] | null>(null);
  const [original, setOriginal] = useState<MedioPago[] | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (config && medios === null) {
      setMedios(config.bancos);
      setOriginal(config.bancos);
    }
  }, [config, medios]);

  if (cargando || !medios) return <p style={{ color: 'var(--color-text-sec)' }}>Cargando…</p>;

  // F9.139 §5 — se fue `const efectivo = medios.find(...)`, junto con el `bloqueado` que dependía
  // de él: existía solo para que no se borrara Mercado Pago mientras Efectivo lo aliaseaba.
  const visibles = medios.filter(m => !m.oculto);
  const dirty = JSON.stringify(medios) !== JSON.stringify(original);
  const cuantosDefault = medios.filter(m => m.porDefecto).length;

  function actualizarMedio(id: string, nuevo: MedioPago) {
    setMedios(prev => (prev ?? []).map(m => (m.id === id ? nuevo : m)));
    setOk(false);
  }

  // F9.139 — el default es EXCLUSIVO, por eso es un radio y no un checkbox: marcar uno desmarca
  // al resto acá mismo, en vez de dejar que el usuario arme un estado inválido y se lo rechacen
  // al guardar.
  function marcarPorDefecto(id: string) {
    setMedios(prev => (prev ?? []).map(m => ({ ...m, porDefecto: m.id === id })));
    setOk(false);
  }

  function eliminarMedio(id: string) {
    setMedios(prev => (prev ?? []).filter(m => m.id !== id));
    setOk(false);
  }

  function agregarMedio() {
    const id = generarId(new Set(medios.map(m => m.id)));
    setMedios(prev => [...(prev ?? []), { id, nombre: 'Nuevo medio', color: '#6b7280', tipo: 'Banco' }]);
    setOk(false);
  }

  function cancelar() {
    setMedios(original);
    setError(null);
    setOk(false);
  }

  async function guardar() {
    // F9.139 §5 (Opción A) — la unicidad del default se valida ACÁ porque el callable
    // `actualizarMediosPago` hace full-replace sin comprobarla, y agregársela obligaría a
    // deployar functions. Queda anotado como hueco en docs/CLAUDE.md: otra vía de escritura
    // podría dejar cero o dos defaults sin que nadie lo frene.
    const n = (medios ?? []).filter(m => m.porDefecto).length;
    if (n !== 1) {
      setError(n === 0
        ? 'Marcá un medio por defecto: es el que se asume cuando no se puede detectar ninguno.'
        : `Hay ${n} medios marcados por defecto y tiene que ser exactamente uno.`);
      return;
    }
    setGuardando(true);
    setError(null);
    const res = await actualizarMediosPago(medios!);
    setGuardando(false);
    if (!res.ok) { setError(res.error.message); return; }
    setOriginal(medios);
    setOk(true);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card padding="var(--space-2)">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {visibles.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-sec)', padding: '12px 10px' }}>Sin medios configurados.</p>
          ) : visibles.map(m => (
            <MedioRow
              key={m.id}
              medio={m}
              onChange={nuevo => actualizarMedio(m.id, nuevo)}
              onEliminar={() => eliminarMedio(m.id)}
              onPorDefecto={() => marcarPorDefecto(m.id)}
            />
          ))}
        </div>
      </Card>

      <AddBtn onClick={agregarMedio}><Icon name="plus" size={18} /> Agregar medio de pago</AddBtn>

      {/* F9.139 §5 — el texto dice QUÉ SIGNIFICA el default, no cómo funciona el radio.
          El párrafo anterior explicaba el alias de Efectivo, que ya no existe. */}
      <p style={{ fontSize: 12, color: 'var(--color-text-sec)', margin: '0 4px', lineHeight: 1.5 }}>
        Los medios de pago alimentan el desglose diario por banco del Resumen. El marcado
        <strong> por defecto</strong> es el que se asume cuando no se puede saber de dónde salió
        la plata — por ejemplo al cargar un comprobante que no dice el banco.
        {cuantosDefault !== 1 && (
          <span style={{ color: 'var(--gf-err-text)' }}>
            {' '}Ahora mismo hay {cuantosDefault === 0 ? 'ninguno' : cuantosDefault} marcado{cuantosDefault === 1 ? '' : 's'}: tiene que ser exactamente uno.
          </span>
        )}
      </p>

      {error && <p style={{ fontSize: 13, color: 'var(--gf-err-text)', margin: '0 4px' }}>{error}</p>}
      {ok && !dirty && <p style={{ fontSize: 13, color: 'var(--gf-ok-text)', margin: '0 4px' }}>Guardado.</p>}

      {dirty && (
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="secondary" size="cta" onClick={cancelar} disabled={guardando}>Cancelar</Button>
          <Button variant="primary" size="cta" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar cambios'}</Button>
        </div>
      )}
    </div>
  );
}
