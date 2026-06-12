// scripts/seed/diagnose.ts
// Diagnóstico de los FAILS del validator. No escribe nada, solo lee.

import { readExcel } from './readExcel';
import { getDb } from './utils/firestore';
import { sha256Hex } from './utils/hash';
import { normalizar, NormRule } from './utils/normalize';

const TECNICA_RE = /^(Juan|Mar[ií]a)(ARS|USD)$|^(Galicia|Frances|BBVA)\s+(Visa|Master)(ARS|USD)$/i;

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

async function main() {
  const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
  const data = readExcel('./data/2026-05-29_sheet_snapshot.xlsx');
  const db = getDb(target);

  console.log('\n=== 1. Movements: IDs duplicados o vacíos en el Excel ===\n');
  const idCounts = new Map<string, number>();
  const sinFecha: any[] = [];
  const idsVacios: any[] = [];
  for (const r of data.historico) {
    if (!r.Fecha && (!r.Monto || r.Monto === 0)) {
      sinFecha.push(r);
      continue;
    }
    const id = r.ID;
    if (!id || id === '') {
      idsVacios.push(r);
      continue;
    }
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  const duplicados = Array.from(idCounts.entries()).filter(([_, c]) => c > 1);
  console.log(`  Filas descartadas legítimas (sin fecha + monto 0): ${sinFecha.length}`);
  console.log(`  Filas con ID vacío: ${idsVacios.length}`);
  console.log(`  IDs únicos en Excel: ${idCounts.size}`);
  console.log(`  IDs duplicados (mismo ID > 1 fila): ${duplicados.length}`);
  if (duplicados.length > 0 && duplicados.length <= 20) {
    console.log('  Primeros duplicados:');
    for (const [id, count] of duplicados.slice(0, 20)) {
      console.log(`    ${id}: ${count}x`);
    }
  } else if (duplicados.length > 20) {
    console.log(`  Demasiados para listar. Mostrando 10:`);
    for (const [id, count] of duplicados.slice(0, 10)) {
      console.log(`    ${id}: ${count}x`);
    }
  }
  if (idsVacios.length > 0 && idsVacios.length <= 10) {
    console.log('  Filas con ID vacío:');
    for (const r of idsVacios) {
      console.log(`    Desc=${r['Descripción']}, Fecha=${r.Fecha}, Monto=${r.Monto}`);
    }
  }

  console.log('\n=== 2. Movements en Firestore ===\n');
  const movsFs = await db.collection('movimientos').count().get();
  const expected = data.historico.length - sinFecha.length;
  console.log(`  Firestore: ${movsFs.data().count}`);
  console.log(`  Esperado (Excel sin descartados): ${expected}`);
  console.log(`  Diferencia: ${expected - movsFs.data().count}`);
  console.log(`  (Si la diferencia = duplicados + vacios, está identificada la causa)`);

  console.log('\n=== 3. Dictionary: hashes colisionando ===\n');
  const rules: NormRule[] = data.diccionarioNorm
    .filter(r => r.Activo === true || r.Activo === 'VERDADERO')
    .map(r => ({ tipo: r.Tipo, patron: r.Patron, reemplazo: r.Reemplazo ?? '' }));

  const hashCounts = new Map<string, any[]>();
  for (const r of data.diccionarioAprendido) {
    const patronOriginal = r.PatronOriginal ?? r.Patron;
    const patron = r.Patron ? normalizar(String(r.Patron), rules) : (patronOriginal ? String(patronOriginal) : null);
    let personaParsed: string | null = null;
    let etiquetaNueva: string | null = r.Etiqueta;
    if (r.Etiqueta) {
      const e = String(r.Etiqueta).trim();
      if (TECNICA_RE.test(e)) {
        if (/^Juan/i.test(e)) personaParsed = 'Juan';
        else if (/^Mar[ií]a/i.test(e)) personaParsed = 'María';
        etiquetaNueva = null;
      }
    }
    const id = sha256Hex(
      'dict',
      patron ?? '',
      etiquetaNueva ?? '',
      personaParsed ?? r.PersonaDefault ?? '',
      r.Origen ?? ''
    ).slice(0, 24);
    if (!hashCounts.has(id)) hashCounts.set(id, []);
    hashCounts.get(id)!.push(r);
  }
  const colisiones = Array.from(hashCounts.entries()).filter(([_, rows]) => rows.length > 1);
  console.log(`  Hashes únicos: ${hashCounts.size}`);
  console.log(`  Colisiones (hash compartido entre filas): ${colisiones.length}`);
  console.log(`  Filas que se pierden: ${colisiones.reduce((s, [_, rows]) => s + rows.length - 1, 0)}`);
  if (colisiones.length > 0) {
    console.log('  Primeras colisiones:');
    for (const [hash, rows] of colisiones.slice(0, 5)) {
      console.log(`    Hash ${hash}:`);
      for (const r of rows) {
        console.log(`      patron="${r.Patron}" etiq="${r.Etiqueta}" persona="${r.PersonaDefault}" origen="${r.Origen}" cat="${r['Categoría']}"`);
      }
    }
  }

  console.log('\n=== 4. Movements sin TC: por qué ===\n');
  const tcDates = new Set<string>();
  for (const r of data.tcDiario) {
    if (r.Fecha) tcDates.add(isoDate(r.Fecha as Date));
  }
  const tcSorted = Array.from(tcDates).sort();
  const tcMin = tcSorted[0];
  const tcMax = tcSorted[tcSorted.length - 1];
  console.log(`  Rango de TC_Diario: ${tcMin} → ${tcMax}`);

  // Movements de Firestore que no tienen TC
  const sinTcSnap = await db.collection('movimientos').where('tcUsdArs', '==', null).get();
  let antesDelMin = 0;
  let dentroDelRango = 0;
  let sinFechaCount = 0;
  let despuesDelMax = 0;
  for (const doc of sinTcSnap.docs) {
    const d = doc.data();
    if (!d.fecha) { sinFechaCount++; continue; }
    const f = d.fecha.toDate ? d.fecha.toDate() : new Date(d.fecha);
    const iso = isoDate(f);
    if (iso < tcMin) antesDelMin++;
    else if (iso > tcMax) despuesDelMax++;
    else dentroDelRango++;
  }
  console.log(`  Total movimientos sin TC: ${sinTcSnap.size}`);
  console.log(`    Anteriores al primer TC del Sheet: ${antesDelMin}`);
  console.log(`    Posteriores al último TC del Sheet: ${despuesDelMax}`);
  console.log(`    Dentro del rango pero sin TC del día: ${dentroDelRango}`);
  console.log(`    Sin fecha: ${sinFechaCount}`);
}

main().catch(e => { console.error(e); process.exit(1); });
