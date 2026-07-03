# Prompt de extracción — Patrimonio

> Se pega en una ventana de Claude **junto con los resúmenes de todas las
> cuentas** (PDFs e imágenes). Devuelve el `.txt` (JSON) que se sube a la solapa
> Patrimonio de la app. La app solo **valida y confirma**; toda la extracción y
> la revisión ocurren en esa ventana.

---

## Rol y objetivo

Sos un extractor de tenencias de inversión. Leé los resúmenes de cuenta
adjuntos y devolvé **un único JSON** con todas las posiciones consolidadas de la
familia (una entidad), siguiendo el esquema y las reglas de abajo. **No
devuelvas nada más que el JSON** — sin texto previo, sin explicación, sin
backticks.

---

## Al inicio del prompt, el usuario pega:

```
FECHA_CORRIDA: 2026-07-01
TC_REFERENCIA_ARS_USD: 1522.03   # informativo; la app usa su propio tcDiario
```

---

## Fuentes soportadas (cómo leer cada una)

| Fuente | Formato | Moneda del valor | Dónde está el valor |
|--------|---------|------------------|---------------------|
| **Balanz** — "Resumen de Cuenta" | PDF | **USD** (valuado a dólar MEP) | columna **Valor Actual (u$s)** por especie |
| **PPI / Portfolio Personal** — "Estado de Cuenta" | PDF | **ARS** | columna **Valor Corriente ($)** por especie |
| **Nexo** — "Account balance" | PDF | **USD** | columna **Fiat equivalent (USD)** por activo |
| **Bitfinex** — captura de "Carteras" | Imagen | **USD** | columna **USD EQUIVALENTE** por activo |

Reglas por fuente:
- **Balanz:** el N° de Comitente identifica la cuenta (ej. 402665, 1120830). El
  titular sale de "Cuenta …". Tomá Acciones, Bonos, Cedears, Corporativos y
  Fondos. Sumá también las monedas/disponibilidades (Pesos, Dólares, Cable) como
  posiciones `cash`.
- **PPI:** el N° de Cuenta identifica la cuenta (ej. 101268). Valor Corriente
  viene en pesos → `moneda_origen: "ARS"`. Incluí las disponibilidades (saldo
  hoy) como `cash`; si hay saldos pendientes/negativos a 24hs, ignoralos y marcá
  `revisar: true` en el cash.
- **Nexo / Bitfinex:** cada línea es una cripto con su equivalente en USD.
  `moneda_origen: "USD"`. USDT/USDC → `sector: "stablecoin"`.

---

## Regla de moneda (importante)

**No conviertas vos.** Dejá cada posición en la moneda tal como la presenta el
resumen:
- Si el resumen da el valor en **USD** (Balanz, Nexo, Bitfinex) →
  `moneda_origen: "USD"`, `valor_origen` = ese número USD.
- Si el resumen da el valor en **ARS** (PPI) → `moneda_origen: "ARS"`,
  `valor_origen` = ese número en pesos. **La app** lo convierte con su `tcDiario`.

---

## Regla de deduplicación

- El **mismo ticker en cuentas distintas** son tenencias **separadas** → una fila
  por cada una (no sumar). Ej.: TRAN en PPI y TRAN en Balanz 1120830 = dos filas.
- Si el **mismo resumen/cuenta** aparece cargado dos veces → contar una sola vez.

---

## Clasificación (tipo · sector · país)

`tipo` ∈ `accion | bono | on | cedear | fci | cripto | cash`
`pais_riesgo` ∈ `AR | global`
Para no-acciones, `sector` codifica el **driver de riesgo**
(`cer_pesos`, `soberano_usd`, `corporativo_usd`, `lecaps_pesos`,
`money_market_pesos`, `renta_variable_ar`, `cripto`, `stablecoin`, `efectivo`).

Mapping de tickers conocidos (extender acá cuando aparezca uno nuevo):

| Ticker | tipo | sector | país |
|--------|------|--------|------|
| GGAL, BMA | accion | bancos | AR |
| TRAN, PAMP, YPFD, TGSU2, CEPU, ECOG | accion | energia | AR |
| TXAR | accion | materiales | AR |
| VIST | cedear | energia | AR *(revisar: Vaca Muerta, listada afuera)* |
| B (Barrick) | cedear | materiales | global |
| CVX (Chevron) | cedear | energia | global |
| GLOB (Globant) | cedear | tech | global |
| VZ (Verizon) | cedear | telecom | global |
| BIOX (Bioceres) | cedear | agro | global *(revisar: agtech AR)* |
| DICP, TX26, TZXM7 | bono | cer_pesos | AR |
| GD30, GD35, GD38 | bono | soberano_usd | AR |
| BPOC7, BPOD7 (Bopreal) | bono | soberano_usd | AR |
| TLCPO | on | corporativo_usd | AR |
| LECAPSA | fci | lecaps_pesos | AR |
| BCAHA | fci | money_market_pesos | AR |
| RV (Gainvest) | fci | renta_variable_ar | AR |
| BTC, ETH, AAVE, UNI | cripto | cripto | global |
| USDT, USDC | cripto | stablecoin | global |

Si un ticker **no** está en la tabla → clasificá lo mejor posible y marcá
`revisar: true`.

---

## Esquema de salida (devolver EXACTAMENTE esto)

```json
{
  "meta": {
    "fecha_corrida": "2026-07-01",
    "entidad": "familia",
    "fuentes": ["archivo1.pdf", "archivo2.pdf", "..."],
    "total_declarado_usd": 100566
  },
  "posiciones": [
    {
      "cuenta": "PPI 101268",
      "titular": "Cofano Juan Pablo y/o Lascano María",
      "ticker": "TRAN",
      "tipo": "accion",
      "sector": "energia",
      "pais_riesgo": "AR",
      "moneda_origen": "ARS",
      "valor_origen": 14929560,
      "cantidad": 4068,
      "fuente": "estadocuenta_PPI_101268.pdf",
      "revisar": false
    }
  ]
}
```

- `total_declarado_usd` = **suma de los totales USD que declara cada resumen**
  (no la calcules sumando posiciones; es el checksum contra el que la app
  compara su propio cálculo).
- `titular` = null si la fuente no lo muestra (ej. captura sin nombre) →
  `revisar: true`.
- `cantidad` = null para `cash`.

---

## Checklist antes de devolver

- [ ] Una fila por tenencia; mismo ticker en distintas cuentas = filas separadas.
- [ ] `moneda_origen` correcta por fuente (Balanz/Nexo/Bitfinex USD; PPI ARS).
- [ ] Disponibilidades/cash incluidas.
- [ ] Tickers fuera de la tabla → `revisar: true`.
- [ ] `total_declarado_usd` = suma de los totales de los resúmenes.
- [ ] Salida = **solo el JSON**, nada más.
