---
title: Integración Mercado Pago
category: integrations
tags: [mercado-pago, pagos, suscripciones, webhook, qr, addon, argentina]
sources: [CLAUDE.md]
updated: 2026-07-04
---

# Integración Mercado Pago

Mercado Pago se usa para dos fines distintos en Genesis360:
1. **Suscripciones** de la plataforma (tenants pagan su plan)
2. **Pagos de ventas** (clientes del tenant pagan con MP QR)

---

## 1. Suscripciones de la plataforma

### Modelo: preapproval (suscripción recurrente)

```
Usuario hace clic en "Suscribirse"
  → Frontend construye init_point DIRECTAMENTE:
    https://www.mercadopago.com.ar/subscriptions/checkout
      ?preapproval_plan_id={id}
      &external_reference={tenant_id}
      &back_url={appUrl}/suscripcion
  → Usuario paga en MP
  → MP envía webhook a mp-webhook
  → EF actualiza tabla subscriptions
```

> [!WARNING] **No usar** `POST /preapproval` vía Edge Function — MP requiere `card_token_id` que no tenemos en este flujo. El `init_point` se construye en el frontend directo.

> [!CAUTION] **🔴 CRÍTICO (confirmado 2026-07-03 en PROD): MP NO persiste `external_reference` NI `payer_email` en los checkout por PLAN** (`preapproval_plan_id`). El preapproval queda con "Código de referencia" y email de pagador VACÍOS (verificado: 10/10 preapprovals reales). Por eso el linkeo preapproval↔tenant **no puede** hacerse por esos campos — el ÚNICO link confiable es el **`preapproval_id`** que MP devuelve en el redirect (`/suscripcion?status=approved&preapproval_id=...`).
>
> **Estado (v1.107.0, Fase 1):** ✅ **Cancelación** arreglada + validada e2e en PROD (linkeo por `mp_subscription_id` guardado + **fail-closed**: la DB solo pasa a `cancelled` si MP confirmó). ❌ **Activación por UI ROTA** — el fix por `payer_email` no sirve (email vacío), y el retorno del checkout falla: **(a)** 401 de sesión (verify se llama antes de que la sesión esté lista en el redirect); **(b)** `handleVerificarPago` hace `if (!tenant) return` y el `useEffect [status]` no reintenta si el tenant no cargó; **(c)** la pantalla "¡Pago aprobado! se activó correctamente" es ESTÁTICA (se muestra por `status=approved`, no refleja el estado real → MIENTE). Neto: el cliente paga, MP lo registra, pero la app nunca linkea. **FASE 2 pendiente = rework de `SuscripcionPage`:** esperar sesión+`tenant` + **reintentar** el verify con el `preapproval_id`; pantalla que refleje el estado REAL; **quitar el botón "Verificar/Ya pagué"** (email-search, inútil sin `payer_email`). El EF `mp-verificar-suscripcion` YA activa bien dado un `preapproval_id`; el problema es 100% frontend.

### IDs de planes PROD

```
Básico: 836c7829f7e944c9ac58d7c0c67a513b  ($4.900 ARS/mes)
Pro:    cb3bcdaa39bc444da4e17a517d5eadd1  ($9.900 ARS/mes)
```

Definidos en `brand.ts` → `MP_PLAN_IDS`.

### `external_reference` = `tenant_id`

El campo `external_reference` identifica al tenant en el webhook. Al recibir un evento de pago de suscripción, el webhook busca el tenant por este campo.

### Estados mapeados

| Estado MP | Estado en Genesis360 |
|-----------|---------------------|
| `authorized` | `active` |
| `pending` | `trial` (mantiene acceso) |
| `cancelled` | `cancelled` |
| `paused` | `inactive` |

---

## 2. Pagos de ventas con QR

### EF `mp-crear-link-pago`

- Crea una `preference` de MP con `external_reference = venta.id` (UUID)
- Para ventas directas: `preVentaId` UUID pre-generado
- Retorna URL de QR/link de pago

### Flujo en VentasPage

1. Cajero hace clic en botón QR en checkout
2. Se genera link de pago via EF
3. Cliente escanea el QR o abre el link
4. Polling cada 4s en el frontend
5. Cuando llega el pago → pantalla "¡Pago recibido!" → botón Finalizar

### Toast global en AppLayout

Cada 30s consulta `ventas_externas_logs` (MercadoPago, últimos 5 min) y, por cada log con
`payload_raw.monto`, muestra un toast `💳 monto · fecha · hora`.

### Conciliación del cobro (REGLA #0, v1.90.0)

> Auditoría completa en `tests/specs/cobertura/06_integraciones_cobro.md`. El módulo nunca se ejerció en
> PROD (0 credenciales MP conectadas) ⇒ los bugs eran latentes; se arreglaron antes de habilitar cobro real.

**Tabla de idempotencia/conciliación:** `ventas_externas_logs` — columna de datos = **`payload_raw`** (JSONB),
NO `payload`. Clave `webhook_external_id`: `mp-payment-{id}` (venta existente) o `mp-preventa-{id}` (pre-venta).
`UNIQUE(tenant_id, integracion, webhook_external_id)` da la idempotencia ante reintentos de MP.

**Dos flujos, dos puntos de asiento de caja (sin doble conteo):**

1. **Venta directa (pre-venta):** el webhook llega antes de crear la venta → guarda `mp-preventa-{preVentaId}`
   en `payload_raw`; `registrarVenta` lo lee y aplica `monto_pagado`. **La caja la asienta `registrarVenta`**
   según el medio del carrito (el webhook NO toca caja).
2. **Venta existente (saldo de reserva / CC por QR):** el **webhook es autoritativo** → setea
   `id_pago_externo`/`money_release_date`, suma `monto_pagado` (cap al total) y asienta **un**
   `ingreso_informativo [Mercado Pago] Venta #N` contra una sesión de caja **operativa** abierta de la sucursal
   (excluye Bóveda; sin caja abierta → no asienta + warn, el saldo igual queda conciliado). El "Finalizar" del
   modal QR solo flipea el estado (`saldoMediosPago: []`).

`mp-webhook` y `mp-ipn` quedaron **espejadas** (misma conciliación + `payload_raw` normalizado). La registrada
en el dashboard es `mp-webhook` (es la `notification_url` de `mp-crear-link-pago`).

---

## 3. Add-ons (Pricing 2026)

### 3.a Add-on TEMPORAL de movimientos (Fase 2, 2026-07-02)

```
Usuario elige pack 1.000 / 5.000 / 20.000 movimientos
  → EF mp-addon (revalida el precio contra el catálogo server-side)
    crea preference de PAGO ÚNICO
    external_reference = `${tenant}|addon|movimientos|${cantidad}|temporal`
  → mp-webhook parsea la ref (parseAddonRef)
    INSERT tenant_addons (dimension='movimientos', tipo='temporal', vence_at = pago+30d,
                          mp_payment_id=<paymentId>)
  → idempotente por uq_tenant_addons_mp_payment (mig 253): reintento de MP = 23505 ignorado
```

El límite EFECTIVO lo calcula `fn_tenant_limite` (base + Σ add-ons activos, temporales no vencidos).
`usePlanLimits` lo espeja en el cliente. **El add-on temporal ya NO usa `tenants.addon_movimientos`**
(esa columna legacy queda solo para packs viejos de 500; back-compat en el webhook).

### 3.b Add-ons FIJOS (recurrentes) + downgrade guiado (Fase 3, 2026-07-02 · deployado, oculto por kill-switch)

```
Alta:  EF mp-addon-fijo (action='agregar', dimension sku/sucursales/usuarios, cantidad)
  → lee el transaction_amount ACTUAL del preapproval (GET /preapproval/{id})
  → PUT /preapproval/{id} auto_recurring.transaction_amount = actual + precio_pack  (DELTA)
  → fail-closed: si el PUT falla, NO se otorga el add-on
  → INSERT tenant_addons (tipo='fijo', vence_at=NULL)
Baja:  EF mp-addon-fijo (action='quitar', addon_id)
  → downgrade GUIADO server-side: fn_tenant_limite(dim) − cantidad vs uso activo;
    si uso > nuevo límite → 200 {blocked:true, excedente, ...} (el usuario desactiva recursos primero)
  → PUT transaction_amount = actual − precio_pack ; DELETE tenant_addons
```

> [!WARNING] **EF deployada DEV+PROD, pero `PUT transaction_amount` NUNCA validado e2e en sandbox.**
> El configurador in-app de add-ons fijos está **oculto detrás del kill-switch `ADDON_FIJO_ENABLED=false`**
> (`brand.ts`, v1.111.0) hasta que GO valide el cobro real (ver sección 3.g y el runbook §11 del UAT).
> **H7 (hallazgo 2026-07-04): el kill-switch es frontend-only** — el EF sigue invocable server-side
> (riesgo aceptado, documentado, mientras dure la validación). El estimador público del Landing y el
> add-on temporal de movimientos NO dependen del flag. El precio SIEMPRE sale del catálogo server-side
> (REGLA #0). Los planes base de MP ya están en $60k/$100k (RIESGO #1 resuelto 2026-07-02).

### 3.c EFs tier-aware (Fase 3a)

`mp-webhook` y `mp-verificar-suscripcion` ahora setean **`tenants.plan_tier`** (mapeo
`preapproval_plan_id`→`basico`/`pro`, env `MP_PLAN_BASICO`/`MP_PLAN_PRO`) al activar, en vez de los
`max_users`/`max_productos` viejos (que `usePlanLimits` ya no lee). Cierra medio RIESGO #1.

### 3.d Cancelación de suscripción (v1.104.0 / v1.106.0)

```
Usuario (Mi Cuenta) o AdminPage → EF cancel-suscripcion (deriva tenant del JWT;
  admin puede pasar { tenant_id })
Panel admin.genesis360.pro → EF admin-api acción billing.cancel_subscription
  → ambos: buscar preapproval(s) del tenant (mp_subscription_id + /preapproval/search
    por external_reference, filtrado client-side) → verificar external_reference===tenant
    → PUT /preapproval/{id} { status: 'cancelled' }
  → FAIL-CLOSED: solo marca subscription_status='cancelled' si MP confirmó
```

**Bug histórico (Fede Messina, 2026-07-02):** el EF `cancel-suscripcion` NO existía → `MiCuentaPage`
fallaba (con id) o hacía un UPDATE local a ciegas (sin id) → MP seguía cobrando. Fix: EF nuevo +
`MiCuentaPage`/`AdminPage`/panel siempre pasan por un EF.

> [!WARNING] **`/preapproval/search?external_reference=X` NO filtra** (devuelve todos, 200) → se filtra
> client-side por el `external_reference` que trae cada resultado + se pagina. El `PUT cancel` sí es fiable.

> [!WARNING] **No se puede sandbox-testear el ALTA del app en vivo.** Los planes `836c…`/`cb3b…` viven en
> la cuenta REAL de GO → pagar con un *Buyer Test User* da **"una de las partes es de prueba"** (test+prod).
> Test real: bajar el plan a un monto chico, que un TERCERO real pague desde la app, cancelar, devolver, y
> volver el plan a $60k (y **vos como vendedor no podés pagarte a vos mismo**).

### 3.e Flujo de activación al volver del checkout (Fase 2, v1.108.0)

```
Checkout MP → back_url /suscripcion?status=approved&preapproval_id=XXX
SuscripcionPage useEffect([status, esAddon, preapprovalId]):
  await supabase.auth.getSession()          # el redirect recarga la app → el JWT puede no estar listo (401)
  loop 4× (cada 2,5s):
    invoke mp-verificar-suscripcion { preapproval_id }   # la EF deriva el tenant del JWT
      200 { activated:true }        → 'ok'  → loadUserData(uid) ANTES de navigate('/dashboard')
      200 { activated:false, reason } (no_encontrado/no_autorizado) → 'pendiente' → reintentar
      4xx/5xx (owner_mismatch/ya_reclamada/plan_desconocido/500)    → 'error' (mensaje por reason)
  agotados los reintentos sin 'ok'/'error' → 'pendiente'
```

**Bug histórico (v1.108.0, revenue):** un cliente pagaba y **no se activaba solo**. Tres causas, todas en
`SuscripcionPage` (el EF ya activaba bien): (1) invocaba la EF con el JWT sin restaurar (401) y `if (!tenant)
return` con `useEffect` en `[status]` → **no reintentaba**; (2) la pantalla de resultado era **estática y
mentía** ("se activó") sin verificar; (3) el botón email-search era inútil (MP manda `payer_email` **vacío**
en checkout por plan). Fix: esperar la sesión + no depender del `tenant` del store + reintentos + pantalla
por estado real + `loadUserData` antes de navegar (evita rebote de `SubscriptionGuard`) + se quitó el botón.

> [!IMPORTANT] La activación **solo se valida en PROD con un pago real** — el token MP de DEV es de otra
> cuenta y no ve las subs reales. Con `payer_email` vacío la EF activa por `preapproval_id` + claim exclusivo.

### 3.f Recuperar una suscripción HUÉRFANA (soporte, panel admin)

Si una suscripción quedó **activa en MP pero sin linkear** en la app (el checkout-return falló, o el
cliente cerró la pestaña), **no se puede autorrecuperar** desde la app: MP manda `payer_email` y
`external_reference` **vacíos** en checkout por plan → no hay por dónde buscarla salvo el `preapproval_id`.

**Herramienta de soporte:** en `admin.genesis360.pro` → ficha del cliente → **"Linkear suscripción"**: se
pega el `preapproval_id` (del panel de MP → Suscriptores → Ver detalles) y se invoca `admin-api` acción
**`billing.link_subscription`** (módulo `billing`). La EF **verifica contra MP** (`status:'authorized'` +
`preapproval_plan_id` de un plan nuestro + **no reclamada** por otro tenant), **cancela una suscripción
anterior distinta** para evitar doble cobro, y recién ahí activa (`subscription_status='active'` +
`mp_subscription_id` + `plan_tier`). Mismo criterio de pertenencia que `mp-verificar-suscripcion`.

> [!TIP] Alternativa sin panel: que el cliente (logueado, con v1.108.0) abra
> `/suscripcion?status=approved&preapproval_id=<ID>` → dispara el mismo camino verificado.

### 3.g UAT re-auditado + espejos de test (2026-07-04, test-only, sin deploy)

A pedido de GO ("revisar el UAT de cobros MP, complementarlo para que sea robusto y testear todo"),
se releyó `tests/specs/mp-suscripciones-pagos.plan.md` contra el código real v1.108→v1.111 (los EFs
de arriba + `SuscripcionPage`/`MiCuentaPage`/`AuthGuard`). Pasó de **43 a 48 escenarios**:

- **Nuevos:** MP-A12 (checkout-return v1.108), MP-A13 (`billing.link_subscription` v1.109, e2e ✅
  PROD), MP-C11 (eliminar cuenta cancela MP fail-closed antes de borrar, v1.110), MP-AD9 (kill-switch
  `ADDON_FIJO_ENABLED` v1.111), MP-AD10 (`mensajeErrorEF`).
- **Actualizados:** MP-C7 (MITIGADO en `cancel-suscripcion` por `payer_email`; `admin-api` sin ese
  fallback → hallazgo **H8**), MP-C9 (✅ IMPLEMENTADO v1.110 + sub-escenarios grace period).
- **Hallazgos nuevos:** **H7** (`ADDON_FIJO_ENABLED` es frontend-only — el EF `mp-addon-fijo` sigue
  invocable server-side; riesgo aceptado documentado) y **H8** (drift entre `cancel-suscripcion` y
  `admin-api.cancelarSubMP`: solo el primero tiene el fallback por `payer_email`).
- **Sección 11 nueva:** RUNBOOK de validaciones e2e con plata real en PROD (checkout-return fresco →
  add-on fijo sobre esa sub → cancelación real → cierre/refund/volver plan a $60k).

**Espejos de test agregados** (patrón ccLogic, lógica pura + vitest, sin cambiar el EF):
- `src/lib/mpAddonFijo.ts` — espejo de `mp-addon-fijo` (alta fail-closed, revert si insert falla, baja
  con downgrade guiado, delta de precio, race documentada) + 18 tests.
- `src/lib/accesoSuscripcion.ts` — `tieneAccesoVigente()` extraída del `SubscriptionGuard`; **el propio
  `AuthGuard.tsx` la importa** (lo testeado es lo que corre) + 10 tests (bordes de grace MP-C9).
- `mensajeErrorEF` (parsea `error.context` de un `FunctionsHttpError`) exportado desde
  `src/lib/suscripcionActivacion.ts` + 4 tests.

Suite: **904 unit tests** (antes 873). Detalle completo del plan en `tests/specs/mp-suscripciones-pagos.plan.md`.

---

## Edge Functions

| Función | JWT | Propósito |
|---------|-----|-----------|
| `crear-suscripcion` | Sí | Deprecated (se usa init_point directo ahora) |
| `mp-webhook` | No | Eventos de pagos Y suscripciones (setea `plan_tier`; add-on temporal → `tenant_addons`) |
| `mp-ipn` | No | IPN alternativo para pagos de ventas |
| `mp-crear-link-pago` | Sí | Genera preference de pago por venta |
| `mp-addon` | Sí | Add-on TEMPORAL de movimientos (pago único, packs 1.000/5.000/20.000) |
| `mp-addon-fijo` | Sí | Add-on FIJO (alta/baja + `PUT transaction_amount` del preapproval) — deployada DEV+PROD, **configurador in-app oculto por kill-switch `ADDON_FIJO_ENABLED` hasta validar el cobro en sandbox** (ver 3.g, H7) |
| `mp-verificar-suscripcion` | Sí | Verifica el preapproval server-side y activa (setea `plan_tier`) |
| `cancel-suscripcion` | Sí | **Cancela** el/los preapproval(s) en MP (`PUT status:'cancelled'`) + marca la cuenta cancelada. Robusto al drift: si falta `mp_subscription_id`, busca por `external_reference` en `/preapproval/search`. Fail-closed. (v1.104.0) |
| `mp-oauth-callback` | No | OAuth de la cuenta del seller |

### Routing en `mp-webhook`

```
Recibe payload de MP
  → Extrae user_id (seller_id)
  → Si coincide con mercadopago_credentials.seller_id
      → Pago de VENTA (usa access_token del seller, actualiza venta)
  → Si no coincide
      → Pago de PLATAFORMA (addon/suscripción, comportamiento anterior)
```

### `mp-ipn`

Alternativa independiente:
- Recibe notificación → verifica en MP API → busca venta por `external_reference` (= `venta_id` UUID)
- Actualiza `id_pago_externo` + `money_release_date`
- Idempotencia via `ventas_externas_logs` con clave `mp-preventa-{id}`

---

## OAuth para sellers (Integraciones)

`mp-oauth-callback` (sin JWT):
- Recibe `?code&state`
- Intercambia code → calcula `expires_at` (180 días)
- Obtiene seller email
- Upsert en `mercadopago_credentials`

**Credenciales por sucursal:**
```sql
mercadopago_credentials(
  tenant_id, sucursal_id, seller_id, seller_email,
  access_token, refresh_token, public_key, expires_at,
  conectado, UNIQUE(tenant_id, sucursal_id)
)
```

Token expira en 180 días. Badge "Vencido" en UI si `expires_at < now()`.

**Client ID:** `7675256842462289`  
**Secrets:** `MP_CLIENT_SECRET`, `MP_ACCESS_TOKEN` en Supabase EF secrets

---

## Variables de entorno

```env
# Frontend (Vercel)
VITE_MP_PUBLIC_KEY=           # Clave pública para SDK frontend
VITE_MP_CLIENT_ID=7675256842462289

# Edge Functions (Supabase secrets)
MP_ACCESS_TOKEN=              # Token de la cuenta de Genesis360
MP_WEBHOOK_SECRET=            # HMAC para validar webhooks
MP_CLIENT_SECRET=             # OAuth secret
```

### Webhook registrado en MP Dashboard

```
URL: https://jjffnbrdjchquexdfgwq.supabase.co/functions/v1/mp-webhook
Eventos: Pagos ✅ + Planes y suscripciones ✅
```

---

## Validación de webhooks

> [!WARNING] **No hay validación HMAC** en `mp-webhook`/`mp-ipn` (a pesar de que exista el secret
> `MP_WEBHOOK_SECRET`). Lo que da la garantía de autenticidad es que la EF **re-fetchea el pago a la API
> de MP** (`GET /v1/payments/{id}`) con el `access_token` del seller: un payload falso con un `payment_id`
> inválido devuelve no-aprobado/404 y no toca la DB. Si en el futuro se quiere endurecer, agregar validación
> de firma `x-signature` con `MP_WEBHOOK_SECRET` ANTES del re-fetch.

---

## Consideraciones Argentina

- Precios en ARS
- Modelo preapproval (suscripción mensual automática)
- Para planes Enterprise: pago fuera de la plataforma
- MP requiere cuenta vendedor verificada para cobrar

---

## Links relacionados

- [[wiki/features/suscripciones-planes]]
- [[wiki/integrations/mercado-libre]]
- [[wiki/architecture/edge-functions]]
