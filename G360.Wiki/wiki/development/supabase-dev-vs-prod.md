---
title: Supabase DEV vs PROD
category: development
tags: [supabase, dev, prod, migraciones, ambiente]
sources: [WORKFLOW.md, CLAUDE.md]
updated: 2026-04-30
---

# Supabase DEV vs PROD

---

## Proyectos

| Ambiente | Project ID | URL |
|----------|-----------|-----|
| **PROD** | `jjffnbrdjchquexdfgwq` | `https://jjffnbrdjchquexdfgwq.supabase.co` |
| **DEV** | `gcmhzdedrkmmzfzfveig` | `https://gcmhzdedrkmmzfzfveig.supabase.co` |

**Tenant dev:** `5f05f3eb-6757-4f60-b9d2-8853fdfae806`

> [!WARNING] **PROD** — NO tocar directamente. Nunca aplicar migraciones en PROD sin haberlas probado en DEV.

---

## Reglas fundamentales

- ❌ Modificar tablas directamente en PROD sin pasar por DEV
- ❌ ALTER TABLE fuera de un archivo de migration
- ❌ Reescribir una migration ya aplicada en PROD (crear una nueva en su lugar)
- ✅ Claude Code **no aplica** migraciones en PROD salvo pedido explícito del usuario

> 🚨 **Si la DB está caída o lenta:** ver [[wiki/support/supabase-db-rescue]] para el procedimiento completo de diagnóstico y rescate.

---

## Flujo de migraciones

```
1. Crear supabase/migrations/NNN_descripcion.sql (idempotente)
2. Aplicar en DEV:
   supabase db push --project-ref gcmhzdedrkmmzfzfveig
3. Actualizar schema_full.sql:
   supabase db dump --project-ref gcmhzdedrkmmzfzfveig > supabase/migrations/schema_full.sql
4. Commit + push dev
5. Testear en DEV
6. Al deployar a PROD:
   supabase db push --project-ref jjffnbrdjchquexdfgwq
```

---

## Edge Functions

```bash
# Deploy a DEV
supabase functions deploy nombre-funcion --project-ref gcmhzdedrkmmzfzfveig

# Deploy a PROD
supabase functions deploy nombre-funcion --project-ref jjffnbrdjchquexdfgwq

# Sin JWT (para webhooks externos)
supabase functions deploy nombre-funcion --project-ref XXXX --no-verify-jwt
```

**Funciones sin JWT (webhooks entrantes):**
- `mp-webhook` · `mp-ipn` · `tn-webhook` · `tn-oauth-callback` · `meli-oauth-callback`
- `mp-oauth-callback` · `birthday-notifications` · `monitoring-check`
- `marketplace-api` (pública)

---

## Configurar DEV desde cero

1. Crear proyecto en supabase.com → aplicar `supabase/migrations/schema_full.sql`
2. Crear buckets vía API (no se puede con SQL): `productos`, `avatares`, `empleados`, `archivos-biblioteca`, `certificados-afip`, `comprobantes-gastos`, `etiquetas-envios`
3. Variables DEV en Vercel con scope **Preview**
4. Variables PROD en Vercel con scope **Production**
5. En Supabase DEV → Authentication → Users → crear usuario de prueba
6. Habilitar extensiones: `pgcrypto`, `pg_cron`, `pg_net`

---

## Variables de entorno por ambiente

### Frontend (Vercel)

| Variable | Scope |
|----------|-------|
| `VITE_SUPABASE_URL` | Preview + Production |
| `VITE_SUPABASE_ANON_KEY` | Preview + Production |
| `VITE_MP_PUBLIC_KEY` | Production |
| `VITE_APP_URL` | Production: `https://app.genesis360.pro` |
| `VITE_TN_APP_ID` | Production: `30376` |
| `VITE_MP_CLIENT_ID` | Production: `7675256842462289` |

### Edge Functions (Supabase secrets)

```
MP_ACCESS_TOKEN
MP_WEBHOOK_SECRET
MP_PRICE_ID (Básico + Pro)
TN_CLIENT_SECRET
MP_CLIENT_SECRET
MELI_CLIENT_ID
MELI_CLIENT_SECRET
ANTHROPIC_API_KEY      # para scan-product (Claude Haiku)
RESEND_API_KEY         # para send-email + monitoring-check
APP_URL                # DEV o PROD según proyecto
SUPABASE_URL           # automático en Supabase
SUPABASE_SERVICE_ROLE_KEY  # automático en Supabase
```

---

## Banner DEV

En ambientes que no son genesis360.pro, se muestra una franja amarilla:
```
⚠ Ambiente DEV — {hostname}
```

Implementado en `AppLayout.tsx`.

---

## pg_cron jobs (DEV + PROD)

Corriendo desde la DB como mecanismo principal de sync:
- `meli-stock-sync` — cada 5 min
- `tn-stock-sync` — cada 5 min

GitHub Actions es backup, no el mecanismo principal.

---

## Snippets SQL útiles en PROD

Guardados en Supabase PROD → SQL Editor:
- Caja activa
- Reservas viejas (> 5 días)
- Stock crítico
- Ventas del día
- Rebajes manuales
- Actividad de usuarios
- Estado de tenants
- Consumo plan free

---

## Links relacionados

- [[wiki/development/deploy]]
- [[wiki/development/workflow-git]]
- [[wiki/database/migraciones]]
