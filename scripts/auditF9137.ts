// F9.137 §1 — medición ANTES de decidir. SOLO LEE.
//
// Dos preguntas separadas, que no hay que mezclar:
//   (A) ¿cuántos ítems cambian de bucket al preguntar por `matches.length` en vez del estado,
//       y cuánto mueve eso a `pendientes` / `totalPendienteUsd`?
//   (B) ¿`totalPendienteUsd` debería usar `realUsd` cuando existe? Cuánto cambia el número.
// (A) es el fix del patrón. (B) es una decisión de producto que (A) no obliga a tomar.
//
// Uso: npx tsx scripts/auditF9137.ts --target=production [--mes=2026-08]

import { getDb } from './seed/utils/firestore';
import { calcularChecklist, cubierto, type CheckItem } from '../src/datos/checklist';
import type { Movement, ExpectedItem } from '../src/types';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
const argMes = process.argv.find(a => a.startsWith('--mes='))?.slice(6);

const aFecha = (v: any) => (v && typeof v.toDate === 'function') ? v.toDate() : new Date(v);
const fmt = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
const rotulo = (ci: any) => ci.item.notas || [ci.item.categoria, ci.item.subcategoria].filter(Boolean).join(' › ') || ci.item.id;

// usdEq replicado igual que informeMensual.ts (mismo criterio de conversión).
const usdEq = (m: Movement, tc: number) => m.moneda === 'USD' ? Math.abs(m.monto) : (tc ? Math.abs(m.monto) / tc : 0);

async function main() {
  const db = getDb(target as 'emulator' | 'production');
  const mes = argMes ?? new Date().toISOString().slice(0, 7);

  const snapMov = await db.collection('movimientos').where('mes', '==', mes).get();
  const movs = snapMov.docs.map(d => ({ id: d.id, ...(d.data() as any), fecha: aFecha(d.data().fecha) })) as Movement[];
  const snapItems = await db.collection('itemsEsperados').get();
  const items = snapItems.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ExpectedItem[];
  const checklist = calcularChecklist(items, movs, mes);

  // TC: los docs de /tcDiario se identifican por fecha (YYYY-MM-DD) y el campo es `tcUsdArs`.
  // Se lee la colección entera y se ordena en memoria: `orderBy('__name__')` pide un índice
  // compuesto y no vale crear uno para un script de auditoría. La colección es chica.
  // El TC no cambia el delta —se aplica igual en las dos variantes— pero hace creíbles los totales.
  const snapTc = await db.collection('tcDiario').get();
  const ultimo = snapTc.docs.map(d => d.id).sort().pop();
  const tc = ultimo ? Number(snapTc.docs.find(d => d.id === ultimo)!.data().tcUsdArs ?? 1) : 1;
  console.log(`mes ${mes} · ${checklist.length} ítems · tc=${tc} (${ultimo ?? 'sin dato'})\n`);

  const bucketViejo = (ci: CheckItem) => cubierto(ci.estado) ? 'pagado'
    : (ci.estado === 'por_confirmar' || ci.estado === 'parcial' || ci.estado === 'programado') ? 'a confirmar'
    : 'pendiente';
  const bucketNuevo = (ci: CheckItem) => cubierto(ci.estado) ? 'pagado'
    : (ci.matches.length > 0 || ci.estado === 'programado') ? 'a confirmar'
    : 'pendiente';

  // ── A. Cambios de bucket
  console.log('=== A — ítems que cambian de bucket ===');
  let cambian = 0;
  for (const ci of checklist) {
    if (ci.estado === 'no_aplica') continue;
    const v = bucketViejo(ci), n = bucketNuevo(ci);
    if (v !== n) {
      cambian++;
      const real = ci.matches.reduce((s, m) => s + usdEq(m, tc), 0);
      console.log(`  · ${rotulo(ci).slice(0, 34).padEnd(36)} ${String(ci.estado).padEnd(14)} m=${ci.matches.length}  ${v} → ${n}   esp=${ci.item.montoEsperado ?? 'null'} realUsd=${fmt(real)}`);
    }
  }
  if (cambian === 0) console.log('  (ninguno)');

  // ── Totales de las dos variantes
  const totales = (bucket: (ci: CheckItem) => string, usarReal: boolean) => {
    let n = 0, suma = 0;
    for (const ci of checklist) {
      if (ci.estado === 'no_aplica') continue;
      if (bucket(ci) !== 'pendiente') continue;
      n++;
      const esperadoUsd = ci.item.montoEsperado == null ? null
        : ci.item.moneda === 'USD' ? ci.item.montoEsperado : (tc ? ci.item.montoEsperado / tc : null);
      const realUsd = ci.matches.length > 0 ? ci.matches.reduce((s, m) => s + usdEq(m, tc), 0) : null;
      suma += usarReal ? (realUsd ?? esperadoUsd ?? 0) : (esperadoUsd ?? 0);
    }
    return { n, suma };
  };

  const antes = totales(bucketViejo, false);
  const despues = totales(bucketNuevo, false);
  console.log('\n=== totales: pendientes / totalPendienteUsd ===');
  console.log(`  ANTES  (estado como proxy):        pendientes=${antes.n}  totalPendienteUsd=${fmt(antes.suma)}`);
  console.log(`  DESPUÉS (matches.length):          pendientes=${despues.n}  totalPendienteUsd=${fmt(despues.suma)}`);
  console.log(`  delta:                             ${despues.n - antes.n} ítems  ${fmt(despues.suma - antes.suma)} USD`);

  // ── B. ¿usar realUsd cuando existe? — decisión aparte
  const conReal = totales(bucketNuevo, true);
  console.log('\n=== B — si `totalPendienteUsd` usara realUsd cuando existe ===');
  console.log(`  con esperadoUsd (como está):       ${fmt(despues.suma)}`);
  console.log(`  con realUsd cuando existe:         ${fmt(conReal.suma)}`);
  console.log(`  delta:                             ${fmt(conReal.suma - despues.suma)} USD`);
  const pendConMatch = checklist.filter(ci => ci.estado !== 'no_aplica' && bucketNuevo(ci) === 'pendiente' && ci.matches.length > 0);
  console.log(`  ítems 'pendiente' CON match (los únicos donde el cambio aplica): ${pendConMatch.length}`);
  for (const ci of pendConMatch) console.log(`    · ${rotulo(ci)}`);

  // ── C. §4 — esperados sin montoEsperado que la card imprime como "$ 0"
  console.log('\n=== C — §4: ítems sin montoEsperado y sin match (la card los rinde "$ 0") ===');
  const sinMonto = checklist.filter(ci => ci.item.montoEsperado == null && ci.matches.length === 0);
  console.log(`  ${sinMonto.length} de ${checklist.length}`);
  for (const ci of sinMonto) console.log(`    · ${rotulo(ci).slice(0, 40).padEnd(42)} ${ci.estado}`);

  // ── D. El caso que dispara §1, construido a mano.
  // Hoy los datos NO lo contienen porque F9.138 limpió los `confirmadoPago` incoherentes: sin
  // ítems 'vencido' CON match, el delta de (A) da cero. Que no haya datos que lo disparen no es
  // lo mismo que que el bug no exista — llega solo con que entre una factura impaga de fecha
  // pasada por extracto. Se construye el caso en memoria (NO toca Firestore) para verificar que
  // el fix hace lo correcto, en vez de declarar "0 cambios" y dar por probado el arreglo.
  console.log('\n=== D — caso sintético: ítem vencido CON match (in-memory, no toca Firestore) ===');
  const falso = {
    item: { id: 'x', categoria: 'Casa', subcategoria: 'Luz', notas: null, montoEsperado: 100000, moneda: 'ARS' },
    matches: [{ id: 'm1', monto: 136533, moneda: 'ARS' }],
    estado: 'vencido',
  } as unknown as CheckItem;
  const realFalso = falso.matches.reduce((s: number, m: Movement) => s + usdEq(m, tc), 0);
  const espFalso = 100000 / tc;
  console.log(`  ítem 'vencido' con 1 match · esperadoUsd=${fmt(espFalso)} realUsd=${fmt(realFalso)}`);
  console.log(`  bucket ANTES:   ${bucketViejo(falso)}   → cuenta en 'pendientes' y suma ${fmt(espFalso)} (el ESPERADO)`);
  console.log(`  bucket DESPUÉS: ${bucketNuevo(falso)}  → sale de 'pendientes'; su plata ya está cargada`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
