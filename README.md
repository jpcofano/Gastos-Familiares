# Gastos Familiares

Sistema familiar de gestion de gastos sobre Firebase (Hosting + Auth + Firestore + Functions + Storage).

Migrado desde un sistema previo en Google Sheets + Apps Script.

## Fuente de verdad

Ver `docs/CLAUDE.md` para el contrato del proyecto, decisiones de arquitectura,
y reglas operativas.

## Setup rapido

```bash
npm install
firebase emulators:start          # terminal A
npm run seed                      # terminal B (contra emulador)
npm run validate                  # verifica totales contra el Excel
```

Para produccion ver `docs/CLAUDE.md` seccion "Como correr el seed contra produccion".
