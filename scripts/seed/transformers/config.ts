import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';

const CATEGORIAS = [
  'Casa','Auto','Alimentación cotidiana','Salidas','Vacaciones y viajes',
  'Salud','Educación y chicos','Personal','Indumentaria','Impuestos y finanzas',
  'Transporte general','Ingresos','Tarjetas',
];

const BANCOS = ['BBVA','Galicia','Personal Pay','Efectivo'];

// Unidades funcionales de la familia (inmuebles con expensas de consorcio)
// UF 043: Depto Del Signo 4042. Cochera (030) no tiene expensa propia en el consorcio.
const UNIDADES = [
  { uf: '043', alias: 'Del Signo 4042 043', etiqueta: 'Expensas' },
];

// ultimos4: últimos 4 dígitos de cada tarjeta física del cuente (María primero, luego adicionales)
// BBVA: no aparecen PANs enmascarados en el encabezado del PDF → capa 1 (numeroCuenta) resuelve
// Galicia: "TARJETA XXXX" aparece en el cuerpo del PDF, no en el encabezado → capa 1 resuelve;
//           ultimos4 queda como fallback si el extractor falla en numeroCuenta
// Galicia Master: usa "N° de Socio" en el PDF (no "N° de Cuenta") → extracción de numeroCuenta frágil;
//                 actualizar el prompt si la capa 1 falla en producción
const TARJETAS = [
  { codigo: 'BBVA-VISA-SIG',   banco: 'BBVA',    tipo: 'Visa Signature',
    titular: 'Juan',  cuentaDebito: 'C.A. 0203124134', numeroCuenta: '0916360348',  ultimos4: ['2308', '2316'] },
  { codigo: 'BBVA-MASTER-BLK', banco: 'BBVA',    tipo: 'Mastercard Black',
    titular: 'Juan',  cuentaDebito: 'C.A. 0203124134', numeroCuenta: '1262521647',  ultimos4: ['0082', '0108'] },
  { codigo: 'GAL-VISA',        banco: 'Galicia', tipo: 'Visa',
    titular: 'Juan',  cuentaDebito: 'C.A. 0406142030', numeroCuenta: '1235391051',  ultimos4: ['9318', '9326'] },
  { codigo: 'GAL-MASTER-BLK',  banco: 'Galicia', tipo: 'Mastercard Black',
    titular: 'María', cuentaDebito: 'C.A. 0406142034', numeroCuenta: '2380140-0-6', ultimos4: ['3178', '2005'] },
];

const normNombreSeed = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const ALIAS_MAP: Record<string, string[]> = {
  'juan': [
    'juan', 'juan pablo', 'juan pablo cofano', 'cofano juan pablo', 'cofano juan',
  ],
  'maria': [
    'maria', 'may', 'maria lascano', 'lascano maria', 'maria lascano cofano',
  ],
  'federico': [
    'fede', 'federico', 'federico nicolas', 'federico cofano',
    'federico cofano lascano', 'federico nicolas cofano lascano',
    'cofano lascano federico nicolas',
  ],
  'sofia': [
    'sofi', 'sofia', 'sofia cofano', 'sofia cofano lascano', 'sofia ines',
    'sofia ines cofano lascano', 'cofano lascano sofia ines',
  ],
};

export async function seedConfig(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> config/familia');

  const porPersona = new Map<string, { emails: string[]; rol: string; activo: boolean }>();
  for (const u of data.usuarios) {
    const persona = u.Persona;
    if (!persona) continue;
    const existing = porPersona.get(persona) ?? { emails: [] as string[], rol: u.Rol as string, activo: !!u.Activo };
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
      alias: ALIAS_MAP[normNombreSeed(persona)] ?? [],
    };
  }

  const familia = {
    miembros,
    categorias: CATEGORIAS,
    bancos: BANCOS,
    tarjetas: TARJETAS,
    unidades: UNIDADES,
    actualizadoEn: FieldValue.serverTimestamp(),
  };

  console.log(`   Miembros: ${Object.keys(miembros).join(', ')}`);
  if (dryRun) return;
  await db.collection('config').doc('familia').set(familia);
  console.log('   OK\n');
}
