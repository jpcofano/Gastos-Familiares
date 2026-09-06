// Tipos de dominio puros — sin dependencias de ningún SDK.
// Campos fecha usan Date. La conversión Timestamp↔Date es trabajo de F4.

export interface Movement {
  id: string;
  idLegacy: string;
  fecha: Date;
  fechaConsumoOriginal: Date | null;
  // Mes de IMPUTACIÓN (YYYY-MM). Es el campo por el que consultan todas las vistas
  // (where('mes','==',…)), así que es el mes en el que el movimiento cuenta, no
  // necesariamente el de su fecha.
  mes: string;
  // F9.118 — el mes lo fijó una persona a mano. Mientras esté en true, editar la fecha NO
  // recalcula `mes`: un pago del 30/8 que corresponde a septiembre se queda en septiembre.
  mesManual: boolean;
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
  // F9.99.7 — fecha real en que confirmadoPago pasó a true (puede diferir del mes del ítem:
  // pago adelantado de un futuro, o registro tardío de un vencido). null = nunca confirmado
  // por este mecanismo (movs legacy / creados antes de F9.99.7).
  pagadoEn?: Date | null;
  // F9.99.7 — marca movimientos creados por el botón "Registrar pago" del checklist, para que
  // una futura deduplicación (si el extracto trae el mismo débito) pueda detectarlo.
  registradoDesdeChecklist?: boolean;
}

export interface AjusteConsolidado {
  concepto: string;
  montoARS: number;
  montoUSD: number;
  origen?: 'pdf' | 'manual';  // undefined ⇒ 'pdf' (compat con docs existentes)
  // F9.161 §4 — obligatorios para `origen: 'manual'` desde ahora; ausentes en los 10 ajustes
  // anteriores, que por eso son indiagnosticables.
  motivo?: string;
  creadoPor?: string;
  creadoEn?: string;          // ISO
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
  // F9.161 §1 — el importe CON el signo del PDF. `monto` sigue siendo su valor absoluto y toda la
  // lógica que depende de él no cambia. Opcional porque las líneas extraídas antes de F9.161 no lo
  // tienen; `null` significa "no se sabe", y el guard del signo no actúa sin este dato.
  montoFirmado?: number | null;
  // F9.161 §1 — título del bloque del PDF donde apareció el renglón ("Consumos Maria Lascano",
  // "Sus pagos y ajustes realizados", …). Es lo que le da contexto al signo.
  seccion?: string | null;
  personaDetectada: string;      // nombre canónico ('María', 'Juan', etc.) o '' si no resuelve
  esBonificacion: boolean;
  esReverso: boolean;
  esImpuesto: boolean;
  // Campos editables en el preview (rellenados por el usuario antes de confirmar)
  personaConfirmada: string | null;
  categoria: string | null;
  subcategoria: string | null;
  incluir: boolean;
  // F9.161 §4 — el banco NO cobra esta línea (caso real: la percepción `DB.RG 5617 30%` cuando los
  // consumos en dólares se pagaron con dólares propios). Es INDEPENDIENTE de `incluir`:
  //   incluir: false   → no se crea movimiento para la línea; el objetivo del cuadre NO se mueve.
  //   noDebitado: true → el objetivo del cuadre BAJA por ese monto y el movimiento-total sale por
  //                      el neto. Las dos puntas juntas.
  // Conflacionarlos bajaría el objetivo por plata que el banco sí cobra (medido en F9.160 §3.5:
  // de las 5 líneas con `incluir:false`, solo 2 son "no se debita").
  noDebitado?: boolean;
}

export interface CardStatement {
  id: string;
  tarjetaCodigo: string | null;
  banco: string;
  tarjeta: string;
  periodo: string;
  estado: 'subido' | 'parseado' | 'confirmado' | 'error' | 'requiere_tarjeta' | 'duplicado';
  tipoError?: 'infra' | 'parsing' | null;
  intentos?: number;
  duplicadoDe?: string | null;
  nroResumen: string | null;
  titular: string | null;
  fechaCierre: Date | null;
  fechaVencimiento: Date | null;
  totalARS: number;
  totalUSD: number;
  // F9.163 §1 — el bloque consolidado del encabezado, que es lo que dice si un ajuste pertenece al
  // período anterior o a éste. Opcionales: los resúmenes anteriores a F9.163 no los tienen y sin
  // ellos la regla se ABSTIENE (el cuadre queda exactamente como hoy). `null` ≠ `0`: cero es un mes
  // sin pagos, null es "no se sabe".
  saldoAnteriorARS?: number | null;
  saldoAnteriorUSD?: number | null;
  pagosDelPeriodoARS?: number | null;
  pagosDelPeriodoUSD?: number | null;
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
  // F9.154 §2 — identificadores propios de ESTE ítem dentro de un emisor compartido (el número de
  // suministro de AySA, por ejemplo). Sirven para desambiguar cuando dos ítems comparten destino.
  // Se guardan varios porque el mismo suministro llega con formatos distintos según el documento:
  // medido en producción, "2651943" en la factura y "000000002651943" en el aviso de deuda.
  clavesDesambiguacion: string[] | null;
  // F9.154 §3 — día de corte para imputar el movimiento a un mes. `null` = comportamiento de
  // siempre (el mes sale de la fecha). Con corte N: día >= N → mes de la fecha; día < N → mes
  // anterior. Existe por el sueldo, que entra entre el 28 y el 3 y caía un mes distinto cada vez.
  diaCorteImputacion: number | null;
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
  // F9.155 §1 — dirección y contraparte. `destino*` es siempre el PAYEE y por eso no puede describir
  // un cobro: en una acreditación la otra parte es quien ordena el pago, no quien lo recibe.
  direccion?: 'entrante' | 'saliente' | null;
  contraparteNombre?: string | null;
  contraparteCuit?: string | null;
  contraparteCbu?: string | null;
}

// F9.154 §2 — un destino compartido por dos ítems esperados (los dos suministros de AySA, las dos
// acreditaciones de Accenture) se resuelve mirando un campo del comprobante. Sin este objeto el
// destino se comporta como siempre: `itemEsperadoId` y listo.
export interface DesambiguacionDestino {
  campo:   'numeroCliente' | 'moneda';
  valores: Record<string, string>;   // valor del campo → itemEsperadoId
}

export interface Destino {
  destinoNorm: string;
  tipo: 'cbu' | 'cuit' | 'alias' | 'nombre';
  itemEsperadoId?: string;
  desambiguacion?: DesambiguacionDestino;
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
  // F9.154 §3 — mes de imputación ya resuelto por el server con el corte del ítem que matcheó.
  mesImputacion?: string;
  // F6.9 — la rama 1 del flujo de comprobantes es siempre reconciliación por payee
  origenReconciliacion?: boolean;
  // F9.82 — pase débil por nombre: rama 1 candidatos, nunca auto-confirma
  reconciliacionDebil?: boolean;
  // F9.99.9 — el picker de agenda unificada saldó un suelto (movimiento sin plantilla)
  // en vez de una plantilla — RazonVinculado lo distingue de "Cargado como nuevo".
  origenSuelto?: boolean;
  // F9.106 — auto-match por destino graduado por confianza (solo rama 2 vía matchPorDestino):
  // true en la banda 0.7-0.9 (pide confirmación con item+mes editables), false/ausente ≥0.9
  // (alta silenciosa) o cuando el match no viene de destino (sin cambios, siempre confirma).
  requiereConfirmacion?: boolean;
  confianza?: number;
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
  // F9.139 — el medio que se asume cuando no se pudo detectar ninguno. Exactamente uno debería
  // tenerlo en true; la unicidad se valida en el cliente (ver docs/CLAUDE.md → Medios de pago).
  // `tipo` conserva 'Efectivo' aunque el medio Efectivo ya no exista: es el TIPO de medio, no el
  // medio, y sacarlo obligaría a tocar TIPOS en el callable (functions/src/index.ts:1892) —
  // con eso el deploy deja de ser solo hosting, a cambio de nada.
  porDefecto?: boolean;
}

// F9.38 — categoria gana id estable (antes string[] plano): renombrar ya no
// huerfana movimientos/diccionario/subcategorias, la callable cascada el
// cambio de nombre server-side (ver guardarTaxonomia en functions).
export interface CategoriaItem {
  id: string;
  nombre: string;
  activo: boolean;
}

export interface TarjetaItem {
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
}

export interface FamiliaConfig {
  miembros: Record<string, FamiliaMiembro>;
  categorias: CategoriaItem[];
  bancos: MedioPago[];
  tarjetas: TarjetaItem[];
  // Unidades funcionales del titular — para extracción correcta en liquidaciones de expensas
  unidades?: Array<{ uf: string; alias?: string; etiqueta?: string }>;
  // F9.43 — mail de calendario del legacy (Config!B4 de la planilla), canal opt-in
  // de recordatorios en Google Calendar. null si nunca se capturó.
  calendarEmail?: string | null;
  // F9.46 — switch global del Canal B (admin). default false hasta que el
  // admin lo prenda. Reemplaza el gate por-ítem autoCalendario (F9.45).
  calendarSync?: boolean;
  actualizadoEn: Date;
}
