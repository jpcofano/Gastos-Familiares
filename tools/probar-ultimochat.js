#!/usr/bin/env node
/**
 * `tools/probar-ultimochat.js` — banco de `tools/ultimochat.js`.
 *
 * ### De dónde salen los fixtures, que es la mitad del valor
 *
 * ⭐ **El payload está COPIADO del volcado real** de la Parte B.0 (`Addendum_2026-09-23_2`): un
 * hook `Stop` temporal volcó su stdin y de ahí salieron las doce claves y sus formas. No se dedujo
 * del esquema — `CLAUDE.md` §4: *un fixture de formato se copia de una salida real*, porque
 * deducirlo prueba que uno sabe leer el template, que es justo lo que no hace falta verificar.
 *
 * ⭐ **Las líneas del transcript también están copiadas**, de
 * `26c70a12-…jsonl` (líneas 22 y 23) y de `80441980-…jsonl`, con los textos y el bloque `usage`
 * recortados pero la **forma** intacta.
 *
 * ⚠ **El caso multi-bloque es SINTÉTICO y va declarado.** El prompt original lo pedía «copiado», y
 * **no se puede**: sobre 1.939 mensajes reales de este proyecto hay **cero** mensajes con más de un
 * bloque `text`. Es la sexta regla de `CLAUDE.md` §4 — *un control sintético prueba lo que su autor
 * imaginó*, así que se declara como tal en vez de presentarlo como medido.
 *
 * ### Lo que este banco NO contesta
 *
 * ⚠ Que el hook esté **instalado** y **corra**. Eso lo dice `.claude/settings.json` y se comprueba
 * mirando `docs/ultimochat.md` después de un turno; acá se prueba la pieza, no el cableado.
 *
 * Uso:
 *   node tools/probar-ultimochat.js
 *   node tools/probar-ultimochat.js --autoprueba     (corre además el control negativo)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const RAIZ = path.join(__dirname, '..');
const RUTA_FUENTE = path.join(__dirname, 'ultimochat.js');
const FUENTE = fs.readFileSync(RUTA_FUENTE, 'utf8');

const AHORA = new Date(2026, 8, 23, 13, 36); // fijo, para que el encabezado sea comparable
const HEAD = 'f140bf6';

/* ── Fixtures ──────────────────────────────────────────────────────────────────────────────── */

/** COPIADO del volcado del hook temporal (B.0, 23/09/2026 13:36). Las doce claves son las reales. */
const PAYLOAD_REAL = {
  session_id: '906e37dc-e9e2-42b9-acb3-bbe38060b5fc',
  transcript_path: 'C:\\Users\\juany\\.claude\\projects\\c--Users-juany-OneDrive-Documentos-AppsScript-Oficina-Motor-Informes\\906e37dc-e9e2-42b9-acb3-bbe38060b5fc.jsonl',
  cwd: 'C:\\Users\\juany\\OneDrive\\Documentos\\AppsScript\\Oficina\\Motor Informes',
  scratchpad_dir: 'C:\\Users\\juany\\AppData\\Local\\Temp\\claude\\c--…\\scratchpad',
  prompt_id: '569040d3-f5c9-4a64-ad2b-27e8bec68aef',
  permission_mode: 'auto',
  effort: { level: 'high' },
  hook_event_name: 'Stop',
  stop_hook_active: false,
  last_assistant_message: 'Hook temporal instalado. **Paro acá**, como pide B.0.',
  background_tasks: [],
  session_crons: [],
};

/** Líneas COPIADAS de `26c70a12-…jsonl` (22 y 23) y de las clases que no traen `message`. */
const L_ASISTENTE_CON_TEXTO = {
  parentUuid: 'af796a4e-08b2-48fe-b108-3fb1fbf31ed2',
  isSidechain: false,
  message: {
    model: 'claude-opus-5', id: 'msg_011CfFKdUiQL6pkRfm9JvWET', type: 'message', role: 'assistant',
    content: [{ type: 'text', text: 'Voy a empezar por el contexto.' }],
    container: null, stop_reason: 'tool_use', stop_sequence: null, stop_details: null,
    input_transformations: [], diagnostics: null, context_management: null,
  },
  apiBlockIndex: 1, requestId: 'req_011CfFKdSjqGDnLU1baNABkQ', type: 'assistant',
  uuid: 'b374c2ff-0169-4abc-ac99-f3e87d88ad85', timestamp: '2026-09-20T20:28:15.403Z',
  userType: 'external', entrypoint: 'claude-vscode', sessionId: '26c70a12', version: '2.1.278', gitBranch: 'main',
};

const L_ASISTENTE_SOLO_TOOL = {
  parentUuid: 'b374c2ff-0169-4abc-ac99-f3e87d88ad85',
  isSidechain: false,
  message: {
    model: 'claude-opus-5', id: 'msg_011CfFKdUiQL6pkRfm9JvWET', type: 'message', role: 'assistant',
    content: [{ type: 'tool_use', id: 'toolu_013CbbL73fiWLztjGhTYZXNj', name: 'Bash', input: {}, caller: { type: 'direct' } }],
    container: null, stop_reason: 'tool_use', stop_sequence: null, stop_details: null,
    input_transformations: [], diagnostics: null, context_management: null,
  },
  wireToolInputs: {}, apiBlockIndex: 2, type: 'assistant',
  uuid: '4e5b23ca-7552-477c-8028-fbfd8ee50936', timestamp: '2026-09-20T20:28:16.658Z',
  userType: 'external', entrypoint: 'claude-vscode', sessionId: '26c70a12', version: '2.1.278', gitBranch: 'main',
};

/** Las clases SIN `message` — copiadas. Un lector que asuma `o.message` se rompe con éstas. */
const LINEAS_SIN_MESSAGE = [
  { type: 'ai-title', aiTitle: 'Borrar copias automáticas', sessionId: '26c70a12' },
  { type: 'atis-latch', atis: '', sessionId: '26c70a12' },
  { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-09-20T20:28:01.475Z', sessionId: '26c70a12' },
  { type: 'file-history-snapshot', messageId: '100af083', snapshot: {}, isSnapshotUpdate: false },
  { type: 'last-prompt', lastPrompt: '…', leafUuid: 'e80ea89d', sessionId: '26c70a12' },
  { type: 'cost-state', sessionId: '26c70a12', totalCostUSD: 14.72 },
];

/** COPIADA: el transcript real `80441980-…jsonl` tiene exactamente esta única línea. */
const L_TELEPORTED = { type: 'teleported-from', remoteSessionId: 'session_01MjCWfvw2UHGTbz86tisvbV', messageCount: 0 };

const jsonl = (objetos) => objetos.map((o) => JSON.stringify(o)).join('\n') + '\n';

/* ── Afirmaciones ──────────────────────────────────────────────────────────────────────────── */

const fallos = [];
let total = 0;

function af(nombre, condicion, detalle) {
  total++;
  if (!condicion) fallos.push(nombre + (detalle ? ' — ' + detalle : ''));
  return !!condicion;
}

/** Carga `ultimochat.js` desde un texto, para poder cargar también una versión mutada. */
function cargar(codigo) {
  const mod = { exports: {} };
  /* El shebang es válido para node y no para `new Function`: se saca antes de evaluar. */
  const sinShebang = codigo.replace(/^#![^\n]*\n/, '');
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', sinShebang);
  fn(mod, mod.exports, require, __dirname, RUTA_FUENTE);
  return mod.exports;
}

function correrAfirmaciones(U, prefijo) {
  const p = prefijo ? prefijo + ' · ' : '';

  // 1 · El payload manda, y el encabezado lo dice.
  const a = U.componer(PAYLOAD_REAL, () => { throw new Error('no se debe leer el transcript'); }, AHORA, HEAD);
  af(p + 'payload · usa `last_assistant_message`', a.includes('Hook temporal instalado. **Paro acá**, como pide B.0.'));
  af(p + 'payload · el encabezado declara `fuente: payload`', a.includes('fuente: payload'));
  af(p + 'payload · el encabezado lleva fecha y HEAD', a.includes('2026-09-23 13:36') && a.includes('HEAD ' + HEAD));
  af(p + 'payload · el encabezado incluye sesión corta', a.includes('sesión 906e37dc'));
  af(p + 'sesion · extrae sesión corta de payload.session_id', U.sesionCortaDe(PAYLOAD_REAL) === '906e37dc');
  af(p + 'sesion · fallback a transcript_path si falta session_id',
    U.sesionCortaDe({ transcript_path: path.join('foo', 'bar', '12345678-abcd.jsonl') }) === '12345678');
  af(p + 'sesion · sin payload devuelve sin-sesion', U.sesionCortaDe(null) === 'sin-sesion');
  af(p + 'payload · no lee el transcript cuando no hace falta', !a.includes('Voy a empezar por el contexto'));

  // 2 · Sin el campo, cae al transcript. El campo es `.optional()`: este camino corre de verdad.
  const sinCampo = Object.assign({}, PAYLOAD_REAL);
  delete sinCampo.last_assistant_message;
  const trans = jsonl([].concat(LINEAS_SIN_MESSAGE, [L_ASISTENTE_CON_TEXTO, L_ASISTENTE_SOLO_TOOL]));
  const b = U.componer(sinCampo, () => trans, AHORA, HEAD);
  af(p + 'fallback · toma el texto del transcript', b.includes('Voy a empezar por el contexto.'));
  af(p + 'fallback · el encabezado declara `fuente: transcript`', b.includes('fuente: transcript'));

  // 3 · El último con texto gana, aunque después venga un mensaje sólo de herramienta.
  af(p + 'fallback · saltea el mensaje posterior que sólo tiene `tool_use`', !b.includes('toolu_013CbbL73fiWLztjGhTYZXNj'));

  // 3 bis · Las doce clases sin `message` no rompen nada.
  af(p + 'fallback · las líneas sin `message` no rompen', U.textoDelTranscript(jsonl(LINEAS_SIN_MESSAGE)) === null);

  // 3 ter · Toma el ÚLTIMO, no el primero. Es la afirmación que el control negativo ataca.
  const dos = jsonl([
    Object.assign({}, L_ASISTENTE_CON_TEXTO, { message: Object.assign({}, L_ASISTENTE_CON_TEXTO.message, { content: [{ type: 'text', text: 'PRIMERO' }] }) }),
    Object.assign({}, L_ASISTENTE_CON_TEXTO, { message: Object.assign({}, L_ASISTENTE_CON_TEXTO.message, { content: [{ type: 'text', text: 'ULTIMO' }] }) }),
  ]);
  af(p + 'fallback · toma el ÚLTIMO mensaje, no el primero', U.textoDelTranscript(dos) === 'ULTIMO', 'devolvió: ' + JSON.stringify(U.textoDelTranscript(dos)));

  // 3 quater · Un subagente escribe en el mismo archivo; su texto no es lo que el usuario vio.
  const conSidechain = jsonl([
    Object.assign({}, L_ASISTENTE_CON_TEXTO, { message: Object.assign({}, L_ASISTENTE_CON_TEXTO.message, { content: [{ type: 'text', text: 'lo que vio el usuario' }] }) }),
    Object.assign({}, L_ASISTENTE_CON_TEXTO, { isSidechain: true, message: Object.assign({}, L_ASISTENTE_CON_TEXTO.message, { content: [{ type: 'text', text: 'reporte de un subagente' }] }) }),
  ]);
  af(p + 'fallback · ignora los mensajes de subagente (`isSidechain`)', U.textoDelTranscript(conSidechain) === 'lo que vio el usuario');

  // 4 · Transcript sin ningún mensaje — COPIADO: es el caso real de `80441980-…jsonl`.
  const c = U.componer(sinCampo, () => jsonl([L_TELEPORTED]), AHORA, HEAD);
  af(p + 'vacío · el archivo dice que no había mensaje', /no tiene ningún mensaje del asistente/.test(c));
  af(p + 'vacío · el encabezado declara `fuente: ninguna`', c.includes('fuente: ninguna'));

  // 4 bis · Transcript inexistente — el motivo queda escrito, no se pierde.
  const d = U.componer(sinCampo, () => { throw new Error('ENOENT: no such file'); }, AHORA, HEAD);
  af(p + 'inexistente · el archivo dice el motivo', /no se pudo leer el transcript/.test(d) && /ENOENT/.test(d));

  // 4 ter · stdin que no es JSON.
  const e = U.componer(null, () => '', AHORA, HEAD);
  af(p + 'sin payload · el archivo dice el motivo', /no entregó un JSON legible/.test(e));

  // 5 · SINTÉTICO, y así declarado: cero casos reales en 1.939 mensajes medidos.
  const multi = jsonl([Object.assign({}, L_ASISTENTE_CON_TEXTO, {
    message: Object.assign({}, L_ASISTENTE_CON_TEXTO.message, {
      content: [{ type: 'text', text: 'bloque uno' }, { type: 'thinking', thinking: 'x' }, { type: 'text', text: 'bloque dos' }],
    }),
  })]);
  af(p + 'SINTÉTICO · une todos los bloques `text` con salto, como la plataforma',
    U.textoDelTranscript(multi) === 'bloque uno\nbloque dos');
}

function probarHistoriaYRotacion(U, prefijo) {
  const p = prefijo ? prefijo + ' · ' : '';
  const dirTmp = path.join(RAIZ, 'scratch', 'test_historia_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  const archTmp = path.join(dirTmp, 'ultimochat_previo.md');

  try {
    fs.mkdirSync(dirTmp, { recursive: true });

    // 6 · Archivar anterior crea archivo AAAAMMDD-HHMMSS_<sesion>.md
    const fechaTest1 = new Date(2026, 9, 8, 20, 30, 45); // 2026-10-08 20:30:45
    const contenido1 = '<!-- ultimochat · hook Stop · 2026-10-08 20:30 · sesión aaaa1111 · HEAD 1234567 · fuente: payload -->\n\nReporte sesion A';
    fs.writeFileSync(archTmp, contenido1, 'utf8');

    const destino1 = U.archivarAnterior(archTmp, dirTmp, { session_id: 'aaaa1111-2222-3333-4444' }, fechaTest1);
    af(p + 'historia · crea archivo de historia con sello y sesión',
      destino1 !== null && fs.existsSync(destino1) && destino1.endsWith('20261008-203045_aaaa1111.md'));
    af(p + 'historia · el archivo histórico preserva el contenido previo',
      destino1 !== null && fs.existsSync(destino1) && fs.readFileSync(destino1, 'utf8') === contenido1);

    // 7 · Dos sesiones no se pisan la historia
    const fechaTest2 = new Date(2026, 9, 8, 20, 35, 12);
    const contenido2 = '<!-- ultimochat · hook Stop · 2026-10-08 20:35 · sesión bbbb2222 · HEAD 1234567 · fuente: payload -->\n\nReporte sesion B';
    fs.writeFileSync(archTmp, contenido2, 'utf8');

    const destino2 = U.archivarAnterior(archTmp, dirTmp, { session_id: 'bbbb2222-9999' }, fechaTest2);
    af(p + 'historia · dos sesiones no se pisan y coexisten en la historia',
      destino2 !== null && fs.existsSync(destino2) && fs.existsSync(destino1) && destino2.endsWith('20261008-203512_bbbb2222.md'));

    // 8 · Rotación / poda deja exactamente 100 archivos
    for (let i = 1; i <= 105; i++) {
      const pad = String(i).padStart(4, '0');
      fs.writeFileSync(path.join(dirTmp, '20260101-00' + pad + '_test.md'), 'test ' + i, 'utf8');
    }
    const borrados = U.podarHistoria(dirTmp, 100);
    const restantes = fs.readdirSync(dirTmp).filter((f) => f.endsWith('.md'));
    af(p + 'poda · la rotación deja exactamente 100 archivos', restantes.length === 100, 'restantes: ' + restantes.length);
    af(p + 'poda · borra los archivos más antiguos primero', !fs.existsSync(path.join(dirTmp, '20260101-000001_test.md')));

    // 9 · Negativo: archivo inexistente devuelve null sin lanzar error
    const noExiste = U.archivarAnterior(path.join(dirTmp, 'no-existe.md'), dirTmp, null);
    af(p + 'negativo · archivar archivo inexistente devuelve null sin lanzar', noExiste === null);

  } finally {
    try {
      if (fs.existsSync(dirTmp)) {
        fs.readdirSync(dirTmp).forEach((f) => {
          try { fs.unlinkSync(path.join(dirTmp, f)); } catch (_) {}
        });
        fs.rmdirSync(dirTmp);
      }
    } catch (_) {}
  }
}

correrAfirmaciones(cargar(FUENTE), '');
probarHistoriaYRotacion(cargar(FUENTE), '');

/* ── Control de punta a punta: el proceso real no puede romper el turno ─────────────────────── */

/* ⭐ El archivo se preserva y se restaura: un banco que deje contenido de prueba en
 * `docs/ultimochat.md` produce exactamente el archivo viejo que parece nuevo. */
const SALIDA = path.join(RAIZ, 'docs', 'ultimochat.md');
const habia = fs.existsSync(SALIDA) ? fs.readFileSync(SALIDA, 'utf8') : null;
const dirHist = path.join(RAIZ, '.ultimochat');
const archivosHistAntes = fs.existsSync(dirHist) ? new Set(fs.readdirSync(dirHist)) : new Set();

try {
  fs.writeFileSync(SALIDA, '<!-- ultimochat · hook Stop · 2026-10-08 12:00 · sesión test1234 · HEAD aaaaaaa · fuente: payload -->\n\nReporte anterior', 'utf8');

  const r = cp.spawnSync(process.execPath, [RUTA_FUENTE], {
    cwd: RAIZ, encoding: 'utf8',
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 'nuevo5678-1111-2222',
      last_assistant_message: 'Nuevo reporte exitoso'
    }),
  });
  af('proceso · sale 0 pase lo que pase', r.status === 0, 'exit ' + r.status);
  const escrito = fs.existsSync(SALIDA) ? fs.readFileSync(SALIDA, 'utf8') : '';
  af('proceso · escribe el nuevo reporte con sesión', escrito.includes('Nuevo reporte exitoso') && escrito.includes('sesión nuevo567'));

  const archivosHistDespues = fs.existsSync(dirHist) ? fs.readdirSync(dirHist) : [];
  const nuevoArchivado = archivosHistDespues.filter((f) => !archivosHistAntes.has(f) && f.includes('test1234'));
  af('proceso · archiva el archivo anterior en .ultimochat/', nuevoArchivado.length > 0);
} finally {
  if (habia === null) { try { fs.unlinkSync(SALIDA); } catch (e) { /* nada */ } }
  else fs.writeFileSync(SALIDA, habia, 'utf8');

  if (fs.existsSync(dirHist)) {
    fs.readdirSync(dirHist).forEach((f) => {
      if (!archivosHistAntes.has(f)) {
        try { fs.unlinkSync(path.join(dirHist, f)); } catch (_) {}
      }
    });
  }
}

/* ── Control negativo ──────────────────────────────────────────────────────────────────────── */

if (process.argv.indexOf('--autoprueba') !== -1) {
  console.log('\n— autoprueba: se rompe a propósito «toma el último» y tiene que caer ESA afirmación —');

  const VIEJO = 'if (texto) ultimo = texto;';
  const NUEVO = 'if (texto && !ultimo) ultimo = texto;';
  const mutado = FUENTE.replace(VIEJO, NUEVO);

  /* ⭐⭐ La guarda del 24/08: si el parche no aplicó, **no hay después**, y el control correría
   * sobre el código intacto dando verde. Eso se lee como «el negativo pasó» y no probó nada. */
  if (mutado === FUENTE) {
    console.log('⛔ LA MUTACIÓN NO APLICÓ: el patrón no matcheó. El control negativo no probó nada.');
    process.exit(1);
  }

  const antes = fallos.length;
  correrAfirmaciones(cargar(mutado), 'MUTADO');
  const nuevos = fallos.slice(antes);

  const laQueDebeCaer = nuevos.filter((f) => /toma el ÚLTIMO mensaje, no el primero/.test(f));
  /* ⭐ No alcanza con ver rojo: hay que exigir el MOTIVO. Una afirmación que cae por otra causa
   * no mide la guarda que dice medir (23/08). */
  if (!laQueDebeCaer.length) {
    console.log('⛔ El negativo NO cayó por la afirmación esperada. Cayeron: ' + JSON.stringify(nuevos));
    process.exit(1);
  }
  console.log('   ✅ cayó por el motivo correcto: ' + laQueDebeCaer[0]);
  console.log('   (las otras ' + (nuevos.length - laQueDebeCaer.length) + ' caídas del mutado son colaterales y se descartan)');

  // Las caídas del mutado no cuentan como fallo del banco.
  fallos.length = antes;

  console.log('\n— autoprueba 2: se rompe a propósito la copia de historia y tiene que caer esa afirmación —');
  const VIEJO_HIST = "fs.writeFileSync(destino, contenido, 'utf8');";
  const NUEVO_HIST = "/* mutado sin copia */;";
  const mutadoHist = FUENTE.replace(VIEJO_HIST, NUEVO_HIST);
  if (mutadoHist === FUENTE) {
    console.log('⛔ LA MUTACIÓN DE HISTORIA NO APLICÓ: el patrón no matcheó.');
    process.exit(1);
  }

  const antesHist = fallos.length;
  probarHistoriaYRotacion(cargar(mutadoHist), 'MUTADO_HISTORIA');
  const nuevosHist = fallos.slice(antesHist);
  const laQueDebeCaerHist = nuevosHist.filter((f) => /crea archivo de historia/.test(f));
  if (!laQueDebeCaerHist.length) {
    console.log('⛔ El negativo de historia NO cayó por la afirmación esperada. Cayeron: ' + JSON.stringify(nuevosHist));
    process.exit(1);
  }
  console.log('   ✅ historia cayó por el motivo correcto: ' + laQueDebeCaerHist[0]);
  fallos.length = antesHist;
}

/* ── Veredicto ─────────────────────────────────────────────────────────────────────────────── */

console.log('\nprobar-ultimochat · ' + (total - fallos.length) + ' de ' + total + ' verificadas');
if (fallos.length) {
  fallos.forEach((f) => console.log('  ❌ ' + f));
  process.exit(1);
}
console.log('✅ sin fallos');
console.log('⚠ NO cubre: que el hook esté instalado ni que corra. Eso es `.claude/settings.json`,');
console.log('   y se comprueba mirando `docs/ultimochat.md` después de un turno.');
process.exit(0);
