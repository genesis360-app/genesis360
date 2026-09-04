---
title: Supabase DEV vs PROD
category: development
tags: [supabase, dev, prod, migraciones, ambiente]
sources: [WORKFLOW.md, CLAUDE.md]
updated: 2026-09-04
---

# Supabase DEV vs PROD

---

## Proyectos

| Ambiente | Project ID | URL |
|----------|-----------|-----|
| **PROD** | `jjffnbrdjchquexdfgwq` | `https://jjffnbrdjchquexdfgwq.supabase.co` |
| **DEV** | `gcmhzdedrkmmzfzfveig` | `https://gcmhzdedrkmmzfzfveig.supabase.co` |

**Tenant dev:** `4cf85bbb-22b3-4760-91ee-15a24d9e4713` ("Familia Otranto De Porto") — corregido 2026-09-04,
el UUID anterior no existe en la base (era un mixup con un tenant de PROD, ver [[reference_tenant_id_dev_prod_mixup]]
en la memoria del asistente). Verificar siempre contra la DB antes de asumir un tenant ID de memoria/docs.

> [!WARNING] **PROD** — NO tocar directamente. Nunca aplicar migraciones en PROD sin haberlas probado en DEV.

---

## Organización y plan de facturación

Ambos proyectos viven en la **única organización** de Supabase, "Argentum Business Group"
(`pcxmmhuauoervlbflygs`) — **comparten la misma cuota de organización** (Egress, Cached Egress, Disk IO,
MAU, Storage, Realtime, Edge Function Invocations, etc.). Un exceso de cuota causado por DEV puede
degradar o bloquear también PROD.

**Histórico del incidente:**
- **2026-08-07**: la organización entró en "grace period" del plan **Free** por exceder Cached Egress —
  riesgo real de 402/degradación en ambos proyectos si no se regularizaba antes del **2026-09-01**.
- El plazo venció el 2026-09-01 sin regularizar. Durante la sesión del 2026-09-03/04 esto causó
  inestabilidad amplia y confusa en DEV (logins colgados 15-30+ seg, requests sin respuesta, resultados
  e2e contradictorios entre corridas idénticas del mismo código) — investigado a fondo asumiendo primero
  causas de código (bump de `react-router`, StrictMode/GoTrue, contención local) antes de encontrar la
  causa raíz real: Fair Use Policy activa por cuota excedida. `get_project` de ambos proyectos seguía en
  `ACTIVE_HEALTHY` (no un pause total) — consistente con throttling condicional, no una caída dura.
- **✅ RESUELTO 2026-09-04**: GO upgradeó la organización a **Pro Plan** (USD 25/mes + IVA, ~USD 29.75 el
  primer cargo). Verificado en Usage post-upgrade: ciclo de facturación **04-Sep-2026 a 04-Oct-2026**,
  todas las métricas en 0 de su nuevo cupo (Egress 250GB, Cached Egress 250GB, Monthly Active Users
  100.000, Monthly Active SSO Users 50.000, Monthly Active Third-Party Users 100.000, Storage Size 100GB,
  Storage Image Transformations 100, Realtime Concurrent Peak Connections 500, Realtime Messages
  5.000.000, Edge Function Invocations 2.000.000). Supabase avisa que el refresh completo de cuota puede
  tardar hasta 1 hora en aplicar. Sin cambio de código ni migración — 100% cambio de plan de facturación
  hecho por GO desde el dashboard de Billing.

> 💡 **Lección para diagnóstico futuro**: si aparecen timeouts/hangs/resultados inconsistentes en DEV o
> PROD que no se explican por el código ni por `pg_stat_activity` (ver [[wiki/support/supabase-db-rescue]]),
> revisar también el dashboard de **Billing → Usage** de la organización — el throttling por cuota
> excedida no siempre marca el proyecto como caído (`get_project` puede seguir en `ACTIVE_HEALTHY`).

Ver `log.md` (2026-09-04, tipo `update`), `sources/raw/project_pendientes.md` (bloques históricos
2026-08-07 y 2026-08-24, anotados como CERRADOS).

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
