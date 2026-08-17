// Barrido v2: awaits/then de Firestore NO cubiertos por un try, dentro de una funcion
// que antes prendio un flag de carga. La v1 fallaba justo con el bug real: onFile tiene
// un try (para JSON.parse) pero el await critico esta afuera.
import fs from 'node:fs';
import path from 'node:path';

const PRENDE = /set(Cargando|Guardando|Validando|Enviando|Subiendo|Procesando|Loading|Busy)\w*\(true\)|setTcCargando\(true\)|setStep\('(validating|saving)'\)|setCargandoEstado\(true\)/i;

function archivos(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...archivos(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Para cada linea: cuantos `try {` abiertos la contienen.
function profundidadTry(lineas) {
  const res = [];
  let depth = 0;
  const pilaTry = [];
  for (const l of lineas) {
    const antes = pilaTry.length;
    for (let i = 0; i < l.length; i++) {
      if (l[i] === '{') {
        // ¿este `{` abre un try?
        const prefijo = l.slice(0, i);
        depth++;
        if (/\btry\s*$/.test(prefijo)) pilaTry.push(depth);
      } else if (l[i] === '}') {
        if (pilaTry.length && pilaTry[pilaTry.length - 1] === depth) pilaTry.pop();
        depth--;
      }
    }
    res.push(Math.max(antes, pilaTry.length));
  }
  return res;
}

// Limites de funcion aproximados: linea que abre funcion -> cierre por indentacion.
function funciones(lineas) {
  const res = [];
  for (let i = 0; i < lineas.length; i++) {
    if (!/(async\s+function\s|function\s+\w+\s*\(|=>\s*\{|async\s*\([^)]*\)\s*=>)/.test(lineas[i])) continue;
    const indent = lineas[i].search(/\S/);
    let j = i + 1;
    while (j < lineas.length) {
      const l = lineas[j];
      if (l.trim() !== '' && l.search(/\S/) <= indent && /^\s*[})]/.test(l)) break;
      j++;
    }
    if (j - i > 200) continue;
    res.push({ desde: i, hasta: Math.min(j, lineas.length - 1) });
  }
  return res;
}

let total = 0;
const hallazgos = [];
for (const f of archivos('src')) {
  const lineas = fs.readFileSync(f, 'utf8').split('\n');
  if (!PRENDE.test(lineas.join('\n'))) continue;
  const tryDepth = profundidadTry(lineas);

  for (const fn of funciones(lineas)) {
    const cuerpo = lineas.slice(fn.desde, fn.hasta + 1);
    // ¿prende un flag de carga?
    const idxPrende = cuerpo.findIndex(l => PRENDE.test(l));
    if (idxPrende < 0) continue;

    for (let k = idxPrende; k < cuerpo.length; k++) {
      const abs = fn.desde + k;
      const l = cuerpo[k];
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) continue; // comentario, no codigo
      if (!/\bawait\b|\.then\(/.test(l)) continue;
      if (tryDepth[abs] > 0) continue;            // cubierto por un try
      if (/\.then\(/.test(l)) {
        // ¿hay .catch o .finally en el resto de la cadena (hasta el fin de la funcion)?
        const cola = cuerpo.slice(k).join('\n');
        if (/\.catch\(|\.finally\(/.test(cola)) continue;
      }
      hallazgos.push({ f, linea: abs + 1, texto: l.trim(), fn: `${fn.desde + 1}-${fn.hasta + 1}` });
      total++;
      break; // uno por funcion alcanza para señalarla
    }
  }
}

const vistos = new Set();
for (const h of hallazgos) {
  const k = `${h.f}:${h.linea}`;
  if (vistos.has(k)) continue;
  vistos.add(k);
  console.log(`${h.f}:${h.linea}  (fn ${h.fn})\n    ${h.texto}`);
}
console.log(`\nHALLAZGOS UNICOS: ${vistos.size}`);
