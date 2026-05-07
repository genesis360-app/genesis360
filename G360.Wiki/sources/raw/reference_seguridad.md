---
name: seguridad_genesis360
description: Estado de seguridad del proyecto: keys rotadas, .gitignore, JWT Supabase, repo público y pendientes
type: reference
---

## Estado (actualizado 2026-03-27)

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
