// F9.163 §1 (gate) — barrido de las formas de "SU PAGO" y "SALDO ANTERIOR" en los 30 PDFs, ANTES
// de fijar la regla de extracción. SOLO LEE, sin API.
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
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  console.log('F9.163 §1 — formas de "SU PAGO" / "SALDO ANTERIOR" en los PDFs. SOLO LECTURA.\n');

  const formas = new Map<string, number>();     // rótulo normalizado → cuántos PDFs lo tienen
  const porBanco = new Map<string, string[]>();
  let conPdf = 0, sinPdf = 0;

  for (const d of resus.docs.slice().sort((a, b) => s(a.data().periodo).localeCompare(s(b.data().periodo)))) {
    const x = d.data();
    if (!x.refStoragePdf) { sinPdf++; console.log(`${d.id.slice(0, 8)} | ${s(x.periodo)} | SIN refStoragePdf (seed)`); continue; }
    let texto: string;
    try {
      const [buf] = await getStorage().bucket().file(s(x.refStoragePdf)).download();
      texto = (await pdfParse(buf as Buffer)).text;
    } catch (e) {
      sinPdf++;
      console.log(`${d.id.slice(0, 8)} | ${s(x.periodo)} | NO SE PUDO LEER: ${(e as Error).message.slice(0, 60)}`);
      continue;
    }
    conPdf++;
    const filas = texto.split('\n').map(l => l.replace(/\s+/g, ' ').trim());

    // Todo renglón que hable de un pago o del saldo anterior, con su importe.
    const hits = filas
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /SU PAGO|SALDO ANTERIOR|PAGO RECIBIDO|SU ULTIMO PAGO|PAGOS? DEL PERIODO/i.test(l));

    console.log('─'.repeat(96));
    console.log(`${d.id.slice(0, 8)} | ${s(x.periodo)} | ${s(x.banco)}/${s(x.tarjeta)}`);
    const clave = `${s(x.banco)}/${s(x.tarjeta)}`;
    const rotulosDeEste = new Set<string>();
    for (const { l, i } of hits) {
      const rot = l.replace(/-?[\d.]+,\d{2}/g, '#').replace(/\d/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
      rotulosDeEste.add(rot);
      console.log(`    L${String(i).padStart(4)}  ${l.slice(0, 88)}`);
    }
    if (hits.length === 0) console.log('    (ningún renglón de pago/saldo anterior)');

    // ¿Cuántos renglones DISTINTOS de pago por moneda? Es la pregunta que abre el gate.
    const pagosArs = new Set<string>(), pagosUsd = new Set<string>();
    for (const { l } of hits) {
      if (!/SU PAGO/i.test(l)) continue;
      const m = l.match(/(-?[\d.]+,\d{2})(?!.*[\d.]+,\d{2})/);
      if (!m) continue;
      if (/USD|U\$S|DOLAR/i.test(l)) pagosUsd.add(m[1]); else pagosArs.add(m[1]);
    }
    console.log(`    → renglones SU PAGO distintos: ARS=${pagosArs.size} ${JSON.stringify([...pagosArs])} | USD=${pagosUsd.size} ${JSON.stringify([...pagosUsd])}`);
    for (const r of rotulosDeEste) {
      formas.set(r, (formas.get(r) ?? 0) + 1);
      const arr = porBanco.get(r) ?? [];
      if (!arr.includes(clave)) arr.push(clave);
      porBanco.set(r, arr);
    }
  }

  console.log('\n' + '═'.repeat(96));
  console.log(`PDFs leídos: ${conPdf} | sin PDF legible: ${sinPdf}\n`);
  console.log('formas de rótulo encontradas (rótulo sin dígitos → en cuántos PDFs, en qué bancos):');
  for (const [r, n] of [...formas].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(3)}×  "${r}"   ${JSON.stringify(porBanco.get(r))}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
