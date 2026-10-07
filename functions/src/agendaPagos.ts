// F9.183 — Agenda de pagos: una captura con varias boletas se parte en un comprobante por fila nueva.
// Semántica normativa en docs/CLAUDE.md, "Agenda de pagos: una captura, un comprobante por fila nueva".
//
// Este módulo es PURO (sin Firestore ni API): el prompt de la segunda llamada, la validación de las
// filas, el id por contenido de cada hijo, el dedup contra lo ya cargado y la forma del hijo. La
// transacción vive en agendaDivision.ts y la llamada al modelo en index.ts. Así scripts/probarF9183.ts
// ejercita exactamente esto, sin levantar firebase-functions.
import { createHash } from 'crypto';

/** Una fila tal como la devuelve el modelo (puede venir incompleta: la valida `validarFilas`). */
export type FilaCruda = {
  emisor?: unknown; numeroCliente?: unknown; monto?: unknown; moneda?: unknown;
  vencimiento?: unknown; vencimientoTexto?: unknown;
};

/** Una fila que pasó la validación determinística de 1.3. */
export type FilaAgenda = {
  emisor: string;
  numeroCliente: string;
  monto: number;
  moneda: 'ARS' | 'USD';
  vencimiento: string;          // YYYY-MM-DD
  vencimientoTexto: string;     // crudo, como evidencia ("Vence mañana", "Vence el 31/10")
};

export type FilaInvalida = { fila: FilaCruda; motivo: string };
export type FilaDescartada = { texto: string; motivo: string };

/** Un comprobante ya cargado que puede ser la misma boleta que una fila (universo de 2.0). */
export type Existente = {
  id: string;
  numeroCliente: string;
  monto: number;
  vencimiento: string;
  emisor: string;
  subidoEn: string | null;      // YYYY-MM-DD, para mostrar en la card del padre
};

export const TOPE_DEDUP = 0.03;
export const MAX_TOKENS_AGENDA = 4096;   // ~40 filas a ~70 tokens cada una, con margen

// ── §1.2 — el prompt de la segunda llamada ───────────────────────────────────────────────────────

/**
 * `subida` es el día de SUBIDA del padre (YYYY-MM-DD), no el de proceso: "Vence mañana" es relativo
 * a cuándo se sacó la captura, y un reintento de mañana no puede correr todos los vencimientos un
 * día. Es el mismo anclaje que F9.154 (`corregirAnioVencimientos`) y F9.169 (`esObligacionFutura`).
 */
export function buildAgendaPrompt(subida: string): string {
  return `\
Sos un extractor de la "Agenda de pagos" de una app de pagos argentina: una captura de pantalla con
una LISTA de boletas o servicios pendientes, uno por renglón.

La captura se sacó el ${subida} (zona horaria America/Argentina/Buenos_Aires). Todos los
vencimientos relativos se calculan contra ESA fecha.

Por cada renglón visible devolvé una fila con:
- emisor: el nombre del servicio tal cual se ve (ej. "AGIP Inmobiliario/ABL", "Edenor", "Metrogas").
- numeroCliente: el número que aparece debajo del emisor, tal cual, con sus ceros a la izquierda.
- monto: número decimal. Los números argentinos usan punto de miles y coma decimal:
  "$ 76.228,21" → 76228.21.
- moneda: "ARS", salvo que el renglón diga USD / U$S / dólares.
- vencimiento: YYYY-MM-DD.
  · "Vence hoy" → ${subida}. "Vence mañana" → el día siguiente a ${subida}.
  · "Vence el DD/MM" sin año: elegí el año tal que la fecha sea la ocurrencia de ese día/mes MÁS
    CERCANA a ${subida} en valor absoluto, hacia adelante o hacia atrás. Un vencimiento futuro es lo
    normal: no lo corras al año pasado por ser futuro.
- vencimientoTexto: el texto del vencimiento tal cual se ve ("Vence mañana", "Vence el 31/10").

REGLAS:
- Una fila por renglón visible. NO deduplicar: varios renglones con el mismo número de cliente son
  obligaciones DISTINTAS (por ejemplo, cuotas atrasadas del mismo impuesto), aunque se parezcan.
- Un renglón cortado por el borde de la captura, sin monto o sin emisor, NO se emite como fila: va en
  filasDescartadas con el motivo.
- No inventes renglones que no se ven. Los botones ("Pagar nuevo servicio") no son renglones.

Devolvé EXCLUSIVAMENTE un objeto JSON válido, sin markdown y sin texto antes ni después:
{
  "filas": [
    { "emisor": "...", "numeroCliente": "...", "monto": 0.00, "moneda": "ARS",
      "vencimiento": "YYYY-MM-DD", "vencimientoTexto": "..." }
  ],
  "filasDescartadas": [ { "texto": "...", "motivo": "..." } ]
}`;
}

// ── §1.3 — validación determinística ────────────────────────────────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function fechaIsoValida(s: string): boolean {
  if (!ISO.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Una fila inválida NO se descarta en silencio: va a `invalidas` con el motivo. */
export function validarFilas(crudas: FilaCruda[]): { validas: FilaAgenda[]; invalidas: FilaInvalida[] } {
  const validas: FilaAgenda[] = [];
  const invalidas: FilaInvalida[] = [];
  for (const f of crudas) {
    const motivos: string[] = [];
    const monto = typeof f.monto === 'number' ? f.monto : Number.NaN;
    if (!(Number.isFinite(monto) && monto > 0)) motivos.push(`monto inválido (${String(f.monto)})`);
    const venc = typeof f.vencimiento === 'string' ? f.vencimiento.slice(0, 10) : '';
    if (!fechaIsoValida(venc)) motivos.push(`vencimiento inválido (${String(f.vencimiento)})`);
    const nc = typeof f.numeroCliente === 'string' ? f.numeroCliente.trim() : typeof f.numeroCliente === 'number' ? String(f.numeroCliente) : '';
    if (!nc) motivos.push('numeroCliente vacío');
    const emisor = typeof f.emisor === 'string' ? f.emisor.trim() : '';
    if (!emisor) motivos.push('emisor vacío');
    if (motivos.length) { invalidas.push({ fila: f, motivo: motivos.join('; ') }); continue; }
    validas.push({
      emisor, numeroCliente: nc, monto: Math.round(monto * 100) / 100,
      moneda: f.moneda === 'USD' ? 'USD' : 'ARS',
      vencimiento: venc,
      vencimientoTexto: typeof f.vencimientoTexto === 'string' ? f.vencimientoTexto : '',
    });
  }
  return { validas, invalidas };
}

// ── §2.1 — id del hijo, por contenido ───────────────────────────────────────────────────────────

/**
 * `sha256("agenda|" + numeroCliente normalizado + "|" + vencimiento + "|" + monto.toFixed(2))`, entero
 * (64 hex), igual que los ids de hoy (el hash del archivo). Si dos filas de la MISMA captura dan el
 * mismo id, la segunda lleva `|2`, la tercera `|3`, en orden: es la única forma de que dos renglones
 * idénticos sean dos obligaciones. Devuelve un id por fila, en el mismo orden.
 */
export function idsDeHijos(filas: FilaAgenda[], normalizar: (v: unknown) => string): { ids: string[]; repetidas: number } {
  const vistas = new Map<string, number>();
  let repetidas = 0;
  const ids = filas.map(f => {
    const base = `agenda|${normalizar(f.numeroCliente)}|${f.vencimiento}|${f.monto.toFixed(2)}`;
    const n = (vistas.get(base) ?? 0) + 1;
    vistas.set(base, n);
    if (n > 1) repetidas++;
    return createHash('sha256').update(n === 1 ? base : `${base}|${n}`).digest('hex');
  });
  return { ids, repetidas };
}

// ── §2.0 — dedup contra lo ya cargado ───────────────────────────────────────────────────────────

/**
 * Para cada fila, el existente con que se aparea (o null = fila nueva). Dentro de cada llave
 * (numeroCliente normalizado + vencimiento), la asignación uno a uno que MAXIMIZA los pares dentro del
 * tope y, entre ésas, MINIMIZA la suma de diferencias relativas. No "gana la menor diferencia": eso
 * duplica al mes siguiente cuando los intereses empujan cada cuota cerca de su vecina (docs/CLAUDE.md,
 * F9.183 §0). Determinístico: ante costos iguales gana la primera asignación explorada, y la
 * exploración sigue el orden de las filas y de los existentes ordenados por id.
 *
 * Los grupos son chicos (las boletas de un mismo número de cliente con el mismo vencimiento), así que
 * se busca por fuerza bruta con poda. Un grupo grande (> 8 filas) cae a un apareo en orden de monto,
 * que es lo que la búsqueda exacta elige en el caso normal.
 */
export function aparearConExistentes(
  filas: FilaAgenda[],
  existentes: Existente[],
  normalizar: (v: unknown) => string,
  tope = TOPE_DEDUP,
): Array<{ existente: Existente; diff: number } | null> {
  const clave = (nc: unknown, v: string) => `${normalizar(nc)}|${v}`;
  const res: Array<{ existente: Existente; diff: number } | null> = filas.map(() => null);
  const grupos = new Map<string, number[]>();
  filas.forEach((f, i) => { const k = clave(f.numeroCliente, f.vencimiento); grupos.set(k, [...(grupos.get(k) ?? []), i]); });
  const ordenados = [...existentes].sort((a, b) => a.id.localeCompare(b.id));

  for (const [k, idx] of grupos) {
    const exs = ordenados.filter(e => clave(e.numeroCliente, e.vencimiento) === k);
    if (exs.length === 0) continue;
    const diff = (i: number, j: number) => Math.abs(filas[i].monto - exs[j].monto) / exs[j].monto;

    if (idx.length > 8 || exs.length > 8) {
      // Respaldo para grupos grandes: los dos lados en orden de monto, par por par dentro del tope.
      const fs = [...idx].sort((a, b) => filas[a].monto - filas[b].monto);
      const es = exs.map((_, j) => j).sort((a, b) => exs[a].monto - exs[b].monto);
      let j = 0;
      for (const i of fs) {
        while (j < es.length && exs[es[j]].monto < filas[i].monto && diff(i, es[j]) > tope) j++;
        if (j < es.length && diff(i, es[j]) <= tope) { res[i] = { existente: exs[es[j]], diff: diff(i, es[j]) }; j++; }
      }
      continue;
    }

    let mejor = { pares: 0, costo: 0, asign: idx.map(() => -1) };
    const asign: number[] = [];
    const usado = new Set<number>();
    const rec = (n: number, pares: number, costo: number) => {
      if (pares + (idx.length - n) < mejor.pares) return;   // poda: ya no alcanza a igualar
      if (n === idx.length) {
        if (pares > mejor.pares || (pares === mejor.pares && costo < mejor.costo - 1e-12)) mejor = { pares, costo, asign: [...asign] };
        return;
      }
      for (let j = 0; j < exs.length; j++) {
        if (usado.has(j)) continue;
        const d = diff(idx[n], j);
        if (d > tope) continue;
        usado.add(j); asign.push(j); rec(n + 1, pares + 1, costo + d); asign.pop(); usado.delete(j);
      }
      asign.push(-1); rec(n + 1, pares, costo); asign.pop();
    };
    rec(0, 0, 0);
    mejor.asign.forEach((j, n) => { if (j >= 0) res[idx[n]] = { existente: exs[j], diff: diff(idx[n], j) }; });
  }
  return res;
}

// ── §2.3 — la forma del hijo ────────────────────────────────────────────────────────────────────

/**
 * `datosExtraidos` con forma de boleta: el mismo shape que deja la extracción de un recorte, así que
 * el match y la card lo tratan igual. Los campos que la agenda no trae van en null.
 * `numeroOperacion` sigue la regla del pseudo-número del prompt de siempre (YYYY-MM-<slug>), más el
 * número de cliente y el vencimiento para que dos filas del mismo emisor no compartan número.
 */
export function datosDeHijo(f: FilaAgenda): Record<string, unknown> {
  const slug = f.emisor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return {
    tipoDocumento:       'recibo_servicio',
    fecha:               null,
    montoTotal:          f.monto,
    moneda:              f.moneda,
    comercioRazonSocial: f.emisor,
    cuit:                null,
    numeroOperacion:     `${f.vencimiento.slice(0, 7)}-${slug}-${f.numeroCliente}-${f.vencimiento}`,
    periodoFacturado:    null,
    numeroCliente:       f.numeroCliente,
    vencimientos:        [{ fecha: f.vencimiento, monto: f.monto }],
    destinoCbu:          null,
    destinoCuit:         null,
    destinoAlias:        null,
    destinoNombre:       f.emisor,
    direccion:           'saliente',
    contraparteNombre:   f.emisor,
    contraparteCuit:     null,
    contraparteCbu:      null,
    // Evidencia de origen: el texto crudo del vencimiento, tal como se leyó en la captura.
    vencimientoTexto:    f.vencimientoTexto,
  };
}
