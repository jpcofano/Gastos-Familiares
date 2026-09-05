// F9.158 — estado REAL del checklist de los ítems de tarjeta, leído de Firestore después de cada
// paso. Usa `calcularChecklist` importado del código, no una réplica. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { calcularChecklist } from '../src/datos/checklist';
import type { Movement, ExpectedItem } from '../src/types';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

async function main() {
  const itemsSnap = await db.collection('itemsEsperados').get();
  const movsSnap = await db.collection('movimientos').get();

  const items: ExpectedItem[] = itemsSnap.docs.map(d => {
    const y = d.data();
    return {
      id: d.id, tipo: y.tipo, activo: y.activo ?? false,
      categoria: y.categoria ?? null, subcategoria: y.subcategoria ?? null,
      etiqueta: y.etiqueta ?? null, persona: y.persona ?? null,
      moneda: y.moneda ?? 'ARS', banco: y.banco ?? null,
      montoEsperado: y.montoEsperado ?? null, diaVencimiento: y.diaVencimiento ?? null,
      autoCalendario: y.autoCalendario ?? false, notas: y.notas ?? null,
      tarjetaCodigo: y.tarjetaCodigo ?? null,
      matchTexto: y.matchTexto ? { incluye: y.matchTexto.incluye ?? [], excluye: y.matchTexto.excluye ?? [] } : null,
      periodicidad: y.periodicidad || 'mensual', pagoAutomatico: y.pagoAutomatico ?? false,
      clavesDesambiguacion: Array.isArray(y.clavesDesambiguacion) ? y.clavesDesambiguacion : null,
      diaCorteImputacion: y.diaCorteImputacion ?? null,
    } as ExpectedItem;
  });

  const movimientos: Movement[] = movsSnap.docs.map(d => {
    const y = d.data();
    return { ...y, id: d.id,
      fecha: (y.fecha as { toDate?: () => Date } | null)?.toDate?.() ?? new Date(0),
      creadoEn: new Date(0), actualizadoEn: new Date(0), fechaConsumoOriginal: null, pagadoEn: null,
    } as unknown as Movement;
  });

  const idsTarjeta = new Set(items.filter(i => i.tarjetaCodigo).map(i => i.id));
  console.log('=== checklist REAL de los ítems de tarjeta (calcularChecklist importado) ===\n');
  for (const mes of ['2026-08', '2026-09']) {
    const movsMes = movimientos.filter(m => m.mes === mes);
    const chk = calcularChecklist(items, movsMes, mes);
    console.log(`--- ${mes} ---`);
    for (const ci of chk.filter(c => idsTarjeta.has(c.item.id)).sort((a, b) => a.item.moneda.localeCompare(b.item.moneda) || (a.item.tarjetaCodigo ?? '').localeCompare(b.item.tarjetaCodigo ?? ''))) {
      const detalle = ci.matches.map(m => {
        const origen = (m as unknown as { origen?: string }).origen;
        return `${m.moneda} ${m.monto} [${origen}${(m as unknown as { excluirDash?: boolean }).excluirDash ? ', excluirDash' : ''}]`;
      }).join(' + ');
      console.log(`  ${ci.item.moneda} ${(ci.item.tarjetaCodigo ?? '').padEnd(18)} ${ci.item.id} | estado=${ci.estado.padEnd(14)} | montoEsperado=${s(ci.item.montoEsperado).padStart(12)} | matches=${ci.matches.length} ${detalle}`);
    }
    console.log();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
