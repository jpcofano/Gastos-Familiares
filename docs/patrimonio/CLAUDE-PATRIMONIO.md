# Patrimonio — Anexo de CLAUDE.md

> Vista privada de análisis de patrimonio/portfolio, **dentro** de la app
> Gastos-Familiares pero **aislada** de los datos de gastos.
> Este archivo es el contrato de la parte Patrimonio. El `docs/CLAUDE.md`
> principal solo lo referencia; no se mezclan.

## Cómo referenciarlo desde el CLAUDE.md principal

Agregar en `docs/CLAUDE.md` una sección puntero (no volcar contenido acá):

```
## Anexo: Patrimonio
Vista privada de portfolio, aislada de gastos (colecciones propias, sin puente).
Contrato completo en docs/CLAUDE-PATRIMONIO.md.
```

---

## Qué es esto

Un módulo de análisis de patrimonio de inversión que vive como **una solapa
privada más** ("Patrimonio") en la app existente. Reusa el caparazón de
Gastos-Familiares (auth, Firestore, Functions, Storage, design system, deploy)
pero **no comparte datos** con la parte de gastos. Sin puente entre ambos:
ningún dato cruza en ninguna dirección.

El objetivo del dueño: **mantener el valor medido en USD**, entendiendo los
riesgos de cada posición. El sistema **propone, mide y muestra riesgos**;
nunca ordena ni dispara alarmas. Las decisiones las toma el usuario.

---

## Objetivo y política (decisiones cerradas)

- **Vara de medida:** USD. Todo se juzga en dólares.
- **Horizonte:** 1–3 años.
- **Postura:** crecer aunque oscile (apetito por renta variable alta).
- **Unidad medida:** la **familia como una sola entidad**. Se mide el total,
  sin separar la parte personal de las cuentas conjuntas.
- **Filosofía:** proponer, medir y mostrar riesgos. Nada prescriptivo.
  Los semáforos son resumen visual de dónde se concentra el riesgo, no alarmas.

---

## Alcance y aislamiento (decisiones cerradas)

- El patrimonio es una **vista privada dentro** de la app, no una app separada.
- **Aislamiento de datos:** colecciones nuevas y propias
  (`posiciones`, `snapshotsPortafolio`, `informesPortafolio`), que **nunca**
  tocan `movimientos`, `comprobantes`, ni ninguna colección de gastos.
- **Visibilidad:** la solapa "Patrimonio" se renderiza en el nav **solo para el
  admin/dueño** (jpcofano@gmail…), scopeada por el modelo `autorizados`
  existente (`esAdmin()` o `memberId` propio). Los dependientes no la ven ni
  tienen acceso de lectura.

---

## Stack (reuso del caparazón)

- Frontend: React 18 + Vite + TS PWA (el existente).
- Backend: Firebase — Auth, Firestore, Cloud Functions (Node 22), Storage,
  Hosting (los existentes).
- Design system, AppShell/navegación y pipeline de deploy: reusados.

---

## Flujo de ingesta (decisión cerrada — reemplaza la auto-ingesta)

La extracción de PDFs **no** ocurre dentro de una Cloud Function. Ocurre en
una **ventana de Claude aparte**, con un prompt fijo. La app solo recibe un
`.txt` ya estructurado.

1. **Extracción (ventana de Claude aparte):** el usuario pega el prompt fijo
   + los resúmenes de las cuentas → Claude lee, clasifica sector/país, y
   devuelve **solo** el JSON del contrato (ver abajo). La revisión humana
   pesada ocurre acá.
2. **Carga (app, botón Patrimonio):** el usuario sube el `.txt` →
   la app valida contra el esquema → pantalla de confirmación → escribe en
   `posiciones` + crea un `snapshotsPortafolio` fechado → regenera las solapas.

Consecuencia: la app **no** hace detección-de-fuente ni parser por bróker ni
llamadas online para precios/TC. Solo valida, convierte ARS→USD vía `tcDiario`
y calcula.

---

## Contrato del `.txt` (esquema — decisión cerrada)

JSON dentro del `.txt`. La extracción deja cada posición en su **moneda
original**; el `valor_usd` lo calcula la app (ver conversión).

```json
{
  "meta": {
    "fecha_corrida": "2026-07-01",
    "entidad": "familia",
    "fuentes": ["balanz_402665.pdf", "balanz_1120830.pdf", "acciones.pdf", "cripto.pdf"],
    "total_declarado_usd": 111000
  },
  "posiciones": [
    {
      "cuenta": "Balanz 402665",
      "titular": "Lascano y/o Cofano",
      "ticker": "TRAN",
      "tipo": "accion",
      "sector": "energia",
      "pais_riesgo": "AR",
      "moneda_origen": "ARS",
      "valor_origen": 22250000,
      "cantidad": 4068,
      "fuente": "balanz_402665.pdf",
      "revisar": false
    }
  ]
}
```

- `tipo` ∈ `accion | bono | on | cedear | fci | cripto | cash`
- `pais_riesgo` ∈ `AR | global`
- `moneda_origen` ∈ `ARS | USD`
- `revisar: true` marca lo que Claude no pudo resolver con certeza (dispara
  atención en la pantalla de confirmación).
- `total_declarado_usd` sirve de checksum contra la suma que calcula la app.

Definir el tipo TS `Posicion` espejo de este esquema (no reusar los tipos de
gastos).

---

## Conversión ARS → USD (decisión cerrada)

- La app calcula `valor_usd` **al cargar**, no la ventana de chat:
  - `moneda_origen == USD` → `valor_usd = valor_origen`.
  - `moneda_origen == ARS` → `valor_usd = valor_origen / tcDiario[fecha_corrida]`.
- `tcDiario` es la **única fuente autoritativa** del tipo de cambio (colección
  ya existente en la app). Mismo criterio que `tcUsdArs` en gastos.
- El snapshot guarda el TC efectivamente usado, para trazabilidad.

---

## Colecciones nuevas y reglas de acceso

- `posiciones` — foto vigente (una fila por tenencia).
- `snapshotsPortafolio` — histórico fechado ("la película, no la foto").
  Requisito desde el día uno, no retrofit.
- `informesPortafolio` — informes generados (por solapa y fecha).

Reglas: `allow read, write: if esAdmin()` (o scopeadas al `memberId` del dueño).
Nunca legibles por dependientes. Nunca referencian colecciones de gastos.

---

## Solapas / informes (decisión cerrada)

1. **Tenencias** — consolidadas por ticker, con desglose por cuenta al expandir; ninguna tenencia queda oculta (regla: agrupación visible, nunca agrupación que esconde).
2. **Concentración / foto** — con semáforos (ver bandas).
3. **Rebalanceo** — menú de opciones medidas + riesgos de cada una
   (no una recomendación única).
4. **Research sectorial** — informe de juicio (nacional + internacional).
5. **Benchmark vs CAFCI** — al final (fase diferida).

---

## Motor de análisis (decisión cerrada — A1)

- **Determinístico → código puro en Functions/TS, sin API.** Tenencias,
  métricas, concentración, HHI, y toda la matemática del rebalanceo
  (el efecto de cada opción se calcula, no se opina). Instantáneo, gratis,
  reproducible.
- **Sectorial (de juicio) → vía API de Anthropic**, implementado, **con un
  toggle activar/desactivar** por control de costo.

---

## Métricas (decisión cerrada — set completo, A3)

Base:
- Concentración del nombre más grande (top-1).
- Peso por sector.
- Peso por país (AR vs global).
- % en renta variable (informativo, ver salvedad).

Completo:
- HHI (concentración global; umbrales estilo DOJ).
- Concentración acumulada top-3 y top-5.
- **Drivers de riesgo** — agrupar por: regulatorio/tarifario, precio de
  commodity, macro/tasas AR, inflación/CER, crédito soberano, cripto, global.
  (La más valiosa para este portfolio.)
- Exposición cambiaria: USD duro vs ARS vs cripto.
- Breakdown por clase de activo: RV / RF / cripto / cash.

---

## Semáforos: bandas propuestas (A4 — estándar, ajustables)

Referencias: regla UCITS 5/10/40 para nombres; umbrales HHI del DOJ.

| Métrica          | 🟢 Verde | 🟡 Amarillo | 🔴 Rojo |
|------------------|---------|------------|--------|
| Nombre único     | ≤ 5%    | 5–10%      | > 10%  |
| Sector           | < 25%   | 25–40%     | > 40%  |
| País único       | < 40%   | 40–60%     | > 60%  |
| Cripto (clase)   | < 10%   | 10–20%     | > 20%  |
| HHI              | < 0,15  | 0,15–0,25  | > 0,25 |

**Salvedad:** el **% en renta variable NO lleva semáforo**. Es descriptivo,
no un riesgo a limitar — el perfil quiere RV alta. Pintarlo de rojo
contradiría la postura. Va como número informativo, sin color.

---

## Orden de trabajo (fases)

1. **Receta/contrato** (este documento) → pasar a Claude Code para documentar
   e implementar el esqueleto.
2. **Validar** la lógica de los informes contra PDFs reales hasta confiar.
3. **Enchufar la vista privada** en la app (barato: caparazón, auth, patrón
   de ingesta y deploy ya existen).

---

## Artefactos a producir

- `docs/prompts/patrimonio-extraccion.md` — el **prompt-de-pegar** para la
  ventana de Claude. **PENDIENTE de calibración** contra la forma real de cada
  fuente (ver A5). Debe: leer las fuentes, extraer toda tenencia, clasificar
  sector/país, y devolver solo el JSON del contrato.
- Tipo TS `Posicion` (+ `SnapshotPortafolio`, `InformePortafolio`).
- Reglas de Firestore para las colecciones nuevas.
- Vista `Patrimonio.tsx` (+ subvistas por solapa) en `src/vistas/`.
- Functions determinísticas de análisis + Function sectorial (API, con toggle).

---

## Pendientes / decisiones abiertas

- **A5 — Fuentes a documentar (bloqueante para el prompt):** un archivo por
  cuenta. Cuentas conocidas hasta ahora:
  - Balanz 402665 (conjunta, Lascano y/o Cofano)
  - Balanz 1120830 (Cofano)
  - Cuenta de acciones (Estado de cuenta / "Portfolio RAW", trae VALOR CORRIENTE)
  - Cripto (definir: resumen de exchange o carga manual)
  *Los archivos no llegaron a la sesión donde se definió esto; re-subir en la
  cuenta nueva para calibrar el prompt y documentar cada formato.*
- **Micro-decisión #2 (propuesta, a confirmar):** que la app solo **valide el
  esquema + una pantalla de confirmación**, sin re-edición campo a campo
  (la revisión pesada ya ocurre en la ventana de chat).
- **Fuente de cripto:** ¿exchange con export, o carga manual del valor USD?

---

## Roadmap de fases (estado al 04/07/2026)

Implementación en cadena (cada una depende de la anterior):
- **F9.90** — Ingesta `.txt` + activos fijos + doble lente *(en curso)*
- **F9.90.1** — Posiciones manuales ACN/GLOB (planes de empleado)
- **F9.91** — Opciones medidas + escenarios de estrés + evolución
- **F9.92** — Informe PDF completo (bajo demanda + archivado)
- **F9.93** — Análisis IA por posición + sectorial (toggle, caché, lote manual)

Fases posteriores (en orden):
- **F9.94 — Diario de decisiones:** registrar decisión (fecha, razón, opción
  de referencia) y revisión a 30/90 días contra la evolución de las métricas.
- **F9.95 — Calendario de eventos:** agregación de `proximosEventos` de los
  análisis IA cacheados en una línea de tiempo única.
- **F9.96 — Registro de aportes/retiros → retorno real (TWR):** recién con
  3-4 snapshots acumulados; corrige el límite "cambio de valor ≠ retorno".
- **F9.97 — Benchmark CAFCI:** comparación vs carteras de fondos
  ACCIONES_AR / BONOS_SOBERANOS_AR (diseño previo ya existente).
- **F9.98 — Optimización formal de portafolio (POST-CAFCI, decidido):**
  correlaciones históricas y optimización (mínima varianza / risk parity /
  frontera). Alcance previsto: obtener series de precios (Yahoo Finance para
  ACN/GLOB/CEDEARs y cripto; BYMA/Rava para tickers AR), dolarizarlas,
  calcular matriz de correlaciones y carteras óptimas como UNA VISTA MÁS
  (propone y mide, no prescribe). **Advertencias documentadas para el
  implementador:** (a) series AR cortas/sucias y la dolarización mete el
  ruido del TC en la serie — definir TC de conversión diario (CCL) y
  ventana; (b) correlaciones inestables en crisis (todo AR → 1): la
  optimización complementa, NO reemplaza, los escenarios de estrés de F9.91;
  (c) la frontera con retornos esperados históricos sobrepondera lo que ya
  subió — preferir métodos sin retornos esperados (mín. varianza / risk
  parity) o tratar los esperados como input manual del dueño.

---

## Decisiones cerradas — no re-litigar

- Vara USD; horizonte 1–3 años; postura crecer aunque oscile.
- Unidad = familia como una entidad; se mide el total.
- Filosofía proponer/medir/mostrar, no alarmas.
- Vista privada dentro de la app; datos aislados; sin puente con gastos.
- Ingesta: ventana de chat → `.txt` JSON → app valida/carga. No auto-ingesta,
  no parser por bróker, no online en la app.
- Conversión ARS→USD por la app vía `tcDiario`.
- Determinístico en TS; sectorial vía API con toggle.
- Set de métricas completo; bandas estándar (ajustables); RV sin semáforo.
- Historial fechado desde el día uno.
- Anexo en archivo propio; puntero desde el CLAUDE.md principal.
