# Bienvenido al Wiki de Genesis360

Este vault es el **cerebro del proyecto Genesis360** — un SaaS de gestión de inventario para pequeños comercios de Argentina.

El wiki es mantenido por el agente LLM (Claude Code). Vos aportás fuentes y hacés preguntas; el agente escribe y actualiza el wiki.

---

## Cómo usar este wiki

| Acción                    | Qué hacer                                                           |
| ------------------------- | ------------------------------------------------------------------- |
| **Agregar una fuente**    | Copiá el archivo a `sources/raw/` y pedile al agente que lo procese |
| **Hacer una pregunta**    | Preguntale al agente directamente — buscará en el wiki              |
| **Ver todo**              | Abrí [[index]]                                                      |
| **Ver actividad**         | Abrí [[log]]                                                        |
| **Ver reglas del agente** | Abrí [[_schema]]                                                    |

---

## Páginas principales

- [[wiki/overview/genesis360-overview]] — qué es el proyecto
- [[wiki/architecture/frontend-stack]] — React, Vite, TypeScript
- [[wiki/architecture/backend-supabase]] — Supabase, DB, Edge Functions
- [[wiki/features/inventario-stock]] — el núcleo del sistema
- [[wiki/business/modelo-negocio]] — segmento y propuesta de valor
- [[wiki/development/deploy]] — cómo deployar

---

## Estructura del vault

```
G360.Wiki/
├── _schema.md    ← reglas del agente wiki (≠ CLAUDE.md de la app)
├── index.md      ← catálogo de todo el wiki
├── log.md        ← historial de actividad
├── sources/
│   └── raw/      ← fuentes crudas (docs app: arquitectura, reglas, UAT, soporte)
└── wiki/         ← páginas generadas por el agente
    ├── overview/
    ├── features/
    ├── architecture/
    ├── database/
    ├── integrations/
    ├── business/
    └── development/
```

> El `CLAUDE.md` de la raíz del proyecto (`D:\Dev\Genesis360\CLAUDE.md`) es para Claude Code cuando desarrollás. Este vault es para consulta y documentación organizada.
