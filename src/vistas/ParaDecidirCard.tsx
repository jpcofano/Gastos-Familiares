// F9.196.1 §1.c — card "Para decidir (N)": los depósitos y retiros que no aparearon con otra cuenta
// (`flujosAuto/estado.pendientes`). Juan elige Aporte, Retiro o Interna; la decisión se guarda en
// `decisionesFlujo` y se aplica con "Aplicar" (recalcularCarteraViva corre los flujos) o con el cron.
//
// Aparece si hay pendientes. Sin pendientes pero con decisiones guardadas queda solo "Decididas"
// (plegada), para poder corregir una decisión ya aplicada. No decide nada sola: "¿Ya lo cargaste a
// mano?" solo avisa.
import { useEffect, useState } from 'react';
import { Card } from '../design-system/components';
import { Icon } from '../design-system/Icon';
import type { DecisionFlujo } from '../datos/compartido/patrimonioFlujosAuto';
import { posibleManual, FLUJOS_AUTO_DESDE } from '../datos/compartido/patrimonioFlujosAuto';
import {
  cargarDecisionesFlujo, cargarEstadoFlujosAuto, guardarDecisionFlujo,
  type DecisionGuardada, type EstadoFlujosAuto, type ResumenMovimientoFlujo, type PendienteResumen,
} from '../datos/patrimonioFlujosAutoLectura';
import { recalcularCarteraVivaCrudo } from '../datos/patrimonioCarteraVivaLectura';
import { mensajeDeErrorCallable } from '../datos/patrimonioRecalcular';

const fmtFecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
const fmtNum = (n: number, dec = 0) => n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const ROTULO: Record<DecisionFlujo, string> = { aporte: 'Aporte', retiro: 'Retiro', interna: 'Interna' };
const sub = { fontSize: 11, color: 'var(--gf-gray-400)', lineHeight: 1.45 } as const;

function monto(m: ResumenMovimientoFlujo, privado: boolean): string {
  if (m.ticker) return `${privado ? '•••' : fmtNum(Math.abs(m.cantidad ?? 0), 4).replace(/,?0+$/, '')} ${m.ticker}`;
  return privado ? '•••' : `${m.moneda === 'USD' ? 'U$S' : '$'} ${fmtNum(Math.abs(m.montoNeto), 2)}`;
}

export type FlujoManualParaComparar = { fecha: string; cuenta: string | null; montoUsd: number };

export default function ParaDecidirCard({ manuales, privado, onAplicado }: {
  /** Flujos MANUALES (no automáticos) de `flujosPatrimonio`, para "¿Ya lo cargaste a mano?". */
  manuales: FlujoManualParaComparar[];
  privado: boolean;
  /** Después de "Aplicar": Patrimonio recarga flujos y cartera viva. */
  onAplicado: () => void;
}) {
  const [estado, setEstado] = useState<EstadoFlujosAuto | null>(null);
  const [decisiones, setDecisiones] = useState<DecisionGuardada[]>([]);
  const [verDecididas, setVerDecididas] = useState(false);
  const [cambiando, setCambiando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null);

  const recargar = () => Promise.all([cargarEstadoFlujosAuto(), cargarDecisionesFlujo()])
    .then(([e, d]) => { setEstado(e); setDecisiones(d); })
    .catch(e => setAviso({ texto: `No se pudo leer: ${e instanceof Error ? e.message : String(e)}`, error: true }));
  useEffect(() => { recargar(); }, []);

  if (!estado) return null;
  // Un estado escrito antes de §1.a (sin `desde`) todavía trae los pendientes de 3 años: se filtran
  // acá también, y se pide "Aplicar" para recalcularlo.
  const desde = estado.desde ?? FLUJOS_AUTO_DESDE;
  const pendientes = estado.pendientes.filter(p => p.fecha >= desde);
  if (pendientes.length === 0 && estado.sinTc.length === 0 && decisiones.length === 0) return null;
  const soloDecididas = pendientes.length === 0 && estado.sinTc.length === 0;
  const decididaDe = new Map(decisiones.map(d => [d.clave, d]));
  const sinDecidir = pendientes.filter(p => !decididaDe.has(p.clave));
  const sinValuacion = pendientes.filter(p => decididaDe.has(p.clave) && p.motivo === 'sin_valuacion');
  const porAplicar = pendientes.filter(p => decididaDe.has(p.clave) && p.motivo !== 'sin_valuacion');
  const enPendientes = new Set(pendientes.map(p => p.clave));
  const conFlujo = estado.clavesConFlujo ? new Set(estado.clavesConFlujo) : null;
  /** Qué pasó con una decisión: para no mostrar como vigente una que no hace nada. */
  const estadoDecision = (d: DecisionGuardada): string | null => {
    if (enPendientes.has(d.clave)) return sinValuacion.some(p => p.clave === d.clave) ? 'sin precio: no entra todavía' : 'por aplicar';
    if (!conFlujo) return null;
    if (conFlujo.has(d.clave)) return 'aplicada';
    if (d.decision === 'interna') return 'aplicada (sin flujo)';
    return 'sin efecto (anterior al corte, apareada o borrada)';
  };

  async function decidir(m: ResumenMovimientoFlujo, d: DecisionFlujo) {
    setOcupado(m.clave); setAviso(null);
    try {
      await guardarDecisionFlujo(m.clave, d, m);
      setDecisiones(prev => [...prev.filter(x => x.clave !== m.clave), { id: m.clave, clave: m.clave, decision: d, resumen: m }]);
      setCambiando(null);
    } catch (e) {
      setAviso({ texto: `No se pudo guardar: ${e instanceof Error ? e.message : String(e)}`, error: true });
    } finally {
      setOcupado(null);
    }
  }

  async function aplicar() {
    setOcupado('aplicar'); setAviso(null);
    try {
      const r = await recalcularCarteraVivaCrudo();
      await recargar();
      onAplicado();
      // Addendum 1 B: `ok: false` nunca se muestra como éxito, con o sin texto de error.
      setAviso(r.flujos?.error
        ? { texto: `Los flujos fallaron: ${r.flujos.error}${!r.ok ? ` · y el valor de hoy no se pudo recalcular: ${r.error ?? 'sin detalle'}` : ''}`, error: true }
        : !r.ok
          ? { texto: `Flujos aplicados (${r.flujos?.flujos ?? 0}), pero el valor de hoy no se pudo recalcular: ${r.error ?? 'sin detalle'}`, error: true }
          : { texto: `Aplicado: ${r.flujos?.flujos ?? 0} flujos automáticos, ${r.flujos?.pendientes ?? 0} para decidir.`, error: false });
    } catch (e) {
      // Puede haber cortado el cliente con el server todavía aplicando: se relee igual.
      await recargar();
      setAviso({ texto: `No se pudo aplicar: ${mensajeDeErrorCallable(e)}`, error: true });
    } finally {
      setOcupado(null);
    }
  }

  const botones = (m: PendienteResumen | ResumenMovimientoFlujo, sugerido: 'aporte' | 'retiro', actual?: DecisionFlujo) => {
    const orden: DecisionFlujo[] = sugerido === 'retiro' ? ['retiro', 'aporte', 'interna'] : ['aporte', 'retiro', 'interna'];
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {orden.map((d, i) => (
          <button key={d} disabled={ocupado !== null} onClick={() => decidir(m, d)} style={{
            padding: '6px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: ocupado ? 'default' : 'pointer', fontFamily: 'var(--font-base)',
            border: i === 0 && !actual ? 'none' : '1px solid var(--gf-gray-200)',
            background: actual === d ? 'var(--gf-ink)' : i === 0 && !actual ? 'var(--color-accent)' : 'var(--color-surface)',
            color: actual === d || (i === 0 && !actual) ? '#fff' : 'var(--color-text)',
          }}>{ROTULO[d]}</button>
        ))}
      </div>
    );
  };

  const fila = (m: PendienteResumen | ResumenMovimientoFlujo, extra?: React.ReactNode) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: 'var(--gf-gray-400)', minWidth: 58 }}>{fmtFecha(m.fecha)}</span>
      <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
        {m.tipo === 'retiro' ? 'Retiro de' : 'Depósito en'} {m.cuenta}
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{monto(m, privado)}</span>
      {extra}
    </div>
  );

  return (
    <Card>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{soloDecididas ? 'Aportes y retiros automáticos' : `Para decidir (${sinDecidir.length})`}</div>
      {!soloDecididas && (
        <div style={{ ...sub, marginTop: 2, marginBottom: 8 }}>
          Depósitos y retiros que no aparearon con otra cuenta tuya. ¿Es plata que entró o salió del patrimonio
          (aporte o retiro), o una transferencia entre tus cuentas (interna)?
        </div>
      )}
      {!estado.desde && (
        <div style={{ ...sub, color: 'var(--gf-out)', marginBottom: 8 }}>
          Este estado es de antes del corte del {fmtFecha(FLUJOS_AUTO_DESDE)}: tocá "Aplicar" para recalcularlo (lo anterior sin par pasa a historial).
        </div>
      )}

      {sinDecidir.map((p, i) => {
        const manual = posibleManual({ fecha: p.fecha, cuenta: p.cuenta, montoUsd: p.montoUsd ?? null }, manuales);
        return (
          <div key={p.clave} style={{ padding: '8px 0', borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : 'none' }}>
            {fila(p)}
            {manual && <div style={{ fontSize: 11.5, color: 'var(--gf-out)', marginTop: 3 }}>¿Ya lo cargaste a mano el {fmtFecha(manual)}?</div>}
            {botones(p, p.sugerido)}
          </div>
        );
      })}
      {sinDecidir.length === 0 && porAplicar.length > 0 && <div style={sub}>Todo decidido. Tocá "Aplicar" para que entre en los flujos.</div>}

      {sinValuacion.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--gf-gray-400)', letterSpacing: 0.3, marginBottom: 4 }}>DECIDIDOS, SIN PRECIO</div>
          <div style={sub}>En especie y sin valuación (precio 0 o sin dato): no entran a los flujos hasta que tengan precio.</div>
          {sinValuacion.map(m => <div key={m.clave} style={{ padding: '4px 0' }}>{fila(m)}</div>)}
        </div>
      )}

      {estado.sinTc.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--gf-gray-400)', letterSpacing: 0.3, marginBottom: 4 }}>SIN DÓLAR DEL DÍA</div>
          <div style={sub}>Decididos, pero sin tipo de cambio para su fecha: no se convierten (no se inventa un dólar). "Aplicar" no los cambia hasta que haya dólar de ese día.</div>
          {estado.sinTc.map(m => <div key={m.clave} style={{ padding: '4px 0' }}>{fila(m)}</div>)}
        </div>
      )}

      {decisiones.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setVerDecididas(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)' }}>
            Decididas ({decisiones.length}) <Icon name={verDecididas ? 'chevron-up' : 'chevron-down'} size={13} color="var(--color-text-sec)" />
          </button>
          {verDecididas && decisiones.map(d => {
            const ed = estadoDecision(d);
            return (
              <div key={d.id} style={{ padding: '6px 0', borderTop: '1px solid var(--gf-gray-100)' }}>
                {d.resumen ? fila(d.resumen, <span style={{ fontSize: 11.5, fontWeight: 700 }}>{ROTULO[d.decision]}</span>) : <div style={sub}>{d.clave}: {ROTULO[d.decision]}</div>}
                {ed && <div style={{ ...sub, marginTop: 2 }}>{ed}</div>}
                {cambiando === d.clave && d.resumen
                  ? botones(d.resumen, d.resumen.tipo === 'retiro' ? 'retiro' : 'aporte', d.decision)
                  : <button onClick={() => setCambiando(d.clave)} disabled={!d.resumen || ocupado !== null} style={{ background: 'none', border: 'none', padding: 0, marginTop: 3, cursor: ocupado ? 'default' : 'pointer', fontSize: 11.5, fontWeight: 700, color: 'var(--color-accent)', fontFamily: 'var(--font-base)' }}>Cambiar</button>}
              </div>
            );
          })}
        </div>
      )}

      {aviso && <div style={{ fontSize: 12, marginTop: 8, color: aviso.error ? 'var(--gf-expense)' : 'var(--gf-income)' }}>{aviso.texto}</div>}
      {(estado.historial ?? 0) > 0 && (
        <div style={{ ...sub, marginTop: 8 }}>
          {estado.historial} {estado.historial === 1 ? 'movimiento anterior' : 'movimientos anteriores'} al {fmtFecha(estado.desde ?? '2026-10-21')} sin par
          {estado.historial === 1 ? ' queda' : ' quedan'} como historial: esa época ya está en tus flujos manuales.
        </div>
      )}
      <button onClick={aplicar} disabled={ocupado !== null} style={{ marginTop: 10, width: '100%', padding: '10px 12px', borderRadius: 10, border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: ocupado ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}>
        {ocupado === 'aplicar' ? 'Aplicando…' : 'Aplicar'}
      </button>
    </Card>
  );
}
