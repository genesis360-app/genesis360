---
name: Preferencias de colaboración - Stokio
description: Cómo trabajar con el usuario en este proyecto
type: feedback
originSessionId: 7ac12f69-1217-41e2-b6e5-3547bd561e43
---
En los commits, Co-Authored-By debe ser siempre "GNO" (no "Claude Sonnet 4.6"):
`Co-Authored-By: GNO <gaston.otranto@gmail.com>`

**Why:** Preferencia personal del usuario.
**How to apply:** Cada commit que haga debe terminar con esa línea.

---

El usuario prefiere que avance sin consultar — implementar todo el roadmap en DEV de forma autónoma.

**Why:** Lo pidió explícitamente. No quiere preguntas entre features, confirmaciones intermedias ni pasos a DEV.
**How to apply:**
- Ejecutar los ítems del roadmap en orden de prioridad sin pausar a preguntar.
- Aplicar migraciones en DEV sin pedir confirmación.
- Hacer git push origin dev sin pedir confirmación.
- Solo interrumpir si hay una decisión destructiva o ambigüedad crítica que pueda causar daño irreversible (ej: tocar PROD sin indicación, borrar datos, cambio de arquitectura que rompe compatibilidad).
- Al llegar al ~15% de contexto restante: actualizar CLAUDE.md + WORKFLOW.md + memory/project_pendientes.md con el estado actual, luego ejecutar `/compact`.

---

`settings.local.json` configurado con `defaultMode: "dontAsk"` — auto-aprueba todo sin preguntar, excepto push/merge a `main` (en `ask` array).

**Why:** El usuario lo pidió explícitamente — no quiere confirmaciones para operaciones DEV.
**How to apply:**
- Todo lo que sea DEV (editar archivos, bash, git push dev, Supabase DEV, npm, gh pr create, etc.) se ejecuta sin prompt.
- Las únicas operaciones que siguen pidiendo confirmación son `git push origin main*`, `git push*:main*` y `gh pr merge*`.
- Para Supabase PROD (`jjffnbrdjchquexdfgwq`), el sistema de permisos no soporta filtro por parámetro en MCP — la protección es conductual (avisar al usuario antes de aplicar en PROD).

---

Verificar siempre rutas en `App.tsx` antes de hacer `navigate()`.

**Why:** Error real — `handleDuplicate` usó `/inventario/producto/:id` en lugar de `/inventario/:id/editar`, mandando al landing page por el wildcard `*`.
**How to apply:** Antes de cualquier `navigate()` a una ruta nueva, leer App.tsx para confirmar que existe.

---

Claude Code NUNCA hace push directo a `main`. Todo desarrollo va en `dev`.

**Why:** `main` es producción con clientes reales. Un push directo puede romper el sistema sin revisión previa.
**How to apply:** Commits y pushes van a `dev` siempre. Para llegar a `main` se requiere PR.

---

Antes de deployar, verificar que cada campo incluido en un INSERT/UPDATE de Supabase existe como columna en el schema.

**Why:** Bug real — devoluciones insertaba `notas` en `inventario_lineas` pero la columna no existía → error 400 en PROD. Requirió hotfix v0.59.1.
**How to apply:** Al implementar un INSERT, comparar los campos del payload contra el schema de la tabla (`schema_full.sql` o Supabase MCP `list_tables`).

---

En los PRs, omitir siempre el pie "🤖 Generated with [Claude Code](https://claude.com/claude-code)".

---

Siempre bumper `APP_VERSION` en `src/config/brand.ts` en el mismo commit que los cambios de cada release, no en un commit separado al final.

**Why:** El usuario vio v0.95 en sidebar aunque ya se había deploado v0.96 — la versión visible quedó desincronizada.
**How to apply:** Cada vez que se crea una PR de release (vX.Y.Z), incluir el bump de APP_VERSION en el mismo batch de archivos commiteados.

**Why:** El usuario lo pidió explícitamente — no quiere esa línea en las descripciones de PRs.
**How to apply:** Al usar `gh pr create`, no incluir ese texto en el `--body`. El footer de Co-Authored-By en commits sigue igual.

---

La cotización USD es global (hook `useCotizacion`), no un campo local por página.

**Why:** El usuario/linter ya refactorizó el campo de cotización local que yo había agregado hacia un hook compartido del sidebar.
**How to apply:** Para cualquier feature relacionado con USD/cotización, usar `useCotizacion` en lugar de estado local.
