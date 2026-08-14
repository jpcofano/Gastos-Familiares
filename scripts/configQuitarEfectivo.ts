// F9.139 §2 paso 2 — saca Efectivo de `config/familia.bancos` y marca el `porDefecto`.
//
// Se hace por script y no por la UI de Perfil porque el flag `porDefecto` todavía no está
// deployado: la UI de prod es la vieja y un full-replace desde ahí borraría el campo recién
// escrito. Post-deploy, el mantenimiento normal es por Perfil › Medios de pago.
//
// PRECONDICIÓN DURA: cero movimientos con `banco: 'Efectivo'`. El alias vive en la config, así que
// borrar el medio con datos todavía apuntando ahí los deja mostrándose como fila propia
// "Efectivo" (ver scripts/migrarEfectivoAMp.ts). El script lo verifica y aborta si no se cumple.
//
// Escribe el array COMPLETO (mismo full-replace que el callable) preservando todo lo demás —
// prod tiene un "Ciudad" que no está en MEDIOS_FALLBACK y no se puede perder.
//
// Dry-run por defecto. Para escribir: `--apply --i-am-sure`.
//
// Uso:
//   npx tsx scripts/configQuitarEfectivo.ts --target=production
//   npx tsx scripts/configQuitarEfectivo.ts --target=production --apply --i-am-sure

import { getDb } from './seed/utils/firestore';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
const apply = process.argv.includes('--apply') && process.argv.includes('--i-am-sure');

const A_BORRAR = 'Efectivo';
const DEFAULT_NOMBRE = 'BBVA';

async function main() {
  const db = getDb(target as 'emulator' | 'production');
  const ref = db.collection('config').doc('familia');
  const cfg = (await ref.get()).data() as any;
  const bancos: any[] = Array.isArray(cfg?.bancos) ? cfg.bancos : [];

  console.log(`\n=== config/familia.bancos ANTES (${bancos.length}) ===`);
  for (const b of bancos) {
    console.log(`  ${String(b.nombre).padEnd(15)} id=${String(b.id).padEnd(16)} tipo=${String(b.tipo).padEnd(10)} ${b.oculto ? 'oculto ' : ''}${b.aliasDe ? `aliasDe=${b.aliasDe} ` : ''}${b.porDefecto ? 'porDefecto' : ''}`);
  }

  // Precondición: ningún movimiento puede seguir apuntando al medio que se va.
  const restantes = await db.collection('movimientos').where('banco', '==', A_BORRAR).get();
  console.log(`\n  movimientos con banco === "${A_BORRAR}": ${restantes.size}`);
  if (restantes.size > 0) {
    console.log(`\n  ABORTA: quedan ${restantes.size} movimientos apuntando a "${A_BORRAR}".`);
    console.log('  Correr scripts/migrarEfectivoAMp.ts --apply --i-am-sure primero.');
    process.exitCode = 1;
    return;
  }

  const nuevos = bancos
    .filter(b => b.nombre !== A_BORRAR)
    .map(b => b.nombre === DEFAULT_NOMBRE ? { ...b, porDefecto: true } : b);

  const hayDefault = nuevos.filter(b => b.porDefecto === true);
  console.log(`\n=== config/familia.bancos DESPUÉS (${nuevos.length}) ===`);
  for (const b of nuevos) {
    console.log(`  ${String(b.nombre).padEnd(15)} id=${String(b.id).padEnd(16)} tipo=${String(b.tipo).padEnd(10)} ${b.oculto ? 'oculto ' : ''}${b.aliasDe ? `aliasDe=${b.aliasDe} ` : ''}${b.porDefecto ? 'porDefecto' : ''}`);
  }
  console.log(`\n  con porDefecto:true → ${hayDefault.length} (${hayDefault.map(b => b.nombre).join(', ') || 'ninguno'})`);

  // Misma invariante que valida el cliente: exactamente uno.
  if (hayDefault.length !== 1) {
    console.log(`\n  ABORTA: tiene que quedar exactamente UN porDefecto, quedaron ${hayDefault.length}.`);
    process.exitCode = 1;
    return;
  }
  // Nadie puede quedar apuntando al medio borrado con aliasDe.
  const huerfanos = nuevos.filter(b => b.aliasDe && !nuevos.some(x => x.id === b.aliasDe));
  if (huerfanos.length > 0) {
    console.log(`\n  ABORTA: quedan aliasDe huérfanos: ${huerfanos.map(b => `${b.nombre}→${b.aliasDe}`).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log('\nDRY-RUN: no se escribió nada. Volver a correr con --apply --i-am-sure.');
    return;
  }

  await ref.update({ bancos: nuevos });
  const post = ((await ref.get()).data() as any).bancos as any[];
  console.log('\nEscrito. Relectura de config/familia.bancos:');
  console.log(JSON.stringify(post, null, 2));
}

main().then(() => process.exit(process.exitCode ?? 0)).catch(e => { console.error(e); process.exit(1); });
