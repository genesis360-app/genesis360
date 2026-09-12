---
title: Autenticación y Onboarding
category: features
tags: [auth, onboarding, google-oauth, trial, suscripcion, guard]
sources: [CLAUDE.md]
updated: 2026-09-12
---

# Autenticación y Onboarding

---

## Métodos de login

- **Google OAuth** — flujo principal
- **Email + Password** — alternativo

Ambos gestionados por Supabase Auth.

---

## Flujo Google OAuth → nuevo usuario

1. Usuario hace click en "Entrar con Google"
2. `loadUserData` corre → no encuentra registro en tabla `users`
3. `needsOnboarding: true` → `AuthGuard` redirige a `/onboarding`
4. `OnboardingPage` recolecta datos del negocio (nombre, tipo de comercio, etc.)
5. Al guardar: genera UUID en cliente con `crypto.randomUUID()` (**nunca** SELECT del tenant recién insertado por RLS SELECT-after-INSERT)
6. INSERT en `tenants` + INSERT en `users` con `rol = OWNER`
7. `await loadUserData(userId)` ANTES de `navigate('/dashboard')`

> [!WARNING] Nunca llamar `navigate('/dashboard')` antes de `await loadUserData()`. La store Zustand debe tener los datos del tenant antes de renderizar el dashboard.

---

## Flujo de autenticación en el frontend

```
App carga
  → AuthGuard verifica sesión Supabase
    → Sin sesión → redirect /login
    → Con sesión → loadUserData()
        → Carga: user, tenant, sucursales, plan, features
  → SubscriptionGuard verifica suscripción
      → trial activo (trial_ends_at futuro) → acceso total (como Pro)
      → suscripción activa → acceso según plan
      → expirado / cancelado / inactivo → redirect SuscripcionPage
```

---

## AuthGuard y SubscriptionGuard

**Regla crítica:** `SubscriptionGuard` **siempre** en `AuthGuard.tsx`, **nunca** en archivo separado.

- **AuthGuard**: verifica que hay sesión activa de Supabase
- **SubscriptionGuard**: verifica `subscription_status` + `trial_ends_at`
- Ambos en `src/components/AuthGuard.tsx`

---

## Trial de 30 días

- Comienza automáticamente al registrar un nuevo tenant (`trial_ends_at` nace con `now() + 30 días`, desde v1.113.0)
- Durante el trial: acceso completo equivalente al plan Pro
- `usePlanLimits` detecta `subscription_status='trial'` con `trial_ends_at` futuro → usa `FEATURES_POR_PLAN['pro']`
- Al vencer: pantalla de pago (SuscripcionPage)

> [!NOTE] Fix v1.3.0: botón "Cerrar sesión" en SuscripcionPage y OnboardingPage cuando el trial vence (el usuario quedaba atrapado en un loop sin poder cerrar sesión).

> [!IMPORTANT] **v1.212.0 (2026-09-12)**: la pantalla de planes decía "tu prueba está por vencer" a
> usuarios cuyo trial había vencido hacía semanas (la condición nunca comparaba `trial_ends_at`, solo
> el status) — en PROD **5 de 6 tenants en trial** estaban en ese caso. Ver [[wiki/features/suscripciones-planes]].

---

## Roles de usuario

> Renombrado `OWNER → DUEÑO` en **migration 100** (v1.8.16). El frontend y todas las políticas RLS usan `'DUEÑO'`. La prop interna `ownerOnly` se conserva con ese nombre.

| Rol | Acceso |
|-----|--------|
| `DUEÑO` | Todo |
| `SUPER_USUARIO` | Igual que DUEÑO dentro del tenant (antes `ADMIN`) |
| `SUPERVISOR` | Todo excepto `/configuracion`, `/usuarios`, `/sucursales`, `/rrhh` |
| `CAJERO` | Solo `/ventas`, `/caja`, `/clientes`, `/mi-cuenta` |
| `RRHH` | Solo `/rrhh`, `/mi-cuenta` |
| `ADMIN` | Solo `/admin` (plataforma interna) |
| `CONTADOR` | `/dashboard`, `/gastos`, `/reportes`, `/historial`, `/metricas`, `/mi-cuenta`, `/suscripcion` |
| `DEPOSITO` | `/inventario`, `/productos`, `/alertas`, `/mi-cuenta` |

Restricciones implementadas en `AppLayout.tsx` con `useLocation` + `useEffect`.

---

## Roles custom (migration 037)

- Tabla `roles_custom` (nombre, permisos JSONB, activo)
- `users.rol_custom_id FK roles_custom`
- Mayor prioridad que el rol estándar
- Si `permisos_custom[modulo] === 'no_ver'` → redirect al primer módulo permitido

---

## Onboarding — valores por defecto

Al registrar un nuevo negocio (v1.1.0):
- Regla de inventario: **Manual** (no FIFO como antes)
- Session timeout: **Nunca**

---

## Session timeout por inactividad (migration 041, v0.67.0)

- `tenants.session_timeout_minutes INT DEFAULT NULL`
- Opciones: 5 / 15 / 30 min / 1h / Nunca
- Configurable en ConfigPage → Negocio
- Aviso toast 1 minuto antes de expirar
- Hook: `useInactivityTimeout`

---

## Mi Cuenta (/mi-cuenta)

Accesible desde el bloque de perfil en sidebar. Disponible para todos los roles.

- **Avatar**: Google OAuth → `user_metadata.avatar_url` automático. Email/password → upload al bucket `avatares`
- **Plan y estado**: muestra plan actual + link a `/suscripcion`
- **Cambio de contraseña**: solo email/password (no Google)
- **Zona de riesgo**:
  - Non-OWNER: "Salir del negocio" → DELETE de `users` (la cuenta de auth queda libre)
  - OWNER: "Eliminar cuenta permanentemente" → requiere escribir el nombre del negocio

> [!IMPORTANT] **v1.213.0 (2026-09-12)**: `/mi-cuenta` salió del `SubscriptionGuard`. Antes, un DUEÑO
> con el trial vencido nunca llegaba a esta pantalla — el guard lo sacaba a `/suscripcion` primero, y
> quedaba **atrapado: no podía pagar, ni avisar un pago, ni eliminar la cuenta**. Ahora sigue accesible
> bajo `AuthGuard` + `AppLayout` aunque la suscripción esté vencida; el resto de la app sigue cerrado.
> Ver [[wiki/features/suscripciones-planes]] → "CERRADO: con el trial vencido...".

---

## `tenants.telefono` — el dato que se pedía y se descartaba (mig 412, v1.214.0) — 2026-09-12

El alta de negocio pide el teléfono desde siempre, pero `provisionNegocio()` nunca lo guardaba: se
tipeaba y se perdía. La mig 412 agrega `tenants.telefono` y ahora se guarda por los **3 caminos** del
alta (form directo, Google OAuth, onboarding con negocio existente). Se puede editar después en
Configuración → Mi negocio. El panel de soporte (`admin.genesis360.pro`) lo muestra como link `tel:`
en la ficha del cliente — ver [[wiki/support/plataforma-soporte]].

---

## Walkthrough (primer uso)

`src/components/Walkthrough.tsx` — tour guiado para usuarios nuevos.  
Los tests E2E lo marcan como visto en localStorage antes de correr.

---

## Gestión de múltiples cuentas

`AvatarDropdown` en el header:
- Guarda cuenta actual en `genesis360_saved_accounts` (localStorage)
- Muestra cuentas guardadas con avatar/nombre/tenant
- Cuenta activa marcada con ✓
- Click en otra cuenta → `signOut()` + `navigate('/login?email=...')`
- "+ Agregar otra cuenta" → `signOut()` + `navigate('/login')`

---

## Defaults al registrar negocio — v1.8.28-dev (migrations 112 + 114)

El trigger `trg_seed_tenant_defaults` (SECURITY DEFINER) crea automáticamente al insertar un tenant:

1. **Sucursal 1** — primera sucursal del negocio
2. **Caja Principal** — caja operativa asignada a Sucursal 1
3. **11 motivos de movimiento** (`ingreso`, `rebaje`, `caja`, `ambos`) marcados `es_sistema=true`
4. **2 estados de inventario** — Disponible (verde) + Bloqueado (rojo)

Los motivos `es_sistema=true` muestran badge "sistema" en ConfigPage y no tienen botones editar/eliminar.

---

## Fix duplicados de tenant en Onboarding (v1.8.28-dev)

**Problema:** si el usuario volvía a `/onboarding` con sesión activa y submitaba el formulario de negocio, se creaba un segundo tenant. El `users` INSERT fallaba con duplicate key, pero el tenant quedaba huérfano.

**Fixes aplicados en `OnboardingPage`:**
- `useState(() => {})` → `useEffect(() => {}, [])` (era uso incorrecto del hook)
- Al detectar sesión activa: consulta si ya hay `users` record → si existe, va directo a `/dashboard`
- Si el `users` INSERT falla: hace rollback del tenant (`DELETE FROM tenants WHERE id = tenantId`)
- Toast de error muestra el mensaje real de `PostgrestError` (antes siempre mostraba "Error al registrar")

---

## Fix registro nuevo negocio — v1.8.27 (migration 110)

**Bug:** Al registrar un negocio nuevo con email nuevo, el formulario mostraba "Error al registrar" sin completar el registro.

**Causa raíz:** El trigger `trg_crear_caja_fuerte` en la tabla `tenants` (que crea la Caja Fuerte/Bóveda por defecto) disparaba inmediatamente al hacer el INSERT del tenant. Como el usuario todavía no había sido insertado en `users` (paso siguiente), la RLS de `cajas` rechazaba el INSERT.

**Fix:** `fn_crear_caja_fuerte` declarada `SECURITY DEFINER` + `SET search_path = public`. Ahora el INSERT en `cajas` omite la RLS durante la creación inicial del tenant.

> [!NOTE] `PostgrestError` (Supabase) no es instancia de `Error`, por lo que el catch mostraba el fallback genérico "Error al registrar" en vez del mensaje real.

---

## 🎬 Guion de videos de onboarding (2026-09-12)

Pedido de GO: grabar una serie — (1) desde `genesis360.pro` hasta tener el negocio creado y entrar,
(2) configuración inicial para modo básico, (3) por funcionalidad. Se escribió el guion de pasos
obligatorios sacado del flujo REAL del código: [[wiki/manuales/guion-videos-onboarding]].

> [!WARNING] **Hallazgo clave**: `mailer_autoconfirm` es `true` en DEV y `false` en PROD — en DEV el
> alta **no pide confirmar el mail**, en PROD **sí**. Grabar el video en DEV saltea un paso entero del
> flujo real que un usuario nuevo de PROD sí ve.

---

## Refresco de sesión con el backend caído (2026-09-06)

El cliente de Supabase (auth-js 2.98) reintenta `POST /auth/v1/token?grant_type=refresh_token` **sin techo
global**: un ticker de 30 s que nunca se detiene, con ~7 reintentos internos por tick y **cero contador de
fallos entre ticks**. Medido en DEV: 595 requests en 24 h, 563 con 5xx, sosteniendo ~65/hora durante 5 horas
seguidas. La app amplificaba la caída que la estaba rompiendo.

Desde v1.196.x el cliente lleva un **cortacircuitos** (`src/lib/authRefreshBreaker.ts`, cableado en
`global.fetch` de `src/lib/supabase.ts`): backoff exponencial con jitter, corte local sin tráfico de red, y
se rinde tras 10 fallos consecutivos mostrando `AvisoSesionSinRefresco` con **Reintentar** / **Volver a
entrar**. Un blip del backend **no** desloguea al usuario; un `invalid_grant` real sí lleva a login limpio.

Detalle completo (incidente, causa raíz, medición y cobertura): [[wiki/architecture/resiliencia]].

---

## Links relacionados

- [[wiki/features/suscripciones-planes]]
- [[wiki/architecture/multi-tenant-rls]]
- [[wiki/architecture/estado-global]]
- [[wiki/architecture/resiliencia]]
- [[wiki/database/triggers]]
- [[wiki/support/plataforma-soporte]]
- [[wiki/manuales/guion-videos-onboarding]]
