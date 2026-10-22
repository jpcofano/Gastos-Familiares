// F9.196 H5 — tesis por acción: P/E con y sin conversión de moneda, potencial, gatillos con los dos
// operadores, el campo editado que no se pisa, la señal de gatillo que cambia, el evento próximo y un
// informe viejo sin `tesis` que importa igual. Sin red ni Firestore.
// Correr: npx tsx functions/src/h5.test.ts   → exit 1 si algo falla.
import {
  normalizarTesis, fusionarTesis, editarTesis, calcularTesis, senalesDeTesis, type Tesis,
  editarValorGatillo, aceptarDatoDelChat, aceptarGatilloDelChat, claveGatillo,
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

console.log('\n=== arreglos de la revisión de H5 ===');
{
  const m = normalizarTesis({ ...delChat, monedaFundamentals: 'ars', proximoEvento: { fecha: '2026-10-24', tipo: 'Balance', texto: '' }, epsGuiaMin: '2.5' }).tesis as Tesis;
  t('moneda y tipo sin importar mayúsculas; un número en texto se lee', m.monedaFundamentals === 'ARS' && m.proximoEvento.tipo === 'balance' && m.epsGuiaMin === 2.5);
  const inv = normalizarTesis({ ...delChat, monedaFundamentals: 'EUR' });
  t('moneda inválida → null (no se asume USD) y P/E con motivo sin_moneda',
    inv.tesis?.monedaFundamentals === null && calcularTesis(inv.tesis!, { valor: 50, moneda: 'USD' }, { tc: 1500, hoy: '2026-10-20' }).motivo === 'sin_moneda');
  t('EPS negativo en el rango → P/E null con motivo', (() => { const c = calcularTesis({ ...T, epsGuiaMin: -1, epsGuiaMax: 3 }, { valor: 50, moneda: 'USD' }, { tc: 1, hoy: '2026-10-20' }); return c.pe === null && c.motivo === 'eps_no_positivo'; })());
  t('sin EPS → P/E null con motivo sin_eps', calcularTesis({ ...T, epsGuiaMin: null, epsGuiaMax: null }, { valor: 50, moneda: 'USD' }, { tc: 1, hoy: '2026-10-20' }).motivo === 'sin_eps');
  // Dos gatillos con la misma métrica vacía y el mismo umbral: cada uno con su estado.
  const dos: Tesis = { ...T, gatillos: [
    { texto: 'X', metrica: '', operador: '>=', umbral: 1, valorActual: 2 },
    { texto: 'Y', metrica: '', operador: '>=', umbral: 1, valorActual: 0 },
  ] };
  const c = calcularTesis(dos, { valor: 50, moneda: 'USD' }, { tc: 1, hoy: '2026-10-20' });
  const e1 = senalesDeTesis(c, dos, [], '2026-10-20');
  const e2 = senalesDeTesis(c, dos, e1.estado, '2026-10-21');
  t('gatillos de igual métrica y umbral no se pisan: sin cambios, sin señal', !e2.senales.some(x => x.id === 'gatillo_tesis') && new Set(e1.estado.map(x => x.clave)).size === 2);
  // cumplido → sin dato → no cumplido: es un cambio.
  const g = (v: number | null): Tesis => ({ ...T, gatillos: [{ texto: 'Z', metrica: 'z', operador: '>=', umbral: 1, valorActual: v }] });
  const calc = (v: number | null) => calcularTesis(g(v), { valor: 50, moneda: 'USD' }, { tc: 1, hoy: '2026-10-20' });
  const a1 = senalesDeTesis(calc(2), g(2), [], '2026-10-20');
  const a2 = senalesDeTesis(calc(null), g(null), a1.estado, '2026-10-21');
  const a3 = senalesDeTesis(calc(0), g(0), a2.estado, '2026-10-22');
  t('cumplido → sin dato → no cumplido: sale "dejó de cumplirse"', a2.estado[0].cumplido === true && a3.senales.some(x => x.id === 'gatillo_tesis' && x.texto.includes('dejó de cumplirse')));
  const r = tesisDeItems([{ ticker: 'PAMP', resultado: { tesis: delChat } }, { ticker: 'A/B', tesis: delChat }]);
  t('tesis dentro de "resultado" → se importa con aviso; ticker con "/" → aviso, no se guarda', r.tesis.length === 1 && r.tesis[0].ticker === 'PAMP' && r.avisos.some(x => x.includes('dentro de "resultado"')) && r.avisos.some(x => x.startsWith('A/B')));
}

console.log('\n=== edición por gatillo y "usar el del chat" (revisión de H6) ===');
{
  const base = fusionarTesis(null, 'YPFD', T);
  const k0 = claveGatillo(T.gatillos[0]);
  const ed = editarValorGatillo(base, k0, 0.25);
  const nuevoChat: Tesis = { ...T, gatillos: [{ ...T.gatillos[0], valorActual: 0.33 }, { ...T.gatillos[1], valorActual: 1.8 }, { texto: 'Nuevo', metrica: 'n', operador: '>=', umbral: 1, valorActual: 2 }] };
  const re = fusionarTesis(ed, 'YPFD', nuevoChat);
  t('editar un gatillo no congela los demás: el chat actualiza el resto y agrega los nuevos',
    re.tesis.gatillos.length === 3 && re.tesis.gatillos[0].valorActual === 0.25 && re.tesis.gatillos[1].valorActual === 1.8 && !re.editadoPorJuan.gatillos);
  t('el gatillo editado guarda el dato distinto del chat', re.gatillosDistintos?.[k0] === 0.33);
  const ac = aceptarGatilloDelChat(re, k0);
  t('"usar el del chat" en un gatillo: vuelve el valor del chat y deja de estar editado', ac.tesis.gatillos[0].valorActual === 0.33 && !(k0 in (ac.gatillosEditados ?? {})) && !(k0 in (ac.gatillosDistintos ?? {})));
  const e2 = fusionarTesis(editarTesis(base, 'precioObjetivoConsenso', 55), 'YPFD', { ...T, precioObjetivoConsenso: 70 });
  const a2 = aceptarDatoDelChat(e2, 'precioObjetivoConsenso');
  t('"usar el del chat" en un campo: queda el 70 y deja de estar editado', a2.tesis.precioObjetivoConsenso === 70 && !a2.editadoPorJuan.precioObjetivoConsenso && a2.distintoDelChat.precioObjetivoConsenso === undefined);
  // Firestore puede devolver los mapas con las claves en otro orden: eso no es "distinto".
  const ev = editarTesis(base, 'proximoEvento', { ...T.proximoEvento });
  const desordenado = { ...ev, tesis: { ...ev.tesis, proximoEvento: { texto: T.proximoEvento.texto, tipo: T.proximoEvento.tipo, fecha: T.proximoEvento.fecha } } };
  t('mismo valor con otro orden de claves → no queda "distinto"', fusionarTesis(desordenado, 'YPFD', T).distintoDelChat.proximoEvento === undefined);
}

console.log('\n=== F9.196.1 §2: ratio con el subyacente y valores absurdos ===');
{
  // GGAL: consenso del ADR (US$ 60 por ADR, 1 ADR = 10 acciones). Precio local $ 6.000, MEP 1.500.
  // Sin ratio: precio en USD = 4 → consenso 15 veces el precio → fuera de escala.
  const ggal: Tesis = { ...T, epsGuiaMin: 4, epsGuiaMax: 6, precioObjetivoConsenso: 60, ratioSubyacente: null };
  const sinRatio = calcularTesis(ggal, { valor: 6000, moneda: 'ARS' }, { tc: 1500, hoy: '2026-10-20' });
  t('acción local con consenso del ADR y sin ratio → potencial null, consenso_fuera_de_escala', sinRatio.potencial === null && sinRatio.motivoPotencial === 'consenso_fuera_de_escala', sinRatio);
  const conRatio = calcularTesis({ ...ggal, ratioSubyacente: { valor: 10, tipo: 'adr', fuente: 'BNY Mellon', fecha: '2026-10-01' } }, { valor: 6000, moneda: 'ARS' }, { tc: 1500, hoy: '2026-10-20' });
  t('con ratio 10 → precio del ADR US$ 40, potencial +50% y P/E 8', Math.abs((conRatio.potencial ?? 0) - 0.5) < 1e-9 && Math.abs((conRatio.pe ?? 0) - 8) < 1e-9 && conRatio.ratioUsado?.valor === 10, conRatio);
  // CEDEAR: 20 CEDEARs = 1 acción. CEDEAR $ 3.000 → acción $ 60.000 → US$ 40; EPS 2 → P/E 20.
  const cedear = calcularTesis({ ...T, epsGuiaMin: 2, epsGuiaMax: 2, precioObjetivoConsenso: 48, ratioSubyacente: { valor: 20, tipo: 'cedear', fuente: 'BYMA', fecha: null } }, { valor: 3000, moneda: 'ARS' }, { tc: 1500, hoy: '2026-10-20', esCedear: true });
  t('CEDEAR con ratio → P/E calculado (20) y potencial (+20%)', Math.abs((cedear.pe ?? 0) - 20) < 1e-9 && Math.abs((cedear.potencial ?? 0) - 0.2) < 1e-9 && cedear.motivo === null, cedear);
  t('CEDEAR sin ratio → sigue cedear_sin_ratio', calcularTesis({ ...T, ratioSubyacente: null }, { valor: 3000, moneda: 'ARS' }, { tc: 1500, hoy: '2026-10-20', esCedear: true }).motivo === 'cedear_sin_ratio');
  const peRaro = calcularTesis({ ...T, epsGuiaMin: 0.01, epsGuiaMax: 0.01, precioObjetivoConsenso: null }, { valor: 50, moneda: 'USD' }, { tc: 1, hoy: '2026-10-20' });
  t('P/E de más de 300 → null, pe_fuera_de_escala', peRaro.pe === null && peRaro.motivo === 'pe_fuera_de_escala', peRaro);
  const n1 = normalizarTesis({ ...delChat, ratioSubyacente: { valor: 10, tipo: 'ADR', fuente: 'BNY', fecha: '2026-10-01' } });
  const n2 = normalizarTesis({ ...delChat, ratioSubyacente: { valor: 0, tipo: 'adr' } });
  const n3 = normalizarTesis(delChat);
  t('normalizar: ratio válido (tipo sin importar mayúsculas); valor 0 → null con aviso; sin el campo → null sin aviso',
    n1.tesis?.ratioSubyacente?.tipo === 'adr' && n1.tesis.ratioSubyacente.valor === 10 && n2.tesis?.ratioSubyacente === null && n2.avisos.some(x => x.includes('ratioSubyacente'))
    && n3.tesis?.ratioSubyacente === null && !n3.avisos.some(x => x.includes('ratioSubyacente')));
  const ed = fusionarTesis(editarTesis(fusionarTesis(null, 'GGAL', n3.tesis!), 'ratioSubyacente', { valor: 10, tipo: 'adr', fuente: 'Juan', fecha: null }), 'GGAL', n1.tesis!);
  t('el ratio editado por Juan no lo pisa el chat (queda "distinto")', ed.tesis.ratioSubyacente?.fuente === 'Juan' && ed.distintoDelChat.ratioSubyacente !== undefined);
}

console.log('\n=== prompt del Chat 2 ===');
{
  const conT = buildPromptPosicionesV3({ fecha: '2026-10-20', materiales: [], menores: [], panorama: {}, conTesis: ['YPFD'], tesisPrevias: {} });
  const sinT = buildPromptPosicionesV3({ fecha: '2026-10-20', materiales: [], menores: [], panorama: {} });
  t('con conTesis: pide el bloque "tesis" con la forma de §6 y las reglas', conT.includes(ESQUEMA_TESIS) && conT.includes('NUNCA inventar') && conT.includes('Sin precio objetivo propio') && conT.includes('Lenguaje condicional'));
  t('el prompt pide ratioSubyacente con fuente y prohíbe inventarlo', ESQUEMA_TESIS.includes('ratioSubyacente') && conT.includes('banco depositario') && conT.includes('NUNCA inventarlo'));
  t('un contexto viejo sin conTesis: el prompt de siempre, sin tesis', !sinT.includes('"tesis"') && !sinT.includes('TESIS:'));
}

console.log(`\n${ok} OK, ${fail} FAIL`);
if (fail) process.exit(1);
