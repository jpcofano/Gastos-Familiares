// F9.196 H5 — tesis por acción: P/E con y sin conversión de moneda, potencial, gatillos con los dos
// operadores, el campo editado que no se pisa, la señal de gatillo que cambia, el evento próximo y un
// informe viejo sin `tesis` que importa igual. Sin red ni Firestore.
// Correr: npx tsx functions/src/h5.test.ts   → exit 1 si algo falla.
import {
  normalizarTesis, fusionarTesis, editarTesis, calcularTesis, senalesDeTesis, type Tesis,
} from './compartido/tesis';
import { tesisDeItems } from './tesisImport';
import { buildPromptPosicionesV3, ESQUEMA_TESIS } from './informeV2';
import { calcIndicadores, type PuntoSerie } from './patrimonioPrecios';

let ok = 0, fail = 0;
function t(rotulo: string, cond: boolean, detalle?: unknown) {
  if (cond) { ok++; console.log(`  OK   ${rotulo}`); }
  else { fail++; console.log(`  FAIL ${rotulo}${detalle !== undefined ? `\n       ${JSON.stringify(detalle)}` : ''}`); }
}

const delChat = {
  monedaFundamentals: 'USD', epsGuiaMin: 2, epsGuiaMax: 3, epsPeriodo: '2026',
  precioObjetivoConsenso: 60, analistas: 20, recomendacionConsenso: 'compra',
  gatillos: [
    { texto: 'Margen EBITDA ≥ 30%', metrica: 'margen_ebitda', operador: '>=', umbral: 0.3, valorActual: 0.32 },
    { texto: 'Deuda/EBITDA ≤ 2', metrica: 'deuda_ebitda', operador: '<=', umbral: 2, valorActual: 2.5 },
  ],
  proximoEvento: { fecha: '2026-10-24', tipo: 'balance', texto: 'Balance 3T' },
  cortoPlazo: 'Si se confirma la guía, …', medianoPlazo: 'Si sigue el ciclo, …', riesgoPrincipal: 'Tipo de cambio',
  fuentes: [{ texto: 'Informe 2T', fecha: '2026-08-10' }], fechaDatos: '2026-10-19',
};
const T = normalizarTesis(delChat).tesis as Tesis;

console.log('=== normalización (tolerante, sin inventar) ===');
t('la forma de §6 se normaliza tal cual', T.epsGuiaMin === 2 && T.gatillos.length === 2 && T.proximoEvento.tipo === 'balance');
const raro = normalizarTesis({ ...delChat, epsGuiaMin: 'mucho', gatillos: [{ texto: 'x', operador: '>', umbral: 1 }], proximoEvento: { fecha: 'pronto' } });
t('datos inválidos → null y aviso, nunca un valor inventado', raro.tesis?.epsGuiaMin === null && raro.tesis?.gatillos.length === 0 && raro.tesis?.proximoEvento.fecha === null && raro.avisos.length >= 1);

console.log('\n=== cálculos con el precio del día ===');
{
  const c = calcularTesis(T, { valor: 50, moneda: 'USD' }, { tc: 1500, hoy: '2026-10-20' });
  t('P/E en la misma moneda = precio / promedio(EPS)', Math.abs((c.pe ?? 0) - 20) < 1e-9);
  t('potencial = objetivo / precio − 1', Math.abs((c.potencial ?? 0) - 0.2) < 1e-9);
  const ars = calcularTesis(T, { valor: 75_000, moneda: 'ARS' }, { tc: 1500, hoy: '2026-10-20' });
  t('P/E con conversión: precio en pesos / MEP', Math.abs((ars.pe ?? 0) - 20) < 1e-9 && Math.abs((ars.precioEnMoneda ?? 0) - 50) < 1e-9);
  t('sin MEP y monedas distintas → null con motivo (no se inventa)', calcularTesis(T, { valor: 75_000, moneda: 'ARS' }, { tc: null, hoy: '2026-10-20' }).pe === null
    && calcularTesis(T, { valor: 75_000, moneda: 'ARS' }, { tc: null, hoy: '2026-10-20' }).motivo === 'sin_tc');
  t('CEDEAR (sin ratio) → null con motivo cedear_sin_ratio', calcularTesis(T, { valor: 3760, moneda: 'ARS' }, { tc: 1500, hoy: '2026-10-20', esCedear: true }).motivo === 'cedear_sin_ratio');
  t('gatillo >= cumplido (0,32 ≥ 0,30)', c.gatillos[0].cumplido === true);
  t('gatillo <= no cumplido (2,5 ≤ 2 es falso)', c.gatillos[1].cumplido === false);
  t('gatillo sin valor actual → cumplido null', calcularTesis({ ...T, gatillos: [{ ...T.gatillos[0], valorActual: null }] }, { valor: 50, moneda: 'USD' }, { tc: 1, hoy: '2026-10-20' }).gatillos[0].cumplido === null);
  t('días al evento', c.diasAlEvento === 4);
}

console.log('\n=== edición de Juan e importación ===');
{
  const inicial = fusionarTesis(null, 'YPFD', T);
  t('primera importación: todo del chat', inicial.tesis.precioObjetivoConsenso === 60 && Object.keys(inicial.editadoPorJuan).length === 0);
  const editado = editarTesis(inicial, 'precioObjetivoConsenso', 55);
  t('editar marca el campo editadoPorJuan', editado.editadoPorJuan.precioObjetivoConsenso === true && editado.tesis.precioObjetivoConsenso === 55);
  const otraVez = fusionarTesis(editado, 'YPFD', { ...T, precioObjetivoConsenso: 70, analistas: 22 });
  t('el campo editado NO se pisa en la importación siguiente', otraVez.tesis.precioObjetivoConsenso === 55);
  t('…y el dato distinto del chat queda aparte ("dato del chat distinto: 70")', otraVez.distintoDelChat.precioObjetivoConsenso === 70);
  t('los campos no editados sí se actualizan', otraVez.tesis.analistas === 22);
  const igualQueJuan = fusionarTesis(editado, 'YPFD', { ...T, precioObjetivoConsenso: 55 });
  t('si el chat trae el mismo valor que Juan, no hay "distinto"', igualQueJuan.distintoDelChat.precioObjetivoConsenso === undefined);
  const viejo = tesisDeItems([{ ticker: 'YPFD' }, { ticker: 'GGAL', tesis: undefined }] as Array<{ ticker?: unknown; tesis?: unknown }>);
  t('un informe viejo sin "tesis" importa igual: no genera tesis ni avisos', viejo.tesis.length === 0 && viejo.avisos.length === 0);
  t('un informe nuevo con tesis la extrae', tesisDeItems([{ ticker: 'YPFD', tesis: delChat }]).tesis.length === 1);
}

console.log('\n=== señales de §5: evento próximo y gatillo de tesis ===');
{
  const c1 = calcularTesis(T, { valor: 50, moneda: 'USD' }, { tc: 1, hoy: '2026-10-20' });
  const s1 = senalesDeTesis(c1, T, [], '2026-10-20');
  t('evento a 4 días → "Evento próximo", info', s1.senales.some(s => s.id === 'evento_proximo' && s.nivel === 'info' && s.texto === 'Balance en 4 días'));
  t('primera lectura: un gatillo nuevo NO es un cambio (sin señal)', !s1.senales.some(s => s.id === 'gatillo_tesis'));
  const T2 = { ...T, gatillos: [{ ...T.gatillos[0], valorActual: 0.28 }, T.gatillos[1]] };
  const c2 = calcularTesis(T2, { valor: 50, moneda: 'USD' }, { tc: 1, hoy: '2026-10-21' });
  const s2 = senalesDeTesis(c2, T2, s1.estado, '2026-10-21');
  const g = s2.senales.find(s => s.id === 'gatillo_tesis');
  t('el gatillo deja de cumplirse → "Gatillo de tesis", atención, con su desde', !!g && g.nivel === 'atencion' && g.desde === '2026-10-21' && g.texto.includes('dejó de cumplirse'));
  const s3 = senalesDeTesis(c2, T2, s2.estado, '2026-10-24');
  t('la señal sigue visible los días siguientes con el mismo desde', s3.senales.some(s => s.id === 'gatillo_tesis' && s.desde === '2026-10-21'));
  const s4 = senalesDeTesis(c2, T2, s2.estado, '2026-11-05');
  t('después de 10 días ya no se muestra', !s4.senales.some(s => s.id === 'gatillo_tesis'));
  const lejos = senalesDeTesis(calcularTesis({ ...T, proximoEvento: { ...T.proximoEvento, fecha: '2026-11-30' } }, { valor: 50, moneda: 'USD' }, { tc: 1, hoy: '2026-10-20' }), T, [], '2026-10-20');
  t('evento a más de 7 días → sin señal', !lejos.senales.some(s => s.id === 'evento_proximo'));
  // Entran por senalesTesis al motor de señales de H4.
  const serie: PuntoSerie[] = Array.from({ length: 40 }, (_, i) => ({ f: new Date(Date.UTC(2026, 8, 10 + i)).toISOString().slice(0, 10), o: 100, h: 101, l: 99, c: 100 + i * 0.1, v: 1000 }));
  const ind = calcIndicadores(serie, { stops: { identidad: 'YPFD|accion|AR', fechaCorrida: null, previo: null, reinicio: null, senalesTesis: s2.senales } });
  t('las señales de la tesis llegan a indicadoresPosicion.senales', !!ind.senales?.some(s => s.id === 'gatillo_tesis') && !!ind.senales?.some(s => s.id === 'evento_proximo'));
}

console.log('\n=== prompt del Chat 2 ===');
{
  const conT = buildPromptPosicionesV3({ fecha: '2026-10-20', materiales: [], menores: [], panorama: {}, conTesis: ['YPFD'], tesisPrevias: {} });
  const sinT = buildPromptPosicionesV3({ fecha: '2026-10-20', materiales: [], menores: [], panorama: {} });
  t('con conTesis: pide el bloque "tesis" con la forma de §6 y las reglas', conT.includes(ESQUEMA_TESIS) && conT.includes('NUNCA inventar') && conT.includes('Sin precio objetivo propio') && conT.includes('Lenguaje condicional'));
  t('un contexto viejo sin conTesis: el prompt de siempre, sin tesis', !sinT.includes('"tesis"') && !sinT.includes('TESIS:'));
}

console.log(`\n${ok} OK, ${fail} FAIL`);
if (fail) process.exit(1);
