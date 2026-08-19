// F9.144 — Ficha de posición: TENENCIA → INDICADORES → DIAGNÓSTICO.
//
// Todo lo que se muestra sale de Firestore y es verificable contra `preciosDiarios`. La ficha NO
// calcula ni recalcula nada: pinta `indicadoresPosicion` tal como lo dejó el cron de F9.141. Si un
// número no está, es porque el cron no lo pudo calcular, y el cliente tiene menos información que
// el cron, no más.
//
// Va ANTES de AnalisisIASection, que no se toca: primero el dato duro, después la opinión.
// Los fundamentals (P/E, ROE…) llegan por búsqueda web del modelo y son F9.147.
import { Card } from '../design-system/components';
import { Icon } from '../design-system/Icon';
import { motivoDeAusencia, LEYENDA_SEMAFOROS, ETIQUETA_SEMAFORO, ETIQUETA_CAMPO_SEMAFORO } from '../datos/patrimonioPrecios';
import type { IndicadoresPosicion, Semaforo, PosicionTipo } from '../types/patrimonio';

// ── Mínimos de ventana ────────────────────────────────────────────────────────
// GEMELO DECLARADO de functions/src/patrimonioPrecios.ts (`RUEDAS` + las ventanas de cada
// indicador). Está acá para poder EXPLICAR una ausencia ("faltan puntos: 183 de 200"), no para
// recalcular nada: la ficha nunca decide si un indicador existe, sólo por qué no está el que ya
// vino en null. Si el motor cambia una ventana, esta tabla queda desactualizada y el texto va a
// mentir sobre el mínimo — hay que tocar las dos.
const MINIMO_PUNTOS: Record<string, number> = {
  sma20: 20, sma50: 50, sma200: 200,
  vsSma20Pct: 20, vsSma50Pct: 50, vsSma200Pct: 200,
  max52s: 252, min52s: 252, distanciaMax52sPct: 252, distanciaMin52sPct: 252,
  drawdownDesdeMaxPct: 20,
  volAnualizada30d: 31, volAnualizada90d: 91,
  perf1m: 22, perf3m: 64, perf6m: 127, perf1a: 253,
  rsi14: 15, atrPct: 15,
  montoOperadoProm30d: 30,
  ulcerIndex126: 126,
};

// ── Tipos que tienen serie de precios ─────────────────────────────────────────
// Un FCI, una cripto en Nexo o el cash no tienen ficha de indicadores y eso NO es un hueco:
// `motivo: 'sin_fuente'` lo dice. Se listan los que sí, para no prometer bloques vacíos.
const TIPOS_CON_INDICADORES: PosicionTipo[] = ['accion', 'cedear', 'bono', 'on'];

const COLOR_SEMAFORO: Record<Semaforo, string> = {
  verde: 'var(--gf-income)',
  amarillo: 'var(--gf-out)',
  rojo: 'var(--gf-expense)',
  sin_datos: 'var(--gf-gray-300)',
};

const fmtNum = (n: number, dec = 2) => n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtPct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const fmtFecha = (iso: string) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a.slice(2)}`; };

type Campo = { clave: keyof IndicadoresPosicion; label: string; fmt: (v: number) => string; semaforo?: string };

// F9.148 §4 — un `perf1a` en dólares al lado de un drawdown en pesos son dos números que no
// cierran entre sí, y si la ficha no lo dice alguien los va a restar. Cada grupo declara en qué
// moneda está: `serie` = la moneda de la serie (ARS para papeles locales), `usd` = dólares
// siempre, `ninguna` = adimensional (porcentajes de sí mismo, RSI, ratios).
type MonedaGrupo = 'serie' | 'usd' | 'ninguna';

const GRUPOS: Array<{ titulo: string; campos: Campo[]; moneda: MonedaGrupo }> = [
  { titulo: 'Tendencia', moneda: 'serie', campos: [
    { clave: 'sma20',  label: 'SMA 20',  fmt: v => fmtNum(v) },
    { clave: 'vsSma20Pct',  label: 'vs SMA 20',  fmt: fmtPct },
    { clave: 'sma50',  label: 'SMA 50',  fmt: v => fmtNum(v) },
    { clave: 'vsSma50Pct',  label: 'vs SMA 50',  fmt: fmtPct },
    { clave: 'sma200', label: 'SMA 200', fmt: v => fmtNum(v) },
    { clave: 'vsSma200Pct', label: 'vs SMA 200', fmt: fmtPct },
  ]},
  { titulo: 'Rango', moneda: 'serie', campos: [
    { clave: 'max52s', label: 'Máx. 52 sem.', fmt: v => fmtNum(v) },
    // F9.148 §3 — el semáforo se mudó acá desde "Drawdown desde máx.": la banda mide esta
    // ventana fija de 52 semanas, no el máximo de toda la serie retenida.
    { clave: 'distanciaMax52sPct', label: 'Distancia al máx.', fmt: fmtPct, semaforo: 'caida52s' },
    { clave: 'min52s', label: 'Mín. 52 sem.', fmt: v => fmtNum(v) },
    { clave: 'distanciaMin52sPct', label: 'Distancia al mín.', fmt: fmtPct },
  ]},
  { titulo: 'Riesgo', moneda: 'serie', campos: [
    { clave: 'drawdownDesdeMaxPct', label: 'Drawdown desde máx.', fmt: fmtPct },
    // F9.149 — sin semáforo a propósito: no hay base para elegirle bandas, y esta fase existe
    // justamente para dejar de inventarlas.
    { clave: 'ulcerIndex126', label: 'Ulcer Index 126d', fmt: fmtPct },
    { clave: 'volAnualizada30d', label: 'Volatilidad 30d', fmt: fmtPct, semaforo: 'volatilidad' },
    { clave: 'volAnualizada90d', label: 'Volatilidad 90d', fmt: fmtPct },
    { clave: 'atrPct', label: 'ATR %', fmt: fmtPct },
  ]},
  { titulo: 'Performance', moneda: 'usd', campos: [
    { clave: 'perf1m', label: '1 mes',  fmt: fmtPct },
    { clave: 'perf3m', label: '3 meses', fmt: fmtPct },
    { clave: 'perf6m', label: '6 meses', fmt: fmtPct },
    { clave: 'perf1a', label: '1 año',  fmt: fmtPct },
  ]},
  { titulo: 'Momentum', moneda: 'ninguna', campos: [
    { clave: 'rsi14', label: 'RSI 14', fmt: v => fmtNum(v, 1) },
  ]},
];

const CAMPOS_LIQUIDEZ: Campo[] = [
  { clave: 'montoOperadoProm30d', label: 'Monto operado prom. 30d', fmt: v => fmtNum(v, 0) },
  { clave: 'montoOperadoUltimo', label: 'Monto operado último', fmt: v => fmtNum(v, 0) },
  { clave: 'ratioVolumen', label: 'Ratio de volumen', fmt: v => fmtNum(v) },
];

// ── Marca de origen (§4) ──────────────────────────────────────────────────────
// Hoy TODO es calculado, así que la marca no distingue nada todavía. Va igual, porque cuando
// F9.147 sume números REPORTADOS por el modelo vía búsqueda web los dos tipos van a convivir en
// la misma ficha y se van a ver idénticos. Agregarla entonces es cuando se olvida.
export function MarcaOrigen({ tipo }: { tipo: 'calculado' | 'reportado' }) {
  return (
    <span
      title={tipo === 'calculado'
        ? 'Calculado por la app sobre la serie de precios — verificable contra el dato.'
        : 'Reportado por una fuente externa — la app no lo puede verificar.'}
      style={{
        fontSize: 9, fontWeight: 800, letterSpacing: 0.3, padding: '1px 4px', borderRadius: 4,
        background: tipo === 'calculado' ? 'var(--gf-gray-100)' : 'rgba(245,158,11,.18)',
        color: tipo === 'calculado' ? 'var(--gf-gray-400)' : 'var(--gf-out)', flexShrink: 0,
      }}
    >{tipo === 'calculado' ? 'CALC' : 'EXT'}</span>
  );
}

// ── Marca de moneda (F9.148 §4) ───────────────────────────────────────────────
// La performance está en dólares y el resto en la moneda de la serie. Dos números en unidades
// distintas que se ven idénticos necesitan que la diferencia esté a la vista — misma lógica que
// la marca CALC. Cuando la conversión no se pudo hacer, lo dice en vez de mentir.
function MarcaMoneda({ grupo, ind }: { grupo: MonedaGrupo; ind: IndicadoresPosicion | null }) {
  if (!ind || grupo === 'ninguna') return null;
  const moneda = grupo === 'usd' ? (ind.monedaPerformance ?? ind.monedaSerie) : ind.monedaSerie;
  if (!moneda) return null;
  const degradado = grupo === 'usd' && ind.motivoPerfEnMoneda === 'sin_tc_completo';
  return (
    <span
      title={degradado
        ? 'Debería estar en dólares, pero falta tipo de cambio en alguna rueda de la serie: se muestra en la moneda de la serie para no mezclar unidades.'
        : grupo === 'usd'
          ? 'La performance se mide en dólares: en pesos la inflación la vuelve positiva casi siempre.'
          : 'En la moneda en que cotiza la serie. Convertir volatilidad y drawdown a dólares los empeora — medido.'}
      style={{
        fontSize: 9, fontWeight: 800, letterSpacing: 0.3, padding: '1px 4px', borderRadius: 4,
        background: degradado ? 'rgba(245,158,11,.18)' : 'var(--gf-gray-100)',
        color: degradado ? 'var(--gf-out)' : 'var(--gf-gray-400)',
      }}
    >{moneda}{degradado ? ' (sin TC)' : ''}</span>
  );
}

// ── De dónde salen las bandas de caída (F9.149) ───────────────────────────────
// El semáforo `caida52s` no usa un umbral elegido a mano: sale de la distribución de caídas del
// propio papel. Mostrar los dos cortes es lo que hace la banda auditable — un color sin los
// números detrás es lo mismo que un umbral inventado, solo que menos visible.
function CalibracionCaida({ ind }: { ind: IndicadoresPosicion }) {
  const { ddMediana, ddCdar80, ddObservaciones } = ind;
  if (ddMediana == null || ddCdar80 == null) {
    // Sin distribución estimable no se pinta nada de más: el semáforo ya dice `sin_datos`.
    return ddObservaciones !== undefined ? (
      <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', lineHeight: 1.5, marginBottom: 6 }}>
        La banda de <strong>caída</strong> necesita una historia que este papel todavía no tiene
        ({ddObservaciones} observaciones): se muestra como <strong>sin datos suficientes</strong>,
        no con un umbral inventado.
      </div>
    ) : null;
  }
  return (
    <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', lineHeight: 1.5, marginBottom: 6 }}>
      La banda de <strong>caída</strong> se calibra contra este papel, no contra un umbral fijo:
      sobre {ddObservaciones} observaciones de su propia historia, su caída típica es{' '}
      <strong>{fmtPct(-ddMediana)}</strong> y el promedio de su peor 20% es{' '}
      <strong>{fmtPct(-ddCdar80)}</strong>. Verde es estar por encima de lo típico; rojo significa
      que <strong>estuvo así de caído o peor solo una fracción chica del tiempo de su historia</strong>
      {' '}— es porcentaje de <em>tiempo</em>, no probabilidad de que pase algo.
    </div>
  );
}

function Punto({ s }: { s: Semaforo }) {
  return (
    <span
      title={ETIQUETA_SEMAFORO[s]}
      style={{
        width: 8, height: 8, borderRadius: 999, background: COLOR_SEMAFORO[s], flexShrink: 0,
        // `sin_datos` no puede verse como un verde apagado: un indicador ausente no es un
        // indicador sano. Se le deja el borde para que se lea como hueco, no como estado.
        border: s === 'sin_datos' ? '1px solid var(--gf-gray-400)' : 'none',
        display: 'inline-block',
      }}
    />
  );
}

function Fila({ label, valor, semaforo, nota }: { label: string; valor: string; semaforo?: Semaforo; nota?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 12 }}>
      {semaforo ? <Punto s={semaforo} /> : <span style={{ width: 8, flexShrink: 0 }} />}
      <span style={{ color: 'var(--color-text-sec)', flex: 1, minWidth: 0 }}>{label}</span>
      <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{valor}</span>
      {nota && <span style={{ fontSize: 10, color: 'var(--gf-gray-400)' }}>{nota}</span>}
    </div>
  );
}

const ESTADO_SERIE_TXT: Record<string, { txt: string; tone: string }> = {
  limpia: { txt: 'serie limpia', tone: 'var(--gf-income)' },
  sospechosa: { txt: 'serie sospechosa', tone: 'var(--gf-out)' },
  sin_serie: { txt: 'sin serie', tone: 'var(--gf-gray-400)' },
};

export type PosicionFicha = {
  ticker: string;
  tipo: PosicionTipo;
  paisRiesgo: string;
  cuenta: string;
  cantidad: number | null;
  valorUsd: number;
  monedaOrigen: string;
};

export default function FichaPosicion({ ident, filas, ind, privado }: {
  ident: string;                       // "TICKER|tipo|pais", para el encabezado cuando hay ambigüedad
  filas: PosicionFicha[];              // las posiciones de ESA identidad (puede haber varias cuentas)
  ind: IndicadoresPosicion | null;
  privado: boolean;
}) {
  const primera = filas[0];
  const totalUsd = filas.reduce((s, f) => s + f.valorUsd, 0);
  const cantidadTotal = filas.every(f => f.cantidad !== null)
    ? filas.reduce((s, f) => s + (f.cantidad ?? 0), 0)
    : null;
  const motivo = motivoDeAusencia(ind);
  const esperaIndicadores = TIPOS_CON_INDICADORES.includes(primera.tipo);
  const tieneDatos = !!ind && ind.motivo === null && ind.precio !== null;

  /** Un campo se muestra si tiene valor; si no, se explica por qué falta. Nunca un guión mudo. */
  function filaDe(c: Campo): JSX.Element | null {
    if (!ind) return null;
    const v = ind[c.clave] as number | null | undefined;
    const sem = c.semaforo ? ind.semaforos?.[c.semaforo] : undefined;
    if (v !== null && v !== undefined) {
      return <Fila key={String(c.clave)} label={c.label} valor={privado ? '•••' : c.fmt(v)} semaforo={sem} />;
    }
    const min = MINIMO_PUNTOS[String(c.clave)];
    if (min && ind.puntosDisponibles < min) {
      return (
        <Fila key={String(c.clave)} label={c.label}
          valor={`faltan puntos (${ind.puntosDisponibles} de ${min})`} semaforo={sem} />
      );
    }
    return null; // ausente por otra razón (ej. ATR sin OHLC): no se inventa una explicación
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10, marginBottom: 4 }}>

      {/* ── TENENCIA ──────────────────────────────────────────────────────── */}
      <Card padding="12px">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: 'var(--gf-gray-400)' }}>TENENCIA</div>
          <MarcaOrigen tipo="calculado" />
          {ind && ind.motivo === null && (
            <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: ESTADO_SERIE_TXT[ind.estadoSerie]?.tone ?? 'var(--gf-gray-400)' }}>
              {ESTADO_SERIE_TXT[ind.estadoSerie]?.txt ?? ind.estadoSerie} · {ind.puntosDisponibles} ruedas
            </span>
          )}
        </div>

        <Fila label="Identidad" valor={ident} />
        <Fila label="Tipo" valor={`${primera.tipo} · ${primera.paisRiesgo}`} />
        <Fila label="Cuenta" valor={filas.map(f => f.cuenta).join(' · ')} />
        {cantidadTotal !== null && <Fila label="Cantidad" valor={privado ? '•••' : fmtNum(cantidadTotal, 0)} />}

        {/* La fecha del precio va AL LADO del precio, no en un pie: la app mostró ACN valuada al
            17/07 mientras el dueño usaba el precio del 12/08. Un precio sin fecha induce a error. */}
        {ind?.precio !== null && ind?.precio !== undefined ? (
          <Fila
            label="Precio"
            valor={privado ? '•••' : `${ind.monedaSerie === 'USD' ? 'U$S ' : '$ '}${fmtNum(ind.precio)}`}
            nota={ind.fechaUltimoPrecio ? `al ${fmtFecha(ind.fechaUltimoPrecio)}` : undefined}
          />
        ) : null}
        <Fila label="Valor actual" valor={privado ? '•••' : `U$S ${fmtNum(totalUsd, 0)}`} />
        {ind?.pesoEnCartera !== null && ind?.pesoEnCartera !== undefined && (
          <Fila label="Peso en cartera" valor={`${(ind.pesoEnCartera * 100).toFixed(2)}%`} semaforo={ind.semaforos?.peso} />
        )}

        {/* Nunca un campo vacío sin explicación. */}
        {motivo && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--gf-gray-100)', fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.45 }}>
            <Icon name="triangle-alert" size={12} color="var(--gf-out)" style={{ marginRight: 5, verticalAlign: 'middle' }} />
            {motivo}
          </div>
        )}
        {!ind && !esperaIndicadores && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--gf-gray-100)', fontSize: 11.5, color: 'var(--color-text-sec)' }}>
            Este tipo de activo no tiene serie de precios en la app.
          </div>
        )}
      </Card>

      {/* ── INDICADORES ───────────────────────────────────────────────────── */}
      {tieneDatos && ind && (
        <Card padding="12px">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: 'var(--gf-gray-400)' }}>INDICADORES</div>
            <MarcaOrigen tipo="calculado" />
          </div>

          {/* `ruedasParaSalir` va arriba y con lugar propio, no perdido entre ratios: es la
              respuesta a "si quiero reducir, ¿en cuántos días salgo sin mover el precio?", y en
              BYMA con papeles finos es un dato de decisión que ninguna ficha estándar trae. */}
          <div style={{ background: 'var(--gf-gray-50)', borderRadius: 10, padding: '9px 11px', marginBottom: 10 }}>
            {/* F9.148 §3 — sin semáforo: `ruedasParaSalir` va de 2,3e-6 a 1,8e-2 en las 16
                posiciones y daba verde en las 15 con dato. Una banda que nunca cambia de color
                entrena a no mirar. El número queda, que es lo que sí decide. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>Ruedas para salir</span>
              <span style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {ind.ruedasParaSalir !== null ? fmtNum(ind.ruedasParaSalir, 1) : '—'}
              </span>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 3, lineHeight: 1.4 }}>
              {ind.ruedasParaSalir !== null
                ? 'Días de rueda para liquidar la posición sin dominar el volumen operado.'
                : 'Sin monto operado publicado por la fuente para este papel.'}
            </div>
          </div>

          {GRUPOS.map(g => {
            const filasG = g.campos.map(filaDe).filter(Boolean);
            if (filasG.length === 0) return null;
            return (
              <div key={g.titulo} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gf-gray-400)', letterSpacing: 0.3 }}>{g.titulo.toUpperCase()}</div>
                  <MarcaMoneda grupo={g.moneda} ind={ind} />
                </div>
                {filasG}
              </div>
            );
          })}

          {(() => {
            const filasL = CAMPOS_LIQUIDEZ.map(filaDe).filter(Boolean);
            if (filasL.length === 0) return null;
            return (
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gf-gray-400)', letterSpacing: 0.3, marginBottom: 2 }}>LIQUIDEZ</div>
                {filasL}
              </div>
            );
          })()}
        </Card>
      )}

      {/* ── DIAGNÓSTICO ───────────────────────────────────────────────────── */}
      {tieneDatos && ind && Object.keys(ind.semaforos ?? {}).length > 0 && (
        <Card padding="12px">
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: 'var(--gf-gray-400)', marginBottom: 8 }}>DIAGNÓSTICO</div>
          {/* NO hay semáforo agregado por posición: componerlo obligaría a ponderar indicadores
              entre sí con pesos arbitrarios, y un verde compuesto escondería un rojo de liquidez
              detrás de tres verdes de tendencia. Se pintan de a uno. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {Object.entries(ind.semaforos).map(([k, s]) => (
              <span key={k} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5,
                background: 'var(--gf-gray-50)', borderRadius: 999, padding: '4px 9px',
              }}>
                <Punto s={s} />
                <span style={{ fontWeight: 600 }}>{ETIQUETA_CAMPO_SEMAFORO[k] ?? k}</span>
                <span style={{ color: 'var(--gf-gray-400)' }}>{ETIQUETA_SEMAFORO[s]}</span>
              </span>
            ))}
          </div>
          <CalibracionCaida ind={ind} />
          <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', lineHeight: 1.5 }}>
            {LEYENDA_SEMAFOROS}
            {' '}Un indicador <strong>sin datos suficientes</strong> se muestra como tal y no cuenta
            como verde. <strong>CALC</strong> = calculado por la app sobre la serie de precios.
          </div>
        </Card>
      )}
    </div>
  );
}
