// F9.162 §1.3 — la identidad que separa los dos casos, medida sobre los 8 resúmenes con ajustes
// origen:pdf. SOLO LEE, sin API.
//
// Lo que se mide, sobre el bloque consolidado del encabezado del PDF:
//     SALDO ANTERIOR + Σ(SU PAGO) + Σ(ajustes)  ≈ 0   → el crédito CANCELA EL SALDO ANTERIOR
//     SALDO ANTERIOR + Σ(SU PAGO)               ≈ 0   → el crédito es del PERÍODO ACTUAL
// La primera dice que el ajuste es plata del período anterior y no tiene nada que hacer en el
// cuadre del período actual; la segunda, que sí.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';

const req = createRequire(process.cwd() + '/functions/package.json');
const pdfParse = req('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;
const ts = req('typescript') as typeof import('typescript');

if (getApps().length === 0) initializeApp({
  credential: cert('./secrets/serviceAccountKey.json'),
  storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
});
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

const srcDatos = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
const bl = (d: string, h: string) => { const i = srcDatos.indexOf(d); return srcDatos.slice(i, srcDatos.indexOf(h, i) + h.length); };
const motor = new Function(`${ts.transpileModule([
  bl('function tipoDeLinea', '\n}'),
  bl('export function totalesNetos', '\n}').replace('export ', ''),
  (() => { const _r = require('node:fs').readFileSync('src/datos/ajusteConsolidado.ts','utf8').replace(/\\r\\n/g,'\\n'); return _r.replace(/^import .*$/gm,'').replace(/export /g,''); })(),
  bl('export function calcularCuadre', '\n}').replace('export ', ''),
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText}
return { calcularCuadre };`)() as {
  calcularCuadre: (l: any[], a: number, u: number, aj?: any[]) => { sumaARS: number; diffARS: number };
};

const numAr = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'));
const f2 = (v: number) => v.toFixed(2).padStart(14);

/** SALDO ANTERIOR y todos los SU PAGO EN PESOS del bloque consolidado. */
function consolidado(texto: string): { saldoAnterior: number | null; pagos: number[] } {
  const filas = texto.split('\n').map(l => l.replace(/\s+/g, ' ').trim());
  let saldoAnterior: number | null = null;
  const pagos: number[] = [];
  filas.forEach((l, i) => {
    if (saldoAnterior === null && /SALDO ANTERIOR/i.test(l)) {
      // BBVA pega el importe al rótulo ("SALDO ANTERIOR1.720.234,7819,79"): se toma el primero.
      const m = l.match(/SALDO ANTERIOR\s*(-?[\d.]+,\d{2})/i)
        ?? (filas[i + 1] ?? '').match(/(-?[\d.]+,\d{2})/);
      if (m) saldoAnterior = numAr(m[1]);
    }
    if (/SU PAGO EN PESOS/i.test(l)) {
      const m = l.match(/(-?[\d.]+,\d{2})(?!.*[\d.]+,\d{2})/) ?? (filas[i + 1] ?? '').match(/(-?[\d.]+,\d{2})/);
      // El PDF imprime el bloque consolidado DOS veces (carátula + detalle), así que cada pago
      // aparece duplicado. Se cuenta cada importe una sola vez. Límite conocido: dos pagos
      // genuinamente iguales en el mismo resumen colapsarían — no pasa en los 30.
      if (m && !pagos.includes(numAr(m[1]))) pagos.push(numAr(m[1]));
    }
  });
  return { saldoAnterior, pagos };
}

async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  console.log('F9.162 §1.3 — la identidad del bloque consolidado. SOLO LECTURA.\n');
  console.log('  A = SALDO ANTERIOR + Σ(SU PAGO)          → si ≈ 0, el pago solo salda el mes anterior');
  console.log('  B = SALDO ANTERIOR + Σ(SU PAGO) + Σajuste → si ≈ 0, el ajuste es PARTE de ese saldado\n');

  const filas: string[] = [];
  for (const d of resus.docs.slice().sort((a, b) => s(a.data().periodo).localeCompare(s(b.data().periodo)))) {
    const x = d.data();
    const ajPdf = ((x.ajustesConsolidado ?? []) as any[]).filter(a => a.origen !== 'manual');
    if (ajPdf.length === 0) continue;
    const ls = (x.movimientosParseados ?? []) as any[];
    const sumaAj = ajPdf.reduce((a, v) => a + Number(v.montoARS ?? 0), 0);

    const cCon = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), ajPdf);
    const cSin = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), []);
    const medido = cSin.diffARS < cCon.diffARS - 0.01 ? 'SOBRA'
      : cSin.diffARS > cCon.diffARS + 0.01 ? 'HACE FALTA' : 'indistinto';

    const [buf] = await getStorage().bucket().file(s(x.refStoragePdf)).download();
    const { saldoAnterior, pagos } = consolidado((await pdfParse(buf as Buffer)).text);
    const sumaPagos = pagos.reduce((a, v) => a + v, 0);
    const A = saldoAnterior === null ? NaN : saldoAnterior + sumaPagos;
    const B = A + sumaAj;

    const predicho = Math.abs(B) < 1 ? 'SOBRA (cancela el saldo anterior)'
      : Math.abs(A) < 1 ? 'HACE FALTA (es del período actual)'
      : 'no encaja en ninguna de las dos';

    // ¿Este resumen tiene además el seguro mal clasificado? Contamina la medición.
    const seguro = ls.filter(l => /CAJA SEG/i.test(s(l.descripcionRaw))
      && ['reintegro_percepcion', 'bonificacion', 'reverso'].includes(s(l.tipoLinea)));
    const contamina = seguro.reduce((a, l) => a + 2 * Number(l.monto ?? 0), 0);

    console.log('─'.repeat(100));
    console.log(`${d.id.slice(0, 8)} | ${s(x.periodo)} | ${s(x.banco)}/${s(x.tarjeta)}`);
    console.log(`  SALDO ANTERIOR=${f2(saldoAnterior ?? NaN)}  Σ(SU PAGO)=${f2(sumaPagos)}  Σajustes=${f2(sumaAj)}`);
    console.log(`  A=${f2(A)}   B=${f2(B)}`);
    console.log(`  medido=${medido.padEnd(11)} predicho por la identidad = ${predicho}`);
    if (contamina > 0) {
      // Corrigiendo el seguro, ¿cuál de las dos hipótesis deja diff = 0?
      const conAj  = Math.abs(cSin.sumaARS + contamina + sumaAj - Number(x.totalARS));
      const sinAj  = Math.abs(cSin.sumaARS + contamina - Number(x.totalARS));
      console.log(`  ojo: tiene el seguro mal clasificado (contamina ${contamina.toFixed(2)}).`);
      console.log(`       con el seguro corregido → diff CON ajuste=${conAj.toFixed(2)} | SIN ajuste=${sinAj.toFixed(2)}`);
    }
    filas.push(`${d.id.slice(0, 8)} ${s(x.periodo)} medido=${medido.padEnd(11)} identidad=${predicho}`);
  }

  console.log('\n' + '═'.repeat(100));
  console.log('resumen:');
  for (const f of filas) console.log('  ' + f);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
