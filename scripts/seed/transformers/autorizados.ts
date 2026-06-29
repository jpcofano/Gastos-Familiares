import { Firestore } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { writeBatch } from '../utils/firestore';

export async function seedAutorizados(db: Firestore, data: SheetData, dryRun: boolean): Promise<number> {
  console.log('-> autorizados');

  const docs: { id: string; memberId: string; rol: 'admin' | 'dependiente' }[] = [];
  const seen = new Set<string>();

  for (const u of data.usuarios) {
    if (!u.Activo) continue;
    if (!u.Persona) continue;
    if (!u.Email || typeof u.Email !== 'string') continue;

    const email = u.Email.trim().toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);

    docs.push({
      id: email,
      memberId: u.Persona,
      rol: u.Rol === 'admin' ? 'admin' : 'dependiente',
    });
  }

  console.log(`   ${docs.length} autorizados: ${docs.map(d => d.id).join(', ')}`);
  if (dryRun) return docs.length;
  await writeBatch(db, 'autorizados', docs);
  console.log('   OK\n');
  return docs.length;
}
