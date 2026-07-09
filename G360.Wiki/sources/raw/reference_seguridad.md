---
name: seguridad_genesis360
description: Estado de seguridad del proyecto: keys rotadas, .gitignore, JWT Supabase, repo público y pendientes
type: reference
---

## Estado (actualizado 2026-07-09)

### Incidente 2026-07-09: Google Maps API Key hardcodeada en `public/test-maps.html`
- **Hallazgo:** GitHub Secret Scanning detectó una Google Maps API Key hardcodeada en
  `public/test-maps.html`, servida en vivo (Vite sirve todo `public/` tal cual, sin build step)
  desde el **21 de mayo de 2026** (más de un mes expuesta públicamente). Era la key REAL de
  `VITE_GOOGLE_MAPS_API_KEY` de producción, no una descartable. Investigación contra el código
  (`src/hooks/useGoogleMaps.ts`, `src/components/AddressAutocompleteInput.tsx`) confirmó que la
  app solo necesita 3 APIs de Google (Maps JavaScript API, Places API (New), Distance Matrix
  API) — la key tenía **33 APIs habilitadas**, muy por encima de lo necesario.
- **Remediación (GO, Google Cloud Console):** (1) restringió las APIs habilitadas de 33 a las 3
  reales; (2) confirmó que la restricción de "Aplicaciones" ya estaba en "Sitios web" con los
  referrers correctos (`*.vercel.app/*`, `app.genesis360.pro/*`, `www.genesis360.pro/*`, etc.) —
  mitigaba buena parte del riesgo real incluso antes de rotar; (3) **rotó la key** (generó una
  nueva), la actualizó en Vercel (`VITE_GOOGLE_MAPS_API_KEY`, marcada "Sensitive") y redeployó.
- **Código:** PR `genesis360-app/genesis360#280` (`security: elimina API key de Google expuesta
  en test-maps.html`, merge commit `4ced7ae8`) elimina `public/test-maps.html` (dos copias: la
  commiteada en `public/` + una suelta sin trackear en la raíz del repo). Mergeado y deployado,
  confirmado `READY` en Vercel producción.
- **✅ CERRADO.** La key rotada + restringida a las 3 APIs reales queda como best practice a
  mantener. **Lección reusable:** nunca hardcodear una API key en un archivo dentro de `public/`
  (Vite lo sirve tal cual, en vivo) ni en ningún archivo de test commiteado — usar siempre
  `import.meta.env.VITE_*`. Al crear una API key nueva de Google (o de cualquier proveedor),
  restringirla de entrada a las APIs realmente usadas, no dejar el default de "todas habilitadas".
  Detalle completo en `G360.Wiki/log.md` (entrada del 2026-07-09).

### .env.local y secrets
- `.env.local` **NO está en git** desde v0.44.1 (`.gitignore` completo aplicado + `git rm --cached`)
- Repo GitHub **público** (`genesis360-app/genesis360`) — nunca commitear secrets
- GH_TOKEN en Windows Credential Manager, **nunca** en `.env.local`

### API keys rotadas en 2026-03 (estado: OK)
| Key | Estado |
|-----|--------|
| Anthropic API | ✅ Rotada — nombre `genesis360` en console.anthropic.com |
| MP Public Key | ✅ Nueva (PRD activado con genesis360.pro) `APP_USR-1edf...` |
| MP Access Token | ✅ Nuevo `APP_USR-7675...` |
| Resend API Key | ✅ Rotada `re_BYtz...` |
| Supabase Access Token | ✅ Rotado `sbp_60df...` |
| GitHub Token | ✅ Rotado `ghp_dF2N...` |

### Supabase JWT Keys
- **CURRENT KEY**: ECC P-256 (seguro)
- **PREVIOUS KEY**: Legacy HS256 — ya rotado (7+ días antes de la sesión de seguridad). El key que estaba en git history ya era inválido al momento del descubrimiento.
- Para revocar definitivamente el legacy key: ir a Supabase → Settings → JWT → Legacy API keys → Disable (requiere confirmar que no hay clientes usando el viejo key)

### Variables en Vercel
- `VITE_APP_URL=https://genesis360.pro` — Production only
- `VITE_MP_PUBLIC_KEY` — All environments (o solo Production)
- `MP_ACCESS_TOKEN` — en EF secrets de Supabase PROD, no en Vercel

### Pendiente de seguridad
- **GitHub Actions secrets** desactualizados: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GITHUB_TOKEN` en repo Settings → Secrets (workflows `birthday-notifications` y `tests` pueden fallar si usan los secrets viejos)

**Why:** El repo es público. Una key expuesta en git history (aunque rotada) debe documentarse para no repetir el error.
**How to apply:** Antes de commitear cualquier archivo, verificar que no contenga secrets. Si hay duda, `git diff --staged` antes de `git commit`.
