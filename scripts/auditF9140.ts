// F9.140 §0 (gate) — ¿el segundo caso incoherente es FÓSIL o lo escribió un writer vivo?
//
// De eso depende si §2 se puede implementar: si hay un writer vivo, el guard taparía el síntoma
// sin que nadie sepa quién lo produce. SOLO LEE.
//
// Reporta el `actualizadoEn` COMPLETO (ms, UTC y hora de Argentina) de los dos casos que la
// corrida del 14/8 encontró, más el estado actual del par en cada uno, más cualquier otro
// movimiento tocado en la misma ventana horaria (para ubicar el deploy sin la consola).
//
// Uso: npx tsx scripts/auditF9140.ts --target=production

import { getDb } from './seed/utils/firestore';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';

const aDate = (v: any): Date | null => {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return isNaN(+d) ? null : d;
};
const arg = (d: Date | null) => d
  ? d.toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }) + ' AR'
  : '—';
const utc = (d: Date | null) => d ? d.toISOString() : '—';

async function main() {
  const db = getDb(target as 'emulator' | 'production');

  // Los dos casos nombrados en el spec, por descripción + monto (no por id: uno solo se conoce).
  const objetivos = [
    { desc: 'ITPA', monto: 2003500 },
    { desc: 'Signo', monto: 184245 },
  ];

  const snap = await db.collection('movimientos').where('mes', '==', '2026-08').get();
  const movs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  console.log(`mes 2026-08 · ${movs.length} movimientos\n`);

  console.log('=== A — los dos casos del §0, estado actual y timestamps completos ===');
  for (const o of objetivos) {
    const hits = movs.filter(m =>
      String(m.descripcion ?? '').toUpperCase().includes(o.desc.toUpperCase()) &&
      Math.round(Math.abs(Number(m.monto))) === o.monto,
    );
    if (hits.length === 0) { console.log(`\n  ${o.desc} / ${o.monto}: NO ENCONTRADO`); continue; }
    for (const m of hits) {
      console.log(`\n  ${m.id}  "${m.descripcion}"  ${m.moneda} ${Number(m.monto).toLocaleString('es-AR')}`);
      console.log(`    pagado=${m.pagado}  confirmadoPago=${m.confirmadoPago}  ← el par debe estar en true/true`);
      console.log(`    origen=${m.origen}  subtipo=${m.subtipo}  itemEsperadoId=${m.itemEsperadoId ?? 'null'}`);
      console.log(`    fecha         = ${utc(aDate(m.fecha))}`);
      console.log(`    pagadoEn      = ${utc(aDate(m.pagadoEn))}   ${arg(aDate(m.pagadoEn))}`);
      console.log(`    actualizadoEn = ${utc(aDate(m.actualizadoEn))}   ${arg(aDate(m.actualizadoEn))}`);
      console.log(`    creadoEn      = ${utc(aDate(m.creadoEn))}   ${arg(aDate(m.creadoEn))}`);
      console.log(`    hashPdf=${m.hashPdf ?? 'null'}  origenComprobanteId=${m.origenComprobanteId ?? 'null'}`);
    }
  }

  // B — el par imposible, ahora. Debería dar 0 tras la corrida del 14/8.
  console.log('\n=== B — pares imposibles hoy (confirmadoPago:true + pagado:false) ===');
  const todos = await db.collection('movimientos').where('confirmadoPago', '==', true).get();
  const rotos = todos.docs.filter(d => d.data().pagado !== true);
  console.log(`  confirmados en total: ${todos.size} · incoherentes: ${rotos.length}`);
  for (const d of rotos) {
    const m = d.data() as any;
    console.log(`    ${d.id} · ${m.mes} · ${String(m.descripcion).slice(0, 40)} · actualizadoEn=${utc(aDate(m.actualizadoEn))}`);
  }

  // C — ventana del 14/8: qué se tocó ese día y en qué orden. Sirve para ubicar el corte del
  // deploy sin la consola: los movimientos escritos DESPUÉS del deploy salieron del bundle nuevo.
  console.log('\n=== C — todo lo escrito el 2026-08-14 (orden cronológico) ===');
  const del14 = movs
    .map(m => ({ m, ts: aDate(m.actualizadoEn) }))
    .filter(x => x.ts && utc(x.ts).slice(0, 10) === '2026-08-14')
    .sort((a, b) => a.ts!.getTime() - b.ts!.getTime());
  if (del14.length === 0) console.log('  (ninguno)');
  for (const { m, ts } of del14) {
    console.log(`  ${utc(ts)}  ${arg(ts).slice(11)}  pagado=${String(m.pagado).padEnd(5)} conf=${String(m.confirmadoPago).padEnd(5)} ${String(m.descripcion).slice(0, 34)}`);
  }

  // D — la huella del writer viejo: `pagadoEn` escrito sin `pagado`. Tras la limpieza el par ya
  // está corregido, así que esto no puede distinguir; se deja como chequeo de que no reaparezca.
  console.log('\n=== D — movimientos con pagadoEn pero pagado !== true (huella del writer pre-F9.138) ===');
  const huella = movs.filter(m => m.pagadoEn && m.pagado !== true);
  console.log(`  ${huella.length}`);
  for (const m of huella) console.log(`    ${m.id} · ${String(m.descripcion).slice(0, 40)} · actualizadoEn=${utc(aDate(m.actualizadoEn))}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
