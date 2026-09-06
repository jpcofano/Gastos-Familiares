// F9.161 §5.3 — el guard contra las 1810 líneas ya guardadas. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
const req = createRequire(process.cwd() + '/functions/package.json');
const ts = req('typescript') as typeof import('typescript');
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const src = fs.readFileSync('functions/src/signoLineas.ts', 'utf8').replace(/\r\n/g, '\n');
const guard = new Function(`${ts.transpileModule(src.replace(/export /g, ''),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText}
  return { corregirSignoConsumos };`)() as { corregirSignoConsumos: (l: any[]) => { correcciones: any[] } };

async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  let lineas = 0, conFirmado = 0, conSeccion = 0, corregidas = 0;
  const detalle: string[] = [];
  for (const d of resus.docs) {
    const ls = (d.data().movimientosParseados ?? []) as any[];
    lineas += ls.length;
    conFirmado += ls.filter(l => typeof l.montoFirmado === 'number').length;
    conSeccion += ls.filter(l => typeof l.seccion === 'string' && l.seccion).length;
    const r = guard.corregirSignoConsumos(ls);
    corregidas += r.correcciones.length;
    for (const c of r.correcciones)
      detalle.push(`  ${d.id.slice(0,8)} | ${s(d.data().periodo)} | seq=${c.seq} | "${c.descripcionRaw}" | ${c.seccion} | ${c.montoFirmado} | era ${c.tipoLineaAntes}`);
  }
  console.log(`resúmenes: ${resus.size} | líneas: ${lineas}`);
  console.log(`con montoFirmado: ${conFirmado} | con seccion: ${conSeccion}`);
  console.log(`líneas que el guard CORREGIRÍA: ${corregidas}`);
  for (const l of detalle) console.log(l);
  if (corregidas === 0 && conFirmado === 0)
    console.log('\n(esperado: sin montoFirmado el guard no actúa — es la conducta correcta ante la duda,\n no un guard que no funciona; su prueba está en signoLineas.test.ts y en la extracción real)');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
