// F9.158 §2 — ESCRIBE. Crea los 4 movimientos-total USD en cero que faltan y actualiza los dos
// `montoEsperado` que están en null. Autorizado por el dueño después de ver el dry run.
//
// Idempotente: si el resumen ya tiene un movimiento-total USD, lo saltea. Correrlo dos veces no
// duplica — que es exactamente el bug que arregló §1 y que sería absurdo reintroducir acá.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';

const req = createRequire(process.cwd() + '/functions/package.json');
const ts = req('typescript') as typeof import('typescript');

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const fechaStr = (v: unknown) => {
  const t = v as { toDate?: () => Date } | null | undefined;
  return t?.toDate ? t.toDate().toISOString().replace('T', ' ').slice(0, 19) : s(v);
};

// `clavesDeResumen` sale del código real, no de una copia.
const src = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
const i = src.indexOf('export function clavesDeResumen');
const j = src.indexOf('\n}', i);
const jsClaves = ts.transpileModule(src.slice(i, j + 2).replace('export ', ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;
const clavesDeResumen = new Function(`${jsClaves}\nreturn clavesDeResumen;`)() as
  (r: { id: string; tarjetaCodigo: string | null; nroResumen: string | null }) => string[];

const PREFIJOS = ['17e51e81', '879eb89a', 'fc31ca48', 'f9d9b308'];

async function main() {
  const aplicar = process.argv.includes('--apply');
  console.log(aplicar ? '=== MODO ESCRITURA (--apply) ===\n' : '=== dry run (sin --apply) ===\n');

  const resus = await db.collection('resumenesTarjeta').get();
  const itemsSnap = await db.collection('itemsEsperados').get();
  const movsSnap = await db.collection('movimientos').get();

  const batch = db.batch();
  const creados: Array<{ pref: string; id: string; doc: Record<string, unknown> }> = [];
  const itemsAActualizar = new Map<string, number>();
  let salteados = 0;

  for (const pref of PREFIJOS) {
    const d = resus.docs.find(x => x.id.startsWith(pref));
    if (!d) { console.log(`  ${pref}: >>> resumen no encontrado, SE SALTEA`); salteados++; continue; }
    const x = d.data();
    const claves = clavesDeResumen({ id: d.id, tarjetaCodigo: x.tarjetaCodigo ?? null, nroResumen: x.nroResumen ?? null });
    const propios = movsSnap.docs.filter(m => claves.includes(s(m.data().resumenTarjetaId)));

    const yaUsd = propios.find(m => m.data().excluirDash === true && m.data().moneda === 'USD');
    if (yaUsd) { console.log(`  ${pref}: ya tiene total USD (${yaUsd.id}) — SE SALTEA (idempotencia)`); salteados++; continue; }

    const totalArs = propios.find(m => m.data().excluirDash === true && m.data().moneda === 'ARS');
    if (!totalArs) { console.log(`  ${pref}: >>> sin total ARS de referencia, SE SALTEA`); salteados++; continue; }
    const a = totalArs.data();

    const itemUSD = itemsSnap.docs.find(it =>
      it.data().tarjetaCodigo === x.tarjetaCodigo && it.data().moneda === 'USD' && it.data().activo === true);
    if (!itemUSD) { console.log(`  ${pref}: >>> sin ítem USD activo para ${s(x.tarjetaCodigo)}, SE SALTEA`); salteados++; continue; }

    // Mismos campos que el bloque "Total USD" de confirmarResumenTarjeta. `fecha`, `mes` y
    // `confirmadoPago` se copian del total ARS del mismo resumen: salen de las mismas variables
    // (fechaRef / mesRef / confirmadoPagoTotal) y derivarlos por mi cuenta ya me dio el mes
    // equivocado una vez (F9.156 §3.2).
    const doc: Record<string, unknown> = {
      fecha: a.fecha, mes: a.mes, tipo: 'Gasto', subtipo: 'Tarjeta', origen: 'Tarjeta',
      descripcion: `Resumen ${s(x.tarjeta)} ${s(x.periodo)} (USD)`, descripcionOriginal: null,
      monto: 0, moneda: 'USD', tcUsdArs: null,
      categoria: 'Tarjetas', subcategoria: a.subcategoria ?? null, etiqueta: null,
      banco: a.banco ?? null, cuenta: null,
      tarjetaCodigo: x.tarjetaCodigo ?? null, tarjeta: x.tarjeta || null, persona: null,
      creadoPor: a.creadoPor ?? null,
      pagado: true, excluirDash: true, incluirResumenMes: true,
      resumenTarjetaId: s(a.resumenTarjetaId), itemEsperadoId: itemUSD.id,
      confirmadoPago: a.confirmadoPago === true,
      hashPdf: x.hashPdf ?? null, refStoragePdf: x.refStoragePdf ?? null,
      padreId: null, notas: null,
      creadoEn: new Date(), actualizadoEn: new Date(),
    };
    const ref = db.collection('movimientos').doc();
    batch.set(ref, doc);
    creados.push({ pref, id: ref.id, doc });
    itemsAActualizar.set(itemUSD.id, 0);
  }

  for (const [itemId, monto] of itemsAActualizar) {
    batch.update(db.collection('itemsEsperados').doc(itemId), { montoEsperado: monto, actualizadoEn: new Date() });
  }

  console.log(`\nmovimientos a crear: ${creados.length} | salteados: ${salteados} | ítems a actualizar: ${itemsAActualizar.size}`);
  if (!aplicar) { console.log('\n(sin --apply: no se escribió nada)'); return; }
  if (creados.length === 0 && itemsAActualizar.size === 0) { console.log('nada que hacer'); return; }

  await batch.commit();
  console.log('\n=== COMMIT HECHO ===\n');

  // Re-lectura desde Firestore: lo que quedó escrito de verdad, no lo que creo que escribí.
  for (const c of creados) {
    const leido = await db.collection('movimientos').doc(c.id).get();
    const y = leido.data()!;
    console.log(`  ${c.pref} → movimiento ${c.id}`);
    for (const k of ['fecha', 'mes', 'tipo', 'subtipo', 'origen', 'descripcion', 'monto', 'moneda',
      'categoria', 'subcategoria', 'banco', 'tarjetaCodigo', 'tarjeta', 'creadoPor', 'pagado',
      'excluirDash', 'incluirResumenMes', 'resumenTarjetaId', 'itemEsperadoId', 'confirmadoPago',
      'hashPdf', 'refStoragePdf', 'padreId', 'notas']) {
      console.log(`      ${k.padEnd(20)} = ${k === 'fecha' ? fechaStr(y[k]) : s(y[k])}`);
    }
    console.log();
  }
  for (const [itemId] of itemsAActualizar) {
    const leido = await db.collection('itemsEsperados').doc(itemId).get();
    const y = leido.data()!;
    console.log(`  ítem ${itemId} (${s(y.tarjetaCodigo)} ${s(y.moneda)}) → montoEsperado = ${s(y.montoEsperado)}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
