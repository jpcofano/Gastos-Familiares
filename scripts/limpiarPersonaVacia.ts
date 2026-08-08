// F9.133 §2 — limpieza one-shot de `persona: ""` en movimientos.
//
// La cadena vacía no es un memberId. `docAMovimiento` ya la normaliza a null en la lectura (borde
// del dominio), pero eso no arregla el dato en origen: cualquier consumidor que lea Firestore
// directo —una query `where('persona','==',…)`, un script, una función— sigue viendo `""`.
//
// Dry-run por defecto, `--apply` para escribir. Mismo patrón que limpiarCafciMappingNulos.ts:
// se reporta ANTES de tocar nada, porque una limpieza que no se puede revisar antes es un borrado
// a ciegas.
//
// Uso:
//   tsx scripts/limpiarPersonaVacia.ts --target=production
//   tsx scripts/limpiarPersonaVacia.ts --target=production --apply

import { getDb } from './seed/utils/firestore';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
const apply = process.argv.includes('--apply');

async function main() {
  const db = getDb(target as 'emulator' | 'production');

  // Firestore no indexa "cadena vacía" como caso especial: se consulta por igualdad exacta.
  const snap = await db.collection('movimientos').where('persona', '==', '').get();

  console.log(`\n=== movimientos con persona === "" ===`);
  console.log(`  encontrados: ${snap.size}`);
  for (const d of snap.docs) {
    const m = d.data() as Record<string, unknown>;
    console.log(`    ${d.id} · ${m.mes} · ${String(m.descripcion).slice(0, 44)} · ${m.moneda} ${m.monto}`);
  }

  if (snap.size === 0) {
    console.log('\nNada que limpiar.');
    return;
  }

  if (!apply) {
    console.log('\nDRY-RUN: no se escribió nada. Volver a correr con --apply.');
    console.log(JSON.stringify({ encontrados: snap.size, actualizados: 0 }));
    return;
  }

  const BATCH = 400;
  for (let i = 0; i < snap.docs.length; i += BATCH) {
    const batch = db.batch();
    // Se pone `null`, no se borra el campo: el contrato del tipo es `string | null` y un campo
    // ausente obligaría a cada lector a distinguir "no cargado" de "sin asignar", que son lo mismo.
    for (const d of snap.docs.slice(i, i + BATCH)) batch.update(d.ref, { persona: null });
    await batch.commit();
  }

  console.log(`\nActualizados ${snap.size} movimientos: "" → null.`);
  console.log(JSON.stringify({ encontrados: snap.size, actualizados: snap.size }));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
