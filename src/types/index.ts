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
  parentId: string | null;
  cardStatementId: string | null;
  expectedItemId: string | null;
  numeroComprobante: string | null;
  pdfHash: string | null;
  pdfStorageRef: string | null;
  notas: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  pdfHash: string | null;
  pdfStorageRef: string | null;
  parsedAt: Date;
  confirmedAt: Date | null;
  confirmedBy: string | null;
  observaciones: string | null;
}

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
  autoCalendar: boolean;
  notas: string | null;
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
