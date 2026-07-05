# CAFCI API — Exploración de estructura

**Fecha de exploración:** 2026-07-05  
**Explorador:** Claude Code (sesión F9.97)

## Estado de la exploración

### Endpoint confirmado (por documentación previa del dueño)

```
GET https://api.pub.cafci.org.ar/fondo/{fondoId}/clase/{claseId}/ficha
Headers requeridos:
  Origin:  https://cafci.org.ar
  Referer: https://cafci.org.ar/
```

### Resultado del intento de fetch automatizado

La API devuelve **403 Forbidden** con body `{"error":"Route not allowed"}` para cualquier
petición curl directa, incluso con los headers correctos. La respuesta viene de CloudFront
(`X-Cache: FunctionGeneratedResponse from cloudfront`, pop `EZE50-P4`).

Esto indica que la API valida el origen a nivel de CDN — acepta requests desde el dominio
cafci.org.ar (con cookie de sesión activa del browser), pero bloquea peticiones directas
desde IPs externas.

**Conclusión:** El fetch real debe hacerse manualmente desde el browser del dueño o desde
una Cloud Function en un entorno IP-trusteado. La Cloud Function `sincronizarCafci` debe
ejecutarse desde Firebase (southamerica-east1) — es probable que tampoco esté en la allowlist
de CAFCI. Si la sincronización falla por 403, el dueño puede copiar la respuesta JSON cruda
del browser y pegarla manualmente.

---

## Estructura parcialmente confirmada (por el dueño, exploración previa)

```json
{
  "data": {
    "info": {
      "semanal": {
        "carteras": [
          {
            "fechaDatos": "YYYY-MM-DD",
            "..."  // campos internos NO confirmados
          }
        ]
      }
    }
  }
}
```

## Campos internos de `carteras[]` — NO confirmados, a completar

Los campos que tipicamente tienen las APIs de fondos argentinos (BYMA, CNV, CAFCI) son:

| Campo probable    | Tipo    | Descripción                            |
|-------------------|---------|----------------------------------------|
| `especie`         | string  | Nombre/ticker de la especie            |
| `tipoEspecie`     | string  | Tipo de instrumento (ON, FCI, RV, etc) |
| `porcentaje`      | number  | Peso porcentual en la cartera          |
| `valor`           | number  | Valor en ARS                           |
| `cantidad`        | number  | Cantidad de nominales                  |

**IMPORTANTE:** Estos campos son SUPUESTOS. El parser implementado usa acceso defensivo
con fallback a `incompleto: true` si un campo esperado no existe.

**Acción pendiente del dueño:** Acceder desde el browser a la ficha de un fondo en
cafci.org.ar, abrir DevTools → Network, filtrar por la URL de la API, copiar el JSON de
respuesta y actualizar este archivo con la estructura real de un elemento de `carteras[]`.

---

## Cómo obtener fondoId y claseId

1. Ir a https://cafci.org.ar/fondos
2. Buscar el fondo deseado
3. Abrir la ficha del fondo
4. La URL tiene la forma `/fondos/{fondoId}/{claseId}` o similar
5. Esos IDs son los que se cargan en `configPatrimonio/cafci.fondos[]`

---

## Parser implementado (fail-soft)

El parser en `functions/src/index.ts` intenta leer:
- `item.especie` o `item.tipoEspecie` → `especieRaw`
- `item.porcentaje` o `item.peso` o `item.porcentajeFondo` → `pesoPct`

Si un campo esperado no existe → `incompleto: true`, nunca excepción.

Actualizar el parser una vez que se confirme la estructura real.
