// F9.136 — (a) detalle de los ítems de tarjeta que la card muestra en 0 o en 1, y
// (b) matriz EXHAUSTIVA estado × match: qué acción ofrece la card en cada combinación,
// incluidas las que hoy no existen en los datos. SOLO LEE.
//
// Uso: npx tsx scripts/auditF9136b.ts --target=production

import { getDb } from './seed/utils/firestore';
import { calcularChecklist } from '../src/datos/checklist';
import type { Movement, ExpectedItem } from '../src/types';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
const aFecha = (v: any) => (v && typeof v.toDate === 'function') ? v.toDate() : new Date(v);

const ESTADOS = ['pagado', 'automatico', 'por_confirmar', 'parcial', 'pendiente', 'vencido', 'programado', 'no_registrado', 'no_aplica'] as const;
const ACCIONABLE = ['pendiente', 'vencido', 'no_registrado', 'por_confirmar'];

async function main() {
  const db = getDb(target as 'emulator' | 'production');
  const mes = new Date().toISOString().slice(0, 7);

  const snapMov = await db.collection('movimientos').where('mes', '==', mes).get();
  const movs = snapMov.docs.map(d => ({ id: d.id, ...(d.data() as any), fecha: aFecha(d.data().fecha) })) as Movement[];
  const snapItems = await db.collection('itemsEsperados').get();
  const items = snapItems.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ExpectedItem[];
  const checklist = calcularChecklist(items, movs, mes);

  // ── A. Los ítems de tarjeta que la card muestra en 0 o en 1
  console.log('=== A — ítems de tarjeta que la card renderiza en 0 o en 1 ===');
  for (const ci of checklist) {
    if (ci.item.tarjetaCodigo == null) continue;
    const real = ci.matches.reduce((s, m) => s + Math.abs(m.monto), 0);
    const monto = ci.matches.length > 0 ? real : (ci.item.montoEsperado ?? 0);
    if (monto > 1) continue;
    console.log(`\n  itemId=${ci.item.id}  estado=${ci.estado}  card muestra=${monto}`);
    console.log(`    tarjetaCodigo=${ci.item.tarjetaCodigo}  moneda=${ci.item.moneda}  activo=${ci.item.activo}`);
    console.log(`    montoEsperado=${ci.item.montoEsperado}  diaVencimiento=${ci.item.diaVencimiento}  notas=${ci.item.notas ?? '—'}`);
    console.log(`    matches=${ci.matches.length}`);
    for (const m of ci.matches) {
      console.log(`      · "${m.descripcion}" monto=${m.monto} ${m.moneda} origen=${m.origen} subtipo=${m.subtipo}`);
      console.log(`        resumenTarjetaId=${m.resumenTarjetaId ?? 'null'} excluirDash=${m.excluirDash} incluirResumenMes=${m.incluirResumenMes}`);
    }
  }

  // ── B. Matriz exhaustiva estado × match
  console.log('\n\n=== B — matriz estado × match: acción que ofrece la card (post-F9.136) ===');
  console.log('  estado          match  accionable  Confirmar  Registrar  Deshacer  →  resultado');
  for (const estado of ESTADOS) {
    for (const conMatch of [false, true]) {
      const n = conMatch ? 1 : 0;
      const acc = ACCIONABLE.includes(estado);
      const confirmar = (estado === 'por_confirmar' || estado === 'vencido') && n > 0;
      const registrar = acc && n === 0;
      const deshacer = estado === 'pagado' && n > 0;
      const alguna = confirmar || registrar || deshacer;
      // Combinaciones que `estadoItem` no puede producir: con match nunca devuelve
      // pendiente/programado/no_registrado/automatico; sin match nunca devuelve
      // pagado-por-match/por_confirmar/parcial.
      const imposible = conMatch
        ? ['pendiente', 'programado', 'no_registrado', 'automatico'].includes(estado)
        : ['por_confirmar', 'parcial'].includes(estado);
      const veredicto = imposible ? 'n/a (no la produce estadoItem)'
        : alguna ? 'ok'
        : acc ? '*** ACCIONABLE SIN ACCIÓN ***'
        : 'sin acción (no accionable, correcto)';
      console.log(`  ${estado.padEnd(15)} ${String(n).padEnd(6)} ${String(acc).padEnd(11)} ${String(confirmar).padEnd(10)} ${String(registrar).padEnd(10)} ${String(deshacer).padEnd(9)} →  ${veredicto}`);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
