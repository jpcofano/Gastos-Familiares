// F9.111 — Gate de datos obligatorio antes de mergear la Parte 2 (coincideToken con límite
// de palabra). Compara, para cada ítem con matchTexto y cada movimiento de los últimos 6
// meses, el resultado del includes() crudo viejo contra coincideToken() nuevo (límite de
// palabra + largo mínimo 3). Solo lee — nunca escribe.
//
// Salida en dos bloques:
//   PIERDE — matcheaba con includes() y deja de matchear con coincideToken().
//            Esperado: solo falsos positivos (tokens anchos tipo 'glob' contra el Bodegón).
//            Cualquier pérdida legítima se corrige ajustando el token en Config → Esperados
//            ANTES de mergear la Parte 2, no relajando coincideToken().
//   GANA   — no matcheaba antes y ahora sí. No debería haber ninguno (coincideToken es un
//            subconjunto estricto de includes(): todo lo que matchea con límite de palabra
//            también matchea como substring crudo).
// Más una lista aparte de ítems con TODOS sus tokens de `incluye` por debajo del largo mínimo
// (fallback: en puntajeReclamo/checklist.ts esos ítems caen a categoría+subcategoría).
//
// Uso:
//   tsx scripts/auditarTokens.ts                       (emulador)
//   tsx scripts/auditarTokens.ts --target=production    (producción, solo lectura)

import { getDb } from './seed/utils/firestore';

// ── coincideToken — copia deliberada de src/datos/checklist.ts / functions/src/matchLogica.ts.
// Sync manual si cambia cualquiera de las tres: es el mismo caso documentado del normalizador
// (docs/CLAUDE.md, "Reglas operativas") — paquetes independientes, no se importan cruzados.
const LARGO_MINIMO_TOKEN = 3;
const esAlfanum = (c: string) => /[\p{L}\p{N}]/u.test(c);

function coincideToken(texto: string, patron: string): boolean {
  const p = patron.trim().toLowerCase();
  if (p.length < LARGO_MINIMO_TOKEN) return false;
  const t = texto.toLowerCase();
  for (let i = t.indexOf(p); i !== -1; i = t.indexOf(p, i + 1)) {
    const antes = i === 0 ? '' : t[i - 1];
    const desp = t[i + p.length] ?? '';
    if ((!antes || !esAlfanum(antes)) && (!desp || !esAlfanum(desp))) return true;
  }
  return false;
}

function incluyeCrudo(texto: string, patron: string): boolean {
  return texto.toLowerCase().includes(patron.trim().toLowerCase());
}

function ultimosNMeses(n: number): Set<string> {
  // Día fijo en 1 antes de restar meses — con el día real (ej. 30/31) `setMonth` puede
  // desbordar en meses cortos (30 de julio − 5 meses cae en 28+2 de febrero → rebota a
  // marzo) y saltearse un mes entero en silencio.
  const out = new Set<string>();
  const base = new Date();
  base.setDate(1);
  for (let i = 0; i < n; i++) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    out.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

interface ItemMin { id: string; etiqueta: string; incluye: string[]; excluye: string[] }
interface MovMin { id: string; descripcion: string; mes: string }

function parseFlags(): 'emulator' | 'production' {
  return process.argv.includes('--target=production') ? 'production' : 'emulator';
}

async function main() {
  const target = parseFlags();
  console.log(`\nAUDITORÍA DE TOKENS (matchTexto) — target=${target}, solo lectura\n`);

  const db = getDb(target);

  const [itemsSnap, movsSnap] = await Promise.all([
    db.collection('itemsEsperados').get(),
    db.collection('movimientos').get(),
  ]);

  const meses = ultimosNMeses(6);
  console.log(`  Meses considerados: ${[...meses].sort().join(', ')}`);

  const items: ItemMin[] = itemsSnap.docs
    .map(doc => {
      const d = doc.data();
      const mt = d.matchTexto as { incluye?: string[]; excluye?: string[] } | null | undefined;
      const etiqueta = [d.categoria, d.subcategoria].filter(Boolean).join(' › ') || d.notas || doc.id;
      return { id: doc.id, etiqueta, incluye: mt?.incluye ?? [], excluye: mt?.excluye ?? [] };
    })
    .filter(i => i.incluye.length > 0);
  console.log(`  Ítems con matchTexto: ${items.length}`);

  const movs: MovMin[] = movsSnap.docs
    .map(doc => {
      const d = doc.data();
      return { id: doc.id, descripcion: (d.descripcion as string) ?? '', mes: (d.mes as string) ?? '' };
    })
    .filter(m => meses.has(m.mes));
  console.log(`  Movimientos en ventana: ${movs.length}\n`);

  interface Diff { itemId: string; etiqueta: string; movId: string; descripcion: string; token: string }
  const pierde: Diff[] = [];
  const gana: Diff[] = [];

  for (const item of items) {
    for (const m of movs) {
      const desc = m.descripcion.toLowerCase();

      const incCrudo = item.incluye.some(t => incluyeCrudo(desc, t));
      const excCrudo = item.excluye.some(t => incluyeCrudo(desc, t));
      const matcheabaAntes = incCrudo && !excCrudo;

      const incNuevo = item.incluye.some(t => coincideToken(desc, t));
      const excNuevo = item.excluye.some(t => coincideToken(desc, t));
      const matcheaAhora = incNuevo && !excNuevo;

      if (matcheabaAntes && !matcheaAhora) {
        const token = item.incluye.find(t => incluyeCrudo(desc, t)) ?? '?';
        pierde.push({ itemId: item.id, etiqueta: item.etiqueta, movId: m.id, descripcion: m.descripcion, token });
      } else if (!matcheabaAntes && matcheaAhora) {
        const token = item.incluye.find(t => coincideToken(desc, t)) ?? '?';
        gana.push({ itemId: item.id, etiqueta: item.etiqueta, movId: m.id, descripcion: m.descripcion, token });
      }
    }
  }

  console.log(`── PIERDE (${pierde.length}) — matcheaba con includes() crudo, deja de matchear ──`);
  for (const d of pierde) {
    console.log(`  [${d.etiqueta}] token="${d.token}"  mov ${d.movId}  "${d.descripcion.slice(0, 60)}"`);
  }

  console.log(`\n── GANA (${gana.length}) — no matcheaba antes, matchea ahora (NO debería haber ninguno) ──`);
  for (const d of gana) {
    console.log(`  [${d.etiqueta}] token="${d.token}"  mov ${d.movId}  "${d.descripcion.slice(0, 60)}"`);
  }
  if (gana.length > 0) {
    console.log('\n  ⚠ coincideToken() debería ser un subconjunto estricto de includes() crudo.');
    console.log('    Si aparece algo acá, hay un bug en coincideToken(), no en los datos.');
  }

  const soloCortos = items.filter(i => i.incluye.every(t => t.trim().length < LARGO_MINIMO_TOKEN));
  console.log(`\n── Ítems con TODOS los tokens de incluye por debajo de ${LARGO_MINIMO_TOKEN} caracteres (${soloCortos.length}) ──`);
  console.log('   Caen a categoría+subcategoría en puntajeReclamo (fallback); en matchLogica.ts (comprobantes) dejan de proponerse por texto.');
  for (const i of soloCortos) {
    console.log(`  [${i.etiqueta}] incluye=[${i.incluye.join(', ')}]`);
  }

  console.log(`\nResumen: ${pierde.length} pierde · ${gana.length} gana · ${soloCortos.length} solo-tokens-cortos.\n`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
