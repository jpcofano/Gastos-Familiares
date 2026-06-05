import { Firestore } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { sha256Hex } from '../utils/hash';
import { writeBatch } from '../utils/firestore';

function buildItem(r: any, tipo: 'Gasto' | 'Ingreso') {
  const id = sha256Hex(
    'exp',
    tipo,
    r.Categoria ?? r['Categoría'] ?? '',
    r.Subcategoria ?? '',
    r.Persona ?? '',
    r.Moneda ?? 'ARS'
  ).slice(0, 20);

  return {
    id,
    tipo,
    activo: r.Activo === true || r.Activo === 'VERDADERO',
    categoria: r.Categoria ?? r['Categoría'] ?? null,
    subcategoria: r.Subcategoria ?? null,
    etiqueta: r.Etiqueta ?? null,
    persona: r.Persona ?? null,
    moneda: (r.Moneda === 'USD' ? 'USD' : 'ARS') as 'ARS' | 'USD',
    banco: r.Banco ?? null,
    montoEsperado: typeof r.MontoEsperado === 'number' ? r.MontoEsperado : null,
    diaVencimiento: typeof r.DiaVencimiento === 'number' ? r.DiaVencimiento : null,
    autoCalendar: false,
    notas: r.Notas ?? null,
  };
}

export async function seedExpectedItems(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> expectedItems');
  const gastos    = data.gastosEsperados.map(r => buildItem(r, 'Gasto'));
  const ingresos  = data.ingresosEsperados.map(r => buildItem(r, 'Ingreso'));
  const docs = [...gastos, ...ingresos];
  console.log(`   ${gastos.length} gastos + ${ingresos.length} ingresos = ${docs.length} items`);
  if (dryRun) return;
  await writeBatch(db, 'expectedItems', docs);
  console.log('   OK\n');
}
