// F9.141 — orquestación de la actualización de precios: qué tickers, en qué orden, qué se
// escribe. Un solo escritor con dos entradas: el cron `actualizarPreciosDiarios` (index.ts) y
// el backfill inicial (scripts/backfillPreciosF9141.ts). No duplicar esto en ninguna de las dos.
//
// El motor (routing, splits, indicadores) está en ./patrimonioPrecios.
import { FieldValue, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import * as PP from './patrimonioPrecios';
import * as RP from './preciosRespaldo';
import type { ClientePPI } from './ppiApi';
import { calcularTesis, normalizarTesis, senalesDeTesis, type DocTesis, type EstadoGatillo } from './compartido/tesis';
import { tcDelDia } from './carteraVivaCron';

export type ObjetivoPrecio = {
  ticker: string;
  tipo: PP.PosicionTipo;
  paisRiesgo: PP.PaisRiesgo;
  valorUsd: number;
  vigente: boolean;
  vigenteEnCorrida: boolean;   // F9.141.1 — desempata quién se queda con el ticker pelado
  docId: string;
  observaciones: Array<{ fecha: string; cantidad: number; valorOrigen: number }>;
  /** F9.196 §4 — fechas de corrida en que aparece la identidad (reinicio del trinquete). */
  corridas: string[];
};

export type ResultadoTicker = {
  ticker: string;
  docId: string;
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
  // F9.195 — posiciones manuales revaluadas con el precio live (cantidad × precio).
  manuales?: ResultadoManual[];
};

export type ResultadoManual = { id: string; ticker: string; precioUsd: number | null; valorUsd: number | null; motivo: string | null };

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));
const PAUSA_MS = 600;  // data912 limita a 120 req/min: serial con pausa, nunca en paralelo

/** Universo de tickers: la corrida vigente más las posiciones manuales. */
export async function objetivosDePrecio(
  db: Firestore,
): Promise<{
  objetivos: ObjetivoPrecio[]; totalUsd: number; fechaCorrida: string | null; fechasCorrida: string[];
}> {
  const snapQ = await db.collection('snapshotsPortafolio')
    .orderBy('fechaCorrida', 'desc').limit(1).get();
  if (snapQ.empty) return { objetivos: [], totalUsd: 0, fechaCorrida: null, fechasCorrida: [] };
  const fechaVigente = snapQ.docs[0].data().fechaCorrida as string;

  // Todas las corridas, no solo la vigente: la capa 2 del detector compara `cantidad`
  // entre corridas para probar un split con dato propio.
  const posSnap = await db.collection('posicionesPatrimonio').get();

  // F9.141.1 — la clave es la TRIPLETA, no el ticker. GLOB es a la vez un CEDEAR en ARS y una
  // acción global en USD: agruparlos por símbolo le colgaría al plan de empleado la serie del
  // CEDEAR, con el `tipo` y el `paisRiesgo` del primero que entró al mapa.
  const porIdentidad = new Map<string, ObjetivoPrecio>();
  const nuevo = (i: PP.Identidad): ObjetivoPrecio => ({
    ...i, valorUsd: 0, vigente: false, vigenteEnCorrida: false, docId: i.ticker, observaciones: [],
    corridas: [],
  });
  const fechasCorrida = new Set<string>();

  for (const doc of posSnap.docs) {
    const p = doc.data() as {
      ticker?: string; tipo?: PP.PosicionTipo; pais_riesgo?: PP.PaisRiesgo;
      valorUsd?: number; cantidad?: number | null; valor_origen?: number; fechaCorrida?: string;
    };
    if (!p.ticker || !p.tipo) continue;

    const id: PP.Identidad = { ticker: p.ticker, tipo: p.tipo, paisRiesgo: p.pais_riesgo ?? 'AR' };
    const clave = PP.claveIdentidad(id);
    const entrada = porIdentidad.get(clave) ?? nuevo(id);
    if (p.fechaCorrida) {
      fechasCorrida.add(p.fechaCorrida);
      if (!entrada.corridas.includes(p.fechaCorrida)) entrada.corridas.push(p.fechaCorrida);
    }
    if (p.fechaCorrida === fechaVigente) {
      entrada.valorUsd += p.valorUsd ?? 0;
      entrada.vigente = true;
      entrada.vigenteEnCorrida = true;
    }
    if (p.fechaCorrida && typeof p.cantidad === 'number' && typeof p.valor_origen === 'number') {
      entrada.observaciones.push({
        fecha: p.fechaCorrida, cantidad: p.cantidad, valorOrigen: p.valor_origen,
      });
    }
    porIdentidad.set(clave, entrada);
  }

  const manSnap = await db.collection('posicionesManuales').get();
  for (const doc of manSnap.docs) {
    const m = doc.data() as {
      ticker?: string; tipo?: PP.PosicionTipo; pais_riesgo?: PP.PaisRiesgo; valorUsd?: number;
    };
    if (!m.ticker) continue;
    const id: PP.Identidad = {
      ticker: m.ticker, tipo: m.tipo ?? 'accion', paisRiesgo: m.pais_riesgo ?? 'global',
    };
    const clave = PP.claveIdentidad(id);
    const entrada = porIdentidad.get(clave) ?? nuevo(id);
    entrada.valorUsd += m.valorUsd ?? 0;
    entrada.vigente = true;
    porIdentidad.set(clave, entrada);
  }

  // Se actualiza lo que se tiene HOY. Las corridas viejas aportan `observaciones` para la
  // capa 2 del detector, pero un ticker que ya no está en cartera no genera documento.
  const objetivos = [...porIdentidad.values()].filter(o => o.vigente);

  // La ambigüedad es propiedad del conjunto: recién con todos a la vista se sabe si un ticker
  // necesita sufijo. Se resuelve una sola vez, después del filtro.
  const ids = PP.resolverIds(objetivos);
  for (const o of objetivos) o.docId = ids.get(PP.claveIdentidad(o)) ?? o.ticker;
  return {
    objetivos,
    totalUsd: objetivos.reduce((a, o) => a + o.valorUsd, 0),
    fechaCorrida: fechaVigente,
    fechasCorrida: [...fechasCorrida].sort(),
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
 * F9.148 §4 — serie de TC con FECHA DE MERCADO, que es lo que hace falta para convertir un
 * precio de cierre.
 *
 * `tcDiario` NO está indexado por fecha de mercado: el cron `actualizarTCDiario` corre a las
 * 09:00 ART, antes de que abra el mercado de bonos que arma el MEP, así que dolarapi todavía
 * devuelve el cierre de AYER y se guarda bajo el rótulo de HOY. Medido tres veces: F9.103
 * (198/200), la investigación de F9.148 (775/778 contra `api[D−1]` y **0/778** contra `api[D]`)
 * y el backfill de F9.148 §4, que revalidó el solapamiento completo en **779/779**.
 *
 * Por eso el TC del día de mercado `D` se lee del documento `D+1`. Sin este corrimiento toda la
 * serie convertida queda corrida un día — un error que no rompe nada visible y ensucia todos
 * los números.
 */
export async function serieTcDeMercado(db: Firestore): Promise<Map<string, number>> {
  const snap = await db.collection('tcDiario').get();
  const out = new Map<string, number>();
  for (const d of snap.docs) {
    const v = (d.data() as { tcUsdArs?: unknown }).tcUsdArs;
    if (typeof v !== 'number' || !(v > 0)) continue;
    out.set(diaAnterior(d.id), v);
  }
  return out;
}

function diaAnterior(f: string): string {
  const [y, m, d] = f.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/**
 * Convierte la serie rueda a rueda. Devuelve null si falta el TC de alguna rueda buena: una
 * serie con agujeros correría la ventana de 252 ruedas de `perf1a` sin que se note.
 */
export function dolarizarSerie(
  serie: PP.PuntoSerie[],
  tc: Map<string, number>,
): PP.PuntoSerie[] | null {
  const buenos = PP.soloBuenos(serie);
  const out: PP.PuntoSerie[] = [];
  for (const p of buenos) {
    const t = tc.get(p.f);
    if (!t || !(t > 0)) return null;
    out.push({ ...p, c: p.c / t, o: null, h: null, l: null, v: null });
  }
  return out;
}

/**
 * @param escribir false = corrida en seco: calcula y reporta exactamente lo mismo, sin tocar
 *                 Firestore. Es lo que permite ver el resultado antes del primer deploy.
 */
export async function correrActualizacionPrecios(
  db: Firestore,
  { escribir, ppi = null }: { escribir: boolean; ppi?: ClientePPI | null },
): Promise<Resumen> {
  const { objetivos, totalUsd, fechaCorrida, fechasCorrida } = await objetivosDePrecio(db);
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
  // F9.196 H5 — el MEP del día (resolverTcCarteraViva) para pasar el precio a la moneda de la tesis.
  const tcTesis = (await tcDelDia(db, new Date().toISOString()).catch(() => null))?.valor ?? tcHoy;
  const tcSerie = await serieTcDeMercado(db);   // F9.148 §4 — una sola lectura para todos

  const resultados: ResultadoTicker[] = [];
  const fallos: Array<{ ticker: string; error: string }> = [];

  for (const o of objetivos) {
    try {
      const r = await actualizarUnTicker(
        db, o, live, totalUsd, tcHoy, tcSerie, escribir, { fechaCorrida, fechasCorrida }, ppi, tcTesis);
      resultados.push(r);
      if (r.cobertura === 'con_serie' || r.motivo === 'fuente_sin_serie') await dormir(PAUSA_MS);
    } catch (e) {
      // Fallo de un ticker no aborta el resto.
      fallos.push({ ticker: o.ticker, error: String(e) });
      console.error(`[precios] ${o.ticker} falló, se sigue con el resto:`, e);
    }
  }

  const manuales = await valuarManuales(db, live, escribir);
  return { fechaCorrida, objetivos: objetivos.length, resultados, fallos, escrito: escribir, manuales };
}

/** Fecha de hoy en Buenos Aires, YYYY-MM-DD. */
const hoyART = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });

/**
 * F9.195 — la valuación de una posición manual es aritmética (cantidad × último precio), así que
 * la hace la app. Antes la pedía el prompt del informe ("manuales"): un LLM buscando el cierre de
 * ACN en la web para multiplicarlo por 43. Solo paneles en USD (usa_stocks): un panel en pesos
 * necesitaría TC y hoy ninguna manual lo usa. Lo que no se puede valuar queda como estaba, con
 * motivo en el log, y el informe lo pide como respaldo.
 */
export async function valuarManuales(
  db: Firestore,
  live: Map<PP.PanelLive, Map<string, number>>,
  escribir: boolean,
): Promise<ResultadoManual[]> {
  const snap = await db.collection('posicionesManuales').get();
  const out: ResultadoManual[] = [];
  const hoy = hoyART();
  for (const doc of snap.docs) {
    const m = doc.data() as { ticker?: string; tipo?: PP.PosicionTipo; pais_riesgo?: PP.PaisRiesgo; cantidad?: unknown };
    const ticker = m.ticker ?? '';
    const cantidad = Number(m.cantidad);
    const spec = ticker ? PP.panelesPara(m.tipo ?? 'accion', m.pais_riesgo ?? 'global') : null;
    let motivo: string | null = null;
    let precio: number | null = null;
    if (!ticker) motivo = 'sin ticker';
    else if (!(cantidad > 0)) motivo = 'sin cantidad';
    else if (!spec) motivo = 'tipo sin panel';
    else if (spec.live !== 'usa_stocks') motivo = `panel ${spec.live} en pesos: no se valúa automático`;
    else {
      precio = live.get(spec.live)?.get(PP.simboloDePanel(ticker)) ?? null;
      if (precio === null) motivo = `el panel ${spec.live} no trajo ${ticker}`;
    }
    const valorUsd = precio !== null ? Math.round(cantidad * precio * 100) / 100 : null;
    if (valorUsd !== null && escribir) {
      await doc.ref.set({
        valorUsd, fechaValuacion: hoy,
        precioUnitarioUsd: precio, fuenteValuacion: `data912:live/${spec!.live}`,
        valuadoEn: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    if (motivo) console.warn(`[precios] manual ${doc.id} (${ticker}): ${motivo}`);
    else console.log(`[precios] manual ${doc.id} ${ticker}: ${cantidad} × ${precio} = USD ${valorUsd}`);
    out.push({ id: doc.id, ticker, precioUsd: precio, valorUsd, motivo });
  }
  return out;
}

async function actualizarUnTicker(
  db: Firestore,
  o: ObjetivoPrecio,
  live: Map<PP.PanelLive, Map<string, number>>,
  totalUsd: number,
  tcHoy: number | null,
  tcSerie: Map<string, number>,
  escribir: boolean,
  corridas: { fechaCorrida: string | null; fechasCorrida: string[] },
  ppi: ClientePPI | null = null,
  tcTesis: number | null = null,
): Promise<ResultadoTicker> {
  const refPrecios = db.collection('preciosDiarios').doc(o.docId);
  const refInd = db.collection('indicadoresPosicion').doc(o.docId);
  const spec = PP.panelesPara(o.tipo, o.paisRiesgo);
  const simbolo = PP.simboloDePanel(o.ticker);

  const base = {
    docId: o.docId, ticker: o.ticker, tipo: o.tipo, paisRiesgo: o.paisRiesgo,
    actualizadoEn: FieldValue.serverTimestamp(),
  };
  const guardar = async (precios: object, indicadores: object) => {
    if (!escribir) return;
    await refPrecios.set({ ...base, ...precios }, { merge: true });
    await refInd.set({ ...base, ...indicadores }, { merge: true });
  };
  // F9.148 §3 — `drawdown` y `liquidez` se retiraron. `set(..., {merge:true})` FUSIONA los mapas
  // anidados, así que sacarlas del objeto calculado no las borra del documento: quedarían
  // colgadas para siempre, con el valor de la última corrida vieja, y la ficha las seguiría
  // pintando. Se borran explícitamente. El sentinel es idempotente: borrar lo ya borrado no falla.
  const retirados = {
    drawdown: FieldValue.delete(),
    liquidez: FieldValue.delete(),
  } as unknown as Record<string, PP.Semaforo>;
  const sinDatos = {
    ...retirados,
    peso: 'sin_datos', caida52s: 'sin_datos', volatilidad: 'sin_datos',
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
      ticker: o.ticker, docId: o.docId, cobertura: 'sin_fuente', estadoSerie: 'sin_serie',
      puntos: 0, saltosPendientes: 0, splitsAplicados: 0, motivo: 'sin_fuente',
    };
  }

  const monedaSerie = spec.live === 'usa_stocks' ? 'USD' : 'ARS';
  // Si el panel entero no se pudo bajar, `precioLive` no se escribe: con merge, el último
  // precio bueno sobrevive. Escribir null acá sería vaciar por una caída de la fuente.
  const panelBajado = live.has(spec.live);
  const precioLive = panelBajado ? (live.get(spec.live)!.get(simbolo) ?? null) : null;
  const campoPrecioLive = panelBajado ? { precioLive } : {};
  // F9.196 H2a — el precio del día con su fuente: data912; si falla o no tiene la especie, PPI.
  const respaldo = await respaldoPPI(refInd, o, spec.live, precioLive, ppi, escribir);
  const escalaGuardada = (o.tipo === 'bono' || o.tipo === 'on')
    ? RP.escalaVigente(((await refInd.get()).data() ?? {}).escalaPPI, PP.claveIdentidad(o)) : null;
  const precioDia = RP.elegirPrecioDia({
    data912: precioLive, monedaSerie, escalaData912: RP.escalaData912(o.tipo, escalaGuardada), ppi: respaldo, hoy: hoyART(),
  });
  const campoPrecioDia = precioDia ? { precioDia } : {};
  if (precioDia?.fuente === 'ppi') console.log(`[precios] ${o.docId}: sin precio de data912, se usa PPI ${precioDia.precio} (escala ${precioDia.escala ?? 'desconocida'})`);

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
        puntosDisponibles: 0, semaforos: sinDatos, ...campoPrecioDia,
      },
    );
    return {
      ticker: o.ticker, docId: o.docId, cobertura: 'solo_live', estadoSerie: 'sin_serie',
      puntos: 0, saltosPendientes: 0, splitsAplicados: 0, motivo: 'sin_historico',
    };
  }

  const { status, body } = await PP.pedir(PP.urlHistorico(spec.historical, simbolo));
  const serieSinMarcar = PP.parseSerie(body);
  // F9.148 — se marca ANTES de splits y detección: el punto podrido no debe generar saltos
  // fantasma ni contaminar la fecha que `splitsPorCantidad` busca en la serie.
  const serieCruda = serieSinMarcar && PP.marcarPuntosMalos(serieSinMarcar, simbolo);

  if (!serieCruda) {
    console.warn(`[precios] ${o.ticker} sin serie · HTTP ${status} · ${JSON.stringify(body).slice(0, 160)}`);
    const previo = await refPrecios.get();
    const teniaSerie = ((previo.data()?.serie as unknown[]) ?? []).length > 0;

    // NUNCA pisar una serie que ya tenía datos: la fuente no tiene SLA y una caída no debe
    // vaciar la base.
    if (PP.decidirEscritura(serieCruda, teniaSerie) === 'conservar') {
      if (escribir) await refPrecios.set({ ...base, ...campoPrecioLive, ultimoIntentoFallido: status }, { merge: true });
      if (escribir && precioDia) await refInd.set({ ...base, ...campoPrecioDia }, { merge: true });
      const d = previo.data() ?? {};
      return {
        ticker: o.ticker, docId: o.docId, cobertura: 'con_serie', estadoSerie: (d.estadoSerie as PP.EstadoSerie) ?? 'limpia',
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
        puntosDisponibles: 0, semaforos: sinDatos, ...campoPrecioDia,
      },
    );
    return {
      ticker: o.ticker, docId: o.docId, cobertura: 'solo_live', estadoSerie: 'sin_serie',
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

  // F9.148 §4 — la serie de la que sale la performance. `usa_stocks` ya viene en dólares y no
  // se toca; lo que está en pesos se convierte rueda a rueda, y si falta un solo TC la
  // conversión se descarta entera (`dolarizarSerie` devuelve null) y la performance queda en
  // pesos, dicho en `monedaPerformance`. Nunca una serie con agujeros.
  const serieUsd = monedaSerie === 'USD' ? null : dolarizarSerie(util, tcSerie);
  const ultimoPunto = PP.soloBuenos(util).slice(-1)[0];
  const cs = PP.llevaStops(o.tipo) && ultimoPunto
    ? await contextoStops(refInd, o, corridas, { cierre: ultimoPunto.c, moneda: monedaSerie, fecha: ultimoPunto.f, tc: tcTesis })
    : null;
  const stops = cs?.ctx;
  const ind = PP.calcIndicadores(util, { serieUsd, yaEnUsd: monedaSerie === 'USD', stops });
  const peso = totalUsd > 0 ? o.valorUsd / totalUsd : null;
  const ruedas = ruedasParaSalir(o.valorUsd, ind.montoOperadoProm30d, monedaSerie, tcHoy);

  await guardar(
    {
      panelLive: spec.live, panelHistorico: spec.historical, monedaSerie,
      fuente: `data912:historical/${spec.historical}`, cobertura: 'con_serie',
      estadoSerie: estado, puntos: serie.length,
      // F9.148 — `puntos` cuenta lo que la fuente devolvió (el punto malo incluido, porque sigue
      // guardado); `puntosMalos` explica por qué `puntosDisponibles` es menor.
      puntosMalos: serie.length - PP.soloBuenos(serie).length,
      primeraFecha: serie[0].f, ultimaFecha: serie[serie.length - 1].f,
      ...campoPrecioLive, splitsAplicados: aplicados, saltosDetectados: saltos,
      ultimoIntentoFallido: FieldValue.delete(),
      serie,
    },
    {
      calculadoEnISO: new Date().toISOString(),
      estadoSerie: estado, monedaSerie, motivo: null, ...campoPrecioDia,
      pesoEnCartera: peso, ruedasParaSalir: ruedas,
      ...(cs?.extra ?? {}),
      ...ind,
      semaforos: { ...retirados, ...PP.calcSemaforos(ind, PP.claseUmbral(o.tipo, o.paisRiesgo), peso) },
    },
  );

  return {
    ticker: o.ticker, docId: o.docId, cobertura: 'con_serie', estadoSerie: estado,
    puntos: ind.puntosDisponibles, saltosPendientes: saltos.length,
    splitsAplicados: aplicados.length, motivo: null,
  };
}

/**
 * F9.196 H2a — precio de PPI cuando data912 no lo trajo. Solo acciones AR, CEDEARs, bonos y ONs
 * (`tipoPPI`). La escala se pide una sola vez por identidad y se guarda; si esa consulta falla, el
 * precio va igual, sin escala (la guarda de la cartera viva hace el resto). Un error de PPI nunca
 * corta la actualización: se loguea (ruta y status, sin tokens) y se sigue sin respaldo.
 */
async function respaldoPPI(
  refInd: DocumentReference,
  o: ObjetivoPrecio,
  panelLive: PP.PanelLive,
  precioLive: number | null,
  ppi: ClientePPI | null,
  escribir: boolean,
): Promise<{ precio: number; escala: number | null; fechaISO: string | null } | null> {
  if (precioLive !== null || !ppi) return null;
  const tipo = RP.tipoPPI(o.tipo, o.paisRiesgo, panelLive);
  if (!tipo) return null;
  const identidad = PP.claveIdentidad(o);
  const previo = (await refInd.get()).data() ?? {};
  let escala = RP.escalaVigente(previo.escalaPPI, identidad);
  if (escala === null) {
    try {
      escala = RP.escalaDeBusqueda(await ppi.get(`MarketData/SearchInstrument?Ticker=${encodeURIComponent(o.ticker)}`), o.ticker, tipo);
      if (escala !== null && escribir) {
        const escalaPPI: RP.EscalaPPI = { identidad, nominalInPrice: escala, consultadoEnISO: new Date().toISOString() };
        await refInd.set({ escalaPPI }, { merge: true });
      }
    } catch (e) {
      console.warn(`[precios] ${o.docId}: SearchInstrument de PPI falló, precio sin escala: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  try {
    const c = RP.precioDeCurrent(await ppi.get(
      `MarketData/Current?Ticker=${encodeURIComponent(o.ticker)}&Type=${tipo}&Settlement=${RP.PLAZO_PPI}`));
    return c ? { precio: c.precio, escala, fechaISO: c.fechaISO } : null;
  } catch (e) {
    console.warn(`[precios] ${o.docId}: respaldo de PPI falló: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * F9.196 §4 — lo que el trinquete, el historial y el `desde` de las señales necesitan de la
 * lectura anterior. Se lee el documento que se va a pisar; una lectura por ticker por día.
 */
async function contextoStops(
  refInd: DocumentReference,
  o: ObjetivoPrecio,
  corridas: { fechaCorrida: string | null; fechasCorrida: string[] },
  precio: { cierre: number; moneda: 'ARS' | 'USD'; fecha: string; tc: number | null },
): Promise<{ ctx: PP.ContextoStops; extra: Record<string, unknown> }> {
  const d = (await refInd.get()).data() ?? {};
  // F9.196 H5 — tesis: P/E, potencial, gatillos y días al evento con el cierre del día, y las
  // señales "Evento próximo" y "Gatillo de tesis" (§5) por `senalesTesis`.
  const docTesis = (await refInd.firestore.collection('tesisPosicion').doc(o.ticker).get()).data() as DocTesis | undefined;
  let senalesTesis: PP.ContextoStops['senalesTesis'] = [];
  const extra: Record<string, unknown> = {};
  // El cliente puede escribir `tesisPosicion` con cualquier forma: se normaliza antes de calcular y
  // un error acá solo saltea la tesis (precios, indicadores y stops del ticker siguen).
  const tesis = docTesis?.tesis ? normalizarTesis(docTesis.tesis).tesis : null;
  if (tesis) {
    try {
      // Días al evento contra HOY en Argentina, no contra la última fecha de la serie (puede venir atrasada).
      const calc = calcularTesis(tesis, { valor: precio.cierre, moneda: precio.moneda }, { tc: precio.tc, hoy: hoyART(), esCedear: o.tipo === 'cedear' });
      const previoGatillos = Array.isArray(d.estadoGatillosTesis) ? (d.estadoGatillosTesis as EstadoGatillo[]) : [];
      const r = senalesDeTesis(calc, tesis, previoGatillos, precio.fecha);
      senalesTesis = r.senales;
      extra.tesisCalculo = JSON.parse(JSON.stringify({ ...calc, fecha: precio.fecha }));
      extra.estadoGatillosTesis = r.estado;
    } catch (e) {
      console.warn(`[precios] ${o.docId}: tesis salteada: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (d.tesisCalculo) {
    extra.tesisCalculo = null;   // se borró la tesis: que no quede un cálculo viejo
  }
  const previo: PP.PrevioStops = {
    stops: (d.stops as PP.Stops | null | undefined) ?? null,
    historialStops: Array.isArray(d.historialStops) ? (d.historialStops as PP.LecturaStop[]) : [],
    senales: Array.isArray(d.senales) ? (d.senales as PP.Senal[]) : [],
  };
  const identidad = PP.claveIdentidad(o);
  const reinicio = PP.motivoReinicioTrinquete(previo.stops, {
    identidad, fechaCorrida: corridas.fechaCorrida, vigenteEnCorrida: o.vigenteEnCorrida,
    corridasPresente: o.corridas, fechasCorrida: corridas.fechasCorrida,
  });
  if (reinicio) console.log(`[precios] ${o.docId}: trinquete del stop ATR reiniciado (${reinicio})`);
  return { ctx: { identidad, fechaCorrida: corridas.fechaCorrida, previo, reinicio, senalesTesis }, extra };
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
