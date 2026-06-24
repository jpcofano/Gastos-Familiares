# Logos de medios de pago

SVG oficiales de cada banco/billetera, servidos como estáticos (`/assets/medios/{id}.svg`)
y consumidos por `BankLogo` (`src/design-system/components/core/BankLogo.tsx`).

Nombrar por `id` del medio de pago (mismo `id` que `config/familia.bancos` /
`M_BANCOS` en los datos de ejemplo de Perfil → Medios de pago):

- `bbva.svg`
- `galicia.svg`
- `pp.svg` (Personal Pay)
- `mp.svg` (MercadoPago)

Si un archivo no existe (404), `BankLogo` cae automáticamente a un chip de color con
la inicial del nombre — no hace falta subir todos a la vez.
