---
name: reference_deploy_commands
description: Comandos exactos listos para ejecutar en cada deploy — GH token, gh CLI, Supabase, Vercel
type: reference
originSessionId: 7ac12f69-1217-41e2-b6e5-3547bd561e43
---
## Obtener GH_TOKEN (Windows Credential Manager)

```bash
GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n' | git credential fill 2>/dev/null | grep password | cut -d= -f2)
```

Usar siempre como prefijo antes de cualquier comando `gh`:
```bash
GH_TOKEN="$GH_TOKEN" "/c/Program Files/GitHub CLI/gh.exe" <comando>
```

> `gh auth login` falla — el token NO está en la sesión de gh, sino en Windows Credential Manager. El patrón de arriba es el único que funciona.

## GitHub CLI — path y comandos comunes

```bash
GH="/c/Program Files/GitHub CLI/gh.exe"

# Listar PRs
GH_TOKEN="$GH_TOKEN" "$GH" pr list --json number,title,state

# Crear PR
GH_TOKEN="$GH_TOKEN" "$GH" pr create --base main --head dev --title "vX.Y.Z — Desc" --body "..."

# Merge PR
GH_TOKEN="$GH_TOKEN" "$GH" pr merge <N> --merge --subject "vX.Y.Z — Desc"

# Actualizar título de PR (REST API, evita error read:org)
GH_TOKEN="$GH_TOKEN" "$GH" api repos/tongas86/stokio/pulls/<N> --method PATCH --field title="nuevo título"

# Crear release
GH_TOKEN="$GH_TOKEN" "$GH" release create vX.Y.Z --target main --title "vX.Y.Z — Desc" --notes "..."
```

> `gh pr edit` requiere scope `read:org` que el token no tiene — usar siempre `gh api ... --method PATCH` para editar PRs.

## Supabase — project refs

| Ambiente | Project ref |
|----------|-------------|
| **PROD** | `jjffnbrdjchquexdfgwq` |
| **DEV**  | `gcmhzdedrkmmzfzfveig` |

## Supabase CLI — comandos comunes

```bash
# Deploy Edge Function en PROD
npx supabase functions deploy <nombre-ef> --project-ref jjffnbrdjchquexdfgwq

# Aplicar migration en PROD (via MCP apply_migration)
# project_id: jjffnbrdjchquexdfgwq  ← PROD
# project_id: gcmhzdedrkmmzfzfveig  ← DEV

# Reparar migration remota desconocida (si supabase db push falla)
npx supabase migration repair --status reverted <timestamp>
```

## Supabase db push — limitaciones conocidas (Windows)

- **Conexión directa** `db.gcmhzdedrkmmzfzfveig.supabase.co` → solo IPv6 → el CLI no conecta desde Windows
- **Pooler** `aws-1-sa-east-1.pooler.supabase.com:5432` → auth SCRAM-SHA-256 falla con CLI v2.78.1 (Scoop) y v2.92.0 (npx)
- **Alternativa**: aplicar migrations manualmente en **SQL Editor del Dashboard**
- **link funciona**: `supabase link --project-ref gcmhzdedrkmmzfzfveig --password <pass>` conecta OK (usa Management API, no DB directa)
- **DEV DB password** guardado en `.env.local` como `SUPABASE_DB_PASSWORD`
- **URI directa DEV**: `postgresql://postgres:[PASS]@db.gcmhzdedrkmmzfzfveig.supabase.co:5432/postgres`

## Vercel — deploy

**No requiere acción manual.** Merge a `main` → Vercel auto-deploya producción.
- URL PROD: https://stokio-tau.vercel.app
- Variables PROD con scope "Production", DEV con scope "Preview"

## Flujo de deploy completo (resumen)

```
1. git push origin dev
2. MCP apply_migration en PROD para cada migration nueva
3. gh pr merge <N> --merge   →  Vercel autodeploya
4. npx supabase functions deploy <ef> --project-ref jjffnbrdjchquexdfgwq   (si hay EF nueva)
5. gh release create vX.Y.Z --target main ...
```
