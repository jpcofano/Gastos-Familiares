# Patrimonio — Resumen de sesión (handoff)

> Archivo de continuidad. Se lee/pega al iniciar en cualquier cuenta de Claude
> para retomar sin perder contexto. Se actualiza y commitea al cerrar cada
> sesión con decisiones nuevas.
>
> Contrato completo y técnico: `CLAUDE-PATRIMONIO.md` (en esta misma carpeta).

**Última actualización:** sesión de diseño inicial.

---

## 1. Qué es este proyecto

Módulo de análisis de patrimonio de inversión, como **vista privada** dentro de
la app existente **Gastos-Familiares** (React+Vite+TS PWA sobre Firebase),
**aislado** de los datos de gastos (colecciones propias, sin puente).

Objetivo del dueño: **mantener el valor medido en USD**, entendiendo el riesgo
de cada posición. El sistema **propone, mide y muestra riesgos**; no ordena ni
alarma. Decide el usuario.

**Perfil (cerrado):** vara USD · horizonte 1–3 años · postura "crecer aunque
oscile" · unidad = la familia como una sola entidad (se mide el total, no la
parte personal) · tiene tolerancia, no necesita liquidez, opera afuera, tiene
cuenta en USD.

---

## 2. La foto del patrimonio (hallazgos del análisis)

Total consolidado a mercado: **~USD 111.000** (cripto = USD 30.000, corregido).

Composición aproximada por riesgo de fondo:
- **Energía AR (acciones gas/electricidad/utilities): ~46%** — el bloque
  dominante y el hallazgo central.
- **Cripto (BTC+ETH, tratados como un solo bloque): ~27%.**
- **Renta fija AR: ~18%** (bonos CER en pesos ~12% + soberanos USD / ON ~6%).
  Es el único amortiguador real; driver distinto a las acciones.
- **Bancos AR: ~5%.**
- **Global (CEDEARs: Barrick, Chevron, Verizon, Globant): ~3%** — lo único
  genuinamente no-argentino además de cripto.

Por país: **~74% Argentina, ~27% cripto, ~3% global.**

Nombres individuales más grandes (sumando cuentas):
- **TRAN (Transener) ~16%**, PAMP ~10%, YPFD ~9%, VIST ~7%.
- Esos **cuatro nombres, mismo sector y país, son > 40% del total.**

Cómo se formó la concentración: no fue deliberada, fue "dejar correr
ganadores". En USD: TRAN +121%, Ecogas +130%, YPF +110%, TGS +96%,
Macro +65%, Central Puerto +59%, Pampa +49%. Único perdedor serio:
Ternium −38%.

**Cuentas:**
- Balanz 402665 — conjunta (Lascano y/o Cofano), ~USD 30k.
- Balanz 1120830 — Cofano, ~USD 12,5k (casi pura energía: PAMP + TRAN).
- Cuenta de acciones ("Portfolio RAW", trae VALOR CORRIENTE a mercado).
- Cripto — USD 30k.

**Trampas de datos ya resueltas (no repetir):**
- RAW2 y RAW3 eran la **misma cuenta duplicada** → contar una sola vez.
- RAW4 = Portfolio RAW **expresado en USD** (mismos tickers/cantidades) →
  no sumar; sirve para valuación y para el G/P.
- Balanz eran **dos comitentes distintos**, no uno.

---

## 3. Diagnóstico de riesgo

- El tamaño de renta variable (~58% entre acciones AR + cripto) es riesgo
  **compensado** y coherente con la postura. No es el problema.
- El problema es la **forma**: 46% en un solo sector de un solo país, con
  cuatro nombres correlacionados que comparten los mismos riesgos (tarifa,
  regulación, macro AR, evento soberano). Es reducción de riesgo "gratis"
  sobre la mesa (bajás varianza sin bajar retorno esperado).
- En horizonte 1–3 años, una corrección fuerte de energía AR sobre una base
  ya muy apreciada es el escenario que más dolería. La cripto no ayuda ahí
  (riesgo independiente, no contrapeso).

---

## 4. Palancas de rebalanceo propuestas (la lógica de la solapa "Rebalanceo")

Idea madre: **mantener el % en renta variable, cambiar su composición.**
No es vender para quedarse en pesos; es repartir la misma apuesta de crecimiento.

1. **Recortar primero los nombres únicos más grandes** (TRAN, PAMP) — máximo
   riesgo sacado por dólar movido.
2. **Separar dentro de energía** reguladas (TRAN, TGS, ECOG) vs productoras
   (YPF, VIST, PAMP, CEPU) — son dos riesgos distintos hoy mezclados.
3. **Redesplegar a otros sectores AR** que casi no tiene (consumo, agro, real
   estate, materiales).
4. **Sumar renta variable global** (puede operar afuera, tiene cuenta USD) —
   probablemente la de mayor impacto: mismo nivel de RV, menos riesgo-país.

Silueta ilustrativa (no receta): energía AR 46% → ~25%, absorbido por otras
acciones AR + global; RF AR parecida como amortiguador; cripto definida como
**decisión explícita** (27% es mucho para dejarlo por inercia).

Recordar al recomendar: (a) no es asesoría matriculada; (b) son ganadores en
USD → vender tiene costo impositivo, pensar gradual; (c) parte está en cuenta
conjunta.

---

## 5. Decisiones de sistema tomadas

Resumen (detalle y forma técnica en `CLAUDE-PATRIMONIO.md`):

- **Arquitectura:** vista privada dentro de la app; colecciones propias
  (`posiciones`, `snapshotsPortafolio`, `informesPortafolio`); sin puente con
  gastos; visible solo para el admin/dueño.
- **Ingesta:** ventana de Claude aparte con prompt-de-pegar → devuelve un
  `.txt` JSON estructurado → la app valida, confirma y carga. Sin auto-ingesta,
  sin parser por bróker, sin llamadas online en la app.
- **Conversión ARS→USD:** la hace la app vía la colección **`tcDiario`** ya
  existente (fuente única del TC). La extracción deja `moneda_origen` +
  `valor_origen`.
- **Motor de análisis:** determinístico en TS/Functions; sectorial vía API de
  Anthropic **con toggle** activar/desactivar por costo.
- **Solapas:** Tenencias · Concentración/foto (semáforos) · Rebalanceo
  (opciones medidas + riesgos) · Research sectorial · Benchmark vs CAFCI
  (diferido).
- **Métricas:** set completo (incluye HHI, top-3/5, drivers de riesgo,
  exposición cambiaria, clases de activo).
- **Semáforos:** bandas estándar (UCITS 5/10/40, HHI DOJ), ajustables.
  **% RV sin semáforo** (es descriptivo, no un límite).
- **Historial fechado** desde el día uno.

---

## 6. Estado actual y próximos pasos

**Hecho:** diseño y decisiones cerradas; contrato `CLAUDE-PATRIMONIO.md`.

**Próximo, en orden:**
1. Crear la carpeta `docs/patrimonio/` en el repo y volcar estos archivos +
   puntero desde `docs/CLAUDE.md`.
2. **Re-subir los resúmenes de cada cuenta (A5)** — no llegaron en la sesión de
   diseño. Con ellos: calibrar el prompt de extracción contra la forma real de
   cada fuente y documentar cada formato.
3. Confirmar micro-decisión #2 (app solo valida + confirma, sin re-edición
   campo a campo).
4. Definir fuente de cripto (exchange con export vs carga manual).
5. Pasar el contrato a Claude Code para el esqueleto: tipo `Posicion`, reglas
   de Firestore, vista `Patrimonio.tsx`, Functions de análisis.

---

## 7. Cómo mantener las dos cuentas alineadas

La memoria de Claude **no cruza entre cuentas**. La continuidad se mantiene por
el **repo**, no por memoria: la carpeta `docs/patrimonio/` es la fuente de
verdad versionada. Claude Code la lee directo; en un chat común se pega el
contenido. Al cerrar cada sesión con decisiones nuevas: actualizar este
`RESUMEN-SESION.md` y commitear.
