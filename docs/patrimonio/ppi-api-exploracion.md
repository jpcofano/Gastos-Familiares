# Exploración de la API de PPI

- **Fecha de armado:** 2026-10-19
- **Fuente:** documentación pública oficial; nada de esto se probó en vivo con credenciales.
- **Spec:** [`docs/prompts/F9.196-acciones-stops-cartera-viva.md`](../prompts/F9.196-acciones-stops-cartera-viva.md) §0 (y §0.b para lo cripto).

## Cómo leer este documento

Ninguno de estos datos se confirmó en vivo. Cada dato lleva una de estas marcas:

| Marca | De dónde sale |
|---|---|
| **[doc]** | Según la doc, sin confirmar en vivo. Es la doc REST o la doc Python oficial (itatppi.github.io). |
| **[swagger]** | Según la doc, sin confirmar en vivo. Es la especificación OpenAPI pública del Swagger del sandbox, enlazada desde la doc REST. No hizo falta autenticarse para bajarla. |
| **[SDK]** | Según el SDK oficial `ppi_client` (código fuente, no la doc REST), sin confirmar en vivo. |
| **[ejemplo]** | Según el repo oficial de ejemplos `itAtPPI/ppi-connector-python`, que no es la doc REST. Sin confirmar en vivo. |

Si una marca va en el título de una sección, vale para todo lo que hay debajo, salvo que una fila diga otra cosa.

### Fuentes leídas

| # | URL | Resultado |
|---|---|---|
| D1 | https://itatppi.github.io/ppi-official-api-docs/api/documentacionRest/ | OK. Es la doc REST, "Version actual de API: 1.0". |
| D2 | https://itatppi.github.io/ppi-official-api-docs/api/documentacionPython/ | OK. Es la doc de la librería Python. |
| D3 | https://itatppi.github.io/ppi-official-api-docs/api/ejemploPython/ | OK |
| D4 | https://itatppi.github.io/ppi-official-api-docs/faq/ | OK |
| D5 | https://itatppi.github.io/ppi-official-api-docs/primerosPasos/credenciales/ | OK |
| D6 | https://itatppi.github.io/ppi-official-api-docs/ | OK. Es la portada. |
| S1 | https://clientapisbx.portfoliopersonal.com/swagger/index.html | OK. Es la Swagger UI, "API Clients". |
| S2 | https://clientapisbx.portfoliopersonal.com/swagger/1.0/swagger.json | OK. OpenAPI 3.0.1, `info.version` 1.0. Las rutas `/swagger/v1/swagger.json` y `/swagger/v1.0/swagger.json` dan **404**. |
| K1 | https://pypi.org/project/ppi-client/1.3.0/ (sdist `ppi_client-1.3.0.tar.gz`, subido el 2026-08-31) | OK. Se bajó y se leyó el código, no se instaló. |
| E1 | https://github.com/itAtPPI/ppi-connector-python/blob/master/runner.py | OK |
| G1 | https://github.com/itAtPPI/ppi-official-api-docs/commit/4b4fbbcb1605fd03a21184d788066a062977b354 | OK. Es el cambio de la URL del sandbox. |
| — | Colección de Postman (enlazada desde D1) | No la abrí: la doc dice que hay que hacerle *fork*, y eso requiere cuenta. |

---

## 1. Base URL

| Dato | Valor | Marca y fuente |
|---|---|---|
| Sandbox (host actual) | `https://clientapisbx.portfoliopersonal.com` | [doc] D1 (link "Swagger Sandbox"). |
| Sandbox (host viejo) | `https://clientapi_sandbox.portfoliopersonal.com`. Es el que figura en la spec F9.196 §0. | [doc] G1: el commit del **2026-10-19** ("se modifica la url de sandbox") cambió `clientapi_sandbox` por `clientapisbx` en `docs/api/documentacionRest.md`. |
| Producción | `https://clientapi.portfoliopersonal.com/api/` | **[SDK]** K1, `ppi_client/ppi_restclient.py`: `self.__API_BASE_URL = "https://clientapi.portfoliopersonal.com/api/"`. Con `sandbox=True` pasa a `https://clientapisbx.portfoliopersonal.com/api/`. **La doc REST no dice la URL de producción.** |
| Realtime (SignalR), producción | `wss://realtimeclientapi.portfoliopersonal.com/` | [SDK] K1, `ppi_restclient.py`. No hace falta para F9.196. |
| Realtime (SignalR), sandbox | `wss://realtimeclientapisbx.portfoliopersonal.com/` | [SDK] K1, `ppi_restclient.py`. |
| Patrón de ruta | `/api/{v}/<Controlador>/<Acción>`, con `{v}` = `1.0` | [doc] D1 ("Method: POST/api/{v}/Account/LoginApi"; "v: string, required, API Version, Path"). [swagger] S2: todas las rutas son `/api/1.0/...`. |
| Versión vigente | 1.0 | [doc] D1 ("Version actual de API: 1.0"). |

### Credenciales y requisitos [doc]

- Las credenciales son `ApiKey`, `ApiSecret`, `AuthorizedClient` y `ClientKey`. Según D1: "El AuthorizedClient y ClientKey de Sandbox(testing) los recibis en un email. Los productivos se encuentran dentro de tu cuenta en Gestiones -> Gestión de servicio API".
- Para usar el servicio hay que tener cuenta en PPI y "haber fondeado una vez con al menos AR$5.000 esa cuenta" (D4).
- [SDK] K1 (`ppi_api_client.py`): el SDK **no** le pide `AuthorizedClient` ni `ClientKey` al usuario. Usa valores fijos propios (`AuthorizedClient = 'API_CLI_PYTHON'` y una `ClientKey` para sandbox y otra para producción, que no copio acá). Al usuario solo le pide `ApiKey` y `ApiSecret` en `login_api(...)`. **Pendiente:** confirmar en vivo si nuestro cliente tiene que usar los `AuthorizedClient`/`ClientKey` propios que Juan saca de Gestiones, que es lo que dice la doc REST.

### Headers comunes

| Header | Cuándo | Marca y fuente |
|---|---|---|
| `AuthorizedClient` | En **todos** los endpoints. | [doc] D1, tabla "Parameters" de cada endpoint ("Headers", required). |
| `ClientKey` | En **todos** los endpoints. | [doc] D1, ídem. |
| `ApiKey` y `ApiSecret` | Solo en `LoginApi`. | [doc] D1, sección Login. |
| `Authorization: Bearer <accessToken>` | En todo lo que no es `LoginApi` ni `RefreshToken`. | **La doc REST no lo dice:** las tablas de D1 no lo listan. Sí aparece en [swagger] S2: `securitySchemes.Bearer` (`type: http`, `scheme: bearer`, `bearerFormat: JWT`), con `security: [{Bearer: []}]` global, y `LoginApi`/`RefreshToken` con `security: [{}]` (anónimos, `operationId` "AllowAnonymousOperation-…"). También en [SDK] K1 (`ppi_api_client.py`): `auth_headers.update({'Authorization': 'Bearer ' + self.token})`. |
| `Accept: application/json` y `Content-type: application/json` | En todos los requests. | [SDK] K1 (`ppi_restclient.py`). La doc no lo dice. |
| `x-tracking-id` y `User-Agent` | Los manda el SDK. | [SDK] K1. La doc no lo dice. No parece obligatorio, pero no está confirmado. |

---

## 2. `POST /api/1.0/Account/LoginApi`

Fuentes: [doc] D1 `#login` y [swagger] S2 `/api/1.0/Account/LoginApi`.

- **Descripción** [doc]: "Tries to log in with the given credentials. Returns a session token which is needed to use the API."
- **Body:** la doc no lo dice. Ni D1 ni S2 definen `requestBody`, y el SDK manda el POST sin body (`data=None`).

**Headers** [doc] D1:

| Nombre | Tipo | Requerido | Descripción (doc) |
|---|---|---|---|
| `AuthorizedClient` | string | sí | Authorized Client ID for the API |
| `ClientKey` | string | sí | Client Key for the API |
| `ApiKey` | string | sí | Api Key for the API |
| `ApiSecret` | string | sí | Api Secret for the API |

**Respuesta 200** [doc] D1. Viene envuelta en **array**:

```json
[
  {
    "creationDate": "2022-01-18T18:25:36.269Z",
    "expirationDate": "2022-01-18T18:25:36.269Z",
    "accessToken": "string",
    "expires": 0,
    "refreshToken": "string",
    "tokenType": "string"
  }
]
```

**Schema `Token`** [swagger] S2 `components.schemas.Token`:

| Campo | Tipo | Descripción (swagger) |
|---|---|---|
| `creationDate` | string date-time | Creation Date |
| `expirationDate` | string date-time | Expiration Date |
| `accessToken` | string, nullable | Access Token |
| `expires` | integer int32 | **"Seconds to expire"** |
| `refreshToken` | string, nullable | Token to refresh the session |
| `tokenType` | string, nullable | Token Type |

- **Unidad de `expires`:** según la Swagger son **segundos** ("Seconds to expire"). La doc REST D1 no dice la unidad.
- **Otras respuestas** [swagger] S2: `400 Bad Request` y `401 Unauthorized`, ambas de tipo `string`.
- **Contradicción a confirmar:** D1 y S2 dicen que la respuesta es un **array** de `Token`. Pero el SDK [SDK] K1 (`api/accounts.py`, `login_api`) la lee como **objeto**: `res['accessToken']`, `res['refreshToken']`.

### Qué pasa al vencer el token

- [doc] D1: "Recordá que cada un tiempo el token se vence y debes volver a pedir un token con endpoint de Refresh token."
- [doc] D4: el token tiene "una validez de tiempo limitado".
- **La doc no dice** cuánto dura el token ni qué código devuelve cuando vence.
- [SDK] K1 (`ppi_api_client.py`): si una llamada da **HTTP 401** y hay `refreshToken`, el SDK llama a `renew_token()` y reintenta, hasta 5 veces seguidas (`refreshedCant < 5`). Si el refresh falla 5 veces, vuelve a hacer `LoginApi` con `ApiKey`/`ApiSecret` (`login_ws()`). De ahí se puede inferir que el token vencido da 401, pero **no está confirmado**.

## 2.b `POST /api/1.0/Account/RefreshToken`

Fuentes: [doc] D1 `#refresh-token` y [swagger] S2.

- **Descripción** [doc]: "Tries to refresh the current session. Returns a new session token which is needed to continue using the API."
- **Headers** [doc]: `AuthorizedClient` (string, requerido) y `ClientKey` (string, requerido).
  - [SDK] K1 (`renew_token`) además manda `Authorization: Bearer <accessToken viejo>`. La doc no lo pide.
- **Body** [doc] D1: `{ "refreshToken": "string" }`. [swagger] S2, schema `LoginRefresh`: `refreshToken` es requerido.
- **Respuesta 200** [doc] D1: el mismo array de `Token` que `LoginApi` (ejemplo con `creationDate` 2022-01-18T19:47:00.054Z). Errores [swagger]: 400 y 401 (string).
- [SDK] K1: después del refresh guarda el **nuevo** `refreshToken` (`self.refreshToken = res.response['refreshToken']`). O sea que el refresh token rotaría en cada refresh. **Sin confirmar.**

---

## 3. `GET /api/1.0/Account/Accounts`

Fuentes: [doc] D1 `#accounts` y [swagger] S2.

- **Descripción** [doc]: "Retrieves all the available accounts and their officer for the current session."
- **Parámetros** [doc]: no tiene query. Solo los headers `AuthorizedClient` y `ClientKey`, más el Bearer según §1.

**Respuesta 200** [doc] D1:

```json
[
  {
    "accountNumber": "string",
    "name": "string",
    "officer": {
      "name": "string",
      "eMail": "string",
      "phone": "string"
    }
  }
]
```

**Schema `Account`** [swagger] S2. Trae 2 campos más que la doc:

| Campo | Tipo | Descripción (swagger) |
|---|---|---|
| `accountNumber` | string, nullable | Account Number. |
| `name` | string, nullable | Account Name. |
| `officer` | `Officer` {`name`, `eMail`, `phone`: string nullable} | Officer Information |
| `externalID` | string, nullable | External client account number. **No figura en D1.** |
| `owners` | array de `Contract` {`email`, `telephone`, `name`, `lastname`} | List of co-owners for the account. **No figura en D1.** |

- **Formato del número de cuenta:** la doc no lo dice. Solo dice que es `string`. Si viene "101268" o "PPI 101268" se confirma en vivo.
- [ejemplo] D3 y E1 toman `account_numbers[0]['accountNumber']` y lo pasan tal cual a los demás endpoints.

---

## 3.b `GET /api/1.0/Account/AvailableBalance?accountNumber=`

Fuentes: [doc] D1 `#available-balance` y [swagger] S2.

- **Descripción** [doc]: "Retrieves cash balance available for trading for the given account."
- **Query** [doc]: `accountNumber` (string, requerido). La Swagger no lo marca `required`.

**Respuesta 200** [doc] D1:

```json
[
  {
    "name": "string",
    "simbol": "string",
    "amount": 0,
    "settlement": "string"
  }
]
```

**Schema `Availability`** [swagger] S2:

| Campo | Tipo | Descripción (swagger) |
|---|---|---|
| `name` | string, nullable | Name of the currency |
| `symbol` | string, nullable | Symbol of the currency |
| `amount` | number double | Amount available of the currency |
| `settlement` | string, nullable | Settlement of the availability |

- **Contradicción:** la doc D1/D2 escribe **`simbol`** y la Swagger S2 escribe **`symbol`**. El código de ejemplo de D2, D3 y E1 lee `balance['symbol']`, así que lo más probable es `symbol`. **Sin confirmar.**
- Valores posibles de `name`, `symbol` y `settlement`: la doc no los dice. Para `settlement` ver §6, `Configuration/Settlements`.

---

## 4. `GET /api/1.0/Account/BalancesAndPositions?accountNumber=`

Fuentes: [doc] D1 `#balances-and-positions` y D2, [swagger] S2, [SDK] K1, [ejemplo] E1.

- **Descripción** [doc]: "Retrieves account balance and positions for the given account."
- **Query** [doc]: `accountNumber` (string, requerido).

### Lo que dice la doc REST: solo saldos, sin posiciones

[doc] D1 (la sección "Response Balances and Positions" de D2 es igual):

```json
[
  {
    "currency": "string",
    "availability": [
      {
        "name": "string",
        "simbol": "string",
        "amount": 0,
        "settlement": "string"
      }
    ]
  }
]
```

[swagger] S2 coincide. Respuesta 200 = array de `GroupedAvailability`:

- `currency`: string nullable, "Grouped currency name".
- `availability`: array de `Availability` (ver §3.b), "Account availability list".

**Ni D1 ni S2 documentan las posiciones.**

### Lo que sale del código de ejemplo oficial: hay posiciones

El código de D2 (doc Python), el de E1 y el docstring del SDK K1 ("Grouped availability and grouped instruments") leen la respuesta como **objeto** con dos claves:

```python
# [doc] D2 / [ejemplo] E1: así se usa la respuesta en el código oficial
for balance in balances_positions["groupedAvailability"]:
    for currency in balance['availability']:
        currency['name'], currency['settlement'], currency['symbol'], currency['amount']
for instruments in balances_positions["groupedInstruments"]:
    instruments['name']
    for instrument in instruments['instruments']:
        instrument['ticker'], instrument['price'], instrument['amount'],
        instrument['quantity'], instrument['collateralQuantity']   # estos dos, solo en E1
```

Forma inferida del código. **No hay un ejemplo JSON en ninguna doc. Sin confirmar en vivo:**

| Ruta | Tipo | Marca y fuente |
|---|---|---|
| `groupedAvailability[]` | array | [doc] D2 (código) y [ejemplo] E1 |
| `groupedAvailability[].availability[].{name, symbol, amount, settlement}` | igual que `Availability` | [doc] D2 (código) y [ejemplo] E1 |
| `groupedAvailability[].currency` | string | Inferido de S2 (`GroupedAvailability`). El código no lo lee. |
| `groupedInstruments[]` | array | [doc] D2 (código) y [ejemplo] E1 |
| `groupedInstruments[].name` | string (por ejemplo, ¿el tipo de instrumento?) | [doc] D2 (código). Qué contiene, la doc no lo dice. |
| `groupedInstruments[].instruments[].ticker` | la doc no lo dice | [doc] D2 (código) |
| `groupedInstruments[].instruments[].price` | la doc no lo dice | [doc] D2 (código) |
| `groupedInstruments[].instruments[].amount` | la doc no lo dice (¿valuación?) | [doc] D2 (código) |
| `groupedInstruments[].instruments[].quantity` | la doc no lo dice | [ejemplo] E1 |
| `groupedInstruments[].instruments[].collateralQuantity` | la doc no lo dice | [ejemplo] E1 |

Lo que **la doc no dice** de las posiciones:

- la moneda de cada posición;
- el tipo de instrumento a nivel de cada posición;
- si hay **costo promedio**: no aparece en ninguna fuente;
- si `amount` es la valuación (precio × cantidad);
- el plazo de los saldos.

Todo eso queda para confirmar en vivo.

---

## 5. `GET /api/1.0/Account/Movements?accountNumber=&dateFrom=&dateTo=`

Fuentes: [doc] D1 `#account-movements` y [swagger] S2.

- **Descripción** [doc]: "Retrieves movements for the given account between the specified dates."

**Query** [doc] D1:

| Nombre | Tipo | Requerido | Descripción (doc) |
|---|---|---|---|
| `accountNumber` | string | sí | Account number to retrieve movements |
| `dateFrom` | string ($date-time) | no | Start date to filter the retrieve movements |
| `dateTo` | string ($date-time) | no | Finish date to filter the retrieve movements |
| `ticker` | string | no | Ticker to filter the retrieve movements |

**Respuesta 200** [doc] D1:

```json
[
  {
    "agreementDate": "2022-01-19T14:32:51.776Z",
    "settlementDate": "2022-01-19T14:32:51.776Z",
    "currency": "string",
    "amount": 0,
    "price": 0,
    "description": "string",
    "ticker": "string",
    "quantity": 0,
    "balance": 0
  }
]
```

**Schema `Movement`** [swagger] S2:

| Campo | Tipo | Descripción (swagger) |
|---|---|---|
| `agreementDate` | string date-time | Agreement Date (concertación) |
| `settlementDate` | string date-time | Settlement Date (liquidación) |
| `currency` | string, nullable | Currency |
| `amount` | number double | Amount |
| `price` | number double | Price |
| `description` | string, nullable | Description of the movement |
| `ticker` | string, nullable | Ticker of the instrument |
| `quantity` | number double | Quantity |
| `balance` | number double | Balance |

- **Tipos de movimiento** (compra, venta, depósito, retiro, cupón, dividendo): **la doc no los dice.** No hay un campo de tipo; lo único que hay es `description` (texto libre).
- **Formato de las fechas que acepta el query:** la doc solo dice "$date-time". [SDK] K1 (`accounts.py`, `get_movements`) pasa objetos `datetime` de Python a `requests`, que los serializa como `2021-12-01 00:00:00`. Qué formato acepta el server se confirma en vivo.
- **Rango máximo y paginación:** la doc no lo dice.

---

## 6. `GET /api/1.0/MarketData/Current?Ticker=&Type=&Settlement=`

Fuentes: [doc] D1 `#current-market-data` y [swagger] S2.

- **Descripción** [doc]: "Search for current market data."

**Query** [doc] D1:

| Nombre | Tipo | Requerido | Descripción |
|---|---|---|---|
| `Ticker` | string | sí | Ticker of the instrument |
| `Type` | string | sí | Type of the instrument |
| `Settlement` | string | sí | Settlement |

- Mayúsculas en los nombres: [SDK] K1 (`constants.py`) usa los parámetros en minúscula (`MarketData/Current?ticker={0}&type={1}&settlement={2}`) y D1 los escribe con mayúscula. Si el server distingue mayúsculas, la doc no lo dice.

**Respuesta 200** [doc] D1. Es un **objeto**, no un array:

```json
{
  "date": "2022-02-24T12:31:04.581Z",
  "price": 0,
  "volume": 0,
  "openingPrice": 0,
  "max": 0,
  "min": 0
}
```

**Schema `InstrumentPrice`** [swagger] S2. Trae 3 campos que D1 no muestra:

| Campo | Tipo | Descripción (swagger) |
|---|---|---|
| `date` | string date-time | Date of the price |
| `price` | number double | Price of the instrument |
| `volume` | number double | Operated volume |
| `openingPrice` | number double | Opening price of the instrument |
| `max` | number double | Max price of the instrument |
| `min` | number double | Min price of the instrument |
| `previousClose` | number double | Previous close price. **No figura en D1.** |
| `marketChange` | number double | Market change between previous close and price. **No figura en D1.** |
| `marketChangePercent` | string, nullable (ojo: **string**) | Market change percent. **No figura en D1.** |

La respuesta no trae moneda. La doc no dice en qué moneda viene el precio.

### Valores válidos de `Type` y `Settlement`

El endpoint no lista los valores válidos. La doc los expone en endpoints de configuración:

- **`GET /api/1.0/Configuration/InstrumentTypes`** [doc] D1 `#instrument-types`: `"BONOS", "LETRAS", "NOBAC", "LEBAC", "ON", "FCI", "CAUCIONES", "ACCIONES", "ETF", "CEDEARS", "OPCIONES", "FUTUROS", "ACCIONES-USA", "FCI-EXTERIOR"`.
- **`GET /api/1.0/Configuration/Settlements`** [doc] D1 `#settlements`: `"INMEDIATA", "A-24HS", "A-48HS", "A-72HS"`.
- **`GET /api/1.0/Configuration/Markets`** [doc] D1: `"ROFEX", "OTC", "NYSE", "BYMA"`. `Current` no recibe mercado.
- Las 3 listas son ejemplos de 2022. Que sean las vigentes hoy se confirma en vivo llamando a esos endpoints.
- **Ejemplos de uso en la doc:**
  - [doc] D2: `current("GGAL", "Acciones", "A-48HS")`, con mayúsculas mezcladas;
  - [doc] D3: realtime con `("GGAL","ACCIONES","A-48HS")`, `("AAPL","CEDEARS","A-48HS")`, `("AL30","BONOS","INMEDIATA")`;
  - [ejemplo] E1: `current("GGAL", "Acciones", "A-24HS")`.
  - Si `Type` distingue mayúsculas, la doc no lo dice.
- **Cobertura de las especies de Balanz** (acciones de BYMA): la doc no lo dice. El único dato es que BYMA figura como mercado.

### Endpoints de Market Data relacionados

Mismos 3 parámetros y headers [doc] D1:

- `GET MarketData/Search`: histórico. Requiere además `DateFrom` y `DateTo`. Devuelve un array de `{date, price, volume, openingPrice, max, min}`.
- `GET MarketData/Intraday`: devuelve un array de `{date, price, volume}`.
- `GET MarketData/Book`: devuelve `{date, offers[{position, price, quantity}], bids[...]}`.
- `GET MarketData/SearchInstrument?Ticker=&Name=&Market=&Type=`: devuelve un array de `{ticker, description, currency, type, market}`. Sirve para conocer el `type` y la `currency` de un ticker antes de llamar a `Current`.

---

## 7. Límites de uso

- **La doc no lo dice.** No hay mención de rate limits, 429 ni throttling en D1 a D6. Tampoco en la Swagger S2, que no declara una respuesta 429, ni en el SDK K1, que no tiene lógica de reintento por límite (solo por 401).

---

## Otros datos útiles

- [swagger] S2 tiene un endpoint que D1 no documenta: `POST /api/1.0/InterestBearingAccount/MassOperation`. Queda fuera de la lista blanca.
- [doc] D1 documenta endpoints de escritura que **quedan fuera de la lista blanca** de F9.196 §0:
  - `Order/Budget`, `Order/Confirm`, `Order/Cancel`, `Order/MassCancel`, `Order/BudgetTransfer` y `Order/ConfirmTransfer`;
  - `Account/BankAccount`, `Account/CancelBankAccount`, `Account/ForeignBankAccount` y `POST Account/InvestingProfile`.
- `Order/BudgetTransfer` y `Order/ConfirmTransfer` mueven plata a una cuenta bancaria (body: `cbu`, `amount`).
- Errores [swagger] S2: todos los endpoints declaran `400 Bad Request` y `401 Unauthorized` con cuerpo `string`. Hay un schema `Error`, pero los endpoints de arriba no lo referencian.

---

## 8. MEP del día: `dolarapi.com/v1/dolares/bolsa` (Addendum 1) — **probado en vivo**

Este endpoint es público, así que este sí se probó en vivo. Es el mismo endpoint y el mismo campo
`venta` que usa `actualizarTCDiario` (F9.30, `functions/src/index.ts`).

**Prueba:** lunes 19/10/2026 a las **22:38:50 ART** (01:38:50 UTC del 20/10), con `curl -i`.

```http
HTTP/1.1 200 OK
Date: Tue, 20 Oct 2026 01:38:50 GMT
Content-Type: application/json
Cache-Control: public, max-age=0, must-revalidate
Server: cloudflare
```

```json
{
  "moneda": "USD",
  "casa": "bolsa",
  "nombre": "Bolsa",
  "compra": 1536.7,
  "venta": 1544.1,
  "fechaActualizacion": "2026-10-19T21:00:00.000Z"
}
```

**Lo que se confirma:**

- `fechaActualizacion` **existe** y viene en **ISO 8601 en UTC**, con milisegundos y sufijo `Z`.
- La fecha devuelta es `2026-10-19T21:00:00.000Z` = **19/10/2026 18:00 ART**. A las 22:38 ART la
  última actualización era la de las 18:00 de ese mismo día.
- **Hay que pasarla a hora argentina antes de comparar con "hoy".** Si se compara la fecha UTC
  (`slice(0, 10)`), una actualización posterior a las 21:00 ART cae en el día siguiente.
  `resolverTcCarteraViva` (`src/datos/patrimonioCarteraViva.ts`) ya la convierte.

**Lo que NO se pudo confirmar esta noche:**

- **Que a las 18:20 ART ya tenga la fecha de hoy.** La prueba fue a las 22:38. El valor de las
  18:00 sugiere que sí, pero no se vio en ese horario. Hay que repetir la prueba un día hábil entre
  las 18:00 y las 18:20.
- Si la hora de las 18:00 es fija (un cierre) o si el valor se mueve durante la rueda. Para saberlo
  hay que hacer varias lecturas en horario de mercado.

**Hallazgo lateral (no se tocó):** `parseCcl` en `functions/src/senalesMercado.ts:116` toma la fecha
de `fechaActualizacion` con `slice(0, 10)`, es decir en UTC. Después de las 21:00 ART esa fecha es la
del día siguiente.

---

## Pendiente con credenciales

1. **Base URL de producción.** Confirmar `https://clientapi.portfoliopersonal.com/api/`, que sale del SDK y no de la doc REST. Confirmar también que el sandbox actual es `clientapisbx` y no `clientapi_sandbox`, que cambió en la doc el 2026-10-19.
2. **`LoginApi`:**
   - qué devuelve: `accessToken`, `refreshToken` y `expires` con su unidad real (la Swagger dice segundos);
   - si viene como array o como objeto;
   - qué pasa al vencer: código HTTP, si `RefreshToken` necesita el Bearer viejo y si el `refreshToken` rota.
   - Confirmar además si se usan los `AuthorizedClient`/`ClientKey` propios de Gestiones.
3. **`Account/Accounts`:** el número de cuenta. Hoy figura como "PPI 101268"; ver si viene "101268" a secas. Mirar también `externalID` y `owners`.
4. **`BalancesAndPositions`:** pegar un ejemplo real anonimizado. Documentar:
   - la forma exacta de las posiciones (`groupedInstruments`): ticker, tipo, cantidad, precio, valuación (`amount`?), moneda, `collateralQuantity` y si trae costo promedio;
   - los saldos por moneda y plazo (`groupedAvailability`, `symbol` vs `simbol`).
5. **`Movements`:**
   - qué tipos existen (compra, venta, depósito, retiro, cupón, dividendo) y cómo se distinguen (¿solo por `description`?);
   - qué campos trae cada uno;
   - qué formato de fecha acepta y cuál es el rango máximo.
6. **`MarketData/Current`:**
   - los valores válidos de `Type` y `Settlement` (llamar a `Configuration/InstrumentTypes` y `Configuration/Settlements`), y si distinguen mayúsculas;
   - si devuelve precio para las especies de BYMA que están en **Balanz**;
   - en qué moneda viene el precio.
7. **Límites de uso.** No están documentados. Medir con 50 llamadas seguidas y anotar la respuesta (código HTTP, cuerpo y headers de límite si los hay).

**Decisión pendiente:** si `MarketData/Current` sirve como **respaldo de data912**, que devolvió 502 el 14/10 (ver F9.195.1). Depende de los puntos 6 y 7: cobertura de especies BYMA/Balanz, moneda del precio, frescura de `date` y límite de llamadas.
