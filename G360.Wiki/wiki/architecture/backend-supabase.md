---
title: Backend — Supabase
category: architecture
tags: [supabase, postgresql, rls, edge-functions, auth]
sources: []
updated: 2026-04-30
---

# Backend — Supabase

Genesis360 usa Supabase como backend completo. No hay servidor propio.

---

## Servicios usados

| Servicio | Uso |
|----------|-----|
| PostgreSQL | Base de datos principal (83 migraciones) |
| Auth | Google OAuth + Email/Password |
| Row Level Security (RLS) | Aislamiento multi-tenant |
| Storage | Imágenes de productos |
| Edge Functions | Lógica serverless (26 funciones Deno) |
| Realtime | (no usado activamente, disponible) |

---

## Proyectos Supabase

| Ambiente | Project ID | Regla |
|----------|-----------|-------|
| **PROD** | `jjffnbrdjchquexdfgwq` | ⚠️ No tocar directamente |
| **DEV** | `gcmhzdedrkmmzfzfveig` | Safe para testing |

> [!WARNING] Las migraciones siempre se aplican primero en DEV. Nunca aplicar directo a PROD sin pruebas.

> 🚨 **Si la DB se cae o está lenta:** ver [[wiki/support/supabase-db-rescue]] — diagnóstico, rescate de pool y procedimiento de restart.

---

## Auth

- **Google OAuth** + Email/Password
- Flow de creación automática de usuario en primer login Google
- Trial de 14 días para negocios nuevos
- Gating por suscripción en `AuthGuard.tsx` (`SubscriptionGuard`)

Roles de usuario: `OWNER · SUPERVISOR · CAJERO · RRHH · ADMIN · CONTADOR · DEPOSITO`

---

## Edge Functions (26 total)

Todas en Deno/TypeScript. Lista completa en [[wiki/architecture/edge-functions]].

Principales:
| Función | Propósito |
|---------|-----------|
| `mp-webhook` | Webhook Mercado Pago (pagos) |
| `crear-suscripcion` | Flow de alta de suscripción |
| `invite-user` | Invitación de usuarios por email |
| `emitir-factura` | Emisión AFIP |
| `send-email` | Emails transaccionales (Resend) |
| `scan-product` | AI: imagen → barcode (Claude Haiku) |
| `meli-oauth-callback` | OAuth Mercado Libre |
| `meli-webhook` | Sincronización inventario MeLi |
| `tn-oauth-callback` | OAuth Tienda Nube |
| `tn-webhook` | Sincronización inventario TN |
| `birthday-notifications` | Alertas cumpleaños empleados |
| `mp-ipn` | Mercado Pago IPN |

---

## Variables de entorno

```env
# Frontend (Vite — prefijo VITE_)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_MP_PUBLIC_KEY=
VITE_APP_URL=

# Backend (Edge Functions — sin prefijo)
MP_ACCESS_TOKEN=
MP_WEBHOOK_SECRET=
MP_PRICE_ID=
```

---

## Links relacionados

- [[wiki/architecture/multi-tenant-rls]]
- [[wiki/architecture/edge-functions]]
- [[wiki/database/schema-overview]]
- [[wiki/database/migraciones]]
- [[wiki/integrations/mercado-pago]]
- [[wiki/development/supabase-dev-vs-prod]]
