// F9.154 §5 — verificación. §5.1 llama a la API REAL con las imágenes reales; §5.2/§5.3/§5.4
// corren contra el código real (importado, no copiado). SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { corregirAnioVencimientos, anioMasCercano, distanciaDias, UMBRAL_DIAS_VENCIMIENTO } from '../functions/src/fechasVencimiento';
import { mesImputado } from '../functions/src/matchLogica';
import * as fs from 'node:fs';

const req = createRequire(process.cwd() + '/functions/package.json');
const Anthropic = req('@anthropic-ai/sdk').default ?? req('@anthropic-ai/sdk');

if (getApps().length === 0) {
  initializeApp({
    credential: cert('./secrets/serviceAccountKey.json'),
    storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
  });
}
const db = getFirestore();

function leerSecreto(): string | null {
  try {
    const out = execSync('npx firebase functions:secrets:access ANTHROPIC_API_KEY',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() || null;
  } catch { return null; }
}

// El system prompt REAL, extraído del fuente: si alguien lo cambia, esto lo ve.
function systemPromptReal(hoy: string): string {
  const src = fs.readFileSync('functions/src/index.ts', 'utf8');
  const i = src.indexOf('function buildSystemPrompt');
  // El cuerpo es un template literal que contiene llaves y saltos de línea (el esquema JSON de
  // salida), así que buscar el primer "\n}" corta en el lugar equivocado. El cierre real es la
  // secuencia backtick-punto y coma seguida de la llave de la función.
  const j = src.indexOf('`;\n}', i);
  if (j < 0) throw new Error('no encontré el cierre de buildSystemPrompt');
  const cuerpo = src.slice(i, j + 4);
  const ts = req('typescript') as typeof import('typescript');
  const js = ts.transpileModule(cuerpo, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  const fn = new Function(`${js}\nreturn buildSystemPrompt;`)() as (h: string) => string;
  return fn(hoy);
}

async function main() {
  const arg = process.argv[2] ?? 'all';

  // ── §5.2 — distribución de distancias y justificación del umbral ─────────
  console.log('=== §5.2 — distancias |vencimiento − subida| sobre los comprobantes de producción ===');
  const comps = await db.collection('comprobantes').get();
  const dist: number[] = [];
  for (const d of comps.docs) {
    const c = d.data();
    const dx = (c.datosExtraidos ?? {}) as Record<string, unknown>;
    const subido = (c.subidoEn as FirebaseFirestore.Timestamp | undefined)?.toDate();
    const vs = (dx.vencimientos as Array<{ fecha?: string | null }> | null) ?? [];
    if (!subido) continue;
    for (const v of vs) {
      if (!v?.fecha) continue;
      const n = distanciaDias(v.fecha, subido);
      if (n !== null) dist.push(n);
    }
  }
  dist.sort((a, b) => a - b);
  console.log(`  comprobantes: ${comps.size} | vencimientos con fecha: ${dist.length}`);
  console.log(`  mínimo: ${dist[0]} d | máximo: ${dist[dist.length - 1]} d | |máx|: ${Math.max(...dist.map(Math.abs))} d`);
  for (const u of [30, 60, 90, 120, 183, 365]) {
    console.log(`  a más de ${String(u).padStart(3)} d de la subida: ${dist.filter(n => Math.abs(n) > u).length}`);
  }
  console.log(`  UMBRAL elegido en el código: ${UMBRAL_DIAS_VENCIMIENTO} d → dispara sobre ${dist.filter(n => Math.abs(n) > UMBRAL_DIAS_VENCIMIENTO).length} de los ${dist.length} vencimientos reales`);

  // ── §5.2b — el guard sobre el caso de Edenor, tal como pasó ──────────────
  console.log('\n=== §5.2b — el guard determinístico contra el caso real de Edenor ===');
  const casos: Array<[string, string, string]> = [
    ['Edenor (el que falló)', '2025-09-08', '2026-09-03'],
    ['Metrogas (el que anduvo)', '2026-09-14', '2026-09-03'],
    ['AySA', '2026-08-04', '2026-07-30'],
    ['fin de año: leído 05/01', '2027-12-20', '2027-01-05'],
    ['fin de año: leído 28/12', '2025-01-05', '2026-12-28'],
  ];
  for (const [rotulo, fecha, subida] of casos) {
    const ref = new Date(subida + 'T12:00:00Z');
    const { vencimientos, correcciones } = corregirAnioVencimientos([{ fecha, monto: 1 }], ref);
    const c = correcciones[0];
    console.log(`  ${rotulo.padEnd(26)} venc=${fecha} subido=${subida} → ${vencimientos[0].fecha}` +
      (c ? `  [CORREGIDO: ${c.antes} (${c.diasAntes} d) → ${c.despues} (${c.diasDespues} d)]` : '  [sin cambios]'));
  }

  // ── §5.4 — mesImputado, la tabla del corte 25 ───────────────────────────
  console.log('\n=== §5.4 — mesImputado() con corte 25 (la tabla de la spec) ===');
  for (const [fecha, esperado] of [
    ['2026-08-25', '2026-08'], ['2026-08-28', '2026-08'], ['2026-09-01', '2026-08'],
    ['2026-09-02', '2026-08'], ['2026-09-25', '2026-09'],
  ] as const) {
    const got = mesImputado(fecha, 25);
    console.log(`  ${got === esperado ? 'OK ' : '>>> NO'} ${fecha} → ${got} (esperado ${esperado})`);
  }
  console.log('  --- ítem sin corte (null): no cambia nada ---');
  for (const fecha of ['2026-08-28', '2026-09-01', '2026-09-25']) {
    console.log(`  ${mesImputado(fecha, null) === null ? 'OK ' : '>>> NO'} ${fecha} con diaCorteImputacion=null → ${mesImputado(fecha, null)} (el caller usa el mes de la fecha)`);
  }
  console.log('  --- borde de año ---');
  for (const [fecha, corte, esperado] of [['2027-01-03', 25, '2026-12'], ['2027-01-25', 25, '2027-01']] as const) {
    const got = mesImputado(fecha, corte);
    console.log(`  ${got === esperado ? 'OK ' : '>>> NO'} ${fecha} corte ${corte} → ${got} (esperado ${esperado})`);
  }

  // ── §5.3 — numeroCliente de las boletas de AySA ─────────────────────────
  console.log('\n=== §5.3 — numeroCliente crudo de las boletas de AySA ===');
  const items = await db.collection('itemsEsperados').get();
  const nombreItem = (id: unknown) => {
    const it = items.docs.find(d => d.id === String(id))?.data();
    return it ? `${it.categoria} > ${it.subcategoria}` : String(id);
  };
  const aysa = comps.docs.filter(d => {
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    return /AYSA|AGUA Y SANEAMIENTO/i.test(String(dx.comercioRazonSocial ?? ''));
  });
  for (const d of aysa) {
    const c = d.data();
    const dx = (c.datosExtraidos ?? {}) as Record<string, unknown>;
    const pm = (c.propuestaMatch ?? {}) as Record<string, unknown>;
    console.log(`  ${d.id.slice(0, 8)} | ${String(dx.montoTotal).padStart(10)} | numeroCliente=${String(dx.numeroCliente).padEnd(18)} | fue a: ${nombreItem(pm.itemEsperadoId)}`);
  }

  console.log('\n  --- simulación de la desambiguación por claves de ítem ---');
  const normalizar = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/^0+(?=.)/, '');
  // Las claves que el dueño cargaría en cada ítem, según los datos de arriba.
  const claves: Record<string, string[]> = {
    'Casa > Agua': ['2651968', '11115200536'],
    'Auto > Agua': ['2651943', '000000002651943', '11115526643'],
  };
  for (const d of aysa) {
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    const num = normalizar(dx.numeroCliente);
    const reclaman = Object.entries(claves).filter(([, cs]) => cs.some(c => normalizar(c) === num));
    console.log(`  numeroCliente=${String(dx.numeroCliente).padEnd(18)} (norm=${num.padEnd(12)}) → ${reclaman.length === 1 ? reclaman[0][0] : reclaman.length === 0 ? '(ninguno: cae al ítem del destino)' : 'AMBIGUO: ' + reclaman.map(r => r[0]).join(' / ')}`);
  }

  if (arg === 'offline') return;

  // ── §5.1 — el prompt nuevo contra la API real, con las imágenes reales ──
  const apiKey = process.env.ANTHROPIC_API_KEY ?? leerSecreto();
  if (!apiKey) { console.log('\n=== §5.1 SALTEADO: sin ANTHROPIC_API_KEY ==='); return; }
  const client = new Anthropic({ apiKey });
  const bucket = getStorage().bucket();

  console.log('\n=== §5.1 — el prompt NUEVO contra la API real, mismas imágenes, hoy = 2026-09-03 ===');
  const HOY = '2026-09-03';
  const system = systemPromptReal(HOY);
  console.log(`  (system prompt extraído del fuente: ${system.length} chars)`);

  for (const [rotulo, pref, esperado] of [
    ['Edenor  "Vence el 08/09"', '0c5d5e5a', '2026-09-08'],
    ['Metrogas "Vence el 14/09"', 'a650c026', '2026-09-14'],
  ] as const) {
    const [files] = await bucket.getFiles({ prefix: 'entrantes/' + pref });
    if (files.length === 0) { console.log(`  ${rotulo}: archivo no encontrado`); continue; }
    const [buf] = await files[0].download();
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1536,
      system,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: (buf as Buffer).toString('base64') } },
          { type: 'text', text: 'Extraé este comprobante.' },
        ],
      }],
    });
    const raw = (resp.content as Array<{ type: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text ?? '').join('');
    const m = raw.match(/```json\s*([\s\S]*?)\s*```/) ?? raw.match(/(\{[\s\S]*\})/);
    let venc = '(no parseó)';
    let fechaEmision = '(no parseó)';
    if (m) {
      try {
        const p = JSON.parse(m[1]) as { vencimientos?: Array<{ fecha?: string }>; fecha?: string };
        venc = p.vencimientos?.[0]?.fecha ?? 'null';
        fechaEmision = p.fecha ?? 'null';
      } catch { /* deja el placeholder */ }
    }
    const ok = venc === esperado ? 'OK ' : '>>> NO';
    console.log(`  ${ok} ${rotulo.padEnd(26)} → vencimientos[0].fecha = ${venc} (esperado ${esperado}) | fecha(emisión) = ${fechaEmision}`);
  }

  // Casos de fin de año: mismo prompt, distinto "hoy", con un texto sintético.
  console.log('\n  --- fin de año, con el mismo prompt y "hoy" distinto (sin imagen, texto plano) ---');
  for (const [hoy, texto, campo, esperado] of [
    ['2027-01-05', 'EDENOR — Servicio de luz. Total a pagar $ 1000,00. Vence el 20/12. Cliente 123456.', 'vencimiento', '2026-12-20'],
    ['2026-12-28', 'METROGAS — Servicio de gas. Total a pagar $ 1000,00. Vence el 05/01. Cliente 123456.', 'vencimiento', '2027-01-05'],
    ['2027-01-05', 'EDENOR — Factura emitida el 20/12. Total a pagar $ 1000,00. Cliente 123456.', 'emision', '2026-12-20'],
    ['2026-12-28', 'METROGAS — Factura emitida el 05/01. Total a pagar $ 1000,00. Cliente 123456.', 'emision', '2026-01-05'],
  ] as const) {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1536,
      system: systemPromptReal(hoy),
      messages: [{ role: 'user', content: [{ type: 'text', text: texto + '\n\nExtraé este comprobante.' }] }],
    });
    const raw = (resp.content as Array<{ type: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text ?? '').join('');
    const m = raw.match(/```json\s*([\s\S]*?)\s*```/) ?? raw.match(/(\{[\s\S]*\})/);
    let got = '(no parseó)';
    if (m) {
      try {
        const p = JSON.parse(m[1]) as { vencimientos?: Array<{ fecha?: string }>; fecha?: string };
        got = (campo === 'vencimiento' ? p.vencimientos?.[0]?.fecha : p.fecha) ?? 'null';
      } catch { /* deja el placeholder */ }
    }
    console.log(`  ${got === esperado ? 'OK ' : '>>> NO'} hoy=${hoy} ${campo.padEnd(11)} "${texto.match(/\d{2}\/\d{2}/)?.[0]}" → ${got} (esperado ${esperado})`);
  }

  // Y el guard, por si el modelo igual se desvía.
  console.log('\n  --- el guard determinístico como red, sobre los mismos 4 casos ---');
  for (const [subida, fechaModelo, esperado] of [
    ['2027-01-05', '2027-12-20', '2026-12-20'],
    ['2026-12-28', '2025-01-05', '2027-01-05'],
  ] as const) {
    const salida = anioMasCercano(fechaModelo, new Date(subida + 'T12:00:00Z'));
    console.log(`  ${salida === esperado ? 'OK ' : '>>> NO'} subida=${subida} modelo dijo ${fechaModelo} → guard: ${salida} (esperado ${esperado})`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
