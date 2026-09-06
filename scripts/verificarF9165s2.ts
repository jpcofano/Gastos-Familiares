// F9.165 §2 — verificación POST-ESCRITURA: se relee Firestore y se recalcula el cuadre con el
// motor real. No se confía en lo que dijo el ejecutor. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
const req = createRequire(process.cwd() + '/functions/package.json');
const ts = req('typescript') as typeof import('typescript');
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const f2 = (v: number) => v.toFixed(2).padStart(14);
let ok = 0, fail = 0;
const chk = (r: string, c: boolean, d = '') => { if (c) { ok++; console.log(`  OK   ${r}${d ? ' — ' + d : ''}`); } else { fail++; console.log(`  FAIL ${r}${d ? ' — ' + d : ''}`); } };
const aJs = (c: string) => ts.transpileModule(c, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
const srcDatos = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
const srcRegla = fs.readFileSync('src/datos/ajusteConsolidado.ts', 'utf8').replace(/\r\n/g, '\n');
const tz = (d: string, h: string) => { const i = srcDatos.indexOf(d); return srcDatos.slice(i, srcDatos.indexOf(h, i) + h.length); };
const motor = new Function(`${aJs([
  srcRegla.replace(/^import .*$/gm, '').replace(/export /g, ''),
  tz('function tipoDeLinea', '\n}'),
  tz('export function totalesNetos', '\n}').replace('export ', ''),
  tz('export function calcularCuadre', '\n}').replace('export ', ''),
].join('\n'))}\nreturn { calcularCuadre };`)() as any;

async function main() {
  console.log('F9.165 §2 — verificación releyendo Firestore.\n');
  const resus = await db.collection('resumenesTarjeta').get();
  for (const pref of ['b553ddf1', 'f3e9e4f3', '5d948f9a', 'c7222865']) {
    const d = resus.docs.find(x => x.id.startsWith(pref))!;
    const x = d.data();
    const ls = (x.movimientosParseados ?? []) as any[];
    const aj = (x.ajustesConsolidado ?? []) as any[];
    const arch = (x.ajustesManualesPrevios ?? []) as any[];
    const movs = await db.collection('movimientos').where('resumenTarjetaId', '==', d.id).get();
    const c = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), aj, x);
    console.log(`── ${pref} | ${s(x.periodo)} | estado=${s(x.estado)} ──`);
    console.log(`   sumaARS=${f2(c.sumaARS)} diffARS=${f2(c.diffARS)} diffUSD=${f2(c.diffUSD)} | decisión=${c.decisionAjustes.decision}`);
    chk(`${pref} cuadra en cero`, c.diffARS < 1 && c.diffUSD < 1 && c.balanceARS && c.balanceUSD, `diffARS=${c.diffARS.toFixed(2)}`);
    chk(`${pref} sin ajustes manuales en el cuadre`, aj.every(a => a.origen !== 'manual'), `${aj.filter(a => a.origen === 'manual').length} manuales`);
    chk(`${pref} los manuales quedaron archivados`, arch.length > 0, `${arch.length}: ${JSON.stringify(arch.map(a => a.montoARS))}`);
    chk(`${pref} tiene el consolidado extraído`, typeof x.saldoAnteriorARS === 'number' && typeof x.pagosDelPeriodoARS === 'number',
        `saldo=${s(x.saldoAnteriorARS)} pagos=${s(x.pagosDelPeriodoARS)}`);
    chk(`${pref} las líneas traen montoFirmado y seccion`,
        ls.every(l => typeof l.montoFirmado === 'number' && typeof l.seccion === 'string'),
        `${ls.filter(l => typeof l.montoFirmado === 'number').length}/${ls.length} con montoFirmado`);
    chk(`${pref} NINGÚN CR.RG como línea`, !ls.some(l => /CR\.RG|CANJE PUNTOS|DEV\.IMP|DEV PER/i.test(s(l.descripcionRaw))), '');
    chk(`${pref} estado y movimientos intactos`, s(x.estado) === 'confirmado' && movs.size > 0, `estado=${s(x.estado)} movimientos=${movs.size}`);
    console.log();
  }
  console.log(`${fail === 0 ? 'TODO OK' : 'HAY FALLAS'} — ${ok} ok, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
