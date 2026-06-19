import { readExcel } from './readExcel';
import { inyectarEmailsDependientes } from './emailsDependientes';
import { getDb } from './utils/firestore';
import { seedConfig }             from './transformers/config';
import { seedSubcategorias }      from './transformers/subcategorias';
import { seedEtiquetas }          from './transformers/etiquetas';
import { seedNormalizationRules } from './transformers/normalizationRules';
import { seedTcDaily }            from './transformers/tcDaily';
import { seedDictionary }         from './transformers/dictionary';
import { seedExpectedItems }      from './transformers/expectedItems';
import { seedCardStatements }     from './transformers/cardStatements';
import { seedAutorizados }        from './transformers/autorizados';
import { seedMovements }          from './transformers/movements';


interface Flags {
  target: 'emulator' | 'production';
  dryRun: boolean;
  excelPath: string;
}

function parseFlags(): Flags {
  const args = process.argv.slice(2);
  const target = args.includes('--target=production') ? 'production' : 'emulator';
  const dryRun = args.includes('--dry-run');
  const excelArg = args.find(a => a.startsWith('--excel='));
  const excelPath = excelArg
    ? excelArg.split('=')[1]
    : './data/2026-06-19_sheet_snapshot.xlsx';

  if (target === 'production' && !args.includes('--i-am-sure')) {
    console.error('ERROR: --target=production requiere flag --i-am-sure');
    console.error('       Esto previene correr el seed contra prod por accidente.');
    process.exit(1);
  }
  return { target, dryRun, excelPath };
}

async function main() {
  const flags = parseFlags();
  console.log(`\nSEED - target=${flags.target} dryRun=${flags.dryRun}`);
  console.log(`   Excel: ${flags.excelPath}\n`);

  const data = readExcel(flags.excelPath);
  inyectarEmailsDependientes(data);
  const db = getDb(flags.target);

  await seedConfig(db, data, flags.dryRun);
  await seedSubcategorias(db, data, flags.dryRun);
  await seedEtiquetas(db, data, flags.dryRun);
  await seedNormalizationRules(db, data, flags.dryRun);
  await seedTcDaily(db, data, flags.dryRun);
  await seedDictionary(db, data, flags.dryRun);
  await seedExpectedItems(db, data, flags.dryRun);
  await seedCardStatements(db, data, flags.dryRun);
  await seedAutorizados(db, data, flags.dryRun);
  await seedMovements(db, data, flags.dryRun);

  console.log('\nSeed completo. Correr `npm run validate` para verificar totales.\n');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
