---
name: project_api_integrations
description: Roadmap de integraciones API para Genesis360 — análisis de alcance, impactos, riesgos y plan de implementación por fases
type: project
originSessionId: 7ac12f69-1217-41e2-b6e5-3547bd561e43
---
## Visión General

El documento define Genesis360 como "Maestro de Inventario" + cerebro financiero. Todas las APIs externas se subordinan a la verdad de la DB. El patrón arquitectónico es:
- **Edge Functions (Deno)**: webhook receivers + API callers
- **Job Queues en Supabase**: todo async, nunca bloquear el POS
- **pgcrypto / Supabase Vault**: todos los tokens/secrets encriptados en DB
- **Idempotencia**: clave en todos los webhooks (X-WC-Webhook-ID, order_id como UNIQUE)
- **Retry con Backoff Exponencial**: 1m → 5m → 15m, máx 5 intentos antes de `failed`
- **POS = Prioridad Absoluta**: race condition siempre resuelve a favor del local físico

**Why:** Este documento define el roadmap de expansión de Genesis360 de ERP puro a plataforma omnicanal completa.
**How to apply:** Usar como guía de arquitectura al planificar cualquier integración. Priorizar por ROI y dependencias.

---

## Estado Actual vs. Lo Requerido

### Lo que YA TENEMOS que se mapea al documento

| Área | Estado actual | Doc requiere |
|---|---|---|
| Open Food Facts | scan-product EF usa OPF | Parte del fallback cascade en GS1 (Intento 2) ✓ |
| MP subscriptions | preapproval para billing | Doc quiere MP for Marketplaces OAuth (distinto) |
| marketplace-api EF | catálogo público simple | Doc: sincronización bidireccional completa |
| ventas + caja_movimientos | tablas existentes | Necesitan columnas adicionales |
| inventario_lineas | tiene alto/ancho/largo/peso | Datos volumétricos para logística ✓ |
| tenant_certificates | tabla AFIP certs | Prerequisito para Facturante ✓ |
| producto_estructuras | unidades_por_caja, peso | Input para cotización volumétrica ✓ |
| RLS multi-tenant | patrón establecido | Requiere mismo patrón en tablas nuevas ✓ |
| GitHub Actions | crons existentes | Usar para token refresh MELI, Ad Spend sync ✓ |
| alicuota_iva por producto | migrations 042+ | Dato crítico para Facturante ✓ |

### Lo que FALTA (gaps críticos)

**Schema ventas — columnas nuevas necesarias:**
- `tracking_id TEXT` — número de envío (Andreani, MELI Envíos, etc.)
- `tracking_url TEXT` — link de seguimiento en vivo
- `costo_envio_logistica DECIMAL` — costo real de envío para POAS
- `origen TEXT` — 'MELI' / 'TiendaNube' / 'Shopify' / 'WooCommerce' / 'POS'
- `marketing_metadata JSONB` — UTMs (utm_source, utm_campaign, etc.)
- `cae VARCHAR`, `vencimiento_cae DATE`, `tipo_comprobante TEXT`, `numero_comprobante TEXT`, `link_factura_pdf TEXT` — para Facturante
- `id_pago_externo TEXT` — payment ID de MP/MODO
- `money_release_date DATE` — fecha real de acreditación MP

**Tablas nuevas de credenciales (1 por integración, con RLS + pgcrypto):**
- `meli_credentials` (tenant_id, sucursal_id UNIQUE, meli_user_id, access_token, refresh_token, expires_at)
- `tiendanube_credentials` (tenant_id, sucursal_id UNIQUE, store_id BIGINT, access_token)
- `shopify_credentials` (tenant_id, sucursal_id UNIQUE, shop_url, access_token)
- `woocommerce_credentials` (tenant_id, sucursal_id UNIQUE, store_url, consumer_key, consumer_secret)
- `mercadopago_credentials` (tenant_id, sucursal_id UNIQUE, seller_id, access_token, public_key, refresh_token, expires_at)
- `modo_credentials` (tenant_id, sucursal_id UNIQUE, store_id, client_id, client_secret)
- `andreani_credentials` (tenant_id, sucursal_id UNIQUE, username, password, cliente_id, contrato, token_jwt, expires_at)
- `correo_argentino_credentials` (similar)
- `moova_credentials`, `treggo_credentials`, `pedidosya_credentials`
- `facturante_credentials` (tenant_id, sucursal_id, punto_venta INT, bot_token)
- `meta_ads_credentials`, `google_ads_credentials`, `klaviyo_credentials`, `gs1_credentials`

**Tablas de mapeo externo:**
- `inventario_meli_map` (tenant_id, sucursal_id, producto_id, meli_item_id, tipo_publicacion, sync_activa)
- `inventario_tn_map` (tenant_id, producto_id, lpn, tn_product_id, tn_variant_id)
- `inventario_shopify_map` (tenant_id, sucursal_id, linea_id, shopify_variant_id, inventory_item_id)

**Tablas de Job Queues (patrón genérico):**
- `meli_job_queue`, `tn_job_queue`, `andreani_job_queue`, `facturacion_job_queue`, etc.
- Campos estándar: id, tenant_id, payload JSONB, endpoint TEXT, status ('pending'/'failed'), retries INT, next_attempt_at TIMESTAMPTZ

**Tablas analíticas (POAS):**
- `marketing_ad_spend` (tenant_id, sucursal_id, fecha DATE, campaign_id, campaign_name, adset_name, ad_name, spend DECIMAL, fuente 'meta'/'google')

**Otros:**
- `geo_cache` para Google Maps (30 días TTL)
- `ventas_externas_logs` para idempotencia (webhook_external_id como UNIQUE)
- Columna `clientes.ubicacion GEOGRAPHY(Point,4326)` — PostGIS
- `clientes.marketing_optin BOOLEAN` — para Klaviyo unsubscribes

**ConfigPage nueva tab "Integraciones":** UI para vincular cuentas externas por sucursal

---

## Complejidad y Riesgos

### Nivel de Complejidad: MUY ALTO
- 17+ APIs diferentes, cada una es un sprint de 2-4 semanas
- Estimación total: 12-18 meses de desarrollo full-time para implementación completa
- Requiere registros como Partner en plataformas externas antes de poder desarrollar

### Riesgos Críticos

1. **Google Ads Standard Token** — requiere aprobación manual de Google (semanas/meses). Bloquea todo el POAS de Google. Iniciar trámite cuanto antes.

2. **MP for Marketplaces** — el flujo OAuth que el documento requiere es distinto al modelo preapproval actual. Requiere registro como "Marketplace" en MP (no solo vendedor). Puede requerir acuerdo comercial.

3. **MELI token refresh (6h)** — si el cron falla, toda la integración se rompe. El cron debe ser altamente confiable con alertas de fallo.

4. **Race conditions POS vs. e-commerce** — requiere locking a nivel de base de datos, no solo aplicación. Los triggers en Supabase deben ser atómicos.

5. **Retrocompatibilidad ventas** — agregar columnas a la tabla `ventas` (que ya tiene miles de registros) debe hacerse con `DEFAULT NULL` para no romper nada.

6. **Facturante / AFIP** — los servidores de AFIP caen frecuentemente. Toda la facturación debe ser async con retry queues. Bloqueo legal: sin CAE, la venta no es válida fiscalmente.

7. **Seguridad credenciales** — `pgcrypto` (extensión PostgreSQL) debe estar habilitada en Supabase antes de implementar cualquier integración. Verificar disponibilidad.

8. **PedidosYa — multas Wait Time** — el botón "Paquete Listo" NUNCA debe auto-dispararse post-pago. Riesgo financiero real para el comercio.

9. **Tienda Nube Partner registration** — necesita cuenta en Portal de Partners de TN para obtener client_id/secret. Proceso manual.

10. **Shopify — scope read_all_orders** — requiere solicitud formal al Partner Dashboard. Sin esto, solo se leen órdenes de los últimos 60 días.

---

## Plan de Implementación por Fases

### Fase 0 — Fundamentos (prerequisito de todo) — ~2 semanas
**Sin esto, nada de lo siguiente funciona.**
- Migration: `ventas` + nuevas columnas (tracking_id, origen, marketing_metadata, cae, etc.)
- Habilitar extensión `pgcrypto` en Supabase DEV y PROD
- Migration: tabla genérica `integration_job_queue` + `ventas_externas_logs`
- Función helper `sanitizePhone(tel TEXT)` en PostgreSQL (Argentina: 54 + 9 + área + número)
- ConfigPage: nueva tab "Integraciones" con skeleton (estructura vacía lista para llenar)

### Fase 1 — Mercado Pago Deep + Facturante — ~6 semanas
**Alto impacto, base para todo lo demás.**
- **MP for Marketplaces OAuth**: EF `mp-oauth-callback`, tabla `mercadopago_credentials` + cron refresh semanas
- **MP IPN Webhooks**: EF `mp-ipn` → procesar `fee_details` → asientos atómicos en `caja_movimientos` (Ingreso Bruto + Egreso Comisión + Egreso Retenciones)
- **MP Point Smart + QR In-Store**: botón en VentasPage → EF → hardware
- **Facturante**: tabla `facturante_credentials`, EF `emitir-factura`, mapeo Factura A/B/C según condición IVA, retry queue, campos CAE en `ventas`
- **Bloqueo crítico**: iniciar registro como Marketplace en MP

### Fase 2 — Mercado Libre (MELI) — ~6 semanas
**Mayor marketplace argentino.**
- Tabla `meli_credentials` + tabla `inventario_meli_map`
- EF OAuth flow + cron refresh (cada 30 min, busca tokens a <45min de vencer)
- EF `webhooks/meli` → procesar orders_v2 → crear venta + asientos financieros
- Triggers PostgreSQL → `meli_job_queue` → worker EF actualiza stock
- Auto-pausado publicaciones cuando stock=0
- Race condition handler: cancelar orden MELI si POS vendió primero
- Etiquetas Mercado Envíos (PDF/ZPL individual + bulk ZIP)

### Fase 3 — GS1 + scan-product upgrade — ~2 semanas
**Mejora scan existente, alto valor UX.**
- Extender EF `scan-product` con:
  1. Validación matemática dígito verificador GTIN
  2. Consulta GS1 Argentina API (si hay credenciales)
  3. Fallback Open Food Facts (ya existe) ✓
  4. Fallback UPCitemdb
- Tabla `gs1_credentials` (opcional para clientes que tienen membresía)
- SSCC: reconocer códigos de 18 dígitos en módulo Recepciones

### Fase 4 — Logística: Andreani + Correo Argentino — ~5 semanas
**Prerequisito para cerrar el ciclo de ventas online.**
- Tablas `andreani_credentials`, `correo_argentino_credentials`
- Sección "Envíos" en VentasPage: selector de courier + cotización volumétrica
- EF `andreani-dispatch`: crear envío → guardar tracking_id → guardar etiqueta
- EF `webhooks/andreani` → mapear estados → actualizar ventas
- Idem Correo Argentino (con polling como fallback si no hay webhooks)
- Integración con Klaviyo `Fulfilled Order` cuando se despacha (Fase 7)

### Fase 5 — Tienda Nube — ~4 semanas
**Marketplace más popular para pymes argentinas.**
- Registro Portal Partners TN → obtener client_id/secret
- Tabla `tiendanube_credentials` + `inventario_tn_map` + `tn_job_queue`
- EF OAuth callback
- EF `webhooks/tiendanube/order-created` + `/order-paid`
- Extracción UTMs → `ventas.marketing_metadata`
- Fulfillment callback (cuando se despacha en G360 → cerrar ciclo en TN)
- Rate limit: monitorear `X-Rate-Limit-Remaining` < 5 → await delay

### Fase 6 — Meta Ads + CAPI — ~4 semanas
**Alto valor POAS + retroalimentación algoritmo.**
- Tabla `meta_ads_credentials` + `marketing_ad_spend`
- EF `sync-meta-ads`: Cron diario 03:00 → Meta Insights API → guardar spend por campaña
- EF `capi-events`: al finalizar venta → POST /pixel_id/events con SHA-256 hashing (email+phone)
- `action_source: "physical_store"` para ventas POS
- Dashboard: columna `marketing_metadata` en análisis de ventas

### Fase 7 — Shopify — ~5 semanas
**Solo si hay clientes Shopify activos.**
- Registro Partner Dashboard Shopify + solicitar `read_all_orders`
- GraphQL-first: `inventorySetOnHandQuantities`, `fulfillmentCreateV2`
- `customerJourneySummary` → UTMs
- Mapeo `sucursales ↔ Shopify Locations`

### Fase 8 — MODO + Google Ads + Klaviyo — ~8 semanas
**Completar ecosistema financiero y marketing.**
- MODO: Payment Intents → QR EMVCo → webhook con validación firma criptográfica
- Google Ads: iniciar trámite Standard Token INMEDIATAMENTE (puede tardar meses)
- Klaviyo: eventos transaccionales + catalog feed endpoint + unsubscribe webhook + POAS formula

### Fase 9 — Últimas Miles + Google Maps — ~8 semanas
**Moova, Treggo, PedidosYa, Google Maps + PostGIS**
- PostGIS: `CREATE EXTENSION postgis`, columna `clientes.ubicacion GEOGRAPHY`
- Google Maps: Places Autocomplete en ClientesPage, Geocoding API
- Moova/Treggo: B2B auth, time windows, fleet selection
- PedidosYa: botón manual "Paquete Listo" (NUNCA auto)

### Fase 10 — WooCommerce — ~3 semanas
**Para clientes con WordPress.**
- Consumer Key/Secret, metadatos fiscales configurables por tenant
- Idempotencia con `X-WC-Webhook-ID`

---

## Tablas de Base de Datos Necesarias (resumen)

### Schema ventas (ALTER TABLE, columnas NULL):
```sql
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS tracking_id TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS costo_envio_logistica DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS origen TEXT DEFAULT 'POS',  -- 'MELI','TiendaNube','Shopify','WooCommerce','POS'
  ADD COLUMN IF NOT EXISTS marketing_metadata JSONB,
  ADD COLUMN IF NOT EXISTS id_pago_externo TEXT,
  ADD COLUMN IF NOT EXISTS money_release_date DATE,
  ADD COLUMN IF NOT EXISTS cae VARCHAR,
  ADD COLUMN IF NOT EXISTS vencimiento_cae DATE,
  ADD COLUMN IF NOT EXISTS tipo_comprobante TEXT,
  ADD COLUMN IF NOT EXISTS numero_comprobante TEXT,
  ADD COLUMN IF NOT EXISTS link_factura_pdf TEXT;
```

### Schema clientes (ALTER TABLE):
```sql
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS marketing_optin BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS telefono_normalizado TEXT;  -- formato 5491144445555
-- PostGIS (Fase 9):
-- ADD COLUMN IF NOT EXISTS ubicacion GEOGRAPHY(Point, 4326);
```

---

## Acciones Inmediatas (próximas sesiones)

1. **Iniciar registro Google Ads Standard Token** — proceso manual de Google, puede tardar semanas
2. **Definir prioridad de negocio**: ¿Qué integración quiere el usuario primero?
3. **Fase 0**: migrations fundacionales + habilitar pgcrypto
4. **MP for Marketplaces**: definir si hay plan de cambiar el flujo de suscripción existente

---

## Notas Arquitectónicas Críticas

- **Job Queue pattern**: NUNCA llamar APIs externas síncronamente en el flujo de venta. Siempre INSERT en queue → worker Deno → retry.
- **POS priority**: el trigger en `inventario_lineas` debe decrementar stock ANTES de que la EF procese el webhook externo.
- **pgcrypto**: todos los tokens van encriptados con `PGP_SYM_ENCRYPT`. La clave de encriptación va en Supabase Vault o como secret de la EF.
- **WhatsApp deep link**: normalizar teléfono → `encodeURIComponent` → `https://api.whatsapp.com/send?phone=54911XXXXYYYY`
- **POAS formula**: `(ventas.monto_total - caja_movimientos[comisiones] - ventas.costo_envio_logistica - precio_costo*cantidad) / marketing_ad_spend.spend`
