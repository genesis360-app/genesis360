---
title: Autenticación y Onboarding
category: features
tags: [auth, onboarding, google-oauth, trial, suscripcion, guard]
sources: [CLAUDE.md]
updated: 2026-04-30
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

## Trial de 14 días

- Comienza automáticamente al registrar un nuevo tenant
- Durante el trial: acceso completo equivalente al plan Pro
- `usePlanLimits` detecta `subscription_status='trial'` con `trial_ends_at` futuro → usa `FEATURES_POR_PLAN['pro']`
- Al vencer: pantalla de pago (SuscripcionPage)

> [!NOTE] Fix v1.3.0: botón "Cerrar sesión" en SuscripcionPage y OnboardingPage cuando el trial vence (el usuario quedaba atrapado en un loop sin poder cerrar sesión).

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

## Fix registro nuevo negocio — v1.8.27 (migration 110)

**Bug:** Al registrar un negocio nuevo con email nuevo, el formulario mostraba "Error al registrar" sin completar el registro.

**Causa raíz:** El trigger `trg_crear_caja_fuerte` en la tabla `tenants` (que crea la Caja Fuerte/Bóveda por defecto) disparaba inmediatamente al hacer el INSERT del tenant. Como el usuario todavía no había sido insertado en `users` (paso siguiente), la RLS de `cajas` rechazaba el INSERT.

**Fix:** `fn_crear_caja_fuerte` declarada `SECURITY DEFINER` + `SET search_path = public`. Ahora el INSERT en `cajas` omite la RLS durante la creación inicial del tenant.

> [!NOTE] `PostgrestError` (Supabase) no es instancia de `Error`, por lo que el catch mostraba el fallback genérico "Error al registrar" en vez del mensaje real.

---

## Links relacionados

- [[wiki/features/suscripciones-planes]]
- [[wiki/architecture/multi-tenant-rls]]
- [[wiki/architecture/estado-global]]
- [[wiki/database/triggers]]
