// F9.183 addendum 1 (b) — medición de la SEGUNDA PASADA del dedup antes de implementarla. SOLO LECTURA.
//
//   npx tsx scripts/verificarF9183b.ts
//
// Segunda pasada propuesta: las filas sin pareja en la primera (llave numeroCliente + vencimiento) se
// aparean contra las obligaciones ABIERTAS y VENCIDAS al momento de la subida con el mismo número de
// cliente, sin importar el vencimiento (mismo criterio: costo mínimo, tope 3 %). La primera pasada se
// resuelve completa antes.
//
// Las filas son las de la captura real (las mismas 7 que extrajo la API en docs/F9.183.txt). Las dos
// pasadas usan aparearConExistentes REAL (functions/src/agendaPagos.ts); la segunda, con el vencimiento
// fuera de la llave. "Obligación abierta" de un comprobante: el movimiento que creó (origenComprobanteId)
// sin cubrir, o el comprobante todavía en Carga sin movimiento ('extraido').
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { aparearConExistentes, type Existente, type FilaAgenda } from '../functions/src/agendaPagos';
import { aExistente } from '../functions/src/agendaDivision';

process.env.TZ = 'America/Argentina/Buenos_Aires';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const req = createRequire(process.cwd() + '/functions/package.json');
const ts = req('typescript') as typeof import('typescript');
const src = fs.readFileSync('functions/src/index.ts', 'utf8').replace(/\r\n/g, '\n');
const i0 = src.indexOf('function normalizarClaveDesambiguacion');
const normalizar = new Function(`${ts.transpileModule(src.slice(i0, src.indexOf('\n}', i0) + 2),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText}\nreturn normalizarClaveDesambiguacion;`)() as (v: unknown) => string;

const SUBIDA = '2026-10-06';
const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const h8 = (v: unknown) => String(v ?? '-').slice(0, 8);
const OBLIG = new Set(['recibo_servicio', 'factura_a', 'factura_b', 'factura_c']);

const f = (emisor: string, numeroCliente: string, monto: number, vencimiento: string, vencimientoTexto: string): FilaAgenda =>
  ({ emisor, numeroCliente, monto, moneda: 'ARS', vencimiento, vencimientoTexto });
const AGENDA: FilaAgenda[] = [
  f('AGIP Inmobiliario/ABL', '0070031265481', 76228.21, '2026-10-07', 'Vence mañana'),
  f('Edenor', '007497140070', 137509.91, '2026-10-07', 'Vence mañana'),
  f('Metrogas', '010372743000', 5291.83, '2026-10-08', 'Vence el 08/10'),
  f('AGIP Inmobiliario/ABL', '0070031265481', 92479.04, '2026-10-31', 'Vence el 31/10'),
  f('AGIP Inmobiliario/ABL', '0070031265481', 89605.43, '2026-10-31', 'Vence el 31/10'),
  f('AGIP Inmobiliario/ABL', '0070031265481', 88081.49, '2026-10-31', 'Vence el 31/10'),
  f('AGIP Inmobiliario/ABL', '0070031265481', 87084.97, '2026-10-31', 'Vence el 31/10'),
];

type Contexto = { existentes: Existente[]; abiertasVencidas: Existente[] };

/** Las dos pasadas. Devuelve, por fila, con qué se apareó y en qué pasada (null = hijo nuevo). */
function dosPasadas(filas: FilaAgenda[], ctx: Contexto) {
  const p1 = aparearConExistentes(filas, ctx.existentes, normalizar);
  const usados = new Set(p1.filter(Boolean).map(p => p!.existente.id));
  const sueltas = filas.map((_, i) => i).filter(i => !p1[i]);
  const cand = ctx.abiertasVencidas.filter(e => !usados.has(e.id)).map(e => ({ ...e, vencimiento: '*' }));
  const p2 = aparearConExistentes(sueltas.map(i => ({ ...filas[i], vencimiento: '*' })), cand, normalizar);
  return filas.map((fila, i) => {
    if (p1[i]) return { fila, pasada: 1, con: p1[i]!.existente, diff: p1[i]!.diff };
    const k = sueltas.indexOf(i);
    return p2[k] ? { fila, pasada: 2, con: ctx.abiertasVencidas.find(e => e.id === p2[k]!.existente.id)!, diff: p2[k]!.diff } : { fila, pasada: 0, con: null, diff: 0 };
  });
}

function imprimir(titulo: string, res: ReturnType<typeof dosPasadas>) {
  console.log(`\n${titulo}`);
  for (const r of res) console.log(`    ${r.fila.emisor.padEnd(22)} ${fmt(r.fila.monto).padStart(11)} · ${r.fila.vencimiento} → ` +
    (r.con ? `ya cargada en PASADA ${r.pasada}: ${h8(r.con.id)} ${r.con.emisor} ${fmt(r.con.monto)} · vence ${r.con.vencimiento} (Δ ${(100 * r.diff).toFixed(2)} %)` : 'NUEVA'));
  console.log(`    → ${res.filter(r => !r.con).length} hijos · ${res.filter(r => r.pasada === 1).length} en pasada 1 · ${res.filter(r => r.pasada === 2).length} en pasada 2`);
}

async function main() {
  console.log(`F9.183 addendum 1 (b) — SOLO LECTURA. Subida ${SUBIDA}.`);
  const [comps, movs] = await Promise.all([db.collection('comprobantes').get(), db.collection('movimientos').get()]);
  const movPorOrigen = new Map<string, FirebaseFirestore.DocumentData>();
  for (const m of movs.docs) { const o = m.data().origenComprobanteId; if (o) movPorOrigen.set(o, { id: m.id, ...m.data() }); }
  const abierta = (compId: string, estado: string, cerradas: Set<string>, abiertasForzadas: Set<string>) => {
    const m = movPorOrigen.get(compId);
    if (m && abiertasForzadas.has(m.id)) return true;
    if (m) return !cerradas.has(m.id) && m.tipo === 'Gasto' && m.pagado !== true && m.confirmadoPago !== true;
    return estado === 'extraido';   // todavía en Carga, sin movimiento: obligación abierta sin materializar
  };
  const armar = (sacar: string[] = [], abiertasForzadas: string[] = []): Contexto => {
    const forz = new Set(abiertasForzadas);
    const existentes = comps.docs.filter(d => !sacar.some(s => d.id.startsWith(s))).map(d => aExistente(d.id, d.data())).filter((e): e is Existente => !!e);
    const abiertasVencidas = existentes.filter(e => {
      const d = comps.docs.find(x => x.id === e.id)!.data();
      return OBLIG.has(d.datosExtraidos?.tipoDocumento) && e.vencimiento < SUBIDA && abierta(e.id, d.estado, new Set(), forz);
    });
    return { existentes, abiertasVencidas };
  };

  // S0 — los datos de hoy, tal cual.
  const ctx0 = armar();
  console.log(`\nuniverso de la pasada 2 con los datos de hoy (obligaciones con numeroCliente, vencidas al ${SUBIDA} y abiertas): ${ctx0.abiertasVencidas.length}`);
  for (const e of ctx0.abiertasVencidas) console.log(`    ${h8(e.id)} ${e.emisor} ${e.numeroCliente} ${fmt(e.monto)} · vence ${e.vencimiento}`);
  imprimir('S0 — datos de hoy: ¿la pasada 2 cambia algo? (esperado: lo mismo que sin ella, 4 hijos y 3 ya cargadas)', dosPasadas(AGENDA, ctx0));

  // Metrogas: a650c026 es la boleta de SEPTIEMBRE (5.291,83, vence 2026-09-14); su movimiento está pago.
  const sep = comps.docs.find(d => d.id.startsWith('a650c026'))!;
  const movSep = movPorOrigen.get(sep.id)!;
  console.log(`\nMetrogas septiembre: ${h8(sep.id)} ${fmt(sep.data().datosExtraidos.montoTotal)} vence ${sep.data().datosExtraidos.vencimientos[0].fecha} · movimiento ${h8(movSep.id)} pagado=${movSep.pagado} confirmadoPago=${movSep.confirmadoPago}`);
  console.log(`Metrogas octubre:    1f5087af 5.291,83 vence 2026-10-08 (recorte ya cargado)`);

  // S1 — el caso que pide el addendum, literal: la de septiembre impaga y vencida.
  imprimir('S1 — septiembre IMPAGA y vencida, con los datos de hoy (la de octubre YA cargada por recorte)',
    dosPasadas(AGENDA, armar([], [movSep.id])));

  // S2 — lo mismo, pero la boleta de octubre NO está cargada todavía (la agenda es la primera fuente).
  imprimir('S2 — septiembre impaga y vencida, y la de octubre SIN cargar (la agenda la trae por primera vez)',
    dosPasadas(AGENDA, armar(['1f5087af'], [movSep.id])));

  // S3 — como S2, pero la agenda también muestra la de septiembre (si la app la lista porque sigue impaga).
  const conSep = [...AGENDA, f('Metrogas', '010372743000', 5291.83, '2026-09-14', 'Venció el 14/09')];
  imprimir('S3 — como S2, y la agenda también lista la de septiembre con su vencimiento original',
    dosPasadas(conSep, armar(['1f5087af'], [movSep.id])));
  const conSepCorrida = [...AGENDA, f('Metrogas', '010372743000', 5291.83, '2026-10-08', 'Vence el 08/10')];
  imprimir('S3b — como S2, y la agenda lista la de septiembre con el vencimiento CORRIDO al 08/10 (el caso que (b) quiere cubrir)',
    dosPasadas(conSepCorrida, armar(['1f5087af'], [movSep.id])));
}

main().catch(e => { console.error(e); process.exit(1); });
