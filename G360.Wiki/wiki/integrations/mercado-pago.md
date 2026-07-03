---
title: Integración Mercado Pago
category: integrations
tags: [mercado-pago, pagos, suscripciones, webhook, qr, addon, argentina]
sources: [CLAUDE.md]
updated: 2026-06-24
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

### 3.b Add-ons FIJOS (recurrentes) + downgrade guiado (Fase 3, 2026-07-02 · NO deployado)

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

> [!WARNING] **NO deployado / no e2e-testeable.** Requiere reconfigurar los planes base de MP a
> $60k/$100k + validar en **sandbox** el `PUT` de `transaction_amount` sobre un preapproval basado en
> plan (comportamiento real de MP a confirmar). El precio SIEMPRE sale del catálogo server-side (REGLA #0).

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

---

## Edge Functions

| Función | JWT | Propósito |
|---------|-----|-----------|
| `crear-suscripcion` | Sí | Deprecated (se usa init_point directo ahora) |
| `mp-webhook` | No | Eventos de pagos Y suscripciones (setea `plan_tier`; add-on temporal → `tenant_addons`) |
| `mp-ipn` | No | IPN alternativo para pagos de ventas |
| `mp-crear-link-pago` | Sí | Genera preference de pago por venta |
| `mp-addon` | Sí | Add-on TEMPORAL de movimientos (pago único, packs 1.000/5.000/20.000) |
| `mp-addon-fijo` | Sí | Add-on FIJO (alta/baja + `PUT transaction_amount` del preapproval) — **NO deployado** |
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
