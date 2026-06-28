// F9.24 — backfill: movimientos.persona por nombre crudo → memberId.
//
// Por qué hace falta: scripts/seed/transformers/movements.ts escribía
// `persona: r.Persona` tal cual venía del Excel — ALIAS_PERSONA (Fede→Federico,
// Sofi→Sofía) estaba importado pero nunca se aplicaba ahí (sí en
// expectedItems.ts). Los docs que ya corrieron el seed con ese bug quedaron
// con persona="Fede"/"Sofi" en vez del memberId real (la key de
// config/familia.miembros, ej. "Federico"/"Sofía"). El fix en movements.ts
// (normPersona) solo corrige re-seeds futuros — este script corrige los
// docs YA escritos, sin re-seedear todo.
//
// Uso:
//   tsx scripts/seed/backfillPersonaMemberId.ts --target=emulator           (dry-run, default)
//   tsx scripts/seed/backfillPersonaMemberId.ts --target=emulator --apply   (escribe)
//   tsx scripts/seed/backfillPersonaMemberId.ts --target=production --apply --i-am-sure
//
// Idempotente: una vez backfillpeado, persona ya es un memberId válido
// (key de config/familia.miembros) y una segunda corrida no encuentra nada
// para corregir.

import { getDb } from './utils/firestore';
import { normPersona } from './transformers/expectedItems';

interface Flags {
  target: 'emulator' | 'production';
  apply: boolean;
}

function parseFlags(): Flags {
  const args = process.argv.slice(2);
  const target = args.includes('--target=production') ? 'production' : 'emulator';
  const apply = args.includes('--apply');

  if (target === 'production' && apply && !args.includes('--i-am-sure')) {
    console.error('ERROR: --target=production --apply requiere flag --i-am-sure');
    process.exit(1);
  }
  return { target, apply };
}

async function main() {
  const { target, apply } = parseFlags();
  console.log(`\nBACKFILL persona→memberId — target=${target} ${apply ? '(APLICANDO)' : '(dry-run, no escribe)'}\n`);

  const db = getDb(target);

  const familiaSnap = await db.collection('config').doc('familia').get();
  if (!familiaSnap.exists) {
    console.error('ERROR: config/familia no existe. Corré el seed primero.');
    process.exit(1);
  }
  const miembros = (familiaSnap.data()?.miembros ?? {}) as Record<string, unknown>;
  const memberIds = new Set(Object.keys(miembros));
  console.log(`   memberIds válidos: ${[...memberIds].join(', ')}\n`);

  const movsSnap = await db.collection('movimientos').get();
  console.log(`   ${movsSnap.size} movimientos en total\n`);

  let yaOk = 0;
  let sinPersona = 0;
  const aCorregir: { id: string; persona: string; nuevo: string }[] = [];
  const sinResolver: { id: string; persona: string }[] = [];

  for (const doc of movsSnap.docs) {
    const persona = doc.data().persona as string | null | undefined;
    if (!persona) { sinPersona++; continue; }
    if (memberIds.has(persona)) { yaOk++; continue; }

    const resuelto = normPersona(persona);
    if (resuelto && memberIds.has(resuelto)) {
      aCorregir.push({ id: doc.id, persona, nuevo: resuelto });
    } else {
      sinResolver.push({ id: doc.id, persona });
    }
  }

  console.log(`   ya con memberId válido: ${yaOk}`);
  console.log(`   sin persona (null/''):  ${sinPersona}`);
  console.log(`   a corregir:             ${aCorregir.length}`);
  console.log(`   sin resolver (manual):  ${sinResolver.length}\n`);

  if (aCorregir.length > 0) {
    console.log('   Docs a corregir:');
    for (const c of aCorregir) console.log(`     ${c.id}: "${c.persona}" → "${c.nuevo}"`);
    console.log('');
  }
  if (sinResolver.length > 0) {
    console.log('   ⚠ Docs sin resolver (revisar a mano — no se tocan):');
    for (const s of sinResolver) console.log(`     ${s.id}: persona="${s.persona}"`);
    console.log('');
  }

  if (!apply) {
    console.log('Dry-run: no se escribió nada. Agregá --apply para escribir los docs listados arriba.\n');
    return;
  }

  const BATCH_SIZE = 400;
  for (let i = 0; i < aCorregir.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const c of aCorregir.slice(i, i + BATCH_SIZE)) {
      batch.update(db.collection('movimientos').doc(c.id), { persona: c.nuevo });
    }
    await batch.commit();
  }
  console.log(`OK: ${aCorregir.length} docs corregidos.\n`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
