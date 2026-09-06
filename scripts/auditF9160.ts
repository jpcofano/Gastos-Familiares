// F9.160 §1 — reconstrucción renglón por renglón del resumen 08a697e0 contra los subtotales que
// imprime el PDF. SOLO LEE. `tipoDeLinea` y `calcularCuadre` salen del código real.
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

const srcDatos = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
function bloque(fuente: string, desde: string, hasta: string): string {
  const i = fuente.indexOf(desde);
  if (i < 0) throw new Error(`no encontré "${desde}"`);
  return fuente.slice(i, fuente.indexOf(hasta, i) + hasta.length);
}
const js = ts.transpileModule([
  bloque(srcDatos, 'function tipoDeLinea', '\n}'),
  bloque(srcDatos, 'export function totalesNetos', '\n}').replace('export ', ''),
  bloque(srcDatos, 'export function calcularCuadre', '\n}').replace('export ', ''),
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
const motor = new Function(`${js}\nreturn { tipoDeLinea, calcularCuadre };`)() as {
  tipoDeLinea: (l: Record<string, unknown>) => 'Gasto' | 'Ingreso';
  calcularCuadre: (l: unknown[], a: number, u: number, aj?: unknown[]) => {
    sumaARS: number; sumaUSD: number; diffARS: number; diffUSD: number; balanceARS: boolean; balanceUSD: boolean };
};

type Linea = {
  seq?: number; tipoLinea?: string; descripcionRaw?: string; monto?: number; moneda?: string;
  personaDetectada?: string; personaConfirmada?: string | null; incluir?: boolean;
  cuotaActual?: number; cuotaTotal?: number; nroCupon?: string; fechaConsumo?: string | null;
  esBonificacion?: boolean; esReverso?: boolean; esImpuesto?: boolean;
};

// Subtotales impresos en el PDF (§1 de la spec) — patrón de comparación, no en discusión.
const PDF = {
  'MARIA':    { ars: 1336897.92, usd: 40.00 },
  'JUAN':     { ars:  807818.44, usd:  3.71 },
  'SOFIA':    { ars:    6951.93, usd:  0.00 },
  'FEDERICO': { ars:  107712.15, usd: 29.84 },
};
const PDF_IMPUESTOS = 112.33 + 1179.55 + 33406.41;   // 34698.29
const PDF_CR_RG     = -890257.63;
const PDF_SALDO     = 1403821.10;
const PDF_SALDO_USD = 73.55;

async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  const d = resus.docs.find(x => x.id.startsWith('08a697e0'))!;
  const x = d.data();
  const lineas = (x.movimientosParseados ?? []) as Linea[];

  console.log(`=== 08a697e0 | ${s(x.banco)} ${s(x.tarjeta)} ${s(x.periodo)} ===`);
  console.log(`totalARS=${s(x.totalARS)} totalUSD=${s(x.totalUSD)} | líneas=${lineas.length}`);
  console.log(`ajustesConsolidado=${JSON.stringify(x.ajustesConsolidado ?? [])}\n`);

  // ── Volcado completo, con el signo con que entra al cuadre ────────────────
  console.log('=== §1 — TODOS los renglones, con el signo con que los suma calcularCuadre ===');
  console.log('  #  | persona    | tipoLinea            | incl | signo |         monto | descripcionRaw');
  let sumaCalc = 0;
  for (const [i, l] of lineas.entries()) {
    const tipo = motor.tipoDeLinea(l as Record<string, unknown>);
    const cuenta = l.incluir && Number(l.monto ?? 0) > 0;
    const signo = tipo === 'Gasto' ? 1 : -1;
    if (cuenta && l.moneda === 'ARS') sumaCalc += signo * Number(l.monto ?? 0);
    console.log(
      `  ${String(i).padStart(3)} | ${s(l.personaDetectada).slice(0, 10).padEnd(10)} | ${s(l.tipoLinea).padEnd(20)} | ` +
      `${l.incluir ? ' sí ' : ' NO '} | ${cuenta ? (signo > 0 ? '  +  ' : '  −  ') : ' ··· '} | ${n2(Number(l.monto ?? 0))} ${s(l.moneda)} | ${s(l.descripcionRaw).slice(0, 44)}`,
    );
  }

  // ── §1.1 — subtotales por sección, contra el PDF ──────────────────────────
  console.log('\n=== §1.1 — subtotal por sección vs el PDF ===');
  const porPersona = new Map<string, { ars: number; usd: number; n: number }>();
  for (const l of lineas) {
    if (!l.incluir || Number(l.monto ?? 0) <= 0) continue;
    // Sin acentos: los datos traen "MARÍA"/"SOFÍA" y las claves del PDF vienen sin tilde.
    const k = s(l.personaDetectada).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/\s+/)[0] || '(sin persona)';
    const acc = porPersona.get(k) ?? { ars: 0, usd: 0, n: 0 };
    const signo = motor.tipoDeLinea(l as Record<string, unknown>) === 'Gasto' ? 1 : -1;
    if (l.moneda === 'ARS') acc.ars += signo * Number(l.monto ?? 0); else acc.usd += signo * Number(l.monto ?? 0);
    acc.n++;
    porPersona.set(k, acc);
  }
  console.log('  sección       |  n |     suma parseada |        PDF |        Δ');
  for (const [k, v] of [...porPersona].sort()) {
    const esperado = (PDF as Record<string, { ars: number; usd: number }>)[k];
    const delta = esperado ? v.ars - esperado.ars : null;
    console.log(`  ${k.padEnd(13)} | ${String(v.n).padStart(2)} | ${n2(v.ars)} | ${esperado ? n2(esperado.ars) : '           n/d'} | ${delta === null ? '        n/d' : n2(delta)}${delta !== null && Math.abs(delta) > 0.01 ? '   <<< NO CIERRA' : ''}`);
    console.log(`  ${''.padEnd(13)} |    | USD ${v.usd.toFixed(2).padStart(10)} | ${esperado ? ('USD ' + esperado.usd.toFixed(2)).padStart(14) : '           n/d'} | ${esperado ? (v.usd - esperado.usd).toFixed(2) : 'n/d'}`);
  }

  // ── §1.2 — renglones del PDF que buscamos explícitamente ──────────────────
  console.log('\n=== §1.2 — los renglones nombrados en la spec: ¿están parseados? ===');
  const buscar: Array<[string, RegExp, number | null]> = [
    ['SU PAGO EN PESOS',      /SU PAGO EN PESOS|SU PAGO/i,        -4313337.28],
    ['SU PAGO EN USD',        /SU PAGO.*(USD|DOLAR)/i,             null],
    ['SALDO ANTERIOR',        /SALDO ANTERIOR/i,                   null],
    ['CR.RG 5617 30% M',      /CR\.?\s*RG\s*5617/i,                -890257.63],
    ['DB.RG 5617 30%',        /DB\.?\s*RG\s*5617/i,                 33406.41],
    ['CAJA SEG-PROMO',        /CAJA SEG/i,                          168542.00],
    ['COTO DIGITAL ... CRED', /COTO DIGITAL.*CRED/i,               -8870.44],
    ['IVA / impuestos',       /\bIVA\b|IMPUESTO|LEY 25413|SELLADO/i, null],
  ];
  for (const [rotulo, re, esperado] of buscar) {
    const hits = lineas.filter(l => re.test(s(l.descripcionRaw)));
    if (hits.length === 0) { console.log(`  >>> AUSENTE  ${rotulo.padEnd(24)} (esperado ${esperado ?? 'n/d'})`); continue; }
    for (const h of hits) {
      const tipo = motor.tipoDeLinea(h as Record<string, unknown>);
      const signo = h.incluir && Number(h.monto ?? 0) > 0 ? (tipo === 'Gasto' ? '+' : '−') : '·';
      console.log(`      presente  ${rotulo.padEnd(24)} | ${s(h.tipoLinea).padEnd(20)} | incl=${h.incluir ? 'sí' : 'NO'} | signo=${signo} | ${n2(Number(h.monto ?? 0))} ${s(h.moneda)} | "${s(h.descripcionRaw).slice(0, 40)}"`);
      if (esperado !== null) {
        const efectivo = (tipo === 'Gasto' ? 1 : -1) * Number(h.monto ?? 0);
        console.log(`                ${''.padEnd(24)}   PDF=${n2(esperado)} | entra al cuadre como ${n2(efectivo)} | Δ=${n2(efectivo - esperado)}`);
      }
    }
  }

  // ── §1.3 — el cuadre actual, y el aritmético del PDF ──────────────────────
  console.log('\n=== §1.3 — el cuadre hoy vs la aritmética del PDF ===');
  const c = motor.calcularCuadre(lineas, Number(x.totalARS), Number(x.totalUSD), (x.ajustesConsolidado ?? []) as unknown[]);
  console.log(`  calcularCuadre: sumaARS=${n2(c.sumaARS)} diffARS=${n2(c.diffARS)} balanceARS=${c.balanceARS}`);
  console.log(`                  sumaUSD=${n2(c.sumaUSD)} diffUSD=${n2(c.diffUSD)} balanceUSD=${c.balanceUSD}`);
  const sumaPdf = PDF.MARIA.ars + PDF.JUAN.ars + PDF.SOFIA.ars + PDF.FEDERICO.ars + PDF_IMPUESTOS + PDF_CR_RG;
  console.log(`  aritmética del PDF: ${PDF.MARIA.ars} + ${PDF.JUAN.ars} + ${PDF.SOFIA.ars} + ${PDF.FEDERICO.ars} + ${PDF_IMPUESTOS.toFixed(2)} + (${PDF_CR_RG}) = ${sumaPdf.toFixed(2)}`);
  console.log(`  SALDO ACTUAL del PDF = ${PDF_SALDO.toFixed(2)} | totalARS extraído = ${s(x.totalARS)} | Δ = ${(sumaPdf - PDF_SALDO).toFixed(2)}`);

  // ── §1.4 — el escenario corregido ─────────────────────────────────────────
  console.log('\n=== §1.4 — ¿qué pasa si SOLO se corrige el seguro a consumo? ===');
  const idxSeguro = lineas.findIndex(l => /CAJA SEG/i.test(s(l.descripcionRaw)));
  const soloSeguro = lineas.map((l, i) => i === idxSeguro ? { ...l, tipoLinea: 'consumo' } : l);
  const c2 = motor.calcularCuadre(soloSeguro, Number(x.totalARS), Number(x.totalUSD), (x.ajustesConsolidado ?? []) as unknown[]);
  console.log(`  sumaARS=${n2(c2.sumaARS)} diffARS=${n2(c2.diffARS)} → excede el total por ${n2(c2.sumaARS - Number(x.totalARS))}`);
  console.log(`  (ese excedente es el "segundo error" que hay que encontrar)`);

  // ── §1.5 — qué renglones suman de más / faltan ────────────────────────────
  console.log('\n=== §1.5 — reconstrucción: qué habría que cambiar para llegar a 1.403.821,10 ===');
  const objetivo = Number(x.totalARS);
  const excedente = c2.sumaARS - objetivo;
  console.log(`  excedente con el seguro corregido: ${excedente.toFixed(2)}`);
  console.log('  candidatos: renglones ARS incluidos cuyo monto o su doble sea igual al excedente');
  for (const l of lineas) {
    if (l.moneda !== 'ARS' || !l.incluir) continue;
    const m = Number(l.monto ?? 0);
    if (Math.abs(m - excedente) < 0.01) console.log(`    monto == excedente : ${n2(m)} | ${s(l.tipoLinea).padEnd(20)} | ${s(l.descripcionRaw).slice(0, 44)}`);
    if (Math.abs(2 * m - excedente) < 0.01) console.log(`    2×monto == excedente: ${n2(m)} | ${s(l.tipoLinea).padEnd(20)} | ${s(l.descripcionRaw).slice(0, 44)}`);
  }
  console.log(`  · si faltara un crédito de ${excedente.toFixed(2)} sin parsear, ese sería el segundo error`);
  console.log(`  · si un crédito existente entrara con signo +, su monto sería ${(excedente / 2).toFixed(2)}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
