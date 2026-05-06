---
title: Integración Mercado Pago
category: integrations
tags: [mercado-pago, pagos, suscripciones, webhook, qr, addon, argentina]
sources: [CLAUDE.md]
updated: 2026-04-30
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

Cada 30s, si llega un pago MP, muestra un toast: `💳 monto · fecha · hora`.

---

## 3. Add-on de movimientos (v0.40.0)

```
Usuario quiere +500 movimientos
  → EF mp-addon crea preference de pago único
  → mp-webhook detecta |addon_movimientos| en external_reference
  → INCREMENT tenants.addon_movimientos += 500
```

`tenants.addon_movimientos INT DEFAULT 0` — se acumula.

---

## Edge Functions

| Función | JWT | Propósito |
|---------|-----|-----------|
| `crear-suscripcion` | Sí | Deprecated (se usa init_point directo ahora) |
| `mp-webhook` | No | Eventos de pagos Y suscripciones |
| `mp-ipn` | No | IPN alternativo para pagos de ventas |
| `mp-crear-link-pago` | Sí | Genera preference de pago por venta |
| `mp-addon` | Sí | Genera preference de add-on |
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

Validación HMAC con `MP_WEBHOOK_SECRET`. La EF rechaza payloads sin firma correcta.

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
