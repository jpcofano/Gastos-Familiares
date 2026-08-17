// F9.142 §2 — corrige configPatrimonio/cafci: saca el fondo mal identificado y el fondo vacío,
// agrega el Pionero que corresponde. Equivale a hacerlo desde Patrimonio › Config CAFCI.
//
// Por defecto NO escribe: muestra el diff y termina. Escribe solo con --aplicar.
// Antes de escribir imprime la config anterior completa, para poder restaurarla a mano.
//
//   npx tsx scripts/configF9142.ts --target=production
//   npx tsx scripts/configF9142.ts --target=production --aplicar
//
// Después de aplicar hay que tocar "Sincronizar" en la UI: el callable exige auth del dueño,
// así que este script no puede traer la cartera de 39/6174 por su cuenta.

import { getDb } from './seed/utils/firestore';

const args = process.argv.slice(2);
const target = args.includes('--target=production') ? 'production' : 'emulator';
const aplicar = args.includes('--aplicar');

type Fondo = { fondoId: string; claseId: string; nombre: string };

// Mismo contenido que FONDOS_SEED en src/datos/patrimonioCafci.ts tras F9.142 §3.
const FONDOS_NUEVOS: Fondo[] = [
  { fondoId: '216', claseId: '1634', nombre: 'Consultatio Acciones Argentina - Clase C' },
  { fondoId: '51',  claseId: '683',  nombre: 'Superfondo Renta Variable - Clase B' },
  { fondoId: '22',  claseId: '1193', nombre: 'Fima PB Acciones - Clase B' },
  { fondoId: '370', claseId: '662',  nombre: 'Delta Acciones - Clase B' },
  { fondoId: '275', claseId: '275',  nombre: '1810 Renta Variable Argentina - única' },
  { fondoId: '436', claseId: '821',  nombre: 'SBS Acciones Argentina - Clase B' },
  { fondoId: '39',  claseId: '6174', nombre: 'Pionero Acciones - Clase B' },
  { fondoId: '227', claseId: '227',  nombre: 'Premier Renta Variable - Clase A' },
  { fondoId: '441', claseId: '836',  nombre: 'Allaria Acciones - Clase B' },
  { fondoId: '615', claseId: '2249', nombre: 'Galileo Acciones - Clase B' },
  { fondoId: '505', claseId: '1021', nombre: 'MAF Acciones Argentina - Clase B' },
  { fondoId: '430', claseId: '804',  nombre: 'IAM Renta Variable - Clase B' },
];

async function main() {
  const db = getDb(target as 'emulator' | 'production');
  const ref = db.collection('configPatrimonio').doc('cafci');
  const snap = await ref.get();
  const actuales: Fondo[] = snap.exists ? ((snap.data() as any).fondos ?? []) : [];

  console.log('\n=== CONFIG ANTERIOR (copiala si querés poder volver) ===');
  console.log(JSON.stringify({ fondos: actuales }, null, 2));

  const clave = (f: Fondo) => `${f.fondoId}/${f.claseId}`;
  const claveNueva = new Set(FONDOS_NUEVOS.map(clave));
  const claveActual = new Set(actuales.map(clave));

  console.log('\n=== DIFF ===');
  for (const f of actuales) if (!claveNueva.has(clave(f))) console.log(`  − ${clave(f)}  "${f.nombre}"`);
  for (const f of FONDOS_NUEVOS) if (!claveActual.has(clave(f))) console.log(`  + ${clave(f)}  "${f.nombre}"`);
  for (const f of FONDOS_NUEVOS) {
    const previo = actuales.find(a => clave(a) === clave(f));
    if (previo && previo.nombre !== f.nombre) console.log(`  ~ ${clave(f)}  "${previo.nombre}" → "${f.nombre}"`);
  }
  console.log(`\n  ${actuales.length} fondos → ${FONDOS_NUEVOS.length} fondos`);

  if (!aplicar) {
    console.log('\nSIMULACIÓN. No se escribió nada. Volvé a correr con --aplicar para escribir.');
    return;
  }

  // merge:true replica guardarConfigCafci(): el array `fondos` se reemplaza entero, que es
  // justo lo que hace falta para que una baja sea una baja.
  await ref.set({ fondos: FONDOS_NUEVOS }, { merge: true });
  console.log('\nESCRITO en configPatrimonio/cafci.');

  const verif = await ref.get();
  const post: Fondo[] = (verif.data() as any).fondos ?? [];
  const ok = post.length === FONDOS_NUEVOS.length && post.every(f => claveNueva.has(clave(f)));
  console.log(`relectura: ${post.length} fondos · ${ok ? 'coincide ✓' : 'NO COINCIDE ✗'}`);
  console.log(`  ${post.map(clave).join(' ')}`);
  console.log('\nFalta: tocar "Sincronizar" en Patrimonio › Config CAFCI para que 39/6174 traiga su cartera.');
}

main().catch(e => { console.error(e); process.exit(1); });
