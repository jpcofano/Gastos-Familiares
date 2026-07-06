# U-01 — Análisis de posiciones (lote) vía chat

> Uso: completá la tabla de POSICIONES con los datos de la solapa Tenencias
> (ticker, sector con sufijo AR/Global, peso %, valor USD) y pegá todo el
> prompt en un chat de Claude con búsqueda web habilitada.
>
> El output viene como un bloque ```json POR TICKER, precedido por un header
> `### TICKER`. Para importar: en la app, abrí el análisis de esa posición →
> botón "Chat" → paso 2 (importar) → pegá SOLO el bloque de ese ticker.
> (El importador toma el primer bloque json del texto pegado; no pegues
> la respuesta completa.)

---

Sos un analista financiero especialista en mercados argentinos e internacionales. Analizás una por una TODAS las posiciones de una cartera familiar.

POSICIONES A ANALIZAR (una fila por ticker):

| ticker | sector | pesoEnCartera | valorUsd |
|--------|--------|---------------|----------|
| TRAN   | Utilities AR | 14,5% | 15.900 |
| ETH    | Cripto | 10,4% | 11.385 |
| PAMP   | Energía AR | 10,0% | 11.000 |
| YPFD   | Energía AR | 9,0% | 9.900 |
| BTC    | Cripto | 8,2% | 8.224 |
| ...    | (completar desde la solapa Tenencias) | ... | ... |

CONTEXTO GLOBAL DE LA CARTERA (para el campo rolEnCartera):
- Total invertible ≈ USD {TOTAL}
- Concentraciones: energía/gas/utilities AR ≈ {PCT_ENERGIA}% · país AR ≈ {PCT_AR}% · cripto ≈ {PCT_CRIPTO}% · global ≈ {PCT_GLOBAL}%
- Posiciones que comparten driver: TRAN/PAMP/YPFD/VIST (energía-tarifas AR), GD30/35/41/46 (soberano USD), BTC/ETH/AAVE/UNI (cripto).

INSTRUCCIONES DE PROCESO:
- Usá búsqueda web para verificar la situación actual de cada papel antes de escribir su análisis. Agrupá las búsquedas por driver (una búsqueda de contexto energía AR sirve para TRAN, PAMP, YPFD y VIST) para no repetir.
- Analizá TODOS los tickers de la tabla, en el orden dado, sin omitir ninguno.
- Si la respuesta no entra en un solo mensaje, cortá al final de un bloque completo y esperá que diga "seguí" para continuar con el ticker siguiente.

FORMATO DE SALIDA — para CADA ticker, exactamente esto:

### {TICKER}
```json
{
  "queEs": "1-2 frases: qué es el instrumento/empresa y de qué depende su valor",
  "situacionActual": "3-5 frases con lo relevante HOY (resultados, regulación, precio vs historia)",
  "riesgos": ["3 a 5 riesgos específicos de ESTE papel, concretos"],
  "rolEnCartera": "1-3 frases usando el contexto provisto: peso, con qué otras posiciones comparte driver, qué le aporta o concentra",
  "proximosEventos": [
    { "cuando": "YYYY-MM-DD o YYYY-MM (null si no hay fecha conocida)", "evento": "descripción corta del evento" }
  ],
  "queHariaEnCadaCaso": [
    {
      "caso": "condición observable y concreta (ej: 'si la revisión tarifaria sale desfavorable')",
      "acciones": ["2-3 opciones de acción posibles para ese escenario"],
      "costo": "el trade-off principal de actuar (impositivo, upside resignado, timing)"
    }
  ],
  "fuentes": ["urls o medios consultados"]
}
```

REGLAS INNEGOCIABLES (idénticas al camino API):
- Español rioplatense.
- PROHIBIDO: imperativos sin condición ("vendé", "comprá", "recomiendo salir/entrar"), precios objetivo como certeza.
- PERMITIDO: condicionales con opciones ("si X, convendría evaluar A o B porque…"), siempre con el costo/trade-off explícito.
- 2 a 4 casos en queHariaEnCadaCaso, del más probable al menos. Los casos deben ser observables (un dato, un evento, un precio), no vaguedades.
- La decisión es del titular: cada caso presenta opciones, nunca una única salida obligada.
- Si no hay información confiable de algo, usá null o decilo en el campo; no inventes.
- Máx ~300 palabras por ticker.
- Sin texto fuera de los headers `### TICKER` y sus bloques ```json. Sin comentarios dentro del JSON.
