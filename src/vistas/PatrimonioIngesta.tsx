import { useState, useRef } from 'react';
import { Card } from '../design-system/components';
import { Icon } from '../design-system/Icon';
import { tcParaFecha } from '../datos/tcDiario';
import { confirmarIngesta } from '../datos/patrimonio';
import type { CorraidaJSON, Posicion, PosicionRaw, ActivoFijo } from '../types/patrimonio';

// ── Validador manual (sin ajv) ─────────────────────────────────────────────────
const TIPOS_VALIDOS = new Set(['accion', 'bono', 'on', 'cedear', 'fci', 'cripto', 'cash']);
const PAISES_VALIDOS = new Set(['AR', 'global']);
const MONEDAS_VALIDAS = new Set(['ARS', 'USD']);

function validarCorrida(raw: unknown): string[] {
  const errs: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return ['No es un objeto JSON válido.'];
  const obj = raw as Record<string, unknown>;

  const meta = obj.meta as Record<string, unknown> | undefined;
  if (!meta) {
    errs.push('Falta el campo "meta".');
  } else {
    if (typeof meta.fecha_corrida !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(meta.fecha_corrida))
      errs.push('meta.fecha_corrida: debe ser YYYY-MM-DD.');
    if (meta.entidad !== 'familia')
      errs.push('meta.entidad: debe ser "familia".');
    if (!Array.isArray(meta.fuentes) || meta.fuentes.length === 0)
      errs.push('meta.fuentes: array con al menos 1 elemento.');
    if (typeof meta.total_declarado_usd !== 'number' || meta.total_declarado_usd <= 0)
      errs.push('meta.total_declarado_usd: número positivo.');
  }

  if (!Array.isArray(obj.posiciones) || obj.posiciones.length === 0) {
    errs.push('posiciones: array con al menos 1 elemento.');
    return errs;
  }

  let posErrs = 0;
  for (let i = 0; i < (obj.posiciones as unknown[]).length; i++) {
    if (posErrs >= 10) { errs.push(`… y más errores en posiciones. Corregí los primeros e intentá de nuevo.`); break; }
    const p = (obj.posiciones as unknown[])[i];
    if (typeof p !== 'object' || p === null) { errs.push(`posiciones[${i}]: no es objeto.`); posErrs++; continue; }
    const pos = p as Record<string, unknown>;
    if (!pos.cuenta || typeof pos.cuenta !== 'string') { errs.push(`[${i}] cuenta requerida.`); posErrs++; }
    if (!pos.ticker || typeof pos.ticker !== 'string') { errs.push(`[${i}] ticker requerido.`); posErrs++; }
    if (!TIPOS_VALIDOS.has(pos.tipo as string)) { errs.push(`[${i}] tipo "${pos.tipo}" inválido.`); posErrs++; }
    if (!PAISES_VALIDOS.has(pos.pais_riesgo as string)) { errs.push(`[${i}] pais_riesgo "${pos.pais_riesgo}" inválido.`); posErrs++; }
    if (!MONEDAS_VALIDAS.has(pos.moneda_origen as string)) { errs.push(`[${i}] moneda_origen "${pos.moneda_origen}" inválida.`); posErrs++; }
    if (typeof pos.valor_origen !== 'number' || pos.valor_origen < 0) { errs.push(`[${i}] valor_origen: número ≥ 0.`); posErrs++; }
    if (typeof pos.revisar !== 'boolean') { errs.push(`[${i}] revisar: debe ser boolean.`); posErrs++; }
  }
  return errs;
}

function fmtUsd(n: number) { return `U$S ${Math.round(n).toLocaleString('es-AR')}`; }

// ── Cálculo del valorUsd de cada posición ─────────────────────────────────────
function enriquecerPosiciones(posicionesRaw: PosicionRaw[], fechaCorrida: string, tc: number): Posicion[] {
  return posicionesRaw.map(p => ({
    ...p,
    fechaCorrida,
    valorUsd: p.moneda_origen === 'USD' ? p.valor_origen : p.valor_origen / tc,
    tcUsado: p.moneda_origen === 'ARS' ? tc : null,
  }));
}

// ── Diff vs corrida previa ─────────────────────────────────────────────────────
type DiffEntry = { ticker: string; cuenta: string; tipo: 'nueva' | 'desaparecida' | 'delta'; delta?: number };

function calcDiff(previas: Posicion[], nuevas: Posicion[]): DiffEntry[] {
  if (previas.length === 0) return [];
  const diff: DiffEntry[] = [];
  const prevMap = new Map<string, number>();
  for (const p of previas) prevMap.set(`${p.cuenta}|${p.ticker}`, p.valorUsd);
  const nuevoMap = new Map<string, number>();
  for (const p of nuevas) nuevoMap.set(`${p.cuenta}|${p.ticker}`, p.valorUsd);
  for (const [k, v] of nuevoMap) {
    if (!prevMap.has(k)) diff.push({ ticker: k.split('|')[1], cuenta: k.split('|')[0], tipo: 'nueva' });
    else {
      const d = v - prevMap.get(k)!;
      if (Math.abs(d) > 1) diff.push({ ticker: k.split('|')[1], cuenta: k.split('|')[0], tipo: 'delta', delta: d });
    }
  }
  for (const [k] of prevMap) {
    if (!nuevoMap.has(k)) diff.push({ ticker: k.split('|')[1], cuenta: k.split('|')[0], tipo: 'desaparecida' });
  }
  return diff;
}

// ── Componente principal ───────────────────────────────────────────────────────
type Props = {
  posicionesPrevias: Posicion[];
  activosFijos: ActivoFijo[];
  totalManualesUsd: number;
  metricasJson: Record<string, unknown>;
  onConfirmado: () => void;
  onClose: () => void;
};

type Step = 'upload' | 'validating' | 'confirm' | 'saving';

export default function PatrimonioIngesta({ posicionesPrevias, activosFijos, totalManualesUsd, metricasJson, onConfirmado, onClose }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [errors, setErrors] = useState<string[]>([]);
  const [checksumWarning, setChecksumWarning] = useState<string | null>(null);
  const [corrida, setCorrida] = useState<CorraidaJSON | null>(null);
  const [posicionesEnriquecidas, setPosicionesEnriquecidas] = useState<Posicion[]>([]);
  const [tc, setTc] = useState<number>(0);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrors([]);
    setChecksumWarning(null);
    setStep('validating');

    let raw: unknown;
    try {
      const text = await file.text();
      raw = JSON.parse(text);
    } catch {
      setErrors(['No se pudo parsear el archivo como JSON.']);
      setStep('upload');
      return;
    }

    const errs = validarCorrida(raw);
    if (errs.length > 0) {
      setErrors(errs);
      setStep('upload');
      return;
    }

    const data = raw as CorraidaJSON;
    const fechaDate = new Date(data.meta.fecha_corrida + 'T12:00:00');
    const tcFecha = await tcParaFecha(fechaDate);
    const tcUsado = tcFecha ?? 0;

    if (!tcFecha) {
      setErrors([`No se encontró TC para ${data.meta.fecha_corrida}. Verificar tcDiario en Firestore.`]);
      setStep('upload');
      return;
    }

    const enriquecidas = enriquecerPosiciones(data.posiciones, data.meta.fecha_corrida, tcUsado);
    const totalCalc = enriquecidas.reduce((s, p) => s + p.valorUsd, 0);
    const diff = Math.abs(totalCalc - data.meta.total_declarado_usd) / data.meta.total_declarado_usd;
    if (diff > 0.01) {
      setChecksumWarning(
        `Diferencia de checksum: declarado ${fmtUsd(data.meta.total_declarado_usd)}, calculado ${fmtUsd(totalCalc)} (${Math.round(diff * 100)}%). ` +
        `Posible TC distinto al de los resúmenes. El sistema usó TC=${Math.round(tcUsado)}.`
      );
    }

    setCorrida(data);
    setPosicionesEnriquecidas(enriquecidas);
    setTc(tcUsado);
    setStep('confirm');
  }

  async function handleConfirmar() {
    if (!corrida) return;
    setStep('saving');
    setErrorGuardar(null);
    try {
      const totalFijosUsd = activosFijos.reduce((s, a) => s + a.valorUsd, 0);
      await confirmarIngesta(posicionesEnriquecidas, corrida.meta, totalFijosUsd, totalManualesUsd, metricasJson);
      onConfirmado();
    } catch (err) {
      setErrorGuardar(String(err));
      setStep('confirm');
    }
  }

  const revisar = posicionesEnriquecidas.filter(p => p.revisar);
  const cuentas = [...new Set(posicionesEnriquecidas.map(p => p.cuenta))];
  const totalCalc = posicionesEnriquecidas.reduce((s, p) => s + p.valorUsd, 0);
  const diff = corrida ? calcDiff(posicionesPrevias, posicionesEnriquecidas) : [];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--gf-gray-100)', flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <Icon name="x" size={20} color="var(--color-text)" />
        </button>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Actualizar posiciones</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>
            {step === 'upload' || step === 'validating' ? 'Paso 1 — Subir archivo' : step === 'confirm' || step === 'saving' ? 'Paso 3 — Confirmar' : ''}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── Paso 1: Upload ──────────────────────────────────────────────────── */}
        {(step === 'upload' || step === 'validating') && (
          <>
            <input ref={fileRef} type="file" accept=".txt,.json" style={{ display: 'none' }} onChange={onFile} />
            <div
              onClick={() => fileRef.current?.click()}
              style={{ border: '2px dashed var(--gf-gray-200)', borderRadius: 16, padding: '36px 20px', textAlign: 'center', cursor: 'pointer', background: 'var(--gf-gray-50)' }}
            >
              <Icon name="upload" size={32} color="var(--gf-gray-300)" />
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 12 }}>Seleccionar archivo</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 4 }}>
                .txt o .json — formato contrato de posiciones
              </div>
            </div>
            {step === 'validating' && (
              <div style={{ textAlign: 'center', color: 'var(--color-text-sec)', fontSize: 13 }}>
                <Icon name="loader" size={16} color="var(--gf-gray-400)" /> Validando…
              </div>
            )}
            {errors.length > 0 && (
              <Card style={{ background: 'rgba(220,38,38,.07)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gf-expense)', marginBottom: 8 }}>
                  <Icon name="triangle-alert" size={14} color="var(--gf-expense)" /> Errores de validación
                </div>
                {errors.map((e, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--gf-expense)', marginBottom: 3 }}>• {e}</div>
                ))}
              </Card>
            )}
          </>
        )}

        {/* ── Paso 3: Confirmar ───────────────────────────────────────────────── */}
        {(step === 'confirm' || step === 'saving') && corrida && (
          <>
            {/* Checksum warning */}
            {checksumWarning && (
              <Card style={{ background: 'rgba(245,158,11,.10)' }}>
                <div style={{ fontSize: 12, color: 'var(--gf-out)', lineHeight: 1.5 }}>
                  <strong>Aviso checksum:</strong> {checksumWarning}
                </div>
              </Card>
            )}

            {/* Resumen de la corrida */}
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Resumen de la corrida</div>
              {[
                ['Fecha', corrida.meta.fecha_corrida],
                ['Total calculado', fmtUsd(totalCalc)],
                ['Declarado en archivo', fmtUsd(corrida.meta.total_declarado_usd)],
                ['Posiciones', String(posicionesEnriquecidas.length)],
                ['TC usado', `$ ${Math.round(tc).toLocaleString('es-AR')} ARS/USD`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                  <span style={{ color: 'var(--color-text-sec)' }}>{k}</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                </div>
              ))}
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--gf-gray-100)', fontSize: 12, color: 'var(--color-text-sec)' }}>
                Cuentas: {cuentas.join(' · ')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 4 }}>
                Fuentes: {corrida.meta.fuentes.join(', ')}
              </div>
            </Card>

            {/* Posiciones con revisar=true */}
            {revisar.length > 0 && (
              <Card style={{ background: 'rgba(245,158,11,.10)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gf-out)', marginBottom: 10 }}>
                  {revisar.length} posición{revisar.length > 1 ? 'es' : ''} para revisar
                </div>
                {revisar.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: i > 0 ? '1px solid rgba(245,158,11,.2)' : 'none', fontSize: 12 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, background: 'rgba(245,158,11,.2)', color: 'var(--gf-out)', borderRadius: 4, padding: '2px 5px' }}>{p.ticker}</span>
                    <span style={{ color: 'var(--color-text-sec)' }}>{p.cuenta}</span>
                    <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(p.valorUsd)}</span>
                  </div>
                ))}
              </Card>
            )}

            {/* Diff vs corrida previa */}
            {diff.length > 0 && (
              <Card>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Cambios vs corrida anterior</div>
                {diff.map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: i > 0 ? '1px solid var(--gf-gray-100)' : 'none', fontSize: 12 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, borderRadius: 4, padding: '2px 5px',
                      background: d.tipo === 'nueva' ? 'var(--gf-emerald-50)' : d.tipo === 'desaparecida' ? 'rgba(220,38,38,.1)' : 'var(--gf-gray-100)',
                      color: d.tipo === 'nueva' ? 'var(--gf-emerald)' : d.tipo === 'desaparecida' ? 'var(--gf-expense)' : 'var(--color-text-sec)',
                    }}>
                      {d.tipo === 'nueva' ? 'NUEVA' : d.tipo === 'desaparecida' ? 'BAJA' : 'Δ'}
                    </span>
                    <span style={{ fontWeight: 600 }}>{d.ticker}</span>
                    <span style={{ color: 'var(--color-text-sec)' }}>{d.cuenta}</span>
                    {d.tipo === 'delta' && d.delta != null && (
                      <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: d.delta > 0 ? 'var(--gf-income)' : 'var(--gf-expense)' }}>
                        {d.delta > 0 ? '+' : ''}{fmtUsd(d.delta)}
                      </span>
                    )}
                  </div>
                ))}
              </Card>
            )}

            {errorGuardar && (
              <Card style={{ background: 'rgba(220,38,38,.07)' }}>
                <div style={{ fontSize: 12, color: 'var(--gf-expense)' }}>Error al guardar: {errorGuardar}</div>
              </Card>
            )}

            {/* Botones */}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={onClose} disabled={step === 'saving'} style={{ flex: 1, padding: '13px 16px', borderRadius: 12, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-base)' }}>
                Cancelar
              </button>
              <button onClick={handleConfirmar} disabled={step === 'saving'} style={{ flex: 2, padding: '13px 16px', borderRadius: 12, border: 'none', background: step === 'saving' ? 'var(--gf-gray-300)' : 'var(--color-accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: step === 'saving' ? 'default' : 'pointer', fontFamily: 'var(--font-base)' }}>
                {step === 'saving' ? 'Guardando…' : 'Confirmar y guardar'}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
