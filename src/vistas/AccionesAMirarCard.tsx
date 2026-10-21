// F9.196 H6 (base §7, diseño 3) — card "Acciones a mirar" en Resumen, debajo de Reserva y señales.
// Solo excepciones, en el orden de §7: stop tocado, stop cerca, señal nueva de atención, gatillo
// que cambió y evento a 7 días o menos. Tocar una fila abre la ficha de esa acción en Tenencias.
//
// ⛔ Sin push, sin campana, sin "acción sugerida": describe niveles y señales, no dice qué hacer.
import { Card } from '../design-system/components';
import { MerchantLogo } from '../design-system/components';
import { Icon } from '../design-system/Icon';
import type { FilaAMirar } from '../datos/patrimonioAccionesAMirar';

const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const horaArg = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(11, 16);
const fechaArg = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(0, 10);

const ETIQUETA: Record<FilaAMirar['motivo'], { txt: string; color: string }> = {
  stop_tocado: { txt: 'en el nivel', color: 'var(--gf-expense)' },
  stop_cerca: { txt: 'cerca de un nivel', color: 'var(--gf-out)' },
  senal_nueva: { txt: 'señal nueva', color: 'var(--gf-out)' },
  gatillo: { txt: 'gatillo de tesis', color: 'var(--gf-out)' },
  evento: { txt: 'evento próximo', color: 'var(--color-text-sec)' },
};

export default function AccionesAMirarCard({ filas, revisadas, calculadoEnISO, privado, onAbrir }: {
  filas: FilaAMirar[];
  revisadas: number;
  calculadoEnISO: string | null;
  privado: boolean;
  onAbrir: (identidad: string) => void;
}) {
  if (revisadas === 0) return null;
  const hoy = fechaArg(new Date().toISOString());
  const cuando = calculadoEnISO
    ? (fechaArg(calculadoEnISO) === hoy ? `hoy ${horaArg(calculadoEnISO)}` : `el ${fechaArg(calculadoEnISO).slice(8, 10)}/${fechaArg(calculadoEnISO).slice(5, 7)} ${horaArg(calculadoEnISO)}`)
    : '';
  return (
    <Card padding="0">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '12px 14px 8px' }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Acciones a mirar</div>
        <span style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginLeft: 'auto' }}>niveles de referencia, no órdenes</span>
      </div>
      {filas.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', padding: '0 14px 12px', lineHeight: 1.45 }}>
          Ninguna acción cerca de un stop ni con señales nuevas · {revisadas} acciones revisadas{cuando ? ` ${cuando}` : ''}
        </div>
      ) : filas.map((f, i) => {
        const e = ETIQUETA[f.motivo];
        return (
          <button
            key={f.identidad}
            onClick={() => onAbrir(f.identidad)}
            style={{ display: 'flex', gap: 10, alignItems: 'flex-start', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', borderTop: i === 0 ? '1px solid var(--gf-gray-100)' : '1px solid var(--gf-gray-100)', background: 'var(--color-surface)', cursor: 'pointer', fontFamily: 'var(--font-base)', color: 'var(--color-text)' }}
          >
            <MerchantLogo nombre={f.ticker} size={34} radius={8} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{f.ticker}</span>
                {f.precio !== null && (
                  <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {privado ? '•••' : `${f.moneda === 'USD' ? 'US$' : '$'} ${fmt(f.precio)}`}
                  </span>
                )}
                {f.variacionDia !== null && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: f.variacionDia >= 0 ? 'var(--gf-income)' : 'var(--gf-expense)', fontVariantNumeric: 'tabular-nums' }}>
                    {f.variacionDia >= 0 ? '▲' : '▼'} {Math.abs(f.variacionDia * 100).toFixed(1).replace('.', ',')}% hoy
                  </span>
                )}
                <span style={{ fontSize: 10, fontWeight: 800, color: e.color, marginLeft: 'auto' }}>{e.txt}</span>
              </span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-text-sec)', marginTop: 3, lineHeight: 1.4 }}>
                {f.detalle.join('  ·  ') || '—'}
              </span>
            </span>
            <Icon name="chevron-right" size={14} color="var(--gf-gray-400)" />
          </button>
        );
      })}
    </Card>
  );
}
