// DEPRECADO F9.99.6 — La limpieza de entrantes huérfanos se hace desde la UI
// (botón "Descartar" en EntranteCard para estados ruteado/error), via la callable
// `descartarEntranteCompleto`. Este script NO borra el registro en `entrantes`,
// lo que dejaría el ítem trabado permanentemente — NO CORRER.
//
// F9.99.5 — Limpieza única del doc huérfano en resumenesTarjeta
// El doc quedó en estado 'error' (HTTP 400 "credit balance too low") sin haberse
// extraído nunca; el mismo PDF fue re-subido y ya está confirmado → duplicado muerto.
//
// Uso original (referencia histórica — usar la UI en su lugar):
//   tsx scripts/limpiarOrfanoF9995.ts               ← dry-run, solo lista
//   tsx scripts/limpiarOrfanoF9995.ts --apply        ← borra Firestore + Storage
//   tsx scripts/limpiarOrfanoF9995.ts --target=production --apply   ← prod
import * as admin from 'firebase-admin';
import * as path from 'path';

const apply      = process.argv.includes('--apply');
const production = process.argv.includes('--target=production');

const keyPath = path.join(__dirname, '../secrets/serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(keyPath),
  storageBucket: production
    ? 'gastos-familiares-prod.appspot.com'
    : 'gastos-familiares-dev.appspot.com',
});
const db      = admin.firestore();
const bucket  = admin.storage().bucket();

async function main() {
  console.log(`\n=== Limpieza doc huérfano F9.99.5 [${apply ? 'APPLY' : 'dry-run'}] ===\n`);

  const snap = await db.collection('resumenesTarjeta')
    .where('estado', '==', 'error')
    .get();

  if (snap.empty) {
    console.log('No hay docs en estado "error" — nada que limpiar.');
    return;
  }

  const candidatos = snap.docs.filter(d => {
    const err: string = d.data().errorExtraccion ?? '';
    return err.toLowerCase().includes('credit balance') || err.includes('400');
  });

  if (candidatos.length === 0) {
    console.log('No hay docs con error de crédito/HTTP 400. Docs en error encontrados:');
    for (const d of snap.docs) {
      console.log(' ', d.id, '|', d.data().errorExtraccion);
    }
    return;
  }

  for (const d of candidatos) {
    const x = d.data();
    console.log('Doc a borrar:');
    console.log('  id:', d.id);
    console.log('  banco:', x.banco, '| tarjeta:', x.tarjeta, '| periodo:', x.periodo);
    console.log('  errorExtraccion:', x.errorExtraccion);
    console.log('  refStoragePdf:', x.refStoragePdf ?? '(null)');

    if (!apply) {
      console.log('  [dry-run] No se borra. Pasá --apply para ejecutar.\n');
      continue;
    }

    // Borrar PDF en Storage
    const storageRef: string | null = x.refStoragePdf ?? null;
    if (storageRef) {
      try {
        await bucket.file(storageRef).delete();
        console.log('  ✓ PDF borrado de Storage:', storageRef);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('  ⚠ No se pudo borrar PDF en Storage (¿ya no existía?):', msg);
      }
    }

    // Borrar doc de Firestore
    await db.collection('resumenesTarjeta').doc(d.id).delete();
    console.log('  ✓ Doc borrado de Firestore:', d.id, '\n');
  }

  if (!apply) {
    console.log('Dry-run completado. Pasá --apply para ejecutar la limpieza.');
  } else {
    console.log('Limpieza completada.');
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
