// F9.183 — verificación de la agenda de pagos. NO escribe en producción.
//
//   1) npx tsx scripts/probarF9183.ts --api <fixture.json>
//      Producción SOLO LECTURA + la API: extracción de la captura (verif. 1), dedup contra producción
//      (verif. 2), re-subida en memoria (verif. 3) y no regresión de la clasificación (verif. 5).
//      Deja en <fixture.json> lo que la parte 2 siembra en el emulador. El fixture tiene datos reales:
//      va al scratchpad, NO se commitea. La captura se lee de Descargas y tampoco se copia al repo.
//
//   2) npm --prefix functions run build
//      firebase emulators:exec --only firestore,functions,storage,auth --project demo-f9183 \
//        "npx tsx scripts/probarF9183.ts --emulador <fixture.json>"
//      Las functions REALES en el emulador: la captura entra como comprobante 'subido' y la procesa
//      extraerComprobante (2 llamadas a la API) → dividido → matchComprobanteHijo. Más atomicidad (verif.
//      4), match de los hijos (verif. 6), "Procesar de nuevo" dos veces (§3.2/§3.3) y el blob compartido
//      al descartar un hijo.
//
// Privacidad: ids a 8 caracteres.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const MODO = process.argv.includes('--emulador') ? 'emulador' : process.argv.includes('--api') ? 'api' : null;
const FIXTURE = process.argv[process.argv.indexOf(MODO === 'emulador' ? '--emulador' : '--api') + 1];
if (!MODO || !FIXTURE) { console.log('uso: --api <fixture.json> | --emulador <fixture.json>'); process.exit(1); }

process.env.TZ = 'America/Argentina/Buenos_Aires';
const CAPTURA = path.join(os.homedir(), 'Downloads', 'agenda-2026-10-06.png');
const SUBIDA = '2026-10-06';
const SUBIDA_TS = new Date('2026-10-06T10:19:00-03:00');   // la hora de la captura

const req = createRequire(process.cwd() + '/functions/package.json');
const h8 = (v: unknown) => (v ? String(v).slice(0, 8) : '-');
const s = (v: unknown) => (v === null ? 'null' : v === undefined ? '(ausente)' : String(v));
const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ok = (c: boolean) => (c ? 'OK' : '✗');
let fallas = 0;
const chequear = (c: boolean, txt: string) => { if (!c) fallas++; console.log(`  ${ok(c)} ${txt}`); };

// La tabla de §0 del prompt: el criterio de aceptación.
const TABLA = [
  { emisor: 'Edenor',   monto: 137509.91, venc: '2026-10-07', ya: '2824a147' },
  { emisor: 'Metrogas', monto: 5291.83,   venc: '2026-10-08', ya: '1f5087af' },
  { emisor: 'AGIP',     monto: 87084.97,  venc: '2026-10-31', ya: 'e9089013' },
  { emisor: 'AGIP',     monto: 76228.21,  venc: '2026-10-07', ya: null },
  { emisor: 'AGIP',     monto: 92479.04,  venc: '2026-10-31', ya: null },
  { emisor: 'AGIP',     monto: 89605.43,  venc: '2026-10-31', ya: null },
  { emisor: 'AGIP',     monto: 88081.49,  venc: '2026-10-31', ya: null },
];

// Firestore → JSON y de vuelta (los Timestamp viajan como { __ts: ms }).
const aJson = (v: unknown): unknown => {
  if (v && typeof v === 'object' && typeof (v as { toMillis?: unknown }).toMillis === 'function') return { __ts: (v as { toMillis: () => number }).toMillis() };
  if (Array.isArray(v)) return v.map(aJson);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, aJson(x)]));
  return v;
};

function normalizadorReal(): (v: unknown) => string {
  const ts = req('typescript') as typeof import('typescript');
  const src = fs.readFileSync('functions/src/index.ts', 'utf8').replace(/\r\n/g, '\n');
  const i = src.indexOf('function normalizarClaveDesambiguacion');
  const code = src.slice(i, src.indexOf('\n}', i) + 2);
  return new Function(`${ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText}\nreturn normalizarClaveDesambiguacion;`)() as (v: unknown) => string;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Parte 1 — producción (solo lectura) + API
// ═════════════════════════════════════════════════════════════════════════════════════════════════
async function parteApi() {
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getStorage } = await import('firebase-admin/storage');
  initializeApp({ credential: cert('./secrets/serviceAccountKey.json'), storageBucket: 'gastos-familiares-e6415.firebasestorage.app' });
  const db = getFirestore();
  const Anthropic = req('@anthropic-ai/sdk').default ?? req('@anthropic-ai/sdk');
  const ts = req('typescript') as typeof import('typescript');
  const AP = await import('../functions/src/agendaPagos');
  const { aExistente } = await import('../functions/src/agendaDivision');
  const { corregirAnioVencimientos } = await import('../functions/src/fechasVencimiento');
  const normalizar = normalizadorReal();

  const src = fs.readFileSync('functions/src/index.ts', 'utf8').replace(/\r\n/g, '\n');
  const i = src.indexOf('function buildSystemPrompt');
  const buildSystemPrompt = new Function(`${ts.transpileModule(src.slice(i, src.indexOf('`;\n}', i) + 4),
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText}\nreturn buildSystemPrompt;`)() as (hoy: string) => string;

  const apiKey = process.env.ANTHROPIC_API_KEY ?? execSync('npx firebase functions:secrets:access ANTHROPIC_API_KEY', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const client = new Anthropic({ apiKey });
  const llamar = async (system: string, buf: Buffer, mime: string, texto: string, maxTokens: number) => {
    const contenido = mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }
      : { type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } };
    const r = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages: [{ role: 'user', content: [contenido, { type: 'text', text: texto }] }] });
    const raw = (r.content as Array<{ type: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text).join('');
    const m = raw.match(/```json\s*([\s\S]*?)\s*```/) ?? raw.match(/(\{[\s\S]*\})/);
    return { r, json: m ? JSON.parse(m[1]) : null };
  };

  console.log('F9.183 — PARTE 1: producción (solo lectura) + API\n');
  if (!fs.existsSync(CAPTURA)) { console.log(`>>> no está ${CAPTURA}`); process.exit(1); }
  const img = fs.readFileSync(CAPTURA);
  // El tipo sale de los BYTES, como en procesarComprobante (F9.152): la captura se llama .png y es WebP.
  const { detectarTipoReal } = await import('../functions/src/tipoArchivo');
  const mimeImg = detectarTipoReal(img) ?? 'image/png';
  console.log(`captura: ${img.length} bytes, tipo real ${mimeImg} (nombre .png)\n`);

  // ── 1. extracción ──
  console.log('── 1. extracción de la captura (subida 2026-10-06)');
  const p1 = await llamar(buildSystemPrompt(SUBIDA), img, mimeImg, 'Extraé este comprobante.', 1536);
  chequear(p1.json?.tipoDocumento === 'agenda_pagos', `primera llamada: tipoDocumento = ${s(p1.json?.tipoDocumento)}`);
  const p2 = await llamar(AP.buildAgendaPrompt(SUBIDA), img, mimeImg, 'Extraé las filas de esta agenda de pagos.', AP.MAX_TOKENS_AGENDA);
  console.log(`  segunda llamada: stop_reason=${p2.r.stop_reason} · output_tokens=${p2.r.usage.output_tokens}`);
  const crudas = (p2.json?.filas ?? []) as Array<Record<string, unknown>>;
  const { vencimientos: vc } = corregirAnioVencimientos(crudas.map(f => ({ fecha: f.vencimiento as string, monto: f.monto as number })), SUBIDA_TS);
  crudas.forEach((f, k) => { f.vencimiento = vc[k].fecha; });
  const { validas, invalidas } = AP.validarFilas(crudas);
  for (const f of validas) console.log(`    ${f.emisor.padEnd(22)} ${f.numeroCliente.padEnd(14)} ${fmt(f.monto).padStart(11)} ${f.moneda} · ${f.vencimiento} · "${f.vencimientoTexto}"`);
  chequear(validas.length === 7 && invalidas.length === 0, `${validas.length} filas válidas, ${invalidas.length} inválidas, ${(p2.json?.filasDescartadas ?? []).length} descartadas`);
  const coincide = TABLA.every(t => validas.some(f => Math.abs(f.monto - t.monto) < 0.005 && f.vencimiento === t.venc));
  chequear(coincide, 'montos exactos y vencimientos de la tabla (Vence mañana → 2026-10-07; 08/10; 31/10)');

  // ── 2. dedup contra producción ──
  console.log('\n── 2. dedup contra producción, con las filas EXTRAÍDAS');
  const comps = await db.collection('comprobantes').get();
  const existentes = comps.docs.map(d => aExistente(d.id, d.data())).filter(<T>(x: T | null): x is T => x !== null);
  const pares = AP.aparearConExistentes(validas, existentes, normalizar);
  let iguales = 0;
  validas.forEach((f, k) => {
    const t = TABLA.find(t => Math.abs(t.monto - f.monto) < 0.005 && t.venc === f.vencimiento);
    const got = pares[k] ? pares[k]!.existente.id.slice(0, 8) : null;
    const bien = !!t && t.ya === got;
    if (bien) iguales++;
    console.log(`    ${ok(bien)} ${f.emisor.padEnd(22)} ${fmt(f.monto).padStart(11)} · ${f.vencimiento} → ${got ? `ya cargada (${got}, Δ ${(100 * pares[k]!.diff).toFixed(2)} %)` : 'NUEVA'}`);
  });
  chequear(iguales === 7, `coincide con la tabla de §0: ${iguales}/7 (${pares.filter(p => !p).length} hijos, ${pares.filter(p => p).length} ya cargadas)`);

  // ── 3. re-subida, en memoria ──
  console.log('\n── 3. re-subida (en memoria, sobre el estado que deja la 2)');
  const nuevas = validas.filter((_, k) => !pares[k]);
  const { ids } = AP.idsDeHijos(nuevas, normalizar);
  const conHijos = [...existentes, ...nuevas.map((f, k) => ({ id: ids[k], numeroCliente: f.numeroCliente, monto: f.monto, vencimiento: f.vencimiento, emisor: f.emisor, subidoEn: SUBIDA }))];
  const misma = AP.aparearConExistentes(validas, conHijos, normalizar);
  chequear(misma.every(p => p), `misma agenda de nuevo → ${misma.filter(p => !p).length} hijos (esperado 0)`);
  const cuotas = validas.filter(f => f.vencimiento === '2026-10-31');
  const siguiente = [
    ...cuotas.map(f => ({ ...f, monto: Math.round(f.monto * 1.012 * 100) / 100 })),
    { ...validas.find(f => /edenor/i.test(f.emisor))!, monto: 121345.67, vencimiento: '2026-11-07', vencimientoTexto: 'Vence el 07/11' },
  ];
  const sig = AP.aparearConExistentes(siguiente, conHijos, normalizar);
  chequear(sig.filter(p => !p).length === 1 && !sig[sig.length - 1], `"un mes después" (cuotas +1,2 %, Edenor 07/11) → ${sig.filter(p => !p).length} hijo(s) (esperado 1: la Edenor nueva)`);

  // ── 5. no regresión de la clasificación ──
  console.log('\n── 5. no regresión: 3 recortes y una factura PDF siguen con su tipoDocumento');
  for (const id of ['2824a147', '1f5087af', 'e9089013', '3be2e9fd']) {
    const d = comps.docs.find(x => x.id.startsWith(id))!; const x = d.data();
    const [buf] = await getStorage().bucket().file(String(x.refStoragePdf)).download();
    const hoy = x.subidoEn.toDate().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const r = await llamar(buildSystemPrompt(hoy), buf as Buffer, String(x.contentType), 'Extraé este comprobante.', 1536);
    const antes = x.datosExtraidos?.tipoDocumento;
    chequear(r.json?.tipoDocumento === antes, `${id} (${x.contentType}) ${s(x.datosExtraidos?.comercioRazonSocial)}: antes ${s(antes)} → ahora ${s(r.json?.tipoDocumento)}`);
  }

  // ── fixture para la parte 2 ──
  const meses = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'];
  const [destinos, items, movs, config] = await Promise.all([
    db.collection('destinos').get(), db.collection('itemsEsperados').get(),
    db.collection('movimientos').where('mes', 'in', meses).get(), db.collection('config').get(),
  ]);
  const col = (snap: FirebaseFirestore.QuerySnapshot) => snap.docs.map(d => ({ id: d.id, data: aJson(d.data()) }));
  fs.writeFileSync(FIXTURE, JSON.stringify({
    primera: p1.json, filas: validas, invalidas, descartadas: p2.json?.filasDescartadas ?? [],
    colecciones: { comprobantes: col(comps), destinos: col(destinos), itemsEsperados: col(items), movimientos: col(movs), config: col(config) },
  }));
  console.log(`\nfixture: ${FIXTURE} (${comps.size} comprobantes, ${destinos.size} destinos, ${items.size} ítems, ${movs.size} movimientos de ${meses[0]}…${meses[meses.length - 1]})`);
  console.log(`\nPARTE 1: ${fallas === 0 ? 'TODO OK' : `${fallas} FALLA(S)`}`);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// Parte 2 — emulador (functions reales)
// ═════════════════════════════════════════════════════════════════════════════════════════════════
async function parteEmulador() {
  const PROYECTO = 'demo-f9183';
  const BUCKET = `${PROYECTO}.appspot.com`;
  // El MISMO firebase-admin que usa functions/src/agendaDivision.ts (functions/node_modules): con la copia
  // de la raíz, su FieldValue.delete() no se reconoce como sentinel y el update falla.
  const { initializeApp } = req('firebase-admin/app') as typeof import('firebase-admin/app');
  const { getFirestore, Timestamp } = req('firebase-admin/firestore') as typeof import('firebase-admin/firestore');
  const { getStorage } = req('firebase-admin/storage') as typeof import('firebase-admin/storage');
  if (!process.env.FIRESTORE_EMULATOR_HOST) { console.log('>>> esto corre DENTRO de firebase emulators:exec'); process.exit(1); }
  initializeApp({ projectId: PROYECTO, storageBucket: BUCKET });
  const db = getFirestore();
  const { dividirAgenda } = await import('../functions/src/agendaDivision');
  const normalizar = normalizadorReal();
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const deJson = (v: unknown): unknown => {
    if (v && typeof v === 'object' && '__ts' in (v as object)) return Timestamp.fromMillis((v as { __ts: number }).__ts);
    if (Array.isArray(v)) return v.map(deJson);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deJson(x)]));
    return v;
  };
  const HUB = 'http://127.0.0.1:4400';
  const FN = `http://127.0.0.1:5001/${PROYECTO}/southamerica-east1`;
  const esperar = async <T>(f: () => Promise<T | null>, seg: number, que: string): Promise<T> => {
    const t0 = Date.now();
    for (;;) {
      const v = await f();
      if (v) return v;
      if (Date.now() - t0 > seg * 1000) throw new Error(`timeout esperando ${que}`);
      await new Promise(r => setTimeout(r, 1500));
    }
  };
  const comps = db.collection('comprobantes');
  const hijosDe = async (padre: string) => (await comps.where('padreHash', '==', padre).get()).docs;

  console.log('F9.183 — PARTE 2: emulador, functions reales\n');

  // ── siembra, con los triggers APAGADOS (si no, aprenderDestino tocaría las confianzas) ──
  await fetch(`${HUB}/functions/disableBackgroundTriggers`, { method: 'PUT' });
  let n = 0;
  for (const [nombre, docs] of Object.entries(fx.colecciones as Record<string, Array<{ id: string; data: Record<string, unknown> }>>)) {
    for (let k = 0; k < docs.length; k += 400) {
      const b = db.batch();
      for (const d of docs.slice(k, k + 400)) { b.set(db.collection(nombre).doc(d.id), deJson(d.data) as Record<string, unknown>); n++; }
      await b.commit();
    }
  }
  const EMAIL = 'admin-f9183@test.local';
  await db.collection('autorizados').doc(EMAIL).set({ rol: 'admin', memberId: 'Juan' });
  await fetch(`${HUB}/functions/enableBackgroundTriggers`, { method: 'PUT' });
  console.log(`sembrados ${n} docs (triggers apagados durante la siembra)\n`);

  // ── E2E: la captura entra como comprobante 'subido' ──
  console.log('── E2E: extraerComprobante → dividido → matchComprobanteHijo');
  const img = fs.readFileSync(CAPTURA);
  const hash = createHash('sha256').update(img).digest('hex');
  const ruta = `entrantes/${hash}`;
  await getStorage().bucket().file(ruta).save(img, { contentType: 'image/png' });
  await comps.doc(hash).set({
    hashPdf: hash, nombreArchivo: 'agenda-2026-10-06.png', contentType: 'image/png', tamano: img.length,
    refStoragePdf: ruta, subidoPor: 'Juan', estado: 'subido', subidoEn: Timestamp.fromDate(SUBIDA_TS),
  });
  const padre = await esperar(async () => {
    const d = (await comps.doc(hash).get()).data();
    return d && (d.estado === 'dividido' || d.estado === 'error') ? d : null;
  }, 240, 'el padre dividido');
  chequear(padre.estado === 'dividido', `padre ${h8(hash)} → ${padre.estado}${padre.errorExtraccion ? ` (${padre.errorExtraccion})` : ''}`);
  const filas = (padre.filas ?? []) as Array<Record<string, unknown>>;
  for (const f of filas) {
    const ya = f.yaCargada as { comprobanteId: string; diferencia: number } | undefined;
    console.log(`    ${String(f.emisor).padEnd(22)} ${fmt(Number(f.monto)).padStart(11)} · ${f.vencimiento} → ${f.resultado === 'hijo' ? `hijo ${h8(f.hijo)} (nuevo=${f.nuevo})` : `ya cargada = ${h8(ya?.comprobanteId)} (Δ ${((ya?.diferencia ?? 0) * 100).toFixed(2)} %)`}`);
  }
  const iguales = TABLA.filter(t => filas.some(f => Math.abs(Number(f.monto) - t.monto) < 0.005 && f.vencimiento === t.venc &&
    (t.ya ? String((f.yaCargada as { comprobanteId?: string } | undefined)?.comprobanteId ?? '').startsWith(t.ya) : f.resultado === 'hijo'))).length;
  chequear(iguales === 7, `filas del padre = tabla de §0: ${iguales}/7`);
  let hijos = await hijosDe(hash);
  chequear(hijos.length === 4, `${hijos.length} hijos creados (esperado 4)`);
  for (const h of hijos) {
    const d = h.data();
    chequear(d.hashPdf === h.id && d.refStoragePdf === ruta && d.padreHash === hash && d.subidoPor === 'Juan' && d.datosExtraidos?.tipoDocumento === 'recibo_servicio',
      `hijo ${h8(h.id)}: hashPdf = su id, imagen del padre, padreHash, recibo_servicio (${d.estado})`);
  }

  // ── 6. match de los hijos (matchComprobanteHijo, onCreate) ──
  console.log('\n── 6. match de los hijos');
  const conPropuesta = await esperar(async () => {
    const ds = await hijosDe(hash);
    return ds.every(d => d.data().propuestaMatch) ? ds : null;
  }, 120, 'la propuesta de los 4 hijos');
  const ABL = '62a96fc83be3b3506032';
  for (const h of conPropuesta) {
    const pm = h.data().propuestaMatch;
    chequear(pm.rama === 2 && pm.itemEsperadoId === ABL && pm.requiereConfirmacion === true,
      `hijo ${h8(h.id)} ${fmt(h.data().datosExtraidos.montoTotal)} → rama ${pm.rama}, ítem ${h8(pm.itemEsperadoId)} (ABL), requiereConfirmacion=${pm.requiereConfirmacion}, esAdicional=${s(pm.esAdicional)}`);
  }

  // ── 4a. la división dos veces sobre el mismo padre ──
  console.log('\n── 4. atomicidad e idempotencia (dividirAgenda real contra el emulador)');
  const padreRef = comps.doc(hash);
  const r4a = await dividirAgenda(db, padreRef, (await padreRef.get()).data()!, { filas: fx.filas, invalidas: fx.invalidas, descartadas: fx.descartadas, primera: fx.primera }, normalizar);
  hijos = await hijosDe(hash);
  chequear(r4a.nuevos === 0 && r4a.hijos.length === 4 && r4a.hijos.every(h => !h.nuevo) && hijos.length === 4,
    `(a) segunda división del mismo padre: ${r4a.nuevos} nuevos, ${r4a.hijos.length} hijos todos nuevo=false, siguen ${hijos.length} docs`);

  // ── 4b. una excepción antes del commit ──
  const padreB = comps.doc('f9183-prueba-b');
  await padreB.set({ estado: 'prueba', contentType: 'image/png', refStoragePdf: ruta, subidoPor: 'Juan', subidoEn: Timestamp.fromDate(SUBIDA_TS) });
  const filasB = [
    { emisor: 'Prueba B', numeroCliente: '999000111', monto: 1000, moneda: 'ARS', vencimiento: '2026-11-10', vencimientoTexto: 'Vence el 10/11' },
    { emisor: 'Prueba B', numeroCliente: '999000222', monto: 2000, moneda: 'ARS', vencimiento: '2026-11-11', vencimientoTexto: 'Vence el 11/11' },
  ];
  let tiro = false;
  try {
    await dividirAgenda(db, padreB, (await padreB.get()).data()!, { filas: filasB as never, invalidas: [], descartadas: [], primera: {} }, normalizar,
      { antesDelCommit: () => { throw new Error('falla inyectada antes del commit'); } });
  } catch { tiro = true; }
  const hijosB = await hijosDe(padreB.id);
  chequear(tiro && hijosB.length === 0 && (await padreB.get()).data()!.estado === 'prueba',
    `(b) excepción antes del commit: tiró=${tiro}, ${hijosB.length} hijos creados, el padre sigue sin tocar (en el flujo real, el catch lo deja en 'error')`);

  // ── 4c. dos capturas que se pisan ──
  const padreC = comps.doc('f9183-prueba-c');
  await padreC.set({ estado: 'prueba', contentType: 'image/png', refStoragePdf: ruta, subidoPor: 'Juan', subidoEn: Timestamp.fromDate(SUBIDA_TS) });
  const compartidas = (fx.filas as Array<{ monto: number; vencimiento: string }>).filter(f => [76228.21, 92479.04, 89605.43].some(m => Math.abs(f.monto - m) < 0.005));
  const filasC = [
    ...compartidas,
    { emisor: 'Edenor', numeroCliente: '007497140070', monto: 121345.67, moneda: 'ARS', vencimiento: '2026-11-07', vencimientoTexto: 'Vence el 07/11' },
    { emisor: 'AGIP Inmobiliario/ABL', numeroCliente: '0070031265481', monto: 99000, moneda: 'ARS', vencimiento: '2026-11-30', vencimientoTexto: 'Vence el 30/11' },
  ];
  const rC = await dividirAgenda(db, padreC, (await padreC.get()).data()!, { filas: filasC as never, invalidas: [], descartadas: [], primera: {} }, normalizar);
  const ligadas = rC.filas.filter(f => f.resultado === 'yaCargada' && hijos.some(h => h.id === f.yaCargada.comprobanteId)).length;
  chequear(rC.nuevos === 2 && ligadas === 3, `(c) segunda captura con 3 filas en común: ${rC.nuevos} hijos nuevos (esperado 2), ${ligadas} ya cargadas como hijos de la primera (esperado 3)`);

  // ── §3.2/§3.3 — "Procesar de nuevo" dos veces: no duplica ──
  console.log('\n── §3.2 "Procesar de nuevo" dos veces sobre el mismo hijo');
  const tok = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: 'f9183-prueba', returnSecureToken: true }),
  }).then(r => r.json()) as { idToken: string };
  const callable = async (nombre: string, data: unknown) => fetch(`${FN}/${nombre}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok.idToken}` },
    body: JSON.stringify({ data }),
  }).then(r => r.json()) as Promise<{ result?: unknown; error?: { message: string } }>;
  const unHijo = hijos[0];
  const movsAntes = (await db.collection('movimientos').count().get()).data().count;
  const c1 = await callable('reprocesarHijoAgenda', { id: unHijo.id });
  const c2 = await callable('reprocesarHijoAgenda', { id: unHijo.id });
  const movsDespues = (await db.collection('movimientos').count().get()).data().count;
  const pmDespues = (await comps.doc(unHijo.id).get()).data()!.propuestaMatch;
  chequear(!c1.error && !c2.error && movsAntes === movsDespues && !!pmDespues,
    `dos llamadas: ${c1.error ? c1.error.message : 'ok'} / ${c2.error ? c2.error.message : 'ok'} · movimientos ${movsAntes} → ${movsDespues} · propuesta rama ${s(pmDespues?.rama)}`);
  const cPadre = await callable('reprocesarHijoAgenda', { id: hash });
  chequear(!!cPadre.error, `sobre el padre lo rechaza: ${cPadre.error?.message ?? '(no rechazó)'}`);

  // ── descartar un hijo no borra la imagen compartida ──
  console.log('\n── descartar un hijo con la imagen compartida');
  const dHijo = await callable('descartarEntrada', { tipo: 'comprobante', id: hijos[1].id });
  const [existe] = await getStorage().bucket().file(ruta).exists();
  chequear(!dHijo.error && !(await comps.doc(hijos[1].id).get()).exists && existe,
    `descartarEntrada(hijo ${h8(hijos[1].id)}): ${dHijo.error ? dHijo.error.message : 'ok'} · doc borrado · la imagen ${existe ? 'SIGUE' : 'SE BORRÓ'} en Storage`);

  console.log(`\nPARTE 2: ${fallas === 0 ? 'TODO OK' : `${fallas} FALLA(S)`}`);
}

(MODO === 'api' ? parteApi() : parteEmulador())
  .then(() => process.exit(fallas === 0 ? 0 : 1))
  .catch(e => { console.error(e); process.exit(1); });
