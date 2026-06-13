import { Firestore } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { sha256Hex } from '../utils/hash';
import { writeBatch } from '../utils/firestore';

export const ALIAS_PERSONA: Record<string, string> = {
  'Fede': 'Federico',
  'Sofi': 'Sofía',
};

export function normPersona(p: string | null | undefined): string {
  if (!p) return '';
  return ALIAS_PERSONA[p] ?? p;
}

// Nombres viejos del Excel → códigos canónicos de config/familia.tarjetas
// Si un nombre no mapea, el seed falla explícitamente (no null silencioso)
const TARJETA_CODIGO_MAP: Record<string, string> = {
  'Mastercard BBVA':    'BBVA-MASTER-BLK',
  'Visa BBVA':          'BBVA-VISA-SIG',
  'Mastercard Galicia': 'GAL-MASTER-BLK',
  'Visa Galicia':       'GAL-VISA',
};

// matchTexto hardcodeado para los items que necesitan discriminación por descripción.
// La clave incluye categoria para separar ABL Cochera (Auto) de ABL Casa.
const MATCH_TEXTO_OVERRIDES: Array<{
  tipo: 'Gasto' | 'Ingreso';
  categoria: string;
  subcategoria: string;
  persona: string;
  matchTexto: { incluye: string[]; excluye: string[] };
}> = [
  { tipo: 'Gasto', categoria: 'Auto',               subcategoria: 'Cochera',                       persona: '',         matchTexto: { incluye: ['signo 2', 'depto 030', 'cochera'], excluye: [] } },
  { tipo: 'Gasto', categoria: 'Casa',               subcategoria: 'Agua',                          persona: '',         matchTexto: { incluye: ['aysa', 'agua'], excluye: ['signo 2', 'depto 030', 'cochera'] } },
  { tipo: 'Gasto', categoria: 'Auto',               subcategoria: 'ABL',                           persona: '',         matchTexto: { incluye: ['abl cochera'], excluye: [] } },
  { tipo: 'Gasto', categoria: 'Casa',               subcategoria: 'ABL',                           persona: '',         matchTexto: { incluye: ['abl'], excluye: ['cochera'] } },
  { tipo: 'Gasto', categoria: 'Educación y chicos', subcategoria: 'Colegio Fede',                  persona: 'Federico', matchTexto: { incluye: ['colegio federico', 'philips'], excluye: [] } },
  { tipo: 'Gasto', categoria: 'Casa',               subcategoria: 'Internet',                      persona: '',         matchTexto: { incluye: ['internet'], excluye: [] } },
  { tipo: 'Gasto', categoria: 'Educación y chicos', subcategoria: 'Actividades extracurriculares', persona: 'Federico', matchTexto: { incluye: ['micro rugby'], excluye: [] } },
];

export function buildItemId(r: any, tipo: 'Gasto' | 'Ingreso'): string {
  const persona   = normPersona(r.Persona);
  const categoria = r.Categoria ?? r['Categoría'] ?? '';
  const tarjetaCodigo = r.Tarjeta ? (TARJETA_CODIGO_MAP[r.Tarjeta as string] ?? null) : null;
  const override  = MATCH_TEXTO_OVERRIDES.find(o =>
    o.tipo === tipo &&
    o.categoria === categoria &&
    o.subcategoria === (r.Subcategoria ?? '') &&
    o.persona === persona,
  );
  const matchTexto = override?.matchTexto ?? null;
  return sha256Hex(
    'exp', tipo, categoria, r.Subcategoria ?? '', persona, r.Moneda ?? 'ARS',
    tarjetaCodigo ?? '',
    matchTexto ? matchTexto.incluye.join('|') : '',
  ).slice(0, 20);
}

function buildItem(r: any, tipo: 'Gasto' | 'Ingreso') {
  const persona = normPersona(r.Persona);
  const categoria = r.Categoria ?? r['Categoría'] ?? '';

  // tarjetaCodigo: falla explícitamente si hay un nombre de tarjeta sin mapeo canónico
  let tarjetaCodigo: string | null = null;
  if (r.Tarjeta) {
    const code = TARJETA_CODIGO_MAP[r.Tarjeta as string];
    if (code === undefined) {
      throw new Error(`[expectedItems] Tarjeta sin mapeo canónico: '${r.Tarjeta}'. Agregar a TARJETA_CODIGO_MAP.`);
    }
    tarjetaCodigo = code;
  }

  const override = MATCH_TEXTO_OVERRIDES.find(o =>
    o.tipo === tipo &&
    o.categoria === categoria &&
    o.subcategoria === (r.Subcategoria ?? '') &&
    o.persona === persona,
  );
  const matchTexto = override?.matchTexto ?? null;
  const id = buildItemId(r, tipo);

  return {
    id,
    tipo,
    activo: r.Activo === true || r.Activo === 'VERDADERO',
    categoria: categoria || null,
    subcategoria: r.Subcategoria ?? null,
    etiqueta: r.Etiqueta ?? null,
    persona: persona || null,
    moneda: (r.Moneda === 'USD' ? 'USD' : 'ARS') as 'ARS' | 'USD',
    banco: r.Banco ?? null,
    montoEsperado: typeof r.MontoEsperado === 'number' ? r.MontoEsperado : null,
    diaVencimiento: typeof r.DiaVencimiento === 'number' ? r.DiaVencimiento : null,
    autoCalendario: false,
    notas: r.Notas ?? null,
    tarjetaCodigo,
    matchTexto,
    periodicidad:   r.Periodicidad || 'mensual',
    pagoAutomatico: r.PagoAutomatico === true || r.PagoAutomatico === 'VERDADERO',
  };
}

export async function seedExpectedItems(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> itemsEsperados');
  const gastos   = data.gastosEsperados.map(r => buildItem(r, 'Gasto'));
  const ingresos = data.ingresosEsperados.map(r => buildItem(r, 'Ingreso'));
  const docs = [...gastos, ...ingresos];
  const conTarjeta   = docs.filter(d => d.tarjetaCodigo).length;
  const conMatchTexto = docs.filter(d => d.matchTexto).length;
  console.log(`   ${gastos.length} gastos + ${ingresos.length} ingresos = ${docs.length} items`);
  console.log(`   ${conTarjeta} con tarjetaCodigo, ${conMatchTexto} con matchTexto`);
  if (dryRun) return;
  await writeBatch(db, 'itemsEsperados', docs);
  console.log('   OK\n');
}
