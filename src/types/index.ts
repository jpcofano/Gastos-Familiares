// Tipos de dominio puros — sin dependencias de ningún SDK.
// Campos fecha usan Date. La conversión Timestamp↔Date es trabajo de F4.

export interface Movement {
  id: string;
  idLegacy: string;
  fecha: Date;
  fechaConsumoOriginal: Date | null;
  mes: string;
  descripcion: string;
  descripcionOriginal: string | null;
  monto: number;
  moneda: 'ARS' | 'USD';
  tcUsdArs: number | null;
  tipo: 'Gasto' | 'Ingreso';
  subtipo: string;
  origen: string;
  categoria: string | null;
  subcategoria: string | null;
  etiqueta: string | null;
  banco: string | null;
  cuenta: string | null;
  tarjetaCodigo: string | null;
  tarjeta: string | null;
  persona: string | null;
  creadoPor: string;
  pagado: boolean;
  excluirDash: boolean;
  incluirResumenMes: boolean;
  padreId: string | null;
  resumenTarjetaId: string | null;
  itemEsperadoId: string | null;
  numeroComprobante: string | null;
  hashPdf: string | null;
  refStoragePdf: string | null;
  notas: string | null;
  creadoEn: Date;
  actualizadoEn: Date;
}

export interface CardStatement {
  id: string;
  tarjetaCodigo: string;
  banco: string;
  tarjeta: string;
  periodo: string;
  fechaCierre: Date | null;
  fechaVencimiento: Date | null;
  totalARS: number;
  totalUSD: number;
  pagoMinimoARS: number;
  cuentaDebito: string | null;
  hashPdf: string | null;
  refStoragePdf: string | null;
  parseadoEn: Date;
  confirmadoEn: Date | null;
  confirmadoPor: string | null;
  observaciones: string | null;
}

export interface MatchTexto { incluye: string[]; excluye: string[]; }

export interface ExpectedItem {
  id: string;
  tipo: 'Gasto' | 'Ingreso';
  activo: boolean;
  categoria: string | null;
  subcategoria: string | null;
  etiqueta: string | null;
  persona: string | null;
  moneda: 'ARS' | 'USD';
  banco: string | null;
  montoEsperado: number | null;
  diaVencimiento: number | null;
  autoCalendario: boolean;
  notas: string | null;
  tarjetaCodigo: string | null;
  matchTexto: MatchTexto | null;
}

export interface FamiliaMiembro {
  nombre: string;
  emails: string[];
  rol: 'admin' | 'dependiente';
  activo: boolean;
}

export interface FamiliaConfig {
  miembros: Record<string, FamiliaMiembro>;
  categorias: string[];
  bancos: string[];
  tarjetas: Array<{
    codigo: string;
    banco: string;
    tipo: string;
    titular: string;
    cuentaDebito: string;
  }>;
  actualizadoEn: Date;
}
