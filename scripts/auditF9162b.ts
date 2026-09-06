// F9.162 §1.3 — la hipótesis quedó refutada (el concepto NUNCA está como línea, en 11 de 11) así
// que hay que buscar qué distingue "sobra" de "hace falta". SOLO LEE, sin API.
//
// Sospecha a medir: la ecuación del cuadre es Σlíneas + Σajustes ≈ totalARS, así que lo que decide
// no es si el concepto está como línea sino si el número que se extrajo como `totalARS` YA VIENE
// NETO del ajuste. Los PDFs imprimen varios totales candidatos (SALDO ACTUAL, TOTAL A PAGAR,
// SALDO PENDIENTE…) y no siempre valen lo mismo.
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
  bl('export function calcularCuadre', '\n}').replace('export ', ''),
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText}
return { calcularCuadre };`)() as {
  calcularCuadre: (l: any[], a: number, u: number, aj?: any[]) => { sumaARS: number; diffARS: number };
};

const numAr = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'));

/** Los totales que imprime la carátula, con el rótulo que los precede. */
function totalesDelPdf(texto: string) {
  const lineas = texto.split('\n').map(l => l.replace(/\s+/g, ' ').trim());
  const out: Array<{ linea: number; rotulo: string; monto: number }> = [];
  const ROT = /(SALDO ACTUAL|TOTAL A PAGAR|SALDO PENDIENTE|SALDO ANTERIOR|PAGO MINIMO|SU PAGO|TOTAL CONSUMOS DEL PERIODO|SALDO EN PESOS|SALDO TOTAL)/i;
  lineas.forEach((l, i) => {
    if (!ROT.test(l)) return;
    // el importe puede venir en la misma línea o en la siguiente (layout de dos columnas)
    for (const cand of [l, lineas[i + 1] ?? '', lineas[i + 2] ?? '']) {
      const m = cand.match(/(-?[\d.]+,\d{2})/);
      if (m) { out.push({ linea: i, rotulo: l.slice(0, 46), monto: numAr(m[1]) }); break; }
    }
  });
  return out;
}

const FOCO = [
  // sobra
  '68c7a1ea', '5d948f9a', 'b553ddf1', 'c7222865', 'f3e9e4f3',
  // hace falta
  'fc31ca48', '08a697e0', 'cba1d7be',
];

async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  console.log('F9.162 §1.3 — ¿qué distingue "sobra" de "hace falta"? SOLO LECTURA.\n');

  for (const pref of FOCO) {
    const d = resus.docs.find(x => x.id.startsWith(pref))!;
    const x = d.data();
    const ls = (x.movimientosParseados ?? []) as any[];
    const ajPdf = ((x.ajustesConsolidado ?? []) as any[]).filter(a => a.origen !== 'manual');
    const sumaAj = ajPdf.reduce((a, v) => a + Number(v.montoARS ?? 0), 0);
    const cCon = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), ajPdf);
    const cSin = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), []);
    const veredicto = cSin.diffARS < cCon.diffARS - 0.01 ? 'SOBRA'
      : cSin.diffARS > cCon.diffARS + 0.01 ? 'HACE FALTA' : 'indistinto';

    console.log('═'.repeat(100));
    console.log(`${d.id.slice(0, 8)} | ${s(x.periodo)} | ${s(x.banco)}/${s(x.tarjeta)} | ${veredicto}`);
    console.log(`  totalARS extraído = ${Number(x.totalARS).toFixed(2)} | Σajustes pdf = ${sumaAj.toFixed(2)} | Σlíneas = ${cSin.sumaARS.toFixed(2)}`);
    console.log(`  Σlíneas − totalARS = ${(cSin.sumaARS - Number(x.totalARS)).toFixed(2)}   (si da ≈ −Σajustes, el ajuste HACE FALTA)`);

    const [buf] = await getStorage().bucket().file(s(x.refStoragePdf)).download();
    const texto = (await pdfParse(buf as Buffer)).text;
    const tot = totalesDelPdf(texto);
    console.log('  totales que imprime el PDF (los candidatos a totalARS):');
    const vistos = new Set<string>();
    for (const t of tot) {
      const k = `${t.rotulo}|${t.monto}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      const marca = Math.abs(t.monto - Number(x.totalARS)) < 0.01 ? '  ←← es el totalARS extraído'
        : Math.abs(t.monto - (Number(x.totalARS) - sumaAj)) < 0.01 ? '  ←← es totalARS SIN el ajuste'
        : Math.abs(t.monto - cSin.sumaARS) < 0.01 ? '  ←← coincide con Σlíneas' : '';
      console.log(`      L${String(t.linea).padStart(4)} ${t.rotulo.padEnd(48)} ${t.monto.toFixed(2).padStart(14)}${marca}`);
    }

    // ¿Dónde cae el ajuste en el PDF? Antes o después del hito "SU PAGO".
    const filas = texto.split('\n').map(l => l.replace(/\s+/g, ' ').trim());
    for (const a of ajPdf) {
      const tok = s(a.concepto).split(/[( ]/)[0];
      const idx = filas.map((l, i) => ({ l, i })).filter(({ l }) => l.toUpperCase().includes(tok.toUpperCase())).map(({ i }) => i);
      console.log(`  "${s(a.concepto)}" (${a.montoARS}) aparece en las líneas del PDF: ${JSON.stringify(idx.slice(0, 8))}`);
    }
    for (const hito of ['SU PAGO', 'SALDO ANTERIOR', 'Sus pagos y ajustes', 'Impuestos, cargos', 'SALDO ACTUAL', 'TOTAL A PAGAR']) {
      const i = filas.findIndex(l => new RegExp(hito, 'i').test(l));
      if (i >= 0) console.log(`      hito "${hito}" → L${i}`);
    }
    console.log();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
