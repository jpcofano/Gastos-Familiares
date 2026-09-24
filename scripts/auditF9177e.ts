// F9.177 §3.1 — ¿las functions desplegadas son las del repo?
// Dos vías: (a) la fecha de despliegue real, vía la API de Cloud Run (las functions v2 son
// servicios de Cloud Run); (b) la prueba de comportamiento: si en producción hay comprobantes
// con `propuestaMatch.medioIdPrellena`, el `matchComprobante` desplegado YA tiene F9.176.
// SOLO LECTURA.
import { initializeApp, cert, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';
import { readFileSync } from 'node:fs';

const SA = './secrets/serviceAccountKey.json';
if (getApps().length === 0) initializeApp({ credential: cert(SA) });
const db = getFirestore();
void applicationDefault;

const REGION = 'southamerica-east1';
const dia = (t: unknown) => (t instanceof Timestamp ? new Date(t.toMillis() - 3 * 3600_000).toISOString().slice(0, 10) : null);
const h8 = (s: unknown) => (s ? String(s).slice(0, 8) : '-');
const fechaCorta = (iso?: string) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') : '-');

async function fechasDeDespliegue(project: string) {
  const auth = new GoogleAuth({ keyFile: SA, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const url = `https://run.googleapis.com/v2/projects/${project}/locations/${REGION}/services?pageSize=200`;
  const res = await client.request<{ services?: Array<{ name: string; updateTime?: string; createTime?: string }> }>({ url });
  return (res.data.services ?? []).map(s => ({
    nombre: s.name.split('/').pop() ?? s.name,
    actualizado: s.updateTime,
    creado: s.createTime,
  }));
}

async function main() {
  const project = (JSON.parse(readFileSync(SA, 'utf8')) as { project_id: string }).project_id;
  console.log(`F9.177 §3.1 — deploy de functions vs repo (${project}). SOLO LECTURA.\n`);

  // ── (a) Fecha real de despliegue ─────────────────────────────────────────
  const DE_INTERES = ['routearentrante', 'extraercomprobante', 'reintentarcomprobante', 'matchcomprobante', 'cargarmovimientodesdecomprobante'];
  try {
    const svcs = await fechasDeDespliegue(project);
    console.log(`══ Cloud Run: ${svcs.length} servicios en ${REGION} ══\n`);
    const rel = svcs.filter(s => DE_INTERES.includes(s.nombre.toLowerCase())).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
    for (const s of rel) console.log(`  ${s.nombre.padEnd(34)} actualizado ${fechaCorta(s.actualizado)}   creado ${fechaCorta(s.creado)}`);
    const ultima = svcs.map(s => s.actualizado ?? '').sort().pop();
    console.log(`\n  último deploy de CUALQUIER function: ${fechaCorta(ultima)}`);
  } catch (e) {
    console.log(`  (no se pudo leer Cloud Run: ${(e as Error).message.slice(0, 120)})`);
  }

  // ── (b) Prueba de comportamiento: ¿el match desplegado tiene F9.176? ─────
  console.log('\n══ ¿El matchComprobante desplegado tiene F9.176? ══\n');
  const comps = await db.collection('comprobantes').get();
  const conMedio = comps.docs.filter(c => (c.data().propuestaMatch as Record<string, unknown> | undefined)?.medioIdPrellena);
  console.log(`  comprobantes con propuestaMatch.medioIdPrellena (campo que SOLO escribe F9.176): ${conMedio.length}`);
  for (const c of conMedio) {
    const p = c.data().propuestaMatch as Record<string, unknown>;
    console.log(`    ${h8(c.id)}  calculado=${dia(p.calculadoEn)}  rama=${p.rama}`);
  }

  // Cuándo fue el último match calculado: si es anterior al deploy, nada lo ejercitó todavía.
  const calculos = comps.docs
    .map(c => dia((c.data().propuestaMatch as Record<string, unknown> | undefined)?.calculadoEn))
    .filter((x): x is string => !!x)
    .sort();
  console.log(`\n  último propuestaMatch.calculadoEn de toda la colección: ${calculos[calculos.length - 1] ?? '-'}`);
  console.log(`  (si es anterior al deploy, ningún comprobante ejercitó el código nuevo todavía)`);

  const destinos = await db.collection('destinos').get();
  const conRol = destinos.docs.filter(d => d.data().rol);
  console.log(`\n  destinos con rol declarado (lo que F9.176 habilita): ${conRol.length} de ${destinos.size}`);
  for (const d of conRol) console.log(`    ${h8(d.id)} tipo=${d.data().tipo} rol=${d.data().rol} medioId=${d.data().medioId ?? '-'}`);
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
