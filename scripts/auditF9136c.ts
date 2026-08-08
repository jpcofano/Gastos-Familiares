// F9.136 verificación — los movimientos vencidos de la Card 1: a qué ítem del checklist
// cuelgan y por qué botón se marcan pagados desde Gastos Fijos. SOLO LEE.
//
// Uso: npx tsx scripts/auditF9136c.ts --target=production

import { getDb } from './seed/utils/firestore';
import { calcularChecklist } from '../src/datos/checklist';
import type { Movement, ExpectedItem } from '../src/types';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
const aFecha = (v: any) => (v && typeof v.toDate === 'function') ? v.toDate() : new Date(v);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
const ACCIONABLE = ['pendiente', 'vencido', 'no_registrado', 'por_confirmar'];

// Fecha efectiva del MOVIMIENTO, igual que `fechaEfectivaMov` en Resumen.tsx.
function fechaEfectiva(m: any): string {
  const v = m.vencimientos;
  if (Array.isArray(v) && v.length > 0 && v[0]?.fecha) return String(v[0].fecha).slice(0, 10);
  return iso(aFecha(m.fecha));
}

async function main() {
  const db = getDb(target as 'emulator' | 'production');
  const hoy = new Date();
  const diaIso = iso(hoy);
  const mes = diaIso.slice(0, 7);

  const snapMov = await db.collection('movimientos').where('mes', '==', mes).get();
  const movs = snapMov.docs.map(d => ({ id: d.id, ...(d.data() as any), fecha: aFecha(d.data().fecha) })) as Movement[];
  const snapItems = await db.collection('itemsEsperados').get();
  const items = snapItems.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ExpectedItem[];
  const checklist = calcularChecklist(items, movs, mes);

  const vencidos = movs.filter(m =>
    m.tipo === 'Gasto' && m.incluirResumenMes && m.pagado !== true && fechaEfectiva(m) < diaIso
  ).sort((a, b) => fechaEfectiva(a).localeCompare(fechaEfectiva(b)));

  console.log(`día ${diaIso} · ${vencidos.length} movimientos vencidos en la Card 1\n`);
  const rotulo = (ci: any) => [ci.item.categoria, ci.item.subcategoria].filter(Boolean).join(' › ') || ci.item.notas || ci.item.id;

  for (const m of vencidos) {
    const ci = checklist.find(c => c.matches.some(x => x.id === m.id));
    console.log(`· ${(m.descripcion ?? '').slice(0, 40).padEnd(42)} ${fechaEfectiva(m)}  $ ${fmt(m.monto)}`);
    if (!ci) {
      console.log(`    NINGÚN ítem lo reclama → no aparece en Gastos Fijos.`);
      console.log(`    Se marca desde la Card 1 (lápiz → editar movimiento) o desde Gastos.\n`);
      continue;
    }
    const n = ci.matches.length;
    const acc = ACCIONABLE.includes(ci.estado);
    const confirmar = (ci.estado === 'por_confirmar' || ci.estado === 'vencido') && n > 0;
    const registrar = acc && n === 0;
    const deshacer = ci.estado === 'pagado' && n > 0;
    const boton = confirmar ? '"Confirmar pago"' : registrar ? '"Registrar pago"' : deshacer ? '"Deshacer"' : 'NINGUNO';
    const antes = ci.estado === 'por_confirmar' ? '"Confirmar pago"' : (acc && n === 0) ? '"Registrar pago"' : 'NINGUNO';
    console.log(`    ítem: ${rotulo(ci)} · estado=${ci.estado} · matches=${n}`);
    console.log(`    botón ANTES de F9.136: ${antes}`);
    console.log(`    botón AHORA:           ${boton}\n`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
