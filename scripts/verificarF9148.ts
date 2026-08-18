// F9.148 — verificación. SOLO LEE.
//
// Corre las funciones REALES del motor (functions/src/patrimonioPrecios.ts y
// patrimonioPreciosCron.ts) sobre las series REALES de producción. Si esto y la pantalla
// difieren, es un bug de la ficha, no de la verificación.
//
// El "antes" del §2 reimplementa el detector viejo (umbral 0,35, sin marcas) porque ese código
// ya no existe: es la única forma de medir el delta.
import { getDb } from './seed/utils/firestore';
import * as PP from '../functions/src/patrimonioPrecios';
import { serieTcDeMercado, dolarizarSerie } from '../functions/src/patrimonioPreciosCron';

let fallos = 0;
const chequear = (n: string, ok: boolean, d: string) => {
  if (!ok) fallos++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}: ${d}`);
};
const pct = (x: number | null | undefined) => x == null ? 'n/d' : `${(x * 100).toFixed(1)}%`;

/** Detector viejo: umbral 0,35, sin concepto de punto malo. */
function detectarViejo(serie: PP.PuntoSerie[]) {
  const out: { fecha: string; ret: number }[] = [];
  for (let i = 1; i < serie.length; i++) {
    const ret = serie[i].c / serie[i - 1].c - 1;
    if (Math.abs(ret) > 0.35) out.push({ fecha: serie[i].f, ret });
  }
  return out;
}

async function main() {
  const db = getDb('production');
  const pd = await db.collection('preciosDiarios').get();
  const tc = await serieTcDeMercado(db);

  const docs = pd.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
    .filter(x => x.cobertura === 'con_serie' && (x.serie ?? []).length)
    .sort((a, b) => a.id.localeCompare(b.id));

  type Caso = {
    id: string; simbolo: string; moneda: string; tipo: string; pais: string;
    cruda: PP.PuntoSerie[]; marcada: PP.PuntoSerie[];
    antes: { n: number; estado: string; util: number };
    desp: { n: number; estado: PP.EstadoSerie; util: number };
    ind: PP.Indicadores; indArs: PP.Indicadores; sem: Record<string, PP.Semaforo>;
  };
  const casos: Caso[] = [];

  for (const d of docs) {
    const cruda: PP.PuntoSerie[] = (d.serie as any[]).map(p =>
      ({ f: p.f, o: p.o ?? null, h: p.h ?? null, l: p.l ?? null, c: p.c, v: p.v ?? null }));
    const simbolo = PP.simboloDePanel(d.ticker);
    const marcada = PP.marcarPuntosMalos(cruda, simbolo);

    const sV = detectarViejo(cruda);
    const utilV = sV.length
      ? cruda.slice(Math.max(0, cruda.findIndex(p => p.f >= sV[sV.length - 1].fecha))).length
      : cruda.length;

    const sN = PP.detectarSaltos(marcada);
    const { util, estado } = PP.recortarPorEstado(marcada, sN, false);
    const yaEnUsd = d.monedaSerie === 'USD';
    const serieUsd = yaEnUsd ? null : dolarizarSerie(util, tc);
    const ind = PP.calcIndicadores(util, { serieUsd, yaEnUsd });
    const indArs = PP.calcIndicadores(util);   // referencia: la misma serie sin dolarizar
    const clase = PP.claseUmbral(d.tipo, d.paisRiesgo === 'global' ? 'global' : 'AR');

    casos.push({
      id: d.id, simbolo, moneda: d.monedaSerie, tipo: d.tipo, pais: d.paisRiesgo,
      cruda, marcada,
      antes: { n: sV.length, estado: sV.length ? 'sospechosa' : 'limpia', util: utilV },
      desp: { n: sN.length, estado, util: PP.soloBuenos(util).length },
      ind, indArs, sem: PP.calcSemaforos(ind, clase, null),
    });
  }

  // ── §1 ──────────────────────────────────────────────────────────────────────
  console.log('\n===== §1 — el punto podrido =====\n');
  const marcados = casos.filter(c => c.marcada.some(p => p.malo));
  chequear('§1 punto marcado', marcados.length === 10,
    `${marcados.length} series con punto marcado el 2023-08-03: ${marcados.map(c => c.id).join(' ')}`);

  const sigueEnSerie = marcados.every(c => c.marcada.filter(p => p.f === '2023-08-03').length === 1);
  chequear('§1 sigue en la serie', sigueEnSerie,
    'el punto marcado NO se eliminó: sigue presente una vez en cada serie');

  const excluido = marcados.every(c => {
    const i = PP.calcIndicadores(c.marcada);
    return i.puntosDisponibles === c.marcada.length - 1;
  });
  chequear('§1 excluido del cálculo', excluido,
    'puntosDisponibles = puntos − 1 en las 10: el punto no entra en ningún indicador');

  const sinFantasmas = marcados.every(c =>
    !PP.detectarSaltos(c.marcada).some(s => s.fecha === '2023-08-03' || s.fecha === '2023-08-04'));
  chequear('§1 sin saltos fantasma', sinFantasmas,
    'ninguna de las 10 reporta salto el 03/08 ni el 04/08');

  const sanas = casos.filter(c => ['BMA', 'CEPU'].includes(c.id));
  chequear('§1 no marca las sanas', sanas.every(c => !c.marcada.some(p => p.malo)),
    `BMA y CEPU tienen fila ese día y el dato es correcto: no se marcan (${sanas.length} verificadas)`);

  const aLimpia = casos.filter(c => c.antes.estado === 'sospechosa' && c.desp.estado === 'limpia');
  chequear('§1+§2 sospechosa -> limpia', aLimpia.length >= 7,
    `${aLimpia.length} de 10 (el criterio del spec pedía 7): ${aLimpia.map(c => c.id).join(' ')}`);

  const regresiones = casos.filter(c => c.antes.estado === 'limpia' && c.desp.estado !== 'limpia');
  chequear('§1+§2 sin regresiones', regresiones.length === 0,
    `${regresiones.length} series pasaron de limpia a sospechosa`);

  // ── §2 ──────────────────────────────────────────────────────────────────────
  console.log('\n===== §2 — el umbral del detector =====\n');
  chequear('§2 umbral', PP.UMBRAL_SALTO === 0.45, `UMBRAL_SALTO = ${PP.UMBRAL_SALTO}`);

  console.log('  ticker    antes: n/estado/util      despues: n/estado/util');
  let ganados = 0;
  for (const c of casos) {
    ganados += c.desp.util - c.antes.util;
    if (c.antes.n || c.desp.n || c.antes.util !== c.desp.util) {
      console.log(`  ${c.id.padEnd(9)} ${c.antes.n}/${c.antes.estado.padEnd(10)}/${String(c.antes.util).padStart(4)}      ${c.desp.n}/${c.desp.estado.padEnd(10)}/${String(c.desp.util).padStart(4)}`);
    }
  }
  chequear('§2 puntos recuperados', ganados > 0, `+${ganados} ruedas utilizables en total`);

  const quedanSospechosas = casos.filter(c => c.desp.estado === 'sospechosa');
  console.log(`  siguen sospechosas: ${quedanSospechosas.map(c => `${c.id}(${c.desp.n})`).join(' ') || 'ninguna'}`);
  for (const c of quedanSospechosas) {
    for (const s of PP.detectarSaltos(c.marcada)) {
      console.log(`    ${c.id} ${s.fecha} ${pct(s.retornoCrudo)} razon=${s.razonSugerida ?? '-'} residuo=${pct(s.residuo)}`);
    }
  }

  // el rally REAL del 2025-10-27, dolarizado, no debe disparar
  let disparos = 0, evaluadas = 0;
  console.log('  rally del 2025-10-27 dolarizado:');
  for (const c of casos) {
    if (c.moneda !== 'ARS') continue;
    const usd = dolarizarSerie(c.marcada, tc);
    if (!usd) continue;
    const i = usd.findIndex(p => p.f === '2025-10-27');
    if (i <= 0) continue;
    evaluadas++;
    const ret = usd[i].c / usd[i - 1].c - 1;
    const dispara = PP.detectarSaltos(usd).some(s => s.fecha === '2025-10-27');
    if (dispara) disparos++;
    if (ret > 0.30) console.log(`    ${c.id.padEnd(8)} ${pct(ret)} -> ${dispara ? 'DISPARA' : 'no dispara'}`);
  }
  chequear('§2 el rally dolarizado no dispara', disparos === 0,
    `0 de ${evaluadas} series dolarizadas reportan salto el 2025-10-27`);

  // ── §3 ──────────────────────────────────────────────────────────────────────
  console.log('\n===== §3 — semáforos =====\n');
  chequear('§3 liquidez retirada', !('liquidez' in (casos[0]?.sem ?? {})),
    `calcSemaforos ya no emite liquidez; claves: ${Object.keys(casos[0]?.sem ?? {}).join(', ')}`);
  chequear('§3 caida52s presente', 'caida52s' in (casos[0]?.sem ?? {}),
    'el semáforo de rango mide distanciaMax52sPct (ventana fija de 52 semanas)');

  const cnt = (f: (c: Caso) => PP.Semaforo) => {
    const o: Record<string, number> = { verde: 0, amarillo: 0, rojo: 0, sin_datos: 0 };
    for (const c of casos) o[f(c)]++;
    return o;
  };
  const claseDe = (c: Caso) => PP.claseUmbral(c.tipo as any, c.pais === 'global' ? 'global' : 'AR');
  // Este bloque mide lo que cambió F9.148: la REFERENCIA (máximo de la serie → máximo de 52
  // semanas), a umbral fijo de los dos lados. F9.149 después cambió la clasificación y renombró
  // la tabla a `caidaFija`, que es la que hay que usar acá para que la comparación siga siendo
  // la de F9.148 y no una mezcla de los dos cambios.
  const viejo = cnt(c => {
    const u = PP.UMBRALES.caidaFija[claseDe(c)];
    const v = c.ind.drawdownDesdeMaxPct;
    if (v == null) return 'sin_datos';
    const a = Math.abs(v);
    return a < u.verde ? 'verde' : a <= u.amarillo ? 'amarillo' : 'rojo';
  });
  const nuevo = cnt(c => PP.bandaCaidaFija(c.ind, claseDe(c)));
  const f = (o: Record<string, number>) => `verde=${o.verde} amarillo=${o.amarillo} rojo=${o.rojo} sin_datos=${o.sin_datos} -> cargados=${o.amarillo + o.rojo}/${casos.length}`;
  console.log(`  referencia vieja (max de la serie): ${f(viejo)}`);
  console.log(`  referencia nueva (max 52 semanas):  ${f(nuevo)}`);
  const ambas = casos.filter(c => c.ind.drawdownDesdeMaxPct != null && c.ind.distanciaMax52sPct != null);
  console.log(`  entre las ${ambas.length} con las dos referencias definidas, cambian de banda:`);
  for (const c of ambas) {
    const u = PP.UMBRALES.caidaFija[claseDe(c)];
    const b = (v: number) => Math.abs(v) < u.verde ? 'verde' : Math.abs(v) <= u.amarillo ? 'amarillo' : 'rojo';
    const a = b(c.ind.drawdownDesdeMaxPct!), n = b(c.ind.distanciaMax52sPct!);
    if (a !== n) console.log(`    ${c.id.padEnd(8)} ${pct(c.ind.drawdownDesdeMaxPct)} (${a}) -> ${pct(c.ind.distanciaMax52sPct)} (${n})`);
  }

  // ── §4 ──────────────────────────────────────────────────────────────────────
  console.log('\n===== §4 — performance en dólares =====\n');
  const tcDocs = await db.collection('tcDiario').get();
  const fechasTc = tcDocs.docs.map(d => d.id).sort();
  console.log(`  tcDiario: ${tcDocs.size} docs, ${fechasTc[0]} .. ${fechasTc[fechasTc.length - 1]}`);

  const arsConSerie = casos.filter(c => c.moneda === 'ARS');
  const sinTc = arsConSerie.filter(c => !dolarizarSerie(c.marcada, tc));
  chequear('§4 cobertura de TC', sinTc.length === 0,
    `las ${arsConSerie.length} series en ARS tienen TC en TODAS sus ruedas${sinTc.length ? ` — faltan en: ${sinTc.map(c => c.id).join(' ')}` : ''}`);

  const enUsd = casos.filter(c => c.ind.monedaPerformance === 'USD');
  chequear('§4 performance en USD', enUsd.length === casos.length,
    `${enUsd.length}/${casos.length} posiciones con monedaPerformance = USD`);

  // caso testigo de la convención de fecha
  const testigo = '2026-08-13';
  const docTestigo = await db.collection('tcDiario').doc('2026-08-14').get();
  const tcTestigo = tc.get(testigo);
  chequear('§4 convención de fecha D = cierre de D−1',
    tcTestigo != null && tcTestigo === (docTestigo.data() as any)?.tcUsdArs,
    `el TC de mercado del ${testigo} (${tcTestigo}) sale del documento tcDiario/2026-08-14 ` +
    `(${(docTestigo.data() as any)?.tcUsdArs}), NO del de ${testigo} ` +
    `(${(await db.collection('tcDiario').doc(testigo).get()).data()?.tcUsdArs})`);

  console.log('\n  perf1a: ARS vs USD');
  console.log('  ticker     ARS       USD       cambia de signo');
  let cambian = 0;
  for (const c of casos) {
    const a = c.indArs.perf1a, u = c.ind.perf1a;
    const flip = a != null && u != null && Math.sign(a) !== Math.sign(u);
    if (flip) cambian++;
    console.log(`  ${c.id.padEnd(9)} ${pct(a).padStart(8)}  ${pct(u).padStart(8)}  ${flip ? 'SI' : ''}${c.moneda === 'USD' ? '  (serie ya en USD)' : ''}`);
  }
  console.log(`  cambian de signo: ${cambian}`);

  // nada más que performance se dolarizó
  const contaminados = casos.filter(c => c.moneda === 'ARS' && (
    c.ind.volAnualizada90d !== c.indArs.volAnualizada90d ||
    c.ind.drawdownDesdeMaxPct !== c.indArs.drawdownDesdeMaxPct ||
    c.ind.sma200 !== c.indArs.sma200 ||
    c.ind.rsi14 !== c.indArs.rsi14 ||
    c.ind.atrPct !== c.indArs.atrPct ||
    c.ind.distanciaMax52sPct !== c.indArs.distanciaMax52sPct));
  chequear('§4 no se dolarizó nada más', contaminados.length === 0,
    `volatilidad, drawdown, medias, rango, RSI y ATR idénticos con y sin conversión en las ` +
    `${arsConSerie.length} series en ARS${contaminados.length ? ` — contaminadas: ${contaminados.map(c => c.id).join(' ')}` : ''}`);

  const soloPerf = casos.filter(c => c.moneda === 'ARS' && c.ind.perf1a !== c.indArs.perf1a);
  chequear('§4 la performance sí cambió', soloPerf.length === arsConSerie.filter(c => c.indArs.perf1a != null).length,
    `${soloPerf.length} series en ARS tienen perf1a distinta al convertir`);

  console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLOS`}`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
