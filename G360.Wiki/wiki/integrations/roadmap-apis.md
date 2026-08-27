---
title: Roadmap de Integraciones API
category: integrations
tags: [apis, roadmap, killer-features, meli, tiendanube, mercadopago, logistica, ads, whatsapp]
updated: 2026-08-26
---

# Roadmap de Integraciones API

Plan aprobado 2026-05-07. **Retomado 2026-08-06, ✅ EN PROD desde v1.159.0** (PR #314, deploy
completo el mismo día): Fase 1.1 (MELI Rentabilidad Neta) ✅ **hecha**, migración 337. Fases 1.2 (TN
BOM combos) y 1.5 (MELI Repricing) tenían un relevamiento de negocio armado esperando respuesta de
GO/Fede — **Fede lo respondió completo el 2026-08-06, GO lo compartió el 2026-08-08** (ver
`sources/raw/relevamiento_ml_tn_combos_repricing_respuestas.md`). **Fase 1.2 (D2) pasó de "lista para
diseñar" a backend CONSTRUIDO y VERIFICADO el mismo día, y quedó ✅ 100% EN PROD desde v1.161.0
(2026-08-08)** (mig 345 en DEV y PROD, `fn_iniciar_armado_kit_auto`/`fn_completar_tarea_armado`,
`tn-webhook`/`meli-webhook` deployados en DEV y PROD) — **falta la prueba end-to-end con una orden real
de un canal de test** (requiere que GO o Fede generen la orden, Claude Code no tiene ese acceso).
**🆕 Fase 1.5 (D3, repricing MELI/TN) — mismo día, construida y VERIFICADA, con la infraestructura
(mig 346 + `meli-stock-worker`/`tn-stock-worker`/`repricing-sweep`) YA APLICADA/DEPLOYADA en DEV Y
PROD** — falta cerrar el pipeline de release del código (`push`/PR `dev→main`/merge/tag `v1.162.0`) y
la prueba end-to-end del mecanismo 2 contra una cuenta MELI/TN real conectada. Además, fuera del
roadmap original, se cerró el **envío automático** al confirmar pago (TN+MELI) y el **fulfillment
sync** TN→despachado/entregado (mig 338) — ver [[wiki/integrations/mercado-libre]] /
[[wiki/integrations/tienda-nube]]. **Con D2 y D3 con su backend construido y verificado, la Fase 1 del
roadmap de integraciones ML/TN queda con las piezas grandes cerradas** — revisar en la próxima sesión
qué queda del roadmap completo (1.3/1.4, Fase 2 en adelante). **Pendiente real: Fase A — conectar un
tenant real a MELI/TN en PROD, sigue sin ninguno.** El resto de las fases (1.3/1.4, 2-6) sigue pausado.

---

## Estado actual (resumen)

| Integración | Básico | Killer Feature | Estado |
|---|---|---|---|
| TiendaNube | orders + stock sync + **envío automático + fulfillment sync (✅ PROD desde v1.159.0)** | BOM combos 🟢 backend construido y verificado (mig 345, EN DEV), falta deployar webhooks + probar con kit real, FIFO lotes | ✅ básico+ / 🟢 killer backend listo |
| MercadoLibre | orders + stock/precio + **envío automático (✅ PROD desde v1.159.0)** | **Rentabilidad neta ✅ hecho y en PROD (mig 337)**, **repricing 🟢 backend construido y verificado, infraestructura (mig 346) EN PROD (2026-08-08), falta el release de código + prueba end-to-end con un canal real** | ✅ básico+ / 🟢 2 de 2 killers con backend listo |
| MercadoPago | pagos QR + suscripciones | Conciliación, chargeback | ✅ básico / ❌ killers |
| MODO | Framework listo (migration 109) | Pagos en POS | ⚠️ schema+UI listos / pendiente activar |
| AFIP | facturación electrónica (parcial) | Auto-completado CUIT | ⚠️ parcial / ❌ killer |
| Logística (Andreani/OCA) | — | Rate shopping, RMA | ❌ todo |
| PagoNube | — | — | ❌ todo |
| EnvíoNube | — | — | ❌ todo |
| WhatsApp Cloud API | — | Carritos, B2B | 🟡 Fase 1 (asistente IA de consultas) construida y verificada en DEV, 2026-08-26 — ver §6.2 |
| Email marketing (Brevo/Klaviyo) | — | RFM sync | ❌ todo |
| Meta Ads | — | POAS, CAPI | ❌ todo |
| Google Ads / GA4 | — | Atribución UTM | ❌ todo |
| MELI Ads | — | Auto-pausado margen | ❌ todo |
| Shopify / WooCommerce | — | — | ❌ todo |

---

## MODO Payments — Framework v1.8.26 (ISS-072, migration 109)

**Schema:**
```sql
modo_credentials(
  tenant_id UUID UNIQUE,
  merchant_id TEXT,
  api_key TEXT,
  ambiente CHECK('test' | 'prod'),
  conectado BOOLEAN,
  conectado_at TIMESTAMPTZ
)
```

**ConfigPage → tab Integraciones → MODO:**
- Formulario para ingresar `merchant_id` + `api_key`
- Toggle ambiente test/prod
- Botón "Conectar" → valida con la API de MODO
- Badge "Conectado ✅" con fecha de conexión

**VentasPage:**
- "MODO" disponible como método de pago (igual que MP QR)
- Solo visible si el tenant tiene `modo_credentials.conectado = true`

**Pendiente:** endpoint de creación de pago y webhook de confirmación MODO (requiere cuenta de producción).

**PagoNube / EnvíoNube scope**: ambos usos — operaciones propias del tenant + integración checkout TiendaNube.  
**Meta Ads / MELI Ads**: posicionamiento futuro, no hay demanda actual de tenants.

---

## Fase 1 — Quick wins sobre infraestructura existente
*Alta prioridad. Impacto alto, esfuerzo bajo — la infra ya existe.*

### 1.1 MELI Rentabilidad Neta Real ⭐ — ✅ HECHO (migración 337, ✅ PROD desde v1.159.0, 2026-08-06)
- Extendido `meli-webhook`: lee `sale_fee` (comisión, en `order_items[]`) y
  `shipping_cost`/`taxes_amount` (viven en `order.payments[]`, NO en la orden ni en `order_items`
  como decía este plan original) de cada orden MELI
- Dashboard de ventas: tab Canales de `VentasPage.tsx` muestra badge "Neto $X" = total - costo_producto - comisión - envío - impuestos
- **Por qué killer**: ningún competidor muestra el margen neto exacto por venta MELI
- Detalle completo: [[wiki/integrations/mercado-libre]] → "Rentabilidad neta real por venta"

### 1.2 TiendaNube — BOM automático para combos ⭐ — ✅ EN PROD desde v1.161.0 (mig 345 + webhooks deployados, 2026-08-08), falta la prueba end-to-end con una orden real de un canal de test
- En `tn-webhook`/`meli-webhook`, si tras la reserva FIFO normal sigue faltando cantidad y el producto
  tiene `es_kit=true`: invocan la RPC `fn_iniciar_armado_kit_auto` (mig 345) que reserva
  automáticamente cada componente en las ubicaciones habilitadas para ese canal y crea una TAREA de
  armado (`wms_tareas.tipo='armado'`) — nunca arma en silencio.
- **Backend 100% construido y verificado con SQL directo contra DEV** (todo-o-nada, camino exitoso,
  filtro de canal `disponible_tn`/`disponible_meli`, cancelación con liberación de reserva) — detalle
  completo: [[wiki/integrations/tienda-nube]] → "BOM automático para combos/kits", `wiki/features/wms`
  → tipo de tarea "armado", `wiki/database/migraciones` (mig 345).
- **✅ Deploy 100% cerrado (2026-08-08):** migración 345 aplicada en DEV y PROD (confirmada con
  `list_migrations` + queries directas); `tn-webhook`/`meli-webhook` deployados en DEV (v21/v25) y
  PROD (v20/v13) vía `deploy_edge_function`, sanity check post-deploy OK; PR #319 (`dev`→`main`)
  mergeado limpio (merge commit `7c26b3a641aafe3d39669badb7c61cf8e42ee3e5`), tag + release `v1.161.0`
  publicados (`--latest`), Vercel PROD verificado de forma independiente (`dpl_CaSPmabR76uEBq6Uuv2d74x78PTP`,
  `READY`, `production`).
- **Pendiente real, no bloqueante del deploy: la prueba end-to-end contra una orden real.** No se pudo
  simular un webhook real con firma válida en este entorno — falta que GO o Fede creen un producto kit
  real mapeado en una de las 2 tiendas TN de test ya conectadas en DEV (tenant
  `bbf7546e-69d6-4ec0-8464-96a6ddc3028d` store `7615512`, tenant `3769b1db-10f4-46a6-bc7f-eb669307730d`
  store `7610321`) y generen una orden real ahí; después se revisa el resultado (venta creada, tarea de
  armado, notificación a supervisores) contra la base real. Fase D2.3 (ficha técnica de armado por kit,
  idea nueva de Fede) sigue sin construir.
- **Por qué killer**: TiendaNube es pésima manejando kits/combos.
- Detalle: [[wiki/integrations/tienda-nube]] → "BOM automático para combos/kits",
  `sources/raw/relevamiento_ml_tn_combos_repricing_respuestas.md`,
  `sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ").

### 1.3 AFIP Auto-completado desde CUIT ⭐
- Llamada al WS público de ARCA: `GET https://soa.afip.gob.ar/sr-padron/v2/persona/{cuit}`
- Al ingresar CUIT en alta de clientes/proveedores, auto-completa: Razón Social, Domicilio Fiscal, Condición IVA
- Migration: agregar `cuit` a clientes y proveedores si no existe

### 1.4 MercadoPago — Conciliación automática ⭐
- Extender `mp-webhook`: al recibir `payment.approved`, consultar MP API para leer `fee_amount`, `taxes_amount`, `net_received_amount`
- Auto-crear en `gastos`: `"Comisión MercadoPago - Pago #N"` (categoría "Gastos Financieros")
- Auto-crear en tabla nueva `creditos_fiscales`: `"Retención IIBB - Pago #N"`
- **Por qué killer**: ahorra horas de trabajo al contador, nadie más lo hace

### 1.5 MELI/TN Repricing automático por margen — 🟢 backend CONSTRUIDO y VERIFICADO, infraestructura EN PROD (mig 346, 2026-08-08), falta la prueba end-to-end con un canal real
- **`productos.margen_objetivo` YA EXISTE** (migración 015) y ahora sí se conectó a una acción de
  código real (antes era solo un insight pasivo en Métricas). Fede respondió el relevamiento completo
  (2026-08-08): 2 mecanismos independientes.
- **Mecanismo 1 — ajuste automático por margen objetivo**, opt-in por producto
  (`productos.reajuste_margen_auto`): toca `precio_venta` (precio base, ÚNICO — igual en Genesis360 y
  TODOS los canales). RPC `fn_evaluar_repricing_margen` (sweep, `service_role`, Edge Function
  `repricing-sweep` con cron cada 6h) ajusta directo o genera una autorización pendiente
  (`autorizaciones_inventario.tipo='repricing_margen'`, reusa la pantalla existente), según
  `tenants.repricing_modo` (automático siempre / alerta / automático desde un monto), con tope de
  suba y umbral de aviso configurables.
- **Mecanismo 2 — ajuste % PROPIO por canal** (`productos.precio_ajuste_meli_pct`/
  `precio_ajuste_tn_pct`, independiente del mecanismo 1): el precio PUBLICADO en cada canal se deriva
  del precio base + ese %, sin tocar `precio_venta` — amortigua la comisión de cada canal.
  `meli-stock-worker` (el job `sync_precio` ya sabía pushear precio, dormido) y `tn-stock-worker`
  (no soportaba precio en absoluto) ahora lo aplican al publicar.
- Comisión MELI proyectada solo informativamente (`fn_ultima_comision_meli`, última venta real de ese
  SKU) — **nunca certera para fijar precio**.
- **🔴 Hallazgo real del `migration-reviewer` antes de aplicar, corregido**: el trigger que dispara el
  push de precio (`fn_enqueue_sync_precio`) reaccionaba a CUALQUIER cambio de precio sin gate —
  como `inventario_meli_map.sync_precio` viene `DEFAULT true` desde la mig 065 (checkbox "dormido"),
  esto habría despertado el push automático para productos ya mapeados sin participar de D3 (2 ítems
  reales de una cuenta MELI real conectada en DEV). Corregido: solo dispara para productos con algo de
  D3 configurado.
- **✅ Migración 346 aplicada en DEV y PROD, Edge Functions `meli-stock-worker`/`tn-stock-worker`/
  `repricing-sweep` deployadas en DEV y PROD, verificado con datos reales en DEV** (fórmula, modo
  alerta sin duplicar, modo automático con tope clampeado, opt-in del trigger, sweep probado en vivo
  contra los 10 tenants de DEV). **`APP_VERSION` bumpeada a `v1.162.0`, commit `792bda42` en `dev`
  LOCAL — falta push a `origin/dev` + PR `dev→main` + merge + tag/release para cerrar el pipeline.**
- **Pendiente real**: el mecanismo 2 (push real de precio) sin probar contra una cuenta MELI/TN real
  conectada (requiere acceso que Claude Code no tiene, mismo motivo que D2).
- Detalle: [[wiki/integrations/mercado-libre]] → "Repricing automático por margen",
  [[wiki/integrations/tienda-nube]] → "Repricing automático por margen",
  `wiki/database/migraciones.md` (mig 346),
  `sources/raw/relevamiento_ml_tn_combos_repricing_respuestas.md`,
  `sources/raw/project_pendientes.md` ("ARRANCÁ ACÁ")

---

## Fase 2 — PagoNube + EnvíoNube
*Integraciones nuevas, alcance acotado. PagoNube y EnvíoNube aplican para: (a) operaciones propias del tenant y (b) integración al checkout de TiendaNube.*

### 2.1 PagoNube
- Credenciales por tenant: tabla `pagomundo_credentials` (api_key, secret por sucursal)
- Edge Function `pagomundo-crear-link`: genera checkout de pago como alternativa a MP (menor comisión)
- Webhook `pagomundo-webhook`: confirma pago → marca venta como pagada
- UI en ConfigPage → Integraciones → PagoNube
- Para TiendaNube: agregar PagoNube como medio de pago disponible en pedidos TN (si la tienda lo tiene configurado)

### 2.2 EnvíoNube
- Credenciales por tenant: tabla `envionube_credentials`
- Edge Function `envionube-cotizar`: cotiza opciones de envío para un destinatario dado
- Rate shopping automático en `EnviosPage`: cotizar EnvíoNube + Andreani + OCA en paralelo, mostrar ranking por tarifa/plazo
- Generación de etiquetas directamente desde G360
- Para TiendaNube: leer métodos de envío configurados en la tienda, sincronizar con G360

---

## Fase 3 — Logística directa (Andreani / OCA / Correo Argentino)
*Schema genérico ya preparado en `integration_job_queue`.*

### 3.1 Rate Shopping automático
- Edge Function `courier-rates`: consulta APIs de Andreani + OCA + Correo AR en paralelo
- Al confirmar envío en `EnviosPage`: mostrar ranking tarifa/plazo/cobertura para el CP del destinatario
- Auto-seleccionar el más barato si el usuario tiene esa preferencia configurada

### 3.2 Generación de etiquetas
- Endpoint de cada carrier para generar etiqueta con código de barras
- PDF de etiqueta embebido en `EnviosPage`
- Guardar `tracking_number` y `carrier` en `envios`

### 3.3 Trazabilidad inversa (RMA)
- Botón "Generar devolución" en `EnviosPage` → crea etiqueta de retorno
- Auto-crea LPN en estado `cuarentena` en `InventarioPage` esperando el producto

### 3.4 Auditoría de sobrecargos
- Cron mensual: cruzar peso/volumen configurado en fichas de producto vs lo que el carrier facturó
- Alerta automática si el carrier cobró de más por aforo

---

## Fase 4 — MELI Ads
*Uso masivo entre vendedores MELI. Requiere token OAuth del mismo `meli_credentials`.*

### 4.1 ACOS por producto
- Pull diario del gasto publicitario por publicación via API MELI Ads
- Nueva pestaña en integración MELI: "Publicidad" con ACOS por ítem

### 4.2 Auto-pausado por margen negativo ⭐ killer absoluto
- Cron cada hora: para cada publicación con anuncio activo, calcular:
  `ganancia_neta = precio - costo - comision_meli - envio_meli - gasto_ad`
- Si `ganancia_neta < 0` → llamar API MELI Ads para pausar el anuncio + notificación al OWNER
- Configuración: toggle "Auto-pausado" por publicación con umbral de margen mínimo configurable

### 4.3 Inversión atada al stock
- Si `stock_disponible <= stock_minimo * 1.5` → reducir presupuesto del anuncio a $0 por API automáticamente

---

## Fase 5 — Meta Ads + Google Ads + GA4
*Mayor complejidad técnica. OAuth por tenant. Para posicionamiento futuro.*

### 5.1 Meta Ads — ROAS básico
- OAuth por tenant (cada tenant conecta su cuenta de Meta Business)
- Pull diario: campaigns, ad_sets con spend + conversions atribuidas
- Dashboard: gasto Meta vs ventas atribuidas

### 5.2 POAS — el detector de mentiras ⭐
- Cruzar campaigns de Meta con ventas G360 usando `utm_source`/`utm_campaign` de pedidos TiendaNube
- POAS = (ganancia neta de ventas atribuidas) / gasto en esa campaña
- Dashboard: ROAS vs POAS lado a lado (si ROAS=10x pero POAS=-0.5x → el negocio está perdiendo)
- Tabla nueva: `marketing_atribucion`

### 5.3 GA4 UTM Tracking
- En `tn-webhook`: leer `utm_source`, `utm_medium`, `utm_campaign` del pedido TiendaNube
- Guardar en `ventas.marketing_metadata` (columna ya existe)
- Dashboard de ventas: torta de "% ganancia neta por canal de adquisición"

### 5.4 Meta CAPI — Audiencias Offline
- Enviar a Meta Conversions API eventos de "compra confirmada" con datos encriptados
- Enviar lista de "Clientes VIP" (RFM tier) para Lookalike audiences

### 5.5 Google Ads
- Similar a Meta pero con Google Ads API (prioridad media, menor adopción pymes AR)
- CAC vs LTV: conectar costo de adquisición con historial de compras del cliente en G360

---

## Fase 6 — Email Marketing + WhatsApp
*Canales de comunicación. WhatsApp espera WABA account.*

### 6.1 Brevo (ex Sendgrid) o Klaviyo
- Sync diario: exportar clientes con etiquetas RFM calculadas en G360 (VIP, En riesgo, Inactivos, Nuevos)
- Segmentos como audiencias en Brevo → campañas de email automáticas
- Webhook reverso: cuando Brevo envía email → actualizar `cliente_notas` en G360

### 6.2 WhatsApp Cloud API (cuando haya WABA account)

> ⚠ **Actualización 2026-08-26**: la propuesta de abajo (notificaciones/carritos/B2B) es la visión
> ORIGINAL de este roadmap, todavía sin construir. Lo que sí se construyó — Fases 1 (consultas) y 2 (cargar
> gastos como borrador), verificadas en DEV, COMMITEADAS/PUSHEADAS (v1.181.0/v1.182.0), sin deploy a PROD
> — es una feature DISTINTA y más chica: un **Asistente de WhatsApp con IA** de consultas de
> stock/precio para el DUEÑO (propuesta de Fede del 25/8/2026), ver [[wiki/features/asistente-whatsapp]].
> GO además conectó de verdad el trámite de Meta (número de prueba) en esta misma sesión — bloqueado para
> mensajes entrantes reales por falta de un chip dedicado, sin afectar el desarrollo (ver esa página).
> La tabla real `whatsapp_credentials` (migración 382) **NO sigue el patrón `(tenant_id, sucursal_id)`
> UNIQUE** apuntado abajo en "Credenciales por integración" — quedó **sin `sucursal_id` a propósito**,
> porque un número de WhatsApp representa al negocio completo, no una sucursal puntual. Si se retoma esta
> visión original (notificaciones/carritos/B2B) más adelante, reusar esa misma tabla en vez de crear una
> nueva.

- Tabla `whatsapp_credentials` (phone_number_id, waba_token por tenant) — ✅ existe desde la mig 382 (sin
  `sucursal_id`, ver nota de arriba), aunque construida para el asistente de consultas, no para lo de abajo
- Notificaciones básicas: pedido enviado, CC vencida, stock crítico
- Recuperación de carritos TiendaNube: webhook carrito abandonado → WA a los 30min con link PagoNube/MP
- Pedidos B2B conversacionales: cliente escribe "repetir pedido del mes pasado" → G360 arma el presupuesto
- CC payment reminder: automatizar el WA que hoy se lanza manualmente desde `ClientesPage`
  (`src/lib/whatsapp.ts`, deep-link `wa.me`, sin IA — no confundir con el asistente conversacional nuevo)

---

## Resumen de prioridades

| # | Feature | Fase | Esfuerzo | Impacto |
|---|---|---|---|---|
| 1 | MELI Rentabilidad Neta | 1 | Bajo | Altísimo — **✅ HECHO y en PROD (mig 337, v1.159.0, 2026-08-06)** |
| 2 | Conciliación MP automática | 1 | Bajo | Altísimo |
| 3 | TiendaNube BOM combos | 1 | Medio | Alto — 🟡 relevamiento respondido (2026-08-08), falta diseñar/construir |
| 4 | AFIP Auto-completado CUIT | 1 | Bajo | Alto |
| 5 | MELI/TN Repricing automático | 1 | Medio | Alto — 🟢 backend construido y verificado, infraestructura EN PROD (mig 346, 2026-08-08), falta el release de código + prueba end-to-end con un canal real |
| 6 | PagoNube | 2 | Medio | Medio |
| 7 | EnvíoNube + Rate shopping | 2 | Medio | Alto |
| 8 | MELI Ads + Auto-pausado | 4 | Medio | Alto |
| 9 | Logística directa (Andreani/OCA) | 3 | Alto | Medio |
| 10 | Meta Ads + POAS | 5 | Alto | Alto |
| 11 | GA4 UTM + Atribución | 5 | Medio | Medio |
| 12 | Brevo/Klaviyo RFM | 6 | Medio | Medio |
| 13 | WhatsApp Cloud API | 6 | Alto | Alto — 🟡 Fases 1+2 (asistente IA de consultas + cargar gastos como borrador, distinto de esta visión de notificaciones/carritos) construidas, verificadas y COMMITEADAS EN DEV (2026-08-26, v1.181.0/v1.182.0), ver [[wiki/features/asistente-whatsapp]] |
| 14 | Google Ads | 5 | Alto | Medio |
| 15 | Shopify / WooCommerce | — | Alto | Bajo (AR) |

---

## Notas técnicas de implementación

### Infraestructura ya disponible
- `integration_job_queue`: queue genérica con retry exponencial (1/2/4/8/16 min, máx 5 reintentos)
- `ventas_externas_logs`: deduplicación de webhooks por `(tenant_id, integracion, external_id)`
- `ventas.marketing_metadata JSONB`: listo para guardar UTMs
- `tenants.whatsapp_plantilla TEXT`: campo preparado para WA

### Credenciales por integración
- Patrón: tabla `{integracion}_credentials` con `(tenant_id, sucursal_id)` UNIQUE
- OAuth tokens: almacenados encriptados, refresh automático al vencer
- API keys: SHA-256 en `api_keys`, nunca expuestos en UI

### Rate limits a tener en cuenta
- MELI API: 100 req/seg por app (no por tenant)
- TiendaNube API: 100 req/min por tienda
- MP API: sin límite documentado, retry con backoff
- AFIP WS: sin límite documentado para consulta de padrón
