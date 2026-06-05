/**************************************
 * 46_Tarjetas_Importer.gs - Fase 2.2.a
 * Recibe array de movimientos, deduplica por hash, escribe en Tarjetas_Raw
 * y auto-matchea via dictApplyToPending.
 *
 * Funciones privadas:
 *   gf_importarMovimientos_(resumenID, movArray)
 *   gf_buildHashMovimiento_(mov)
 *   gf_esPercepcionAutoExcluir_(descRaw)
 **************************************/

// Patrones hardcodeados de percepciones que se auto-excluyen
const GF_PERCEPCIONES_EXCLUIR = [
  'DB.RG 5617',
  'IVA RG 4240',
  'IIBB PERCEP-CABA'
];

/**
 * Calcula un hash determinístico para un movimiento de tarjeta.
 * Basado en FechaConsumo + DescripcionRaw + Monto + Moneda.
 *
 * @param {Object} mov  Objeto con al menos {fechaConsumo, descripcionRaw, monto, moneda}
 * @returns {string}    Hash hex de 16 caracteres
 */
function gf_buildHashMovimiento_(mov) {
  const fechaStr = mov.fechaConsumo instanceof Date
    ? Utilities.formatDate(mov.fechaConsumo, Session.getScriptTimeZone(), 'yyyy-MM-dd')
    : String(mov.fechaConsumo || '');

  const raw = [
    fechaStr,
    String(mov.descripcionRaw || '').trim().toLowerCase(),
    String(Number(mov.monto)   || 0),
    String(mov.moneda          || 'ARS').toUpperCase()
  ].join('|');

  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  return bytes.slice(0, 8).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

/**
 * Determina si una descripción raw corresponde a una percepción que debe
 * auto-excluirse (no pasar a Historico).
 *
 * @param {string} descRaw
 * @returns {boolean}
 */
function gf_esPercepcionAutoExcluir_(descRaw) {
  if (!descRaw) return false;
  const norm = descRaw.trim().toUpperCase();
  return GF_PERCEPCIONES_EXCLUIR.some(p => norm.includes(p.toUpperCase()));
}

/**
 * Importa un array de movimientos en Tarjetas_Raw.
 * - Valida que resumenID exista en Tarjetas_Resumen
 * - Calcula hash por movimiento y descarta duplicados
 * - Pre-setea AccionUsuario='ExcluirTotalmente' para percepciones
 * - Al final llama dictApplyToPending() en las filas recién insertadas
 *
 * @param {string} resumenID  ID del resumen padre (debe existir en Tarjetas_Resumen)
 * @param {Array}  movArray   Array de objetos con campos del movimiento:
 *   {
 *     seq?:              number,
 *     tipoLinea?:        string,   // consumo|cuota|impuesto|pago_anterior|bonificacion|reverso|reintegro_percepcion
 *     fechaConsumo?:     Date,
 *     descripcionRaw:    string,
 *     nroCupon?:         string,
 *     cuotaActual?:      number,
 *     cuotaTotal?:       number,
 *     moneda?:           string,   // ARS|USD
 *     monto:             number,
 *     personaDetectada?: string,
 *     esBonificacion?:   boolean,
 *     esReverso?:        boolean,
 *     esImpuesto?:       boolean,
 *     esPagoAnterior?:   boolean,
 *     notas?:            string
 *   }
 * @returns {{insertados: number, duplicados: number, autoMatched: number, sinMapeo: number}}
 */
function gf_importarMovimientos_(resumenID, movArray) {
  if (!resumenID) throw new Error('gf_importarMovimientos_: resumenID requerido');
  if (!movArray || !movArray.length) {
    return { insertados: 0, duplicados: 0, autoMatched: 0, sinMapeo: 0 };
  }

  const ss = SpreadsheetApp.getActive();

  // --- Validar que resumenID exista ---
  const shRes = ss.getSheetByName(GF.SHEET_TARJETAS_RESUMEN);
  if (!shRes) throw new Error('Hoja Tarjetas_Resumen no encontrada');

  const hRes = shRes.getRange(1, 1, 1, shRes.getLastColumn()).getValues()[0];
  const iRes = {};
  hRes.forEach((h, i) => { iRes[String(h).trim()] = i; });

  if (iRes['ResumenID'] === undefined) throw new Error('Tarjetas_Resumen: falta columna ResumenID');

  let resumenFound = false;
  if (shRes.getLastRow() >= 2) {
    const ids = shRes.getRange(2, iRes['ResumenID'] + 1, shRes.getLastRow() - 1, 1).getValues();
    resumenFound = ids.some(r => String(r[0]).trim() === resumenID);
  }
  if (!resumenFound) throw new Error('resumenID no encontrado en Tarjetas_Resumen: ' + resumenID);

  // --- Cargar hashes existentes en Raw para dedup ---
  const shRaw = ss.getSheetByName(GF.SHEET_TARJETAS_RAW);
  if (!shRaw) throw new Error('Hoja Tarjetas_Raw no encontrada');

  const hRaw = shRaw.getRange(1, 1, 1, shRaw.getLastColumn()).getValues()[0];
  const iRaw = {};
  hRaw.forEach((h, i) => { iRaw[String(h).trim()] = i; });

  const existingHashes = new Set();
  if (shRaw.getLastRow() >= 2 && iRaw['HashMovimiento'] !== undefined) {
    const nRows = shRaw.getLastRow() - 1;
    const hashes = shRaw.getRange(2, iRaw['HashMovimiento'] + 1, nRows, 1).getValues();
    hashes.forEach(r => {
      const h = String(r[0] || '').trim();
      if (h) existingHashes.add(h);
    });
  }

  const now = new Date();
  const usuario = Session.getActiveUser().getEmail() || 'Sistema';

  let insertados = 0;
  let duplicados = 0;
  const rowsToInsert = [];

  for (let s = 0; s < movArray.length; s++) {
    const mov = movArray[s];

    const hash = gf_buildHashMovimiento_(mov);

    if (existingHashes.has(hash)) {
      duplicados++;
      continue;
    }
    existingHashes.add(hash); // evitar duplicados dentro del mismo batch

    const accionUsuario = '';

    const newRow = new Array(hRaw.length).fill('');

    const set = (col, val) => {
      if (iRaw[col] !== undefined && val !== undefined && val !== null) newRow[iRaw[col]] = val;
    };

    set('RawID',            newId_('RAW'));
    set('ResumenID',        resumenID);
    set('Seq',              mov.seq !== undefined ? mov.seq : (s + 1));
    set('TipoLinea',        mov.tipoLinea       || 'consumo');
    set('FechaConsumo',     mov.fechaConsumo    || '');
    set('DescripcionRaw',   mov.descripcionRaw  || '');
    set('NroCupon',         mov.nroCupon        || '');
    set('CuotaActual',      mov.cuotaActual     !== undefined ? mov.cuotaActual : '');
    set('CuotaTotal',       mov.cuotaTotal      !== undefined ? mov.cuotaTotal  : '');
    set('Moneda',           mov.moneda          || 'ARS');
    set('Monto',            mov.monto);
    set('PersonaDetectada', mov.personaDetectada    || '');
    set('PersonaFinal',     mov.personaDetectada    || '');
    set('EsBonificacion',   mov.esBonificacion      || false);
    set('EsReverso',        mov.esReverso           || false);
    set('EsImpuesto',       mov.esImpuesto          || false);
    set('EsPagoAnterior',   mov.esPagoAnterior      || false);
    // Sugerencias de Claude como valor inicial (el dict las sobreescribe si hay match)
    set('Categoría',        mov.categoriaSugerida    || '');
    set('Subcategoria',     mov.subcategoriaSugerida || '');
    set('HashMovimiento',   hash);
    set('EstadoMatch',      'pending');
    set('AccionUsuario',    accionUsuario);
    set('ImportadoEn',      now);
    set('ImportadoPor',     usuario);
    set('Notas',            mov.notas           || '');

    rowsToInsert.push(newRow);
    insertados++;
  }

  // Escritura en batch
  if (rowsToInsert.length > 0) {
    const firstNewRow = shRaw.getLastRow() + 1;
    shRaw.getRange(firstNewRow, 1, rowsToInsert.length, hRaw.length).setValues(rowsToInsert);
  }

  // Auto-match de las filas recién insertadas
  let autoMatched = 0;
  let sinMapeo = 0;
  if (insertados > 0) {
    const applyResult = dictApplyToPending();
    autoMatched = applyResult.matched  || 0;
    sinMapeo    = applyResult.unmatched || 0;
  }

  const result = { insertados, duplicados, autoMatched, sinMapeo };
  Logger.log('gf_importarMovimientos_: ' + JSON.stringify(result));
  SpreadsheetApp.getActive().toast(
    'Insertados: ' + insertados + ' | Dupl: ' + duplicados +
    ' | Auto-mapeados: ' + autoMatched + ' | Sin mapeo: ' + sinMapeo,
    'Importador', 8
  );
  return result;
}
