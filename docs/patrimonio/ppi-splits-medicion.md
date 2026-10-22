# PPI: splits y costo sospechoso (F9.196.1 §5), medición

**Fecha:** 21/10/2026 a la noche, ART (repetida después de la revisión).
**Script:** `npx tsx scripts/medirSplitsPPI.ts`.
- Es de solo lectura: usa la lista blanca de `scripts/ppiCliente.ts`.
- No imprime credenciales, tokens ni el número de cuenta.
- Los crudos quedan en `data/ppi-splits/`, fuera de git. Ojo: `data/` está dentro de OneDrive, así que se sincroniza a la nube.
- Acá no se copian tenencias, montos ni precios absolutos: solo cocientes.

## Qué se midió

- 3 años de `Account/Movements`: 167 filas desde el 23/10/2023. El script corta si la respuesta no es 200.
- `Account/BalancesAndPositions`.

**Controles del formato:**
- Las filas de split se buscan sin distinguir mayúsculas (`/^\s*split\b/i`).
- Se listan las descripciones que el clasificador de producción (`clasificarDescripcionPPI`) no reconoce, y las que dicen "desdoblamiento", "cambio de VN", "canje" o "conversión de acciones".
- **Resultado:** 0 en los dos controles. No hay un split escrito de otra forma.

### Filas de split en la ventana

Hay cinco. La especie sale del **texto**, porque el campo `ticker` de esas filas viene equivocado: trae bonos de la cartera.

| Fecha | Texto | Campo `ticker` |
|---|---|---|
| 22/11/2024 | `Split / CEPU` | GD30 |
| 22/11/2024 | `Split / CEPU` | GD35 |
| 22/11/2024 | `Split / CEPU` | BPOC7 |
| 22/11/2024 | `Split / CEPU` | BPOD7 |
| 22/12/2025 | `Split / TXAR` | GD38 |

Ninguna es de las especies con costo sospechoso.

### Especies con costo sospechoso

El costo es `ppc` (en pesos, `ppc.currency = Pesos`) y el precio es el de `BalancesAndPositions`.

| Especie | Precio ÷ costo | Filas de split en la ventana | Movimientos de la especie en la ventana |
|---|---|---|---|
| PAMP | 111,2 | 0 | solo ventas |
| TGSU2 | 110,8 | 0 | ventas y dividendos |
| TRAN | 58,4 | 0 | ventas y dividendos |
| YPFD | 5,08 | 0 | compras en 2024–2025 y ventas en oct-2026 |

**PAMP, TGSU2 y TRAN.** No hay compras ni splits en la ventana. El costo viene de antes de oct-2023. Puede ser costo en pesos nominales viejos (inflación) o un split anterior a la ventana; `ppi-api-exploracion.md` ya decía que el `ppc` "parece arrastrar escala de antes de splits". **La medición no puede distinguir entre las dos causas.**

**YPFD: inexplicado.**
- Las compras de la ventana (2024–2025) fueron a precios entre 3,4 y 5 veces el de hoy.
- Las ventas de octubre de 2026 suman muchas más acciones que las compradas en la ventana.
- El `ppc` queda por debajo de todas las compras de la ventana, aun dividido por 10.

Todo eso indica un cambio de escala (un split acreditado sin fila `Split /`, o en una fecha que la API no muestra). No hay ningún dato que diga el factor.

Ningún factor obvio deja el costo bien:
- con costo ÷ 10, el cociente queda en ~51;
- con costo × 10 queda en ~0,5, dentro de la banda, pero sin ninguna base: es un número elegido para que entre, no medido.

## Conclusión (§5: "frená y reportá")

- **No hay factor de split medido** para ninguna de las cuatro especies, y el 5,08 de YPFD no lo explica ningún dato. **No se escribió el detector** (`cuentasVivas/ppi.splits`, `costoAjustadoPorSplit`): sin filas de split no tendría de dónde sacar el factor.
- Las cuatro **siguen `costoSospechoso`** y quedan fuera de los cálculos de rendimiento, como hasta ahora.
- **Para decidir con Juan:** se puede dejarlas así, o cargar a mano un costo en USD por especie, sacado de los comprobantes del broker. Para YPFD conviene preguntarle a PPI por el cambio de escala.
- **Límite de la medición:** solo cubre 3 años. No descarta splits anteriores a oct-2023.
