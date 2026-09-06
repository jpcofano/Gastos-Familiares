// F9.160 — §1.5 criterio de éxito, §2 ¿se conserva el signo?, §3.5 qué significa incluir:false.
// SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
const req = createRequire(process.cwd() + '/functions/package.json');
const ts = req('typescript') as typeof import('typescript');
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const n2 = (v: number) => v.toFixed(2).padStart(14);
const src = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
const bl = (d: string, h: string) => { const i = src.indexOf(d); return src.slice(i, src.indexOf(h, i) + h.length); };
const js = ts.transpileModule([bl('function tipoDeLinea', '\n}'), bl('export function calcularCuadre', '\n}').replace('export ', '')].join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
const motor = new Function(`${js}\nreturn { tipoDeLinea, calcularCuadre };`)() as any;

type L = { tipoLinea?: string; descripcionRaw?: string; monto?: number; moneda?: string; incluir?: boolean };

async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  const d = resus.docs.find(x => x.id.startsWith('08a697e0'))!;
  const x = d.data();
  const lineas = (x.movimientosParseados ?? []) as L[];
  const ajustes = (x.ajustesConsolidado ?? []) as Array<{ concepto: string; montoARS: number; montoUSD: number; origen?: string }>;
  const i = lineas.findIndex(l => /CAJA SEG/i.test(s(l.descripcionRaw)));

  console.log('=== §1.5 — criterio de éxito: cero por las razones correctas ===');
  const esc = (corregirSeguro: boolean, sacarAjusteManual: boolean) => {
    const ls = corregirSeguro ? lineas.map((l, n) => n === i ? { ...l, tipoLinea: 'consumo' } : l) : lineas;
    const aj = sacarAjusteManual ? ajustes.filter(a => a.origen !== 'manual') : ajustes;
    return motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), aj);
  };
  for (const [rot, cs, sa] of [
    ['HOY (seguro como reintegro + ajuste manual)', false, false],
    ['solo corrijo el seguro',                       true,  false],
    ['solo saco el ajuste manual',                   false, true ],
    ['LOS DOS: seguro consumo + sin ajuste manual',  true,  true ],
  ] as const) {
    const c = esc(cs, sa);
    console.log(`  ${rot.padEnd(46)} sumaARS=${n2(c.sumaARS)} diffARS=${n2(c.diffARS)} balanceARS=${c.balanceARS}`);
  }

  console.log('\n=== §2 — ¿la extracción conserva el signo original del PDF? ===');
  let neg = 0, tot = 0;
  for (const r of resus.docs) for (const l of (r.data().movimientosParseados ?? []) as L[]) { tot++; if (Number(l.monto ?? 0) < 0) neg++; }
  console.log(`  líneas en los 30 resúmenes: ${tot} | con monto NEGATIVO: ${neg}`);
  console.log(`  el crédito real del PDF "COTO DIGITAL SUC 056 CRED" (-8.870,44) está guardado como: ${s(lineas.find(l => /COTO DIGITAL.*CRED/i.test(s(l.descripcionRaw)) && Number(l.monto) < 100000)?.monto)}`);
  const campos = new Set<string>();
  for (const l of lineas) for (const k of Object.keys(l)) campos.add(k);
  console.log(`  campos de una línea: ${[...campos].sort().join(', ')}`);
  console.log(`  ¿hay algún campo con el signo o la sección de origen? ${[...campos].some(k => /signo|seccion|section|raw.*monto|montoOriginal/i.test(k)) ? 'SÍ' : 'NO'}`);

  console.log('\n=== §3.5 — TODAS las líneas con incluir:false en los 30 resúmenes ===');
  let nExc = 0;
  for (const r of resus.docs.slice().sort((a, b) => s(a.data().periodo).localeCompare(s(b.data().periodo)))) {
    const y = r.data();
    for (const l of (y.movimientosParseados ?? []) as L[]) {
      if (l.incluir !== false) continue;
      nExc++;
      console.log(`  ${r.id.slice(0, 8)} | ${s(y.periodo)} | ${s(y.banco)}/${s(y.tarjeta)} | ${s(l.tipoLinea).padEnd(20)} | ${n2(Number(l.monto ?? 0))} ${s(l.moneda)} | ${s(l.descripcionRaw).slice(0, 46)}`);
    }
  }
  console.log(`  total con incluir:false: ${nExc}`);

  console.log('\n=== §3.5 — ajustes manuales ya usados (el parche de "cerrar diferencia") ===');
  for (const r of resus.docs) {
    for (const a of (r.data().ajustesConsolidado ?? []) as Array<{ concepto: string; montoARS: number; origen?: string }>) {
      if (a.origen !== 'manual') continue;
      console.log(`  ${r.id.slice(0, 8)} | ${s(r.data().periodo)} | ${n2(Number(a.montoARS))} | "${s(a.concepto)}"`);
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
