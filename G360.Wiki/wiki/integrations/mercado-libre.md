---
title: Integración MercadoLibre (MELI)
category: integrations
tags: [mercadolibre, meli, oauth, stock-sync, webhook, integraciones]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-08-08
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
- **🟢 `sync_precio` ya no está "dormido" desde D3 (2026-08-08, mig 346)**: el trigger
  `trg_enqueue_sync_precio` (`AFTER UPDATE OF precio_venta, precio_ajuste_meli_pct,
  precio_ajuste_tn_pct ON productos`) encola el job **solo si el producto participa de D3**
  (`reajuste_margen_auto=true` o algún `precio_ajuste_*_pct` seteado) — para el resto de los
  productos mapeados con `inventario_meli_map.sync_precio=true` (default desde la mig 065) el push de
  precio sigue sin dispararse, a propósito (ver "Repricing automático por margen" arriba). El worker
  publica `precio_venta * (1 + precio_ajuste_meli_pct / 100)` si el producto tiene ese % cargado
  (mecanismo 2), o el precio base tal cual si no.
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

**🟢 ✅ EN PROD desde v1.161.0 (2026-08-08): armado automático de kits (D2).** Si tras el loop de
reserva FIFO anterior sigue faltando cantidad y el producto tiene `es_kit=true`, `meli-webhook` invoca
la RPC nueva `fn_iniciar_armado_kit_auto` (mig 345, `service_role`, sin `auth.uid()`) para reservar los
componentes en las ubicaciones habilitadas para MELI y crear una tarea `wms_tareas.tipo='armado'` —
best-effort, nunca bloquea la venta. El backend (RPC) ya estaba construido y verificado por SQL directo
contra DEV; `meli-webhook` fue deployado a DEV (v25) y PROD (v13) vía `deploy_edge_function`, sanity
check post-deploy OK (topic de test → 200 `{ok:true, skipped:...}` esperado, sin crashear). **Pendiente
real, no bloqueante:** el webhook en sí sigue sin probarse contra una orden real de MELI (requiere GO/
Fede generando una orden real en una tienda de test con un kit mapeado). Detalle completo (mismo
mecanismo, doc primaria): [[wiki/integrations/tienda-nube]] → "BOM automático para combos/kits".

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

## 🐛 Fix: `sucursal_id = NULL` en ventas MELI (2026-08-07 — ✅ EN PROD desde v1.160.0, PR #317 mergeado el 2026-08-08; ⚠ redeploy de la Edge Function `meli-webhook` a PROD NO confirmado en el cierre de esta sesión)

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
- **✅ Código en PROD desde v1.160.0** (PR #317 mergeado `181a6f52`, tag+release `v1.160.0`, 2026-08-08).
  **⚠ Dato NO confirmado en el cierre de esta sesión: si la Edge Function `meli-webhook` de PROD fue
  redeployada** con este fix (al cierre de la sesión anterior seguía en v11 sin el fix, DEV ya en v24)
  — pendiente de confirmar con GO. Ver `sources/raw/project_pendientes.md`, bloque "ARRANCÁ ACÁ" del
  2026-08-08.

Archivo: `supabase/functions/meli-webhook/index.ts`.

---

## 🟢 Repricing automático por margen (Fase D3 del roadmap) — backend CONSTRUIDO, VERIFICADO y con la infraestructura YA EN PROD (migración 346, 2026-08-08) — falta cerrar el release de código + probar el mecanismo 2 con un canal real

`productos.margen_objetivo` **ya existe** (migración 015) y ahora sí se conectó a una acción de
código real — antes era solo un insight pasivo en Métricas. El relevamiento de negocio quedó **100%
respondido por Fede** (`relevamiento-integraciones-ml-tn-reglas-negocio.html`, raíz del repo) —
detalle completo en `sources/raw/relevamiento_ml_tn_combos_repricing_respuestas.md`. El mismo día
(2026-08-08) se construyó y verificó el backend real:

- **Mecanismo 1 — ajuste automático por margen objetivo, opt-in por producto**
  (`productos.reajuste_margen_auto`): si se activa, ajusta `precio_venta` (el precio BASE, ÚNICO —
  igual en Genesis360 y en TODOS los marketplaces conectados, nunca un precio distinto por canal)
  cuando se desvía del `margen_objetivo` ya cargado en la ficha.
- **RPC `fn_precio_para_margen(costo, margen_objetivo, alicuota_iva)`** — extrae a SQL puro
  (`IMMUTABLE`) la fórmula que vivía duplicada en JSX (`ProductoFormPage.tsx`/`MetricasPage.tsx`).
- **RPC `fn_evaluar_repricing_margen(p_tenant_id)`** — el sweep, sin `auth.uid()` (mismo patrón que
  `fn_iniciar_armado_kit_auto` de D2/mig 345), `GRANT` solo `service_role`. Según
  `tenants.repricing_modo` (configurable en Config → Integraciones → card "Repricing automático por
  margen": automático siempre / alerta para aprobar / automático desde un monto en $, con
  `repricing_tope_pct` y `repricing_umbral_aviso_monto` opcionales): aplica el precio directo
  (notificando a DUEÑO/SUPERVISOR/SUPER_USUARIO) o genera una fila en `autorizaciones_inventario`
  (nuevo tipo `'repricing_margen'` — **reusa la pantalla de Autorizaciones YA EXISTENTE**, mismo
  patrón que `'kit_precio'` de la mig 343) sin duplicar sugerencias pendientes entre corridas.
  Disparado por **Edge Function `repricing-sweep`** + GitHub Action `repricing-sweep.yml` cada 6
  horas (no hay pg_cron habilitado).
- **RPC `fn_ultima_comision_meli(producto_id)`** — de solo lectura, comisión + precio de la venta MELI
  más reciente de ese SKU, informativa en la ficha del producto — **nunca se usa como dato certero
  para fijar un precio** (B4 del relevamiento).
- **Mecanismo 2 — ajuste por diferencial de % por canal, independiente del mecanismo 1**
  (`productos.precio_ajuste_meli_pct`/`precio_ajuste_tn_pct`): el precio PUBLICADO en cada canal se
  deriva del precio base + ese %, sin tocar `precio_venta` — amortigua la comisión de cada canal por
  separado. Ver más abajo "Sync de stock hacia MELI" y [[wiki/integrations/tienda-nube]].
- **El precio base (`precio_venta`) SIEMPRE manda** — un cambio en el marketplace nunca lo modifica.
- Interruptor del mecanismo 1 por producto ("Reajuste automático por margen", deshabilitado sin
  `margen_objetivo` cargado) + los 2 % del mecanismo 2, todo en la ficha del producto
  (`ProductoFormPage.tsx`).

> [!WARNING] **🔴 Hallazgo real del `migration-reviewer` antes de aplicar, corregido.** El trigger que
> dispara el push de precio a MELI/TN (`fn_enqueue_sync_precio`) originalmente reaccionaba a
> CUALQUIER cambio de `precio_venta`, sin gate. Como `inventario_meli_map.sync_precio` viene
> `DEFAULT true` desde la mig 065 (un checkbox de Config "dormido" hace tiempo, sin nada que lo
> disparara), esto habría despertado el push automático de precio para CUALQUIER producto ya mapeado,
> sin que nadie haya pedido participar de D3 — verificado con datos reales que afectaría 2 ítems de
> una cuenta de MercadoLibre REAL conectada en el tenant de test de DEV. **Corregido**: el trigger
> ahora solo dispara para productos que tienen algo de D3 configurado (`reajuste_margen_auto=true` o
> alguno de los 2 % de ajuste seteado) — el checkbox viejo sigue "dormido" para el resto, a propósito.

**Verificado con datos reales en DEV**, tenant SIN conexión real a MELI/TN ("Familia Otranto De
Porto"): fórmula (`costo $100, margen 50%, IVA 21%` → `$181,50`); modo alerta genera autorización +
notificación, segunda corrida del sweep NO duplica; aprobación simulada aplica el precio; modo
automático con tope 10% clampea `$181,50` a `$110`; fix del trigger — producto opt-in + mapeo MELI
(falso) SÍ encola `sync_precio`, producto SIN opt-in con el mismo mapeo NO encola nada;
`repricing-sweep` probado en vivo por curl contra DEV (10 tenants, 0 cambios — correcto, ningún
producto real tiene el opt-in todavía). Datos de prueba limpiados.

**Migración `346_repricing_margen_meli_d3.sql` aplicada en DEV (`gcmhzdedrkmmzfzfveig`) y PROD
(`jjffnbrdjchquexdfgwq`).** Edge Functions `meli-stock-worker`/`tn-stock-worker`/`repricing-sweep`
deployadas en DEV y PROD. **`APP_VERSION` bumpeada a `v1.162.0`, commit `792bda42` en la rama LOCAL
`dev` — falta push a `origin/dev` + PR `dev→main` + merge + tag/release para cerrar el pipeline de
release del código** (la migración y las Edge Functions ya están aplicadas/deployadas en los
proyectos Supabase de DEV y PROD, mismo criterio que el DDL aditivo de las migs 339-343).

**Pendiente real**: el mecanismo 2 (push real de precio a un canal) sigue sin probarse contra una
cuenta MELI/TN real conectada — mismo motivo que D2 (armado automático de kits): requiere acceso a
una tienda de test real que Claude Code no tiene. La lógica (RPC + workers) está 100% verificada.

Ver [[wiki/integrations/roadmap-apis]] (1.5), [[wiki/integrations/tienda-nube]] → "Repricing
automático por margen", `wiki/database/migraciones.md` (mig 346),
`sources/raw/relevamiento_ml_tn_combos_repricing_respuestas.md`,
`sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ").

---

## 🔴 Sync de fulfillment (aviso de despacho/entrega) — diferido, NO implementado para MELI

A diferencia de TiendaNube (ver [[wiki/integrations/tienda-nube]] → "Fulfillment sync"), MELI **NO**
recibe ningún aviso automático de G360 cuando un envío pasa a despachado/entregado. Se evaluó junto
con la Fase C del roadmap (2026-08-06) y se descartó a propósito por ahora: no se sabe si los tenants
usan **Mercado Envíos** (ahí el vendedor NO controla el estado por API, lo controla la logística de
MELI) o envío propio — la respuesta cambia por completo si esta fase es viable.

**Nota operativa C1 del relevamiento (2026-08-08): sigue SIN el dato.** Fede no opera un negocio real
en Genesis360 hoy, así que no tiene el dato real de qué tipo de envío predomina — va a variar cliente a
cliente entre los futuros clientes de Genesis360. Queda como dato a relevar con **clientes reales**
antes de decidir si esta fase es viable. Lo que SÍ quedó definido (independiente del dato) es el
**diseño de la pantalla**: pestaña nueva dentro de Envíos, con sub-pestañas por canal (MELI, TN, etc.),
tipo de envío por defecto por producto y por canal, y override a nivel de venta individual (mientras no
se haya despachado). Detalle completo: `sources/raw/relevamiento_ml_tn_combos_repricing_respuestas.md`.

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
