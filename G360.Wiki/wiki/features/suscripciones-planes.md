---
title: Suscripciones y Planes
category: features
tags: [suscripcion, planes, mercado-pago, trial, billing]
sources: []
updated: 2026-04-30
---

# Suscripciones y Planes

Genesis360 usa un modelo freemium con 4 planes de suscripción. Los pagos se procesan con Mercado Pago.

---

## Planes disponibles

| Plan | Usuarios | Productos | Precio |
|------|----------|-----------|--------|
| **Free** | 1 | 50 | $0 ARS/mes |
| **Basic** | 2 | 500 | $4.900 ARS/mes |
| **Pro** | 10 | 5.000 | $9.900 ARS/mes |
| **Enterprise** | Ilimitado | Ilimitado | A convenir |

Los límites se verifican en el hook `src/hooks/usePlanLimits.ts`.

---

## Trial

- 14 días de trial gratuito para negocios nuevos
- Acceso completo al plan Pro durante el trial
- Al vencer, se muestra pantalla de upgrade

---

## Estados de suscripción

| Estado | Descripción |
|--------|-------------|
| `trial` | Período de prueba activo |
| `active` | Suscripción paga activa |
| `inactive` | Suscripción vencida (no renovó) |
| `cancelled` | Cancelada por el usuario |

---

## Integración Mercado Pago

- El frontend inicia el checkout llamando a la Edge Function `crear-suscripcion`
- La función crea la suscripción en Mercado Pago y retorna la URL de pago
- Mercado Pago llama al webhook `mp-webhook` / `mp-ipn` en cada evento de pago
- Las Edge Functions actualizan el estado en la tabla `subscriptions`

Ver [[wiki/integrations/mercado-pago]].

---

## Gating de features

El `SubscriptionGuard` (en `src/components/AuthGuard.tsx`) intercepta todas las rutas protegidas y verifica:
1. Sesión activa
2. Estado de suscripción (`trial` o `active`)
3. Si el plan permite la feature solicitada (via `usePlanLimits`)

---

## Variables de entorno relevantes

```env
VITE_MP_PUBLIC_KEY=       # Clave pública MP (frontend)
MP_ACCESS_TOKEN=           # Token de acceso MP (Edge Functions)
MP_WEBHOOK_SECRET=         # Secret para validar webhooks
MP_PRICE_ID=               # ID del plan en Mercado Pago
```

---

## Links relacionados

- [[wiki/integrations/mercado-pago]]
- [[wiki/architecture/multi-tenant-rls]]
- [[wiki/features/autenticacion-onboarding]]
