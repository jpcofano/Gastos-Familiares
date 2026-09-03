// F9.155 §8 — verificación. §8.1/§8.2 contra la API REAL con el prompt extraído del fuente;
// §8.3/§8.5/§8.6/§8.7 contra el código real (importado, no copiado). SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { esCuitValido, rescatarCuitContraparte } from '../functions/src/cuit';
import { reconciliarPorPayee, reconciliarPorNombre, tipoConciliable, type MovimientoMin, type DatosExtractosMin } from '../functions/src/matchLogica';
import { sueltosFuturosDelMes, construirAgenda, pendienteAgenda, pendientesOrdenados } from '../src/datos/agenda';

const req = createRequire(process.cwd() + '/functions/package.json');
const Anthropic = req('@anthropic-ai/sdk').default ?? req('@anthropic-ai/sdk');
const ts = req('typescript') as typeof import('typescript');

if (getApps().length === 0) {
  initializeApp({
    credential: cert('./secrets/serviceAccountKey.json'),
    storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
  });
}
const db = getFirestore();

function leerSecreto(): string | null {
  try {
    return execSync('npx firebase functions:secrets:access ANTHROPIC_API_KEY',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

function systemPromptReal(hoy: string): string {
  const src = fs.readFileSync('functions/src/index.ts', 'utf8').replace(/\r\n/g, '\n');
  const i = src.indexOf('function buildSystemPrompt');
  const j = src.indexOf('`;\n}', i);
  const js = ts.transpileModule(src.slice(i, j + 4), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  return (new Function(`${js}\nreturn buildSystemPrompt;`)() as (h: string) => string)(hoy);
}

const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

async function main() {
  const arg = process.argv[2] ?? 'all';
  const comps = await db.collection('comprobantes').get();

  // ── §8.3 — el validador contra los datos reales ─────────────────────────
  console.log('=== §8.3 — validador de CUIT ===');
  for (const [v, esp] of [['33610006189', true], ['30-57297583-1', true], ['12345678901', false], ['00000000000', false]] as const) {
    console.log(`  ${esCuitValido(v) === esp ? 'OK ' : '>>> NO'} ${String(v).padEnd(14)} → ${esCuitValido(v)}`);
  }
  let ncHit = 0, noHit = 0, nc = 0, no = 0;
  const hits: string[] = [];
  for (const d of comps.docs) {
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    if (dx.numeroCliente)   { nc++; if (esCuitValido(dx.numeroCliente))   { ncHit++; hits.push(`numeroCliente   "${s(dx.numeroCliente)}"   | ${d.id.slice(0, 8)} | ${s(dx.comercioRazonSocial)}`); } }
    if (dx.numeroOperacion) { no++; if (esCuitValido(dx.numeroOperacion)) { noHit++; hits.push(`numeroOperacion "${s(dx.numeroOperacion)}" | ${d.id.slice(0, 8)} | ${s(dx.comercioRazonSocial)}`); } }
  }
  console.log(`  numeroCliente poblados: ${nc} → validan: ${ncHit} | numeroOperacion poblados: ${no} → validan: ${noHit}`);
  for (const h of hits) console.log('    ' + h);

  console.log('\n  --- el rescate ACOTADO sobre esos mismos casos ---');
  for (const d of comps.docs) {
    const dx = { ...(d.data().datosExtraidos ?? {}) } as Record<string, unknown>;
    if (!esCuitValido(dx.numeroCliente) && !esCuitValido(dx.numeroOperacion)) continue;
    for (const dir of ['entrante', 'saliente'] as const) {
      const r = rescatarCuitContraparte({ ...dx, direccion: dir, contraparteCuit: null });
      console.log(`    ${d.id.slice(0, 8)} direccion=${dir.padEnd(9)} → ${s(r).padEnd(13)} | ${s(dx.comercioRazonSocial)}`);
    }
  }

  // ── §8.5 — el tipo del preload ──────────────────────────────────────────
  console.log('\n=== §8.5 — tipo del preload sin ítem esperado (expresión leída del fuente) ===');
  const srcComp = fs.readFileSync('src/vistas/Comprobantes.tsx', 'utf8').replace(/\r\n/g, '\n');
  const linea = srcComp.split('\n').map(l => l.trim()).find(l => l.startsWith('tipo:') && l.includes("d.direccion"));
  if (!linea) throw new Error('no encontré la línea de `tipo:` del preloadBase');
  const expr = linea.slice('tipo:'.length).replace(/,$/, '').trim();
  console.log(`  expresión: tipo: ${expr}`);
  const evalTipo = (dir: unknown) => new Function('d', `return ${expr.replace(/ as .*$/, '')};`)({ direccion: dir });
  for (const [dir, esp] of [['entrante', 'Ingreso'], ['saliente', 'Gasto'], [null, 'Gasto'], [undefined, 'Gasto']] as const) {
    const got = evalTipo(dir);
    console.log(`  ${got === esp ? 'OK ' : '>>> NO'} direccion=${String(dir).padEnd(9)} → ${got} (esperado ${esp})`);
  }

  // ── §8.6 — reconciliación con guarda de dirección ───────────────────────
  console.log('\n=== §8.6 — reconciliación de un cobro esperado impago ===');
  const cobro: MovimientoMin = {
    id: 'mov-cobro', monto: 3056235.49, moneda: 'ARS', tipo: 'Ingreso',
    fecha: new Date('2026-09-01T12:00:00Z'), mes: '2026-09', descripcion: 'ACCENTURE SRL',
    itemEsperadoId: 'item-sueldo-ars', destinoCuit: '33610006189', confirmadoPago: false,
  };
  const gasto: MovimientoMin = { ...cobro, id: 'mov-gasto', tipo: 'Gasto', descripcion: 'Pago a Accenture' };

  const acreditacion: DatosExtractosMin = {
    tipoDocumento: 'transferencia', montoTotal: 3056235.49, moneda: 'ARS', fecha: '2026-09-01',
    comercioRazonSocial: 'ACCENTURE SRL', direccion: 'entrante',
    contraparteNombre: 'ACCENTURE SRL', contraparteCuit: '33610006189',
  };
  const pagoSaliente: DatosExtractosMin = { ...acreditacion, direccion: 'saliente', destinoCuit: '33610006189', contraparteCuit: '33610006189' };

  const r1 = reconciliarPorPayee(acreditacion, [cobro, gasto]);
  const r2 = reconciliarPorPayee(pagoSaliente, [cobro, gasto]);
  console.log(`  tipoConciliable(entrante) = ${tipoConciliable(acreditacion)} | tipoConciliable(saliente) = ${tipoConciliable(pagoSaliente)}`);
  console.log(`  ${r1.length === 1 && r1[0].id === 'mov-cobro' ? 'OK ' : '>>> NO'} acreditación entrante → salda [${r1.map(m => m.id).join(', ')}] (esperado mov-cobro)`);
  console.log(`  ${r2.every(m => m.id !== 'mov-cobro') ? 'OK ' : '>>> NO'} pago SALIENTE del mismo monto → salda [${r2.map(m => m.id).join(', ')}] (NO debe estar mov-cobro)`);

  // Con destinoNombre en los dos, para que el assert no pase por vacuidad.
  const conNombre = [{ ...cobro, destinoNombre: 'ACCENTURE SRL' }, { ...gasto, destinoNombre: 'ACCENTURE SRL' }];
  const rn1 = reconciliarPorNombre(acreditacion, conNombre, null);
  const rn2 = reconciliarPorNombre(pagoSaliente, conNombre, null);
  console.log(`  ${rn1.length === 1 && rn1[0].id === 'mov-cobro' ? 'OK ' : '>>> NO'} porNombre entrante → [${rn1.map(m => m.id).join(', ')}] (esperado solo mov-cobro)`);
  console.log(`  ${rn2.length === 1 && rn2[0].id === 'mov-gasto' ? 'OK ' : '>>> NO'} porNombre saliente → [${rn2.map(m => m.id).join(', ')}] (esperado solo mov-gasto)`);

  // Sin `direccion` (documentos viejos): comportamiento histórico
  const sinDir: DatosExtractosMin = { ...acreditacion, direccion: undefined, contraparteCuit: undefined, destinoCuit: '33610006189' };
  const r3 = reconciliarPorPayee(sinDir, [cobro, gasto]);
  console.log(`  ${r3.every(m => m.tipo === 'Gasto') ? 'OK ' : '>>> NO'} sin direccion (doc viejo) → solo Gasto [${r3.map(m => m.id).join(', ')}] — comportamiento histórico`);

  // ── §8.7 — el ingreso suelto en el picker ───────────────────────────────
  console.log('\n=== §8.7 — un ingreso suelto pendiente entra en la agenda/picker ===');
  const hoy = new Date('2026-09-03T12:00:00Z');
  const mk = (id: string, tipo: 'Gasto' | 'Ingreso', monto: number) => ({
    id, tipo, monto, moneda: 'ARS' as const, pagado: false,
    fecha: new Date('2026-09-20T12:00:00Z'), descripcion: id,
  });
  const movs = [mk('gasto-suelto', 'Gasto', 5000), mk('cobro-suelto', 'Ingreso', 90000)] as unknown as Parameters<typeof sueltosFuturosDelMes>[0];
  const sueltos = sueltosFuturosDelMes(movs, [], hoy);
  console.log(`  sueltos en la agenda: [${sueltos.map(m => m.id).join(', ')}]`);
  console.log(`  ${sueltos.some(m => m.id === 'cobro-suelto') ? 'OK ' : '>>> NO'} el ingreso suelto entra (antes se filtraba por tipo === 'Gasto')`);
  const agenda = construirAgenda([], sueltos);
  const ofrecidos = pendientesOrdenados(agenda);
  console.log(`  ${ofrecidos.some(e => e.kind === 'suelto' && e.mov.id === 'cobro-suelto') ? 'OK ' : '>>> NO'} y el picker lo ofrece (pendientesOrdenados)`);
  console.log(`  ${pendienteAgenda(agenda) === 5000 ? 'OK ' : '>>> NO'} pendienteAgenda = ${pendienteAgenda(agenda)} (esperado 5000: el cobro NO infla el "pendiente del mes")`);

  if (arg === 'offline') return;

  // ── §8.1 / §8.2 — contra la API real ────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY ?? leerSecreto();
  if (!apiKey) { console.log('\n=== §8.1/§8.2 SALTEADO: sin ANTHROPIC_API_KEY ==='); return; }
  const client = new Anthropic({ apiKey });
  const bucket = getStorage().bucket();
  const system = systemPromptReal('2026-09-03');
  console.log(`\n=== §8.1/§8.2 — prompt nuevo contra la API real (${system.length} chars) ===`);

  async function extraer(pref: string): Promise<Record<string, unknown> | null> {
    const [files] = await bucket.getFiles({ prefix: 'entrantes/' + pref });
    if (files.length === 0) return null;
    const [buf] = await files[0].download();
    const b = buf as Buffer;
    const esPdf = b.subarray(0, 4).toString('latin1') === '%PDF';
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1536, system,
      messages: [{ role: 'user', content: [
        esPdf
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b.toString('base64') } }
          : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } },
        { type: 'text', text: 'Extraé este comprobante.' },
      ] }],
    });
    const raw = (resp.content as Array<{ type: string; text?: string }>).filter(x => x.type === 'text').map(x => x.text ?? '').join('');
    const m = raw.match(/```json\s*([\s\S]*?)\s*```/) ?? raw.match(/(\{[\s\S]*\})/);
    if (!m) return null;
    try { return JSON.parse(m[1]) as Record<string, unknown>; } catch { return null; }
  }

  console.log('\n  --- §8.1: las dos acreditaciones de Accenture ---');
  for (const [rot, pref] of [['Accenture ARS (haberes)', '0e59c80c'], ['Accenture USD (cash)', '28cab4a0']] as const) {
    const p = await extraer(pref);
    if (!p) { console.log(`  ${rot}: no se pudo extraer`); continue; }
    const conRescate = rescatarCuitContraparte(p) ?? p.contraparteCuit;
    const okDir = p.direccion === 'entrante';
    const okCuit = String(conRescate) === '33610006189';
    console.log(`  ${okDir && okCuit ? 'OK ' : '>>> NO'} ${rot}`);
    console.log(`       direccion=${s(p.direccion)} | contraparteNombre=${s(p.contraparteNombre)} | contraparteCuit=${s(p.contraparteCuit)}${p.contraparteCuit ? '' : ` (rescatado: ${s(conRescate)})`}`);
    console.log(`       destino* sin tocar: destinoNombre=${s(p.destinoNombre)} destinoCuit=${s(p.destinoCuit)} | numeroOperacion=${s(p.numeroOperacion)}`);
  }

  console.log('\n  --- §8.2 no regresión: un saliente y una factura de servicio ---');
  for (const [rot, pref, campos] of [
    ['transferencia saliente (BBVA)', '00c3651d', ['destinoNombre', 'destinoCuit', 'destinoCbu']],
    ['factura de servicio (Edenor)',  '811a6b00', ['destinoNombre', 'destinoCuit', 'montoTotal']],
  ] as const) {
    const p = await extraer(pref);
    if (!p) { console.log(`  ${rot}: no se pudo extraer`); continue; }
    const viejo = comps.docs.find(d => d.id.startsWith(pref))?.data()?.datosExtraidos as Record<string, unknown> | undefined;
    const iguales = campos.every(c => String(p[c] ?? '') === String(viejo?.[c] ?? ''));
    console.log(`  ${p.direccion === 'saliente' ? 'OK ' : '>>> NO'} ${rot}: direccion=${s(p.direccion)}`);
    console.log(`  ${iguales ? 'OK ' : '>>> NO'}   destino* igual que hoy → ${campos.map(c => `${c}=${s(p[c])}`).join(' | ')}`);
    if (!iguales) console.log(`         hoy en Firestore: ${campos.map(c => `${c}=${s(viejo?.[c])}`).join(' | ')}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
