---
title: Integración MercadoLibre (MELI)
category: integrations
tags: [mercadolibre, meli, oauth, stock-sync, webhook, integraciones]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-08-07
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

## 🆕 Envío automático al confirmar el pago (2026-08-06, ✅ PROD desde v1.159.0)

> [!NOTE] Corrige un dato viejo del wiki: la fila ISS-073 de `project_pendientes.md` decía que
> TiendaNube/MELI "solo rebajan stock" — eso ya era falso desde hace tiempo (ambos webhooks crean
> venta + cliente + reserva de stock). Ver [[wiki/integrations/tienda-nube]].

`meli-webhook` ahora crea automáticamente `cliente_domicilios` + `envios` con los datos reales del
comprador al confirmar el pago del pedido — antes había que armarlo a mano en `EnviosPage`.

- **MELI no incluye la dirección en la orden** (a diferencia de TN) — se agregó un fetch adicional a
  `GET /shipments/{id}` para resolverla.
- Campos leídos (confirmados contra un pedido de test real de la cuenta conectada en DEV):
  `receiver_address.street_name`, `.street_number`, `.zip_code`, `.city.name`, `.state.name`,
  `receiver_name`.
- **Best-effort**: si falla la creación del envío, la venta se crea igual — nunca bloquea.
- **🐛 Bug real corregido de paso**: la rama de "pago tardío" (`order/paid` llega después de una
  notificación ya procesada) seleccionaba la columna `payload` de `ventas_externas_logs` — no existe,
  la columna real es `payload_raw` — así que la transición pendiente→reservada por ese camino nunca
  corría. Corregido.
- Verificado end-to-end contra DEV con pedidos reales (venta pendiente→reservada + envío + domicilio
  creados).
- Archivo: `supabase/functions/meli-webhook/index.ts`.
- **✅ Deployado a PROD el 2026-08-06** (PR #314, tag `v1.159.0`, EF `meli-webhook` v10→v11).

---

## 🆕 Rentabilidad neta real por venta (Fase D1 del roadmap, migración 337, ✅ hecho — ✅ PROD desde v1.159.0)

> Cierra la Fase 1.1 ⭐ del roadmap de integraciones. Ver [[wiki/integrations/roadmap-apis]].

`meli-webhook` lee y guarda, por cada orden:
- **`sale_fee`** (comisión de MercadoLibre) — viene en `order_items[]` → `venta_items.comision_marketplace numeric(12,2)`.
- **`shipping_cost`** y **`taxes_amount`** — **viven en `order.payments[]`, NO en la orden ni en
  `order_items`** (corrige lo que decía el roadmap original) → `ventas.impuestos_marketplace numeric(12,2)`.

> [!WARNING] `impuestos_marketplace` es la **retención del marketplace** sobre el pago (comisión +
> impuestos que retiene MELI), **NO** el IVA fiscal de la factura (columna `ventas.iva_monto`, usada
> para AFIP/CAE) — son conceptos separados a propósito, para no mezclar lo comercial con lo fiscal.

**Bug real corregido de paso**: `precio_costo_historico` quedaba siempre NULL en `venta_items` de
ventas MELI (nunca se leía `productos.precio_costo`) — sin esto la ganancia no se podía calcular ni
a mano.

**UI** — tab Canales de `VentasPage.tsx`: badge **"Neto $X"** (rojo si da negativo) con
`ganancia_neta = total − costo − comisión − envío − impuestos`, visible solo en ventas MELI que
tengan datos de comisión cargados (pedidos procesados desde que existe esta fase — las ventas
históricas no lo muestran).

Verificado end-to-end en DEV con un pedido real de Almacén Jorgito (comisión $1793, envío $8720,
costo $600 → neto **-$7751**), incluida la renderización real en el navegador.

> [!WARNING] **Deuda técnica anotada el 2026-08-06 — ✅ corregida el 2026-08-07**, ver sección de abajo
> ("Fix: `sucursal_id` NULL en ventas MELI").

Archivos: `supabase/functions/meli-webhook/index.ts`, `src/pages/VentasPage.tsx`,
`supabase/migrations/337_meli_rentabilidad_neta.sql`.

**✅ Deployado a PROD el 2026-08-06** (PR #314, tag `v1.159.0`, mig 337 aplicada en `jjffnbrdjchquexdfgwq`).

---

## 🐛 Fix: `sucursal_id = NULL` en ventas MELI (2026-08-07 — corregido en el working tree local, deployado a la Edge Function en DEV, NO commiteado)

> [!WARNING] Bug real (Regla de Oro #0, no solo deuda técnica): `meli-webhook` nunca leía ni
> propagaba `meli_credentials.sucursal_id` al crear la venta ni el envío — a diferencia de
> `tn-webhook`, que sí lo hacía desde siempre. El tenant piloto conectado en PROD (Almacén Jorgito) es
> multi-sucursal y multi-emisor, así que las ventas MELI podían perder visibilidad en vistas filtradas
> por sucursal y, en un tenant multi-CUIT, facturarse potencialmente con el emisor equivocado.

**Fix:** se agregó `sucursal_id` al `SELECT` de `meli_credentials` y se propagó tanto al `INSERT` de
`ventas` como al de `envios` (dentro de `crearEnvioAutomaticoMELI`) — mismo patrón que `tn-webhook`.
Cierra la nota de "deuda técnica anotada" que quedaba en la sección de arriba (Fase D1, 2026-08-06).

- **Deployado a la Edge Function `meli-webhook` en DEV** (v24, `verify_jwt: false` preservado).
- **⚠ No probado de punta a punta contra un pedido real de MercadoLibre** — requeriría un pedido
  nuevo real en la cuenta de test conectada; la limitación ya existía desde que se construyó la Fase B
  original.
- **No commiteado** — vive en el working tree de `dev` junto con el resto de los cambios de la
  sesión (ver `sources/raw/project_pendientes.md`, bloque "ARRANCÁ ACÁ" del 2026-08-07).

Archivo: `supabase/functions/meli-webhook/index.ts`.

---

## 🟡 Repricing automático por margen (Fase D3 del roadmap) — bloqueado, relevamiento armado

`productos.margen_objetivo` **ya existe** (migración 015) pero nunca se conectó a ninguna acción —
hoy es solo un insight pasivo en Métricas. Falta decidir con GO/Fede: si el umbral es global o por
producto, si el ajuste de precio en MELI es automático o requiere aprobación, si actualiza también el
precio en G360, y cómo estimar la comisión de MELI antes de vender (hoy no se conoce hasta después de
la venta). Preguntas armadas en `relevamiento-integraciones-ml-tn-reglas-negocio.html` (raíz del
repo, 2026-08-06) — pendiente de que GO lo responda offline con Fede. Ver
[[wiki/integrations/roadmap-apis]] (1.5).

---

## 🔴 Sync de fulfillment (aviso de despacho/entrega) — diferido, NO implementado para MELI

A diferencia de TiendaNube (ver [[wiki/integrations/tienda-nube]] → "Fulfillment sync"), MELI **NO**
recibe ningún aviso automático de G360 cuando un envío pasa a despachado/entregado. Se evaluó junto
con la Fase C del roadmap (2026-08-06) y se descartó a propósito por ahora: no se sabe si los tenants
usan **Mercado Envíos** (ahí el vendedor NO controla el estado por API, lo controla la logística de
MELI) o envío propio — la respuesta cambia por completo el diseño. Pregunta abierta en el mismo
relevamiento de arriba.

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
