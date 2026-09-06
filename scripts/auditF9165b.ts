// F9.165 §5 — ¿qué máscaras de PAN hay REALMENTE en los PDF? El harness dio 0 documentos que ganen
// el marcador, así que el rango no era la explicación. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';
const req = createRequire(process.cwd() + '/functions/package.json');
const pdfParse = req('pdf-parse') as (b: Buffer, o?: { max: number }) => Promise<{ text: string }>;
if (getApps().length === 0) initializeApp({
  credential: cert('./secrets/serviceAccountKey.json'),
  storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
});
const db = getFirestore();
const s = (v: unknown) => v === undefined || v === null ? '' : String(v);

// Cualquier cosa que PAREZCA una mascara de tarjeta, sin comprometerse con un formato.
const SONDAS: Array<[string, RegExp]> = [
  ['digitos + relleno + digitos (el regex viejo)', /\d{4}[\s*X]{4,10}\d{4}/],
  ['digitos + relleno + digitos (el nuevo)',       /\d{4}[\s*X]{4,14}\d{4}/],
  ['arranca enmascarado: XXXX...1234',             /[X*]{4}[\s*X]{4,14}\d{4}/],
  ['con guiones: 4509-XXXX-XXXX-1234',            /\d{4}[-\s*X]{4,14}\d{4}/],
  ['4 o mas asteriscos seguidos',                  /\*{4,}/],
  ['4 o mas X seguidas',                           /X{4,}/],
  ['la palabra TARJETA seguida de digitos',        /TARJETA[^\n]{0,20}\d{4}/],
];

async function main() {
  const refs: Array<{ id: string; ref: string; col: string }> = [];
  for (const col of ['entrantes', 'comprobantes', 'resumenesTarjeta']) {
    const snap = await db.collection(col).get();
    for (const d of snap.docs) {
      const r = d.data().refStoragePdf ?? d.data().refStorage;
      if (r) refs.push({ id: d.id.slice(0, 10), ref: s(r), col });
    }
  }
  const cuenta = new Map<string, number>();
  const ejemplos = new Map<string, string[]>();
  let leidos = 0;
  for (const { ref } of refs) {
    let texto: string;
    try {
      const [buf] = await getStorage().bucket().file(ref).download();
      texto = (await pdfParse(buf as Buffer, { max: 3 })).text;
    } catch { continue; }
    leidos++;
    const norm = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    for (const [rot, re] of SONDAS) {
      const m = norm.match(re);
      if (!m) continue;
      cuenta.set(rot, (cuenta.get(rot) ?? 0) + 1);
      const e = ejemplos.get(rot) ?? [];
      if (e.length < 4) e.push(m[0].replace(/\s+/g, ' ').slice(0, 40));
      ejemplos.set(rot, e);
    }
  }
  console.log(`PDFs leídos: ${leidos}\n`);
  console.log('sonda                                          | PDFs | ejemplos');
  for (const [rot] of SONDAS) {
    const n = cuenta.get(rot) ?? 0;
    console.log(`${rot.padEnd(46)} | ${String(n).padStart(4)} | ${JSON.stringify(ejemplos.get(rot) ?? [])}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
