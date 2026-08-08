// F9.132.2 — check final: los `pagado: true, confirmadoPago: false` del día caen en la Card 2
// y no en la Card 1. SOLO LEE.
// Uso: npx tsx scripts/auditF91322c.ts --target=production --dia=2026-08-07

import { getDb } from './seed/utils/firestore';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
const argDia = process.argv.find(a => a.startsWith('--dia='))?.slice(6)!;

const aFecha = (v: any) => (v && typeof v.toDate === 'function') ? v.toDate() : new Date(v);
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const db = getDb(target as 'emulator' | 'production');
  const snap = await db.collection('movimientos').where('mes', '==', argDia.slice(0, 7)).get();
  const delDia = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
    .filter(m => m.tipo === 'Gasto' && m.incluirResumenMes && iso(aFecha(m.fecha)) === argDia);

  const card1 = delDia.filter(m => m.pagado !== true);
  const card2 = delDia.filter(m => m.pagado === true);
  const sinConfirmar = delDia.filter(m => m.pagado === true && m.confirmadoPago !== true);

  console.log(`día ${argDia} · ${delDia.length} gastos del día\n`);
  console.log(`pagado:true + confirmadoPago:false → ${sinConfirmar.length}`);
  for (const m of sinConfirmar) {
    const enC1 = card1.some(x => x.id === m.id), enC2 = card2.some(x => x.id === m.id);
    console.log(`  ${(m.descripcion ?? '').slice(0, 46).padEnd(48)} card1=${enC1} card2=${enC2}`);
  }
  const ids1 = new Set(card1.map(m => m.id));
  const solapan = card2.filter(m => ids1.has(m.id));
  console.log(`\ncards excluyentes: ${solapan.length === 0 ? 'OK (0 solapamientos)' : `FALLA (${solapan.length})`}`);
  console.log(`card1 (${card1.length}) + card2 (${card2.length}) = ${card1.length + card2.length} · fila HOY = ${delDia.length}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
