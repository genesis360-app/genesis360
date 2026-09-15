---
title: Marketplace Interno
category: features
tags: [marketplace, api, webhook, productos, publicacion]
sources: [CLAUDE.md, supabase/functions/marketplace-api, supabase/functions/marketplace-webhook]
updated: 2026-09-14
---

# Marketplace Interno

Genesis360 tiene un marketplace propio (independiente de MeLi/TN) que permite exponer productos vía API pública a sistemas externos.

> [!NOTE]
> **Estado al 2026-09-14:** ningún negocio lo tiene activo (0 en DEV y PROD, 0 productos publicados).
> Las dos Edge Functions existen **solo en PROD**. El **webhook de stock quedó apagado** por decisión de
> GO: ver más abajo.

---

## Concepto

El marketplace interno permite que un sistema externo (ej: tienda propia, app móvil) consulte el catálogo de productos con stock disponible en tiempo real vía una API pública.

---

## Schema (migration 020)

### Campos en `productos`
```sql
publicado_marketplace   BOOLEAN
precio_marketplace      DECIMAL(12,2)
stock_reservado_marketplace INT
descripcion_marketplace TEXT
```

### Campos en `tenants`
```sql
marketplace_activo      BOOLEAN
marketplace_webhook_url TEXT   -- sin uso desde 2026-09-14 (el campo salió de Configuración)
```

---

## Edge Functions

### `marketplace-api` (pública, sin JWT)

```
GET ?tenant_id=uuid
→ devuelve productos con publicado_marketplace=true
```

**Stock disponible calculado:**
```
stock_disponible = stock_actual - stock_reservado_marketplace 
                 - SUM(cantidad_reservada en inventario_lineas)
```

- Rate limiting: 60 req/min por IP (en memoria del isolate Deno)
- CORS abierto (cualquier origen puede consultar)

Es la forma de integrarse que sigue vigente: el sistema externo **consulta** el stock cuando lo necesita.

### `marketplace-webhook` — 🔌 APAGADA (2026-09-14)

Recibía `{ producto_id }`, buscaba `marketplace_webhook_url` del negocio y le mandaba un POST con
`{ tenant_id, producto_id, sku, nombre, stock_disponible, timestamp }` (timeout 10 s).

**Por qué se apagó:** el wiki la describía como "fire-and-forget desde el frontend", pero **ningún código
la llamaba** (ni el frontend ni un trigger o Database Webhook). Quien cargara una URL en Configuración
nunca iba a recibir nada. Además aceptaba llamadas **sin autenticación** (para un Database Webhook que
nunca se configuró): cualquiera con un `producto_id` podía disparar un POST hacia la URL del negocio.

**Qué se hizo** (decisión de GO):
- El campo "URL de webhook externo" salió de Configuración → Marketplace (la columna queda en la base).
- La EF ahora exige un usuario autenticado **del mismo negocio** que el producto (401/403 si no).
  ⚠️ El código nuevo está en el repo; en PROD se redespliega con el próximo deploy (`verify_jwt` pasa a
  `true`). En DEV nunca estuvo desplegada.
- Si algún día se reconecta: hacerlo **server-side** (trigger sobre `movimientos_stock` + cola con
  reintentos + firma HMAC), nunca desde el navegador.

---

## Activar el marketplace

Desde ConfigPage → Negocio → Marketplace: toggle de `marketplace_activo` (solo el DUEÑO). Al activarlo se
muestra el endpoint público del catálogo.

---

## UI ProductoFormPage

- Sección "Marketplace" colapsable
- **Solo visible** si `tenant.marketplace_activo = true`
- Auto-abre si el producto ya está publicado
- Toggle publicar + precio marketplace + stock reservado + descripción pública

---

## Restricción por plan

- Feature `marketplace` disponible desde plan **Pro / Enterprise**
- En Free/Básico: `UpgradePrompt` con candado en el sidebar

---

## Diferencia con integraciones MeLi/TN

| Aspecto | Marketplace interno | MeLi/TiendaNube |
|---------|--------------------|--------------------|
| Autenticación API | Sin JWT (pública con tenant_id) | OAuth por tenant |
| Sync stock | Consulta a la API (el webhook está apagado) | Worker + trigger |
| Órdenes entrantes | No aplica | Webhook → venta G360 |
| Configuración | Toggle en ConfigPage | OAuth en tab Integraciones |

---

## Links relacionados

- [[wiki/integrations/mercado-libre]]
- [[wiki/integrations/tienda-nube]]
- [[wiki/features/inventario-stock]]
- [[wiki/architecture/edge-functions]]
