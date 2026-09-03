// F9.155 — auditorías previas obligatorias. SOLO LEE.
//   §2 — ¿algún numeroCliente/numeroOperacion valida como CUIT por casualidad?
//   §3 — si se re-extrae un comprobante ya vinculado, ¿la rama 0 lo ataja? (traza con datos reales)
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

// Módulo 11, pesos 5,4,3,2,7,6,5,4,3,2 sobre los primeros 10 dígitos.
const PESOS_CUIT = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
function esCuitValido(raw: unknown): boolean {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;            // 00000000000 y compañía
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += Number(d[i]) * PESOS_CUIT[i];
  const resto = suma % 11;
  const dv = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
  return dv === Number(d[10]);
}

async function main() {
  const comps = await db.collection('comprobantes').get();
  const movs  = await db.collection('movimientos').get();

  // ── §2 ────────────────────────────────────────────────────────────────────
  console.log('=== §2 — validador de CUIT ===');
  for (const [v, esperado] of [
    ['33610006189', true],   // Accenture, el de las capturas
    ['30-57297583-1', true], // Personal, con guiones
    ['30709565075', true],   // AySA
    ['20243359679', true],   // el del dueño (aparece en destinos)
    ['12345678901', false],
    ['00000000000', false],
    ['007497140070', false], // numeroCliente de Edenor: 12 dígitos
  ] as const) {
    const got = esCuitValido(v);
    console.log(`  ${got === esperado ? 'OK ' : '>>> NO'} ${String(v).padEnd(14)} → ${got} (esperado ${esperado})`);
  }

  console.log('\n--- ¿algún numeroCliente / numeroOperacion valida como CUIT por casualidad? ---');
  let nc = 0, no = 0, ncHit = 0, noHit = 0;
  for (const d of comps.docs) {
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    if (dx.numeroCliente) {
      nc++;
      if (esCuitValido(dx.numeroCliente)) {
        ncHit++;
        console.log(`  >>> numeroCliente "${s(dx.numeroCliente)}" VALIDA como CUIT | ${d.id.slice(0, 8)} | ${s(dx.comercioRazonSocial)}`);
      }
    }
    if (dx.numeroOperacion) {
      no++;
      if (esCuitValido(dx.numeroOperacion)) {
        noHit++;
        console.log(`  >>> numeroOperacion "${s(dx.numeroOperacion)}" VALIDA como CUIT | ${d.id.slice(0, 8)} | ${s(dx.comercioRazonSocial)}`);
      }
    }
  }
  console.log(`  numeroCliente poblados: ${nc} → validan como CUIT: ${ncHit}`);
  console.log(`  numeroOperacion poblados: ${no} → validan como CUIT: ${noHit}`);

  // Control: los cuit/destinoCuit reales SÍ tienen que validar.
  let cuitOk = 0, cuitMal = 0;
  for (const d of comps.docs) {
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    for (const campo of ['cuit', 'destinoCuit'] as const) {
      if (!dx[campo]) continue;
      if (esCuitValido(dx[campo])) cuitOk++;
      else { cuitMal++; console.log(`  (control) ${campo}="${s(dx[campo])}" NO valida | ${d.id.slice(0, 8)} | ${s(dx.comercioRazonSocial)}`); }
    }
  }
  console.log(`  control: cuit/destinoCuit reales que validan: ${cuitOk} | que no validan: ${cuitMal}`);

  // ── §3 ────────────────────────────────────────────────────────────────────
  console.log('\n=== §3 — ¿la rama 0 ataja una re-extracción? ===');
  console.log('La rama 0 consulta: movimientos where hashPdf == <id del comprobante>.');
  console.log('Si el movimiento del comprobante NO tiene ese hashPdf, la rama 0 no lo ve.\n');

  const idsIngreso = new Set(
    movs.docs.filter(d => d.data().tipo === 'Ingreso' && d.data().origenComprobanteId)
             .map(d => d.data().origenComprobanteId as string),
  );
  let atajados = 0, sueltos = 0;
  for (const d of comps.docs) {
    if (!idsIngreso.has(d.id)) continue;
    const porHash   = movs.docs.filter(m => m.data().hashPdf === d.id);
    const porOrigen = movs.docs.filter(m => m.data().origenComprobanteId === d.id);
    const ok = porHash.length > 0;
    if (ok) atajados++; else sueltos++;
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    console.log(`  ${ok ? 'ATAJA  ' : '>>> NO '} ${d.id.slice(0, 8)} | ${s(d.data().estado).padEnd(10)} | movs por hashPdf=${porHash.length} por origen=${porOrigen.length} | ${s(dx.comercioRazonSocial)} ${s(dx.moneda)}`);
    if (!ok && porOrigen.length > 0) {
      console.log(`           el movimiento existe pero su hashPdf es "${s(porOrigen[0].data().hashPdf).slice(0, 12)}…", no el de este comprobante`);
    }
  }
  console.log(`\n  de los ${atajados + sueltos} comprobantes de acreditación: ${atajados} los ataja la rama 0, ${sueltos} NO`);

  // ── §3 bis — el mismo chequeo sobre TODOS los comprobantes vinculados ─────
  let totalV = 0, totalAtaja = 0;
  const huerfanos: string[] = [];
  for (const d of comps.docs) {
    if (d.data().estado !== 'vinculado') continue;
    totalV++;
    const porHash = movs.docs.some(m => m.data().hashPdf === d.id);
    if (porHash) totalAtaja++;
    else {
      const porOrigen = movs.docs.filter(m => m.data().origenComprobanteId === d.id);
      const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
      huerfanos.push(`${d.id.slice(0, 8)} | ${s(dx.tipoDocumento).padEnd(16)} | movs por origen=${porOrigen.length} | ${s(dx.comercioRazonSocial).slice(0, 30)}`);
    }
  }
  console.log(`\n  sobre TODOS los comprobantes vinculados: ${totalV} | la rama 0 atajaría ${totalAtaja} | NO atajaría ${huerfanos.length}`);
  for (const h of huerfanos.slice(0, 25)) console.log('    ' + h);
  if (huerfanos.length > 25) console.log(`    … y ${huerfanos.length - 25} más`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
