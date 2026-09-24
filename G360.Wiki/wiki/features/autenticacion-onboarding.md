---
title: Autenticación y Onboarding
category: features
tags: [auth, onboarding, google-oauth, trial, suscripcion, guard]
sources: [CLAUDE.md]
updated: 2026-09-24
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

---

## 🛑 El negocio se crea al confirmar el mail (v1.219.0, mig 415) — 2026-09-14

### El bug: el escáner de mails dejaba el alta muerta

Crear el negocio era trabajo del **navegador**: `provisionNegocio()` en `OnboardingPage` corre
después de que el link de confirmación redirige a la app. Si ese aterrizaje no ocurre, no hay
negocio.

Y hay una forma muy común de que no ocurra: **el escáner de links del proveedor de correo**. Gmail
pre-carga las URLs de los mails — medido en un caso real: **94 segundos después del envío**.
Supabase confirma la cuenta y **consume el token, que es de un solo uso**, pero ningún navegador
ejecutó la app.

Quedaba una **cuenta de auth confirmada y válida, sin fila en `users` y sin `tenants`**. Y sin
salida:

| Lo que intenta la persona | Lo que pasaba |
|---|---|
| Clickear el link del mail | `otp_expired` → cae en el formulario de alta, sin sesión |
| Loguearse | La auth funciona, pero la app pega **406** en `users?...` y la rebota a `/login` **sin ningún mensaje** (`/login`→`/dashboard`→`/login`) |
| Registrarse de nuevo | Anti-enumeración de Supabase → *"Revisá tu email"* para siempre |

Y el mail quedaba quemado. Outlook Safe Links y los escáneres corporativos hacen lo mismo.

### El arreglo, en dos niveles

**1. Server-side (mig 415).** Un trigger sobre `auth.users` crea `tenants` + `users` al confirmarse
el mail, sin depender del navegador. Es el mismo criterio que la REGLA #0 exige en lo fiscal:
**guard server-side ADEMÁS de la UI**. Que el alta de un negocio dependa de que un navegador llegue
a una página es tan frágil como validar un permiso solo en el frontend.

- **Dos disparadores**: `AFTER UPDATE OF email_confirmed_at` (PROD, `mailer_autoconfirm` false) y
  `AFTER INSERT` (DEV, que autoconfirma). Así DEV se comporta como PROD y se puede probar.
- **Solo altas self-service**: son las únicas con `ob_nombre`+`ob_pais` en el metadata. Invitados,
  agentes del panel (mig 221) y cuentas del Portal de Proveedores quedan afuera a propósito.
- 🛑 **Nunca hace fallar la confirmación**: atrapa cualquier error y avisa. Si propagara, la persona
  no podría ni confirmar su cuenta — un bug peor que el que arregla. **Probado forzando un error
  adentro: la cuenta se confirma igual.**
- El frontend **no se saca**: sigue siendo el camino normal y el único para Google OAuth (que nace
  confirmado, sin `UPDATE`). Si corren los dos, el `EXISTS` cubre el caso normal y en la carrera
  exacta gana el trigger (`users.id` es PK y `provisionNegocio` ya borra su tenant al fallar).

**2. La carrera del login.** `LoginPage` hacía `navigate('/dashboard')` **sin esperar** a
`loadUserData`, así que el `AuthGuard` evaluaba con la store vacía (`user: null`,
`needsOnboarding: false`) y mandaba a `/login`. Es el mismo gotcha que el CLAUDE.md documenta para
Google OAuth; el camino de email/contraseña lo tenía igual.

Por eso la **vía de recuperación de `OnboardingPage` (líneas 78-88) era inalcanzable**: existía,
funcionaba, pero nada llevaba hasta ella. Ahora el login espera y rutea por el resultado — sin fila
en `users` va a `/onboarding`, que sabe terminar el trabajo.

**3. `ob_terminos_version` en el metadata del alta**, para que el trigger no tenga que inventar una
versión de T&C — o sea, falsear un consentimiento legal.

### Lo que no hace

No manda el mail de bienvenida (eso lo dispara el frontend con la EF `send-email`). Si la persona
nunca aterriza, tiene su negocio pero no recibe ese mail. Detalle menor frente a quedarse sin
negocio, y evita meter `pg_net` en el camino de la confirmación.


---

## 📄 Guía para clientes: "Primeros pasos, de cero a tu primera venta" (2026-09-23)

**Artifact**: https://claude.ai/artifact/WBZVSEjGy623cSE9urXV1T · **PDF** en
`E:\OneDrive\Documentos\Primeros pasos en Genesis360.pdf` (7 páginas, generado con el Chromium de
Playwright y verificado página por página).

Pedido de GO: una guía de inicio con las configuraciones principales para poder operar y hacer las
primeras ventas. **No existía** — los `manual-*-genesis360.html` son por rubro y cubren el flujo
completo, no el arranque.

**Fundada en el código, no en supuestos**: el bloqueo real de la primera venta salió de
`VentasPage.tsx` (*"No hay caja abierta. Abrí una caja antes de registrar ventas o reservas (incluso
en cuenta corriente)"*), lo que ya viene sembrado salió de `fn_seed_tenant_defaults`
(`schema_full.sql`), y los roles y las descripciones de los modos son literalmente los de
`UsuariosPage.tsx` y `ConfigPage.tsx`.

**Estructura**: arranca con *"Esto ya está hecho, no lo busques"* (sucursal, Caja Principal, 5 métodos
de pago, motivos, estados, unidades y cuentas de origen — todo del seed), después 8 pasos con código
de color (violeta = configuración de una sola vez · verde = rutina diaria): modo Básico/Avanzado →
datos del negocio → métodos de pago → productos → equipo y roles → **abrir la caja** → primera venta
→ cierre con arqueo. Cierra con qué sumar después y 5 problemas comunes.

✅ **La advertencia que traía sobre reimportar quedó obsoleta.** Contenía un aviso de que el archivo de
*Exportar productos* no servía para reimportar (hallazgo D-3, `tests/specs/uat-modo-basico.md` §66.8).
D-3 se cerró el 2026-09-24 y está **EN PROD desde v1.231.0**: el export ya es reimportable de punta a
punta. **Pendiente menor: sacar esa advertencia de la guía** (no se tocó el PDF en esta sesión). Ver
[[wiki/features/productos]] → "Importador CSV — columnas de moneda (A0)".

🚧 **Le faltan capturas de pantalla** — la de facturación las tiene porque salieron de una sesión
grabada. Pendiente: grabarlas contra el tenant de prueba (Modo de operación, Métodos de pago, Abrir
caja, POS).

Ver [[wiki/features/facturacion-afip]] ("Guía para clientes + video") para la otra guía, y
[[wiki/manuales/guion-videos-onboarding]].

---

## 🔐🔑 v1.231.0 — "Desactivar" corta el acceso de verdad (mig 433) + Usuarios sin correo (mig 434) — 🚀 EN PROD desde 2026-09-24

PR **#357**, merge commit **`313b7f6d`**, release **`v1.231.0`** (`--latest`). Migraciones **001-434**,
aplicadas y verificadas en DEV y en PROD. Paridad de policies DEV=PROD por hash **por schema**: `public`
**234** · `storage` **40** · `cron` **2**, hashes idénticos. Antes: PROD en `v1.230.0` (migs 001-432).

## 🔐 "Desactivar" un usuario le corta el acceso de verdad (mig 433, 2026-09-24) — ✅ APLICADA Y PROBADA EN DEV Y EN PROD

Salió contestando una pregunta de GO sobre cómo conviene manejar las cuentas de los empleados.

🛑 **El agujero que tenía la app**: dar de baja a alguien no le quitaba nada. La cadena completa,
verificada:

- El botón **"Desactivar"** de `UsuariosPage` escribe `users.activo = false` y nada más — es la
  **única** acción que existe sobre un usuario, no hay eliminar.
- `get_user_tenant_id()` era `SELECT tenant_id FROM users WHERE id = auth.uid()`, **sin mirar
  `activo`** — y esa función gobierna el `USING` de casi todas las policies de RLS del schema
  `public`. El usuario dado de baja seguía viendo y escribiendo todo lo de su rol.
- `users_select` tampoco filtraba, ni `loadUserData` en el frontend. `user.activo` no se consultaba en
  **ningún** lado de la app.

O sea que desde la app **no había forma de cortarle el acceso a un empleado que se fue**.

### La migración (`433_desactivar_usuario_corta_acceso.sql`)

1. **`get_user_tenant_id()` e `is_admin()` dejan de resolver** para un usuario dado de baja. Una sola
   función y queda cerrado para todas las tablas a la vez, del lado del servidor (ver
   [[wiki/architecture/multi-tenant-rls]] y [[wiki/database/rls-policies]]).
2. **Trigger `trg_guard_baja_usuario`** (`BEFORE UPDATE OF activo`): impide que alguien se dé de baja a
   sí mismo, o que se dé de baja al **último DUEÑO activo** del negocio. Antes era un error cosmético
   sin consecuencia; ahora sería un candado sin llave.
3. **`fn_estado_usuario_actual()`** (`'activo' | 'inactivo' | 'sin_usuario' | 'sin_sesion'`), para que
   la app pueda explicar qué pasó — devuelve información solo sobre uno mismo, no filtra nada de nadie.

⚠️ **`users.activo` es NULLABLE** (`boolean DEFAULT true`): las tres funciones y el trigger usan
`coalesce(activo, true)`, el mismo criterio que ya aplica `fn_soporte_ticket_detalle`. Con `AND activo`
a secas, cualquier fila con NULL habría perdido el acceso — un bug nuevo tapando al viejo.

### El frontend era la mitad imprescindible (`authStore` + `AuthGuard`)

Sin este lado, el usuario dado de baja tampoco puede leer **su propia fila** (la policy `users_select`
ya no lo deja), así que `loadUserData` lo confundiría con "no tiene negocio" y `AuthGuard` lo mandaría
a `/onboarding` — ofreciéndole **crear un negocio nuevo con su misma identidad** (el INSERT chocaría
contra su fila vieja y moriría con un error crudo de SQL). Lo marcó el `migration-reviewer` como el
hallazgo más importante de la revisión.

Ahora `authStore.loadUserData` llama a `fn_estado_usuario_actual()` cuando no encuentra `users` ni
`proveedor_accounts`, y distingue `accesoRevocado` de `needsOnboarding`. `AuthGuard` muestra **"Tu
acceso fue dado de baja"** con el botón de cerrar sesión, evaluado ANTES del redirect a onboarding.

### Lo que NO se ve afectado (confirmado por `migration-reviewer`)

- **`admin.genesis360.pro`** (panel de plataforma): autentica contra `support_agents` con
  `service_role`, no pasa por `is_admin()`.
- **El alta de un negocio nuevo**: los triggers de seed usan `NEW.id`, no llaman a
  `get_user_tenant_id()`.

### ✅ Aplicada y probada en DEV (2026-09-24, 2ª sesión) — luego a PROD

La sesión anterior la había dejado **escrita, revisada por `migration-reviewer` (APTA), pero SIN
APLICAR**: el conector de Supabase se había desconectado a mitad de sesión. Esta sesión: fuente real
verificada antes de reemplazar (`get_user_tenant_id()`/`is_admin()` estaban exactamente como decía la
migración), los 26 usuarios de DEV estaban en `activo = true` (ningún `NULL`), así que aplicarla **no le
cortó el acceso a nadie**. Acentos verificados post-aplicación con `prosrc LIKE` (gotcha conocido de
`apply_migration`).

Probado contra DEV, UAT §67:
- **67.1** — impersonando al supervisor con `SET LOCAL ROLE` + `request.jwt.claims`: antes de la baja
  veía 26 productos / 4 ventas / 2 clientes / su propia fila; después, **0 / 0 / 0 / 0** y
  `get_user_tenant_id() = NULL`. Todo dentro de una transacción descartada: no quedó nadie de baja.
- **67.5** — los dos candados del trigger rebotan con su mensaje. El de "darse de baja a uno mismo"
  saltó incluso sin buscarlo: el `UPDATE` de prueba corría con el `auth.uid()` del propio usuario.
- **67.2** — spec e2e nuevo `158_acceso_revocado_mutante`, con dos usuarios reales: el DUEÑO da de baja
  al contador desde `/usuarios`, el contador entra con su contraseña en un contexto limpio y ve **"Tu
  acceso fue dado de baja"** (y NO `/onboarding`), lo reactivan, vuelve a entrar normal.

🛑 **El agujero que abría la propia migración: no se podía deshacer una baja.** `UsuariosPage` gateaba
TODAS las acciones con `canManage && u.activo`, y no existía "Reactivar" en ningún lado del archivo —
mientras la baja era cosmética daba igual; con la 433 aplicada, una baja por error quedaba como un
**candado sin llave** (la app tampoco tiene "eliminar usuario"). Se agregó la mutación `reactivar` + su
botón, solo DUEÑO — la policy `users_update_owner` ya lo permitía porque compara el `tenant_id` de la
FILA, que la baja no toca. El confirm de "Desactivar" ahora avisa que la persona pierde el acceso.

**Auditoría de que el corte es completo** (UAT §67.9): de las 234 policies de `public`, las únicas que
no pasan por `tenant_id`/`get_user_tenant_id()` son 3 de catálogo público sin datos del negocio
(`planes`, `consumo_tarifas`, `ayuda_recursos` publicados). `get_user_role()` sigue sin mirar `activo`,
pero toda policy que lo usa lo acompaña de `tenant_id = get_user_tenant_id()`, que ya da `NULL`.

UAT `tests/specs/uat-modo-basico.md` §67: **9/10 ✅** (67.10 queda 🟡 — el límite del plan no se
ejercita porque el tenant de pruebas tiene límite `-1`, ilimitado). **🚀 EN PROD desde v1.231.0** (PR
#357, merge `313b7f6d`), aplicada y verificada también ahí.

---

## 🔑 Usuarios sin correo — empleados con nombre y contraseña (mig 434, 2026-09-24) — 🚀 EN PROD desde v1.231.0

Pedido de GO. En un negocio chico los empleados no tienen mail propio, o tienen uno que no revisan
nunca, y `invite-user` exigía una dirección real (`inviteUserByEmail` manda un magic link) — el dueño
terminaba inventando casillas o usando la suya para todo el equipo (ver la recomendación de Gmail `+`
más abajo, que sigue vigente para quien no adopte esta feature).

**Las dos decisiones que tomó GO el 2026-09-24** (el resto sale de ahí):
1. Al ingresar, el empleado escribe el **código del negocio + su usuario**, no una dirección — por eso
   el nombre de usuario solo tiene que ser único DENTRO del negocio.
2. La contraseña que le pone el dueño es **de un solo uso**: está obligado a cambiarla en el primer
   ingreso, así la sabe únicamente el empleado, y el log de actividad es indiscutiblemente suyo.

Por dentro, la identidad de Supabase Auth es `<usuario>.<codigo>@u.genesis360.pro`, un dominio que no
recibe correo. El empleado nunca la ve ni la escribe: la compone la app (`src/lib/usuarioLocal.ts`, 16
tests, incluido uno que verifica que todo lo que el frontend da por válido pasa también el CHECK de la
base).

### La migración (`434_usuarios_sin_correo.sql`)

- **`tenants.codigo`**: único e **INMUTABLE**, generado del nombre del negocio por el trigger
  `trg_tenant_codigo` (`BEFORE INSERT`, `SECURITY DEFINER` — mismo gotcha de la mig 166: corre antes de
  que exista la fila en `users`, si no el SELECT de colisión lo filtra RLS y siempre reporta "libre").
  Backfill de los 9 negocios de DEV sin colisiones (ej. Kalken → `kalken`, Familia Otranto De Porto →
  `familiaotranto`). ⚠️ **Cambiarlo dejaría afuera a todos los usuarios sin correo de ese negocio**,
  porque su dirección de Auth ya quedó fija — por eso es inmutable, no editable desde ningún lado.
- **`users.usuario`**: `NULL` para las cuentas con correo real, único **por tenant** (índice parcial) —
  no global: dos negocios distintos pueden tener cada uno su "juan".
- **`users.debe_cambiar_password`** + su guard (ver agujero 1 abajo).

### Edge Function `usuarios-sin-correo` (deployada en DEV y en PROD, `verify_jwt: true`)

Acciones `crear` / `resetear-password` / `cambiar-password-propia`. El código del negocio y el
`tenant_id` salen del perfil del LLAMADOR, nunca del body — así un dueño no puede crear usuarios dentro
del negocio de otro. Mismo whitelist de roles que `invite-user` (`ADMIN` no se puede asignar). **Reponer
contraseña funciona SOLO para cuentas sin correo** — pisarle la contraseña a alguien que tiene casilla
propia sería quedarse con su cuenta, no administrar un empleado; esas cuentas se recuperan con "Olvidé
mi contraseña", que les llega a ELLAS. Si el INSERT en `users` falla —el caso real es el límite de
usuarios del plan— borra la cuenta de `auth.users` recién creada, para no dejar el nombre tomado por un
huérfano invisible.

### Frontend

- **`LoginPage`**: modo "sin correo" con dos campos (código del negocio + usuario). El botón nuevo
  rompió los locators laxos (`/ingresar|iniciar sesion|login/i`) de **12 archivos** `*.setup.ts` —
  reescrito a `'Ingresar'` exacto.
- **`AuthGuard`**: pantalla de cambio obligatorio, evaluada ANTES de cualquier ruta (no se saltea por
  URL).
- **`UsuariosPage`**: alta "Sin email" con el código del negocio a la vista, chip del usuario, marca
  "Contraseña sin estrenar", botón para reponer contraseña (solo en cuentas sin correo), y el par
  Desactivar/Reactivar de la mig 433.

### Los dos agujeros que aparecieron, y quién los encontró

1. 🛑 **`users_update_owner` le da al DUEÑO `UPDATE` sin restricción de columna** sobre las filas de su
   negocio — podía apagar `debe_cambiar_password` con un PATCH directo a PostgREST, sin rotar ninguna
   contraseña, y seguir sabiendo la de su empleado para siempre (justo la garantía que la marca existe
   para dar). **Lo encontró `migration-reviewer`**; el comentario original en la migración afirmaba lo
   contrario y estaba mal. Se cerró con el trigger `trg_guard_debe_cambiar_password` (mismo patrón que
   la mig 247): la marca solo BAJA desde `service_role`. También faltaban los `REVOKE` de las funciones
   nuevas — por defecto Postgres da `EXECUTE` a `PUBLIC`, y `anon` está adentro (`fn_generar_codigo_tenant`
   es `SECURITY DEFINER` y lee `tenants` salteándose RLS).
2. 🛑 **Cambiar la contraseña con la Admin API revoca TODAS las sesiones del usuario, incluida la
   suya.** Esto **no lo podía ver ninguna revisión de código** — el código era correcto, el efecto está
   en GoTrue — y solo apareció cuando el spec e2e manejó la app como un empleado real: elegía su
   contraseña nueva y la app lo escupía al login sin una palabra (la bandera quedaba bien en `false`, la
   captura mostraba `/login`). Se cerró reautenticándolo con la contraseña nueva; el reingreso queda
   invisible.

### Validado con la interfaz real, no solo con specs (v1.231.0)

Revisión visual completa manejando la app como usuario (Playwright, 20 capturas revisadas a ojo): los
dos modos de la pantalla de ingreso, el alta "Sin email", la fila del empleado con su marca, el cambio
obligatorio con sus dos validaciones, el reingreso, el modal de reponer contraseña, que una cuenta CON
correo **no** ofrezca reponer (UAT 69.7), y el par Desactivar/Reactivar. Todo correcto.

🐛 **Lo único que salió mal**: la barra de uso del plan en Usuarios mostraba **"13 de -1 usuarios ·
0%"** — `max_usuarios = -1` es el centinela de "sin límite" y `-1 < 999` da `true`, así que entraba en
la barra normal (`ProductosPage` ya trataba ese caso aparte; `UsuariosPage` no). Ahora dice "13 usuarios
· Sin límite en tu plan". Bug preexistente, cosmético, cerrado en el mismo release.

Typecheck limpio, build verde, specs `158` y `159` verdes. UAT `tests/specs/uat-modo-basico.md` §69:
**11/13 ✅** (69.7 y 69.11 quedan 🟡, sin test automatizado — el tenant de pruebas tiene límite de plan
`-1`).

**Mientras tanto**, la recomendación para quien no adopte esta feature (clientes sin dominio propio):
una sola cuenta `negocio@gmail.com` con direcciones `+` por empleado (`negocio+juan@gmail.com`) — Gmail
las entrega todas a la misma casilla. Contras: la invitación le llega al dueño, el empleado no recibe
avisos propios, y el nombre que muestra la app sale de lo que está antes del `@`.

---

## 🧪 De paso: el spec fiscal 146 corría contra el tenant equivocado (2026-09-24)

`146_gasto_cotizacion_fiscal_mutante` (IVA crédito de gastos en moneda extranjera) es del tenant
RESPONSABLE INSCRIPTO y ya tenía su propio proyecto Playwright, `chromium-ri` — pero el `testIgnore` del
proyecto `chromium` no lo excluía, así que corría TAMBIÉN contra el tenant principal (Monotributista),
donde correctamente no se ofrece "Factura A" (no discrimina IVA). Eso dejaba **3 rojos permanentes**, y
un rojo permanente enseña a ignorar los rojos — justo en el único spec que cubre IVA crédito de compras.
Excluido del proyecto `chromium` en `playwright.config.ts`; contra el tenant RI corre 4/4.

Ver `sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ") y `log.md` (2026-09-24, `deploy`).
