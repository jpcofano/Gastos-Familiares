export interface ComercioDominio { dominio: string; match: string[]; }

export const COMERCIOS_DOMINIOS: ComercioDominio[] = [
  { dominio: 'edenor.com',          match: ['edenor', 'empresa distribuidora y comercializadora norte'] },
  { dominio: 'telecom.com.ar',      match: ['telecom'] },
  { dominio: 'personal.com.ar',     match: ['personal pay', 'telecom personal'] },
  { dominio: 'movistar.com.ar',     match: ['movistar', 'telefonica'] },
  { dominio: 'aysa.com.ar',         match: ['aysa', 'agua y saneamientos'] },
  { dominio: 'metrogas.com.ar',     match: ['metrogas'] },
  { dominio: 'naturgy.com.ar',      match: ['naturgy'] },
  { dominio: 'afip.gob.ar',         match: ['afip', 'monotributo'] },
  { dominio: 'fibertel.com.ar',     match: ['fibertel'] },
  { dominio: 'farmacity.com.ar',    match: ['farmacity'] },
  { dominio: 'coto.com.ar',         match: ['coto'] },
  { dominio: 'jumbo.com.ar',        match: ['jumbo'] },
  { dominio: 'carrefour.com.ar',    match: ['carrefour'] },
  { dominio: 'disco.com.ar',        match: ['disco'] },
  { dominio: 'ypf.com',             match: ['ypf'] },
  { dominio: 'shell.com.ar',        match: ['shell'] },
  { dominio: 'despegar.com',        match: ['despegar'] },
  { dominio: 'aerolineas.com.ar',   match: ['aerolineas'] },
  { dominio: 'apple.com',           match: ['apple', 'itunes', 'icloud'] },
  { dominio: 'mercadolibre.com.ar', match: ['mercadolibre', 'mercado libre'] },
  { dominio: 'mercadopago.com.ar',  match: ['mercadopago', 'mercado pago'] },
  { dominio: 'netflix.com',         match: ['netflix'] },
  { dominio: 'spotify.com',         match: ['spotify'] },
  { dominio: 'rappi.com.ar',        match: ['rappi'] },
  { dominio: 'pedidosya.com.ar',    match: ['pedidosya', 'pedidos ya'] },
  { dominio: 'starbucks.com.ar',    match: ['starbucks'] },
  { dominio: 'sodimac.com.ar',      match: ['sodimac'] },
  { dominio: 'easy.com.ar',         match: ['easy'] },
  { dominio: 'fravega.com',         match: ['fravega'] },
  { dominio: 'garbarino.com',       match: ['garbarino'] },
  { dominio: 'musimundo.com',       match: ['musimundo'] },
  { dominio: 'cinemark.com.ar',     match: ['cinemark'] },
  { dominio: 'dexter.com.ar',       match: ['dexter'] },
];

const norm = (s: string) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export function comercioDominio(nombre: string | null | undefined): string | null {
  const n = norm(nombre ?? '');
  if (!n) return null;
  for (const e of COMERCIOS_DOMINIOS) if (e.match.some(m => n.includes(m))) return e.dominio;
  return null;
}
