---
title: Planes y Pricing
category: business
tags: [planes, pricing, free, basic, pro, enterprise, limites]
sources: []
updated: 2026-04-30
---

# Planes y Pricing

---

## Tabla de planes

| Plan | Usuarios | Productos | Sucursales | Precio |
|------|----------|-----------|------------|--------|
| **Free** | 1 | 50 | 1 | $0 ARS/mes |
| **Basic** | 2 | 500 | 1 | $4.900 ARS/mes |
| **Pro** | 10 | 5.000 | Múltiples | $9.900 ARS/mes |
| **Enterprise** | Ilimitado | Ilimitado | Ilimitado | A convenir |

---

## Trial

- **Duración:** 14 días
- **Acceso:** equivalente al plan Pro
- **Sin tarjeta** requerida al inicio

---

## Límites técnicos

Los límites se verifican en el hook `src/hooks/usePlanLimits.ts`. El hook recibe el plan del tenant y retorna los límites aplicables.

El `SubscriptionGuard` en `src/components/AuthGuard.tsx` bloquea acceso a features no incluidas en el plan actual.

---

## Features por plan

> [!NOTE] Esta tabla debe actualizarse cada vez que se agreguen features gateadas por plan.

| Feature | Free | Basic | Pro | Enterprise |
|---------|------|-------|-----|-----------|
| Inventario | ✓ | ✓ | ✓ | ✓ |
| POS/Ventas | ✓ | ✓ | ✓ | ✓ |
| Caja | ✓ | ✓ | ✓ | ✓ |
| Reportes básicos | ✓ | ✓ | ✓ | ✓ |
| Exportación Excel/PDF | — | ✓ | ✓ | ✓ |
| RRHH | — | — | ✓ | ✓ |
| Marketplace (MeLi/TN) | — | — | ✓ | ✓ |
| Multi-sucursal | — | — | ✓ | ✓ |
| AFIP Facturación | — | — | ✓ | ✓ |
| Auto-reorder | — | — | ✓ | ✓ |
| API acceso | — | — | — | ✓ |

---

## Links relacionados

- [[wiki/features/suscripciones-planes]]
- [[wiki/integrations/mercado-pago]]
- [[wiki/business/modelo-negocio]]
