// F9.178 — prueba el lector real (src/datos/shareTargetIdb.ts) contra lo que escribe el SW,
// incluido el formato del SW viejo. Necesita `npx vite --port 5179` corriendo. Ver docs/F9.178-share.txt §5.
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
const dir = fs.mkdtempSync(path.join(process.cwd(), 'prof-'));
const ctx = await chromium.launchPersistentContext(dir, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await ctx.newPage();
await page.goto('http://localhost:5179/?x');
await page.evaluate(() => navigator.serviceWorker.ready); await page.reload();
await page.evaluate(() => { const f = document.createElement('form'); f.method='post'; f.enctype='multipart/form-data'; f.action='/share-target'; f.id='sf'; const i=document.createElement('input'); i.type='file'; i.name='files'; i.multiple=true; f.appendChild(i); document.body.appendChild(f); });
await page.setInputFiles('#sf input', ['prueba.pdf', 'prueba.png']);
await Promise.all([page.waitForURL(u => u.search.includes('share'), { waitUntil: 'load' }), page.evaluate(() => document.getElementById('sf').submit())]);
console.log('URL:', page.url());
const r = await page.evaluate(async () => {
  const m = await import('/src/datos/shareTargetIdb.ts');
  const a = await m.leerYBorrarArchivosCompartidos();
  const b = await m.leerYBorrarArchivosCompartidos();   // segunda lectura: ya vacío
  // formato del SW viejo: un File suelto bajo 'archivo'
  await new Promise(res => { const o = indexedDB.open('gastos-share', 1); o.onsuccess = () => { const tx = o.result.transaction('pendiente','readwrite'); tx.objectStore('pendiente').put(new File(['x'], 'viejo.pdf', { type: 'application/pdf' }), 'archivo'); tx.oncomplete = res; }; });
  const c = await m.leerYBorrarArchivosCompartidos();
  const f = x => ({ archivos: x.archivos.map(z => `${z.name}|${z.type}|${z.size}|File=${z instanceof File}`), diag: x.diag && x.diag.etapa + '/' + x.diag.recibidos });
  return { primera: f(a), segunda: f(b), legacy: f(c) };
});
console.log(JSON.stringify(r, null, 1));
await ctx.close(); fs.rmSync(dir, { recursive: true, force: true });
