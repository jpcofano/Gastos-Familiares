// F9.187 §1 — reconectar Firestore cuando la app vuelve al frente.
//
// Síntoma (Juan, 2026-10-07): "pasa seguido que tengo que refrescar". Caso medido en F9.186: el
// resumen 37ab6ea1 quedó 'parseado' en el servidor y la app siguió mostrando "Extrayendo…" ~7 min,
// hasta recargar. El listener (onSnapshot) no recibió el cambio y no dio ningún error.
//
// En una PC no se reprodujo (docs/F9.187.txt §0: congelada 3 min, el cambio llega al volver). En el
// teléfono pasa algo más que el congelado: Android corta sockets y el servidor real cierra conexiones
// largas. Esto es una MITIGACIÓN, aplicada por decisión de Juan sin haberlo visto: al volver de más de
// 20 s oculta, o cuando vuelve la red, se baja y se sube la red de Firestore, lo que obliga a todos los
// listeners a re-suscribirse contra el servidor. Una a la vez y con 5 s mínimos entre dos.
//
// Cada reconexión queda en la consola ("[F9.187] reconexión …") y en localStorage (las últimas 50, en
// 'f9187-reconexiones'), para poder mirarlas con la depuración remota si vuelve a pasar.
import { disableNetwork, enableNetwork, type Firestore } from 'firebase/firestore';

const MIN_OCULTA_MS = 20_000;
const MIN_ENTRE_MS = 5_000;
const MAX_RECONEXION_MS = 15_000;
const CLAVE = 'f9187-reconexiones';

function registrar(texto: string): void {
  console.log(`[F9.187] ${texto}`);
  try {
    const l = JSON.parse(localStorage.getItem(CLAVE) ?? '[]') as string[];
    l.push(`${new Date().toISOString()} ${texto}`);
    localStorage.setItem(CLAVE, JSON.stringify(l.slice(-50)));
  } catch { /* sin localStorage (modo privado, cuota): queda solo la consola */ }
}

export function instalarReconexion(db: Firestore): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  let ocultaDesde: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
  let enCurso = false;
  let ultima = 0;

  async function reconectar(motivo: string): Promise<void> {
    const ahora = Date.now();
    if (enCurso || ahora - ultima < MIN_ENTRE_MS) return;
    enCurso = true;
    ultima = ahora;
    try {
      // Si el SDK no responde, el candado no puede quedar tomado para siempre: a los 15 s se libera y la
      // próxima vuelta al frente reintenta. La operación de red sigue su curso por su lado.
      const listo = await Promise.race([
        (async () => { await disableNetwork(db); await enableNetwork(db); return true; })(),
        new Promise<false>(r => setTimeout(() => r(false), MAX_RECONEXION_MS)),
      ]);
      registrar(listo ? `reconexión (${motivo})` : `reconexión colgada > ${MAX_RECONEXION_MS / 1000}s (${motivo})`);
    } catch (e) {
      registrar(`reconexión FALLÓ (${motivo}): ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      enCurso = false;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { ocultaDesde = Date.now(); return; }
    const oculta = ocultaDesde == null ? 0 : Date.now() - ocultaDesde;
    ocultaDesde = null;
    if (oculta > MIN_OCULTA_MS) void reconectar(`oculta ${Math.round(oculta / 1000)}s`);
  });
  window.addEventListener('online', () => { void reconectar('volvió la red'); });
}
