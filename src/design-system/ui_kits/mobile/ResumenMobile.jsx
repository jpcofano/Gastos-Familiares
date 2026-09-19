// ResumenMobile — paridad con el vivo `src/vistas/Resumen.tsx` (F9.99.8 → F9.140).
//  • Por día     : KPIs (neto + cobertura) · banner de 3 estados · card HOY "a pagar"
//                  (con vencidos) · card HOY "gastado" · gastos por día expandibles.
//  • Gastos Fijos: agenda unificada = esperados ∪ gastos futuros sueltos, ordenada por
//                  día de vencimiento, con "Débitos automáticos" en sub-sección propia.
//  • Privacidad  : todo se expresa como % del ingreso del mes, con la base declarada.
const { Money: RMny, StatusBadge: RSB, Badge: RBadge, Button: RBtn, Card: RCard } =
  window.GastosFamiliaresDesignSystem_d81a5e;

// ── helpers ───────────────────────────────────────────────────────────────
const HOY_DIA = 29; // "hoy" del mock (junio 2026)
const DIAS_MES = 30;
const DIA_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const CUBIERTOS = ['pagado', 'automatico'];
const ACCIONABLE = ['pendiente', 'vencido', 'no_registrado', 'por_confirmar', 'parcial'];
// Signo como prefijo, igual que `money.jsx` (−$ 1.234, no $ -1.234).
const _nfes = (n) => Math.round(Math.abs(n)).toLocaleString('es-AR');
const _sign = (n) => (n < 0 ? '−' : '');
function fmtArs(n) { return _sign(n) + '$\u00a0' + _nfes(n); }
function fmtUsd(n) { return _sign(n) + 'U$S\u00a0' + _nfes(n); }
function fmtPct(n, base) { return base > 0 ? Math.round((n / base) * 100) + '%' : '—'; }
function rEqArs(x) { return x.moneda === 'ARS' ? x.monto : x.monto * (x.tcUsdArs || window.M_TC); }
// F9.132.2 — un movimiento está "cubierto" si ya salió la plata O si saldó su obligación.
function movCubierto(m) { return m.pagado === true || m.confirmadoPago === true; }
// Montos REALES (F9.132.1 cambio C): pesos y dólares cada uno en su moneda de origen.
const REAL0 = { ars: 0, usd: 0 };
function sumarReal(a, m) { return m.moneda === 'USD' ? { ars: a.ars, usd: a.usd + m.monto } : { ars: a.ars + m.monto, usd: a.usd }; }
function totalReal(movs) { return movs.reduce(sumarReal, REAL0); }
function agruparReal(movs, clave) {
  const map = new Map();
  for (const m of movs) map.set(clave(m), sumarReal(map.get(clave(m)) || REAL0, m));
  return [...map.entries()].sort((a, b) => b[1].ars - a[1].ars);
}
// El esperado sin plantilla usa su fecha; el que tiene vencimiento, el vencimiento.
function fechaEfectiva(m) { return m.vencimiento ? new Date(2026, 5, m.vencimiento) : m.fecha; }

// ── Fila compartida día + chips de banco + total (F9.99.8.1 DiaRowShell) ─────
function DiaRow({ dayBig, daySub, banks, totalNode, highlight, expanded, onToggle, fmtChip, children }) {
  const Ic = window.Icon;
  return (
    <RCard variant={highlight ? 'highlight' : 'flat'} padding="var(--space-3)">
      <button onClick={onToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-base)', color: 'var(--color-text)', textAlign: 'left' }}>
        <span style={{ width: 46, flexShrink: 0, textAlign: 'center' }}>
          <span style={{ display: 'block', fontSize: 19, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{dayBig}</span>
          <span style={{ display: 'block', fontSize: 10, color: 'var(--gf-gray-400)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.4px' }}>{daySub}</span>
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {banks.map(([b, v]) => {
            const banco = (window.M_BANCOS || []).find((x) => x.nombre === b) || {};
            return (
              <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--color-text-strong)', background: 'var(--gf-gray-100)', borderRadius: 999, padding: '3px 9px 3px 4px', whiteSpace: 'nowrap' }}>
                <window.BankLogo id={banco.id} nombre={b} color={banco.color} dominio={banco.dominio} size={17} radius={5} />
                {b} · {fmtChip(v)}
              </span>
            );
          })}
        </span>
        <span style={{ textAlign: 'right', flexShrink: 0 }}>{totalNode}</span>
        <Ic name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="var(--gf-gray-300)" />
      </button>
      {children}
    </RCard>
  );
}

// Fila de "a pagar" / "vencido" dentro de la card HOY.
function FilaAPagar({ m, conBorde, monto, pie, vencido }) {
  const banco = (window.M_BANCOS || []).find((b) => b.nombre === window.medioCanonico(m.banco)) || {};
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: conBorde ? '1px solid var(--gf-gray-100)' : 'none' }}>
      <window.BankLogo id={banco.id} nombre={banco.nombre || m.banco} color={banco.color} dominio={banco.dominio} size={28} radius={8} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.descripcion}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-sec)' }}>{window.medioCanonico(m.banco)}{m.subcat ? ' · ' + m.subcat : ''}</span>
      </span>
      <span style={{ textAlign: 'right', flexShrink: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: vencido ? 'var(--gf-expense-text)' : 'var(--color-text)' }}>{monto}</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: vencido ? 'var(--gf-expense-text)' : 'var(--color-text-sec)' }}>{pie}</span>
      </span>
    </div>
  );
}

// ── KPI calc ────────────────────────────────────────────────────────────────
function rCalc(movs) {
  const tc = window.M_TC;
  let ingArs = 0, ingUsd = 0, gasArs = 0, gasUsd = 0;
  for (const x of movs) {
    if (x.tipo === 'Ingreso') { if (x.moneda === 'USD') ingUsd += x.monto; else ingArs += x.monto; }
    else { if (x.moneda === 'USD') gasUsd += x.monto; else gasArs += x.monto; }
  }
  const ingArsEq = ingArs + ingUsd * tc, gasArsEq = gasArs + gasUsd * tc;
  return {
    ingArsEq, gasArsEq, netArsEq: ingArsEq - gasArsEq,
    ingUsdEq: ingUsd + ingArs / tc, gasUsdEq: gasUsd + gasArs / tc,
    netUsdEq: (ingUsd + ingArs / tc) - (gasUsd + gasArs / tc),
    pesosDisp: ingArs, tc,
    // F9.140 — cobertura del mes: gastos totales ARS-eq contra los pesos que entraron.
    faltanteArs: gasArsEq - ingArs,
  };
}

function rByDay(movs) {
  const map = new Map();
  for (const x of movs) {
    if (x.tipo !== 'Gasto') continue;
    const d = x.fecha.getDate();
    if (!map.has(d)) map.set(d, { day: d, date: x.fecha, eqArs: 0, banks: {}, movs: [] });
    const e = map.get(d);
    e.eqArs += rEqArs(x);
    const b = window.medioCanonico(x.banco);
    e.banks[b] = sumarReal(e.banks[b] || REAL0, x);
    e.movs.push(x);
  }
  return [...map.values()].sort((a, b) => a.day - b.day);
}

function PersonaIngreso(movs) {
  const map = {};
  for (const x of movs) if (x.tipo === 'Ingreso') map[x.persona] = (map[x.persona] || 0) + rEqArs(x);
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

// ── Agenda unificada (F9.99.8 / F9.99.8.1 — src/datos/agenda.ts) ────────────
// esperados del checklist ∪ gastos futuros sueltos que ningún esperado capturó.
function construirAgenda(esperados, movs) {
  const capturados = new Set(esperados.map((e) => e.conciliadoCon).filter(Boolean));
  const sueltos = movs.filter((m) =>
    m.tipo === 'Gasto' && !movCubierto(m) && m.fecha.getDate() >= HOY_DIA && !capturados.has(m.id));
  return [
    ...esperados.map((ci) => ({ kind: 'esperado', ci })),
    ...sueltos.map((mov) => ({ kind: 'suelto', mov })),
  ];
}
const agendaCubierto = (e) => e.kind === 'esperado' ? CUBIERTOS.includes(e.ci.estado) : movCubierto(e.mov);
const diaDeAgenda = (e) => e.kind === 'esperado' ? (e.ci.vence || 99) : e.mov.fecha.getDate();
// Pendiente: lo no cubierto, a monto esperado (o real si el suelto ya existe).
const pendienteAgenda = (agenda) => agenda.filter((e) => !agendaCubierto(e))
  .reduce((s, e) => s + (e.kind === 'esperado' ? rEqArs({ monto: e.ci.monto, moneda: e.ci.moneda }) : rEqArs(e.mov)), 0);

// ── Aviso de base del modo privacidad (F9.120) ──────────────────────────────
function BasePrivacidad() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--gf-gray-400)', margin: '0 4px' }}>
      <window.Icon name="eye-off" size={12} color="var(--gf-gray-400)" /> % de los ingresos del mes
    </div>
  );
}

// ── KPIs ────────────────────────────────────────────────────────────────────
function KpiCards({ c, cur, privado, pendiente }) {
  const enArs = privado || cur === 'ARS';
  const fmt = privado ? (n) => fmtPct(n, c.ingArsEq) : (enArs ? fmtArs : fmtUsd);
  const fmtOtra = privado ? () => '' : (enArs ? fmtUsd : fmtArs);
  const netBig = enArs ? c.netArsEq : c.netUsdEq;
  const netSmall = enArs ? c.netUsdEq : c.netArsEq;
  const cubierto = c.faltanteArs <= 0;
  return (
    <React.Fragment>
      <div style={{ background: 'linear-gradient(135deg, var(--gf-ink) 0%, var(--gf-ink-soft) 100%)', borderRadius: 'var(--radius-card)', padding: 'var(--space-4)', color: '#fff', boxShadow: 'var(--shadow-soft)', textAlign: 'center' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'rgba(255,255,255,.55)' }}>Neto del mes</div>
        <div style={{ fontSize: 34, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.5px', lineHeight: 1.05, marginTop: 6, color: netBig >= 0 ? 'var(--gf-on-ink-pos)' : 'var(--gf-on-ink-neg)' }}>
          {netBig >= 0 ? '+' : '−'}{fmt(Math.abs(netBig))}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,.6)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{netBig >= 0 ? '+' : '−'}{fmtOtra(Math.abs(netSmall))}</div>
        <div style={{ display: 'flex', marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.15)' }}>
          {[{ label: 'Ingresos', v: enArs ? c.ingArsEq : c.ingUsdEq, eq: enArs ? c.ingUsdEq : c.ingArsEq },
            { label: 'Gastos', v: enArs ? c.gasArsEq : c.gasUsdEq, eq: enArs ? c.gasUsdEq : c.gasArsEq }].map((x, i) => (
            <div key={x.label} style={{ flex: 1, borderLeft: i > 0 ? '1px solid rgba(255,255,255,.12)' : 'none' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'rgba(255,255,255,.5)' }}>{x.label}</div>
              <div style={{ fontSize: 19, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#fff', marginTop: 3 }}>{fmt(x.v)}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,.55)', fontVariantNumeric: 'tabular-nums', marginTop: 1 }}>{fmtOtra(x.eq)}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <RCard eyebrow="Pesos disponibles" style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{privado ? fmtPct(c.pesosDisp, c.ingArsEq) : fmtArs(c.pesosDisp)}</span>
        </RCard>
        {/* USD para cubrir el mes: lo que falta en dólares para tapar los gastos del mes con
            los pesos que entraron. Cero = cubierto. */}
        <RCard eyebrow="USD para cubrir mes" style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: cubierto ? 'var(--gf-income-text)' : 'var(--gf-expense-text)' }}>
            {cubierto ? 'Cubierto' : (privado ? fmtPct(c.faltanteArs, c.ingArsEq) : fmtUsd(c.faltanteArs / c.tc))}
          </span>
        </RCard>
        {/* USD faltantes = ingresos USD-eq − gastos USD-eq. Negativo = el mes no se paga solo. */}
        <RCard eyebrow="USD faltantes" style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: c.netUsdEq >= 0 ? 'var(--gf-income-text)' : 'var(--gf-expense-text)' }}>
            {privado ? fmtPct(c.netUsdEq * c.tc, c.ingArsEq) : fmtUsd(c.netUsdEq)}
          </span>
        </RCard>
      </div>
    </React.Fragment>
  );
}

// ── Sección: Por día ────────────────────────────────────────────────────────
function PorDia({ cur, privado, esperados, onIrAGastos }) {
  const Ic = window.Icon;
  const M = window.GFMoney;
  const movs = window.M_MOVS.filter((m) => m.incluirResumenMes !== false);
  const c = rCalc(movs);
  const days = rByDay(movs);
  const personas = PersonaIngreso(movs);
  const totalMesEq = days.reduce((s, d) => s + d.eqArs, 0);
  const agenda = construirAgenda(esperados, movs);
  const [openDay, setOpenDay] = React.useState(null);
  const [hoyAbierto, setHoyAbierto] = React.useState(true);
  const [vencAbierto, setVencAbierto] = React.useState(false);

  const fmtBig = (arsEq) => privado ? fmtPct(arsEq, c.ingArsEq) : M.fromARS(arsEq, cur);
  const fmtSmall = (arsEq) => privado ? '' : M.otherFromARS(arsEq, cur);
  // F9.132.1 cambio C — la moneda en cero no se muestra en filas ni chips…
  const fmtReal = (r) => {
    if (privado) return fmtPct(r.ars + r.usd * c.tc, c.ingArsEq);
    const p = [];
    if (r.ars !== 0) p.push(fmtArs(r.ars));
    if (r.usd !== 0) p.push(fmtUsd(r.usd));
    return p.length ? p.join(' · ') : fmtArs(0);
  };
  // …pero el TOTAL del encabezado muestra las dos SIEMPRE (F9.136 §4).
  const fmtTotalReal = (r) => privado ? fmtReal(r) : `${fmtArs(r.ars)} · ${fmtUsd(r.usd)}`;

  // Card 1 y card 2: misma fuente, mismo día, `pagado` como único discriminante.
  const delDia = movs.filter((m) => m.tipo === 'Gasto' && m.fecha.getDate() === HOY_DIA);
  const aPagarHoy = delDia.filter((m) => !movCubierto(m)).sort((a, b) => rEqArs(b) - rEqArs(a));
  const gastadoHoy = delDia.filter((m) => m.pagado === true).sort((a, b) => rEqArs(b) - rEqArs(a));
  // Impagos primero — es lo accionable; los ya pagados quedan como registro del día.
  const filasHoy = [...aPagarHoy, ...gastadoHoy];
  const aPagarVencidos = movs
    .filter((m) => m.tipo === 'Gasto' && !movCubierto(m) && fechaEfectiva(m).getDate() < HOY_DIA)
    .sort((a, b) => fechaEfectiva(a) - fechaEfectiva(b));
  const bancoDe = (m) => window.medioCanonico(m.banco || 'Sin medio');

  const cubiertos = agenda.filter(agendaCubierto).length;
  const porRevisar = esperados.filter((e) => !CUBIERTOS.includes(e.estado) && !e.conciliadoCon && ACCIONABLE.includes(e.estado)).length;
  const vencidos = agenda.filter((e) => e.kind === 'esperado' && e.ci.estado === 'vencido').length;
  const todoConfirmado = porRevisar === 0 && cubiertos === agenda.length;
  const pendiente = pendienteAgenda(agenda);
  // §3 — los vencidos tienen card propia: la card HOY es del día, y un vencido no es de hoy.
  // Sin vencidos la card no se renderiza.
  const fmtPend = (n) => privado ? fmtPct(n, c.ingArsEq) : fmtArs(n);
  // §2 — base del ritmo: el gasto promedio de los últimos 6 meses cerrados (M_HIST_MESES
  // sin el mes en curso). El mes se compara contra cómo gasta la familia, no contra lo que entró.
  const promedio6 = (() => {
    const h = (window.M_HIST_MESES || []).slice(0, -1).slice(-6);
    return h.length ? h.reduce((s, x) => s + x.gasto, 0) / h.length : 0;
  })();
  const pctGastado = promedio6 > 0 ? (totalMesEq / promedio6) * 100 : 0;
  const pctDia = (HOY_DIA / DIAS_MES) * 100;

  // Los días que ya pasaron se pliegan en una sola fila para que la cola del mes quede
  // arriba. Si atrás quedó algo impago, el rótulo lo dice y abre directo esos días.
  const [pasadoAbierto, setPasadoAbierto] = React.useState(false);
  const [verTodoPasado, setVerTodoPasado] = React.useState(false);
  const pasados = days.filter((d) => d.day < HOY_DIA);
  const futuros = days.filter((d) => d.day >= HOY_DIA);
  const totalPasadoEq = pasados.reduce((s, d) => s + d.eqArs, 0);
  const impagosPasadosMovs = pasados.flatMap((d) => d.movs).filter((m) => !movCubierto(m));
  const impagosPasados = impagosPasadosMovs.length;
  const impagoPasadoEq = impagosPasadosMovs.reduce((s, m) => s + rEqArs(m), 0);
  const pasadosImpagos = verTodoPasado ? pasados : pasados.filter((d) => d.movs.some((m) => !movCubierto(m)));

  const renderDia = (d) => {
    const abierto = openDay === d.day;
    return (
              <DiaRow
                key={d.day}
                dayBig={String(d.day)}
                daySub={DIA_ES[d.date.getDay()]}
                banks={Object.entries(d.banks).sort((a, b) => b[1].ars - a[1].ars)}
                highlight={false}
                expanded={abierto}
                onToggle={() => setOpenDay(abierto ? null : d.day)}
                fmtChip={fmtReal}
                totalNode={
                  <React.Fragment>
                    <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtBig(d.eqArs)}</div>
                    <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{fmtSmall(d.eqArs)}</div>
                  </React.Fragment>
                }
              >
                {abierto && (
                  <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--gf-gray-100)' }}>
                    {d.movs.map((m, i) => {
                      // Lo pagado se atenúa por COLOR, no por opacidad: apilar las dos dejaba
                      // el monto a 2,1:1 y el estado a 1,6:1.
                      const pago = movCubierto(m);
                      return (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < d.movs.length - 1 ? '1px solid var(--gf-gray-100)' : 'none' }}>
                        <window.MerchantLogo nombre={m.descripcion} size={30} radius={8} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: pago ? 'var(--color-text-sec)' : 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.descripcion}</span>
                          <span style={{ fontSize: 11.5, color: 'var(--color-text-sec)' }}>{window.medioCanonico(m.banco)}{m.subcat ? ' · ' + m.subcat : ''}</span>
                        </span>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <span style={{ display: 'block', fontSize: 13.5, fontWeight: pago ? 600 : 700, fontVariantNumeric: 'tabular-nums', color: pago ? 'var(--color-text)' : 'var(--gf-out-text)' }}>
                              {privado ? fmtPct(rEqArs(m), c.ingArsEq) : (m.moneda === 'USD' ? fmtUsd(m.monto) : fmtArs(m.monto))}
                            </span>
                            {/* Estado de caja de la fila: lo pago y lo que falta pagar no se
                                distinguían, y en una pantalla de planificación es el dato. */}
                            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: pago ? 'var(--color-text-sec)' : 'var(--gf-expense-text)' }}>
                              {pago ? 'Pagado' : 'A pagar'}
                            </span>
                            {m.moneda === 'USD' && !privado && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--gf-gray-400)' }}>{fmtArs(rEqArs(m))}</span>}
                          </div>
                      </div>
                      );
                    })}
                  </div>
                )}
                {d.day === HOY_DIA && !abierto && <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gf-income-text)', textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 6 }}>Hoy</div>}
              </DiaRow>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {privado && <BasePrivacidad />}
      <KpiCards c={c} cur={cur} privado={privado} pendiente={pendiente} />

      {/* F9.110/F9.136 — tres estados: falta cargar (ámbar) · todo confirmado (verde) ·
          nada vencido pero falta confirmar (reloj). Clickeable → Gastos Fijos. */}
      <RCard variant="flat" padding="var(--space-3)" onClick={onIrAGastos} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        {porRevisar > 0
          ? <Ic name="alert-circle" size={17} color="var(--gf-out-text)" />
          : todoConfirmado
            ? <span style={{ width: 17, height: 17, borderRadius: 999, background: 'var(--gf-income)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Ic name="check" size={11} color="#fff" /></span>
            : <Ic name="clock" size={17} color="var(--gf-gray-400)" />}
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: todoConfirmado ? 'var(--gf-income-text)' : 'var(--color-text)' }}>
          {porRevisar > 0
            ? `Revisar pendientes del mes · ${porRevisar} sin pagar · ${fmtPend(pendiente)}`
            : todoConfirmado
              ? `Todo confirmado · ${cubiertos}/${agenda.length}`
              : <React.Fragment>
                  {vencidos > 0 ? `${vencidos} vencido${vencidos > 1 ? 's' : ''} · ` : 'Nada vencido · '}
                  {cubiertos}/{agenda.length} confirmados
                  {pendiente > 0 && <span style={{ color: 'var(--color-text-sec)', fontWeight: 500 }}> · {fmtPend(pendiente)} a confirmar</span>}
                </React.Fragment>}
        </span>
        <Ic name="chevron-right" size={16} color="var(--gf-gray-300)" />
      </RCard>

      {/* §3 — vencidos: card propia (no existe si no hay vencidos), colapsable, con el total
          por banco en los chips — mismo comportamiento que la card HOY. */}
      {aPagarVencidos.length > 0 && (
        <DiaRow
          dayBig={String(aPagarVencidos.length)}
          daySub="VENC."
          banks={agruparReal(aPagarVencidos, bancoDe)}
          expanded={vencAbierto}
          onToggle={() => setVencAbierto((v) => !v)}
          fmtChip={fmtReal}
          totalNode={
            <React.Fragment>
              <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--gf-expense-text)' }}>{fmtTotalReal(totalReal(aPagarVencidos))}</div>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gf-expense-text)' }}>vencido</div>
            </React.Fragment>
          }
        >
          {vencAbierto && (
            <div style={{ marginTop: 10, borderTop: '1px solid var(--gf-gray-100)', paddingTop: 6 }}>
              {aPagarVencidos.map((m, i) => (
                <FilaAPagar key={m.id} m={m} conBorde={i < aPagarVencidos.length - 1} vencido
                  pie={`Venció ${fechaEfectiva(m).getDate()}/${fechaEfectiva(m).getMonth() + 1}`}
                  monto={privado ? fmtPct(rEqArs(m), c.ingArsEq) : (m.moneda === 'USD' ? fmtUsd(m.monto) : fmtArs(m.monto))} />
              ))}
            </div>
          )}
        </DiaRow>
      )}

      {/* CARD HOY — una sola: cada pago del día con su estado, y el total por banco en los
          chips. Los impagos se listan primero y su subtotal va etiquetado aparte: el total
          del encabezado es el del día completo. */}
      <DiaRow
        dayBig={String(HOY_DIA)}
        daySub="HOY"
        banks={agruparReal(delDia, bancoDe)}
        expanded={hoyAbierto}
        onToggle={() => setHoyAbierto((v) => !v)}
        fmtChip={fmtReal}
        totalNode={
          <React.Fragment>
            <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtTotalReal(totalReal(delDia))}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gf-gray-400)' }}>total de hoy</div>
            {aPagarHoy.length > 0 && (
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--gf-expense-text)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                {aPagarHoy.length} a pagar · {fmtReal(totalReal(aPagarHoy))}
              </div>
            )}
          </React.Fragment>
        }
      >
        {hoyAbierto && (
          <div style={{ marginTop: 10, borderTop: '1px solid var(--gf-gray-100)', paddingTop: 6 }}>
            {delDia.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--color-text-sec)' }}>Nada previsto para hoy.</div>
            ) : filasHoy.map((m, i) => (
              <FilaAPagar key={m.id} m={m} conBorde={i < filasHoy.length - 1}
                pie={movCubierto(m) ? 'Pagado' : 'A pagar'}
                vencido={!movCubierto(m)}
                monto={privado ? fmtPct(rEqArs(m), c.ingArsEq) : (m.moneda === 'USD' ? fmtUsd(m.monto) : fmtArs(m.monto))} />
            ))}
          </div>
        )}
      </DiaRow>

      {/* Distribución de ingresos */}
      {personas.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '0 4px 8px' }}>
            <Ic name="users-round" size={13} color="var(--gf-gray-400)" /> Distribución de ingresos
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {personas.map(([p, v]) => {
              const col = (window.M_MIEMBROS.find((m) => m.nombre === p) || {}).color || 'var(--gf-gray-400)';
              return (
                <div key={p} style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--gf-gray-150)', borderRadius: 'var(--radius-card)', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: col }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-strong)' }}>{p}</span>
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtBig(v)}</div>
                  <div style={{ fontSize: 11, color: 'var(--gf-gray-400)', fontVariantNumeric: 'tabular-nums' }}>{fmtSmall(v)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '0 4px 8px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
            <Ic name="calendar-days" size={13} color="var(--gf-gray-400)" /> Gastos por día
          </span>
          <span style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>Total mes <strong style={{ color: 'var(--color-text)' }}>{fmtBig(totalMesEq)}</strong></span>
        </div>
        {/* §2 — ritmo del mes: gasto acumulado contra el promedio de los 6 meses anteriores,
            con la marca del día. Rojo si el mes va más rápido que el calendario. */}
        {promedio6 > 0 && (
        <div style={{ margin: '0 4px 10px' }}>
          <div style={{ position: 'relative', height: 8, borderRadius: 999, background: 'var(--gf-gray-150)' }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${Math.min(100, pctGastado)}%`, borderRadius: 999, background: pctGastado > pctDia ? 'var(--gf-expense)' : 'var(--gf-emerald)' }} />
            <div title="Día del mes" style={{ position: 'absolute', top: -3, left: `${pctDia}%`, width: 2, height: 14, background: 'var(--color-text)', borderRadius: 2 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 11, color: 'var(--color-text-sec)' }}>
            <span><strong style={{ color: 'var(--color-text)' }}>{Math.round(pctGastado)}%</strong> del promedio de 6 meses</span>
            <span>día {HOY_DIA} de {DIAS_MES} · {Math.round(pctDia)}% · prom. {fmtArs(promedio6)}</span>
          </div>
        </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pasados.length > 0 && (
            <div style={{ background: 'var(--gf-gray-50)', border: '1px dashed var(--gf-gray-200)', borderRadius: 'var(--radius-card)', padding: '11px 13px' }}>
              <button onClick={() => setPasadoAbierto((v) => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-base)', color: 'var(--color-text)', textAlign: 'left' }}>
                <Ic name="history" size={15} color="var(--color-text-sec)" />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>Ya pasó · {pasados.length} días</span>
                  {impagosPasados > 0 && (
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--gf-expense-700)' }}>{impagosPasados} impago{impagosPasados > 1 ? 's' : ''} · {fmtBig(impagoPasadoEq)}</span>
                  )}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-sec)' }}>{fmtBig(totalPasadoEq)}</span>
                <Ic name={pasadoAbierto ? 'chevron-up' : 'chevron-down'} size={16} color="var(--gf-gray-300)" />
              </button>
              {pasadoAbierto && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--gf-gray-200)' }}>
                  {(impagosPasados > 0 ? pasadosImpagos : pasados).map(renderDia)}
                  {/* Filtrado por impagos, el bloque escondía los otros días sin decirlo: en
                     pantalla se leía como que faltaban días. */}
                  {impagosPasados > 0 && pasados.length > pasadosImpagos.length && (
                    <button onClick={() => setVerTodoPasado(true)} style={{ background: 'none', border: 'none', padding: '4px 0 0', cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-sec)', textAlign: 'left' }}>
                      + {pasados.length - pasadosImpagos.length} día{pasados.length - pasadosImpagos.length > 1 ? 's' : ''} sin nada pendiente
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {futuros.length > 0 && pasados.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 4px 0' }}>
              <span style={{ flex: 1, height: 1, background: 'var(--gf-gray-200)' }} />
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--gf-gray-400)' }}>Hasta acá el mes</span>
              <span style={{ flex: 1, height: 1, background: 'var(--gf-gray-200)' }} />
            </div>
          )}
          {futuros.map(renderDia)}
        </div>
      </div>
      <div style={{ height: 4 }} />
    </div>
  );
}

// ── Sección: Gastos Fijos (agenda unificada) ────────────────────────────────
const R_LINE = {
  pagado: 'var(--st-pagado-line)', por_confirmar: 'var(--st-por-confirmar-line)',
  parcial: 'var(--st-parcial-line)', automatico: 'var(--st-automatico-line)',
  pendiente: 'var(--st-pendiente-line)', vencido: 'var(--st-vencido-line)',
  programado: 'var(--st-programado-line)', no_registrado: 'var(--st-no-registrado-line)',
};

// Ítem esperado: estado + acciones (confirmar / registrar pago con monto y fecha).
function ItemEsperadoCard({ i, privado, base, onPagar }) {
  const Ic = window.Icon;
  const [form, setForm] = React.useState(null);
  const accionable = ACCIONABLE.includes(i.estado);
  const fmtMonto = (n) => privado ? fmtPct(n, base) : (i.moneda === 'USD' ? fmtUsd(n) : fmtArs(n));
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--gf-gray-150)', borderRadius: 14, padding: '11px 13px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: R_LINE[i.estado] || R_LINE.pendiente, flexShrink: 0, marginTop: 6 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{i.label}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <RBadge tone="neutral">{i.persona}</RBadge>
              <RSB state={i.estado} />
              {i.vence && <span style={{ fontSize: 11, color: 'var(--color-text-sec)' }}>vence {i.vence}</span>}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtMonto(i.monto)}</div>
          {i.estado === 'parcial' && <div style={{ fontSize: 11, color: 'var(--gf-amber-700)', marginTop: 2 }}>Falta una cuota</div>}
        </div>
      </div>
      {accionable && !form && (
        <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
          <RBtn variant="green" size="sm" style={{ flex: 1 }} onClick={() => onPagar(i.id)}><Ic name="check" size={15} /> Confirmar pago</RBtn>
          <RBtn variant="ghost" size="sm" onClick={() => setForm({ monto: i.monto, dia: HOY_DIA })}>Registrar pago</RBtn>
        </div>
      )}
      {/* F9.99.7 Parte 4 — "Registrar pago": monto y fecha editables, imputado al mes del ítem. */}
      {form && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--gf-gray-100)' }}>
          <input value={form.monto} onChange={(e) => setForm({ ...form, monto: Number(e.target.value) || 0 })} inputMode="numeric"
            style={{ flex: 1, minWidth: 0, padding: '7px 9px', borderRadius: 9, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-base)', fontSize: 13, fontVariantNumeric: 'tabular-nums' }} />
          <input value={`${String(form.dia).padStart(2, '0')}/06`} onChange={(e) => setForm({ ...form, dia: Number(e.target.value.slice(0, 2)) || HOY_DIA })}
            style={{ width: 64, padding: '7px 9px', borderRadius: 9, border: '1px solid var(--gf-gray-200)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'var(--font-base)', fontSize: 13 }} />
          <RBtn variant="green" size="sm" onClick={() => { onPagar(i.id); setForm(null); }}>Guardar</RBtn>
          <RBtn variant="ghost" size="sm" onClick={() => setForm(null)}>✕</RBtn>
        </div>
      )}
    </div>
  );
}

// Gasto futuro sin plantilla: no tiene estado de la máquina, solo pagado o no.
function SueltoCard({ mov, privado, base, onPagar }) {
  const Ic = window.Icon;
  const pagado = movCubierto(mov);
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--gf-gray-150)', borderRadius: 14, padding: '11px 13px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: pagado ? 'var(--st-pagado-line)' : 'var(--gf-gray-300)', flexShrink: 0, marginTop: 6 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{mov.descripcion}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <RBadge tone="neutral">{mov.persona}</RBadge>
              <RBadge tone="warning">Sin plantilla</RBadge>
              <span style={{ fontSize: 11, color: 'var(--color-text-sec)' }}>vence {mov.fecha.getDate()}</span>
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{privado ? fmtPct(rEqArs(mov), base) : (mov.moneda === 'USD' ? fmtUsd(mov.monto) : fmtArs(mov.monto))}</div>
        </div>
      </div>
      <div style={{ marginTop: 9 }}>
        {pagado
          ? <RBtn variant="ghost" size="sm" style={{ width: '100%' }} onClick={() => onPagar(mov.id, false)}>Deshacer</RBtn>
          : <RBtn variant="green" size="sm" style={{ width: '100%' }} onClick={() => onPagar(mov.id, true)}><Ic name="check" size={15} /> Marcar pagado</RBtn>}
      </div>
    </div>
  );
}

function GastosFijos({ privado, esperados, onConfirmar }) {
  const movs = window.M_MOVS.filter((m) => m.incluirResumenMes !== false);
  const base = rCalc(movs).ingArsEq;
  const [pagadosSueltos, setPagadosSueltos] = React.useState({});
  const agenda = construirAgenda(esperados, movs).map((e) =>
    e.kind === 'suelto' && pagadosSueltos[e.mov.id] !== undefined
      ? { kind: 'suelto', mov: { ...e.mov, pagado: pagadosSueltos[e.mov.id] } }
      : e);
  const alDia = agenda.filter(agendaCubierto).length;
  const pendiente = pendienteAgenda(agenda);
  const principales = agenda
    .filter((e) => e.kind === 'suelto' || !e.ci.pagoAutomatico)
    .sort((a, b) => diaDeAgenda(a) - diaDeAgenda(b));
  const automaticos = agenda.filter((e) => e.kind === 'esperado' && e.ci.pagoAutomatico);
  const fmtMonto = (n) => privado ? fmtPct(n, base) : fmtArs(n);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {privado && <BasePrivacidad />}
      <div style={{ display: 'flex', gap: 10 }}>
        <RCard eyebrow="Pendiente" style={{ flex: 1 }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-expense)', fontVariantNumeric: 'tabular-nums' }}>{fmtMonto(pendiente)}</span>
        </RCard>
        <RCard eyebrow="Confirmados" style={{ flex: '0 0 96px', textAlign: 'center' }}>
          <span style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{alDia}<span style={{ fontSize: 14, color: 'var(--gf-gray-400)' }}>/{agenda.length}</span></span>
        </RCard>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {principales.map((e) => e.kind === 'esperado'
          ? <ItemEsperadoCard key={e.ci.id} i={e.ci} privado={privado} base={base} onPagar={onConfirmar} />
          : <SueltoCard key={e.mov.id} mov={e.mov} privado={privado} base={base}
              onPagar={(id, v) => setPagadosSueltos((p) => ({ ...p, [id]: v }))} />)}
      </div>

      {automaticos.length > 0 && (
        <React.Fragment>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gf-gray-400)', textTransform: 'uppercase', letterSpacing: '.5px', margin: '2px 4px 0' }}>Débitos automáticos</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {automaticos.map((e) => <ItemEsperadoCard key={e.ci.id} i={e.ci} privado={privado} base={base} onPagar={onConfirmar} />)}
          </div>
        </React.Fragment>
      )}
      <div style={{ height: 4 }} />
    </div>
  );
}

// ── Shell ───────────────────────────────────────────────────────────────────
function ResumenMobile() {
  const Ic = window.Icon;
  const [sec, setSec] = React.useState('dia');
  const [cur, setCur] = React.useState('ARS');
  const [privado, setPrivado] = React.useState(false);
  const [esperados, setEsperados] = React.useState(window.M_ESPERADOS);
  const confirmar = (id) => setEsperados((prev) => prev.map((i) => i.id === id ? { ...i, estado: 'pagado' } : i));
  const tabs = [{ id: 'dia', label: 'Por día' }, { id: 'fijos', label: 'Gastos Fijos' }];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* F9.120 — privacidad al lado del toggle de moneda; con montos tapados el de
          moneda no cambia nada, así que queda deshabilitado. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={() => setPrivado((v) => !v)} title={privado ? 'Mostrar montos' : 'Ocultar montos'} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 999, border: 'none',
          cursor: 'pointer', fontFamily: 'var(--font-base)', fontSize: 12, fontWeight: 700, transition: '.15s',
          background: privado ? 'var(--gf-ink)' : 'var(--gf-gray-200)', color: privado ? '#fff' : 'var(--color-text-sec)',
        }}>
          <Ic name={privado ? 'eye-off' : 'eye'} size={13} color={privado ? '#fff' : 'var(--color-text-sec)'} /> %
        </button>
        <div style={{ display: 'flex', gap: 3, background: 'var(--gf-gray-200)', borderRadius: 999, padding: 3 }}>
          {['ARS', 'USD'].map((id) => {
            const on = cur === id;
            return (
              <button key={id} onClick={() => setCur(id)} disabled={privado} style={{
                padding: '5px 12px', borderRadius: 999, border: 'none', cursor: privado ? 'default' : 'pointer',
                fontFamily: 'var(--font-base)', fontSize: 12, fontWeight: 700, transition: '.15s',
                background: on && !privado ? 'var(--color-surface)' : 'transparent',
                color: on ? 'var(--color-text)' : 'var(--color-text-sec)',
                boxShadow: on && !privado ? 'var(--shadow-sm)' : 'none', opacity: privado ? .45 : 1,
              }}>{id === 'ARS' ? '$ ARS' : 'USD'}</button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, background: 'var(--gf-gray-100)', borderRadius: 999, padding: 4 }}>
        {tabs.map((t) => {
          const on = sec === t.id;
          return (
            <button key={t.id} onClick={() => setSec(t.id)} style={{
              flex: 1, padding: '8px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-base)', fontSize: 13, fontWeight: on ? 700 : 500,
              background: on ? 'var(--color-surface)' : 'transparent',
              color: on ? 'var(--color-text)' : 'var(--color-text-sec)',
              boxShadow: on ? 'var(--shadow-sm)' : 'none', transition: 'background .15s, color .15s',
            }}>{t.label}</button>
          );
        })}
      </div>

      {sec === 'dia'
        ? <PorDia cur={cur} privado={privado} esperados={esperados} onIrAGastos={() => setSec('fijos')} />
        : <GastosFijos privado={privado} esperados={esperados} onConfirmar={confirmar} />}
    </div>
  );
}

Object.assign(window, { ResumenMobile });
