---
name: proceso_releases_github
description: Checklist obligatorio de deploy — versión, release, docs. Sin excepción.
type: feedback
originSessionId: 7ac12f69-1217-41e2-b6e5-3547bd561e43
---
**REGLA: cada deploy a PROD debe completar los 4 pasos sin excepción.**

**Why:** El usuario exige que versión, release, docs y memoria estén siempre sincronizados. Olvidarse de cualquier paso es inaceptable y genera confusión en la app y en el historial.

**How to apply — checklist en orden:**

1. **Bump `APP_VERSION` en `src/config/brand.ts`** → AL INICIO DE CADA SESIÓN verificar que coincide con la versión en dev. Si no coincide, corregirlo antes de cualquier otra tarea.
   - Es la versión visible en el sidebar de la app. Si no se actualiza, la app muestra la versión vieja.
   - **Incidente:** quedó en v0.78.0 mientras el código llegó a v0.85.0 — 7 sprints sin actualizar.

2. **PR dev → main** con título `vX.Y.Z — Descripción breve`.

3. **GitHub release** sobre `main` con tag `vX.Y.Z` y notas de los cambios.
   ```
   GH_TOKEN=... gh release create vX.Y.Z --target main --title "vX.Y.Z — ..." --notes "..."
   ```

4. **Actualizar documentación:**
   - `CLAUDE.md` → marcar versión como `✅ PROD` y agregar items de la versión nueva
   - `WORKFLOW.md` → agregar fila en tabla de releases
   - `memory/project_pendientes.md` → actualizar "Último release en PROD"

**Esquema de versiones:**
- **Y** (minor) = nueva funcionalidad o grupo de features
- **Z** (patch) = bugfix o cambio menor

**Repo:** github.com/genesis360-app/genesis360 · Branch principal: `main`

**⚠ CRÍTICO — PR body:** NUNCA incluir `🤖 Generated with [Claude Code](https://claude.com/claude-code)` en el body del PR. Solo contenido relevante.
**Why:** el usuario lo pidió repetidas veces — es ruido innecesario en el historial del repo. Se incumplió en PR #64 y otros anteriores.

**⚠ CRÍTICO — Migrations a PROD:** NUNCA ejecutar `execute_sql` o `apply_migration` en el proyecto PROD (`jjffnbrdjchquexdfgwq`) sin consultar explícitamente al usuario primero.
**Why:** el usuario lo pidió desde el inicio — PROD es sagrado. El flujo siempre es: DEV → PR aprobado por el usuario → recién ahí PROD. Se incumplió aplicando migrations 068/069/070 directamente sin consultar. Aplica a TODO: migrations, funciones SQL, cambios de schema.
