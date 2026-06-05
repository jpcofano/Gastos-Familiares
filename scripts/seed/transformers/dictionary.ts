import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { sha256Hex } from '../utils/hash';
import { normalizar, NormRule } from '../utils/normalize';
import { writeBatch } from '../utils/firestore';

const TECNICA_RE = /^(Juan|Mar[ií]a)(ARS|USD)$|^(Galicia|Frances|BBVA)\s+(Visa|Master)(ARS|USD)$/i;

interface Parsed {
  personaDefault: string | null;
  monedaDefault: 'ARS' | 'USD' | null;
  etiquetaNueva: string | null;
}

function parseEtiquetaTecnica(etiqOrig: string | null): Parsed {
  if (!etiqOrig) return { personaDefault: null, monedaDefault: null, etiquetaNueva: null };
  const e = etiqOrig.trim();
  if (!TECNICA_RE.test(e)) {
    return { personaDefault: null, monedaDefault: null, etiquetaNueva: e };
  }
  let persona: string | null = null;
  if (/^Juan/i.test(e)) persona = 'Juan';
  else if (/^Mar[ií]a/i.test(e)) persona = 'María';
  const moneda: 'ARS' | 'USD' = /USD$/i.test(e) ? 'USD' : 'ARS';
  return { personaDefault: persona, monedaDefault: moneda, etiquetaNueva: null };
}

export async function seedDictionary(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> dictionary');

  const rules: NormRule[] = data.diccionarioNorm
    .filter(r => r.Activo === true || r.Activo === 'VERDADERO')
    .map(r => ({ tipo: r.Tipo, patron: r.Patron, reemplazo: r.Reemplazo ?? '' }));

  let convertidos = 0;
  const candidates = data.diccionarioAprendido.map(r => {
    const patronOriginal = r.PatronOriginal ?? r.Patron;
    const patronOriginalStr = patronOriginal !== null && patronOriginal !== undefined 
      ? String(patronOriginal) 
      : null;
    const patron = r.Patron ? normalizar(String(r.Patron), rules) : patronOriginalStr;
    const { personaDefault: personaParsed, monedaDefault, etiquetaNueva }
      = parseEtiquetaTecnica(r.Etiqueta);

    if (etiquetaNueva === null && r.Etiqueta) convertidos++;

    const id = sha256Hex(
      'dict',
      patron ?? '',
      etiquetaNueva ?? '',
      personaParsed ?? r.PersonaDefault ?? '',
      r.Origen ?? ''
    ).slice(0, 24);

    return {
      id,
      patron,
      patronOriginal,
      tipoMatch: (r.TipoMatch === 'contains' ? 'contains' : 'exact') as 'exact' | 'contains',
      descripcionLimpia: r.DescripcionLimpia ?? r.DescripcionNormalizada ?? null,
      categoria:    r['Categoría'] ?? r.Categoria ?? null,
      subcategoria: r.Subcategoria ?? null,
      etiqueta:     etiquetaNueva,
      personaDefault: personaParsed ?? r.PersonaDefault ?? null,
      monedaDefault,
      bancoFiltro:   r.BancoFiltro ?? null,
      tarjetaFiltro: r.TarjetaFiltro ?? null,
      confianza:     typeof r.Confianza === 'number' ? r.Confianza : 0.9,
      accionDefault: r.AccionDefault ?? '',
      usoCount:      typeof r.UsoCount === 'number' ? r.UsoCount : 0,
      ultimoUso:     r.UltimoUso ? Timestamp.fromDate(r.UltimoUso as Date) : null,
      activo:        r.Activo === true || r.Activo === 'VERDADERO',
      origen:        r.Origen ?? 'Tarjeta',
      creadoPor:     r.CreadoPor ?? 'Sistema',
      createdAt:     r.CreadoEn ? Timestamp.fromDate(r.CreadoEn as Date) : Timestamp.now(),
      notas:         r.Notas ?? null,
    };
  });

  // Agrupar por ID, sumando UsoCount y tomando MAX de UltimoUso/createdAt
  const grouped = new Map<string, any>();
  for (const c of candidates) {
    const existing = grouped.get(c.id);
    if (!existing) {
      grouped.set(c.id, c);
    } else {
      existing.usoCount += c.usoCount;
      if (c.ultimoUso && (!existing.ultimoUso || c.ultimoUso.toMillis() > existing.ultimoUso.toMillis())) {
        existing.ultimoUso = c.ultimoUso;
      }
      if (c.createdAt && existing.createdAt && c.createdAt.toMillis() > existing.createdAt.toMillis()) {
        existing.categoria = c.categoria;
        existing.subcategoria = c.subcategoria;
        existing.descripcionLimpia = c.descripcionLimpia;
      }
    }
  }
  const docs = Array.from(grouped.values());

  console.log(`   ${docs.length} entradas finales`);
  console.log(`   ${candidates.length - docs.length} consolidadas por hash (suma UsoCount)`);
  console.log(`   ${convertidos} con etiqueta tecnica convertida a persona+moneda`);
  if (dryRun) return;
  await writeBatch(db, 'dictionary', docs);
  console.log('   OK\n');
}
