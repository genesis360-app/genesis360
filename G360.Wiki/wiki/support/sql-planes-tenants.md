---
title: SQL de planes por negocio (consultar y cambiar)
category: support
tags: [soporte, planes, pricing, sql, tenants, addons, suscripcion]
sources: [supabase/schema_full.sql, src/config/brand.ts, mig 251, mig 456]
updated: 2026-10-02
---

# SQL de planes por negocio

Para GO / soporte. Se corre en el **SQL editor de Supabase** (PROD = `jjffnbrdjchquexdfgwq`). Son cambios de DATOS, no de
estructura: no hace falta migración (la regla "todo por migración" es para tablas, funciones y policies).

## Dónde vive cada cosa

**No hay una tabla de planes.** La tabla `planes` era de la primera versión (marzo) y se retiró el 2026-10-02 (mig 456).
- **El catálogo** (precios, qué incluye cada plan, add-ons) vive en el código: `src/config/brand.ts` → `PLANES`,
  `PLAN_BASE_LIMITS`, `ADDON_PACKS`, `FEATURES_POR_PLAN`. Cambiar un precio = cambio de código + deploy.
- **Los límites** (usuarios, productos, comprobantes, sucursales, CUITs) los calcula la base:
  `fn_plan_base_limite(plan, dimension)` (lo del plan) y `fn_tenant_limite(negocio, dimension)` (plan + add-ons).
- **El plan de cada negocio** está en la tabla `tenants`:

| Columna | Valores | Qué es |
|---|---|---|
| `plan_tier` | `basico` · `pro` · `enterprise` (`free` = legacy) | El plan |
| `subscription_status` | `trial` · `active` · `inactive` · `cancelled` | Estado de la suscripción |
| `trial_ends_at` | fecha | Fin de la prueba (con `trial`, mientras no venza tiene límites de **Pro**) |
| `billing_mode` | `auto` (débito MP) · `manual` (transferencia/efectivo) | Cómo paga |
| `manual_monto_mensual` / `manual_paid_until` | monto / fecha | Solo pago manual |
| `subscription_period_end` | fecha | Cancelado: acceso hasta acá (período ya pagado) |
| `mp_subscription_id` | texto | Suscripción de Mercado Pago (débito) |

- **Los add-ons** comprados están en `tenant_addons` (`dimension`: `sku`, `comprobantes`, `sucursales`, `usuarios`, `cuits`;
  `tipo`: `fijo` = mensual, `temporal` = vence en `vence_at`).

## Antes de cambiar algo

- 🛑 Si el negocio paga por **débito automático** (`billing_mode = 'auto'` con `mp_subscription_id`), el plan lo define la
  suscripción de MP: un cambio a mano puede pisarse con el próximo aviso de MP. Cambiá el plan en MP o cancelá/vinculá la
  suscripción desde el panel interno (Facturación).
- Para **extender la prueba** o **registrar un pago manual** usá el panel interno (admin.genesis360.pro): queda en la
  auditoría. Un UPDATE por SQL no queda registrado; anotá el cambio en las notas del cliente del panel.
- Bajar de plan **no borra nada**: el negocio conserva lo creado, pero no puede crear más allá del límite nuevo.

## Consultas

```sql
-- Plan, estado y límites efectivos de un negocio (cambiar el nombre)
SELECT t.id, t.nombre, t.plan_tier, t.subscription_status, t.trial_ends_at::date, t.billing_mode,
       t.manual_monto_mensual, t.manual_paid_until::date, t.mp_subscription_id,
       public.fn_tenant_limite(t.id, 'usuarios')     AS lim_usuarios,
       public.fn_tenant_limite(t.id, 'sucursales')   AS lim_sucursales,
       public.fn_tenant_limite(t.id, 'sku')          AS lim_productos,
       public.fn_tenant_limite(t.id, 'comprobantes') AS lim_comprobantes,
       public.fn_tenant_limite(t.id, 'cuits')        AS lim_cuits
  FROM public.tenants t
 WHERE t.nombre ILIKE '%Kalken%';

-- Todos los negocios con su plan
SELECT nombre, plan_tier, subscription_status, trial_ends_at::date, billing_mode
  FROM public.tenants ORDER BY created_at;

-- Add-ons de un negocio
SELECT dimension, cantidad, tipo, vence_at::date, created_at::date
  FROM public.tenant_addons a JOIN public.tenants t ON t.id = a.tenant_id
 WHERE t.nombre ILIKE '%Kalken%';
```

## Cambios

```sql
-- Cambiar el plan (pago manual / sin débito MP). Valores: 'basico' | 'pro' | 'enterprise'
UPDATE public.tenants SET plan_tier = 'pro'
 WHERE id = '<TENANT_ID>';

-- Pasarlo a activo con pago manual (monto del mes y hasta cuándo está pago)
UPDATE public.tenants
   SET subscription_status = 'active', billing_mode = 'manual',
       manual_monto_mensual = 117600, manual_paid_until = '2026-11-02'
 WHERE id = '<TENANT_ID>';

-- Extender la prueba (preferible desde el panel: "Extender prueba")
UPDATE public.tenants SET subscription_status = 'trial', trial_ends_at = '2026-10-31 23:59:59-03'
 WHERE id = '<TENANT_ID>';

-- Regalar un add-on fijo (ej. +1 sucursal) — dimension: sku | comprobantes | sucursales | usuarios | cuits
INSERT INTO public.tenant_addons (tenant_id, dimension, cantidad, tipo)
VALUES ('<TENANT_ID>', 'sucursales', 1, 'fijo');

-- Add-on temporal (vence solo): +1.000 comprobantes por 30 días
INSERT INTO public.tenant_addons (tenant_id, dimension, cantidad, tipo, vence_at)
VALUES ('<TENANT_ID>', 'comprobantes', 1000, 'temporal', now() + interval '30 days');
```

Usá siempre el `id` del negocio (sale de la primera consulta) en los UPDATE: con `nombre ILIKE` podés tocar más de uno.

> ⏳ Pricing v7 (en curso): se suma la "herencia" de los negocios existentes (conservan límites y módulos de su plan
> viejo). Cuando esté, esta página suma cómo consultarla.

**Relacionado:** [[wiki/business/planes-pricing]] · [[wiki/support/plataforma-soporte]] · [[wiki/support/checklist-alta-cliente]].
