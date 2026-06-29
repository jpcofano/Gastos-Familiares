// F9.49 — genera los PNG de icons/ a partir de los SVG fuente. No hay
// herramienta de rasterizado de imágenes en este entorno (sin ImageMagick/
// sharp preinstalados) — correr este script una vez, localmente:
//
//   npm install -D sharp
//   node scripts/gen-pwa-icons.mjs
//
// No es parte del build ni del seed — uso único (o cada vez que cambie el
// ícono fuente). No requiere red ni toca Firestore.
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const DIR = resolve(import.meta.dirname, '..', 'public', 'icons');

const TARGETS = [
  { src: 'icon.svg',          out: 'icon-192.png',           size: 192 },
  { src: 'icon.svg',          out: 'icon-512.png',           size: 512 },
  { src: 'icon-maskable.svg', out: 'icon-maskable-512.png',  size: 512 },
  { src: 'icon-square.svg',   out: 'apple-touch-icon.png',   size: 180 },
];

for (const t of TARGETS) {
  const svg = readFileSync(resolve(DIR, t.src));
  await sharp(svg, { density: 384 })
    .resize(t.size, t.size)
    .png()
    .toFile(resolve(DIR, t.out));
  console.log(`OK ${t.out} (${t.size}x${t.size}) <- ${t.src}`);
}
