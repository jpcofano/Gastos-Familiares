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

`escalaData912` (`functions/src/preciosRespaldo.ts:71-74`):

```ts
if (tipo !== 'bono' && tipo !== 'on') return 1;
return escalaPPI ?? 100;
```

- **Bonos:** asume 100 → **coincide**.
- **ONs:** asume 100 → **coincide** en la única ON medida (TLCPO). Es un solo dato: otra ON podría
  publicarse distinto (no hay razón para pensarlo, pero no está medido).
- **Letras:** no hay un tipo `letra` (`PosicionTipo`, `functions/src/patrimonioPrecios.ts:10`). PPI
  mapea `LETRAS` a `bono` (`src/datos/compartido/clasificacionPPI.ts:20`); en Balanz y en la corrida
  el tipo lo pone el importador o la ingesta (supuesto: `bono`, no verificado para TZXM7). Si es
  `bono`, se busca en `arg_bonds` (`PANEL_POR_TIPO`, `patrimonioPrecios.ts:58`), donde está, y se
  divide por 100 → **coincide**.
- **Ojo con un detalle:** si PPI guardó una escala para la especie (`escalaPPI`), el código usa esa
  escala también para el precio de data912. Lo medido dice que data912 es siempre por 100 en bonos,
  letras y ONs, sin depender de lo que diga PPI. Si alguna especie tuviera `nominalInPrice` = 1 en
  PPI, el precio de data912 quedaría 100 veces alto (el test `functions/src/h2a.test.ts:215` fija
  justamente `escalaData912('on', 1) === 1`). La escala de PPI se guarda solo cuando data912 no trajo
  la especie y se usa el respaldo de PPI (`patrimonioPreciosCron.ts`, `respaldoPPI`), y después no
  vence: el riesgo es condicional, pero real. Con TLCPO no pasa, porque PPI también da 100. Lo más seguro sería
  que `escalaData912` devuelva 100 fijo para bonos y ONs y dejar la escala de PPI solo para el
  precio de PPI. Es una decisión para tomar: esta medición no cambia código.
