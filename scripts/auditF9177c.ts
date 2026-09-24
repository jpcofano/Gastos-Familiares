// F9.177 §2 — ¿los archivos llegan a Storage aunque no haya doc en Firestore?
// Separa "nunca salió del teléfono" de "subió el binario y no se escribió el doc".
// SOLO LECTURA: lista objetos, no descarga ni escribe.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import type { File as GcsFile } from '@google-cloud/storage';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

if (getApps().length === 0) {
  const sa = JSON.parse(readFileSync('./secrets/serviceAccountKey.json', 'utf8')) as { project_id: string };
  initializeApp({ credential: cert('./secrets/serviceAccountKey.json'), storageBucket: `${sa.project_id}.firebasestorage.app` });
}
const db = getFirestore();

const dia = (iso: string | undefined) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10) : '-');
const h8 = (s: string) => s.slice(0, 8);

async function main() {
  console.log('F9.177 §2 — Storage vs Firestore. SOLO LECTURA.\n');

  let bucket = getStorage().bucket();
  let files: GcsFile[];
  try {
    [files] = await bucket.getFiles({ prefix: 'entrantes/' });
  } catch {
    // El bucket por defecto cambió de dominio en 2024; probamos el viejo.
    const sa = JSON.parse(readFileSync('./secrets/serviceAccountKey.json', 'utf8')) as { project_id: string };
    bucket = getStorage().bucket(`${sa.project_id}.appspot.com`);
    [files] = await bucket.getFiles({ prefix: 'entrantes/' });
  }
  console.log(`bucket: ${bucket.name}`);
  console.log(`objetos bajo entrantes/: ${files.length}\n`);

  const entS = await db.collection('entrantes').get();
  const docs = new Set(entS.docs.map(d => d.id));

  // Por día, y marcando los que NO tienen doc en Firestore.
  const porDia = new Map<string, { n: number; huerfanos: string[] }>();
  for (const f of files) {
    const hash = f.name.replace('entrantes/', '');
    const d = dia(f.metadata.timeCreated as string | undefined);
    const r = porDia.get(d) ?? { n: 0, huerfanos: [] };
    r.n++;
    if (!docs.has(hash)) r.huerfanos.push(hash);
    porDia.set(d, r);
  }
  console.log('══ Objetos en Storage por día (últimos 30) ══\n');
  for (const d of [...porDia.keys()].sort().slice(-30)) {
    const r = porDia.get(d)!;
    console.log(`  ${d}  ${String(r.n).padStart(3)}  ${'█'.repeat(Math.min(r.n, 30))}${r.huerfanos.length ? `   ⚠ ${r.huerfanos.length} SIN doc en Firestore` : ''}`);
  }

  const huerfanos = files.filter((f: GcsFile) => !docs.has(f.name.replace('entrantes/', '')));
  console.log(`\n══ Objetos en Storage SIN doc en entrantes: ${huerfanos.length} ══\n`);
  for (const f of huerfanos.sort((a: GcsFile, b: GcsFile) => String(a.metadata.timeCreated).localeCompare(String(b.metadata.timeCreated)))) {
    const hash = f.name.replace('entrantes/', '');
    console.log(`  ${h8(hash)}  ${dia(f.metadata.timeCreated as string)}  ${f.metadata.contentType}  ${Math.round(Number(f.metadata.size) / 1024)} kb  ${String((f.metadata.metadata as Record<string, unknown>)?.nombreArchivo ?? '-').slice(0, 40)}`);
  }

  // Y al revés: docs sin binario (no debería pasar).
  const sinBinario = entS.docs.filter(d => !files.some((f: GcsFile) => f.name === `entrantes/${d.id}`));
  console.log(`\n══ Docs en entrantes SIN objeto en Storage: ${sinBinario.length} ══`);
  for (const d of sinBinario.slice(0, 20)) {
    const x = d.data() as Record<string, unknown>;
    const t = x.creadoEn instanceof Timestamp ? x.creadoEn.toDate().toISOString().slice(0, 10) : '-';
    console.log(`  ${h8(d.id)}  ${t}  estado=${x.estado}  ruta=${x.rutaStorage}`);
  }

  const ultimo = files.map((f: GcsFile) => String(f.metadata.timeCreated)).sort().pop();
  console.log(`\n  ÚLTIMO objeto en Storage: ${ultimo ? dia(ultimo) : '-'}  ·  hoy: ${new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)}`);
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
