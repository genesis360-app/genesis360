---
title: Integración TiendaNube
category: integrations
tags: [tiendanube, tn, oauth, stock-sync, webhook, integraciones]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-04-30
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
