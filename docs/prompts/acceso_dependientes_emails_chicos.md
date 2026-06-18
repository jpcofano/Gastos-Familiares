# F6.x — Acceso de dependientes (cargar emails de Federico y Sofía)

> Federico y Sofía ya existen como miembros en `config/familia.miembros` (con alias), pero sin email,
> así que no pueden loguearse y no aparecen en `/autorizados/`. Objetivo: cargarles el email de login
> de forma que `/autorizados/` y `config/familia.miembros.<chico>.emails` queden consistentes, derivados
> de una sola fuente.

## Contexto (verificado en el repo)
- `scripts/seed/transformers/config.ts` (`seedConfig`) arma `config/familia.miembros` agrupando
  `data.usuarios` por `Persona`; pushea `Email` solo si existe.
- `scripts/seed/transformers/autorizados.ts` (`seedAutorizados`) crea `/autorizados/{email}` con
  `{ memberId: u.Persona, rol: u.Rol === 'admin' ? 'admin' : 'dependiente' }`, y **saltea filas sin
  email** (`if (!u.Email) continue`).
- Ambos leen de `data.usuarios`. Los chicos tienen fila (aparecen en `miembros` con alias) pero sin
  `Email` → de ahí el problema.

## Decisión (A-over-B)
- **A (elegida):** inyectar los emails en `data.usuarios` en el **orquestador del seed** (`seed.ts`),
  después de leer el Excel y antes de correr los transformers. Así `seedConfig` y `seedAutorizados`
  derivan ambos del mismo array — una sola fuente, sin tocar ningún transformer.
- **B (rechazada):** escribir los docs de `autorizados` y parchear `miembros.emails` por separado
  (dos escrituras independientes que pueden divergir — es justo el desdoblamiento de rol que queremos
  evitar).

## Cambio

### `scripts/seed/seed.ts` — override de emails antes de los transformers

```ts
// Emails de login de los dependientes. COMPLETAR con las cuentas Google reales.
// Las claves deben coincidir EXACTAMENTE con el `Persona` ya usado en config/familia.miembros
// (verificar contra los miembros existentes — probablemente 'Federico' y 'Sofía' con acento).
const EMAILS_DEPENDIENTES: Record<string, string> = {
  'Federico': 'COMPLETAR_federico@gmail.com',
  'Sofía':    'COMPLETAR_sofia@gmail.com',
};

function inyectarEmailsDependientes(data: SheetData): void {
  for (const [persona, email] of Object.entries(EMAILS_DEPENDIENTES)) {
    if (email.startsWith('COMPLETAR_')) {
      throw new Error(`Falta completar el email de ${persona} en EMAILS_DEPENDIENTES`);
    }
    const fila = data.usuarios.find(u => u.Persona === persona);
    if (fila) {
      fila.Email  = email.toLowerCase();
      fila.Activo = true;
      fila.Rol    = fila.Rol === 'admin' ? 'admin' : 'dependiente';
    } else {
      // Si no hay fila para esa persona, crear una mínima de dependiente.
      data.usuarios.push({ Persona: persona, Email: email.toLowerCase(), Activo: true, Rol: 'dependiente' } as any);
    }
  }
}
```

Llamar `inyectarEmailsDependientes(data)` justo **después** de leer el Excel y **antes** de
`seedConfig` / `seedAutorizados`. Adaptar a la firma real de `SheetData.usuarios` (verificar nombres
de campo: `Persona`, `Email`, `Activo`, `Rol`).

## Reglas / convenciones a respetar
- Idempotente: re-correr el seed re-aplica los mismos emails (sin duplicar — `autorizados` se escribe
  por id = email; `miembros.emails` se reconstruye desde cero en cada seed).
- **Seguridad del seed:** correr primero contra el **emulador** (default). Para producción, usar el
  guard existente (`--target=production --i-am-sure`). No tocar `serviceAccountKey.json` (gitignored).
- Las claves de `EMAILS_DEPENDIENTES` deben matchear el `Persona` exacto de los miembros existentes;
  verificar contra `config/familia.miembros` antes de correr (no asumir casing/acento).

## Criterios de cierre
- `/autorizados/` pasa de 4 a 6 docs; los dos nuevos con `{ memberId: 'Federico'|'Sofía',
  rol: 'dependiente' }` y el email como id (lowercase).
- `config/familia.miembros.Federico.emails` y `.Sofía.emails` incluyen el email cargado.
- **Prueba en vivo (la que de verdad cierra):** loguearse con la cuenta de un chico → ve
  "Mis movimientos" (solo lo suyo), puede crear un consumo propio, y NO ve el dashboard completo,
  ResumenMes ni /tarjetas. Esto confirma que reglas + UI coinciden en runtime, no solo que los docs
  existen.

## Nota
- No inventar emails: los placeholders `COMPLETAR_` hacen fallar el seed a propósito si no se cargaron.
- Esto es data, no cambia el modelo de acceso (que ya estaba implementado en UI + reglas + seed).
