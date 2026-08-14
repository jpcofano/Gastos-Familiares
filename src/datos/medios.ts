import type { MedioPago } from '../types';

export type { MedioPago };

// F9.36 — config/familia.bancos es la fuente real y editable (Perfil › Medios de pago); este
// fallback solo cubre el instante antes de que useFamiliaConfig() resuelva, o si el doc llegara
// sin el campo. OJO: prod ya divergió de esta lista (tiene un "Ciudad" agregado desde la UI), así
// que el fallback NO es un espejo de la config — es un piso mínimo para no renderizar vacío.
// F9.139 — Efectivo se fue: era un alias cosmético de Mercado Pago y ahora no existe ni acá, ni en
// config/familia.bancos de prod, ni en los datos (los 150 movimientos históricos se migraron con
// scripts/migrarEfectivoAMp.ts). El comentario anterior decía que el modelo real no cambiaba y que
// no había migración de datos; dejó de ser cierto en las dos mitades.
export const MEDIOS_FALLBACK: MedioPago[] = [
  { id: 'bbva',    nombre: 'BBVA',         color: '#072146', tipo: 'Banco',     dominio: 'bbva.com.ar', porDefecto: true },
  { id: 'galicia', nombre: 'Galicia',      color: '#ff7300', tipo: 'Banco',     dominio: 'bancogalicia.com' },
  { id: 'pp',      nombre: 'Personal Pay', color: '#5b2d8e', tipo: 'Billetera', dominio: 'personalpay.com.ar' },
  { id: 'mp',      nombre: 'Mercado Pago', color: '#00a5e6', tipo: 'Billetera', dominio: 'mercadopago.com.ar' },
];

// F9.139 — nombres que los PDFs traen y no coinciden con ningún medio configurado.
// Tabla explícita a propósito: el matcheo difuso convierte un banco desconocido en uno
// conocido sin que nadie se entere. Cuando aparezca otro, se agrega acá.
// Medido sobre los 1829 movimientos de prod: es el ÚNICO nombre fuera de config (299 movimientos).
export const ALIAS_NOMBRE_MEDIO: Record<string, string> = {
  'bbva argentina': 'BBVA',
};

// F9.139 — el medio que se asume cuando no hay ninguno detectable. Cae al primero de la
// lista si nadie está marcado, para no devolver undefined y escribir null en `banco`.
export function medioPorDefecto(medios: MedioPago[] = MEDIOS_FALLBACK): MedioPago | undefined {
  return medios.find(m => m.porDefecto) ?? medios.find(m => !m.oculto);
}

export function mediosVisibles(medios: MedioPago[] = MEDIOS_FALLBACK): MedioPago[] {
  return medios.filter(m => !m.oculto);
}

// medioCanonico — usar en TODA agrupación/etiqueta por medio (desglose diario
// por banco del Resumen, bancoDominante del Dashboard, chips de medio, etc.)
// para que un movimiento con banco:'Efectivo' se cuente y muestre como
// Mercado Pago, sin tocar el dato guardado. `medios` real = config?.bancos;
// si no llegó todavía, cae al fallback (mismo resultado para el set conocido).
export function medioCanonico(nombre: string, medios: MedioPago[] = MEDIOS_FALLBACK): string {
  const medio = medios.find(m => m.nombre === nombre);
  if (!medio?.aliasDe) return nombre;
  const destino = medios.find(m => m.id === medio.aliasDe);
  return destino?.nombre ?? nombre;
}

export function colorMedio(nombre: string, medios: MedioPago[] = MEDIOS_FALLBACK): string | undefined {
  return medios.find(m => m.nombre === medioCanonico(nombre, medios))?.color;
}
