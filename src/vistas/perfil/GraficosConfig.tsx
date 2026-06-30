import { CHART_PALETTES, usePaletaIdx } from '../../datos/graficosPrefs';

// F9.55 — Selector de paleta de colores para gráficos de categorías.
// El índice elegido se guarda en localStorage (gf-chart-paleta) y lo lee
// Dashboard al montar, sin necesidad de contexto global.
export default function GraficosConfig() {
  const [paletaIdx, setPaletaIdx] = usePaletaIdx();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 4 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>
          Paleta de colores
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 16 }}>
          Los colores se asignan por orden de gasto. Más de 8 categorías caen en gris.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {CHART_PALETTES.map((p, i) => {
            const on = paletaIdx === i;
            return (
              <button
                key={p.nombre}
                onClick={() => setPaletaIdx(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', background: 'var(--color-surface)',
                  border: on ? '2px solid var(--gf-emerald)' : '1px solid var(--color-border-card)',
                  borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'var(--font-base)', width: '100%',
                }}
              >
                <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                  {p.colores.map((c, j) => (
                    <span key={j} style={{ width: 18, height: 18, borderRadius: 4, background: c }} />
                  ))}
                </div>
                <span style={{ fontSize: 14, fontWeight: on ? 700 : 500, color: 'var(--color-text)', flex: 1 }}>
                  {p.nombre}
                </span>
                {on && (
                  <span style={{ fontSize: 12, color: 'var(--gf-emerald)', fontWeight: 700, flexShrink: 0 }}>✓</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
