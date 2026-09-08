// F9.168 — ¿la obligación que el guard "saca" de rama 1 la creó EL MISMO comprobante? SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const PARES: Array<[string,string]> = [
  ['0c5d5e5ac2d','rwfmBgh6N6us7w'], ['927eeaca65e','KhYexvlIEdaLZf'], ['97e781db1d7','LNobq8UjkEGyVN'],
  ['a650c026283','yR4NiHeWwX87tr'], ['c8b5ca52c84','7HTNXS5cwTNCdf'], ['e895125d2f2','2nnnWCKXSqONzh'],
];
async function main() {
  const comps = await db.collection('comprobantes').get();
  const movs  = await db.collection('movimientos').get();
  console.log('comprobante  | obligación     | ¿la creó ESTE comprobante? | monto comp | monto oblig | propuesta actual');
  for (const [cp, mp] of PARES) {
    const c = comps.docs.find(d => d.id.startsWith(cp))!;
    const m = movs.docs.find(d => d.id.startsWith(mp))!;
    const mismo = s(m.data().origenComprobanteId) === c.id;
    console.log(`${cp} | ${mp} | ${(mismo ? 'SÍ — es su propia obligación' : '>>> NO, es de OTRO').padEnd(26)} | ${String(s(c.data().datosExtraidos?.montoTotal)).padStart(10)} | ${String(s(m.data().monto)).padStart(11)} | rama ${s(c.data().propuestaMatch?.rama)}`);
    if (!mismo) console.log(`     origenComprobanteId de la obligación = ${s(m.data().origenComprobanteId).slice(0,14)}…`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
