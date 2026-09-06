// F9.165 §2 — estado de partida de los cuatro antes de re-extraer. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  for (const pref of ['b553ddf1', 'f3e9e4f3', '5d948f9a', 'c7222865']) {
    const d = resus.docs.find(x => x.id.startsWith(pref))!;
    const x = d.data();
    const movs = await db.collection('movimientos').where('resumenTarjetaId', '==', d.id).get();
    const aj = (x.ajustesConsolidado ?? []) as any[];
    console.log(`${pref} | ${s(x.periodo)} | estado=${s(x.estado)} | lineas=${(x.movimientosParseados ?? []).length} | confirmadoEn=${x.confirmadoEn ? 'sí' : 'no'}`);
    console.log(`    movimientos ya generados: ${movs.size}`);
    console.log(`    campos F9.163: saldoAnteriorARS=${s(x.saldoAnteriorARS)} pagosDelPeriodoARS=${s(x.pagosDelPeriodoARS)}`);
    console.log(`    ajustesConsolidado: pdf=${aj.filter(a => a.origen !== 'manual').length} manual=${aj.filter(a => a.origen === 'manual').length}`);
    for (const a of aj.filter(a => a.origen === 'manual')) console.log(`        manual: ${a.montoARS} "${s(a.concepto)}"`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
