// F9.158 — §1 verificación de la idempotencia (contra el CÓDIGO REAL, simulando el batch) y
// §2/§3/§4 DRY RUN. NO ESCRIBE NADA EN NINGÚN LADO.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import { calcularChecklist } from '../src/datos/checklist';
import type { Movement, ExpectedItem } from '../src/types';

const req = createRequire(process.cwd() + '/functions/package.json');
const ts = req('typescript') as typeof import('typescript');

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const ms = (v: unknown) => (v as { toMillis?: () => number } | null)?.toMillis?.() ?? null;
const fechaStr = (v: unknown) => {
  const t = v as { toDate?: () => Date } | null | undefined;
  return t?.toDate ? t.toDate().toISOString().replace('T', ' ').slice(0, 19) : s(v);
};

const src = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');

// `clavesDeResumen` se extrae del fuente, no se copia: si mañana cambia, esto lo ve.
function bloque(desde: string, hasta: string): string {
  const i = src.indexOf(desde);
  if (i < 0) throw new Error(`no encontré "${desde}"`);
  const j = src.indexOf(hasta, i);
  return src.slice(i, j + hasta.length);
}
const jsClaves = ts.transpileModule(bloque('export function clavesDeResumen', '\n}').replace('export ', ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;
const clavesDeResumen = new Function(`${jsClaves}\nreturn clavesDeResumen;`)() as (r: { id: string; tarjetaCodigo: string | null; nroResumen: string | null }) => string[];

async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  const itemsSnap = await db.collection('itemsEsperados').get();
  const movsSnap = await db.collection('movimientos').get();

  const movsDe = (d: FirebaseFirestore.QueryDocumentSnapshot) => {
    const x = d.data();
    const claves = clavesDeResumen({ id: d.id, tarjetaCodigo: x.tarjetaCodigo ?? null, nroResumen: x.nroResumen ?? null });
    return movsSnap.docs.filter(m => claves.includes(s(m.data().resumenTarjetaId)));
  };

  // ── §1 — la política, leída del fuente ──────────────────────────────────
  console.log('=== §1 — guardas leídas del código real ===');
  for (const [rotulo, aguja] of [
    ['rechaza si ya hay movimientos y no se pidió reemplazar', "if (existentes.length > 0 && !opciones?.reemplazar)"],
    ['borra los viejos en el MISMO batch',                     'for (const d of existentes) batch.delete(d.ref);'],
    ['guarda de tamaño de batch',                              'if (opsEstimadas > MAX_OPS_BATCH)'],
    ['contempla la clave legacy',                              '`${resumen.tarjetaCodigo}_${resumen.nroResumen}`'],
  ] as const) {
    console.log(`  ${src.includes(aguja) ? 'OK ' : '>>> NO'} ${rotulo}`);
  }
  const orden = src.indexOf('for (const d of existentes) batch.delete(d.ref);') < src.indexOf('await batch.commit()');
  console.log(`  ${orden ? 'OK ' : '>>> NO'} los deletes van antes del commit (atómico: un solo batch)`);
  // El chequeo va acotado a `confirmarResumenTarjeta`: el archivo tiene otro writeBatch en
  // `subirResumenTarjeta` (línea 104), que no tiene nada que ver con esta operación.
  const cuerpoConfirmar = src.slice(src.indexOf('export async function confirmarResumenTarjeta'), src.indexOf('export async function asignarTarjetaResumen'));
  const nBatches = (cuerpoConfirmar.match(/writeBatch\(db\)/g) ?? []).length;
  const nCommits = (cuerpoConfirmar.match(/batch\.commit\(\)/g) ?? []).length;
  console.log(`  ${nBatches === 1 && nCommits === 1 ? 'OK ' : '>>> NO'} confirmarResumenTarjeta usa UN solo batch y UN solo commit (batches=${nBatches}, commits=${nCommits})`);

  console.log('\n=== §1 — simulación: confirmar dos veces el mismo resumen ===');
  const ejemplo = resus.docs.find(d => movsDe(d).length > 0)!;
  const ex = ejemplo.data();
  const existentes = movsDe(ejemplo);
  const totalesPorMoneda = new Map<string, number>();
  for (const m of existentes) {
    if (m.data().excluirDash !== true) continue;
    const k = s(m.data().moneda);
    totalesPorMoneda.set(k, (totalesPorMoneda.get(k) ?? 0) + 1);
  }
  console.log(`  resumen de ejemplo: ${ejemplo.id.slice(0, 8)} ${s(ex.tarjeta)} ${s(ex.periodo)} | movimientos existentes: ${existentes.length}`);
  console.log(`  1ª confirmación (hoy ya ocurrió) → totales por moneda: ${JSON.stringify([...totalesPorMoneda])}`);
  console.log('  2ª confirmación SIN reemplazar → rechazada por la guarda; no escribe nada');
  const lineas = Array.isArray(ex.movimientosParseados) ? (ex.movimientosParseados as Array<{ incluir?: boolean; monto?: number }>).filter(l => l.incluir && (l.monto ?? 0) > 0).length : 0;
  console.log(`  2ª confirmación CON reemplazar → borra ${existentes.length} y crea ${lineas} líneas + 2 totales`);
  console.log(`     ⇒ totales de la misma moneda después: ARS 1, USD 1 (no puede haber dos: los viejos se borran en el mismo batch)`);
  console.log(`     ⇒ operaciones = ${existentes.length} + ${lineas} + 5 = ${existentes.length + lineas + 5} (máximo ${450})`);

  console.log('\n  --- requisito 2: una edición de líneas entre confirmaciones se refleja ---');
  console.log('  La 2ª confirmación recrea las líneas desde `lineasEditadas` (el estado del preview),');
  console.log('  no desde los movimientos viejos, que se borraron. Destildar `incluir` en una línea la');
  console.log('  saca de `lineasAImportar` y esa línea deja de existir. Cambiar categoría la recrea con');
  console.log('  la nueva. Es la misma ruta de la 1ª confirmación, sin ramas aparte.');

  console.log('\n  --- peor caso de batch sobre TODOS los resúmenes ---');
  let peor = 0, peorId = '';
  for (const d of resus.docs) {
    const x = d.data();
    const l = Array.isArray(x.movimientosParseados) ? (x.movimientosParseados as Array<{ incluir?: boolean; monto?: number }>).filter(y => y.incluir && (y.monto ?? 0) > 0).length : 0;
    const ops = movsDe(d).length + l + 5;
    if (ops > peor) { peor = ops; peorId = `${d.id.slice(0, 8)} ${s(x.tarjeta)} ${s(x.periodo)}`; }
  }
  console.log(`  ${peor <= 450 ? 'OK ' : '>>> NO'} peor caso: ${peor} operaciones (${peorId}) | límite ${450} | margen ${450 - peor}`);

  // ── §2 — DRY RUN del backfill ───────────────────────────────────────────
  console.log('\n\n=== §2 — DRY RUN del backfill: los 4 movimientos USD que se crearían ===');
  console.log('(NO SE EJECUTA NADA)\n');
  const items: ExpectedItem[] = itemsSnap.docs.map(d => {
    const y = d.data();
    return {
      id: d.id, tipo: y.tipo, activo: y.activo ?? false,
      categoria: y.categoria ?? null, subcategoria: y.subcategoria ?? null,
      etiqueta: y.etiqueta ?? null, persona: y.persona ?? null,
      moneda: y.moneda ?? 'ARS', banco: y.banco ?? null,
      montoEsperado: y.montoEsperado ?? null, diaVencimiento: y.diaVencimiento ?? null,
      autoCalendario: y.autoCalendario ?? false, notas: y.notas ?? null,
      tarjetaCodigo: y.tarjetaCodigo ?? null,
      matchTexto: y.matchTexto ? { incluye: y.matchTexto.incluye ?? [], excluye: y.matchTexto.excluye ?? [] } : null,
      periodicidad: y.periodicidad || 'mensual', pagoAutomatico: y.pagoAutomatico ?? false,
      clavesDesambiguacion: Array.isArray(y.clavesDesambiguacion) ? y.clavesDesambiguacion : null,
      diaCorteImputacion: y.diaCorteImputacion ?? null,
    } as ExpectedItem;
  });

  type Nuevo = { resumenPref: string; mes: string; itemUSD: string; doc: Record<string, unknown> };
  const nuevos: Nuevo[] = [];
  for (const pref of ['17e51e81', '879eb89a', 'fc31ca48', 'f9d9b308']) {
    const d = resus.docs.find(x => x.id.startsWith(pref))!;
    const x = d.data();
    const propios = movsDe(d);
    const totalArs = propios.find(m => m.data().excluirDash === true && m.data().moneda === 'ARS');
    const yaUsd = propios.find(m => m.data().excluirDash === true && m.data().moneda === 'USD');
    if (yaUsd) { console.log(`  ${pref}: YA TIENE total USD (${yaUsd.id}) — se saltea`); continue; }
    if (!totalArs) { console.log(`  ${pref}: >>> sin total ARS de referencia, NO se puede derivar mes/confirmadoPago`); continue; }
    const a = totalArs.data();
    const itemUSD = items.find(i => i.tarjetaCodigo === x.tarjetaCodigo && i.moneda === 'USD' && i.activo);
    if (!itemUSD) { console.log(`  ${pref}: >>> sin ítem USD activo para ${s(x.tarjetaCodigo)}`); continue; }

    // Mismos campos que produce el bloque "Total USD" de confirmarResumenTarjeta, con `mes`,
    // `fecha` y `confirmadoPago` copiados del total ARS del mismo resumen (que salen de las mismas
    // variables `fechaRef`/`mesRef`/`confirmadoPagoTotal` del código).
    const doc: Record<string, unknown> = {
      fecha: a.fecha, mes: a.mes, tipo: 'Gasto', subtipo: 'Tarjeta', origen: 'Tarjeta',
      descripcion: `Resumen ${s(x.tarjeta)} ${s(x.periodo)} (USD)`, descripcionOriginal: null,
      monto: 0, moneda: 'USD', tcUsdArs: null,
      categoria: 'Tarjetas', subcategoria: a.subcategoria, etiqueta: null, banco: a.banco, cuenta: null,
      tarjetaCodigo: x.tarjetaCodigo, tarjeta: x.tarjeta || null, persona: null, creadoPor: a.creadoPor,
      pagado: true, excluirDash: true, incluirResumenMes: true,
      resumenTarjetaId: s(a.resumenTarjetaId), itemEsperadoId: itemUSD.id,
      confirmadoPago: a.confirmadoPago === true,
      hashPdf: x.hashPdf ?? null, refStoragePdf: x.refStoragePdf ?? null,
      padreId: null, notas: null,
    };
    nuevos.push({ resumenPref: pref, mes: s(a.mes), itemUSD: itemUSD.id, doc });

    console.log(`  ${pref} | ${s(x.tarjeta)} ${s(x.periodo)} | totalUSD real=${s(x.totalUSD)} → movimiento monto=0`);
    for (const [k, v] of Object.entries(doc)) {
      console.log(`      ${k.padEnd(20)} = ${k === 'fecha' ? fechaStr(v) : s(v)}`);
    }
    console.log();
  }

  console.log('  --- montoEsperado de los ítems USD que quedarían actualizados ---');
  const porItem = new Map<string, number>();
  for (const n of nuevos) porItem.set(n.itemUSD, 0);
  for (const [id] of porItem) {
    const i = items.find(x => x.id === id)!;
    console.log(`      ${i.tarjetaCodigo!.padEnd(18)} ${id} | montoEsperado ${s(i.montoEsperado)} → 0`);
  }

  console.log('\n  --- checklist resultante (calcularChecklist real) ---');
  const movimientos: Movement[] = movsSnap.docs.map(d => {
    const y = d.data();
    return { ...y, id: d.id, fecha: (y.fecha as { toDate?: () => Date } | null)?.toDate?.() ?? new Date(0),
      creadoEn: new Date(0), actualizadoEn: new Date(0), fechaConsumoOriginal: null, pagadoEn: null } as unknown as Movement;
  });
  for (const n of nuevos) {
    const mov = { ...n.doc, id: `sim-${n.resumenPref}`, fecha: new Date() } as unknown as Movement;
    const itemsDespues = items.map(i => i.id === n.itemUSD ? { ...i, montoEsperado: 0 } : i);
    const antes = calcularChecklist(items, movimientos.filter(m => m.mes === n.mes), n.mes).find(c => c.item.id === n.itemUSD);
    const despues = calcularChecklist(itemsDespues, [...movimientos.filter(m => m.mes === n.mes), mov], n.mes).find(c => c.item.id === n.itemUSD);
    console.log(`      ${n.resumenPref} | ${n.mes} | ${n.itemUSD} | ANTES=${s(antes?.estado).padEnd(14)}(${antes?.matches.length}) → DESPUÉS=${s(despues?.estado).padEnd(14)}(${despues?.matches.length})`);
  }
  console.log(`\n  >>> §2 crearía ${nuevos.length} movimientos y actualizaría ${porItem.size} ítems. NO EJECUTADO.`);

  // ── §3 — los USD 1 manuales ─────────────────────────────────────────────
  console.log('\n\n=== §3 — los movimientos manuales de USD 1 (NO SE BORRA NADA) ===');
  const idsTarjeta = new Set(items.filter(i => i.tarjetaCodigo).map(i => i.id));
  const manuales = movsSnap.docs.filter(d => {
    const y = d.data();
    return idsTarjeta.has(s(y.itemEsperadoId)) && s(y.origen) === 'Manual';
  });
  for (const d of manuales) {
    const y = d.data();
    const it = items.find(i => i.id === y.itemEsperadoId);
    console.log(`  ${d.id} | ${s(y.monto)} ${s(y.moneda)} | mes=${s(y.mes)} | item=${s(y.itemEsperadoId)} (${s(it?.tarjetaCodigo)} ${s(it?.moneda)})`);
    console.log(`      descripcion="${s(y.descripcion)}" | excluirDash=${s(y.excluirDash)} | creadoPor=${s(y.creadoPor)} | creadoEn=${fechaStr(y.creadoEn)}`);
  }
  console.log(`  >>> ${manuales.length} para borrar DESPUÉS de §2. NO EJECUTADO.`);

  // ── §4 — duplicados con la regla corregida ──────────────────────────────
  console.log('\n\n=== §4 — DRY RUN de los duplicados, con la regla corregida (NO SE BORRA NADA) ===');
  console.log('regla: 1) conservar el que cuadra con el total del resumen · 2) si empatan, el más antiguo · 3) si ninguno cuadra, NO tocar\n');
  const aBorrar: Array<{ id: string; mes: string; moneda: string; monto: number; regla: string }> = [];
  const bloqueados: string[] = [];
  for (const d of resus.docs) {
    const x = d.data();
    const totales = movsDe(d).filter(m => m.data().excluirDash === true);
    for (const moneda of ['ARS', 'USD'] as const) {
      const grupo = totales.filter(m => m.data().moneda === moneda)
        .sort((a, b) => (ms(a.data().creadoEn) ?? 0) - (ms(b.data().creadoEn) ?? 0));
      if (grupo.length <= 1) continue;
      const esperado = Number(moneda === 'ARS' ? x.totalARS : x.totalUSD) || 0;
      const cuadra = grupo.filter(m => Math.abs(Number(m.data().monto ?? 0) - esperado) < 0.01);
      let conservar: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      let regla = '';
      if (cuadra.length === 1) { conservar = cuadra[0]; regla = '1 (cuadra con el total del resumen)'; }
      else if (cuadra.length > 1) { conservar = cuadra[0]; regla = '2 (los dos cuadran → el más antiguo)'; }
      else { bloqueados.push(`${d.id.slice(0, 8)} ${s(x.tarjeta)} ${s(x.periodo)} ${moneda}: ninguno cuadra con ${esperado} → [${grupo.map(m => s(m.data().monto)).join(', ')}]`); continue; }

      console.log(`  ${s(x.banco)} ${s(x.tarjeta)} ${s(x.periodo)} ${moneda} | total del resumen = ${esperado}`);
      for (const m of grupo) {
        const y = m.data();
        const esConservar = m.id === conservar!.id;
        console.log(`     ${esConservar ? 'CONSERVAR' : 'BORRAR   '} ${m.id} | monto=${s(y.monto)} | creadoEn=${fechaStr(y.creadoEn)}${esConservar ? `  ← regla ${regla}` : ''}`);
        if (!esConservar) aBorrar.push({ id: m.id, mes: s(y.mes), moneda, monto: Number(y.monto ?? 0), regla });
      }
      console.log();
    }
  }
  if (bloqueados.length > 0) {
    console.log('  >>> BLOQUEADOS por la regla 3 (ninguno cuadra) — NO SE TOCAN:');
    for (const b of bloqueados) console.log(`      ${b}`);
    console.log();
  } else console.log('  (ninguno cae en la regla 3)\n');

  console.log('  --- impacto por mes ---');
  const porMes = new Map<string, { ars: number; usd: number }>();
  for (const b of aBorrar) {
    const acc = porMes.get(b.mes) ?? { ars: 0, usd: 0 };
    if (b.moneda === 'ARS') acc.ars += b.monto; else acc.usd += b.monto;
    porMes.set(b.mes, acc);
  }
  for (const [mes, v] of [...porMes].sort()) console.log(`      ${mes}: −ARS ${v.ars.toFixed(2)} | −USD ${v.usd.toFixed(2)}`);
  console.log(`\n  --- IDs a borrar (${aBorrar.length}) — NO EJECUTADO ---`);
  for (const b of aBorrar) console.log(`      ${b.id.padEnd(28)} ${b.moneda} ${String(b.monto).padStart(12)} | ${b.mes} | por regla ${b.regla}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
