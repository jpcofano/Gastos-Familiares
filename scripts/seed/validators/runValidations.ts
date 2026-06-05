import { getDb } from '../utils/firestore';
import { readExcel } from '../readExcel';
import { runChecks } from './checks';

async function main() {
  const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
  const excelPath = './data/2026-05-29_sheet_snapshot.xlsx';

  const data = readExcel(excelPath);
  const db = getDb(target);

  const results = await runChecks(db, data);
  let pass = 0, fail = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'OK ' : 'FAIL'} ${r.name} - ${r.detail}`);
    r.ok ? pass++ : fail++;
  }
  console.log(`\n${pass} OK / ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
