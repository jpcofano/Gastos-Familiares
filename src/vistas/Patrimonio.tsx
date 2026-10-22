import { Fragment, useState, useEffect, useMemo, useRef, createContext, useContext } from 'react';
import { Timestamp } from 'firebase/firestore';
import { cargarTCReciente, cargarEstadoTcDiario, backfillTcDiario, tcEfectivoDe, type EstadoTcDiario, type ResultadoBackfillTc } from '../datos/tcDiario';
import { Card, MerchantLogo, MoneyInput } from '../design-system/components';
import { usePrivacidad, fmtPct, BasePrivacidad } from '../contexto/PrivacidadContext';
import { Icon } from '../design-system/Icon';
import {
  cargarPosicionesVigentes, cargarActivosFijos, cargarPosicionesManuales,
  cargarHistorialSnapshots,
  guardarActivoFijo, eliminarActivoFijo,
  guardarPosicionManual, eliminarPosicionManual,
  exportarCorridaTxt, exportarDossierJson,
  cargarConfigRiesgo, guardarConfigRiesgo,
  type SnapshotResumen,
} from '../datos/patrimonio';
import {
  generarYArchivarInforme, cargarInformesAnteriores,
  type InformeAnterior, type StressResult, type OpcionResult,
} from '../datos/patrimonioInforme';
import {
  analizarPosicion, analizarSectorial, generarAgenda, analizarManuales,
  cargarAnalisisPosicion, cargarTodosLosAnalisis, cargarUltimoSectorial, cargarUltimaAgenda,
  cargarUltimoGlobal, type AnalisisGlobal,
  cargarConfigIA, guardarConfigIA,
  normalizarEventoProximo,
  generarPromptIA, importarAnalisisIA,
  splitSectorialPorDriver, tickerADriver, contextoPosicion,
  type AnalisisPosicion, type AnalisisSectorial, type ConfigIA,
  type AgendaMacro, type EventoAgenda, type ModoIA,
  type Fundamentals, type Recomendacion,
} from '../datos/patrimonioIA';
import {
  obtenerSeriesPrecios, calcularOptimizacion, cargarTCRango, dolarizarSerie, correrTests,
  cargarUltimaOptimizacion, guardarOptimizacion, testMinVarAnalitico, testMinVarConstraintWmax,
  type ResultadoOptimizacion, type PuntoPrecio, type DiagnosticoSerie,
} from '../datos/patrimonioOptimizacion';
import type { Posicion, ActivoFijo, PosicionManual, PosicionTipo, PatMetrics, IndicadoresPosicion } from '../types/patrimonio';
import { cargarIndicadoresPorIdentidad } from '../datos/patrimonioPrecios';
import FichaPosicion, { MarcaOrigen, type PosicionFicha } from './FichaPosicion';
import {
  cargarFlujos, crearFlujo, actualizarFlujo, eliminarFlujo, calcRetorno,
  type FlujoPatrimonio, type NuevoFlujo,
} from '../datos/patrimonioFlujos';
import {
  cargarDecisiones, crearDecision, agregarRevision, revisionPendiente,
  type DecisionPatrimonio, type NuevaDecision, type MetricasSnap,
} from '../datos/patrimonioDecisiones';
import {
  cargarConfigCafci, guardarConfigCafci, cargarUltimasCarteras, cargarMappings,
  sincronizarCafci as sincronizarCafciCallable, calcBenchmark,
  importarFondosSugeridos, importarMappingSeed,
  importarCafciManual as importarCafciManualCallable, fechaDatosDeFondo,
  testsGemeloNormalizarEspecie,
  cargarUniversoVigente, fondosDeUniverso, pesosDeUniverso,
  type ConfigCafci, type CafciCartera, type CafciFondoConfig, type ResultadoSincronizarCafci,
  type ResultadoImportarCafciManual, type UniversoCafci,
} from '../datos/patrimonioCafci';
import { cargarFactoresTicker, importarFactoresSeed, cargarCustodiaCuenta, guardarCustodiaCuenta } from '../datos/patrimonioFactores';
import {
  cargarDeclaraciones, guardarDeclaracion, clasificarExposiciones,
  NOTA_MINIMA, UMBRAL_MATERIALIDAD, UMBRAL_DERIVADA,
  type Declaracion, type Exposicion,
} from '../datos/patrimonioDeclaraciones';
import PatrimonioIngesta from './PatrimonioIngesta';
import PatrimonioBalanz from './PatrimonioBalanz';
import { posicionesDeCarteraViva } from '../datos/patrimonioCarteraViva';
import { cargarTodasLasTesis } from '../datos/patrimonioTesis';
import type { DocTesis } from '../datos/compartido/tesis';
import { accionesAMirar, ordenarTenencias, type OrdenTenencias } from '../datos/patrimonioAccionesAMirar';
import AccionesAMirarCard from './AccionesAMirarCard';
import { Plegable } from './FichaStopsTesis';
import ParaDecidirCard from './ParaDecidirCard';
import { cargarCarteraViva, sincronizarPPIAhora, sincronizarBitfinexAhora, recalcularCarteraViva, type DocCarteraViva } from '../datos/patrimonioCarteraVivaLectura';

/** F9.196 H2a — el valor de hoy como dato aparte para el informe (que sigue sobre la corrida). */
function resumenValorDeHoy(cv: DocCarteraViva | null) {
  if (!cv) return null;
  return {
    nota: 'Dato aparte: el análisis de arriba es sobre la corrida; esto es la cartera valuada hoy (cartera viva).',
    totalUsd: cv.totalUsd, calculadoEnISO: cv.calculadaEnISO,
    ultimaCarga: { fecha: cv.fechaCorrida, totalUsd: cv.totalCargaUsd },
    efectoPreciosUsd: cv.efectoPreciosUsd, efectoDolarUsd: cv.efectoDolarUsd, efectoMovimientosUsd: cv.efectoMovimientosUsd,
    mep: cv.tc ? { valor: cv.tc.valor, fecha: cv.tc.fechaCotizacion, viejo: cv.tc.viejo } : null,
    frescura: cv.frescura,
  };
}
// F9.190 — informe v2 (contexto con el motor de riesgo) y señales de mercado de la reserva.
import {
  contextoInformeV3, contextoPosicionesV3, evaluarSenales, UMBRALES_SENALES,
  type SenalEvaluada, type LecturaMercado, type BasesMercado,
} from '../datos/patrimonioInformeV2';
import { cargarUltimaLecturaSenales, actualizarSenales } from '../datos/patrimonioSenales';
// F9.195 (sistema cripto) — política propia del bloque cripto, evaluación pura y lectura diaria.
import {
  evaluarSistemaCripto, validarPoliticaCripto, CRIPTO_DEFAULTS, GRUPOS_CRIPTO, GRUPO_CRIPTO_LABEL,
  type PoliticaCripto, type DiaCripto,
} from '../datos/patrimonioCripto';
import {
  cargarLecturaCripto, cargarHistorialCripto, actualizarPreciosCripto, cargarPoliticaCripto, guardarPoliticaCripto,
  type EstadoCripto,
} from '../datos/patrimonioCriptoLectura';
// F9.116 §1 — calcMetrics/sectorDisplay salieron de este archivo a un módulo puro y
// reusable; la lógica no cambió.
import { calcMetrics, sectorDisplay, SECTOR_DISPLAY, manualToPosicion } from '../datos/patrimonioMetricas';
// F9.116 §2 — motor único de escenarios: los cuatro idiosincráticos que vivían acá se
// movieron al módulo y conviven con los sistémicos por beta. Una sola fuente de números.
import {
  ESCENARIOS, calcEscenarios, calcBrecha, calcMixObjetivo, violacionesBandas,
  RIESGO_DEFAULTS, ESCENARIO_TITULAR, BLOQUE_LABEL, inferenciasDeBloque, posicionesInvertibles, bloqueDe,
  exposicionArgentina, FACTOR_LABEL, FACTOR_AMBIGUO, FACTOR_ENERGIA, type Factor,
  exposicionContraparte, escenariosContraparteDe, CUSTODIA_LABEL, type Custodia,
  type ResultadoEscenario, type ViolacionBanda, type MixObjetivo, type TopesRiesgo, type Bloque,
} from '../datos/patrimonioRiesgo';

const SECTOR_COL: Record<string, string> = {
  'Energía AR':       '#f5a623',
  'Energía Global':   '#f7c843',
  'Cripto':           '#f7931a',
  'Renta fija AR':    '#4f8ef7',
  'Renta fija Global':'#7ba7f7',
  'Bancos AR':        '#2bb673',
  'ONs AR':           '#6366f1',
  'Cash':             '#94a3b8',
  'Tecnología Global':'#a855f7',
  'Global':           '#a855f7',
  'Consumo AR':       '#ec4899',
  'FCI AR':           '#14b8a6',
};
function sectorColor(disp: string): string { return SECTOR_COL[disp] ?? '#8b8b8b'; }

// ── Snapshot de métricas para decisiones ──────────────────────────────────────
function buildMetricasSnap(M: PatMetrics, todasPosiciones: Posicion[]): MetricasSnap {
  const byTicker: Record<string, number> = {};
  for (const p of todasPosiciones) byTicker[p.ticker] = (byTicker[p.ticker] ?? 0) + p.valorUsd;
  return {
    totalInvertibleUsd: Math.round(M.total),
    energiaArPct: (M.bySector['Energía AR'] ?? 0) / (M.total || 1),
    paisArPct: M.paisAr,
    criptoPct: M.cripto,
    top1Ticker: M.nombreTop.ticker,
    top1Pct: M.top1,
    hhi: M.hhi,
    valoresTickers: Object.fromEntries(Object.entries(byTicker).map(([k, v]) => [k, Math.round(v)])),
  };
}

const UMBRAL_OTROS = 0.019;

// ── Labels ────────────────────────────────────────────────────────────────────
const TIPO_LABEL: Record<string, string> = {
  accion: 'Acción', bono: 'Bono', on: 'ON', cedear: 'CEDEAR',
  fci: 'FCI', cripto: 'Cripto', cash: 'Cash',
};

// ── Formateo ──────────────────────────────────────────────────────────────────
function fmtUsd(n: number): string { return `U$S ${Math.round(n).toLocaleString('es-AR')}`; }
// F9.172 §3 — espacio duro: el monto no se parte entre signo y numero.
function fmtArs(n: number, tc: number): string { return `$ ${Math.round(n * tc).toLocaleString('es-AR')}`; }

// F9.121 — modo privacidad en pantalla. Patrimonio no tiene un componente `Money` único (son
// 4.300 líneas y 12 componentes con estilos propios), así que el modo se implementa acá: un
// solo lugar decide si el número sale en plata o en %.
//
// La base viaja por contexto y no por parámetro: 7 de los 12 componentes que muestran plata no
// reciben `M` (PosicionesManualesCard, ActivosFijosCard, AportesRetirosCard, OpcionCard, los
// dos modales de decisiones y DiarioDecisiones). Pasarles un `base` por props obligaría a que
// cada uno eligiera el suyo —y algunos tienen un total local a mano, que es justo el
// denominador equivocado—. Con un provider único, la base es una sola por construcción, que es
// lo que pide la Sección 2 del spec.
const BaseDineroCtx = createContext(0);

function useDinero() {
  const { privado } = usePrivacidad();
  const base = useContext(BaseDineroCtx);
  return {
    privado,
    // Valor absoluto → % de la base, o el monto en USD.
    // fmtPct ya resuelve base cero, signo y <1% / >-1% (F9.120): no se reimplementa nada acá.
    usd: (n: number) => privado ? fmtPct(n, base) : fmtUsd(n),
    // Gemelo en pesos: con el modo activo devuelve '' y la línea NO se renderiza.
    ars: (n: number, tc: number) => privado ? '' : fmtArs(n, tc),
  };
}
function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
const pct = (x: number) => Math.round(x * 100) + '%';

// ── Semáforos ─────────────────────────────────────────────────────────────────
type BandaNombre = 'nombre' | 'sector' | 'pais' | 'cripto' | 'hhi';
const BANDAS: Record<BandaNombre, [number, number]> = {
  nombre: [0.05, 0.10],
  sector: [0.25, 0.40],
  pais:   [0.40, 0.60],
  cripto: [0.10, 0.20],
  hhi:    [0.15, 0.25],
};
function banda(m: BandaNombre, v: number): 'verde' | 'amarillo' | 'rojo' {
  const [b0, b1] = BANDAS[m];
  return v <= b0 ? 'verde' : v <= b1 ? 'amarillo' : 'rojo';
}
const SEM = {
  verde:    { dot: 'var(--gf-emerald)',  bg: 'var(--gf-emerald-50)' },
  amarillo: { dot: 'var(--gf-out)',      bg: 'var(--gf-gray-100)' },
  rojo:     { dot: 'var(--gf-expense)',  bg: 'var(--gf-gray-100)' },
} as const;

// ── Simulación de opciones de rebalanceo ──────────────────────────────────────
type Corte = { tipo: 'ticker' | 'sector'; key: string; targetPct: number };
type Redespliegue = { ticker: string; tipo: PosicionTipo; sector: string; pais_riesgo: 'AR' | 'global'; fraccion: number };
type OpcionConfig = {
  id: 'A' | 'B' | 'C';
  titulo: string;
  descripcion: string;
  cortes: Corte[];
  redespliegues: Redespliegue[];
  riesgos: string[];
};

const OPCIONES_CONFIG: OpcionConfig[] = [
  {
    id: 'A',
    titulo: 'Recorte mínimo',
    descripcion: 'TRAN al 8% y PAMP al 6%; liberado → RV global',
    cortes: [
      { tipo: 'ticker', key: 'TRAN', targetPct: 0.08 },
      { tipo: 'ticker', key: 'PAMP', targetPct: 0.06 },
    ],
    redespliegues: [
      { ticker: 'RV Global', tipo: 'accion', sector: 'global', pais_riesgo: 'global', fraccion: 1.0 },
    ],
    riesgos: [
      'Costo impositivo: TRAN y PAMP son ganadoras en USD.',
      'Upside resignado si energía AR continúa subiendo.',
      'Nuevo riesgo: exposición a mercado global.',
    ],
  },
  {
    id: 'B',
    titulo: 'Diversificar dentro de AR',
    descripcion: 'Energía AR al 35%; liberado mitad a otros sectores AR, mitad a RV global',
    cortes: [
      { tipo: 'sector', key: 'Energía AR', targetPct: 0.35 },
    ],
    redespliegues: [
      { ticker: 'RV AR otros', tipo: 'accion', sector: 'consumo', pais_riesgo: 'AR', fraccion: 0.5 },
      { ticker: 'RV Global',   tipo: 'accion', sector: 'global',  pais_riesgo: 'global', fraccion: 0.5 },
    ],
    riesgos: [
      'Costo impositivo: posiciones de energía AR son ganadoras.',
      'Diversificación intra-AR no elimina el riesgo soberano.',
      'Complejidad operativa: algunas posiciones en cuentas conjuntas.',
    ],
  },
  {
    id: 'C',
    titulo: 'Giro global',
    descripcion: 'Energía AR al 25% y cripto al 15%; liberado → RV global',
    cortes: [
      { tipo: 'sector', key: 'Energía AR', targetPct: 0.25 },
      { tipo: 'sector', key: 'Cripto',     targetPct: 0.15 },
    ],
    redespliegues: [
      { ticker: 'RV Global', tipo: 'accion', sector: 'global', pais_riesgo: 'global', fraccion: 1.0 },
    ],
    riesgos: [
      'Costo impositivo alto: múltiples posiciones ganadoras.',
      'Upside resignado en energía AR y cripto.',
      'Mayor exposición a riesgo de mercado global y divisa.',
    ],
  },
];

function simularOpcion(posiciones: Posicion[], opcion: OpcionConfig) {
  const total = posiciones.reduce((s, p) => s + p.valorUsd, 0);
  const antes = calcMetrics(posiciones);
  const ajustadas = posiciones.map(p => ({ ...p }));
  let liberadoUsd = 0;
  const movimientos: { desc: string; deltaUsd: number }[] = [];

  for (const c of opcion.cortes) {
    const targets = ajustadas.filter(p =>
      c.tipo === 'ticker'
        ? p.ticker === c.key
        : sectorDisplay(p.sector, p.pais_riesgo) === c.key
    );
    const actualUsd = targets.reduce((s, p) => s + p.valorUsd, 0);
    const targetUsd = c.targetPct * total;
    if (actualUsd > targetUsd) {
      const delta = actualUsd - targetUsd;
      const factor = targetUsd / actualUsd;
      targets.forEach(p => { p.valorUsd = p.valorUsd * factor; });
      liberadoUsd += delta;
      movimientos.push({ desc: c.key, deltaUsd: -delta });
    }
  }

  for (const r of opcion.redespliegues) {
    const monto = liberadoUsd * r.fraccion;
    if (monto > 0) {
      ajustadas.push({
        ticker: r.ticker, tipo: r.tipo, sector: r.sector, pais_riesgo: r.pais_riesgo,
        cuenta: 'Redespliegue', titular: null, moneda_origen: 'USD', valor_origen: monto,
        cantidad: null, fuente: 'simulacion', revisar: false,
        valorUsd: monto, tcUsado: null, fechaCorrida: '',
      });
      movimientos.push({ desc: r.ticker, deltaUsd: monto });
    }
  }

  return { liberadoUsd, movimientos, antes, despues: calcMetrics(ajustadas), total };
}

// ── Barra apilada ─────────────────────────────────────────────────────────────
function CompBar({ M }: { M: PatMetrics }) {
  const $ = useDinero();
  const [mostrarOtros, setMostrarOtros] = useState(false);
  const segs = Object.entries(M.bySector).sort((a, b) => b[1] - a[1]);
  const mayores = segs.filter(([, v]) => v / M.total >= UMBRAL_OTROS);
  const menores = segs.filter(([, v]) => v / M.total < UMBRAL_OTROS);
  const otrosUsd = menores.reduce((s, [, v]) => s + v, 0);
  return (
    <div>
      <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', marginBottom: 14, background: 'var(--gf-gray-100)' }}>
        {segs.map(([k, v]) => (
          <div key={k} title={k} style={{ width: pct(v / M.total), background: sectorColor(k) }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {mayores.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: sectorColor(k), flexShrink: 0 }} />
            <span style={{ fontWeight: 600 }}>{k}</span>
            {/* F9.121 — el chip de la derecha ya es el % sobre M.total, la misma base del modo
                privacidad: convertir el absoluto mostraría el mismo número dos veces. Se oculta
                (mismo criterio que la Sección 3 para las filas que ya traen un pct()). */}
            {!$.privado && <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{$.usd(v)}</span>}
            <span style={{ marginLeft: $.privado ? 'auto' : undefined, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{pct(v / M.total)}</span>
          </div>
        ))}
        {menores.length > 0 && (
          <>
            <div
              onClick={() => setMostrarOtros(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--gf-gray-300)', flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: 'var(--color-text-sec)' }}>Otros ({menores.length})</span>
              {!$.privado && <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-sec)' }}>{$.usd(otrosUsd)}</span>}
              <span style={{ marginLeft: $.privado ? 'auto' : undefined, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{pct(otrosUsd / M.total)}</span>
              <Icon name={mostrarOtros ? 'chevron-up' : 'chevron-down'} size={13} color="var(--gf-gray-400)" />
            </div>
            {mostrarOtros && menores.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, paddingLeft: 17 }}>
                <span style={{ width: 8, height: 8, borderRadius: 3, background: sectorColor(k), flexShrink: 0 }} />
                <span style={{ fontWeight: 600, color: 'var(--color-text-sec)' }}>{k}</span>
                {!$.privado && <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-sec)' }}>{$.usd(v)}</span>}
                <span style={{ marginLeft: $.privado ? 'auto' : undefined, fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '1px 7px' }}>{pct(v / M.total)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Modal editar / agregar posición manual ────────────────────────────────────
function ModalPosicionManual({
  pm, onGuardar, onEliminar, onClose,
}: {
  pm: PosicionManual | null;
  onGuardar: (pm: PosicionManual) => void;
  onEliminar?: (id: string) => void;
  onClose: () => void;
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [ticker,   setTicker]   = useState(pm?.ticker   ?? '');
  const [nombre,   setNombre]   = useState(pm?.nombre   ?? '');
  const [cantidad, setCantidad] = useState(pm ? String(pm.cantidad) : '');
  const [valorStr, setValorStr] = useState(pm ? String(pm.valorUsd) : '');
  const [fecha,    setFecha]    = useState(pm?.fechaValuacion ?? hoy);
  const [sector,   setSector]   = useState(pm?.sector   ?? 'tech');
  const [notas,    setNotas]    = useState(pm?.notas    ?? '');
  const id = pm?.id ?? ('manual_' + Date.now());
  const valid = ticker.trim().length > 0 && Number(valorStr) > 0 && Number(cantidad) > 0;

  function guardar() {
    if (!valid) return;
    onGuardar({
      id, ticker: ticker.trim().toUpperCase(), nombre: nombre.trim() || ticker.trim().toUpperCase(),
      cantidad: Number(cantidad), valorUsd: Number(valorStr), fechaValuacion: fecha,
      tipo: 'accion', sector: sector.trim() || 'tech', pais_riesgo: 'global',
      cuenta: pm?.cuenta ?? ('Plan empleado ' + ticker.trim().toUpperCase()), notas,
    });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', background: 'var(--color-surface)', borderRadius: '20px 20px 0 0', padding: '22px 18px 36px', maxHeight: '90dvh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>{pm ? 'Editar posición' : 'Nueva posición manual'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={20} color="var(--color-text)" />
          </button>
        </div>
        {([
          { label: 'Ticker', val: ticker, set: setTicker, type: 'text' as const, placeholder: 'ACN' },
          { label: 'Nombre (opcional)', val: nombre, set: setNombre, type: 'text' as const, placeholder: 'Accenture' },
          { label: 'Cantidad', val: cantidad, set: setCantidad, type: 'number' as const, placeholder: '50' },
          { label: 'Valor total (USD)', val: valorStr, set: setValorStr, type: 'number' as const, placeholder: '6870' },
          { label: 'Fecha valuación', val: fecha, set: setFecha, type: 'date' as const, placeholder: '' },
          { label: 'Sector', val: sector, set: setSector, type: 'text' as const, placeholder: 'tech' },
          { label: 'Notas (opcional)', val: notas, set: setNotas, type: 'text' as const, placeholder: '' },
        ]).map(f => (
          <div key={f.label} style={{ marginBottom: 13 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', marginBottom: 5 }}>{f.label}</div>
            <input
              type={f.type} value={f.val} placeholder={f.placeholder}
              onChange={e => f.set(e.target.value)}
              style={{ width: '100%', padding: '11px 13px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', fontSize: 14, fontFamily: 'var(--font-base)', background: 'var(--gf-gray-50)', boxSizing: 'border-box' }}
            />
          </div>
        ))}
        <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginBottom: 14, lineHeight: 1.4 }}>
          Entra al análisis de riesgo (métricas, semáforos). País: global fijo.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {pm && onEliminar && (
            <button onClick={() => onEliminar(pm.id)} style={{ padding: '12px 14px', borderRadius: 11, border: '1px solid rgba(220,38,38,.3)', background: 'rgba(220,38,38,.06)', color: 'var(--gf-expense)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
              <Icon name="trash-2" size={14} color="var(--gf-expense)" />
            </button>
          )}
          <button onClick={onClose} style={{ flex: 1, padding: '12px 14px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={!valid} style={{ flex: 2, padding: '12px 14px', borderRadius: 11, border: 'none', background: valid ? 'var(--color-accent)' : 'var(--gf-gray-200)', color: valid ? '#fff' : 'var(--gf-gray-400)', fontSize: 14, fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'var(--font-base)' }}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Card posiciones manuales ──────────────────────────────────────────────────
function PosicionesManualesCard({ manuales, fechaCorrida, onEdit, onAdd }: {
  manuales: PosicionManual[];
  fechaCorrida: string;
  onEdit: (pm: PosicionManual) => void;
  onAdd: () => void;
}) {
  const $ = useDinero();
  const total = manuales.reduce((s, m) => s + m.valorUsd, 0);
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Posiciones manuales</span>
        <button onClick={onAdd} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 8, border: 'none', background: 'none', fontSize: 12, fontWeight: 700, color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
          <Icon name="plus" size={13} color="var(--color-accent)" /> Agregar
        </button>
      </div>
      {manuales.map((m, i) => {
        const stale = fechaCorrida && m.fechaValuacion < fechaCorrida;
        return (
          <div key={m.id} style={{ padding: '8px 0', borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{m.ticker}</span>
                <span style={{ fontSize: 12, color: 'var(--color-text-sec)', marginLeft: 6 }}>{m.cantidad} acc · {m.cuenta}</span>
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{$.usd(m.valorUsd)}</span>
              <button onClick={() => onEdit(m)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <Icon name="pencil" size={14} color="var(--gf-gray-400)" />
              </button>
            </div>
            {stale && (
              <div style={{ fontSize: 10.5, color: 'var(--gf-out)', marginTop: 3 }}>
                Valuación anterior a la última corrida ({fmtFecha(m.fechaValuacion)})
              </div>
            )}
          </div>
        );
      })}
      {manuales.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800, borderTop: '1px solid var(--gf-gray-200)', paddingTop: 8, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
          <span>Total manuales</span>
          <span>{$.usd(total)}</span>
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 6, lineHeight: 1.4 }}>
        Entra al análisis · planes de empleado sin API
      </div>
    </Card>
  );
}

// ── Modal editar / agregar activo fijo ────────────────────────────────────────
function ModalActivoFijo({
  af, onGuardar, onEliminar, onClose,
}: {
  af: ActivoFijo | null;
  onGuardar: (af: ActivoFijo) => void;
  onEliminar?: (id: string) => void;
  onClose: () => void;
}) {
  const [nombre,   setNombre]   = useState(af?.nombre   ?? '');
  const [valorStr, setValorStr] = useState(af ? String(af.valorUsd) : '');
  const [notas,    setNotas]    = useState(af?.notas     ?? '');
  const id = af?.id ?? ('fijo_' + Date.now());
  const valid = nombre.trim().length > 0 && Number(valorStr) > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', background: 'var(--color-surface)', borderRadius: '20px 20px 0 0', padding: '22px 18px 36px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>{af ? 'Editar activo' : 'Nuevo activo'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={20} color="var(--color-text)" />
          </button>
        </div>
        {([
          { label: 'Nombre', val: nombre, set: setNombre, type: 'text' as const },
          { label: 'Valor (USD)', val: valorStr, set: setValorStr, type: 'number' as const },
          { label: 'Notas (opcional)', val: notas, set: setNotas, type: 'text' as const },
        ]).map(f => (
          <div key={f.label} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', marginBottom: 5 }}>{f.label}</div>
            <input
              type={f.type} value={f.val}
              onChange={e => f.set(e.target.value)}
              style={{ width: '100%', padding: '11px 13px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', fontSize: 14, fontFamily: 'var(--font-base)', background: 'var(--gf-gray-50)', boxSizing: 'border-box' }}
            />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          {af && onEliminar && (
            <button onClick={() => onEliminar(af.id)} style={{ padding: '12px 14px', borderRadius: 11, border: '1px solid rgba(220,38,38,.3)', background: 'rgba(220,38,38,.06)', color: 'var(--gf-expense)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
              <Icon name="trash-2" size={14} color="var(--gf-expense)" />
            </button>
          )}
          <button onClick={onClose} style={{ flex: 1, padding: '12px 14px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
            Cancelar
          </button>
          <button
            onClick={() => valid && onGuardar({ id, nombre: nombre.trim(), valorUsd: Number(valorStr), pais: af?.pais ?? 'AR', notas })}
            disabled={!valid}
            style={{ flex: 2, padding: '12px 14px', borderRadius: 11, border: 'none', background: valid ? 'var(--color-accent)' : 'var(--gf-gray-200)', color: valid ? '#fff' : 'var(--gf-gray-400)', fontSize: 14, fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'var(--font-base)' }}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Card activos fijos ────────────────────────────────────────────────────────
function ActivosFijosCard({ activosFijos, onEdit, onAdd }: {
  activosFijos: ActivoFijo[];
  onEdit: (af: ActivoFijo) => void;
  onAdd: () => void;
}) {
  const $ = useDinero();
  const total = activosFijos.reduce((s, a) => s + a.valorUsd, 0);
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Activos fijos</span>
        <button onClick={onAdd} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 8, border: 'none', background: 'none', fontSize: 12, fontWeight: 700, color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
          <Icon name="plus" size={13} color="var(--color-accent)" /> Agregar
        </button>
      </div>
      {activosFijos.map((af, i) => (
        <div key={af.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : 'none' }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{af.nombre}</span>
          <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{$.usd(af.valorUsd)}</span>
          <button onClick={() => onEdit(af)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <Icon name="pencil" size={14} color="var(--gf-gray-400)" />
          </button>
        </div>
      ))}
      {activosFijos.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800, borderTop: '1px solid var(--gf-gray-200)', paddingTop: 8, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
          <span>Total fijos</span>
          <span>{$.usd(total)}</span>
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 6, lineHeight: 1.4 }}>
        Fuera del análisis de riesgo · lente invertible
      </div>
    </Card>
  );
}

// ── Card de opción de rebalanceo ──────────────────────────────────────────────
function OpcionCard({ opcion, posiciones, onRegistrarDecision }: { opcion: OpcionConfig; posiciones: Posicion[]; onRegistrarDecision: () => void }) {
  const $ = useDinero();
  const { liberadoUsd, movimientos, antes, despues, total } = simularOpcion(posiciones, opcion);
  const metricas: { label: string; av: number; dv: number; b: BandaNombre | null }[] = [
    { label: 'Energía AR',             av: (antes.bySector['Energía AR'] ?? 0) / (antes.total || 1),   dv: (despues.bySector['Energía AR'] ?? 0) / (despues.total || 1),  b: 'sector' },
    { label: 'País AR',                av: antes.paisAr,  dv: despues.paisAr,  b: 'pais'   },
    { label: 'Cripto',                 av: antes.cripto,  dv: despues.cripto,  b: 'cripto' },
    { label: `Top-1 (${despues.nombreTop.ticker})`, av: antes.top1,   dv: despues.top1,   b: 'nombre' },
    { label: 'HHI',                    av: antes.hhi,     dv: despues.hhi,     b: 'hhi'    },
    { label: '% RV',                   av: antes.rvPct,   dv: despues.rvPct,   b: null     },
  ];
  return (
    <Card>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
        <span style={{ width: 26, height: 26, borderRadius: 999, background: 'var(--gf-ink)', color: '#fff', fontSize: 13, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {opcion.id}
        </span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{opcion.titulo}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-sec)', lineHeight: 1.4, marginTop: 2 }}>{opcion.descripcion}</div>
        </div>
      </div>

      {/* Movimientos */}
      {liberadoUsd > 0 ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Movimientos</div>
          {movimientos.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '2px 0', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: m.deltaUsd < 0 ? 'var(--gf-expense)' : 'var(--gf-income)' }}>
                {m.deltaUsd < 0 ? '↓' : '↑'} {m.desc}
              </span>
              <span style={{ color: m.deltaUsd < 0 ? 'var(--gf-expense)' : 'var(--gf-income)', fontWeight: 700 }}>
                {m.deltaUsd < 0 ? '−' : '+'}{$.privado ? '' : `${$.usd(Math.abs(m.deltaUsd))} · `}{pct(Math.abs(m.deltaUsd) / total)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--gf-gray-400)', marginBottom: 10 }}>
          Todas las posiciones ya están bajo el target.
        </div>
      )}

      {/* Métricas antes → después */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>Métricas</div>
        {metricas.map(m => {
          const bA = m.b ? banda(m.b, m.av) : null;
          const bD = m.b ? banda(m.b, m.dv) : null;
          const mejoró = m.b && bA && bD && (
            bD === 'verde' && bA !== 'verde' ||
            bD === 'amarillo' && bA === 'rojo'
          );
          return (
            <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', fontSize: 12.5 }}>
              <span style={{ flex: 1, color: 'var(--color-text-sec)' }}>{m.label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {bA && <span style={{ color: SEM[bA].dot }}>●</span>} {pct(m.av)}
              </span>
              <span style={{ color: 'var(--gf-gray-400)', fontSize: 11 }}>→</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: mejoró ? 700 : 400 }}>
                {bD && <span style={{ color: SEM[bD].dot }}>●</span>} {pct(m.dv)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Riesgos */}
      <div style={{ background: 'var(--gf-gray-50)', borderRadius: 10, padding: '10px 12px' }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>Riesgos de esta opción</div>
        {opcion.riesgos.map((r, i) => (
          <div key={i} style={{ fontSize: 12, color: 'var(--color-text-sec)', lineHeight: 1.4, padding: '1px 0' }}>· {r}</div>
        ))}
      </div>

      {/* Registrar decisión */}
      <button
        onClick={onRegistrarDecision}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 10, padding: '7px 12px', borderRadius: 9, border: '1px solid var(--gf-gray-200)', background: 'none', fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', cursor: 'pointer', fontFamily: 'var(--font-base)' }}
      >
        <Icon name="book-open" size={13} color="var(--color-text-sec)" /> Registrar decisión
      </button>
    </Card>
  );
}

// F9.116 §4 — Riesgo y escenarios. La app medía composición (HHI, top1/3/5) pero un HHI de
// 0,070 no le dice a nadie cuánto cae la cartera en una corrección. Acá se cruza la pérdida
// esperable contra la caída que el titular declaró que banca: la brecha es lo accionable.
//
// Fail-soft por sección: cada bloque se calcula por separado y un fallo se registra y se
// omite. Una sección caída nunca tumba la card ni la solapa Resumen.
function intentar<T>(fn: () => T, ctx: string): T | null {
  try { return fn(); } catch (e) { console.error(`[RiesgoCard] ${ctx} falló:`, e); return null; }
}

function RiesgoCard({ posiciones, manuales, topes, configurado, factores }: {
  posiciones: Posicion[];
  manuales: PosicionManual[];
  topes: TopesRiesgo;
  configurado: boolean;
  factores: Record<string, Factor>;
}) {
  const $ = useDinero();
  const [escenarioSel, setEscenarioSel] = useState<string>(ESCENARIO_TITULAR);
  const [verMix, setVerMix] = useState(false);

  // F9.128 §3 — posiciones cuyo bloque se dedujo en vez de estar declarado. Va en esta card, junto
  // al desglose por bloque: es acá donde el bloque se convierte en un número.
  const inferencias = inferenciasDeBloque(posicionesInvertibles(posiciones, manuales));
  const [custodias, setCustodias] = useState<Record<string, Custodia>>({});
  useEffect(() => {
    cargarCustodiaCuenta().then(setCustodias).catch(e => console.error('[custodia] no se pudo leer:', e));
  }, []);

  // F9.127 §3 — exposición argentina por factor. El override de `factoresTicker` se pasa entero,
  // leído una sola vez arriba: nunca un get() por posición.
  const expo = intentar(
    () => exposicionArgentina(posicionesInvertibles(posiciones, manuales), factores),
    'exposicionArgentina',
  );

  // F9.130 §2/§3 — exposición por contraparte y sus escenarios. Se calculan aparte de los de
  // precio a propósito: ver el comentario de `escenariosContraparteDe`.
  const todasInv = posicionesInvertibles(posiciones, manuales);
  const contra = intentar(() => exposicionContraparte(todasInv, custodias), 'exposicionContraparte');
  const escContra: ResultadoEscenario[] | null = intentar(
    () => calcEscenarios(posiciones, manuales, escenariosContraparteDe(posiciones, manuales, custodias)),
    'escenariosContraparte',
  );

  const escenarios: ResultadoEscenario[] | null = intentar(() => calcEscenarios(posiciones, manuales), 'calcEscenarios');
  const violaciones: ViolacionBanda[] | null = intentar(() => violacionesBandas(posiciones, manuales, topes), 'violacionesBandas');

  const titular = escenarios?.find(e => e.id === ESCENARIO_TITULAR) ?? null;
  const brecha = titular ? intentar(() => calcBrecha(titular.perdidaPct, topes.toleranciaCaidaPct), 'calcBrecha') : null;
  const sel = escenarios?.find(e => e.id === escenarioSel) ?? null;
  const mix: MixObjetivo | null = verMix
    ? intentar(() => calcMixObjetivo(posiciones, manuales, topes.toleranciaCaidaPct, escenarioSel), 'calcMixObjetivo')
    : null;

  if (!escenarios && !violaciones) return null;

  // El semáforo de la brecha NO puede salir de banda(): esos umbrales son absolutos y éste
  // es relativo a la tolerancia declarada. Se reusan los colores, no los cortes.
  const sem: 'verde' | 'amarillo' | 'rojo' = !brecha ? 'amarillo'
    : brecha.cumple ? 'verde'
    : brecha.factor <= 1.5 ? 'amarillo'
    : 'rojo';

  return (
    <Card>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Riesgo y escenarios</div>

      {/* F9.127 §3 — exposición argentina por factor, ARRIBA de los escenarios. Es la métrica que
          ninguna vista mostraba: renta fija AR y renta variable AR no son dos apuestas, y la grilla
          de bloques las presentaba como diversificación. */}
      {expo && (
        <div style={{ marginTop: 10, padding: '11px 12px', borderRadius: 12, background: 'var(--gf-gray-100)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>
            Exposición argentina {pct(expo.pctInvertible)}
            {!$.privado && <span style={{ fontWeight: 400, color: 'var(--color-text-sec)' }}> · {$.usd(expo.usd)}</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-sec)', marginTop: 3, lineHeight: 1.45 }}>
            Atraviesa bloques: acciones, soberanos y pesos se mueven juntos si Argentina repricea.
            Concentración por factor HHI {expo.hhiFactor.toFixed(2)} · {expo.nombresEfectivos.toFixed(1)} factores
            efectivos.
          </div>
          {expo.porFactor.filter(f => f.usd > 0 && f.factor !== 'sin_clasificar').map(f => (
            <div key={f.factor} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', fontSize: 11.5 }}>
              <span style={{ flex: 1, color: 'var(--color-text-sec)' }}>
                {FACTOR_LABEL[f.factor]}
                {f.ambiguos.length > 0 && (
                  <span
                    title={f.ambiguos.map(t => `${t}: ${FACTOR_AMBIGUO[t]?.nota ?? ''}`).join(' · ')}
                    style={{ marginLeft: 5, color: 'var(--gf-out)', fontWeight: 700, cursor: 'help' }}
                  >≈</span>
                )}
                <span style={{ color: 'var(--gf-gray-400)', fontSize: 10, marginLeft: 5 }}>{f.tickers.join(' ')}</span>
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{pct(f.pctInvertible)}</span>
            </div>
          ))}
          {expo.porFactor.some(f => f.ambiguos.length > 0) && (
            <div style={{ fontSize: 10, color: 'var(--gf-gray-400)', marginTop: 4, lineHeight: 1.4 }}>
              ≈ el ticker pesa en más de un factor y se le asignó el dominante. Es una simplificación
              declarada, no una medición — pasá el cursor para ver el detalle.
            </div>
          )}
          {expo.sinClasificar.usd > 0 && (
            <div style={{ fontSize: 10.5, color: 'var(--gf-out)', marginTop: 6, lineHeight: 1.4 }}>
              Sin clasificar: {expo.sinClasificar.tickers.join(', ')} · {pct(expo.sinClasificar.usd / (expo.usd || 1))} de
              la exposición argentina. Cuenta en el total pero no se le asignó factor: preferimos
              verlo acá antes que contarlo en el factor equivocado.
            </div>
          )}
        </div>
      )}

      {/* F9.130 §2 — exposición por contraparte, debajo de la de factores. Responde una pregunta
          que ninguna otra vista hacía: no "cuánto puede caer" sino "quién te lo tiene que devolver". */}
      {contra && (
        <div style={{ marginTop: 10, padding: '11px 12px', borderRadius: 12, background: 'var(--gf-gray-100)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>
            Crédito contra terceros {pct(contra.creditoPct)}
            {!$.privado && contra.creditoUsd > 0 && (
              <span style={{ fontWeight: 400, color: 'var(--color-text-sec)' }}> · {$.usd(contra.creditoUsd)}</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-sec)', marginTop: 3, lineHeight: 1.45 }}>
            {contra.mayor
              ? <>Mayor exposición a una sola contraparte: <strong>{contra.mayor.contraparte}</strong> con {pct(contra.mayor.pctInvertible)}. Dos plataformas al 11% no es lo mismo que una al 22%.</>
              : <>Ninguna posición está declarada como crédito. Los escenarios de contraparte dan 0 por eso, no porque no haya riesgo.</>}
          </div>
          {contra.porContraparte.map(c => (
            <div key={c.contraparte} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', fontSize: 11.5 }}>
              <span style={{ flex: 1, color: 'var(--color-text-sec)' }}>
                {c.contraparte}
                <span style={{
                  marginLeft: 6, fontSize: 9.5, fontWeight: 700,
                  color: c.esCredito ? 'var(--gf-expense)' : c.custodia === 'sin_declarar' ? 'var(--gf-out)' : 'var(--gf-gray-400)',
                }}>{CUSTODIA_LABEL[c.custodia]}</span>
                <span style={{ color: 'var(--gf-gray-400)', fontSize: 10, marginLeft: 5 }}>{c.tickers.slice(0, 6).join(' ')}</span>
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{pct(c.pctInvertible)}</span>
            </div>
          ))}
          {contra.sinDeclarar.usd > 0 && (
            <div style={{ fontSize: 10.5, color: 'var(--gf-out)', marginTop: 6, lineHeight: 1.4 }}>
              Sin declarar: {contra.sinDeclarar.contrapartes.join(', ')}. Nada se da por sentado —
              suponer "propia" sobre algo que en realidad es un crédito escondería justo el riesgo
              que esta card existe para mostrar. Declarala en Config para que entre a los escenarios.
            </div>
          )}
        </div>
      )}

      {/* 1. Titular de brecha */}
      {titular && brecha ? (
        <div style={{ background: SEM[sem].bg, borderRadius: 12, padding: '12px 13px', marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: SEM[sem].dot, flexShrink: 0 }} />
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>
              Bancás −{pct(topes.toleranciaCaidaPct)}. En una corrección global perdés {pct(titular.perdidaPct)}.
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)', marginTop: 5, lineHeight: 1.45 }}>
            {brecha.cumple
              ? `La pérdida del escenario entra dentro de lo declarado (${$.usd(titular.perdidaUsd)}).`
              : `Son ${pct(brecha.brechaPct)} del portafolio por encima de lo declarado — ${$.usd(titular.perdidaUsd)} contra un límite de ${$.usd(-topes.toleranciaCaidaPct * titular.total)}.`}
            {!configurado && ' Tolerancia por defecto: declarala en Config › Política de riesgo.'}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', marginTop: 8 }}>
          No se pudo calcular la brecha (ver consola).
        </div>
      )}

      {/* 2. Tabla de escenarios — tap para ver la contribución por bloque */}
      {escenarios && (
        <div style={{ marginTop: 12 }}>
          {escenarios.map((e, i) => {
            const abierto = e.id === escenarioSel;
            const gana = e.perdidaUsd >= 0;
            return (
              <div key={e.id} style={{ borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : '1px solid var(--gf-gray-100)' }}>
                <button
                  onClick={() => setEscenarioSel(abierto ? '' : e.id)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-base)' }}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600 }}>{e.nombre}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: gana ? 'var(--gf-income)' : 'var(--gf-expense)', flexShrink: 0 }}>
                    {$.usd(e.perdidaUsd)}
                  </span>
                  <span style={{ width: 46, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--gf-gray-400)', flexShrink: 0 }}>
                    {pct(e.perdidaPct)}
                  </span>
                  <Icon name={abierto ? 'chevron-down' : 'chevron-right'} size={13} color="var(--gf-gray-300)" />
                </button>
                {/* 3. Contribución por bloque del escenario seleccionado */}
                {abierto && sel && (
                  <div style={{ padding: '0 0 10px 0' }}>
                    <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginBottom: 5, lineHeight: 1.4 }}>{sel.descripcion}</div>
                    {sel.contribucion.filter(c => c.perdidaUsd !== 0).map(c => (
                      <div key={c.bloque} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 11.5 }}>
                        <span style={{ flex: 1, minWidth: 0, color: 'var(--color-text-sec)' }}>{c.nombre}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-sec)' }}>{$.usd(c.perdidaUsd)}</span>
                        <span style={{ width: 46, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{pct(c.aporteFrac)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 4. Bandas violadas */}
      {violaciones && violaciones.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--gf-gray-100)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>
            Bandas fuera de política ({violaciones.length})
          </div>
          {violaciones.map(v => (
            <div key={`${v.tipo}-${v.nombre}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 11.5 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{v.nombre}</strong>
                <span style={{ color: 'var(--gf-gray-400)' }}>
                  {' '}· {v.tipo === 'caja' ? `piso ${pct(v.tope)}` : `tope ${pct(v.tope)}`} · actual {pct(v.actual)}
                </span>
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--gf-expense)', flexShrink: 0 }}>
                {v.tipo === 'caja' ? 'faltan ' : '+'}{$.usd(v.excesoUsd)}
              </span>
            </div>
          ))}
        </div>
      )}
      {violaciones && violaciones.length === 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--gf-gray-100)' }}>
          Ninguna banda fuera de política.
        </div>
      )}

      {/* 5. Mix objetivo, colapsado */}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--gf-gray-100)' }}>
        <button
          onClick={() => setVerMix(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 12, fontWeight: 700, color: 'var(--color-accent)' }}
        >
          <Icon name={verMix ? 'chevron-down' : 'chevron-right'} size={13} color="var(--color-accent)" />
          Mix objetivo para entrar en la tolerancia
        </button>
        {verMix && (mix ? (
          <div style={{ marginTop: 8 }}>
            {mix.ventaNecesariaUsd <= 0 ? (
              <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)' }}>
                El escenario ya entra en la tolerancia: no hace falta recortar nada.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5, marginBottom: 6 }}>
                  Pasar <strong style={{ color: 'var(--color-text)' }}>{$.usd(mix.ventaNecesariaUsd)}</strong> a caja
                  llevaría la pérdida del escenario justo al límite declarado. Al alza eso cuesta{' '}
                  <strong style={{ color: 'var(--color-text)' }}>{pct(mix.upsideResignadoPct)}</strong> del portafolio
                  en un rally simétrico. Es una medición, no una recomendación: la decisión es tuya.
                </div>
                {(Object.entries(mix.pesosObjetivo) as [Bloque, number][])
                  .filter(([, v]) => v > 0.0005)
                  .sort((a, b) => b[1] - a[1])
                  .map(([b, v]) => (
                    <div key={b} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 11.5 }}>
                      <span style={{ flex: 1, color: 'var(--color-text-sec)' }}>{BLOQUE_LABEL[b]}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{pct(v)}</span>
                    </div>
                  ))}
              </>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', marginTop: 8 }}>
            No se pudo calcular el mix objetivo (ver consola).
          </div>
        ))}
      </div>

      {/* F9.128 §3 — qué se dio por sentado al clasificar. No es un warning: es una línea que dice
          qué se infirió, para que un instrumento nuevo se vea antes de contaminar un escenario
          durante seis meses en silencio, que es exactamente lo que acaba de pasar. */}
      {inferencias.length > 0 && (
        <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 10, lineHeight: 1.45 }}>
          Clasificación inferida, no declarada:{' '}
          {inferencias.map(i => `${i.ticker} → ${BLOQUE_LABEL[i.bloque]}`).join(' · ')}.
          Se dedujo del nombre del instrumento; si alguna está mal, el bloque —y su beta— está mal
          en todos los escenarios.
        </div>
      )}

      {/* F9.130 §3 — SECCIÓN APARTE, no mezclada con los escenarios de precio. Un colapso de
          plataforma y una corrección global son eventos independientes y de probabilidad muy
          distinta; ordenarlos en la misma lista por pérdida invita a leerlos como comparables. */}
      {escContra && escContra.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--gf-gray-200)' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 2 }}>Riesgo de contraparte</div>
          <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginBottom: 6, lineHeight: 1.4 }}>
            No son escenarios de mercado y no se comparan con los de arriba: acá el activo no baja de
            precio, no vuelve.
          </div>
          {escContra.map(e => (
            <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', fontSize: 11.5 }}>
              <span style={{ flex: 1, color: 'var(--color-text-sec)' }}>{e.nombre}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: e.perdidaUsd < 0 ? 'var(--gf-expense)' : 'var(--gf-gray-400)' }}>
                {pct(e.perdidaPct)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 10, lineHeight: 1.4 }}>
        Escenarios ilustrativos con shocks fijos y betas constantes documentadas; no son predicciones ni probabilidades.
      </div>
    </Card>
  );
}

// ── Solapa Resumen ────────────────────────────────────────────────────────────
// ── F9.190 §2 — Reserva (piso de caja) y señales de mercado ──────────────────
// INFORMATIVA, como el resto de Patrimonio: muestra la caja contra el piso que fijó el titular y tres
// señales de mercado contra sus umbrales. No notifica ni sugiere una acción por sí sola: los casos
// condicionales son texto fijo acordado con el titular (13-oct-2026), no una salida del sistema.
const NIVEL_SENAL: Record<0 | 1 | 2, { color: string; label: string }> = {
  0: { color: 'var(--gf-income)', label: 'lejos del umbral' },
  1: { color: '#d97706', label: 'nivel 1' },
  2: { color: 'var(--gf-expense)', label: 'nivel 2' },
};

function ReservaCard({ posiciones, manuales, topes }: {
  posiciones: Posicion[];
  manuales: PosicionManual[];
  topes: TopesRiesgo;
}) {
  const $ = useDinero();
  const [estado, setEstado] = useState<{ lectura: LecturaMercado | null; bases: BasesMercado | null } | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);

  useEffect(() => {
    cargarUltimaLecturaSenales()
      .then(setEstado)
      .catch(e => { console.error('[senales] no se pudo leer:', e); setErrorCarga(String((e as Error)?.message ?? e)); });
  }, []);

  async function leer(reiniciarBase: boolean) {
    setLeyendo(true);
    setErrorCarga(null);
    try {
      setEstado(await actualizarSenales(reiniciarBase));
    } catch (e) {
      // Crudo, sin interpretar la causa (lección de CAFCI).
      setErrorCarga(String((e as Error)?.message ?? e));
    } finally {
      setLeyendo(false);
    }
  }

  const todas = posicionesInvertibles(posiciones, manuales);
  const total = todas.reduce((s, p) => s + p.valorUsd, 0);
  if (total <= 0) return null;
  const cajaUsd = todas.filter(p => bloqueDe(p) === 'cash').reduce((s, p) => s + p.valorUsd, 0);
  const caja = cajaUsd / total;
  const piso = topes.pisoCajaPct;
  const faltante = Math.max(0, (piso - caja) * total);
  const senales: SenalEvaluada[] = estado ? evaluarSenales(estado.lectura, estado.bases) : [];
  const fmtVal = (s: SenalEvaluada) => s.valor === null ? '—'
    : s.id === 'riesgoPais' ? `${Math.round(s.valor)} pb`
    : s.valor.toLocaleString('es-AR', { maximumFractionDigits: s.id === 'mervalUsd' ? 0 : 2 });

  return (
    <Card>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Reserva y señales de mercado</div>
      <div style={{ fontSize: 11, color: 'var(--color-text-sec)', lineHeight: 1.45 }}>
        Caja (efectivo, money market en dólares y stablecoins) contra el piso de tu política de riesgo. Un money market en pesos no cuenta: es renta fija en pesos.
      </div>

      <div style={{ marginTop: 10, padding: '11px 12px', borderRadius: 12, background: 'var(--gf-gray-100)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>Caja {pct(caja)} · piso {pct(piso)}</span>
          {!$.privado && <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>{$.usd(cajaUsd)}</span>}
        </div>
        <div style={{ fontSize: 11.5, marginTop: 4, color: faltante > 0 ? 'var(--gf-out)' : 'var(--color-text-sec)' }}>
          {faltante > 0
            ? <>Faltan {$.usd(faltante)} para el piso.</>
            : 'La caja está en el piso o por encima.'}
          {' '}El piso se cambia en Configuración › Política de riesgo.
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700 }}>Señales de mercado</div>
      {!estado?.lectura && !errorCarga && (
        <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)', marginTop: 4 }}>
          Todavía no se leyeron. La primera lectura fija la base de las caídas (Merval en USD y S&P).
        </div>
      )}
      {senales.map(s => (
        <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid var(--gf-gray-100)' }}>
          <span style={{
            width: 9, height: 9, borderRadius: 5, marginTop: 4, flexShrink: 0,
            background: s.nivel === null ? 'transparent' : NIVEL_SENAL[s.nivel].color,
            border: s.nivel === null ? '1.5px solid var(--gf-gray-400)' : 'none',
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{s.etiqueta}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtVal(s)}</span>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--color-text-sec)', marginTop: 2, lineHeight: 1.4 }}>
              {s.variacion !== null && <>{s.variacion >= 0 ? '+' : ''}{(s.variacion * 100).toFixed(1)}% desde la base del {s.base?.fecha ? fmtFecha(s.base.fecha) : '—'} · </>}
              umbral {s.umbrales}
              {s.nivel !== null && <> · {NIVEL_SENAL[s.nivel].label}</>}
              {s.fecha && <> · dato {fmtFecha(s.fecha)}</>}
            </div>
            {s.error && (
              <div style={{ fontSize: 10.5, color: 'var(--gf-out)', marginTop: 2, wordBreak: 'break-word', userSelect: 'text' }}>
                Sin dato: {s.error}
              </div>
            )}
          </div>
        </div>
      ))}
      {errorCarga && (
        <div style={{ fontSize: 11, color: 'var(--gf-out)', marginTop: 6, wordBreak: 'break-word', userSelect: 'text' }}>
          No se pudieron leer las señales: {errorCarga}
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
        <button
          onClick={() => leer(false)}
          disabled={leyendo}
          style={{ padding: '7px 12px', borderRadius: 9, border: 'none', background: leyendo ? 'var(--gf-gray-200)' : 'var(--color-accent)', color: leyendo ? 'var(--gf-gray-400)' : '#fff', fontSize: 12, fontWeight: 700, cursor: leyendo ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}
        >{leyendo ? 'Leyendo…' : 'Actualizar señales'}</button>
        {estado?.lectura && (
          <button
            onClick={() => { if (confirm('¿Fijar la base de las caídas en el valor de hoy?')) leer(true); }}
            disabled={leyendo}
            style={{ padding: '7px 12px', borderRadius: 9, border: '1px solid var(--gf-gray-200)', background: 'transparent', color: 'var(--color-text-sec)', fontSize: 12, fontWeight: 700, cursor: leyendo ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}
          >Reiniciar base</button>
        )}
      </div>
      {estado?.lectura && (
        <div style={{ fontSize: 10, color: 'var(--gf-gray-400)', marginTop: 6 }}>
          Última lectura: {fmtFecha(estado.lectura.leidoEnISO.slice(0, 10))}
        </div>
      )}

      <details style={{ marginTop: 10 }}>
        <summary style={{ fontSize: 11.5, fontWeight: 600, cursor: 'pointer', color: 'var(--color-text-sec)' }}>
          Qué haría en cada caso
        </summary>
        <div style={{ fontSize: 11, color: 'var(--color-text-sec)', lineHeight: 1.5, marginTop: 6 }}>
          <div>· Si el riesgo país pasa {UMBRALES_SENALES.riesgoPais[0]} pb o el Merval en USD cae {UMBRALES_SENALES.mervalUsdCaida[0] * 100}% → las opciones serían usar hasta un tercio de la reserva (GD30 / ETF amplio / reguladas castigadas) o esperar confirmación. Trade-off: entrar temprano vs. perder parte del rebote.</div>
          <div>· Si pasa {UMBRALES_SENALES.riesgoPais[1]} pb o el Merval cae {UMBRALES_SENALES.mervalUsdCaida[1] * 100}% → las opciones serían usar otro tercio o sostener. Trade-off: más exposición en la baja vs. liquidez para una caída mayor.</div>
          <div>· Si el S&P cae {UMBRALES_SENALES.sp500Caida[0] * 100}% → las opciones serían destinar parte al ETF amplio o esperar. Trade-off: diversificar en la baja vs. caída adicional.</div>
          <div>· El último tercio queda guardado salvo una necesidad real. La decisión es tuya: esto no es una orden.</div>
        </div>
      </details>
    </Card>
  );
}

// ── F9.195 (sistema cripto) §5 — Sistema cripto ───────────────────────────────
// INFORMATIVA, como la card de reserva: composición interna del bloque cripto contra su política,
// plataformas, tramos de BTC y freno. Sin campana, sin contador, sin push. Los casos de "Qué haría"
// son texto fijo acordado con el titular (15-oct-2026), no una salida del sistema.
const pct1 = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const pts1 = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1).replace('.', ',')} pts`;
const CUSTODIAS_ELEGIBLES: Custodia[] = ['sin_declarar', 'credito', 'segregada', 'propia', 'emisor'];

function CriptoCard({ posiciones, pesoClase }: { posiciones: Posicion[]; pesoClase: number }) {
  const $ = useDinero();
  const [estado, setEstado] = useState<EstadoCripto | null>(null);
  const [historial, setHistorial] = useState<DiaCripto[]>([]);
  const [politica, setPolitica] = useState<PoliticaCripto>(CRIPTO_DEFAULTS);
  const [custodias, setCustodias] = useState<Record<string, Custodia>>({});
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);

  useEffect(() => {
    cargarLecturaCripto().then(setEstado)
      .catch(e => { console.error('[cripto] lectura:', e); setErrorCarga(String((e as Error)?.message ?? e)); });
    cargarHistorialCripto().then(setHistorial).catch(e => console.error('[cripto] historial:', e));
    cargarPoliticaCripto().then(r => setPolitica(r.politica)).catch(e => console.error('[cripto] política:', e));
    cargarCustodiaCuenta().then(setCustodias).catch(e => console.error('[cripto] custodia:', e));
  }, []);

  async function leer(reiniciarBase: boolean) {
    setLeyendo(true);
    setErrorCarga(null);
    try {
      setEstado(await actualizarPreciosCripto(reiniciarBase));
      setHistorial(await cargarHistorialCripto());
    } catch (e) {
      setErrorCarga(String((e as Error)?.message ?? e));
    } finally {
      setLeyendo(false);
    }
  }

  async function declararCustodia(cuenta: string, c: Custodia) {
    try {
      await guardarCustodiaCuenta(cuenta, c);
      setCustodias(prev => {
        const next = { ...prev };
        if (c === 'sin_declarar') delete next[cuenta]; else next[cuenta] = c;
        return next;
      });
    } catch (e) {
      setErrorCarga(`No se pudo guardar la custodia de ${cuenta}: ${String((e as Error)?.message ?? e)}`);
    }
  }

  const ev = evaluarSistemaCripto({
    posiciones, lectura: estado?.lectura ?? null, bases: estado?.bases ?? null,
    historial, politica, custodias, pesoClase,
  });
  if (!ev) return null;

  const rojo = 'var(--gf-out)';
  const verde = 'var(--gf-income)';
  const sec = 'var(--color-text-sec)';
  const th: React.CSSProperties = { fontSize: 10.5, color: sec, fontWeight: 600, textAlign: 'right', padding: '4px 0' };
  const td: React.CSSProperties = { fontSize: 12, textAlign: 'right', padding: '5px 0', fontVariantNumeric: 'tabular-nums', borderTop: '1px solid var(--gf-gray-100)' };
  const sinPrecio = estado?.lectura
    ? Object.entries(estado.lectura.precios).filter(([, p]) => p.valor === null)
    : [];
  const { tramos, reserva, freno } = ev;

  return (
    <Card>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Sistema cripto</div>
      <div style={{ fontSize: 11, color: sec, lineHeight: 1.45 }}>
        Composición del bloque cripto contra su política propia. Sigue sumando en el total y en la banda de clase.
      </div>

      {/* 1. Encabezado */}
      <div style={{ marginTop: 10, padding: '11px 12px', borderRadius: 12, background: 'var(--gf-gray-100)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{$.usd(ev.valorUsd)}</span>
          <span style={{ fontSize: 12, color: sec }}>{pct1(ev.pesoEnTotal)} del total</span>
        </div>
        <div style={{ fontSize: 10.5, color: sec, marginTop: 3, lineHeight: 1.4 }}>
          Precios {ev.fechaPrecios ? `del ${fmtFecha(ev.fechaPrecios)}` : 'sin leer todavía'}
          {' · '}cantidades del {ev.fechaCantidades ? fmtFecha(ev.fechaCantidades) : '—'}
          {ev.valuadosConSnapshot.length > 0 && ev.fechaCantidades && (
            <> · {ev.valuadosConSnapshot.join(', ')} con el valor del {fmtFecha(ev.fechaCantidades).slice(0, 5)}</>
          )}
        </div>
      </div>

      {/* 2. Composición */}
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700 }}>Composición</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 2 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Grupo</th><th style={th}>Actual</th><th style={th}>Objetivo</th>
            <th style={th}>Desvío</th><th style={th}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {ev.composicion.map(f => (
            <tr key={f.grupo}>
              <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{GRUPO_CRIPTO_LABEL[f.grupo]}</td>
              <td style={td}>{pct1(f.actual)}</td>
              <td style={td}>{pct1(f.objetivo)}</td>
              <td style={td}>{pts1(f.desvioPts)}</td>
              <td style={{ ...td, color: f.estado === 'en_banda' ? verde : rojo, fontWeight: 600 }}>
                {f.estado === 'en_banda' ? 'en banda' : 'fuera'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 10.5, color: sec, marginTop: 4, lineHeight: 1.4 }}>
        Banda ±{Math.round(politica.bandaPts * 100)} pts.{' '}
        {!$.privado && ev.composicion.filter(f => f.estado === 'fuera_de_banda').map(f =>
          `${GRUPO_CRIPTO_LABEL[f.grupo]}: ${f.usdAlObjetivo >= 0 ? 'faltan' : 'sobran'} ${fmtUsd(Math.abs(f.usdAlObjetivo))} para el objetivo`,
        ).join(' · ')}
      </div>

      {/* 3. Plataformas */}
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700 }}>Plataformas</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 2 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Plataforma</th><th style={th}>%</th>
            <th style={th}>Tope {pct(politica.topePlataformaPct)}</th>
          </tr>
        </thead>
        <tbody>
          {ev.plataformas.map(p => (
            <Fragment key={p.plataforma}>
              <tr>
                <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>
                  {p.plataforma}
                  {!p.mapeada && <span style={{ fontSize: 10, color: rojo, fontWeight: 600, marginLeft: 6 }}>plataforma sin mapear</span>}
                </td>
                <td style={td}>{pct1(p.pct)}</td>
                <td style={{ ...td, color: p.superaTope ? rojo : verde, fontWeight: 600 }}>{p.superaTope ? 'supera' : 'dentro'}</td>
              </tr>
              {/* La custodia es por cuenta (F9.130): se declara acá, debajo de su plataforma. */}
              {p.cuentas.map(c => (
                <tr key={c.cuenta}>
                  <td colSpan={3} style={{ padding: '2px 0 5px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: sec }}>
                      <span style={{ flex: 1, minWidth: 0 }}>{c.cuenta} · {pct1(c.pct)}</span>
                      <select
                        value={c.custodia}
                        onChange={e => declararCustodia(c.cuenta, e.target.value as Custodia)}
                        style={{ fontSize: 11, maxWidth: 170, border: '1px solid var(--gf-gray-200)', borderRadius: 6, padding: '2px 4px', fontFamily: 'var(--font-base)', color: c.custodia === 'sin_declarar' ? rojo : 'inherit', background: 'transparent' }}
                      >
                        {CUSTODIAS_ELEGIBLES.map(k => <option key={k} value={k}>{CUSTODIA_LABEL[k]}</option>)}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>

      {/* 4. Reserva y tramos */}
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700 }}>Reserva y tramos de BTC</div>
      <div style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.5 }}>
        Reserva {pct1(reserva.actual)} · objetivo {pct1(reserva.objetivo)}
        {!$.privado && <> · {reserva.faltaUsd > 0 ? `faltan ${fmtUsd(reserva.faltaUsd)}` : 'en el objetivo'} · cada tercio {fmtUsd(reserva.tercioUsd)}</>}
      </div>
      <div style={{ fontSize: 11.5, marginTop: 2, lineHeight: 1.5 }}>
        {tramos.base && tramos.precio !== null && tramos.variacion !== null ? (
          <>BTC {fmtUsd(tramos.precio)} · {tramos.variacion >= 0 ? '+' : ''}{(tramos.variacion * 100).toFixed(1).replace('.', ',')}% desde la base del {fmtFecha(tramos.base.fecha)} ({fmtUsd(tramos.base.valor)}) · </>
        ) : (
          <span style={{ color: sec }}>{tramos.base ? 'Sin precio de BTC en la última lectura · ' : 'Sin base de BTC: la fija la primera lectura · '}</span>
        )}
        niveles {tramos.niveles.map((n, i) => (
          <span key={i} style={{ color: n.alcanzado ? rojo : sec, fontWeight: n.alcanzado ? 700 : 400 }}>
            {i > 0 ? ' / ' : ''}{Math.round(n.tramo * 100)}%{n.alcanzado ? ' ✓' : ''}
          </span>
        ))}
        {' '}· {tramos.alcanzados} de {tramos.niveles.length} alcanzados
      </div>

      {/* 5. Freno */}
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700 }}>Freno</div>
      <div style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.5, color: freno.activo ? rojo : 'inherit' }}>
        {(freno.caida * 100).toFixed(1).replace('.', ',')}% desde el máximo
        {!$.privado && <> ({fmtUsd(freno.maximoUsd)}{freno.fechaMaximo ? `, ${fmtFecha(freno.fechaMaximo)}` : ''})</>}
        {' '}· umbral −{Math.round(freno.umbral * 100)}%{freno.activo ? ' · superado: pide revisar' : ''}
      </div>
      <div style={{ fontSize: 10.5, color: sec, marginTop: 2 }}>
        {freno.dias > 0 ? `Máximo sobre ${freno.dias} día(s) con todo valuado a precio del día.` : 'Todavía no hay serie diaria: el máximo es el valor de hoy.'}
      </div>

      {sinPrecio.length > 0 && (
        <div style={{ fontSize: 10.5, color: rojo, marginTop: 8, wordBreak: 'break-word', userSelect: 'text' }}>
          {sinPrecio.map(([t, p]) => <div key={t}>Sin precio {t}: {p.error}</div>)}
        </div>
      )}
      {errorCarga && (
        <div style={{ fontSize: 11, color: rojo, marginTop: 6, wordBreak: 'break-word', userSelect: 'text' }}>
          {errorCarga}
        </div>
      )}

      {/* 7. Botones */}
      <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
        <button
          onClick={() => leer(false)}
          disabled={leyendo}
          style={{ padding: '7px 12px', borderRadius: 9, border: 'none', background: leyendo ? 'var(--gf-gray-200)' : 'var(--color-accent)', color: leyendo ? 'var(--gf-gray-400)' : '#fff', fontSize: 12, fontWeight: 700, cursor: leyendo ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}
        >{leyendo ? 'Leyendo…' : 'Actualizar'}</button>
        {estado?.lectura && (
          <button
            onClick={() => { if (confirm('¿Fijar la base de BTC en el precio de hoy?')) leer(true); }}
            disabled={leyendo}
            style={{ padding: '7px 12px', borderRadius: 9, border: '1px solid var(--gf-gray-200)', background: 'transparent', color: sec, fontSize: 12, fontWeight: 700, cursor: leyendo ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}
          >Reiniciar base</button>
        )}
      </div>
      {estado?.lectura && estado.lectura.sondeo.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--gf-gray-400)', marginTop: 6, wordBreak: 'break-word' }}>
          Fuentes: {estado.lectura.sondeo.map(s => `${s.fuente} ${s.status || 'sin respuesta'}`).join(' · ')}
        </div>
      )}

      {/* 6. Qué haría en cada caso */}
      <details style={{ marginTop: 10 }}>
        <summary style={{ fontSize: 11.5, fontWeight: 600, cursor: 'pointer', color: sec }}>
          Qué haría en cada caso
        </summary>
        <div style={{ fontSize: 11, color: sec, lineHeight: 1.5, marginTop: 6 }}>
          <div>· Si un grupo sale de banda → rebalancear hacia el objetivo o esperar al próximo snapshot. Costo: comisiones e impuesto vs. más riesgo concentrado.</div>
          <div>· Si BTC alcanza un nivel → usar un tercio de la reserva o sostenerlo. Costo: entrar antes de un piso vs. perder parte del rebote.</div>
          <div>· Si una plataforma supera el tope → mover a billetera propia u otra plataforma, o aceptarlo. Costo: comisiones de red y manejo de claves vs. riesgo de contraparte.</div>
          <div>· Si se activa el freno → pausar compras y revisar la política.</div>
          <div>· La decisión es tuya: esto no es una orden.</div>
        </div>
      </details>
    </Card>
  );
}

// ── F9.195 (sistema cripto) §2 — Política cripto (solapa Config) ─────────────
// A diferencia de la política de riesgo, no se guarda tecla a tecla: los cuatro objetivos tienen que
// sumar 100% y un valor intermedio no valida. Borrador local + "Guardar" con la validación a la vista.
function PoliticaCriptoCard({ onToast }: { onToast: (texto: string, error: boolean) => void }) {
  const [politica, setPolitica] = useState<PoliticaCripto | null>(null);
  const [configurada, setConfigurada] = useState(false);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const aBorrador = (p: PoliticaCripto): Record<string, string> => ({
    ...Object.fromEntries(GRUPOS_CRIPTO.map(g => [g, String(Math.round(p.objetivo[g] * 1000) / 10)])),
    bandaPts: String(Math.round(p.bandaPts * 1000) / 10),
    topePlataformaPct: String(Math.round(p.topePlataformaPct * 1000) / 10),
    frenoCaidaPct: String(Math.round(p.frenoCaidaPct * 1000) / 10),
    tramosBtc: p.tramosBtc.map(t => String(Math.round(t * 1000) / 10)).join(', '),
  });

  useEffect(() => {
    cargarPoliticaCripto()
      .then(r => { setPolitica(r.politica); setConfigurada(r.configurada); setBorrador(aBorrador(r.politica)); })
      .catch(e => { console.error('[politica cripto]', e); setErrorCarga(String((e as Error)?.message ?? e)); });
  }, []);

  const n = (k: string) => Number(String(borrador[k] ?? '').replace(',', '.')) / 100;
  const candidata: PoliticaCripto = {
    objetivo: Object.fromEntries(GRUPOS_CRIPTO.map(g => [g, n(g)])) as PoliticaCripto['objetivo'],
    bandaPts: n('bandaPts'),
    topePlataformaPct: n('topePlataformaPct'),
    frenoCaidaPct: n('frenoCaidaPct'),
    tramosBtc: String(borrador.tramosBtc ?? '').split(/[;,\s]+/).filter(Boolean).map(s => -Math.abs(Number(s.replace(',', '.'))) / 100),
  };
  const errores = politica ? validarPoliticaCripto(candidata) : [];
  const cambio = politica !== null && JSON.stringify(aBorrador(politica)) !== JSON.stringify(borrador);

  async function guardar() {
    setGuardando(true);
    try {
      await guardarPoliticaCripto(candidata);
      setPolitica(candidata);
      setConfigurada(true);
      setBorrador(aBorrador(candidata));
      onToast('Política cripto guardada', false);
    } catch (e) {
      onToast(`No se pudo guardar: ${String((e as Error)?.message ?? e)}`, true);
    } finally {
      setGuardando(false);
    }
  }

  const fila = (k: string, label: string, sub: string, ancho = 58, unidad = '%') => (
    <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--gf-gray-100)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', lineHeight: 1.3 }}>{sub}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <input
          type="text" inputMode="decimal"
          value={borrador[k] ?? ''}
          onChange={e => setBorrador(b => ({ ...b, [k]: e.target.value }))}
          style={{ width: ancho, textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums', border: '1px solid var(--gf-gray-300)', borderRadius: 8, padding: '5px 7px', fontFamily: 'var(--font-base)' }}
        />
        <span style={{ fontSize: 12, color: 'var(--gf-gray-400)' }}>{unidad}</span>
      </div>
    </div>
  );

  return (
    <Card>
      <div style={{ fontSize: 13, fontWeight: 700 }}>Política cripto</div>
      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2, marginBottom: 6 }}>
        {errorCarga ? `No se pudo leer: ${errorCarga}` : configurada ? 'Configurada' : 'Sin configurar · se usan los valores iniciales'}
      </div>
      {politica && (
        <>
          {fila('BTC', 'Objetivo BTC', 'Fracción del sistema cripto')}
          {fila('ETH', 'Objetivo ETH', 'Fracción del sistema cripto')}
          {fila('otras', 'Objetivo otras', 'Toda cripto que no es BTC, ETH ni stablecoin')}
          {fila('reserva', 'Objetivo reserva', 'Stablecoins')}
          {fila('bandaPts', 'Banda', 'Desvío tolerado por grupo', 58, 'pts')}
          {fila('topePlataformaPct', 'Tope por plataforma', 'Máximo del sistema en una sola cuenta')}
          {fila('frenoCaidaPct', 'Freno', 'Caída del sistema desde su máximo que pide revisar')}
          {fila('tramosBtc', 'Tramos de BTC', 'Caídas desde la base, separadas por coma (ej. 5, 12, 20)', 100)}
          {errores.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--gf-out)', marginTop: 6, lineHeight: 1.45 }}>
              {errores.map(e => <div key={e}>{e}</div>)}
            </div>
          )}
          <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
            <button
              onClick={guardar}
              disabled={!cambio || errores.length > 0 || guardando}
              style={{ padding: '7px 12px', borderRadius: 9, border: 'none', background: !cambio || errores.length > 0 || guardando ? 'var(--gf-gray-200)' : 'var(--color-accent)', color: !cambio || errores.length > 0 || guardando ? 'var(--gf-gray-400)' : '#fff', fontSize: 12, fontWeight: 700, cursor: !cambio || errores.length > 0 || guardando ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}
            >{guardando ? 'Guardando…' : 'Guardar'}</button>
            {cambio && (
              <button
                onClick={() => setBorrador(aBorrador(politica))}
                style={{ padding: '7px 12px', borderRadius: 9, border: '1px solid var(--gf-gray-200)', background: 'transparent', color: 'var(--color-text-sec)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}
              >Descartar</button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

// ── F9.196 H2a — Hero "Valor de hoy (estimado)" ──────────────────────────────
// El número grande es la cartera viva (`carteraViva/ultima`): cada cuenta con su mejor fuente y el
// precio y el MEP del día. Abajo, la última carga y la diferencia separada en precios, dólar y
// movimientos, más una línea de frescura por cuenta. Las inconsistencias se muestran, no se corrigen.
function HeroValorDeHoy({ cv, fijosUsd, tc, onActualizado, onToast }: {
  cv: DocCarteraViva; fijosUsd: number; tc: number;
  onActualizado: () => void; onToast: (texto: string, error: boolean) => void;
}) {
  const $ = useDinero();
  const [ocupado, setOcupado] = useState<'ppi' | 'bitfinex' | 'recalcular' | null>(null);
  const [verInconsistencias, setVerInconsistencias] = useState(false);
  const mep = cv.tc?.valor ?? tc;
  const diferencia = cv.totalUsd - cv.totalCargaUsd;
  const precioSinDolar = cv.efectoPreciosUsd - cv.efectoDolarUsd;
  const signo = (x: number) => (x >= 0 ? '+' : '−');
  const efecto = (x: number) => `${signo(x)}${$.usd(Math.abs(x))}`;
  const calculada = cv.calculadaEnISO ? new Date(Date.parse(cv.calculadaEnISO) - 3 * 3600_000).toISOString() : '';

  async function correr(cual: 'ppi' | 'bitfinex' | 'recalcular') {
    setOcupado(cual);
    try {
      if (cual === 'bitfinex') {
        const r = await sincronizarBitfinexAhora();
        onToast(`Bitfinex sincronizado: ${r.posiciones} activos, ${r.movimientos} movimientos${r.paraRevisar ? `, ${r.paraRevisar} para revisar` : ''}. Valor de hoy recalculado.`, false);
      } else if (cual === 'ppi') {
        const r = await sincronizarPPIAhora();
        await recalcularCarteraViva();
        onToast(`PPI sincronizado: ${r.posiciones} posiciones, ${r.movimientos} movimientos. Valor de hoy recalculado.`, false);
      } else {
        await recalcularCarteraViva();
        onToast('Valor de hoy recalculado.', false);
      }
      onActualizado();
    } catch (e) {
      onToast(`${cual === 'ppi' ? 'No se pudo sincronizar PPI' : cual === 'bitfinex' ? 'No se pudo sincronizar Bitfinex' : 'No se pudo recalcular'}: ${String((e as Error)?.message ?? e)}`, true);
    } finally {
      setOcupado(null);
    }
  }

  const boton = (cual: 'ppi' | 'bitfinex' | 'recalcular', texto: string) => (
    <button
      onClick={() => correr(cual)}
      disabled={ocupado !== null}
      style={{ background: 'rgba(255,255,255,.14)', border: 'none', borderRadius: 8, padding: '7px 10px', color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: ocupado ? 'default' : 'pointer', fontFamily: 'var(--font-base)', opacity: ocupado && ocupado !== cual ? .5 : 1 }}
    >
      {ocupado === cual ? 'Actualizando…' : texto}
    </button>
  );

  return (
    <div style={{ background: 'var(--gf-ink)', color: '#fff', borderRadius: 20, padding: '22px 20px' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', opacity: .6 }}>
          Valor de hoy (estimado)
        </div>
        <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-1px', margin: '4px 0 2px', fontVariantNumeric: 'tabular-nums' }}>
          {$.usd(cv.totalUsd)}
        </div>
        {!$.privado && (
          <div style={{ fontSize: 12, opacity: .5, fontVariantNumeric: 'tabular-nums', marginBottom: 8 }}>{$.ars(cv.totalUsd, mep)}</div>
        )}
        <div style={{ fontSize: 12, opacity: .75, fontVariantNumeric: 'tabular-nums' }}>
          Última carga {fmtFecha(cv.fechaCorrida)}: {$.usd(cv.totalCargaUsd)}
          <span style={{ marginLeft: 6, fontWeight: 700, color: diferencia >= 0 ? '#4ade80' : '#f87171' }}>{efecto(diferencia)}</span>
        </div>
        <div style={{ fontSize: 11, opacity: .6, fontVariantNumeric: 'tabular-nums', marginTop: 3, lineHeight: 1.5 }}>
          precios {efecto(precioSinDolar)} · dólar {efecto(cv.efectoDolarUsd)} · movimientos {efecto(cv.efectoMovimientosUsd)}
        </div>
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,.15)', margin: '14px 0 10px' }} />
      <div style={{ fontSize: 11, opacity: .7, lineHeight: 1.55 }}>
        {cv.frescura.map((l, i) => <div key={i}>{l}</div>)}
        {calculada && <div style={{ opacity: .7 }}>Calculado {fmtFecha(calculada.slice(0, 10))} {calculada.slice(11, 16)}</div>}
      </div>
      {cv.inconsistencias.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11 }}>
          <button onClick={() => setVerInconsistencias(v => !v)} style={{ background: 'none', border: 'none', padding: 0, color: '#fbbf24', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
            {cv.inconsistencias.length} inconsistencia(s) {verInconsistencias ? '▴' : '▾'}
          </button>
          {verInconsistencias && (
            <ul style={{ margin: '4px 0 0', paddingLeft: 16, opacity: .8, lineHeight: 1.45 }}>
              {cv.inconsistencias.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          )}
        </div>
      )}
      <div style={{ borderTop: '1px solid rgba(255,255,255,.15)', margin: '12px 0 10px' }} />
      <div style={{ textAlign: 'center', opacity: .65 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 3 }}>Patrimonio total (hoy)</div>
        <div style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{$.usd(cv.totalUsd + fijosUsd)}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        {boton('ppi', 'Sincronizar PPI ahora')}
        {boton('bitfinex', 'Sincronizar Bitfinex ahora')}
        {boton('recalcular', 'Recalcular')}
      </div>
    </div>
  );
}

function ResumenTab({ M, Mhoy, carteraViva, carteraVivaVieja, onCarteraViva, posicionesCorrida, indicadores, identidadesHoy, onAbrirFicha, tc, fechaCorrida, activosFijos, historial, flujos, informes, generandoInforme, onGenerarInforme, onToast, posiciones, manuales, topesRiesgo, riesgoConfigurado, factores }: {
  M: PatMetrics; tc: number; fechaCorrida: string;
  /** F9.196 H2a — métricas sobre la cartera viva (pesos, riesgo); `M` es la corrida. */
  Mhoy: PatMetrics;
  carteraViva: DocCarteraViva | null;
  /** Fecha de corrida de una cartera viva desactualizada (calculada sobre otra corrida), o null. */
  carteraVivaVieja: string | null;
  onCarteraViva: () => void;
  /** La corrida (para la card cripto hasta H2c); `posiciones` es la cartera viva si existe. */
  posicionesCorrida: Posicion[];
  /** F9.196 H6 — para "Acciones a mirar". */
  indicadores: Map<string, IndicadoresPosicion>;
  identidadesHoy: Set<string>;
  onAbrirFicha: (identidad: string) => void;
  activosFijos: ActivoFijo[];
  posiciones: Posicion[];
  manuales: PosicionManual[];
  topesRiesgo: TopesRiesgo;
  riesgoConfigurado: boolean;
  factores: Record<string, Factor>;
  historial: SnapshotResumen[];
  flujos: FlujoPatrimonio[];
  informes: InformeAnterior[];
  generandoInforme: boolean;
  onGenerarInforme: (sinMontos: boolean) => void;
  onToast: (texto: string, error: boolean) => void;
}) {
  // F9.115 — descargas de la corrida vigente. El patrón blob/a.download es el de
  // descargar() (:3127), pero acá SÍ se libera el object URL.
  const $ = useDinero();
  const [descargando, setDescargando] = useState<'txt' | 'json' | null>(null);
  // F9.120 — variante del informe. F9.121: es INDEPENDIENTE del modo privacidad de pantalla, a
  // propósito — el modo de pantalla es efímero, el PDF es un archivo que se entrega y sobrevive.
  const [sinMontos, setSinMontos] = useState(false);

  async function descargarExport(cual: 'txt' | 'json') {
    setDescargando(cual);
    const res = cual === 'txt' ? await exportarCorridaTxt() : await exportarDossierJson();
    setDescargando(null);
    if (!res) {
      onToast('No hay corrida cargada para exportar (si hay datos, revisá la consola).', true);
      return;
    }
    const blob = new Blob([res.contenido], { type: cual === 'txt' ? 'text/plain' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = res.nombre; a.click();
    URL.revokeObjectURL(url);
  }

  const fijosUsd   = activosFijos.reduce((s, a) => s + a.valorUsd, 0);
  const patrimTotal = M.total + fijosUsd;
  const corrPrev = historial.length > 1 ? historial[1] : null;
  const deltaInv = corrPrev ? M.total - corrPrev.totalInvertibleUsd : null;

  // F9.196 H2a — riesgos sobre el valor de hoy (Mhoy).
  const riesgos: { k: string; v: number; b: ReturnType<typeof banda>; extra?: string }[] = [
    { k: 'Nombre más grande', v: Mhoy.top1, b: banda('nombre', Mhoy.top1), extra: Mhoy.nombreTop.ticker },
    { k: 'Sector top',        v: Mhoy.sectorTop.pct, b: banda('sector', Mhoy.sectorTop.pct), extra: Mhoy.sectorTop.nombre },
    { k: 'Cripto (clase)',    v: Mhoy.cripto, b: banda('cripto', Mhoy.cripto) },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {carteraViva && (
        <HeroValorDeHoy cv={carteraViva} fijosUsd={fijosUsd} tc={tc} onActualizado={onCarteraViva} onToast={onToast} />
      )}
      {/* 1. Hero negro — sin cartera viva calculada todavía: el de la corrida */}
      {!carteraViva && (
      <div style={{ background: 'var(--gf-ink)', color: '#fff', borderRadius: 20, padding: '22px 20px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', opacity: .6 }}>
            Portfolio invertible
          </div>
          <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-1px', margin: '4px 0 2px', fontVariantNumeric: 'tabular-nums' }}>
            {$.usd(M.total)}
          </div>
          {/* F9.121 — el gemelo en pesos no se renderiza con el modo activo: una línea vacía
              dejaría un hueco y un salto de alto en el hero. */}
          {!$.privado && (
            <div style={{ fontSize: 12, opacity: .5, fontVariantNumeric: 'tabular-nums', marginBottom: 8 }}>
              {$.ars(M.total, tc)}
            </div>
          )}
          {deltaInv !== null && corrPrev && (
            <div style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', marginTop: $.privado ? 8 : 0 }}>
              {/* F9.121 — el delta ya trae su propio % al lado, calculado sobre OTRA base (el
                  total de la corrida anterior). Con el modo activo se oculta el absoluto y
                  queda sólo el paréntesis: nunca dos porcentajes distintos del mismo número. */}
              {!$.privado && (
                <span style={{ color: deltaInv >= 0 ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                  {deltaInv >= 0 ? '+' : ''}{$.usd(deltaInv)}
                </span>
              )}
              <span style={{ opacity: .55, marginLeft: $.privado ? 0 : 5, color: $.privado ? (deltaInv >= 0 ? '#4ade80' : '#f87171') : undefined, fontWeight: $.privado ? 700 : undefined }}>
                ({deltaInv >= 0 ? '+' : ''}{pct(deltaInv / (corrPrev.totalInvertibleUsd || 1))}) · vs {fmtFecha(corrPrev.fechaCorrida)}
              </span>
            </div>
          )}
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,.15)', margin: '14px 0 12px' }} />
        <div style={{ textAlign: 'center', opacity: .65 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 3 }}>
            Patrimonio total
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {$.usd(patrimTotal)}
          </div>
          <div style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
            {$.privado ? '' : `${$.ars(patrimTotal, tc)} · `}al {fmtFecha(fechaCorrida)}
          </div>
        </div>
        <div style={{ textAlign: 'center', fontSize: 10, opacity: .35, marginTop: 10 }}>
          TC ${Math.round(tc).toLocaleString('es-AR')}
        </div>
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          {carteraVivaVieja && (
            <div style={{ fontSize: 11, opacity: .7, marginBottom: 6 }}>
              El valor de hoy guardado es de la carga del {fmtFecha(carteraVivaVieja)}: recalculalo con la corrida nueva.
            </div>
          )}
          <button
            onClick={() => recalcularCarteraViva()
              .then(() => { onToast('Valor de hoy calculado.', false); onCarteraViva(); })
              .catch(e => onToast(`No se pudo calcular el valor de hoy: ${String((e as Error)?.message ?? e)}`, true))}
            style={{ background: 'rgba(255,255,255,.14)', border: 'none', borderRadius: 8, padding: '7px 10px', color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}
          >
            Calcular valor de hoy
          </button>
        </div>
      </div>
      )}

      {/* 2. Riesgos */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
          Riesgos principales
          <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--gf-gray-400)', marginLeft: 6 }}>· sobre invertible</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {riesgos.map(r => (
            <div key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: SEM[r.b].bg }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: SEM[r.b].dot, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {r.k}
                {r.extra && <span style={{ color: 'var(--color-text-sec)', fontWeight: 500 }}> · {r.extra}</span>}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{pct(r.v)}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* 3. Composición por sector */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Composición por sector</div>
        <CompBar M={Mhoy} />
      </Card>

      {/* 4. Evolución entre corridas */}
      {historial.length > 1 && (() => {
        const retorno = flujos.length > 0 ? calcRetorno(historial, flujos) : null;
        // Mapa: fechaHasta → retorno del período (periodos van de antiguo a reciente)
        const retornoMap = new Map<string, number>(
          retorno?.periodos.map(p => [p.fechaHasta, p.retornoPct]) ?? []
        );
        return (
          <Card>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Evolución</div>
              {retorno && (
                <div style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-sec)' }}>
                  Acumulado: <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{retorno.acumulado >= 0 ? '+' : ''}{pct(retorno.acumulado)}</span>
                </div>
              )}
            </div>
            {historial.map((s, i) => {
              const prev = historial[i + 1];
              const delta = prev ? s.totalInvertibleUsd - prev.totalInvertibleUsd : null;
              const rPct = retornoMap.get(s.fechaCorrida);
              return (
                <div key={s.fechaCorrida} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : 'none', fontSize: 13 }}>
                  <span style={{ color: 'var(--gf-gray-400)', minWidth: 54, fontSize: 12 }}>{fmtFecha(s.fechaCorrida)}</span>
                  <span style={{ flex: 1, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{$.usd(s.totalInvertibleUsd)}</span>
                  {delta !== null && (
                    <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: delta >= 0 ? 'var(--gf-income)' : 'var(--gf-expense)', fontWeight: 600 }}>
                      {delta >= 0 ? '+' : ''}{pct(delta / (prev!.totalInvertibleUsd || 1))}
                    </span>
                  )}
                  {rPct !== undefined && (
                    <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-sec)', background: 'var(--gf-gray-100)', borderRadius: 6, padding: '2px 6px', fontWeight: 600 }}>
                      {rPct >= 0 ? '+' : ''}{pct(rPct)} aprox.
                    </span>
                  )}
                  {i === 0 && <span style={{ fontSize: 10, background: 'var(--gf-gray-100)', borderRadius: 4, padding: '2px 5px', color: 'var(--gf-gray-400)', fontWeight: 700 }}>HOY</span>}
                </div>
              );
            })}
            <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 8, lineHeight: 1.4 }}>
              {flujos.length > 0
                ? 'Retorno (aprox.) descuenta los flujos registrados en Configuración (Modified Dietz, peso 0,5). Δ% = variación de valor bruta.'
                : 'La variación refleja cambio de valor, no retorno: no descuenta aportes ni retiros. Registrá flujos en Configuración para ver el retorno real.'}
            </div>
          </Card>
        );
      })()}

      {/* 4b. Riesgo y escenarios (F9.116) */}
      <DeclaracionesCard posiciones={posiciones} manuales={manuales} factores={factores} />
      <RiesgoCard posiciones={posiciones} manuales={manuales} topes={topesRiesgo} configurado={riesgoConfigurado} factores={factores} />
      <ReservaCard posiciones={posiciones} manuales={manuales} topes={topesRiesgo} />
      {/* F9.196 H6 — debajo de Reserva y señales: solo excepciones, en el orden de §7. */}
      {(() => {
        const a = accionesAMirar(indicadores, identidadesHoy);
        return <AccionesAMirarCard filas={a.filas} revisadas={a.revisadas} sinDatos={a.sinDatos} calculadoEnISO={a.calculadoEnISO} privado={$.privado} onAbrir={onAbrirFicha} />;
      })()}
      {/* F9.196 H2c — cripto: las cantidades de Bitfinex salen de `cuentasVivas/bitfinex` vía la cartera
          viva (que sincronizarBitfinex recalcula al terminar); sin cartera viva, la corrida. */}
      <CriptoCard posiciones={posiciones.some(p => p.fuente === 'cartera_viva') ? posiciones : posicionesCorrida} pesoClase={Mhoy.cripto} />

      {/* 5. Informe PDF */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: informes.length > 0 ? 10 : 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Informe PDF</span>
          <button
            onClick={() => onGenerarInforme(sinMontos)}
            disabled={generandoInforme}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: 'none', background: generandoInforme ? 'var(--gf-gray-200)' : 'var(--color-accent)', color: generandoInforme ? 'var(--gf-gray-400)' : '#fff', fontSize: 12.5, fontWeight: 700, cursor: generandoInforme ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}
          >
            <Icon name="download" size={13} color={generandoInforme ? 'var(--gf-gray-400)' : '#fff'} />
            {generandoInforme ? 'Generando…' : 'Generar informe PDF'}
          </button>
        </div>
        {informes.length > 0 && (
          <>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>Anteriores</div>
            {informes.map((inf, i) => {
              const fecha = inf.generadoEnISO ? fmtFecha(inf.generadoEnISO.slice(0, 10)) : '—';
              return (
                <div key={inf.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : 'none', fontSize: 12.5 }}>
                  <span style={{ flex: 1 }}>
                    <span style={{ fontWeight: 700 }}>Corrida {fmtFecha(inf.fechaCorrida)}</span>
                    <span style={{ color: 'var(--gf-gray-400)', marginLeft: 6, fontSize: 11 }}>· {fecha}</span>
                  </span>
                  {inf.downloadURL && (
                    <a href={inf.downloadURL} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 700, color: 'var(--color-accent)', textDecoration: 'none' }}>
                      <Icon name="download" size={12} color="var(--color-accent)" /> Descargar
                    </a>
                  )}
                </div>
              );
            })}
          </>
        )}
        {/* F9.120 — opción EXPLÍCITA al generar, no el toggle de pantalla: el PDF queda
            archivado en Storage y después nadie sabría por qué ese informe no tiene números.
            El archivo lo dice en la portada y en el nombre. */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={sinMontos} onChange={e => setSinMontos(e.target.checked)} />
          <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>
            Sin montos <span style={{ color: 'var(--gf-gray-400)' }}>· todo como % de la cartera, para compartir</span>
          </span>
        </label>

        <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: informes.length > 0 ? 8 : 4, lineHeight: 1.4 }}>
          Bajo demanda · incluye análisis IA cacheados
        </div>

        {/* F9.115 — la corrida vuelve a salir de la app: .txt re-importable en la ingesta,
            y dossier .json para análisis externo (no re-importable). */}
        <div style={{ borderTop: '1px solid var(--gf-gray-100)', marginTop: 12, paddingTop: 12, display: 'flex', gap: 8 }}>
          {([
            { id: 'txt' as const,  label: 'Descargar corrida (.txt)',  sub: 'Re-importable en la ingesta' },
            { id: 'json' as const, label: 'Descargar dossier (.json)', sub: 'Corrida + manuales + flujos + historial' },
          ]).map(b => {
            const busy = descargando === b.id;
            return (
              <button
                key={b.id}
                onClick={() => descargarExport(b.id)}
                disabled={descargando !== null}
                style={{ flex: 1, minWidth: 0, textAlign: 'left', padding: '9px 11px', borderRadius: 10, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', cursor: descargando !== null ? 'default' : 'pointer', fontFamily: 'var(--font-base)', opacity: descargando !== null && !busy ? .5 : 1 }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>
                  <Icon name="download" size={12} color="var(--color-text-sec)" />
                  {busy ? 'Generando…' : b.label}
                </span>
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 2, lineHeight: 1.3 }}>{b.sub}</span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ── Solapa Tenencias (consolidada por ticker, desglose por cuenta al tap) ─────
type FilaTenencia =
  | { origen: 'corrida'; pos: Posicion }
  | { origen: 'manual'; pm: PosicionManual };

type ConsolidadoTicker = {
  ticker: string;
  sectorDisp: string;
  totalUsd: number;
  filas: FilaTenencia[];
  tieneManual: boolean;
  tieneRevisar: boolean;
  tieneStale: boolean;
};

// F9.144 — la lista de Tenencias consolida por TICKER (así se venía viendo y no se cambia), pero
// el indicador se busca por IDENTIDAD. Un ticker con dos identidades muestra dos fichas.
function agruparPorIdentidad(filas: FilaTenencia[]): Array<[string, PosicionFicha[]]> {
  const m = new Map<string, PosicionFicha[]>();
  for (const f of filas) {
    const p = f.origen === 'corrida' ? f.pos : f.pm;
    const tipo = (p.tipo ?? 'accion') as PosicionTipo;
    const pais = p.pais_riesgo ?? 'AR';
    const clave = `${p.ticker}|${tipo}|${pais}`;
    if (!m.has(clave)) m.set(clave, []);
    m.get(clave)!.push({
      ticker: p.ticker, tipo, paisRiesgo: pais,
      cuenta: p.cuenta ?? '—',
      cantidad: typeof p.cantidad === 'number' ? p.cantidad : null,
      valorUsd: p.valorUsd,
      monedaOrigen: f.origen === 'corrida' ? f.pos.moneda_origen : 'USD',
      deCarteraViva: f.origen === 'corrida' && f.pos.fuente === 'cartera_viva',
    });
  }
  return [...m.entries()].sort((a, b) =>
    b[1].reduce((s, x) => s + x.valorUsd, 0) - a[1].reduce((s, x) => s + x.valorUsd, 0));
}

function TenenciasTab({ M, posiciones, manuales, fechaCorrida, indicadores, analisisCache, configIA, onAnalizar, onAbrirChat, agenda, sectorial, fichaAbierta, onFichaConsumida, tcHoy, tesisMap, onTesisGuardada }: {
  M: PatMetrics; posiciones: Posicion[]; manuales: PosicionManual[]; fechaCorrida: string;
  /** F9.196 H6 — deep link desde "Acciones a mirar": la identidad cuya ficha hay que abrir. */
  fichaAbierta: string | null;
  onFichaConsumida: () => void;
  /** MEP de hoy (cartera viva), para los cálculos de la tesis en la ficha. */
  tcHoy: number | null;
  tesisMap: Record<string, DocTesis>;
  onTesisGuardada: (d: DocTesis) => void;
  indicadores: Map<string, IndicadoresPosicion>;
  analisisCache: Record<string, AnalisisPosicion>;
  configIA: ConfigIA;
  onAnalizar: (ticker: string, contexto: Record<string, unknown>) => void;
  onAbrirChat: (ticker: string, contexto: Record<string, unknown>) => void;
  agenda: AgendaMacro | null;
  sectorial: AnalisisSectorial | null;
}) {
  const $ = useDinero();
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [analizando, setAnalizando] = useState<Set<string>>(new Set());
  // F9.196 H6 — orden y buscador, manteniendo la agrupación por identidad.
  const [orden, setOrden] = useState<OrdenTenencias>('peso');
  const [busqueda, setBusqueda] = useState('');
  const scrollFicha = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (scrollFicha.current) clearTimeout(scrollFicha.current); }, []);

  // Consolidar por ticker usando valorUsd ya calculado (no re-suma)
  const byTickerMap = new Map<string, ConsolidadoTicker>();
  const todasFilas: FilaTenencia[] = [
    ...posiciones.map(pos => ({ origen: 'corrida' as const, pos })),
    ...manuales.map(pm  => ({ origen: 'manual'  as const, pm  })),
  ];
  for (const fila of todasFilas) {
    const ticker = fila.origen === 'corrida' ? fila.pos.ticker : fila.pm.ticker;
    const val    = fila.origen === 'corrida' ? fila.pos.valorUsd : fila.pm.valorUsd;
    const sec    = fila.origen === 'corrida'
      ? sectorDisplay(fila.pos.sector, fila.pos.pais_riesgo)
      : sectorDisplay(fila.pm.sector, fila.pm.pais_riesgo);
    if (!byTickerMap.has(ticker)) {
      byTickerMap.set(ticker, { ticker, sectorDisp: sec, totalUsd: 0, filas: [], tieneManual: false, tieneRevisar: false, tieneStale: false });
    }
    const entry = byTickerMap.get(ticker)!;
    entry.totalUsd += val;
    entry.filas.push(fila);
    if (fila.origen === 'manual') entry.tieneManual = true;
    if (fila.origen === 'corrida' && fila.pos.revisar) entry.tieneRevisar = true;
    if (fila.origen === 'manual' && fechaCorrida && fila.pm.fechaValuacion < fechaCorrida) entry.tieneStale = true;
  }
  const todosConsolidados = Array.from(byTickerMap.values())
    .map(c => ({ ...c, identidades: agruparPorIdentidad(c.filas).map(([i]) => i) }));
  const consolidados = ordenarTenencias(todosConsolidados, orden, indicadores, busqueda);
  const totalInvertible = todosConsolidados.reduce((s, c) => s + c.totalUsd, 0);

  // F9.196 H6 — deep link: expandir el ticker de esa identidad y hacer scroll hasta su ficha.
  useEffect(() => {
    if (!fichaAbierta) return;
    const c = todosConsolidados.find(x => x.identidades.includes(fichaAbierta));
    if (c) {
      setBusqueda('');
      setExpandidos(prev => new Set(prev).add(c.ticker));
      // El timer no se limpia al consumir el deep link (eso re-corre el efecto), solo al desmontar.
      if (scrollFicha.current) clearTimeout(scrollFicha.current);
      scrollFicha.current = setTimeout(() => document.getElementById(`ficha-${fichaAbierta}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    }
    onFichaConsumida();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fichaAbierta]);

  function toggle(ticker: string) {
    setExpandidos(prev => {
      const next = new Set(prev);
      next.has(ticker) ? next.delete(ticker) : next.add(ticker);
      return next;
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Composición por sector */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Composición por sector</div>
        <CompBar M={M} />
      </Card>

      {/* F9.196 H6 — buscador y orden */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar ticker"
          aria-label="Buscar ticker"
          style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid var(--gf-gray-200)', fontSize: 16, fontFamily: 'var(--font-base)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([['peso', 'Peso'], ['stop', 'Cerca del stop primero'], ['variacion', 'Variación']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setOrden(k)} style={{
              padding: '6px 11px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 12, fontWeight: 700,
              background: orden === k ? 'var(--gf-ink)' : 'var(--gf-gray-100)', color: orden === k ? '#fff' : 'var(--color-text-sec)',
            }}>{l}</button>
          ))}
        </div>
      </div>

      {/* Lista consolidada por ticker */}
      <Card padding="0">
        {consolidados.length === 0 && (
          <div style={{ padding: '14px', fontSize: 12.5, color: 'var(--color-text-sec)' }}>Ningún ticker coincide con «{busqueda}».</div>
        )}
        {consolidados.map((c, idx) => {
          const exp    = expandidos.has(c.ticker);
          const cuentas = new Set(c.filas.map(f => f.origen === 'corrida' ? f.pos.cuenta : f.pm.cuenta)).size;
          const isLast = idx === consolidados.length - 1;
          return (
            <div key={c.ticker}>
              {/* Fila consolidada */}
              <div
                onClick={() => toggle(c.ticker)}
                style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px',
                  borderBottom: (!isLast || exp) ? '1px solid var(--gf-gray-100)' : 'none',
                  cursor: 'pointer' }}
              >
                <MerchantLogo nombre={c.ticker} size={40} radius={8} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{c.ticker}</span>
                    {c.tieneManual && (
                      <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--gf-gray-100)', color: 'var(--color-text-sec)', borderRadius: 4, padding: '2px 5px' }}>MANUAL</span>
                    )}
                    {(c.tieneRevisar || c.tieneStale) && (
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--gf-out)', flexShrink: 0, display: 'inline-block' }} />
                    )}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--color-text-sec)', display: 'flex', gap: 5, alignItems: 'center' }}>
                    <span style={{ width: 7, height: 7, borderRadius: 3, background: sectorColor(c.sectorDisp), flexShrink: 0, display: 'inline-block' }} />
                    {c.sectorDisp}
                    {cuentas > 1 && <span style={{ fontSize: 10.5, color: 'var(--gf-gray-400)' }}>· {cuentas} cuentas</span>}
                  </span>
                </span>
                <span style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{$.usd(c.totalUsd)}</span>
                  <span style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{pct(c.totalUsd / M.total)}</span>
                </span>
                <Icon name={exp ? 'chevron-up' : 'chevron-down'} size={14} color="var(--gf-gray-400)" />
              </div>

              {/* Acordeón: desglose por cuenta */}
              {exp && (
                <div style={{ background: 'var(--gf-gray-50)', borderBottom: !isLast ? '1px solid var(--gf-gray-100)' : 'none' }}>
                  {c.filas.map((fila, fi) => {
                    const fkey   = fila.origen === 'corrida'
                      ? `${fila.pos.ticker}-${fila.pos.cuenta}-${fi}`
                      : fila.pm.id;
                    const val    = fila.origen === 'corrida' ? fila.pos.valorUsd : fila.pm.valorUsd;
                    const cta    = fila.origen === 'corrida' ? fila.pos.cuenta   : fila.pm.cuenta;
                    const titular = fila.origen === 'corrida' ? fila.pos.titular  : null;
                    const cant   = fila.origen === 'corrida' ? fila.pos.cantidad  : fila.pm.cantidad;
                    const rev    = fila.origen === 'corrida' && fila.pos.revisar;
                    const stale  = fila.origen === 'manual' && fechaCorrida && fila.pm.fechaValuacion < fechaCorrida;
                    const fechaVal = fila.origen === 'manual' ? fila.pm.fechaValuacion : null;
                    return (
                      <div key={fkey} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 14px 9px 22px', borderTop: fi > 0 ? '1px solid var(--gf-gray-100)' : 'none' }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{cta}</span>
                          {titular && <span style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', marginLeft: 5 }}>{titular}</span>}
                          <span style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
                            {/* F9.121 — los nominales se ocultan: revelan el tamaño de la
                                posición y no tienen conversión a % que signifique algo. */}
                            {cant != null && !$.privado && (
                              <span style={{ fontSize: 11.5, color: 'var(--color-text-sec)' }}>{cant.toLocaleString('es-AR')} nom.</span>
                            )}
                            {fila.origen === 'manual' && (
                              <span style={{ fontSize: 9.5, fontWeight: 700, background: 'var(--gf-gray-200)', color: 'var(--color-text-sec)', borderRadius: 4, padding: '1px 5px' }}>
                                MANUAL · {fmtFecha(fechaVal!)}
                              </span>
                            )}
                            {rev && (
                              <span style={{ fontSize: 9.5, fontWeight: 700, background: 'rgba(245,158,11,.15)', color: 'var(--gf-out)', borderRadius: 4, padding: '1px 5px' }}>REVISAR</span>
                            )}
                            {stale && (
                              <span style={{ fontSize: 9.5, color: 'var(--gf-out)' }}>val. anterior a corrida</span>
                            )}
                          </span>
                          {/* F9.189 §2.3 — qué mirar, si la extracción lo dijo. Texto libre que puede
                              traer montos ("encabezado 15.708 vs detalle 15.487"): se oculta en modo
                              privacidad, mismo criterio que los nominales (F9.121). */}
                          {rev && fila.origen === 'corrida' && fila.pos.motivo_revisar && !$.privado && (
                            <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-sec)', marginTop: 3, lineHeight: 1.35 }}>
                              {fila.pos.motivo_revisar}
                            </span>
                          )}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0, paddingTop: 2 }}>
                          {$.usd(val)}
                        </span>
                      </div>
                    );
                  })}
                  {/* F9.144 — la ficha va ANTES del análisis: primero el dato duro, después la
                      opinión. Una ficha POR IDENTIDAD (ticker|tipo|paisRiesgo), no por ticker:
                      GLOB es a la vez un CEDEAR en ARS y una acción global en USD, y buscar por
                      ticker le daría al plan de empleado los indicadores del CEDEAR. Es el
                      defecto que F9.141.1 cerró en el escritor; no se reintroduce en el lector. */}
                  {agruparPorIdentidad(c.filas).map(([ident, fichaFilas], iIdent) => (
                    <div key={ident} id={`ficha-${ident}`} style={{ scrollMarginTop: 12 }}>
                      <FichaPosicion
                        ident={ident}
                        filas={fichaFilas}
                        ind={indicadores.get(ident) ?? null}
                        privado={$.privado}
                        tesis={tesisMap[c.ticker] ?? null}
                        onTesisGuardada={onTesisGuardada}
                        mostrarTesis={iIdent === 0}
                        tc={tcHoy}
                      />
                    </div>
                  ))}
                  {/* F9.93: Análisis IA por ticker. F9.196 H6: plegado (es lo de consulta, va al final). */}
                  <div style={{ padding: '0 10px 10px' }}>
                  <Plegable titulo="ANÁLISIS IA COMPLETO">
                  <AnalisisIASection
                    ticker={c.ticker}
                    totalUsd={c.totalUsd}
                    totalPortafolio={M.total}
                    sectorDisp={c.sectorDisp}
                    // F9.147 §1 — la ficha entra al contexto del prompt. Misma agrupación por
                    // IDENTIDAD que usa la ficha de arriba: si el modelo va a opinar sobre GLOB,
                    // tiene que ver las DOS (el CEDEAR en ARS y la acción global en USD), no una
                    // mezcla. Se arma acá y no adentro para no volver a resolver identidades.
                    identidades={agruparPorIdentidad(c.filas).map(([ident, fichaFilas]) => ({
                      identidad: ident,
                      tipo: fichaFilas[0].tipo,
                      paisRiesgo: fichaFilas[0].paisRiesgo,
                      valorUsd: fichaFilas.reduce((s, x) => s + x.valorUsd, 0),
                      cantidad: fichaFilas.every(x => x.cantidad !== null)
                        ? fichaFilas.reduce((s, x) => s + (x.cantidad ?? 0), 0) : null,
                      ind: indicadores.get(ident) ?? null,
                    }))}
                    analisis={analisisCache[c.ticker] ?? null}
                    analizando={analizando.has(c.ticker)}
                    configIA={configIA}
                    onAnalizar={(ctx) => {
                      if (analizando.has(c.ticker)) return;
                      setAnalizando(prev => { const n = new Set(prev); n.add(c.ticker); return n; });
                      onAnalizar(c.ticker, ctx);
                      setTimeout(() => setAnalizando(prev => { const n = new Set(prev); n.delete(c.ticker); return n; }), 30000);
                    }}
                    onAbrirChat={(ctx) => onAbrirChat(c.ticker, ctx)}
                    agenda={agenda}
                    sectorial={sectorial}
                  />
                  </Plegable>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {/* Pie: total invertible (debe cuadrar con el hero) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, padding: '0 4px', fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ color: 'var(--gf-gray-400)' }}>Total invertible</span>
        <span>{$.usd(totalInvertible)}</span>
      </div>

      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', textAlign: 'center' }}>
        {posiciones.length} {posiciones.some(p => p.fuente === 'cartera_viva') ? 'posiciones (valor de hoy)' : 'posiciones corrida'} · {manuales.length} manuales · {todosConsolidados.length} tickers · carga del {fmtFecha(fechaCorrida)}
      </div>
    </div>
  );
}

// ── Solapa Riesgo ─────────────────────────────────────────────────────────────
function RiesgoTab({ M, posiciones }: { M: PatMetrics; posiciones: Posicion[] }) {
  const $ = useDinero();
  const criptoTickers = posiciones.filter(p => p.tipo === 'cripto').map(p => p.ticker).join(' + ') || 'sin cripto';
  const rows: { k: string; sub: string; v: string; b: 'verde' | 'amarillo' | 'rojo'; band: string }[] = [
    { k: 'Nombre más grande', sub: M.nombreTop.ticker + ' · cripto se mide aparte', v: pct(M.top1), b: banda('nombre', M.top1), band: '🟢 ≤5 · 🟡 5–10 · 🔴 >10%' },
    { k: 'Sector top',        sub: M.sectorTop.nombre,                               v: pct(M.sectorTop.pct), b: banda('sector', M.sectorTop.pct), band: '🟢 <25 · 🟡 25–40 · 🔴 >40%' },
    { k: 'País único',        sub: 'Argentina',                                      v: pct(M.paisAr), b: banda('pais', M.paisAr), band: '🟢 <40 · 🟡 40–60 · 🔴 >60%' },
    { k: 'Cripto (clase)',    sub: criptoTickers,                                     v: pct(M.cripto), b: banda('cripto', M.cripto), band: '🟢 <10 · 🟡 10–20 · 🔴 >20%' },
    { k: 'HHI (concentración global)', sub: 'umbral DOJ',                             v: M.hhi.toFixed(2), b: banda('hhi', M.hhi), band: '🟢 <0,15 · 🟡 0,15–0,25 · 🔴 >0,25' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map(r => (
        <Card key={r.k} style={{ background: SEM[r.b].bg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ width: 11, height: 11, borderRadius: 999, background: SEM[r.b].dot, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{r.k}</span>
              <span style={{ fontSize: 11.5, color: 'var(--color-text-sec)' }}>{r.sub}</span>
            </span>
            <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{r.v}</span>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,.06)', letterSpacing: '.2px' }}>
            {r.band}
          </div>
        </Card>
      ))}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Top-3 / Top-5</div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
          Las 3 mayores posiciones son <strong style={{ color: 'var(--color-text)' }}>{pct(M.top3)}</strong> del total; las 5 mayores, <strong style={{ color: 'var(--color-text)' }}>{pct(M.top5)}</strong>.
        </div>
      </Card>
      <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', textAlign: 'center', lineHeight: 1.5 }}>
        El <strong style={{ color: 'var(--color-text-sec)' }}>% en renta variable ({pct(M.rvPct)})</strong> es informativo, sin semáforo:<br />
        la postura busca RV alta, no es un límite a controlar.
      </div>

      {/* Escenarios de estrés */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>¿Qué pasa si...?</div>
        {/* F9.116 — el registro es único (sistémicos por beta + idiosincráticos), así que
            acá aparecen los ocho. El signo lo pone el escenario: el rally suma. */}
        {calcEscenarios(posiciones, []).map((r, i) => (
          <div key={r.id} style={{ padding: '10px 0', borderTop: '1px solid var(--gf-gray-100)', marginTop: i === 0 ? 10 : 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 5 }}>{r.nombre}</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12.5 }}>
              <span>
                <span style={{ color: 'var(--gf-gray-400)' }}>{r.perdidaUsd >= 0 ? 'Ganancia ' : 'Pérdida '}</span>
                <strong style={{ color: r.perdidaUsd >= 0 ? 'var(--gf-income)' : 'var(--gf-expense)', fontVariantNumeric: 'tabular-nums' }}>
                  {$.privado ? '' : `${$.usd(r.perdidaUsd)} `}({pct(r.perdidaPct)})
                </strong>
              </span>
              <span>
                <span style={{ color: 'var(--gf-gray-400)' }}>Resultante </span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{$.usd(r.totalFinal)}</strong>
              </span>
            </div>
          </div>
        ))}
        <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 10, lineHeight: 1.4 }}>
          Escenarios ilustrativos con shocks fijos; no son predicciones ni probabilidades.
        </div>
      </Card>
    </div>
  );
}

// ── Modal: registrar decisión ─────────────────────────────────────────────────
function ModalRegistrarDecision({
  preload, metricasActuales, onGuardar, onClose,
}: {
  preload?: { opcionReferencia: 'A' | 'B' | 'C' | null; tickers: string[] } | null;
  metricasActuales: MetricasSnap;
  onGuardar: (d: NuevaDecision) => void;
  onClose: () => void;
}) {
  const $ = useDinero();
  const [titulo, setTitulo] = useState('');
  const [razon, setRazon] = useState('');
  const [tickersStr, setTickersStr] = useState((preload?.tickers ?? []).join(', '));

  const tickers = tickersStr.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
  const valid = titulo.trim().length > 0;

  function guardar() {
    if (!valid) return;
    const filteredValores = Object.fromEntries(tickers.map(t => [t, metricasActuales.valoresTickers[t] ?? 0]));
    const snap: MetricasSnap = { ...metricasActuales, valoresTickers: filteredValores };
    onGuardar({ titulo: titulo.trim(), razon: razon.trim(), tickers, opcionReferencia: preload?.opcionReferencia ?? null, metricasAlCrear: snap });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', background: 'var(--color-surface)', borderRadius: '20px 20px 0 0', padding: '22px 18px 36px', maxHeight: '90dvh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>Registrar decisión</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={20} color="var(--color-text)" />
          </button>
        </div>

        {preload?.opcionReferencia && (
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-accent)', background: 'rgba(6,95,70,.08)', borderRadius: 8, padding: '6px 10px', marginBottom: 14 }}>
            Desde Opción {preload.opcionReferencia}
          </div>
        )}

        {([
          { label: 'Título', val: titulo, set: setTitulo, placeholder: 'Recorte TRAN a ~10%', required: true },
          { label: 'Razón (texto libre)', val: razon, set: setRazon, placeholder: 'Por qué la tomás', required: false },
          { label: 'Tickers involucrados (opcional, separados por coma)', val: tickersStr, set: setTickersStr, placeholder: 'TRAN, PAMP', required: false },
        ]).map(f => (
          <div key={f.label} style={{ marginBottom: 13 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', marginBottom: 5 }}>
              {f.label}{f.required && <span style={{ color: 'var(--gf-expense)' }}> *</span>}
            </div>
            <input
              type="text" value={f.val} placeholder={f.placeholder}
              onChange={e => f.set(e.target.value)}
              style={{ width: '100%', padding: '11px 13px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', fontSize: 14, fontFamily: 'var(--font-base)', background: 'var(--gf-gray-50)', boxSizing: 'border-box' }}
            />
          </div>
        ))}

        <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginBottom: 16, lineHeight: 1.4 }}>
          Foto de métricas actuales: {$.privado ? '' : `${$.usd(metricasActuales.totalInvertibleUsd)} total · `}HHI {metricasActuales.hhi.toFixed(2)} · Cripto {pct(metricasActuales.criptoPct)}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '12px 14px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={!valid} style={{ flex: 2, padding: '12px 14px', borderRadius: 11, border: 'none', background: valid ? 'var(--color-accent)' : 'var(--gf-gray-200)', color: valid ? '#fff' : 'var(--gf-gray-400)', fontSize: 14, fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'var(--font-base)' }}>
            Registrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: revisar decisión (30d / 90d) ───────────────────────────────────────
function ModalRevision({
  decision, tipo, metricasActuales, onGuardar, onClose,
}: {
  decision: DecisionPatrimonio;
  tipo: '30d' | '90d';
  metricasActuales: MetricasSnap;
  onGuardar: (notas: string, metricas: MetricasSnap) => void;
  onClose: () => void;
}) {
  const $ = useDinero();
  const [quePaso, setQuePaso] = useState('');
  const [laVolveria, setLaVolveria] = useState('');
  const valid = quePaso.trim().length > 0;

  const entonces = decision.metricasAlCrear;
  const ahora: MetricasSnap = {
    ...metricasActuales,
    valoresTickers: Object.fromEntries(
      decision.tickers.map(t => [t, metricasActuales.valoresTickers[t] ?? 0])
    ),
  };

  function fmtDelta(a: number, b: number, kind: 'usd' | 'pct') {
    const d = b - a;
    const sign = d >= 0 ? '+' : '';
    return kind === 'usd' ? `${sign}${$.usd(d)}` : `${sign}${(d * 100).toFixed(1)} pp`;
  }

  const metricas: { label: string; ent: string; hoy: string; delta: string }[] = [
    { label: 'Total invertible', ent: $.usd(entonces.totalInvertibleUsd), hoy: $.usd(ahora.totalInvertibleUsd), delta: fmtDelta(entonces.totalInvertibleUsd, ahora.totalInvertibleUsd, 'usd') },
    { label: 'Energía AR', ent: pct(entonces.energiaArPct), hoy: pct(ahora.energiaArPct), delta: fmtDelta(entonces.energiaArPct, ahora.energiaArPct, 'pct') },
    { label: 'País AR', ent: pct(entonces.paisArPct), hoy: pct(ahora.paisArPct), delta: fmtDelta(entonces.paisArPct, ahora.paisArPct, 'pct') },
    { label: 'Cripto', ent: pct(entonces.criptoPct), hoy: pct(ahora.criptoPct), delta: fmtDelta(entonces.criptoPct, ahora.criptoPct, 'pct') },
    { label: `Top-1 (${entonces.top1Ticker})`, ent: pct(entonces.top1Pct), hoy: pct(ahora.top1Pct), delta: fmtDelta(entonces.top1Pct, ahora.top1Pct, 'pct') },
    { label: 'HHI', ent: entonces.hhi.toFixed(2), hoy: ahora.hhi.toFixed(2), delta: `${(ahora.hhi - entonces.hhi >= 0 ? '+' : '')}${(ahora.hhi - entonces.hhi).toFixed(2)}` },
  ];

  function guardar() {
    if (!valid) return;
    const notas = laVolveria.trim()
      ? `${quePaso.trim()}\n\n¿La volvería a tomar?\n${laVolveria.trim()}`
      : quePaso.trim();
    onGuardar(notas, ahora);
  }

  const celStyle = (align?: string): React.CSSProperties => ({
    padding: '5px 8px', fontSize: 11, fontVariantNumeric: 'tabular-nums',
    textAlign: (align as React.CSSProperties['textAlign']) ?? 'left',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', background: 'var(--color-surface)', borderRadius: '20px 20px 0 0', padding: '22px 18px 36px', maxHeight: '93dvh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>Revisión {tipo}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={20} color="var(--color-text)" />
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 16 }}>{decision.titulo}</div>

        {/* Tabla entonces → hoy (colores neutros, sin semáforos) */}
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>Entonces → hoy</div>
        <div style={{ border: '1px solid var(--gf-gray-200)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', background: 'var(--gf-gray-100)', fontSize: 9.5, fontWeight: 700, color: 'var(--gf-gray-500)' }}>
            {['Métrica', 'Entonces', 'Hoy', 'Δ'].map((h, i) => (
              <div key={h} style={{ ...celStyle(i > 0 ? 'right' : undefined), padding: '6px 8px' }}>{h}</div>
            ))}
          </div>
          {metricas.map((m, i) => (
            <div key={m.label} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', borderTop: '1px solid var(--gf-gray-100)', background: i % 2 ? 'var(--gf-gray-50)' : 'transparent' }}>
              <div style={{ ...celStyle(), color: 'var(--color-text-sec)', fontSize: 10.5 }}>{m.label}</div>
              <div style={celStyle('right')}>{m.ent}</div>
              <div style={celStyle('right')}>{m.hoy}</div>
              <div style={{ ...celStyle('right'), color: 'var(--color-text-sec)' }}>{m.delta}</div>
            </div>
          ))}
          {decision.tickers.map((t, i) => {
            const valA = entonces.valoresTickers[t] ?? 0;
            const valH = ahora.valoresTickers[t] ?? 0;
            return (
              <div key={t} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', borderTop: '1px solid var(--gf-gray-100)', background: (metricas.length + i) % 2 ? 'var(--gf-gray-50)' : 'transparent' }}>
                <div style={{ ...celStyle(), fontWeight: 700 }}>{t}</div>
                <div style={celStyle('right')}>{$.usd(valA)}</div>
                <div style={celStyle('right')}>{$.usd(valH)}</div>
                <div style={{ ...celStyle('right'), color: 'var(--color-text-sec)' }}>{fmtDelta(valA, valH, 'usd')}</div>
              </div>
            );
          })}
        </div>

        {/* Preguntas de reflexión */}
        <div style={{ marginBottom: 13 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', marginBottom: 5 }}>
            ¿Qué pasó desde entonces?<span style={{ color: 'var(--gf-expense)' }}> *</span>
          </div>
          <textarea
            value={quePaso} onChange={e => setQuePaso(e.target.value)}
            placeholder="Describí brevemente qué ocurrió con la posición y el mercado"
            rows={3}
            style={{ width: '100%', padding: '11px 13px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', fontSize: 13, fontFamily: 'var(--font-base)', background: 'var(--gf-gray-50)', boxSizing: 'border-box', resize: 'vertical' }}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', marginBottom: 5 }}>
            ¿La volverías a tomar? ¿Por qué?
          </div>
          <textarea
            value={laVolveria} onChange={e => setLaVolveria(e.target.value)}
            placeholder="Reflexión sobre el proceso de decisión"
            rows={3}
            style={{ width: '100%', padding: '11px 13px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', fontSize: 13, fontFamily: 'var(--font-base)', background: 'var(--gf-gray-50)', boxSizing: 'border-box', resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '12px 14px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={!valid} style={{ flex: 2, padding: '12px 14px', borderRadius: 11, border: 'none', background: valid ? 'var(--color-accent)' : 'var(--gf-gray-200)', color: valid ? '#fff' : 'var(--gf-gray-400)', fontSize: 14, fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'var(--font-base)' }}>
            Guardar revisión
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Diario de decisiones (sección dentro de PlanTab) ──────────────────────────
function DiarioDecisiones({ decisiones, onNueva, onIniciarRevision }: {
  decisiones: DecisionPatrimonio[];
  onNueva: () => void;
  onIniciarRevision: (d: DecisionPatrimonio, tipo: '30d' | '90d') => void;
}) {
  const $ = useDinero();
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpandidos(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function fmtTs(ts: { toDate(): Date }) {
    const d = ts.toDate();
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear().toString().slice(2)}`;
  }

  const ESTADO_LABEL: Record<string, string> = {
    abierta: 'abierta', revisada30: 'revisada 30d', revisada90: 'revisada 90d', cerrada: 'cerrada',
  };

  return (
    <Card padding="0">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 14px', borderBottom: decisiones.length > 0 ? '1px solid var(--gf-gray-100)' : 'none' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Diario de decisiones</span>
        <button onClick={onNueva} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: 'none', background: 'var(--gf-gray-100)', fontSize: 12, fontWeight: 700, color: 'var(--color-text)', cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
          <Icon name="plus" size={13} color="var(--color-text)" /> Decisión
        </button>
      </div>

      {decisiones.length === 0 && (
        <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--gf-gray-400)', textAlign: 'center', lineHeight: 1.5 }}>
          Sin decisiones registradas.{'\n'}Usá "+ Decisión" o el botón en cada Opción.
        </div>
      )}

      {decisiones.map((d, idx) => {
        const exp = expandidos.has(d.id);
        const pendiente = revisionPendiente(d);
        const isLast = idx === decisiones.length - 1;
        return (
          <div key={d.id}>
            <div onClick={() => toggle(d.id)} style={{ padding: '10px 14px', borderBottom: (!isLast || exp) ? '1px solid var(--gf-gray-100)' : 'none', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{d.titulo}</span>
                    {d.opcionReferencia && (
                      <span style={{ fontSize: 9.5, fontWeight: 700, background: 'var(--gf-ink)', color: '#fff', borderRadius: 4, padding: '1px 5px' }}>Op. {d.opcionReferencia}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10.5, color: 'var(--gf-gray-400)' }}>{fmtTs(d.creadaEn)}</span>
                    {d.tickers.map(t => (
                      <span key={t} style={{ fontSize: 9.5, fontWeight: 700, background: 'var(--gf-gray-100)', color: 'var(--color-text-sec)', borderRadius: 4, padding: '1px 5px' }}>{t}</span>
                    ))}
                    <span style={{ fontSize: 9.5, fontWeight: 700, background: 'var(--gf-gray-100)', color: 'var(--color-text-sec)', borderRadius: 4, padding: '1px 5px' }}>
                      {ESTADO_LABEL[d.estado] ?? d.estado}
                    </span>
                    {pendiente && (
                      <span style={{ fontSize: 9.5, fontWeight: 700, background: 'rgba(245,158,11,.15)', color: '#b45309', borderRadius: 4, padding: '1px 5px', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Icon name="clock" size={9} color="#b45309" /> revisión {pendiente}
                      </span>
                    )}
                  </div>
                </div>
                <Icon name={exp ? 'chevron-up' : 'chevron-down'} size={14} color="var(--gf-gray-400)" />
              </div>
            </div>

            {exp && (
              <div style={{ background: 'var(--gf-gray-50)', padding: '12px 14px', borderBottom: !isLast ? '1px solid var(--gf-gray-100)' : 'none' }}>
                {d.razon && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginBottom: 10, lineHeight: 1.5 }}>{d.razon}</div>
                )}

                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>Al registrar</div>
                <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)', marginBottom: 10, lineHeight: 1.7 }}>
                  {$.privado ? '' : `${$.usd(d.metricasAlCrear.totalInvertibleUsd)} total · `}HHI {d.metricasAlCrear.hhi.toFixed(2)} · Cripto {pct(d.metricasAlCrear.criptoPct)} · País AR {pct(d.metricasAlCrear.paisArPct)}
                  {Object.entries(d.metricasAlCrear.valoresTickers).map(([t, v]) => (
                    <span key={t}> · {t} {$.usd(v as number)}</span>
                  ))}
                </div>

                {/* Revisiones previas */}
                {!d.revisiones.some(r => r.tipo === '30d') && d.revisiones.some(r => r.tipo === '90d') && (
                  <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', fontStyle: 'italic', marginBottom: 6 }}>Revisión 30d omitida</div>
                )}
                {d.revisiones.map((r, ri) => (
                  <div key={ri} style={{ marginBottom: 8, padding: '8px 10px', background: 'var(--color-surface)', borderRadius: 8, border: '1px solid var(--gf-gray-200)' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', marginBottom: 3 }}>
                      Revisión {r.tipo} · {fmtTs(r.fecha)}
                    </div>
                    {r.notas && (
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{r.notas}</div>
                    )}
                    <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                      {$.usd(r.metricasAlRevisar.totalInvertibleUsd)} total al revisar · Δ {r.metricasAlRevisar.totalInvertibleUsd - d.metricasAlCrear.totalInvertibleUsd >= 0 ? '+' : ''}{$.usd(r.metricasAlRevisar.totalInvertibleUsd - d.metricasAlCrear.totalInvertibleUsd)}
                    </div>
                  </div>
                ))}

                {pendiente && (
                  <button
                    onClick={() => onIniciarRevision(d, pendiente)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, padding: '8px 14px', borderRadius: 9, border: '1px solid rgba(245,158,11,.4)', background: 'rgba(245,158,11,.1)', fontSize: 12, fontWeight: 700, color: '#b45309', cursor: 'pointer', fontFamily: 'var(--font-base)' }}
                  >
                    <Icon name="clock" size={12} color="#b45309" /> Iniciar revisión {pendiente}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}

// ── Solapa Plan ───────────────────────────────────────────────────────────────
function PlanTab({ M, posiciones, decisiones, onRegistrarLibre, onRegistrarDesdeOpcion, onIniciarRevision }: {
  M: PatMetrics; posiciones: Posicion[];
  decisiones: DecisionPatrimonio[];
  onRegistrarLibre: () => void;
  onRegistrarDesdeOpcion: (opcionId: 'A' | 'B' | 'C', tickers: string[]) => void;
  onIniciarRevision: (decision: DecisionPatrimonio, tipo: '30d' | '90d') => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card>
        <div style={{ fontSize: 14, fontWeight: 800 }}>La idea madre</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-sec)', marginTop: 6, lineHeight: 1.5 }}>
          Mantener el <strong style={{ color: 'var(--color-text)' }}>{pct(M.rvPct)} en renta variable</strong>, cambiar su composición.
          No es vender para quedarse en pesos: es repartir la misma apuesta de crecimiento.
        </div>
      </Card>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '2px 2px 0' }}>
        Opciones
      </div>
      {OPCIONES_CONFIG.map(o => {
        const tickersPreload = o.cortes.filter(c => c.tipo === 'ticker').map(c => c.key);
        return (
          <OpcionCard
            key={o.id}
            opcion={o}
            posiciones={posiciones}
            onRegistrarDecision={() => onRegistrarDesdeOpcion(o.id, tickersPreload)}
          />
        );
      })}
      <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--gf-gray-100)', fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
        Estas opciones miden direcciones posibles, no son recomendaciones. Podés combinarlas o ignorarlas.
      </div>
      <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--gf-gray-100)', fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
        No es asesoramiento matriculado. Las posiciones ganadoras en USD tienen costo impositivo al vender; conviene pensar gradual. Parte está en cuentas conjuntas.
      </div>
      <DiarioDecisiones
        decisiones={decisiones}
        onNueva={onRegistrarLibre}
        onIniciarRevision={onIniciarRevision}
      />
    </div>
  );
}

// ── Markdown renderer liviano (sin dependencias, para sectorial) ──────────────
function renderInline(text: string): JSX.Element {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i}>{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

function renderMarkdownLite(text: string): JSX.Element {
  const lines = text.split('\n');
  const nodes: JSX.Element[] = [];
  const paraBuf: string[] = [];

  const flushPara = () => {
    const content = paraBuf.join(' ').trim();
    paraBuf.length = 0;
    if (!content) return;
    nodes.push(<p key={nodes.length} style={{ fontSize: 12, lineHeight: 1.6, margin: '0 0 5px 0', color: 'var(--color-text-sec)' }}>{renderInline(content)}</p>);
  };

  for (const raw of lines) {
    if (raw.startsWith('## ')) {
      flushPara();
      const title = raw.slice(3).replace(/\s*\[driver:\s*\w+\]/, '').trim();
      nodes.push(<div key={nodes.length} style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)', marginTop: 8, marginBottom: 2 }}>{title}</div>);
    } else if (/^[-·•]\s/.test(raw)) {
      flushPara();
      nodes.push(<div key={nodes.length} style={{ fontSize: 11.5, color: 'var(--color-text-sec)', padding: '1px 0' }}>· {renderInline(raw.replace(/^[-·•]\s/, ''))}</div>);
    } else if (/^Si .+→/.test(raw)) {
      flushPara();
      const arrowIdx = raw.indexOf('→');
      const cond = raw.slice(0, arrowIdx).trim();
      const result = raw.slice(arrowIdx + 1).trim();
      nodes.push(
        <div key={nodes.length} style={{ background: 'var(--gf-gray-50)', border: '1px solid var(--gf-gray-100)', borderRadius: 6, padding: '5px 10px', fontSize: 11.5, margin: '2px 0' }}>
          <span style={{ fontWeight: 700 }}>{cond} →</span>
          <span style={{ color: 'var(--color-text-sec)' }}> {renderInline(result)}</span>
        </div>
      );
    } else if (raw.trim() === '') {
      flushPara();
    } else {
      paraBuf.push(raw);
    }
  }
  flushPara();
  return <>{nodes}</>;
}

// ── Análisis IA por ticker (dentro del acordeón de Tenencias) ────────────────
// ── F9.147 §1 — fundamentals: reportados, no calculados ───────────────────────
// Bloque visualmente distinto y marca EXT, porque en una grilla se ven idénticos a los de la
// ficha y un P/E equivocado al lado de un semáforo verde se lee como dato de la app.
// **Fuente y fecha son parte del dato**: sin ellas el número no se puede juzgar.
// SIN SEMÁFORO: un umbral sobre algo no verificable convierte un dato dudoso en un veredicto.
function BloqueFundamentals({ f }: { f: Fundamentals | null }) {
  if (!f) return null;
  const conValor = f.metricas?.filter(m => m.valor !== null && m.valor !== undefined) ?? [];
  const sinValor = f.metricas?.filter(m => m.valor === null || m.valor === undefined) ?? [];
  if (conValor.length === 0 && !f.motivoSinDatos && sinValor.length === 0) return null;

  return (
    <div style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.25)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)' }}>Fundamentals</span>
        <MarcaOrigen tipo="reportado" />
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--gf-gray-400)' }}>
          {f.fuente ?? 'sin fuente'}{f.fechaDato ? ` · ${f.fechaDato}` : ''}
        </span>
      </div>
      {conValor.map((m, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5, padding: '1.5px 0' }}>
          <span style={{ color: 'var(--color-text-sec)', flex: 1 }}>{m.nombre}</span>
          <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {typeof m.valor === 'number' ? m.valor.toLocaleString('es-AR', { maximumFractionDigits: 2 }) : m.valor}
            {m.unidad ? ` ${m.unidad}` : ''}
          </span>
          {m.comentario && <span style={{ fontSize: 10, color: 'var(--gf-gray-400)', flexBasis: '100%' }}>{m.comentario}</span>}
        </div>
      ))}
      {/* Un hueco explícito vale más que un número inventado: se muestra que se buscó y no había. */}
      {sinValor.length > 0 && (
        <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 3 }}>
          Sin dato: {sinValor.map(m => m.nombre).join(', ')}
        </div>
      )}
      {f.motivoSinDatos && (
        <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 3 }}>{f.motivoSinDatos}</div>
      )}
      <div style={{ fontSize: 10, color: 'var(--gf-gray-400)', marginTop: 5, lineHeight: 1.4 }}>
        <strong>EXT</strong> = reportado por el modelo vía búsqueda web. La app no lo puede
        verificar contra su propia serie, y por eso no lleva semáforo.
      </div>
    </div>
  );
}

// ── F9.147 §3 — recomendación y justificación ─────────────────────────────────
// La recomendación explícita convive con `queHariaEnCadaCaso`; no lo reemplaza. Y solo se emite
// si cita indicadores concretos: sin eso va `null` con el motivo a la vista, que es la versión
// exigente de la regla vieja ("prohibido imperativos sin condición"), no su eliminación.
function BloqueRecomendacion({ r, justificacion }: { r: Recomendacion | null; justificacion?: string[] }) {
  if (!r && !(justificacion && justificacion.length > 0)) return null;
  const citados = r?.indicadoresCitados ?? [];
  const emitida = !!r?.accion && citados.length > 0;

  return (
    <div style={{ marginTop: 2, paddingTop: 6, borderTop: '1px solid var(--gf-gray-100)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', marginBottom: 4 }}>Recomendación</div>
      {emitida ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, background: 'var(--gf-gray-100)', borderRadius: 6, padding: '3px 9px' }}>
            {r!.accion}
          </span>
          {citados.map((c, i) => (
            <span key={i} style={{ fontSize: 10.5, color: 'var(--color-text-sec)', background: 'var(--gf-gray-50)', borderRadius: 5, padding: '2px 6px' }}>
              {c.nombre}: <strong>{c.valor}</strong>
            </span>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', marginBottom: 4, lineHeight: 1.5 }}>
          Sin recomendación
          {r?.motivoSinRecomendacion ? `: ${r.motivoSinRecomendacion}` : (r?.accion && citados.length === 0
            ? ': el modelo propuso una acción pero no citó indicadores que la sostengan, así que no se muestra.'
            : '.')}
        </div>
      )}
      {justificacion && justificacion.length > 0 && (
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-gray-400)', marginBottom: 2 }}>Por qué</div>
          {justificacion.map((j, i) => (
            <div key={i} style={{ fontSize: 11.5, color: 'var(--color-text-sec)', padding: '1px 0', lineHeight: 1.45 }}>· {j}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalisisIASection({ ticker, totalUsd, totalPortafolio, sectorDisp, identidades, analisis, analizando, configIA, onAnalizar, onAbrirChat, agenda, sectorial }: {
  ticker: string; totalUsd: number; totalPortafolio: number; sectorDisp: string;
  identidades: Parameters<typeof contextoPosicion>[4];
  analisis: AnalisisPosicion | null;
  analizando: boolean;
  configIA: ConfigIA;
  onAnalizar: (contexto: Record<string, unknown>) => void;
  onAbrirChat: (contexto: Record<string, unknown>) => void;
  agenda: AgendaMacro | null;
  sectorial: AnalisisSectorial | null;
}) {
  const [panoramaExpandido, setPanoramaExpandido] = useState(false);
  // F9.147 §1 — el contexto pasó de cuatro campos a la ficha completa. La transformación vive en
  // `src/datos/patrimonioIA.ts` porque es pura y es lo único de esto que se puede verificar sin
  // pintar (`scripts/verificarF9147.ts`).
  const contexto = contextoPosicion(ticker, sectorDisp, totalUsd, totalPortafolio, identidades);

  const diasAntiguo = analisis
    ? Math.floor((Date.now() - new Date(analisis.generadoEnISO).getTime()) / 86400000)
    : null;

  // Permeado
  const driver = tickerADriver(ticker, sectorDisp);
  const eventosDriver = (agenda && driver !== 'otro')
    ? agenda.eventos
        .filter(ev => ev.driver === driver)
        .sort((a, b) => (!a.fecha ? 1 : !b.fecha ? -1 : a.fecha < b.fecha ? -1 : 1))
        .slice(0, 3)
    : [];
  const seccionesSectorial = sectorial ? splitSectorialPorDriver(sectorial.resultado) : [];
  const seccionDriver = seccionesSectorial.find(s => s.driver === driver);
  const diasSectorial = sectorial
    ? Math.floor((Date.now() - new Date(sectorial.generadoEnISO).getTime()) / 86400000)
    : null;

  return (
    <div style={{ borderTop: '1px solid var(--gf-gray-100)', padding: '10px 14px 10px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: analisis ? 8 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.3px' }}>
            Análisis IA
          </span>
          {analisis?.origen === 'chat' && (
            <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--gf-gray-500)', background: 'var(--gf-gray-100)', borderRadius: 4, padding: '1px 5px' }}>vía chat</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {analisis && diasAntiguo !== null && (
            <span style={{ fontSize: 10.5, color: 'var(--gf-gray-400)' }}>hace {diasAntiguo}d</span>
          )}
          <button
            onClick={() => onAbrirChat(contexto)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 9px', borderRadius: 8, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: 'var(--color-text-sec)', fontFamily: 'var(--font-base)' }}
          >
            <Icon name="message-circle" size={10} color="var(--color-text-sec)" />
            Chat
          </button>
          <button
            onClick={() => onAnalizar(contexto)}
            disabled={analizando || !configIA.habilitado}
            title={!configIA.habilitado ? 'IA deshabilitada — activar en Research' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 11.5, fontWeight: 700, cursor: (analizando || !configIA.habilitado) ? 'default' : 'pointer', color: !configIA.habilitado ? 'var(--gf-gray-400)' : 'var(--color-accent)', fontFamily: 'var(--font-base)' }}
          >
            <Icon name={analizando ? 'loader' : 'zap'} size={11} color={!configIA.habilitado ? 'var(--gf-gray-400)' : 'var(--color-accent)'} />
            {analizando ? 'Analizando…' : analisis ? 'Regenerar' : 'Generar análisis'}
          </button>
        </div>
      </div>

      {analisis && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* F9.147 §1 — los fundamentals van ANTES de la prosa (son dato, no opinión) pero en
              bloque propio y marcados EXT: no son verificables por la app, a diferencia de todo
              lo de la ficha de arriba. Sin semáforo, a propósito. */}
          <BloqueFundamentals f={analisis.resultado.fundamentals ?? null} />
          {analisis.resultado.queEs && (
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700 }}>Qué es: </span>
              {analisis.resultado.queEs}
            </div>
          )}
          {analisis.resultado.situacionActual && (
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700 }}>Hoy: </span>
              {analisis.resultado.situacionActual}
            </div>
          )}
          {analisis.resultado.riesgos && analisis.resultado.riesgos.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', marginBottom: 2 }}>Riesgos</div>
              {analisis.resultado.riesgos.map((r, i) => (
                <div key={i} style={{ fontSize: 11.5, color: 'var(--color-text-sec)', padding: '1px 0' }}>· {r}</div>
              ))}
            </div>
          )}
          {analisis.resultado.rolEnCartera && (
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700 }}>En cartera: </span>
              {analisis.resultado.rolEnCartera}
            </div>
          )}
          {analisis.resultado.proximosEventos && analisis.resultado.proximosEventos.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', marginBottom: 2 }}>Próximos eventos</div>
              {analisis.resultado.proximosEventos.map((e, i) => {
                const ev = normalizarEventoProximo(e);
                return (
                  <div key={i} style={{ display: 'flex', gap: 5, alignItems: 'baseline', fontSize: 11.5, color: 'var(--color-text-sec)', padding: '1px 0' }}>
                    {ev.cuando && (
                      <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--gf-gray-100)', borderRadius: 4, padding: '1px 5px', flexShrink: 0, color: 'var(--gf-gray-500)' }}>
                        {ev.cuando.slice(5).replace('-', '/')}
                      </span>
                    )}
                    <span>· {ev.evento}</span>
                  </div>
                );
              })}
            </div>
          )}
          {analisis.resultado.queHariaEnCadaCaso && analisis.resultado.queHariaEnCadaCaso.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', marginBottom: 4 }}>Qué haría en cada caso</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {analisis.resultado.queHariaEnCadaCaso.map((c, i) => (
                  <div key={i} style={{ background: 'var(--gf-gray-50)', border: '1px solid var(--gf-gray-100)', borderRadius: 6, padding: '6px 10px' }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 2 }}>{c.caso}</div>
                    {(c.acciones ?? []).map((a, j) => (
                      <div key={j} style={{ fontSize: 11.5, color: 'var(--color-text-sec)', padding: '1px 0' }}>· {a}</div>
                    ))}
                    {c.costo && (
                      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 }}>{c.costo}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {analisis.resultado.senalesAVigilar && analisis.resultado.senalesAVigilar.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', marginBottom: 2 }}>Señales a vigilar</div>
              {analisis.resultado.senalesAVigilar.map((s, i) => (
                <div key={i} style={{ fontSize: 11.5, color: 'var(--color-text-sec)', padding: '1px 0' }}>· {s}</div>
              ))}
            </div>
          )}
          {/* F9.147 §3 — el orden termina en RECOMENDACIÓN → JUSTIFICACIÓN, después de los
              escenarios condicionales, que siguen presentes: el veredicto no los reemplaza. */}
          <BloqueRecomendacion
            r={analisis.resultado.recomendacion ?? null}
            justificacion={analisis.resultado.justificacion}
          />
        </div>
      )}

      {/* Permeado: eventos de la agenda del mismo driver */}
      {eventosDriver.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--gf-gray-100)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', marginBottom: 4 }}>De la agenda</div>
          {eventosDriver.map((ev, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 11.5, color: 'var(--color-text-sec)', padding: '2px 0' }}>
              {ev.fecha && (
                <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--gf-gray-100)', borderRadius: 4, padding: '1px 5px', flexShrink: 0, color: 'var(--gf-gray-500)' }}>
                  {ev.fecha.slice(5).replace('-', '/')}
                </span>
              )}
              <span>{ev.evento}</span>
            </div>
          ))}
        </div>
      )}

      {/* Permeado: sección del panorama sectorial del mismo driver */}
      {seccionDriver && (
        <div style={{ marginTop: 6 }}>
          <button
            onClick={() => setPanoramaExpandido(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', color: 'var(--gf-gray-400)', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-base)' }}
          >
            <span>{panoramaExpandido ? '▲' : '▼'}</span>
            <span>Panorama {seccionDriver.titulo}</span>
            {diasSectorial !== null && <span style={{ fontWeight: 400, marginLeft: 4 }}>· hace {diasSectorial}d</span>}
          </button>
          {panoramaExpandido && (
            <div style={{ marginTop: 4, paddingLeft: 4 }}>
              {renderMarkdownLite(seccionDriver.cuerpo)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers de calendario ──────────────────────────────────────────────────────
const DRIVER_CHIP: Record<string, string> = {
  cer_pesos: 'CER', soberano: 'Soberano', tasas_ar: 'Tasas AR',
  tasas_global: 'Fed', cripto: 'Cripto', energia_ar: 'Tarifas',
  tech_global: 'Tech', resultados: 'Earnings', impositivo: 'Fiscal', otro: 'Macro',
  bancos_ar: 'Bancos',
};

type EventoCal = {
  cuandoMs: number | null;
  cuandoDisplay: string;
  texto: string;
  chip: string;
  subtitulo?: string;
  isPast: boolean;
  analisisISO?: string; // antigüedad para eventos de posición
};

function parseCuando(cuando: string | null): { ms: number | null; display: string } {
  if (!cuando) return { ms: null, display: 'Sin fecha' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(cuando)) {
    const ms = new Date(cuando + 'T12:00:00').getTime();
    const [y, m, d] = cuando.split('-');
    return { ms, display: `${d}/${m}/${y}` };
  }
  if (/^\d{4}-\d{2}$/.test(cuando)) {
    const ms = new Date(cuando + '-01T12:00:00').getTime();
    const [y, m] = cuando.split('-');
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return { ms, display: `~${meses[parseInt(m) - 1]} ${y}` };
  }
  return { ms: null, display: cuando };
}

function buildEventosCal(
  analisisCache: Record<string, AnalisisPosicion>,
  agenda: AgendaMacro | null,
): EventoCal[] {
  const ahora = Date.now();
  const hace30 = ahora - 30 * 86400000;
  const eventos: EventoCal[] = [];

  // Eventos de posición
  for (const a of Object.values(analisisCache)) {
    for (const raw of a.resultado.proximosEventos ?? []) {
      const { cuando, evento } = normalizarEventoProximo(raw);
      const { ms, display } = parseCuando(cuando);
      eventos.push({
        cuandoMs: ms,
        cuandoDisplay: display,
        texto: evento,
        chip: a.ticker,
        isPast: ms !== null && ms < hace30,
        analisisISO: a.generadoEnISO,
      });
    }
  }

  // Eventos macro
  if (agenda) {
    for (const e of agenda.eventos) {
      const { ms, display } = parseCuando(e.fecha);
      eventos.push({
        cuandoMs: ms,
        cuandoDisplay: display,
        texto: e.evento,
        chip: DRIVER_CHIP[e.driver] ?? 'Macro',
        // F9.190 §1 — la agenda v2 dice a qué tickers toca (reemplaza los eventos por posición).
        subtitulo: e.tickers?.length ? `${e.tickers.join(' · ')} — ${e.porQueImporta}` : e.porQueImporta,
        isPast: ms !== null && ms < hace30,
      });
    }
  }

  // Sort: pasados (atenuados) al final, luego por fecha asc, sin fecha al final del bloque futuro
  eventos.sort((a, b) => {
    if (a.isPast !== b.isPast) return a.isPast ? 1 : -1;
    if (a.cuandoMs === null && b.cuandoMs === null) return 0;
    if (a.cuandoMs === null) return 1;
    if (b.cuandoMs === null) return -1;
    return a.cuandoMs - b.cuandoMs;
  });

  return eventos;
}

// ── Card Calendario de eventos ──────────────────────────────────────────────────
function CalendarioCard({ analisisCache, agenda, configIA, generandoAgenda, onGenerarAgenda, onAbrirChatAgenda }: {
  analisisCache: Record<string, AnalisisPosicion>;
  agenda: AgendaMacro | null;
  configIA: ConfigIA;
  generandoAgenda: boolean;
  onGenerarAgenda: () => void;
  onAbrirChatAgenda?: () => void;
}) {
  const fmtFechaISO = (iso: string) => {
    const d = iso.slice(0, 10).split('-');
    return `${d[2]}/${d[1]}/${d[0]}`;
  };
  const fmtDiasAntig = (iso: string) => {
    const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return `análisis hace ${dias}d`;
  };

  const eventos = buildEventosCal(analisisCache, agenda);
  const tieneEventos = eventos.length > 0;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: tieneEventos ? 10 : 6, gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Calendario de eventos</div>
          {agenda && (
            <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 }}>
              agenda del {fmtFechaISO(agenda.generadoEnISO)} · {agenda.horizonteDias}d
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {onAbrirChatAgenda && (
            <button onClick={onAbrirChatAgenda}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: 'var(--color-text-sec)', fontFamily: 'var(--font-base)' }}>
              <Icon name="message-circle" size={12} color="var(--color-text-sec)" />
              Chat
            </button>
          )}
          <button
            onClick={onGenerarAgenda}
            disabled={generandoAgenda || !configIA.habilitado}
            title={!configIA.habilitado ? 'Habilitar IA primero' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '7px 10px',
              borderRadius: 9, border: 'none',
              background: (!configIA.habilitado || generandoAgenda) ? 'var(--gf-gray-200)' : 'var(--color-accent)',
              color: (!configIA.habilitado || generandoAgenda) ? 'var(--gf-gray-400)' : '#fff',
              fontSize: 12, fontWeight: 700, cursor: (!configIA.habilitado || generandoAgenda) ? 'default' : 'pointer',
              fontFamily: 'var(--font-base)',
            }}
          >
            <Icon name="sparkles" size={13} color={(!configIA.habilitado || generandoAgenda) ? 'var(--gf-gray-400)' : '#fff'} />
            {generandoAgenda ? 'Generando…' : agenda ? 'Actualizar agenda' : 'Actualizar agenda macro'}
          </button>
        </div>
      </div>

      {!tieneEventos && (
        <div style={{ fontSize: 12, color: 'var(--gf-gray-400)' }}>
          Generá análisis de posiciones para poblar el calendario.
        </div>
      )}

      {tieneEventos && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {eventos.map((ev, i) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '7px 0',
                borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : undefined,
                opacity: ev.isPast ? 0.45 : 1,
              }}
            >
              <div style={{ minWidth: 54, fontSize: 10.5, color: 'var(--gf-gray-400)', paddingTop: 1, textAlign: 'right', flexShrink: 0 }}>
                {ev.cuandoDisplay}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, lineHeight: 1.4 }}>{ev.texto}</span>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 99,
                    background: 'var(--gf-gray-100)', color: 'var(--color-text-sec)',
                    fontWeight: 700, flexShrink: 0,
                  }}>{ev.chip}</span>
                </div>
                {ev.subtitulo && (
                  <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2, lineHeight: 1.4 }}>{ev.subtitulo}</div>
                )}
                {ev.analisisISO && (
                  <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 1 }}>{fmtDiasAntig(ev.analisisISO)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Solapa Research ───────────────────────────────────────────────────────────
// ── F9.190 §1 — Análisis global ("Actualizar todo" v2) ───────────────────────
// Lo REPORTADO por el modelo interpretando los números de la app: va marcado como tal, igual que los
// fundamentals de F9.147. Los números de la app siguen estando en las cards de Resumen.
function GlobalCard({ global }: { global: AnalisisGlobal | null }) {
  if (!global) {
    return (
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Análisis global</div>
        <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)', marginTop: 4, lineHeight: 1.45 }}>
          Todavía no hay. Sale de "Actualización integral › Chat".
        </div>
      </Card>
    );
  }
  const r = global.resultado;
  const sub = { fontSize: 11.5, fontWeight: 700, marginTop: 10 } as const;
  const txt = { fontSize: 12, color: 'var(--color-text-sec)', lineHeight: 1.5 } as const;
  const dias = Math.floor((Date.now() - new Date(global.generadoEnISO).getTime()) / 86400000);
  const mercado = r.mercado ? Object.entries(r.mercado).filter(([, v]) => v && v.valor !== null) : [];
  // F9.191 — estilos compartidos por coherencia, rebalanceo y oportunidades.
  const caja = { marginTop: 6, padding: '8px 10px', borderRadius: 10, background: 'var(--gf-gray-100)' } as const;
  const nota = { fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 } as const;
  const op = global.oportunidades;
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Análisis global</span>
        <MarcaOrigen tipo="reportado" />
        <span style={{ fontSize: 10.5, color: 'var(--gf-gray-400)' }}>hace {dias} d</span>
      </div>
      <div style={{ ...txt, marginTop: 6 }}>{renderInline(r.diagnostico)}</div>
      {r.coherencia && (
        <>
          <div style={sub}>
            Política vs. cartera{r.coherencia.veredicto ? ` · ${r.coherencia.veredicto}` : ''}
          </div>
          {r.coherencia.lectura && <div style={txt}>{renderInline(r.coherencia.lectura)}</div>}
          {r.coherencia.caminos?.map((c, i) => (
            <div key={i} style={caja}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{c.caso}</div>
              {c.opciones?.map((o, j) => <div key={j} style={txt}>· {o}</div>)}
              {c.costo && <div style={nota}>{c.costo}</div>}
            </div>
          ))}
          {r.coherencia.supuestos?.length ? (
            <div style={{ ...nota, marginTop: 6 }}>Supuestos del modelo (no hay perfil cargado): {r.coherencia.supuestos.join(' · ')}</div>
          ) : null}
        </>
      )}
      {r.riesgosPrincipales?.length ? (
        <>
          <div style={sub}>Riesgos principales</div>
          {r.riesgosPrincipales.map((x, i) => (
            <div key={i} style={{ ...txt, display: 'flex', gap: 8 }}>
              <span style={{ flex: 1 }}>· {x.riesgo}</span>
              {x.exposicionPct && <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{x.exposicionPct}</span>}
            </div>
          ))}
        </>
      ) : null}
      {r.rebalanceo && (
        <>
          <div style={sub}>Rebalanceo</div>
          {r.rebalanceo.lectura && <div style={txt}>{r.rebalanceo.lectura}</div>}
          {r.rebalanceo.casos?.map((c, i) => (
            <div key={i} style={{ marginTop: 6, padding: '8px 10px', borderRadius: 10, background: 'var(--gf-gray-100)' }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{c.caso}</div>
              {c.opciones?.map((o, j) => <div key={j} style={txt}>· {o}</div>)}
              {c.costo && <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 }}>{c.costo}</div>}
            </div>
          ))}
        </>
      )}
      {op && (op.faltantes?.length || op.tacticas?.length) ? (
        <>
          <div style={sub}>Faltantes y oportunidades</div>
          {op.faltantes?.map((f, i) => (
            <div key={i} style={caja}>
              <div style={{ display: 'flex', gap: 8, fontSize: 12, fontWeight: 600 }}>
                <span style={{ flex: 1 }}>{f.exposicion}</span>
                {f.pesoActual !== undefined && f.pesoActual !== null && (
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    hoy {typeof f.pesoActual === 'number' ? `${(f.pesoActual * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%` : f.pesoActual}
                  </span>
                )}
              </div>
              {f.queResuelve && <div style={txt}>{f.queResuelve}</div>}
              {f.candidatos?.length ? <div style={txt}>Candidatos: {f.candidatos.join(' · ')}</div> : null}
              {f.datoClave && <div style={nota}>{f.datoClave}</div>}
              {f.tradeoff && <div style={nota}>Trade-off: {f.tradeoff}</div>}
            </div>
          ))}
          {op.fondeo?.length ? (
            <div style={{ ...txt, marginTop: 6 }}>
              Fondeo posible: {op.fondeo.map(x => x.usd ? `${x.fuente} (USD ${Math.round(x.usd).toLocaleString('es-AR')})` : x.fuente).join(' · ')}
            </div>
          ) : null}
          {op.tacticas?.map((c, i) => (
            <div key={i} style={caja}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{c.caso}</div>
              {c.opciones?.map((o, j) => <div key={j} style={txt}>· {o}</div>)}
              {c.costo && <div style={nota}>{c.costo}</div>}
            </div>
          ))}
        </>
      ) : null}
      {r.reserva && (<><div style={sub}>Reserva</div><div style={txt}>{r.reserva}</div></>)}
      {mercado.length > 0 && (
        <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 8, lineHeight: 1.4 }}>
          Mercado según el modelo: {mercado.map(([k, v]) => `${k} ${v!.valor}${v!.fecha ? ` (${v!.fecha})` : ''}`).join(' · ')}
        </div>
      )}
      {global.notas.length > 0 && (
        <>
          <div style={sub}>Notas de posiciones menores</div>
          {global.notas.map((n, i) => <div key={i} style={txt}><strong>{n.ticker}</strong> — {n.nota}</div>)}
        </>
      )}
    </Card>
  );
}

function ResearchTab({ M, configIA, sectorial, generandoSectorial, analizandoLote, loteProgreso, onGenerarSectorial, onAnalizarLote, onChatLote, analisisCache, agenda, generandoAgenda, onGenerarAgenda, onAbrirChat, onActualizarTodoChat, onActualizarTodoApi, actualizandoTodo, resultadoActualizarTodo, global }: {
  global: AnalisisGlobal | null;
  M: PatMetrics;
  configIA: ConfigIA;
  sectorial: AnalisisSectorial | null;
  generandoSectorial: boolean;
  analizandoLote: boolean;
  loteProgreso: { actual: number; total: number; errores: string[] } | null;
  onGenerarSectorial: () => void;
  onAnalizarLote: () => void;
  onChatLote: () => void;
  analisisCache: Record<string, AnalisisPosicion>;
  agenda: AgendaMacro | null;
  generandoAgenda: boolean;
  onGenerarAgenda: () => void;
  onAbrirChat: (modo: ModoIA, ticker: string | undefined, contexto: Record<string, unknown>) => void;
  onActualizarTodoChat: (parte: 'estrategia' | 'posiciones') => void;
  onActualizarTodoApi: () => void;
  actualizandoTodo: { idx: number; total: number; label: string } | null;
  resultadoActualizarTodo: string[] | null;
}) {
  const [expandedSecIdx, setExpandedSecIdx] = useState<Set<number>>(new Set([0]));
  const seccionesSectorial = sectorial ? splitSectorialPorDriver(sectorial.resultado) : [];

  const fmtFechaISO = (iso: string) => {
    const d = iso.slice(0, 10);
    const [y,m,dd] = d.split('-');
    return `${dd}/${m}/${y}`;
  };
  const pctStr = (x: number) => Math.round(x * 100) + '%';
  const ctxSectorial = { bySector: M.bySector, byTipo: M.byTipo, paisAr: pctStr(M.paisAr), total: M.total };
  const ctxAgenda = (() => {
    const exp: Record<string, string> = {};
    for (const [s, v] of Object.entries(M.bySector)) exp[s] = pctStr(v / (M.total || 1));
    return { exposicion: exp, total: Math.round(M.total), paisAr: pctStr(M.paisAr), cripto: pctStr(M.cripto) };
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* F9.101 — Actualización integral */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Actualización integral</span>
          <div style={{ display: 'flex', gap: 7 }}>
            {/* F9.194 — el informe por chat va en dos partes, en este orden. */}
            {(['estrategia', 'posiciones'] as const).map((parte, i) => (
              <button
                key={parte}
                onClick={() => onActualizarTodoChat(parte)}
                disabled={!!actualizandoTodo}
                style={{ padding: '7px 10px', borderRadius: 9, border: '1px solid var(--gf-gray-200)', background: 'transparent', color: 'var(--color-text-sec)', fontSize: 12, fontWeight: 700, cursor: actualizandoTodo ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}
              >
                Chat {i + 1} · {parte === 'estrategia' ? 'Estrategia' : 'Posiciones'}
              </button>
            ))}
            <button
              onClick={onActualizarTodoApi}
              disabled={!configIA.habilitado || !!actualizandoTodo}
              style={{ padding: '7px 12px', borderRadius: 9, border: 'none', background: (!configIA.habilitado || actualizandoTodo) ? 'var(--gf-gray-200)' : 'var(--color-accent)', color: (!configIA.habilitado || actualizandoTodo) ? 'var(--gf-gray-400)' : '#fff', fontSize: 12, fontWeight: 700, cursor: (!configIA.habilitado || actualizandoTodo) ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}
            >
              {actualizandoTodo ? 'Actualizando…' : 'Actualizar todo · API'}
            </button>
          </div>
        </div>
        {actualizandoTodo && (
          <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)' }}>
            Etapa {actualizandoTodo.idx}/{actualizandoTodo.total}: {actualizandoTodo.label}…
          </div>
        )}
        {!actualizandoTodo && resultadoActualizarTodo && (
          <div style={{ fontSize: 11, color: 'var(--color-text-sec)', lineHeight: 1.5, marginTop: 2 }}>
            {resultadoActualizarTodo.map((r, i) => <div key={i}>{r}</div>)}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 6, lineHeight: 1.4 }}>
          Chat en dos partes, en orden. 1 · Estrategia: análisis global con el motor de riesgo, coherencia con tu
          política, faltantes y oportunidades (de una lista blanca), sectorial y agenda. 2 · Posiciones: una ficha por
          posición de 2% o más y manuales, usando lo que dejó la parte 1. Sincroniza CAFCI al importar.
          API: lote + sectorial + agenda + manuales + CAFCI, sin análisis global.
          {' '}Chat: costo cero · API: consume, con progreso por etapa
          {!configIA.habilitado && <span style={{ marginLeft: 5 }}>· activar IA en Configuración para usar API</span>}
        </div>
      </Card>

      {/* Calendario de eventos */}
      <GlobalCard global={global} />

      <CalendarioCard
        analisisCache={analisisCache}
        agenda={agenda}
        configIA={configIA}
        generandoAgenda={generandoAgenda}
        onGenerarAgenda={onGenerarAgenda}
        onAbrirChatAgenda={() => onAbrirChat('agenda', undefined, ctxAgenda)}
      />

      {/* Analizar lote */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Analizar toda la cartera</span>
          <div style={{ display: 'flex', gap: 7 }}>
            <button
              onClick={onChatLote}
              style={{ padding: '7px 12px', borderRadius: 9, border: '1px solid var(--gf-gray-200)', background: 'transparent', color: 'var(--color-text-sec)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}
            >
              Chat
            </button>
            <button
              onClick={onAnalizarLote}
              disabled={!configIA.habilitado || analizandoLote}
              style={{ padding: '7px 12px', borderRadius: 9, border: 'none', background: (!configIA.habilitado || analizandoLote) ? 'var(--gf-gray-200)' : 'var(--color-accent)', color: (!configIA.habilitado || analizandoLote) ? 'var(--gf-gray-400)' : '#fff', fontSize: 12, fontWeight: 700, cursor: (!configIA.habilitado || analizandoLote) ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}
            >
              {analizandoLote ? 'Analizando…' : 'Analizar lote'}
            </button>
          </div>
        </div>
        {loteProgreso && (
          <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)' }}>
            {loteProgreso.actual} / {loteProgreso.total} tickers
            {loteProgreso.errores.length > 0 && (
              <span style={{ color: 'var(--gf-expense)', marginLeft: 8 }}>· {loteProgreso.errores.length} errores</span>
            )}
          </div>
        )}
        {loteProgreso && loteProgreso.errores.length > 0 && (
          <div style={{ fontSize: 10.5, color: 'var(--gf-expense)', marginTop: 4 }}>
            {loteProgreso.errores.join(' · ')}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 6, lineHeight: 1.4 }}>
          Chat: costo cero · Analizar lote: consume API
          {!configIA.habilitado && <span style={{ marginLeft: 5 }}>· activar IA en Configuración para usar lote</span>}
        </div>
      </Card>

      {/* Panorama sectorial */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: sectorial ? 10 : 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Panorama sectorial</div>
              {sectorial?.origen === 'chat' && (
                <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--gf-gray-500)', background: 'var(--gf-gray-100)', borderRadius: 4, padding: '1px 5px' }}>vía chat</span>
              )}
            </div>
            {sectorial && (
              <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 }}>
                {fmtFechaISO(sectorial.generadoEnISO)} · {sectorial.modeloUsado}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => onAbrirChat('sectorial', undefined, ctxSectorial)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: 'var(--color-text-sec)', fontFamily: 'var(--font-base)' }}>
              <Icon name="message-circle" size={12} color="var(--color-text-sec)" />
              Chat
            </button>
            <button
              onClick={onGenerarSectorial}
              disabled={generandoSectorial || !configIA.habilitado}
              title={!configIA.habilitado ? 'Habilitar IA primero' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 9, border: 'none', background: (!configIA.habilitado || generandoSectorial) ? 'var(--gf-gray-200)' : 'var(--color-accent)', color: (!configIA.habilitado || generandoSectorial) ? 'var(--gf-gray-400)' : '#fff', fontSize: 12, fontWeight: 700, cursor: (!configIA.habilitado || generandoSectorial) ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}
            >
              <Icon name="sparkles" size={13} color={(!configIA.habilitado || generandoSectorial) ? 'var(--gf-gray-400)' : '#fff'} />
              {generandoSectorial ? 'Generando…' : sectorial ? 'Regenerar' : 'Generar panorama'}
            </button>
          </div>
        </div>
        {sectorial ? (
          <div>
            {seccionesSectorial.length > 0
              ? seccionesSectorial.map((sec, i) => (
                  <div key={sec.driver} style={{ borderBottom: i < seccionesSectorial.length - 1 ? '1px solid var(--gf-gray-100)' : undefined, paddingBottom: i < seccionesSectorial.length - 1 ? 8 : 0, marginBottom: i < seccionesSectorial.length - 1 ? 8 : 0 }}>
                    <button
                      onClick={() => setExpandedSecIdx(prev => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i); else next.add(i);
                        return next;
                      })}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontSize: 12, fontWeight: 700, color: 'var(--color-text)', width: '100%', textAlign: 'left', fontFamily: 'var(--font-base)' }}
                    >
                      <span style={{ fontSize: 10, color: 'var(--gf-gray-400)', flexShrink: 0 }}>{expandedSecIdx.has(i) ? '▲' : '▼'}</span>
                      {sec.titulo}
                    </button>
                    {expandedSecIdx.has(i) && (
                      <div style={{ marginTop: 4 }}>
                        {renderMarkdownLite(sec.cuerpo)}
                      </div>
                    )}
                  </div>
                ))
              : (
                <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--color-text-sec)', whiteSpace: 'pre-wrap' }}>
                  {sectorial.resultado}
                </div>
              )
            }
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--gf-gray-400)' }}>
            Sin panorama sectorial generado. Activar IA o usar "Chat".
          </div>
        )}
      </Card>

      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', textAlign: 'center', lineHeight: 1.5 }}>
        Solo el dueño puede generar análisis IA · el modelo describe, contextualiza y muestra riesgos
        · nunca recomienda comprar, vender ni mantener
      </div>
    </div>
  );
}

// ── Modal: registrar/editar flujo (aporte o retiro) ──────────────────────────
function ModalFlujo({
  flujo, onGuardar, onEliminar, onClose,
}: {
  flujo: FlujoPatrimonio | null;
  onGuardar: (data: NuevoFlujo) => void;
  onEliminar?: () => void;
  onClose: () => void;
}) {
  const [fecha, setFecha] = useState(
    flujo ? flujo.fecha.toDate().toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [tipo, setTipo] = useState<'aporte' | 'retiro'>(flujo?.tipo ?? 'aporte');
  // F9.107 — el monto USD se tipea a mano: número desde el vamos, sin parseFloat casero.
  const [monto, setMonto] = useState<number | null>(flujo ? flujo.montoUsd : null);
  const [cuenta, setCuenta] = useState(flujo?.cuenta ?? '');
  const [nota, setNota] = useState(flujo?.nota ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const valid = fecha.length === 10 && monto !== null && monto > 0;

  function guardar() {
    if (!valid || monto === null) return;
    const ts = Timestamp.fromDate(new Date(fecha + 'T12:00:00'));
    onGuardar({ fecha: ts, tipo, montoUsd: monto, cuenta: cuenta.trim() || null, nota: nota.trim() });
  }

  const estiloCampo: React.CSSProperties = {
    width: '100%', padding: '11px 13px', borderRadius: 11, border: '1px solid var(--gf-gray-200)',
    fontSize: 14, fontFamily: 'var(--font-base)', background: 'var(--gf-gray-50)', boxSizing: 'border-box',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', background: 'var(--color-surface)', borderRadius: '20px 20px 0 0', padding: '22px 18px 36px', maxHeight: '90dvh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>{flujo ? 'Editar flujo' : 'Registrar flujo'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={20} color="var(--color-text)" />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {(['aporte', 'retiro'] as const).map(t => (
            <button key={t} onClick={() => setTipo(t)} style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: tipo === t ? '2px solid var(--color-accent)' : '1px solid var(--gf-gray-200)', background: tipo === t ? 'rgba(6,95,70,.06)' : 'var(--gf-gray-50)', fontSize: 13, fontWeight: 700, color: tipo === t ? 'var(--color-accent)' : 'var(--color-text-sec)', cursor: 'pointer', fontFamily: 'var(--font-base)', textTransform: 'capitalize' }}>
              {t}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 13 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', marginBottom: 5 }}>Fecha</div>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={estiloCampo} />
        </div>

        {/* El monto sale del map genérico: es el único campo numérico y necesita MoneyInput. */}
        <div style={{ marginBottom: 13 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', marginBottom: 5 }}>Monto (USD)</div>
          <MoneyInput value={monto} onChange={setMonto} moneda="USD" placeholder="1.000,00" style={estiloCampo} />
        </div>

        {[
          { label: 'Cuenta (opcional)', val: cuenta, set: setCuenta, placeholder: 'IOL, Balanz…' },
          { label: 'Nota (opcional)', val: nota, set: setNota, placeholder: 'descripción libre' },
        ].map(f => (
          <div key={f.label} style={{ marginBottom: 13 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', marginBottom: 5 }}>{f.label}</div>
            <input type="text" value={f.val} placeholder={f.placeholder} onChange={e => f.set(e.target.value)}
              style={estiloCampo} />
          </div>
        ))}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '12px 14px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={!valid} style={{ flex: 2, padding: '12px 14px', borderRadius: 11, border: 'none', background: valid ? 'var(--color-accent)' : 'var(--gf-gray-200)', color: valid ? '#fff' : 'var(--gf-gray-400)', fontSize: 14, fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'var(--font-base)' }}>
            {flujo ? 'Guardar cambios' : 'Registrar'}
          </button>
        </div>

        {flujo && onEliminar && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--gf-gray-100)', paddingTop: 14 }}>
            {!confirmDelete
              ? <button onClick={() => setConfirmDelete(true)} style={{ width: '100%', padding: '11px', borderRadius: 11, border: '1px solid #fca5a5', background: 'none', fontSize: 13, fontWeight: 700, color: 'var(--gf-expense)', cursor: 'pointer', fontFamily: 'var(--font-base)' }}>Eliminar flujo</button>
              : <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setConfirmDelete(false)} style={{ flex: 1, padding: '11px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', background: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>No</button>
                  <button onClick={onEliminar} style={{ flex: 2, padding: '11px', borderRadius: 11, border: 'none', background: 'var(--gf-expense)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>Confirmar eliminación</button>
                </div>
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ── Card: aportes y retiros ───────────────────────────────────────────────────
function AportesRetirosCard({ flujos, onAdd, onEdit }: {
  flujos: FlujoPatrimonio[];
  onAdd: () => void;
  onEdit: (f: FlujoPatrimonio) => void;
}) {
  const $ = useDinero();
  const fmtFechaTs = (ts: Timestamp) => { const d = ts.toDate(); const y = d.getFullYear(), m = d.getMonth()+1, dd = d.getDate(); return `${String(dd).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`; };
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: flujos.length > 0 ? 10 : 0 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Aportes y retiros</div>
          {flujos.length === 0 && <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 }}>Sin flujos registrados — el retorno de la evolución no descuenta aportes</div>}
        </div>
        <button onClick={onAdd} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 11px', borderRadius: 9, border: '1px solid var(--gf-gray-200)', background: 'none', fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
          <Icon name="plus" size={13} color="var(--color-text-sec)" /> Agregar
        </button>
      </div>
      {flujos.map((f, i) => (
        <button key={f.id} onClick={() => onEdit(f)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 0', borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-base)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: f.tipo === 'aporte' ? 'var(--gf-income)' : 'var(--gf-expense)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'var(--gf-gray-400)', minWidth: 52 }}>{fmtFechaTs(f.fecha)}</span>
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1, textTransform: 'capitalize' }}>{f.tipo}{f.cuenta ? ` · ${f.cuenta}` : ''}</span>
          {/* F9.121 — el único importe que no pasaba por ningún helper. Se conserva el signo y
              el color por tipo; sólo cambia el número. */}
          <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: f.tipo === 'aporte' ? 'var(--gf-income)' : 'var(--gf-expense)' }}>{f.tipo === 'aporte' ? '+' : '−'}{$.usd(f.montoUsd)}</span>
          <Icon name="chevron-right" size={14} color="var(--gf-gray-300)" />
        </button>
      ))}
    </Card>
  );
}

// F9.102.2 4b — modal "Pegar JSON": URL de la ficha (copiable/clickeable) + textarea + botón
// Importar. Errores del backend (JSON inválido, success:false, fondo que no coincide, etc.)
// se muestran inline — más accionable que un toast lejos del textarea.
function PegarJsonModal({ fondo, onImportar, onClose }: {
  fondo: CafciFondoConfig;
  onImportar: (fondoId: string, claseId: string, json: string) => Promise<ResultadoImportarCafciManual>;
  onClose: () => void;
}) {
  const [json, setJson] = useState('');
  const [importando, setImportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `https://estadisticas.cafci.org.ar/fondos/${fondo.fondoId}?clase=${fondo.claseId}`;
  const snippet = "copy(document.querySelector('[data-pie-chart-items-value]').dataset.pieChartItemsValue)";

  async function importar() {
    if (!json.trim() || importando) return;
    setImportando(true);
    setError(null);
    try {
      await onImportar(fondo.fondoId, fondo.claseId, json.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportando(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--color-surface)', borderRadius: '18px 18px 0 0', padding: 16, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', boxSizing: 'border-box' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>Pegar JSON — {fondo.nombre}</div>
        <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', marginBottom: 10, lineHeight: 1.5 }}>
          1. Abrí la URL en el navegador. 2. Abrí la consola (F12) y pegá el snippet de abajo —
          copia la cartera al portapapeles. 3. Pegala en el cuadro de acá abajo.
        </div>
        <a href={url} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: 11.5, color: 'var(--color-accent)', wordBreak: 'break-all', marginBottom: 10, textDecoration: 'underline' }}>
          {url}
        </a>
        <code style={{ display: 'block', fontSize: 10.5, background: 'var(--gf-gray-50)', border: '1px solid var(--gf-gray-100)', borderRadius: 8, padding: '7px 9px', marginBottom: 10, wordBreak: 'break-all', lineHeight: 1.4 }}>
          {snippet}
        </code>
        <textarea
          value={json}
          onChange={e => setJson(e.target.value)}
          placeholder="Pegá acá lo que copió el snippet (o el JSON completo de la ficha vieja)…"
          rows={8}
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--gf-gray-200)', fontSize: 11.5, fontFamily: 'monospace', resize: 'vertical' }}
        />
        {error && (
          <div style={{ fontSize: 11.5, color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '6px 9px', marginTop: 8, lineHeight: 1.4 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={importar} disabled={!json.trim() || importando}
            style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', cursor: !json.trim() || importando ? 'not-allowed' : 'pointer', background: !json.trim() || importando ? 'var(--gf-gray-100)' : 'var(--color-accent)', color: !json.trim() || importando ? 'var(--gf-gray-400)' : '#fff', fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-base)' }}>
            {importando ? 'Importando…' : 'Importar'}
          </button>
          <button onClick={onClose}
            style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', cursor: 'pointer', background: 'var(--gf-gray-100)', color: 'var(--color-text-sec)', fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--font-base)' }}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Card de fondos CAFCI ──────────────────────────────────────────────────────
function CafciFondosCard({ configCafci, carteras, sincronizando, onSincronizar, onGuardar, onImportarFondos, onImportarMapping, onImportarFactores, onImportarManual }: {
  configCafci: ConfigCafci;
  carteras: CafciCartera[];
  sincronizando: boolean;
  onSincronizar: () => void;
  onGuardar: (c: ConfigCafci) => void;
  onImportarFondos: () => void;
  onImportarMapping: () => void;
  onImportarFactores: () => void;
  onImportarManual: (fondoId: string, claseId: string, json: string) => Promise<ResultadoImportarCafciManual>;
}) {
  const [pegarJsonFondo, setPegarJsonFondo] = useState<CafciFondoConfig | null>(null);
  const [nombre, setNombre] = useState('');
  const [fondoId, setFondoId] = useState('');
  const [claseId, setClaseId] = useState('');
  const [agregando, setAgregando] = useState(false);

  function addFondo() {
    if (!nombre.trim() || !fondoId.trim() || !claseId.trim()) return;
    const nuevo: CafciFondoConfig = { fondoId: fondoId.trim(), claseId: claseId.trim(), nombre: nombre.trim() };
    onGuardar({ fondos: [...configCafci.fondos, nuevo] });
    setNombre(''); setFondoId(''); setClaseId(''); setAgregando(false);
  }

  const inp: React.CSSProperties = {
    padding: '8px 10px', borderRadius: 8, border: '1px solid var(--gf-gray-200)',
    fontSize: 12.5, fontFamily: 'var(--font-base)', width: '100%', boxSizing: 'border-box',
  };

  const btnSec: React.CSSProperties = {
    padding: '7px 11px', borderRadius: 9, border: '1px solid var(--gf-gray-200)',
    cursor: 'pointer', background: 'transparent', color: 'var(--color-text-sec)',
    fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-base)',
  };

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Fondos CAFCI (benchmark)</div>
          <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 }}>
            {configCafci.fondos.length} fondo{configCafci.fondos.length !== 1 ? 's' : ''} configurado{configCafci.fondos.length !== 1 ? 's' : ''}
          </div>
        </div>
        <button
          onClick={onSincronizar}
          disabled={sincronizando || configCafci.fondos.length === 0}
          style={{
            padding: '7px 13px', borderRadius: 9, border: 'none',
            cursor: sincronizando || configCafci.fondos.length === 0 ? 'not-allowed' : 'pointer',
            background: sincronizando || configCafci.fondos.length === 0 ? 'var(--gf-gray-100)' : 'var(--color-accent)',
            color: sincronizando || configCafci.fondos.length === 0 ? 'var(--gf-gray-400)' : '#fff',
            fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-base)',
          }}
        >
          {sincronizando ? 'Sincronizando…' : 'Sincronizar'}
        </button>
      </div>
      {configCafci.fondos.length === 0 && !agregando && (
        <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', marginBottom: 10, lineHeight: 1.5 }}>
          Agregá fondos para comparar tu cartera con carteras de fondos CAFCI.
          Necesitás el <strong>fondoId</strong> y <strong>claseId</strong> de la URL de cafci.org.ar.
        </div>
      )}
      {configCafci.fondos.map((f, i) => {
        const fechaDatos = fechaDatosDeFondo(carteras, f.fondoId);
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: i < configCafci.fondos.length - 1 ? '1px solid var(--gf-gray-100)' : 'none', gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{f.nombre}</div>
              <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 1 }}>fondo {f.fondoId} · clase {f.claseId}</div>
              <div style={{ fontSize: 10.5, marginTop: 2, display: 'flex', alignItems: 'center', gap: 3, color: fechaDatos ? 'var(--gf-emerald)' : 'var(--gf-gray-400)' }}>
                <Icon name={fechaDatos ? 'check' : 'circle-x'} size={10} color={fechaDatos ? 'var(--gf-emerald)' : 'var(--gf-gray-300)'} />
                {fechaDatos ? `datos al ${fechaDatos}` : 'sin datos'}
              </div>
            </div>
            <button onClick={() => setPegarJsonFondo(f)} style={btnSec}>
              Pegar JSON
            </button>
            <button onClick={() => onGuardar({ fondos: configCafci.fondos.filter((_, j) => j !== i) })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
              <Icon name="x" size={14} color="var(--gf-gray-400)" />
            </button>
          </div>
        );
      })}
      {pegarJsonFondo && (
        <PegarJsonModal fondo={pegarJsonFondo} onImportar={onImportarManual} onClose={() => setPegarJsonFondo(null)} />
      )}
      {agregando ? (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <input placeholder="Nombre del fondo" value={nombre} onChange={e => setNombre(e.target.value)} style={inp} />
          <div style={{ display: 'flex', gap: 7 }}>
            <input placeholder="fondoId" value={fondoId} onChange={e => setFondoId(e.target.value)} style={{ ...inp, width: undefined, flex: 1, minWidth: 0 }} />
            <input placeholder="claseId" value={claseId} onChange={e => setClaseId(e.target.value)} style={{ ...inp, width: undefined, flex: 1, minWidth: 0 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={addFondo} disabled={!nombre.trim() || !fondoId.trim() || !claseId.trim()}
              style={{ flex: 1, padding: '8px 0', borderRadius: 9, border: 'none', cursor: 'pointer', background: 'var(--color-accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-base)' }}>
              Agregar
            </button>
            <button onClick={() => setAgregando(false)}
              style={{ flex: 1, padding: '8px 0', borderRadius: 9, border: 'none', cursor: 'pointer', background: 'var(--gf-gray-100)', color: 'var(--color-text-sec)', fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--font-base)' }}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAgregando(true)} style={{ marginTop: configCafci.fondos.length > 0 ? 10 : 0, width: '100%', padding: '8px 0', borderRadius: 9, border: '1.5px dashed var(--gf-gray-200)', background: 'transparent', color: 'var(--gf-gray-400)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
          + Agregar fondo
        </button>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={onImportarFondos} style={btnSec}>
          Importar fondos sugeridos (13)
        </button>
        <button onClick={onImportarMapping} style={btnSec}>
          Importar mapping (70)
        </button>
      </div>
      {/* F9.127 §2 — semilla del override de factores. Idempotente y nunca pisa un origen manual. */}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={onImportarFactores} style={btnSec}>
          Importar factores ({Object.keys(FACTOR_ENERGIA).length})
        </button>
      </div>
    </Card>
  );
}

// ── F9.131 — Declaradas, derivadas, emergentes ────────────────────────────────
// Card en Riesgo, ARRIBA de escenarios, ordenada por accionabilidad y no por tamaño: lo primero que
// hay que mirar es lo que nunca pasó por una decisión, no lo que más pesa.
function DeclaracionesCard({ posiciones, manuales, factores }: {
  posiciones: Posicion[];
  manuales: PosicionManual[];
  factores: Record<string, Factor>;
}) {
  const $ = useDinero();
  const [decls, setDecls] = useState<Declaracion[]>([]);
  // La custodia se lee acá y no llega por props: esta card es el único consumidor fuera de
  // RiesgoCard, y pasarla por dos niveles de componente solo para esto sería peor.
  const [custodias, setCustodias] = useState<Record<string, Custodia>>({});
  const [editando, setEditando] = useState<Exposicion | null>(null);
  const [techoInput, setTechoInput] = useState('');
  const [notaInput, setNotaInput] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [verDerivadas, setVerDerivadas] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recargar = () => cargarDeclaraciones().then(setDecls).catch(e => console.error('[declaraciones]', e));
  useEffect(() => {
    recargar();
    cargarCustodiaCuenta().then(setCustodias).catch(e => console.error('[custodia]', e));
  }, []);

  const todas = posicionesInvertibles(posiciones, manuales);
  const expos = intentar(() => clasificarExposiciones(todas, decls, {
    factores, custodias,
    labelFactor: (f: Factor) => FACTOR_LABEL[f],
    labelBloque: (b: Bloque) => BLOQUE_LABEL[b],
  }), 'clasificarExposiciones') ?? [];

  const emergentes = expos.filter(e => e.estado === 'emergente');
  const excedidas  = expos.filter(e => e.estado === 'excedida');
  const declaradas = expos.filter(e => e.estado === 'declarada');
  const derivadas  = expos.filter(e => e.estado === 'derivada');

  const abrirForm = (e: Exposicion) => {
    setEditando(e);
    // El techo viene precargado con el % ACTUAL: es el punto de partida natural, y el dueño lo edita.
    setTechoInput((e.pct * 100).toFixed(1).replace('.', ','));
    setNotaInput(e.declaracion?.nota ?? '');
    setError(null);
  };

  const guardar = async () => {
    if (!editando) return;
    const techoPct = parseFloat(techoInput.replace(',', '.')) / 100;
    setGuardando(true);
    setError(null);
    try {
      await guardarDeclaracion({
        eje: editando.eje, clave: editando.clave, techoPct, base: 'invertible',
        fecha: new Date().toISOString().slice(0, 10), nota: notaInput.trim(),
      });
      await recargar();
      setEditando(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  };

  const notaCorta = notaInput.trim().length < NOTA_MINIMA;

  const btnSec: React.CSSProperties = {
    padding: '7px 11px', borderRadius: 9, border: '1px solid var(--gf-gray-200)',
    cursor: 'pointer', background: 'transparent', color: 'var(--color-text-sec)',
    fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-base)',
  };

  if (expos.length === 0) return null;

  return (
    <Card>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Exposiciones: declaradas y emergentes</div>
      <div style={{ fontSize: 11, color: 'var(--color-text-sec)', marginTop: 2, lineHeight: 1.45 }}>
        No hay topes duros. La app no dice qué hacer: dice dónde hay exposición que nunca pasó por una
        decisión. Solo se listan las que superan el {pct(UMBRAL_MATERIALIDAD)} del invertible.
      </div>

      {/* 1. Emergentes — las únicas que levantan la mano, junto con las excedidas. */}
      {emergentes.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {emergentes.map(e => (
            <div key={`${e.eje}-${e.clave}`} style={{ padding: '9px 11px', borderRadius: 10, background: 'var(--st-por-confirmar-bg, var(--gf-gray-100))', marginBottom: 6 }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                <strong>{e.etiqueta}</strong> es el {pct(e.pct)} del invertible y nunca lo declaraste.
                ¿Lo declarás o lo bajás?
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', marginTop: 3 }}>
                {e.eje} · {e.tickers.slice(0, 8).join(' ')}
              </div>
              <button onClick={() => abrirForm(e)} style={{ ...btnSec, marginTop: 6, width: 'auto', padding: '5px 12px' }}>
                Declarar
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 2. Excedidas — el dueño contra su propia decisión pasada, no contra un promedio ajeno. */}
      {excedidas.map(e => (
        <div key={`${e.eje}-${e.clave}`} style={{ padding: '9px 11px', borderRadius: 10, background: 'var(--st-vencido-bg, var(--gf-gray-100))', marginTop: 6 }}>
          <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
            <strong>{e.etiqueta}</strong> está en {pct(e.pct)} y declaraste un techo de {pct(e.declaracion!.techoPct)} el {e.declaracion!.fecha}.
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-sec)', marginTop: 3 }}>
            {/* Aritmética, no recomendación: no lleva "deberías vender". */}
            Volver al techo son {$.usd(e.excesoUsd)}.
          </div>
          <button onClick={() => abrirForm(e)} style={{ ...btnSec, marginTop: 6, width: 'auto', padding: '5px 12px' }}>
            Revisar declaración
          </button>
        </div>
      ))}

      {/* 3. Declaradas — sin colores de alarma. Con la nota visible: es lo que permite saber en seis
             meses si la convicción sigue en pie. */}
      {declaradas.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {declaradas.map(e => (
            <div key={`${e.eje}-${e.clave}`} style={{ padding: '5px 0', borderBottom: '1px solid var(--gf-gray-100)', fontSize: 11.5 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ flex: 1, color: 'var(--color-text-sec)' }}>{e.etiqueta}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{pct(e.pct)}</span>
                <span style={{ color: 'var(--gf-gray-400)' }}>de {pct(e.declaracion!.techoPct)}</span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', lineHeight: 1.4 }}>
                {e.declaracion!.fecha} · {e.declaracion!.nota}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 4. Derivadas — consecuencia aritmética de una declarada. Colapsadas por defecto. */}
      {derivadas.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setVerDerivadas(v => !v)} style={{ ...btnSec, width: 'auto', padding: '4px 10px', fontSize: 11 }}>
            {verDerivadas ? 'Ocultar' : `Ver ${derivadas.length} derivada${derivadas.length !== 1 ? 's' : ''}`}
          </button>
          {verDerivadas && derivadas.map(e => (
            <div key={`${e.eje}-${e.clave}`} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 11.5, color: 'var(--color-text-sec)' }}>
              <span style={{ flex: 1 }}>{e.etiqueta}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{pct(e.pct)}</span>
            </div>
          ))}
          <div style={{ fontSize: 10, color: 'var(--gf-gray-400)', marginTop: 4, lineHeight: 1.4 }}>
            Consecuencia de lo que ya declaraste: más del {pct(UMBRAL_DERIVADA)} de su valor viene de
            posiciones con declaración propia. Se informa, no se alerta.
          </div>
        </div>
      )}

      {/* Formulario. Nada se autodeclara: el techo viene precargado pero el motivo lo tipea el dueño. */}
      {editando && (
        <div style={{ marginTop: 10, padding: '10px 11px', borderRadius: 10, border: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Declarar {editando.etiqueta}</div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--color-text-sec)', marginBottom: 2 }}>
            Techo (% del invertible)
          </label>
          <input
            value={techoInput}
            onChange={ev => setTechoInput(ev.target.value)}
            inputMode="decimal"
            style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--color-border)', fontFamily: 'var(--font-base)', fontSize: 13 }}
          />
          <label style={{ display: 'block', fontSize: 11, color: 'var(--color-text-sec)', margin: '8px 0 2px' }}>
            Por qué (mínimo {NOTA_MINIMA} caracteres)
          </label>
          <textarea
            value={notaInput}
            onChange={ev => setNotaInput(ev.target.value)}
            rows={3}
            placeholder="Sin esto, la declaración no se distingue de silenciar la alerta."
            style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 8, border: `1px solid ${notaCorta ? 'var(--gf-out)' : 'var(--color-border)'}`, fontFamily: 'var(--font-base)', fontSize: 12.5, resize: 'vertical' }}
          />
          <div style={{ fontSize: 10.5, color: notaCorta ? 'var(--gf-out)' : 'var(--gf-gray-400)', marginTop: 2 }}>
            {notaInput.trim().length}/{NOTA_MINIMA}
          </div>
          {error && <div style={{ fontSize: 11, color: 'var(--gf-expense)', marginTop: 4, lineHeight: 1.4 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={guardar} disabled={notaCorta || guardando} style={{ ...btnSec, width: 'auto', padding: '6px 14px', opacity: notaCorta || guardando ? 0.5 : 1 }}>
              {guardando ? 'Guardando…' : 'Confirmar declaración'}
            </button>
            <button onClick={() => setEditando(null)} style={{ ...btnSec, width: 'auto', padding: '6px 14px' }}>Cancelar</button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Solapa Benchmark ──────────────────────────────────────────────────────────
function BenchmarkTab({ posiciones, carteras, mappings, universo }: {
  posiciones: Posicion[];
  carteras: CafciCartera[];
  mappings: Record<string, string | null>;
  universo: UniversoCafci | null;
}) {
  const $ = useDinero();
  if (carteras.length === 0) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Sin datos de fondos</div>
          <div style={{ fontSize: 12.5, color: 'var(--gf-gray-400)', lineHeight: 1.5 }}>
            Configurá al menos un fondo CAFCI en la solapa Config y tocá "Sincronizar" para cargar sus carteras.
          </div>
        </div>
      </Card>
    );
  }

  // F9.122.1 §B — se pasan las posiciones completas, no {ticker, valorUsd}: calcBenchmark necesita
  // `tipo` y `pais_riesgo` para filtrar la base con bloqueDe().
  // F9.143 — los pesos salen del universo vigente (patrimonio del FONDO, suma de clases). Sin
  // universo el promedio queda equiponderado, que es el comportamiento previo.
  const { filas, soloenFondos, soloEnPropio, base } = calcBenchmark(posiciones, carteras, mappings, pesosDeUniverso(universo));
  const filasEnAmbos = filas.filter(f => f.propioFrac !== null && f.fondosAvgFrac > 0);
  const fmtFrac = (x: number) => (Math.round(x * 1000) / 10).toFixed(1) + '%';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
          Divergencia vs fondos — renta variable AR · {base.fondosEnBase} fondo{base.fondosEnBase !== 1 ? 's' : ''}
        </div>
        {/* F9.122.1 §B — la base va declarada arriba de la tabla y no en una nota al pie: un % cuyo
            denominador hay que ir a buscar es un % que se lee mal. El monto absoluto se omite con
            el modo privacidad activo, porque ahí $.usd() daría el mismo % que ya se muestra al
            lado — misma regla que F9.121 §3. */}
        <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginBottom: 10, lineHeight: 1.45 }}>
          Base: renta variable argentina. Tu cartera {fmtFrac(base.propioPctDeCartera)} del invertible
          {!$.privado && <> ({fmtUsd(base.propioUsd)})</>}; los fondos, {fmtFrac(base.fondoCoberturaProm)} promedio
          de su cartera. Se excluyen liquidez, renta fija, "Resto de Activos" y CEDEARs sin riesgo
          argentino ({fmtFrac(base.excluidoFondoProm)} promedio del fondo).
          {base.fondosSalteados > 0 && (
            <> <strong>{base.fondosSalteados} fondo{base.fondosSalteados !== 1 ? 's' : ''}</strong> quedó
            {base.fondosSalteados !== 1 ? 'ron' : ''} afuera: su porción comparable no llega al 40% y
            renormalizar sobre una base tan flaca amplifica el ruido en vez de medir.</>
          )}
          {/* F9.143 — sobre qué masa se ponderó. Un promedio ponderado sin declarar el denominador
              es una cifra que induce a error, mismo criterio que `propioPctDeCartera`. */}
          {base.ponderado
            ? <> Ponderado por patrimonio del fondo{!$.privado && <> sobre ARS {(base.patrimonioBaseArs / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 0 })} M</>}
                {universo && <> · universo {universo.fecha}</>}.</>
            : <> <strong>Equiponderado</strong>: no hay universo con patrimonio cargado, cada fondo pesa igual.</>}
        </div>
        {filasEnAmbos.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--gf-gray-400)', lineHeight: 1.5 }}>
            Sin tickers en común con los fondos. Revisá los mappings de especies en Config una vez que la sincronización corra.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 58px 68px 50px', gap: 4, fontSize: 10, color: 'var(--gf-gray-400)', fontWeight: 700, marginBottom: 6 }}>
              <div>Ticker</div>
              <div style={{ textAlign: 'right' }}>Propio</div>
              <div style={{ textAlign: 'right' }}>Fondos avg¹</div>
              <div style={{ textAlign: 'right' }}>Δ</div>
            </div>
            {filasEnAmbos.map(f => {
              const delta = (f.propioFrac ?? 0) - f.fondosAvgFrac;
              // F9.122.1 §B — umbrales recalibrados de 0,05/0,02 a 0,08/0,04: sobre una base ~2×
              // más chica los deltas son ~2× más grandes, y los umbrales viejos pintarían de rojo
              // toda la tabla, que es lo mismo que no tener semáforo.
              const col = Math.abs(delta) > 0.08 ? 'var(--gf-expense)' : Math.abs(delta) > 0.04 ? '#f59e0b' : 'var(--gf-gray-400)';
              return (
                <div key={f.ticker} style={{ display: 'grid', gridTemplateColumns: '1fr 58px 68px 50px', gap: 4, padding: '5px 0', borderBottom: '1px solid var(--gf-gray-100)', fontSize: 12.5, alignItems: 'center' }}>
                  <div style={{ fontWeight: 700 }}>{f.ticker}</div>
                  <div style={{ textAlign: 'right' }}>{(Math.round((f.propioFrac ?? 0) * 1000) / 10).toFixed(1)}%</div>
                  <div style={{ textAlign: 'right', color: 'var(--gf-gray-500)' }}>
                    {(Math.round(f.fondosAvgFrac * 1000) / 10).toFixed(1)}%
                    {f.fondosMinFrac !== f.fondosMaxFrac && (
                      <div style={{ fontSize: 9, color: 'var(--gf-gray-300)' }}>
                        {(Math.round(f.fondosMinFrac * 1000) / 10).toFixed(1)}–{(Math.round(f.fondosMaxFrac * 1000) / 10).toFixed(1)}%
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', color: col, fontWeight: 700 }}>
                    {delta > 0 ? '+' : ''}{(Math.round(delta * 1000) / 10).toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </>
        )}
      </Card>

      <div style={{ fontSize: 10, color: 'var(--gf-gray-400)', marginTop: 8, lineHeight: 1.4 }}>
        ¹ promedio entre los {base.fondosEnBase} fondos que entraron a la base: un fondo que no
        tiene el papel computa 0%. No es el promedio entre los que sí lo tienen.
      </div>

      {soloenFondos.length > 0 && (
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>En fondos, no en tu cartera</div>
          {soloenFondos.map(f => (
            <div key={f.ticker} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--gf-gray-100)', fontSize: 12.5 }}>
              <span style={{ fontWeight: 600 }}>{f.ticker}</span>
              <span style={{ color: 'var(--gf-gray-500)', fontSize: 11.5 }}>{(Math.round(f.avgFrac * 1000) / 10).toFixed(1)}% avg</span>
            </div>
          ))}
        </Card>
      )}

      {soloEnPropio.length > 0 && (
        <Card>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>En tu cartera, no en fondos</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {soloEnPropio.map(t => (
              <span key={t} style={{ padding: '3px 9px', borderRadius: 20, background: 'var(--gf-gray-100)', fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-sec)' }}>{t}</span>
            ))}
          </div>
        </Card>
      )}

      {carteras.some(c => c.advertenciaSuma) && (
        <div style={{ fontSize: 11.5, color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: '8px 12px', lineHeight: 1.5 }}>
          ⚠️ {carteras.filter(c => c.advertenciaSuma).map(c => c.nombre).join(', ')} — la suma de porcentajes está fuera de [98, 102]. Los datos pueden ser parciales.
        </div>
      )}

      {/* F9.104 — cobertura identificada baja: el pie chart de origen truncó la cola en "Resto
          de Activos" y ese resto pesa demasiado para tratar la cartera como conocida. */}
      {carteras.some(c => c.advertenciaCobertura) && (
        <div style={{ fontSize: 11.5, color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: '8px 12px', lineHeight: 1.5 }}>
          ⚠️ {carteras.filter(c => c.advertenciaCobertura).map(c => `${c.nombre} (${(c.coberturaIdentificada ?? 0).toFixed(1)}%)`).join(', ')} — cartera con cobertura identificada baja (cola agrupada en "Resto de Activos"). El benchmark de esos fondos es parcial.
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', textAlign: 'center', padding: '4px 0' }}>
        {carteras.map(c => c.nombre).join(' · ')} · {carteras[0]?.fechaDatos ?? '—'}
      </div>
    </div>
  );
}

// ── Solapa Configuración ──────────────────────────────────────────────────────
// F9.103 — card "Tipo de cambio": estado de cobertura de tcDiario + backfill desde
// ArgentinaDatos. Mismo patrón que CafciFondosCard (fuente externa, botón de sync + reporte).
function TipoCambioCard() {
  const [estado, setEstado] = useState<EstadoTcDiario | null>(null);
  const [cargandoEstado, setCargandoEstado] = useState(true);
  const [validando, setValidando] = useState(false);
  const [completando, setCompletando] = useState(false);
  const [reporte, setReporte] = useState<ResultadoBackfillTc | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function recargarEstado() {
    setCargandoEstado(true);
    try {
      setEstado(await cargarEstadoTcDiario());
    } finally {
      setCargandoEstado(false);
    }
  }

  useEffect(() => { recargarEstado(); }, []);

  async function onValidar() {
    setValidando(true); setError(null);
    try {
      setReporte(await backfillTcDiario({ soloValidar: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setValidando(false);
    }
  }

  async function onCompletar() {
    setCompletando(true); setError(null);
    try {
      setReporte(await backfillTcDiario({}));
      await recargarEstado();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCompletando(false);
    }
  }

  const btnSec: React.CSSProperties = {
    padding: '7px 12px', borderRadius: 9, border: '1px solid var(--gf-gray-200)',
    cursor: 'pointer', background: 'transparent', color: 'var(--color-text-sec)',
    fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-base)',
  };
  const btnPri: React.CSSProperties = {
    padding: '7px 12px', borderRadius: 9, border: 'none',
    cursor: 'pointer', background: 'var(--color-accent)', color: '#fff',
    fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-base)',
  };

  return (
    <Card>
      <div style={{ fontSize: 13, fontWeight: 700 }}>Tipo de cambio</div>
      {cargandoEstado ? (
        <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', marginTop: 6 }}>Cargando…</div>
      ) : estado && estado.fechaMin && estado.fechaMax ? (
        <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', marginTop: 6, lineHeight: 1.6 }}>
          {estado.fechaMin} → {estado.fechaMax} · {estado.cantidadDias} días · {estado.semanasISO} semanas ISO
          {estado.huecos.length > 0 && (
            <span style={{ color: 'var(--gf-expense)', fontWeight: 700 }}>
              {' '}· {estado.huecos.length} hueco{estado.huecos.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', marginTop: 6 }}>Sin datos en tcDiario.</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={onValidar} disabled={validando || completando} style={btnSec}>
          {validando ? 'Validando…' : 'Validar'}
        </button>
        <button onClick={onCompletar} disabled={validando || completando} style={btnPri}>
          {completando ? 'Completando…' : 'Completar histórico'}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 11.5, color: 'var(--gf-expense)', marginTop: 10 }}>{error}</div>
      )}

      {reporte && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 9, background: 'var(--gf-gray-50)', fontSize: 11, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700 }}>
            Solapamiento: {reporte.solapamiento.coinciden}/{reporte.solapamiento.totalComparados} coinciden
          </div>
          {reporte.solapamiento.difieren.length > 0 && (
            <div style={{ color: 'var(--gf-expense)', marginTop: 4 }}>
              {reporte.solapamiento.difieren.length} difieren:
              {reporte.solapamiento.difieren.slice(0, 10).map(d => (
                <div key={d.fecha}>{d.fecha}: propio {d.propio} vs API {d.api} (Δ{d.deltaPct.toFixed(2)}%)</div>
              ))}
            </div>
          )}
          {reporte.solapamiento.soloPropioSinApi.length > 0 && (
            <div style={{ marginTop: 4 }}>Sin dato en API: {reporte.solapamiento.soloPropioSinApi.join(', ')}</div>
          )}
          {reporte.soloValidar ? (
            reporte.planEscritura && (
              <div style={{ marginTop: 6 }}>
                Plan: {reporte.planEscritura.aEscribir} a escribir · {reporte.planEscritura.saltadosPorExistir} ya existen
                {reporte.planEscritura.sinDatoEnApi.length > 0 && (
                  <div>Sin dato en API para el rango: {reporte.planEscritura.sinDatoEnApi.join(', ')}</div>
                )}
              </div>
            )
          ) : (
            <div style={{ marginTop: 6 }}>
              Escritos: {reporte.escritos} · Saltados (ya existían): {reporte.saltadosPorExistir}
              {reporte.sinDatoEnApi && reporte.sinDatoEnApi.length > 0 && (
                <div>Sin dato en API: {reporte.sinDatoEnApi.join(', ')}</div>
              )}
            </div>
          )}
          <button onClick={() => setReporte(null)} style={{ ...btnSec, marginTop: 8 }}>Cerrar</button>
        </div>
      )}
    </Card>
  );
}

// F9.116 §3 — Política de riesgo: los cuatro números que declara el titular. Sin ellos, la
// concentración es un dato sin consecuencia; con ellos la app puede señalar la brecha.
// La UI trabaja en enteros (20 = 20%) y convierte en el borde: adentro todo es fracción.
function PoliticaRiesgoCard({ topes, configurado, onGuardar }: {
  topes: TopesRiesgo;
  configurado: boolean;
  onGuardar: (t: TopesRiesgo) => void;
}) {
  const CAMPOS: { k: keyof TopesRiesgo; label: string; sub: string }[] = [
    { k: 'toleranciaCaidaPct', label: 'Caída que bancás',   sub: 'Máxima pérdida tolerada en un escenario' },
    { k: 'topePosicionPct',    label: 'Tope por posición',  sub: 'Por ticker consolidado entre cuentas' },
    { k: 'topeDriverPct',      label: 'Tope por driver',    sub: 'Por bloque que se mueve junto en una crisis' },
    { k: 'pisoCajaPct',        label: 'Piso de caja',       sub: 'Cash y stablecoins — es un piso, no un tope' },
  ];

  function editar(k: keyof TopesRiesgo, valor: string) {
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0 || n > 100) return;
    onGuardar({ ...topes, [k]: n / 100 });
  }

  return (
    <Card>
      <div style={{ fontSize: 13, fontWeight: 700 }}>Política de riesgo</div>
      <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2, marginBottom: 10 }}>
        {configurado ? 'Configurada' : 'Sin configurar · se usan los valores por defecto'}
      </div>
      {CAMPOS.map((c, i) => (
        <div key={c.k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : 'none' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{c.label}</div>
            <div style={{ fontSize: 10.5, color: 'var(--gf-gray-400)', lineHeight: 1.3 }}>{c.sub}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <input
              type="number" inputMode="numeric" min={0} max={100}
              value={Math.round(topes[c.k] * 100)}
              onChange={e => editar(c.k, e.target.value)}
              style={{ width: 58, textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums', border: '1px solid var(--gf-gray-300)', borderRadius: 8, padding: '5px 7px', fontFamily: 'var(--font-base)' }}
            />
            <span style={{ fontSize: 12, color: 'var(--gf-gray-400)' }}>%</span>
          </div>
        </div>
      ))}
    </Card>
  );
}

function ConfigTab({ activosFijos, manuales, configIA, fechaCorrida, flujos, configCafci, cafciCarteras, sincronizandoCafci, topesRiesgo, riesgoConfigurado, onGuardarRiesgo, onToast, onEditFijo, onAddFijo, onEditManual, onAddManual, onToggleIA, onAddFlujo, onEditFlujo, onSincronizarCafci, onGuardarConfigCafci, onImportarFondosCafci, onImportarMappingCafci, onImportarFactores, onImportarCafciManual, onFlujosAplicados }: {
  /** F9.196.1 §1.c — después de "Aplicar" en "Para decidir": recargar flujos y cartera viva. */
  onFlujosAplicados: () => void;
  activosFijos: ActivoFijo[];
  manuales: PosicionManual[];
  topesRiesgo: TopesRiesgo;
  riesgoConfigurado: boolean;
  onGuardarRiesgo: (t: TopesRiesgo) => void;
  onToast: (texto: string, error: boolean) => void;
  configIA: ConfigIA;
  fechaCorrida: string;
  flujos: FlujoPatrimonio[];
  configCafci: ConfigCafci;
  cafciCarteras: CafciCartera[];
  sincronizandoCafci: boolean;
  onEditFijo: (af: ActivoFijo) => void;
  onAddFijo: () => void;
  onEditManual: (pm: PosicionManual) => void;
  onAddManual: () => void;
  onToggleIA: (val: boolean) => void;
  onAddFlujo: () => void;
  onEditFlujo: (f: FlujoPatrimonio) => void;
  onSincronizarCafci: () => void;
  onGuardarConfigCafci: (c: ConfigCafci) => void;
  onImportarFondosCafci: () => void;
  onImportarMappingCafci: () => void;
  onImportarFactores: () => void;
  onImportarCafciManual: (fondoId: string, claseId: string, json: string) => Promise<ResultadoImportarCafciManual>;
}) {
  const $cfg = useDinero();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PosicionesManualesCard manuales={manuales} fechaCorrida={fechaCorrida} onEdit={onEditManual} onAdd={onAddManual} />
      <ActivosFijosCard activosFijos={activosFijos} onEdit={onEditFijo} onAdd={onAddFijo} />
      {/* F9.196.1 §1.c — los depósitos y retiros sin par, arriba de los flujos manuales. */}
      <ParaDecidirCard
        manuales={flujos.filter(f => !(f as FlujoPatrimonio & { automatico?: boolean }).automatico)
          .map(f => ({ fecha: f.fecha.toDate().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }), cuenta: f.cuenta, montoUsd: f.montoUsd }))}
        privado={$cfg.privado}
        onAplicado={onFlujosAplicados}
      />
      <AportesRetirosCard flujos={flujos} onAdd={onAddFlujo} onEdit={onEditFlujo} />
      <CafciFondosCard configCafci={configCafci} carteras={cafciCarteras} sincronizando={sincronizandoCafci} onSincronizar={onSincronizarCafci} onGuardar={onGuardarConfigCafci} onImportarFondos={onImportarFondosCafci} onImportarMapping={onImportarMappingCafci} onImportarFactores={onImportarFactores} onImportarManual={onImportarCafciManual} />
      <TipoCambioCard />
      <PoliticaRiesgoCard topes={topesRiesgo} configurado={riesgoConfigurado} onGuardar={onGuardarRiesgo} />
      <PoliticaCriptoCard onToast={onToast} />
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Análisis IA</div>
            <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 }}>
              {configIA.habilitado ? 'Habilitado · consume API de Anthropic' : 'Deshabilitado · no llama a la API'}
            </div>
          </div>
          <button
            onClick={() => onToggleIA(!configIA.habilitado)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
          >
            <Icon name={configIA.habilitado ? 'toggle-right' : 'toggle-left'} size={28} color={configIA.habilitado ? 'var(--color-accent)' : 'var(--gf-gray-400)'} />
          </button>
        </div>
      </Card>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Actualización de precios</div>
            <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2 }}>Próximamente</div>
          </div>
          <Icon name="toggle-left" size={28} color="var(--gf-gray-300)" />
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', marginTop: 10, lineHeight: 1.5 }}>
          Traerá cotizaciones de referencia (cripto y NYSE) con un botón manual. Los precios de referencia NUNCA
          modifican la corrida: se muestran como línea informativa junto al valor oficial. Métricas, semáforos
          e informes siguen calculando sobre la corrida documentada.
        </div>
      </Card>
      <Card>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Edición manual del portafolio</div>
        <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', marginTop: 2, marginBottom: 10 }}>Próximamente</div>
        <div style={{ fontSize: 11.5, color: 'var(--gf-gray-400)', lineHeight: 1.5 }}>
          Permitirá registrar ajustes manuales trazables (alta/baja/corrección) entre corridas, sin editar la corrida original.
        </div>
      </Card>
    </div>
  );
}

// ── Helper: ticker de portfolio → símbolo Yahoo Finance ──────────────────────
function toYahooTicker(ticker: string, tipo: string, pais_riesgo: string, _moneda: string): string {
  if (ticker.includes('-USD') || ticker.endsWith('.BA')) return ticker;
  if (tipo === 'cripto') return ticker + '-USD';
  if (pais_riesgo === 'AR') return ticker + '.BA';
  return ticker;
}

// ── Solapa Optimización (F9.98) ───────────────────────────────────────────────
// F9.102 4b — texto humano del motivo de exclusión/inclusión de una serie en Optim.
// El "mín 40" está hardcodeado en paridad con MIN_OBS del onCalcular de Optim (Patrimonio.tsx);
// si ese valor cambia, actualizar acá también (no hay un solo punto de verdad para minObs hoy).
function motivoDiagHumano(d: DiagnosticoSerie): string {
  switch (d.motivo) {
    case 'ok': return 'ok';
    case 'sin_datos_yahoo': return 'sin datos de Yahoo';
    case 'tc_insuficiente': return `TC insuficiente (${d.puntosDolarizados ?? 0} sem, mín 40)`;
    case 'serie_corta': return `serie corta (${d.semanasAlineadas} sem, mín 40)`;
    case 'recorta_interseccion': return `recorta la intersección (${d.semanasAlineadas} sem)`;
    default: return d.motivo;
  }
}

function OptimizacionTab({
  posiciones, resultado, calculando, error, avisoGuardado, onCalcular,
}: {
  posiciones: Array<{ ticker: string; tipo: string; pais_riesgo: string; moneda_origen: string; valorUsd: number }>;
  resultado: ResultadoOptimizacion | null;
  calculando: boolean;
  error: string | null;
  avisoGuardado: string | null;
  onCalcular: (semanas: number, pesoMax: number) => void;
}) {
  const [semanas, setSemanas] = useState(104);
  const [pesoMax, setPesoMax] = useState(0.15);
  const [showTests, setShowTests] = useState(false);
  const [testResults, setTestResults] = useState<ReturnType<typeof correrTests> | null>(null);
  const [showDiag, setShowDiag] = useState(false);

  // F9.102.2 2 — guarda permanente (no andamiaje temporal): si los tests del motor de
  // min-var (casos analíticos, deterministas, no dependen de datos reales) están en rojo,
  // la columna Mín. var. no se muestra como si fuera una recomendación válida.
  const motorMinVarSano = useMemo(
    () => testMinVarAnalitico().ok && testMinVarConstraintWmax().ok,
    []
  );

  const aptas = posiciones.filter(p => ['accion', 'cedear', 'cripto'].includes(p.tipo));
  const totalUsd = posiciones.reduce((s, p) => s + p.valorUsd, 0) || 1;

  // F9.102 5 — dedupe de chips: una posición puede repetirse por cuenta (misma posición en
  // varias cuentas) o coincidir en símbolo Yahoo entre ticker AR/US del mismo activo; se
  // agrega primero por símbolo (key ya única) y se mapea desde ahí.
  const aptasPorSimbolo = new Map<string, number>();
  for (const p of aptas) {
    const sym = toYahooTicker(p.ticker, p.tipo, p.pais_riesgo, p.moneda_origen);
    aptasPorSimbolo.set(sym, (aptasPorSimbolo.get(sym) ?? 0) + p.valorUsd);
  }

  const btn = { padding: '8px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-base)' } as const;
  const secH = { fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase' as const, letterSpacing: '.4px', marginBottom: 6 };
  const chip = (text: string, col: string, bg: string) => (
    <span style={{ fontSize: 10.5, fontWeight: 700, color: col, background: bg, borderRadius: 5, padding: '2px 6px' }}>{text}</span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Advertencias (siempre visible) */}
      <Card>
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={secH}>Límites de esta optimización</div>
          <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
            · <strong>Series AR cortas:</strong> el tipo de cambio (MEP) solo cubre ~6 meses. Los activos AR se excluyen hasta acumular ≥40 semanas de TC.
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
            · <strong>Correlaciones en crisis:</strong> todos los activos AR colapsan a 1 simultáneamente. Esta optimización complementa — no reemplaza — los escenarios de estrés de la solapa Plan.
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
            · <strong>Sin retornos esperados históricos:</strong> métodos usados (mín. varianza y risk parity) no requieren estimarlos — así se evita sobreponderar lo que ya subió.
          </div>
        </div>
      </Card>

      {/* Parámetros + botón */}
      <Card>
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={secH}>Parámetros</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>
              Ventana:
              <select value={semanas} onChange={e => setSemanas(Number(e.target.value))}
                style={{ marginLeft: 6, fontSize: 12, borderRadius: 6, border: '1px solid var(--gf-gray-200)', padding: '3px 6px', background: 'var(--color-surface)', fontFamily: 'var(--font-base)' }}>
                <option value={52}>52 sem (1 año)</option>
                <option value={104}>104 sem (2 años)</option>
                <option value={156}>156 sem (3 años)</option>
              </select>
            </label>
            <label style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>
              Peso máx.:
              <select value={pesoMax} onChange={e => setPesoMax(Number(e.target.value))}
                style={{ marginLeft: 6, fontSize: 12, borderRadius: 6, border: '1px solid var(--gf-gray-200)', padding: '3px 6px', background: 'var(--color-surface)', fontFamily: 'var(--font-base)' }}>
                <option value={0.10}>10%</option>
                <option value={0.15}>15%</option>
                <option value={0.20}>20%</option>
                <option value={0.25}>25%</option>
                <option value={1.0}>Sin límite</option>
              </select>
            </label>
            <button onClick={() => onCalcular(semanas, pesoMax)} disabled={calculando || aptas.length === 0}
              style={{ ...btn, background: calculando ? 'var(--gf-gray-200)' : 'var(--color-accent)', color: calculando ? 'var(--gf-gray-400)' : '#fff' }}>
              <Icon name={calculando ? 'loader' : 'zap'} size={12} color={calculando ? 'var(--gf-gray-400)' : '#fff'} style={{ marginRight: 5, verticalAlign: 'middle' }} />
              {calculando ? 'Calculando…' : resultado ? 'Recalcular' : 'Calcular optimización'}
            </button>
          </div>
          {error && <div style={{ fontSize: 11.5, color: 'var(--gf-expense)', marginTop: 4 }}>{error}</div>}
        </div>
      </Card>

      {/* Posiciones incluibles */}
      <Card>
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={secH}>Posiciones elegibles</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {[...aptasPorSimbolo.keys()].map(sym => {
              const sinSerie = resultado?.sinSerieSuficiente?.includes(sym);
              return (
                <span key={sym} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, background: sinSerie ? 'var(--gf-gray-100)' : 'var(--gf-emerald-50, #d1fae5)', borderRadius: 6, padding: '3px 8px', color: sinSerie ? 'var(--gf-gray-400)' : 'var(--gf-emerald)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: sinSerie ? 'var(--gf-gray-300)' : 'var(--gf-emerald)', flexShrink: 0 }} />
                  {sym}
                  {sinSerie && <span style={{ fontSize: 10, color: 'var(--gf-gray-400)' }}>sin serie</span>}
                </span>
              );
            })}
            {aptas.length === 0 && <span style={{ fontSize: 12, color: 'var(--gf-gray-400)' }}>Sin posiciones elegibles</span>}
          </div>
        </div>
      </Card>

      {/* F9.102 4b — diagnóstico de series: reemplaza la adivinanza del chip "sin serie" con
          el detalle de puntos/semanas/motivo por símbolo. */}
      {resultado?.diagnostico && Object.keys(resultado.diagnostico).length > 0 && (
        <div>
          <button onClick={() => setShowDiag(v => !v)}
            style={{ ...btn, background: 'var(--gf-gray-100)', color: 'var(--color-text-sec)', width: '100%' }}>
            {showDiag ? 'Ocultar diagnóstico de series' : 'Ver diagnóstico de series'}
          </button>
          {showDiag && (
            <Card>
              <div style={{ padding: '10px 14px', overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11.5 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--gf-gray-200)' }}>
                      <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 700, color: 'var(--gf-gray-400)', fontSize: 10.5 }}>Símbolo</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 700, color: 'var(--gf-gray-400)', fontSize: 10.5 }}>Puntos</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 700, color: 'var(--gf-gray-400)', fontSize: 10.5 }}>Semanas</th>
                      <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 700, color: 'var(--gf-gray-400)', fontSize: 10.5 }}>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(resultado.diagnostico).sort(([a], [b]) => a.localeCompare(b)).map(([sym, d]) => (
                      <tr key={sym} style={{ borderBottom: '1px solid var(--gf-gray-100)' }}>
                        <td style={{ padding: '5px 6px', fontWeight: 700 }}>{sym}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--color-text-sec)' }}>{d.puntosDolarizados ?? d.puntosCrudos}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--color-text-sec)' }}>{d.semanasAlineadas}</td>
                        <td style={{ padding: '5px 6px', color: d.motivo === 'ok' ? 'var(--gf-emerald)' : 'var(--color-text-sec)' }}>{motivoDiagHumano(d)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {resultado && (
        <>
          {avisoGuardado && (
            <div style={{ fontSize: 11.5, color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: '8px 12px', lineHeight: 1.5 }}>
              ⚠️ {avisoGuardado}
            </div>
          )}
          {/* Heatmap de correlaciones */}
          <Card>
            <div style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={secH}>Matriz de correlaciones</div>
                <span style={{ fontSize: 10.5, color: 'var(--gf-gray-400)' }}>{resultado.semanas} sem · shrinkage α=0.2</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }} />
                      {resultado.correlacion.simbolos.map(s => (
                        <th key={s} style={{ padding: '0 4px', fontWeight: 700, color: 'var(--gf-gray-400)', fontSize: 10, maxWidth: 50, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.correlacion.simbolos.map((rowSym, i) => (
                      <tr key={rowSym}>
                        <td style={{ fontWeight: 700, color: 'var(--gf-gray-400)', fontSize: 10, paddingRight: 6, whiteSpace: 'nowrap' }}>{rowSym}</td>
                        {resultado.correlacion.matriz[i].map((v, j) => {
                          const abs = Math.abs(v);
                          const bg = i === j
                            ? 'var(--gf-gray-200)'
                            : `rgba(100,100,100,${(abs * 0.5).toFixed(2)})`;
                          return (
                            <td key={j} style={{ background: bg, padding: '4px 6px', textAlign: 'center', borderRadius: 3, border: '1px solid var(--gf-gray-100)' }}>
                              {i === j ? '—' : v.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          {/* Carteras propuestas */}
          <Card>
            <div style={{ padding: '12px 14px' }}>
              <div style={secH}>Carteras calculadas vs actual</div>
              {!motorMinVarSano && (
                <div style={{ fontSize: 11, color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '5px 9px', marginTop: 4 }}>
                  ⚠️ Mín. var.: no confiable — tests del motor en rojo
                </div>
              )}
              <div style={{ overflowX: 'auto', marginTop: 6 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--gf-gray-200)' }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 700, color: 'var(--gf-gray-400)', fontSize: 11 }}>Activo</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 700, color: 'var(--gf-gray-400)', fontSize: 11 }}>Actual</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 700, color: 'var(--gf-gray-400)', fontSize: 11 }}>Mín. var.</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 700, color: 'var(--gf-gray-400)', fontSize: 11 }}>Risk P.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.deltasMinVarianza.map(row => {
                      const rpPeso = resultado.riskParity.pesos[row.simbolo] ?? 0;
                      const rpDelta = rpPeso - row.pesoActual;
                      return (
                        <tr key={row.simbolo} style={{ borderBottom: '1px solid var(--gf-gray-100)' }}>
                          <td style={{ padding: '5px 8px', fontWeight: 700 }}>{row.simbolo}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--color-text-sec)' }}>{(row.pesoActual * 100).toFixed(1)}%</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                            {motorMinVarSano ? (
                              <>
                                <span>{(row.pesoOptimo * 100).toFixed(1)}%</span>
                                <span style={{ fontSize: 10, marginLeft: 4, color: row.delta > 0.01 ? 'var(--gf-emerald)' : row.delta < -0.01 ? 'var(--color-text-sec)' : 'var(--gf-gray-400)' }}>
                                  {row.delta > 0 ? '+' : ''}{(row.delta * 100).toFixed(1)}pp
                                </span>
                              </>
                            ) : (
                              <span style={{ color: 'var(--gf-gray-300)' }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                            <span>{(rpPeso * 100).toFixed(1)}%</span>
                            <span style={{ fontSize: 10, marginLeft: 4, color: rpDelta > 0.01 ? 'var(--gf-emerald)' : rpDelta < -0.01 ? 'var(--color-text-sec)' : 'var(--gf-gray-400)' }}>
                              {rpDelta > 0 ? '+' : ''}{(rpDelta * 100).toFixed(1)}pp
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '1px solid var(--gf-gray-200)' }}>
                      <td style={{ padding: '4px 8px', fontSize: 11, color: 'var(--gf-gray-400)' }}>Volatilidad (sem.)</td>
                      <td />
                      <td style={{ padding: '4px 8px', textAlign: 'right', fontSize: 11, color: 'var(--gf-gray-300)' }}>{motorMinVarSano ? `${(resultado.minVarianza.volatilidad * 100).toFixed(2)}%` : '—'}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', fontSize: 11, color: 'var(--gf-gray-400)' }}>{(resultado.riskParity.volatilidad * 100).toFixed(2)}%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {resultado.sinSerieSuficiente.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {resultado.sinSerieSuficiente.map(s => chip(s + ' sin serie', 'var(--gf-gray-400)', 'var(--gf-gray-100)'))}
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--gf-gray-400)' }}>
                Cartera calculada (no prescriptiva) · {new Date(resultado.fechaCalculo).toLocaleDateString('es-AR')}
              </div>
            </div>
          </Card>

          {/* Tests unitarios */}
          <div>
            {/* F9.125 — los tests del gemelo normalizarEspecie corren acá, en el mismo panel: la
                copia cliente no la cubría nada, y el par gemelo solo sirve si las dos se testean. */}
            <button onClick={() => { setShowTests(!showTests); if (!testResults) setTestResults([...correrTests(), ...testsGemeloNormalizarEspecie()]); }}
              style={{ ...btn, background: 'var(--gf-gray-100)', color: 'var(--color-text-sec)', width: '100%' }}>
              {showTests ? 'Ocultar tests matemáticos' : 'Verificar tests unitarios del motor'}
            </button>
            {showTests && testResults && (
              <Card>
                <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {testResults.map(t => (
                    <div key={t.nombre} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 13, lineHeight: 1, marginTop: 1 }}>{t.ok ? '✓' : '✗'}</span>
                      <div>
                        <div style={{ fontSize: 11.5, fontWeight: 700 }}>{t.nombre}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-sec)' }}>{t.detalle}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Modal chat path (F9.99) ────────────────────────────────────────────────────
function ModalPromptChat({
  modo, ticker, contexto, onDone, onClose,
}: {
  modo: ModoIA;
  ticker?: string;
  contexto: Record<string, unknown>;
  onDone: () => void;
  onClose: () => void;
}) {
  const [paso, setPaso] = useState<1 | 2>(1);
  const [promptText, setPromptText] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [contenido, setContenido] = useState('');
  const [validando, setValidando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importado, setImportado] = useState(false);
  const [resumenImportado, setResumenImportado] = useState<string | null>(null);
  const nombreModo = modo === 'posicion' ? `Posición ${ticker}` : modo === 'sectorial' ? 'Sectorial' : modo === 'agenda' ? 'Agenda macro' : modo === 'completo' ? (contexto['parte'] === 'posiciones' ? 'Informe 2/2 · Posiciones' : 'Informe 1/2 · Estrategia') : 'Lote (toda la cartera)';

  useEffect(() => {
    setCargando(true);
    setError(null);
    generarPromptIA(modo, contexto, ticker)
      .then(r => {
        // F9.196 — si el servidor arma un prompt de otra versión que el contexto, el informe sale
        // vacío o viejo sin que se note. Se corta acá, a la vista.
        const vCtx = contexto['version'];
        if (modo === 'completo' && typeof vCtx === 'number' && r.versionPrompt !== vCtx) {
          setError(`El servidor armó el prompt v${r.versionPrompt ?? 1} para un contexto v${vCtx}: las functions están desactualizadas. Corré "firebase deploy --only functions" y volvé a abrir esto.`);
          return;
        }
        setPromptText(r.prompt);
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCargando(false));
  }, []);

  const copiar = () => {
    navigator.clipboard.writeText(promptText);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const descargar = () => {
    const nombre = `prompt-ia-${modo}-${ticker || 'general'}-${new Date().toISOString().slice(0, 10)}.txt`;
    const blob = new Blob([promptText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre; a.click();
    URL.revokeObjectURL(url);
  };

  const validarEImportar = async () => {
    setValidando(true);
    setError(null);
    try {
      const result = await importarAnalisisIA(modo, contenido, ticker);
      setResumenImportado(result.resumen);
      setImportado(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setValidando(false);
    }
  };

  const btn = { padding: '9px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-base)' } as const;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: 'var(--color-surface)', borderRadius: '18px 18px 0 0', width: '100%', maxWidth: 480, padding: '20px 16px 32px', display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '90dvh', overflow: 'auto' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Analizar vía chat · {nombreModo}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={18} color="var(--color-text-sec)" />
          </button>
        </div>

        {/* Selector de paso */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--gf-gray-100)', borderRadius: 9, padding: 3 }}>
          {([1, 2] as const).map(p => (
            <button key={p} onClick={() => setPaso(p)} style={{ flex: 1, padding: '7px 4px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12.5, background: paso === p ? 'var(--color-surface)' : 'transparent', color: paso === p ? 'var(--color-text)' : 'var(--gf-gray-400)', fontFamily: 'var(--font-base)' }}>
              Paso {p} · {p === 1 ? 'Prompt' : 'Importar'}
            </button>
          ))}
        </div>

        {paso === 1 && (
          <>
            <div style={{ fontSize: 12, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
              Pegá este prompt en un chat de Claude (claude.ai). Luego volvé al Paso 2 con la respuesta.
            </div>
            {cargando && <div style={{ fontSize: 12, color: 'var(--gf-gray-400)', textAlign: 'center', padding: 16 }}>Generando prompt…</div>}
            {error && <div style={{ fontSize: 12, color: 'var(--gf-expense)' }}>{error}</div>}
            {promptText && (
              <textarea readOnly value={promptText} rows={8}
                style={{ fontSize: 11.5, borderRadius: 8, border: '1px solid var(--gf-gray-200)', padding: '8px 10px', resize: 'vertical', background: 'var(--gf-gray-50)', fontFamily: 'var(--font-base)', color: 'var(--color-text)' }} />
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={copiar} disabled={!promptText} style={{ ...btn, flex: 1, background: copiado ? 'var(--gf-emerald)' : 'var(--gf-gray-100)', color: copiado ? '#fff' : 'var(--color-text)' }}>
                <Icon name={copiado ? 'check' : 'copy'} size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
              <button onClick={descargar} disabled={!promptText} style={{ ...btn, flex: 1, background: 'var(--gf-gray-100)', color: 'var(--color-text)' }}>
                <Icon name="download" size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                Descargar .txt
              </button>
            </div>
            <button onClick={() => setPaso(2)} disabled={!promptText} style={{ ...btn, background: 'var(--color-accent)', color: '#fff' }}>
              Ir al Paso 2 →
            </button>
          </>
        )}

        {paso === 2 && (
          <>
            {importado ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', padding: '12px 0' }}>
                <span style={{ fontSize: 28 }}>✓</span>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Análisis importado</div>
                {resumenImportado && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-sec)', textAlign: 'center', lineHeight: 1.4 }}>{resumenImportado}</div>
                )}
                <button onClick={onDone} style={{ ...btn, background: 'var(--color-accent)', color: '#fff', width: '100%' }}>Cerrar</button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--color-text-sec)', lineHeight: 1.5 }}>
                  Pegá la respuesta de Claude. Puede incluir los fences {modo === 'sectorial' ? '```markdown' : '```json'} o no.
                  {(modo === 'lote' || modo === 'completo') && (
                    <span style={{ display: 'block', marginTop: 4, color: 'var(--gf-gray-400)' }}>
                      Si Claude cortó en varios mensajes, concatená todas las partes antes de pegar (el JSON debe ser un único bloque válido).
                    </span>
                  )}
                </div>
                <textarea value={contenido} onChange={e => { setContenido(e.target.value); setError(null); }} rows={8} placeholder={modo === 'sectorial' ? 'Pegar texto aquí…' : 'Pegar JSON aquí…'}
                  style={{ fontSize: 11.5, borderRadius: 8, border: `1px solid ${error ? 'var(--gf-expense)' : 'var(--gf-gray-200)'}`, padding: '8px 10px', resize: 'vertical', fontFamily: 'var(--font-base)', color: 'var(--color-text)', background: 'var(--color-surface)' }} />
                {error && <div style={{ fontSize: 11.5, color: 'var(--gf-expense)' }}>{error}</div>}
                <button onClick={validarEImportar} disabled={!contenido.trim() || validando}
                  style={{ ...btn, background: validando ? 'var(--gf-gray-200)' : 'var(--color-accent)', color: validando ? 'var(--gf-gray-400)' : '#fff' }}>
                  {validando ? 'Validando…' : 'Validar e importar'}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Vista principal ───────────────────────────────────────────────────────────
const TABS = [
  ['resumen',      'Resumen'],
  ['tenencias',    'Tenencias'],
  ['riesgo',       'Riesgo'],
  ['plan',         'Plan'],
  ['benchmark',    'Bench'],
  ['optimizacion', 'Optim'],
  ['research',     'Research'],
  ['config',       'Config'],
] as const;
type TabId = typeof TABS[number][0];

export default function Patrimonio() {
  const [tab, setTab] = useState<TabId>('resumen');
  // F9.114 — valor inicial por la cascada (cache del último TC leído → TC_FALLBACK), no el
  // literal pelado; abajo lo pisa /tcDiario cuando llega.
  const { privado, alternar: alternarPrivado } = usePrivacidad();
  const [tc, setTc] = useState(() => tcEfectivoDe({ estado: 'cargando' }).tc);

  const [posiciones,        setPosiciones]        = useState<Posicion[]>([]);
  const [activosFijos,      setActivosFijos]      = useState<ActivoFijo[]>([]);
  const [posicionesManuales, setPosicionesManuales] = useState<PosicionManual[]>([]);
  const [fechaCorrida,      setFechaCorrida]      = useState('');
  const [historial,         setHistorial]         = useState<SnapshotResumen[]>([]);
  const [loading, setLoading] = useState(true);

  const [informes,          setInformes]         = useState<InformeAnterior[]>([]);
  const [generandoInforme, setGenerandoInforme] = useState(false);

  const [configIA,           setConfigIA]          = useState<ConfigIA>({ habilitado: false });
  const [analisisCache,      setAnalisisCache]      = useState<Record<string, AnalisisPosicion>>({});
  const [sectorial,          setSectorial]          = useState<AnalisisSectorial | null>(null);
  const [generandoSectorial, setGenerandoSectorial] = useState(false);
  const [analizandoLote,     setAnalizandoLote]     = useState(false);
  const [loteProgreso,       setLoteProgreso]       = useState<{ actual: number; total: number; errores: string[] } | null>(null);
  const [agenda,             setAgenda]             = useState<AgendaMacro | null>(null);
  const [analisisGlobal,     setAnalisisGlobal]     = useState<AnalisisGlobal | null>(null);
  const [generandoAgenda,    setGenerandoAgenda]    = useState(false);

  const [decisiones,          setDecisiones]          = useState<DecisionPatrimonio[]>([]);
  const [showModalDecision,   setShowModalDecision]   = useState(false);
  const [preloadDecision,     setPreloadDecision]     = useState<{ opcionReferencia: 'A' | 'B' | 'C' | null; tickers: string[] } | null>(null);
  const [showModalRevision,   setShowModalRevision]   = useState<{ decision: DecisionPatrimonio; tipo: '30d' | '90d' } | null>(null);

  const [flujos,             setFlujos]             = useState<FlujoPatrimonio[]>([]);
  const [showModalFlujo,   setShowModalFlujo]   = useState(false);
  const [editFlujo,        setEditFlujo]        = useState<FlujoPatrimonio | null>(null);

  // F9.116 §3 — política de riesgo declarada por el titular (fracciones, ver patrimonioRiesgo.ts)
  const [topesRiesgo,       setTopesRiesgo]       = useState<TopesRiesgo>(RIESGO_DEFAULTS);
  const [riesgoConfigurado, setRiesgoConfigurado] = useState(false);

  const [configCafci,        setConfigCafci]        = useState<ConfigCafci>({ fondos: [] });
  const [cafciCarteras,      setCafciCarteras]      = useState<CafciCartera[]>([]);
  const [cafciMappings,      setCafciMappings]      = useState<Record<string, string | null>>({});
  const [universoCafci,      setUniversoCafci]      = useState<UniversoCafci | null>(null);
  // F9.144 — una sola lectura de `indicadoresPosicion` por montaje de la vista, indexada por
  // identidad. NUNCA se lee `preciosDiarios` desde el cliente: son ~30 KB por documento.
  const [indicadores,        setIndicadores]        = useState<Map<string, IndicadoresPosicion>>(new Map());
  const [factores,           setFactores]           = useState<Record<string, Factor>>({});
  const [sincronizandoCafci, setSincronizandoCafci] = useState(false);

  // F9.98 — Optimización
  const [optimizacion,          setOptimizacion]          = useState<ResultadoOptimizacion | null>(null);
  const [calculandoOptimizacion, setCalculandoOptimizacion] = useState(false);
  const [errorOptimizacion,     setErrorOptimizacion]     = useState<string | null>(null);
  // F9.102.1 1b — el resultado se muestra en pantalla antes de persistir; si falla el guardado
  // (ej. Firestore rechaza el doc), no se pierde el cálculo ya hecho — se avisa aparte.
  const [avisoGuardadoOptim,    setAvisoGuardadoOptim]    = useState<string | null>(null);

  // F9.99 — Modal chat path
  const [modalPromptChat, setModalPromptChat] = useState<{
    modo: ModoIA;
    ticker?: string;
    contexto: Record<string, unknown>;
    onDone: () => void;
  } | null>(null);

  const [showIngesta,      setShowIngesta]      = useState(false);
  // F9.196 H2a — cartera viva (`carteraViva/ultima`, la escribe actualizarCarteraViva).
  const [carteraViva, setCarteraViva] = useState<DocCarteraViva | null>(null);
  // F9.196 H6 — deep link a la ficha y tesis por ticker (una lectura por montaje).
  const [fichaAbierta, setFichaAbierta] = useState<string | null>(null);
  const [tesisMap, setTesisMap] = useState<Record<string, DocTesis>>({});
  useEffect(() => { cargarTodasLasTesis().then(setTesisMap).catch(e => console.warn('[tesis]', e)); }, []);
  useEffect(() => { cargarCarteraViva().then(setCarteraViva).catch(e => { console.warn('[carteraViva]', e); setCarteraViva(null); }); }, []);
  // Después de una corrida nueva o de importar Balanz: recalcular el valor de hoy (fail-soft).
  const recalcularYRecargarCarteraViva = () => {
    recalcularCarteraViva()
      .then(() => cargarCarteraViva())
      .then(setCarteraViva)
      .catch(e => console.warn('[carteraViva] no se pudo recalcular:', e));
  };
  // F9.196 Addendum 2 §A — "Actualizar Balanz" (Mis Instrumentos → cuentasVivas).
  const [showBalanz,       setShowBalanz]       = useState(false);
  const [showModalFijo,    setShowModalFijo]    = useState(false);
  const [editFijo,         setEditFijo]         = useState<ActivoFijo | null>(null);
  const [showModalManual,  setShowModalManual]  = useState(false);
  const [editManual,       setEditManual]       = useState<PosicionManual | null>(null);

  // F9.101 — Actualización integral
  const [actualizandoTodo, setActualizandoTodo] = useState<{ idx: number; total: number; label: string } | null>(null);
  const [resultadoActualizarTodo, setResultadoActualizarTodo] = useState<string[] | null>(null);
  const [toastIngestaOk,   setToastIngestaOk]   = useState(false);
  // F9.102 3b — feedback real de "Sincronizar CAFCI" (antes fail-silent).
  const [toast, setToast] = useState<{ texto: string; error: boolean } | null>(null);

  useEffect(() => {
    cargarTCReciente(1).then(h => { if (h[0]) setTc(h[0].tcUsdArs); });
    cargarConfigIA().then(setConfigIA);
    cargarUltimoSectorial().then(setSectorial);
    cargarUltimaAgenda().then(setAgenda);
    cargarUltimoGlobal().then(setAnalisisGlobal).catch(e => console.error('[analisisGlobal] no se pudo leer:', e));
    cargarTodosLosAnalisis().then(lista => {
      const cache: Record<string, AnalisisPosicion> = {};
      for (const a of lista) cache[a.ticker] = a;
      setAnalisisCache(cache);
    });
    // F9.142 — encadenado, no en paralelo: las carteras se filtran por la config, así que
    // conviene leerla una sola vez y pasarla, en vez de que cada llamada la relea por su cuenta.
    // F9.143 — el universo derivado gobierna el benchmark; la config queda como override manual y
    // se sigue leyendo porque la card de Config la muestra y la edita.
    cargarConfigCafci().then(setConfigCafci).catch(e => console.error('[configCafci]', e));
    cargarUniversoVigente()
      .then(u => { setUniversoCafci(u); return cargarUltimasCarteras(u ? fondosDeUniverso(u) : undefined); })
      .then(setCafciCarteras)
      .catch(e => console.error('[universoCafci] no se pudo leer:', e));
    cargarMappings().then(setCafciMappings);
    // F9.127 §2 — una sola lectura del diccionario de overrides por montaje de la vista.
    cargarFactoresTicker().then(setFactores).catch(e => console.error('[factores] no se pudieron leer:', e));
    cargarIndicadoresPorIdentidad().then(setIndicadores)
      .catch(e => console.error('[indicadores] no se pudieron leer:', e));
    cargarUltimaOptimizacion().then(setOptimizacion);
  }, []);

  function cargar() {
    setLoading(true);
    Promise.all([
      cargarPosicionesVigentes(),
      cargarActivosFijos(),
      cargarPosicionesManuales(),
      cargarHistorialSnapshots(10),
      cargarInformesAnteriores(5),
      cargarDecisiones(),
      cargarFlujos(),
      // F9.116 §3 — sin doc configurado devuelve los defaults y `configurado:false`, que la
      // card usa para aclararlo en pantalla.
      cargarConfigRiesgo().catch(err => {
        console.error('[Patrimonio] cargarConfigRiesgo falló:', err);
        return { topes: RIESGO_DEFAULTS, configurado: false };
      }),
    ])
      .then(([pos, fijos, manuales, hist, infs, decs, flujos, riesgo]) => {
        setPosiciones(pos);
        setActivosFijos(fijos);
        setPosicionesManuales(manuales);
        setHistorial(hist);
        setInformes(infs);
        setDecisiones(decs);
        setFlujos(flujos);
        setTopesRiesgo(riesgo.topes);
        setRiesgoConfigurado(riesgo.configurado);
        if (pos.length > 0) setFechaCorrida(pos[0].fechaCorrida);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { cargar(); }, []);

  async function handleGuardarFijo(af: ActivoFijo) {
    await guardarActivoFijo(af);
    setActivosFijos(prev => {
      const idx = prev.findIndex(x => x.id === af.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = af; return next; }
      return [...prev, af];
    });
    setShowModalFijo(false);
  }

  async function handleEliminarFijo(id: string) {
    await eliminarActivoFijo(id);
    setActivosFijos(prev => prev.filter(x => x.id !== id));
    setShowModalFijo(false);
  }

  async function handleGuardarManual(pm: PosicionManual) {
    await guardarPosicionManual(pm);
    setPosicionesManuales(prev => {
      const idx = prev.findIndex(x => x.id === pm.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = pm; return next; }
      return [...prev, pm];
    });
    setShowModalManual(false);
  }

  async function handleEliminarManual(id: string) {
    await eliminarPosicionManual(id);
    setPosicionesManuales(prev => prev.filter(x => x.id !== id));
    setShowModalManual(false);
  }

  async function handleGuardarFlujo(data: NuevoFlujo) {
    if (editFlujo) {
      await actualizarFlujo(editFlujo.id, data);
      setFlujos(prev => prev.map(f => f.id === editFlujo.id ? { ...f, ...data } : f));
    } else {
      const nuevo = await crearFlujo(data);
      setFlujos(prev => [nuevo, ...prev].sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis()));
    }
    setShowModalFlujo(false);
  }

  async function handleEliminarFlujo(id: string) {
    await eliminarFlujo(id);
    setFlujos(prev => prev.filter(f => f.id !== id));
    setShowModalFlujo(false);
  }

  // F9.142 — al guardar la config hay que releer las carteras: ahora la config decide qué
  // fondos entran al benchmark, así que sacar uno de la lista tiene que sacarlo del cálculo
  // en el acto. Sin esto el estado quedaba mostrando el fondo recién eliminado hasta recargar
  // la vista, que es justo la sensación de "lo saqué y sigue ahí" que este cambio elimina.
  async function handleGuardarConfigCafci(c: ConfigCafci) {
    await guardarConfigCafci(c);
    setConfigCafci(c);
    setCafciCarteras(await cargarUltimasCarteras(c.fondos));
  }

  async function handleImportarFondosCafci() {
    try {
      const n = await importarFondosSugeridos();
      const updated = await cargarConfigCafci();
      setConfigCafci(updated);
      setCafciCarteras(await cargarUltimasCarteras(updated.fondos));
      if (n === 0) alert('Los fondos sugeridos ya estaban en la lista.');
      else alert(`${n} fondo${n !== 1 ? 's' : ''} agregado${n !== 1 ? 's' : ''}.`);
    } catch (e) {
      console.error('[importarFondos]', e);
    }
  }

  async function handleImportarMappingCafci() {
    try {
      const n = await importarMappingSeed();
      const mappings = await cargarMappings();
      setCafciMappings(mappings);
      alert(`Mapping importado: ${n} patrones escritos en cafciMapping.`);
    } catch (e) {
      console.error('[importarMapping]', e);
    }
  }

  // F9.127 §2 — semilla del override de factores. Reporta cuántos conservó por ser manuales, que es
  // la garantía de que la semilla no pisa lo cargado a mano.
  async function handleImportarFactores() {
    try {
      const { escritos, conservados } = await importarFactoresSeed();
      setFactores(await cargarFactoresTicker());
      alert(`Factores importados: ${escritos} escritos${conservados > 0 ? `, ${conservados} conservados por ser manuales` : ''}.`);
    } catch (e) {
      console.error('[importarFactores]', e);
    }
  }

  // F9.102 3b — deja de tragar el resultado: toast con conteos reales + errores por fondo,
  // y devuelve el resultado (o null en error) para que "Actualizar todo" (etapa 5) lo consuma.
  async function handleSincronizarCafci(): Promise<ResultadoSincronizarCafci | null> {
    if (sincronizandoCafci) return null;
    setSincronizandoCafci(true);
    try {
      const result = await sincronizarCafciCallable();
      // Recargar carteras tras sincronizar
      const [carteras, mappings] = await Promise.all([cargarUltimasCarteras(configCafci.fondos), cargarMappings()]);
      setCafciCarteras(carteras);
      setCafciMappings(mappings);
      const partes = [`CAFCI: ${result.sincronizados}/${configCafci.fondos.length} fondos`];
      if (result.pendientesMapeo.length > 0) partes.push(`${result.pendientesMapeo.length} especies sin mapear`);
      if (result.errores.length > 0) partes.push(`${result.errores.length} con error (${result.errores[0].fondo}: ${result.errores[0].mensaje})`);
      setToast({ texto: partes.join(' · '), error: result.errores.length > 0 });
      return result;
    } catch (e) {
      console.error('[sincronizarCafci]', e);
      setToast({ texto: `Sincronizar CAFCI: falló (${e instanceof Error ? e.message : String(e)})`, error: true });
      return null;
    } finally {
      setSincronizandoCafci(false);
    }
  }

  // F9.102.2 4b — ingesta manual de JSON/array CAFCI: red de seguridad si el fetch automático
  // falla (sitio caído, cambio de estructura, etc. — F9.104). Tira si falla — el modal de
  // "Pegar JSON" muestra el mensaje inline (más accionable ahí que en un toast lejos del
  // textarea); solo el éxito pasa por el toast compartido, igual que sincronizarCafci.
  async function handleImportarCafciManual(fondoId: string, claseId: string, json: string) {
    const result = await importarCafciManualCallable(fondoId, claseId, json);
    const [carteras, mappings] = await Promise.all([cargarUltimasCarteras(configCafci.fondos), cargarMappings()]);
    setCafciCarteras(carteras);
    setCafciMappings(mappings);
    const partes = [`Importado: ${result.especies} especies · datos al ${result.fechaDatos}`];
    if (result.pendientesMapeo.length > 0) partes.push(`${result.pendientesMapeo.length} sin mapear`);
    setToast({ texto: partes.join(' · '), error: false });
    return result;
  }

  // Manuales fusionadas con corrida para métricas (lente invertible incluye manuales)
  const todasPosiciones = [...posiciones, ...posicionesManuales.map(manualToPosicion)];

  async function handleAnalizarPosicion(ticker: string, contexto: Record<string, unknown>) {
    try {
      const result = await analizarPosicion(ticker, contexto);
      setAnalisisCache(prev => ({ ...prev, [ticker]: result }));
    } catch (e) {
      console.error('[analizarPosicion]', e);
    }
  }

  // Agrupa todasPosiciones por ticker (consolida distintas cuentas del mismo papel).
  // Compartido por Analizar lote, Chat lote y Actualización integral (F9.101).
  function buildByTickerMap(): Record<string, { totalUsd: number; sectorDisp: string }> {
    const byTickerMap: Record<string, { totalUsd: number; sectorDisp: string }> = {};
    for (const p of todasPosiciones) {
      const sec = (() => { const base = SECTOR_DISPLAY[p.sector] ?? p.sector; if (p.sector === 'cripto' || p.sector === 'cash' || p.sector === 'global') return base; return base + (p.pais_riesgo === 'AR' ? ' AR' : ' Global'); })();
      if (!byTickerMap[p.ticker]) byTickerMap[p.ticker] = { totalUsd: 0, sectorDisp: sec };
      byTickerMap[p.ticker].totalUsd += p.valorUsd;
    }
    return byTickerMap;
  }

  // Corre el análisis ticker-por-ticker (API directa) y reporta progreso. Compartido
  // por el botón "Analizar lote" standalone y la etapa 1 de "Actualizar todo — API".
  async function analizarLoteTickers(
    onProgreso?: (actual: number, total: number, errores: string[]) => void,
  ): Promise<{ ok: number; errores: string[] }> {
    if (!M) return { ok: 0, errores: [] };
    const byTickerMap = buildByTickerMap();
    const tickers = Object.keys(byTickerMap);
    const errores: string[] = [];
    for (let i = 0; i < tickers.length; i++) {
      const t = tickers[i];
      const { totalUsd, sectorDisp } = byTickerMap[t];
      try {
        const result = await analizarPosicion(t, { ticker: t, sector: sectorDisp, pesoEnCartera: pct(totalUsd / (M.total || 1)), valorUsd: Math.round(totalUsd) });
        setAnalisisCache(prev => ({ ...prev, [t]: result }));
      } catch {
        errores.push(t);
      }
      onProgreso?.(i + 1, tickers.length, errores);
    }
    return { ok: tickers.length - errores.length, errores };
  }

  async function handleAnalizarLote() {
    if (!M || analizandoLote) return;
    setAnalizandoLote(true);
    setLoteProgreso({ actual: 0, total: Object.keys(buildByTickerMap()).length, errores: [] });
    await analizarLoteTickers((actual, total, errores) => setLoteProgreso({ actual, total, errores }));
    setAnalizandoLote(false);
  }

  function handleAbrirChatLote() {
    if (!M) return;
    const byTickerMap = buildByTickerMap();
    const posicionesLote = Object.entries(byTickerMap).map(([t, v]) => ({
      ticker: t, sector: v.sectorDisp, pesoEnCartera: pct(v.totalUsd / (M.total || 1)), valorUsd: Math.round(v.totalUsd),
    }));
    const contexto = {
      posiciones: posicionesLote,
      global: { total: Math.round(M.total), paisAr: pct(M.paisAr), cripto: pct(M.cripto), hhi: M.hhi },
    };
    setModalPromptChat({
      modo: 'lote',
      contexto,
      onDone: () => {
        cargarTodosLosAnalisis().then(analisis => {
          const cache: Record<string, AnalisisPosicion> = {};
          for (const a of analisis) if (a.ticker) cache[a.ticker] = a;
          setAnalisisCache(prev => ({ ...prev, ...cache }));
        });
      },
    });
  }

  // F9.190 §1 — contexto del informe v2: los números del motor de riesgo (los mismos que pinta
  // "Riesgo y escenarios"), la reserva y la materialidad ya resuelta. Asincrónico porque necesita
  // declaraciones, custodias y la última lectura de señales; cada una es fail-soft: si falla, el
  // informe sale sin ese dato en vez de no salir.
  // F9.194 — el informe v3 va en dos partes: 'estrategia' (global, oportunidades, sectorial,
  // agenda) y 'posiciones' (fichas + manuales, con el panorama que dejó la parte 1).
  async function buildContextoCompleto(parte: 'estrategia' | 'posiciones' = 'estrategia'): Promise<Record<string, unknown>> {
    if (!M) return {};
    const byTickerMap = buildByTickerMap();
    const sectorDe: Record<string, string> = {};
    for (const [t, v] of Object.entries(byTickerMap)) sectorDe[t] = v.sectorDisp;
    const [decls, custodias, senales] = await Promise.all([
      cargarDeclaraciones().catch(e => { console.error('[informe v2] declaraciones:', e); return [] as Declaracion[]; }),
      cargarCustodiaCuenta().catch(e => { console.error('[informe v2] custodias:', e); return {} as Record<string, Custodia>; }),
      // F9.191 — si no hay lectura o tiene más de 6 h, se lee ahora: así el modelo copia el mercado
      // de la app en vez de gastar búsquedas (y no aparecen dos valores para el mismo dato).
      // Fail-soft: si la lectura nueva falla, se usa la guardada.
      // La parte 2 no usa el mercado: no se lee.
      parte === 'posiciones' ? Promise.resolve(null) : cargarUltimaLecturaSenales()
        .then(async est => {
          const t = est.lectura?.leidoEnISO ? new Date(est.lectura.leidoEnISO).getTime() : 0;
          if (Date.now() - t < 6 * 3600_000) return est;
          return actualizarSenales(false).catch(e => { console.error('[informe v3] actualizar señales:', e); return est; });
        })
        .catch(e => { console.error('[informe v2] señales:', e); return null; }),
    ]);
    const exposiciones = intentar(() => clasificarExposiciones(
      posicionesInvertibles(posiciones, posicionesManuales), decls, {
        factores, custodias,
        labelFactor: (f: Factor) => FACTOR_LABEL[f],
        labelBloque: (b: Bloque) => BLOQUE_LABEL[b],
      }), 'clasificarExposiciones') ?? [];
    // F9.191 — contexto v3: suma la lectura de mercado cruda (el modelo la copia en vez de
    // buscarla), umbrales, contribución por bloque de los peores escenarios y universo invertible.
    const entrada = {
      fecha: new Date().toISOString().slice(0, 10),
      posiciones, manuales: posicionesManuales,
      topes: topesRiesgo, riesgoConfigurado,
      factores, exposiciones, sectorDe, hhi: M.hhi,
      senales: null,
      lectura: senales?.lectura ?? null,
      bases: senales?.bases ?? null,
      perfil: null,   // pendiente F9.192: UI de perfil del titular
    };
    // F9.196 H2a — el informe sigue sobre la corrida; el valor de hoy va como DATO APARTE.
    if (parte === 'estrategia') return { ...contextoInformeV3(entrada), valorDeHoy: resumenValorDeHoy(carteraViva) };

    // Parte 2: lo último importado de la parte 1, leído fresco de Firestore (no del estado, que
    // puede no haberse refrescado todavía). Fail-soft: sin panorama, el prompt lo avisa.
    const [glob, sec, age, tesisPrevias] = await Promise.all([
      cargarUltimoGlobal().catch(() => null),
      cargarUltimoSectorial().catch(() => null),
      cargarUltimaAgenda().catch(() => null),
      // F9.196 H5 — la última tesis de cada acción, para que el Chat 2 la actualice (fail-soft).
      cargarTodasLasTesis().then(m => Object.fromEntries(Object.entries(m).map(([t, d]) => [t, d.tesis]))).catch(() => ({})),
    ]);
    return contextoPosicionesV3(entrada, {
      generadoEnISO: glob?.generadoEnISO ?? sec?.generadoEnISO ?? null,
      diagnostico: glob?.resultado.diagnostico ?? null,
      sectorial: sec?.resultado ?? null,
      agenda: age ? age.eventos.map(ev => ({ fecha: ev.fecha, evento: ev.evento, tickers: ev.tickers })) : null,
    }, tesisPrevias);
  }

  async function handleAbrirChatCompleto(parte: 'estrategia' | 'posiciones' = 'estrategia') {
    if (!M) return;
    const contexto = await buildContextoCompleto(parte);
    setModalPromptChat({
      modo: 'completo',
      contexto,
      onDone: () => {
        Promise.all([
          cargarTodosLosAnalisis(),
          cargarUltimoSectorial(),
          cargarUltimaAgenda(),
          cargarPosicionesManuales(),
          cargarUltimoGlobal().catch(() => null),
        ]).then(([analisis, sec, age, manuales, glob]) => {
          const cache: Record<string, AnalisisPosicion> = {};
          for (const a of analisis) if (a.ticker) cache[a.ticker] = a;
          setAnalisisCache(prev => ({ ...prev, ...cache }));
          setSectorial(sec);
          setAgenda(age);
          setPosicionesManuales(manuales);
          setAnalisisGlobal(glob);
        });
        handleSincronizarCafci();
      },
    });
  }

  // F9.101 — orquestador API: corre las 5 etapas secuencialmente, fail-soft (una etapa
  // que falla se registra y no frena a las siguientes).
  async function handleActualizarTodoApi() {
    if (!M || actualizandoTodo) return;
    setResultadoActualizarTodo(null);
    const resultados: string[] = [];

    setActualizandoTodo({ idx: 1, total: 5, label: 'Lote' });
    try {
      const { ok, errores } = await analizarLoteTickers();
      resultados.push(errores.length > 0 ? `Lote: ${ok} ok, ${errores.length} con error` : `Lote: ${ok} ok`);
    } catch (e) {
      resultados.push(`Lote: error (${e instanceof Error ? e.message : String(e)})`);
    }

    setActualizandoTodo({ idx: 2, total: 5, label: 'Sectorial' });
    try {
      const result = await analizarSectorial({ bySector: M.bySector, byTipo: M.byTipo, paisAr: pct(M.paisAr), total: M.total });
      setSectorial(result);
      resultados.push('Sectorial: ok');
    } catch (e) {
      resultados.push(`Sectorial: error (${e instanceof Error ? e.message : String(e)})`);
    }

    setActualizandoTodo({ idx: 3, total: 5, label: 'Agenda' });
    try {
      const exposicion: Record<string, string> = {};
      for (const [sector, val] of Object.entries(M.bySector)) exposicion[sector] = pct(val / (M.total || 1));
      const result = await generarAgenda({ exposicion, total: Math.round(M.total), paisAr: pct(M.paisAr), cripto: pct(M.cripto) });
      setAgenda(result);
      resultados.push(`Agenda: ${result.eventos.length} eventos`);
    } catch (e) {
      resultados.push(`Agenda: error (${e instanceof Error ? e.message : String(e)})`);
    }

    setActualizandoTodo({ idx: 4, total: 5, label: 'Manuales' });
    try {
      if (posicionesManuales.length > 0) {
        const resumen = await analizarManuales({
          manuales: posicionesManuales.map(m => ({ id: m.id, ticker: m.ticker, nombre: m.nombre, cantidad: m.cantidad, valorUsd: m.valorUsd, fechaValuacion: m.fechaValuacion })),
        });
        setPosicionesManuales(await cargarPosicionesManuales());
        resultados.push(resumen);
      } else {
        resultados.push('Manuales: sin posiciones manuales');
      }
    } catch (e) {
      resultados.push(`Manuales: error (${e instanceof Error ? e.message : String(e)})`);
    }

    setActualizandoTodo({ idx: 5, total: 5, label: 'Sincronizar CAFCI' });
    const resultCafci = await handleSincronizarCafci();
    resultados.push(
      resultCafci
        ? `Sincronizar CAFCI: ${resultCafci.sincronizados}/${configCafci.fondos.length}${resultCafci.errores.length > 0 ? ` (${resultCafci.errores.length} con error)` : ''}`
        : 'Sincronizar CAFCI: falló'
    );

    setActualizandoTodo(null);
    setResultadoActualizarTodo(resultados);
  }

  async function handleGenerarSectorial() {
    if (generandoSectorial) return;
    setGenerandoSectorial(true);
    try {
      const result = await analizarSectorial({ bySector: M?.bySector ?? {}, byTipo: M?.byTipo ?? {}, paisAr: pct(M?.paisAr ?? 0), total: M?.total ?? 0 });
      setSectorial(result);
    } catch (e) {
      console.error('[generarSectorial]', e);
    } finally {
      setGenerandoSectorial(false);
    }
  }

  async function handleGenerarAgenda() {
    if (!M || generandoAgenda) return;
    setGenerandoAgenda(true);
    try {
      // Arma exposición por driver desde bySector normalizado a %
      const exposicion: Record<string, string> = {};
      for (const [sector, val] of Object.entries(M.bySector)) {
        exposicion[sector] = pct(val / (M.total || 1));
      }
      const result = await generarAgenda({ exposicion, total: Math.round(M.total), paisAr: pct(M.paisAr), cripto: pct(M.cripto) });
      setAgenda(result);
    } catch (e) {
      console.error('[generarAgenda]', e);
    } finally {
      setGenerandoAgenda(false);
    }
  }

  async function handleCrearDecision(nueva: NuevaDecision) {
    const d = await crearDecision(nueva);
    setDecisiones(prev => [d, ...prev]);
    setShowModalDecision(false);
  }

  async function handleAgregarRevision(decisionId: string, tipo: '30d' | '90d', notas: string, metricas: MetricasSnap) {
    const estadoNuevo: DecisionPatrimonio['estado'] = tipo === '90d' ? 'revisada90' : 'revisada30';
    const rev = await agregarRevision(decisionId, tipo, notas, metricas, estadoNuevo);
    setDecisiones(prev => prev.map(d =>
      d.id === decisionId ? { ...d, revisiones: [...d.revisiones, rev], estado: estadoNuevo } : d
    ));
    setShowModalRevision(null);
  }

  // F9.116 §3 — optimista: el input responde ya y el guardado va detrás. Si Firestore
  // rechaza, se avisa por el toast compartido y queda el valor en pantalla para reintentar.
  async function handleGuardarRiesgo(t: TopesRiesgo) {
    setTopesRiesgo(t);
    setRiesgoConfigurado(true);
    try {
      await guardarConfigRiesgo(t);
    } catch (e) {
      setToast({ texto: `No se pudo guardar la política de riesgo: ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
  }

  async function handleToggleIA(val: boolean) {
    const next = { habilitado: val };
    setConfigIA(next);
    await guardarConfigIA(next);
  }

  async function handleGenerarInforme(sinMontos = false) {
    if (!M || generandoInforme) return;
    setGenerandoInforme(true);
    try {
      const stressResults: StressResult[] = calcEscenarios(posiciones, posicionesManuales).map(r => ({
        nombre: r.nombre, perdidaUsd: r.perdidaUsd, perdidaPct: r.perdidaPct,
        totalResultante: r.totalFinal, total: r.total,
      }));
      const opcionResults: OpcionResult[] = OPCIONES_CONFIG.map(o => {
        const { liberadoUsd, movimientos, antes, despues, total } = simularOpcion(todasPosiciones, o);
        return { id: o.id, titulo: o.titulo, descripcion: o.descripcion, liberadoUsd, total, riesgos: o.riesgos, movimientos, antes, despues };
      });
      // F9.116 §5 — si el bloque de riesgo falla, el informe se genera igual sin esa parte.
      const riesgo = intentar(() => {
        const escenarios = calcEscenarios(posiciones, posicionesManuales);
        const titular = escenarios.find(e => e.id === ESCENARIO_TITULAR);
        if (!titular) return null;
        const b = calcBrecha(titular.perdidaPct, topesRiesgo.toleranciaCaidaPct);
        return {
          toleranciaPct: topesRiesgo.toleranciaCaidaPct,
          perdidaTitularPct: titular.perdidaPct,
          perdidaTitularUsd: titular.perdidaUsd,
          nombreTitular: titular.nombre,
          cumple: b.cumple,
          brechaPct: b.brechaPct,
          violaciones: violacionesBandas(posiciones, posicionesManuales, topesRiesgo),
        };
      }, 'riesgo del informe');

      const nuevo = await generarYArchivarInforme({
        posiciones, activosFijos, manuales: posicionesManuales,
        historial, tc, fechaCorrida, M,
        stressResults, opcionResults, riesgo,
        soloPorcentajes: sinMontos,
      });
      setInformes(prev => [nuevo, ...prev].slice(0, 5));
    } finally {
      setGenerandoInforme(false);
    }
  }
  const totalManualesUsd = posicionesManuales.reduce((s, m) => s + m.valorUsd, 0);

  const pendingReviewCount = decisiones.filter(d => revisionPendiente(d) !== null).length;

  const M = todasPosiciones.length > 0 ? calcMetrics(todasPosiciones) : null;
  // F9.196 H2a — pesos, riesgo y reserva sobre la cartera viva (el valor de HOY). Evolución,
  // Benchmark, informe IA, Plan, Optimización y decisiones siguen sobre la corrida (`M`).
  // Una cartera viva calculada sobre OTRA corrida (Juan ingirió una nueva y todavía no se recalculó)
  // no se usa: pesos y riesgo vuelven a la corrida hasta recalcular.
  const cvVigente = carteraViva && carteraViva.fechaCorrida === fechaCorrida ? carteraViva : null;
  const posicionesVivas = cvVigente ? posicionesDeCarteraViva(cvVigente, cvVigente.fechaCorrida) : null;
  const posicionesHoy = posicionesVivas && posicionesVivas.length ? posicionesVivas : posiciones;
  const todasHoy = [...posicionesHoy, ...posicionesManuales.map(manualToPosicion)];
  const Mhoy = todasHoy.length > 0 ? calcMetrics(todasHoy) : M;
  const identidadesHoy = new Set(todasHoy.map(p => `${p.ticker}|${p.tipo}|${p.pais_riesgo}`));
  const metricasJson: Record<string, unknown> = M
    ? { top1: M.top1, top3: M.top3, top5: M.top5, hhi: M.hhi, sectorTop: M.sectorTop,
        paisAr: M.paisAr, cripto: M.cripto, rvPct: M.rvPct, total: M.total, totalManualesUsd }
    : {};

  return (
    // F9.121 — base única de toda la vista: el portfolio invertible. No `patrimTotal`: la
    // pantalla ya muestra chips de % calculados sobre M.total (pesoEnCartera, pct(x/total)), y
    // con otra base el monto convertido y el chip de la misma fila darían dos números distintos.
    <BaseDineroCtx.Provider value={Mhoy?.total ?? M?.total ?? 0}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
          Portafolio
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* F9.121 — mismo patrón que Resumen/Inicio. El estado viene del PrivacidadProvider
              de AppShell: prenderlo en Inicio y venir acá tiene que llegar tapado. */}
          <button
            onClick={alternarPrivado}
            aria-label={privado ? 'Mostrar montos' : 'Ocultar montos'}
            title={privado ? 'Mostrar montos' : 'Ocultar montos'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 999,
              border: 'none', cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 12, fontWeight: 700,
              background: privado ? 'var(--gf-ink)' : 'var(--gf-gray-200)',
              color: privado ? '#fff' : 'var(--color-text-sec)', transition: '.15s',
            }}
          >
            <Icon name={privado ? 'eye-off' : 'eye'} size={13} color={privado ? '#fff' : 'var(--color-text-sec)'} />
            %
          </button>
          <button
            onClick={() => setShowIngesta(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)', color: 'var(--color-text)' }}
          >
            <Icon name="upload" size={13} color="var(--color-text-sec)" /> Actualizar posiciones
          </button>
          <button
            onClick={() => setShowBalanz(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)', color: 'var(--color-text)' }}
          >
            <Icon name="file-up" size={13} color="var(--color-text-sec)" /> Actualizar Balanz
          </button>
        </div>
      </div>

      {/* F9.121 — la base declarada, una sola vez para toda la vista: un % sin base es ruido. */}
      {privado && <BasePrivacidad texto="% del portfolio invertible" />}

      {/* Segmentado de solapas */}
      <div style={{ display: 'flex', gap: 3, background: 'var(--gf-gray-100)', borderRadius: 11, padding: 3 }}>
        {TABS.map(([id, label]) => {
          const on = tab === id;
          return (
            <button key={id} onClick={() => setTab(id)} style={{
              flex: id === 'config' ? 'none' : 1,
              padding: id === 'config' ? '8px 10px' : '8px 4px',
              borderRadius: 9, border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-base)', fontSize: 11, fontWeight: on ? 700 : 600,
              background: on ? 'var(--color-surface)' : 'transparent',
              color: on ? 'var(--color-text)' : 'var(--color-text-sec)',
              boxShadow: on ? 'var(--shadow-sm)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {id === 'config'
                ? <Icon name="settings-2" size={15} color={on ? 'var(--color-text)' : 'var(--color-text-sec)'} />
                : id === 'plan' && pendingReviewCount > 0
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {label}
                      <span style={{ width: 6, height: 6, borderRadius: 999, background: '#f59e0b', flexShrink: 0 }} />
                    </span>
                  : label}
            </button>
          );
        })}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-sec)', fontSize: 13 }}>
          Cargando portafolio…
        </div>
      )}

      {!loading && posiciones.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Sin corrida vigente</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-sec)', marginBottom: 20 }}>
            Subí el archivo .txt de posiciones para cargar el portafolio.
          </div>
          <button onClick={() => setShowIngesta(true)} style={{ padding: '12px 24px', borderRadius: 12, border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
            Actualizar posiciones
          </button>
        </div>
      )}

      {!loading && M && (
        <>
          {tab === 'resumen' && (
            <ResumenTab
              indicadores={indicadores} identidadesHoy={identidadesHoy}
              onAbrirFicha={ident => { setFichaAbierta(ident); setTab('tenencias'); }}
              M={M} Mhoy={Mhoy ?? M} carteraViva={cvVigente} carteraVivaVieja={!!carteraViva && !cvVigente ? carteraViva.fechaCorrida : null} posicionesCorrida={posiciones}
              onCarteraViva={() => { cargarCarteraViva().then(setCarteraViva).catch(() => setCarteraViva(null)); }}
              tc={tc} fechaCorrida={fechaCorrida}
              activosFijos={activosFijos}
              historial={historial}
              flujos={flujos}
              informes={informes}
              generandoInforme={generandoInforme}
              onGenerarInforme={handleGenerarInforme}
              onToast={(texto, error) => setToast({ texto, error })}
              posiciones={posicionesHoy}
              manuales={posicionesManuales}
              topesRiesgo={topesRiesgo}
              riesgoConfigurado={riesgoConfigurado}
              factores={factores}
            />
          )}
          {tab === 'tenencias' && (
            <TenenciasTab
              M={Mhoy ?? M} posiciones={posicionesHoy} manuales={posicionesManuales} fechaCorrida={fechaCorrida}
              fichaAbierta={fichaAbierta} onFichaConsumida={() => setFichaAbierta(null)}
              tcHoy={carteraViva?.tc?.valor ?? null}
              tesisMap={tesisMap} onTesisGuardada={d => setTesisMap(prev => ({ ...prev, [d.ticker]: d }))}
              indicadores={indicadores}
              analisisCache={analisisCache}
              configIA={configIA}
              onAnalizar={handleAnalizarPosicion}
              agenda={agenda}
              sectorial={sectorial}
              onAbrirChat={(ticker, contexto) => {
                const onDone = () => {
                  cargarAnalisisPosicion(ticker).then(a => {
                    if (a) setAnalisisCache(prev => ({ ...prev, [ticker]: a }));
                  });
                };
                setModalPromptChat({ modo: 'posicion', ticker, contexto, onDone });
              }}
            />
          )}
          {tab === 'riesgo'    && <RiesgoTab M={Mhoy ?? M} posiciones={todasHoy} />}
          {tab === 'benchmark' && (
            <BenchmarkTab posiciones={todasPosiciones} carteras={cafciCarteras} mappings={cafciMappings} universo={universoCafci} />
          )}
          {tab === 'plan' && (
            <PlanTab
              M={M} posiciones={todasPosiciones}
              decisiones={decisiones}
              onRegistrarLibre={() => { setPreloadDecision(null); setShowModalDecision(true); }}
              onRegistrarDesdeOpcion={(opcionId, tickers) => { setPreloadDecision({ opcionReferencia: opcionId, tickers }); setShowModalDecision(true); }}
              onIniciarRevision={(decision, tipo) => setShowModalRevision({ decision, tipo })}
            />
          )}
          {tab === 'optimizacion' && (
            <OptimizacionTab
              posiciones={todasPosiciones}
              resultado={optimizacion}
              calculando={calculandoOptimizacion}
              error={errorOptimizacion}
              avisoGuardado={avisoGuardadoOptim}
              onCalcular={async (semanas, pesoMax) => {
                setCalculandoOptimizacion(true);
                setErrorOptimizacion(null);
                setAvisoGuardadoOptim(null);
                try {
                  // Derivar símbolos y pesos actuales
                  const sym = todasPosiciones
                    .filter(p => ['accion', 'cedear', 'cripto'].includes(p.tipo))
                    .map(p => toYahooTicker(p.ticker, p.tipo, p.pais_riesgo, p.moneda_origen));
                  const totalUsd = todasPosiciones.reduce((s, p) => s + p.valorUsd, 0) || 1;
                  const pesosActuales: Record<string, number> = {};
                  for (const p of todasPosiciones.filter(p => ['accion','cedear','cripto'].includes(p.tipo))) {
                    const sym2 = toYahooTicker(p.ticker, p.tipo, p.pais_riesgo, p.moneda_origen);
                    pesosActuales[sym2] = (pesosActuales[sym2] ?? 0) + (p.valorUsd / totalUsd);
                  }
                  const uniqueSym = [...new Set(sym)];

                  const { series: rawSeries, faltantes } = await obtenerSeriesPrecios(uniqueSym, semanas);

                  // Dolarizar series ARS usando tcDiario
                  const MIN_OBS = 40;
                  const seriesDolar: Record<string, PuntoPrecio[]> = {};
                  const excluidos: string[] = [...faltantes];

                  // Calcular rango de fechas necesario
                  const hasta = new Date().toISOString().slice(0, 10);
                  const desde = new Date(Date.now() - semanas * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
                  let tcByDate: Record<string, number> = {};

                  const tieneARS = Object.values(rawSeries).some(s => s.moneda === 'ARS');
                  if (tieneARS) {
                    tcByDate = await cargarTCRango(desde, hasta);
                  }

                  // F9.102 4b — diagnóstico end-to-end: faltantes de la CF (sin_datos_yahoo) y
                  // exclusiones por TC insuficiente al dolarizar (tc_insuficiente) se arman acá;
                  // el resto (ok/serie_corta/recorta_interseccion) sale de alinearSeries.
                  const diagnosticoPrevio: Record<string, DiagnosticoSerie> = {};
                  for (const s of faltantes) diagnosticoPrevio[s] = { puntosCrudos: 0, semanasAlineadas: 0, motivo: 'sin_datos_yahoo' };

                  for (const [s, serie] of Object.entries(rawSeries)) {
                    if (serie.moneda === 'USD') {
                      seriesDolar[s] = serie.puntos;
                    } else {
                      const { puntos: dolarizados, excluir } = dolarizarSerie(serie.puntos, tcByDate, MIN_OBS);
                      if (excluir) {
                        excluidos.push(s);
                        diagnosticoPrevio[s] = { puntosCrudos: serie.puntos.length, puntosDolarizados: dolarizados.length, semanasAlineadas: 0, motivo: 'tc_insuficiente' };
                      } else {
                        seriesDolar[s] = dolarizados;
                      }
                    }
                  }

                  const resultado = calcularOptimizacion(seriesDolar, pesosActuales, semanas, pesoMax, MIN_OBS);
                  resultado.sinSerieSuficiente = [...new Set([...resultado.sinSerieSuficiente, ...excluidos])];
                  resultado.diagnostico = { ...diagnosticoPrevio, ...resultado.diagnostico };

                  // F9.102.1 1b — mostrar el resultado YA, antes de intentar persistir: un
                  // error de guardado no debe tirar a la basura un cálculo que tardó varios
                  // segundos (fetch de series + cómputo).
                  setOptimizacion(resultado);
                  try {
                    await guardarOptimizacion(resultado);
                  } catch (eGuardado) {
                    setAvisoGuardadoOptim(
                      `No se pudo guardar, resultado no persistido: ${eGuardado instanceof Error ? eGuardado.message : String(eGuardado)}`
                    );
                  }
                } catch (e) {
                  setErrorOptimizacion(e instanceof Error ? e.message : String(e));
                } finally {
                  setCalculandoOptimizacion(false);
                }
              }}
            />
          )}
          {tab === 'research'  && (
            <ResearchTab
              M={M}
              configIA={configIA}
              sectorial={sectorial}
              generandoSectorial={generandoSectorial}
              analizandoLote={analizandoLote}
              loteProgreso={loteProgreso}
              onGenerarSectorial={handleGenerarSectorial}
              onAnalizarLote={handleAnalizarLote}
              onChatLote={handleAbrirChatLote}
              analisisCache={analisisCache}
              agenda={agenda}
              generandoAgenda={generandoAgenda}
              onGenerarAgenda={handleGenerarAgenda}
              onAbrirChat={(modo, ticker, contexto) => {
                const onDone = () => {
                  if (modo === 'sectorial') cargarUltimoSectorial().then(setSectorial);
                  if (modo === 'agenda') cargarUltimaAgenda().then(setAgenda);
                  if (modo === 'posicion' && ticker) {
                    cargarAnalisisPosicion(ticker).then(a => {
                      if (a) setAnalisisCache(prev => ({ ...prev, [ticker]: a }));
                    });
                  }
                };
                setModalPromptChat({ modo, ticker, contexto, onDone });
              }}
              onActualizarTodoChat={handleAbrirChatCompleto}
              onActualizarTodoApi={handleActualizarTodoApi}
              actualizandoTodo={actualizandoTodo}
              resultadoActualizarTodo={resultadoActualizarTodo}
              global={analisisGlobal}
            />
          )}
          {tab === 'config' && (
            <ConfigTab
              onFlujosAplicados={() => {
                cargarFlujos().then(setFlujos).catch(e => console.warn('[flujos]', e));
                cargarCarteraViva().then(setCarteraViva).catch(e => console.warn('[carteraViva]', e));
              }}
              activosFijos={activosFijos}
              manuales={posicionesManuales}
              configIA={configIA}
              fechaCorrida={fechaCorrida}
              flujos={flujos}
              configCafci={configCafci}
              cafciCarteras={cafciCarteras}
              sincronizandoCafci={sincronizandoCafci}
              topesRiesgo={topesRiesgo}
              riesgoConfigurado={riesgoConfigurado}
              onGuardarRiesgo={handleGuardarRiesgo}
              onToast={(texto, error) => setToast({ texto, error })}
              onEditFijo={af => { setEditFijo(af); setShowModalFijo(true); }}
              onAddFijo={() => { setEditFijo(null); setShowModalFijo(true); }}
              onEditManual={pm => { setEditManual(pm); setShowModalManual(true); }}
              onAddManual={() => { setEditManual(null); setShowModalManual(true); }}
              onToggleIA={handleToggleIA}
              onAddFlujo={() => { setEditFlujo(null); setShowModalFlujo(true); }}
              onEditFlujo={f => { setEditFlujo(f); setShowModalFlujo(true); }}
              onSincronizarCafci={handleSincronizarCafci}
              onGuardarConfigCafci={handleGuardarConfigCafci}
              onImportarFondosCafci={handleImportarFondosCafci}
              onImportarMappingCafci={handleImportarMappingCafci}
              onImportarFactores={handleImportarFactores}
              onImportarCafciManual={handleImportarCafciManual}
            />
          )}
        </>
      )}

      <div style={{ height: 4 }} />

      {showIngesta && (
        <PatrimonioIngesta
          posicionesPrevias={posiciones}
          activosFijos={activosFijos}
          totalManualesUsd={totalManualesUsd}
          metricasJson={metricasJson}
          onConfirmado={() => { setShowIngesta(false); cargar(); setToastIngestaOk(true); recalcularYRecargarCarteraViva(); }}
          onClose={() => setShowIngesta(false)}
        />
      )}

      {showBalanz && (
        <PatrimonioBalanz
          posicionesCorrida={posiciones}
          indicadores={indicadores}
          tc={tc}
          mep={carteraViva?.tc ?? null}
          fechaCorrida={fechaCorrida}
          onGuardado={texto => { setShowBalanz(false); setToast({ texto, error: false }); recalcularYRecargarCarteraViva(); }}
          onClose={() => setShowBalanz(false)}
        />
      )}

      {/* F9.101 — CTA post-ingesta: navega a Research con la card de actualización integral */}
      {toastIngestaOk && (
        <div style={{ position: 'fixed', left: 12, right: 12, bottom: 84, zIndex: 60, maxWidth: 480, margin: '0 auto', background: 'var(--gf-ink)', color: '#fff', borderRadius: 14, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10, boxShadow: 'var(--shadow-card)' }}>
          <Icon name="check" size={16} color="var(--gf-emerald-line, #0a7d5e)" style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>Corrida actualizada</div>
            <button
              onClick={() => { setTab('research'); setToastIngestaOk(false); }}
              style={{ marginTop: 6, background: 'rgba(255,255,255,.16)', border: 'none', borderRadius: 8, padding: '7px 10px', color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}
            >
              Actualizar análisis con la cartera nueva →
            </button>
          </div>
          <button onClick={() => setToastIngestaOk(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0 }}>
            <Icon name="x" size={15} color="#fff" />
          </button>
        </div>
      )}

      {/* F9.102 3b — toast mínimo de resultado (éxito o error). F9.115 — lo comparten
          "Sincronizar CAFCI" y las descargas de corrida/dossier. */}
      {toast && (
        <div style={{ position: 'fixed', left: 12, right: 12, bottom: 84, zIndex: 60, maxWidth: 480, margin: '0 auto', background: 'var(--gf-ink)', color: '#fff', borderRadius: 14, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10, boxShadow: 'var(--shadow-card)' }}>
          <Icon name={toast.error ? 'triangle-alert' : 'check'} size={16} color={toast.error ? '#fca5a5' : 'var(--gf-emerald-line, #0a7d5e)'} style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.4 }}>{toast.texto}</div>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0 }}>
            <Icon name="x" size={15} color="#fff" />
          </button>
        </div>
      )}

      {showModalFijo && (
        <ModalActivoFijo
          af={editFijo}
          onGuardar={handleGuardarFijo}
          onEliminar={editFijo ? handleEliminarFijo : undefined}
          onClose={() => setShowModalFijo(false)}
        />
      )}

      {showModalManual && (
        <ModalPosicionManual
          pm={editManual}
          onGuardar={handleGuardarManual}
          onEliminar={editManual ? handleEliminarManual : undefined}
          onClose={() => setShowModalManual(false)}
        />
      )}

      {showModalFlujo && (
        <ModalFlujo
          flujo={editFlujo}
          onGuardar={handleGuardarFlujo}
          onEliminar={editFlujo ? () => handleEliminarFlujo(editFlujo.id) : undefined}
          onClose={() => setShowModalFlujo(false)}
        />
      )}

      {showModalDecision && M && (
        <ModalRegistrarDecision
          preload={preloadDecision}
          metricasActuales={buildMetricasSnap(M, todasPosiciones)}
          onGuardar={handleCrearDecision}
          onClose={() => setShowModalDecision(false)}
        />
      )}

      {showModalRevision && M && (
        <ModalRevision
          decision={showModalRevision.decision}
          tipo={showModalRevision.tipo}
          metricasActuales={buildMetricasSnap(M, todasPosiciones)}
          onGuardar={(notas, metricas) =>
            handleAgregarRevision(showModalRevision.decision.id, showModalRevision.tipo, notas, metricas)
          }
          onClose={() => setShowModalRevision(null)}
        />
      )}

      {modalPromptChat && (
        <ModalPromptChat
          modo={modalPromptChat.modo}
          ticker={modalPromptChat.ticker}
          contexto={modalPromptChat.contexto}
          onDone={() => {
            modalPromptChat.onDone(); setModalPromptChat(null);
            // F9.196 H6 — la importación pudo traer tesis nuevas: que la ficha no edite sobre una copia vieja.
            cargarTodasLasTesis().then(setTesisMap).catch(e => console.warn('[tesis]', e));
          }}
          onClose={() => setModalPromptChat(null)}
        />
      )}
    </div>
    </BaseDineroCtx.Provider>
  );
}
