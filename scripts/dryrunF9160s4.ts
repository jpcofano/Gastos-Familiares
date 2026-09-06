// F9.160 §4 — DRY RUN. Re-evalúa el cuadre de los 30 resúmenes con la lógica corregida.
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
const n2 = (v: number) => v.toFixed(2).padStart(13);
const src = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
const bl = (d: string, h: string) => { const i = src.indexOf(d); return src.slice(i, src.indexOf(h, i) + h.length); };
const js = ts.transpileModule([  (() => { const _r = require('node:fs').readFileSync('src/datos/ajusteConsolidado.ts','utf8').replace(/\\r\\n/g,'\\n'); return _r.replace(/^import .*$/gm,'').replace(/export /g,''); })(),
  bl('function tipoDeLinea', '\n}'), bl('export function totalesNetos', '\n}').replace('export ', ''), bl('export function calcularCuadre', '\n}').replace('export ', '')].join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
const motor = new Function(`${js}\nreturn { tipoDeLinea, calcularCuadre };`)() as any;
type L = { tipoLinea?: string; descripcionRaw?: string; monto?: number; moneda?: string; incluir?: boolean };
type A = { concepto: string; montoARS: number; montoUSD: number; origen?: string };

async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  console.log('La corrección simulada: los renglones tipo ingreso cuyo nombre sugiere promoción');
  console.log('(CAJA SEG-PROMO) pasan a `consumo`, y se quita el ajuste manual de "Diferencia no');
  console.log('identificada" que los venía compensando. NO SE ESCRIBE NADA.\n');
  const mejoran: string[] = [], igual: string[] = [], empeoran: string[] = [];
  for (const d of resus.docs.slice().sort((a, b) => s(a.data().periodo).localeCompare(s(b.data().periodo)))) {
    const x = d.data();
    const ls = (x.movimientosParseados ?? []) as L[];
    const aj = (x.ajustesConsolidado ?? []) as A[];
    const idx = ls.map((l, i) => ({ l, i })).filter(({ l }) => /CAJA SEG/i.test(s(l.descripcionRaw)) && ['reintegro_percepcion','bonificacion','reverso'].includes(s(l.tipoLinea))).map(({ i }) => i);
    const manual = aj.filter(a => a.origen === 'manual');
    if (idx.length === 0 && manual.length === 0) { igual.push(`${d.id.slice(0,8)} | ${s(x.periodo)}`); continue; }
    const antes = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), aj);
    const lsNuevas = ls.map((l, i) => idx.includes(i) ? { ...l, tipoLinea: 'consumo' } : l);
    const despues = motor.calcularCuadre(lsNuevas, Number(x.totalARS), Number(x.totalUSD), aj.filter(a => a.origen !== 'manual'));
    const fila = `${d.id.slice(0,8)} | ${s(x.periodo)} | ${(s(x.banco)+'/'+s(x.tarjeta)).slice(0,30).padEnd(30)} | diffARS ${n2(antes.diffARS)} → ${n2(despues.diffARS)} | balanceARS ${String(antes.balanceARS).padEnd(5)} → ${String(despues.balanceARS).padEnd(5)} | reclasifica ${idx.length} | quita ${manual.length} ajuste(s) manual(es)`;
    if (despues.diffARS < antes.diffARS - 0.01 || (despues.balanceARS && !antes.balanceARS)) mejoran.push(fila);
    else if (despues.diffARS > antes.diffARS + 0.01 || (!despues.balanceARS && antes.balanceARS)) empeoran.push(fila);
    else igual.push(fila);
  }
  console.log(`=== MEJORAN o quedan igual de cuadrados pero por las razones correctas: ${mejoran.length} ===`);
  for (const f of mejoran) console.log('  ' + f);
  console.log(`\n=== EMPEORAN: ${empeoran.length} ===`);
  for (const f of empeoran) console.log('  >>> ' + f);
  console.log(`\n=== sin cambios (incluye los 17 del seed que descuadran por otra causa): ${igual.length} ===`);
  for (const f of igual.slice(0, 40)) console.log('  ' + f);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
