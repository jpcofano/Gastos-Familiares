import { useState, useEffect } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { useMiembroCtx } from '../../contexto/MiembroContext';
import { useItemsEsperados } from '../../contexto/ItemsEsperadosContext';
import { useMovimientosDelMes } from '../../hooks/useMovimientosDelMes';
import { useFamiliaConfig } from '../../hooks/useFamiliaConfig';
import { useResumenesTarjeta } from '../../hooks/useResumenesTarjeta';
import { calcularChecklist, cubierto, mesActualStr } from '../../datos/checklist';
import { setCalendarSync } from '../../datos/configFamilia';
import { Card, Badge } from '../../design-system/components';
import { Icon } from '../../design-system/Icon';
import { fmtMoney } from '../../datos/money';
import type { CardStatement, ExpectedItem, Movement, FamiliaConfig } from '../../types';

// F9.43 — Canal A: centro de recordatorios in-app. Derivado on-read desde
// itemsEsperados (diaVencimiento) + resumenesTarjeta (fechaVencimiento) +
// config.tarjetas[].venceDia (respaldo si no hay resumen del período). Sin
// colección nueva. La porción de itemsEsperados necesita movimientos de TODA
// la familia para saber si un ítem ya está cubierto — por Rules eso solo lo
// puede consultar un admin (mismo gate que Resumen › Gastos Fijos), así que
// un dependiente ve únicamente los recordatorios de tarjetas (visibles para
// todos los roles, igual que /tarjetas).

const DIAS_VENTANA = 14;

type EstadoRec = 'vencido' | 'hoy' | 'proximo';

interface Recordatorio {
  id: string;
  titulo: string;
  sub?: string;
  fecha: Date;
  estado: EstadoRec;
  montos: Array<{ monto: number; moneda: 'ARS' | 'USD' }>;
  onTap: () => void;
}

function diffDias(fecha: Date, hoy: Date): number {
  const f = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  const h = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((f.getTime() - h.getTime()) / 86400000);
}

function estadoPorDias(dias: number): EstadoRec {
  if (dias < 0) return 'vencido';
  if (dias === 0) return 'hoy';
  return 'proximo';
}

function recordatoriosEsperados(items: ExpectedItem[], movs: Movement[], hoy: Date, navigate: NavigateFunction): Recordatorio[] {
  const checklist = calcularChecklist(items, movs, mesActualStr());
  const out: Recordatorio[] = [];
  for (const { item, estado } of checklist) {
    if (item.tipo !== 'Gasto' || item.diaVencimiento == null) continue;
    if (cubierto(estado) || estado === 'programado' || estado === 'no_registrado' || estado === 'no_aplica') continue;
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth(), item.diaVencimiento);
    const dias = diffDias(fecha, hoy);
    const estadoRec = estadoPorDias(dias);
    if (estadoRec === 'proximo' && dias > DIAS_VENTANA) continue;
    out.push({
      id: `esp-${item.id}`,
      titulo: [item.categoria, item.subcategoria].filter(Boolean).join(' › ') || item.notas || '(sin categoría)',
      sub: estado === 'por_confirmar' ? 'Pago detectado — falta confirmar' : estado === 'parcial' ? 'Pago parcial detectado' : undefined,
      fecha, estado: estadoRec,
      montos: item.montoEsperado != null ? [{ monto: item.montoEsperado, moneda: item.moneda }] : [],
      onTap: () => navigate('/resumen', { state: { sec: 'fijos' } }),
    });
  }
  return out;
}

function recordatoriosTarjetas(resumenes: CardStatement[], config: FamiliaConfig | null, hoy: Date, navigate: (to: string) => void): Recordatorio[] {
  const out: Recordatorio[] = [];
  const periodoActual = mesActualStr();
  for (const r of resumenes) {
    if (r.estado === 'confirmado' || !r.fechaVencimiento) continue;
    const dias = diffDias(r.fechaVencimiento, hoy);
    const estadoRec = estadoPorDias(dias);
    if (estadoRec === 'proximo' && dias > DIAS_VENTANA) continue;
    const montos: Array<{ monto: number; moneda: 'ARS' | 'USD' }> = [];
    if (r.totalARS > 0) montos.push({ monto: r.totalARS, moneda: 'ARS' });
    if (r.totalUSD > 0) montos.push({ monto: r.totalUSD, moneda: 'USD' });
    out.push({
      id: `tar-${r.id}`,
      titulo: r.tarjeta || r.banco,
      sub: r.tarjeta ? r.banco : undefined,
      fecha: r.fechaVencimiento, estado: estadoRec,
      montos,
      onTap: () => navigate('/tarjetas'),
    });
  }
  // Respaldo: tarjetas con venceDia configurado pero sin resumen cargado del período
  // (ej. todavía no llegó el PDF) — estimado, no hay monto real para mostrar.
  for (const t of config?.tarjetas ?? []) {
    if (!t.venceDia) continue;
    const tieneResumen = resumenes.some(r => r.tarjetaCodigo === t.codigo && r.periodo === periodoActual);
    if (tieneResumen) continue;
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth(), t.venceDia);
    const dias = diffDias(fecha, hoy);
    const estadoRec = estadoPorDias(dias);
    if (estadoRec === 'proximo' && dias > DIAS_VENTANA) continue;
    out.push({
      id: `tarcfg-${t.codigo}`,
      titulo: `${t.banco} — ${t.tipo}`,
      sub: 'Estimado · sin resumen cargado todavía',
      fecha, estado: estadoRec,
      montos: [],
      onTap: () => navigate('/tarjetas'),
    });
  }
  return out;
}

const ORDEN_ESTADO_REC: Record<EstadoRec, number> = { vencido: 0, hoy: 1, proximo: 2 };
const TINT: Record<EstadoRec, string> = { vencido: 'var(--gf-expense)', hoy: 'var(--gf-emerald)', proximo: 'var(--gf-gray-300)' };
const LABEL: Record<EstadoRec, string> = { vencido: 'Vencido', hoy: 'Hoy', proximo: 'Próximo' };

function fmtFechaCorta(d: Date): string {
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', weekday: 'short' });
}

export function contarVencProximos(recordatorios: Recordatorio[]): number {
  return recordatorios.filter(r => r.estado === 'vencido' || r.estado === 'hoy').length;
}

function RecordatorioRow({ r }: { r: Recordatorio }) {
  return (
    <button onClick={r.onTap} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px',
      background: 'var(--color-surface)', border: '1px solid var(--gf-gray-150)', borderRadius: 14,
      cursor: 'pointer', fontFamily: 'var(--font-base)', textAlign: 'left',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: TINT[r.estado], flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{r.titulo}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>
          {fmtFechaCorta(r.fecha)}{r.sub ? ` · ${r.sub}` : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        {r.montos.map(m => (
          <span key={m.moneda} style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(m.monto, { from: m.moneda, to: m.moneda })}</span>
        ))}
        <Badge tone={r.estado === 'vencido' ? 'danger' : r.estado === 'hoy' ? 'success' : 'neutral'}>{LABEL[r.estado]}</Badge>
      </div>
    </button>
  );
}

// Hook compartido — Notificaciones (lista completa) y Perfil (solo el conteo
// del badge) necesitan los mismos recordatorios derivados.
export function useRecordatorios(): { recordatorios: Recordatorio[]; esAdmin: boolean; config: FamiliaConfig | null } {
  const navigate = useNavigate();
  const { memberId, miembro } = useMiembroCtx();
  const esAdmin = miembro.rol === 'admin';
  const hoy = new Date();

  const { config } = useFamiliaConfig();
  const { items } = useItemsEsperados();
  const { movimientos } = useMovimientosDelMes(mesActualStr(), esAdmin ? undefined : memberId);
  const { resumenes } = useResumenesTarjeta();

  const recEsperados = esAdmin ? recordatoriosEsperados(items, movimientos, hoy, navigate) : [];
  const recTarjetas = recordatoriosTarjetas(resumenes, config, hoy, navigate);
  const recordatorios = [...recEsperados, ...recTarjetas].sort((a, b) =>
    ORDEN_ESTADO_REC[a.estado] - ORDEN_ESTADO_REC[b.estado] || a.fecha.getTime() - b.fecha.getTime(),
  );
  return { recordatorios, esAdmin, config };
}

// F9.46 — switch global del Canal B (Google Calendar). Un solo flag para
// toda la familia (calendario compartido) — el admin lo mueve, el
// dependiente solo ve el estado.
function CalendarSyncRow({ esAdmin, activo }: { esAdmin: boolean; activo: boolean }) {
  const [valor, setValor] = useState(activo);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setValor(activo), [activo]);

  async function toggle() {
    if (!esAdmin || guardando) return;
    const nuevo = !valor;
    setValor(nuevo);
    setGuardando(true);
    setError(null);
    const res = await setCalendarSync(nuevo);
    setGuardando(false);
    if (!res.ok) { setValor(!nuevo); setError(res.error.message); }
  }

  return (
    <Card padding="var(--space-3)">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--gf-gray-100)', color: 'var(--color-text-strong)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="calendar" size={18} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>Eventos en Google Calendar</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>
            {esAdmin ? 'Crea los vencimientos en el calendario compartido' : 'Lo activa o desactiva un admin'}
          </div>
        </div>
        {esAdmin ? (
          <button onClick={toggle} disabled={guardando} style={{
            display: 'flex', gap: 3, background: 'var(--gf-gray-200)', borderRadius: 999, padding: 3, border: 'none', cursor: guardando ? 'default' : 'pointer',
          }}>
            {(['Inactivo', 'Activo'] as const).map((label, i) => {
              const on = (i === 1) === valor;
              return (
                <span key={label} style={{
                  padding: '5px 10px', borderRadius: 999, fontFamily: 'var(--font-base)', fontSize: 11, fontWeight: 700,
                  background: on ? 'var(--color-surface)' : 'transparent', color: on ? 'var(--color-text)' : 'var(--color-text-sec)',
                  boxShadow: on ? 'var(--shadow-sm)' : 'none',
                }}>{label}</span>
              );
            })}
          </button>
        ) : (
          <Badge tone={valor ? 'success' : 'neutral'}>{valor ? 'Activo' : 'Inactivo'}</Badge>
        )}
      </div>
      {error && <p style={{ fontSize: 12, color: 'var(--gf-err-text)', margin: '8px 0 0' }}>{error}</p>}
    </Card>
  );
}

export default function Notificaciones() {
  const { recordatorios, esAdmin, config } = useRecordatorios();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <CalendarSyncRow esAdmin={esAdmin} activo={config?.calendarSync === true} />

      <Card variant="flat" padding="var(--space-3)" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="bell" size={17} color="var(--gf-gray-400)" />
        <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-sec)' }}>
          Vencimientos de los próximos {DIAS_VENTANA} días{!esAdmin ? ' · solo tarjetas' : ''}
        </span>
        <span style={{ minWidth: 22, height: 22, borderRadius: 999, background: 'var(--gf-out)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>
          {contarVencProximos(recordatorios)}
        </span>
      </Card>

      {recordatorios.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-sec)', margin: '0 4px' }}>Sin vencimientos próximos.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recordatorios.map(r => <RecordatorioRow key={r.id} r={r} />)}
        </div>
      )}
      <div style={{ height: 4 }} />
    </div>
  );
}
