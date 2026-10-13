// F9.190 §1 — "Actualizar todo" v2: el análisis GLOBAL primero, alimentado por el motor de riesgo.
//
// Por qué existe (diagnóstico medido sobre el prompt v1 de F9.101):
//   1. `buildPromptCompleto` concatenaba los cuatro prompts standalone ENTEROS: persona y reglas
//      repetidas cuatro veces, cada bloque con sus propias instrucciones de formato pisadas al final.
//   2. El lote (todas las posiciones, ~150 palabras c/u) iba PRIMERO y la regla de continuación
//      cortaba ahí: el sectorial y la agenda llegaban comprimidos o no llegaban.
//   3. Ningún bloque miraba la cartera entera. Y no podía: el contexto solo traía total, % AR,
//      % cripto y HHI. Nada del motor que la app ya calcula (escenarios, brecha contra la
//      tolerancia, bandas de la política, exposición por factor, exposiciones sin decidir).
//
// v2: un solo bloque de reglas; orden GLOBAL → SECTORIAL → AGENDA → POSICIONES → MANUALES; si falta
// espacio se recortan las posiciones, nunca el global; análisis completo solo para posiciones ≥ 2%
// (el filtro lo hace el cliente, no el modelo). Los números del motor llegan calculados y el modelo
// tiene PROHIBIDO recalcularlos — mismo criterio que F9.147 para la ficha de posición.
//
// Módulo puro (sin SDK), para poder verificar el texto y el validador sin red ni emulador.

export const VERSION_INFORME = 2;

export function buildPromptCompletoV2(contexto: Record<string, unknown>): string {
  const j = (k: string) => JSON.stringify(contexto[k] ?? null, null, 2);
  const materiales = (contexto['materiales'] as unknown[] | undefined) ?? [];
  const menores = (contexto['menores'] as unknown[] | undefined) ?? [];
  const fecha = typeof contexto['fecha'] === 'string' ? contexto['fecha'] : null;

  return `Sos un analista financiero especializado en mercados argentinos e internacionales. Analizás una cartera familiar${fecha ? `. Hoy es ${fecha}` : ''}.
Usá búsqueda web para verificar datos actuales: MÁXIMO 12 búsquedas, agrupadas por driver (una búsqueda sirve para todo el grupo).

REGLAS (valen para todo el informe):
- Español rioplatense.
- PROHIBIDO: imperativos sin condición ("vendé", "comprá", "recomiendo") y precios objetivo como certeza.
- PERMITIDO: "Si [condición observable] → las opciones serían [A / B], con el trade-off [X]". La decisión es del titular: nunca una salida obligada.
- Si un dato no se puede verificar: null o "sin dato verificado". No inventes.
- Los números de CARTERA, RIESGO y RESERVA los calculó la app y están auditados: NO los recalcules ni los contradigas. Interpretalos. Los porcentajes vienen como fracción (0.35 = 35%).
- No asumas que una posición debe venderse por estar en ganancia ni comprarse por estar en pérdida.
- PRIORIDAD DE SALIDA: global > sectorial > agenda > posiciones > manuales. Si te falta espacio, acortá o recortá "posiciones"; NUNCA "global".

═══ DATOS CALCULADOS POR LA APP ═══
CARTERA:
${j('cartera')}

RIESGO (motor de escenarios, política del titular, exposición por factor, exposiciones que nadie declaró):
${j('riesgo')}

RESERVA (piso de caja de la política) Y SEÑALES DE MERCADO (última lectura de la app; puede venir null):
${j('reserva')}

POSICIONES MATERIALES (peso ≥ 2%, ${materiales.length}):
${j('materiales')}

POSICIONES MENORES (0,5%–2%, ${menores.length}) — solo una nota si hay novedad relevante:
${j('menores')}

POSICIONES MANUALES (precio a actualizar):
${j('manuales')}

═══ QUÉ DEVOLVER ═══
1) "global" (máx. 300 palabras en total). Es el análisis de la cartera COMO UN TODO:
   - "diagnostico": 3-5 frases. Qué mueve hoy a la cartera completa, dónde está el riesgo y cómo se lee contra la política del titular.
   - "riesgosPrincipales": exactamente 3, cada uno con el % de cartera expuesto (sacalo de los datos de la app).
   - "rebalanceo": "lectura" (1-2 frases sobre lo que está fuera de política y las exposiciones sin decidir) + 2-3 "casos" condicionales.
   - "reserva": 1-2 frases sobre el piso de caja (cuánto falta, si falta) y qué tan cerca están las señales de mercado de sus umbrales.
   - "mercado": valores verificados HOY de riesgo país, Merval en USD y S&P 500, cada uno con fecha y fuente (null si no se verifica).
2) "sectorial": markdown. Una sección por driver presente, cada una empieza EXACTAMENTE con "## <Nombre> [driver: <driver>]" (energia_ar, cer_pesos, soberano, cripto, tech_global). Máx. 120 palabras por sección: situación + riesgos + 2 escenarios "Si … → las opciones serían … , con el trade-off …". Sin otros headers.
3) "agenda": máx. 12 eventos de los próximos 45 días, solo si afectan un bloque ≥ 5% o una posición material. Fecha sin confirmar → null, aclarado en el texto. Ordenados por exposición del driver. Cada evento lista los tickers de la cartera que toca.
4) "posiciones":
   - "analisis": una entrada por posición MATERIAL, máx. 80 palabras por resultado: queEs (1 frase), situacionActual (2 frases con info de hoy), riesgos (2), rolEnCartera (1 frase), queHariaEnCadaCaso (2 casos), fuentes (≤ 2). Sin eventos: van en la agenda.
   - "notas": para posiciones MENORES, una línea SOLO si hay una novedad relevante; si no hay, omitila.
5) "manuales": último cierre verificado de cada posición manual; valorUsd = cantidad × precioUnitarioUsd. Si no se verifica → null en precio y valor.

═══ FORMATO ═══
Respondé ÚNICAMENTE con UN bloque \`\`\`json, sin texto afuera ni comentarios adentro, con esta forma exacta:
{
  "global": {
    "diagnostico": "…",
    "riesgosPrincipales": [{ "riesgo": "…", "exposicionPct": "35%" }],
    "rebalanceo": { "lectura": "…", "casos": [{ "caso": "condición observable", "opciones": ["A", "B"], "costo": "trade-off" }] },
    "reserva": "…",
    "mercado": {
      "riesgoPais": { "valor": 589, "fecha": "YYYY-MM-DD", "fuente": "…" },
      "mervalUsd":  { "valor": null, "fecha": null, "fuente": null },
      "sp500":      { "valor": null, "fecha": null, "fuente": null }
    }
  },
  "sectorial": "## Energía AR [driver: energia_ar]\\n…",
  "agenda": { "eventos": [{ "fecha": "YYYY-MM-DD", "evento": "≤ 80 caracteres", "driver": "cer_pesos|soberano|tasas_ar|tasas_global|cripto|energia_ar|tech_global|resultados|impositivo|otro", "tickers": ["YPFD"], "porQueImporta": "1 frase" }] },
  "posiciones": {
    "analisis": [{ "ticker": "…", "resultado": { "queEs": "…", "situacionActual": "…", "riesgos": ["…", "…"], "rolEnCartera": "…", "queHariaEnCadaCaso": [{ "caso": "…", "acciones": ["…", "…"], "costo": "…" }], "fuentes": ["…"] } }],
    "notas": [{ "ticker": "…", "nota": "…" }]
  },
  "manuales": [{ "id": "…", "ticker": "…", "precioUnitarioUsd": 0, "valorUsd": 0, "fechaPrecio": "YYYY-MM-DD", "fuente": "…" }]
}
Si la respuesta no cabe en un mensaje, cortá al final de un elemento completo de "posiciones.analisis" y esperá que el usuario escriba "seguí".`;
}

/** Validación fail-soft del bloque global. null = válido. */
export function validarGlobal(g: unknown): string | null {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return 'global debe ser un objeto';
  const o = g as Record<string, unknown>;
  if (typeof o['diagnostico'] !== 'string' || (o['diagnostico'] as string).trim().length < 40) {
    return 'global.diagnostico falta o es demasiado corto';
  }
  if (o['riesgosPrincipales'] !== undefined && !Array.isArray(o['riesgosPrincipales'])) {
    return 'global.riesgosPrincipales debe ser un array';
  }
  return null;
}

/** ¿La respuesta pegada es v2? Se decide por la forma, no por una marca que el modelo pueda olvidar. */
export const esRespuestaV2 = (parsed: Record<string, unknown>): boolean =>
  'global' in parsed || 'posiciones' in parsed;

// ══ F9.191 — informe v3: coherencia política↔cartera y oportunidades ════════════
//
// Cambios contra v2 (motivos medidos en la corrida del 13-oct-2026, ver docs/prompts/F9.191):
//   - global.coherencia: ¿la política del titular es compatible con esta cartera? Tres vías:
//     mover la cartera, mover la política o las dos. Si falta el perfil, el modelo declara supuestos.
//   - "oportunidades": faltantes (lo que la cartera no tiene y resolvería algo de SU política o de
//     SUS peores escenarios), fondeo sin sumar riesgo y tácticas verificadas. Va segundo en la
//     prioridad de salida: es lo que v2 nunca producía.
//   - Los datos de mercado que la app ya lee entran en el contexto: el modelo los copia, no los busca.
//   - Sectorial por driver con peso ≥ 3% (suma bancos_ar), 110 palabras por posición, 15 búsquedas.
// El import sigue decidiendo por forma: una respuesta v3 también es v2 (`global`/`posiciones`) y
// trae además `oportunidades`.

export const VERSION_INFORME_V3 = 3;

// Reglas comunes a las dos partes (F9.194). Un solo texto: si cambia una regla, cambia en las dos.
const REGLAS_V3 = `═══ REGLAS ═══
- Español rioplatense en los VALORES de texto. Las CLAVES del JSON van idénticas a la plantilla de FORMATO: no se traducen, no se renombran, no se agregan.
- Nada en imperativo ni como recomendación ("vendé", "comprá", "recomiendo", "deberías"). Siempre: "Si [condición observable] → las opciones serían [A / B], con el trade-off [X]". "No hacer nada" puede ser una de las opciones.
- Precios objetivo o rendimientos esperados: solo citados con su fuente, nunca como certeza propia.
- Dato no verificado → null o "sin dato verificado". No inventes números, fechas ni tickers.
- Una ganancia o pérdida acumulada no es, por sí sola, razón para vender ni para comprar.
- Los DATOS DE LA APP son la fuente de verdad sobre la cartera: están auditados. Interpretalos; no los recalcules ni los contradigas. Los porcentajes vienen como fracción (0.35 = 35%).
- Si dos fuentes dan valores distintos para el mismo dato, usá la primaria o la más reciente y mencioná la discrepancia en "fuente".`;

const CIERRE_V3 = `- Strings: saltos de línea escapados como \\n y comillas dobles internas como \\" (vale sobre todo para textos largos). Sin caracteres de control sin escapar.
- La respuesta va COMPLETA en un único bloque JSON válido: no cortes ni pidas confirmación para seguir. Si te acercás al límite de largo, acortá la sección de menor prioridad y asegurate de cerrar todas las llaves y corchetes.`;

/**
 * F9.194 — PARTE 1 de 2: estrategia. Global (con coherencia), oportunidades (con lista blanca),
 * sectorial y agenda. Sin posiciones: ese presupuesto queda para la parte 2.
 */
export function buildPromptEstrategiaV3(contexto: Record<string, unknown>): string {
  const j = (k: string) => JSON.stringify(contexto[k] ?? null, null, 2);
  const materiales = (contexto['materiales'] as unknown[] | undefined) ?? [];
  const fecha = typeof contexto['fecha'] === 'string' ? contexto['fecha'] : null;

  return `Sos un analista de carteras especializado en Argentina y mercados globales. Trabajás para el titular de una cartera familiar: tu tarea es que entienda qué tiene, qué le falta y qué opciones tiene. La decisión es siempre suya.${fecha ? ` Hoy es ${fecha}.` : ''}
Este es el informe PARTE 1 de 2 (estrategia de la cartera completa). Las fichas por posición son la parte 2, en otro mensaje: acá no las hagas.

═══ CÓMO TRABAJAR ═══
1. MERCADO trae lo que la app ya leyó (riesgo país, Merval en USD, SPY, CCL). Usalo tal cual, con su fecha y fuente. Si falta algún valor, resolvé todos los faltantes en UNA sola búsqueda de cierre del día.
2. Búsqueda web: hasta 15 búsquedas; agrupá consultas siempre que puedas. Prioridad: (a) un panorama por driver con peso ≥ 5%; (b) lo que falte de MERCADO; (c) agenda de los próximos 45 días; (d) dato actual (precio, TIR) de los candidatos que elijas en "oportunidades". Abrir una página no cuenta como búsqueda.

${REGLAS_V3}
- "Oportunidades": los candidatos salen de UNIVERSO.candidatos (por ticker o por nombre si es genérico). Un candidato es una opción para evaluar, no una recomendación.
- PRIORIDAD SI FALTA ESPACIO: global > oportunidades > sectorial > agenda. Nunca se acortan "global" ni "oportunidades".

═══ DATOS DE LA APP ═══
PERFIL DEL TITULAR (null = no cargado → en global.coherencia.supuestos declarás qué asumiste: horizonte, moneda de consumo, necesidad de liquidez):
${j('perfil')}

UNIVERSO INVERTIBLE (cuentas, familias de instrumentos, restricciones y la LISTA BLANCA de candidatos; "sumaAFactor" dice a qué factor de riesgo agrega exposición; "enCartera" = ya lo tiene; "excluidos" y "noDisponible" no se proponen):
${j('universo')}

CARTERA:
${j('cartera')}

RIESGO:
- politica: lo que definió el titular (tolerancia de caída, tope por posición, tope por driver, piso de caja).
- escenarios: resultado sobre el total. En los peores, "contribucion" dice cuánto aporta cada bloque al resultado (fracción del total). Un bloque con aporte > 0 en un escenario malo amortigua; si no hay ninguno, la cartera no tiene cobertura para ese caso.
- fueraDePolitica: "usdFaltante" = lo que falta para llegar al piso (caja); "usdExcedente" = lo que sobra sobre el tope (posición o driver).
- exposicionPorFactor: TODA la cartera agrupada por factor de riesgo (incluye cripto y global, no es solo Argentina). Correspondencia con los drivers: energia_ar = Oil & gas + Energía AR regulada; cer_pesos = Soberano AR pesos / CER; soberano = Soberano AR hard-dollar; bancos_ar = Bancos AR; cripto = Cripto; tech_global = Global desarrollado.
- exposicionesSinDecidir: exposiciones que el titular nunca declaró como decisión.
${j('riesgo')}

RESERVA (piso de caja de la política):
${j('reserva')}

MERCADO (lectura de la app; null = sin lectura. "umbrales" son las señales que eligió el titular; "spy" es el ETF SPY, no el índice):
${j('mercado')}

POSICIONES MATERIALES (peso ≥ 2%, ${materiales.length}) — referencia para la agenda y el fondeo; no se analizan acá:
${j('materiales')}

═══ QUÉ DEVOLVER ═══
1) "global" (máx. 350 palabras): la cartera COMO UN TODO.
   - "diagnostico": 3-5 frases. Qué mueve hoy a la cartera completa y dónde está el riesgo.
   - "coherencia": ¿la política del titular es compatible con esta cartera?
       "veredicto": "compatible" | "parcialmente compatible" | "incompatible".
       "lectura": 2-3 frases, apoyadas en brechaTitular, fueraDePolitica y la contribución de los peores escenarios.
       "caminos": exactamente 3 casos condicionales, presentados con el mismo peso: (1) adecuar la cartera a la política actual; (2) adecuar la política a lo que la cartera revela (la tolerancia implícita es la pérdida del escenario de brechaTitular: usá ese número, no supongas otro); (3) un camino intermedio. Cada uno con su trade-off. No des por sentado que la política es intocable ni que el riesgo siempre tiene que bajar.
       "supuestos": lo que asumiste si PERFIL vino null ([] si no asumiste nada).
   - "riesgosPrincipales": exactamente 3, cada uno con el % de cartera expuesto, tomado de los datos.
   - "rebalanceo": "lectura" (1-2 frases sobre lo que está fuera de política y lo que nadie decidió) + 2-3 "casos" condicionales.
   - "reserva": 1-2 frases. Cuánto falta para el piso y a qué distancia está cada señal de su umbral (con MERCADO; si una lectura vino null, usá el valor verificado en la web y aclaralo).
   - "mercado": riesgo país, Merval en USD y S&P 500, cada uno con fecha y fuente. Si MERCADO trae el valor, copialo con fuente "app (<fuente original>)"; si no, verificalo. Para el S&P aclará si es SPY o el índice.
2) "oportunidades" (máx. 300 palabras). Mirá lo que FALTA, no lo que ya hay:
   - "faltantes": 2-4 exposiciones ausentes o subrepresentadas que mejorarían la cartera frente a SU política o SUS peores escenarios. Cada una con:
       "exposicion"; "pesoActual" (número, fracción tomada de los datos; 0 si no existe); "queResuelve" (qué escenario amortigua o qué incumplimiento corrige); "candidatos" (1-3 de UNIVERSO.candidatos, por ticker o nombre); "datoClave" (métrica observable con fecha: precio, TIR o duration; si no la refrescaste, la "dato" de la lista aclarando su fecha; o "sin dato verificado"); "tradeoff" (incluí si el candidato suma a un factor ya concentrado, según "sumaAFactor").
     Si ningún candidato de la lista resuelve un faltante, decilo en "candidatos" (["sin candidato en la lista blanca"]) y explicá en "tradeoff" qué haría falta (p. ej. una cuenta en el exterior); no inventes un ticker.
   - "fondeo": de dónde podría salir la plata SIN sumar riesgo: vencimientos de la agenda, usdExcedente de fueraDePolitica, caja disponible. Montos solo si están en los datos o en la agenda; no inventes.
   - "tacticas": 0-2 oportunidades de mercado verificadas hoy (un sector castigado, una dislocación, un evento), como casos condicionales. Si suman riesgo a un driver o factor ya excedido, decilo en el costo.
   Primero los faltantes que corrigen un incumplimiento de la política; después los que agregan riesgo.
3) "sectorial": markdown. Una sección por driver con peso consolidado ≥ 3% según exposicionPorFactor (energia_ar suma Oil & gas + Energía AR regulada en UNA sola sección). Cada una empieza EXACTAMENTE con "## <Nombre> [driver: <driver>]", usando solo estos tags: energia_ar, cer_pesos, soberano, bancos_ar, cripto, tech_global. Ningún otro. Máx. 150 palabras: situación de hoy + riesgos + 2 escenarios "Si … → las opciones serían … , con el trade-off …". Sin otros headers. Este texto lo va a recibir la parte 2 como contexto de cada posición: que sea concreto.
4) "agenda": máx. 12 eventos de los próximos 45 días, solo si afectan un bloque ≥ 5% o una posición material. Incluí vencimientos de posiciones de la cartera. Fecha sin confirmar → null, aclarado en el texto. Ordenados por exposición del driver. Cada evento lista los tickers de la cartera que toca.

═══ FORMATO ═══
Respondé ÚNICAMENTE con UN bloque \`\`\`json, sin texto afuera ni comentarios adentro, con esta forma exacta:
{
  "global": {
    "diagnostico": "…",
    "coherencia": {
      "veredicto": "compatible|parcialmente compatible|incompatible",
      "lectura": "…",
      "caminos": [{ "caso": "condición observable", "opciones": ["A", "B"], "costo": "trade-off" }],
      "supuestos": ["…"]
    },
    "riesgosPrincipales": [{ "riesgo": "…", "exposicionPct": "35%" }],
    "rebalanceo": { "lectura": "…", "casos": [{ "caso": "condición observable", "opciones": ["A", "B"], "costo": "trade-off" }] },
    "reserva": "…",
    "mercado": {
      "riesgoPais": { "valor": 589, "fecha": "YYYY-MM-DD", "fuente": "…" },
      "mervalUsd":  { "valor": null, "fecha": null, "fuente": null },
      "sp500":      { "valor": null, "fecha": null, "fuente": null }
    }
  },
  "oportunidades": {
    "faltantes": [{ "exposicion": "…", "pesoActual": 0, "queResuelve": "…", "candidatos": ["…"], "datoClave": "…", "tradeoff": "…" }],
    "fondeo": [{ "fuente": "…", "usd": 0 }],
    "tacticas": [{ "caso": "Si …", "opciones": ["…", "…"], "costo": "…" }]
  },
  "sectorial": "## Energía AR [driver: energia_ar]\\n…",
  "agenda": { "eventos": [{ "fecha": "YYYY-MM-DD", "evento": "≤ 80 caracteres", "driver": "cer_pesos|soberano|bancos_ar|tasas_ar|tasas_global|cripto|energia_ar|tech_global|resultados|impositivo|otro", "tickers": ["YPFD"], "porQueImporta": "1 frase" }] }
}
${CIERRE_V3}`;
}

/**
 * F9.194 — PARTE 2 de 2: posiciones. Recibe el panorama que dejó la parte 1 (diagnóstico,
 * sectorial, agenda) y dedica todo el presupuesto de búsqueda a las posiciones.
 */
export function buildPromptPosicionesV3(contexto: Record<string, unknown>): string {
  const j = (k: string) => JSON.stringify(contexto[k] ?? null, null, 2);
  const materiales = (contexto['materiales'] as unknown[] | undefined) ?? [];
  const menores = (contexto['menores'] as unknown[] | undefined) ?? [];
  const fecha = typeof contexto['fecha'] === 'string' ? contexto['fecha'] : null;
  const panorama = (contexto['panorama'] ?? {}) as Record<string, unknown>;
  const sinPanorama = !panorama['sectorial'] && !panorama['diagnostico'];

  return `Sos un analista de carteras especializado en Argentina y mercados globales. Trabajás para el titular de una cartera familiar. La decisión es siempre suya.${fecha ? ` Hoy es ${fecha}.` : ''}
Este es el informe PARTE 2 de 2: una ficha por posición. El panorama de la cartera completa (parte 1) ya está hecho y viene abajo en PANORAMA: usalo como contexto y no lo repitas.${sinPanorama ? '\nATENCIÓN: PANORAMA vino vacío (la parte 1 no se corrió o no se importó). Trabajá igual, pero mencioná en cada "situacionActual" solo lo que verifiques vos.' : ''}

═══ CÓMO TRABAJAR ═══
1. Búsqueda web: hasta 15 búsquedas, todas para las posiciones. El panorama por driver ya está en PANORAMA.sectorial: no lo vuelvas a buscar. Buscá por posición lo propio de cada una (resultados, hechos relevantes, precio, TIR para bonos). Si dos posiciones comparten emisor o driver, agrupá la consulta. Abrir una página no cuenta como búsqueda.
2. Los eventos con fecha ya están en PANORAMA.agenda: no los repitas en las fichas.

${REGLAS_V3}
- Cada ficha tiene que ser coherente con PANORAMA.sectorial del driver de esa posición. Si encontrás algo que lo contradice, decilo explícitamente en "situacionActual".
- PRIORIDAD SI FALTA ESPACIO: primero las posiciones de mayor peso; las de menor peso pueden quedar fuera. "manuales" siempre va.

═══ DATOS DE LA APP ═══
CARTERA (resumen):
${j('cartera')}

POLÍTICA Y DESVÍOS POR POSICIÓN ("usdExcedente" = lo que sobra sobre el tope):
${j('politica')}
${j('fueraDePolitica')}

PANORAMA (lo que produjo la parte 1; "generadoEnISO" dice cuándo):
${j('panorama')}

POSICIONES MATERIALES (peso ≥ 2%, ${materiales.length}; "factor" = factor de riesgo según la app):
${j('materiales')}

POSICIONES MENORES (0,5%–2%, ${menores.length}) — una nota solo si hay novedad relevante:
${j('menores')}

POSICIONES MANUALES (precio a actualizar):
${j('manuales')}

═══ QUÉ DEVOLVER ═══
1) "posiciones":
   - "analisis": una entrada por posición MATERIAL, en orden de peso, máx. 130 palabras por resultado (sin contar fuentes):
       queEs (1 frase); situacionActual (2-3 frases con info de hoy); riesgos (2); rolEnCartera (1 frase: qué aporta o qué concentra, usando "factor" y los desvíos de política); queHariaEnCadaCaso (2 casos condicionales; OJO: acá la clave de las opciones es "acciones", no "opciones"); fuentes (≤ 2 URLs).
   - "notas": para posiciones MENORES, una línea SOLO si hay una novedad relevante; si no, se omite.
2) "manuales": último cierre verificado de cada posición manual; valorUsd = cantidad × precioUnitarioUsd. Si no se verifica → null en precio y valor.

═══ FORMATO ═══
Respondé ÚNICAMENTE con UN bloque \`\`\`json, sin texto afuera ni comentarios adentro, con esta forma exacta:
{
  "posiciones": {
    "analisis": [{ "ticker": "…", "resultado": { "queEs": "…", "situacionActual": "…", "riesgos": ["…", "…"], "rolEnCartera": "…", "queHariaEnCadaCaso": [{ "caso": "…", "acciones": ["…", "…"], "costo": "…" }], "fuentes": ["…"] } }],
    "notas": [{ "ticker": "…", "nota": "…" }]
  },
  "manuales": [{ "id": "…", "ticker": "…", "precioUnitarioUsd": 0, "valorUsd": 0, "fechaPrecio": "YYYY-MM-DD", "fuente": "…" }]
}
${CIERRE_V3}`;
}

/** F9.194 — despacho por parte. Sin `parte` (bundle de F9.191) se trata como estrategia. */
export function buildPromptV3(contexto: Record<string, unknown>): string {
  return contexto['parte'] === 'posiciones' ? buildPromptPosicionesV3(contexto) : buildPromptEstrategiaV3(contexto);
}

/**
 * F9.191 — extracción tolerante del JSON pegado. Orden: el primer bloque ```json que parsee; si
 * ninguno parsea solo, la concatenación de todos los bloques (respuesta partida en dos mensajes con
 * "seguí", herencia de v2); por último, el primer objeto `{…}` del texto. null si nada parsea.
 */
export function extraerJson(rawText: string): unknown {
  // Loop con exec y no matchAll: no depende del `lib` del tsconfig de functions.
  const re = /```json\s*([\s\S]*?)\s*```/g;
  const bloques: string[] = [];
  for (let m = re.exec(rawText); m !== null; m = re.exec(rawText)) bloques.push(m[1]);
  const intentar = (t: string): unknown => { try { return JSON.parse(t); } catch { return undefined; } };
  for (const b of bloques) {
    const r = intentar(b);
    if (r !== undefined) return r;
  }
  if (bloques.length > 1) {
    const r = intentar(bloques.join(''));
    if (r !== undefined) return r;
  }
  if (bloques.length === 0) {
    const m = rawText.match(/(\{[\s\S]*\})/);
    if (m) {
      const r = intentar(m[1]);
      if (r !== undefined) return r;
    }
  }
  return null;
}

/**
 * F9.191 — la ficha de posición lee `queHariaEnCadaCaso[].acciones`; el global y las oportunidades
 * usan `opciones`. Si un modelo unifica a `opciones` también en posiciones, se normaliza acá en vez
 * de perder el análisis. Muta y devuelve el mismo objeto.
 */
export function normalizarCasosPosicion(resultado: unknown): unknown {
  if (!resultado || typeof resultado !== 'object') return resultado;
  const casos = (resultado as Record<string, unknown>)['queHariaEnCadaCaso'];
  if (!Array.isArray(casos)) return resultado;
  for (const c of casos) {
    if (c && typeof c === 'object') {
      const o = c as Record<string, unknown>;
      if (!Array.isArray(o['acciones']) && Array.isArray(o['opciones'])) {
        o['acciones'] = o['opciones'];
        delete o['opciones'];
      }
    }
  }
  return resultado;
}

/** Validación fail-soft de "oportunidades" (v3). null = válido. Ausente = válido (respuesta v2). */
export function validarOportunidades(o: unknown): string | null {
  if (o === undefined) return null;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'oportunidades debe ser un objeto';
  const r = o as Record<string, unknown>;
  for (const k of ['faltantes', 'fondeo', 'tacticas']) {
    if (r[k] !== undefined && !Array.isArray(r[k])) return `oportunidades.${k} debe ser un array`;
  }
  if (!Array.isArray(r['faltantes']) || (r['faltantes'] as unknown[]).length === 0) {
    return 'oportunidades.faltantes vacío';
  }
  return null;
}
