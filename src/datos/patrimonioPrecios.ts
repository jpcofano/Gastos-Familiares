// F9.141 — acceso de LECTURA a la serie de precios y a los indicadores.
//
// El motor (routing por tipo, detector de splits, matemática de indicadores) vive en
// functions/src/patrimonioPrecios.ts, porque el cron es quien calcula y functions/ tiene
// rootDir propio. Este módulo NO reimplementa nada de eso: si acá aparece una tabla de
// paneles o una media móvil, hay dos motores y el error ya está cometido.
//
// Contrato: docs/patrimonio/CLAUDE-PATRIMONIO.md → "Precios y serie diaria (F9.141)".
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import type { PreciosDiarios, IndicadoresPosicion, Semaforo } from '../types/patrimonio';

export async function cargarPreciosDiarios(ticker: string): Promise<PreciosDiarios | null> {
  const snap = await getDoc(doc(db, 'preciosDiarios', ticker));
  return snap.exists() ? (snap.data() as PreciosDiarios) : null;
}

export async function cargarIndicadores(ticker: string): Promise<IndicadoresPosicion | null> {
  const snap = await getDoc(doc(db, 'indicadoresPosicion', ticker));
  return snap.exists() ? (snap.data() as IndicadoresPosicion) : null;
}

/** Indexado por ticker, para pintar una grilla de posiciones sin N lecturas. */
export async function cargarIndicadoresPorTicker(): Promise<Map<string, IndicadoresPosicion>> {
  const snap = await getDocs(collection(db, 'indicadoresPosicion'));
  return new Map(snap.docs.map(d => [d.id, d.data() as IndicadoresPosicion]));
}

/**
 * Por qué un indicador está en null. La UI necesita distinguir "todavía no lo sabemos"
 * de "la fuente no lo tiene", que es lo que separa un bug de un dato ausente legítimo.
 */
export function motivoDeAusencia(ind: IndicadoresPosicion | null): string | null {
  if (!ind) return 'Sin datos de precio para este ticker.';
  switch (ind.motivo) {
    case 'sin_fuente':
      return 'Sin fuente de precios para este tipo de activo.';
    case 'sin_historico':
      return 'La fuente cotiza el papel pero no publica su historia.';
    case 'fuente_sin_serie':
      return 'La fuente no tiene serie histórica para este ticker.';
    default:
      break;
  }
  if (ind.estadoSerie === 'sospechosa') {
    return `Serie con un salto sin explicar: se calcula solo sobre ${ind.puntosDisponibles} ruedas posteriores.`;
  }
  return null;
}

/**
 * 🔴 es "está fuera de banda, mirá esto", no "vendé": un drawdown rojo puede ser motivo
 * de compra. La leyenda tiene que decirlo, o el semáforo se lee como señal de operación.
 */
export const LEYENDA_SEMAFOROS =
  'Los colores marcan qué mirar, no qué hacer. Un rojo indica que la posición está fuera ' +
  'de la banda esperada para su tipo de activo — puede ser motivo de compra tanto como de venta.';

export const ETIQUETA_SEMAFORO: Record<Semaforo, string> = {
  verde: 'dentro de banda',
  amarillo: 'en el borde',
  rojo: 'fuera de banda',
  sin_datos: 'sin datos suficientes',
};
