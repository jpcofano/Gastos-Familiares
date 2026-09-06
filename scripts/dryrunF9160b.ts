// F9.160 §4 (bis) — DRY RUN. Separa las dos mitades de la corrección para saber qué explica qué.
// A = solo reclasificar CAJA SEG-PROMO a consumo (deja los ajustes manuales donde están).
// B = A + quitar los ajustes manuales de "diferencia no identificada".
// NO ESCRIBE NADA.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
const req = createRequire(process.cwd() + '/functions/package.json');
const ts = req('typescript') as typeof import('typescript');
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const n = (v: number) => v.toFixed(2).padStart(13);
const src = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
const bl = (d: string, h: string) => { const i = src.indexOf(d); return src.slice(i, src.indexOf(h, i) + h.length); };
const js = ts.transpileModule([bl('function tipoDeLinea', '\n}'), bl('export function calcularCuadre', '\n}').replace('export ', '')].join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
const motor = new Function(`${js}\nreturn { calcularCuadre };`)() as any;
type L = { tipoLinea?: string; descripcionRaw?: string; monto?: number };
type A = { concepto: string; montoARS: number; origen?: string };

async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  console.log('id       | período | banco/tarjeta                  |     diffARS hoy | A: reclasificado |  B: A sin ajuste manual | seg | aj.man');
  console.log('-'.repeat(140));
  for (const d of resus.docs.slice().sort((a, b) => s(a.data().periodo).localeCompare(s(b.data().periodo)))) {
    const x = d.data();
    const ls = (x.movimientosParseados ?? []) as L[];
    const aj = (x.ajustesConsolidado ?? []) as A[];
    const seg = ls.filter(l => /CAJA SEG/i.test(s(l.descripcionRaw)) && ['reintegro_percepcion','bonificacion','reverso'].includes(s(l.tipoLinea)));
    const man = aj.filter(a => a.origen === 'manual');
    if (seg.length === 0 && man.length === 0) continue;
    const ls2 = ls.map(l => seg.includes(l) ? { ...l, tipoLinea: 'consumo' } : l);
    const hoy = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), aj);
    const A = motor.calcularCuadre(ls2, Number(x.totalARS), Number(x.totalUSD), aj);
    const B = motor.calcularCuadre(ls2, Number(x.totalARS), Number(x.totalUSD), aj.filter(a => a.origen !== 'manual'));
    console.log(`${d.id.slice(0,8)} | ${s(x.periodo)} | ${(s(x.banco)+'/'+s(x.tarjeta)).slice(0,30).padEnd(30)} | ${n(hoy.diffARS)} | ${n(A.diffARS)}     | ${n(B.diffARS)}         |  ${seg.length}  |  ${man.length}`);
    for (const a of man) console.log(`         └ ajuste manual: "${a.concepto}" = ${a.montoARS}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
