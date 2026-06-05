import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';

const CATEGORIAS = [
  'Casa','Auto','Alimentación cotidiana','Salidas','Vacaciones y viajes',
  'Salud','Educación y chicos','Personal','Indumentaria','Impuestos y finanzas',
  'Transporte general','Ingresos','Tarjetas',
];

const BANCOS = ['BBVA','Galicia','Personal Pay','Efectivo'];

const TARJETAS = [
  { codigo: 'BBVA-VISA-SIG',   banco: 'BBVA',    tipo: 'Visa Signature',
    titular: 'Juan',  cuentaDebito: 'C.A. 0203124134' },
  { codigo: 'BBVA-MASTER-BLK', banco: 'BBVA',    tipo: 'Mastercard Black',
    titular: 'Juan',  cuentaDebito: 'C.A. 0203124134' },
  { codigo: 'GAL-VISA',        banco: 'Galicia', tipo: 'Visa',
    titular: 'Juan',  cuentaDebito: 'C.A. 0406142030' },
  { codigo: 'GAL-MASTER-BLK',  banco: 'Galicia', tipo: 'Mastercard Black',
    titular: 'María', cuentaDebito: 'C.A. 0406142034' },
];

export async function seedConfig(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> config/familia');

  const porPersona = new Map<string, { emails: string[]; rol: string; activo: boolean }>();
  for (const u of data.usuarios) {
    const persona = u.Persona;
    if (!persona) continue;
    const existing = porPersona.get(persona) ?? { emails: [], rol: u.Rol, activo: !!u.Activo };
    if (u.Email && typeof u.Email === 'string') existing.emails.push(u.Email.toLowerCase());
    porPersona.set(persona, existing);
  }

  const miembros: Record<string, any> = {};
  for (const [persona, info] of porPersona) {
    miembros[persona] = {
      nombre: persona,
      emails: info.emails,
      rol: info.rol === 'admin' ? 'admin' : 'dependiente',
      activo: info.activo,
    };
  }

  const familia = {
    miembros,
    categorias: CATEGORIAS,
    bancos: BANCOS,
    tarjetas: TARJETAS,
    actualizadoEn: FieldValue.serverTimestamp(),
  };

  console.log(`   Miembros: ${Object.keys(miembros).join(', ')}`);
  if (dryRun) return;
  await db.collection('config').doc('familia').set(familia);
  console.log('   OK\n');
}
