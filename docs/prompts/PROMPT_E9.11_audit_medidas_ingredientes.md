# PROMPT E9.11 — Auditoría de medidas e ingredientes (READ-ONLY)

> **Objetivo:** detectar recetas donde (a) hay medidas vagas o ausentes, (b) sal/pimienta se usan sin cantidad o sin estar listadas, (c) hay ingredientes mencionados en pasos que no están en la lista, o listados que nunca se usan.
>
> **Alcance:** solo lectura sobre las 308 recetas reales (excluí los 2 sintéticos de comprasRapidas). Output = **queries/script + listados pegados literal**. NO corregir nada. Esperar `procedé`. El fix sale en prompt aparte (es decisión culinaria de JP).

---

## Clasificación de hallazgos (tagear TODO con A o B)

Cada hallazgo de D1–D4 debe venir etiquetado:

- **Tier A — Error (a corregir):** medida vaga/ausente o ingrediente faltante en algo que **aporta cantidad relevante**: proteínas, verduras, grasas usadas como cantidad de cocción (salsas, fritura, marinadas), harinas, líquidos, **endulzantes (eritritol/azúcar)**, salsas/condimentos líquidos (soja, pescado, etc.).
- **Tier B — Excepción a confirmar (no se da por válida sola; va a revisión de JP):** **sal**, **pimienta** y condimentos secos "a gusto"; `agua para hervir`; `aceite para engrasar / la plancha`; hierbas u hojas de guarnición tipo "unas hojas". Se reportan igual, pero como candidatas a excepción, no como error.

> Regla de corte: si la falta de medida no cambia el resultado del plato ni la lista de compras (sal/pimienta de mesa, agua de hervor), es Tier B. Si cambia la receta o la compra, es Tier A.

---

## D1 — Medidas vagas o ausentes en `ingredientes[]`

Listá ingredientes (receta + nombre) donde:
- `cantidad` es null / 0 / ausente, **o**
- `nombre` / `preparacion` / `notas` contienen marcadores vagos: `a gusto`, `al gusto`, `c/n`, `cantidad necesaria`, `lo necesario`, `a ojo`.

Reportá: `receta | ingrediente | cantidad | unidad | dónde apareció el marcador`.

## D2 — Medidas vagas en pasos

Escaneá `pasos[].titulo` + `pasos[].detalle` con esta denylist (case-insensitive): `a gusto`, `al gusto`, `c/n`, `cantidad necesaria`, `un poco de`, `un chorrito`, `unas gotas`, `un hilo de` (salvo "hilo de cocina"), `a ojo`, `rocío de`, `cantidad a gusto`.

Reportá: `receta | nroPaso | frase encontrada`.

## D3 — Sal / pimienta → **Tier B** (excepción a confirmar)

Detectar igual, pero reportar como candidatas a excepción, no como error:

3a. **Mencionadas en pasos pero NO listadas:** recetas cuyos pasos contienen `sal`, `salar`, `salpimentar`, `pimienta`, `sazonar`, `condimentar`, pero cuya lista no incluye sal* y/o pimienta*. Reportá por receta cuál falta. (JP decide si exige listarlas o las acepta ausentes por ser staples.)

3b. **Listadas con cantidad vaga/0:** ítems sal* o pimienta* con `cantidad` null/0 o `unidad` vacía.

> Todo D3 es Tier B salvo que el ítem detectado sea un **endulzante o un condimento líquido** (eritritol, azúcar, salsa de soja, salsa de pescado): esos son **Tier A**.

## D4 — Cobertura ingrediente ↔ paso

4a. **Ingredientes listados nunca mencionados en pasos:** por receta, ítems de `ingredientes[]` cuyo nombre/canónico no aparece en ningún `paso.detalle`. (Posible ingrediente espurio o paso incompleto.) — chequeo confiable.

4b. **(best-effort, marcar como CANDIDATOS) Ingredientes en pasos ausentes de la lista:** cruzá el texto de los pasos contra el catálogo de canónicos; reportá términos del catálogo que aparecen en los pasos de una receta pero no están en su lista. Advertí explícitamente que `agua`, `aceite`, `sal`, `pimienta` y similares genéricos pueden ser falsos positivos.

---

## Agrupación y resumen

- Total de recetas con ≥1 hallazgo, y desglose **por Tier (A / B)** y por tipo (D1/D2/D3/D4).
- Conteo de hallazgos **agrupado por `cocina` (o `estilo` si `cocina` está vacío) y/o por tanda/origen**, para ver dónde se concentran.
- Listá los **Tier B** (sal, pimienta, agua de hervor, aceite de engrasar, guarniciones "unas hojas") por separado: van a revisión de JP, no se dan por válidos solos.

## Requisitos

- Cada bloque con su query/script y su listado pegados literal. Nada de resúmenes sin output.
- No corregir nada. Terminar y esperar `procedé`.
