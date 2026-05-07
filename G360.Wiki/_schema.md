# Genesis360 — LLM Wiki Schema

Este archivo es el contrato entre vos y el agente LLM. Define cómo está estructurado el wiki, qué convenciones usar, y qué hacer en cada operación. Actualizalo junto con el agente a medida que el proyecto evoluciona.

---

## Contexto del Proyecto

**Genesis360** es un SaaS de gestión de inventario (WMS) para pequeños comercios físicos de Argentina (almacenes, ferreterías, kioscos, minimercados). Tagline: *"El cerebro del negocio físico"*.

- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Auth + RLS + Edge Functions)
- **Payments:** Mercado Pago (suscripciones)
- **Deploy:** Vercel (frontend) + Supabase (backend)
- **Código fuente:** `D:\Dev\Genesis360` (SSD · migrado desde E:\OneDrive el 2026-05-06)
- **Wiki (este vault):** `D:\Dev\Genesis360\G360.Wiki` (dentro del mismo repo)

---

## Estructura del Wiki

```
G360.Wiki/                ← raíz del vault Obsidian (wiki)
├── _schema.md            ← este archivo (schema y reglas del wiki)
├── index.md              ← índice de todas las páginas wiki
├── log.md                ← log cronológico append-only
│
├── sources/              ← fuentes crudas (el agente NUNCA modifica)
│   ├── raw/              ← docs de la app: arquitectura, reglas negocio, UAT, soporte
│   └── assets/           ← imágenes descargadas
│
└── wiki/                 ← páginas generadas por el agente LLM
    ├── overview/         ← visión general, arquitectura, decisiones
    ├── features/         ← una página por módulo/feature
    ├── architecture/     ← backend, frontend, infra, DB schema
    ├── database/         ← tablas, migraciones, RLS, triggers
    ├── integrations/     ← APIs externas (AFIP, MP, MeLi, TN, etc.)
    ├── business/         ← modelo de negocio, planes, roadmap
    └── development/      ← workflow git, convenciones, deploy
```

> **Nota sobre CLAUDE.md:** El archivo `CLAUDE.md` en la raíz del proyecto (`D:\Dev\Genesis360\CLAUDE.md`) es distinto — contiene las reglas de desarrollo de la app y es leído automáticamente por Claude Code. Este archivo (`_schema.md`) solo rige el sistema wiki.

### Reglas de estructura
- Las carpetas de `wiki/` están fijas — no crear subcarpetas sin discutirlo primero
- Los archivos en `sources/` son inmutables — el agente los lee pero nunca los edita
- Todo el contenido escrito por el agente va en `wiki/`

---

## Formato de Páginas Wiki

### Frontmatter obligatorio
```yaml
---
title: Nombre de la página
category: overview | features | architecture | database | integrations | business | development
tags: [tag1, tag2]
sources: [nombre-fuente-1.md, nombre-fuente-2.md]
updated: YYYY-MM-DD
---
```

### Convenciones de contenido
- Escribir en español
- Usar `[[links]]` de Obsidian para referencias entre páginas del wiki
- Usar `> [!NOTE]` / `> [!WARNING]` / `> [!TIP]` para callouts importantes
- Al final de cada página: sección `## Fuentes` con links a `sources/`
- Anotar contradicciones explícitamente: `> [!WARNING] Contradicción: ...`
- Un archivo por concepto/módulo, no mezclar temas distintos

---

## Operaciones

### 1. Ingest (agregar una nueva fuente)
Cuando el usuario agrega un archivo a `sources/raw/`:
1. Leer el archivo fuente
2. Discutir los puntos clave con el usuario
3. Crear una página resumen en la carpeta correspondiente de `wiki/`
4. Actualizar `index.md` con la nueva página
5. Actualizar páginas relacionadas existentes (cross-references)
6. Agregar entrada en `log.md`: `## [YYYY-MM-DD] ingest | Título de la fuente`

### 2. Query (responder preguntas)
1. Leer `index.md` para identificar páginas relevantes
2. Leer esas páginas y sintetizar la respuesta
3. Citar las páginas wiki consultadas
4. Si la respuesta es valiosa: preguntar al usuario si quiere guardarla como nueva página wiki
5. Agregar entrada en `log.md`: `## [YYYY-MM-DD] query | Resumen de la pregunta`

### 3. Lint (health-check del wiki)
Buscar:
- Páginas mencionadas en el wiki que no tienen su propia página
- Contradicciones entre páginas
- Páginas huérfanas (sin links entrantes)
- Información desactualizada por nuevas fuentes
- Gaps de conocimiento (temas que faltan documentar)
Reportar hallazgos al usuario y proponer acciones.

### 4. Update (actualizar el código fuente → wiki)
Cuando hay cambios en el código fuente:
1. Leer los archivos modificados
2. Identificar páginas wiki que deben actualizarse
3. Actualizar con la nueva información
4. Marcar la fecha en el frontmatter `updated:`
5. Log: `## [YYYY-MM-DD] update | Qué cambió`

---

## Convenciones de Nomenclatura

| Tipo | Formato | Ejemplo |
|------|---------|---------|
| Feature page | `kebab-case.md` | `ventas-pos.md` |
| Architecture page | `kebab-case.md` | `multi-tenant-rls.md` |
| Source (raw) | nombre original | `reunion-roadmap-2026.md` |
| Log entry | `## [YYYY-MM-DD] tipo \| título` | `## [2026-04-30] ingest \| Reunión de roadmap` |

---

## Guías por Dominio

### Multi-tenancy
- Toda tabla tiene `tenant_id`
- RLS con subqueries: `tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())`
- Nunca usar funciones en políticas RLS (performance)

### Migraciones de DB
- Formato: `NNN_nombre_descriptivo.sql`
- Aplicar en DEV primero, luego PROD
- Actualizar `schema_full.sql` snapshot
- 85 migraciones al 2026-05-05

### Edge Functions
- Runtime: Deno
- 26 funciones activas
- Autenticación: validar JWT en cada función

### Planes de Suscripción
| Plan | Usuarios | Productos | Precio |
|------|----------|-----------|--------|
| Free | 1 | 50 | $0 |
| Basic | 2 | 500 | $4.900 ARS/mes |
| Pro | 10 | 5.000 | $9.900 ARS/mes |
| Enterprise | ∞ | ∞ | Custom |

---

## Reglas del Agente

1. **Nunca modificar** archivos en `sources/`
2. **Siempre actualizar** `index.md` y `log.md` al crear/modificar páginas
3. **Priorizar links internos** — si un concepto existe como página, siempre linkear
4. **Español** como idioma del wiki (el código y las variables quedan en inglés)
5. **Una página, un tema** — si una página crece demasiado, proponer dividirla
6. **Contradicciones explícitas** — nunca silenciar información contradictoria
7. **Frontmatter completo** en cada página nueva
8. Al terminar una sesión, verificar que `log.md` e `index.md` estén actualizados
