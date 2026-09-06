// F9.161 §3 — ¿el CR.RG / CANJE PUNTOS está TAMBIÉN como línea? SOLO LEE (sin API).
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === undefined || v === null ? '' : String(v);
async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  for (const pref of ['08a697e0', 'b553ddf1', 'f3e9e4f3', '5d948f9a', 'c7222865']) {
    const d = resus.docs.find(x => x.id.startsWith(pref))!;
    const ls = (d.data().movimientosParseados ?? []) as any[];
    const hits = ls.filter(l => /CR\.RG|CANJE PUNTOS|DEV\.IMP/i.test(s(l.descripcionRaw)));
    const sumaLineas = ls.filter(l => l.incluir !== false && Number(l.monto) > 0).reduce((a, l) =>
      a + (l.moneda === 'ARS' ? (['reintegro_percepcion','bonificacion','reverso'].includes(s(l.tipoLinea)) ? -1 : 1) * Number(l.monto) : 0), 0);
    const aj = ((d.data().ajustesConsolidado ?? []) as any[]).filter(a => a.origen !== 'manual');
    console.log(`\n${pref} | totalARS=${s(d.data().totalARS)} | suma de LÍNEAS (sin ajustes)=${sumaLineas.toFixed(2)} | Δ=${(sumaLineas - Number(d.data().totalARS)).toFixed(2)}`);
    console.log(`  ajustes del PDF guardados: ${JSON.stringify(aj)}`);
    console.log(`  líneas CR.RG/CANJE/DEV.IMP: ${hits.length}`);
    for (const h of hits) console.log(`      "${s(h.descripcionRaw)}" | ${s(h.tipoLinea)} | ${s(h.monto)} ${s(h.moneda)}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
