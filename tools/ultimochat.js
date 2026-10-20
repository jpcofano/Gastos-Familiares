#!/usr/bin/env node
/**
 * `tools/ultimochat.js` — escribe en `docs/ultimochat.md` el texto que Code le devolvió al
 * usuario al terminar el turno. Lo invoca el hook `Stop` de Claude Code, nunca una persona.
 *
 * ### Por qué un hook y no una regla escrita
 *
 * claude.ai ya no lee el repo por GitHub: lee la carpeta local. Sin esto, el reporte de Code sólo
 * existe en el chat y el usuario lo tiene que copiar y pegar. Una regla de «acordate de escribir
 * el archivo» es una convención y se saltea el primer día apurado — `CLAUDE.md` §4: **la guarda va
 * en el escritor, no en quien se acuerda**. El hook `Stop` corre siempre, lea o no lea `CLAUDE.md`
 * la sesión.
 *
 * ### De dónde sale el texto — dos caminos, y el orden importa
 *
 * ⭐ **Primario: `last_assistant_message` del payload del hook.** Medido sobre el binario de Claude
 * Code 2.1.278 (`Addendum_2026-09-23_2`, Parte A) y confirmado con una corrida real: el campo llega
 * y su propia descripción dice para qué está — *«Avoids the need to read and parse the transcript
 * file»*. La plataforma arma ese texto uniendo los bloques del mensaje con `"\n"` y haciendo
 * `trim()`.
 *
 * ⚠ **Fallback: `transcript_path`.** El campo es `.optional()` en el esquema, así que puede no
 * venir. El fallback reproduce **la misma regla** que la plataforma, a propósito: si los dos
 * caminos no coinciden, el archivo estaría diciendo dos cosas distintas según el día.
 *
 * ⭐ **Que existan los dos es además el segundo lector de `CLAUDE.md` §4**: son dos mecanismos
 * —uno recibe el texto ya armado, el otro lo reconstruye del disco—, no dos implementaciones de lo
 * mismo.
 *
 * ### Lo que este archivo NO es
 *
 * ⛔ **No es fuente de nada.** Es el eco del último reporte: si discrepa con `docs/BITACORA.md`,
 * gana la bitácora; si discrepa con el estado del repo, gana el repo. Y sólo tiene los turnos de la
 * sesión principal — `SubagentStop` es otro evento, así que lo que diga un subagente no llega acá.
 *
 * ### Nunca rompe el turno
 *
 * ⛔ Sale **0 pase lo que pase**, y ante cualquier error escribe el motivo en el mismo archivo. Un
 * archivo con el error es un dato; **un archivo viejo que parece nuevo es el número plausible**, y
 * por eso el encabezado lleva la fecha, el `HEAD` y **por qué camino salió el texto**.
 *
 * Lo corre el hook. A mano no hace nada útil: sin payload por stdin escribe el aviso de error.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.join(RAIZ, 'docs', 'ultimochat.md');
const DIR_HISTORIA = path.join(RAIZ, '.ultimochat');

/* ── Las dos piezas que el banco prueba por separado ───────────────────────────────────────── */

/**
 * El texto del último mensaje del asistente, leído del transcript.
 *
 * ⚠ **No toda línea del `.jsonl` es un mensaje.** Medido: conviven doce clases —`ai-title`,
 * `attachment`, `queue-operation`, `file-history-snapshot`, `cost-state`, `mode`, `system`,
 * `teleported-from`…— y **ninguna trae `message`**. Un lector que lo asuma se rompe.
 *
 * Devuelve `null` cuando no hay ningún mensaje utilizable, que **no es lo mismo que uno vacío**.
 */
function textoDelTranscript(contenido) {
  const lineas = String(contenido).split('\n');
  let ultimo = null;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();
    if (!linea) continue;

    let o;
    try {
      o = JSON.parse(linea);
    } catch (e) {
      continue; // una línea a medio escribir no invalida el archivo entero
    }

    if (!o || o.type !== 'assistant' || !o.message) continue;
    /* Un subagente escribe en el mismo archivo con `isSidechain: true`. El hook `Stop` no corre
     * por subagente, pero el transcript sí los tiene: tomar uno sería publicar como reporte de
     * Code algo que el usuario nunca vio. */
    if (o.isSidechain === true) continue;
    if (!Array.isArray(o.message.content)) continue;

    const texto = o.message.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (texto) ultimo = texto; // la última que tenga texto gana
  }

  return ultimo;
}

/** Obtiene la sesión corta (8 caracteres) del payload o del transcript_path. */
function sesionCortaDe(payload) {
  if (!payload || typeof payload !== 'object') return 'sin-sesion';
  if (typeof payload.session_id === 'string' && payload.session_id.trim()) {
    return payload.session_id.trim().slice(0, 8);
  }
  if (typeof payload.transcript_path === 'string' && payload.transcript_path.trim()) {
    const base = path.basename(payload.transcript_path.trim(), '.jsonl');
    if (base) return base.slice(0, 8);
  }
  return 'sin-sesion';
}

/** Extrae la sesión corta de un contenido de ultimochat si ya la tiene en su cabecera. */
function extraerSesionDeContenido(contenido) {
  if (!contenido || typeof contenido !== 'string') return null;
  const m = /<!-- ultimochat .*? · sesión ([A-Za-z0-9_-]+)/.exec(contenido);
  return m ? m[1] : null;
}

/** Formatea una fecha como AAAAMMDD-HHMMSS. */
function formatearSelloArchivo(fecha) {
  const d = (n) => String(n).padStart(2, '0');
  const f = (fecha instanceof Date && !isNaN(fecha.getTime())) ? fecha : new Date();
  return String(f.getFullYear()) +
    d(f.getMonth() + 1) +
    d(f.getDate()) +
    '-' +
    d(f.getHours()) +
    d(f.getMinutes()) +
    d(f.getSeconds());
}

/** El encabezado. Lleva **por qué camino salió** el texto, no sólo cuándo, y la sesión corta. */
function encabezado(fuente, ahora, head, sesionCorta) {
  const dosDigitos = (n) => String(n).padStart(2, '0');
  const sello = ahora.getFullYear() + '-' + dosDigitos(ahora.getMonth() + 1) + '-' + dosDigitos(ahora.getDate()) +
    ' ' + dosDigitos(ahora.getHours()) + ':' + dosDigitos(ahora.getMinutes());
  const ses = sesionCorta ? ' · sesión ' + sesionCorta : '';
  return '<!-- ultimochat · hook Stop · ' + sello + ses + ' · HEAD ' + head + ' · fuente: ' + fuente + ' · no editar -->';
}

/** El `HEAD` corto. Si git no contesta, se dice — no se inventa ni se omite. */
function headCorto() {
  try {
    return cp.execSync('git rev-parse --short HEAD', { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || '(sin head)';
  } catch (e) {
    return '(sin head)';
  }
}

/**
 * Decide el texto y de dónde salió. Devuelve `{ fuente, texto, aviso }`.
 * `fuente` es `payload`, `transcript` o `ninguna`.
 */
function resolver(payload, leerArchivo) {
  if (!payload || typeof payload !== 'object') {
    return { fuente: 'ninguna', texto: null, aviso: 'el hook no entregó un JSON legible por stdin' };
  }

  const lam = payload.last_assistant_message;
  if (typeof lam === 'string' && lam.trim()) {
    return { fuente: 'payload', texto: lam.trim(), aviso: null };
  }

  const ruta = payload.transcript_path;
  if (!ruta) {
    return { fuente: 'ninguna', texto: null, aviso: 'el payload no trajo `last_assistant_message` ni `transcript_path`' };
  }

  let contenido;
  try {
    contenido = leerArchivo(ruta);
  } catch (e) {
    return { fuente: 'ninguna', texto: null, aviso: 'no se pudo leer el transcript `' + ruta + '`: ' + e.message };
  }

  const texto = textoDelTranscript(contenido);
  if (!texto) {
    return { fuente: 'ninguna', texto: null, aviso: 'el transcript `' + ruta + '` no tiene ningún mensaje del asistente con texto' };
  }
  return { fuente: 'transcript', texto: texto, aviso: null };
}

/** Arma el archivo entero. Separado de la escritura para que el banco lo pueda mirar. */
function componer(payload, leerArchivo, ahora, head, sesion) {
  const r = resolver(payload, leerArchivo);
  const cuerpo = r.texto !== null
    ? r.texto
    : '⚠ ultimochat no pudo leer el último mensaje: ' + r.aviso + '.';
  const ses = sesion !== undefined ? sesion : sesionCortaDe(payload);
  return encabezado(r.fuente, ahora, head, ses) + '\n\n' + cuerpo + '\n';
}

/**
 * Poda los archivos en la carpeta de historia dejando como máximo `maxArchivos` (por defecto 100).
 * Los archivos tienen nombre AAAAMMDD-HHMMSS_*, por lo que ordenados lexicográficamente
 * quedan ordenados de más antiguo a más reciente.
 */
function podarHistoria(dirHistoria, maxArchivos) {
  const limite = maxArchivos || 100;
  if (!fs.existsSync(dirHistoria)) return 0;
  let entradas;
  try {
    entradas = fs.readdirSync(dirHistoria).filter((f) => f.endsWith('.md')).sort();
  } catch (e) {
    return 0;
  }
  let borrados = 0;
  if (entradas.length > limite) {
    const aBorrar = entradas.slice(0, entradas.length - limite);
    for (let i = 0; i < aBorrar.length; i++) {
      try {
        fs.unlinkSync(path.join(dirHistoria, aBorrar[i]));
        borrados++;
      } catch (e) {
        // Ignorar fallo al borrar archivo individual
      }
    }
  }
  return borrados;
}

/**
 * Archiva el contenido actual de `docs/ultimochat.md` en la carpeta `.ultimochat/` antes
 * de sobreescribirlo, asegurando que dos sesiones o turnos sucesivos no se pisen (2026-10-08_13).
 * Conserva los últimos 100 archivos.
 *
 * ⛔ Todo corre dentro de un try/catch aislado: si falla copiar la historia, nunca
 * se bloquea la escritura del nuevo reporte ni se altera la salida 0 del hook.
 */
function archivarAnterior(rutaSalida, dirHistoria, payloadActual, fechaAhora) {
  const ruta = rutaSalida || SALIDA;
  const dir = dirHistoria || DIR_HISTORIA;
  if (!fs.existsSync(ruta)) return null;

  let contenido;
  let stat;
  try {
    contenido = fs.readFileSync(ruta, 'utf8');
    stat = fs.statSync(ruta);
  } catch (e) {
    return null;
  }

  if (!contenido || !contenido.trim()) return null;

  const sesion = extraerSesionDeContenido(contenido) || sesionCortaDe(payloadActual);
  const fecha = fechaAhora || ((stat && stat.mtime instanceof Date && !isNaN(stat.mtime.getTime())) ? stat.mtime : new Date());
  const sello = formatearSelloArchivo(fecha);
  const nombre = sello + '_' + sesion + '.md';

  try {
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, nombre);
    fs.writeFileSync(destino, contenido, 'utf8');
    podarHistoria(dir, 100);
    return destino;
  } catch (e) {
    return null;
  }
}

/* ── El camino que corre el hook ───────────────────────────────────────────────────────────── */

function principal() {
  let crudo = '';
  let terminado = false;

  const cerrar = () => {
    if (terminado) return;
    terminado = true;

    let payload = null;
    try {
      payload = JSON.parse(crudo);
    } catch (e) {
      payload = null;
    }

    /* 1. Archivar el archivo anterior en .ultimochat/ con try/catch aislado */
    try {
      archivarAnterior(SALIDA, DIR_HISTORIA, payload);
    } catch (eHistoria) {
      /* Un fallo al archivar nunca puede romper el turno ni evitar escribir el nuevo */
    }

    /* 2. Escribir el nuevo docs/ultimochat.md */
    try {
      const texto = componer(payload, (p) => fs.readFileSync(p, 'utf8'), new Date(), headCorto());
      fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
      fs.writeFileSync(SALIDA, texto, 'utf8');
    } catch (e) {
      /* Último recurso: que el archivo diga qué pasó. Si ni esto se puede, se sale igual — el
       * turno del usuario no se rompe por un eco. */
      try {
        fs.writeFileSync(SALIDA, '⚠ ultimochat falló al escribir: ' + (e && e.message) + '\n', 'utf8');
      } catch (e2) { /* nada más que hacer */ }
    }

    process.exit(0);
  };

  try {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { crudo += c; });
    process.stdin.on('end', cerrar);
    process.stdin.on('error', cerrar);
    /* Si nadie escribe por stdin, no colgar el cierre del turno. */
    setTimeout(cerrar, 5000).unref();
  } catch (e) {
    cerrar();
  }
}

module.exports = {
  textoDelTranscript,
  encabezado,
  headCorto,
  resolver,
  componer,
  sesionCortaDe,
  extraerSesionDeContenido,
  formatearSelloArchivo,
  archivarAnterior,
  podarHistoria,
  SALIDA,
  DIR_HISTORIA,
};

if (require.main === module) principal();
