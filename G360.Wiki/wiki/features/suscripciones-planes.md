---
title: Suscripciones y Planes
category: features
tags: [suscripcion, planes, mercado-pago, trial, billing]
sources: []
updated: 2026-07-05
---

# Suscripciones y Planes

Genesis360 usa un modelo freemium con 4 planes de suscripción. Los pagos se procesan con Mercado Pago.

> [!NOTE] Detalle completo de precios/límites/add-ons (fuente de verdad, actualizado 2026-07-17):
> [[wiki/business/planes-pricing]]. El detalle técnico de billing (activación/cancelación/reconciliación)
> vive en [[wiki/integrations/mercado-pago]].

---

## Planes disponibles (✅ pricing v2, EN PROD desde v1.115.0 — ver [[wiki/business/planes-pricing]] para el detalle completo con add-ons)

| Plan | Usuarios | SKU | Comprobantes/mes | Sucursales | Precio (lista / con débito automático −10%) |
|------|----------|-----|-------------------|------------|--------|
| **Free** | 1 | 50 | 200 | 1 | $0 ARS/mes (30 días de trial) |
| **Básico** | 5 | 2.000 | 6.000 | 1 | $60.000 / $54.000 ARS/mes |
| **Pro** | 15 | 8.000 | 14.000 | 4 | $100.000 / $90.000 ARS/mes |
| **Enterprise** | Ilimitado | Ilimitado | Ilimitado | Ilimitado | A convenir |

Los límites se verifican en el hook `src/hooks/usePlanLimits.ts`. Cada dimensión (SKU, comprobantes, sucursales, usuarios, CUITs adicionales) se puede ampliar con add-ons — ver `ADDON_PACKS` en `brand.ts`.

---

## Trial

- **30 días** de trial gratuito para negocios nuevos (✅ v1.113.0, 2026-07-05, mig 257 — antes eran 7 días; ver [[wiki/business/planes-pricing]] "Trial")
- Acceso completo al plan Pro durante el trial
- Al vencer, se muestra pantalla de upgrade

**Estimador "Armá tu plan" (`PricingConfigurator`):** disponible tanto en el Landing público como embebido
en `/suscripcion` (v1.113.0, visible para todos los usuarios, suscriptos o no). Es una **estimación pura**
del total mensual (plan base + add-ons) — no cobra nada; la compra real de add-ons fijos sigue detrás del
kill-switch `ADDON_FIJO_ENABLED` (ver [[wiki/integrations/mercado-pago]] §3.b).

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

**v1.55.0**: nueva feature `wms` en Pro+/Enterprise (`puede_wms` en `usePlanLimits`) — habilita el **modo de operación Avanzado (WMS)**; el toggle vive en Config → Negocio y el trial lo prueba automáticamente. Ver [[wiki/features/modo-basico-avanzado]].

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
