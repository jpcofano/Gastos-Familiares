import { Firestore } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';

interface Result { name: string; ok: boolean; detail: string; }

export async function runChecks(db: Firestore, data: SheetData): Promise<Result[]> {
  const results: Result[] = [];

  const movs = await db.collection('movements').count().get();
  const expected = data.historico.filter(r => r.Fecha || r.Monto !== 0).length;
  results.push({
    name: 'movements count',
    ok: movs.data().count === expected,
    detail: `firestore=${movs.data().count} excel=${expected}`,
  });

  const may = await db.collection('movements')
    .where('mes', '==', '2026-05').where('tipo', '==', 'Gasto').where('moneda', '==', 'ARS')
    .get();
  const sumFs = may.docs.reduce((s, d) => s + (d.data().monto ?? 0), 0);
  const sumXls = data.historico
    .filter(r => r.Fecha && (r.Fecha as Date).toISOString().startsWith('2026-05'))
    .filter(r => r.Tipo === 'Gasto' && r.Moneda === 'ARS')
    .reduce((s, r) => s + (r.Monto ?? 0), 0);
  results.push({
    name: 'gastos ARS 2026-05',
    ok: Math.abs(sumFs - sumXls) < 0.01,
    detail: `firestore=${sumFs.toFixed(2)} excel=${sumXls.toFixed(2)}`,
  });

  const dict = await db.collection('dictionary').count().get();
  results.push({
    name: 'dictionary count',
    ok: dict.data().count >= data.diccionarioAprendido.length - 15 && dict.data().count <= data.diccionarioAprendido.length,
    detail: `firestore=${dict.data().count} excel=${data.diccionarioAprendido.length} (consolidación esperada)`,
  });

  const etiqs = await db.collection('etiquetas').get();
  const tieneTecnicas = etiqs.docs.some(d => /^(Juan|Mar[ií]a)(ARS|USD)$/.test(d.data().valor));
  results.push({
    name: 'etiquetas sin tecnicas',
    ok: !tieneTecnicas,
    detail: tieneTecnicas ? 'hay tecnicas (mal)' : 'limpio',
  });

  const stmts = await db.collection('cardStatements').count().get();
  results.push({
    name: 'cardStatements count',
    ok: stmts.data().count === data.tarjetasResumen.length,
    detail: `firestore=${stmts.data().count} excel=${data.tarjetasResumen.length}`,
  });

  const tc = await db.collection('tcDaily').count().get();
  results.push({
    name: 'tcDaily count',
    ok: tc.data().count === data.tcDiario.filter(r => r.Fecha && r.TC_USDARS).length,
    detail: `firestore=${tc.data().count}`,
  });

  const sinTc = await db.collection('movements').where('tcUsdArs', '==', null).count().get();
  results.push({
    name: 'movements sin TC',
    ok: sinTc.data().count < 10,
    detail: `${sinTc.data().count} (esperado 0 con fallback forward)`,
  });

  const fam = await db.collection('config').doc('familia').get();
  const numMiembros = fam.exists ? Object.keys(fam.data()!.miembros ?? {}).length : 0;
  results.push({
    name: 'config/familia 4 miembros',
    ok: numMiembros === 4,
    detail: `miembros=${numMiembros}`,
  });

  return results;
}
