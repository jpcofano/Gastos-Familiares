// F9.139 §2 — migración one-shot: movimientos con `banco: 'Efectivo'` → `banco: 'Mercado Pago'`.
//
// EL ORDEN IMPORTA Y NO ES NEGOCIABLE. `medioCanonico('Efectivo')` resuelve a "Mercado Pago"
// leyendo la entrada Efectivo de `config/familia.bancos`. Si se borra el medio primero, la función
// no encuentra `aliasDe`, devuelve el nombre tal cual, y los movimientos históricos vuelven a
// mostrarse como fila propia "Efectivo". El alias muere junto con el medio.
//   1. Correr esto (deja los datos ya apuntando al medio real).
//   2. Recién con la relectura en 0, sacar Efectivo de config/familia.bancos.
//   3. Recién ahí, deploy.
//
// Solo toca `banco`. NO toca subtipo, origen, ni ningún otro campo: la plata no cambió de mano,
// cambió el nombre con el que la registramos.
//
// Dry-run por defecto. Para escribir hacen falta LAS DOS flags: `--apply --i-am-sure`.
//
// Uso:
//   npx tsx scripts/migrarEfectivoAMp.ts --target=production
//   npx tsx scripts/migrarEfectivoAMp.ts --target=production --apply --i-am-sure

import { getDb } from './seed/utils/firestore';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
const apply = process.argv.includes('--apply') && process.argv.includes('--i-am-sure');
const applyPedido = process.argv.includes('--apply');

const DESDE = 'Efectivo';
const HACIA = 'Mercado Pago';

async function main() {
  const db = getDb(target as 'emulator' | 'production');

  const snap = await db.collection('movimientos').where('banco', '==', DESDE).get();
  console.log(`\n=== movimientos con banco === "${DESDE}" ===`);
  console.log(`  encontrados: ${snap.size}`);

  if (snap.size === 0) {
    console.log('\nNada que migrar.');
    console.log(JSON.stringify({ encontrados: 0, actualizados: 0, restantes: 0 }));
    return;
  }

  // Desglose antes de escribir: una migración que no se puede revisar antes es un borrado a ciegas.
  const porMes = new Map<string, number>();
  const porOrigen = new Map<string, number>();
  for (const d of snap.docs) {
    const m = d.data() as any;
    porMes.set(String(m.mes), (porMes.get(String(m.mes)) ?? 0) + 1);
    porOrigen.set(String(m.origen ?? '—'), (porOrigen.get(String(m.origen ?? '—')) ?? 0) + 1);
  }
  console.log('\n  por mes:');
  for (const [k, n] of [...porMes.entries()].sort()) console.log(`    ${k.padEnd(10)} ${n}`);
  console.log('\n  por origen:');
  for (const [k, n] of [...porOrigen.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(18)} ${n}`);

  // La config tiene que seguir teniendo Efectivo cuando esto corre: es lo que hace que el alias
  // siga vivo mientras se migra. Si ya no está, el paso 2 se adelantó y hay que avisarlo.
  const cfg = (await db.collection('config').doc('familia').get()).data() as any;
  const bancos: any[] = Array.isArray(cfg?.bancos) ? cfg.bancos : [];
  const efectivoEnCfg = bancos.find(b => b.nombre === DESDE);
  const mpEnCfg = bancos.find(b => b.nombre === HACIA);
  console.log(`\n  config/familia.bancos: Efectivo ${efectivoEnCfg ? 'presente' : 'AUSENTE'} · Mercado Pago ${mpEnCfg ? 'presente' : 'AUSENTE'}`);
  if (!mpEnCfg) {
    console.log('\n  ABORTA: "Mercado Pago" no está en la config. Migrar hacia un medio inexistente');
    console.log('  crearía el mismo problema que este script viene a cerrar.');
    process.exitCode = 1;
    return;
  }
  if (!efectivoEnCfg) {
    console.log('\n  AVISO: Efectivo ya no está en la config, así que el paso 2 se corrió antes que');
    console.log('  el paso 1. La migración sigue siendo correcta y necesaria (los datos quedaron');
    console.log('  apuntando a un medio que no existe), pero mientras tanto se mostraron mal.');
  }

  if (!apply) {
    if (applyPedido) console.log('\n  --apply sin --i-am-sure: no se escribe. Hacen falta las dos.');
    console.log('\nDRY-RUN: no se escribió nada. Volver a correr con --apply --i-am-sure.');
    console.log(JSON.stringify({ encontrados: snap.size, actualizados: 0, restantes: snap.size }));
    return;
  }

  const BATCH = 400;
  for (let i = 0; i < snap.docs.length; i += BATCH) {
    const batch = db.batch();
    for (const d of snap.docs.slice(i, i + BATCH)) batch.update(d.ref, { banco: HACIA });
    await batch.commit();
  }

  // Relectura: el conteo que importa es el de después, no el de antes.
  const post = await db.collection('movimientos').where('banco', '==', DESDE).get();
  console.log(`\nActualizados ${snap.size} movimientos: "${DESDE}" → "${HACIA}".`);
  console.log(`Relectura: ${post.size} restantes con "${DESDE}".`);
  console.log(JSON.stringify({ encontrados: snap.size, actualizados: snap.size, restantes: post.size }));
}

main().then(() => process.exit(process.exitCode ?? 0)).catch(e => { console.error(e); process.exit(1); });
