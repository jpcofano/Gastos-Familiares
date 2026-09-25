// Simula el Web Share Target: POST multipart de navegación a /share-target desde una página
// controlada por el SW. Uso (ver docs/F9.178-share.txt §5): node simularShare.mjs <archivo> [<archivo> ...]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const files = process.argv.slice(2).map(f => path.resolve(f));
const userDir = fs.mkdtempSync(path.join(process.cwd(), 'prof-'));

const ctx = await chromium.launchPersistentContext(userDir, {
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const page = await ctx.newPage();
page.on('response', r => { if (r.status() >= 400) console.log('[resp]', r.status(), r.url()); });
page.on('console', m => console.log(`[page:${m.type()}] ${m.text()}`));
ctx.on('serviceworker', sw => console.log('[ctx] SW registrado:', sw.url()));

await page.goto(BASE + '/?inicio');
await page.evaluate(() => navigator.serviceWorker.ready);
if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
console.log('[t] controlado por SW:', await page.evaluate(() => !!navigator.serviceWorker.controller));

// Formulario idéntico a lo que genera Chrome para el share_target del manifest.
await page.evaluate(() => {
  const f = document.createElement('form');
  f.method = 'post'; f.enctype = 'multipart/form-data'; f.action = '/share-target'; f.id = 'sf';
  const i = document.createElement('input'); i.type = 'file'; i.name = 'files'; i.multiple = true;
  f.appendChild(i); document.body.appendChild(f);
});
await page.setInputFiles('#sf input', files);

const reqsServidor = [];
page.on('request', r => { if (r.url().includes('share-target')) reqsServidor.push(`${r.method()} ${r.url()} sw=${!!r.serviceWorker()}`); });
await Promise.all([page.waitForURL(u => !u.search.includes('inicio') && !u.pathname.startsWith('/share-target'), { waitUntil: 'load' }), page.evaluate(() => document.getElementById('sf').submit())]);
console.log('[t] URL tras el redirect:', page.url());

// Estado de IDB apenas aterriza (sin sesión, Comprobantes no se monta y nadie lo lee).
const idb = async () => page.evaluate(() => new Promise(res => {
  const r = indexedDB.open('gastos-share');
  r.onsuccess = () => {
    const db = r.result;
    const stores = [...db.objectStoreNames];
    if (!stores.length) return res({ stores });
    const tx = db.transaction(stores, 'readonly');
    const out = { stores };
    let pend = stores.length;
    for (const s of stores) {
      const st = tx.objectStore(s); const keys = st.getAllKeys(); const vals = st.getAll();
      vals.onsuccess = () => {
        out[s] = keys.result.map((k, i) => {
          const v = vals.result[i];
          if (v instanceof Blob) return { k, blob: true, name: v.name, type: v.type, size: v.size };
          if (Array.isArray(v)) return { k, arr: v.map(x => x instanceof Blob ? { name: x.name, type: x.type, size: x.size } : x) };
          return { k, v };
        });
        if (--pend === 0) res(out);
      };
    }
  };
  r.onerror = () => res({ err: String(r.error) });
}));
console.log('[t] IDB al aterrizar:', JSON.stringify(await idb()));
await page.waitForTimeout(Number(process.env.ESPERA ?? 4000));
console.log('[t] IDB a los', process.env.ESPERA ?? 4000, 'ms:', JSON.stringify(await idb()));
console.log('[t] texto visible:', (await page.locator('body').innerText()).slice(0, 300).replace(/\s+/g, ' '));
console.log('[t] requests share-target vistos por la página:', reqsServidor);
await ctx.close();
fs.rmSync(userDir, { recursive: true, force: true });
