// F9.83 — Backfill: asignar categoría canónica a movimientos que solo tienen subcategoría.
//
// Por qué: quedaron movimientos con `subcategoria` seteada pero `categoria` vacía/null
// (o con un valor que no es una categoría canónica activa). Los agregados del Dashboard
// "Por categoría" los dejan fuera. Este script los completa usando la taxonomía de
// config/familia (categorías activas) y la colección /subcategorias (valor → categoriaPadre).
//
// Tres grupos en el reporte:
//   1. A completar  — subcat matchea en taxonomía, se puede inferir la categoría padre.
//   2. Revisión manual — subcat existe pero no está en la taxonomía; decidir a mano.
//   3. Sin subcategoría ni categoría — quedan como están.
//
// Uso:
//   tsx scripts/seed/backfillCategoriaCanonica.ts                    (dry-run, emulador)
//   tsx scripts/seed/backfillCategoriaCanonica.ts --apply            (escribe, emulador)
//   tsx scripts/seed/backfillCategoriaCanonica.ts --target=production --apply --i-am-sure
//
// Idempotente: una segunda corrida no encuentra candidatos (categoria ya está bien).

import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from './utils/firestore';

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

const norm = (s?: string | null): string =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

async function main() {
  const { target, apply } = parseFlags();
  console.log(`\nBACKFILL CATEGORÍA CANÓNICA — target=${target} ${apply ? '(APLICANDO)' : '(dry-run, no escribe)'}\n`);

  const db = getDb(target);

  const [familiaSnap, subcatsSnap] = await Promise.all([
    db.collection('config').doc('familia').get(),
    db.collection('subcategorias').get(),
  ]);

  if (!familiaSnap.exists) {
    console.error('ERROR: config/familia no existe. Corré el seed primero.');
    process.exit(1);
  }

  const fam = familiaSnap.data()!;

  // Categorías canónicas activas (F9.38: CategoriaItem[] con {id, nombre, activo})
  const categoriasActivas = new Set<string>(
    ((fam.categorias ?? []) as Array<{ nombre: string; activo: boolean }>)
      .filter(c => c.activo !== false)
      .map(c => c.nombre),
  );
  console.log(`  Categorías canónicas activas (${categoriasActivas.size}): ${[...categoriasActivas].join(', ')}`);

  // Map norm(subcat.valor) → categoriaPadre (solo subcats activas)
  // /subcategorias docs tienen: { valor, categoriaPadre, activo }
  const subToCat = new Map<string, string>();
  for (const doc of subcatsSnap.docs) {
    const d = doc.data();
    if (d.activo === false) continue;
    const nombreSub = norm(d.valor as string | undefined);
    const padre     = (d.categoriaPadre as string | null) ?? null;
    if (nombreSub && padre) subToCat.set(nombreSub, padre);
  }
  console.log(`  Subcategorías en taxonomía: ${subToCat.size}\n`);

  // Cargar todos los movimientos (seed ~1136 docs, manejable en memoria)
  const movsSnap = await db.collection('movimientos').get();
  console.log(`  Movimientos totales: ${movsSnap.size}`);

  interface Candidato { id: string; descripcion: string; subcatActual: string; catActual: string; catNueva: string }
  interface SinMatch  { id: string; descripcion: string; subcategoria: string; categoria: string }
  interface SinSubcat { id: string; descripcion: string }

  const aCompletar: Candidato[] = [];
  const sinMatch:   SinMatch[]  = [];
  const sinSubcat:  SinSubcat[] = [];

  for (const doc of movsSnap.docs) {
    const d        = doc.data();
    const subcat   = ((d.subcategoria as string | null) ?? '').trim();
    const catActual = ((d.categoria   as string | null) ?? '').trim();

    if (!subcat) {
      if (!catActual) sinSubcat.push({ id: doc.id, descripcion: (d.descripcion as string) ?? '' });
      continue;
    }

    // Tiene subcategoría — ¿la categoría ya es canónica?
    if (catActual && categoriasActivas.has(catActual)) continue;

    const catNueva = subToCat.get(norm(subcat));
    if (catNueva) {
      aCompletar.push({ id: doc.id, descripcion: (d.descripcion as string) ?? '', subcatActual: subcat, catActual, catNueva });
    } else {
      sinMatch.push({ id: doc.id, descripcion: (d.descripcion as string) ?? '', subcategoria: subcat, categoria: catActual });
    }
  }

  // ── Reporte ──────────────────────────────────────────────────────────────────
  console.log(`\n── 1. A completar (${aCompletar.length}) — se escriben con --apply ────────────`);
  for (const m of aCompletar) {
    const desc = m.descripcion.slice(0, 45).padEnd(45);
    console.log(`  ${m.id}  "${desc}"  subcat="${m.subcatActual}"  "${m.catActual || '(vacía)'}" → "${m.catNueva}"`);
  }

  console.log(`\n── 2. Revisión manual (${sinMatch.length}) — subcat sin match en taxonomía ────`);
  for (const m of sinMatch) {
    const desc = m.descripcion.slice(0, 45).padEnd(45);
    console.log(`  ${m.id}  "${desc}"  subcat="${m.subcategoria}"  cat="${m.categoria || '(vacía)'}"`);
  }

  console.log(`\n── 3. Sin subcategoría ni categoría (${sinSubcat.length}) ─────────────────────`);
  const mostrar = sinSubcat.slice(0, 20);
  for (const m of mostrar) {
    console.log(`  ${m.id}  "${m.descripcion.slice(0, 55)}"`);
  }
  if (sinSubcat.length > 20) console.log(`  … y ${sinSubcat.length - 20} más`);

  if (!apply) {
    console.log(`\nDry-run: no se escribió nada. Agregá --apply para completar los ${aCompletar.length} del grupo 1.\n`);
    return;
  }

  if (aCompletar.length === 0) {
    console.log('\nNada que escribir.\n');
    return;
  }

  for (let i = 0; i < aCompletar.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const m of aCompletar.slice(i, i + BATCH_SIZE)) {
      batch.update(db.collection('movimientos').doc(m.id), {
        categoria:     m.catNueva,
        actualizadoEn: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  console.log(`\n✓ ${aCompletar.length} movimientos actualizados con categoría canónica.\n`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
