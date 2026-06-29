# Logos de medios de pago

`BankLogo` (en `MobileShell.jsx`) busca acá el archivo del logo por **id**, probando
`.svg` → `.png` → `.webp`. Si no encuentra ninguno, cae al chip-monograma con el color
de marca definido en `M_BANCOS` (`data.jsx`). No dibujamos logos a mano: dejá los
**oficiales** acá con el nombre exacto del id.

| id        | medio          | archivo esperado            | dónde conseguir el oficial             |
|-----------|----------------|-----------------------------|----------------------------------------|
| `bbva`    | BBVA           | `bbva.svg`                  | brand.bbva.com / press kit             |
| `galicia` | Galicia        | `galicia.svg`               | banco galicia — recursos de marca      |
| `pp`      | Personal Pay   | `pp.svg`                    | personalpay.com.ar — prensa            |
| `mp`      | MercadoPago    | `mp.svg`                    | mercadopago — brand assets             |
| `efec`    | Efectivo       | (sin logo → monograma)      | —                                      |

Recomendado: SVG con padding propio, fondo transparente, ~1:1. Se renderiza dentro de
un cuadrado de 34px (radio 9) con `object-fit: contain` y fondo blanco.

Para sumar un medio nuevo: agregá la fila a `M_BANCOS` con su `id` + `color`, y soltá
`<id>.svg` en esta carpeta.
