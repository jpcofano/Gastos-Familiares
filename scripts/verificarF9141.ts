// F9.141 §7 — verificación del motor de precios. Corre con:
//   npx tsx scripts/verificarF9141.ts               (offline: usa data912 en vivo, no escribe)
//   npx tsx scripts/verificarF9141.ts --firestore   (además lee la corrida de producción)
//
// Mismo patrón de salida que scripts/verificarRiesgo.ts: una línea OK/FAIL por caso y exit
// code 1 si algo falla. SOLO LEE — no escribe en Firestore ni en data912.
import {
  panelesPara, detectarSaltos, aplicarSplits, parseSerie, esErrorDeFuente, decidirEscritura,
  calcIndicadores, recortarTope, recortarPorEstado, pedir, urlHistorico, urlLive,
  SPLITS_CONFIRMADOS, TOPE_PUNTOS,
  type PuntoSerie,
} from '../functions/src/patrimonioPrecios';

type Caso = { name: string; ok: boolean; detail: string };
const casos: Caso[] = [];
const chequear = (name: string, ok: boolean, detail: string) => { casos.push({ name, ok, detail }); };
const cerca = (a: number, b: number, tol = 0.0001) => Math.abs(a - b) <= tol;
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

const conFirestore = process.argv.includes('--firestore');

async function bajarSerie(panel: 'stocks' | 'cedears' | 'bonds' | 'usa_stocks', t: string) {
  const { body } = await pedir(urlHistorico(panel, t));
  await dormir(600);
  return { serie: parseSerie(body), body };
}

async function main() {
  // ── 1. Routing por tipo: BTC no consulta ningún panel ───────────────────────
  {
    const btc = panelesPara('cripto', 'global');
    chequear('btc-sin-panel', btc === null,
      btc === null ? 'cripto → null, no se consulta ningún panel' : `ruteó a ${JSON.stringify(btc)}`);

    // Y el falso positivo existe de verdad: BTC está listado en usa_stocks.
    const { body } = await pedir(urlLive('usa_stocks'));
    const listado = Array.isArray(body) && (body as Array<{ symbol?: string }>).some(x => x.symbol === 'BTC');
    chequear('btc-falso-positivo-real', listado,
      listado ? 'BTC figura en live/usa_stocks: por eso el routing es por tipo' : 'BTC ya no figura en usa_stocks');
    await dormir(600);
  }

  // ── 2. Los seis cedears van a arg_cedears, no a usa_stocks ─────────────────
  {
    const seis = ['B', 'BIOX', 'CVX', 'GLOB', 'VIST', 'VZ'];
    const specs = seis.map(t => ({ t, spec: panelesPara('cedear', 'global') }));
    const todosArg = specs.every(s => s.spec?.live === 'arg_cedears' && s.spec?.historical === 'cedears');
    chequear('cedears-a-arg_cedears', todosArg,
      todosArg ? `${seis.join(', ')} → arg_cedears / cedears (ARS)` : 'algún cedear ruteó a usa_stocks');
  }

  // ── 3. ACN/GLOB globales: usa_stocks, y su serie es solo cierre ────────────
  {
    const spec = panelesPara('accion', 'global');
    chequear('accion-global-a-usa_stocks',
      spec?.live === 'usa_stocks' && spec?.historical === 'usa_stocks',
      `accion+global → ${JSON.stringify(spec)}`);

    const { serie } = await bajarSerie('usa_stocks', 'ACN');
    const soloCierre = !!serie && serie.every(p => p.o === null && p.h === null && p.l === null && p.v === null);
    chequear('usa_stocks-solo-cierre', soloCierre && !!serie?.length,
      serie ? `${serie.length} puntos, o/h/l/v en null` : 'sin serie');

    if (serie) {
      const ind = calcIndicadores(serie);
      chequear('usa_stocks-sin-atr-ni-volumen',
        ind.atrPct === null && ind.montoOperadoProm30d === null && ind.ratioVolumen === null,
        `atrPct=${ind.atrPct} montoProm30d=${ind.montoOperadoProm30d} · sma200=${ind.sma200?.toFixed(2)}`);
    }
  }

  // ── 4. El detector encuentra el split de YPFD SIN la tabla curada ──────────
  // Que la capa 1 tape el caso no prueba el detector: acá la capa 1 no participa.
  let ypfd: PuntoSerie[] | null = null;
  {
    const { serie } = await bajarSerie('stocks', 'YPFD');
    ypfd = serie;
    const saltos = serie ? detectarSaltos(serie).filter(s => s.fecha === '2026-08-03') : [];
    const s = saltos[0];
    const ok = !!s && s.razonSugerida === 10 && s.residuo !== null && cerca(s.residuo, -0.0235, 0.001);
    chequear('detector-solo-encuentra-ypfd', ok,
      s ? `razón=${s.razonSugerida} residuo=${(s.residuo! * 100).toFixed(2)}% cociente=${s.cocienteCrudo.toFixed(4)}`
        : 'no detectó el salto del 2026-08-03');
  }

  // ── 5. La serie queda continua a través del split (capa 1) ─────────────────
  if (ypfd) {
    const splits = (SPLITS_CONFIRMADOS.YPFD ?? []).map(s => ({ ...s, origen: 'tabla' as const }));
    const { serie: ajustada, aplicados } = aplicarSplits(ypfd, splits);
    const okAplicado = aplicados.length === 1 && aplicados[0].fecha === '2026-08-03' && aplicados[0].razon === 10
      && aplicados[0].origen === 'tabla';
    chequear('ypfd-split-aplicado', okAplicado, JSON.stringify(aplicados));

    const i = ajustada.findIndex(p => p.f === '2026-08-03');
    const cinco = ajustada.slice(i - 2, i + 3);
    console.log('\n  YPFD, cinco ruedas alrededor del split (serie YA ajustada):');
    for (const p of cinco) {
      console.log(`    ${p.f}  o=${p.o}  c=${p.c}  v=${p.v}`);
    }
    const ret = cinco[2].c / cinco[1].c - 1;
    chequear('ypfd-serie-continua', cerca(ret, -0.0235, 0.001),
      `retorno del 2026-08-03 tras ajustar = ${(ret * 100).toFixed(2)}% (crudo era −90,23%)`);

    // Y ya sin salto pendiente: la serie queda `ajustada`, no `sospechosa`, en ese punto.
    const recortada = recortarTope(ajustada);
    const explicadas = new Set(aplicados.map(s => s.fecha));
    const pendientes = detectarSaltos(recortada).filter(s => !explicadas.has(s.fecha));
    const sinPendienteEnElSplit = !pendientes.some(s => s.fecha === '2026-08-03');
    chequear('ypfd-split-no-queda-pendiente', sinPendienteEnElSplit,
      `saltos pendientes: ${pendientes.map(s => s.fecha).join(', ') || 'ninguno'}`);
  }

  // ── 6. La capa 3 NUNCA reescala ────────────────────────────────────────────
  // TX26 2026-05-08 matchea razón 2 (es una amortización, no un split). Si la capa 3
  // reescalara, la serie previa quedaría dividida por 2.
  {
    const { serie } = await bajarSerie('bonds', 'TX26');
    if (!serie) {
      chequear('tx26-serie', false, 'no bajó la serie de TX26');
    } else {
      const s = detectarSaltos(serie).find(x => x.fecha === '2026-05-08');
      chequear('tx26-falso-positivo-detectado', s?.razonSugerida === 2,
        s ? `el detector sugiere razón ${s.razonSugerida} para una amortización` : 'no vio el salto');

      const { serie: sinTocar, aplicados } = aplicarSplits(serie, []);  // TX26 no está en la tabla
      const igual = sinTocar.every((p, i) => p.c === serie[i].c);
      chequear('tx26-serie-intacta', igual && aplicados.length === 0,
        'sin entrada en SPLITS_CONFIRMADOS ni prueba por cantidad, la serie no se toca');

      const { estado } = recortarPorEstado(serie, [s!], false);
      chequear('tx26-marcada-sospechosa', estado === 'sospechosa', `estadoSerie=${estado}`);
    }
  }

  // ── 7. Mínimos de puntos: ningún indicador largo sobre serie corta ─────────
  {
    const { serie } = await bajarSerie('cedears', 'GLOB');
    if (!serie) {
      chequear('cedear-serie', false, 'no bajó la serie de cedears/GLOB');
    } else {
      const ind = calcIndicadores(serie);
      const corta = serie.length < 200;
      chequear('cedear-sin-sma200', corta && ind.sma200 === null && ind.sma50 !== null,
        `${serie.length} puntos → sma200=${ind.sma200}, sma50=${ind.sma50?.toFixed(2)}, perf1a=${ind.perf1a}`);
      chequear('cedear-sin-max52s', ind.max52s === null && ind.perf1a === null,
        'max52s y perf1a en null: no hay 252 ruedas');
    }
  }

  // ── 8. Serie sintética: los mínimos se respetan exactamente ────────────────
  {
    const punto = (i: number): PuntoSerie => ({
      f: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
      o: 100, h: 101, l: 99, c: 100 + i * 0.01, v: 1000,
    });
    const ind199 = calcIndicadores(Array.from({ length: 199 }, (_, i) => punto(i)));
    chequear('minimo-sma200-en-199', ind199.sma200 === null && ind199.sma50 !== null,
      `199 puntos → sma200=null, sma50=${ind199.sma50?.toFixed(4)}`);
    const ind200 = calcIndicadores(Array.from({ length: 200 }, (_, i) => punto(i)));
    chequear('minimo-sma200-en-200', ind200.sma200 !== null,
      `200 puntos → sma200=${ind200.sma200?.toFixed(4)}`);
  }

  // ── 9. Contrato de errores y regla de no vaciar ────────────────────────────
  {
    const errorTicker = { Error: 'Nahh no tengo ese ticker loko' };
    const errorRuta = { detail: 'Not Found' };
    chequear('errores-por-payload',
      esErrorDeFuente(errorTicker) && esErrorDeFuente(errorRuta) && parseSerie(errorTicker) === null,
      'ticker inexistente responde HTTP 200: se valida la forma del payload, no el status');

    chequear('caida-no-vacia',
      decidirEscritura(null, true) === 'conservar' &&
      decidirEscritura([], true) === 'conservar' &&
      decidirEscritura(null, false) === 'marcar_sin_serie',
      'con serie previa se conserva; sin serie previa se marca sin_serie; nunca se vacía');

    const buena: PuntoSerie[] = [{ f: '2026-08-14', o: 1, h: 1, l: 1, c: 1, v: 1 }];
    chequear('escribe-cuando-hay-dato', decidirEscritura(buena, true) === 'escribir', 'serie válida → escribir');
  }

  // ── 10. Tope de 750 puntos ─────────────────────────────────────────────────
  if (ypfd) {
    const r = recortarTope(ypfd);
    chequear('tope-750', r.length === TOPE_PUNTOS && r[r.length - 1].f === ypfd[ypfd.length - 1].f,
      `${ypfd.length} → ${r.length} puntos, recortado por el extremo viejo (desde ${r[0].f})`);
  }

  // ── 11. Contra Firestore (opcional) ────────────────────────────────────────
  if (conFirestore) {
    const { getDb } = await import('./seed/utils/firestore');
    const db = getDb('production');
    const snapQ = await db.collection('snapshotsPortafolio')
      .orderBy('fechaCorrida', 'desc').limit(1).get();
    const fecha = snapQ.docs[0]?.data().fechaCorrida as string;
    const pos = await db.collection('posicionesPatrimonio').where('fechaCorrida', '==', fecha).get();

    const sinRuteo: string[] = [];
    const conRuteo: string[] = [];
    for (const d of pos.docs) {
      const p = d.data() as { ticker: string; tipo: any; pais_riesgo: any };
      (panelesPara(p.tipo, p.pais_riesgo ?? 'AR') ? conRuteo : sinRuteo).push(p.ticker);
    }
    console.log(`\n  corrida ${fecha}: ${new Set(conRuteo).size} tickers con panel, ${new Set(sinRuteo).size} sin panel`);
    console.log(`  sin panel: ${[...new Set(sinRuteo)].sort().join(' ')}`);
    chequear('btc-sin-panel-en-corrida', sinRuteo.includes('BTC'),
      'BTC queda sin panel en la corrida real, como manda el §7');
  }

  // ── salida ─────────────────────────────────────────────────────────────────
  console.log('');
  for (const c of casos) console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name} — ${c.detail}`);
  const fallos = casos.filter(c => !c.ok).length;
  console.log(`\n${casos.length - fallos}/${casos.length} OK`);
  process.exit(fallos ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
