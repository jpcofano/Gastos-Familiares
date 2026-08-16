// F9.141 — orquestación de la actualización de precios: qué tickers, en qué orden, qué se
// escribe. Un solo escritor con dos entradas: el cron `actualizarPreciosDiarios` (index.ts) y
// el backfill inicial (scripts/backfillPreciosF9141.ts). No duplicar esto en ninguna de las dos.
//
// El motor (routing, splits, indicadores) está en ./patrimonioPrecios.
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import * as PP from './patrimonioPrecios';

export type ObjetivoPrecio = {
  ticker: string;
  tipo: PP.PosicionTipo;
  paisRiesgo: PP.PaisRiesgo;
  valorUsd: number;
  vigente: boolean;
  observaciones: Array<{ fecha: string; cantidad: number; valorOrigen: number }>;
};

export type ResultadoTicker = {
  ticker: string;
  cobertura: 'con_serie' | 'solo_live' | 'sin_fuente';
  estadoSerie: PP.EstadoSerie;
  puntos: number;
  saltosPendientes: number;
  splitsAplicados: number;
  motivo: string | null;
};

export type Resumen = {
  fechaCorrida: string | null;
  objetivos: number;
  resultados: ResultadoTicker[];
  fallos: Array<{ ticker: string; error: string }>;
  escrito: boolean;
};

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));
const PAUSA_MS = 600;  // data912 limita a 120 req/min: serial con pausa, nunca en paralelo

/** Universo de tickers: la corrida vigente más las posiciones manuales. */
export async function objetivosDePrecio(
  db: Firestore,
): Promise<{ objetivos: ObjetivoPrecio[]; totalUsd: number; fechaCorrida: string | null }> {
  const snapQ = await db.collection('snapshotsPortafolio')
    .orderBy('fechaCorrida', 'desc').limit(1).get();
  if (snapQ.empty) return { objetivos: [], totalUsd: 0, fechaCorrida: null };
  const fechaVigente = snapQ.docs[0].data().fechaCorrida as string;

  // Todas las corridas, no solo la vigente: la capa 2 del detector compara `cantidad`
  // entre corridas para probar un split con dato propio.
  const posSnap = await db.collection('posicionesPatrimonio').get();
  const porTicker = new Map<string, ObjetivoPrecio>();

  for (const doc of posSnap.docs) {
    const p = doc.data() as {
      ticker?: string; tipo?: PP.PosicionTipo; pais_riesgo?: PP.PaisRiesgo;
      valorUsd?: number; cantidad?: number | null; valor_origen?: number; fechaCorrida?: string;
    };
    if (!p.ticker || !p.tipo) continue;

    const entrada = porTicker.get(p.ticker) ?? {
      ticker: p.ticker, tipo: p.tipo, paisRiesgo: p.pais_riesgo ?? 'AR',
      valorUsd: 0, vigente: false, observaciones: [],
    };
    if (p.fechaCorrida === fechaVigente) {
      entrada.valorUsd += p.valorUsd ?? 0;
      entrada.vigente = true;
    }
    if (p.fechaCorrida && typeof p.cantidad === 'number' && typeof p.valor_origen === 'number') {
      entrada.observaciones.push({
        fecha: p.fechaCorrida, cantidad: p.cantidad, valorOrigen: p.valor_origen,
      });
    }
    porTicker.set(p.ticker, entrada);
  }

  const manSnap = await db.collection('posicionesManuales').get();
  for (const doc of manSnap.docs) {
    const m = doc.data() as {
      ticker?: string; tipo?: PP.PosicionTipo; pais_riesgo?: PP.PaisRiesgo; valorUsd?: number;
    };
    if (!m.ticker) continue;
    const entrada = porTicker.get(m.ticker) ?? {
      ticker: m.ticker, tipo: m.tipo ?? 'accion', paisRiesgo: m.pais_riesgo ?? 'global',
      valorUsd: 0, vigente: false, observaciones: [],
    };
    entrada.valorUsd += m.valorUsd ?? 0;
    entrada.vigente = true;
    porTicker.set(m.ticker, entrada);
  }

  // Se actualiza lo que se tiene HOY. Las corridas viejas aportan `observaciones` para la
  // capa 2 del detector, pero un ticker que ya no está en cartera no genera documento.
  const objetivos = [...porTicker.values()].filter(o => o.vigente);
  return {
    objetivos,
    totalUsd: objetivos.reduce((a, o) => a + o.valorUsd, 0),
    fechaCorrida: fechaVigente,
  };
}

/** Un panel live se baja UNA vez por corrida, no una vez por ticker. */
async function bajarPanelesLive(
  paneles: Set<PP.PanelLive>,
): Promise<Map<PP.PanelLive, Map<string, number>>> {
  const out = new Map<PP.PanelLive, Map<string, number>>();
  for (const panel of paneles) {
    try {
      const { status, body } = await PP.pedir(PP.urlLive(panel));
      if (!Array.isArray(body)) {
        // Status y cuerpo tal como llegan, sin interpretar la causa (lección de CAFCI).
        console.error(`[precios] live/${panel} HTTP ${status} cuerpo=${JSON.stringify(body).slice(0, 200)}`);
        continue;
      }
      const m = new Map<string, number>();
      for (const fila of body as Array<{ symbol?: unknown; c?: unknown }>) {
        const c = Number(fila.c);
        // Valuación siempre por `c`, nunca el punto medio de las puntas: GLOB llegó a tener
        // 25% de spread entre px_bid y px_ask.
        if (typeof fila.symbol === 'string' && Number.isFinite(c) && c > 0) m.set(fila.symbol, c);
      }
      out.set(panel, m);
      console.log(`[precios] live/${panel} → ${m.size} símbolos`);
    } catch (e) {
      console.error(`[precios] live/${panel} falló:`, e);
    }
    await dormir(PAUSA_MS);
  }
  return out;
}

/**
 * TC más reciente, leyendo por id exacto y caminando hacia atrás. Sin `orderBy` sobre el id:
 * esa consulta pide un índice compuesto que el proyecto no tiene (es el mismo tropiezo de
 * F9.113). Diez lecturas puntuales cuestan menos que un índice nuevo para una sola llamada.
 */
async function tcHoyAdmin(db: Firestore, diasAtras = 10): Promise<number | null> {
  const hoy = new Date();
  for (let i = 0; i < diasAtras; i++) {
    const d = new Date(hoy.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const snap = await db.collection('tcDiario').doc(d).get();
    const tc = snap.data()?.tcUsdArs as unknown;
    if (typeof tc === 'number' && tc > 0) return tc;
  }
  return null;
}

/**
 * @param escribir false = corrida en seco: calcula y reporta exactamente lo mismo, sin tocar
 *                 Firestore. Es lo que permite ver el resultado antes del primer deploy.
 */
export async function correrActualizacionPrecios(
  db: Firestore,
  { escribir }: { escribir: boolean },
): Promise<Resumen> {
  const { objetivos, totalUsd, fechaCorrida } = await objetivosDePrecio(db);
  if (!objetivos.length) {
    console.warn('[precios] sin corrida vigente, no hay nada que actualizar');
    return { fechaCorrida, objetivos: 0, resultados: [], fallos: [], escrito: escribir };
  }

  const panelesLive = new Set<PP.PanelLive>();
  for (const o of objetivos) {
    const spec = PP.panelesPara(o.tipo, o.paisRiesgo);
    if (spec) panelesLive.add(spec.live);
  }
  const live = await bajarPanelesLive(panelesLive);
  const tcHoy = await tcHoyAdmin(db);

  const resultados: ResultadoTicker[] = [];
  const fallos: Array<{ ticker: string; error: string }> = [];

  for (const o of objetivos) {
    try {
      const r = await actualizarUnTicker(db, o, live, totalUsd, tcHoy, escribir);
      resultados.push(r);
      if (r.cobertura === 'con_serie' || r.motivo === 'fuente_sin_serie') await dormir(PAUSA_MS);
    } catch (e) {
      // Fallo de un ticker no aborta el resto.
      fallos.push({ ticker: o.ticker, error: String(e) });
      console.error(`[precios] ${o.ticker} falló, se sigue con el resto:`, e);
    }
  }

  return { fechaCorrida, objetivos: objetivos.length, resultados, fallos, escrito: escribir };
}

async function actualizarUnTicker(
  db: Firestore,
  o: ObjetivoPrecio,
  live: Map<PP.PanelLive, Map<string, number>>,
  totalUsd: number,
  tcHoy: number | null,
  escribir: boolean,
): Promise<ResultadoTicker> {
  const refPrecios = db.collection('preciosDiarios').doc(o.ticker);
  const refInd = db.collection('indicadoresPosicion').doc(o.ticker);
  const spec = PP.panelesPara(o.tipo, o.paisRiesgo);
  const simbolo = PP.simboloDePanel(o.ticker);

  const base = {
    ticker: o.ticker, tipo: o.tipo, paisRiesgo: o.paisRiesgo,
    actualizadoEn: FieldValue.serverTimestamp(),
  };
  const guardar = async (precios: object, indicadores: object) => {
    if (!escribir) return;
    await refPrecios.set({ ...base, ...precios }, { merge: true });
    await refInd.set({ ...base, ...indicadores }, { merge: true });
  };
  const sinDatos = {
    peso: 'sin_datos', drawdown: 'sin_datos', volatilidad: 'sin_datos', liquidez: 'sin_datos',
  } as Record<string, PP.Semaforo>;

  // Sin panel para el tipo: cripto, fci y cash. BTC entra por acá — no se consulta ningún
  // panel, aunque exista un ticker BTC listado en usa_stocks.
  if (!spec) {
    await guardar(
      {
        panelLive: null, panelHistorico: null, monedaSerie: null, fuente: null,
        cobertura: 'sin_fuente', estadoSerie: 'sin_serie', puntos: 0,
        primeraFecha: null, ultimaFecha: null, precioLive: null,
        splitsAplicados: [], saltosDetectados: [], serie: [],
      },
      { estadoSerie: 'sin_serie', motivo: 'sin_fuente', puntosDisponibles: 0, semaforos: sinDatos },
    );
    return {
      ticker: o.ticker, cobertura: 'sin_fuente', estadoSerie: 'sin_serie',
      puntos: 0, saltosPendientes: 0, splitsAplicados: 0, motivo: 'sin_fuente',
    };
  }

  const monedaSerie = spec.live === 'usa_stocks' ? 'USD' : 'ARS';
  // Si el panel entero no se pudo bajar, `precioLive` no se escribe: con merge, el último
  // precio bueno sobrevive. Escribir null acá sería vaciar por una caída de la fuente.
  const panelBajado = live.has(spec.live);
  const precioLive = panelBajado ? (live.get(spec.live)!.get(simbolo) ?? null) : null;
  const campoPrecioLive = panelBajado ? { precioLive } : {};

  // Sin endpoint histórico para el tipo (ON: /historical/corp/ da 404).
  if (!spec.historical) {
    await guardar(
      {
        panelLive: spec.live, panelHistorico: null, monedaSerie,
        fuente: `data912:live/${spec.live}`, cobertura: 'solo_live',
        estadoSerie: 'sin_serie', puntos: 0, primeraFecha: null, ultimaFecha: null,
        ...campoPrecioLive, splitsAplicados: [], saltosDetectados: [], serie: [],
      },
      {
        estadoSerie: 'sin_serie', motivo: 'sin_historico', precio: precioLive, monedaSerie,
        puntosDisponibles: 0, semaforos: sinDatos,
      },
    );
    return {
      ticker: o.ticker, cobertura: 'solo_live', estadoSerie: 'sin_serie',
      puntos: 0, saltosPendientes: 0, splitsAplicados: 0, motivo: 'sin_historico',
    };
  }

  const { status, body } = await PP.pedir(PP.urlHistorico(spec.historical, simbolo));
  const serieCruda = PP.parseSerie(body);

  if (!serieCruda) {
    console.warn(`[precios] ${o.ticker} sin serie · HTTP ${status} · ${JSON.stringify(body).slice(0, 160)}`);
    const previo = await refPrecios.get();
    const teniaSerie = ((previo.data()?.serie as unknown[]) ?? []).length > 0;

    // NUNCA pisar una serie que ya tenía datos: la fuente no tiene SLA y una caída no debe
    // vaciar la base.
    if (PP.decidirEscritura(serieCruda, teniaSerie) === 'conservar') {
      if (escribir) await refPrecios.set({ ...base, ...campoPrecioLive, ultimoIntentoFallido: status }, { merge: true });
      const d = previo.data() ?? {};
      return {
        ticker: o.ticker, cobertura: 'con_serie', estadoSerie: (d.estadoSerie as PP.EstadoSerie) ?? 'limpia',
        puntos: (d.puntos as number) ?? 0, saltosPendientes: 0, splitsAplicados: 0,
        motivo: 'conservado_por_fallo',
      };
    }

    await guardar(
      {
        panelLive: spec.live, panelHistorico: spec.historical, monedaSerie,
        fuente: `data912:live/${spec.live}`, cobertura: 'solo_live',
        estadoSerie: 'sin_serie', puntos: 0, primeraFecha: null, ultimaFecha: null,
        ...campoPrecioLive, splitsAplicados: [], saltosDetectados: [], serie: [],
      },
      {
        estadoSerie: 'sin_serie', motivo: 'fuente_sin_serie', precio: precioLive, monedaSerie,
        puntosDisponibles: 0, semaforos: sinDatos,
      },
    );
    return {
      ticker: o.ticker, cobertura: 'solo_live', estadoSerie: 'sin_serie',
      puntos: 0, saltosPendientes: 0, splitsAplicados: 0, motivo: 'fuente_sin_serie',
    };
  }

  // Capa 1 (tabla curada) + capa 2 (cantidad entre corridas). Las únicas que reescalan.
  const deTabla = (PP.SPLITS_CONFIRMADOS[o.ticker] ?? [])
    .map(s => ({ ...s, origen: 'tabla' as const }));
  const deCantidad = PP.splitsPorCantidad(o.observaciones, serieCruda)
    .filter(s => !deTabla.some(t => t.fecha === s.fecha))
    .map(s => ({ ...s, origen: 'cantidad' as const }));

  const { serie: ajustada, aplicados } = PP.aplicarSplits(serieCruda, [...deTabla, ...deCantidad]);
  const serie = PP.recortarTope(ajustada);

  // Capa 3: SOLO REPORTE. Lo que quedó sin explicar por 1 y 2 marca la serie, no la toca.
  const explicadas = new Set(aplicados.map(s => s.fecha));
  const saltos = PP.detectarSaltos(serie).filter(s => !explicadas.has(s.fecha));
  const { util, estado } = PP.recortarPorEstado(serie, saltos, aplicados.length > 0);

  const ind = PP.calcIndicadores(util);
  const peso = totalUsd > 0 ? o.valorUsd / totalUsd : null;
  const ruedas = ruedasParaSalir(o.valorUsd, ind.montoOperadoProm30d, monedaSerie, tcHoy);

  await guardar(
    {
      panelLive: spec.live, panelHistorico: spec.historical, monedaSerie,
      fuente: `data912:historical/${spec.historical}`, cobertura: 'con_serie',
      estadoSerie: estado, puntos: serie.length,
      primeraFecha: serie[0].f, ultimaFecha: serie[serie.length - 1].f,
      ...campoPrecioLive, splitsAplicados: aplicados, saltosDetectados: saltos,
      ultimoIntentoFallido: FieldValue.delete(),
      serie,
    },
    {
      calculadoEnISO: new Date().toISOString(),
      estadoSerie: estado, monedaSerie, motivo: null,
      pesoEnCartera: peso, ruedasParaSalir: ruedas,
      ...ind,
      semaforos: PP.calcSemaforos(ind, PP.claseUmbral(o.tipo, o.paisRiesgo), peso, ruedas),
    },
  );

  return {
    ticker: o.ticker, cobertura: 'con_serie', estadoSerie: estado,
    puntos: ind.puntosDisponibles, saltosPendientes: saltos.length,
    splitsAplicados: aplicados.length, motivo: null,
  };
}

/** Ruedas necesarias para liquidar la posición al monto operado promedio. */
function ruedasParaSalir(
  valorUsd: number, montoProm30d: number | null, moneda: 'ARS' | 'USD', tcHoy: number | null,
): number | null {
  if (!montoProm30d || montoProm30d <= 0 || valorUsd <= 0) return null;
  if (moneda === 'USD') return valorUsd / montoProm30d;
  if (!tcHoy || tcHoy <= 0) return null;  // sin TC no se inventa la conversión
  return (valorUsd * tcHoy) / montoProm30d;
}
