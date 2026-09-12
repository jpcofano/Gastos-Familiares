# dist — bundle + estilos del Design System

Lo que Code necesita **un nivel arriba de `ui_kits/`**. Copialo a `src/design-system/`
junto a la carpeta `ui_kits/mobile/` que ya bajaste:

```
src/design-system/
├── _ds_bundle.js     ← componentes (Button, Badge, Card, Money, Message, RadioChip,
│                        FieldRow, StepIndicator, MonthSelector, …)
├── styles.css        ← @import de tokens/*
├── tokens/           ← colors · typography · spacing · status
└── ui_kits/mobile/   ← (del zip anterior)
```

`ui_kits/mobile/index.html` carga `../../_ds_bundle.js` y `../../styles.css`, así que con esta
estructura renderiza.

> **F9.174 — en ESTE repo el contenido de `dist/` nunca se copió un nivel arriba: sigue
> acá adentro.** Los tres HTML de `ui_kits/mobile/` apuntaban a `../../styles.css` y
> `../../_ds_bundle.js`, que no existen, así que el kit se abría sin un solo token ni
> componente. Se corrigieron los `href`/`src` a `../../dist/…` en vez de mover archivos.
> Si algún día se adopta la estructura del diagrama, hay que revertir esos tres paths. Si querés el **código fuente** de los componentes (no el bundle), pedímelo.
