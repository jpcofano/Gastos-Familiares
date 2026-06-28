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
  // F6.8 — propagado desde datosExtraidos del comprobante al confirmar
  destinoCbu?: string | null;
  destinoCuit?: string | null;
  destinoAlias?: string | null;
  destinoNombre?: string | null;
  vencimientos?: Array<{ fecha: string | null; monto: number | null }> | null;
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
  // F6.8 — destino del pago/transferencia
  destinoCbu?: string | null;        // CBU/CVU del destinatario (22 dígitos)
  destinoCuit?: string | null;       // CUIT/CUIL del destinatario (11 dígitos, solo dígitos)
  destinoAlias?: string | null;      // alias CVU/CBU del destinatario
  destinoNombre?: string | null;     // nombre/razón social del destinatario
}

export interface Destino {
  destinoNorm: string;
  tipo: 'cbu' | 'cuit' | 'alias' | 'nombre';
  itemEsperadoId?: string;
  categoria?: string;
  subcategoria?: string;
  etiqueta?: string;
  confianza: number;
  creadoPor: string;
  actualizadoEn: Date;
}

export interface PropuestaMatch {
  rama: 0 | 1 | 2 | 3;
  movimientoId?: string;
  itemEsperadoId?: string;
  candidatos?: Array<{
    tipo: 'movimiento' | 'esperado';
    id: string;
    score?: number;
    descripcion?: string;
    monto?: number;
    moneda?: 'ARS' | 'USD';
    fecha?: string;            // ISO YYYY-MM-DD, para mostrar al usuario
  }>;
  calculadoEn: Date;
  // F6.8
  origenDestino?: boolean;
  esAdicional?: boolean;
  categoriaPrellena?: string | null;
  subcategoriaPrellena?: string | null;
  etiquetaPrellena?: string | null;
  dedupInfo?: { movId: string; mes: string | null; monto: number | null; item?: string | null };
  // F6.9 — la rama 1 del flujo de comprobantes es siempre reconciliación por payee
  origenReconciliacion?: boolean;
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

// F9.36 — config/familia.bancos pasa de string[] a MedioPago[] (editable desde
// Perfil › Medios de pago). id estable independiente del nombre (permite
// renombrar sin romper aliasDe ni los movimientos históricos, que guardan el
// nombre en `movimientos.banco`, no el id).
export interface MedioPago {
  id: string;
  nombre: string;
  color: string;          // hex #RRGGBB
  tipo: 'Banco' | 'Billetera' | 'Efectivo';
  dominio?: string;        // para el logo vía Brandfetch (BankLogo, F9.20)
  aliasDe?: string;        // id de otro medio: este se agrupa/etiqueta como ese (F9.23)
  oculto?: boolean;        // no aparece como fila propia en Medios de pago
}

// F9.38 — categoria gana id estable (antes string[] plano): renombrar ya no
// huerfana movimientos/diccionario/subcategorias, la callable cascada el
// cambio de nombre server-side (ver guardarTaxonomia en functions).
export interface CategoriaItem {
  id: string;
  nombre: string;
  activo: boolean;
}

export interface FamiliaConfig {
  miembros: Record<string, FamiliaMiembro>;
  categorias: CategoriaItem[];
  bancos: MedioPago[];
  tarjetas: Array<{
    codigo: string;
    banco: string;
    tipo: string;
    titular: string;
    cuentaDebito: string;
    numeroCuenta?: string;
    ultimos4?: string[];   // últimos 4 dígitos de cada tarjeta física del cuente (titular + adicionales)
    // F9.35 — opcionales: no hay fuente legacy, se cargan a mano cuando se conozcan
    // (no inventar valores). Sin cierreDia/venceDia no se rompe nada: cada CardStatement
    // ya trae su propia fechaCierre/fechaVencimiento extraída del PDF (F6.5).
    cierreDia?: number;     // día del mes de cierre del resumen (1-31)
    venceDia?: number;      // día del mes de vencimiento del pago (1-31)
    tipoTarjeta?: 'credito' | 'debito';
  }>;
  // Unidades funcionales del titular — para extracción correcta en liquidaciones de expensas
  unidades?: Array<{ uf: string; alias?: string; etiqueta?: string }>;
  actualizadoEn: Date;
}
