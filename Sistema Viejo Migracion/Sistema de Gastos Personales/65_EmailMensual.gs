/**************************************
 * EMAIL DASHBOARD MENSUAL
 * - Genera un mail HTML lindo basado en los datos del mes
 * - Configuración en Config!A12:B17
 * - Envío manual y automático
 **************************************/

function gf_emailDashboard_setupConfig_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_CONFIG) || ss.insertSheet(GF.SHEET_CONFIG);

  const labels = [
    ['A12', 'Emails dashboard mensual (TO)'],
    ['A13', 'Emails dashboard mensual (CC)'],
    ['A14', 'Día envío dashboard mensual (1-31)'],
    ['A15', 'Dashboard mensual email habilitado (SI/NO)'],
    ['A16', 'Hora envío dashboard mensual (HH:MM)'],
    ['A17', 'Último envío dashboard mensual']
  ];

  labels.forEach(([a1, label]) => {
    if (!sh.getRange(a1).getValue()) {
      sh.getRange(a1).setValue(label).setFontWeight('bold');
    }
  });

  if (!sh.getRange('B12').getValue()) sh.getRange('B12').setValue('');
  if (!sh.getRange('B13').getValue()) sh.getRange('B13').setValue('');
  if (!sh.getRange('B14').getValue()) sh.getRange('B14').setValue(1);
  if (!sh.getRange('B15').getValue()) sh.getRange('B15').setValue('NO');
  if (!sh.getRange('B16').getValue()) sh.getRange('B16').setValue('08:00');
  if (!sh.getRange('B17').getValue()) sh.getRange('B17').setValue('');

  sh.setColumnWidth(1, 320);
  sh.setColumnWidth(2, 320);
}

function gf_emailDashboard_getCfg_() {
  gf_emailDashboard_setupConfig_();
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(GF.SHEET_CONFIG);

  return {
    to: gf_emailDashboard_normalizeEmails_(sh.getRange('B12').getValue()),
    cc: gf_emailDashboard_normalizeEmails_(sh.getRange('B13').getValue()),
    day: Math.max(1, Math.min(31, Number(sh.getRange('B14').getValue()) || 1)),
    enabled: String(sh.getRange('B15').getValue() || '').trim().toUpperCase() === 'SI',
    hhmm: String(sh.getRange('B16').getValue() || '08:00').trim() || '08:00',
    lastSent: String(sh.getRange('B17').getValue() || '').trim()
  };
}

function gf_emailDashboard_normalizeEmails_(raw) {
  return String(raw || '')
    .split(/[;,\n]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .join(',');
}

function gf_emailDashboard_collectRaw_(mesYYYYMM, start, end) {
  const ss = SpreadsheetApp.getActive();
  const out = [];

  function pushFrom(sh, isHist) {
    if (!sh) return;
    const t = gf_readSheet_(sh);
    const idx = gf_buildIdx_(t.headers);

    const iTipo = idx[gf_norm_('Tipo')];
    const iFecha = idx[gf_norm_('Fecha')];
    const iMes = idx[gf_norm_('Mes')];
    const iDesc = idx[gf_norm_('Descripción')] ?? idx[gf_norm_('Descripcion')];
    const iPers = idx[gf_norm_('Persona')];
    const iBanco = idx[gf_norm_('Banco')];
    const iMon = idx[gf_norm_('Moneda')];
    const iMonto = idx[gf_norm_('Monto')];
    const iCat = idx[gf_norm_('Categoría')] ?? idx[gf_norm_('Categoria')];

    for (const r of t.rows) {
      const tipo = (iTipo != null ? (r[iTipo] ?? '') : '').toString().trim() || 'Gasto';
      const fecha = iFecha != null ? r[iFecha] : null;
      const mesRow = isHist && iMes != null ? String(r[iMes] ?? '').trim() : '';
      const monto = Number(iMonto != null ? r[iMonto] : 0) || 0;
      if (!monto) continue;

      let inMonth = false;
      if (fecha instanceof Date) {
        inMonth = fecha >= start && fecha < end;
      } else if (isHist && mesRow === mesYYYYMM) {
        inMonth = true;
      } else if (!isHist && !fecha) {
        inMonth = true;
      }
      if (!inMonth) continue;

      out.push({
        tipo,
        fecha: fecha instanceof Date ? fecha : null,
        descripcion: (iDesc != null ? r[iDesc] : '') || '',
        persona: (iPers != null ? r[iPers] : '') || '',
        banco: (iBanco != null ? r[iBanco] : '') || '',
        mon: ((iMon != null ? r[iMon] : 'ARS') || 'ARS').toString().toUpperCase().trim(),
        monto,
        cat: (iCat != null ? r[iCat] : '') || ''
      });
    }
  }

  pushFrom(ss.getSheetByName(GF.SHEET_HIST), true);
  pushFrom(ss.getSheetByName(GF.SHEET_CARGA), false);
  return out;
}

function gf_emailDashboard_buildData_(mesYYYYMM) {
  const ss = SpreadsheetApp.getActive();
  const p = gf_parseMonth_(mesYYYYMM);
  const tcRef = Number(gf_lookupTCPorMes_(mesYYYYMM)) || 1;
  const raw = gf_emailDashboard_collectRaw_(mesYYYYMM, p.start, p.end);

  const ingresos = [];
  const gastos = [];
  for (const it of raw) {
    if ((it.tipo || '').toString().trim() === 'Ingreso') ingresos.push(it);
    else gastos.push(it);
  }

  let totalIngArs = 0, totalIngUsd = 0, totalGasArs = 0, totalGasUsd = 0;
  for (const i of ingresos) {
    if (i.mon === 'USD') totalIngUsd += i.monto;
    else totalIngArs += i.monto;
  }
  for (const g of gastos) {
    if (g.mon === 'USD') totalGasUsd += g.monto;
    else totalGasArs += g.monto;
  }

  const totalIngArsEq = totalIngArs + totalIngUsd * tcRef;
  const totalIngUsdEq = totalIngUsd + (tcRef ? totalIngArs / tcRef : 0);
  const totalGasArsEq = totalGasArs + totalGasUsd * tcRef;
  const totalGasUsdEq = totalGasUsd + (tcRef ? totalGasArs / tcRef : 0);
  const netoArsEq = totalIngArsEq - totalGasArsEq;
  const netoUsdEq = totalIngUsdEq - totalGasUsdEq;

  const byCategoria = new Map();
  const byDescripcion = new Map();

  for (const g of gastos) {
    const cat = String(g.cat || 'Sin categoría').trim() || 'Sin categoría';
    const desc = String(g.descripcion || 'Sin descripción').trim() || 'Sin descripción';

    const curCat = byCategoria.get(cat) || { ars: 0, usd: 0 };
    const curDesc = byDescripcion.get(desc) || { ars: 0, usd: 0 };

    if (g.mon === 'USD') {
      curCat.usd += g.monto;
      curDesc.usd += g.monto;
    } else {
      curCat.ars += g.monto;
      curDesc.ars += g.monto;
    }

    byCategoria.set(cat, curCat);
    byDescripcion.set(desc, curDesc);
  }

  const categorias = Array.from(byCategoria.entries())
    .map(([k, v]) => ({
      key: k,
      arsEq: v.ars + v.usd * tcRef,
      usdEq: v.usd + (tcRef ? v.ars / tcRef : 0)
    }))
    .sort((a, b) => b.arsEq - a.arsEq);

  const descripciones = Array.from(byDescripcion.entries())
    .map(([k, v]) => ({
      key: k,
      arsEq: v.ars + v.usd * tcRef,
      usdEq: v.usd + (tcRef ? v.ars / tcRef : 0)
    }))
    .sort((a, b) => b.arsEq - a.arsEq);

  // Ingresos por persona: se leen por descripción real del Histórico/Carga
  // Ejemplos: "Sueldo María (USD)", "Sueldo María (ARS)", "Sueldo Juan (ARS)", "Sueldo Juan (USD)"
  const ingresoPersonaRaw = {
    'María': { ars: 0, usd: 0 },
    'Juan': { ars: 0, usd: 0 }
  };

  for (const i of ingresos) {
    const descNorm = gf_norm_(i.descripcion || '');
    let persona = '';
    if (descNorm.includes('maria')) persona = 'María';
    else if (descNorm.includes('juan')) persona = 'Juan';
    if (!persona) continue;

    if (i.mon === 'USD') ingresoPersonaRaw[persona].usd += i.monto;
    else ingresoPersonaRaw[persona].ars += i.monto;
  }

  const ingresosPersonas = ['María', 'Juan'].map(nombre => {
    const v = ingresoPersonaRaw[nombre] || { ars: 0, usd: 0 };
    return {
      key: nombre,
      arsEq: (v.ars || 0) + (v.usd || 0) * tcRef,
      usdEq: (v.usd || 0) + (tcRef ? (v.ars || 0) / tcRef : 0)
    };
  });

  // Serie mensual de los últimos 6 meses: ingresos y gastos en $ eq y USD eq
  const monthlySeries = [];
  const endMonth = new Date(p.year, p.month0, 1);
  for (let offset = 5; offset >= 0; offset--) {
    const d = new Date(endMonth.getFullYear(), endMonth.getMonth() - offset, 1);
    const ym = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
    const pp = gf_parseMonth_(ym);
    const rr = gf_emailDashboard_collectRaw_(ym, pp.start, pp.end);

    let ingArs = 0, ingUsd = 0, gasArs = 0, gasUsd = 0;
    for (const it of rr) {
      const tipo = (it.tipo || '').toString().trim();
      if (tipo === 'Ingreso') {
        if (it.mon === 'USD') ingUsd += it.monto;
        else ingArs += it.monto;
      } else {
        if (it.mon === 'USD') gasUsd += it.monto;
        else gasArs += it.monto;
      }
    }

    const tcMonth = Number(gf_lookupTCPorMes_(ym)) || tcRef || 1;
    monthlySeries.push({
      label: ym,
      ingresosArsEq: ingArs + ingUsd * tcMonth,
      ingresosUsdEq: ingUsd + (tcMonth ? ingArs / tcMonth : 0),
      gastosArsEq: gasArs + gasUsd * tcMonth,
      gastosUsdEq: gasUsd + (tcMonth ? gasArs / tcMonth : 0)
    });
  }

  const observations = [];
  if (netoArsEq < 0) observations.push(`El mes cierra con saldo negativo de ${gf_emailDashboard_formatMoneyARS_(Math.abs(netoArsEq))} en pesos equivalentes.`);
  else observations.push(`El mes cierra con saldo positivo de ${gf_emailDashboard_formatMoneyARS_(netoArsEq)} en pesos equivalentes.`);

  if (categorias.length) observations.push(`La categoría con mayor peso fue ${categorias[0].key} por ${gf_emailDashboard_formatMoneyARS_(categorias[0].arsEq)} (${gf_emailDashboard_formatMoneyUSD_(categorias[0].usdEq)}).`);
  if (descripciones.length) observations.push(`La descripción con mayor peso fue ${descripciones[0].key} por ${gf_emailDashboard_formatMoneyARS_(descripciones[0].arsEq)}.`);

  const maria = ingresosPersonas.find(x => x.key === 'María') || { arsEq: 0, usdEq: 0 };
  const juan = ingresosPersonas.find(x => x.key === 'Juan') || { arsEq: 0, usdEq: 0 };
  observations.push(`Ingresos equivalentes: María ${gf_emailDashboard_formatMoneyARS_(maria.arsEq)} y Juan ${gf_emailDashboard_formatMoneyARS_(juan.arsEq)}.`);

  return {
    mes: mesYYYYMM,
    tcRef,
    totalIngArsEq,
    totalIngUsdEq,
    totalGasArsEq,
    totalGasUsdEq,
    netoArsEq,
    netoUsdEq,
    categorias,
    descripciones,
    ingresosPersonas,
    monthlySeries,
    observations,
    spreadsheetUrl: ss.getUrl(),
    dashSheetName: `DashMensual ${mesYYYYMM}`
  };
}

function gf_emailDashboard_formatMoneyARS_(n) {
  const x = Number(n) || 0;
  return '$ ' + x.toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function gf_emailDashboard_formatMoneyUSD_(n) {
  const x = Number(n) || 0;
  return 'USD ' + x.toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function gf_emailDashboard_buildSubject_(data) {
  const neto = gf_emailDashboard_formatMoneyARS_(data.netoArsEq);
  const gastos = gf_emailDashboard_formatMoneyARS_(data.totalGasArsEq);
  const ingresos = gf_emailDashboard_formatMoneyARS_(data.totalIngArsEq);
  return `Resumen ${data.mes} | Ing ${ingresos} | Gast ${gastos} | Neto ${neto}`;
}

function gf_emailDashboard_escapeHtml_(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function gf_emailDashboard_tableHtml_(title, rows, firstColLabel) {
  const top = rows.slice(0, 15);
  const trs = top.map(r => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${gf_emailDashboard_escapeHtml_(r.key)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${gf_emailDashboard_formatMoneyARS_(r.arsEq)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${gf_emailDashboard_formatMoneyUSD_(r.usdEq)}</td>
    </tr>`).join('');

  return `
    <div style="margin-top:22px;">
      <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;">${title}</div>
      <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <thead>
          <tr style="background:#111827;color:#ffffff;">
            <th style="padding:12px;text-align:left;">${firstColLabel}</th>
            <th style="padding:12px;text-align:right;">Total ($ eq)</th>
            <th style="padding:12px;text-align:right;">Total (USD eq)</th>
          </tr>
        </thead>
        <tbody>
          ${trs || '<tr><td colspan="3" style="padding:12px;">Sin datos</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

function gf_emailDashboard_peopleIncomeTableHtml_(rows) {
  const trs = rows.map(r => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${gf_emailDashboard_escapeHtml_(r.key)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${gf_emailDashboard_formatMoneyARS_(r.arsEq)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${gf_emailDashboard_formatMoneyUSD_(r.usdEq)}</td>
    </tr>`).join('');

  return `
    <div style="margin-top:22px;">
      <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;">Ingresos por persona</div>
      <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <thead>
          <tr style="background:#111827;color:#ffffff;">
            <th style="padding:12px;text-align:left;">Persona</th>
            <th style="padding:12px;text-align:right;">Ingresos ($ eq)</th>
            <th style="padding:12px;text-align:right;">Ingresos (USD eq)</th>
          </tr>
        </thead>
        <tbody>${trs}</tbody>
      </table>
    </div>`;
}

function gf_emailDashboard_monthlySummaryHtml_(series) {
  const rows = series.filter(x => (Number(x.ingresosArsEq) || 0) > 0 || (Number(x.gastosArsEq) || 0) > 0);
  if (!rows.length) {
    return `
      <div style="margin-top:22px;">
        <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;">Evolución últimos 6 meses</div>
        <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">Sin datos mensuales para mostrar.</div>
      </div>`;
  }

  const maxArs = Math.max(1, ...rows.map(r => Math.max(Number(r.ingresosArsEq)||0, Number(r.gastosArsEq)||0, Math.abs(Number(r.ingresosArsEq||0)-Number(r.gastosArsEq||0)))));

  const trs = rows.map(r => {
    const netoArsEq = (Number(r.ingresosArsEq) || 0) - (Number(r.gastosArsEq) || 0);
    const netoUsdEq = (Number(r.ingresosUsdEq) || 0) - (Number(r.gastosUsdEq) || 0);
    const ingW = Math.max(2, Math.round(((Number(r.ingresosArsEq)||0) / maxArs) * 100));
    const gasW = Math.max(2, Math.round(((Number(r.gastosArsEq)||0) / maxArs) * 100));
    const netW = Math.max(2, Math.round((Math.abs(netoArsEq) / maxArs) * 100));
    const netColor = netoArsEq >= 0 ? '#059669' : '#b91c1c';

    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap;">${gf_emailDashboard_escapeHtml_(r.label)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${gf_emailDashboard_formatMoneyARS_(r.ingresosArsEq)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${gf_emailDashboard_formatMoneyARS_(r.gastosArsEq)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:${netColor};font-weight:700;">${gf_emailDashboard_formatMoneyARS_(netoArsEq)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${gf_emailDashboard_formatMoneyUSD_(r.ingresosUsdEq)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${gf_emailDashboard_formatMoneyUSD_(r.gastosUsdEq)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:${netColor};font-weight:700;">${gf_emailDashboard_formatMoneyUSD_(netoUsdEq)}</td>
      </tr>
      <tr>
        <td colspan="7" style="padding:8px 12px 14px;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">Ingresos / Gastos / Neto ($ eq)</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <div style="flex:1;background:#e5e7eb;border-radius:999px;height:8px;overflow:hidden;"><div style="width:${ingW}%;background:#2563eb;height:8px;"></div></div>
            <div style="flex:1;background:#e5e7eb;border-radius:999px;height:8px;overflow:hidden;"><div style="width:${gasW}%;background:#dc2626;height:8px;"></div></div>
            <div style="flex:1;background:#e5e7eb;border-radius:999px;height:8px;overflow:hidden;"><div style="width:${netW}%;background:${netColor};height:8px;"></div></div>
          </div>
        </td>
      </tr>`;
  }).join('');

  return `
    <div style="margin-top:22px;">
      <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;">Evolución últimos 6 meses</div>
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:12px 14px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
          <span style="display:inline-block;margin-right:16px;"><span style="display:inline-block;width:10px;height:10px;background:#2563eb;border-radius:50%;margin-right:6px;"></span>Ingresos</span>
          <span style="display:inline-block;margin-right:16px;"><span style="display:inline-block;width:10px;height:10px;background:#dc2626;border-radius:50%;margin-right:6px;"></span>Gastos</span>
          <span style="display:inline-block;"><span style="display:inline-block;width:10px;height:10px;background:#059669;border-radius:50%;margin-right:6px;"></span>Neto</span>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#111827;color:#ffffff;">
              <th style="padding:12px;text-align:left;">Mes</th>
              <th style="padding:12px;text-align:right;">Ingresos ($ eq)</th>
              <th style="padding:12px;text-align:right;">Gastos ($ eq)</th>
              <th style="padding:12px;text-align:right;">Neto ($ eq)</th>
              <th style="padding:12px;text-align:right;">Ingresos (USD eq)</th>
              <th style="padding:12px;text-align:right;">Gastos (USD eq)</th>
              <th style="padding:12px;text-align:right;">Neto (USD eq)</th>
            </tr>
          </thead>
          <tbody>${trs}</tbody>
        </table>
      </div>
    </div>`;
}

function gf_emailDashboard_observationsHtml_(items) {
  const lis = items.map(x => `<li style="margin-bottom:8px;">${gf_emailDashboard_escapeHtml_(x)}</li>`).join('');
  return `
    <div style="margin-top:22px;">
      <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;">Observaciones automáticas</div>
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
        <ul style="margin:0;padding-left:18px;color:#374151;line-height:1.5;">${lis}</ul>
      </div>
    </div>`;
}

function gf_emailDashboard_kpiCardHtml_(title, arsEq, usdEq, negative) {
  return `
    <td style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:16px;vertical-align:top;">
      <div style="font-size:13px;color:#6b7280;margin-bottom:8px;">${title}</div>
      <div style="font-size:26px;font-weight:800;${negative && arsEq < 0 ? 'color:#b91c1c;' : ''}">${gf_emailDashboard_formatMoneyARS_(arsEq)}</div>
      <div style="font-size:15px;font-weight:700;margin-top:6px;${negative && usdEq < 0 ? 'color:#b91c1c;' : 'color:#374151;'}">${gf_emailDashboard_formatMoneyUSD_(usdEq)}</div>
    </td>`;
}

function gf_emailDashboard_buildHtml_(data) {
  const link = data.spreadsheetUrl;
  return `
  <div style="background:#f3f4f6;padding:24px;font-family:Arial,sans-serif;color:#111827;">
    <div style="max-width:980px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
      <div style="background:#111827;color:#ffffff;padding:22px 26px;">
        <div style="font-size:28px;font-weight:800;">Dashboard mensual ${data.mes}</div>
        <div style="font-size:14px;opacity:.9;margin-top:6px;">TC ref: ${Number(data.tcRef).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      </div>

      <div style="padding:22px 26px;">
        <table style="width:100%;border-collapse:separate;border-spacing:14px 12px;">
          <tr>
            ${gf_emailDashboard_kpiCardHtml_('Ingresos', data.totalIngArsEq, data.totalIngUsdEq, false)}
            ${gf_emailDashboard_kpiCardHtml_('Gastos', data.totalGasArsEq, data.totalGasUsdEq, false)}
            ${gf_emailDashboard_kpiCardHtml_('Neto', data.netoArsEq, data.netoUsdEq, true)}
          </tr>
        </table>

        ${gf_emailDashboard_tableHtml_('Gastos por categoría', data.categorias, 'Categoría')}
        ${gf_emailDashboard_tableHtml_('Gastos por descripción', data.descripciones, 'Descripción')}
        ${gf_emailDashboard_monthlySummaryHtml_(data.monthlySeries)}
        ${gf_emailDashboard_peopleIncomeTableHtml_(data.ingresosPersonas)}
        ${gf_emailDashboard_observationsHtml_(data.observations)}

        <div style="margin-top:24px;padding-top:18px;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280;">
          <div>Este mail fue generado automáticamente desde tu sistema de gastos familiares.</div>
          <div style="margin-top:8px;"><a href="${link}" style="color:#2563eb;text-decoration:none;font-weight:700;">Abrir planilla</a></div>
        </div>
      </div>
    </div>
  </div>`;
}

function gf_emailDashboard_sendMonthly_() {
  const cfg = gf_emailDashboard_getCfg_();
  if (!cfg.to) throw new Error('Config!B12 está vacío. Cargá al menos un destinatario.');

  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const shConfig = ss.getSheetByName(GF.SHEET_CONFIG);
  const mes = gf_toYYYYMM_(shConfig.getRange(GF.CFG_MES_CELL).getValue(), tz);
  if (!mes) throw new Error('Config!B1 inválido.');

  const data = gf_emailDashboard_buildData_(mes);
  const subject = gf_emailDashboard_buildSubject_(data);
  const htmlBody = gf_emailDashboard_buildHtml_(data);
  const plainBody = `Resumen ${mes}\nIngresos ($ eq): ${data.totalIngArsEq}\nGastos ($ eq): ${data.totalGasArsEq}\nNeto ($ eq): ${data.netoArsEq}`;

  MailApp.sendEmail({
    to: cfg.to,
    cc: cfg.cc || undefined,
    subject,
    htmlBody,
    body: plainBody,
    name: 'Gastos Familia'
  });

  shConfig.getRange('B17').setValue(`${mes} | ${new Date().toISOString()}`);
}

function gf_emailDashboard_sendIfDue_() {
  const cfg = gf_emailDashboard_getCfg_();
  if (!cfg.enabled) return { skipped: true, reason: 'disabled' };
  if (!cfg.to) return { skipped: true, reason: 'no_recipients' };

  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const today = new Date();
  const shConfig = ss.getSheetByName(GF.SHEET_CONFIG);
  const mes = gf_toYYYYMM_(shConfig.getRange(GF.CFG_MES_CELL).getValue(), tz);
  if (!mes) return { skipped: true, reason: 'invalid_month' };

  const parts = mes.split('-').map(Number);
  const year = parts[0];
  const month0 = parts[1] - 1;
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  const sendDay = Math.min(cfg.day, lastDay);

  const todayY = Number(Utilities.formatDate(today, tz, 'yyyy'));
  const todayM = Number(Utilities.formatDate(today, tz, 'M')) - 1;
  const todayD = Number(Utilities.formatDate(today, tz, 'd'));

  if (todayY !== year || todayM !== month0 || todayD !== sendDay) {
    return { skipped: true, reason: 'not_due_today' };
  }

  const props = PropertiesService.getDocumentProperties();
  const key = `GF_EMAIL_DASH_SENT_${mes}`;
  if (props.getProperty(key) === '1') {
    return { skipped: true, reason: 'already_sent' };
  }

  gf_emailDashboard_sendMonthly_();
  props.setProperty(key, '1');
  return { sent: true, mes };
}

function gf_emailDashboard_installTrigger_() {
  const cfg = gf_emailDashboard_getCfg_();
  const parts = String(cfg.hhmm || '08:00').split(':');
  const hour = Math.max(0, Math.min(23, Number(parts[0]) || 8));
  const minute = Math.max(0, Math.min(59, Number(parts[1]) || 0));

  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'gf_emailDashboard_sendIfDue_') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('gf_emailDashboard_sendIfDue_')
    .timeBased()
    .everyDays(1)
    .atHour(hour)
    .nearMinute(minute)
    .create();
}
