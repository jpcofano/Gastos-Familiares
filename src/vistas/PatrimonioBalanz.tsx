// F9.196 Addendum 2 §A (H2b) — "Actualizar Balanz": importa uno o varios "Mis Instrumentos"
// (.xlsx) a `cuentasVivas/balanz_<comitente>`, sin LLM. No crea una corrida: alimenta solo la
// cartera viva. Antes de confirmar muestra la comitente, la fecha del archivo, las especies, el
// total en USD, el control contra la app y qué cambió contra la importación anterior.
//
// §B (H3c) — el mismo botón acepta el archivo de Movimientos: sugiere la comitente por tickers
// (Juan la confirma), clasifica cada fila, registra los movimientos y ancla la caja en la corrida.
import { useRef, useState } from 'react';
import { Card } from '../design-system/components';
import { Icon } from '../design-system/Icon';
import type { IndicadoresPosicion, Posicion, PosicionRaw } from '../types/patrimonio';
import type { MovimientoCuenta } from '../datos/patrimonioMovimientos';
import {
  detectarArchivoBalanz, parsearNombreBalanz, parsearMisInstrumentos, clasificacionesDe,
  cuentaVivaDeImportacion, esMismaImportacion, movimientosInferidos, controlContraApp,
  cuentaDeComitente, leerFilasXlsx, tiposPorTickerDe, esMasViejo, UMBRAL_CONTROL,
  type ImportacionMisInstrumentos, type ControlBalanz, type CuentaVivaBalanz,
} from '../datos/patrimonioBalanzArchivo';
import { cargarCuentaVivaBalanz, guardarImportacionBalanz, guardarMovimientosBalanz } from '../datos/patrimonioCuentasVivas';
import {
  parsearMovimientosBalanz, aparearDevoluciones, movimientosDeBalanz, cajaAnclada, sugerirComitente, idsAnulados,
  contarPorClase, type CajaAnclada, type ClaseBalanz, type FilaMovBalanz,
} from '../datos/patrimonioBalanzMovimientos';

type Props = {
  /** Posiciones de la corrida vigente: de acá salen las comitentes conocidas y la clasificación. */
  posicionesCorrida: Posicion[];
  /** Último cierre por identidad, para el control contra la app. */
  indicadores: Map<string, IndicadoresPosicion>;
  /** ARS por USD que usa la vista (último `tcDiario`). */
  tc: number;
  /** Fecha de la corrida vigente: ancla la caja del archivo de Movimientos (§B). */
  fechaCorrida: string;
  onGuardado: (texto: string) => void;
  onClose: () => void;
};

type Lista = {
  imp: ImportacionMisInstrumentos;
  previa: CuentaVivaBalanz | null;
  mismo: boolean;
  movimientos: MovimientoCuenta[];
  control: ControlBalanz;
  fechaDelNombre: boolean;
  /** No se puede confirmar este archivo: más viejo que lo vigente, o filas que no cuadran. */
  bloqueo: string | null;
  /** Otro archivo más nuevo de la misma comitente en esta subida. Se recalcula. */
  descartada: string | null;
};

/** §B — un archivo de Movimientos listo para confirmar. */
type ListaMovimientos = {
  comitente: string;
  filas: FilaMovBalanz[];
  duplicadas: number;
  conteo: Record<ClaseBalanz, number>;
  movimientos: MovimientoCuenta[];
  /** Comprobantes anulados por una devolución: si un export anterior los guardó, se borran. */
  borrar: string[];
  monedasDesconocidas: string[];
  /** Fecha de la tenencia vigente ("Mis Instrumentos"), para avisar si no coincide con la caja. */
  tenenciaDel: string | null;
  devueltas: number;
  sinComprobante: FilaMovBalanz[];
  caja: CajaAnclada;
};

/** `id` = nombre + fecha del archivo + posición: un resultado viejo nunca pisa una subida nueva. */
type Entrada = { id: string; nombre: string } & (
  | { estado: 'leyendo' }
  | { estado: 'error'; mensaje: string }
  | { estado: 'mov_pide_cuenta'; filas: unknown[][]; sugerencias: Array<{ comitente: string; comunes: number; total: number }> }
  | ({ estado: 'mov_lista' } & ListaMovimientos)
  | { estado: 'pide_cuenta'; filas: unknown[][]; exportadoEn: string | null; lastModified: number }
  | ({ estado: 'lista' } & Lista)
);

const fmtUsd = (n: number) => `U$S ${Math.round(n).toLocaleString('es-AR')}`;
const fmtPct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1).replace('.', ',')}%`;
const fmtFechaHora = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
const isoArgDe = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 19) + '-03:00';

/**
 * Una importación por comitente: entre dos archivos de la misma en la misma subida se queda el de
 * exportación MÁS NUEVA, sin importar el orden en que los devuelva el selector de archivos.
 */
function resolverRepetidas(xs: Entrada[]): Entrada[] {
  const mejor = new Map<string, string>();   // comitente → id del más nuevo
  for (const x of xs) {
    if (x.estado !== 'lista' || x.bloqueo || x.mismo) continue;
    const actual = xs.find(y => y.id === mejor.get(x.imp.comitente));
    if (!actual || (actual.estado === 'lista' && x.imp.exportadoEn > actual.imp.exportadoEn)) mejor.set(x.imp.comitente, x.id);
  }
  return xs.map(x => {
    if (x.estado !== 'lista') return x;
    const elegido = mejor.get(x.imp.comitente);
    const descartada = !x.bloqueo && !x.mismo && elegido && elegido !== x.id
      ? `Hay otro archivo más nuevo de la comitente ${x.imp.comitente} en esta subida: se importa ese.`
      : null;
    return { ...x, descartada };
  });
}

export default function PatrimonioBalanz({ posicionesCorrida, indicadores, tc, fechaCorrida, onGuardado, onClose }: Props) {
  const [entradas, setEntradas] = useState<Entrada[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const comitentesConocidas = [...new Set(posicionesCorrida
    .map(p => /^Balanz (\d+)$/.exec(p.cuenta)?.[1])
    .filter((x): x is string => !!x))].sort();

  const precioDe = (p: PosicionRaw) => {
    const ind = indicadores.get(`${p.ticker}|${p.tipo}|${p.pais_riesgo}`);
    if (!ind || ind.precio === null || !ind.monedaSerie) return null;
    return { precio: ind.precio, moneda: ind.monedaSerie, fecha: ind.fechaUltimoPrecio ?? '' };
  };

  async function preparar(id: string, nombre: string, filas: unknown[][], comitente: string, exportadoEn: string, fechaDelNombre: boolean): Promise<Entrada> {
    try {
      const leida = await cargarCuentaVivaBalanz(comitente);
      // Una cuenta viva con solo la caja anclada (sin "Mis Instrumentos" todavía) no es una
      // importación anterior: comparar contra ella inferiría la compra de todas las especies.
      const previa = leida?.posiciones?.length ? leida : null;
      const cuenta = cuentaDeComitente(comitente);
      const imp = parsearMisInstrumentos(filas, {
        comitente, exportadoEn,
        clasificaciones: clasificacionesDe(previa?.posiciones ?? [], posicionesCorrida, cuenta),
        tiposPorTicker: tiposPorTickerDe(previa?.posiciones ?? [], posicionesCorrida, cuenta),
      });
      const mismo = esMismaImportacion(previa, imp);
      const bloqueo = !mismo && esMasViejo(previa, imp)
        ? `Este archivo (${fmtFechaHora(imp.exportadoEn)}) es más viejo que la importación vigente (${fmtFechaHora(previa!.exportadoEn)}): no se importa.`
        : imp.noCuadran.length
          ? `Hay filas donde Nominales × Precio no da el Valor actual (un número mal leído); no se importa: ${imp.noCuadran.join(' · ')}`
          : null;
      return {
        id, nombre, estado: 'lista', imp, previa, mismo, fechaDelNombre, bloqueo, descartada: null,
        movimientos: mismo || bloqueo ? [] : movimientosInferidos(previa?.posiciones ?? null, imp),
        control: controlContraApp(imp, precioDe, tc),
      };
    } catch (e) {
      return { id, nombre, estado: 'error', mensaje: e instanceof Error ? e.message : String(e) };
    }
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const archivos = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!archivos.length) return;
    setErrorGuardar(null);
    const sello = Date.now();
    const ids = archivos.map((f, i) => `${f.name}|${f.lastModified}|${i}|${sello}`);
    setEntradas(archivos.map((f, i) => ({ id: ids[i], nombre: f.name, estado: 'leyendo' })));
    const out: Entrada[] = [];
    for (const [i, f] of archivos.entries()) {
      const id = ids[i];
      try {
        const { filas } = await leerFilasXlsx(await f.arrayBuffer());
        const tipo = detectarArchivoBalanz(filas[0] ?? []);
        if (tipo === 'movimientos') { out.push(await sugerir(id, f.name, filas)); continue; }
        if (tipo !== 'mis_instrumentos') {
          out.push({ id, nombre: f.name, estado: 'error', mensaje: 'No reconozco el archivo: los encabezados no son los de "Mis Instrumentos" ni los de "Movimientos" de Balanz.' });
          continue;
        }
        const { comitente, exportadoEn } = parsearNombreBalanz(f.name);
        if (!comitente) {
          out.push({ id, nombre: f.name, estado: 'pide_cuenta', filas, exportadoEn, lastModified: f.lastModified });
          continue;
        }
        out.push(await preparar(id, f.name, filas, comitente, exportadoEn ?? isoArgDe(f.lastModified), !!exportadoEn));
      } catch (err) {
        out.push({ id, nombre: f.name, estado: 'error', mensaje: err instanceof Error ? err.message : String(err) });
      }
    }
    // Si mientras tanto hubo otra subida, este resultado ya no corresponde.
    setEntradas(prev => (prev.some(p => ids.includes(p.id)) ? resolverRepetidas(out.filter(o => prev.some(p => p.id === o.id))) : prev));
  }

  async function elegirCuenta(id: string, comitente: string) {
    const x = entradas.find(y => y.id === id);
    if (!x || x.estado !== 'pide_cuenta' || !comitente) return;
    // Mientras se prepara, la entrada pasa a "leyendo": el selector desaparece (no hay carrera A→B).
    setEntradas(prev => prev.map(y => (y.id === id ? { id, nombre: y.nombre, estado: 'leyendo' } : y)));
    const lista = await preparar(id, x.nombre, x.filas, comitente, x.exportadoEn ?? isoArgDe(x.lastModified), !!x.exportadoEn);
    setEntradas(prev => resolverRepetidas(prev.map(y => (y.id === id ? lista : y))));
  }

  /** §B — el nombre no trae la comitente: se sugiere por tickers en común y Juan la confirma. */
  async function sugerir(id: string, nombre: string, filas: unknown[][]): Promise<Entrada> {
    try {
      const prueba = parsearMovimientosBalanz(filas, 'x').filas;
      const candidatas = await Promise.all(comitentesConocidas.map(async c => {
        const viva = await cargarCuentaVivaBalanz(c).catch(() => null);
        const tickers = viva?.posiciones.length
          ? viva.posiciones.map(p => p.ticker)
          : posicionesCorrida.filter(p => p.cuenta === cuentaDeComitente(c) && p.tipo !== 'cash').map(p => p.ticker);
        return { comitente: c, tickers };
      }));
      return { id, nombre, estado: 'mov_pide_cuenta', filas, sugerencias: sugerirComitente(prueba, candidatas) };
    } catch (e) {
      return { id, nombre, estado: 'error', mensaje: e instanceof Error ? e.message : String(e) };
    }
  }

  async function confirmarComitenteMovimientos(id: string, comitente: string) {
    const x = entradas.find(y => y.id === id);
    if (!x || x.estado !== 'mov_pide_cuenta' || !comitente) return;
    let lista: Entrada;
    try {
      const { filas, duplicadas, monedasDesconocidas } = parsearMovimientosBalanz(x.filas, comitente);
      const dev = aparearDevoluciones(filas);
      const viva = await cargarCuentaVivaBalanz(comitente).catch(() => null);
      lista = {
        id, nombre: x.nombre, estado: 'mov_lista', comitente, filas, duplicadas, monedasDesconocidas,
        tenenciaDel: viva?.posiciones?.length ? viva.exportadoEn : null,
        conteo: contarPorClase(filas),
        borrar: idsAnulados(filas, comitente, dev.anuladas),
        movimientos: movimientosDeBalanz(filas, comitente, dev.anuladas),
        devueltas: dev.pares.length, sinComprobante: dev.sinComprobante,
        caja: cajaAnclada(filas, fechaCorrida ? { fecha: fechaCorrida, posiciones: posicionesCorrida } : null, comitente),
      };
    } catch (e) {
      lista = { id, nombre: x.nombre, estado: 'error', mensaje: e instanceof Error ? e.message : String(e) };
    }
    setEntradas(prev => prev.map(y => (y.id === id ? lista : y)));
  }

  const quitar = (id: string) => setEntradas(prev => resolverRepetidas(prev.filter(y => y.id !== id)));

  const aGuardar = entradas.filter((x): x is Extract<Entrada, { estado: 'lista' }> =>
    x.estado === 'lista' && !x.mismo && !x.bloqueo && !x.descartada);
  const movAGuardar = entradas.filter((x): x is Extract<Entrada, { estado: 'mov_lista' }> => x.estado === 'mov_lista');
  const totalAGuardar = aGuardar.length + movAGuardar.length;
  // Solo lo que se está leyendo frena la confirmación; un archivo que pide cuenta se puede quitar.
  const pendientes = entradas.some(x => x.estado === 'leyendo');

  async function confirmar() {
    setGuardando(true);
    setErrorGuardar(null);
    try {
      // Primero "Mis Instrumentos": la caja anclada se escribe sobre la cuenta viva que ese archivo crea.
      for (const x of aGuardar) await guardarImportacionBalanz(cuentaVivaDeImportacion(x.imp), x.movimientos);
      const textosMov: string[] = [];
      // Del archivo que llega a la fecha más vieja al más nuevo: si hay dos de la misma comitente,
      // la caja que queda es la más nueva (y guardarMovimientosBalanz no deja pisarla con una vieja).
      const hasta = (y: (typeof movAGuardar)[number]) => (y.caja.estado === 'ok' ? y.caja.hasta : '');
      for (const x of [...movAGuardar].sort((a, b) => hasta(a).localeCompare(hasta(b)))) {
        const r = await guardarMovimientosBalanz(x.comitente, cuentaDeComitente(x.comitente), x.movimientos, x.borrar, x.caja);
        const caja = { actualizada: 'caja actualizada', creada_sin_tenencia: 'caja guardada (falta Mis Instrumentos)', mas_vieja: 'caja sin cambios: ya hay una más nueva', desconocida: 'caja desconocida' }[r.caja];
        textosMov.push(`${x.comitente}: ${x.movimientos.length} movimientos, ${caja}`);
      }
      onGuardado(`Balanz actualizado: ${[
        ...aGuardar.map(x => `${x.imp.comitente} (${x.imp.posiciones.length} especies)`),
        ...textosMov,
      ].join(' · ')}.`);
    } catch (e) {
      setErrorGuardar(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  }

  const sub = { fontSize: 12, color: 'var(--color-text-sec)', lineHeight: 1.45 } as const;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--gf-gray-100)', flexShrink: 0 }}>
        <button onClick={onClose} aria-label="Cerrar" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <Icon name="x" size={20} color="var(--color-text)" />
        </button>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Actualizar Balanz</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Archivo "Mis Instrumentos" (.xlsx), uno por comitente</div>
        </div>
      </div>

      <input ref={fileRef} type="file" multiple accept=".xlsx" style={{ display: 'none' }} onChange={onFiles} />

      <div style={{ flex: 1, padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={sub}>
          Bajá "Mis Instrumentos" desde Balanz y subilo tal cual. Actualiza solo la cartera viva de esa
          comitente (no crea una corrida). Mientras no operes, no hace falta volver a subirlo: la app
          revalúa con el precio del día.
        </div>

        <button
          onClick={() => fileRef.current?.click()}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px 16px', borderRadius: 12, border: '1.5px dashed var(--gf-gray-300, var(--gf-gray-200))', background: 'var(--gf-gray-50)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)', color: 'var(--color-text)' }}
        >
          <Icon name="upload" size={15} color="var(--color-text-sec)" /> Elegir archivos .xlsx
        </button>

        {entradas.map(x => (
          <Card key={x.id} style={x.estado === 'error' || (x.estado === 'lista' && x.bloqueo) ? { background: 'rgba(220,38,38,.07)' } : undefined}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 11.5, color: 'var(--color-text-sec)', wordBreak: 'break-all' }}>{x.nombre}</div>
              {x.estado !== 'leyendo' && (
                <button onClick={() => quitar(x.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12, fontWeight: 700, color: 'var(--color-text-sec)', fontFamily: 'var(--font-base)', whiteSpace: 'nowrap' }}>
                  Quitar
                </button>
              )}
            </div>

            {x.estado === 'leyendo' && <div style={sub}>Leyendo…</div>}
            {x.estado === 'error' && <div style={{ fontSize: 13, color: 'var(--gf-expense)', lineHeight: 1.45 }}>{x.mensaje}</div>}
            {x.estado === 'mov_pide_cuenta' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={sub}>
                  Archivo de <strong>Movimientos</strong>. El nombre no dice la comitente
                  {x.sugerencias[0]?.comunes
                    ? <>: por los tickers parece <strong>Balanz {x.sugerencias[0].comitente}</strong> ({x.sugerencias[0].comunes} de {x.sugerencias[0].total} en común). Confirmala:</>
                    : '. Elegila:'}
                </div>
                <select
                  defaultValue=""
                  onChange={e => confirmarComitenteMovimientos(x.id, e.target.value)}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--gf-gray-200)', fontSize: 14, fontFamily: 'var(--font-base)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                >
                  <option value="" disabled>Elegí la comitente…</option>
                  {x.sugerencias.map(c => <option key={c.comitente} value={c.comitente}>Balanz {c.comitente} · {c.comunes} tickers en común</option>)}
                </select>
                {!x.sugerencias.length && <div style={sub}>No hay cuentas de Balanz en la corrida para elegir: quitá este archivo.</div>}
              </div>
            )}
            {x.estado === 'mov_lista' && <ResumenMovimientos x={x} />}

            {x.estado === 'pide_cuenta' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={sub}>El nombre del archivo no dice la comitente. Elegila (no se adivina):</div>
                <select
                  defaultValue=""
                  onChange={e => elegirCuenta(x.id, e.target.value)}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--gf-gray-200)', fontSize: 14, fontFamily: 'var(--font-base)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                >
                  <option value="" disabled>Elegí la comitente…</option>
                  {comitentesConocidas.map(c => <option key={c} value={c}>Balanz {c}</option>)}
                </select>
                {!comitentesConocidas.length && <div style={sub}>No hay cuentas de Balanz en la corrida para elegir: quitá este archivo.</div>}
              </div>
            )}

            {x.estado === 'lista' && <ResumenImportacion x={x} />}
          </Card>
        ))}

        {errorGuardar && (
          <Card style={{ background: 'rgba(220,38,38,.07)' }}>
            <div style={{ fontSize: 13, color: 'var(--gf-expense)' }}>No se pudo guardar: {errorGuardar}</div>
          </Card>
        )}

        {entradas.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '12px 14px', borderRadius: 11, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
              Cancelar
            </button>
            <button
              onClick={confirmar}
              disabled={!totalAGuardar || guardando || pendientes}
              style={{ flex: 2, padding: '12px 14px', borderRadius: 11, border: 'none', background: totalAGuardar && !guardando && !pendientes ? 'var(--color-accent)' : 'var(--gf-gray-200)', color: totalAGuardar && !guardando && !pendientes ? '#fff' : 'var(--gf-gray-400)', fontSize: 14, fontWeight: 700, cursor: totalAGuardar && !guardando && !pendientes ? 'pointer' : 'default', fontFamily: 'var(--font-base)' }}
            >
              {guardando ? 'Guardando…' : totalAGuardar ? `Confirmar (${totalAGuardar})` : 'Nada para guardar'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResumenImportacion({ x }: { x: Lista }) {
  const { imp, control, movimientos, previa, mismo } = x;
  const sub = { fontSize: 12, color: 'var(--color-text-sec)', lineHeight: 1.45 } as const;
  const fueraDelTotal = control.especies.filter(e => e.nota !== null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Balanz {imp.comitente}</div>
          <div style={sub}>
            Archivo del {fmtFechaHora(imp.exportadoEn)}{x.fechaDelNombre ? '' : ' (fecha del archivo, el nombre no la trae)'} · {imp.filas.length} especies
          </div>
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, whiteSpace: 'nowrap' }}>{fmtUsd(imp.valorUsdBalanz)}</div>
      </div>

      {mismo && (
        <div style={{ ...sub, fontWeight: 700 }}>Este archivo ya está importado (misma comitente, fecha y hora): no cambia nada.</div>
      )}
      {x.bloqueo && <div style={{ fontSize: 13, color: 'var(--gf-expense)', lineHeight: 1.45, fontWeight: 700 }}>{x.bloqueo}</div>}
      {x.descartada && <div style={{ ...sub, fontWeight: 700 }}>{x.descartada}</div>}

      {!mismo && !x.bloqueo && (
        <div style={sub}>
          {!previa
            ? 'Primera importación de esta comitente: no hay contra qué comparar cantidades.'
            : movimientos.length === 0
              ? `Sin cambios de cantidades contra la importación del ${fmtFechaHora(previa.exportadoEn)}.`
              : <>
                  <strong>Cambios contra la importación del {fmtFechaHora(previa.exportadoEn)}</strong> (se registran como movimientos inferidos, no son aportes ni retiros):
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {movimientos.map(m => (
                      <li key={m.id}>{m.tipo === 'compra' ? 'Compra' : 'Venta'} de {m.cantidad?.toLocaleString('es-AR')} {m.ticker} (≈ {fmtUsd(m.montoNeto)})</li>
                    ))}
                  </ul>
                </>}
        </div>
      )}

      <div style={{ ...sub, padding: '8px 10px', borderRadius: 10, background: control.supera ? 'rgba(245,158,11,.12)' : 'var(--gf-gray-50)' }}>
        <strong>Control contra la app:</strong>{' '}
        {control.difTotalPct === null
          ? 'la app no tiene precio para comparar ninguna especie.'
          : <>las especies comparables valen {fmtUsd(control.totalAppComparableUsd)} con los precios de la app, contra {fmtUsd(control.totalArchivoComparableUsd)} en el archivo ({fmtPct(control.difTotalPct)}).
              {control.supera && <> Supera el {Math.round(UMBRAL_CONTROL * 100)}%: puede ser escala o tipo de cambio. No se corrige solo.</>}</>}
        {(control.supera || fueraDelTotal.length > 0) && (
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {control.especies.filter(e => control.supera || e.nota !== null).map((e, k) => (
              <li key={`${e.ticker}-${k}`}>
                {e.ticker}: archivo {fmtUsd(e.valorArchivoUsd)}
                {e.valorAppUsd !== null && <> · app {fmtUsd(e.valorAppUsd)}</>}
                {e.difPct !== null && e.nota === null && <> ({fmtPct(e.difPct)})</>}
                {e.nota === 'sin_precio_app' && ' · sin precio en la app'}
                {e.nota === 'sin_tc' && ' · sin tipo de cambio'}
                {e.nota === 'valor_archivo_cero' && ' · el archivo la valúa en 0, fuera del total'}
                {e.nota === 'escala_distinta' && ` · escala distinta (×${((e.difPct ?? 0) + 1).toFixed(1).replace('.', ',')}), fuera del total`}
              </li>
            ))}
          </ul>
        )}
      </div>

      {(imp.paraRevisar.length > 0 || imp.posiciones.some(p => p.revisar)) && (
        <div style={{ ...sub, padding: '8px 10px', borderRadius: 10, background: 'rgba(245,158,11,.10)' }}>
          <strong>Para revisar:</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {imp.paraRevisar.map((r, k) => <li key={`r-${k}`}>{r.ticker}: {r.motivo} (sin tipo conocido: no entra a la cartera viva)</li>)}
            {imp.posiciones.filter(p => p.revisar).map((p, k) => <li key={`p-${k}`}>{p.ticker}: {p.motivo_revisar}</li>)}
          </ul>
        </div>
      )}

      {imp.avisos.length > 0 && (
        <ul style={{ ...sub, margin: 0, paddingLeft: 18 }}>
          {imp.avisos.map((a, k) => <li key={k}>{a}</li>)}
        </ul>
      )}
    </div>
  );
}

const ROTULO_CLASE: Record<ClaseBalanz, string> = {
  deposito: 'depósitos (Recibo de Cobro)', retiro: 'retiros (Comprobante de Pago)', anula_retiro: 'devoluciones por rechazo',
  compra: 'compras', venta: 'ventas', caucion: 'cauciones', renta: 'dividendos, rentas y amortizaciones',
  gasto: 'retenciones y cargos', ajuste_caja: 'conversiones y ajustes de caja', fci_caja: 'FCI (lado caja)',
  fci_tenencia: 'FCI (lado tenencia)', transferencia_titulos: 'transferencias de títulos', para_revisar: 'para revisar',
};

function ResumenMovimientos({ x }: { x: ListaMovimientos }) {
  const sub = { fontSize: 12, color: 'var(--color-text-sec)', lineHeight: 1.45 } as const;
  const fechas = x.filas.map(f => f.concertacion).sort();
  const revisar = x.filas.filter(f => f.clase === 'para_revisar');
  const candidatos = x.movimientos.filter(m => m.tipo === 'deposito' || m.tipo === 'retiro');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800 }}>Movimientos · Balanz {x.comitente}</div>
        <div style={sub}>
          {x.filas.length} filas del {fechas[0]} al {fechas[fechas.length - 1]}
          {x.duplicadas ? ` · ${x.duplicadas} filas idénticas a otra (se cuentan todas)` : ''} · {x.movimientos.length} movimientos a registrar
          {x.filas.length >= 1000 ? ' · ⚠ justo 1000 filas: el export puede venir cortado' : ''}
        </div>
      </div>
      <ul style={{ ...sub, margin: 0, paddingLeft: 18 }}>
        {(Object.entries(x.conteo) as Array<[ClaseBalanz, number]>).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
          <li key={c} style={c === 'para_revisar' ? { color: 'var(--gf-expense)', fontWeight: 700 } : undefined}>{n} {ROTULO_CLASE[c]}</li>
        ))}
      </ul>
      {revisar.length > 0 && (
        <div style={{ ...sub, padding: '8px 10px', borderRadius: 10, background: 'rgba(245,158,11,.10)' }}>
          <strong>Para revisar</strong> (no se clasifican solas):
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {revisar.map(f => <li key={f.fila}>fila {f.fila}: «{f.descripcion}»</li>)}
          </ul>
        </div>
      )}
      {x.monedasDesconocidas.length > 0 && (
        <div style={{ ...sub, color: 'var(--gf-expense)', fontWeight: 700 }}>
          Monedas desconocidas (quedan fuera de la caja): {x.monedasDesconocidas.join(' · ')}
        </div>
      )}
      {x.caja.estado === 'ok' && x.tenenciaDel && x.tenenciaDel.slice(0, 10) !== x.caja.hasta && (
        <div style={{ ...sub, padding: '8px 10px', borderRadius: 10, background: 'rgba(245,158,11,.12)' }}>
          ⚠ La tenencia es de "Mis Instrumentos" del {x.tenenciaDel.slice(0, 10)} y esta caja llega hasta el {x.caja.hasta}.
          Si operaste entre las dos fechas, una compra o venta puede quedar contada en la caja y no en la tenencia (o al revés).
          Subí los dos archivos del mismo día para que cuadren.
        </div>
      )}
      {(x.devueltas > 0 || x.sinComprobante.length > 0) && (
        <div style={sub}>
          {x.devueltas > 0 && <>{x.devueltas} devolución(es) por rechazo anulan su Comprobante de Pago. </>}
          {x.sinComprobante.length > 0 && <strong>{x.sinComprobante.length} devolución(es) sin su Comprobante de Pago en el archivo.</strong>}
        </div>
      )}
      <div style={sub}>
        {candidatos.length} depósitos y retiros (dinero o títulos en especie) quedan como candidatos a aporte o retiro.
        No son flujos todavía: se aparean contra las otras cuentas y lo que no aparea lo decidís vos.
      </div>
      <div style={{ ...sub, padding: '8px 10px', borderRadius: 10, background: 'var(--gf-gray-50)' }}>
        <strong>Caja anclada:</strong>{' '}
        {x.caja.estado === 'ok'
          ? <>caja de la corrida del {x.caja.ancla} (ARS {Math.round(x.caja.cajaCorrida.ARS).toLocaleString('es-AR')} · USD {Math.round(x.caja.cajaCorrida.USD).toLocaleString('es-AR')}) + {x.caja.filasSumadas} filas liquidadas después = <strong>ARS {Math.round(x.caja.saldos.ARS).toLocaleString('es-AR')} · USD {Math.round(x.caja.saldos.USD).toLocaleString('es-AR')}</strong>. Se guarda en la cuenta viva si ya importaste su "Mis Instrumentos".</>
          : <>desconocida — {x.caja.motivo} La caja sigue siendo la de la corrida.</>}
      </div>
    </div>
  );
}
