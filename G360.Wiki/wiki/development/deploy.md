---
title: Deploy — Vercel + Supabase
category: development
tags: [deploy, vercel, supabase, produccion, dominios]
sources: []
updated: 2026-09-15
---

# Deploy

---

## Stack de deploy

| Componente | Servicio |
|-----------|---------|
| Frontend (React SPA) | Vercel |
| Base de datos | Supabase (PostgreSQL managed) |
| Edge Functions | Supabase Edge Functions (Deno) |
| Dominio | genesis360.pro |

---

## Dominios

| Dominio | Destino |
|---------|---------|
| `www.genesis360.pro` | Landing page (marketing) |
| `app.genesis360.pro` | Aplicación autenticada |

Configurado en `vercel.json`:
- `app.genesis360.pro/` → redirect a `/login`
- Todas las rutas → `/index.html` (SPA rewrite)

---

## Proyectos Supabase

| Ambiente | Project ID | URL |
|----------|-----------|-----|
| PROD | `jjffnbrdjchquexdfgwq` | `https://jjffnbrdjchquexdfgwq.supabase.co` |
| DEV | `gcmhzdedrkmmzfzfveig` | `https://gcmhzdedrkmmzfzfveig.supabase.co` |

> [!WARNING] **PROD:** No aplicar migraciones sin haber testeado en DEV primero. No modificar datos directamente.

---

## Variables de entorno en Vercel

Configuradas en el dashboard de Vercel (no en el repo):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_MP_PUBLIC_KEY`
- `VITE_APP_URL`

---

## Variables de entorno en Supabase (Edge Functions)

Configuradas en Supabase Dashboard → Settings → Edge Functions:
- `MP_ACCESS_TOKEN`
- `MP_WEBHOOK_SECRET`
- `MP_PRICE_ID`
- Claves de Resend, AFIP, MeLi, TN, Anthropic

---

## Proceso de deploy

### Frontend (automático)
```
Push a main → Vercel detecta → build automático → deploy
```

### Migraciones de DB (manual)
```bash
# 1. Crear migration
supabase migration new nombre_descriptivo

# 2. Escribir SQL en supabase/migrations/NNN_nombre.sql

# 3. Aplicar en DEV
supabase db push --project-ref gcmhzdedrkmmzfzfveig

# 4. Testear en DEV

# 5. Aplicar en PROD (solo después de testeo exitoso)
supabase db push --project-ref jjffnbrdjchquexdfgwq

# 6. Actualizar schema_full.sql
supabase db dump --project-ref jjffnbrdjchquexdfgwq > supabase/migrations/schema_full.sql
```

### Edge Functions (manual)
```bash
supabase functions deploy nombre-funcion --project-ref jjffnbrdjchquexdfgwq
# webhooks (Meta, TN, MELI, MODO, MP) — preservar verify_jwt=false:
supabase functions deploy tn-webhook --project-ref jjffnbrdjchquexdfgwq --no-verify-jwt
```

🐛 **El deploy de una Edge Function por CLI CONSERVA el `verify_jwt` que ya tenía la función desplegada** —
(2026-09-15, deploy de `marketplace-webhook`). No importa lo que diga el código nuevo ni si se pasa o no
`--no-verify-jwt`: `supabase functions deploy` no toca el flag si la función ya existía, hereda el que estaba
configurado en el dashboard/proyecto. `marketplace-webhook` tenía `verify_jwt: false` desde que aceptaba llamadas
sin auth (bug cerrado el 2026-09-14); tras redesplegar el código nuevo (que exige un usuario autenticado del mismo
negocio) el flag **siguió en `false`** — la EF quedaba con el guard nuevo pero sin exigir el JWT de entrada.
Se corrige con la **Management API**, no con la CLI:
```bash
curl -X PATCH "https://api.supabase.com/v1/projects/<project-ref>/functions/<function-slug>" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"verify_jwt": true}'
```
Verificar siempre con un GET/POST sin `Authorization`: `UNAUTHORIZED_NO_AUTH_HEADER` cuando `verify_jwt: true`
está realmente activo (no alcanza con mirar el flag en el dashboard sin probar la llamada real).

🛑 **Mergear `dev`→`main` NO despliega las Edge Functions.** En cada deploy a PROD, auditar que el código desplegado sea el del repo:

```bash
bash scripts/auditar-edge-functions.sh
```

Y la **paridad de policies por schema** (no solo `public`): el 2026-09-14 `public` y `cron` estaban idénticos, pero en `storage` a PROD le faltaban las políticas de 3 buckets (mig 419).

```sql
SELECT schemaname, count(*), md5(string_agg(tablename||policyname||cmd||coalesce(qual,'')||coalesce(with_check,''), '|' ORDER BY tablename, policyname)) FROM pg_policies GROUP BY schemaname ORDER BY schemaname;
```

Motivo: el 2026-09-14 la EF `emitir-factura` de PROD resultó ser la del 15/07, sin el lock anti doble emisión que el wiki daba por deployado desde el 20/08. Ver [[wiki/architecture/edge-functions]].

---

## Comandos útiles

```bash
npm run dev          # Dev server local
npm run build        # Build de producción
npm run preview      # Preview del build local
npm run lint         # TypeScript + ESLint
```

---

## Links relacionados

- [[wiki/development/workflow-git]]
- [[wiki/development/supabase-dev-vs-prod]]
- [[wiki/architecture/backend-supabase]]
