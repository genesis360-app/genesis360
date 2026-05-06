---
title: Marketplace Interno
category: features
tags: [marketplace, api, webhook, productos, publicacion]
sources: [CLAUDE.md]
updated: 2026-04-30
---

# Marketplace Interno

Genesis360 tiene un marketplace propio (independiente de MeLi/TN) que permite exponer productos vía API pública a sistemas externos.

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
marketplace_webhook_url TEXT
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

### `marketplace-webhook` (autenticado desde frontend o DB Webhook)

Recibe `{ producto_id }` → busca `marketplace_webhook_url` en tenant → envía POST al sistema externo:
```json
{
  "tenant_id": "...",
  "producto_id": "...",
  "sku": "...",
  "nombre": "...",
  "stock_disponible": 42,
  "timestamp": "..."
}
```
Timeout 10s. Fire-and-forget desde el frontend.

---

## Activar el marketplace

**Vía SQL** (o desde ConfigPage → Negocio):
```sql
UPDATE tenants SET marketplace_activo = true WHERE id = '<tenant_id>';
UPDATE tenants SET marketplace_webhook_url = '<url>' WHERE id = '<tenant_id>';
```

Desde v0.64.0: toggle de `marketplace_activo` disponible directamente en ConfigPage → Negocio.

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
| Sync stock | Webhook saliente | Worker + trigger |
| Órdenes entrantes | No aplica | Webhook → venta G360 |
| Configuración | Toggle en ConfigPage | OAuth en tab Integraciones |

---

## Links relacionados

- [[wiki/integrations/mercado-libre]]
- [[wiki/integrations/tienda-nube]]
- [[wiki/features/inventario-stock]]
