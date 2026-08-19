// F9.147 §4 — auditoría previa. SOLO LEE.
// Cuántos análisis hay guardados, con qué campos, y si el cambio de shape los rompe.
import { getDb } from './seed/utils/firestore';

async function main() {
  const db = getDb('production');
  const snap = await db.collection('analisisPosiciones').get();
  console.log(`=== analisisPosiciones: ${snap.size} documentos ===\n`);

  const campos: Record<string, number> = {};
  const porOrigen: Record<string, number> = {};
  const filas: any[] = [];
  for (const d of snap.docs) {
    const x = d.data() as any;
    const r = (x.resultado ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(r)) campos[k] = (campos[k] ?? 0) + 1;
    porOrigen[x.origen ?? '(sin origen)'] = (porOrigen[x.origen ?? '(sin origen)'] ?? 0) + 1;
    filas.push({
      id: d.id, origen: x.origen ?? '-', modelo: x.modeloUsado ?? '-',
      fecha: (x.generadoEnISO ?? '').slice(0, 10),
      claves: Object.keys(r).length,
      tieneReq: ['queEs', 'situacionActual', 'riesgos', 'rolEnCartera'].every(k => k in r),
    });
  }
  filas.sort((a, b) => a.id.localeCompare(b.id));
  console.log('ticker      origen   modelo                       fecha        claves  pasa validacion');
  for (const f of filas) {
    console.log(`${f.id.padEnd(11)} ${f.origen.padEnd(8)} ${String(f.modelo).padEnd(28)} ${f.fecha.padEnd(12)} ${String(f.claves).padStart(6)}  ${f.tieneReq ? 'si' : 'NO'}`);
  }
  console.log(`\norigenes: ${JSON.stringify(porOrigen)}`);
  console.log('\ncampos presentes en `resultado` (de %d docs):', snap.size);
  for (const [k, n] of Object.entries(campos).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)} ${String(n).padStart(3)}/${snap.size}`);
  }

  const NUEVOS = ['fundamentals', 'recomendacion', 'justificacion'];
  console.log('\ncampos NUEVOS de F9.147 ya presentes:');
  for (const k of NUEVOS) console.log(`  ${k.padEnd(22)} ${campos[k] ?? 0}/${snap.size}`);
  console.log('\n-> los documentos viejos no traen los campos nuevos: el render tiene que');
  console.log('   tolerarlos ausentes (opcionales en el tipo), no migrarlos ni borrarlos.');

  // ¿Qué tipos de posición hay hoy? Define para qué tipos hay que definir fundamentals.
  const pd = await db.collection('preciosDiarios').get();
  const porTipo: Record<string, string[]> = {};
  for (const d of pd.docs) {
    const x = d.data() as any;
    const k = `${x.tipo}/${x.paisRiesgo}`;
    if (!porTipo[k]) porTipo[k] = [];
    porTipo[k].push(d.id);
  }
  console.log('\n=== tipos de posicion en cartera (para la seleccion por tipo del §2) ===');
  for (const [k, ts] of Object.entries(porTipo).sort()) {
    console.log(`  ${k.padEnd(18)} ${String(ts.length).padStart(2)}  ${ts.join(' ')}`);
  }

  // Indicadores disponibles para el contexto del prompt
  const ind = await db.collection('indicadoresPosicion').get();
  const conDatos = ind.docs.filter(d => (d.data() as any).motivo === null);
  console.log(`\n=== indicadoresPosicion: ${ind.size} docs, ${conDatos.length} con datos ===`);
  const ejemplo = conDatos.find(d => d.id === 'PAMP') ?? conDatos[0];
  if (ejemplo) {
    const e = ejemplo.data() as any;
    console.log(`  ejemplo (${ejemplo.id}): ${Object.keys(e).length} campos`);
    console.log(`  ${Object.keys(e).sort().join(', ')}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
