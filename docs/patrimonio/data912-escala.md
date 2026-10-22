# Escala de data912 en bonos, letras y ONs (F9.196.1 §6.3)

**Pregunta:** ¿data912 publica bonos y ONs por 100 VN o por 1 VN?
**Respuesta:** por **100 VN**, en las siete especies medidas (bonos, letra y ON).

## Medición

- Cuándo: 21-oct-2026, 21:00 ART (`2026-10-22T00:00:33Z`).
- Cómo: `npx tsx scripts/verificarEscalaData912.ts`. Solo lectura, sin credenciales: dos pedidos
  (`/live/arg_bonds`, 206 símbolos, y `/live/arg_corp`, 645 símbolos), 15 s de timeout, sin reintentos.
- Campo usado: `c` (el último), el mismo con el que valúa el cron (`patrimonioPreciosCron.ts:150-154`).
- Referencia: Balanz, ARS por 1 VN, 21/10 a las 17:00-17:02.
- Criterio del factor (el del script): cociente data912 ÷ Balanz entre 50 y 200 → 100; entre 0,5 y 2
  → 1; fuera de eso, "raro".

| Especie | Tipo | Panel | data912 `c` | Balanz (1 VN) | data912 ÷ Balanz | Factor |
|---|---|---|---|---|---|---|
| GD30 | bono | arg_bonds | 87.770 | 877,7 | 100 | 100 |
| GD35 | bono | arg_bonds | 114.510 | 1.145,1 | 100 | 100 |
| DICP | bono | arg_bonds | 49.500 | 495 | 100 | 100 |
| TX26 | bono | arg_bonds | 760 | 7,6 | 100 | 100 |
| TZXM7 | letra | arg_bonds | 233,15 | 2,3315 | 100 | 100 |
| BPOC7 | bono | arg_bonds | 162.600 | 1.626 | 100 | 100 |
| TLCPO | ON | arg_corp | 173.520 | 1.735,2 | 100 | 100 |

Todas aparecieron, y cada una en un solo panel (los bonos y la letra en `arg_bonds`, la ON en
`arg_corp`). Ninguna dio 1 ni un factor raro. Esta vez los cocientes salieron exactos porque el
cierre de data912 coincidió con el precio de Balanz de las 17:00. Otro día el precio puede moverse
unos puntos; lo que importa es el factor (100), no el decimal.

## ¿El código asume bien la escala?

**Hoy (desde F9.196.1 Addendum 1 C):** `escalaData912(tipo)` (`functions/src/preciosRespaldo.ts:72`):

```ts
return tipo === 'bono' || tipo === 'on' ? 100 : 1;
```

Esto pasa por tipo:
- **Bonos:** 100, que **coincide** con lo medido.
- **ONs:** 100. **Coincide** en la única ON medida (TLCPO). Es un solo dato: otra ON podría
  publicarse distinto. No hay razón para pensarlo, pero no está medido.
- **Letras:** no hay un tipo `letra` (`PosicionTipo`, `functions/src/patrimonioPrecios.ts:10`).
  - PPI mapea `LETRAS` a `bono` (`src/datos/compartido/clasificacionPPI.ts:20`).
  - En Balanz y en la corrida, el tipo lo pone el importador o la ingesta. Se supone `bono`, pero no
    está verificado para TZXM7.
  - Si es `bono`, se busca en `arg_bonds` (`PANEL_POR_TIPO`, `patrimonioPrecios.ts:58`), donde está,
    y se divide por 100: **coincide**.

La escala de PPI (`nominalInPrice` / `escalaPPI`) se usa **solo** para el precio que viene de PPI
(`respaldoPPI` en `patrimonioPreciosCron.ts`). El test `functions/src/h2a.test.ts:215` fija
`escalaData912('on') === 100` y `escalaData912('bono') === 100`. El test `:216-219` comprueba que un
bono con `escalaPPI = 1` guardada no cambia el precio de data912.

### Antes del Addendum 1 C (histórico)

- El código hacía `return escalaPPI ?? 100` para bonos y ONs, o sea que usaba la escala de PPI
  también para el precio de data912.
- La escala de PPI se guardaba cuando data912 no traía la especie y se usaba el respaldo de PPI, y
  después no vencía. Si PPI hubiera dado `nominalInPrice` = 1 para un bono, el precio de data912
  habría quedado 100 veces alto.
- Esta medición mostró que data912 es siempre por 100, diga lo que diga PPI. Juan decidió fijarla
  en 100 (Addendum 1 C, 21/10/2026).
