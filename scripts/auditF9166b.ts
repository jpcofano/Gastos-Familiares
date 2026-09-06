// F9.166 — ¿qué se les cambio a esos movimientos? SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const IDS = ['0KGl80d6l8bcbsdllOam','Uzhjm5Rz5C5z9EuI9hC6','qBEU8cNH93r2ZTgfIL9k','yEGWZOvh6yCct4NzWFTc',
             'IwCBhRxCy1kr5cSzwbq3','lSAndyXdY7gR3iiw938S','4BH8ac3GzIiZqtJWxHWB','THmRpBnQae6kgSV7L4d6'];
async function main() {
  console.log('id                   | pagado | confirmadoPago | pagadoEn         | itemEsperadoId | categoria       | persona');
  for (const id of IDS) {
    const m = (await db.collection('movimientos').doc(id).get()).data()!;
    console.log(`${id.slice(0,20)} | ${String(s(m.pagado)).padEnd(6)} | ${String(s(m.confirmadoPago)).padEnd(14)} | ${(m.pagadoEn?.toDate?.().toISOString().slice(0,10) ?? s(m.pagadoEn)).padEnd(16)} | ${s(m.itemEsperadoId).slice(0,14).padEnd(14)} | ${s(m.categoria).padEnd(15)} | ${s(m.persona)}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
