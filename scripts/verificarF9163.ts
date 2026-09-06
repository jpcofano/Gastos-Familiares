// F9.163 §2/§3 — la regla sobre los 30, antes y después. El motor y la regla se EXTRAEN del
// fuente: si cambian, esto se rompe. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import { leerConsolidado } from './auditF9163b';

const req = createRequire(process.cwd() + '/functions/package.json');
const pdfParse = req('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;
const ts = req('typescript') as typeof import('typescript');

if (getApps().length === 0) initializeApp({
  credential: cert('./secrets/serviceAccountKey.json'),
  storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
});
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const f2 = (v: number) => v.toFixed(2).padStart(13);
let ok = 0, fail = 0;
const chk = (rot: string, cond: boolean, det = '') => {
  if (cond) { ok++; console.log(`  OK   ${rot}${det ? ' — ' + det : ''}`); }
  else { fail++; console.log(`  FAIL ${rot}${det ? ' — ' + det : ''}`); }
};

function aJs(c: string) {
  return ts.transpileModule(c, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
}
// El motor REAL: tipoDeLinea + totalesNetos + calcularCuadre + la regla de ajusteConsolidado.
const srcDatos = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
const srcRegla = fs.readFileSync('src/datos/ajusteConsolidado.ts', 'utf8').replace(/\r\n/g, '\n');
const tz = (d: string, h: string) => { const i = srcDatos.indexOf(d); return srcDatos.slice(i, srcDatos.indexOf(h, i) + h.length); };
const motor = new Function(`${aJs([
  srcRegla.replace(/^import .*$/gm, '').replace(/export /g, ''),
  tz('function tipoDeLinea', '\n}'),
  tz('export function totalesNetos', '\n}').replace('export ', ''),
  tz('export function calcularCuadre', '\n}').replace('export ', ''),
].join('\n'))}\nreturn { calcularCuadre, decidirAjustesConsolidado, TOLERANCIA_IDENTIDAD_ARS };`)() as {
  calcularCuadre: (l: any[], a: number, u: number, aj?: any[], cons?: any) => {
    sumaARS: number; diffARS: number; balanceARS: boolean; diffUSD: number; balanceUSD: boolean;
    decisionAjustes: { decision: string; motivo: string } };
  TOLERANCIA_IDENTIDAD_ARS: number;
};

async function main() {
  console.log(`tolerancia en uso: ${motor.TOLERANCIA_IDENTIDAD_ARS} ARS\n`);
  const resus = await db.collection('resumenesTarjeta').get();

  // ── (a) los 30 TAL COMO ESTÁN hoy: ninguno tiene los campos nuevos ──────────
  console.log('=== §3.a — los 30 como están HOY (ninguno tiene el consolidado extraído) ===');
  console.log('id       | período |  diffARS antes |  diffARS después | balance antes→después | decisión');
  console.log('-'.repeat(104));
  let cambiados = 0, empeoran = 0;
  const docs = resus.docs.slice().sort((a, b) => s(a.data().periodo).localeCompare(s(b.data().periodo)));
  for (const d of docs) {
    const x = d.data();
    const ls = (x.movimientosParseados ?? []) as any[];
    const aj = (x.ajustesConsolidado ?? []) as any[];
    const antes = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), aj);           // sin consolidado
    const desp  = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), aj, x);        // con el doc real
    if (Math.abs(antes.diffARS - desp.diffARS) > 0.01) cambiados++;
    if (desp.diffARS > antes.diffARS + 0.01 || (antes.balanceARS && !desp.balanceARS)) empeoran++;
    console.log(`${d.id.slice(0, 8)} | ${s(x.periodo)} | ${f2(antes.diffARS)} | ${f2(desp.diffARS)}    | ${String(antes.balanceARS).padEnd(5)}→${String(desp.balanceARS).padEnd(5)}        | ${desp.decisionAjustes.decision}`);
  }
  chk('ninguno de los 30 cambia hoy', cambiados === 0, `${cambiados} cambiados`);
  chk('ninguno empeora', empeoran === 0, `${empeoran} empeoran`);
  console.log('  (esperado: sin los campos nuevos la regla se ABSTIENE en los 30 — es la garantía de');
  console.log('   no regresión el día del deploy, antes de re-extraer nada)\n');

  // ── (b) simulando el consolidado que el prompt de §1 va a emitir ────────────
  console.log('=== §3.b — con el consolidado poblado (lo que pasa DESPUÉS de re-extraer) ===');
  console.log('id       | período |  diffARS antes |  diffARS después | balance antes→después | decisión');
  console.log('-'.repeat(104));
  let mejoran = 0, iguales = 0, empeoran2 = 0;
  const filas: Array<{ id: string; antes: number; desp: number; dec: string }> = [];
  for (const d of docs) {
    const x = d.data();
    const ls = (x.movimientosParseados ?? []) as any[];
    const aj = (x.ajustesConsolidado ?? []) as any[];
    let cons: any = null;
    if (x.refStoragePdf) {
      try {
        const [buf] = await getStorage().bucket().file(s(x.refStoragePdf)).download();
        const r = leerConsolidado((await pdfParse(buf as Buffer)).text);
        if (r.saldo !== null && r.pagos !== null)
          cons = { saldoAnteriorARS: r.saldo, pagosDelPeriodoARS: r.pagos };
      } catch { /* seed sin PDF */ }
    }
    const antes = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), aj);
    const desp  = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), aj, cons);
    if (desp.diffARS < antes.diffARS - 0.01) mejoran++;
    else if (desp.diffARS > antes.diffARS + 0.01 || (antes.balanceARS && !desp.balanceARS)) empeoran2++;
    else iguales++;
    filas.push({ id: d.id.slice(0, 8), antes: antes.diffARS, desp: desp.diffARS, dec: desp.decisionAjustes.decision });
    console.log(`${d.id.slice(0, 8)} | ${s(x.periodo)} | ${f2(antes.diffARS)} | ${f2(desp.diffARS)}    | ${String(antes.balanceARS).padEnd(5)}→${String(desp.balanceARS).padEnd(5)}        | ${desp.decisionAjustes.decision}`);
  }
  console.log(`\n  mejoran=${mejoran}  iguales=${iguales}  EMPEORAN=${empeoran2}`);
  console.log('  (los 4 que empeoran dan 0.00 HOY gracias al parche manual de "cerrar diferencia",');
  console.log('   dimensionado para compensar el estado viejo: sacar el ajuste de PDF sin sacar el');
  console.log('   parche descompensa. El escenario real post-re-extraccion es el §3.c.)');

  // ── (c) el escenario REAL post-re-extracción: sin los parches manuales ──────
  // `procesarResumenTarjeta` REESCRIBE `ajustesConsolidado` con lo que emite el modelo, así que
  // después de re-extraer los parches manuales ya no están. Ése es el estado que hay que medir.
  console.log('\n=== §3.c — con el consolidado poblado Y sin los parches manuales (post-re-extracción) ===');
  console.log('id       | período |  diffARS antes |  diffARS después | balance antes→después | decisión');
  console.log('-'.repeat(104));
  let mejoran3 = 0, iguales3 = 0, empeoran3 = 0;
  const filas3: Array<{ id: string; antes: number; desp: number; dec: string }> = [];
  for (const d of docs) {
    const x = d.data();
    const ls = (x.movimientosParseados ?? []) as any[];
    const ajPdf = ((x.ajustesConsolidado ?? []) as any[]).filter(a => a.origen !== 'manual');
    let cons: any = null;
    if (x.refStoragePdf) {
      try {
        const [buf] = await getStorage().bucket().file(s(x.refStoragePdf)).download();
        const r = leerConsolidado((await pdfParse(buf as Buffer)).text);
        if (r.saldo !== null && r.pagos !== null)
          cons = { saldoAnteriorARS: r.saldo, pagosDelPeriodoARS: r.pagos };
      } catch { /* seed sin PDF */ }
    }
    const antes = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), ajPdf);
    const desp  = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), ajPdf, cons);
    if (desp.diffARS < antes.diffARS - 0.01) mejoran3++;
    else if (desp.diffARS > antes.diffARS + 0.01 || (antes.balanceARS && !desp.balanceARS)) empeoran3++;
    else iguales3++;
    filas3.push({ id: d.id.slice(0, 8), antes: antes.diffARS, desp: desp.diffARS, dec: desp.decisionAjustes.decision });
    console.log(`${d.id.slice(0, 8)} | ${s(x.periodo)} | ${f2(antes.diffARS)} | ${f2(desp.diffARS)}    | ${String(antes.balanceARS).padEnd(5)}→${String(desp.balanceARS).padEnd(5)}        | ${desp.decisionAjustes.decision}`);
  }
  console.log(`\n  mejoran=${mejoran3}  iguales=${iguales3}  EMPEORAN=${empeoran3}`);
  chk('§3.c — NINGUNO empeora', empeoran3 === 0, `${empeoran3} empeoran`);
  chk('§3.c — los 4 con ajuste sobrante mejoran', mejoran3 === 4, `${mejoran3} mejoran`);
  filas.length = 0; filas.push(...filas3);

  // ── §2 — los tres casos de control ─────────────────────────────────────────
  console.log('\n=== §2 — los tres casos de control ===');
  for (const [pref, esperado] of [['c7222865', 'ignora'], ['08a697e0', 'computa'], ['cba1d7be', 'computa']] as const) {
    const f = filas.find(v => v.id === pref)!;
    const d = docs.find(v => v.id.startsWith(pref))!;
    const x = d.data();
    const cons0 = { saldoAnteriorARS: null, pagosDelPeriodoARS: null };
    void cons0;
    if (pref === 'c7222865') {
      chk('c7222865 — el ajuste se IGNORA y diffARS pasa de 33.035,55 a 0',
          f.dec === 'ignora' && Math.abs(f.antes - 33035.55) < 0.01 && f.desp < 0.01,
          `dec=${f.dec} antes=${f.antes.toFixed(2)} después=${f.desp.toFixed(2)}`);
    } else {
      chk(`${pref} — el ajuste se COMPUTA y queda EXACTAMENTE igual que hoy`,
          f.dec === esperado && Math.abs(f.antes - f.desp) < 0.01,
          `dec=${f.dec} antes=${f.antes.toFixed(2)} después=${f.desp.toFixed(2)}`);
      if (pref === 'cba1d7be')
        chk('cba1d7be — sigue en 0,00 como hoy', f.desp < 0.01, `diffARS=${f.desp.toFixed(2)} totalARS=${s(x.totalARS)}`);
    }
  }

  console.log(`\n${fail === 0 ? 'TODO OK' : 'HAY FALLAS'} — ${ok} ok, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
