// F9.47 — preflight de migración: SOLO LECTURA. Reporta qué hay en el target
// (emulador o prod) y qué escribiría el seed (vía los mismos transformers en
// dryRun, no lógica duplicada) ANTES de tocar un solo doc. No requiere
// --i-am-sure (no escribe nada) — pero sí el service account para prod.
import { existsSync } from 'fs';
import type { Firestore } from 'firebase-admin/firestore';
import { readExcel } from './readExcel';
import { inyectarEmailsDependientes } from './emailsDependientes';
import { getDb } from './utils/firestore';
import { seedConfig } from './transformers/config';
import { seedSubcategorias } from './transformers/subcategorias';
import { seedEtiquetas } from './transformers/etiquetas';
import { seedNormalizationRules } from './transformers/normalizationRules';
import { seedTcDaily } from './transformers/tcDaily';
import { seedDictionary } from './transformers/dictionary';
import { seedExpectedItems } from './transformers/expectedItems';
import { seedCardStatements } from './transformers/cardStatements';
import { seedAutorizados } from './transformers/autorizados';
import { seedMovements } from './transformers/movements';

interface Flags { target: 'emulator' | 'production'; excelPath: string; }

function parseFlags(): Flags {
  const args = process.argv.slice(2);
  const target = args.includes('--target=production') ? 'production' : 'emulator';
  const excelArg = args.find(a => a.startsWith('--excel='));
  const excelPath = excelArg ? excelArg.split('=')[1] : './data/2026-06-19_sheet_snapshot.xlsx';
  return { target, excelPath };
}

function verificarServiceAccount(target: Flags['target']): void {
  if (target === 'emulator') return;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return; // confiamos en la env var, no chequeamos el archivo
  const keyPath = './secrets/serviceAccountKey.json';
  if (existsSync(keyPath)) return;
  console.error('ERROR: no se encontró el service account para conectar a producción.');
  console.error(`       Esperado en: ${keyPath} (o seteá GOOGLE_APPLICATION_CREDENTIALS).`);
  console.error('       Bajalo de: Firebase Console → ⚙ Configuración del proyecto → Cuentas de servicio');
  console.error('       → "Generar nueva clave privada" (proyecto gastos-familiares-e6415).');
  console.error(`       Guardalo en ${keyPath} — NUNCA lo subas a git (ya está en .gitignore).`);
  process.exit(1);
}

const COLECCIONES = [
  'config', 'tcDiario', 'subcategorias', 'etiquetas', 'reglasNormalizacion',
  'diccionario', 'itemsEsperados', 'resumenesTarjeta', 'autorizados', 'movimientos',
] as const;
type Coleccion = typeof COLECCIONES[number];

async function contarActual(db: Firestore, col: Coleccion): Promise<number> {
  if (col === 'config') {
    const snap = await db.collection('config').doc('familia').get();
    return snap.exists ? 1 : 0;
  }
  const res = await db.collection(col).count().get();
  return res.data().count;
}

async function main() {
  const { target, excelPath } = parseFlags();
  console.log(`\nPREFLIGHT - target=${target}`);
  console.log(`   Excel: ${excelPath}\n`);

  verificarServiceAccount(target);

  const data = readExcel(excelPath);
  inyectarEmailsDependientes(data);
  const db = getDb(target);

  console.log('--- Esperado (Excel, vía transformers en dry-run — misma lógica que el seed real) ---');
  const esperado: Record<Coleccion, number> = {
    config:              await seedConfig(db, data, true, target, false),
    subcategorias:       await seedSubcategorias(db, data, true),
    etiquetas:           await seedEtiquetas(db, data, true),
    reglasNormalizacion: await seedNormalizationRules(db, data, true),
    tcDiario:            await seedTcDaily(db, data, true),
    diccionario:         await seedDictionary(db, data, true),
    itemsEsperados:      await seedExpectedItems(db, data, true),
    resumenesTarjeta:    await seedCardStatements(db, data, true),
    autorizados:         await seedAutorizados(db, data, true),
    movimientos:         await seedMovements(db, data, true),
  };

  console.log(`\n--- Estado actual en ${target} ---`);
  const actual: Record<Coleccion, number> = {} as Record<Coleccion, number>;
  for (const col of COLECCIONES) {
    actual[col] = await contarActual(db, col);
  }

  console.log('\nColección                esperado   actual');
  console.log('────────────────────── ────────── ──────');
  for (const col of COLECCIONES) {
    console.log(`${col.padEnd(22)} ${String(esperado[col]).padStart(8)}   ${String(actual[col]).padStart(6)}`);
  }

  const totalActual = Object.values(actual).reduce((s, n) => s + n, 0);
  console.log('');
  if (totalActual === 0) {
    console.log(`VEREDICTO: LISTO PARA IMPORT LIMPIO (${target} está vacío).`);
  } else {
    console.log(`VEREDICTO: ${target} NO está vacío (${totalActual} docs totales en las colecciones de arriba).`);
    console.log('           Re-import sobrescribe por id (idempotente) — config/familia queda PROTEGIDA');
    console.log('           salvo --force-config. Revisá los números arriba antes de seguir.');
  }
  console.log('');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
