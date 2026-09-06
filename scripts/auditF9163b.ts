// F9.163 §2 — la distribución de |A| y |B| sobre los 30, para elegir la tolerancia CON LOS DATOS.
// SOLO LEE, sin API. Los valores del consolidado salen del PDF con pdf-parse; es la simulación de
// lo que el prompt de §1 va a emitir.
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
const numAr = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'));
const f2 = (v: number | null) => v === null ? '         n/d' : v.toFixed(2).padStart(14);

/**
 * Extrae `SALDO ANTERIOR` y la suma de los pagos, cubriendo las TRES formas que midió el gate:
 *   BBVA            "SALDO ANTERIOR4.313.337,281.983,64" + "SU PAGO EN PESOS" (importe aparte)
 *   Galicia Visa    "07-08-26 SU PAGO EN PESOS -965.344,91"
 *   Galicia Master  "05-Jun-26SU PAGO -108.915,32-108.915,32"  (varios renglones por mes)
 */
export function leerConsolidado(texto: string): { saldo: number | null; pagos: number | null; n: number } {
  const filas = texto.split('\n').map(l => l.replace(/\s+/g, ' ').trim());
  let saldo: number | null = null;
  const pagos: number[] = [];
  filas.forEach((l, i) => {
    if (saldo === null && /SALDO ANTERIOR/i.test(l)) {
      const m = l.match(/SALDO ANTERIOR\s*(-?[\d.]+,\d{2})/i) ?? (filas[i + 1] ?? '').match(/(-?[\d.]+,\d{2})/);
      if (m) saldo = numAr(m[1]);
    }
    if (!/SU PAGO/i.test(l)) return;
    if (/USD|U\$S|DOLAR/i.test(l)) return;                      // solo ARS
    const m = l.match(/(-?[\d.]+,\d{2})(?!.*[\d.]+,\d{2})/) ?? (filas[i + 1] ?? '').match(/(-?[\d.]+,\d{2})/);
    if (!m) return;
    // El bloque consolidado se imprime dos veces en BBVA: cada importe cuenta UNA vez.
    if (!pagos.includes(numAr(m[1]))) pagos.push(numAr(m[1]));
  });
  return { saldo, pagos: pagos.length ? pagos.reduce((a, v) => a + v, 0) : null, n: pagos.length };
}

async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  console.log('F9.163 §2 — distribución de |A| y |B|. SOLO LECTURA.\n');
  console.log('id       | período | ajPdf |            A |            B |  |A|  vs  |B|');
  console.log('-'.repeat(96));

  const filas: Array<{ id: string; per: string; a: number | null; b: number | null; n: number }> = [];
  for (const d of resus.docs.slice().sort((a, b) => s(a.data().periodo).localeCompare(s(b.data().periodo)))) {
    const x = d.data();
    const ajPdf = ((x.ajustesConsolidado ?? []) as any[]).filter(a => a.origen !== 'manual');
    let saldo: number | null = null, pagos: number | null = null, np = 0;
    if (x.refStoragePdf) {
      try {
        const [buf] = await getStorage().bucket().file(s(x.refStoragePdf)).download();
        const r = leerConsolidado((await pdfParse(buf as Buffer)).text);
        saldo = r.saldo; pagos = r.pagos; np = r.n;
      } catch { /* seed sin PDF */ }
    }
    const a = (saldo !== null && pagos !== null) ? saldo + pagos : null;
    const b = a === null ? null : a + ajPdf.reduce((acc, v) => acc + Number(v.montoARS ?? 0), 0);
    filas.push({ id: d.id.slice(0, 8), per: s(x.periodo), a, b, n: ajPdf.length });
    const marca = a === null ? 'sin PDF → la regla se ABSTIENE'
      : Math.abs(a) <= 1 ? '|A|≈0 → COMPUTA'
      : Math.abs(b!) <= 1 ? '|B|≈0 → IGNORA'
      : '>>> ninguna da cero → SIN DECIDIR';
    console.log(`${d.id.slice(0, 8)} | ${s(x.periodo)} |   ${String(ajPdf.length).padStart(2)}  | ${f2(a)} | ${f2(b)} | ${marca}${np ? `  (${np} pago/s)` : ''}`);
  }

  // La distribución que justifica la tolerancia: el margen entre la rama ganadora y la perdedora.
  console.log('\n' + '═'.repeat(96));
  console.log('margen entre la rama que gana (≈0) y la que pierde, en los que tienen ajustes de PDF:');
  const margenes: number[] = [];
  for (const f of filas) {
    if (f.n === 0 || f.a === null || f.b === null) continue;
    const gana = Math.abs(f.a) <= Math.abs(f.b) ? Math.abs(f.a) : Math.abs(f.b);
    const pierde = Math.abs(f.a) <= Math.abs(f.b) ? Math.abs(f.b) : Math.abs(f.a);
    margenes.push(pierde);
    console.log(`  ${f.id} ${f.per}  gana=${gana.toFixed(2).padStart(12)}  pierde=${pierde.toFixed(2).padStart(14)}`);
  }
  if (margenes.length) {
    console.log(`\n  máximo de la rama ganadora: ${Math.max(...filas.filter(f => f.n > 0 && f.a !== null)
      .map(f => Math.min(Math.abs(f.a!), Math.abs(f.b!)))).toFixed(2)}`);
    console.log(`  mínimo de la rama perdedora: ${Math.min(...margenes).toFixed(2)}`);
    console.log('  → cualquier tolerancia entre esos dos valores clasifica IGUAL a los 8.');
  }
  const sinPdf = filas.filter(f => f.a === null).length;
  console.log(`\n  resúmenes sin consolidado legible (la regla se abstiene): ${sinPdf} de ${filas.length}`);
}

// `leerConsolidado` la importa verificarF9163.ts, asi que main() corre solo si se invoca directo.
if (process.argv[1]?.includes('auditF9163b'))
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
