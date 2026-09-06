// F9.164 §1 (gate) — TODOS los conceptos del bloque consolidado en los 13 PDFs legibles.
// La pregunta: ¿hay una tercera categoría además de "pago del titular" y "ajuste"? Si la hay, la
// regla "todo lo que no es SU PAGO es ajuste" es falsa y hay que enumerarla, no inferirla.
// SOLO LEE, sin API.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';

const req = createRequire(process.cwd() + '/functions/package.json');
const pdfParse = req('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;

if (getApps().length === 0) initializeApp({
  credential: cert('./secrets/serviceAccountKey.json'),
  storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
});
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

/**
 * El bloque consolidado va de `SALDO ANTERIOR` hasta el primer hito que lo cierra
 * (`SALDO PENDIENTE`, `SALDO ACTUAL`, `TOTAL A PAGAR` o el arranque del detalle). Se toma el PRIMER
 * bloque: BBVA lo imprime dos veces y el segundo es copia.
 */
function bloqueConsolidado(texto: string): string[] {
  const filas = texto.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const ini = filas.findIndex(l => /SALDO ANTERIOR/i.test(l));
  if (ini < 0) return [];
  const CIERRA = /SALDO PENDIENTE|SALDO ACTUAL|TOTAL A PAGAR|DETALLE DEL|Consumos |CONSUMOS DE|Impuestos, cargos|LIMITE|PAGO MINIMO/i;
  const out: string[] = [];
  for (let i = ini; i < filas.length && i < ini + 40; i++) {
    if (i > ini && CIERRA.test(filas[i])) break;
    out.push(filas[i]);
  }
  return out;
}

/** Rótulo sin importes ni dígitos, para agrupar formas. */
const rotulo = (l: string) => l
  .replace(/-?[\d.]+,\d{2}/g, '')
  .replace(/\d/g, '')
  .replace(/[-–]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const ES_PAGO   = /SU PAGO/i;
const ES_SALDO  = /SALDO ANTERIOR/i;

async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  console.log('F9.164 §1 — conceptos del bloque consolidado. SOLO LECTURA.\n');

  const otros = new Map<string, { n: number; ejemplos: string[]; bancos: string[] }>();
  const ajustesGuardados = new Map<string, number>();
  let leidos = 0;

  for (const d of resus.docs.slice().sort((a, b) => s(a.data().periodo).localeCompare(s(b.data().periodo)))) {
    const x = d.data();
    if (!x.refStoragePdf) continue;
    let texto: string;
    try {
      const [buf] = await getStorage().bucket().file(s(x.refStoragePdf)).download();
      texto = (await pdfParse(buf as Buffer)).text;
    } catch { continue; }
    leidos++;
    const bloque = bloqueConsolidado(texto);
    const banco = `${s(x.banco)}/${s(x.tarjeta)}`;
    console.log('─'.repeat(96));
    console.log(`${d.id.slice(0, 8)} | ${s(x.periodo)} | ${banco}`);
    for (const l of bloque) {
      const clase = ES_SALDO.test(l) ? 'SALDO ' : ES_PAGO.test(l) ? 'PAGO  ' : 'OTRO  ';
      console.log(`    ${clase} ${l.slice(0, 84)}`);
      if (clase === 'OTRO  ') {
        const r = rotulo(l).slice(0, 44);
        const e = otros.get(r) ?? { n: 0, ejemplos: [], bancos: [] };
        e.n++;
        if (e.ejemplos.length < 2) e.ejemplos.push(l.slice(0, 70));
        if (!e.bancos.includes(banco)) e.bancos.push(banco);
        otros.set(r, e);
      }
    }
    // ¿esos "OTRO" son los mismos que el modelo ya emite como ajustesConsolidado?
    const aj = ((x.ajustesConsolidado ?? []) as any[]).filter(a => a.origen !== 'manual');
    for (const a of aj) ajustesGuardados.set(s(a.concepto), (ajustesGuardados.get(s(a.concepto)) ?? 0) + 1);
    console.log(`    → ajustesConsolidado que HOY emite el modelo: ${JSON.stringify(aj.map(a => a.concepto))}`);
  }

  console.log('\n' + '═'.repeat(96));
  console.log(`PDFs leídos: ${leidos}\n`);
  console.log('conceptos del bloque que NO son SALDO ANTERIOR ni SU PAGO:');
  if (otros.size === 0) console.log('  (ninguno)');
  for (const [r, e] of [...otros].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${String(e.n).padStart(3)}×  "${r}"`);
    for (const ej of e.ejemplos) console.log(`         ej: ${ej}`);
    console.log(`         bancos: ${JSON.stringify(e.bancos)}`);
  }
  console.log('\nconceptos que el modelo YA emite como ajustesConsolidado (origen pdf):');
  for (const [c, n] of [...ajustesGuardados].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(3)}×  "${c}"`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
