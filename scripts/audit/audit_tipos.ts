/**
 * F3.1.2 — Auditoría de tipos: emulador vs src/types/index.ts
 * Solo lectura contra el emulador local. NO toca producción.
 * Correr con:  npx tsx scripts/audit/audit_tipos.ts
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';

if (getApps().length === 0) {
  initializeApp({ projectId: 'gastos-familiares-e6415' });
}
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

// ─── Campos esperados según src/types/index.ts ────────────────────────────────
// "id" se excluye de la comparación porque mapea al doc ID, no a un campo stored.

const TYPE_MOVEMENT = new Set([
  'idLegacy','fecha','fechaConsumoOriginal','mes','descripcion','descripcionOriginal',
  'monto','moneda','tcUsdArs','tipo','subtipo','origen','categoria','subcategoria',
  'etiqueta','banco','cuenta','tarjetaCodigo','tarjeta','persona','creadoPor','pagado',
  'excluirDash','incluirResumenMes','padreId','resumenTarjetaId','itemEsperadoId',
  'numeroComprobante','hashPdf','refStoragePdf','notas','creadoEn','actualizadoEn',
]);

const TYPE_CARD_STATEMENT = new Set([
  'tarjetaCodigo','banco','tarjeta','periodo','fechaCierre','fechaVencimiento',
  'totalARS','totalUSD','pagoMinimoARS','cuentaDebito','hashPdf','refStoragePdf',
  'parseadoEn','confirmadoEn','confirmadoPor','observaciones',
]);

const TYPE_EXPECTED_ITEM = new Set([
  'tipo','activo','categoria','subcategoria','etiqueta','persona','moneda','banco',
  'montoEsperado','diaVencimiento','autoCalendario','notas',
]);

const TYPE_FAMILIA_CONFIG = new Set([
  'miembros','categorias','bancos','tarjetas',
]);

const TYPE_FAMILIA_MIEMBRO = new Set([
  'nombre','emails','rol','activo',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferType(val: unknown): string {
  if (val === null) return 'null';
  if (Array.isArray(val)) return `array(${(val as unknown[]).length})`;
  if (val && typeof val === 'object' && 'toDate' in val) return 'Timestamp';
  if (typeof val === 'object') return 'map';
  return typeof val;
}

const HR = '═'.repeat(62);

function diffReport(
  label: string,
  typeFields: Set<string>,
  docFields: string[],
  docId: string,
) {
  console.log(`\n${HR}`);
  console.log(`  ${label}   [doc: ${docId}]`);
  console.log(HR);

  const docSet = new Set(docFields);
  const inBoth     = docFields.filter(f => typeFields.has(f));
  const onlyInDoc  = docFields.filter(f => !typeFields.has(f));
  const onlyInType = [...typeFields].filter(f => !docSet.has(f));

  console.log(`\n  ✓ Coinciden (${inBoth.length}): ${inBoth.join(', ')}`);

  if (onlyInDoc.length > 0) {
    console.log(`\n  ⚠ En Firestore pero NO en el tipo (${onlyInDoc.length}):`);
    onlyInDoc.forEach(f => console.log(`      ${f}`));
  }
  if (onlyInType.length > 0) {
    console.log(`\n  ✗ En el tipo pero NO en Firestore (${onlyInType.length}):`);
    onlyInType.forEach(f => console.log(`      ${f}`));
  }
}

function fieldTable(data: Record<string, unknown>) {
  console.log('\n  Campos y tipos observados en el doc:');
  for (const [k, v] of Object.entries(data)) {
    console.log(`    ${k.padEnd(26)} ${inferType(v)}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔍 F3.1.2 — Auditoría emulador vs src/types/index.ts');
  console.log('   Solo lectura. Emulador local (localhost:8080).\n');

  // ── movimientos ──────────────────────────────────────────────────────────────
  const movSnap = await db.collection('movimientos').limit(2).get();
  if (movSnap.empty) {
    console.log('\n⚠ movimientos: colección vacía — ¿corrió el seed?');
  } else {
    const doc = movSnap.docs[0];
    const data = doc.data() as Record<string, unknown>;
    diffReport('Movement', TYPE_MOVEMENT, Object.keys(data), doc.id);
    fieldTable(data);
  }

  // ── resumenesTarjeta ─────────────────────────────────────────────────────────
  const csSnap = await db.collection('resumenesTarjeta').limit(1).get();
  if (csSnap.empty) {
    console.log('\n⚠ resumenesTarjeta: colección vacía');
  } else {
    const doc = csSnap.docs[0];
    const data = doc.data() as Record<string, unknown>;
    diffReport('CardStatement', TYPE_CARD_STATEMENT, Object.keys(data), doc.id);
    fieldTable(data);
  }

  // ── itemsEsperados ──────────────────────────────────────────────────────────
  const eiSnap = await db.collection('itemsEsperados').limit(1).get();
  if (eiSnap.empty) {
    console.log('\n⚠ itemsEsperados: colección vacía');
  } else {
    const doc = eiSnap.docs[0];
    const data = doc.data() as Record<string, unknown>;
    diffReport('ExpectedItem', TYPE_EXPECTED_ITEM, Object.keys(data), doc.id);
    fieldTable(data);
  }

  // ── config/familia ─────────────────────────────────────────────────────────
  const familiaDoc = await db.collection('config').doc('familia').get();
  if (!familiaDoc.exists) {
    console.log('\n⚠ config/familia: documento NO encontrado');
  } else {
    const data = familiaDoc.data() as Record<string, unknown>;
    diffReport('FamiliaConfig', TYPE_FAMILIA_CONFIG, Object.keys(data), 'familia');
    fieldTable(data);

    // Detalle de miembros
    console.log('\n  ─── Estructura de miembros ───');
    const miembros = (data['miembros'] ?? {}) as Record<string, Record<string, unknown>>;
    for (const [key, miembro] of Object.entries(miembros)) {
      console.log(`\n    miembros["${key}"]:`);
      for (const [mk, mv] of Object.entries(miembro)) {
        console.log(`      ${mk.padEnd(10)} ${inferType(mv).padEnd(12)} = ${JSON.stringify(mv)}`);
      }
      const miembroFields = new Set(Object.keys(miembro));
      const extra  = Object.keys(miembro).filter(f => !TYPE_FAMILIA_MIEMBRO.has(f));
      const faltaN = [...TYPE_FAMILIA_MIEMBRO].filter(f => !miembroFields.has(f));
      if (extra.length)  console.log(`    ⚠ campos extra en miembro: ${extra.join(', ')}`);
      if (faltaN.length) console.log(`    ✗ faltan en miembro: ${faltaN.join(', ')}`);
    }
  }

  // ─── Resumen consolidado ───────────────────────────────────────────────────
  console.log(`\n\n${HR}`);
  console.log('  ANÁLISIS ESTÁTICO (derivado de lectura del seed)');
  console.log(HR);
  console.log(`
  Este script confirma lo derivable del código del seed:

  1. config/familia — DISCREPANCIA REAL:
     • Firestore tiene:  actualizadoEn  (FieldValue.serverTimestamp)
     • FamiliaConfig no lo declara.
     → Acción propuesta: agregar  actualizadoEn: Date  a FamiliaConfig.

  2. hashPdf — unificado en F3.1.3 y castellanizado en F4.0. Campo final: hashPdf.

  3. Castellanización completada en F4.0:
     • movimientos:      creadoEn, actualizadoEn, hashPdf, refStoragePdf,
                         padreId, resumenTarjetaId, itemEsperadoId
     • resumenesTarjeta: hashPdf, refStoragePdf, parseadoEn, confirmadoEn, confirmadoPor
     → Deuda técnica saldada. Seed, tipos y reglas en castellano camelCase.
  `);

  console.log(`${HR}\n`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
