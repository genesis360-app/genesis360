---
title: Integración MercadoLibre (MELI)
category: integrations
tags: [mercadolibre, meli, oauth, stock-sync, webhook, integraciones]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-05-06
---

# Integración MercadoLibre (MELI)

Integración completa con el marketplace más grande de Argentina. Implementada en v0.91.0–v0.99.0 PROD ✅.

---

## Registro de la app

- **App ID:** `2358829201151305`
- **Secrets:** `MELI_CLIENT_ID` + `MELI_CLIENT_SECRET` en Supabase EF secrets
- **Redirect URIs DEV + PROD:** configuradas en MELI Developers
- **Permisos:** read + offline_access + write

---

## Credenciales

**Tabla `meli_credentials`** (migration 065):
```
tenant_id, sucursal_id, meli_user_id BIGINT, seller_email,
access_token, refresh_token, public_key, expires_at, conectado
UNIQUE(tenant_id, sucursal_id)
```
Token expira periódicamente. El worker hace refresh automático.

---

## OAuth flow

**EF `meli-oauth-callback`** (sin JWT):
1. Recibe `?code&state` del redirect de MELI
2. Intercambia code por token en MELI API
3. Obtiene `seller_email` + `meli_user_id`
4. Upsert en `meli_credentials`
5. **Registra webhook automáticamente** para evento `orders_v2`
6. Redirige a `APP_URL/configuracion?tab=integraciones&ml=ok`

`state` = `btoa(tenantId:sucursalId)`

> [!NOTE] La EF usa `SUPABASE_URL` env para construir el redirect URI, no `req.url`. Esto es crítico para que el OAuth funcione en PROD.

---

## Mapeo de productos

**Tabla `inventario_meli_map`** (migration 065):
```sql
tenant_id, sucursal_id, producto_id FK productos,
meli_item_id TEXT, tipo_publicacion TEXT,
sync_activa BOOLEAN DEFAULT TRUE,
ultimo_sync_at TIMESTAMPTZ
```

Auto-complete por SKU/nombre con **EF `meli-search-items`**: busca items en MELI API.

> [!WARNING] **Items OMNI**: para publicaciones sincronizadas con MELI Fulfillment, usar endpoint `PUT /items/{id}/variations/{var_id}` — `available_quantity` a nivel item **no es modificable**.

---

## Webhooks de órdenes

**EF `meli-webhook`** (sin JWT):
- Evento `orders_v2` → crea venta `reservada` o `pendiente`
- **Idempotencia**: clave `meli-order-{id}` en `ventas_externas_logs`
- Mapeo de producto: por `inventario_meli_map`, fallback por título ML en `notas`
- Crea cliente por nickname si no existe
- Venta con `origen='MELI'`, `tenant_id` en `venta_items`

---

## Sync de stock hacia MELI

**EF `meli-stock-worker`** (sin JWT):
- Procesa jobs `sync_stock` y `sync_precio` de `integration_job_queue`
- Calcula stock disponible: `SUM(cantidad - cantidad_reservada)` en `inventario_lineas`
- Filtra por:
  - `es_disponible_meli = true` en estados de inventario (migration 066)
  - `disponible_meli = true` en ubicaciones (migration 066)
- Refresh token automático cuando `expires_at` está próximo
- Backoff exponencial en fallos

**Trigger `trg_meli_stock_sync`** (migration 065):
```sql
AFTER INSERT/UPDATE/DELETE ON inventario_lineas
→ fn_enqueue_meli_stock_sync() SECURITY DEFINER
→ INSERT en integration_job_queue (NOT EXISTS dedup)
```

**pg_cron** (mecanismo principal, más confiable que Actions):
- Job `meli-stock-sync` corriendo cada 5 min desde la DB en DEV + PROD ✅

**GitHub Actions** `.github/workflows/meli-stock-sync.yml`:
- Cron `*/5 * * * *` — backup del pg_cron

---

## Reserva de stock al recibir orden

Al crear venta `Reservada` desde webhook MELI:
1. Incrementa `cantidad_reservada` en `inventario_lineas` (FIFO)
2. El sync worker usa `cantidad - cantidad_reservada` → sin oversell
3. `order/cancelled` → libera `cantidad_reservada` y cancela venta en G360

---

## Permisos de estados y ubicaciones

- `estados_inventario.es_disponible_meli BOOLEAN DEFAULT TRUE` (migration 066)
- `ubicaciones.disponible_meli BOOLEAN DEFAULT TRUE` (migration 066)

Config UI:
- ConfigPage → Estados → sub-tab "Permisos por estado" — columna ML
- ConfigPage → Ubicaciones — botón ML (amarillo) por ubicación

---

## UI en ConfigPage → Integraciones → ML

- Botón **"Conectar"** → OAuth redirect con `state`
- Badge estado: "Conectada" (verde) o "Vencido" si `expires_at < now()`
- Muestra `seller_email` + fecha vencimiento token
- Botón **"↑ Sync stock"** manual → encola jobs + llama worker inmediatamente
- **CRUD mapeo** por sucursal: producto Genesis360, MELI Item ID, toggle `sync_activa`
- Auto-complete SKU via EF `meli-search-items`

---

## MercadoPago QR integrado en MELI

El módulo de cobros de MP es independiente de la integración MELI. Ver [[wiki/integrations/mercado-pago]].

---

## Tab Canales en VentasPage

KPIs por canal incluyendo MELI + listado filtrable por estado y fechas. Ver [[wiki/features/ventas-pos]].

---

## Links relacionados

- [[wiki/integrations/tienda-nube]]
- [[wiki/integrations/mercado-pago]]
- [[wiki/architecture/edge-functions]]
- [[wiki/database/schema-overview]]
