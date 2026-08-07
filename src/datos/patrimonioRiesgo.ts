// F9.116 §2 — riesgo del portafolio: pérdida esperable por escenario, brecha contra la
// tolerancia declarada, bandas de concentración y mix objetivo. Módulo puro: sin Firestore,
// sin React, sin Date.now() — todo determinístico y verificable con scripts/verificarRiesgo.ts.
//
// UNIFICACIÓN (decisión del dueño al ejecutar el spec): los cuatro escenarios idiosincráticos
// que vivían dentro de vistas/Patrimonio.tsx (STRESS_ESCENARIOS + calcStress, consumidos por la
// solapa Plan y por el informe PDF) se movieron ACÁ tal cual y conviven con los cuatro
// sistémicos nuevos en un único registro. Hay un solo motor de escenarios en la app: dos
// motores darían dos números distintos para la misma pregunta en la misma pantalla.
//
// CONVENCIÓN DE UNIDADES: todo porcentaje de este módulo es una FRACCIÓN (0.20 = 20%), igual
// que el resto de las métricas de patrimonio (top1, hhi, cripto) y que el helper pct() de la
// UI. La conversión a números enteros pasa sólo en el borde del formulario de configuración.
import type { Posicion, PosicionManual } from '../types/patrimonio';
import { manualToPosicion } from './patrimonioMetricas';

// ── Bloques de riesgo ─────────────────────────────────────────────────────────
// El bloque es el DRIVER: lo que hace que un conjunto de posiciones se mueva junto en una
// crisis. Es la unidad de los shocks y de las betas.
export type Bloque = 'accionesAr' | 'accionesGlobal' | 'cripto' | 'soberanoAr' | 'rentaFijaPesos' | 'cash';

export const STABLECOINS = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD']);

export const BLOQUE_LABEL: Record<Bloque, string> = {
  accionesAr:     'Acciones AR',
  accionesGlobal: 'Acciones global',
  cripto:         'Cripto',
  soberanoAr:     'Soberano AR (USD)',
  // Agrupa la renta fija de beta baja: pesos AR y renta fija global. La beta de ambas es del
  // mismo orden; no se inventa un bloque nuevo sin fundamento para separarlas.
  rentaFijaPesos: 'Renta fija (pesos / global)',
  cash:           'Cash y stablecoins',
};

// F9.128 §1 — `moneda_origen` describe cómo viene expresada la FILA en el archivo de origen, no en
// qué moneda está denominado el INSTRUMENTO: el mismo GD30 aparece con USD en una cuenta y ARS en
// otra. Clasificar por ese campo manda soberanos hard-dollar a rentaFijaPesos y CER en pesos a
// soberanoAr — ~12% del invertible con la beta equivocada aplicada en cada escenario.
// La única señal confiable es el ticker. Va como tabla explícita y no como regex de prefijos para
// que se pueda leer, auditar y corregir sin desarmar una expresión regular.
export type Denominacion = 'hard' | 'pesos';

export const DENOMINACION_SOBERANO: Record<string, Denominacion> = {
  // Hard-dollar: soberanos ley extranjera/local en USD y Bopreal.
  GD30: 'hard', GD35: 'hard', GD38: 'hard',
  BPOC7: 'hard', BPOD7: 'hard',
  // Pesos: CER, Boncer, Discount en pesos y los FCI que los contienen.
  TX26: 'pesos', TZXM7: 'pesos', TZSU2: 'pesos',
  DICP: 'pesos', LECAPSA: 'pesos', BCAHA: 'pesos',
  // ON corporativa en dólares. Va acá porque esta tabla declara DENOMINACIÓN, no soberanía: TLCPO
  // está denominado en dólares y punto. Que el bloque resultante se llame `soberanoAr` es una
  // imprecisión conocida y provisional — ver el comentario de la rama en `bloqueDe`.
  // Sin esta entrada caía al fallback y terminaba en `rentaFijaPesos`, que es peor: un instrumento
  // en dólares clasificado como pesos.
  TLCPO: 'hard',
  // Medidos en la corrida 2026-07-17 (F9.128 §0). RV NO está acá a propósito: es un FCI de renta
  // variable, no renta fija, y no tiene denominación que declarar (lo resuelve F9.129).
  // Si un ticker de la corrida no está en la tabla, NO se inventa su denominación: cae en el
  // fallback y se reporta como inferida.
};

// Fallback SOLO para instrumentos que todavía no están en la tabla. Es una heurística sobre
// nomenclatura del mercado local, no una verdad: GD/AL/AE/BPO/BPY son ley extranjera o local en
// dólares; TX/TZX/DIC/PAR/LECAP/BONCER ajustan por CER o son a tasa en pesos.
//
// El default cae en `hard`, y esto CORRIGE al spec de F9.128, que pedía `pesos` justificándolo como
// el lado conservador. Era falso: `rentaFijaPesos` tiene beta 0,25 contra 0,40 de `soberanoAr`, y en
// `localAr` recibe −35% contra −40%, así que caer en `pesos` SUBESTIMA el riesgo. El principio que
// el propio spec declara —un sistema de riesgo tiene que fallar hacia el lado incómodo— le gana al
// argumento de probabilidad ("un AR sin identificar es más probablemente en pesos"), y además deja
// este default coherente con el de `BLOQUE_FCI`, que ya cae en el bloque de mayor beta. Dos defaults
// con filosofías opuestas en el mismo archivo es lo que se lee mal seis meses después.
// Toda inferencia se reporta igual en pantalla (§3): el default es la red, no el mecanismo.
// F9.129 — Un FCI es un envase: lo que define su riesgo es lo que tiene adentro, no el envase.
// `bloqueDe` los mandaba a todos por la rama de renta fija decidiendo por `moneda_origen`, así que
// un fondo de acciones argentinas (RV, USD 1.264) entraba a los escenarios con beta 0,25 en vez de
// 1,30 — un fondo de acciones pesando como un plazo fijo.
// A diferencia de F9.128, acá `sector` SÍ tiene la granularidad correcta y está poblado en los tres
// FCI de la corrida: el mapa se apoya en él y no en el ticker.
export const BLOQUE_FCI: Record<string, Bloque> = {
  renta_variable_ar:  'accionesAr',
  lecaps_pesos:       'rentaFijaPesos',
  cer_pesos:          'rentaFijaPesos',
  money_market_pesos: 'rentaFijaPesos',
  soberano_usd:       'soberanoAr',
  corporativo_usd:    'soberanoAr',   // mismo criterio que TLCPO en F9.128: se resuelve por factor
};

export function denominacionDe(ticker: string): { den: Denominacion; inferida: boolean } {
  const t = ticker.toUpperCase();
  const tabla = DENOMINACION_SOBERANO[t];
  if (tabla) return { den: tabla, inferida: false };
  if (/^(GD|AL|AE|BPO|BPY)\d/.test(t)) return { den: 'hard', inferida: true };
  if (/^(TX|TZX|TZ|DIC|PAR|LECAP|BONCER|S\d)/.test(t)) return { den: 'pesos', inferida: true };
  return { den: 'hard', inferida: true };
}

export function bloqueDe(p: Posicion): Bloque {
  if (p.tipo === 'cash') return 'cash';
  // Una stablecoin no es cripto a efectos de riesgo de mercado: se comporta como cash.
  if (p.tipo === 'cripto') return STABLECOINS.has(p.ticker) ? 'cash' : 'cripto';
  if (p.tipo === 'accion' || p.tipo === 'cedear') {
    return p.pais_riesgo === 'AR' ? 'accionesAr' : 'accionesGlobal';
  }
  // F9.128 §2 — bono / on con riesgo AR: la denominación sale del TICKER, no de `moneda_origen`.
  // Ver el comentario de DENOMINACION_SOBERANO: el mismo GD30 viene con USD en una cuenta y ARS en
  // otra, así que decidir por ese campo partía el mismo instrumento en dos bloques.
  //
  // Las ON corporativas en dólares (TLCPO) quedan en `soberanoAr` de forma PROVISIONAL. No son
  // soberanas y el bloque miente sobre lo que son; el criterio acordado es que la distinción
  // corporativo/soberano se resuelve en la capa de factores (F9.127), no acá, porque partir el
  // bloque solo para una posición de USD 379 agregaría una beta que nadie midió.
  if (p.pais_riesgo === 'AR' && (p.tipo === 'bono' || p.tipo === 'on')) {
    return denominacionDe(p.ticker).den === 'hard' ? 'soberanoAr' : 'rentaFijaPesos';
  }
  // F9.129 §1 — FCI: por subyacente, no por envase. Va ANTES de la rama de renta fija, que es la
  // que los venía clasificando por `moneda_origen`.
  // La condición de país es DELIBERADA y corrige el spec: éste daba por sentado que los FCI
  // globales "ya se resuelven antes en bloqueDe", y no es así — caen al `return 'rentaFijaPesos'`
  // del final. Sin acotar por AR, esta rama se los comería y los mandaría a `accionesAr` por el
  // default. Hoy no hay ninguno en la corrida, pero el primero que aparezca entraría mal.
  if (p.tipo === 'fci' && p.pais_riesgo === 'AR') {
    const b = BLOQUE_FCI[p.sector ?? ''];
    if (b) return b;
    // Sin sector reconocido no se adivina. Cae en el bloque de mayor beta a propósito: un
    // desconocido mal clasificado tiene que SOBREESTIMAR el riesgo, nunca esconderlo. Acá el
    // fundamento sí cierra —`accionesAr` es la beta más alta (1,30)—, al revés del fallback de
    // F9.128, donde el default cae en el bloque más benigno. Se reporta en la lista de §3.
    return 'accionesAr';
  }
  if (p.pais_riesgo === 'AR') return p.moneda_origen === 'USD' ? 'soberanoAr' : 'rentaFijaPesos';
  return 'rentaFijaPesos';
}

// F9.128 §3 — visibilidad de lo que se dio por sentado. No es un warning: es una línea que dice qué
// se infirió, para que un instrumento nuevo se vea antes de contaminar un escenario durante seis
// meses en silencio — que es exactamente lo que acaba de pasar con los CER en `soberanoAr`.
// Se deduplica por ticker: GD30 aparece en tres filas y sería tres veces la misma inferencia.
export type InferenciaBloque = { ticker: string; bloque: Bloque; motivo: string };

export function inferenciasDeBloque(posiciones: Posicion[]): InferenciaBloque[] {
  const vistos = new Map<string, InferenciaBloque>();
  for (const p of posiciones) {
    if (p.pais_riesgo !== 'AR') continue;
    if (p.tipo === 'bono' || p.tipo === 'on') {
      const { den, inferida } = denominacionDe(p.ticker);
      if (!inferida || vistos.has(p.ticker)) continue;
      vistos.set(p.ticker, {
        ticker: p.ticker,
        bloque: den === 'hard' ? 'soberanoAr' : 'rentaFijaPesos',
        motivo: 'denominación inferida del prefijo del ticker',
      });
    }
    // F9.129 — un FCI cuyo `sector` no está en BLOQUE_FCI cae al default y tiene que aparecer en
    // ESTA lista, no en una paralela: es la misma pregunta —"¿qué se dio por sentado acá?"— y dos
    // listas separadas harían que se lea una y se ignore la otra.
    if (p.tipo === 'fci' && !BLOQUE_FCI[p.sector ?? ''] && !vistos.has(p.ticker)) {
      vistos.set(p.ticker, {
        ticker: p.ticker,
        bloque: 'accionesAr',
        motivo: `FCI con sector "${p.sector ?? '(vacío)'}" no mapeado — default de mayor beta`,
      });
    }
  }
  return [...vistos.values()];
}

// ── Factores de riesgo (F9.127) ───────────────────────────────────────────────
// Factor de riesgo: qué mueve el precio, no qué instrumento es. `Bloque` responde "dónde está la
// plata"; `Factor` responde "qué la hace subir o bajar". Son ORTOGONALES: un bono soberano y una
// acción argentina son bloques distintos y el MISMO factor país, y por eso la cartera puede verse
// diversificada por bloque y ser una sola apuesta.
//
// El caso que motivó todo: `accionesAr` es un solo bloque, así que ninguna métrica sobre esa grilla
// puede ver que el 87,7% de la renta variable AR es energía. Y peor: el escenario `energia_ar`
// castiga a TRAN, TGSU2, CEPU, ECOG, YPFD, PAMP y VIST con el mismo −30%, cuando son dos factores
// distintos — las reguladas dependen de una decisión tarifaria, las de upstream del precio del
// crudo. Un congelamiento tarifario destroza a TRAN y apenas toca a VIST.
export type Factor =
  | 'energia_ar_regulada'    // transporte, distribución, generación: manda la tarifa
  | 'oil_gas'                // upstream: manda el precio del crudo y el gas
  | 'banco_ar'
  | 'industria_ar'
  | 'infraestructura_mercado'// BYMA y afines: manda el volumen operado
  | 'soberano_ar_hard'       // GD/BPO: manda el riesgo país
  | 'soberano_ar_pesos'      // LECAP/CER/TX: manda la tasa y la inflación
  | 'cripto'
  | 'global_dm'
  | 'cash'
  | 'sin_clasificar';

export const FACTOR_LABEL: Record<Factor, string> = {
  energia_ar_regulada:     'Energía AR regulada',
  oil_gas:                 'Oil & gas',
  banco_ar:                'Bancos AR',
  industria_ar:            'Industria AR',
  infraestructura_mercado: 'Infraestructura de mercado',
  soberano_ar_hard:        'Soberano AR hard-dollar',
  soberano_ar_pesos:       'Soberano AR pesos / CER',
  cripto:                  'Cripto',
  global_dm:               'Global desarrollado',
  cash:                    'Cash y stablecoins',
  sin_clasificar:          'Sin clasificar',
};

// F9.127 — `sector` gana donde alcanza. Decisión del dueño tras la auditoría §0: el vocabulario de
// `sector` es limpio para bancos/materiales/agro, y sostener esos tres en un mapa de tickers sería
// mantenimiento manual sin ganancia.
const FACTOR_POR_SECTOR: Record<string, Factor> = {
  bancos:      'banco_ar',
  materiales:  'industria_ar',
  // `agro` no tiene factor propio: BIOX entra al balde de industria. Es un balde declarado, no un
  // default silencioso — si algún día pesa, se le abre factor.
  agro:        'industria_ar',
  telecom:     'industria_ar',
  tech:        'industria_ar',
};

// F9.127 — y NO alcanza para energía: `sector: 'energia'` cubre por igual reguladas y upstream, que
// es justo la distinción que este módulo existe para hacer. Para esos tickers el mapa NO es un
// override, es la fuente primaria.
// Condición dura decidida por el dueño: un ticker con `sector: 'energia'` que NO esté acá va a
// `sin_clasificar` y aparece en pantalla. Nunca a un default plausible — una posición mal
// clasificada en silencio es peor que una sin clasificar a la vista, y adivinar acá sería el bug de
// F9.122 §3 en otra forma.
export const FACTOR_ENERGIA: Record<string, Factor> = {
  YPFD:  'oil_gas',
  VIST:  'oil_gas',
  PAMP:  'oil_gas',                // ambiguo, ver FACTOR_AMBIGUO
  TRAN:  'energia_ar_regulada',
  TGSU2: 'energia_ar_regulada',
  CEPU:  'energia_ar_regulada',
  ECOG:  'energia_ar_regulada',
};

// F9.127 — tickers cuya exposición real se reparte entre dos factores. En v1 se les asigna el
// dominante y se los MARCA: la app tiene que decir "esto es una simplificación", no fingir
// precisión. Repartir el valorUsd entre factores es otro prompt si hace falta.
export const FACTOR_AMBIGUO: Record<string, { asignado: Factor; tambien: Factor; nota: string }> = {
  PAMP: {
    asignado: 'oil_gas',
    tambien: 'energia_ar_regulada',
    nota: 'Upstream de gas y generación eléctrica. Se asigna oil_gas por peso del negocio.',
  },
};

// Subyacente de FCI AR → factor. Mismo criterio que BLOQUE_FCI: el envase no define el riesgo.
const FACTOR_FCI: Record<string, Factor> = {
  lecaps_pesos:       'soberano_ar_pesos',
  cer_pesos:          'soberano_ar_pesos',
  money_market_pesos: 'soberano_ar_pesos',
  soberano_usd:       'soberano_ar_hard',
  corporativo_usd:    'soberano_ar_hard',
  // `renta_variable_ar` NO está acá a propósito: un fondo de acciones argentinas es varios factores
  // a la vez, no uno. Cae en `sin_clasificar` y se ve en pantalla, que es la respuesta honesta.
};

export type ResultadoFactor = { factor: Factor; ambiguo: boolean };

/**
 * F9.127 — resuelve el factor de una posición. El ORDEN importa:
 *   1. override manual por ticker (colección `factoresTicker`) — gana siempre
 *   2. cripto / cash por tipo
 *   3. no-AR → global_dm
 *   4. renta fija AR → por denominación declarada (la tabla de F9.128, no `moneda_origen`)
 *   5. renta variable AR → `sector`, y energía por el mapa de tickers
 *   6. nada resolvió → sin_clasificar
 */
export function factorDe(p: Posicion, overrides: Record<string, Factor> = {}): ResultadoFactor {
  const amb = FACTOR_AMBIGUO[p.ticker];
  const ambiguo = !!amb;

  // 1. El override manual le gana a toda heurística: es el único lugar donde se resuelven los casos
  //    que la app no puede deducir.
  const ov = overrides[p.ticker];
  if (ov) return { factor: ov, ambiguo };

  // 2.
  if (p.tipo === 'cash') return { factor: 'cash', ambiguo };
  if (p.tipo === 'cripto') return { factor: STABLECOINS.has(p.ticker) ? 'cash' : 'cripto', ambiguo };

  // 3.
  if (p.pais_riesgo !== 'AR') return { factor: 'global_dm', ambiguo };

  // 4. Renta fija AR. El criterio de moneda sale de la tabla declarada de F9.128 y NO de
  //    `moneda_origen`, que describe la fila y no el instrumento.
  if (p.tipo === 'bono' || p.tipo === 'on') {
    const { den } = denominacionDe(p.ticker);
    return { factor: den === 'hard' ? 'soberano_ar_hard' : 'soberano_ar_pesos', ambiguo };
  }
  if (p.tipo === 'fci') {
    const f = FACTOR_FCI[p.sector ?? ''];
    return { factor: f ?? 'sin_clasificar', ambiguo };
  }

  // 5. Renta variable AR.
  if (p.tipo === 'accion' || p.tipo === 'cedear') {
    if (p.sector === 'energia') {
      // Sin entrada en el mapa NO se adivina, aunque el sector sea inequívoco.
      return { factor: FACTOR_ENERGIA[p.ticker] ?? 'sin_clasificar', ambiguo };
    }
    const f = FACTOR_POR_SECTOR[p.sector ?? ''];
    return { factor: f ?? 'sin_clasificar', ambiguo };
  }

  // 6.
  return { factor: 'sin_clasificar', ambiguo };
}

// ── Custodia y contraparte (F9.130) ───────────────────────────────────────────
// TERCER eje, ortogonal a los otros dos. Las tres preguntas: `Bloque` dice **dónde está la plata**,
// `Factor` dice **qué la mueve**, `Custodia` dice **quién te la tiene que devolver**. Un mismo
// activo cambia de riesgo según esto: 1 ETH en una billetera propia y 1 ETH prestado en una
// plataforma tienen idéntico riesgo de precio y riesgo de contraparte incomparable.
//
// Por qué hace falta: los 12 escenarios de F9.127 modelan movimientos de PRECIO. El escenario
// `cripto` aplica −50% a ETH/BTC/AAVE/UNI — el activo sigue siendo tuyo y vale menos. Si esos
// tokens están en una plataforma de lending, el colapso de la plataforma no es −50%: es −100% de lo
// que esté ahí, haga lo que haga el precio. No es un shock más grande, es otro tipo de evento.
export type Custodia =
  | 'propia'          // llaves o efectivo propios: sin contraparte
  | 'segregada'       // broker/caja de valores: el título está a tu nombre
  | 'credito'         // lending, staking con terceros, saldo en exchange: sos acreedor
  | 'emisor'          // stablecoin: crédito contra quien lo emite
  | 'sin_declarar';

export const CUSTODIA_LABEL: Record<Custodia, string> = {
  propia:       'Propia',
  segregada:    'Segregada',
  credito:      'Crédito contra la plataforma',
  emisor:       'Crédito contra el emisor',
  sin_declarar: 'Sin declarar',
};

export const esCreditoCustodia = (c: Custodia): boolean => c === 'credito' || c === 'emisor';

/**
 * F9.130 §1 — custodia de una posición. El override manual (colección `custodiaCuenta/{cuenta}`)
 * gana siempre, y **nada cae a un default plausible**.
 *
 * Acá esa regla importa más que en ningún otro lado de la serie: dar por sentado `propia` sobre una
 * posición que en realidad es un crédito esconde exactamente el riesgo que este eje existe para
 * mostrar. Si no se sabe, se dice que no se sabe — y la card lo muestra.
 *
 * La ÚNICA excepción es el stablecoin, y no es una inferencia sino una definición: un USDT es un
 * pasivo de quien lo emite, esté donde esté. Eso no depende de cómo tenga el usuario su cuenta.
 */
export function custodiaDe(p: Posicion, overrides: Record<string, Custodia> = {}): Custodia {
  const ov = overrides[p.cuenta ?? ''];
  if (ov) return ov;
  if (p.tipo === 'cripto' && STABLECOINS.has(p.ticker)) return 'emisor';
  return 'sin_declarar';
}

// F9.130 §2 — el denominador va declarado, como en F9.122.1 §B.
export type ExposicionContraparte = {
  contraparte: string;        // valor de `cuenta`: la plataforma / broker
  custodia: Custodia;
  usd: number;
  pctInvertible: number;
  tickers: string[];
  esCredito: boolean;         // la CUENTA está declarada como crédito
  usdCredito: number;         // USD dentro de la cuenta clasificados como crédito por posición
};

export function exposicionContraparte(
  posiciones: Posicion[],
  overrides: Record<string, Custodia> = {},
): {
  porContraparte: ExposicionContraparte[];
  creditoUsd: number;          // 'credito' + 'emisor'
  creditoPct: number;
  mayor: ExposicionContraparte | null;   // la mayor exposición a UNA sola contraparte de crédito
  sinDeclarar: { usd: number; contrapartes: string[] };
} {
  const total = posiciones.reduce((s, p) => s + p.valorUsd, 0);

  // Agrupa por cuenta y suma por ticker dentro de cada una, mismo criterio que F9.127: sumar filas
  // repetiría el ticker cuando hay dos posiciones del mismo papel en la misma cuenta.
  const grupos = new Map<string, { usd: number; usdCredito: number; tickers: Map<string, number> }>();
  for (const p of posiciones) {
    const cuenta = p.cuenta || '(sin cuenta)';
    const g = grupos.get(cuenta) ?? { usd: 0, usdCredito: 0, tickers: new Map<string, number>() };
    g.usd += p.valorUsd;
    // El crédito se cuenta POR POSICIÓN, no por cuenta. Promover la cuenta entera a "crédito"
    // porque tiene un stablecoin adentro sería inferir que todo lo que hay ahí es un préstamo a
    // partir de un token: exactamente el default plausible que este eje prohíbe. Una cuenta es
    // crédito cuando alguien lo declaró, no cuando su composición lo sugiere.
    if (esCreditoCustodia(custodiaDe(p, overrides))) g.usdCredito += p.valorUsd;
    g.tickers.set(p.ticker, (g.tickers.get(p.ticker) ?? 0) + p.valorUsd);
    grupos.set(cuenta, g);
  }

  const porContraparte: ExposicionContraparte[] = [...grupos.entries()]
    .map(([contraparte, g]) => {
      const custodia = overrides[contraparte] ?? 'sin_declarar';
      return {
        contraparte,
        custodia,
        usd: g.usd,
        pctInvertible: total > 0 ? g.usd / total : 0,
        tickers: [...g.tickers.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
        esCredito: esCreditoCustodia(custodia),
        usdCredito: g.usdCredito,
      };
    })
    .sort((a, b) => b.usd - a.usd);

  const credito = porContraparte.filter(c => c.esCredito);
  // Suma de lo efectivamente clasificado como crédito, no del valor entero de las cuentas de
  // crédito: un stablecoin dentro de un broker segregado también es un crédito contra su emisor.
  const creditoUsd = porContraparte.reduce((s, c) => s + (c.esCredito ? c.usd : c.usdCredito), 0);
  const sinDecl = porContraparte.filter(c => c.custodia === 'sin_declarar');

  return {
    porContraparte,
    creditoUsd,
    creditoPct: total > 0 ? creditoUsd / total : 0,
    // Dos plataformas al 11% cada una es un riesgo distinto a una al 22%: el máximo individual es
    // el número que importa, no la suma.
    mayor: credito[0] ?? null,
    sinDeclarar: {
      usd: sinDecl.reduce((s, c) => s + c.usd, 0),
      contrapartes: sinDecl.map(c => c.contraparte),
    },
  };
}

// ── Betas por bloque ──────────────────────────────────────────────────────────
// Constantes documentadas, no estimadas de series (eso está fuera de alcance de F9.116).
// Referencia de la beta AR: marzo 2020, el Merval cayó ~34% en USD contra ~34% del S&P pico a
// piso, pero los nombres individuales cayeron mucho más — YPF −47,5%, GGAL −43,7%, BMA −40,4%.
export const BETA_DEFAULT: Record<Bloque, number> = {
  accionesAr:     1.30,
  cripto:         1.75,
  accionesGlobal: 1.00,
  soberanoAr:     0.40,
  rentaFijaPesos: 0.25,
  cash:           0.00,
};

// ── Escenarios ────────────────────────────────────────────────────────────────
export type ShockFn = (p: Posicion) => number;
export type FamiliaEscenario = 'sistemico' | 'idiosincratico';

export type Escenario = {
  id: string;
  nombre: string;
  descripcion: string;
  familia: FamiliaEscenario;
  shock: ShockFn;
};

// Shock por bloque → ShockFn. Los sistémicos se definen así: el driver manda, no el papel.
function porBloque(mapa: Partial<Record<Bloque, number>>): ShockFn {
  return p => mapa[bloqueDe(p)] ?? 0;
}

// Movimiento del mercado global × beta del bloque.
function porBeta(shockMercado: number): ShockFn {
  return p => shockMercado * BETA_DEFAULT[bloqueDe(p)];
}

// F9.127 §4 — análogo de porBloque, pero sobre la grilla de factores. Es lo que permite castigar a
// TRAN sin castigar a VIST, que con la grilla de bloques era imposible.
function porFactor(mapa: Partial<Record<Factor, number>>): ShockFn {
  return p => mapa[factorDe(p).factor] ?? 0;
}

// Sistémicos (F9.116). Un shock negativo es caída.
export const ESCENARIOS_SISTEMICOS: Escenario[] = [
  {
    id: 'global20',
    nombre: 'Corrección global −20%',
    descripcion: 'S&P −20%, cada bloque golpeado por su beta.',
    familia: 'sistemico',
    shock: porBeta(-0.20),
  },
  {
    id: 'crash2020',
    nombre: 'Crash tipo marzo 2020',
    descripcion: 'S&P −34%, acciones AR −44%, cripto −50%; renta fija por beta sobre el −34%.',
    familia: 'sistemico',
    // Los tres primeros son valores observados en marzo 2020; los de renta fija se derivan
    // con la beta del bloque sobre el mismo −34%, para no inventar un número suelto.
    shock: porBloque({
      accionesGlobal: -0.34,
      accionesAr:     -0.44,
      cripto:         -0.50,
      soberanoAr:     -0.34 * BETA_DEFAULT.soberanoAr,
      rentaFijaPesos: -0.34 * BETA_DEFAULT.rentaFijaPesos,
      cash:            0,
    }),
  },
  {
    id: 'localAr',
    nombre: 'Evento local AR',
    descripcion: 'Acciones AR −50%, soberano −40%, pesos −35%; global y cripto sin shock.',
    familia: 'sistemico',
    // Agosto 2019: la Bolsa cayó más de 57% en USD en un mes sin crisis global — el riesgo
    // local no necesita que el mundo acompañe.
    shock: porBloque({
      accionesAr:     -0.50,
      soberanoAr:     -0.40,
      rentaFijaPesos: -0.35,
      accionesGlobal:  0,
      cripto:          0,
      cash:            0,
    }),
  },
  {
    id: 'rally',
    nombre: 'Rally global +20%',
    descripcion: 'Simétrico de la corrección: S&P +20% por beta. El upside también se mide.',
    familia: 'sistemico',
    // Contrapeso deliberado: mostrar sólo el downside es información sesgada.
    shock: porBeta(0.20),
  },
];

// Idiosincráticos: los cuatro que ya existían en vistas/Patrimonio.tsx, movidos sin cambiar
// un solo shock. Son a nivel posición (sector, ticker), no por bloque.
export const ESCENARIOS_IDIOSINCRATICOS: Escenario[] = [
  {
    id: 'energia_ar',
    nombre: 'Corrección energía AR',
    descripcion: 'Acciones de energía argentina −30%. Superado por "Congelamiento tarifario" y '
      + '"Crudo a la baja" (F9.127), que separan reguladas de upstream; se conserva por '
      + 'comparabilidad histórica.',
    familia: 'idiosincratico',
    shock: p => (p.sector === 'energia' && p.pais_riesgo === 'AR' && p.tipo === 'accion' ? -0.30 : 0),
  },
  {
    id: 'cripto',
    nombre: 'Invierno cripto',
    descripcion: 'Cripto no-stablecoin −50%.',
    familia: 'idiosincratico',
    shock: p => (p.tipo === 'cripto' && !STABLECOINS.has(p.ticker) ? -0.50 : 0),
  },
  {
    id: 'soberano_ar',
    nombre: 'Evento soberano AR',
    descripcion: 'Todo lo argentino golpeado según su instrumento.',
    familia: 'idiosincratico',
    shock: p => {
      if (p.pais_riesgo !== 'AR') return 0;
      if (p.tipo === 'accion' || p.tipo === 'cedear') return -0.40;
      if (p.tipo === 'bono' || p.tipo === 'on') return -0.25;
      if (p.tipo === 'fci') return -0.30;
      return 0;
    },
  },
  {
    id: 'tormenta',
    nombre: 'Tormenta perfecta',
    descripcion: 'Evento soberano AR y invierno cripto a la vez.',
    familia: 'idiosincratico',
    shock: p => {
      let s = 0;
      if (p.pais_riesgo === 'AR') {
        if (p.tipo === 'accion' || p.tipo === 'cedear') s = -0.40;
        else if (p.tipo === 'bono' || p.tipo === 'on') s = -0.25;
        else if (p.tipo === 'fci') s = -0.30;
      }
      if (p.tipo === 'cripto' && !STABLECOINS.has(p.ticker)) s = -0.50;
      return s;
    },
  },
];

// F9.127 §4 — escenarios sobre la grilla de factores. Los cuatro anteriores NO se tocaron: shockean
// por `tipo`/`sector` y se conservan por comparabilidad histórica.
export const ESCENARIOS_POR_FACTOR: Escenario[] = [
  {
    id: 'tarifas',
    nombre: 'Congelamiento tarifario',
    descripcion: 'Reguladas −35%, upstream −10%. La decisión tarifaria golpea a TRAN, TGSU2, CEPU '
      + 'y ECOG; a las de upstream las toca de refilón, por arrastre de plaza.',
    familia: 'idiosincratico',
    shock: porFactor({ energia_ar_regulada: -0.35, oil_gas: -0.10 }),
  },
  {
    id: 'crudo_baja',
    nombre: 'Crudo a la baja',
    descripcion: 'Upstream −30%, reguladas −5%. El espejo del anterior: un crudo a 45 destroza a '
      + 'YPFD y VIST y casi no mueve a las reguladas, que cobran tarifa y no precio.',
    familia: 'idiosincratico',
    shock: porFactor({ oil_gas: -0.30, energia_ar_regulada: -0.05 }),
  },
  {
    id: 'normalizacion_ar',
    nombre: 'Normalización argentina',
    descripcion: 'Escenario POSITIVO: soberano hard +25%, bancos +40%, reguladas +30%, upstream '
      + '+15%. Hasta acá el único upside era el rally global; mostrar solo el downside de lo '
      + 'argentino, que es donde está la mitad de la cartera, es información sesgada.',
    familia: 'idiosincratico',
    shock: porFactor({
      soberano_ar_hard:    0.25,
      banco_ar:            0.40,
      energia_ar_regulada: 0.30,
      oil_gas:             0.15,
    }),
  },
  {
    id: 'nombre_unico',
    nombre: 'Nombre único −40%',
    descripcion: 'La mayor posición individual cae 40%. El ticker se calcula sobre la cartera del '
      + 'momento, no está fijo: hardcodearlo haría que el escenario mienta apenas cambie la cartera.',
    familia: 'idiosincratico',
    // El shock no puede ver el resto de la cartera, así que el mayor nombre se resuelve por
    // closure sobre las posiciones que se le pasen a calcEscenarios (ver `escenariosDe`).
    shock: () => 0,
  },
];

/**
 * F9.127 §4 — el escenario de nombre único depende de la cartera, así que no puede ser una
 * constante. `escenariosDe` devuelve el registro completo con ese escenario ya resuelto contra las
 * posiciones reales. Todo lo demás pasa igual.
 */
export function escenariosDe(posiciones: Posicion[], manuales: PosicionManual[] = []): Escenario[] {
  const todas = posicionesInvertibles(posiciones, manuales);
  const porTicker = new Map<string, number>();
  for (const p of todas) porTicker.set(p.ticker, (porTicker.get(p.ticker) ?? 0) + p.valorUsd);
  const mayor = [...porTicker.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return ESCENARIOS.map(e => {
    if (e.id !== 'nombre_unico') return e;
    return {
      ...e,
      nombre: mayor ? `Nombre único −40% (${mayor})` : e.nombre,
      shock: (p: Posicion) => (mayor && p.ticker === mayor ? -0.40 : 0),
    };
  });
}

export const ESCENARIOS: Escenario[] = [
  ...ESCENARIOS_SISTEMICOS,
  ...ESCENARIOS_IDIOSINCRATICOS,
  ...ESCENARIOS_POR_FACTOR,
];

/**
 * F9.130 §3 — escenarios de CONTRAPARTE. Deliberadamente **fuera** de `ESCENARIOS`.
 *
 * Un colapso de plataforma y una corrección global son eventos independientes y de probabilidad muy
 * distinta. Presentarlos en la misma lista ordenada por pérdida invita a leerlos como comparables,
 * y no lo son: la lista de precio responde "cuánto puede caer esto", ésta responde "qué pasa si no
 * me lo devuelven". La UI los muestra en sección aparte, con su propio encabezado.
 *
 * Dependen de la cartera (cuál es la mayor exposición de crédito), así que se construyen con los
 * datos, igual que `nombre_unico` de F9.127 §4.
 */
export function escenariosContraparteDe(
  posiciones: Posicion[],
  manuales: PosicionManual[] = [],
  overrides: Record<string, Custodia> = {},
): Escenario[] {
  const todas = posicionesInvertibles(posiciones, manuales);
  const { mayor } = exposicionContraparte(todas, overrides);

  return [
    {
      id: 'colapso_contraparte',
      nombre: mayor ? `Colapso de contraparte (${mayor.contraparte})` : 'Colapso de contraparte',
      descripcion: mayor
        ? `Pérdida del 100% de lo que está en ${mayor.contraparte}. No es un shock de precio: el `
          + `activo no vuelve, haga lo que haga el mercado.`
        : 'No hay ninguna posición declarada como crédito contra una contraparte, así que este '
          + 'escenario da 0. No significa que no haya riesgo: significa que la custodia todavía no '
          + 'se declaró — ver la card de contraparte.',
      familia: 'idiosincratico',
      shock: (p: Posicion) => (mayor && (p.cuenta || '(sin cuenta)') === mayor.contraparte ? -1 : 0),
    },
    {
      id: 'corrida_stablecoin',
      nombre: 'Corrida de stablecoin',
      descripcion: 'Stablecoins −40%. SUPUESTO, no dato: históricamente los depeg se recuperaron '
        + 'parcialmente (USDT 2022, USDC 2023), así que un −100% acá sería alarmismo y un −5% '
        + 'complacencia. El número es discutible y por eso está declarado.',
      familia: 'idiosincratico',
      shock: (p: Posicion) => (custodiaDe(p, overrides) === 'emisor' ? -0.40 : 0),
    },
  ];
}

// El titular de la brecha se mide contra este escenario: es el más comparable con "cuánta
// caída bancás", porque no depende de que se dé un evento argentino puntual.
export const ESCENARIO_TITULAR = 'global20';

// ── Cálculo ───────────────────────────────────────────────────────────────────
export type ContribucionBloque = {
  bloque: Bloque;
  nombre: string;
  valorUsd: number;
  perdidaUsd: number;   // negativo = pérdida
  aporteFrac: number;   // fracción de la pérdida total que aporta este bloque
};

export type ResultadoEscenario = {
  id: string;
  nombre: string;
  descripcion: string;
  familia: FamiliaEscenario;
  total: number;
  perdidaUsd: number;   // negativo = pérdida, positivo = ganancia (rally)
  perdidaPct: number;   // fracción sobre el total, mismo signo que perdidaUsd
  totalFinal: number;
  contribucion: ContribucionBloque[];
};

// Corrida + manuales: la lente invertible completa.
export function posicionesInvertibles(posiciones: Posicion[], manuales: PosicionManual[]): Posicion[] {
  return [...posiciones, ...manuales.map(manualToPosicion)];
}

// ── Concentración por factor (F9.127 §3) ──────────────────────────────────────
// La lección de F9.122.1 §B: un porcentaje sin denominador declarado induce a error. Acá se exponen
// los dos, siempre juntos, porque responden preguntas distintas.
export type ExposicionFactor = {
  factor: Factor;
  usd: number;
  pctInvertible: number;   // sobre el patrimonio invertible total
  pctBloque: number;       // sobre su propio bloque
  tickers: string[];
  ambiguos: string[];      // subconjunto marcado en FACTOR_AMBIGUO
};

// F9.127 — Exposición argentina agregada, atravesando bloques. Renta fija AR y renta variable AR no
// son dos apuestas: si Argentina repricea, se mueven juntas. La vista por bloque las presenta como
// diversificación y eso es una ilusión de encuadre.
//
// El HHI se calcula POR FACTOR y no por ticker a propósito: sobre los tickers de RV AR da ~0,17 y se
// lee como "diversificado", cuando el mismo dinero está apostado a dos o tres cosas.
const FACTORES_AR: Factor[] = [
  'energia_ar_regulada', 'oil_gas', 'banco_ar', 'industria_ar',
  'infraestructura_mercado', 'soberano_ar_hard', 'soberano_ar_pesos',
];

export function exposicionArgentina(
  posiciones: Posicion[],
  overrides: Record<string, Factor> = {},
): {
  usd: number;
  pctInvertible: number;
  porFactor: ExposicionFactor[];
  hhiFactor: number;
  nombresEfectivos: number;
  sinClasificar: { usd: number; tickers: string[] };
} {
  const total = posiciones.reduce((s, p) => s + p.valorUsd, 0);

  // Agregación POR TICKER, no por fila: PAMP y TRAN tienen dos posiciones cada uno y GD30 tres.
  // Sumar filas daría el mismo total pero listaría el ticker repetido y rompería el HHI.
  const porFactorMap = new Map<Factor, { usd: number; tickers: Map<string, number> }>();
  const usdPorBloque = new Map<Bloque, number>();

  for (const p of posiciones) {
    const { factor } = factorDe(p, overrides);
    const cur = porFactorMap.get(factor) ?? { usd: 0, tickers: new Map<string, number>() };
    cur.usd += p.valorUsd;
    cur.tickers.set(p.ticker, (cur.tickers.get(p.ticker) ?? 0) + p.valorUsd);
    porFactorMap.set(factor, cur);
    const b = bloqueDe(p);
    usdPorBloque.set(b, (usdPorBloque.get(b) ?? 0) + p.valorUsd);
  }

  // El bloque de referencia de un factor es aquel donde vive la mayor parte de su plata.
  const bloqueDeFactor = new Map<Factor, Bloque>();
  for (const p of posiciones) {
    const { factor } = factorDe(p, overrides);
    if (!bloqueDeFactor.has(factor)) bloqueDeFactor.set(factor, bloqueDe(p));
  }

  const porFactor: ExposicionFactor[] = [...porFactorMap.entries()]
    .map(([factor, v]) => {
      const bloque = bloqueDeFactor.get(factor);
      const usdBloque = bloque ? (usdPorBloque.get(bloque) ?? 0) : 0;
      const tickers = [...v.tickers.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
      return {
        factor,
        usd: v.usd,
        pctInvertible: total > 0 ? v.usd / total : 0,
        pctBloque: usdBloque > 0 ? v.usd / usdBloque : 0,
        tickers,
        ambiguos: tickers.filter(t => !!FACTOR_AMBIGUO[t]),
      };
    })
    .sort((a, b) => b.usd - a.usd);

  // El total argentino se mide por BLOQUE, no por pertenencia a FACTORES_AR. Si se midiera por
  // factor, una posición argentina sin clasificar quedaría fuera del titular y la card diría 66,3%
  // donde la vista por bloques dice 67,5% — dos respuestas a la misma pregunta en la misma
  // pantalla, que es justo lo que F9.122.1 §B decidió no volver a hacer. Lo que no se puede
  // atribuir a un factor sigue siendo exposición argentina; se cuenta, y se muestra aparte.
  const BLOQUES_AR: Bloque[] = ['accionesAr', 'soberanoAr', 'rentaFijaPesos'];
  const usdAr = posiciones
    .filter(p => BLOQUES_AR.includes(bloqueDe(p)))
    .reduce((s, p) => s + p.valorUsd, 0);

  // HHI sobre la apuesta argentina, normalizado dentro de Argentina: la pregunta es "cuán
  // concentrada está", no "cuánta Argentina hay" — eso lo dice pctInvertible. El bucket sin
  // clasificar entra al cálculo: es una exposición distinta de las demás, no un hueco.
  const usdArSinClas = posiciones
    .filter(p => BLOQUES_AR.includes(bloqueDe(p)) && factorDe(p, overrides).factor === 'sin_clasificar')
    .reduce((s, p) => s + p.valorUsd, 0);
  const cubos = [
    ...porFactor.filter(f => FACTORES_AR.includes(f.factor)).map(f => f.usd),
    ...(usdArSinClas > 0 ? [usdArSinClas] : []),
  ];
  const hhiFactor = usdAr > 0 ? cubos.reduce((s, v) => s + (v / usdAr) ** 2, 0) : 0;

  const sc = porFactorMap.get('sin_clasificar');
  return {
    usd: usdAr,
    pctInvertible: total > 0 ? usdAr / total : 0,
    porFactor,
    hhiFactor,
    nombresEfectivos: hhiFactor > 0 ? 1 / hhiFactor : 0,
    sinClasificar: {
      usd: sc?.usd ?? 0,
      tickers: sc ? [...sc.tickers.keys()] : [],
    },
  };
}

export function calcEscenarios(
  posiciones: Posicion[],
  manuales: PosicionManual[] = [],
  // F9.127 §4 — el default pasa por `escenariosDe` y no por `ESCENARIOS` a secas: el escenario de
  // nombre único se resuelve contra la cartera que se está midiendo. Con la constante pelada su
  // shock sería 0 siempre, o sea un escenario que dice "no pasa nada" — peor que no tenerlo.
  escenarios: Escenario[] = escenariosDe(posiciones, manuales),
): ResultadoEscenario[] {
  const todas = posicionesInvertibles(posiciones, manuales);
  const total = todas.reduce((s, p) => s + p.valorUsd, 0);

  return escenarios.map(e => {
    const porB = new Map<Bloque, { valorUsd: number; perdidaUsd: number }>();
    let perdidaUsd = 0;

    for (const p of todas) {
      const b = bloqueDe(p);
      const delta = p.valorUsd * e.shock(p);
      perdidaUsd += delta;
      const acc = porB.get(b) ?? { valorUsd: 0, perdidaUsd: 0 };
      acc.valorUsd += p.valorUsd;
      acc.perdidaUsd += delta;
      porB.set(b, acc);
    }

    const contribucion: ContribucionBloque[] = [...porB.entries()]
      .map(([bloque, v]) => ({
        bloque,
        nombre: BLOQUE_LABEL[bloque],
        valorUsd: v.valorUsd,
        perdidaUsd: v.perdidaUsd,
        aporteFrac: perdidaUsd !== 0 ? v.perdidaUsd / perdidaUsd : 0,
      }))
      // Mayor aporte primero (el que más pesa en el resultado, sea pérdida o ganancia).
      .sort((a, b) => Math.abs(b.perdidaUsd) - Math.abs(a.perdidaUsd));

    return {
      id: e.id, nombre: e.nombre, descripcion: e.descripcion, familia: e.familia,
      total,
      perdidaUsd,
      perdidaPct: total > 0 ? perdidaUsd / total : 0,
      totalFinal: total + perdidaUsd,
      contribucion,
    };
  });
}

export type Brecha = {
  brechaPct: number;   // cuánto excede la pérdida a la tolerancia, en fracción del total
  factor: number;      // pérdida / tolerancia (1.5 = perdés una vez y media lo que bancás)
  cumple: boolean;
};

// `perdidaPct` puede venir con signo (como sale de calcEscenarios); se compara en magnitud.
export function calcBrecha(perdidaPct: number, toleranciaPct: number): Brecha {
  const perdida = Math.abs(perdidaPct);
  const tol = Math.abs(toleranciaPct);
  return {
    brechaPct: perdida - tol,
    factor: tol > 0 ? perdida / tol : Infinity,
    cumple: perdida <= tol,
  };
}

// ── Mix objetivo ──────────────────────────────────────────────────────────────
export type MixObjetivo = {
  pesosObjetivo: Record<Bloque, number>;  // fracción del total por bloque, después del recorte
  ventaNecesariaUsd: number;
  upsideResignadoPct: number;             // fracción del total que se deja de ganar en el rally
};

// Recorta los bloques de mayor aporte a la pérdida —pasándolos a cash— hasta que el escenario
// dé exactamente la tolerancia. Devuelve también lo que ese recorte cuesta al alza: mostrar el
// recorte sin mostrar el upside resignado es información sesgada.
export function calcMixObjetivo(
  posiciones: Posicion[],
  manuales: PosicionManual[],
  toleranciaPct: number,
  escenarioId: string = ESCENARIO_TITULAR,
): MixObjetivo | null {
  const escenario = ESCENARIOS.find(e => e.id === escenarioId);
  if (!escenario) return null;

  const todas = posicionesInvertibles(posiciones, manuales);
  const total = todas.reduce((s, p) => s + p.valorUsd, 0);
  if (total <= 0) return null;

  // Valor y shock efectivo por bloque (promedio ponderado, porque dentro de un bloque los
  // escenarios idiosincráticos no golpean a todas las posiciones por igual).
  const valor = {} as Record<Bloque, number>;
  const perdida = {} as Record<Bloque, number>;
  const upside = {} as Record<Bloque, number>;
  for (const b of Object.keys(BLOQUE_LABEL) as Bloque[]) { valor[b] = 0; perdida[b] = 0; upside[b] = 0; }

  const rally = ESCENARIOS.find(e => e.id === 'rally')!;
  for (const p of todas) {
    const b = bloqueDe(p);
    valor[b] += p.valorUsd;
    perdida[b] += p.valorUsd * escenario.shock(p);
    upside[b] += p.valorUsd * rally.shock(p);
  }

  const perdidaActual = (Object.keys(valor) as Bloque[]).reduce((s, b) => s + perdida[b], 0);
  const objetivo = -Math.abs(toleranciaPct) * total;   // pérdida máxima admitida, negativa

  const recortado = { ...valor };
  let ventaNecesariaUsd = 0;
  let upsideResignadoUsd = 0;

  // Si ya cumple, no hay nada que vender.
  if (perdidaActual >= objetivo) {
    return {
      pesosObjetivo: fracciones(recortado, total),
      ventaNecesariaUsd: 0,
      upsideResignadoPct: 0,
    };
  }

  let faltante = objetivo - perdidaActual;   // positivo: cuánta pérdida hay que eliminar
  const orden = (Object.keys(valor) as Bloque[])
    .filter(b => b !== 'cash' && valor[b] > 0 && perdida[b] < 0)
    .sort((a, b) => perdida[a] - perdida[b]);   // el que más pierde, primero

  for (const b of orden) {
    if (faltante <= 0) break;
    // Pérdida por dólar de este bloque (magnitud) — mover un dólar a cash la elimina entera.
    const perdidaPorUsd = -perdida[b] / valor[b];
    if (perdidaPorUsd <= 0) continue;
    const usdNecesarios = faltante / perdidaPorUsd;
    const usdAMover = Math.min(usdNecesarios, recortado[b]);
    const fraccionMovida = usdAMover / valor[b];

    recortado[b] -= usdAMover;
    recortado.cash += usdAMover;
    ventaNecesariaUsd += usdAMover;
    upsideResignadoUsd += upside[b] * fraccionMovida;
    faltante -= usdAMover * perdidaPorUsd;
  }

  return {
    pesosObjetivo: fracciones(recortado, total),
    ventaNecesariaUsd,
    upsideResignadoPct: total > 0 ? upsideResignadoUsd / total : 0,
  };
}

function fracciones(valores: Record<Bloque, number>, total: number): Record<Bloque, number> {
  const out = {} as Record<Bloque, number>;
  for (const b of Object.keys(valores) as Bloque[]) out[b] = total > 0 ? valores[b] / total : 0;
  return out;
}

// ── Bandas ────────────────────────────────────────────────────────────────────
// Fracciones (0.20 = 20%). Ver la convención de unidades al tope del archivo.
export type TopesRiesgo = {
  toleranciaCaidaPct: number;
  topePosicionPct: number;
  topeDriverPct: number;
  pisoCajaPct: number;
};

export const RIESGO_DEFAULTS: TopesRiesgo = {
  toleranciaCaidaPct: 0.20,
  topePosicionPct:    0.08,
  topeDriverPct:      0.35,
  pisoCajaPct:        0.05,
};

export type ViolacionBanda = {
  tipo: 'posicion' | 'driver' | 'caja';
  nombre: string;
  actual: number;      // fracción del total
  tope: number;        // fracción del total (piso, en el caso de caja)
  excesoUsd: number;   // USD por encima del tope; en caja, USD que faltan para el piso
};

export function violacionesBandas(
  posiciones: Posicion[],
  manuales: PosicionManual[],
  topes: TopesRiesgo = RIESGO_DEFAULTS,
): ViolacionBanda[] {
  const todas = posicionesInvertibles(posiciones, manuales);
  const total = todas.reduce((s, p) => s + p.valorUsd, 0);
  if (total <= 0) return [];

  const out: ViolacionBanda[] = [];

  // Por posición: consolidada por ticker (el mismo papel en dos cuentas es una sola apuesta).
  const porTicker: Record<string, number> = {};
  for (const p of todas) porTicker[p.ticker] = (porTicker[p.ticker] ?? 0) + p.valorUsd;
  for (const [ticker, v] of Object.entries(porTicker)) {
    const actual = v / total;
    if (actual > topes.topePosicionPct) {
      out.push({ tipo: 'posicion', nombre: ticker, actual, tope: topes.topePosicionPct, excesoUsd: (actual - topes.topePosicionPct) * total });
    }
  }

  // Por driver: el bloque de riesgo, que es lo que se mueve junto en una crisis.
  const porDriver = {} as Record<Bloque, number>;
  for (const p of todas) porDriver[bloqueDe(p)] = (porDriver[bloqueDe(p)] ?? 0) + p.valorUsd;
  for (const [bloque, v] of Object.entries(porDriver) as [Bloque, number][]) {
    if (bloque === 'cash') continue;   // el cash tiene piso, no tope
    const actual = v / total;
    if (actual > topes.topeDriverPct) {
      out.push({ tipo: 'driver', nombre: BLOQUE_LABEL[bloque], actual, tope: topes.topeDriverPct, excesoUsd: (actual - topes.topeDriverPct) * total });
    }
  }

  // Caja: es un PISO, no un tope — la violación es quedarse corto.
  const caja = (porDriver.cash ?? 0) / total;
  if (caja < topes.pisoCajaPct) {
    out.push({ tipo: 'caja', nombre: BLOQUE_LABEL.cash, actual: caja, tope: topes.pisoCajaPct, excesoUsd: (topes.pisoCajaPct - caja) * total });
  }

  return out.sort((a, b) => b.excesoUsd - a.excesoUsd);
}
