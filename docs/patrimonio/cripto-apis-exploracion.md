# Exploración de las APIs cripto: Bitfinex y Nexo

- **Fecha de armado:** 2026-10-19
- **Fuente:** documentación pública oficial; nada de esto se probó en vivo con credenciales.
- **Spec:** [`docs/prompts/F9.196-acciones-stops-cartera-viva.md`](../prompts/F9.196-acciones-stops-cartera-viva.md) §0.b (el contexto de PPI está en §0).

## Cómo leer este documento

Ninguno de estos datos se confirmó en vivo. Cada dato lleva una de estas marcas:

| Marca | De dónde sale |
|---|---|
| **[doc]** | Según la doc, sin confirmar en vivo. Es la doc oficial del proveedor. |
| **[no oficial]** | Sale de una librería o guía de terceros, no de la doc oficial. Es solo un indicio, sin confirmar en vivo. |

Si una marca va en el título de una sección, vale para todo lo que hay debajo, salvo que una fila diga otra cosa.

---

# Parte A: Bitfinex API v2

### Fuentes leídas

Las bajé en versión Markdown agregando `.md` a la URL de readme.io. El contenido es el mismo que el de la página.

| # | URL | Resultado |
|---|---|---|
| B1 | https://docs.bitfinex.com/docs/rest-auth | OK. Actualizada el 2025-10-14. |
| B2 | https://docs.bitfinex.com/docs/requirements-and-limitations | OK. Actualizada el 2025-06-10. |
| B3 | https://docs.bitfinex.com/docs/rest-general | OK |
| B4 | https://docs.bitfinex.com/docs/api-access | OK |
| B5 | https://docs.bitfinex.com/recipes/restpython-authenticated-request-example | OK |
| B6 | https://docs.bitfinex.com/recipes/restjavascript-authenticated-request-example | OK |
| B7 | https://docs.bitfinex.com/reference/rest-auth-wallets | OK |
| B8 | https://docs.bitfinex.com/reference/rest-auth-funding-credits | OK |
| B9 | https://docs.bitfinex.com/reference/rest-auth-funding-offers | OK |
| B10 | https://docs.bitfinex.com/reference/rest-auth-ledgers | OK |
| B11 | https://docs.bitfinex.com/reference/rest-auth-movements | OK. Actualizada el 2026-02-06. |
| B12 | https://docs.bitfinex.com/reference/rest-auth-trades | OK |
| B13 | https://docs.bitfinex.com/reference/rest-auth-trades-by-symbol | OK |
| B14 | https://docs.bitfinex.com/reference/key-permissions | OK |
| B15 | https://docs.bitfinex.com/reference/rest-auth-funding-loans | La bajé pero **no la volqué acá**. Ver la nota en A.4. |

## A.1 Dominio y forma de las URLs [doc]

- Las llamadas autenticadas van a `https://api.bitfinex.com` (B1, B3, B4).
  - El servidor de las OpenAPI de cada endpoint es `https://api.bitfinex.com/v2` (B7 a B14).
- Las públicas van a `https://api-pub.bitfinex.com` (B3, B4).
- La forma es `https://api.bitfinex.com/v2/<endpoint>/<pathParam>?queryParam=...` (B3).
- Los timestamps van "expressed in UTC and in milliseconds" (B3).
- Los símbolos van en mayúscula:
  - con prefijo `t` los pares de trading (`tBTCUSD`);
  - con prefijo `f` las monedas de funding (`fUSD`).
  - `btcusd` es inválido (B3).
- **Todos los endpoints `auth/r/*` de esta exploración son `POST`.** Lo dicen las OpenAPI de B7 a B14 (`"post": {...}`).
- Error de mantenimiento: `["error", 20060, "maintenance"]`. Según B3, algunos endpoints (por ejemplo `books`) lo devuelven durante el mantenimiento.

## A.2 Autenticación [doc]

Fuentes: B5 (Python) y B6 (JavaScript). B1 remite a ellas.

**Headers.** Hay que mandar los 3 en cada request (B5: "you must provide and attach the following triplet of headers"):

| Header | Contenido |
|---|---|
| `bfx-apikey` | El API-KEY. |
| `bfx-nonce` | El nonce, como string. |
| `bfx-signature` | La firma, en hex. |
| `Content-Type: application/json` | Cuando se manda body. B5: "If you are sending some POST data within the request, remember to also add the header". |

B5 aclara: "You must generate a unique triplet of headers before sending each of your HTTP requests."

**String a firmar:** path de la URL + nonce + JSON del body, si hay body.

- B5 (Python): `message = f"/api/v2/{endpoint}{nonce}"` y, si hay payload, `message += json.dumps(payload)`.
- B6 (JavaScript): `` `/api/${apiPath}${nonce}${JSON.stringify(body)}` `` con `apiPath = 'v2/auth/w/order/submit'`.
- O sea que el path firmado arranca en `/api/v2/...` aunque la URL real sea `https://api.bitfinex.com/v2/...`.

**Algoritmo:** HMAC-SHA384, con el API-SECRET como clave.

- B5: "signing this string using the HMAC-SHA384 algorithm"; "The starting key for the hash must be equal to your API-SECRET".
- Python: `hmac.new(key=API_SECRET.encode("utf8"), msg=message.encode("utf8"), digestmod=hashlib.sha384)`.

**Encoding de la firma:** hexadecimal. B5 usa `.hexdigest()` y B6 usa `.digest('hex')`. El texto de entrada va en UTF-8 (B5).

**Body vacío.** B5 solo agrega el JSON a la firma si hay payload. Las OpenAPI de los `auth/r/*` muestran `RAW_BODY` con default `"{}"` (B7, B14).

- *Inferencia, no está escrita en la doc:* el JSON firmado tiene que ser exactamente el string que se manda en el body. Si se manda `{}`, hay que firmar `{}`.
- La doc no dice qué pasa si se firma sin body pero se manda `{}`.

### Nonce [doc]

- **Estrictamente creciente.** B2: "The only requirement for the nonce is that it needs to be strictly increasing."
- B5: "Providing a nonce smaller than that of the last authentication attempt will cause an error to be thrown."
- B2: "The server will reject any request that comes with an incorrect nonce."
- **Tope de tamaño:** B2 dice "should not exceed the MAX_SAFE_INTEGER constant value of 9007199254740991".
- **Unidad:** la doc no fija una. Los ejemplos no coinciden:
  - B5 usa **milisegundos**: `round(datetime.now().timestamp() * 1_000)`. B5 recomienda "current milliseconds since Unix Epoch".
  - B6 usa **microsegundos**: `(Date.now() * 1000).toString()`.
  - Ojo con esto: si se arranca en µs y después se pasa a ms, el nonce baja y la API lo rechaza.
- **El nonce es por key.** B2: "Each API key has its own nonce requirements". Para usar varias conexiones en paralelo hay que crear una key por cliente (B2, B4).
- Cuál es el error exacto por nonce chico (código o texto): la doc no lo dice.

## A.3 Rate limits y bloqueo [doc]

- **General.** B2: "The current rate limit is between 10 and 90 requests per minute, depending on the specific REST API endpoint". B3 dice lo mismo.
- **Bloqueo de 60 s.** B2: "If an IP address is rate limited, the IP is blocked for 60 seconds and cannot make any requests during that time".
  - El bloqueo es **por IP**, no por key.
  - Respuesta: `{"error": "ERR_RATE_LIMIT"}` (B2).
  - El código HTTP de esa respuesta: la doc no lo dice.
- **Por endpoint:** todos los de esta exploración dicen **90 req/min** (filas en A.5).
- WebSocket (fuera de alcance): máximo 5 conexiones autenticadas cada 15 s en `wss://api.bitfinex.com`. Si se pasa, el bloqueo es de 15 s (B2).

## A.4 Permisos de la API key (solo lectura) [doc]

- La key se crea en https://setting.bitfinex.com/api#new-key (B2). B4 enlaza a https://www.bitfinex.com/api.
- B2: "If you only want to use your keys to view account data, selecting the 'read' permissions will suffice. If you also wish to use your API key to trade on your account or to request deposits and withdrawals, you will also need to check the appropriate 'write' permissions."
- La key se confirma por email. El secret se muestra **una sola vez** (B2).

**Matriz de permisos** (B4):

| Permiso | Read | Write |
|---|---|---|
| ACCOUNT INFO | ✓ | ✗ |
| ACCOUNT HISTORY | ✓ | ✗ |
| ORDERS | ✓ | ✓ |
| MARGIN TRADING | ✓ | ✓ |
| MARGIN FUNDING | ✓ | ✓ |
| WALLETS | ✓ | ✓ |
| WITHDRAW | ✗ | ✓ |

**Verificar los permisos de la key** con `POST /v2/auth/r/permissions` (B14), 90 req/min.

- Devuelve un array de `[SCOPE, READ, WRITE]`.
- SCOPE es uno de `'account', 'history', 'orders', 'positions', 'funding', 'settings', 'wallets', 'withdraw', 'ui_withdraw', 'bfxpay'`.
- READ y WRITE valen 0 o 1.
- Sirve para que el cliente rechace arrancar si alguna key tiene `WRITE = 1`.

Si una key de solo lectura rechaza `auth/w/*` y con qué error: la doc no lo dice explícitamente. Va a la lista de pendientes.

**Nota sobre funding (B8 y B15, descripciones de la doc):**

- `funding/credits` es "Funds used in active positions".
- `funding/loans` es "Funds not used in active positions" (descripción de B15 en el índice https://docs.bitfinex.com/llms.txt).
- Si se presta en Bitfinex, una parte de lo prestado podría figurar en **loans** y no en **credits**. La spec §0.b solo pide credits y offers. No volqué el detalle de `funding/loans`.

## A.5 Endpoints [doc]

Todos son POST a `https://api.bitfinex.com/v2/...` con los 3 headers de A.2. Los arrays de respuesta son **posicionales**. Los índices que no figuran en la tabla son `PLACEHOLDER` (valen `null` en los ejemplos).

### A.5.1 `POST /v2/auth/r/wallets` (B7)

- **Descripción:** "Returns an array of all the current user's wallets."
- **Body:** `{}`. No tiene parámetros.
- **Rate limit:** 90 req/min.
- **Respuesta:** array de wallets. Cada wallet:

| Índice | Campo | Tipo | Descripción (doc) |
|---|---|---|---|
| 0 | TYPE | string | Wallet name (exchange, margin, funding) |
| 1 | CURRENCY | string | Currency (e.g. USD, BTC, ETH, ...) |
| 2 | BALANCE | float | Balance |
| 3 | UNSETTLED_INTEREST | float | Unsettled interest |
| 4 | AVAILABLE_BALANCE | float | Wallet balance available for orders/withdrawal/transfer |
| 5 | LAST_CHANGE | string | Description of the last ledger entry |
| 6 | LAST_CHANGE_METADATA | JSON | Optional object with details |

Ejemplo (B7):

```text
[ [ "exchange", "UST", 19788.6529257, 0, 19788.6529257,
    "Exchange 2.0 UST for USD @ 11.696",
    { reason: "TRADE", order_id: 1189740779, order_id_oppo: 1189785673,
      trade_price: "11.696", trade_amount: "-2.0",
      order_cid: 1598516362757, order_gid: 1598516362629 } ], [...] ]
```

Si `AVAILABLE_BALANCE` puede venir `null` (pasa en otras APIs), la doc no lo dice.

### A.5.2 `POST /v2/auth/r/funding/credits/{Symbol}` (B8)

- **Descripción:** "Funds used in active positions".
- **Path:** `Symbol` (por ejemplo `fUSD`). B8: "Symbol (fUSD, ...), Omit for all symbols". Sin símbolo queda `/v2/auth/r/funding/credits`.
- **Body:** `{}`.
- **Rate limit:** 90 req/min.
- **Respuesta:** array de créditos. Cada crédito:

| Índice | Campo | Tipo | Descripción (doc) |
|---|---|---|---|
| 0 | ID | int | Loan ID |
| 1 | SYMBOL | string | The currency of the loan (fUSD, etc) |
| 2 | SIDE | int | 1 if you are the lender, 0 if both lender and borrower, -1 if borrower |
| 3 | MTS_CREATE | int | Millisecond Time Stamp when the loan was created |
| 4 | MTS_UPDATE | int | Millisecond Time Stamp when the loan was updated |
| 5 | AMOUNT | float | Amount of funds provided |
| 6 | FLAGS | object | Future params object |
| 7 | STATUS | string | Loan Status: ACTIVE |
| 8 | RATE_TYPE | string | "FIXED" or "VAR" (for FRR) |
| 9–10 | (placeholder) | — | — |
| 11 | RATE | float | Rate of the loan (1% = 0.01) |
| 12 | PERIOD | int | Period of the loan |
| 13 | MTS_OPENING | int | Millisecond Time Stamp for when the loan was opened |
| 14 | MTS_LAST_PAYOUT | int | Millisecond Time Stamp for when the last payout was made |
| 15 | NOTIFY | int | 0/1 |
| 16 | HIDDEN | int | 0/1 (en el ejemplo viene `null`) |
| 17 | (placeholder) | — | — |
| 18 | RENEW | int | 0/1 |
| 19 | (placeholder) | — | — |
| 20 | NO_CLOSE | int | If funding will be returned when position is closed (0/1) |
| 21 | POSITION_PAIR | string | Pair of the position that the funding was used for |

- Ejemplo (B8): `[[26222883,"fUST",1,1574013661000,1574079687000,350,null,"ACTIVE","FIXED",null,null,0.0024,2,1574013661000,1574078487000,0,null,null,0,null,0,"tBTCUST"]]`.
- **Unidad de `PERIOD`** (¿días?): la doc no lo dice.
- **`RATE`:** la doc dice que es un porcentaje expresado como decimal. Si es diario o anual, la doc no lo dice.

### A.5.3 `POST /v2/auth/r/funding/offers/{Symbol}` (B9)

- **Descripción:** "Get active funding offers. A path param can be used to retrieve offers in a particular currency. All offers are returned if no currency is specified." Sin símbolo queda `/v2/auth/r/funding/offers`.
- **Body:** `{}`.
- **Rate limit:** 90 req/min.
- **Respuesta:** array de ofertas. Cada oferta:

| Índice | Campo | Tipo | Descripción (doc) |
|---|---|---|---|
| 0 | ID | int | Offer ID |
| 1 | SYMBOL | string | The currency of the offer (fUSD, etc) |
| 2 | MTS_CREATED | int | ms timestamp de creación |
| 3 | MTS_UPDATED | int | ms timestamp de actualización |
| 4 | AMOUNT | float | Amount of the offer |
| 5 | AMOUNT_ORIG | float | Amount of the offer when it was first created |
| 6 | TYPE | string | "LIMIT, ..." |
| 7–8 | (placeholder) | — | — |
| 9 | FLAGS | object | Future params object |
| 10 | STATUS | string | Offer Status: ACTIVE, PARTIALLY FILLED |
| 11–13 | (placeholder) | — | — |
| 14 | RATE | float | Rate of the offer (1% = 0.01) |
| 15 | PERIOD | int | Period of the offer |
| 16 | NOTIFY | int | 0/1 |
| 17 | HIDDEN | int | null if false, 1 if true |
| 18 | (placeholder) | — | — |
| 19 | RENEW | int | 0/1 |
| 20 | (placeholder) | — | — |

- Ejemplo (B9): `[[652606505,"fETH",1574000611000,1574000611000,0.29797676,0.29797676,"LIMIT",null,null,0,"ACTIVE",null,null,null,0.0002,2,0,null,null,0,null]]`.
- Ojo: en el ejemplo FLAGS (índice 9) vale `0`, aunque la tabla dice "Object".

### A.5.4 `POST /v2/auth/r/ledgers/{Currency}/hist` (B10)

- **Descripción:** "View your past ledger entries… The endpoint returns data up to 6 years old."
- **Path:** `Currency` (por ejemplo `BTC`). Para todas las monedas: `/v2/auth/r/ledgers/hist`. B10: "The currency param can be omitted… The path for this call is 'v2/auth/r/ledgers/hist'".
- **Rate limit:** 90 req/min.

**Body:**

| Campo | Tipo | Descripción (doc) |
|---|---|---|
| `category` | int32 | Filtro por categoría (tabla abajo) |
| `start` | int64 | Millisecond start time |
| `end` | int64 | Millisecond end time |
| `limit` | int32 | Number of records (Max 2500) |
| `wallet` | string | Wallet name e.g. exchange, margin, funding |

**Respuesta:** array de asientos. Cada asiento:

| Índice | Campo | Tipo | Descripción (doc) |
|---|---|---|---|
| 0 | ID | int | Ledger identifier |
| 1 | CURRENCY | string | e.g. "BTC" |
| 2 | WALLET | string o null | 'exchange', 'margin', 'funding', 'contribution' |
| 3 | MTS | int | Timestamp in milliseconds |
| 4 | (placeholder) | — | — |
| 5 | AMOUNT | float | Amount changed |
| 6 | BALANCE | float | Balance after change |
| 7 | (placeholder) | — | — |
| 8 | DESCRIPTION | string | Description of ledger transaction |

Ejemplo (B10): `[[2531822314,"USD","margin",1573521810000,null,0.01644445,0,null,"Settlement @ 185.79 on wallet margin"]]`.

**Valores de `category`** (B10), con los que más importan para F9.196:

| Categoría | Valor |
|---|---|
| exchange | 5 |
| position modified/closed/liquidated | 22 |
| position claim | 23 |
| position transfer | 25 |
| position swap | 26 |
| position funding cost or interest charged | 27 |
| **margin / swap / interest payment** | **28** |
| derivatives funding event | 29 |
| settlement | 31 |
| **transfer** | **51** |
| **deposit** | **101** |
| **withdrawal** | **104** |
| canceled withdrawal | 105 |
| **trading fee** | **201** |
| trading rebate | 202 |
| hidden order fee | 204 |
| otc trade fee | 207 |
| swap fee | 222 |
| claiming fee | 224 |
| used margin funding charge | 226 |
| unused margin funding fee | 228 |
| earned fee / affiliate rebate | 241 |
| ETHFX loyalty fee | 243 |
| deposit fee | 251 |
| withdrawal fee | 254 |
| withdrawal express fee | 255 |
| miner fee | 258 |
| staking payment | 262 |
| adjustment | 401 |
| expense | 501 |
| currency conversion / computation fee | 905 |
| monthly profit payment | 907 |
| losses | 911 |

- El asiento **no trae la categoría** en la respuesta, solo `DESCRIPTION`. Para clasificar hay que filtrar con `category` en el body o parsear el texto.
- Que el interés cobrado por funding prestado sea la categoría 28 es una inferencia por el nombre. La doc no lo dice.

### A.5.5 `POST /v2/auth/r/movements/{Currency}/hist` (B11)

- **Descripción:** "View your past deposits/withdrawals. Currency can be specified to retrieve movements specific to that currency."
- **Path:** `Currency`. B11: "Currency param can be omitted to retrieve recent movements for all currencies". Sin moneda queda `/v2/auth/r/movements/hist`, por analogía con ledgers. B11 no escribe esa ruta explícitamente.
- **Rate limit:** 90 req/min.

**Body:**

| Campo | Tipo | Descripción (doc) |
|---|---|---|
| `start` | int64 | ms; solo registros con MTS_UPDATED >= start |
| `end` | int64 | ms; solo registros con MTS_UPDATED <= end |
| `limit` | int32 | Number of records (Max 2500) |
| `id` | array int32 | Optional array of deposit/withdrawal ids |
| `address` | string | Optional deposit address filter |

**Respuesta:** array de movimientos. Cada movimiento:

| Índice | Campo | Tipo (doc) | Descripción (doc) |
|---|---|---|---|
| 0 | ID | String (en el ejemplo es número) | Movement identifier |
| 1 | CURRENCY | String | ex. "BTC" |
| 2 | CURRENCY_NAME | String | ex. "BITCOIN" |
| 3–4 | (placeholder) | — | — |
| 5 | MTS_STARTED | Int | Movement started at |
| 6 | MTS_UPDATED | Int | Movement last updated at |
| 7–8 | (placeholder) | — | — |
| 9 | STATUS | String | Current status (en los ejemplos: `COMPLETED`, `CANCELED`) |
| 10–11 | (placeholder) | — | — |
| 12 | AMOUNT | String (en el ejemplo, `'0.26300954'`) | Positivo para depósitos, negativo para retiros |
| 13 | FEES | String | Tx Fees applied |
| 14–15 | (placeholder) | — | — |
| 16 | DESTINATION_ADDRESS | String | Destination address |
| 17 | PAYMENT_ID | String | Payment ID (if relevant) |
| 18–19 | (placeholder) | — | — |
| 20 | TRANSACTION_ID | String | Transaction identifier |
| 21 | WITHDRAW_TRANSACTION_NOTE | String | Optional personal withdraw transaction note |

- Ojo: según la doc, `AMOUNT` y `FEES` vienen como **string**, no como número.
- La lista completa de valores de STATUS: la doc no la da.

### A.5.6 `POST /v2/auth/r/trades/hist` y `POST /v2/auth/r/trades/{symbol}/hist` (B12, B13)

- **Descripción:** "Retrieve your trades. Your most recent trades will be retrieved by default, but a timestamp can be used…"
- **Path** (solo en B13): `symbol`, por ejemplo `tBTCUSD`.
- **Header:** `Content-Type: application/json` (`x-readme.headers` de B12 y B13).
- **Rate limit:** 90 req/min (los dos).

**Body:**

| Campo | Tipo | Descripción (doc) |
|---|---|---|
| `start` | int64 | MTS >= start (ms) |
| `end` | int64 | MTS <= end (ms) |
| `limit` | int32 | max. 2500 |
| `sort` | int32 | +1 ascendente / -1 descendente (por MTS) |

**Respuesta:** array de trades. Cada trade:

| Índice | Campo | Tipo | Descripción (doc) |
|---|---|---|---|
| 0 | ID | int | Trade database id |
| 1 | SYMBOL | string | Symbol (en el ejemplo, `"tETHUST"`) |
| 2 | MTS | int | Execution timestamp |
| 3 | ORDER_ID | int | Order id |
| 4 | EXEC_AMOUNT | float | Positivo = compra, negativo = venta |
| 5 | EXEC_PRICE | float | Execution price |
| 6 | ORDER_TYPE | string | Order type. No viene en los trades anteriores a marzo de 2020. |
| 7 | ORDER_PRICE | float | Order price |
| 8 | MAKER | int | 1 if true, -1 if false |
| 9 | FEE | float | Fee |
| 10 | FEE_CURRENCY | string | Fee currency |
| 11 | CID | int | Client Order ID |

Ejemplo (B12 y B13): `[[402088407,"tETHUST",1574963975602,34938060782,-0.2,153.57,"MARKET",0,-1,-0.061668,"USD",1234]]`.

Si sin `start`/`end` devuelve todo el historial o solo una ventana reciente, la doc no lo dice. Solo dice "most recent trades will be retrieved by default".

---

# Parte B: Nexo Pro

### Fuentes leídas

| # | URL | Resultado |
|---|---|---|
| N1 | https://pro.nexo.io/api-doc-pro | Redirige a `https://pro.nexo.com/api-doc-pro` y devuelve solo el shell de la SPA (3131 bytes, sin contenido sin JavaScript). **No pude leer una "Nexo Pro API" propiamente dicha.** El link lo cita una librería no oficial. |
| N2 | `https://pro.nexo.com/apiDocsPro.html`, `/apiDocPro.html`, `/api-doc`, `/api-docs`, `/apidocs` | Todas devuelven el mismo shell de 3131 bytes. No hay doc. |
| N3 | **https://pro.nexo.com/apiDocPrime.html** | **OK.** Es la doc Redoc titulada **"Nexo Prime API (v1)"**. Es el `iframe` de la ruta `/api-doc-prime` de la SPA de pro.nexo.com. Trae la OpenAPI embebida (servidor `https://prime-api.prime-nexo.net`). Último cambio en su changelog: V1.1.3, del 01.03.2023. |
| N4 | Wayback Machine (`pro.nexo.io/apiDocsPro.html`, `pro.nexo.io/api-doc-pro`, etc.) | No hay snapshots archivados. |
| N5 | https://github.com/aussedatlo/nexo-pro (README y `src/constant/api.ts`, `src/utils/rest.ts`) | OK. **[no oficial]** Su autor dice que no está afiliado a Nexo. |
| N6 | https://github.com/guilyx/python-nexo (`nexo/base_client.py`) | OK. **[no oficial]** |
| N7 | https://help.recap.io/en/articles/10768282-connecting-your-nexo-pro-account | OK. **[no oficial]** Es una guía de terceros. |
| N8 | https://www.cointracker.io/integrations/nexo | **Falló: HTTP 403 Forbidden.** |

**Advertencia importante:** la única doc oficial que pude leer es la de **Nexo Prime** (N3), servida desde el dominio de Nexo Pro.

- Que **Nexo Pro use la misma API** que Nexo Prime: **la doc no lo dice**. El indicio es que la SPA de pro.nexo.com es un único bundle (`prime_user_ui`) con un flag `isNexoPro`, y que solo trae doc para la ruta `/api-doc-prime`.
- Las librerías no oficiales para Nexo Pro (N5, N6) usan otra base, `https://pro-api.nexo.io`. Hoy la raíz de ese host responde HTTP 530.
- Pero firman exactamente como describe N3.

Todo lo que sigue es de N3 salvo que diga otra cosa.

## B.1 Base URL [doc, Nexo Prime]

| Uso | URL | Fuente |
|---|---|---|
| Producción | `https://prime-api.prime-nexo.net` | N3, "Environments" |
| WebSocket | `wss://prime-api.prime-nexo.net` (endpoint `/api/ws/v1`) | N3 |
| Base para Nexo Pro **[no oficial]** | `https://pro-api.nexo.io/api/v1` | N5 (`BASE_URL = 'https://pro-api.nexo.io/api'`). N6 usa `https://pro-api.nexo.io`. |

La doc no dice cuál es la base correcta para una cuenta Nexo Pro.

## B.2 Autenticación [doc, Nexo Prime]

**Headers** (N3, en cada endpoint):

| Header | Tipo | Descripción (doc) |
|---|---|---|
| `X-API-KEY` | string | The user API-Key |
| `X-NONCE` | integer int64 | "The millisecond timestamp of request creation." |
| `X-SIGNATURE` | string | "The generated HMAC signature" |

- **Algoritmo** (N3): "Authentication is carried out through an API-Key and a shared secret (API-Secret). The process itself involves HMAC Sha256 hashing to generate a signature on the client side and then compared to one generated with the same payload on the server side."
- **String a firmar.** Para REST, la doc no lo escribe. Para WebSocket dice "The signature is generated exactly like the one for REST", y el ejemplo Java de WebSocket hace:
  - `nonce = System.currentTimeMillis()`;
  - `Mac("HmacSHA256")` con clave `<API_SECRET>`;
  - `Base64.encode(mac.doFinal(Long.toString(nonce).getBytes(UTF_8)))`.
- Por inferencia: **firma = Base64(HMAC-SHA256(API_SECRET, str(nonce)))**. Solo se firma el nonce: ni path ni body. Las dos librerías no oficiales hacen exactamente eso: N5 usa `createHmac('sha256', secret).update(nonce.toString()).digest('base64')` y N6 usa `hmac.new(secret, str(nonce), sha256)`.
- **Nonce:** "millisecond timestamp of request creation". Si tiene que ser estrictamente creciente o si hay ventana de tiempo, la doc no lo dice.
  - Error `106 - Request nonce is malformed or invalid.` (N3).

## B.3 Roles de la API key [doc, Nexo Prime]

- N3: "TRADER - All endpoints including POST" / "**VIEWER - All GET endpoints**".
- Sin acceso devuelve `{"errorCode": 103, "errorMessage": "Access is denied."}`. En la lista de códigos, el 103 figura como "Unauthorized".
- La key se crea en "Nexo Pro → API Management": eso dice la spec §0.b. **[no oficial]** N7 (Recap) dice: "ensure that only the VIEWER role is selected". La doc oficial no describe la pantalla.

## B.4 Rate limits y errores [doc, Nexo Prime]

- N3: "For the REST API each API key has a default rate limit of **10 requests per second**. The limit is negotiable".
- Si se pasa: `{"errorCode": 301, "errorMessage": "Rate limit exceeded."}` con **HTTP 429**.

**Códigos de error** (N3):

| Código | Descripción |
|---|---|
| 100 | API-Key malformed/invalid |
| 101 | signature malformed/invalid |
| 102 | field malformed/missing |
| 103 | Unauthorized |
| 104 | WS method invalid |
| 105 | WS already authenticated |
| 106 | nonce malformed/invalid |
| 203 | No results found |
| 206 | Internal error |
| 300 | exchanges unsupported for pair |
| 301 | Rate limit exceeded |

## B.5 `GET /api/v1/accountSummary` [doc, Nexo Prime]

- **Descripción:** "Retrieves account balances." "Retrieves a list of available assets and their corresponding balances." Roles: **TRADER, VIEWER**.
- **Parámetros:** solo los 3 headers de B.2. `operationId: getAccountSummary`.

**Respuesta 200** ("Found balances."), schema `BalancesResponse` → `balances[]` de `WalletBalance`:

| Campo | Tipo |
|---|---|
| `assetName` | string |
| `totalBalance` | **string** |
| `availableBalance` | **string** |
| `lockedBalance` | **string** |

Ejemplo (N3):

```json
{"balances": [{"assetName": "NEXO", "totalBalance": "5000", "availableBalance": "3500", "lockedBalance": "1500"}]}
```

**Errores:**

- `400 Authentication failure.` con cuerpo `{"errorCode": 400, "errorMessage": "Authentication failure."}`.
- `500 No balances found.` con cuerpo `{"errorCode": 500, …}`. Ojo: "sin saldos" devuelve **500**, no una lista vacía.

## B.6 Indicios sobre si ve la cuenta Nexo principal [doc, Nexo Prime]

La doc **no dice** si `accountSummary` incluye los saldos de la cuenta Nexo principal (Earn flexible o a plazo). Lo que sí aparece en N3, y sugiere que **son dos cosas separadas**:

- Hay un endpoint aparte, `GET /api/v1/platform/balances`, descrito como "Retrieves **Nexo platform** balances".
  - Su respuesta solo trae `assetName` y `availableBalance` (string).
  - Ejemplo: `{"balances": [{"assetName": "NEXO", "availableBalance": "3500"}]}`.
  - **No lista los roles permitidos**: no dice si VIEWER puede llamarlo.
- Hay `POST /api/v1/deposit` ("Deposits balances **from Nexo platform**") y `POST /api/v1/withdraw` ("Withdraw balances **to Nexo platform**"). Son de escritura y quedan fuera de la lista blanca.
- Por estos nombres, "Nexo platform" sería la cuenta principal y `accountSummary` sería el saldo de la cuenta Pro/Prime. **Es una inferencia.** Si `platform/balances` distingue Earn flexible, a plazo o colateral, la doc no lo dice: solo da `availableBalance`.
- **[no oficial]** N7 (Recap) solo habla de "Nexo Pro" y no menciona Earn ni Savings.

**Conclusión:** la doc no lo dice. Es lo que hay que confirmar en vivo, y conviene probar también `platform/balances`.

---

## Lemon y Binance

- **Lemon:** no tiene API pública para usuarios. Es lo que dice la investigación previa del proyecto (F9.196 §0.b), y en esta búsqueda no encontré nada distinto.
  - Lo único que aparece, en directorios de terceros como https://apis.io/providers/lemon-cash/, es un "Mini App SDK" para que apps de terceros corran dentro de la app de Lemon. No es una API para leer la cuenta propia.
  - No lo confirmé en una fuente oficial de Lemon.
- **Binance:** no se integra, por decisión del proyecto.

---

## Pendiente con credenciales

### Bitfinex (key de solo lectura)

1. **Forma real de cada respuesta** de `auth/r/wallets`, `auth/r/funding/credits` (con y sin símbolo), `auth/r/funding/offers`, `auth/r/ledgers/hist` (y `/{Currency}/hist`), `auth/r/movements/hist` (y `/{Currency}/hist`) y `auth/r/trades/hist` (y `/{symbol}/hist`). En particular:
   - el largo real de cada array y si cambia algún índice;
   - si `AMOUNT`/`FEES` de movements vienen como string;
   - la unidad de `PERIOD` y si `RATE` es diaria;
   - qué categoría de ledger trae el interés cobrado por funding (¿28?);
   - si lo prestado aparece en `funding/credits`, en `funding/loans` o en los dos.
2. **Rate limit real:** cuántas llamadas por minuto aguanta antes de `ERR_RATE_LIMIT`, qué código HTTP devuelve y si de verdad bloquea la IP 60 s. No hay que probarlo desde la IP de producción de Cloud Functions sin cuidado, porque el bloqueo es por IP.
3. **Firma y nonce:** confirmar la firma con body `{}` y sin body. Fijar la unidad del nonce (ms o µs) y no cambiarla después. Ver qué error devuelve un nonce chico.
4. **Que la key de solo lectura rechace `auth/w/*`:** probar un endpoint de escritura inocuo y anotar el error. `auth/r/permissions` tiene que mostrar `WRITE = 0` en todos los scopes.

### Nexo

5. **Cuál es la API de Nexo Pro:** si la doc de Nexo Prime (N3, `prime-api.prime-nexo.net`) aplica a una cuenta Nexo Pro o si la base es `pro-api.nexo.io`, que es la de las librerías no oficiales.
6. **Si `accountSummary` ve la cuenta principal** (Earn flexible y a plazo) o solo Nexo Pro. Probar también `GET /api/v1/platform/balances` con la key VIEWER: si responde, qué trae y si distingue flexible de a plazo.
7. **Una key por cada una de las dos cuentas Nexo:** confirmar que cada cuenta genera su propia key VIEWER y que cada una ve solo lo suyo.
8. **Firma real:** confirmar que es Base64(HMAC-SHA256(secret, nonce)) sin path ni body. Ver si el nonce tiene que ser creciente o si hay ventana de tiempo, y qué devuelve una cuenta sin saldos (¿500?).
