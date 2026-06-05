import { Firestore } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { sha256Hex } from '../utils/hash';
import { writeBatch } from '../utils/firestore';

const TECNICA_RE = /^(Juan|Mar[ií]a)(ARS|USD)$|^(Galicia|Frances|BBVA)\s+(Visa|Master)(ARS|USD)$/i;

export async function seedEtiquetas(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> etiquetas');

  const todasLasEtiq = data.diccionario.filter(r => r.Tipo === 'Etiqueta' && r.Valor);
  const funcionales = todasLasEtiq.filter(r => !TECNICA_RE.test(r.Valor));
  const tecnicas = todasLasEtiq.filter(r => TECNICA_RE.test(r.Valor));

  const docs = funcionales.map(r => ({
    id: sha256Hex('etiq', r.Valor).slice(0, 16),
    valor: r.Valor,
    activo: r.Activo === true || r.Activo === 'VERDADERO',
  }));

  console.log(`   ${docs.length} etiquetas funcionales`);
  console.log(`   ${tecnicas.length} tecnicas descartadas (se convierten en dict)`);
  if (dryRun) return;
  await writeBatch(db, 'etiquetas', docs);
  console.log('   OK\n');
}
