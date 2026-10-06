// F9.182 §0 — medición antes de partir la "Agenda de pagos" en comprobantes hijos. SOLO LECTURA.
//
//   npx tsx scripts/verificarF9182.ts
//
// 0.1 los recortes de AGIP / Edenor / Metrogas ya subidos: propuesta, ítem final, confirmación
// 0.2 (se cita en docs/F9.182.txt: es lectura de código, no de datos)
// 0.3 factura real DESPUÉS de una obligación nacida de un recorte/hijo: qué rama sale
// 0.4 ABL con 5 obligaciones en 2026-10: calcularChecklist real + esCargoAdicional + matchPorDestino
//
// matchPorDestino es el REAL: se recorta de functions/src/index.ts (no se puede importar sin levantar
// firebase-functions) y corre contra producción, donde solo LEE `destinos`. calcularChecklist y los
// conversores son los del cliente, cargados con scripts/simConfirmarResumen.ts. Nada se escribe.
//
// Privacidad: ids a 8 caracteres. Los números de cliente ya figuran en el prompt de la fase.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as ML from '../functions/src/matchLogica';
import type { DatosExtractosMin, MovimientoMin, ItemEsperadoMin, PropuestaMatch } from '../functions/src/matchLogica';
import { crearSim } from './simConfirmarResumen';
import type { ExpectedItem, Movement } from '../src/types';
import type { CheckItem } from '../src/datos/checklist';

process.env.TZ = 'America/Argentina/Buenos_Aires';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const sim = crearSim(db);

const req = createRequire(process.cwd() + '/functions/package.json');
const ts = req('typescript') as typeof import('typescript');

// ── matchPorDestino real ──────────────────────────────────────────────────────
const srcFn = fs.readFileSync('functions/src/index.ts', 'utf8').replace(/\r\n/g, '\n');
const bl = (d: string, h: string) => {
  const i = srcFn.indexOf(d);
  if (i < 0) throw new Error(`no está en index.ts: ${d}`);
  return srcFn.slice(i, srcFn.indexOf(h, i) + h.length);
};
const codigo = ts.transpileModule([
  bl('function mesDePago', '\n}'),
  bl('const UMBRAL_AUTO =', ';'),
  bl('function idDestinoNorm', '\n}'),
  bl('function normalizarClaveDesambiguacion', '\n}'),
  bl('function resolverItemDeDestino', '\n  return base;\n}'),
  bl('async function matchPorDestino', '\n  return null;\n}'),
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
const { matchPorDestino, mesDePago } = new Function('db', 'createHash', 'ML', `
  const { normalizarDestino, destinoResuelve, mesImputado, esObligacionFutura, obligacionSaldable, esCargoAdicional } = ML;
  ${codigo}
  return { matchPorDestino, mesDePago };`)(db, createHash, ML) as {
  matchPorDestino: (d: DatosExtractosMin, movs: MovimientoMin[], mesComp: string, items: ItemEsperadoMin[], refISO: string) =>
    Promise<Omit<PropuestaMatch, 'calculadoEn'> | null>;
  mesDePago: (d: DatosExtractosMin) => string;
};

type ChkMod = { calcularChecklist: (items: ExpectedItem[], movs: Movement[], mes: string) => CheckItem[] };
type MovMod = { docAMovimiento: (id: string, data: FirebaseFirestore.DocumentData) => Movement };
type ItemsMod = { docAItemEsperado: (id: string, data: FirebaseFirestore.DocumentData) => ExpectedItem };
const CHK = sim.cargar<ChkMod>('src/datos/checklist.ts');
const MOV = sim.cargar<MovMod>('src/datos/movimientos.ts');
const ITEMS = sim.cargar<ItemsMod>('src/datos/itemsEsperados.ts');

// ── salida ────────────────────────────────────────────────────────────────────
const h8 = (v: unknown) => (v ? String(v).slice(0, 8) : '-');
const s = (v: unknown) => (v === null ? 'null' : v === undefined ? '(ausente)' : String(v));
const fechaAR = (v: unknown) => {
  const t = v as { toDate?: () => Date } | null | undefined;
  return t?.toDate ? t.toDate().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }) : s(v);
};
const prop = (p: Omit<PropuestaMatch, 'calculadoEn'> | null) => p
  ? `rama ${p.rama}${p.itemEsperadoId ? ` item=${h8(p.itemEsperadoId)}` : ''}${p.movimientoId ? ` mov=${h8(p.movimientoId)}` : ''}` +
    `${p.esAdicional !== undefined ? ` esAdicional=${p.esAdicional}` : ''}${p.requiereConfirmacion !== undefined ? ` requiereConfirmacion=${p.requiereConfirmacion}` : ''}`
  : 'null (sin destino: sigue por texto)';

const ITEM = { ABL: '62a96fc83be3b3506032', EDENOR: '1d186f3b678a358a4af1' };
const NUMEROS = ['70031265481', '7497140070', '10372743000'];

// Mismo armado que matchComprobante (index.ts): ventana [mes-1 … mes+3] e ítems activos.
async function contexto(mesComp: string) {
  const meses: string[] = [];
  const [y, m] = mesComp.split('-').map(Number);
  for (let delta = -1; delta <= 3; delta++) {
    const d = new Date(y, m - 1 + delta);
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const [movsSnap, itemsSnap] = await Promise.all([
    db.collection('movimientos').where('mes', 'in', meses).get(),
    db.collection('itemsEsperados').where('activo', '==', true).get(),
  ]);
  const movs: MovimientoMin[] = movsSnap.docs.map(d => {
    const x = d.data();
    return {
      id: d.id, monto: x.monto, moneda: x.moneda, tipo: x.tipo,
      fecha: (x.fecha as Timestamp | null)?.toDate() ?? new Date(0), mes: x.mes, descripcion: x.descripcion ?? '',
      itemEsperadoId: x.itemEsperadoId ?? null, destinoCuit: x.destinoCuit ?? null, destinoCbu: x.destinoCbu ?? null,
      destinoAlias: x.destinoAlias ?? null, destinoNombre: x.destinoNombre ?? null, vencimientos: x.vencimientos ?? null,
      confirmadoPago: x.confirmadoPago ?? false, origenComprobanteId: x.origenComprobanteId ?? null,
    };
  });
  const items: ItemEsperadoMin[] = itemsSnap.docs.map(d => {
    const x = d.data();
    const mt = x.matchTexto as { incluye?: string[]; excluye?: string[] } | null;
    return {
      id: d.id, tipo: x.tipo, moneda: x.moneda, activo: x.activo ?? false,
      matchTexto: mt ? { incluye: mt.incluye ?? [], excluye: mt.excluye ?? [] } : null,
      categoria: x.categoria ?? null, subcategoria: x.subcategoria ?? null, notas: x.notas ?? null,
      montoEsperado: x.montoEsperado ?? null,
      clavesDesambiguacion: Array.isArray(x.clavesDesambiguacion) ? x.clavesDesambiguacion : null,
      diaCorteImputacion: x.diaCorteImputacion ?? null,
    };
  });
  return { movs, items };
}

async function main() {
  console.log('F9.182 §0 — SOLO LECTURA. Nada se escribe.\n');
  const [comps, todosItems] = await Promise.all([
    db.collection('comprobantes').get(),
    db.collection('itemsEsperados').get(),
  ]);
  const nombreItem = new Map(todosItems.docs.map(d => [d.id, `${d.data().categoria ?? '?'} › ${d.data().subcategoria ?? '?'}${d.data().descripcion ? ` (${d.data().descripcion})` : ''}`]));
  const nItem = (id: unknown) => (id ? `${h8(id)} ${nombreItem.get(String(id)) ?? '(no existe)'}` : '-');

  // ── 0.1 ───────────────────────────────────────────────────────────────────
  console.log('── 0.1 recortes de AGIP / Edenor / Metrogas (imagen) y, como referencia, los PDF del mismo emisor');
  const re = /AGIP|EDENOR|METROGAS/i;
  const relevantes = comps.docs.filter(d => {
    const de = d.data().datosExtraidos ?? {};
    const nc = String(de.numeroCliente ?? '').replace(/^0+/, '');
    return re.test(`${de.comercioRazonSocial ?? ''} ${de.destinoNombre ?? ''}`) || NUMEROS.includes(nc);
  }).sort((a, b) => fechaAR(a.data().subidoEn).localeCompare(fechaAR(b.data().subidoEn)));
  let imagenes = 0, correctos = 0, silenciosos = 0;
  for (const d of relevantes) {
    const x = d.data(); const de = x.datosExtraidos ?? {}; const pm = x.propuestaMatch ?? {};
    const esImagen = String(x.contentType ?? '').startsWith('image/');
    // El movimiento que CREÓ este comprobante: origenComprobanteId. Por hashPdf solo como respaldo —
    // un pago posterior por rama 1 (confirmarRama1) pisa el hashPdf de la obligación con el suyo.
    let movs = (await db.collection('movimientos').where('origenComprobanteId', '==', d.id).get()).docs;
    if (!movs.length) movs = (await db.collection('movimientos').where('hashPdf', '==', d.id).get()).docs;
    const mov = movs[0]?.data();
    const finalItem = mov?.itemEsperadoId ?? null;
    const llego = pm.itemEsperadoId && finalItem === pm.itemEsperadoId;
    const modo = pm.rama === 2 ? (pm.requiereConfirmacion === false ? 'ALTA SILENCIOSA (≥ UMBRAL_AUTO)' : pm.requiereConfirmacion === true ? `con confirmación (confianza ${s(pm.confianza)})` : 'rama 2 anterior a F9.106 (sin requiereConfirmacion)') : `rama ${s(pm.rama)}`;
    if (esImagen) {
      imagenes++;
      if (llego) correctos++;
      if (pm.requiereConfirmacion === false) silenciosos++;
    }
    console.log(`  ${h8(d.id)} ${esImagen ? 'IMAGEN' : 'pdf   '} subido ${fechaAR(x.subidoEn).slice(0, 10)} | ${s(de.tipoDocumento)} | ${s(de.comercioRazonSocial)} | nº cliente ${s(de.numeroCliente)} | ${s(de.montoTotal)} | venc ${JSON.stringify((de.vencimientos ?? []).map((v: { fecha: string }) => v.fecha))}`);
    console.log(`           propuesta: ${modo}, item=${nItem(pm.itemEsperadoId)}${pm.esAdicional !== undefined ? `, esAdicional=${pm.esAdicional}` : ''} | estado ${s(x.estado)}`);
    console.log(`           movimiento: ${mov ? `${mov.origenComprobanteId === d.id ? 'creado' : 'vinculado'} ` + `${h8(movs[0].id)} mes ${s(mov.mes)} item=${nItem(finalItem)} confirmadoPago=${s(mov.confirmadoPago)} origenComprobanteId=${h8(mov.origenComprobanteId)}` : '(ninguno con origenComprobanteId ni hashPdf = este id)'}` +
      `${pm.itemEsperadoId ? ` → ${llego ? 'llegó a su ítem' : '✗ NO llegó al ítem propuesto'}` : ''}`);
  }
  console.log(`  IMÁGENES: ${imagenes} | llegaron al ítem propuesto: ${correctos} | altas silenciosas: ${silenciosos}`);

  // ── 0.3 ───────────────────────────────────────────────────────────────────
  console.log('\n── 0.3 factura real de Edenor DESPUÉS de la obligación nacida de un recorte (= forma de un hijo)');
  const datosFactura: DatosExtractosMin = {
    tipoDocumento: 'recibo_servicio', fecha: '2026-09-29', montoTotal: 137509.91, moneda: 'ARS',
    comercioRazonSocial: 'Empresa Distribuidora y Comercializadora Norte S.A. (Edenor)',
    numeroCliente: '7497140070', vencimientos: [{ fecha: '2026-10-07', monto: 137509.91 }],
    destinoCuit: '30655116202', destinoNombre: 'Empresa Distribuidora y Comercializadora Norte S.A. (Edenor)',
    destinoCbu: null, destinoAlias: null, direccion: 'saliente',
  } as DatosExtractosMin;
  const mes = mesDePago(datosFactura);
  const ctx = await contexto(mes);
  const oblEdenor = ctx.movs.filter(m => m.itemEsperadoId === ITEM.EDENOR && m.mes === mes);
  console.log(`  obligaciones reales de Edenor en ${mes}: ${oblEdenor.length ? oblEdenor.map(m => `${h8(m.id)} ${m.monto} confirmadoPago=${m.confirmadoPago} origenComprobanteId=${h8(m.origenComprobanteId)}`).join(' | ') : '(ninguna)'}`);
  let movs03 = ctx.movs;
  if (!oblEdenor.some(m => m.origenComprobanteId)) {
    // Si el recorte de octubre no generó obligación todavía, se simula la que crearía el hijo.
    movs03 = [...ctx.movs, { id: 'SIM-hijo-edenor', monto: 137509.91, moneda: 'ARS', tipo: 'Gasto', fecha: new Date('2026-10-07T12:00:00'),
      mes, descripcion: 'Edenor', itemEsperadoId: ITEM.EDENOR, destinoCuit: null, destinoCbu: null, destinoAlias: null,
      destinoNombre: 'Edenor', vencimientos: [{ monto: 137509.91 }], confirmadoPago: false, origenComprobanteId: 'SIM-hijo' }];
    console.log('  (se agrega una obligación SIMULADA de Edenor nacida de un hijo, impaga)');
  }
  for (const [caso, ref] of [['factura subida ANTES del vencimiento (2026-10-02)', '2026-10-02'],
                              ['factura subida el día del vencimiento (2026-10-07)', '2026-10-07'],
                              ['factura subida DESPUÉS del vencimiento (2026-10-08)', '2026-10-08']] as const) {
    const p = await matchPorDestino(datosFactura, movs03, mes, ctx.items, ref);
    const dup = !(p?.rama === 1);
    console.log(`  ${caso}: ${prop(p)} → ${dup ? '✗ NO es rama 1: la card propone crear otra obligación (DUPLICADO)' : 'rama 1 OK'}`);
  }
  // La misma pregunta en la otra dirección: la fila de la agenda llega cuando el recorte ya creó la obligación.
  const datosHijo: DatosExtractosMin = {
    tipoDocumento: 'recibo_servicio', fecha: null, montoTotal: 137509.91, moneda: 'ARS', comercioRazonSocial: 'Edenor',
    numeroCliente: '007497140070', vencimientos: [{ fecha: '2026-10-07', monto: 137509.91 }],
    destinoNombre: 'Edenor', destinoCuit: null, destinoCbu: null, destinoAlias: null, direccion: 'saliente',
  } as DatosExtractosMin;
  const pHijo = await matchPorDestino(datosHijo, movs03, mes, ctx.items, '2026-10-06');
  console.log(`  y al revés — hijo de la agenda (Edenor 137.509,91, vence 2026-10-07, subido 2026-10-06) con esa obligación ya creada: ${prop(pHijo)}`);

  // ── 0.4 ───────────────────────────────────────────────────────────────────
  console.log('\n── 0.4 ABL en 2026-10 con 5 obligaciones abiertas de la partida 0070031265481');
  const montos = [76228.21, 92479.04, 89605.43, 88081.49, 87084.97];
  const vtos = ['2026-10-07', '2026-10-31', '2026-10-31', '2026-10-31', '2026-10-31'];
  const ablDoc = todosItems.docs.find(d => d.id === ITEM.ABL)!;
  const ablItem = ITEMS.docAItemEsperado(ablDoc.id, ablDoc.data());
  console.log(`  ítem: ${nItem(ITEM.ABL)} | montoEsperado=${s(ablDoc.data().montoEsperado)} | activo=${s(ablDoc.data().activo)}`);
  const realesABL = (await db.collection('movimientos').where('itemEsperadoId', '==', ITEM.ABL).where('mes', '==', '2026-10').get()).docs;
  console.log(`  obligaciones REALES de ABL en 2026-10 hoy: ${realesABL.length ? realesABL.map(d => `${h8(d.id)} ${d.data().monto} confirmadoPago=${d.data().confirmadoPago} origen=${h8(d.data().origenComprobanteId)}`).join(' | ') : '(ninguna)'}`);
  const plantilla = realesABL[0]?.data() ?? {};
  const sinteticas = montos.map((monto, i) => ({
    id: `SIM-abl-${i + 1}`,
    data: { ...plantilla, monto, mes: '2026-10', itemEsperadoId: ITEM.ABL, tipo: 'Gasto', moneda: 'ARS', confirmadoPago: false, pagado: false,
      fecha: Timestamp.fromDate(new Date(`${vtos[i]}T12:00:00`)), vencimientos: [{ fecha: vtos[i], monto }],
      origenComprobanteId: `SIM-hijo-${i + 1}`, hashPdf: `SIM-hijo-${i + 1}`, descripcion: 'AGIP Inmobiliario/ABL' },
  }));

  // (a) lo que decide el matcher, hijo por hijo, en el orden de la agenda: cada uno ve las obligaciones de los anteriores.
  console.log('  (a) matchPorDestino real, hijo por hijo (subidos 2026-10-06), cada uno con las obligaciones que crearon los anteriores:');
  const ctxAbl = await contexto('2026-10');
  const base = ctxAbl.movs.filter(m => !(m.itemEsperadoId === ITEM.ABL && m.mes === '2026-10'));
  const acumuladas: MovimientoMin[] = [];
  for (let i = 0; i < montos.length; i++) {
    const datos = { tipoDocumento: 'recibo_servicio', fecha: null, montoTotal: montos[i], moneda: 'ARS', comercioRazonSocial: 'AGIP Inmobiliario/ABL',
      numeroCliente: '0070031265481', vencimientos: [{ fecha: vtos[i], monto: montos[i] }], destinoNombre: 'AGIP Inmobiliario/ABL',
      destinoCuit: null, destinoCbu: null, destinoAlias: null, direccion: 'saliente' } as DatosExtractosMin;
    const p = await matchPorDestino(datos, [...base, ...acumuladas], '2026-10', ctxAbl.items, '2026-10-06');
    const futura = ML.esObligacionFutura(datos, '2026-10-06');
    console.log(`      ${i + 1}. ${montos[i]} vence ${vtos[i]} → ${prop(p)}${futura ? '  [esObligacionFutura = true]' : ''}`);
    acumuladas.push({ id: sinteticas[i].id, monto: montos[i], moneda: 'ARS', tipo: 'Gasto', fecha: new Date(`${vtos[i]}T12:00:00`), mes: '2026-10',
      descripcion: 'AGIP', itemEsperadoId: ITEM.ABL, destinoCuit: null, destinoCbu: null, destinoAlias: null, destinoNombre: 'AGIP Inmobiliario/ABL',
      vencimientos: [{ monto: montos[i] }], confirmadoPago: false, origenComprobanteId: `SIM-hijo-${i + 1}` });
  }
  // (b) esCargoAdicional sobre el conjunto ya creado: lo que diría la reasignación de cada una.
  console.log('  (b) esCargoAdicional(las 5, excluyendo a cada una, entra recibo_servicio):');
  for (let i = 0; i < acumuladas.length; i++)
    console.log(`      ${i + 1}. ${montos[i]} → esCargoAdicional=${ML.esCargoAdicional(acumuladas, acumuladas[i].id, 'recibo_servicio')}`);
  // (c) el checklist del cliente con las 5 (sin las reales de ABL de octubre, para aislar el caso).
  const resumir = (c: CheckItem) =>
    `estado=${c.estado} | matches=${c.matches.length} [${c.matches.map(m => `${m.monto}${m.confirmadoPago ? ' pagada' : ''}`).join(', ')}]${c.disputas?.length ? ` | disputas=${c.disputas.length}` : ''}`;
  const movsChk = sinteticas.map(x => MOV.docAMovimiento(x.id, x.data));
  console.log('  (c) calcularChecklist real, ítem ABL, 2026-10 (el checklist da UN estado por ítem; no marca adicionales):');
  for (const c of CHK.calcularChecklist([ablItem], movsChk, '2026-10')) console.log(`      las 5 impagas: ${resumir(c)}`);
  // (d) se paga SOLO la del mes (la primera): ¿qué ve el usuario de las 4 cuotas atrasadas?
  const movsD = sinteticas.map((x, i) => MOV.docAMovimiento(x.id, { ...x.data, confirmadoPago: i === 0, pagado: i === 0 }));
  for (const c of CHK.calcularChecklist([ablItem], movsD, '2026-10')) console.log(`      pagada solo la del mes:     ${resumir(c)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
