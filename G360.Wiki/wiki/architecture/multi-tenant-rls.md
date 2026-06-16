---
title: Multi-Tenant con RLS
category: architecture
tags: [multi-tenant, rls, supabase, postgresql, seguridad]
sources: []
updated: 2026-04-30
---

# Multi-Tenant con Row Level Security

Genesis360 es multi-tenant: múltiples negocios (tenants) comparten la misma base de datos pero están completamente aislados entre sí mediante RLS de PostgreSQL.

---

## Modelo de datos

Cada tabla de negocio tiene una columna `tenant_id` que referencia a la tabla `tenants`.

```sql
-- Patrón estándar de política RLS
CREATE POLICY "tenant_isolation" ON tabla_x
  USING (tenant_id IN (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));
```

> [!NOTE] Se usa una **subquery** en lugar de una función (`get_tenant_id()`). Esto es intencional: las funciones en políticas RLS tienen peor performance porque PostgreSQL no puede optimizarlas igual que las subqueries inlineadas.

### Segunda capa: aislamiento por sucursal (v1.75.0, migs 216-218)

Además del `tenant_id`, **23 tablas operativas** filtran por **sucursal** a nivel servidor. La policy combina ambos:

```sql
USING (
  tenant_id = get_user_tenant_id()
  AND ( auth_ve_todas_sucursales()            -- DUEÑO + roles globales → todo el tenant
        OR sucursal_id IS NULL                 -- bóveda/legacy → visible para todos
        OR sucursal_id = auth_user_sucursal() ) -- usuario restringido → solo la suya
)
```

`auth_ve_todas_sucursales()` (STABLE SECURITY DEFINER) replica `authStore.puedeVerTodas`. Las tablas hijas sin `sucursal_id` propia heredan la visibilidad del padre vía `EXISTS`. Detalle, tablas incluidas/excluidas y el gotcha de usuarios mal configurados (activos sin sucursal → sin acceso) en [[wiki/features/multi-sucursal]].

---

## Jerarquía de entidades

```
tenant (negocio)
  └── users (empleados con roles)
  └── sucursales (branches)
  └── productos
  └── inventario (LPNs)
  └── ventas
  └── clientes
  └── proveedores
  └── ... (todas las tablas)
```

---

## Funciones helper de roles

```sql
-- Verifica si el usuario es admin del tenant
is_admin() → boolean

-- Verifica si el usuario es RRHH del tenant
is_rrhh() → boolean
```

Estas funciones se usan en políticas que requieren permisos específicos (ej: solo ADMIN puede ver datos de nómina).

---

## Roles de usuario

| Rol | Descripción |
|-----|-------------|
| `OWNER` | Propietario del negocio, acceso total |
| `SUPERVISOR` | Supervisión de operaciones |
| `CAJERO` | Solo POS y caja |
| `RRHH` | Módulo de RRHH |
| `ADMIN` | Administración (similar a OWNER) |
| `CONTADOR` | Solo lectura, reportes y facturación |
| `DEPOSITO` | Solo inventario físico |

---

## Onboarding de nuevo tenant

1. Usuario se registra (Google OAuth o email)
2. `OnboardingPage.tsx` recolecta datos del negocio
3. Se crea registro en `tenants`
4. Se crea registro en `users` con `role = OWNER`
5. Trial de 14 días comienza automáticamente
6. `AuthGuard` / `SubscriptionGuard` controla acceso

---

## Flujo de autenticación en el frontend

```
App carga → AuthGuard verifica sesión Supabase
  → Si no hay sesión: redirect a /login
  → Si hay sesión: loadUserData() en authStore
      → Carga: user, tenant, sucursales, plan, features
  → SubscriptionGuard verifica estado de suscripción
      → trial activo / suscripción activa → acceso
      → expirado / cancelado → redirect a pantalla de pago
```

El estado global vive en `src/store/authStore.ts` (Zustand).

---

## Links relacionados

- [[wiki/architecture/backend-supabase]]
- [[wiki/database/rls-policies]]
- [[wiki/features/autenticacion-onboarding]]
- [[wiki/features/suscripciones-planes]]
