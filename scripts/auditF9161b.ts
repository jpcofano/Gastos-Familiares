// F9.161 §3 — ¿el CR.RG 5617 está en el DETALLE del PDF, además de en el consolidado? SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';
const req = createRequire(process.cwd() + '/functions/package.json');
const pdfParse = req('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;
if (getApps().length === 0) initializeApp({
  credential: cert('./secrets/serviceAccountKey.json'),
  storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
});
const db = getFirestore();
const s = (v: unknown) => v === undefined ? '' : String(v);

async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  for (const pref of ['08a697e0', 'b553ddf1', 'f3e9e4f3']) {
    const d = resus.docs.find(x => x.id.startsWith(pref))!;
    const [buf] = await getStorage().bucket().file(s(d.data().refStoragePdf)).download();
    const texto = (await pdfParse(buf as Buffer)).text;
    console.log(`\n=== ${pref} | ${s(d.data().periodo)} | totalARS=${s(d.data().totalARS)} ===`);
    const lineas = texto.split('\n').map(l => l.trim());
    lineas.forEach((l, i) => {
      if (/CR\.RG|DB\.RG/i.test(l)) {
        console.log(`  linea ${String(i).padStart(4)}: ${l.slice(0, 110)}`);
      }
    });
    // dónde cae respecto de los hitos del PDF
    for (const hito of ['SU PAGO', 'SALDO ANTERIOR', 'Sus pagos y ajustes', 'Impuestos, cargos']) {
      const i = lineas.findIndex(l => new RegExp(hito, 'i').test(l));
      if (i >= 0) console.log(`  hito "${hito}" en linea ${i}`);
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
