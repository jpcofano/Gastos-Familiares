// F9.158 §1 — auditoría previa: ¿hay movimientos de resumen editados a mano después de importados?
// La respuesta decide si una política de borrar-y-recrear es aceptable. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const ms = (v: unknown) => (v as { toMillis?: () => number } | null)?.toMillis?.() ?? null;
const fechaStr = (v: unknown) => {
  const t = v as { toDate?: () => Date } | null | undefined;
  return t?.toDate ? t.toDate().toISOString().replace('T', ' ').slice(0, 19) : s(v);
};

async function main() {
  const movsSnap = await db.collection('movimientos').get();
  const resus = await db.collection('resumenesTarjeta').get();

  // Clave legacy + doc id: los 17 del seed usan `{tarjetaCodigo}_{nroResumen}`.
  const claves = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const d of resus.docs) {
    const x = d.data();
    claves.set(d.id, d);
    claves.set(`${s(x.tarjetaCodigo)}_${s(x.nroResumen)}`, d);
  }

  const deResumen = movsSnap.docs.filter(d => d.data().resumenTarjetaId);
  console.log(`=== §1 — movimientos con resumenTarjetaId: ${deResumen.length} ===\n`);

  // ── ¿Cuántos fueron tocados después de crearse? ───────────────────────────
  const TOLERANCIA_MS = 5000; // el batch escribe creadoEn y actualizadoEn con el mismo serverTimestamp
  const editados: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let sinFechas = 0;
  for (const d of deResumen) {
    const y = d.data();
    const c = ms(y.creadoEn), a = ms(y.actualizadoEn);
    if (c === null || a === null) { sinFechas++; continue; }
    if (a - c > TOLERANCIA_MS) editados.push(d);
  }
  console.log(`con creadoEn y actualizadoEn poblados: ${deResumen.length - sinFechas} | sin alguna de las dos: ${sinFechas}`);
  console.log(`>>> EDITADOS después de creados (actualizadoEn − creadoEn > ${TOLERANCIA_MS} ms): ${editados.length}\n`);

  for (const d of editados) {
    const y = d.data();
    const r = claves.get(s(y.resumenTarjetaId));
    const delta = (ms(y.actualizadoEn)! - ms(y.creadoEn)!) / 1000;
    console.log(`  ${d.id}`);
    console.log(`     ${s(y.moneda)} ${s(y.monto)} | mes=${s(y.mes)} | ${s(y.descripcion).slice(0, 46)}`);
    console.log(`     creado=${fechaStr(y.creadoEn)} → actualizado=${fechaStr(y.actualizadoEn)}  (+${delta.toFixed(0)} s = ${(delta / 86400).toFixed(1)} d)`);
    console.log(`     resumen=${s(r?.data().banco)} ${s(r?.data().tarjeta)} ${s(r?.data().periodo)} | excluirDash=${s(y.excluirDash)} | itemEsperadoId=${s(y.itemEsperadoId)}`);
    console.log(`     categoria=${s(y.categoria)} > ${s(y.subcategoria)} | persona=${s(y.persona)} | notas=${s(y.notas)} | etiqueta=${s(y.etiqueta)}`);
  }

  // ── Tamaño del batch: ¿cuántas operaciones tendría un borrar-y-recrear? ───
  console.log('\n=== §1 — tamaño del batch si la política fuera borrar-y-recrear ===');
  console.log('(Firestore admite 500 operaciones por batch; pasarse rompe la atomicidad)');
  let peor = 0, peorId = '';
  for (const d of resus.docs) {
    const x = d.data();
    const claveLegacy = `${s(x.tarjetaCodigo)}_${s(x.nroResumen)}`;
    const existentes = movsSnap.docs.filter(m => {
      const k = s(m.data().resumenTarjetaId);
      return k === d.id || k === claveLegacy;
    }).length;
    const lineas = Array.isArray(x.movimientosParseados)
      ? (x.movimientosParseados as Array<{ incluir?: boolean; monto?: number }>).filter(l => l.incluir && (l.monto ?? 0) > 0).length
      : 0;
    // deletes + lineas nuevas + 2 totales + 2 updates de item + 1 update del resumen
    const ops = existentes + lineas + 2 + 2 + 1;
    if (ops > peor) { peor = ops; peorId = `${d.id.slice(0, 8)} ${s(x.tarjeta)} ${s(x.periodo)} (existentes=${existentes}, lineas=${lineas})`; }
  }
  console.log(`  peor caso hoy: ${peor} operaciones — ${peorId}`);
  console.log(`  ${peor <= 500 ? 'OK ' : '>>> NO'} margen contra el límite de 500: ${500 - peor}`);

  // ── ¿Qué movimientos tienen los 4 del backfill? ──────────────────────────
  console.log('\n=== §2 — estado actual de los 4 resúmenes del backfill ===');
  for (const pref of ['17e51e81', '879eb89a', 'fc31ca48', 'f9d9b308']) {
    const d = resus.docs.find(x => x.id.startsWith(pref));
    if (!d) { console.log(`  ${pref}: no encontrado`); continue; }
    const x = d.data();
    const claveLegacy = `${s(x.tarjetaCodigo)}_${s(x.nroResumen)}`;
    const totales = movsSnap.docs.filter(m => {
      const y = m.data();
      const k = s(y.resumenTarjetaId);
      return (k === d.id || k === claveLegacy) && y.excluirDash === true;
    });
    console.log(`  ${pref} | ${s(x.tarjeta).padEnd(18)} ${s(x.periodo)} | tarjetaCodigo=${s(x.tarjetaCodigo)} | totalARS=${s(x.totalARS)} totalUSD=${s(x.totalUSD)}`);
    for (const m of totales) {
      const y = m.data();
      console.log(`      total ${s(y.moneda)}: ${m.id} | monto=${s(y.monto)} | mes=${s(y.mes)} | pagado=${s(y.pagado)} confirmadoPago=${s(y.confirmadoPago)} | item=${s(y.itemEsperadoId)}`);
      console.log(`         hashPdf=${s(y.hashPdf)?.slice(0, 12)}… | refStoragePdf=${s(y.refStoragePdf)} | fecha=${fechaStr(y.fecha)} | banco=${s(y.banco)} | subcategoria=${s(y.subcategoria)}`);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
