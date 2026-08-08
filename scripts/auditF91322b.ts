// F9.132.2 §4 — conteo por estado con el motor REAL (`calcularChecklist`), antes vs. después.
// `checklist.ts` solo tiene imports de tipo, así que se puede importar directo bajo tsx.
// SOLO LEE.
//
// Uso: npx tsx scripts/auditF91322b.ts --target=production [--dia=2026-08-07]

import { getDb } from './seed/utils/firestore';
import { calcularChecklist } from '../src/datos/checklist';
import type { Movement, ExpectedItem } from '../src/types';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
const argDia = process.argv.find(a => a.startsWith('--dia='))?.slice(6);

function aFecha(v: any): Date {
  if (v && typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  return new Date(v);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const db = getDb(target as 'emulator' | 'production');
  const hoy = argDia ? new Date(`${argDia}T12:00:00`) : new Date();
  const diaIso = iso(hoy);
  const mes = diaIso.slice(0, 7);

  const snapMov = await db.collection('movimientos').where('mes', '==', mes).get();
  const movs = snapMov.docs.map(d => ({ id: d.id, ...(d.data() as any), fecha: aFecha(d.data().fecha) })) as Movement[];
  const snapItems = await db.collection('itemsEsperados').get();
  const items = snapItems.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ExpectedItem[];

  const checklist = calcularChecklist(items, movs, mes);
  console.log(`día ${diaIso} · ${movs.length} movs · ${checklist.length} ítems en checklist\n`);

  const conteo: Record<string, number> = {};
  for (const ci of checklist) conteo[ci.estado] = (conteo[ci.estado] ?? 0) + 1;
  console.log('=== conteo por estado ACTUAL ===');
  for (const [e, n] of Object.entries(conteo).sort((a, b) => b[1] - a[1])) console.log(`  ${e.padEnd(16)} ${n}`);

  // Regla nueva simulada sobre el mismo checklist.
  const rotulo = (ci: any) => [ci.item.categoria, ci.item.subcategoria].filter(Boolean).join(' › ') || ci.item.notas || ci.item.id;
  const fechaEfectiva = (ci: any): string | null => {
    const v = ci.matches[0]?.vencimientos;
    if (Array.isArray(v) && v.length > 0 && v[0]?.fecha) return String(v[0].fecha).slice(0, 10);
    if (ci.item.diaVencimiento) return `${mes}-${String(ci.item.diaVencimiento).padStart(2, '0')}`;
    return null;
  };
  const cubierto = (ci: any) => ci.matches.some((m: Movement) => m.pagado === true || m.confirmadoPago === true);

  console.log('\n=== regla NUEVA: fecha efectiva < hoy y no cubierto ===');
  const nuevos: any[] = [];
  for (const ci of checklist) {
    if (ci.estado === 'pagado' || ci.estado === 'automatico' || ci.estado === 'programado' || ci.estado === 'no_aplica') continue;
    const f = fechaEfectiva(ci);
    if (f != null && f < diaIso && !cubierto(ci)) nuevos.push({ ci, f });
  }
  console.log(`  pasan a 'vencido': ${nuevos.length}`);
  for (const { ci, f } of nuevos) {
    console.log(`      ${rotulo(ci).slice(0, 40).padEnd(42)} estado actual=${String(ci.estado).padEnd(14)} fechaEfectiva=${f} matches=${ci.matches.length}`);
  }

  console.log('\n=== detalle: ítems accionables y su fecha efectiva ===');
  for (const ci of checklist) {
    if (ci.estado === 'pagado' || ci.estado === 'automatico' || ci.estado === 'no_aplica') continue;
    console.log(`  ${rotulo(ci).slice(0, 38).padEnd(40)} ${String(ci.estado).padEnd(14)} fe=${String(fechaEfectiva(ci) ?? '—').padEnd(12)} dv=${String(ci.item.diaVencimiento ?? 'null').padEnd(5)} m=${ci.matches.length} cub=${cubierto(ci)}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
