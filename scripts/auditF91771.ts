// F9.177.1 §1 — inventario de fuentes de log. SOLO LECTURA.
//
// No habilita NADA. Cada sonda solo LEE, y distingue tres respuestas que no son lo mismo:
//   · SERVICE_DISABLED      → la API está apagada en el proyecto
//   · PERMISSION_DENIED     → existe y está prendida, pero esta service account no puede leerla
//   · 200 con 0 resultados  → prendida, legible y vacía
// Esa distinción es el punto del prompt: "cada fuente apagada figura como apagada, no como
// 'sin resultados'".
//
// Privacidad: UIDs a 8 caracteres, IPs a /24, sin emails ni tokens.
import { GoogleAuth } from 'google-auth-library';
import { readFileSync } from 'node:fs';

const SA = './secrets/serviceAccountKey.json';
const PROJECT = (JSON.parse(readFileSync(SA, 'utf8')) as { project_id: string }).project_id;
const SITIO = 'gastos-familiares-jmsf';
const DESDE = '2026-09-12T00:00:00Z';
const REGION = 'southamerica-east1';

export type Estado = 'APAGADA' | 'SIN-PERMISO' | 'OK-VACÍA' | 'OK-CON-DATOS' | 'NO-EXISTE' | 'ERROR';

export interface Sonda {
  fuente: string;
  estado: Estado;
  detalle: string;
  datos?: unknown;
}

const auth = new GoogleAuth({ keyFile: SA, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

/** Clasifica el error de Google en una de las tres respuestas que importan. */
function clasificar(e: unknown): { estado: Estado; detalle: string } {
  const err = e as { response?: { status?: number; data?: { error?: { message?: string; status?: string; details?: unknown[] } } }; message?: string };
  const status = err.response?.status;
  const g = err.response?.data?.error;
  const msg = (g?.message ?? err.message ?? String(e)).slice(0, 220);
  if (g?.status === 'PERMISSION_DENIED' || status === 403) {
    // Google usa 403 para las dos cosas; el texto las separa.
    if (/has not been used|is disabled|SERVICE_DISABLED|not enabled/i.test(msg)) {
      return { estado: 'APAGADA', detalle: msg };
    }
    return { estado: 'SIN-PERMISO', detalle: msg };
  }
  if (status === 404) return { estado: 'NO-EXISTE', detalle: msg };
  return { estado: 'ERROR', detalle: `HTTP ${status ?? '?'} — ${msg}` };
}

async function pedir<T>(url: string, method: 'GET' | 'POST' = 'GET', data?: unknown): Promise<T> {
  const client = await auth.getClient();
  const res = await client.request<T>({ url, method, data });
  return res.data;
}

async function sonda<T>(fuente: string, fn: () => Promise<T>, resumir: (d: T) => { estado: Estado; detalle: string; datos?: unknown }): Promise<Sonda> {
  try {
    const d = await fn();
    return { fuente, ...resumir(d) };
  } catch (e) {
    return { fuente, ...clasificar(e) };
  }
}

// ── Utilidades de privacidad ────────────────────────────────────────────────
const uid8 = (s: unknown) => (s ? String(s).slice(0, 8) + '…' : '-');
const ip24 = (s: unknown) => {
  const t = String(s ?? '');
  const m = /^(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(t);
  return m ? `${m[1]}.${m[2]}.${m[3]}.0/24` : (t.includes(':') ? 'IPv6/…' : '-');
};
const fecha = (iso?: string) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') : '-');

// ── §1.0 — Qué APIs están prendidas ─────────────────────────────────────────
async function apisPrendidas() {
  type R = { services?: Array<{ config?: { name?: string } }> };
  const d = await pedir<R>(`https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services?filter=state:ENABLED&pageSize=200`);
  return (d.services ?? []).map(s => s.config?.name ?? '').filter(Boolean).sort();
}

// ── §1.1 y §1.5 y §1.7 — Cloud Logging ──────────────────────────────────────
async function logs(filtro: string, pageSize = 50) {
  type R = { entries?: Array<Record<string, unknown>> };
  return pedir<R>('https://logging.googleapis.com/v2/entries:list', 'POST', {
    resourceNames: [`projects/${PROJECT}`],
    filter: filtro,
    orderBy: 'timestamp desc',
    pageSize,
  });
}

// ── §1.2 — Releases de Hosting ──────────────────────────────────────────────
async function releases() {
  type R = { releases?: Array<{ name?: string; releaseTime?: string; releaseUser?: { email?: string }; type?: string; version?: { name?: string; status?: string; createTime?: string } }> };
  return pedir<R>(`https://firebasehosting.googleapis.com/v1beta1/sites/${SITIO}/releases?pageSize=40`);
}

// ── §1.3 — Cloud Run ────────────────────────────────────────────────────────
async function cloudRun() {
  type R = { services?: Array<{ name: string; updateTime?: string }> };
  return pedir<R>(`https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services?pageSize=200`);
}

// ── §1.4 — ¿Están prendidos los Data Access audit logs? ─────────────────────
async function auditConfig() {
  type R = { auditConfigs?: Array<{ service?: string; auditLogConfigs?: Array<{ logType?: string }> }> };
  return pedir<R>(`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:getIamPolicy`, 'POST', {});
}

// ── §1.6 — Cloud Monitoring ─────────────────────────────────────────────────
async function serie(metrica: string) {
  type R = { timeSeries?: Array<{ points?: Array<{ interval?: { endTime?: string }; value?: Record<string, unknown> }> }> };
  const url = new URL(`https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries`);
  url.searchParams.set('filter', `metric.type="${metrica}"`);
  url.searchParams.set('interval.startTime', DESDE);
  url.searchParams.set('interval.endTime', new Date().toISOString());
  url.searchParams.set('aggregation.alignmentPeriod', '86400s');
  url.searchParams.set('aggregation.perSeriesAligner', 'ALIGN_SUM');
  url.searchParams.set('aggregation.crossSeriesReducer', 'REDUCE_SUM');
  return pedir<R>(url.toString());
}

async function main() {
  console.log(`F9.177.1 §1 — inventario de fuentes de log (${PROJECT}). SOLO LECTURA, no se habilitó nada.\n`);
  const resultados: Sonda[] = [];

  // ── APIs prendidas ────────────────────────────────────────────────────────
  const sApis = await sonda('APIs habilitadas (serviceusage)', apisPrendidas, d => ({
    estado: d.length ? 'OK-CON-DATOS' as const : 'OK-VACÍA' as const,
    detalle: `${d.length} APIs habilitadas`,
    datos: d,
  }));
  resultados.push(sApis);
  const apis = (sApis.datos as string[] | undefined) ?? [];
  const tiene = (n: string) => apis.some(a => a.includes(n));
  if (apis.length) {
    console.log('══ APIs habilitadas, las que importan acá ══\n');
    for (const n of ['logging', 'monitoring', 'run.googleapis', 'cloudfunctions', 'firebasehosting', 'identitytoolkit', 'storage', 'firestore', 'cloudresourcemanager', 'serviceusage']) {
      const m = apis.filter(a => a.includes(n));
      console.log(`  ${n.padEnd(22)} ${m.length ? '✓ ' + m.join(', ') : '✗ no aparece'}`);
    }
    console.log('');
  }

  // ── §1.1 Hosting requests ────────────────────────────────────────────────
  resultados.push(await sonda(
    '§1.1 Hosting → Cloud Logging (requests)',
    () => logs(`logName="projects/${PROJECT}/logs/firebasehosting.googleapis.com%2Frequests" AND timestamp>="${DESDE}"`, 200),
    d => {
      const e = d.entries ?? [];
      if (!e.length) return { estado: 'OK-VACÍA', detalle: 'La integración Hosting→Cloud Logging NO está activada, o no registró nada desde el 12/9. Sin entradas no se puede distinguir; ver nota.' };
      return { estado: 'OK-CON-DATOS', detalle: `${e.length} requests desde el 12/9`, datos: e };
    },
  ));

  // ── §1.2 Releases ─────────────────────────────────────────────────────────
  resultados.push(await sonda('§1.2 Hosting → releases', releases, d => {
    const r = (d.releases ?? []).filter(x => (x.releaseTime ?? '') >= DESDE);
    return { estado: r.length ? 'OK-CON-DATOS' : 'OK-VACÍA', detalle: `${r.length} releases desde el 12/9 (de ${(d.releases ?? []).length} traídos)`, datos: r };
  }));

  // ── §1.3 Cloud Run ────────────────────────────────────────────────────────
  resultados.push(await sonda('§1.3 Cloud Run (deploy de functions)', cloudRun, d => {
    const s = d.services ?? [];
    return { estado: s.length ? 'OK-CON-DATOS' : 'OK-VACÍA', detalle: `${s.length} servicios`, datos: s };
  }));

  // ── §1.4 Data Access audit logs de Storage ───────────────────────────────
  resultados.push(await sonda('§1.4 Data Access audit logs (config)', auditConfig, d => {
    const cfg = d.auditConfigs ?? [];
    if (!cfg.length) return { estado: 'APAGADA', detalle: 'La política IAM del proyecto no tiene auditConfigs: los Data Access audit logs están APAGADOS (default de GCP).' };
    return { estado: 'OK-CON-DATOS', detalle: cfg.map(c => `${c.service}:${(c.auditLogConfigs ?? []).map(x => x.logType).join('|')}`).join(' · '), datos: cfg };
  }));

  resultados.push(await sonda(
    '§1.4 Storage — audit logs de datos',
    () => logs(`protoPayload.serviceName="storage.googleapis.com" AND timestamp>="${DESDE}"`, 50),
    d => {
      const e = d.entries ?? [];
      return { estado: e.length ? 'OK-CON-DATOS' : 'OK-VACÍA', detalle: `${e.length} entradas`, datos: e };
    },
  ));

  // ── §1.5 Auth ─────────────────────────────────────────────────────────────
  resultados.push(await sonda(
    '§1.5 Identity Toolkit / Auth',
    () => logs(`(protoPayload.serviceName="identitytoolkit.googleapis.com" OR resource.type="identitytoolkit_project" OR resource.type="audited_resource") AND timestamp>="${DESDE}"`, 50),
    d => {
      const e = d.entries ?? [];
      return { estado: e.length ? 'OK-CON-DATOS' : 'OK-VACÍA', detalle: `${e.length} entradas`, datos: e };
    },
  ));

  // ── §1.6 Monitoring ───────────────────────────────────────────────────────
  for (const [nombre, metrica] of [
    ['§1.6 Storage — requests/día', 'storage.googleapis.com/api/request_count'],
    ['§1.6 Firestore — writes/día', 'firestore.googleapis.com/document/write_count'],
    ['§1.6 Firestore — reads/día', 'firestore.googleapis.com/document/read_count'],
  ] as const) {
    resultados.push(await sonda(nombre, () => serie(metrica), d => {
      const pts = (d.timeSeries ?? []).flatMap(t => t.points ?? []);
      return { estado: pts.length ? 'OK-CON-DATOS' : 'OK-VACÍA', detalle: `${pts.length} puntos diarios`, datos: pts };
    }));
  }

  // ── §1.7 Barrido general ──────────────────────────────────────────────────
  resultados.push(await sonda(
    '§1.7 Barrido 18/9–20/9 (cualquier recurso)',
    () => logs('timestamp>="2026-09-18T00:00:00Z" AND timestamp<="2026-09-21T00:00:00Z"', 200),
    d => {
      const e = d.entries ?? [];
      return { estado: e.length ? 'OK-CON-DATOS' : 'OK-VACÍA', detalle: `${e.length} entradas`, datos: e };
    },
  ));
  resultados.push(await sonda(
    '§1.7 Barrido "share-target" / "entrantes" (todo el tiempo)',
    () => logs('(textPayload:"share-target" OR jsonPayload.message:"share-target" OR httpRequest.requestUrl:"share-target" OR textPayload:"entrantes")', 100),
    d => {
      const e = d.entries ?? [];
      return { estado: e.length ? 'OK-CON-DATOS' : 'OK-VACÍA', detalle: `${e.length} entradas`, datos: e };
    },
  ));

  // ── Tabla ─────────────────────────────────────────────────────────────────
  console.log('══ Tabla de fuentes ══\n');
  const w = Math.max(...resultados.map(r => r.fuente.length));
  for (const r of resultados) {
    console.log(`  ${r.fuente.padEnd(w)}  ${r.estado.padEnd(12)}  ${r.detalle.slice(0, 150)}`);
  }

  // ── Detalle de lo que tuvo datos ──────────────────────────────────────────
  const rel = resultados.find(r => r.fuente.startsWith('§1.2'));
  if (rel?.datos) {
    console.log('\n══ §1.2 — Releases de Hosting desde el 12/9 ══\n');
    for (const x of rel.datos as Array<Record<string, any>>) {
      console.log(`  ${fecha(x.releaseTime)}  tipo=${x.type ?? '-'}  version=${String(x.version?.name ?? '').split('/').pop()}  estado=${x.version?.status ?? '-'}  por=${x.releaseUser?.email ? uid8(x.releaseUser.email) : '-'}`);
    }
  }
  const run = resultados.find(r => r.fuente.startsWith('§1.3'));
  if (run?.datos) {
    console.log('\n══ §1.3 — Cloud Run: último deploy por servicio ══\n');
    const de = ['routearentrante', 'extraercomprobante', 'reintentarcomprobante', 'matchcomprobante', 'cargarmovimientodesdecomprobante'];
    const svcs = (run.datos as Array<{ name: string; updateTime?: string }>).map(s => ({ n: (s.name.split('/').pop() ?? '').toLowerCase(), t: s.updateTime }));
    for (const s of svcs.filter(s => de.includes(s.n)).sort((a, b) => a.n.localeCompare(b.n))) console.log(`  ${s.n.padEnd(34)} ${fecha(s.t)}`);
    console.log(`  ${'(último de CUALQUIER function)'.padEnd(34)} ${fecha(svcs.map(s => s.t ?? '').sort().pop())}`);
  }
  for (const clave of ['§1.6 Storage', '§1.6 Firestore — writes']) {
    const m = resultados.find(r => r.fuente.startsWith(clave));
    if (!m?.datos) continue;
    console.log(`\n══ ${m.fuente} ══\n`);
    const pts = (m.datos as Array<{ interval?: { endTime?: string }; value?: Record<string, unknown> }>);
    for (const p of pts.slice().reverse()) {
      const v = Object.values(p.value ?? {})[0];
      console.log(`  ${String(p.interval?.endTime ?? '').slice(0, 10)}  ${String(v)}`);
    }
  }
  const hosting = resultados.find(r => r.fuente.startsWith('§1.1'));
  if (hosting?.datos) {
    console.log('\n══ §1.1 — Requests a Hosting ══\n');
    for (const e of (hosting.datos as Array<Record<string, any>>).slice(0, 60)) {
      const h = e.httpRequest ?? {};
      console.log(`  ${fecha(e.timestamp)}  ${String(h.requestMethod ?? '-').padEnd(5)} ${String(h.status ?? '-').padEnd(4)} ${String(h.requestUrl ?? '-').slice(0, 60).padEnd(60)} ${ip24(h.remoteIp)}  ${String(h.userAgent ?? '-').slice(0, 40)}`);
    }
  }
  for (const clave of ['§1.5', '§1.7']) {
    for (const m of resultados.filter(r => r.fuente.startsWith(clave) && r.datos)) {
      console.log(`\n══ ${m.fuente} ══\n`);
      for (const e of (m.datos as Array<Record<string, any>>).slice(0, 40)) {
        console.log(`  ${fecha(e.timestamp)}  ${e.severity ?? '-'}  ${e.resource?.type ?? '-'}  ${String(e.protoPayload?.methodName ?? e.textPayload ?? e.jsonPayload?.message ?? '').slice(0, 90)}`);
      }
    }
  }
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
