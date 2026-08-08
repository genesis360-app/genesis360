---
title: Integración TiendaNube
category: integrations
tags: [tiendanube, tn, oauth, stock-sync, webhook, integraciones]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-08-08
---

# Integración TiendaNube

Primera integración de marketplaces en Genesis360. Orden: **TiendaNube → MercadoPago → MELI**.

---

## Registro de la app

- **TiendaNube Partners App ID:** `30376`
- **Redirect URI PROD:** `https://jjffnbrdjchquexdfgwq.supabase.co/functions/v1/tn-oauth-callback`
- **Permisos:** Edit Products + Edit Orders + View Customers
- **Secret:** `TN_CLIENT_SECRET` en Supabase EF secrets
- **Frontend env var:** `VITE_TN_APP_ID=30376` en Vercel (no secreto)

---

## Credenciales

**Tabla `tiendanube_credentials`** (migration 061):
```
tenant_id, sucursal_id, store_id BIGINT, store_name, store_url,
access_token, conectado, UNIQUE(tenant_id, sucursal_id)
```
Token **permanente** — TiendaNube no expira access tokens.

---

## OAuth flow

**EF `tn-oauth-callback`** (sin JWT):
1. Recibe `?code&state` del redirect de TN
2. Intercambia code por token: `user_id` (= store_id) viene en el **cuerpo** del token response, no en la URL
3. Obtiene store info (nombre, URL)
4. Upsert en `tiendanube_credentials`
5. **Registra automáticamente** webhooks `order/created` + `order/paid` en TN (ignora 422 si ya existen)
6. Redirige a `APP_URL/configuracion?tab=integraciones&tn=ok`

`state` = `btoa(tenantId:sucursalId)`

---

## Mapeo de productos

**Tabla `inventario_tn_map`** (migration 061):
- Mapeo producto Genesis360 ↔ variante TN (tn_product_id + tn_variant_id)
- Flags: `sync_stock`, `sync_precio`, `ultimo_sync_at`
- Auto-complete por SKU con **EF `tn-search-products`**: busca productos en TN API

---

## Webhooks de órdenes

**EF `tn-webhook`** (sin JWT):
- `order/created` → crea venta `pendiente`
- `order/paid` → si existe venta `pendiente` la actualiza a `reservada`; si no existe, la crea directamente como `reservada`
- **Idempotencia**: clave `{store_id}-{event}-{orderId}` en `ventas_externas_logs`
- Mapeo de producto: primero por `inventario_tn_map`, fallback por SKU ilike
- Crea cliente si no existe (por nombre del comprador)
- Venta con `origen='TiendaNube'`

**Race condition resuelta (v1.0.0):**
- `order/paid` + `order/created` pueden llegar simultáneos
- Si `order/created` llega después y ya existe venta, la saltea

> [!NOTE] **ISS-073 corregida en el wiki (2026-08-06)**: `project_pendientes.md` tenía una fila
> vieja diciendo que TN "hoy: solo rebaja stock" — eso era **falso desde hace tiempo**, este webhook
> ya crea venta + cliente + reserva de stock automáticamente (arriba). Marcada ✅ cerrada.

---

## 🆕 Envío automático al confirmar el pago (2026-08-06, ✅ PROD desde v1.159.0)

`tn-webhook` ahora crea automáticamente `cliente_domicilios` + `envios` con los datos reales del
comprador al confirmar el pago del pedido (`order/paid`) — antes había que armarlo a mano en
`EnviosPage`.

- Campos leídos de `order.shipping_address` (confirmados contra la doc oficial de TiendaNube y
  contra un payload real ya capturado en DEV): `address`, `number`, `floor`, `locality`, `city`,
  `province`, `zipcode`, `phone`.
- **Best-effort**: si falla la creación del envío, la venta se crea igual — nunca bloquea.
- Verificado end-to-end contra DEV con pedidos reales.
- Archivo: `supabase/functions/tn-webhook/index.ts`.
- **✅ Deployado a PROD el 2026-08-06** (PR #314, tag `v1.159.0`, EF `tn-webhook` v18→v19).

(Ver también [[wiki/integrations/mercado-libre]] → "Envío automático" para el equivalente MELI, que
necesita un fetch adicional a `GET /shipments/{id}` porque la orden no trae dirección.)

---

## 🆕 Fulfillment sync — aviso a TiendaNube al despachar/entregar (Fase C del roadmap, migración 338, ✅ PROD desde v1.159.0)

Cuando un envío de canal TiendaNube pasa a `despachado`/`entregado` en G360, ahora se le avisa a TN
vía su API real de **Fulfillment Orders**: `PATCH /orders/{id}/fulfillment-orders/{fulfillment_id}`
con `status` `DISPATCHED`/`DELIVERED`.

**Mecanismo server-side** (mismo patrón que `trg_tn_stock_sync`/`tn-stock-worker`, no depende de que
el usuario no cierre la pestaña):
1. Trigger **`trg_tn_fulfillment_sync`** (migración 338) — `AFTER UPDATE OF estado ON envios`, filtra
   canal `TiendaNube` + estado `despachado`/`entregado`.
2. Encola job `sync_fulfillment` en `integration_job_queue`.
3. Edge Function nueva **`tn-fulfillment-worker`** procesa el job y hace el PATCH real.

- **`ventas.tn_order_id BIGINT`** (migración 338, nueva) — el endpoint de fulfillment-orders necesita
  el **ID interno** de la orden en TN, distinto de `tracking_id`/el número visible al comerciante
  (`order.number`). `tn-webhook` lo guarda en cada venta nueva.
- **Cron cada 5 min** vía `pg_cron` (job `tn-fulfillment-sync`, mismo patrón que `meli-stock-sync`) +
  backup **`.github/workflows/tn-fulfillment-sync.yml`**.

> [!WARNING] **Este trabajo estuvo bloqueado y se desbloqueó recién en la sesión del 2026-08-06**: la
> app de TiendaNube Partners (App ID 30376) no tenía los scopes `read_fulfillment_orders`/
> `write_fulfillment_orders`. GO los agregó (categoría "Shipping" → "Edit/View Fulfillment orders" en
> el panel de permisos de la app) y reconectó la tienda Almacén Jorgito. Verificado con una llamada
> real: PATCH exitoso, confirmado con un GET posterior que el pedido real (orden TN 1955532685) quedó
> en estado `DISPATCHED`.

> [!NOTE] **MercadoLibre queda deliberadamente fuera de esta fase** — no se sabe si los tenants usan
> Mercado Envíos (ahí el vendedor NO controla el estado por API, lo hace la logística de MELI) o
> envío propio. Ver [[wiki/integrations/mercado-libre]] → "Sync de fulfillment — diferido".

Archivos: `supabase/migrations/338_tn_fulfillment_sync.sql`,
`supabase/functions/tn-fulfillment-worker/index.ts` (nueva), `supabase/functions/tn-webhook/index.ts`.

**✅ Deployado a PROD el 2026-08-06** (PR #314, tag `v1.159.0`): mig 338 aplicada en `jjffnbrdjchquexdfgwq`
(el `cron.schedule` se corrigió a mano a la URL de PROD, mismo criterio que `meli-stock-sync`), EF
`tn-fulfillment-worker` deployada (v1) y `tn-webhook` redeployada (v18→v19).

---

## 🟡 BOM automático para combos/kits (Fase D2 del roadmap) — relevamiento RESPONDIDO por Fede (2026-08-08), listo para diseñar/construir

Investigado el 2026-08-06: en TODA la app el único modelo de venta de kits es "armar primero
(`iniciar_armado_kit`/`confirmar_armado_kit`), vender después" — nunca existió desarme de kit en el
momento de la venta. Esas funciones SQL dependen de `auth.uid()` (usuario logueado), así que ni
siquiera se pueden invocar desde un webhook server-side tal como están hoy. El relevamiento de negocio
quedó **100% respondido por Fede** (`relevamiento-integraciones-ml-tn-reglas-negocio.html`, raíz del
repo) — detalle completo en `sources/raw/relevamiento_ml_tn_combos_repricing_respuestas.md`. En
síntesis:

- Armado **mixto**: cuando hay stock suficiente de los componentes en las ubicaciones habilitadas para
  ese canal, el sistema genera automáticamente la TAREA de armado — no arma en silencio sin que nadie
  se entere.
- Todo-o-nada si falta cualquier componente (mismo criterio que el armado manual hoy).
- **El kit pasa a ser su propio SKU**, con ubicación predefinida en su ficha (o sugerida
  automáticamente según volumen, editable a mano) — conecta con el cubicaje volumétrico ya
  parcialmente construido. Cada armado resta las unidades de los componentes y suma una unidad al SKU
  del kit.
- Nunca silencioso: tarea asignada (automática o preset del supervisor) + alerta a supervisor/dueño.
- Al resolverse con SKU propio, sirve para MELI y TiendaNube por igual, sin lógica separada por canal.
- **Idea nueva de Fede, fuera del relevamiento original**: ficha técnica de armado por kit (texto/
  imágenes/video), opcional, con un botón visible del lado de quien arma solo si existe una cargada
  para ESE kit.

**Nada de esto está construido todavía** — el relevamiento está cerrado, falta el diseño técnico +
implementación (ej. variante de `iniciar_armado_kit`/`confirmar_armado_kit` invocable server-side sin
`auth.uid()`, infraestructura de "tarea asignada + alerta"). Ver [[wiki/integrations/roadmap-apis]]
(1.2).

---

## Sync de stock hacia TiendaNube

**EF `tn-stock-worker`** (sin JWT):
- Procesa jobs `sync_stock` de `integration_job_queue`
- Calcula `SUM(cantidad - cantidad_reservada)` en `inventario_lineas`
- `PUT /v1/{store_id}/products/{tn_product_id}/variants/{tn_variant_id}` con `{ stock: N }`
- Solo productos en `inventario_tn_map` con `sync_stock=true`
- Filtra por `es_disponible_tn` en estados + `disponible_tn` en ubicaciones
- BATCH_SIZE=50 (mejorado a 200 en v1.4.0) · CONCURRENCY=20
- Backoff exponencial: 1/2/4/8/16 min, máx 5 reintentos

**Trigger `trg_tn_stock_sync`** (migration 062):
```sql
AFTER INSERT/UPDATE/DELETE ON inventario_lineas
→ fn_enqueue_tn_stock_sync() SECURITY DEFINER
→ INSERT en integration_job_queue (NOT EXISTS dedup)
```

**GitHub Actions** `.github/workflows/tn-stock-sync.yml`:
- Cron `*/5 * * * *`
- `pg_cron` también corre como mecanismo principal (más confiable)

**Throughput v1.4.0:** ~2.400 jobs/minuto (~15× vs v1.3.0)

---

## Reserva de stock al recibir orden

Al crear venta `Reservada` desde webhook TN:
1. Incrementa `cantidad_reservada` en `inventario_lineas` (FIFO)
2. El sync worker usa `cantidad - cantidad_reservada` → sin oversell
3. `order/cancelled` → libera `cantidad_reservada` y cancela venta

---

## UI en ConfigPage → Integraciones → TN

- Botón **"Conectar"** → OAuth redirect con `state`
- Badge "Conectada" + fecha (token no vence)
- Muestra `store_name` + `store_url` post-conexión
- Botón **"↑ Sync stock"** manual → encola jobs + llama worker inmediatamente
- **CRUD mapeo** por sucursal: producto Genesis360, TN Product ID, TN Variant ID, toggle `sync_stock`

---

## Permisos de estados y ubicaciones

- `estados_inventario.es_disponible_tn BOOLEAN DEFAULT TRUE` (migration 063)
- `ubicaciones.disponible_tn BOOLEAN DEFAULT TRUE` (migration 066)

Config UI en ConfigPage → Estados (sub-tab Permisos) y ConfigPage → Ubicaciones.

---

## Documentación de soporte

Existe guía para el equipo: `docs/soporte_tiendanube.html` — flujo completo, pasos de conexión, mapeo de productos, verificación, estados, troubleshooting y FAQ.

---

## Links relacionados

- [[wiki/integrations/mercado-libre]]
- [[wiki/integrations/mercado-pago]]
- [[wiki/architecture/edge-functions]]
- [[wiki/database/schema-overview]]
