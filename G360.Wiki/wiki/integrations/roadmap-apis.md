---
title: Roadmap de Integraciones API
category: integrations
tags: [apis, roadmap, killer-features, meli, tiendanube, mercadopago, logistica, ads, whatsapp]
updated: 2026-05-07
---

# Roadmap de Integraciones API

Plan aprobado 2026-05-07. Implementación pausada — retomar cuando se decida avanzar.

---

## Estado actual (resumen)

| Integración | Básico | Killer Feature | Estado |
|---|---|---|---|
| TiendaNube | orders + stock sync | BOM combos, FIFO lotes | ✅ básico / ❌ killers |
| MercadoLibre | orders + stock/precio | Rentabilidad neta, repricing | ✅ básico / ❌ killers |
| MercadoPago | pagos QR + suscripciones | Conciliación, chargeback | ✅ básico / ❌ killers |
| MODO | Framework listo (migration 109) | Pagos en POS | ⚠️ schema+UI listos / pendiente activar |
| AFIP | facturación electrónica (parcial) | Auto-completado CUIT | ⚠️ parcial / ❌ killer |
| Logística (Andreani/OCA) | — | Rate shopping, RMA | ❌ todo |
| PagoNube | — | — | ❌ todo |
| EnvíoNube | — | — | ❌ todo |
| WhatsApp Cloud API | — | Carritos, B2B | ❌ (espera WABA account) |
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

### 1.1 MELI Rentabilidad Neta Real ⭐
- Extender `meli-webhook` + `meli-stock-worker`: leer `sale_fee`, `shipping_cost`, `taxes` de cada orden MELI
- Mostrar en dashboard de ventas: ganancia neta = total - costo_producto - comisión - envío - impuestos
- **Por qué killer**: ningún competidor muestra el margen neto exacto por venta MELI

### 1.2 TiendaNube — BOM automático para combos ⭐
- En `tn-webhook` al procesar `order/paid`: si el producto tiene `es_kit=true`, descontar automáticamente cada componente con FIFO/FEFO desde las ubicaciones correctas del depósito
- Actualmente el combo se descuenta como unidad, no sus componentes individuales
- **Por qué killer**: TiendaNube es pésima manejando kits/combos

### 1.3 AFIP Auto-completado desde CUIT ⭐
- Llamada al WS público de ARCA: `GET https://soa.afip.gob.ar/sr-padron/v2/persona/{cuit}`
- Al ingresar CUIT en alta de clientes/proveedores, auto-completa: Razón Social, Domicilio Fiscal, Condición IVA
- Migration: agregar `cuit` a clientes y proveedores si no existe

### 1.4 MercadoPago — Conciliación automática ⭐
- Extender `mp-webhook`: al recibir `payment.approved`, consultar MP API para leer `fee_amount`, `taxes_amount`, `net_received_amount`
- Auto-crear en `gastos`: `"Comisión MercadoPago - Pago #N"` (categoría "Gastos Financieros")
- Auto-crear en tabla nueva `creditos_fiscales`: `"Retención IIBB - Pago #N"`
- **Por qué killer**: ahorra horas de trabajo al contador, nadie más lo hace

### 1.5 MELI Repricing automático por margen
- Extender `meli-stock-worker`: al hacer sync, comparar `(precio - costo - comision) / costo` vs `margen_objetivo`
- Si margen cayó bajo el objetivo → actualizar precio en MELI por API automáticamente
- Se activa cuando el usuario modifica `precio_costo` en G360

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
- Tabla `whatsapp_credentials` (phone_number_id, waba_token por tenant)
- Notificaciones básicas: pedido enviado, CC vencida, stock crítico
- Recuperación de carritos TiendaNube: webhook carrito abandonado → WA a los 30min con link PagoNube/MP
- Pedidos B2B conversacionales: cliente escribe "repetir pedido del mes pasado" → G360 arma el presupuesto
- CC payment reminder: automatizar el WA que hoy se lanza manualmente desde `ClientesPage`

---

## Resumen de prioridades

| # | Feature | Fase | Esfuerzo | Impacto |
|---|---|---|---|---|
| 1 | MELI Rentabilidad Neta | 1 | Bajo | Altísimo |
| 2 | Conciliación MP automática | 1 | Bajo | Altísimo |
| 3 | TiendaNube BOM combos | 1 | Medio | Alto |
| 4 | AFIP Auto-completado CUIT | 1 | Bajo | Alto |
| 5 | MELI Repricing automático | 1 | Medio | Alto |
| 6 | PagoNube | 2 | Medio | Medio |
| 7 | EnvíoNube + Rate shopping | 2 | Medio | Alto |
| 8 | MELI Ads + Auto-pausado | 4 | Medio | Alto |
| 9 | Logística directa (Andreani/OCA) | 3 | Alto | Medio |
| 10 | Meta Ads + POAS | 5 | Alto | Alto |
| 11 | GA4 UTM + Atribución | 5 | Medio | Medio |
| 12 | Brevo/Klaviyo RFM | 6 | Medio | Medio |
| 13 | WhatsApp Cloud API | 6 | Alto | Alto |
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
