// F9.149 — verificación. SOLO LEE.
//
// Corre las funciones REALES del motor sobre las series REALES de producción.
import { getDb } from './seed/utils/firestore';
import * as PP from '../functions/src/patrimonioPrecios';
import { serieTcDeMercado, dolarizarSerie } from '../functions/src/patrimonioPreciosCron';

let fallos = 0;
const chequear = (n: string, ok: boolean, d: string) => {
  if (!ok) fallos++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}: ${d}`);
};
const pct = (x: number | null | undefined, d = 1) => x == null ? '   n/d' : ((x * 100).toFixed(d) + '%').padStart(7);

async function main() {
  const db = getDb('production');
  const pd = await db.collection('preciosDiarios').get();
  const tc = await serieTcDeMercado(db);
  const docs = pd.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
    .filter(x => x.cobertura === 'con_serie' && (x.serie ?? []).length)
    .sort((a, b) => a.id.localeCompare(b.id));

  type Caso = {
    id: string; tipo: string; pais: string; clase: PP.ClaseUmbral; puntos: number;
    ind: PP.Indicadores; sem: Record<string, PP.Semaforo>; fija: PP.Semaforo; nueva: PP.Semaforo;
  };
  const casos: Caso[] = [];
  for (const d of docs) {
    const cruda: PP.PuntoSerie[] = (d.serie as any[]).map(p =>
      ({ f: p.f, o: p.o ?? null, h: p.h ?? null, l: p.l ?? null, c: p.c, v: p.v ?? null }));
    const marcada = PP.marcarPuntosMalos(cruda, PP.simboloDePanel(d.ticker));
    const { util } = PP.recortarPorEstado(marcada, PP.detectarSaltos(marcada), false);
    const yaEnUsd = d.monedaSerie === 'USD';
    const ind = PP.calcIndicadores(util, { serieUsd: yaEnUsd ? null : dolarizarSerie(util, tc), yaEnUsd });
    const clase = PP.claseUmbral(d.tipo, d.paisRiesgo === 'global' ? 'global' : 'AR');
    casos.push({
      id: d.id, tipo: d.tipo, pais: d.paisRiesgo, clase, puntos: PP.soloBuenos(util).length,
      ind, sem: PP.calcSemaforos(ind, clase, null),
      fija: PP.bandaCaidaFija(ind, clase), nueva: PP.bandaCaidaCalibrada(ind),
    });
  }

  // ── §1 — la banda sale de la distribución del propio activo
  console.log('\n===== §1 — banda calibrada =====\n');
  console.log('ticker              pts   obs   mediana   CDaR80   |hoy|     fija       calibrada   cambia');
  let cambian = 0;
  for (const c of casos) {
    const dif = c.fija !== c.nueva;
    if (dif) cambian++;
    console.log(`${c.id.padEnd(19)} ${String(c.puntos).padStart(4)} ${String(c.ind.ddObservaciones).padStart(5)}  ${pct(c.ind.ddMediana)} ${pct(c.ind.ddCdar80)} ${pct(c.ind.distanciaMax52sPct)}  ${c.fija.padEnd(10)} ${c.nueva.padEnd(11)} ${dif ? 'SI' : ''}`);
  }

  const semDelMotor = casos.every(c => c.sem.caida52s === c.nueva);
  chequear('§1 el semáforo usa la banda calibrada', semDelMotor,
    'calcSemaforos.caida52s === bandaCaidaCalibrada en las ' + casos.length);

  const cnt = (f: (c: Caso) => PP.Semaforo) => {
    const o: Record<string, number> = { verde: 0, amarillo: 0, rojo: 0, sin_datos: 0 };
    for (const c of casos) o[f(c)]++;
    return o;
  };
  const oFija = cnt(c => c.fija), oNueva = cnt(c => c.nueva);
  const f = (o: Record<string, number>) => `verde=${o.verde} amarillo=${o.amarillo} rojo=${o.rojo} sin_datos=${o.sin_datos}`;
  const conDatos = casos.filter(c => c.nueva !== 'sin_datos').length;
  console.log(`\n  umbral fijo:  ${f(oFija)}  -> rojos=${oFija.rojo}/${casos.length}`);
  console.log(`  calibrada:    ${f(oNueva)}  -> rojos=${oNueva.rojo}/${casos.length} (${oNueva.rojo}/${conDatos} = ${(oNueva.rojo / conDatos * 100).toFixed(0)}% de las que tienen distribución)`);
  console.log(`  cambian de banda: ${cambian}/${casos.length}`);

  chequear('§1 los rojos no pasan de un tercio', oNueva.rojo / conDatos <= 1 / 3,
    `${oNueva.rojo} de ${conDatos} con distribución (${(oNueva.rojo / conDatos * 100).toFixed(0)}%). ` +
    `Superar CDaR(0,8) pasa bastante menos que el 20% del tiempo porque es la MEDIA del peor 20%, ` +
    `no el percentil 80`);

  // ── §2 — mínimo de observaciones y sin_datos
  console.log('\n===== §2 — cobertura mínima =====\n');
  chequear('§2 mínimo medido', PP.MINIMO_OBS_DRAWDOWN === 400,
    `MINIMO_OBS_DRAWDOWN = ${PP.MINIMO_OBS_DRAWDOWN} observaciones (652 puntos de serie). ` +
    `A 400 la dispersión entre ventanas es 3% en CDaR(0,8) y 18% en la mediana; a 300, 4% y 34%`);

  const cortas = casos.filter(c => c.ind.ddObservaciones < PP.MINIMO_OBS_DRAWDOWN);
  chequear('§2 las cortas quedan sin_datos', cortas.every(c => c.nueva === 'sin_datos'),
    `${cortas.length} series por debajo del mínimo, todas en sin_datos: ` +
    cortas.map(c => `${c.id}(${c.ind.ddObservaciones} obs)`).join(' '));
  chequear('§2 sin distribución no hay bandas', cortas.every(c => c.ind.ddMediana === null && c.ind.ddCdar80 === null),
    'ddMediana y ddCdar80 en null cuando no hay observaciones suficientes: nunca una banda inventada');

  const largas = casos.filter(c => c.ind.ddObservaciones >= PP.MINIMO_OBS_DRAWDOWN);
  chequear('§2 las largas sí tienen banda', largas.every(c => c.nueva !== 'sin_datos'),
    `${largas.length} series con distribución estimable, todas con banda`);

  // Coherencia: la distribución tiene que ser la del MISMO objeto que se clasifica. Si fuera la
  // del máximo corrido, ddObservaciones sería igual a `puntos` y no a `puntos − 251`.
  chequear('§2 la distribución es del MISMO estadístico que se clasifica',
    largas.every(c => c.ind.ddObservaciones === c.puntos - 251),
    'ddObservaciones = puntos − 251 en las ' + largas.length + ': la curva es la de ventana móvil ' +
    'de 52 semanas, el mismo objeto que distanciaMax52sPct');
  chequear('§2 sin 252 ruedas no hay ni una observación',
    PP.curvaCaida52s([1, 2, 3]).length === 0 && PP.curvaCaida52s(Array(252).fill(1)).length === 1,
    'la curva necesita 252 ruedas para dar su primera observación');

  // ── §3 — Ulcer Index
  console.log('\n===== §3 — Ulcer Index =====\n');
  const sinSemaforo = !casos.some(c => 'ulcer' in c.sem || 'ulcerIndex126' in c.sem);
  chequear('§3 Ulcer sin semáforo', sinSemaforo,
    `las claves de semáforo son: ${Object.keys(casos[0].sem).join(', ')}`);
  const conUlcer = casos.filter(c => c.ind.ulcerIndex126 !== null);
  chequear('§3 Ulcer calculado', conUlcer.length === casos.filter(c => c.puntos >= 126).length,
    `${conUlcer.length} de ${casos.length} tienen ulcerIndex126 (las que llegan a 126 ruedas)`);
  console.log('  ticker              ulcer126   caída hoy   vol90d');
  for (const c of casos) {
    console.log(`  ${c.id.padEnd(19)} ${pct(c.ind.ulcerIndex126)}   ${pct(c.ind.distanciaMax52sPct)}     ${pct(c.ind.volAnualizada90d)}`);
  }

  // ── §4 — lo que no se toca
  console.log('\n===== §4 — lo que NO se toca =====\n');
  const volOk = casos.every(c => {
    const u = PP.UMBRALES.volatilidad[c.clase];
    const v = c.ind.volAnualizada90d;
    const esperado: PP.Semaforo = v == null ? 'sin_datos'
      : Math.abs(v) < u.verde ? 'verde' : Math.abs(v) <= u.amarillo ? 'amarillo' : 'rojo';
    return c.sem.volatilidad === esperado;
  });
  chequear('§4 volatilidad sin cambios', volOk,
    'el semáforo de volatilidad sigue saliendo de UMBRALES.volatilidad, umbral fijo por clase');
  chequear('§4 umbrales de volatilidad intactos',
    PP.UMBRALES.volatilidad.accionAr.verde === 0.40 && PP.UMBRALES.volatilidad.accionAr.amarillo === 0.60,
    `accionAr volatilidad = ${PP.UMBRALES.volatilidad.accionAr.verde}/${PP.UMBRALES.volatilidad.accionAr.amarillo}`);
  chequear('§4 umbrales de peso intactos',
    PP.UMBRALES.peso.verde === 0.04 && PP.UMBRALES.peso.amarillo === 0.08,
    `peso = ${PP.UMBRALES.peso.verde}/${PP.UMBRALES.peso.amarillo}`);
  chequear('§4 la tabla fija sigue disponible para comparar',
    typeof PP.UMBRALES.caidaFija.accionAr.verde === 'number',
    'UMBRALES.caidaFija se conserva y bandaCaidaFija la usa: la referencia vieja no se borró');
  chequear('§4 se sigue midiendo distanciaMax52sPct',
    casos.filter(c => c.ind.distanciaMax52sPct != null).length === largas.length,
    'la banda cambió cómo se clasifica, no qué se mide');

  // ── propiedades del método
  console.log('\n===== propiedades del método =====\n');
  chequear('CDaR(0,8) >= mediana siempre', largas.every(c => c.ind.ddCdar80! >= c.ind.ddMediana!),
    'la media del peor 20% nunca cae por debajo de la mediana');
  chequear('CDaR es media de cola, no percentil',
    PP.cdar([0.10, 0.20, 0.30, 0.40, 0.50], 0.8) === 0.50 &&
    PP.cdar([0.10, 0.20, 0.30, 0.40, 0.50], 0.6) === 0.45,
    'cdar([10,20,30,40,50]%, β=0.8) = 50% (el peor 20% de 5 observaciones es 1 sola) y ' +
    'con β=0.6 son las 2 peores promediadas = 45%');
  // La propiedad que explica por qué los rojos son ~8% y no ~20%: CDaR(0,8) es la MEDIA del peor
  // 20%, así que cae por encima del percentil 80 y se lo supera menos del 20% del tiempo.
  const excedencias: number[] = [];
  let cdarSobreP80 = true;
  for (const c of largas) {
    const d = docs.find(x => x.id === c.id)!;
    const cruda: PP.PuntoSerie[] = (d.serie as any[]).map(p =>
      ({ f: p.f, o: null, h: null, l: null, c: p.c, v: null }));
    const marcada = PP.marcarPuntosMalos(cruda, PP.simboloDePanel(d.ticker));
    const { util } = PP.recortarPorEstado(marcada, PP.detectarSaltos(marcada), false);
    const curva = PP.curvaCaida52s(PP.soloBuenos(util).map(p => p.c));
    const orden = [...curva].sort((a, b) => a - b);
    const p80 = orden[Math.floor(orden.length * 0.8)];
    if (!(c.ind.ddCdar80! >= p80)) cdarSobreP80 = false;
    excedencias.push(curva.filter(x => x > c.ind.ddCdar80!).length / curva.length);
  }
  const promExc = excedencias.reduce((a, b) => a + b, 0) / excedencias.length;
  chequear('CDaR(0,8) cae más adentro de la cola que el percentil 80', cdarSobreP80,
    `en las ${largas.length} series CDaR(0,8) >= p80 de su propia distribución; el tiempo por ` +
    `encima de CDaR(0,8) promedia ${(promExc * 100).toFixed(1)}%, no 20% — por eso los rojos son pocos`);
  chequear('ulcerIndex penaliza la duración',
    (PP.ulcerIndex([100, 50, 50, 50, 50, 50], 6) ?? 0) > (PP.ulcerIndex([100, 50, 100, 100, 100, 100], 6) ?? 0),
    'misma caída máxima, más tiempo abajo → Ulcer más alto');

  console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLOS`}`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
