// F9.196 nota de revisión 4 — Configuración → "Fuentes del valor de hoy". El detalle que salió del
// hero: frescura por cuenta, la tabla por cuenta (carga contra hoy), las inconsistencias y el dólar
// usado. Lee `carteraViva/ultima`, el mismo documento que el hero; nada del servidor cambia.
//
// ⛔ Las inconsistencias se muestran, no se corrigen solas (contrato de CLAUDE-PATRIMONIO).
import { useEffect, useState } from 'react';
import { Card } from '../design-system/components';
import type { DocCarteraViva } from '../datos/patrimonioCarteraVivaLectura';
import { avisosValorHoy, rotuloFuenteCuenta } from '../datos/patrimonioFuentesValorHoy';
import { taparMontos } from '../datos/patrimonioAccionesAMirar';

export const ID_FUENTES_VALOR_HOY = 'fuentes-valor-hoy';

const sub = { fontSize: 11, color: 'var(--gf-gray-400)', lineHeight: 1.45 } as const;
const titulo = { fontSize: 11, fontWeight: 800, letterSpacing: 0.3, color: 'var(--gf-gray-400)', marginBottom: 4 } as const;
const ddmm = (f: string | null | undefined) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : '—');
const horaArg = (iso: string | null | undefined) => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Date(ms - 3 * 3600_000).toISOString() : null;
};

/** Ancho de teléfono: la tabla por cuenta pasa a filas de dos renglones (sin scroll horizontal). */
function useAnchoChico(px = 560): boolean {
  const consulta = `(max-width: ${px}px)`;
  const [chico, setChico] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(consulta).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(consulta);
    if (!mq) return;
    const al = () => setChico(mq.matches);
    mq.addEventListener?.('change', al);
    return () => mq.removeEventListener?.('change', al);
  }, [consulta]);
  return chico;
}

export default function FuentesValorHoyCard({ cv, privado, usd, fechaCorrida }: {
  cv: DocCarteraViva | null;
  privado: boolean;
  /** La corrida vigente: si el documento es de otra carga, se avisa (el hero ya no lo usa). */
  fechaCorrida: string;
  /** El formateador de montos de Patrimonio (con el modo privado ya resuelto). */
  usd: (n: number) => string;
}) {
  const chico = useAnchoChico();
  const fmtUsd = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? usd(n) : '—');
  const fmtDif = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? `${n >= 0 ? '+' : '−'}${usd(Math.abs(n))}` : '—');

  if (!cv) {
    return (
      <div id={ID_FUENTES_VALOR_HOY} style={{ scrollMarginTop: 12 }}>
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Fuentes del valor de hoy</div>
          <div style={{ ...sub, marginTop: 4 }}>Todavía no hay un valor de hoy calculado.</div>
        </Card>
      </div>
    );
  }

  const avisos = avisosValorHoy(cv);
  const frescura = Array.isArray(cv.frescura) ? cv.frescura : [];
  const cuentas = Array.isArray(cv.cuentas) ? cv.cuentas : [];
  const inconsistencias = Array.isArray(cv.inconsistencias) ? cv.inconsistencias : [];
  const calculada = horaArg(cv.calculadaEnISO);
  const tc = cv.tc ?? null;
  // Modo privado: montos y precios de los textos (frescura e inconsistencias) se tapan.
  const texto = (l: string) => (privado ? taparMontos(l) : l);
  const desactualizada = !!cv.fechaCorrida && !!fechaCorrida && cv.fechaCorrida !== fechaCorrida;

  return (
    <div id={ID_FUENTES_VALOR_HOY} style={{ scrollMarginTop: 12 }}>
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Fuentes del valor de hoy</div>
        <div style={{ ...sub, marginTop: 2, marginBottom: 10 }}>
          De dónde sale cada cuenta del "Valor de hoy (estimado)" del Resumen, y lo que no cuadra.
          {avisos.length > 0 ? ` ⚠ ${avisos.length} ${avisos.length === 1 ? 'aviso' : 'avisos'}.` : ' Sin avisos.'}
        </div>
        {desactualizada && (
          <div style={{ ...sub, color: 'var(--gf-out)', marginTop: -6, marginBottom: 10 }}>
            ⚠ Calculado sobre la carga del {ddmm(cv.fechaCorrida)} (la vigente es la del {ddmm(fechaCorrida)}): desactualizado. Recalculá el valor de hoy.
          </div>
        )}

        {/* 1. Frescura */}
        <div style={titulo}>FRESCURA</div>
        <div style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 12, overflowWrap: 'anywhere' }}>
          {frescura.length ? frescura.map((l, i) => (
            <div key={i} style={l.includes('⚠') || /sin lectura|sin sincronizar|sin dato|\(viejo\)/.test(l) ? { color: 'var(--gf-out)' } : undefined}>{texto(l)}</div>
          )) : <div style={sub}>—</div>}
          {/* Lo que se cuenta como aviso y no está en las líneas de arriba también se ve. */}
          {avisos.filter(a => a.tipo === 'fuente_vieja').map((a, i) => <div key={`v${i}`} style={{ color: 'var(--gf-out)' }}>⚠ Fuente vieja: {a.texto}</div>)}
          {avisos.some(a => a.tipo === 'sin_lectura_cripto') && !frescura.some(l => l.startsWith('Cripto:')) && (
            <div style={{ color: 'var(--gf-out)' }}>⚠ Cripto: sin lectura de precios</div>
          )}
        </div>

        {/* 2. Por cuenta */}
        <div style={titulo}>POR CUENTA</div>
        {!cuentas.length ? <div style={{ ...sub, marginBottom: 12 }}>—</div> : (
          <div style={{ marginBottom: 12 }}>
            {!chico && (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) 0.8fr 0.7fr 1fr 1fr 1fr', gap: 8, fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', padding: '0 0 4px', borderBottom: '1px solid var(--gf-gray-100)' }}>
                <span>Cuenta</span><span>Fuente</span><span>Fecha base</span>
                <span style={{ textAlign: 'right' }}>Última carga</span><span style={{ textAlign: 'right' }}>Hoy</span><span style={{ textAlign: 'right' }}>Diferencia</span>
              </div>
            )}
            {cuentas.map((c, i) => {
              const dif = typeof c.valorUsd === 'number' && typeof c.valorCargaUsd === 'number' ? c.valorUsd - c.valorCargaUsd : null;
              const colorDif = dif === null ? undefined : dif >= 0 ? 'var(--gf-income)' : 'var(--gf-expense)';
              const fuente = rotuloFuenteCuenta(c.fuente, c.cuenta, frescura, c.porArchivo);
              // Nota de revisión 5: en Balanz por archivo, las dos fechas (tenencia y caja) en vez de la fecha base.
              const fechas = c.porArchivo
                ? `tenencia ${c.tenenciaDel ? ddmm(c.tenenciaDel) : `${ddmm(c.fechaBase)} (carga)`} · caja ${c.cajaAl ? ddmm(c.cajaAl) : 'de la carga'}`
                : ddmm(c.fechaBase);
              return chico ? (
                <div key={i} style={{ padding: '7px 0', borderTop: i ? '1px solid var(--gf-gray-100)' : 'none', fontSize: 12 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>{c.cuenta}{c.error ? ' ⚠' : ''}</span>
                    <span style={sub}>{fuente} · {fechas}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-sec)' }}>
                    <span>carga {fmtUsd(c.valorCargaUsd)}</span>
                    <span>→ hoy {fmtUsd(c.valorUsd)}</span>
                    <span style={{ fontWeight: 700, color: colorDif }}>{fmtDif(dif)}</span>
                  </div>
                </div>
              ) : (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) 0.8fr 0.7fr 1fr 1fr 1fr', gap: 8, fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--gf-gray-100)', fontVariantNumeric: 'tabular-nums', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{c.cuenta}{c.error ? ' ⚠' : ''}</span>
                  <span>{fuente}</span>
                  <span style={c.porArchivo ? { fontSize: 11 } : undefined}>{fechas}</span>
                  <span style={{ textAlign: 'right' }}>{fmtUsd(c.valorCargaUsd)}</span>
                  <span style={{ textAlign: 'right' }}>{fmtUsd(c.valorUsd)}</span>
                  <span style={{ textAlign: 'right', fontWeight: 700, color: colorDif }}>{fmtDif(dif)}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* 3. Inconsistencias */}
        <div style={titulo}>INCONSISTENCIAS</div>
        {inconsistencias.length ? (
          <ul style={{ margin: '0 0 12px', paddingLeft: 16, fontSize: 12, lineHeight: 1.45, color: 'var(--gf-out)', overflowWrap: 'anywhere' }}>
            {inconsistencias.map((x, i) => <li key={i}>{texto(x)}</li>)}
          </ul>
        ) : <div style={{ ...sub, marginBottom: 12 }}>Sin inconsistencias.</div>}

        {/* 4. Dólar y cálculo */}
        <div style={titulo}>DÓLAR Y CÁLCULO</div>
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>
          <div>
            MEP {tc && typeof tc.valor === 'number' ? (privado ? '•••' : `$ ${Math.round(tc.valor).toLocaleString('es-AR')}`) : '—'}
            {tc ? ` · ${tc.fuente === 'dolarapi-bolsa' ? 'dolarapi (bolsa)' : tc.fuente === 'tcDiario' ? 'tcDiario (respaldo)' : tc.fuente ?? '—'} · ${ddmm(tc.fechaCotizacion)}` : ''}
            {cv.tcViejo ? <span style={{ color: 'var(--gf-out)' }}> · viejo</span> : null}
          </div>
          <div style={sub}>Calculado {calculada ? `${ddmm(calculada.slice(0, 10))} ${calculada.slice(11, 16)}` : '—'}</div>
        </div>
      </Card>
    </div>
  );
}
