---
title: Multi-Tenant con RLS
category: architecture
tags: [multi-tenant, rls, supabase, postgresql, seguridad]
sources: []
updated: 2026-09-24
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

> [!WARNING] **Mig 433 — ✅ EN DEV Y EN PROD desde v1.231.0 (2026-09-24, PR #357)**: hasta esta
> migración, `get_user_tenant_id()` —la subquery/función que gobierna el `USING` de casi todas las
> policies del schema `public`— **no miraba `users.activo`**. Dar de baja a un usuario (`UsuariosPage` →
> "Desactivar", la única acción que existe, no hay eliminar) no le cortaba el acceso: seguía viendo y
> escribiendo todo lo de su rol. La mig 433 agrega `AND coalesce(activo, true)` a `get_user_tenant_id()`
> e `is_admin()` (`activo` es NULLABLE, así que `AND activo` a secas habría dejado afuera a cualquier
> fila con NULL) + un trigger que bloquea auto-baja y baja del último DUEÑO activo. El frontend
> (`authStore`/`AuthGuard`) necesitó su propio fix: sin `fn_estado_usuario_actual()`, un usuario dado de
> baja no puede leer ni su propia fila y la app lo mandaría a crear un negocio nuevo con su misma
> identidad. Probada en DEV impersonando con `SET LOCAL ROLE` (26 productos/4 ventas/2 clientes/su fila
> → 0/0/0/0 tras la baja) y con el spec e2e `158_acceso_revocado_mutante`. Detalle completo en
> [[wiki/features/autenticacion-onboarding]] ("Desactivar corta el acceso de verdad").

> [!WARNING] **Mig 437 — 🟡 EN DEV, falta PROD (2026-09-25)**: `get_user_tenant_id()` resuelve bien
> el tenant a partir de `auth.uid()`, pero eso no protege una función que recibe el tenant **por
> parámetro** si esa función no compara ambos valores. `process_aging_profiles(p_tenant_id)` y
> `liberar_reservas_vencidas(p_tenant_id)` —dos sweeps `SECURITY DEFINER` con `EXECUTE` para
> `authenticated`— no hacían esa comparación: cualquier usuario logueado podía pasar el UUID de OTRO
> negocio. Fix: con sesión se exige `p_tenant_id = get_user_tenant_id()`; sin sesión (service_role /
> cron-sweeps) sigue igual. Detalle completo en [[wiki/architecture/guards-server-side]] ("G15").

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
