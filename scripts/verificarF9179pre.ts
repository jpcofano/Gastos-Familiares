// F9.179-pre — Confirmar resumen de tarjeta: "Missing or insufficient permissions". SOLO LECTURA.
//
// §1 — estado en Firestore (Admin SDK, solo lecturas).
// §2 — qué escritura rechazó la regla. El batch NO se reconstruye a mano: se corre el
//      `confirmarResumenTarjeta` REAL de src/datos/resumenesTarjeta.ts contra un Firestore de mentira.
//      Las lecturas que hace (getDoc/getDocs) van a producción por Admin SDK; las escrituras
//      (writeBatch.set/update/delete) solo se anotan y `commit()` no manda nada. Así el payload que
//      se evalúa contra firestore.rules es el que armó el cliente, con `tipoDeLinea`, `totalesNetos`
//      y `calcularCuadre` reales adentro — no una copia.
//
// El módulo se transpila en memoria y se evalúa con `require` propio: `../firebase` (inicializa el
// SDK cliente con import.meta.env, no corre en node), `./movimientos` y `./hashArchivo` se
// reemplazan por stubs; `../familia`, `./medios` y `./ajusteConsolidado` son los archivos reales.
// `Timestamp` y `serverTimestamp` son los del SDK cliente de verdad, para que una fecha inválida se
// comporte igual que en el teléfono.
//
// Privacidad: ids a 8 caracteres, emails enmascarados, descripciones recortadas.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp as AdminTimestamp } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CardStatement, FamiliaConfig, MovimientoParseado } from '../src/types';
import type { CuadreResult } from '../src/datos/resumenesTarjeta';

// El teléfono que confirmó está en Argentina; `new Date('YYYY-MM-DD')` y `getMonth()` dependen de esto.
process.env.TZ = 'America/Argentina/Buenos_Aires';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const adminDb = getFirestore();

const rootReq = createRequire(process.cwd() + '/package.json');
const ts = rootReq('typescript') as typeof import('typescript');
const clienteFS = rootReq('firebase/firestore') as typeof import('firebase/firestore');

// ── utilidades de salida ──────────────────────────────────────────────────────
const h8 = (s: unknown) => (s ? String(s).slice(0, 8) : '-');
const s = (v: unknown) => (v === null ? 'null' : v === undefined ? '(ausente)' : String(v));
const corto = (v: unknown, n = 26) => {
  const t = String(v ?? '');
  return t.length > n ? t.slice(0, n) + '…' : t;
};
const enmascarar = (email: string) => {
  const [loc, dom] = email.split('@');
  return `${loc.slice(0, 2)}…${loc.slice(-1)}@${dom ?? '?'}`;
};
const fechaAR = (v: unknown) => {
  const t = v as { toDate?: () => Date } | null | undefined;
  if (!t?.toDate) return s(v);
  return t.toDate().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
};
const ars = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const casi = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 0.005;

// ── loader: transpila un .ts del repo y lo evalúa con stubs ──────────────────
type Mod = Record<string, unknown>;
const STUBS_RUTA: Record<string, Mod> = {};
const STUBS_PAQUETE: Record<string, Mod> = {};
const cacheMods = new Map<string, Mod>();

function cargarModulo(rutaAbs: string): Mod {
  const previo = cacheMods.get(rutaAbs);
  if (previo) return previo;
  const fuente = fs.readFileSync(rutaAbs, 'utf8');
  const js = ts.transpileModule(fuente, {
    fileName: rutaAbs,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const modulo = { exports: {} as Mod };
  cacheMods.set(rutaAbs, modulo.exports);
  const requireLocal = (spec: string): unknown => {
    if (spec in STUBS_PAQUETE) return STUBS_PAQUETE[spec];
    if (spec.startsWith('.')) {
      const base = path.resolve(path.dirname(rutaAbs), spec);
      const clave = path.relative(process.cwd(), base).replace(/\\/g, '/');
      if (clave in STUBS_RUTA) return STUBS_RUTA[clave];
      const archivo = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(f => fs.existsSync(f));
      if (!archivo) throw new Error(`no resuelvo ${spec} desde ${rutaAbs}`);
      return cargarModulo(archivo);
    }
    throw new Error(`import no previsto en la reconstrucción: ${spec} (desde ${rutaAbs})`);
  };
  new Function('require', 'module', 'exports', js)(requireLocal, modulo, modulo.exports);
  return modulo.exports;
}

// ── Firestore simulado: lee producción, escribe en un registro ───────────────
type RefSim = { __ref: true; path: string; id: string; col: string };
type ColSim = { __col: true; path: string };
type WhereSim = { campo: string; op: FirebaseFirestore.WhereFilterOp; valor: unknown };
type QuerySim = { __q: true; col: ColSim; ws: WhereSim[] };
type OpBatch = { op: 'set' | 'update' | 'delete'; ref: RefSim; data?: Record<string, unknown> };

const lecturas: Array<{ que: string; n: number }> = [];
const batchesCommiteados: OpBatch[][] = [];
let autoId = 0;
const DB_SIM = { __dbSimulado: true };

const fsSimulado: Mod = {
  Timestamp: clienteFS.Timestamp,
  serverTimestamp: clienteFS.serverTimestamp,
  collection: (_db: unknown, ...segs: string[]): ColSim => ({ __col: true, path: segs.join('/') }),
  doc: (a: ColSim | unknown, ...segs: string[]): RefSim => {
    if ((a as ColSim).__col) {
      const col = (a as ColSim).path;
      const id = segs[0] ?? `nuevo-${String(++autoId).padStart(2, '0')}`;
      return { __ref: true, path: `${col}/${id}`, id, col };
    }
    return { __ref: true, path: segs.join('/'), id: segs[segs.length - 1], col: segs.slice(0, -1).join('/') };
  },
  where: (campo: string, op: FirebaseFirestore.WhereFilterOp, valor: unknown): WhereSim => ({ campo, op, valor }),
  query: (col: ColSim, ...ws: WhereSim[]): QuerySim => ({ __q: true, col, ws }),
  getDocs: async (q: QuerySim | ColSim) => {
    const col = (q as QuerySim).__q ? (q as QuerySim).col.path : (q as ColSim).path;
    const ws = (q as QuerySim).__q ? (q as QuerySim).ws : [];
    let r: FirebaseFirestore.Query = adminDb.collection(col);
    for (const w of ws) r = r.where(w.campo, w.op, w.valor);
    const snap = await r.get();
    lecturas.push({ que: `${col} ${ws.map(w => `${w.campo} ${w.op} ${JSON.stringify(w.valor)}`).join(' & ')}`, n: snap.size });
    return {
      size: snap.size,
      empty: snap.empty,
      docs: snap.docs.map(d => ({
        id: d.id,
        ref: { __ref: true, path: d.ref.path, id: d.id, col } as RefSim,
        data: () => d.data(),
      })),
    };
  },
  getDoc: async (ref: RefSim) => {
    const snap = await adminDb.doc(ref.path).get();
    lecturas.push({ que: `${ref.path} (getDoc)`, n: snap.exists ? 1 : 0 });
    return { id: snap.id, exists: () => snap.exists, data: () => snap.data() };
  },
  writeBatch: () => {
    const ops: OpBatch[] = [];
    const b = {
      set: (ref: RefSim, data: Record<string, unknown>) => { ops.push({ op: 'set', ref, data }); return b; },
      update: (ref: RefSim, data: Record<string, unknown>) => { ops.push({ op: 'update', ref, data }); return b; },
      delete: (ref: RefSim) => { ops.push({ op: 'delete', ref }); return b; },
      commit: async () => { batchesCommiteados.push(ops); },   // NO escribe: solo registra
    };
    return b;
  },
  updateDoc: async () => { throw new Error('updateDoc no tiene que correr en esta reconstrucción'); },
  onSnapshot: () => { throw new Error('onSnapshot no tiene que correr en esta reconstrucción'); },
};
STUBS_PAQUETE['firebase/firestore'] = fsSimulado;
STUBS_PAQUETE['firebase/storage'] = { ref: () => ({}), uploadBytes: async () => { throw new Error('sin storage'); } };
STUBS_RUTA['src/firebase'] = { db: DB_SIM, storage: {}, auth: {}, functions: {}, app: {} };
STUBS_RUTA['src/datos/hashArchivo'] = { sha256Archivo: async () => { throw new Error('sin hash'); } };
STUBS_RUTA['src/datos/movimientos'] = { docAMovimiento: (id: string, data: Record<string, unknown>) => ({ id, ...data }) };

type RTMod = {
  docACardStatement: (id: string, data: FirebaseFirestore.DocumentData) => CardStatement;
  calcularCuadre: (l: MovimientoParseado[], tARS: number, tUSD: number, aj: CardStatement['ajustesConsolidado'], c?: CardStatement) => CuadreResult;
  totalesNetos: (l: MovimientoParseado[], tARS: number, tUSD: number) => { objetivoARS: number; objetivoUSD: number };
  clavesDeResumen: (r: CardStatement) => string[];
  confirmarResumenTarjeta: (r: CardStatement, l: MovimientoParseado[], memberId: string, cfg: FamiliaConfig) =>
    Promise<{ ok: true; data: void } | { ok: false; error: Error }>;
};
type FamMod = {
  cargarFamiliaConfig: () => Promise<FamiliaConfig | null>;
  resolverMiembro: (email: string, cfg: FamiliaConfig) => { memberId: string } | null;
  resolverNombreMiembro: (nombre: string, cfg: FamiliaConfig) => string | null;
};
const RT = cargarModulo(path.resolve('src/datos/resumenesTarjeta.ts')) as unknown as RTMod;
const FAM = cargarModulo(path.resolve('src/familia.ts')) as unknown as FamMod;

// ── firestore.rules: las condiciones del create de movimientos, con su línea ──
const reglas = fs.readFileSync('firestore.rules', 'utf8').replace(/\r\n/g, '\n').split('\n');
const iniMov = reglas.findIndex(l => l.includes('match /movimientos/{id}'));
const lineaRegla = (frag: string) => {
  const i = reglas.findIndex((l, k) => k > iniMov && l.includes(frag));
  return i >= 0 ? `:${i + 1}` : ':?';
};

type Auth = { emailVerificado: boolean; autorizado: { rol: unknown; memberId: unknown } | null };
type Cond = { regla: string; texto: string; ok: boolean; valor: string };

function evaluarCreateMovimiento(d: Record<string, unknown>, auth: Auth): Cond[] {
  const a = auth.autorizado;
  const miMemberId = a ? a.memberId ?? null : null;
  const esMiembro = auth.emailVerificado && a != null && a.memberId != null;
  const esAdmin = auth.emailVerificado && a != null && a.rol === 'admin';
  const esST = (v: unknown) => (v as { _methodName?: string } | null)?._methodName === 'serverTimestamp';
  const fechaOk = d.fecha instanceof clienteFS.Timestamp && Number.isFinite((d.fecha as InstanceType<typeof clienteFS.Timestamp>).seconds);
  const c: Cond[] = [
    { regla: lineaRegla('allow create: if esMiembro()'), texto: 'esMiembro()', ok: esMiembro, valor: `memberId=${s(miMemberId)}` },
    { regla: lineaRegla('data.creadoPor == miMemberId()'), texto: 'creadoPor == miMemberId()', ok: d.creadoPor === miMemberId, valor: `${s(d.creadoPor)} vs ${s(miMemberId)}` },
    { regla: lineaRegla('(esAdmin() || request.resource.data.persona'), texto: 'esAdmin() || persona == miMemberId()', ok: esAdmin || d.persona === miMemberId, valor: `admin=${esAdmin} persona=${s(d.persona)}` },
    { regla: lineaRegla("data.tipo in ['Gasto', 'Ingreso']"), texto: 'tipo in [Gasto, Ingreso]', ok: d.tipo === 'Gasto' || d.tipo === 'Ingreso', valor: s(d.tipo) },
    { regla: lineaRegla("data.moneda in ['ARS', 'USD']"), texto: 'moneda in [ARS, USD]', ok: d.moneda === 'ARS' || d.moneda === 'USD', valor: s(d.moneda) },
    { regla: lineaRegla('data.monto is number'), texto: 'monto is number', ok: typeof d.monto === 'number', valor: `${typeof d.monto} ${s(d.monto)}` },
    { regla: lineaRegla('data.monto > 0'), texto: 'monto > 0', ok: typeof d.monto === 'number' && d.monto > 0, valor: s(d.monto) },
    { regla: lineaRegla('data.fecha is timestamp'), texto: 'fecha is timestamp', ok: fechaOk, valor: fechaOk ? new Date((d.fecha as InstanceType<typeof clienteFS.Timestamp>).toMillis()).toISOString().slice(0, 10) : s(d.fecha) },
    { regla: lineaRegla('data.mes is string'), texto: 'mes is string', ok: typeof d.mes === 'string', valor: s(d.mes) },
    { regla: lineaRegla('data.mes.matches('), texto: "mes.matches('^[0-9]{4}-[0-9]{2}$')", ok: typeof d.mes === 'string' && /^[0-9]{4}-[0-9]{2}$/.test(d.mes), valor: s(d.mes) },
    { regla: lineaRegla('data.creadoEn == request.time'), texto: 'creadoEn == request.time', ok: esST(d.creadoEn), valor: esST(d.creadoEn) ? 'serverTimestamp()' : s(d.creadoEn) },
    { regla: lineaRegla('data.actualizadoEn == request.time'), texto: 'actualizadoEn == request.time', ok: esST(d.actualizadoEn), valor: esST(d.actualizadoEn) ? 'serverTimestamp()' : s(d.actualizadoEn) },
    { regla: lineaRegla('data.descripcion is string'), texto: 'descripcion is string', ok: typeof d.descripcion === 'string', valor: typeof d.descripcion },
    { regla: lineaRegla('data.descripcion.size() > 0'), texto: 'descripcion.size() > 0', ok: typeof d.descripcion === 'string' && d.descripcion.length > 0, valor: JSON.stringify(corto(d.descripcion, 20)) },
  ];
  return c;
}

// ── criterios de la captura ───────────────────────────────────────────────────
const IMP_CAPTURA = [8.79, 92.38, 131.97];
const esUSD029 = (l: MovimientoParseado) => l.moneda === 'USD' && casi(l.monto, 0.29);
const esRev = (l: MovimientoParseado) => l.tipoLinea === 'reverso' && casi(l.monto, 149.96);
const esImpCaptura = (l: MovimientoParseado) => l.tipoLinea === 'impuesto' && l.moneda === 'ARS' && IMP_CAPTURA.some(m => casi(l.monto, m));

async function main() {
  const ahora = new Date().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
  console.log('F9.179-pre — Confirmar resumen de tarjeta: "Missing or insufficient permissions"');
  console.log(`corrido: ${ahora} (AR) · TZ del proceso: ${process.env.TZ} · SOLO LECTURA (commit() simulado)\n`);

  // ════ §1.1 — identificar el resumen ════
  console.log('=== §1.1 Identificar el resumen ===');
  console.log('criterio: una línea USD de 0,29 Y una línea reverso de 149,96 (confirmación: imp. ARS 8,79 / 92,38 / 131,97)');
  const resSnap = await adminDb.collection('resumenesTarjeta').get();
  const todos = resSnap.docs.map(d => ({ d, r: RT.docACardStatement(d.id, d.data()) }));
  const parcial = todos.filter(({ r }) => r.movimientosParseados.some(esUSD029) || r.movimientosParseados.some(esRev));
  const candidatos = parcial.filter(({ r }) => r.movimientosParseados.some(esUSD029) && r.movimientosParseados.some(esRev));
  console.log(`resúmenes en la colección: ${todos.length} · con USD 0,29 o reverso 149,96: ${parcial.length} · con los dos: ${candidatos.length}`);
  for (const { d, r } of parcial) {
    const m = r.movimientosParseados;
    console.log(`  ${h8(r.id)}  ${s(r.tarjetaCodigo).padEnd(10)} periodo=${s(r.periodo).padEnd(8)} estado=${r.estado.padEnd(10)} ` +
      `actualizadoEn=${fechaAR(d.data().actualizadoEn)}  líneas=${m.length} incluir=${m.filter(l => l.incluir).length} ` +
      `USD0,29=${m.some(esUSD029) ? 'sí' : 'no'} rev149,96=${m.some(esRev) ? 'sí' : 'no'} imp=${m.filter(esImpCaptura).length}/3`);
  }
  if (candidatos.length !== 1) {
    console.log(`\n>>> PARADA: ${candidatos.length} candidatos con los dos criterios (se esperaba exactamente 1).`);
    return;
  }
  const { d: resDoc, r: resumen } = candidatos[0];
  const crudo = resDoc.data();
  console.log(`=> resumen: ${h8(resumen.id)} (${resumen.tarjetaCodigo} · ${resumen.tarjeta} · ${resumen.periodo})\n`);

  // ════ §1.2 — el resumen ════
  console.log('=== §1.2 Estado del resumen ===');
  console.log(`  estado:               ${crudo.estado}`);
  console.log(`  confirmadoEn:         ${fechaAR(crudo.confirmadoEn)}`);
  console.log(`  confirmadoPor:        ${s(crudo.confirmadoPor)}`);
  console.log(`  totalARS (PDF):       ${s(crudo.totalARS)} (${typeof crudo.totalARS})`);
  console.log(`  totalUSD (PDF):       ${s(crudo.totalUSD)} (${typeof crudo.totalUSD})`);
  const aj = resumen.ajustesConsolidado;
  console.log(`  ajustesConsolidado:   ${aj.length}${aj.map(a => `\n      · ARS=${a.montoARS} USD=${a.montoUSD} origen=${a.origen} creadoPor=${s(a.creadoPor)} creadoEn=${a.creadoEn ? new Date(a.creadoEn).toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }) : '-'}` +
    `\n        concepto: ${JSON.stringify(corto(a.concepto, 90))}`).join('')}`);
  console.log(`  movimientosParseados: ${resumen.movimientosParseados.length}`);
  console.log(`  fechaCierre:          ${s(resumen.fechaCierre?.toISOString().slice(0, 10))} · fechaVencimiento: ${s(resumen.fechaVencimiento?.toISOString().slice(0, 10))} (crudo: ${JSON.stringify(crudo.fechaVencimiento?.toDate ? 'Timestamp' : crudo.fechaVencimiento)})`);
  console.log(`  subidoPor/subidoEn:   ${s(crudo.subidoPor)} · ${fechaAR(crudo.subidoEn)}`);
  console.log(`  parseadoEn:           ${fechaAR(crudo.parseadoEn)}`);
  console.log(`  actualizadoEn:        ${fechaAR(crudo.actualizadoEn)}`);
  console.log(`  saldo/pagos consolidado: saldoAnteriorARS=${s(crudo.saldoAnteriorARS)} pagosDelPeriodoARS=${s(crudo.pagosDelPeriodoARS)} saldoAnteriorUSD=${s(crudo.saldoAnteriorUSD)} pagosDelPeriodoUSD=${s(crudo.pagosDelPeriodoUSD)}\n`);

  // ════ §1.3 — movimientos del resumen ════
  console.log('=== §1.3 Movimientos con resumenTarjetaId en clavesDeResumen(resumen) ===');
  const claves = RT.clavesDeResumen(resumen);
  let propios = 0;
  for (const k of claves) {
    const q = await adminDb.collection('movimientos').where('resumenTarjetaId', '==', k).get();
    console.log(`  clave ${h8(k)} (${k === resumen.id ? 'doc id' : 'legacy tarjetaCodigo_nroResumen'}): ${q.size}`);
    propios += q.size;
  }
  console.log(`  total: ${propios} (esperado 0) ${propios === 0 ? 'OK' : '>>> NO'}\n`);

  // ════ §1.4 — movimientos origen Tarjeta creados hoy ════
  console.log('=== §1.4 Movimientos origen == "Tarjeta" con creadoEn del 2026-10-05 (AR) ===');
  const desde = AdminTimestamp.fromDate(new Date('2026-10-05T00:00:00-03:00'));
  const hasta = AdminTimestamp.fromDate(new Date('2026-10-06T00:00:00-03:00'));
  const hoy = await adminDb.collection('movimientos').where('creadoEn', '>=', desde).where('creadoEn', '<', hasta).get();
  const hoyTarjeta = hoy.docs.filter(m => m.data().origen === 'Tarjeta');
  const hoyEsta = hoyTarjeta.filter(m => m.data().tarjetaCodigo === resumen.tarjetaCodigo);
  console.log(`  creados el 2026-10-05 (cualquier origen): ${hoy.size} · origen Tarjeta: ${hoyTarjeta.length} · de ${resumen.tarjetaCodigo}: ${hoyEsta.length} (esperado 0) ${hoyEsta.length === 0 ? 'OK' : '>>> NO'}`);
  for (const m of hoy.docs) {
    const x = m.data();
    console.log(`    ${h8(m.id)} ${fechaAR(x.creadoEn)} origen=${s(x.origen)} tarjeta=${s(x.tarjetaCodigo)} ${x.moneda} ${x.monto} "${corto(x.descripcion, 24)}"`);
  }
  const algoGuardado = propios > 0 || hoyEsta.length > 0 || crudo.estado === 'confirmado' || crudo.confirmadoEn != null;
  console.log(`\nCierre §1: ${algoGuardado ? '>>> APARECIÓ UNA ESCRITURA — PARADA' : 'no se guardó nada (0 movimientos del resumen, 0 de la tarjeta hoy, resumen sin confirmar)'}\n`);
  if (algoGuardado) return;

  // ════ §2.0 — quién confirma: memberId del cliente vs el de las reglas ════
  console.log('=== §2.0 memberId: el que manda el cliente vs el que exige la regla ===');
  console.log('  cliente: useMiembro → resolverMiembro(email, config/familia)   (src/hooks/useMiembro.ts)');
  console.log('  reglas:  miMemberId() = autorizados/{email.lower()}.memberId    (firestore.rules:16-19)');
  const config = await FAM.cargarFamiliaConfig();
  if (!config) { console.log('  >>> config/familia no existe'); return; }
  const autSnap = await adminDb.collection('autorizados').get();
  const usuarios: Array<{ email: string; auth: Auth; memberIdCliente: string | null }> = [];
  for (const a of autSnap.docs) {
    const x = a.data();
    const cli = FAM.resolverMiembro(a.id, config);
    const rolConfig = cli ? config.miembros[cli.memberId]?.rol : undefined;
    const coincide = cli?.memberId === x.memberId;
    console.log(`  ${enmascarar(a.id).padEnd(22)} autorizados: rol=${s(x.rol).padEnd(11)} memberId=${s(x.memberId).padEnd(8)} · ` +
      `config: memberId=${s(cli?.memberId).padEnd(8)} rol=${s(rolConfig).padEnd(11)} → ${coincide ? 'coincide' : '>>> DISTINTO'}`);
    // El payload depende solo del memberId del cliente y la regla solo de rol+memberId de
    // autorizados: dos emails del mismo miembro dan el mismo resultado, se evalúa uno por miembro.
    const yaEsta = usuarios.some(u => u.memberIdCliente === (cli?.memberId ?? null) && u.auth.autorizado?.memberId === x.memberId);
    if (x.rol === 'admin' && !yaEsta) usuarios.push({ email: a.id, auth: { emailVerificado: true, autorizado: { rol: x.rol, memberId: x.memberId } }, memberIdCliente: cli?.memberId ?? null });
  }
  console.log(`  admins a evaluar (uno por miembro): ${usuarios.map(u => `${u.memberIdCliente} (${enmascarar(u.email)})`).join(', ')}`);
  console.log(`  (la vista de resúmenes lee resumenesTarjeta, que es esAdmin(): quien vio el preview pasa esAdmin() con email_verified)`);
  console.log(`  subidoPor del resumen: ${s(crudo.subidoPor)} · creadoPor del ajuste manual: ${aj.map(a => s(a.creadoPor)).join(', ') || '-'}\n`);

  // ════ §2.1 — lo guardado vs la captura ════
  console.log('=== §2.1 movimientosParseados guardado vs la captura ===');
  console.log('  LIMITACIÓN: las ediciones de la UI (incluir / noDebitado / tipoLinea) no se persistieron —');
  console.log('  el batch falló entero, y el update del resumen iba en ese mismo batch. Lo guardado es el estado previo.');
  const M = resumen.movimientosParseados;
  const rev = M.filter(esRev), usd = M.filter(esUSD029), imp = M.filter(esImpCaptura);
  console.log(`  líneas: ${M.length} · incluir=true: ${M.filter(l => l.incluir).length} (botón de la captura: 42)`);
  for (const l of rev) console.log(`  reverso 149,96: seq=${l.seq} incluir=${l.incluir} noDebitado=${s(l.noDebitado)} moneda=${l.moneda}  (captura: destildado)`);
  for (const l of usd) console.log(`  USD 0,29:       seq=${l.seq} tipoLinea=${l.tipoLinea} incluir=${l.incluir} noDebitado=${s(l.noDebitado)} "${corto(l.descripcionRaw, 24)}"  (captura: tildado)`);
  for (const l of imp) console.log(`  imp. ${String(l.monto).padEnd(7)}   seq=${l.seq} incluir=${l.incluir} noDebitado=${s(l.noDebitado)} "${corto(l.descripcionRaw, 24)}"  (captura: tildado)`);
  const coincideCaptura = M.filter(l => l.incluir).length === 42 && rev.every(l => !l.incluir) && usd.every(l => l.incluir) && imp.length === 3 && imp.every(l => l.incluir);
  console.log(`  ¿coincide con la captura?: ${coincideCaptura ? 'sí' : 'NO'}`);
  // Tipos crudos: un monto string o una moneda rara pasarían el filtro de JS y no la regla.
  const raros = M.filter(l => typeof l.monto !== 'number' || (l.moneda !== 'ARS' && l.moneda !== 'USD') || typeof l.descripcionRaw !== 'string'
    || !l.descripcionRaw || (l.fechaConsumo != null && Number.isNaN(new Date(l.fechaConsumo).getTime())));
  console.log(`  líneas con monto no numérico / moneda fuera de ARS|USD / descripción vacía / fechaConsumo inválida: ${raros.length}`);
  for (const l of raros) console.log(`    seq=${l.seq} monto=${JSON.stringify(l.monto)} moneda=${JSON.stringify(l.moneda)} desc=${JSON.stringify(l.descripcionRaw)} fechaConsumo=${JSON.stringify(l.fechaConsumo)}`);
  console.log('');

  // Lo que el preview le pasa a confirmar(): las líneas guardadas + personaConfirmada resuelta
  // (ResumenesTarjeta.tsx:109-115). categoria/subcategoria salen del clasificador del cliente y no
  // se reproducen: ninguna condición de la regla las mira.
  const lineasUI = (base: MovimientoParseado[]) => base.map(l => ({
    ...l,
    personaConfirmada: l.personaDetectada ? FAM.resolverNombreMiembro(l.personaDetectada, config) : null,
  }));
  const variantes: Array<{ nombre: string; lineas: MovimientoParseado[] }> = [{ nombre: 'A — estado guardado', lineas: lineasUI(M) }];
  if (!coincideCaptura) {
    variantes.push({
      nombre: 'B — con las ediciones de la captura (reverso 149,96 destildado; USD 0,29 e imp. tildados)',
      lineas: lineasUI(M).map(l => (esRev(l) ? { ...l, incluir: false } : esUSD029(l) || esImpCaptura(l) ? { ...l, incluir: true } : l)),
    });
  }

  for (const v of variantes) {
    const detalle = usuarios[0];
    for (const u of usuarios) {
      const verbose = u === detalle;
      if (verbose) {
        console.log(`=== §2.2 Batch reconstruido — variante ${v.nombre} ===`);
        console.log(`  usuario: ${s(u.memberIdCliente)} (${enmascarar(u.email)}) · botón: "Confirmar ${v.lineas.filter(l => l.incluir).length} líneas + 2 totales"`);
        // El botón cuenta `incluir`; el batch importa `incluir && !noDebitado && monto > 0` (resumenesTarjeta.ts:472).
        const fuera = v.lineas.filter(l => l.incluir && (l.noDebitado || !(l.monto > 0)));
        console.log(`  tildadas que NO van al batch (noDebitado o monto <= 0): ${fuera.length}` +
          fuera.map(l => `\n    · seq=${l.seq} ${l.tipoLinea} ${l.moneda} ${l.monto} noDebitado=${s(l.noDebitado)}`).join(''));
      }
      lecturas.length = 0;
      batchesCommiteados.length = 0;
      autoId = 0;
      const res = await RT.confirmarResumenTarjeta(resumen, v.lineas, u.memberIdCliente ?? '(sin memberId)', config);
      if (verbose) {
        console.log(`  lecturas previas al batch (rules: itemsEsperados → esMiembro(); movimientos → esAdmin()):`);
        for (const l of lecturas) console.log(`    · ${l.que.replace(/[0-9a-f]{64}/g, x => h8(x) + '…')} → ${l.n}`);
      }
      if (!res.ok) {
        console.log(verbose
          ? `  >>> la función cortó ANTES del commit: ${res.error.message}`
          : `  mismo resultado con ${s(u.memberIdCliente)} (${enmascarar(u.email)}): cortó antes del commit (${res.error.message})`);
        continue;
      }
      const ops = batchesCommiteados[0] ?? [];
      const sets = ops.filter(o => o.op === 'set' && o.ref.col === 'movimientos');
      const upds = ops.filter(o => o.op === 'update');
      const dels = ops.filter(o => o.op === 'delete');

      const fallas = new Map<string, number[]>();
      const filas: string[] = [];
      sets.forEach((o, i) => {
        const dd = o.data!;
        const malas = evaluarCreateMovimiento(dd, u.auth).filter(c => !c.ok);
        const quien = dd.excluirDash === true ? `TOTAL ${dd.moneda}` : 'línea';
        filas.push(`  ${String(i + 1).padStart(2)} ${quien.padEnd(9)} ${s(dd.tipo).padEnd(7)} ${s(dd.moneda)} ${String(dd.monto).padStart(11)} mes=${s(dd.mes)} ` +
          `"${corto(dd.descripcion, 22)}"`.padEnd(26) + ` → ${malas.length === 0 ? 'OK' : 'FALLA ' + malas.map(c => `${c.regla} ${c.texto} [${c.valor}]`).join(' · ')}`);
        for (const c of malas) fallas.set(`${c.regla} ${c.texto}`, [...(fallas.get(`${c.regla} ${c.texto}`) ?? []), i + 1]);
      });
      const esAdmin = u.auth.emailVerificado && u.auth.autorizado?.rol === 'admin';
      for (const o of upds) {
        filas.push(`  update ${o.ref.col}/${h8(o.ref.id)}… → match /resumenesTarjeta: esAdmin() → ${esAdmin ? 'OK' : 'FALLA'}`);
        if (!esAdmin) fallas.set('resumenesTarjeta esAdmin()', [-1]);
      }
      const claveDelete = `${lineaRegla('allow delete: if false')} allow delete: if false`;
      for (const o of dels) {
        filas.push(`  delete movimientos/${h8(o.ref.id)} → ${claveDelete} → FALLA`);
        fallas.set(claveDelete, [...(fallas.get(claveDelete) ?? []), -1]);
      }
      const resultado = fallas.size === 0
        ? 'NINGUNA escritura viola las reglas'
        : `${[...fallas.values()].flat().length} violación(es): ` + [...fallas].map(([k, p]) => `${k} → payload ${p.join(', ')}`).join(' · ');

      if (!verbose) {
        console.log(`  mismo batch con ${s(u.memberIdCliente)} (${enmascarar(u.email)}, autorizados rol=${s(u.auth.autorizado?.rol)}): ` +
          `${sets.length} create + ${upds.length} update + ${dels.length} delete → ${resultado}`);
        continue;
      }
      console.log(`  commit() alcanzado · ops=${ops.length}: ${sets.length} create movimientos, ${upds.length} update, ${dels.length} delete`);

      // ── §2.3 cuadre ──
      const cu = RT.calcularCuadre(v.lineas, resumen.totalARS, resumen.totalUSD, resumen.ajustesConsolidado, resumen);
      const umbralARS = cu.objetivoARS > 0 ? Math.max(10, cu.objetivoARS * 0.0001) : 10;
      const totARSMov = sets.find(o => o.data?.excluirDash === true && o.data?.moneda === 'ARS')?.data?.monto;
      const totUSDMov = sets.find(o => o.data?.excluirDash === true && o.data?.moneda === 'USD')?.data?.monto;
      console.log('  --- §2.3 cuadre (calcularCuadre real, con los ajustes guardados) ---');
      console.log(`  ARS: totalARS PDF=${ars(resumen.totalARS)} · noDebitadoARS=${ars(cu.noDebitadoARS)} · objetivoARS=${ars(cu.objetivoARS)} · sumaARS=${ars(cu.sumaARS)} · diff=${ars(cu.diffARS)} (umbral ${ars(umbralARS)}) · balance=${cu.balanceARS}`);
      console.log(`       totalARSMov = Math.max(objetivoARS, 0) = ${s(totARSMov)}`);
      console.log(`  USD: totalUSD PDF=${resumen.totalUSD} · noDebitadoUSD=${cu.noDebitadoUSD} · objetivoUSD=${cu.objetivoUSD} · sumaUSD=${+cu.sumaUSD.toFixed(2)} · diff=${+cu.diffUSD.toFixed(2)} · balance=${cu.balanceUSD}`);
      console.log(`       totalUSDMov = Math.max(objetivoUSD, 0) = Math.max(${cu.objetivoUSD}, 0) = ${s(totUSDMov)}`);
      console.log(`  rama \`totalUSD === 0\` de resumenesTarjeta.ts:253 (ahí totalUSD ya es el objetivo neto): ` +
        (cu.objetivoUSD === 0
          ? `SÍ, el balanceUSD salió por ahí · sin esa rama: diffUSD ${+cu.diffUSD.toFixed(2)} ${cu.diffUSD <= 1 ? '<= 1 → habría pasado igual' : '> 1 → habría fallado'}`
          : `NO — objetivoUSD=${cu.objetivoUSD}; balanceUSD salió por diffUSD ${+cu.diffUSD.toFixed(2)} <= 1`));
      console.log(`  decisión ajustes (F9.163): ${JSON.stringify(cu.decisionAjustes)}`);
      // De dónde sale el ajuste manual: el mismo cuadre sin él, con estas líneas y con las guardadas.
      const sinManual = resumen.ajustesConsolidado.filter(a => a.origen !== 'manual');
      if (sinManual.length < resumen.ajustesConsolidado.length) {
        const casos: Array<[string, MovimientoParseado[]]> = [['estas líneas', v.lineas], ['las 43 guardadas (reverso tildado)', lineasUI(M)]];
        for (const [nom, ls] of casos) {
          const c0 = RT.calcularCuadre(ls, resumen.totalARS, resumen.totalUSD, sinManual, resumen);
          console.log(`  sin el ajuste manual, ${nom}: ARS diff=${ars(c0.diffARS)} balance=${c0.balanceARS} · ` +
            `USD sumaUSD=${+c0.sumaUSD.toFixed(2)} vs objetivo ${c0.objetivoUSD} diff=${+c0.diffUSD.toFixed(2)} balance=${c0.balanceUSD}`);
        }
      }

      // ── §2.4 reglas por payload ──
      console.log(`  --- §2.4 firestore.rules${lineaRegla('allow create: if esMiembro()')}-${lineaRegla('data.descripcion.size() > 0').slice(1)} por payload ` +
        `(auth: email_verified, autorizados rol=${s(u.auth.autorizado?.rol)} memberId=${s(u.auth.autorizado?.memberId)}) ---`);
      for (const f of filas) console.log(f);
      console.log(`  resultado: ${resultado}`);
    }
    console.log('');
  }

  // ════ §2.5 — alcance: qué otros resúmenes chocan con la misma regla ════
  console.log('=== §2.5 Alcance: resúmenes cuyo movimiento-total saldría en 0 (objetivo neto <= 0 en alguna moneda) ===');
  console.log('  (totalesNetos real sobre las líneas guardadas; el estado dice si ya pasaron por otro camino)');
  const choca = todos
    .map(({ r }) => ({ r, n: RT.totalesNetos(r.movimientosParseados, r.totalARS, r.totalUSD) }))
    .filter(({ n }) => n.objetivoARS <= 0 || n.objetivoUSD <= 0)
    .sort((a, b) => a.r.periodo.localeCompare(b.r.periodo) || s(a.r.tarjetaCodigo).localeCompare(s(b.r.tarjetaCodigo)));
  for (const { r, n } of choca) {
    console.log(`  ${h8(r.id)} ${s(r.tarjetaCodigo).padEnd(10)} periodo=${s(r.periodo).padEnd(8)} estado=${r.estado.padEnd(10)} objetivoARS=${n.objetivoARS} objetivoUSD=${n.objetivoUSD}`);
  }
  const porEstado: Record<string, number> = {};
  for (const { r } of choca) porEstado[r.estado] = (porEstado[r.estado] ?? 0) + 1;
  console.log(`  total: ${choca.length} de ${todos.length} · por estado: ${JSON.stringify(porEstado)}\n`);

  console.log('§3 (emulador) no se corre: §2 encontró el payload que viola la regla.');
  console.log('nota: el comentario de resumenesTarjeta.ts:394/:399 cita firestore.rules:74 (delete) y :62 (monto > 0);');
  console.log(`      en el archivo actual son ${lineaRegla('allow delete: if false')} y ${lineaRegla('data.monto > 0')}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
