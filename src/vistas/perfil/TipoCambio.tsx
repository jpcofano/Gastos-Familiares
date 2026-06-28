import { useEffect, useState } from 'react';
import { Card, Badge, Button } from '../../design-system/components';
import { cargarTCReciente, type TCDiarioItem } from '../../datos/tcDiario';
import { actualizarTCManual } from '../../datos/configFamilia';

// F9.39 — respaldo manual de /tcDiario (complementa el cron automático F9.30
// que lee dolarapi/MEP). Mismo doc/shape, origen:'manual' vs 'dolarapi-bolsa'
// — una sola fuente de verdad, tcParaFecha no cambia. El toggle local
// manual/automático de F9.26 (que no persistía nada) se reemplaza por el
// formulario real: cargar/corregir el TC de una fecha puntual, con aviso si
// pisa un valor existente.

const inputStyle: React.CSSProperties = {
  fontSize: 14, fontFamily: 'var(--font-base)', border: '1px solid var(--gf-gray-200)',
  borderRadius: 8, padding: '8px 11px', background: 'var(--color-surface)', color: 'var(--color-text)',
};

function fmtFecha(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function hoyAR(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}

function origenLabel(o?: TCDiarioItem['origen']): { texto: string; tone: 'info' | 'warning' } {
  return o === 'manual' ? { texto: 'Manual', tone: 'warning' } : { texto: 'Automático', tone: 'info' };
}

export default function TipoCambio() {
  const [hist, setHist] = useState<TCDiarioItem[]>([]);
  const [cargando, setCargando] = useState(true);

  const [fecha, setFecha] = useState(hoyAR());
  const [valor, setValor] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function recargar() {
    setCargando(true);
    cargarTCReciente(10).then(h => { setHist(h); setCargando(false); });
  }

  useEffect(recargar, []);

  const actual = hist[0];

  async function guardar() {
    const num = Number(valor.replace(',', '.'));
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { setError('Fecha inválida.'); return; }
    if (!Number.isFinite(num) || num <= 0) { setError('Ingresá un valor de TC válido.'); return; }

    const existente = hist.find(h => h.fecha === fecha);
    if (existente && !confirm(
      `Ya hay un TC para ${fmtFecha(fecha)}: $ ${existente.tcUsdArs.toLocaleString('es-AR')} (${origenLabel(existente.origen).texto}). ¿Sobrescribir con $ ${num.toLocaleString('es-AR')}?`,
    )) return;

    setGuardando(true);
    setError(null);
    setOk(false);
    const res = await actualizarTCManual(fecha, num);
    setGuardando(false);
    if (!res.ok) { setError(res.error.message); return; }
    setOk(true);
    setValor('');
    recargar();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card variant="highlight" eyebrow="TC USD → ARS (último MEP)">
        {cargando ? (
          <span style={{ fontSize: 14, color: 'var(--color-text-sec)' }}>Cargando…</span>
        ) : !actual ? (
          <span style={{ fontSize: 14, color: 'var(--color-text-sec)' }}>Sin datos de /tcDiario todavía.</span>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 36, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.5px' }}>$ {actual.tcUsdArs.toLocaleString('es-AR')}</span>
              <span style={{ fontSize: 14, color: 'var(--color-text-sec)' }}>/ USD</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Actualizado el {fmtFecha(actual.fecha)}</span>
              <Badge tone={origenLabel(actual.origen).tone}>{origenLabel(actual.origen).texto}</Badge>
            </div>
          </>
        )}
      </Card>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)' }}>Cargar / corregir TC manual</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
            Respaldo del refresco automático (dolarapi-MEP). Pisa el valor de ese día puntual — el
            cron del día siguiente vuelve a poner el automático.
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="date" value={fecha} onChange={e => { setFecha(e.target.value); setOk(false); }} style={{ ...inputStyle, flex: 1 }} />
            <input
              type="number" inputMode="decimal" placeholder="$ por USD" value={valor}
              onChange={e => { setValor(e.target.value); setOk(false); }}
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
          {error && <p style={{ fontSize: 12, color: 'var(--gf-err-text)', margin: 0 }}>{error}</p>}
          {ok && <p style={{ fontSize: 12, color: 'var(--gf-ok-text)', margin: 0 }}>Guardado.</p>}
          <Button variant="primary" size="cta" onClick={guardar} disabled={guardando || !valor}>
            {guardando ? 'Guardando…' : 'Guardar TC'}
          </Button>
        </div>
      </Card>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 0 8px 4px' }}>Histórico (últimos {hist.length})</div>
        <Card padding="var(--space-2)">
          {hist.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-sec)', padding: '11px 10px' }}>Sin histórico todavía.</p>
          ) : hist.map((h, i) => (
            <div key={h.fecha} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', padding: '11px 10px', borderBottom: i < hist.length - 1 ? '1px solid var(--gf-gray-100)' : 'none', fontSize: 14 }}>
              <span style={{ color: 'var(--color-text-strong)' }}>{fmtFecha(h.fecha)}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Badge tone={origenLabel(h.origen).tone}>{origenLabel(h.origen).texto}</Badge>
                <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>$ {h.tcUsdArs.toLocaleString('es-AR')}</span>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
