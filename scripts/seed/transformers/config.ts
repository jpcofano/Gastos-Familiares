import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';

// F9.38 — categorias gana id estable (antes string[] plano). id curado a mano,
// igual que BANCOS — movimientos.categoria sigue guardando el NOMBRE (no el
// id); renombrar desde Perfil cascada el nombre en movimientos/diccionario/
// subcategorias vía la callable guardarTaxonomia (ver docs/CLAUDE.md F9.38).
const CATEGORIAS = [
  { id: 'casa',         nombre: 'Casa' },
  { id: 'auto',         nombre: 'Auto' },
  { id: 'alimentacion', nombre: 'Alimentación cotidiana' },
  { id: 'salidas',      nombre: 'Salidas' },
  { id: 'vacaciones',   nombre: 'Vacaciones y viajes' },
  { id: 'salud',        nombre: 'Salud' },
  { id: 'educacion',    nombre: 'Educación y chicos' },
  { id: 'personal',     nombre: 'Personal' },
  { id: 'indumentaria', nombre: 'Indumentaria' },
  { id: 'impuestos',    nombre: 'Impuestos y finanzas' },
  { id: 'transporte',   nombre: 'Transporte general' },
  { id: 'ingresos',     nombre: 'Ingresos' },
  { id: 'tarjetas',     nombre: 'Tarjetas' },
].map(c => ({ ...c, activo: true }));

// F9.36 — bancos pasa de string[] a MedioPago[] (editable desde Perfil ›
// Medios de pago, vía callable actualizarMediosPago). id estable, distinto
// del nombre — movimientos.banco sigue guardando el NOMBRE, no el id.
// Efectivo: alias cosmético de Mercado Pago (F9.23) — aliasDe + oculto, igual
// que ya vivía hardcodeado en src/datos/medios.ts (acá se promueve a Firestore).
const BANCOS = [
  { id: 'bbva',    nombre: 'BBVA',         color: '#072146', tipo: 'Banco' as const,     dominio: 'bbva.com.ar' },
  { id: 'galicia', nombre: 'Galicia',      color: '#ff7300', tipo: 'Banco' as const,     dominio: 'bancogalicia.com' },
  { id: 'pp',      nombre: 'Personal Pay', color: '#5b2d8e', tipo: 'Billetera' as const, dominio: 'personalpay.com.ar' },
  { id: 'mp',      nombre: 'Mercado Pago', color: '#00a5e6', tipo: 'Billetera' as const, dominio: 'mercadopago.com.ar' },
  { id: 'efec',    nombre: 'Efectivo',     color: '#16a34a', tipo: 'Efectivo' as const,  aliasDe: 'mp', oculto: true },
];

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
// F9.35 — tipoTarjeta: las 4 son tarjetas de crédito tradicionales (generan resumen
// mensual con cierre/vencimiento, ver F6.5) — inferencia segura, no un dato inventado.
// cierreDia/venceDia: sin fuente legacy confiable — quedan sin valor hasta que se
// carguen a mano desde Perfil › Tarjetas (no fabricar fechas que después "mientan").
const TARJETAS = [
  { codigo: 'BBVA-VISA-SIG',   banco: 'BBVA',    tipo: 'Visa Signature',
    titular: 'Juan',  cuentaDebito: 'C.A. 0203124134', numeroCuenta: '0916360348',  ultimos4: ['2308', '2316'], tipoTarjeta: 'credito' as const },
  { codigo: 'BBVA-MASTER-BLK', banco: 'BBVA',    tipo: 'Mastercard Black',
    titular: 'Juan',  cuentaDebito: 'C.A. 0203124134', numeroCuenta: '1262521647',  ultimos4: ['0082', '0108'], tipoTarjeta: 'credito' as const },
  { codigo: 'GAL-VISA',        banco: 'Galicia', tipo: 'Visa',
    titular: 'Juan',  cuentaDebito: 'C.A. 0406142030', numeroCuenta: '1235391051',  ultimos4: ['9318', '9326'], tipoTarjeta: 'credito' as const },
  { codigo: 'GAL-MASTER-BLK',  banco: 'Galicia', tipo: 'Mastercard Black',
    titular: 'María', cuentaDebito: 'C.A. 0406142034', numeroCuenta: '2380140-0-6', ultimos4: ['3178', '2005'], tipoTarjeta: 'credito' as const },
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
