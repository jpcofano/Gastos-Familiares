// F9.193 — Lista blanca de candidatos para la sección "oportunidades" del informe.
//
// Por qué: la revisión de Gemini del prompt v3 (13-oct-2026) marcó que pedir "candidatos del
// universo" en abierto invita a inventar tickers y rendimientos. La propia sugerencia de Gemini lo
// probó: propuso CEDEARs de SHV/BIL, que NO existen en BYMA. El modelo ahora elige de esta lista o
// propone una tipología genérica; nunca un ticker suelto.
//
// Módulo PURO. Es una ELECCIÓN curada, no un catálogo exhaustivo: lo más líquido y relevante para
// los faltantes típicos de esta cartera (liquidez USD, cobertura de crash, global amplio y
// defensivo, renta fija USD no soberana). Cada grupo dice de dónde salió y a qué fecha.
//
// Fuentes (verificadas el 13-oct-2026):
//   - BYMA, "CEDEARs negociables en BYMA" (PDF del 17-abr-2026) + altas del 1-jun-2026 (RSP, EWY,
//     XME, ICLN) — ETFs listados como CEDEAR.
//   - Bloomberg Línea, 10-jul-2026: el CEO de BYMA confirma que NO hay CEDEARs de Treasuries ni
//     de ETFs de renta fija internacional (en conversaciones con la CNV, sin fecha).
//   - Banco Hipotecario, informe de ON del 3-jul-2026 — tickers, ley, vencimiento, TIR y duration.
//   - CAFCI, ficha de Balanz Money Market USD (fondo 1538).
// Los datos de TIR/duration son a la fecha de la fuente: el modelo los tiene que refrescar.
//
// Mantenimiento: revisar cada trimestre. Altas de CEDEARs: newsroom de BYMA. ON: informes de ON
// de bancos/brokers. Si un candidato deja de cotizar, sacarlo de acá (no del prompt).

export type CandidatoUniverso = {
  ticker: string;          // código BYMA, o '' si es una tipología genérica
  nombre: string;
  tipo: 'cedear_etf' | 'on_usd' | 'soberano_usd' | 'fci' | 'generico';
  cubre: string[];         // faltantes que puede resolver (ver CUBRE)
  factor: string;          // factor de la app al que SUMA exposición (para no concentrar sin querer)
  dato?: string;           // métrica de la fuente, con fecha
  fuente: string;
};

/** Vocabulario de `cubre`. */
export const CUBRE = {
  liquidez_usd: 'cuenta para el piso de caja',
  cobertura_crash: 'tiende a amortiguar en caídas globales',
  global_amplio: 'renta variable global diversificada',
  global_defensivo: 'sectores defensivos globales',
  emergentes: 'renta variable emergente',
  renta_fija_usd: 'renta fija en dólares no soberana',
  soberano_usd: 'soberano argentino en dólares',
  cripto_wrapper: 'misma exposición cripto vía otro custodio',
  pesos: 'instrumentos en pesos',
} as const;

const BYMA = 'BYMA, CEDEARs negociables (17-abr-2026 + altas 1-jun-2026)';
const HIPO = 'Banco Hipotecario, informe de ON 3-jul-2026';

export const UNIVERSO_CANDIDATOS: CandidatoUniverso[] = [
  // ── Liquidez USD (cuenta para el piso: efectivo USD, stablecoins, FCI money market USD) ──
  { ticker: '', nombre: 'FCI money market en USD (p. ej. Balanz Money Market USD, CAFCI 1538)', tipo: 'fci',
    cubre: ['liquidez_usd'], factor: 'Cash y stablecoins', fuente: 'CAFCI, ficha regulatoria fondo 1538' },
  { ticker: '', nombre: 'Caución en dólares (BYMA)', tipo: 'generico',
    cubre: ['liquidez_usd'], factor: 'Cash y stablecoins', fuente: 'BYMA' },

  // ── Global amplio (CEDEAR de ETF) ──
  { ticker: 'SPY', nombre: 'SPDR S&P 500', tipo: 'cedear_etf', cubre: ['global_amplio'], factor: 'Global desarrollado', fuente: BYMA },
  { ticker: 'IVV', nombre: 'iShares Core S&P 500', tipo: 'cedear_etf', cubre: ['global_amplio'], factor: 'Global desarrollado', fuente: BYMA },
  { ticker: 'RSP', nombre: 'Invesco S&P 500 Equal Weight', tipo: 'cedear_etf', cubre: ['global_amplio'], factor: 'Global desarrollado', fuente: BYMA },
  { ticker: 'ACWI', nombre: 'iShares MSCI ACWI (mundo)', tipo: 'cedear_etf', cubre: ['global_amplio'], factor: 'Global desarrollado', fuente: BYMA },
  { ticker: 'EFA', nombre: 'iShares MSCI EAFE (desarrollados ex-EE.UU.)', tipo: 'cedear_etf', cubre: ['global_amplio'], factor: 'Global desarrollado', fuente: BYMA },
  { ticker: 'VEA', nombre: 'Vanguard FTSE Developed Markets', tipo: 'cedear_etf', cubre: ['global_amplio'], factor: 'Global desarrollado', fuente: BYMA },
  { ticker: 'QQQ', nombre: 'Invesco QQQ (Nasdaq 100)', tipo: 'cedear_etf', cubre: ['global_amplio'], factor: 'Global desarrollado', fuente: BYMA },
  { ticker: 'VIG', nombre: 'Vanguard Dividend Appreciation', tipo: 'cedear_etf', cubre: ['global_amplio', 'global_defensivo'], factor: 'Global desarrollado', fuente: BYMA },
  { ticker: 'SPHQ', nombre: 'Invesco S&P 500 Quality', tipo: 'cedear_etf', cubre: ['global_amplio', 'global_defensivo'], factor: 'Global desarrollado', fuente: BYMA },

  // ── Global defensivo (sectoriales) ──
  { ticker: 'XLV', nombre: 'Health Care Select Sector SPDR', tipo: 'cedear_etf', cubre: ['global_defensivo'], factor: 'Global desarrollado', fuente: BYMA },
  { ticker: 'XLP', nombre: 'Consumer Staples Select Sector SPDR', tipo: 'cedear_etf', cubre: ['global_defensivo'], factor: 'Global desarrollado', fuente: BYMA },
  { ticker: 'XLU', nombre: 'Utilities Select Sector SPDR', tipo: 'cedear_etf', cubre: ['global_defensivo'], factor: 'Global desarrollado', fuente: BYMA },

  // ── Emergentes ──
  { ticker: 'IEMG', nombre: 'iShares Core MSCI Emerging Markets', tipo: 'cedear_etf', cubre: ['emergentes'], factor: 'Global (emergentes)', fuente: BYMA },
  { ticker: 'EEM', nombre: 'iShares MSCI Emerging Markets', tipo: 'cedear_etf', cubre: ['emergentes'], factor: 'Global (emergentes)', fuente: BYMA },

  // ── Oro y metales (lo más parecido a una cobertura de crash dentro del universo) ──
  { ticker: 'GLD', nombre: 'SPDR Gold Trust', tipo: 'cedear_etf', cubre: ['cobertura_crash'], factor: 'Oro', fuente: BYMA },
  { ticker: 'GDX', nombre: 'VanEck Gold Miners (acciones mineras: más volátil que el oro)', tipo: 'cedear_etf', cubre: ['cobertura_crash'], factor: 'Oro / materiales', fuente: BYMA },

  // ── Cripto vía CEDEAR: NO diversifica el factor, sí la contraparte ──
  { ticker: 'IBIT', nombre: 'iShares Bitcoin Trust', tipo: 'cedear_etf', cubre: ['cripto_wrapper'], factor: 'Cripto', fuente: BYMA },
  { ticker: 'ETHA', nombre: 'iShares Ethereum Trust', tipo: 'cedear_etf', cubre: ['cripto_wrapper'], factor: 'Cripto', fuente: BYMA },

  // ── ON corporativas en USD (especie D = USD MEP). Ojo con el factor: varias SUMAN oil & gas. ──
  { ticker: 'YMCYD', nombre: 'YPF 2028 (ley NY)', tipo: 'on_usd', cubre: ['renta_fija_usd'], factor: 'Oil & gas', dato: 'TIR 5,23%, duration 1,84 (3-jul-2026)', fuente: HIPO },
  { ticker: 'YM34D', nombre: 'YPF 2034 (ley NY)', tipo: 'on_usd', cubre: ['renta_fija_usd'], factor: 'Oil & gas', dato: 'TIR 7,38%, duration 5,36 (3-jul-2026)', fuente: HIPO },
  { ticker: 'MGCOD', nombre: 'Pampa Energía 2034 (ley NY, mín. 10.000)', tipo: 'on_usd', cubre: ['renta_fija_usd'], factor: 'Oil & gas', dato: 'TIR 7,35%, duration 5,87 (3-jul-2026)', fuente: HIPO },
  { ticker: 'VSCTD', nombre: 'Vista Energy 2035 (ley NY, mín. 10.000)', tipo: 'on_usd', cubre: ['renta_fija_usd'], factor: 'Oil & gas', dato: 'TIR 7,27%, duration 6,40 (3-jul-2026)', fuente: HIPO },
  { ticker: 'PLC6D', nombre: 'Pluspetrol 2029 (ley AR)', tipo: 'on_usd', cubre: ['renta_fija_usd'], factor: 'Oil & gas', dato: 'TIR 6,41%, duration 2,16 (3-jul-2026)', fuente: HIPO },
  { ticker: 'TLCMD', nombre: 'Telecom 2031 (ley NY)', tipo: 'on_usd', cubre: ['renta_fija_usd'], factor: 'Corporativo AR (telecom)', dato: 'TIR 7,03%, duration 3,01 (3-jul-2026)', fuente: HIPO },
  { ticker: 'ARC1D', nombre: 'Aeropuertos Argentina 2000 2031 (ley NY)', tipo: 'on_usd', cubre: ['renta_fija_usd'], factor: 'Corporativo AR (infraestructura)', dato: 'TIR 3,41%, duration 4,01 (3-jul-2026)', fuente: HIPO },
  { ticker: 'IRCOD', nombre: 'IRSA 2029 (ley AR)', tipo: 'on_usd', cubre: ['renta_fija_usd'], factor: 'Corporativo AR (real estate)', dato: 'TIR 6,06%, duration 2,62 (3-jul-2026)', fuente: HIPO },
  { ticker: 'BACHD', nombre: 'Banco Macro 2031 (ley NY, mín. 1.000)', tipo: 'on_usd', cubre: ['renta_fija_usd'], factor: 'Bancos AR', dato: 'TIR 6,93%, duration 3,56 (3-jul-2026)', fuente: HIPO },
  { ticker: 'BYCHD', nombre: 'Banco Galicia 2028 (ley NY)', tipo: 'on_usd', cubre: ['renta_fija_usd'], factor: 'Bancos AR', dato: 'TIR 6,62%, duration 1,77 (3-jul-2026)', fuente: HIPO },

  // ── Soberano AR en USD (bonos del canje 2020; GD = ley NY, AL = ley local) ──
  { ticker: 'GD30', nombre: 'Global 2030 (ley NY)', tipo: 'soberano_usd', cubre: ['soberano_usd'], factor: 'Soberano AR hard-dollar', fuente: 'Canje 2020; en cartera' },
  { ticker: 'GD35', nombre: 'Global 2035 (ley NY)', tipo: 'soberano_usd', cubre: ['soberano_usd'], factor: 'Soberano AR hard-dollar', fuente: 'Canje 2020; en cartera' },
  { ticker: 'GD38', nombre: 'Global 2038 (ley NY)', tipo: 'soberano_usd', cubre: ['soberano_usd'], factor: 'Soberano AR hard-dollar', fuente: 'Canje 2020' },
  { ticker: 'GD41', nombre: 'Global 2041 (ley NY)', tipo: 'soberano_usd', cubre: ['soberano_usd'], factor: 'Soberano AR hard-dollar', fuente: 'Canje 2020' },
  { ticker: 'AL30', nombre: 'Bonar 2030 (ley local)', tipo: 'soberano_usd', cubre: ['soberano_usd'], factor: 'Soberano AR hard-dollar', fuente: 'Canje 2020' },

  // ── Pesos: SOLO tipologías. Los tickers vigentes cambian con cada licitación del Tesoro. ──
  { ticker: '', nombre: 'LECAP / BONCAP (tasa fija) vigentes', tipo: 'generico', cubre: ['pesos'], factor: 'Soberano AR pesos / CER', fuente: 'Secretaría de Finanzas (licitaciones)' },
  { ticker: '', nombre: 'BONCER (ajuste CER) vigentes', tipo: 'generico', cubre: ['pesos'], factor: 'Soberano AR pesos / CER', fuente: 'Secretaría de Finanzas (licitaciones)' },
  { ticker: '', nombre: 'Letras / bonos dollar linked del Tesoro', tipo: 'generico', cubre: ['pesos'], factor: 'Soberano AR pesos / CER', fuente: 'Secretaría de Finanzas (licitaciones)' },
];

/**
 * Listados en BYMA pero FUERA del universo por decisión: apalancados, inversos, volatilidad y
 * futuros. Se comportan como derivados, y el universo excluye derivados.
 */
export const UNIVERSO_EXCLUIDOS = [
  'TQQQ', 'SPXL',  // apalancados 3x
  'SH', 'PSQ',     // inversos
  'VXX',           // volatilidad (futuros de VIX)
  'USO',           // futuros de petróleo
];

/** Lo que el modelo tiende a sugerir y NO existe en el universo. */
export const UNIVERSO_NO_DISPONIBLE = [
  'CEDEARs de bonos del Tesoro de EE.UU. o de ETFs de renta fija internacional (SHV, BIL, SGOV, TLT, IEF, AGG, LQD, HYG, EMB, BND): no existen en BYMA (CEO de BYMA, 10-jul-2026). Exposición a Treasuries solo con cuenta en el exterior, que está fuera del universo.',
  'VOO, VT, VWO, IAU, FBTC: no figuran en la lista de CEDEARs de BYMA (17-abr-2026). Equivalentes disponibles: IVV/SPY, ACWI, IEMG, GLD, IBIT.',
];

/** Versión compacta para el prompt; marca lo que ya está en la cartera. */
export function universoParaPrompt(tickersEnCartera: Set<string>) {
  return {
    candidatos: UNIVERSO_CANDIDATOS.map(c => ({
      ...(c.ticker ? { ticker: c.ticker } : {}),
      nombre: c.nombre,
      tipo: c.tipo,
      cubre: c.cubre,
      sumaAFactor: c.factor,
      ...(c.dato ? { dato: c.dato } : {}),
      ...(c.ticker && tickersEnCartera.has(c.ticker) ? { enCartera: true } : {}),
    })),
    excluidos: UNIVERSO_EXCLUIDOS,
    noDisponible: UNIVERSO_NO_DISPONIBLE,
  };
}
