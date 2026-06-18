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
  confirmadoPago: boolean;
  numeroComprobante: string | null;
  hashPdf: string | null;
  refStoragePdf: string | null;
  notas: string | null;
  creadoEn: Date;
  actualizadoEn: Date;
}

export interface AjusteConsolidado {
  concepto: string;
  montoARS: number;
  montoUSD: number;
  origen?: 'pdf' | 'manual';  // undefined ⇒ 'pdf' (compat con docs existentes)
}

export interface MovimientoParseado {
  seq: number;
  tipoLinea: 'consumo' | 'cuota' | 'impuesto' | 'reintegro_percepcion' | 'bonificacion' | 'reverso';
  fechaConsumo: string | null;   // YYYY-MM-DD
  descripcionRaw: string;
  nroCupon: string;
  cuotaActual: number;
  cuotaTotal: number;
  moneda: 'ARS' | 'USD';
  monto: number;                 // siempre positivo
  personaDetectada: string;      // nombre canónico ('María', 'Juan', etc.) o '' si no resuelve
  esBonificacion: boolean;
  esReverso: boolean;
  esImpuesto: boolean;
  // Campos editables en el preview (rellenados por el usuario antes de confirmar)
  personaConfirmada: string | null;
  categoria: string | null;
  subcategoria: string | null;
  incluir: boolean;
}

export interface CardStatement {
  id: string;
  tarjetaCodigo: string | null;
  banco: string;
  tarjeta: string;
  periodo: string;
  estado: 'subido' | 'parseado' | 'confirmado' | 'error' | 'requiere_tarjeta';
  nroResumen: string | null;
  titular: string | null;
  fechaCierre: Date | null;
  fechaVencimiento: Date | null;
  totalARS: number;
  totalUSD: number;
  pagoMinimoARS: number;
  cuentaDebito: string | null;
  hashPdf: string | null;
  refStoragePdf: string | null;
  subidoPor: string | null;
  subidoEn: Date | null;
  parseadoEn: Date | null;
  confirmadoEn: Date | null;
  confirmadoPor: string | null;
  observaciones: string | null;
  errorExtraccion: string | null;
  movimientosParseados: MovimientoParseado[];
  ajustesConsolidado: AjusteConsolidado[];
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
  periodicidad: 'mensual' | 'bimestral' | 'trimestral' | 'anual' | 'unico';
  pagoAutomatico: boolean;
}

export interface DatosExtraidos {
  tipoDocumento: string;
  fecha: string | null;              // ISO YYYY-MM-DD, emisión
  montoTotal: number | null;         // = primer vencimiento / monto base
  moneda: 'ARS' | 'USD';
  comercioRazonSocial: string | null;
  cuit: string | null;               // XX-XXXXXXXX-X
  numeroOperacion: string;           // real o pseudo-número YYYY-MM-<slug>
  // F6.2.2 — opcionales para compat con docs pre-F6.2.2
  periodoFacturado?: string | null;  // "YYYY-MM" o texto crudo
  numeroCliente?: string | null;     // nro cliente/cuenta/suministro
  vencimientos?: Array<{ fecha: string | null; monto: number | null }>;  // [] si no aplica
}

export interface PropuestaMatch {
  rama: 0 | 1 | 2 | 3;
  movimientoId?: string;
  itemEsperadoId?: string;
  candidatos?: Array<{ tipo: 'movimiento' | 'esperado'; id: string; score?: number }>;
  calculadoEn: Date;
}

export interface Comprobante {
  id: string;         // = hashPdf (doc-id)
  hashPdf: string;
  nombreArchivo: string;
  contentType: string;
  tamano: number;
  refStoragePdf: string;
  subidoPor: string;  // memberId
  subidoEn: Date;
  estado: 'subido' | 'extraido' | 'vinculado' | 'error';
  errorExtraccion?: string;
  datosExtraidos?: DatosExtraidos;
  propuestaMatch?: PropuestaMatch;
}

export interface FamiliaMiembro {
  nombre: string;
  emails: string[];
  rol: 'admin' | 'dependiente';
  activo: boolean;
  alias?: string[];  // minúscula, sin acentos — solo para resolverNombreMiembro(), nunca se muestran en UI
}

export interface Entrante {
  hash: string;
  rutaStorage: string;
  mimeType: string;
  nombreArchivo: string | null;
  tamano: number | null;
  creadoPor: string;
  origen: 'app' | 'share_target';
  estado: 'pendiente' | 'ruteado' | 'ambiguo' | 'error';
  tipoDetectado?: 'comprobante' | 'resumen' | 'ambiguo';
  destino?: { coleccion: 'comprobantes' | 'resumenesTarjeta'; id: string };
  motivoDeteccion?: string;
  creadoEn: Date;
  actualizadoEn: Date;
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
    numeroCuenta?: string;
    ultimos4?: string;
  }>;
  actualizadoEn: Date;
}
