// F9.187 §0 — reproducir "la app se queda con datos viejos hasta refrescar". NO usa producción.
//
//   firebase emulators:exec --only firestore,auth --project demo-f9187 \
//     "npx tsx scripts/reproducirF9187.ts [--rapido] [--solo A,A2,B,C] [--etiqueta texto]"
//
// Chrome del sistema (variable CHROME para otra ruta) en --headless=new, manejado por CDP crudo
// (WebSocket de Node). NO Playwright: Playwright fuerza la visibilidad de sus páginas y con él una
// pestaña nunca queda 'hidden' ni se congela (medido en F9.187 §0). La página es
// scripts/f9187/harness.ts, empaquetada con esbuild con el src/firebase.ts REAL apuntando al emulador.
//
// Segundo plano = otra pestaña al frente (la nuestra pasa a 'hidden'). Congelar = además CDP
// Page.setWebLifecycleState 'frozen' (el JS deja de correr; se disparan 'freeze'/'resume'). Es lo que
// hace Android con una PWA en segundo plano. Descongelar = 'active' + nuestra pestaña al frente.
//
// Escenarios (un listener sobre resumenesTarjeta/f9187-prueba; el doc cambia por Admin SDK durante la
// condición):
//   A  una pestaña en segundo plano y congelada 3 min; cambia el doc; vuelve. ¿Llega solo? ¿cuánto tarda?
//   A2 como A, pero además SIN RED mientras está congelada (Android corta los sockets de una app en
//      segundo plano). No lo pide el prompt: es la variante más cercana al teléfono.
//   B  dos pestañas de la app, la 1 (primaria) en segundo plano y congelada, la 2 al frente; cambia el
//      doc. ¿La 2 lo recibe?
//   C  como B, y a los 3 min se descongela la 1. ¿La 2 se pone al día?
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const RAPIDO = process.argv.includes('--rapido');            // 30 s en vez de 3 min (para iterar)
const CONGELADO_MS = RAPIDO ? 30_000 : 180_000;
const ESPERA_MS = 90_000;                                     // cuánto se espera un cambio antes de darlo por perdido
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const SOLO = (arg('--solo') ?? 'A,A2,B,C').split(',');
const ETIQUETA = arg('--etiqueta') ?? '';
const PROYECTO = 'demo-f9187';
const DOC = 'f9187-prueba';
const EMAIL = 'f9187@test.local';
const PUERTO = 5199;
const PUERTO_CDP = 9334;
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.log('>>> corre DENTRO de firebase emulators:exec'); process.exit(1); }
const req = createRequire(process.cwd() + '/package.json');
const { initializeApp } = req('firebase-admin/app') as typeof import('firebase-admin/app');
const { getFirestore } = req('firebase-admin/firestore') as typeof import('firebase-admin/firestore');
const { getAuth } = req('firebase-admin/auth') as typeof import('firebase-admin/auth');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const ref = db.collection('resumenesTarjeta').doc(DOC);
const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── la página ────────────────────────────────────────────────────────────────────────────────────
async function construir(dir: string) {
  const esbuild = req('esbuild') as typeof import('esbuild');
  await esbuild.build({
    entryPoints: ['scripts/f9187/harness.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2020',
    outfile: path.join(dir, 'harness.js'), logLevel: 'error',
    define: { 'import.meta.env': JSON.stringify({ DEV: true, VITE_FIREBASE_PROJECT_ID: PROYECTO, VITE_FIREBASE_API_KEY: 'demo-key' }) },
  });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>F9.187</title><script type="module" src="/harness.js"></script>');
  return http.createServer((rq, rs) => {
    const ruta = (rq.url ?? '/').split('?')[0];
    const f = path.join(dir, ruta === '/' || ruta === '/otra' ? 'index.html' : ruta.slice(1));
    if (ruta === '/otra') { rs.writeHead(200, { 'Content-Type': 'text/html' }); rs.end('<!doctype html><title>otra</title>otra app'); return; }
    if (!fs.existsSync(f)) { rs.writeHead(404); rs.end(); return; }
    rs.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
    rs.end(fs.readFileSync(f));
  }).listen(PUERTO);
}

// ── CDP crudo ────────────────────────────────────────────────────────────────────────────────────
type Tab = { id: string; send: (m: string, p?: Record<string, unknown>) => Promise<{ result?: Record<string, unknown>; error?: { message: string } }>; close: () => void };
async function abrirTab(url: string): Promise<Tab> {
  const t = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/new?${url}`, { method: 'PUT' })).json() as { id: string; webSocketDebuggerUrl: string };
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let n = 0; const pend = new Map<number, (d: unknown) => void>();
  ws.addEventListener('message', m => { const d = JSON.parse(String(m.data)); if (d.id && pend.has(d.id)) { pend.get(d.id)!(d); pend.delete(d.id); } });
  return {
    id: t.id,
    send: (method, params = {}) => new Promise(r => { const i = ++n; pend.set(i, r as (d: unknown) => void); ws.send(JSON.stringify({ id: i, method, params })); }),
    close: () => ws.close(),
  };
}
const alFrente = async (t: Tab) => { await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/activate/${t.id}`)).text(); };
const cerrarTab = async (t: Tab) => { t.close(); await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/close/${t.id}`)).text(); };
/** Evalúa en la pestaña; si está congelada no responde, y eso se informa en vez de colgarse. */
async function evaluar<T>(t: Tab, expr: string): Promise<T | '(congelada)'> {
  const r = await Promise.race([t.send('Runtime.evaluate', { expression: expr, returnByValue: true }), esperar(2000).then(() => null)]);
  return r ? ((r.result as { result?: { value?: T } })?.result?.value as T) : '(congelada)';
}
async function abrirApp(): Promise<Tab> {
  const t = await abrirTab(`http://localhost:${PUERTO}/?doc=${DOC}`);
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    const st = await evaluar<string>(t, 'window.__error ? "ERR " + window.__error : (window.__listo ? "listo" : "")');
    if (st === 'listo') return t;
    if (typeof st === 'string' && st.startsWith('ERR')) throw new Error(`la página no arrancó: ${st}`);
    await esperar(300);
  }
  throw new Error('la página no arrancó en 30 s');
}
async function congelar(t: Tab, otra: Tab, sinRed = false) {
  await alFrente(otra);                                       // la nuestra pasa a segundo plano ('hidden')
  await esperar(1000);
  if (sinRed) { await t.send('Network.enable'); await t.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); }
  await t.send('Page.setWebLifecycleState', { state: 'frozen' });
}
async function descongelar(t: Tab, sinRed = false, traerAlFrente = true) {
  await t.send('Page.setWebLifecycleState', { state: 'active' });
  if (sinRed) await t.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  if (traerAlFrente) await alFrente(t);
}
type Ev = { n: unknown; t: number; deCache: boolean };
/** Espera en la pestaña el valor n (del servidor); devuelve ms desde `desde`, o null si no llegó. */
async function recibe(t: Tab, n: number, desde: number, espera = ESPERA_MS): Promise<number | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < espera) {
    const evs = await evaluar<Ev[]>(t, 'window.__ev');
    if (Array.isArray(evs)) { const e = evs.find(x => x.n === n && !x.deCache); if (e) return e.t - desde; }
    await esperar(500);
  }
  return null;
}
const logsF9187 = async (t: Tab) => { const l = await evaluar<string[]>(t, 'window.__log'); return Array.isArray(l) ? l : []; };

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f9187-'));
  const srv = await construir(dir);
  await getAuth().createUser({ email: EMAIL, password: 'f9187-prueba', emailVerified: true }).catch(() => undefined);
  await db.collection('autorizados').doc(EMAIL).set({ rol: 'admin', memberId: 'Juan' });
  let n = 0;
  await ref.set({ estado: 'subido', n });

  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'f9187c-'));
  const chrome = spawn(CHROME, [`--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${perfil}`, '--no-first-run',
    '--no-default-browser-check', '--headless=new', 'about:blank'], { stdio: 'ignore' });
  await esperar(2500);
  const ver = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/version`)).json() as { Browser: string };
  console.log(`F9.187 §0${ETIQUETA ? ` — ${ETIQUETA}` : ''} · emulador ${PROYECTO} · ${ver.Browser} (headless=new, CDP) · congelado ${CONGELADO_MS / 1000} s${RAPIDO ? ' (--rapido)' : ''}\n`);
  const resultados: string[] = [];

  try {
    for (const esc of ['A', 'A2']) {
      if (!SOLO.includes(esc)) continue;
      const sinRed = esc === 'A2';
      const p = await abrirApp();
      const otra = await abrirTab(`http://localhost:${PUERTO}/otra`);
      await congelar(p, otra, sinRed);
      console.log(`(${esc}) una pestaña: en segundo plano y congelada${sinRed ? ', sin red' : ''} · responde: ${await evaluar(p, '1')}`);
      await esperar(10_000);
      await ref.update({ n: ++n });
      const cambio = Date.now();
      await esperar(CONGELADO_MS - 10_000);
      await descongelar(p, sinRed);
      const tD = Date.now();
      const ms = await recibe(p, n, tD);
      const r = ms == null ? `NO LLEGÓ en ${ESPERA_MS / 1000} s después de volver → REPRODUCE` : `llegó ${(ms / 1000).toFixed(1)} s después de volver (el cambio se hizo ${((tD - cambio) / 1000).toFixed(0)} s antes)`;
      const logs = await logsF9187(p);
      console.log(`(${esc}) ${r} · visibilidad ${await evaluar(p, 'document.visibilityState')} · logs F9.187: ${logs.length ? logs.join(' | ') : '(ninguno)'}`);
      resultados.push(`(${esc}) ${r}`);
      await cerrarTab(otra); await cerrarTab(p); await esperar(1500);
    }

    if (SOLO.includes('B') || SOLO.includes('C')) {
      const p1 = await abrirApp();
      await esperar(3000);
      const p2 = await abrirApp();
      await esperar(3000);
      await congelar(p1, p2);                                 // la 2 al frente, la 1 oculta y congelada
      console.log(`(B) dos pestañas de la app; la 1 (abierta primero, primaria) en segundo plano y congelada, la 2 al frente (${await evaluar(p2, 'document.visibilityState')})`);
      await esperar(5000);
      await ref.update({ n: ++n });
      const cambio = Date.now();
      const msB = await recibe(p2, n, cambio);
      const rB = msB == null ? `la 2 NO recibió el cambio en ${ESPERA_MS / 1000} s → REPRODUCE` : `la 2 lo recibió en ${(msB / 1000).toFixed(1)} s`;
      console.log(`(B) ${rB} · logs F9.187 de la 2: ${(await logsF9187(p2)).join(' | ') || '(ninguno)'}`);
      resultados.push(`(B) ${rB}`);
      if (SOLO.includes('C')) {
        await esperar(Math.max(0, CONGELADO_MS - (Date.now() - cambio)));
        await descongelar(p1, false, false);                  // se descongela la 1, sigue la 2 al frente
        const tD = Date.now();
        const ms2 = msB == null ? await recibe(p2, n, tD) : 0;
        const ms1 = await recibe(p1, n, tD);
        const rC = `${msB == null ? (ms2 == null ? `la 2 SIGUE sin el cambio ${ESPERA_MS / 1000} s después de descongelar la 1 → REPRODUCE` : `la 2 se puso al día ${(ms2! / 1000).toFixed(1)} s después de descongelar la 1`) : 'la 2 ya lo tenía (B)'} · la 1 ${ms1 == null ? 'NO lo recibió' : `lo recibió ${(ms1 / 1000).toFixed(1)} s después`}`;
        console.log(`(C) ${rC}`);
        resultados.push(`(C) ${rC}`);
      }
      await cerrarTab(p2); await cerrarTab(p1);
    }
  } finally {
    console.log(`\nRESUMEN${ETIQUETA ? ` — ${ETIQUETA}` : ''}\n${resultados.map(r => `  ${r}`).join('\n')}`);
    chrome.kill();
    srv.close();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
