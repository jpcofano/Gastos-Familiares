# Patrimonio — Resumen de sesión (handoff)

> Archivo de continuidad. Se lee/pega al iniciar en cualquier cuenta de Claude
> para retomar sin perder contexto. Se actualiza y commitea al cerrar cada
> sesión con decisiones nuevas.
>
> Contrato completo y técnico: `CLAUDE-PATRIMONIO.md` (misma carpeta).

**Última actualización:** sesión con foto real (5 resúmenes al 01/07/2026).

---

## 0. Estado y próximo paso (leer primero)

Foto del patrimonio ya construida con **datos reales** (5 cuentas). Prompt de
extracción calibrado, `.txt` generado y JSON Schema listo. **Lo primero mañana:**
reconciliar la cripto (ver punto 2) y confirmar dos clasificaciones (VIST, BIOX).

Artefactos de esta sesión:
- `patrimonio-extraccion.md` — prompt fino (→ `docs/patrimonio/prompts/`).
- `patrimonio_2026-07-01.txt` — corrida con las 49 posiciones.
- `posicion.schema.json` — validación estricta (→ `docs/patrimonio/esquemas/`).

---

## 1. Qué es este proyecto

Módulo de análisis de patrimonio, como **vista privada** dentro de la app
**Gastos-Familiares** (React+Vite+TS PWA sobre Firebase), **aislado** de gastos
(colecciones propias, sin puente).

Objetivo: **mantener el valor medido en USD**, entendiendo el riesgo de cada
posición. El sistema **propone, mide y muestra riesgos**; no ordena ni alarma.

**Perfil (cerrado):** vara USD · horizonte 1–3 años · "crecer aunque oscile" ·
unidad = la familia como una sola entidad · tolerancia alta · no necesita
liquidez · opera afuera · tiene cuenta USD.

---

## 2. La foto del patrimonio (DATOS REALES al 01/07/2026)

**Total consolidado: ~USD 100.500.** (Sustituye estimaciones previas de 96k–111k.)

Por cuenta (contra el total que declara cada resumen):
- Balanz **402665** (Lascano y/o Cofano) — ~USD 29.676
- Balanz **1120830** (Cofano) — ~USD 12.415
- **PPI 101268** (Cofano y/o Lascano) — ~USD 36.970  *(= la vieja "Portfolio RAW")*
- **Nexo** (M. Lascano) — ~USD 6.340
- **Bitfinex** — ~USD 15.165

Por bucket:
- **Acciones AR: ~55%** (energía domina)
- **Cripto: ~21,4%** (USD 21.505)
- **Renta fija AR: ~16,8%** (CER en pesos + soberanos USD + 1 ON)
- FCI AR: ~3,4% · Global (CEDEARs): ~3,0% · Cash: ~0,3%

Por país: **~75,6% AR · ~21,4% cripto · ~3,0% global.**

**Energía AR: 48,7%** — el bloque dominante y el hallazgo central.

Top nombres (agregados por ticker, % del total):
- **TRAN 15,7%** · **ETH 11,3%** · **PAMP 10,9%** · **YPFD 10,0%** ·
  **BTC 8,2%** · **VIST 6,8%** · TZXM7 5,9% · TGSU2 3,5%

**Cripto en detalle (rompe el supuesto viejo de "50/50 BTC/ETH"):**
ETH 11.385 · BTC 8.224 · AAVE 1.291 · UNI 604 · USDT ~0.
→ Hay más ETH que BTC, y aparecen AAVE/UNI. **ETH es el 2º nombre más grande
de todo el patrimonio.**

**Nota metodológica clave:** el HHI por nombre da 0,081 (verde) porque hay ~30
posiciones que lo diluyen, pero energía AR (48,7%) y TRAN (15,7%) son rojo. Es la
razón de usar varias métricas: un HHI solo taparía la concentración sectorial.

---

## 3. PENDIENTES para mañana (decisiones que faltan)

1. **Cripto (importante):** los resúmenes documentan **USD 21.505**, no los 30k
   que se venían usando. ¿Hay otra billetera/exchange (cold wallet, etc.) fuera
   de Nexo y Bitfinex? Si sí → sumar esa fuente y regenerar el `.txt`. Si no →
   **~21,5k es el número oficial** (asumido como tal por ahora).
2. **VIST:** contado como **energía AR** (Vaca Muerta) aunque es CEDEAR.
   Confirmar. *(marcado revisar:true en el .txt)*
3. **BIOX / Bioceres:** clasificado **global/agro** aunque es agtech argentina.
   Confirmar país de riesgo. *(marcado revisar:true)*

---

## 4. Diagnóstico de riesgo (se mantiene con datos reales)

- El **tamaño** de renta variable (~76% entre acciones AR + cripto) es riesgo
  compensado y coherente con la postura. No es el problema.
- El problema es la **forma:** 48,7% en un solo sector de un solo país; cuatro
  nombres (TRAN, PAMP, YPFD, VIST) comparten los mismos riesgos (tarifa,
  regulación, macro AR, evento soberano). Es reducción de riesgo "gratis"
  (baja varianza sin bajar retorno esperado).
- En 1–3 años, una corrección fuerte de energía AR sobre base muy apreciada es
  el peor escenario. La cripto (21%) no es contrapeso: riesgo independiente y
  ahora se ve que ETH la hace aún más pesada de lo pensado.

---

## 5. Palancas de rebalanceo (lógica de la solapa "Rebalanceo")

Idea madre: **mantener el % en renta variable, cambiar su composición.**
1. Recortar primero los nombres únicos más grandes (TRAN, PAMP).
2. Separar dentro de energía reguladas (TRAN, TGS, ECOG) vs productoras
   (YPF, VIST, PAMP, CEPU).
3. Redesplegar a otros sectores AR casi ausentes (consumo, agro, materiales).
4. Sumar renta variable **global** (opera afuera, cuenta USD) — mayor impacto:
   baja riesgo-país sin bajar crecimiento.
Extra que surge de los datos: **definir la cripto a conciencia** (21% con ETH
sobreponderado es una decisión, no debería quedar por inercia).

Recordar al recomendar: no es asesoría matriculada; son ganadores en USD (costo
impositivo → gradual); parte está en cuentas conjuntas.

---

## 6. Decisiones de sistema (cerradas)

- **Arquitectura:** vista privada dentro de la app; colecciones propias
  (`posiciones`, `snapshotsPortafolio`, `informesPortafolio`); sin puente con
  gastos; visible solo para el admin/dueño.
- **Ingesta:** ventana de Claude aparte con prompt-de-pegar → `.txt` JSON → la
  app **solo valida + confirma** (sin reedición campo a campo). Sin auto-ingesta,
  sin parser por bróker, sin llamadas online en la app.
- **Conversión ARS→USD:** la hace la app vía `tcDiario` (fuente única). La
  extracción deja `moneda_origen` + `valor_origen`. Balanz/Nexo/Bitfinex ya
  vienen en USD; PPI viene en ARS.
- **Cripto:** entra como una fuente más del `.txt` (Nexo, Bitfinex).
- **Motor:** determinístico en TS/Functions; sectorial vía API con **toggle**
  activar/desactivar por costo.
- **Solapas:** Tenencias · Concentración/foto (semáforos) · Rebalanceo
  (opciones medidas + riesgos) · Research sectorial · Benchmark vs CAFCI
  (diferido).
- **Métricas:** set completo (top-1, sector, país, %RV, HHI, top-3/5, drivers
  de riesgo, exposición cambiaria, clases de activo).
- **Semáforos (bandas):** nombre 5/10 · sector 25/40 · país 40/60 ·
  cripto 10/20 · HHI 0,15/0,25. **%RV sin semáforo** (descriptivo).
- **Historial fechado** desde el día uno.
- **Docs:** anexo en `docs/patrimonio/`, puntero desde `docs/CLAUDE.md`.

---

## 7. Próximos pasos (post-pendientes)

1. Volcar los 4 artefactos a `docs/patrimonio/` (contrato, resumen, prompt,
   schema) + puntero en `docs/CLAUDE.md`.
2. Resolver los 3 pendientes del punto 3.
3. Pasar el contrato a Claude Code: tipo TS `Posicion`, reglas de Firestore de
   las colecciones nuevas, vista `Patrimonio.tsx`, Functions de análisis
   (determinísticas) + Function sectorial (API con toggle).
4. Validar los informes contra el `.txt` real antes de enchufar la vista.

---

## 8. Cómo mantener las dos cuentas alineadas

La memoria de Claude **no cruza entre cuentas**. La continuidad la da el **repo**:
`docs/patrimonio/` es la fuente de verdad versionada. Claude Code la lee directo;
en un chat común se pega el contenido. Al cerrar cada sesión con decisiones
nuevas: actualizar este archivo y commitear.
