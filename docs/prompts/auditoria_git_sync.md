# Auditoría git — dejar el remoto igual al local

> Ops, no feature. El remoto (GitHub) quedó en `07c33e4` (F6.4). Los commits locales F6.4.5 (`7d51c18`),
> F6.6 (`ed10eaf`) y el gitignore-fix (`295b229`) NO están pusheados. Hubo un `filter-repo` de por medio
> (reescritura de historia), así que el push no es trivial. Objetivo: diagnosticar por qué no sube y
> dejar el remoto idéntico al local, sin reintroducir los xlsx purgados.

## PASO 1 — Diagnóstico (reportá ANTES de pushear, NO fuerces nada todavía)
Corré y pegá la salida de TODO esto:
```bash
git remote -v
git status
git log --oneline -8
git fetch origin
git log --oneline origin/main -5
git rev-list --left-right --count origin/main...HEAD   # divergencia: <atras> <adelante>
git log --all --oneline -- '*.xlsx'                     # DEBE dar vacío
git rev-list --all --objects | grep -i '\.xlsx'         # DEBE dar vacío
git push origin main 2>&1 | tail -20                    # capturá el error EXACTO si rechaza
```

Interpretación esperada:
- **`origin` ausente** → `filter-repo` lo borró. Re-agregar: `git remote add origin
  https://github.com/jpcofano/Gastos-Familiares.git` y volver a correr el diagnóstico.
- **Divergencia (algo "atrás" Y algo "adelante")** → local y remoto divergieron en la reescritura. Un push
  normal se rechaza. Es esperado tras `filter-repo`.
- **Los dos greps de xlsx dan vacío** → la historia local está limpia (sin las planillas). Condición
  NECESARIA para poder forzar sin reintroducir data.

**Pará y reportá. No sigas a PASO 2 hasta tener el diagnóstico claro.**

## PASO 2 — Sincronizar (con el diagnóstico OK)
Solo si: (a) los greps de xlsx dieron vacío en local, y (b) confirmaste que la historia local es la
correcta (tiene el purge + F6.4.5 + F6.6).

- Si el rechazo es por divergencia de la reescritura → **force push** (la historia local es la fuente de
  verdad):
  ```bash
  git push --force-with-lease origin main
  ```
  Usar `--force-with-lease` (no `--force` pelado): aborta si el remoto cambió de forma inesperada desde el
  último fetch, evitando pisar algo que no viste.
- Si NO hay divergencia y solo faltaba pushear commits nuevos → `git push origin main` normal alcanza.

## PASO 3 — Verificar que quedó igual
```bash
git fetch origin
git rev-parse HEAD
git rev-parse origin/main          # deben coincidir
git log --oneline origin/main -5   # debe mostrar F6.4.5 (7d51c18) y F6.6 (ed10eaf) arriba
```
Confirmá:
- `HEAD == origin/main` (mismo SHA).
- El remoto muestra F6.4.5 y F6.6.
- Re-verificar en remoto que no hay xlsx: el grep de `*.xlsx` sigue vacío tras el push.

## Reglas
- NO `git push --force` pelado. Siempre `--force-with-lease`.
- NO pushear si los greps de xlsx en local dan algo (estarías reintroduciendo la data purgada). En ese
  caso, parar y reportar — hay que limpiar local primero.
- Reportá la salida de cada paso; no asumas que el push se efectuó sin ver `HEAD == origin/main`.
