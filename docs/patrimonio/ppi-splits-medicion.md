# PPI: splits y costo sospechoso (F9.196.1 §5): medición

**Fecha:** 21/10/2026, a la noche (ART). **Script:** `npx tsx scripts/medirSplitsPPI.ts`. Es de solo lectura: usa la lista blanca de `scripts/ppiCliente.ts` y no imprime credenciales, tokens ni el número de cuenta. Los crudos quedan en `data/ppi-splits/`, fuera de git. Acá no se copian tenencias ni montos.

## Qué se midió

Tres años de `Account/Movements` (167 filas desde el 23/10/2023), más `Account/BalancesAndPositions`.

### Filas `Split / <t>` en los tres años

Son cinco. La especie sale del **texto**: el campo `ticker` de esas filas viene equivocado (trae bonos de la cartera).

| Fecha | Texto | Campo `ticker` |
|---|---|---|
| 22/11/2024 | `Split / CEPU` | GD30 |
| 22/11/2024 | `Split / CEPU` | GD35 |
| 22/11/2024 | `Split / CEPU` | BPOC7 |
| 22/11/2024 | `Split / CEPU` | BPOD7 |
| 22/12/2025 | `Split / TXAR` | GD38 |

Ninguna de las cinco es de las especies con costo sospechoso.

### Especies con costo sospechoso

En las cuatro, el precio y `ppc` (costo promedio) son de `BalancesAndPositions`, en pesos por acción.

| Especie | Precio ÷ costo | Filas `Split / <t>` | Lectura |
|---|---|---|---|
| PAMP | 111,2 | 0 | Sin split. El costo es de compras en pesos nominales de hace más de 3 años (inflación); no hay movimientos de compra en la ventana. |
| TGSU2 | 110,8 | 0 | Igual que PAMP. |
| TRAN | 58,4 | 0 | Igual que PAMP. |
| YPFD | 5,08 | 0 | Ver abajo. |

**YPFD.** No hay ninguna fila `Split / YPFD`.
- Las compras de 2024–2025 son a $27.850–41.800 por acción, y hoy cotiza a $8.240. Probablemente hubo un split que PPI acreditó sin una fila `Split /`.
- Aun suponiendo un 10:1, ningún factor explica bien el 5,08:
  - costo ÷ 10 deja el cociente en 50,8;
  - costo × 10 lo deja en 0,51, dentro de la banda, pero pondría el costo en pesos de **antes** del split contra un precio de **después**. Daría un rendimiento falso de −49%.
- Lo más probable es que el `ppc` ya esté ajustado y mezcle compras viejas en pesos nominales (inflación) con las de 2024–2025.

## Conclusión (§5: "frená y reportá")

- **No hay factor de split medido** para ninguna de las cuatro especies, y el 5,08 de YPFD no lo explica un factor obvio. **No se escribió el detector** (`cuentasVivas/ppi.splits`, `costoAjustadoPorSplit`): sin filas de split, no tendría de dónde sacar el factor.
- Las cuatro **siguen `costoSospechoso`**, fuera de los cálculos de rendimiento, como hasta ahora.
- La causa de PAMP, TGSU2 y TRAN es la inflación sobre costos en pesos nominales, no un split. Ajustarlas pediría el costo en dólares de cada compra, que la API no trae en esta ventana.
- **Para decidir con Juan:**
  - si YPFD (y las otras tres) se dejan sospechosas;
  - o si se carga a mano un costo en USD por especie (desde los comprobantes del broker).
