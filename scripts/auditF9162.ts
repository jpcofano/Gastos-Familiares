// F9.162 §1 — DIAGNÓSTICO PURO. ¿El ajuste consolidado está también como línea?
// SOLO LEE: ni una escritura, ni una llamada a la API. Los subtotales impresos del PDF salen de
// pdf-parse, no a ojo. El motor de cuadre se EXTRAE del fuente, no se copia.
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
const n2 = (v: number) => v.toFixed(2).padStart(14);

const srcDatos = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
const bl = (d: string, h: string) => { const i = srcDatos.indexOf(d); return srcDatos.slice(i, srcDatos.indexOf(h, i) + h.length); };
const motor = new Function(`${ts.transpileModule([
  bl('function tipoDeLinea', '\n}'),
  bl('export function totalesNetos', '\n}').replace('export ', ''),
  (() => { const _r = require('node:fs').readFileSync('src/datos/ajusteConsolidado.ts','utf8').replace(/\\r\\n/g,'\\n'); return _r.replace(/^import .*$/gm,'').replace(/export /g,''); })(),
  bl('export function calcularCuadre', '\n}').replace('export ', ''),
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText}
return { calcularCuadre };`)() as {
  calcularCuadre: (l: any[], a: number, u: number, aj?: any[]) => {
    sumaARS: number; diffARS: number; balanceARS: boolean; sumaUSD: number; diffUSD: number };
};

/**
 * Normalización para comparar un concepto de ajuste contra una descripción de línea.
 * NO es la regla del §2 — es solo el instrumento de medición del diagnóstico. Se saca la
 * puntuación y el sufijo de una letra (`CR.RG 5617 30% M` vs `CR.RG 5617 30%`) porque ésa es
 * justamente la variación que la spec señala.
 */
const norm = (v: string) => v
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase()
  .replace(/[.,%()]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\s+[A-Z]$/, '');

/** ¿La descripción de la línea corresponde al mismo concepto que el ajuste? */
function mismoConcepto(concepto: string, descripcion: string): boolean {
  const a = norm(concepto), b = norm(descripcion);
  if (!a || !b) return false;
  return a === b || b.startsWith(a) || a.startsWith(b);
}

const numAr = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'));
function subtotalesDelPdf(texto: string) {
  const out: Array<{ rotulo: string; monto: number }> = [];
  const re = /(TOTAL\s+(?:DE\s+)?CONSUMOS?\s+(?:DE\s+)?[^\d\n]{0,40}?|TOTAL\s+ADICIONAL\s+DE\s+[^\d\n]{0,40}?)\s+(-?[\d.]+,\d{2})/gi;
  let m: RegExpExecArray | null;
  const vistos = new Set<string>();
  while ((m = re.exec(texto)) !== null) {
    const rot = m[1].replace(/\s+/g, ' ').trim();
    const k = `${rot}|${m[2]}`;
    if (vistos.has(k)) continue;      // el PDF imprime los subtotales dos veces (resumen + detalle)
    vistos.add(k);
    out.push({ rotulo: rot, monto: numAr(m[2]) });
  }
  return out;
}

function porSeccion(lineas: any[]) {
  const map = new Map<string, number>();
  for (const l of lineas) {
    if (Number(l.monto ?? 0) <= 0 || l.moneda !== 'ARS') continue;
    const k = (s(l.seccion) !== '(ausente)' && s(l.seccion) !== 'null' && l.seccion)
      ? norm(s(l.seccion)) : `(sin seccion) persona=${s(l.personaDetectada) || '—'}`;
    const ingreso = ['reintegro_percepcion', 'bonificacion', 'reverso'].includes(s(l.tipoLinea));
    map.set(k, (map.get(k) ?? 0) + (ingreso ? -1 : 1) * Number(l.monto ?? 0));
  }
  return map;
}

const FOCO = ['08a697e0', 'b553ddf1', 'f3e9e4f3', '5d948f9a', 'c7222865'];

async function main() {
  const resus = await db.collection('resumenesTarjeta').get();

  console.log('F9.162 §1 — DIAGNÓSTICO. Cero escrituras, cero llamadas a la API.\n');

  for (const pref of FOCO) {
    const d = resus.docs.find(x => x.id.startsWith(pref));
    if (!d) { console.log(`>>> ${pref}: no está`); continue; }
    const x = d.data();
    const ls = (x.movimientosParseados ?? []) as any[];
    const ajTodos = (x.ajustesConsolidado ?? []) as any[];
    const ajPdf = ajTodos.filter(a => a.origen !== 'manual');

    console.log('═'.repeat(104));
    console.log(`${d.id.slice(0, 8)} | ${s(x.periodo)} | ${s(x.banco)}/${s(x.tarjeta)} | totalARS=${s(x.totalARS)} totalUSD=${s(x.totalUSD)}`);

    console.log('  ajustesConsolidado[] (el array entero):');
    for (const a of ajTodos)
      console.log(`      concepto="${s(a.concepto)}" montoARS=${s(a.montoARS)} montoUSD=${s(a.montoUSD)} origen=${s(a.origen)}`);
    if (ajTodos.length === 0) console.log('      (vacío)');

    console.log('  ¿el concepto del ajuste (origen pdf) está como LÍNEA?');
    for (const a of ajPdf) {
      const hits = ls.filter(l => mismoConcepto(s(a.concepto), s(l.descripcionRaw)));
      console.log(`      "${s(a.concepto)}" → ${hits.length > 0 ? 'SÍ' : 'NO'} (${hits.length} línea/s)`);
      for (const h of hits)
        console.log(`         seq=${s(h.seq)} desc="${s(h.descripcionRaw)}" monto=${s(h.monto)} montoFirmado=${s(h.montoFirmado)} seccion=${s(h.seccion)} tipoLinea=${s(h.tipoLinea)} incluir=${s(h.incluir)}`);
    }
    // Red de seguridad: el matcheo por concepto puede fallar por redacción. Se busca también por
    // MONTO, que no depende de cómo esté escrito el renglón.
    for (const a of ajPdf) {
      const porMonto = ls.filter(l => Math.abs(Number(l.monto ?? 0) - Math.abs(Number(a.montoARS ?? 0))) < 0.01);
      if (porMonto.length)
        for (const h of porMonto)
          console.log(`      [por monto ${Math.abs(Number(a.montoARS)).toFixed(2)}] seq=${s(h.seq)} "${s(h.descripcionRaw)}" tipoLinea=${s(h.tipoLinea)} seccion=${s(h.seccion)}`);
      else
        console.log(`      [por monto ${Math.abs(Number(a.montoARS)).toFixed(2)}] ninguna línea con ese importe`);
    }

    const cCon = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), ajPdf);
    const cSin = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), []);
    console.log(`  sumaARS CON ajuste=${n2(cCon.sumaARS)} (diff ${n2(cCon.diffARS)}) | SIN ajuste=${n2(cSin.sumaARS)} (diff ${n2(cSin.diffARS)}) | totalARS=${n2(Number(x.totalARS))}`);
    console.log(`  → el ajuste ${cSin.diffARS < cCon.diffARS ? 'SOBRA' : cSin.diffARS > cCon.diffARS ? 'HACE FALTA' : 'es indistinto'}`);

    console.log('  subtotales por sección (líneas guardadas):');
    for (const [k, v] of [...porSeccion(ls)].sort()) console.log(`      ${k.padEnd(46).slice(0, 46)} ${n2(v)}`);
    try {
      const [buf] = await getStorage().bucket().file(s(x.refStoragePdf)).download();
      const imp = subtotalesDelPdf((await pdfParse(buf as Buffer)).text);
      console.log('  subtotales que IMPRIME el PDF:');
      for (const t of imp) console.log(`      ${t.rotulo.padEnd(46).slice(0, 46)} ${n2(t.monto)}`);
    } catch (e) {
      console.log(`  (no se pudo leer el PDF: ${(e as Error).message.slice(0, 80)})`);
    }
    console.log();
  }

  // ── §1.5 — el tamaño real del problema, sobre los 30 ────────────────────────
  console.log('═'.repeat(104));
  console.log('§1.5 — los 30 resúmenes: ¿cuántos ajustes origen:pdf figuran también como línea?\n');
  let conAjPdf = 0, duplicados = 0, ajPdfTotal = 0;
  const filas: string[] = [];
  for (const d of resus.docs.slice().sort((a, b) => s(a.data().periodo).localeCompare(s(b.data().periodo)))) {
    const x = d.data();
    const ls = (x.movimientosParseados ?? []) as any[];
    const ajPdf = ((x.ajustesConsolidado ?? []) as any[]).filter(a => a.origen !== 'manual');
    if (ajPdf.length === 0) continue;
    conAjPdf++;
    ajPdfTotal += ajPdf.length;
    const cCon = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), ajPdf);
    const cSin = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), []);
    for (const a of ajPdf) {
      const comoLinea = ls.some(l => mismoConcepto(s(a.concepto), s(l.descripcionRaw)));
      const porMonto  = ls.some(l => Math.abs(Number(l.monto ?? 0) - Math.abs(Number(a.montoARS ?? 0))) < 0.01);
      if (comoLinea) duplicados++;
      filas.push(
        `  ${d.id.slice(0, 8)} | ${s(x.periodo)} | "${s(a.concepto)}" ${String(a.montoARS).padStart(13)}` +
        ` | comoLinea=${comoLinea ? 'SÍ' : 'no'} | mismoMonto=${porMonto ? 'SÍ' : 'no'}` +
        ` | diff con=${cCon.diffARS.toFixed(2)} sin=${cSin.diffARS.toFixed(2)}` +
        ` → ${cSin.diffARS < cCon.diffARS - 0.01 ? 'SOBRA' : cSin.diffARS > cCon.diffARS + 0.01 ? 'HACE FALTA' : 'indistinto'}`,
      );
    }
  }
  for (const f of filas) console.log(f);
  console.log(`\n  resúmenes con ajustes origen:pdf: ${conAjPdf} de ${resus.size}`);
  console.log(`  ajustes origen:pdf en total: ${ajPdfTotal}`);
  console.log(`  de ésos, con el concepto TAMBIÉN como línea: ${duplicados}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
