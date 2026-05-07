---
title: Deploy — Vercel + Supabase
category: development
tags: [deploy, vercel, supabase, produccion, dominios]
sources: []
updated: 2026-04-30
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
```

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
