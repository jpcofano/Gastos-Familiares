// Lee texto de un PDF via decompresión manual de streams FlateDecode
import * as fs from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';
import * as os from 'os';

const pdfPath = path.join(os.tmpdir(), 'audit_error_a677fa90.pdf');

function extractPdfText(buf: Buffer): string {
  const text = buf.toString('latin1');
  const results: string[] = [];

  // 1. Buscar streams FlateDecode y descomprimir
  const streamRe = /stream\r?\n([\s\S]+?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  let streamIdx = 0;

  while ((match = streamRe.exec(text)) !== null) {
    streamIdx++;
    const rawStream = Buffer.from(match[1], 'latin1');

    // Ver si el objeto que precede al stream tiene FlateDecode
    const preceding = text.slice(Math.max(0, match.index - 200), match.index);
    if (!preceding.includes('FlateDecode')) continue;

    try {
      const decompressed = zlib.inflateSync(rawStream).toString('latin1');
      // Extraer texto legible de BT...ET (texto PDF)
      const btRe = /BT\s*([\s\S]*?)\s*ET/g;
      let btMatch: RegExpExecArray | null;
      while ((btMatch = btRe.exec(decompressed)) !== null) {
        // Extraer strings entre paréntesis (Tj, TJ operators)
        const strRe = /\(([^)]+)\)/g;
        let strMatch: RegExpExecArray | null;
        while ((strMatch = strRe.exec(btMatch[1])) !== null) {
          const s = strMatch[1].replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
          if (s.trim().length > 1) results.push(s);
        }
      }
    } catch (_) {
      // not FlateDecode or other issue
    }
  }

  return results.join(' ');
}

async function main() {
  if (!fs.existsSync(pdfPath)) {
    console.log('PDF no encontrado:', pdfPath);
    process.exit(1);
  }
  const buf = fs.readFileSync(pdfPath);
  console.log(`PDF size: ${(buf.length / 1024).toFixed(1)} KB`);

  const txt = extractPdfText(buf);
  if (txt.length < 10) {
    console.log('No se pudo extraer texto legible del PDF.');
    // Intentar encontrar strings ASCII directos (sin compresión)
    const raw = buf.toString('latin1');
    const strings = raw.match(/[\x20-\x7E]{8,}/g) ?? [];
    // Filtrar strings que parecen texto real
    const interesting = strings.filter(s =>
      /[a-zA-Z]{3,}/.test(s) &&
      !s.startsWith('<<') &&
      !s.includes('>>') &&
      !s.includes('/Filter') &&
      !s.includes('/Length')
    );
    console.log('Strings ASCII interesantes encontradas:');
    interesting.slice(0, 80).forEach(s => console.log(' ', s));
  } else {
    console.log('Texto extraído:');
    console.log(txt.slice(0, 5000));
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
