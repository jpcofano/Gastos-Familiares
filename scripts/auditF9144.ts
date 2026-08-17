// F9.144 §0.4 — medición previa obligatoria. SOLO LEE.
//
// Cuántas posiciones de la corrida vigente tienen indicador y cuántas no, por `motivo`. Ese número
// dice cuánta ficha se va a ver realmente. También verifica el caso GLOB (dos identidades, dos
// documentos) que es el criterio de §6 para probar que el lector indexa por tripleta y no por ticker.
//
// Uso: npx tsx scripts/auditF9144.ts
import { getDb } from './seed/utils/firestore';

const clave = (t: string, tipo: string, pais: string) => `${t}|${tipo}|${pais}`;

async function main() {
  const db = getDb('production');

  const snapPort = await db.collection('snapshotsPortafolio').orderBy('fechaCorrida', 'desc').limit(1).get();
  const fechaCorrida = (snapPort.docs[0].data() as any).fechaCorrida;
  const posSnap = await db.collection('posicionesPatrimonio').where('fechaCorrida', '==', fechaCorrida).get();
  const manSnap = await db.collection('posicionesManuales').get();

  const posiciones = [
    ...posSnap.docs.map(d => { const p = d.data() as any; return { ticker: p.ticker, tipo: p.tipo, pais: p.pais_riesgo, cuenta: p.cuenta, valorUsd: p.valorUsd, origen: 'corrida' }; }),
    ...manSnap.docs.map(d => { const m = d.data() as any; return { ticker: m.ticker, tipo: m.tipo, pais: m.pais_riesgo, cuenta: m.cuenta, valorUsd: m.valorUsd, origen: 'manual' }; }),
  ];

  const indSnap = await db.collection('indicadoresPosicion').get();
  const porIdentidad = new Map<string, any>();
  for (const d of indSnap.docs) {
    const x = d.data() as any;
    porIdentidad.set(clave(x.ticker, x.tipo, x.paisRiesgo), { ...x, docId: x.docId ?? d.id });
  }

  console.log(`corrida vigente: ${fechaCorrida}`);
  console.log(`posiciones: ${posiciones.length} (${posSnap.size} de corrida + ${manSnap.size} manuales)`);
  console.log(`documentos en indicadoresPosicion: ${indSnap.size}`);

  // Identidades únicas: la ficha se muestra por ticker consolidado en TenenciasTab, pero el
  // indicador se busca por tripleta. Contar las dos cosas.
  const identidades = new Map<string, { pos: any[]; ind: any | null }>();
  for (const p of posiciones) {
    const k = clave(p.ticker, p.tipo, p.pais);
    if (!identidades.has(k)) identidades.set(k, { pos: [], ind: porIdentidad.get(k) ?? null });
    identidades.get(k)!.pos.push(p);
  }
  console.log(`identidades distintas (ticker|tipo|pais): ${identidades.size}`);
  console.log(`tickers distintos: ${new Set(posiciones.map(p => p.ticker)).size}`);

  const con = [...identidades.entries()].filter(([, v]) => v.ind);
  const sin = [...identidades.entries()].filter(([, v]) => !v.ind);
  console.log(`\n── CON indicador: ${con.length}/${identidades.size}`);
  console.log(`── SIN documento : ${sin.length}/${identidades.size}`);

  const porMotivo = new Map<string, string[]>();
  for (const [k, v] of con) {
    const m = v.ind.motivo ?? '(null — tiene datos)';
    if (!porMotivo.has(m)) porMotivo.set(m, []);
    porMotivo.get(m)!.push(k);
  }
  console.log('\n── por `motivo` (de los que TIENEN documento)');
  for (const [m, ks] of [...porMotivo.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`   ${String(ks.length).padStart(3)}  ${m}`);
    console.log(`        ${ks.map(k => k.split('|')[0]).join(', ')}`);
  }
  if (sin.length) {
    console.log('\n── SIN documento en indicadoresPosicion');
    console.log(`        ${sin.map(([k]) => k).join(', ')}`);
  }

  const conDatos = con.filter(([, v]) => v.ind.motivo === null || v.ind.motivo === undefined);
  console.log('\n── por `estadoSerie` (de los que tienen datos reales)');
  const porEstado = new Map<string, number>();
  for (const [, v] of conDatos) porEstado.set(v.ind.estadoSerie, (porEstado.get(v.ind.estadoSerie) ?? 0) + 1);
  for (const [e, n] of porEstado) console.log(`   ${String(n).padStart(3)}  ${e}`);

  console.log('\n── cobertura de indicadores clave (sobre los que tienen datos)');
  const campos = ['precio', 'sma20', 'sma50', 'sma200', 'max52s', 'perf1a', 'rsi14', 'atrPct', 'ruedasParaSalir', 'montoOperadoProm30d', 'pesoEnCartera'];
  for (const c of campos) {
    const n = conDatos.filter(([, v]) => v.ind[c] !== null && v.ind[c] !== undefined).length;
    console.log(`   ${c.padEnd(20)} ${String(n).padStart(3)}/${conDatos.length}`);
  }

  console.log('\n── PUNTOS DISPONIBLES');
  const pts = conDatos.map(([k, v]) => ({ k, p: v.ind.puntosDisponibles, e: v.ind.estadoSerie }))
    .sort((a, b) => a.p - b.p);
  for (const x of pts) console.log(`   ${String(x.p).padStart(4)}  ${x.e.padEnd(11)}  ${x.k}`);

  // §6 — el caso GLOB: dos identidades, dos documentos, dos monedas de serie.
  console.log('\n── CASO GLOB (criterio de §6)');
  const globs = [...identidades.entries()].filter(([k]) => k.startsWith('GLOB|'));
  if (globs.length === 0) console.log('   GLOB no está en la corrida vigente.');
  for (const [k, v] of globs) {
    console.log(`   ${k}`);
    console.log(`     posiciones: ${v.pos.map((p: any) => `${p.cuenta} (USD ${Math.round(p.valorUsd)})`).join(' · ')}`);
    console.log(`     indicador : ${v.ind ? `docId=${v.ind.docId} moneda=${v.ind.monedaSerie} precio=${v.ind.precio} puntos=${v.ind.puntosDisponibles} estado=${v.ind.estadoSerie}` : 'SIN DOCUMENTO'}`);
  }

  // Semáforos realmente presentes: la ficha pinta lo que trae, así que conviene saber qué trae.
  console.log('\n── CLAVES DE `semaforos` presentes');
  const claves = new Map<string, Map<string, number>>();
  for (const [, v] of conDatos) {
    for (const [c, s] of Object.entries(v.ind.semaforos ?? {})) {
      if (!claves.has(c)) claves.set(c, new Map());
      const m = claves.get(c)!;
      m.set(s as string, (m.get(s as string) ?? 0) + 1);
    }
  }
  for (const [c, m] of claves) {
    console.log(`   ${c.padEnd(22)} ${[...m.entries()].map(([s, n]) => `${s}=${n}`).join(' ')}`);
  }

  console.log('\n── ACN (control de serie sana, §6)');
  const acn = [...identidades.entries()].find(([k]) => k.startsWith('ACN|'));
  if (acn) {
    const v = acn[1].ind;
    console.log(`   ${acn[0]}: ${v ? `puntos=${v.puntosDisponibles} estado=${v.estadoSerie} precio=${v.precio} (${v.fechaUltimoPrecio}) moneda=${v.monedaSerie}` : 'SIN DOCUMENTO'}`);
  } else console.log('   ACN no está en la corrida.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
