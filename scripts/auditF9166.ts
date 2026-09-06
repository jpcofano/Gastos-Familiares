// F9.166 — ¿CUÁLES son los movimientos "editados a mano" que el aviso cuenta? SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const TOL = 5000;
async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  for (const pref of ['b553ddf1', 'f3e9e4f3', '5d948f9a', 'c7222865']) {
    const d = resus.docs.find(x => x.id.startsWith(pref))!;
    const x = d.data();
    const claves = [d.id, x.tarjetaCodigo && x.nroResumen ? `${x.tarjetaCodigo}_${x.nroResumen}` : null].filter(Boolean) as string[];
    const vistos = new Map<string, any>();
    for (const k of claves) {
      const snap = await db.collection('movimientos').where('resumenTarjetaId', '==', k).get();
      for (const dd of snap.docs) vistos.set(dd.id, dd.data());
    }
    console.log(`── ${pref} | ${s(x.periodo)} | ${vistos.size} movimientos ──`);
    for (const [id, m] of vistos) {
      const c = m.creadoEn?.toMillis?.(), a = m.actualizadoEn?.toMillis?.();
      if (c == null || a == null || a - c <= TOL) continue;
      const dias = ((a - c) / 86400000).toFixed(1);
      console.log(`   ${id.slice(0, 20).padEnd(20)} | ${s(m.descripcion).slice(0, 34).padEnd(34)} | ${String(m.monto).padStart(12)} ${s(m.moneda)} | excluirDash=${s(m.excluirDash)} | editado ${dias} días después`);
    }
    console.log();
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
