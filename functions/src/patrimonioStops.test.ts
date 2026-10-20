// F9.196 §4–§5 — self-test de stops y señales. Sin framework (mismo criterio que
// `cafciHtml.test.ts`): series sintéticas, sin red ni Firestore.
// Correr: npx tsx functions/src/patrimonioStops.test.ts   → exit 1 si algo falla.
import {
  calcIndicadores, calcStops, motivoReinicioTrinquete, rsiSerie, UMBRALES,
  type ContextoStops, type PuntoSerie, type Stops,
} from './patrimonioPrecios';

let ok = 0, fail = 0;
function t(rotulo: string, cond: boolean, detalle = '') {
  if (cond) { ok++; console.log(`  OK   ${rotulo}`); }
  else { fail++; console.log(`  FAIL ${rotulo}${detalle ? `\n       ${detalle}` : ''}`); }
}

/** Fechas consecutivas desde 2025-01-01 (el calendario real no importa para estas reglas). */
function fecha(i: number): string {
  const d = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000);
  return d.toISOString().slice(0, 10);
}
/** Serie con OHLC: rango alto-bajo de ±`rango` alrededor del cierre. */
function serieDe(cierres: number[], rango = 1, volumen: number | null = 1000): PuntoSerie[] {
  return cierres.map((c, i) => ({ f: fecha(i), o: c, h: c + rango, l: c - rango, c, v: volumen }));
}
const ctx = (extra: Partial<ContextoStops> = {}): ContextoStops => ({
  identidad: 'GLOB|cedear|AR', fechaCorrida: '2026-10-10', previo: null, reinicio: null, ...extra,
});
const subida = (n: number, desde = 100, paso = 0.5) => Array.from({ length: n }, (_, i) => desde + i * paso);

console.log('=== §4 mínimo de datos ===');
{
  const r29 = calcStops(serieDe(subida(29)), 2, ctx());
  t('29 puntos → stopAtr null', r29.stops.stopAtr === null);
  t('29 puntos → motivo menos_de_30_puntos', r29.stops.motivoStopAtr === 'menos_de_30_puntos');
  const r30 = calcStops(serieDe(subida(30)), 2, ctx());
  t('30 puntos → stopAtr calculado', r30.stops.stopAtr !== null && r30.stops.motivoStopAtr === null);
  // Por calcIndicadores, como lo llama el cron.
  const ind29 = calcIndicadores(serieDe(subida(29)), { stops: ctx() });
  t('calcIndicadores con 29 puntos → stops.stopAtr null con motivo',
    ind29.stops?.stopAtr === null && ind29.stops?.motivoStopAtr === 'menos_de_30_puntos');
  const sinOhlc = serieDe(subida(40)).map(p => ({ ...p, h: null, l: null }));
  const indSin = calcIndicadores(sinOhlc, { stops: ctx() });
  t('sin OHLC (usa_stocks) → atr14 null y motivo sin_ohlc',
    indSin.atr14 === null && indSin.stops?.motivoStopAtr === 'sin_ohlc');
  const indBono = calcIndicadores(serieDe(subida(40)));
  t('sin opciones.stops (bonos, ONs) → stops/senales/historial null',
    indBono.stops === null && indBono.senales === null && indBono.historialStops === null);
}

console.log('\n=== §4 stop ATR chandelier ===');
{
  const s = serieDe(subida(40));            // rango ±1, paso 0,5 → TR = 2 en todas las ruedas
  const ind = calcIndicadores(s, { stops: ctx() });
  const max22 = Math.max(...s.slice(-22).map(p => p.c));
  t('atr14 absoluto = 2', Math.abs((ind.atr14 ?? 0) - 2) < 1e-9, `atr14=${ind.atr14}`);
  t('atrPct no cambió (= atr14 / último cierre)', Math.abs((ind.atrPct ?? 0) - 2 / s[39].c) < 1e-12);
  t('stopAtrBase = máx22 − 3 × ATR14', Math.abs((ind.stops?.stopAtrBase ?? 0) - (max22 - 6)) < 1e-9);
  t('distStopAtrPct = cierre/stop − 1', Math.abs((ind.stops?.distStopAtrPct ?? 0) - (s[39].c / (max22 - 6) - 1)) < 1e-12);
}

console.log('\n=== §4 trinquete ===');
{
  const s = serieDe(subida(40));
  const primera = calcStops(s, 2, ctx()).stops;
  // Lectura anterior con un stop MÁS ALTO que la base de hoy: el vigente no baja.
  const previoAlto: Stops = { ...primera, stopAtr: primera.stopAtrBase! + 5, stopAtrDesde: '2025-01-20' };
  const r = calcStops(s, 2, ctx({ previo: { stops: previoAlto, historialStops: [], senales: [] } })).stops;
  t('el trinquete no baja: stopAtr = el anterior', r.stopAtr === previoAlto.stopAtr);
  t('...y conserva stopAtrDesde del último ajuste', r.stopAtrDesde === '2025-01-20');
  // Con una base que sube, el stop sube y `desde` pasa a hoy.
  const previoBajo: Stops = { ...primera, stopAtr: primera.stopAtrBase! - 5, stopAtrDesde: '2025-01-20' };
  const r2 = calcStops(s, 2, ctx({ previo: { stops: previoBajo, historialStops: [], senales: [] } })).stops;
  t('base mayor → sube y stopAtrDesde = hoy', r2.stopAtr === primera.stopAtrBase && r2.stopAtrDesde === s[39].f);
  // Caída: una secuencia de lecturas diarias nunca baja el stop.
  const cierres = [...subida(40), ...Array.from({ length: 15 }, (_, i) => 119.5 - i * 1.5)];
  let previo: Stops | null = null;
  let historial: ReturnType<typeof calcStops>['historial'] = [];
  let bajo = false;
  for (let k = 35; k <= cierres.length; k++) {
    const res = calcStops(serieDe(cierres.slice(0, k)), 2,
      ctx({ previo: previo ? { stops: previo, historialStops: historial, senales: [] } : null }));
    if (previo && res.stops.stopAtr! < previo.stopAtr!) bajo = true;
    previo = res.stops; historial = res.historial;
  }
  t('lecturas diarias con caída: el stop nunca baja', !bajo);
  t('historialStops guarda una lectura por fecha', historial.length === cierres.length - 35 + 1 &&
    new Set(historial.map(h => h.fecha)).size === historial.length);
  // Re-correr el mismo día reemplaza la lectura, no la duplica.
  const again = calcStops(serieDe(cierres), 2, ctx({ previo: { stops: previo, historialStops: historial, senales: [] } }));
  t('re-correr el mismo día no duplica el historial', again.historial.length === historial.length);
  // Tope de 60 lecturas.
  const largo = Array.from({ length: 80 }, (_, i) => ({ fecha: fecha(i), stopAtr: 1, sma50: null, sma200: null, cierre: 1 }));
  const conTope = calcStops(serieDe(subida(100)), 2, ctx({ previo: { stops: null, historialStops: largo, senales: [] } }));
  t(`historialStops tiene como máximo ${UMBRALES.stops.historial} lecturas`, conTope.historial.length === UMBRALES.stops.historial);
}

console.log('\n=== §4 reinicio del trinquete ===');
{
  const s = serieDe(subida(40));
  const primera = calcStops(s, 2, ctx()).stops;
  const previoAlto: Stops = { ...primera, stopAtr: primera.stopAtrBase! + 5, fechaCorridaLectura: '2026-09-01' };
  const base = { identidad: 'GLOB|cedear|AR', fechaCorrida: '2026-10-10', vigenteEnCorrida: true };
  t('sin hueco → no reinicia', motivoReinicioTrinquete(previoAlto, {
    ...base, corridasPresente: ['2026-09-01', '2026-09-15', '2026-10-10'], fechasCorrida: ['2026-09-01', '2026-09-15', '2026-10-10'],
  }) === null);
  const hueco = motivoReinicioTrinquete(previoAlto, {
    ...base, corridasPresente: ['2026-09-01', '2026-10-10'], fechasCorrida: ['2026-09-01', '2026-09-15', '2026-10-10'],
  });
  t('vendida entera en una corrida intermedia → tenencia_interrumpida', hueco === 'tenencia_interrumpida');
  t('manual (no viene de corridas) → nunca por hueco', motivoReinicioTrinquete(previoAlto, {
    ...base, vigenteEnCorrida: false, corridasPresente: [], fechasCorrida: ['2026-09-15', '2026-10-10'],
  }) === null);
  t('otra identidad → identidad', motivoReinicioTrinquete(previoAlto, {
    ...base, identidad: 'GLOB|accion|global', corridasPresente: [], fechasCorrida: [],
  }) === 'identidad');
  const r = calcStops(s, 2, ctx({ reinicio: 'tenencia_interrumpida', previo: { stops: previoAlto, historialStops: [], senales: [] } })).stops;
  t('con reinicio, el stop vuelve a la base aunque el anterior fuera mayor', r.stopAtr === primera.stopAtrBase && r.reinicio === 'tenencia_interrumpida');
  const otra = calcStops(s, 2, ctx({ identidad: 'GLOB|accion|global', previo: { stops: previoAlto, historialStops: [{ fecha: '2025-01-02', stopAtr: 1, sma50: null, sma200: null, cierre: 1 }], senales: [] } }));
  t('previo de otra identidad: no alimenta el trinquete y descarta el historial',
    otra.stops.stopAtr === primera.stopAtrBase && otra.stops.reinicio === 'identidad' && otra.historial.length === 1);
}

console.log('\n=== §4 SMA200: el cierre debajo cuenta solo con dos ruedas seguidas ===');
{
  const arriba = subida(230, 100, 0.2);                 // todo por encima de su SMA200
  const ultimo = arriba[arriba.length - 1];
  const unaRueda = [...arriba, 50];                     // un cierre muy debajo de la SMA200
  const dosRuedas = [...arriba, 50, 50];
  const r1 = calcIndicadores(serieDe(unaRueda), { stops: ctx() });
  const r2 = calcIndicadores(serieDe(dosRuedas), { stops: ctx() });
  t('referencia: con todo arriba, estadoSma200 = encima',
    calcIndicadores(serieDe(arriba), { stops: ctx() }).stops?.estadoSma200 === 'encima', `último=${ultimo}`);
  t('una rueda debajo → estadoSma200 = cerca (no confirma)', r1.stops?.estadoSma200 === 'cerca', `estado=${r1.stops?.estadoSma200}`);
  t('una rueda debajo → sin señal debajo_sma200', !r1.senales?.some(s => s.id === 'debajo_sma200'));
  t('dos ruedas debajo → estadoSma200 = debajo', r2.stops?.estadoSma200 === 'debajo');
  t('dos ruedas debajo → estado resumido tocado', r2.stops?.estado === 'tocado');
  const sen = r2.senales?.find(s => s.id === 'debajo_sma200');
  t('dos ruedas debajo → señal atención, desde la segunda rueda, nueva',
    !!sen && sen.nivel === 'atencion' && sen.desde === fecha(dosRuedas.length - 1) && sen.nueva);
  t('distSma200Pct negativo cuando está debajo', (r2.stops?.distSma200Pct ?? 0) < 0);
  // `cerca` por distancia: a menos de 0,5 ATR por encima de la media, sin cruzarla.
  const sma200 = r1.stops!.stopSma200!;
  const pegado = calcStops(serieDe([...arriba.slice(0, -1), 0]).map((p, i, a) => i === a.length - 1 ? { ...p, c: sma200 + 0.1 } : p), 1, ctx()).stops;
  t('a menos de 0,5 ATR arriba de la SMA200 → cerca', pegado.estadoSma200 === 'cerca', `estado=${pegado.estadoSma200}`);
}

console.log('\n=== §5 cruce de medias dentro de la ventana de 10 ruedas ===');
{
  // 260 ruedas subiendo y después una caída larga: la SMA50 termina cruzando debajo de la SMA200.
  const cierres = [...subida(260, 100, 0.5), ...Array.from({ length: 120 }, (_, i) => 229.5 - i * 1.2)];
  // Se busca el día del cruce por fuerza bruta, con medias calculadas a mano.
  const sma = (xs: number[], v: number, fin: number) => xs.slice(fin - v + 1, fin + 1).reduce((a, b) => a + b, 0) / v;
  let k = -1;
  for (let i = 201; i < cierres.length; i++) {
    if (sma(cierres, 50, i - 1) >= sma(cierres, 200, i - 1) && sma(cierres, 50, i) < sma(cierres, 200, i)) { k = i; break; }
  }
  t('la serie sintética tiene un cruce bajista', k > 0, `k=${k}`);
  const dentro = calcIndicadores(serieDe(cierres.slice(0, k + 5)), { stops: ctx() });   // cruce en n−5
  const borde = calcIndicadores(serieDe(cierres.slice(0, k + 10)), { stops: ctx() });   // cruce en n−10
  const fuera = calcIndicadores(serieDe(cierres.slice(0, k + 11)), { stops: ctx() });   // cruce en n−11
  const cb = dentro.senales?.find(s => s.id === 'cruce_bajista');
  t('cruce hace 5 ruedas → señal cruce_bajista con desde = día del cruce', !!cb && cb.desde === fecha(k) && cb.nivel === 'atencion');
  t('cruce hace 5 ruedas → no es "nueva" (más de 3 ruedas)', !!cb && !cb.nueva);
  t('cruce en la rueda n−10 → todavía dentro de la ventana', !!borde.senales?.some(s => s.id === 'cruce_bajista'));
  t('cruce en la rueda n−11 → fuera de la ventana', !fuera.senales?.some(s => s.id === 'cruce_bajista'));
  const reciente = calcIndicadores(serieDe(cierres.slice(0, k + 2)), { stops: ctx() });
  t('cruce hace 2 ruedas → nueva', !!reciente.senales?.find(s => s.id === 'cruce_bajista')?.nueva);
  t('sin cruce alcista en una caída', !dentro.senales?.some(s => s.id === 'cruce_alcista'));
  // Espejo: caída y después subida → cruce alcista, nivel info.
  const espejo = cierres.map(c => 400 - c);
  let ka = -1;
  for (let i = 201; i < espejo.length; i++) {
    if (sma(espejo, 50, i - 1) <= sma(espejo, 200, i - 1) && sma(espejo, 50, i) > sma(espejo, 200, i)) { ka = i; break; }
  }
  const alc = calcIndicadores(serieDe(espejo.slice(0, ka + 3)), { stops: ctx() }).senales?.find(s => s.id === 'cruce_alcista');
  t('espejo → cruce_alcista nivel info', !!alc && alc.nivel === 'info' && alc.desde === fecha(ka));
}

console.log('\n=== §5 resto de señales ===');
{
  // RSI: la serie rueda a rueda termina en el mismo número que `rsi14`.
  const zigzag = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
  const ind = calcIndicadores(serieDe(zigzag), { stops: ctx() });
  const rs = rsiSerie(zigzag);
  t('rsiSerie termina en rsi14', Math.abs((rs[rs.length - 1] ?? 0) - (ind.rsi14 ?? -1)) < 1e-9);
  // Sobrecompra: subida pura → RSI 100.
  const sc = calcIndicadores(serieDe([...Array(30).fill(100), ...subida(20, 100, 1)]), { stops: ctx() }).senales;
  t('subida sostenida → sobrecompra info', !!sc?.some(s => s.id === 'sobrecompra' && s.nivel === 'info'));
  // Volumen anómalo: el último día opera 5× el promedio.
  const s = serieDe(subida(40));
  s[39] = { ...s[39], v: 5000 };
  const va = calcIndicadores(s, { stops: ctx() }).senales?.find(x => x.id === 'volumen_anomalo');
  t('volumen 5× → volumen_anomalo, desde hoy, nueva', !!va && va.desde === s[39].f && va.nueva);
  // Stop ATR tocado: el `desde` se hereda de la lectura anterior si ya estaba activa.
  const caida = serieDe([...subida(40), 100]);
  const r = calcIndicadores(caida, { stops: ctx() });
  const st = r.senales?.find(x => x.id === 'stop_atr_tocado');
  t('cierre debajo del stop ATR → stop_atr_tocado atención + estado tocado', !!st && st.nivel === 'atencion' && r.stops?.estado === 'tocado');
  const heredada = calcIndicadores(caida, { stops: ctx({ previo: {
    stops: r.stops, historialStops: [], senales: [{ ...st!, desde: '2025-02-05' }],
  } }) }).senales?.find(x => x.id === 'stop_atr_tocado');
  t('stop_atr_tocado ya activa → conserva su desde', heredada?.desde === '2025-02-05');
  // Las señales de la tesis (§6, H5) entran por el contexto.
  const tesis = calcIndicadores(serieDe(subida(40)), { stops: ctx({ senalesTesis: [
    { id: 'evento_proximo', texto: 'Balance en 4 días', desde: fecha(39), nivel: 'info' },
  ] }) }).senales;
  t('senalesTesis se suman con la marca nueva', !!tesis?.some(x => x.id === 'evento_proximo' && x.nueva));
}

console.log(`\n${ok} OK, ${fail} FAIL`);
if (fail) process.exit(1);
