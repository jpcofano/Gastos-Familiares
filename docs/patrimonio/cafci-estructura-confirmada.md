# CAFCI API — Estructura confirmada

**Fecha de confirmación:** 2026-07-05  
**Fuente:** Código AppsScript en producción (`10_Fondos_CAFCl.js`), corrió contra
`api.pub.cafci.org.ar` y pobló 365 filas con control `total_share = 100.0` en 14 fondos.

---

## Endpoint

```
GET https://api.pub.cafci.org.ar/fondo/{fondoId}/clase/{claseId}/ficha
```

### Headers requeridos (exactos — nota el `www.`)

```
User-Agent: Mozilla/5.0
Accept: application/json, text/plain, */*
Origin:  https://www.cafci.org.ar
Referer: https://www.cafci.org.ar/
```

El header original sin `www.` (`https://cafci.org.ar`) devuelve 403 desde CloudFront.
Si la Cloud Function sigue devolviendo 403, el camino de pegado manual de JSON sigue
disponible en la UI.

---

## Estructura de respuesta confirmada

```json
{
  "success": true,
  "data": {
    "model": {
      "nombre": "<nombre de la CLASE>",
      "fondo": { "nombre": "<nombre del FONDO>" }
    },
    "info": {
      "semanal": {
        "fechaDatos": "YYYY-MM-DD",
        "carteras": [
          { "nombreActivo": "YPF - D",                  "share": 17.902 },
          { "nombreActivo": "Grupo Fciero Galicia - B",  "share": 17.708 },
          ...
        ]
      }
    }
  }
}
```

### Invariantes confirmados

| Campo            | Ubicación                          | Notas                               |
|------------------|------------------------------------|-------------------------------------|
| `success`        | raíz                               | Debe ser `true`; si no, error claro |
| `fechaDatos`     | `data.info.semanal.fechaDatos`     | NO dentro de cada item de carteras  |
| `carteras[]`     | `data.info.semanal.carteras`       | Son las posiciones directamente     |
| `nombreActivo`   | cada item de `carteras[]`          | Campo especie; formato "Empresa - Clase" |
| `share`          | cada item de `carteras[]`          | Peso porcentual; Σ ≈ 100 por fondo  |
| fondo nombre     | `data.model.fondo.nombre`          | Fallback: nombre configurado        |
| clase nombre     | `data.model.nombre`                | Fallback: nombre configurado        |

**La suma de `share` da 100.0 ± redondeo** (verificado en 14 fondos reales).  
Si la suma queda fuera de [98, 102], el doc se guarda con `advertenciaIntegridad: true`
y la UI muestra un banner de advertencia en la solapa Benchmark.

---

## Tipos de especie especiales (no son pendientes de mapeo humano)

| Patrón (regex)               | ticker | categoria  | Excluir benchmark AR |
|------------------------------|--------|------------|----------------------|
| `/^fci\b/i`                  | null   | LIQUIDEZ   | sí                   |
| `/^cta\.? ?cte\.?/i`         | null   | LIQUIDEZ   | sí                   |
| `/^cauci[oó]n/i`             | null   | LIQUIDEZ   | sí                   |
| `/^cedear/i`                 | null   | CEDEAR     | sí                   |

Estos se detectan en el parser server-side (`sincronizarCafci`) antes de buscar en
`cafciMapping`. FCI/cauciones/cuentas corrientes representan hasta ~15% de algunos fondos.

---

## Mapping especie→ticker (`cafciMapping`)

Colección Firestore con documentos `{ ticker, tipo, sector }`.
- Clave: `normalizarEspecie(nombreActivo)` (NFD-lowercase)
- 70 patrones pre-sembrados desde el sistema AppsScript anterior (seed de abril 2026)
- Botón "Importar mapping (70)" en Config → Fondos CAFCI

---

## Parser implementado (F9.97.1)

En `functions/src/index.ts`, función `sincronizarCafci`:

1. Valida `json.success === true` y `data.info.semanal` presente.
2. Lee `carteras[]` de `data.info.semanal` — son posiciones directas.
3. Lee `fechaDatos` de `data.info.semanal.fechaDatos`.
4. Para cada item: campo `nombreActivo` (primario), `share` (primario).
5. Detecta LIQUIDEZ/CEDEAR por prefijo antes de buscar en `cafciMapping`.
6. Calcula `totalPct = Σ share` y marca `advertenciaIntegridad` si fuera de [98,102].
7. Guarda en `cafciCarteras/{fondoId}_{fechaDatos}`.

---

## Fondos sugeridos (seed F9.97.1 §8a)

13 fondos de acciones AR validados contra la API en abril 2026.
Botón "Importar fondos sugeridos (13)" en Config → Fondos CAFCI — merge, no borra los ya configurados.

Ver tabla completa en `docs/patrimonio/cafci-seed.json` → clave `fondos_acciones`.
