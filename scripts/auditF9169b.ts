// F9.169 §1 — el movimiento huérfano: ¿es duplicado? ¿entra a los totales? SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const t = (v: unknown) => v instanceof Timestamp ? v.toDate().toISOString().slice(0,19).replace('T',' ') : '—';
async function main() {
  console.log('=== los tres movimientos, estado completo ===');
  for (const id of ['LNobq8UjkEGyVNB3YSXC','dIPI1qQGvAhZUM8d8qef','7qR8XY1cZCVPMrMcuNin']) {
    const d = await db.collection('movimientos').doc(id).get();
    if (!d.exists) { console.log(`${id}: NO EXISTE`); continue; }
    const x = d.data()!;
    console.log(`\n${id}`);
    console.log(`  descripcion=${s(x.descripcion)} monto=${s(x.monto)} ${s(x.moneda)} mes=${s(x.mes)} fecha=${t(x.fecha)}`);
    console.log(`  itemEsperadoId=${s(x.itemEsperadoId)}  categoria=${s(x.categoria)} > ${s(x.subcategoria)}`);
    console.log(`  origenComprobanteId=${s(x.origenComprobanteId).slice(0,20)}  esAdicional=${s(x.esAdicional)}`);
    console.log(`  excluirDash=${s(x.excluirDash)}  incluirResumenMes=${s(x.incluirResumenMes)}  pagado=${s(x.pagado)} confirmadoPago=${s(x.confirmadoPago)}`);
    console.log(`  vencimientos=${JSON.stringify(x.vencimientos)}`);
    console.log(`  creadoEn=${t(x.creadoEn)}  actualizadoEn=${t(x.actualizadoEn)}`);
  }
  console.log('\n=== ¿cuánto suma AGUA en septiembre CONTANDO el huérfano? ===');
  const snap = await db.collection('movimientos').where('mes','==','2026-09').get();
  let conHuerfano = 0, n = 0;
  for (const d of snap.docs) {
    const x = d.data();
    if (!/aysa|agua/i.test(s(x.descripcion))) continue;
    if (x.excluirDash === true) continue;              // el dashboard los excluye
    n++; conHuerfano += Number(x.monto ?? 0);
    console.log(`  ${d.id.slice(0,20)} | ${String(s(x.monto)).padStart(9)} | item=${s(x.itemEsperadoId).slice(0,10)} | excluirDash=${s(x.excluirDash)}`);
  }
  console.log(`  → ${n} movimientos, suman ${conHuerfano.toFixed(2)} | las dos boletas: 74974.33 | DE MÁS: ${(conHuerfano-74974.33).toFixed(2)}`);

  console.log('\n=== ¿la propuesta de los comprobantes se actualizó? (arreglo 1 de F9.168) ===');
  for (const id of ['a2c31b98fc08b4359dc8455caf3a5a4c215524ea5b234c87d5f7e1b15a36f5c1',
                    '97e781db1d749f5a5ece62c0eeb789befa57fbeba44f72e2c312b0409a36c087']) {
    const c = await db.collection('comprobantes').doc(id).get();
    const pm = c.data()?.propuestaMatch;
    console.log(`  ${id.slice(0,14)} | rama=${s(pm?.rama)} item=${s(pm?.itemEsperadoId).slice(0,10)} esAdicional=${s(pm?.esAdicional)} reasignadoAMano=${s(pm?.reasignadoAMano)} origenReconciliacion=${s(pm?.origenReconciliacion)}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
