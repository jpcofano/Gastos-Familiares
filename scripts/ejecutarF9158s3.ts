// F9.158 §3 — ESCRIBE (borra). Los dos movimientos manuales de USD 1 que el dueño había cargado a
// mano para destapar los ítems de Galicia de 2026-08. Autorizado después de verificar §2.
//
// Guarda dura: solo borra un movimiento si cumple TODAS las condiciones del parche, y solo si el
// ítem-mes ya está cubierto por el movimiento-total en cero que creó §2. Si el reemplazo no está,
// no borra — no vamos a dejar el ítem colgado otra vez.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const fechaStr = (v: unknown) => {
  const t = v as { toDate?: () => Date } | null | undefined;
  return t?.toDate ? t.toDate().toISOString().replace('T', ' ').slice(0, 19) : s(v);
};

const IDS = ['11n2oyC29eDKlWETb7vl', 'AlZAgybQSHHDxujcW3c2'];

async function main() {
  const aplicar = process.argv.includes('--apply');
  console.log(aplicar ? '=== MODO ESCRITURA (--apply) ===\n' : '=== dry run (sin --apply) ===\n');

  const movsSnap = await db.collection('movimientos').get();
  const aBorrar: string[] = [];

  for (const id of IDS) {
    const d = movsSnap.docs.find(x => x.id === id);
    if (!d) { console.log(`  ${id}: ya no existe — SE SALTEA`); continue; }
    const y = d.data();

    // Guarda 1: es el parche y no otra cosa.
    const esParche = s(y.origen) === 'Manual' && y.excluirDash === false
      && s(y.moneda) === 'USD' && Number(y.monto) === 1 && s(y.mes) === '2026-08';
    // Guarda 2: el ítem-mes ya tiene el movimiento-total en cero que lo reemplaza.
    const reemplazo = movsSnap.docs.find(m => {
      const z = m.data();
      return z.itemEsperadoId === y.itemEsperadoId && s(z.mes) === s(y.mes)
        && z.excluirDash === true && s(z.origen) === 'Tarjeta' && Number(z.monto) === 0;
    });

    console.log(`  ${id} | ${s(y.monto)} ${s(y.moneda)} | mes=${s(y.mes)} | item=${s(y.itemEsperadoId)}`);
    console.log(`      origen=${s(y.origen)} excluirDash=${s(y.excluirDash)} creadoEn=${fechaStr(y.creadoEn)} descripcion="${s(y.descripcion)}"`);
    console.log(`      guarda "es el parche": ${esParche ? 'OK' : '>>> NO'}`);
    console.log(`      guarda "hay reemplazo en cero": ${reemplazo ? `OK (${reemplazo.id})` : '>>> NO'}`);
    if (esParche && reemplazo) aBorrar.push(id);
    else console.log('      >>> NO SE BORRA');
    console.log();
  }

  console.log(`a borrar: ${aBorrar.length} de ${IDS.length}`);
  if (!aplicar) { console.log('\n(sin --apply: no se borró nada)'); return; }
  if (aBorrar.length === 0) return;

  const batch = db.batch();
  for (const id of aBorrar) batch.delete(db.collection('movimientos').doc(id));
  await batch.commit();
  console.log('\n=== COMMIT HECHO ===');
  for (const id of aBorrar) {
    const leido = await db.collection('movimientos').doc(id).get();
    console.log(`  ${id} → existe todavía: ${leido.exists ? '>>> SÍ (falló)' : 'no (borrado)'}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
