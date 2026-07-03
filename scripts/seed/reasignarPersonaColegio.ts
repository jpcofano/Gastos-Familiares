// F9.81 — Migración: reasignar persona de movimientos de "colegio" de los hijos a un padre.
//
// Por qué: los hijos (Federico/Sofía) son dependientes — la app les muestra
// solo sus movimientos via where('persona','==', memberId). Los gastos de colegio
// de cada hijo tienen persona=<hijo>, así que los ven. Reasignando persona='Juan'
// esos gastos dejan de aparecerles. El padre sí los ve; el filtro por persona
// los excluye del hijo.
//
// Selección (movimientos):
//   1. persona ∈ IDS_HIJOS
//   2. normalizado (sin acentos, lowercase) de descripcion / subcategoria / etiqueta / notas
//      contiene "colegio"
//
// Selección (itemsEsperados):
//   Mismo criterio: persona ∈ IDS_HIJOS y algún campo normalizado contiene "colegio".
//   Cambiar persona = PADRE_DESTINO para que el prellenado y el alta manual sugieran el padre.
//
// Uso:
//   tsx scripts/seed/reasignarPersonaColegio.ts                    (dry-run, emulador)
//   tsx scripts/seed/reasignarPersonaColegio.ts --apply            (escribe, emulador)
//   tsx scripts/seed/reasignarPersonaColegio.ts --target=production --apply --i-am-sure
//
// Idempotente: una segunda corrida no encuentra candidatos (persona ya es Juan).

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from './utils/firestore';

// ⚠️  Verificar en el dry-run que estos IDs aparezcan como personas de movimientos de colegio.
//     Son los memberIds post-backfill (F9.24: Fede→Federico, Sofi→Sofía).
const IDS_HIJOS = new Set<string>(['Federico', 'Sofía']);
const PADRE_DESTINO = 'Juan';

const BATCH_SIZE = 450;

interface Flags {
  target: 'emulator' | 'production';
  apply: boolean;
}

function parseFlags(): Flags {
  const args = process.argv.slice(2);
  const target = args.includes('--target=production') ? 'production' : 'emulator';
  const apply  = args.includes('--apply');

  if (target === 'production' && apply && !args.includes('--i-am-sure')) {
    console.error('ERROR: --target=production --apply requiere flag --i-am-sure');
    process.exit(1);
  }
  return { target, apply };
}

const norm = (s?: string): string =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const esColegio = (data: FirebaseFirestore.DocumentData): boolean =>
  ['descripcion', 'subcategoria', 'etiqueta', 'notas'].some(k =>
    norm(data[k] as string | undefined).includes('colegio'),
  );

async function procesarColeccion(
  db: FirebaseFirestore.Firestore,
  coleccion: string,
  apply: boolean,
): Promise<number> {
  const snap = await db.collection(coleccion)
    .where('persona', 'in', [...IDS_HIJOS])
    .get();

  const candidatos = snap.docs.filter(d => esColegio(d.data()));

  console.log(`\n  [${coleccion}] ${snap.size} docs con persona∈hijos → ${candidatos.length} candidatos colegio`);

  if (candidatos.length === 0) {
    console.log('  (nada que hacer)');
    return 0;
  }

  for (const doc of candidatos) {
    const d = doc.data();
    const fecha = d.fecha?.toDate?.()?.toISOString?.()?.slice(0, 10) ?? d.fecha ?? '—';
    console.log(`    ${doc.id}  fecha=${fecha}  desc="${d.descripcion ?? ''}"  persona="${d.persona}" → "${PADRE_DESTINO}"`);
  }

  if (!apply) return candidatos.length;

  for (let i = 0; i < candidatos.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const doc of candidatos.slice(i, i + BATCH_SIZE)) {
      batch.update(db.collection(coleccion).doc(doc.id), {
        persona:      PADRE_DESTINO,
        actualizadoEn: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  console.log(`  ✓ ${candidatos.length} docs actualizados en ${coleccion}.`);
  return candidatos.length;
}

async function main() {
  const { target, apply } = parseFlags();
  console.log(`\nRASIGNAR PERSONA COLEGIO — target=${target} ${apply ? '(APLICANDO)' : '(dry-run, no escribe)'}`);
  console.log(`  IDS_HIJOS: ${[...IDS_HIJOS].join(', ')}  →  PADRE_DESTINO: ${PADRE_DESTINO}\n`);

  const db = getDb(target);

  const familiaSnap = await db.collection('config').doc('familia').get();
  if (!familiaSnap.exists) {
    console.error('ERROR: config/familia no existe. Corré el seed primero.');
    process.exit(1);
  }
  const miembros = familiaSnap.data()?.miembros ?? {};
  const memberIds = new Set(Object.keys(miembros));
  console.log(`  memberIds válidos: ${[...memberIds].join(', ')}`);

  for (const id of [...IDS_HIJOS, PADRE_DESTINO]) {
    if (!memberIds.has(id)) {
      console.error(`ERROR: "${id}" no es un memberId válido en config/familia.miembros. Ajustá IDS_HIJOS / PADRE_DESTINO.`);
      process.exit(1);
    }
  }

  const totalMovs    = await procesarColeccion(db, 'movimientos',   apply);
  const totalEsperados = await procesarColeccion(db, 'itemsEsperados', apply);

  console.log(`\nResumen: movimientos=${totalMovs}  itemsEsperados=${totalEsperados}`);
  if (!apply) {
    console.log('Dry-run: no se escribió nada. Agregá --apply para aplicar.\n');
  } else {
    console.log('Migración aplicada.\n');
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
