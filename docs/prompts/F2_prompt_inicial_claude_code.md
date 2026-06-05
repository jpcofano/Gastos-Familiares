# Prompt inicial para Claude Code — Sistema de Gastos Familiares (Firebase)

## Contexto

Este es el primer prompt de implementación del repo nuevo `Gastos-Familiares`.
La arquitectura completa fue decidida previamente en sesiones de diseño. Este
prompt cubre **F0 (setup del repo) + F2 (script de seed Sheets → Firestore)**.
La F1 (modelo de datos) ya está reflejada en el código y las Rules de este prompt.

**Trabajo bajo el siguiente contrato:**

1. Antes de tocar cualquier archivo, leé este prompt entero hasta el final.
2. Cuando lo entiendas, **decime tu plan en prosa antes de crear archivos**. Confirmo
   o ajusto antes de que arranques.
3. Una vez aprobado el plan, creá los archivos en el orden que indica la sección
   "Orden de creación".
4. **NO** corras `npm install`, `npm run seed`, ni `firebase deploy` por iniciativa
   propia. Yo corro esos comandos manualmente desde la terminal.
5. Si encontrás ambigüedades en el prompt, paráme y preguntá. No supongas.
6. Convención de commits: un commit por tarea numerada, mensaje en castellano.
   Yo decido cuándo commitear, no commitees por iniciativa propia.

---

## Carpeta de trabajo

`C:\Users\20243359679\OneDrive\Documentos\AppsScript\Gastos-Familiares`

El repo ya está clonado vacío desde `https://github.com/jpcofano/Gastos-Familiares.git`.
Pueden no existir aún `.gitignore`, `package.json`, etc. — los vas a crear vos.

---

## Estructura del repo a crear

```
Gastos-Familiares/
├── .firebaserc
├── .gitignore
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
├── package.json
├── tsconfig.json
├── README.md
│
├── docs/
│   ├── CLAUDE.md                  # contrato del proyecto (fuente de verdad)
│   ├── prompts/                   # vacía, .gitkeep
│   │   └── .gitkeep
│   └── sesiones/                  # vacía, .gitkeep
│       └── .gitkeep
│
├── scripts/
│   └── seed/
│       ├── seed.ts                # entry point
│       ├── readExcel.ts           # lector del .xlsx
│       ├── transformers/
│       │   ├── config.ts
│       │   ├── subcategorias.ts
│       │   ├── etiquetas.ts
│       │   ├── normalizationRules.ts
│       │   ├── tcDaily.ts
│       │   ├── dictionary.ts
│       │   ├── expectedItems.ts
│       │   ├── cardStatements.ts
│       │   └── movements.ts
│       ├── validators/
│       │   ├── runValidations.ts
│       │   └── checks.ts
│       └── utils/
│           ├── firestore.ts       # cliente Admin SDK
│           ├── hash.ts            # SHA-256 helpers
│           └── normalize.ts       # aplicar normalizationRules
│
├── data/
│   └── .gitkeep                   # el .xlsx lo copio yo después
│
├── secrets/
│   └── .gitkeep                   # serviceAccountKey.json va acá (gitignored)
│
└── src/                           # frontend, vacío por ahora
    └── .gitkeep
```

---

## Orden de creación

Importante: el orden minimiza errores de "archivo no encontrado" cuando hago
`npm install`. Andá en este orden:

1. **Raíz**: `.gitignore`, `package.json`, `tsconfig.json`, `README.md`,
   `.firebaserc`, `firebase.json`, `firestore.rules`, `firestore.indexes.json`.
2. **docs/**: `docs/CLAUDE.md`, y los dos `.gitkeep` en `docs/prompts/` y `docs/sesiones/`.
3. **data/**, **secrets/**, **src/**: los tres `.gitkeep`.
4. **scripts/seed/utils/**: `firestore.ts`, `hash.ts`, `normalize.ts`.
5. **scripts/seed/**: `readExcel.ts`, `seed.ts`.
6. **scripts/seed/transformers/**: los 9 archivos (config, subcategorias, etiquetas, normalizationRules, tcDaily, dictionary, expectedItems, cardStatements, movements).
7. **scripts/seed/validators/**: `runValidations.ts`, `checks.ts`.

---

## Contenido literal de cada archivo

### `.gitignore`

```
node_modules/
dist/
.env
.env.*
secrets/*.json
secrets/serviceAccountKey*.json
*.log
.firebase/
.DS_Store
Thumbs.db
emulator-data/
```

### `.firebaserc`

Reemplazar `gastos-familiares` por el Project ID real de Firebase (yo lo paso
en el chat antes de que crees este archivo si es distinto).

```json
{
  "projects": {
    "default": "gastos-familiares"
  }
}
```

### `package.json`

```json
{
  "name": "gastos-familiares",
  "version": "0.1.0",
  "private": true,
  "description": "Sistema familiar de gestion de gastos sobre Firebase",
  "scripts": {
    "seed":      "tsx scripts/seed/seed.ts --target=emulator",
    "seed:prod": "tsx scripts/seed/seed.ts --target=production",
    "seed:dry":  "tsx scripts/seed/seed.ts --target=emulator --dry-run",
    "validate":  "tsx scripts/seed/validators/runValidations.ts",
    "emulators": "firebase emulators:start --import=./emulator-data --export-on-exit"
  },
  "devDependencies": {
    "firebase-admin": "^12.0.0",
    "xlsx":           "^0.18.5",
    "tsx":            "^4.7.0",
    "typescript":     "^5.3.0",
    "@types/node":    "^20.0.0"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "isolatedModules": true
  },
  "include": ["scripts/**/*.ts", "src/**/*.ts"],
  "exclude": ["node_modules", "dist", "emulator-data"]
}
```

### `README.md`

```markdown
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
```

### `firebase.json`

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }],
    "headers": [
      {
        "source": "**",
        "headers": [
          { "key": "Cross-Origin-Opener-Policy",  "value": "same-origin-allow-popups" },
          { "key": "Cross-Origin-Embedder-Policy","value": "unsafe-none" }
        ]
      }
    ]
  },
  "emulators": {
    "auth":      { "port": 9099 },
    "firestore": { "port": 8080 },
    "functions": { "port": 5001 },
    "ui":        { "enabled": true, "port": 4000 }
  }
}
```

### `firestore.rules`

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }
    function userDoc()    { return get(/databases/$(database)/documents/users/$(request.auth.uid)); }
    function isAdmin()    { return isSignedIn() && userDoc().data.rol == 'admin'; }
    function memberId()   { return userDoc().data.memberId; }
    function isOwnPersona()   { return request.resource.data.persona == memberId(); }
    function readOwnPersona() { return resource.data.persona == memberId(); }

    match /config/{doc} {
      allow read:  if isSignedIn();
      allow write: if false;
    }

    match /users/{uid} {
      allow read, write: if isSignedIn() && request.auth.uid == uid;
    }

    match /movements/{id} {
      allow read:   if isAdmin() || (isSignedIn() && readOwnPersona());
      allow create: if isAdmin() || (isSignedIn() && isOwnPersona());
      allow update, delete: if isAdmin();
    }

    match /cardStatements/{id} {
      allow read, write: if isAdmin();
    }

    match /expectedItems/{id} {
      allow read, write: if isAdmin();
    }

    match /dictionary/{id} {
      allow read: if isSignedIn();
      allow create, update: if isAdmin() || (isSignedIn() && request.resource.data.origen == 'Manual');
      allow delete: if isAdmin();
    }

    match /tcDaily/{id} {
      allow read:  if isSignedIn();
      allow write: if false;
    }

    match /subcategorias/{id} {
      allow read:  if isSignedIn();
      allow write: if false;
    }

    match /etiquetas/{id} {
      allow read:  if isSignedIn();
      allow write: if false;
    }

    match /normalizationRules/{id} {
      allow read:  if isAdmin();
      allow write: if false;
    }
  }
}
```

### `firestore.indexes.json`

```json
{
  "indexes": [
    { "collectionGroup": "movements", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "mes",    "order": "ASCENDING" },
      { "fieldPath": "tipo",   "order": "ASCENDING" }
    ]},
    { "collectionGroup": "movements", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "persona", "order": "ASCENDING" },
      { "fieldPath": "mes",     "order": "ASCENDING" }
    ]},
    { "collectionGroup": "movements", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "persona", "order": "ASCENDING" },
      { "fieldPath": "mes",     "order": "ASCENDING" },
      { "fieldPath": "tipo",    "order": "ASCENDING" }
    ]},
    { "collectionGroup": "movements", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "cardStatementId", "order": "ASCENDING" },
      { "fieldPath": "fecha",           "order": "ASCENDING" }
    ]},
    { "collectionGroup": "movements", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "mes",              "order": "ASCENDING" },
      { "fieldPath": "incluirResumenMes","order": "ASCENDING" }
    ]},
    { "collectionGroup": "movements", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "mes",         "order": "ASCENDING" },
      { "fieldPath": "excluirDash", "order": "ASCENDING" },
      { "fieldPath": "tipo",        "order": "ASCENDING" }
    ]},
    { "collectionGroup": "movements", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "mes",          "order": "ASCENDING" },
      { "fieldPath": "tipo",         "order": "ASCENDING" },
      { "fieldPath": "categoria",    "order": "ASCENDING" },
      { "fieldPath": "subcategoria", "order": "ASCENDING" }
    ]},
    { "collectionGroup": "dictionary", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "activo",   "order": "ASCENDING" },
      { "fieldPath": "usoCount", "order": "DESCENDING" }
    ]},
    { "collectionGroup": "expectedItems", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "activo", "order": "ASCENDING" },
      { "fieldPath": "tipo",   "order": "ASCENDING" }
    ]}
  ],
  "fieldOverrides": []
}
```

### `docs/CLAUDE.md`

```markdown
# Sistema de Gastos Familiares — Firebase

## Que es esto

Sistema familiar de gestion de gastos. Migrado desde Google Sheets + Apps Script
a Firebase (Hosting + Auth + Firestore + Functions + Storage). Fuente de verdad
unica: Firestore. Sheets queda archivado en read-only.

Cuatro usuarios reales: Juan y Maria (admins, login con Google), Federico y Sofia
(dependientes, login con Google propio, solo ven y cargan lo suyo).

## Estado actual

- Fase 0 — Setup: en curso (este commit).
- Fase 1 — Modelo de datos: cerrado.
- Fase 2 — Seed Sheets a Firestore: codigo listo, pendiente correr en produccion.
- Fase 3 — Auth + shell PWA: pendiente.
- Fase 4 — Vistas read-only (Dashboard, Resumen, pantalla de hijos): pendiente.
- Fase 5 — Flujos de escritura (Manual, Eventuales, Ingresos): pendiente.
- Fase 6 — Tarjetas + Comprobantes con Cloud Functions: pendiente.
- Fase 7 — Cutover y archivo del Sheet: pendiente.

## Decisiones cerradas

- Sheets se descarta como fuente. Firestore es source of truth unica.
- Plan Blaze con presupuesto de alerta US$5/mes.
- Seed-as-fresh-project: trabajamos como si nunca hubiera estado en prod.
- Stack frontend: Vite + React + TypeScript (mismo blueprint que sistema de comidas).
- Auth: Firebase Auth con signInWithPopup + GoogleAuthProvider.
  Whitelist en `/config/familia.miembros[*].emails`. Sin custom claims.
- Hijos se loguean. Read scope a su persona. Pueden crear, no editar ni borrar.
- Dict de aprendizaje global: lo que aprende cualquiera aplica para todos.
- Audit = solo timestamps (createdAt, updatedAt, creadoPor). Sin subcoleccion history.
- Naming: castellano camelCase para colecciones y campos.
- Etiquetas tecnicas (JuanARS, etc.) se convierten a persona + moneda en seed.

## Reglas operativas

- Seed contra emulador por default. `--target=production` requiere `--i-am-sure`.
- Toda query filtra por `mes` o usa `limit()`. Nunca query sin filtro temporal.
- Listeners `onSnapshot` solo donde el realtime aporta valor (carga sincronizada
  Juan-Maria). Dashboard y pantallas historicas: one-shot.
- Backup diario de Firestore a GCS configurado en F0.
- `serviceAccountKey.json` SIEMPRE gitignored. Si se filtra, Google revoca la key.

## Compromisos para fases posteriores

Estas mejoras quedan registradas pero no se implementan en F2:

- F3-F5: offline persistence (`enablePersistentLocalCache`), optimistic updates,
  onSnapshot en pantalla del mes.
- F4: aggregation queries (count, sum) en lugar de bajar docs.
- F6: transacciones atomicas para confirmar resumen, custom claims si Rules se sienten lentas.
- F0/F6: COOP/COEP headers en `firebase.json` (ya estan), TTL en `/temp/` de Storage,
  Cloud Scheduler para backup diario, tests de Security Rules con
  `@firebase/rules-unit-testing` antes de las Rules mismas.

## Trabajando con Claude Code

- Sesiones de arquitectura: en el Project de Claude.ai. Sesiones de implementacion:
  en VS Code con Claude Code.
- Mockup-before-code: cuando una pantalla cambia, dos alternativas con tradeoffs
  antes de implementar.
- Cambios a CLAUDE.md: mostrar diff antes de aplicar.
- Investigar primero, reportar findings, esperar aprobacion antes de tocar codigo.
- Commit por tarea numerada, mensaje en castellano, push al final cuando lo pida yo.
- Claude Code NO corre `npm install`, `npm run seed`, ni `firebase deploy` por
  iniciativa propia. Esos comandos los corro yo manualmente.

## Como correr el seed contra produccion

Solo despues de validar contra emulador. Pasos:

1. Verificar que `secrets/serviceAccountKey.json` existe y esta gitignored.
2. `npm run seed:prod -- --i-am-sure`
3. `npm run validate -- --target=production`
4. Confirmar que los 8 validators dan verde.

Si algun validator falla, no avanzar a F3. Diagnosticar primero.

## Modelo de datos

Colecciones:
- `/config/familia` (doc unico): miembros, categorias, bancos, tarjetas.
- `/subcategorias/{id}`: 92 docs.
- `/etiquetas/{id}`: 13 docs (las tecnicas se descartan).
- `/normalizationRules/{id}`: 7 reglas.
- `/tcDaily/{YYYY-MM-DD}`: 147+ docs, escritura solo desde Function.
- `/users/{uid}`: 1 doc por usuario logueado.
- `/movements/{id}`: ~1013 docs iniciales, source of truth de movimientos.
- `/cardStatements/{id}`: 14 docs iniciales, cabeceras de resumenes.
- `/expectedItems/{id}`: 24 docs (20 gastos + 4 ingresos), unificada con `tipo`.
- `/dictionary/{id}`: 412 entradas de aprendizaje, dict global.

Ver `scripts/seed/transformers/*.ts` para schemas completos y logica de migracion.

## Estructura del repo

- `docs/CLAUDE.md` — este archivo. Fuente de verdad.
- `docs/prompts/` — prompts iniciales de cada sesion con Claude Code.
- `docs/sesiones/` — resumenes de sesion al cerrar cada fase.
- `scripts/seed/` — script de migracion Sheets a Firestore.
- `data/` — snapshots .xlsx versionados.
- `secrets/` — service account JSON (gitignored).
- `src/` — frontend (vacio hasta F3).
- `firestore.rules` — Security Rules.
- `firestore.indexes.json` — indices compuestos.
- `firebase.json` — config de Hosting + Emulators + Headers.
```

### `scripts/seed/utils/firestore.ts`

```typescript
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

export function getDb(target: 'emulator' | 'production'): Firestore {
  if (getApps().length > 0) return getFirestore();

  if (target === 'emulator') {
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    initializeApp({ projectId: 'gastos-familiares' });
  } else {
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
                 || './secrets/serviceAccountKey.json';
    initializeApp({ credential: cert(keyPath) });
  }

  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  return db;
}

export async function writeBatch(db: Firestore, collection: string, docs: { id: string; [k: string]: any }[]) {
  const BATCH_SIZE = 400;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + BATCH_SIZE)) {
      const { id, ...rest } = doc;
      batch.set(db.collection(collection).doc(id), rest);
    }
    await batch.commit();
  }
}
```

### `scripts/seed/utils/hash.ts`

```typescript
import { createHash } from 'crypto';

export function sha256Hex(...parts: (string | number | null | undefined)[]): string {
  const h = createHash('sha256');
  for (const p of parts) h.update(String(p ?? ''));
  return h.digest('hex');
}
```

### `scripts/seed/utils/normalize.ts`

```typescript
export interface NormRule {
  tipo: 'prefix' | 'suffix' | 'replace' | 'regex';
  patron: string;
  reemplazo: string;
}

export function normalizar(s: string, rules: NormRule[]): string {
  if (!s) return s;
  let out = s;
  for (const r of rules) {
    if (!out) break;
    switch (r.tipo) {
      case 'prefix':
        if (out.startsWith(r.patron)) out = (r.reemplazo + out.slice(r.patron.length)).trim();
        break;
      case 'suffix':
        if (out.endsWith(r.patron)) out = (out.slice(0, -r.patron.length) + r.reemplazo).trim();
        break;
      case 'replace':
        out = out.split(r.patron).join(r.reemplazo).trim();
        break;
      case 'regex':
        try { out = out.replace(new RegExp(r.patron, 'gi'), r.reemplazo).trim(); }
        catch { /* regex invalido, ignorar */ }
        break;
    }
  }
  return out;
}
```

### `scripts/seed/readExcel.ts`

```typescript
import * as XLSX from 'xlsx';

export interface SheetData {
  historico:            any[];
  tcDiario:             any[];
  tarjetasResumen:      any[];
  gastosEsperados:      any[];
  ingresosEsperados:    any[];
  diccionarioAprendido: any[];
  diccionario:          any[];
  diccionarioNorm:      any[];
  usuarios:             any[];
}

export function readExcel(path: string): SheetData {
  console.log(`   Leyendo ${path}...`);
  const wb = XLSX.readFile(path, { cellDates: true });

  const get = (name: string) => {
    const ws = wb.Sheets[name];
    if (!ws) throw new Error(`Hoja "${name}" no existe en el Excel`);
    return XLSX.utils.sheet_to_json(ws, { defval: null });
  };

  const data: SheetData = {
    historico:            get('Historico'),
    tcDiario:             get('TC_Diario'),
    tarjetasResumen:      get('Tarjetas_Resumen'),
    gastosEsperados:      get('GastosEsperados'),
    ingresosEsperados:    get('IngresosEsperados'),
    diccionarioAprendido: get('Diccionario_Aprendido'),
    diccionario:          get('Diccionario'),
    diccionarioNorm:      get('Diccionario_Normalizacion'),
    usuarios:             get('Usuarios'),
  };

  console.log(`   Historico: ${data.historico.length} filas`);
  console.log(`   TC_Diario: ${data.tcDiario.length} filas`);
  console.log(`   Tarjetas_Resumen: ${data.tarjetasResumen.length} filas`);
  console.log(`   Diccionario_Aprendido: ${data.diccionarioAprendido.length} filas\n`);
  return data;
}
```

### `scripts/seed/seed.ts`

```typescript
import { readExcel } from './readExcel';
import { getDb } from './utils/firestore';
import { seedConfig }             from './transformers/config';
import { seedSubcategorias }      from './transformers/subcategorias';
import { seedEtiquetas }          from './transformers/etiquetas';
import { seedNormalizationRules } from './transformers/normalizationRules';
import { seedTcDaily }            from './transformers/tcDaily';
import { seedDictionary }         from './transformers/dictionary';
import { seedExpectedItems }      from './transformers/expectedItems';
import { seedCardStatements }     from './transformers/cardStatements';
import { seedMovements }          from './transformers/movements';

interface Flags {
  target: 'emulator' | 'production';
  dryRun: boolean;
  excelPath: string;
}

function parseFlags(): Flags {
  const args = process.argv.slice(2);
  const target = args.includes('--target=production') ? 'production' : 'emulator';
  const dryRun = args.includes('--dry-run');
  const excelArg = args.find(a => a.startsWith('--excel='));
  const excelPath = excelArg
    ? excelArg.split('=')[1]
    : './data/2026-05-29_sheet_snapshot.xlsx';

  if (target === 'production' && !args.includes('--i-am-sure')) {
    console.error('ERROR: --target=production requiere flag --i-am-sure');
    console.error('       Esto previene correr el seed contra prod por accidente.');
    process.exit(1);
  }
  return { target, dryRun, excelPath };
}

async function main() {
  const flags = parseFlags();
  console.log(`\nSEED - target=${flags.target} dryRun=${flags.dryRun}`);
  console.log(`   Excel: ${flags.excelPath}\n`);

  const data = readExcel(flags.excelPath);
  const db = getDb(flags.target);

  await seedConfig(db, data, flags.dryRun);
  await seedSubcategorias(db, data, flags.dryRun);
  await seedEtiquetas(db, data, flags.dryRun);
  await seedNormalizationRules(db, data, flags.dryRun);
  await seedTcDaily(db, data, flags.dryRun);
  await seedDictionary(db, data, flags.dryRun);
  await seedExpectedItems(db, data, flags.dryRun);
  await seedCardStatements(db, data, flags.dryRun);
  await seedMovements(db, data, flags.dryRun);

  console.log('\nSeed completo. Correr `npm run validate` para verificar totales.\n');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
```

### `scripts/seed/transformers/config.ts`

```typescript
import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';

const CATEGORIAS = [
  'Casa','Auto','Alimentación cotidiana','Salidas','Vacaciones y viajes',
  'Salud','Educación y chicos','Personal','Indumentaria','Impuestos y finanzas',
  'Transporte general','Ingresos','Tarjetas',
];

const BANCOS = ['BBVA','Galicia','Personal Pay','Efectivo'];

const TARJETAS = [
  { codigo: 'BBVA-VISA-SIG',   banco: 'BBVA',    tipo: 'Visa Signature',
    titular: 'Juan',  cuentaDebito: 'C.A. 0203124134' },
  { codigo: 'BBVA-MASTER-BLK', banco: 'BBVA',    tipo: 'Mastercard Black',
    titular: 'Juan',  cuentaDebito: 'C.A. 0203124134' },
  { codigo: 'GAL-VISA',        banco: 'Galicia', tipo: 'Visa',
    titular: 'Juan',  cuentaDebito: 'C.A. 0406142030' },
  { codigo: 'GAL-MASTER-BLK',  banco: 'Galicia', tipo: 'Mastercard Black',
    titular: 'María', cuentaDebito: 'C.A. 0406142034' },
];

export async function seedConfig(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> config/familia');

  const porPersona = new Map<string, { emails: string[]; rol: string; activo: boolean }>();
  for (const u of data.usuarios) {
    const persona = u.Persona;
    if (!persona) continue;
    const existing = porPersona.get(persona) ?? { emails: [], rol: u.Rol, activo: !!u.Activo };
    if (u.Email && typeof u.Email === 'string') existing.emails.push(u.Email.toLowerCase());
    porPersona.set(persona, existing);
  }

  const miembros: Record<string, any> = {};
  for (const [persona, info] of porPersona) {
    miembros[persona] = {
      nombre: persona,
      emails: info.emails,
      rol: info.rol === 'admin' ? 'admin' : 'dependiente',
      activo: info.activo,
    };
  }

  const familia = {
    miembros,
    categorias: CATEGORIAS,
    bancos: BANCOS,
    tarjetas: TARJETAS,
    actualizadoEn: FieldValue.serverTimestamp(),
  };

  console.log(`   Miembros: ${Object.keys(miembros).join(', ')}`);
  if (dryRun) return;
  await db.collection('config').doc('familia').set(familia);
  console.log('   OK\n');
}
```

### `scripts/seed/transformers/subcategorias.ts`

```typescript
import { Firestore } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { sha256Hex } from '../utils/hash';
import { writeBatch } from '../utils/firestore';

export async function seedSubcategorias(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> subcategorias');

  const docs = data.diccionario
    .filter(r => r.Tipo === 'Subcategoria' && r.Valor)
    .map(r => ({
      id: sha256Hex('subcat', r.Categoria ?? '', r.Valor).slice(0, 16),
      categoriaPadre: r.Categoria ?? null,
      valor: r.Valor,
      activo: r.Activo === true || r.Activo === 'VERDADERO',
    }));

  console.log(`   ${docs.length} subcategorias`);
  if (dryRun) return;
  await writeBatch(db, 'subcategorias', docs);
  console.log('   OK\n');
}
```

### `scripts/seed/transformers/etiquetas.ts`

```typescript
import { Firestore } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { sha256Hex } from '../utils/hash';
import { writeBatch } from '../utils/firestore';

const TECNICA_RE = /^(Juan|Mar[ií]a)(ARS|USD)$|^(Galicia|Frances|BBVA)\s+(Visa|Master)(ARS|USD)$/i;

export async function seedEtiquetas(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> etiquetas');

  const todasLasEtiq = data.diccionario.filter(r => r.Tipo === 'Etiqueta' && r.Valor);
  const funcionales = todasLasEtiq.filter(r => !TECNICA_RE.test(r.Valor));
  const tecnicas = todasLasEtiq.filter(r => TECNICA_RE.test(r.Valor));

  const docs = funcionales.map(r => ({
    id: sha256Hex('etiq', r.Valor).slice(0, 16),
    valor: r.Valor,
    activo: r.Activo === true || r.Activo === 'VERDADERO',
  }));

  console.log(`   ${docs.length} etiquetas funcionales`);
  console.log(`   ${tecnicas.length} tecnicas descartadas (se convierten en dict)`);
  if (dryRun) return;
  await writeBatch(db, 'etiquetas', docs);
  console.log('   OK\n');
}
```

### `scripts/seed/transformers/normalizationRules.ts`

```typescript
import { Firestore } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { writeBatch } from '../utils/firestore';

export async function seedNormalizationRules(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> normalizationRules');

  const docs = data.diccionarioNorm
    .filter(r => r.Activo === true || r.Activo === 'VERDADERO')
    .map((r, i) => ({
      id: `rule_${String(i).padStart(3,'0')}`,
      tipo: r.Tipo,
      patron: r.Patron,
      reemplazo: r.Reemplazo ?? '',
      activo: true,
      orden: i,
      notas: r.Notas ?? null,
    }));

  console.log(`   ${docs.length} reglas activas`);
  if (dryRun) return;
  await writeBatch(db, 'normalizationRules', docs);
  console.log('   OK\n');
}
```

### `scripts/seed/transformers/tcDaily.ts`

```typescript
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { writeBatch } from '../utils/firestore';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function seedTcDaily(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> tcDaily');

  const docs = data.tcDiario
    .filter(r => r.Fecha && r.TC_USDARS)
    .map(r => ({
      id: isoDate(r.Fecha as Date),
      tcUsdArs: Number(r.TC_USDARS),
      actualizadoEn: r.ActualizadoEn
        ? Timestamp.fromDate(r.ActualizadoEn as Date)
        : Timestamp.fromDate(r.Fecha as Date),
    }));

  console.log(`   ${docs.length} dias con TC`);
  if (dryRun) return;
  await writeBatch(db, 'tcDaily', docs);
  console.log('   OK\n');
}
```

### `scripts/seed/transformers/dictionary.ts`

```typescript
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { sha256Hex } from '../utils/hash';
import { normalizar, NormRule } from '../utils/normalize';
import { writeBatch } from '../utils/firestore';

const TECNICA_RE = /^(Juan|Mar[ií]a)(ARS|USD)$|^(Galicia|Frances|BBVA)\s+(Visa|Master)(ARS|USD)$/i;

interface Parsed {
  personaDefault: string | null;
  monedaDefault: 'ARS' | 'USD' | null;
  etiquetaNueva: string | null;
}

function parseEtiquetaTecnica(etiqOrig: string | null): Parsed {
  if (!etiqOrig) return { personaDefault: null, monedaDefault: null, etiquetaNueva: null };
  const e = etiqOrig.trim();
  if (!TECNICA_RE.test(e)) {
    return { personaDefault: null, monedaDefault: null, etiquetaNueva: e };
  }
  let persona: string | null = null;
  if (/^Juan/i.test(e)) persona = 'Juan';
  else if (/^Mar[ií]a/i.test(e)) persona = 'María';
  const moneda: 'ARS' | 'USD' = /USD$/i.test(e) ? 'USD' : 'ARS';
  return { personaDefault: persona, monedaDefault: moneda, etiquetaNueva: null };
}

export async function seedDictionary(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> dictionary');

  const rules: NormRule[] = data.diccionarioNorm
    .filter(r => r.Activo === true || r.Activo === 'VERDADERO')
    .map(r => ({ tipo: r.Tipo, patron: r.Patron, reemplazo: r.Reemplazo ?? '' }));

  let convertidos = 0;
  const docs = data.diccionarioAprendido.map(r => {
    const patronOriginal = r.PatronOriginal ?? r.Patron;
    const patron = r.Patron ? normalizar(r.Patron, rules) : patronOriginal;

    const { personaDefault: personaParsed, monedaDefault, etiquetaNueva }
      = parseEtiquetaTecnica(r.Etiqueta);

    if (etiquetaNueva === null && r.Etiqueta) convertidos++;

    const id = sha256Hex(
      'dict',
      patron ?? '',
      etiquetaNueva ?? '',
      personaParsed ?? r.PersonaDefault ?? '',
      r.Origen ?? ''
    ).slice(0, 24);

    return {
      id,
      patron,
      patronOriginal,
      tipoMatch: (r.TipoMatch === 'contains' ? 'contains' : 'exact') as 'exact' | 'contains',
      descripcionLimpia: r.DescripcionLimpia ?? r.DescripcionNormalizada ?? null,
      categoria:    r['Categoría'] ?? r.Categoria ?? null,
      subcategoria: r.Subcategoria ?? null,
      etiqueta:     etiquetaNueva,
      personaDefault: personaParsed ?? r.PersonaDefault ?? null,
      monedaDefault,
      bancoFiltro:   r.BancoFiltro ?? null,
      tarjetaFiltro: r.TarjetaFiltro ?? null,
      confianza:     typeof r.Confianza === 'number' ? r.Confianza : 0.9,
      accionDefault: r.AccionDefault ?? '',
      usoCount:      typeof r.UsoCount === 'number' ? r.UsoCount : 0,
      ultimoUso:     r.UltimoUso ? Timestamp.fromDate(r.UltimoUso as Date) : null,
      activo:        r.Activo === true || r.Activo === 'VERDADERO',
      origen:        r.Origen ?? 'Tarjeta',
      creadoPor:     r.CreadoPor ?? 'Sistema',
      createdAt:     r.CreadoEn ? Timestamp.fromDate(r.CreadoEn as Date) : Timestamp.now(),
      notas:         r.Notas ?? null,
    };
  });

  console.log(`   ${docs.length} entradas`);
  console.log(`   ${convertidos} con etiqueta tecnica convertida a persona+moneda`);
  if (dryRun) return;
  await writeBatch(db, 'dictionary', docs);
  console.log('   OK\n');
}
```

### `scripts/seed/transformers/expectedItems.ts`

```typescript
import { Firestore } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { sha256Hex } from '../utils/hash';
import { writeBatch } from '../utils/firestore';

function buildItem(r: any, tipo: 'Gasto' | 'Ingreso') {
  const id = sha256Hex(
    'exp',
    tipo,
    r.Categoria ?? r['Categoría'] ?? '',
    r.Subcategoria ?? '',
    r.Persona ?? '',
    r.Moneda ?? 'ARS'
  ).slice(0, 20);

  return {
    id,
    tipo,
    activo: r.Activo === true || r.Activo === 'VERDADERO',
    categoria: r.Categoria ?? r['Categoría'] ?? null,
    subcategoria: r.Subcategoria ?? null,
    etiqueta: r.Etiqueta ?? null,
    persona: r.Persona ?? null,
    moneda: (r.Moneda === 'USD' ? 'USD' : 'ARS') as 'ARS' | 'USD',
    banco: r.Banco ?? null,
    montoEsperado: typeof r.MontoEsperado === 'number' ? r.MontoEsperado : null,
    diaVencimiento: typeof r.DiaVencimiento === 'number' ? r.DiaVencimiento : null,
    autoCalendar: false,
    notas: r.Notas ?? null,
  };
}

export async function seedExpectedItems(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> expectedItems');
  const gastos    = data.gastosEsperados.map(r => buildItem(r, 'Gasto'));
  const ingresos  = data.ingresosEsperados.map(r => buildItem(r, 'Ingreso'));
  const docs = [...gastos, ...ingresos];
  console.log(`   ${gastos.length} gastos + ${ingresos.length} ingresos = ${docs.length} items`);
  if (dryRun) return;
  await writeBatch(db, 'expectedItems', docs);
  console.log('   OK\n');
}
```

### `scripts/seed/transformers/cardStatements.ts`

```typescript
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { writeBatch } from '../utils/firestore';

function periodoYYYYMM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

export async function seedCardStatements(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> cardStatements');

  const docs = data.tarjetasResumen
    .filter(r => r.ResumenID)
    .map(r => ({
      id: r.ResumenID,
      tarjetaCodigo: r.TarjetaCodigo,
      banco: r.Banco,
      tarjeta: r.Tarjeta,
      periodo: r.MesResumen ? periodoYYYYMM(r.MesResumen as Date) : '',
      fechaCierre: r.FechaCierre
        ? Timestamp.fromDate(r.FechaCierre as Date) : null,
      fechaVencimiento: r.FechaVencimiento
        ? Timestamp.fromDate(r.FechaVencimiento as Date) : null,
      totalARS: Number(r.TotalARS ?? 0),
      totalUSD: Number(r.TotalUSD ?? 0),
      pagoMinimoARS: Number(r.PagoMinimoARS ?? 0),
      cuentaDebito: r.CuentaDebitoDetalle ?? null,
      hashPDF: r.HashPDF ?? null,
      pdfStorageRef: null,
      parsedAt:     r.ImportadoEn
        ? Timestamp.fromDate(r.ImportadoEn as Date) : Timestamp.now(),
      confirmedAt:  r.EstadoImport === 'aplicado'
        ? Timestamp.fromDate(r.ImportadoEn as Date) : null,
      confirmedBy:  r.ImportadoPor ?? null,
      observaciones: r.Observaciones ?? null,
    }));

  console.log(`   ${docs.length} resumenes`);
  if (dryRun) return;
  await writeBatch(db, 'cardStatements', docs);
  console.log('   OK\n');
}
```

### `scripts/seed/transformers/movements.ts`

```typescript
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { writeBatch } from '../utils/firestore';

const TECNICA_RE = /^(Juan|Mar[ií]a)(ARS|USD)$|^(Galicia|Frances|BBVA)\s+(Visa|Master)(ARS|USD)$/i;

function isoDate(d: Date): string { return d.toISOString().slice(0,10); }
function mesYYYYMM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

interface TCMap { [iso: string]: number; }

function buildTCMap(tcRows: any[]): TCMap {
  const map: TCMap = {};
  for (const r of tcRows) {
    if (r.Fecha && r.TC_USDARS) map[isoDate(r.Fecha as Date)] = Number(r.TC_USDARS);
  }
  return map;
}

function tcForDate(map: TCMap, fecha: Date): number | null {
  const target = isoDate(fecha);
  if (map[target]) return map[target];
  const sortedDates = Object.keys(map).sort();
  let best: string | null = null;
  for (const d of sortedDates) {
    if (d <= target) best = d; else break;
  }
  return best ? map[best] : null;
}

function inferSubtipo(r: any): { subtipo: string; origen: string } {
  if (r.Subtipo && r.Origen) return { subtipo: r.Subtipo, origen: r.Origen };
  const cat = r['Categoría'] ?? r.Categoria;
  if (cat === 'Tarjetas') return { subtipo: 'TarjetaPago', origen: 'WebApp' };
  return { subtipo: 'EventualDirecto', origen: 'WebApp' };
}

export async function seedMovements(db: Firestore, data: SheetData, dryRun: boolean) {
  console.log('-> movements');

  const tcMap = buildTCMap(data.tcDiario);
  let descartados = 0;
  let tcRelleno = 0;
  let subtipoInferido = 0;

  const docs = data.historico
    .filter(r => {
      if (!r.Fecha && (!r.Monto || r.Monto === 0)) { descartados++; return false; }
      return true;
    })
    .map(r => {
      const fecha = r.Fecha as Date;
      const { subtipo, origen } = inferSubtipo(r);
      if (!r.Subtipo) subtipoInferido++;

      let tcUsdArs: number | null = typeof r.TC_USDARS === 'number' ? r.TC_USDARS : null;
      if (tcUsdArs === null && fecha) {
        tcUsdArs = tcForDate(tcMap, fecha);
        if (tcUsdArs !== null) tcRelleno++;
      }

      return {
        id: r.ID,
        fecha: Timestamp.fromDate(fecha),
        fechaConsumoOriginal: r.FechaConsumoOriginal
          ? Timestamp.fromDate(r.FechaConsumoOriginal as Date) : null,
        mes: mesYYYYMM(fecha),
        descripcion: r['Descripción'] ?? r.Descripcion ?? '',
        descripcionOriginal: null,
        monto: Number(r.Monto ?? 0),
        moneda: (r.Moneda === 'USD' ? 'USD' : 'ARS') as 'ARS' | 'USD',
        tcUsdArs,
        tipo: r.Tipo as 'Gasto' | 'Ingreso',
        subtipo,
        origen,
        categoria: r['Categoría'] ?? r.Categoria ?? null,
        subcategoria: r.Subcategoria ?? null,
        etiqueta: r.Etiqueta ?? null,
        banco: r.Banco ?? null,
        cuenta: r.Cuenta ?? null,
        tarjetaCodigo: null,
        tarjeta: r.Tarjeta ?? null,
        persona: r.Persona ?? null,
        creadoPor: r.Usuario ?? 'Sistema',
        pagado: r.Pagado === true,
        excluirDash: r.ExcluirDash === true,
        incluirResumenMes: r.FlagResumenMes === true,
        parentId: r.ParentID ?? null,
        cardStatementId: r.ResumenTarjetaID ?? null,
        expectedItemId: null,
        numeroComprobante: r.NumeroComprobante ?? null,
        pdfHash: null,
        pdfStorageRef: null,
        notas: r.Notas ?? null,
        createdAt: r.CreatedAt ? Timestamp.fromDate(r.CreatedAt as Date) : Timestamp.fromDate(fecha),
        updatedAt: r.UpdatedAt ? Timestamp.fromDate(r.UpdatedAt as Date) : Timestamp.fromDate(fecha),
      };
    })
    .map(d => {
      if (d.etiqueta && TECNICA_RE.test(d.etiqueta)) {
        return { ...d, etiqueta: null };
      }
      return d;
    });

  console.log(`   ${docs.length} movimientos (${descartados} descartados)`);
  console.log(`   ${subtipoInferido} subtipos inferidos (OBL- legacy)`);
  console.log(`   ${tcRelleno} TC rellenados desde tcDaily`);
  if (dryRun) return;
  await writeBatch(db, 'movements', docs);
  console.log('   OK\n');
}
```

### `scripts/seed/validators/runValidations.ts`

```typescript
import { getDb } from '../utils/firestore';
import { readExcel } from '../readExcel';
import { runChecks } from './checks';

async function main() {
  const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
  const excelPath = './data/2026-05-29_sheet_snapshot.xlsx';

  const data = readExcel(excelPath);
  const db = getDb(target);

  const results = await runChecks(db, data);
  let pass = 0, fail = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'OK ' : 'FAIL'} ${r.name} - ${r.detail}`);
    r.ok ? pass++ : fail++;
  }
  console.log(`\n${pass} OK / ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
```

### `scripts/seed/validators/checks.ts`

```typescript
import { Firestore } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';

interface Result { name: string; ok: boolean; detail: string; }

export async function runChecks(db: Firestore, data: SheetData): Promise<Result[]> {
  const results: Result[] = [];

  const movs = await db.collection('movements').count().get();
  const expected = data.historico.filter(r => r.Fecha || r.Monto !== 0).length;
  results.push({
    name: 'movements count',
    ok: movs.data().count === expected,
    detail: `firestore=${movs.data().count} excel=${expected}`,
  });

  const may = await db.collection('movements')
    .where('mes', '==', '2026-05').where('tipo', '==', 'Gasto').where('moneda', '==', 'ARS')
    .get();
  const sumFs = may.docs.reduce((s, d) => s + (d.data().monto ?? 0), 0);
  const sumXls = data.historico
    .filter(r => r.Fecha && (r.Fecha as Date).toISOString().startsWith('2026-05'))
    .filter(r => r.Tipo === 'Gasto' && r.Moneda === 'ARS')
    .reduce((s, r) => s + (r.Monto ?? 0), 0);
  results.push({
    name: 'gastos ARS 2026-05',
    ok: Math.abs(sumFs - sumXls) < 0.01,
    detail: `firestore=${sumFs.toFixed(2)} excel=${sumXls.toFixed(2)}`,
  });

  const dict = await db.collection('dictionary').count().get();
  results.push({
    name: 'dictionary count',
    ok: dict.data().count === data.diccionarioAprendido.length,
    detail: `firestore=${dict.data().count} excel=${data.diccionarioAprendido.length}`,
  });

  const etiqs = await db.collection('etiquetas').get();
  const tieneTecnicas = etiqs.docs.some(d => /^(Juan|Mar[ií]a)(ARS|USD)$/.test(d.data().valor));
  results.push({
    name: 'etiquetas sin tecnicas',
    ok: !tieneTecnicas,
    detail: tieneTecnicas ? 'hay tecnicas (mal)' : 'limpio',
  });

  const stmts = await db.collection('cardStatements').count().get();
  results.push({
    name: 'cardStatements count',
    ok: stmts.data().count === data.tarjetasResumen.length,
    detail: `firestore=${stmts.data().count} excel=${data.tarjetasResumen.length}`,
  });

  const tc = await db.collection('tcDaily').count().get();
  results.push({
    name: 'tcDaily count',
    ok: tc.data().count === data.tcDiario.filter(r => r.Fecha && r.TC_USDARS).length,
    detail: `firestore=${tc.data().count}`,
  });

  const sinTc = await db.collection('movements').where('tcUsdArs', '==', null).count().get();
  results.push({
    name: 'movements sin TC',
    ok: sinTc.data().count < 100,
    detail: `${sinTc.data().count} (acceptable si <100)`,
  });

  const fam = await db.collection('config').doc('familia').get();
  const numMiembros = fam.exists ? Object.keys(fam.data()!.miembros ?? {}).length : 0;
  results.push({
    name: 'config/familia 4 miembros',
    ok: numMiembros === 4,
    detail: `miembros=${numMiembros}`,
  });

  return results;
}
```

---

## Despues de crear todos los archivos

NO corras nada. Solo decime "F2 listo, todos los archivos creados". Yo voy a:

1. Revisar la estructura con `tree` o `dir /s`.
2. `npm install` (yo, no vos).
3. Copiar el .xlsx a `data/2026-05-29_sheet_snapshot.xlsx`.
4. Colocar el `serviceAccountKey.json` en `secrets/`.
5. Levantar emulador en una terminal.
6. `npm run seed:dry` para ver el plan.
7. `npm run seed` contra emulador.
8. `npm run validate` para verificar.

Si algo falla en mis pasos, te llamo de nuevo con el error.

---

## Resumen de lo que tenes que hacer

1. Leer el prompt entero.
2. Decirme tu plan en prosa.
3. Esperar mi confirmacion.
4. Crear los archivos en el orden indicado, con el contenido literal.
5. Reportar "F2 listo".

Listo.
