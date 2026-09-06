// F9.167 §4 — ¿cuántas veces reconcilió `reconciliarPorPayee` de verdad? La marca vive en el
// propuestaMatch del COMPROBANTE, no en el movimiento. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === undefined || v === null ? '' : String(v);
async function main() {
  const comps = await db.collection('comprobantes').get();
  const porRama = new Map<string, number>();
  let reconc = 0, debil = 0, adicional = 0;
  for (const d of comps.docs) {
    const pm = d.data().propuestaMatch;
    if (!pm) { porRama.set('(sin propuesta)', (porRama.get('(sin propuesta)') ?? 0) + 1); continue; }
    const k = `rama ${s(pm.rama)}`;
    porRama.set(k, (porRama.get(k) ?? 0) + 1);
    if (pm.origenReconciliacion === true) reconc++;
    if (pm.reconciliacionDebil === true) debil++;
    if (pm.esAdicional === true) adicional++;
  }
  console.log(`comprobantes: ${comps.size}`);
  for (const [k, n] of [...porRama].sort()) console.log(`  ${k.padEnd(18)} ${String(n).padStart(3)}`);
  console.log(`\n  con origenReconciliacion=true (reconciliaron por payee): ${reconc}`);
  console.log(`  con reconciliacionDebil=true  (pase débil por nombre):   ${debil}`);
  console.log(`  con esAdicional=true          (segundo cargo del mes):   ${adicional}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
