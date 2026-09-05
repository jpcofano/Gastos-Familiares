// F9.158 §4 — ESCRIBE (borra). Los movimientos-total duplicados, con la regla corregida:
//   1. conservar el que cuadra con el total del resumen (resumen.totalARS / totalUSD)
//   2. si los dos cuadran, conservar el más antiguo por creadoEn
//   3. si NINGUNO cuadra, no tocar
// La regla se recalcula acá desde los datos vivos; no se borra por una lista escrita a mano.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';

const req = createRequire(process.cwd() + '/functions/package.json');
const ts = req('typescript') as typeof import('typescript');

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const ms = (v: unknown) => (v as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
const fechaStr = (v: unknown) => {
  const t = v as { toDate?: () => Date } | null | undefined;
  return t?.toDate ? t.toDate().toISOString().replace('T', ' ').slice(0, 19) : s(v);
};

const src = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
const i = src.indexOf('export function clavesDeResumen');
const j = src.indexOf('\n}', i);
const jsClaves = ts.transpileModule(src.slice(i, j + 2).replace('export ', ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;
const clavesDeResumen = new Function(`${jsClaves}\nreturn clavesDeResumen;`)() as
  (r: { id: string; tarjetaCodigo: string | null; nroResumen: string | null }) => string[];

async function main() {
  const aplicar = process.argv.includes('--apply');
  console.log(aplicar ? '=== MODO ESCRITURA (--apply) ===\n' : '=== dry run (sin --apply) ===\n');

  const resus = await db.collection('resumenesTarjeta').get();
  const movsSnap = await db.collection('movimientos').get();

  const aBorrar: Array<{ id: string; mes: string; moneda: string; monto: number; regla: string }> = [];
  const bloqueados: string[] = [];

  for (const d of resus.docs) {
    const x = d.data();
    const claves = clavesDeResumen({ id: d.id, tarjetaCodigo: x.tarjetaCodigo ?? null, nroResumen: x.nroResumen ?? null });
    const totales = movsSnap.docs.filter(m =>
      claves.includes(s(m.data().resumenTarjetaId)) && m.data().excluirDash === true);

    for (const moneda of ['ARS', 'USD'] as const) {
      const grupo = totales.filter(m => m.data().moneda === moneda)
        .sort((a, b) => ms(a.data().creadoEn) - ms(b.data().creadoEn));
      if (grupo.length <= 1) continue;

      const esperado = Number(moneda === 'ARS' ? x.totalARS : x.totalUSD) || 0;
      const cuadra = grupo.filter(m => Math.abs(Number(m.data().monto ?? 0) - esperado) < 0.01);
      let conservar: FirebaseFirestore.QueryDocumentSnapshot;
      let regla: string;
      if (cuadra.length === 1)      { conservar = cuadra[0]; regla = '1 (único que cuadra con el total del resumen)'; }
      else if (cuadra.length > 1)   { conservar = cuadra[0]; regla = '2 (los dos cuadran, el más antiguo)'; }
      else {
        bloqueados.push(`${s(x.banco)} ${s(x.tarjeta)} ${s(x.periodo)} ${moneda}: ninguno cuadra con ${esperado} → [${grupo.map(m => s(m.data().monto)).join(', ')}]`);
        continue;   // regla 3 — no se toca
      }

      console.log(`  ${s(x.banco)} ${s(x.tarjeta)} ${s(x.periodo)} ${moneda} | total del resumen = ${esperado}`);
      for (const m of grupo) {
        const y = m.data();
        const es = m.id === conservar.id;
        console.log(`     ${es ? 'CONSERVAR' : 'BORRAR   '} ${m.id.padEnd(28)} monto=${String(s(y.monto)).padStart(14)} creadoEn=${fechaStr(y.creadoEn)}${es ? `  <- regla ${regla}` : ''}`);
        if (!es) aBorrar.push({ id: m.id, mes: s(y.mes), moneda, monto: Number(y.monto ?? 0), regla });
      }
      console.log();
    }
  }

  if (bloqueados.length > 0) {
    console.log('  >>> BLOQUEADOS por la regla 3 (ninguno cuadra) — NO SE TOCAN:');
    for (const b of bloqueados) console.log(`      ${b}`);
    console.log();
  } else console.log('  (ninguno cae en la regla 3)\n');

  const porMes = new Map<string, { ars: number; usd: number }>();
  for (const b of aBorrar) {
    const acc = porMes.get(b.mes) ?? { ars: 0, usd: 0 };
    if (b.moneda === 'ARS') acc.ars += b.monto; else acc.usd += b.monto;
    porMes.set(b.mes, acc);
  }
  console.log('  --- impacto por mes ---');
  for (const [mes, v] of [...porMes].sort()) console.log(`      ${mes}: -ARS ${v.ars.toFixed(2)} | -USD ${v.usd.toFixed(2)}`);
  console.log(`\n  a borrar: ${aBorrar.length}`);

  if (!aplicar) { console.log('\n(sin --apply: no se borró nada)'); return; }
  if (aBorrar.length === 0) return;

  const batch = db.batch();
  for (const b of aBorrar) batch.delete(db.collection('movimientos').doc(b.id));
  await batch.commit();
  console.log('\n=== COMMIT HECHO ===');
  for (const b of aBorrar) {
    const leido = await db.collection('movimientos').doc(b.id).get();
    console.log(`  ${b.id.padEnd(28)} ${b.moneda} ${String(b.monto).padStart(14)} | ${b.mes} | regla ${b.regla} | existe: ${leido.exists ? '>>> SÍ (falló)' : 'no (borrado)'}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
