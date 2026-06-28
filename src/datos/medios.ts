import type { MedioPago } from '../types';

export type { MedioPago };

// F9.23/F9.36 — Efectivo = alias cosmético de Mercado Pago. El modelo real
// (movimientos.banco) NO cambia — Efectivo sigue existiendo ahí como medio
// propio (paridad legacy, cero migración de datos). config/familia.bancos
// (F9.36) es ahora la fuente real y editable (Perfil › Medios de pago); este
// fallback solo cubre el instante antes de que useFamiliaConfig() resuelva,
// o si el doc llegara sin el campo por alguna razón.
export const MEDIOS_FALLBACK: MedioPago[] = [
  { id: 'bbva',    nombre: 'BBVA',         color: '#072146', tipo: 'Banco',     dominio: 'bbva.com.ar' },
  { id: 'galicia', nombre: 'Galicia',      color: '#ff7300', tipo: 'Banco',     dominio: 'bancogalicia.com' },
  { id: 'pp',      nombre: 'Personal Pay', color: '#5b2d8e', tipo: 'Billetera', dominio: 'personalpay.com.ar' },
  { id: 'mp',      nombre: 'Mercado Pago', color: '#00a5e6', tipo: 'Billetera', dominio: 'mercadopago.com.ar' },
  { id: 'efec',    nombre: 'Efectivo',     color: '#16a34a', tipo: 'Efectivo',  aliasDe: 'mp', oculto: true },
];

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
