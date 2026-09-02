// F9.152 §1 — Detección del tipo real de un archivo por sus bytes.
//
// Por qué existe: el `media_type` que se le manda a la API de Anthropic salía de
// `comprobantes.contentType`, que es `entrantes.mimeType`, que es `file.type` del share target de
// Android (src/datos/entrantes.ts:59) — o sea, lo que DECLARA el cliente. Cuando el cliente miente
// (screenshot JPEG anunciado como `image/png`, caso típico de Android) la API responde 400 y la
// extracción muere. Pasó el 2026-08-31 (auditoría F9.151, H5) y otra vez el 2026-09-02.
// El `media_type: contentType as ImageMediaType` que había en index.ts era un cast, no una
// validación: apagaba al compilador exactamente donde estaba el bug.
//
// Vive en su propio módulo, y no dentro de index.ts, para que la verificación de F9.152 §5 pueda
// ejercitarlo contra archivos reales sin levantar el entry-point de Functions.

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
export type TipoArchivoReal = 'application/pdf' | ImageMediaType;

// Marcas ISO-BMFF de la familia HEIF/HEIC. Pasan el `accept` del picker y la API de imágenes no las
// acepta, así que tienen que fallar con mensaje propio y no con el 400 crudo.
const MARCAS_HEIC = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

export function detectarTipoReal(b: Buffer): TipoArchivoReal | null {
  if (b.length >= 4  && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  if (b.length >= 3  && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8  && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
                     && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 4  && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// `errorExtraccion` lo lee una persona en la pantalla Cargar: el mensaje tiene que decirle qué
// hacer, no repetirle el error de la API.
export function motivoFormatoNoSoportado(b: Buffer, declarado: string): string {
  const esIsoBmff = b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp';
  const marca     = esIsoBmff ? b.toString('latin1', 8, 12).toLowerCase().trim() : '';
  if (esIsoBmff && MARCAS_HEIC.has(marca)) {
    return 'Formato no soportado: HEIC. Convertí a JPG antes de subir.';
  }
  if (esIsoBmff) {
    return `Formato no soportado: el archivo es un contenedor "${marca}" (video o similar). Subí una foto JPG/PNG o el PDF.`;
  }
  return `Formato no soportado: el archivo no es PDF, JPG, PNG, GIF ni WEBP (el dispositivo lo declaró como "${declarado}"). Convertilo a JPG o PDF antes de subir.`;
}
