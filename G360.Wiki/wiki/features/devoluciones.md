---
title: Devoluciones
category: features
tags: [devoluciones, stock, nota-credito, caja, serializado]
sources: [CLAUDE.md]
updated: 2026-04-30
---

# Devoluciones

Módulo de devoluciones de ventas. Implementado en v0.58.0 (migration 030).

---

## Prerequisito de configuración

Antes de usar devoluciones, configurar en ConfigPage:
1. **Ubicación DEV** (`ubicaciones.es_devolucion = true`) — solo 1 por tenant
2. **Estado DEV** (`estados_inventario.es_devolucion = true`) — solo 1 activo a la vez

Sin esta configuración, la lógica bloquea con error descriptivo.

---

## Acceso

Botón **"Devolver"** en el modal de detalle de una venta.  
Disponible para ventas en estado `despachada` o `facturada`.

---

## Flujo de devolución

### Stock no serializado

1. Crea nueva `inventario_lineas` en la ubicación DEV con el estado DEV
2. `notas = "Devolución de venta #N"` (o `"Devolución de LPN {lpn_original}"`)
3. Trigger recalcula `stock_actual` automáticamente
4. Registra movimiento tipo `ingreso`

### Stock serializado

1. Reactiva las series originales: `activo=true, reservado=false`
2. Reactiva su línea (`inventario_lineas`)
3. Recalcula `stock_actual` manualmente (+cantDev)

### Nota de Crédito

- Si origen = `facturada` → `numero_nc = "NC-{venta.numero}-{n}"` (n = count previas + 1)
- Si origen = `despachada` → sin NC
- NC electrónica con AFIP: **pendiente** (requiere extensión del módulo)

### Caja

- Efectivo en `medio_pago` de la devolución → INSERT `egreso` en `caja_movimientos`
- Otro medio → `egreso_informativo`
- Bloquea si no hay sesión de caja abierta y el medio es efectivo

---

## Schema (migration 030)

```sql
devoluciones(
  id, tenant_id, venta_id,
  numero_nc TEXT,
  origen TEXT,        -- 'despachada' | 'facturada'
  motivo TEXT,
  monto_total DECIMAL,
  medio_pago TEXT,    -- JSON [{tipo, monto}]
  created_by
)

devolucion_items(
  devolucion_id, producto_id, cantidad, precio_unitario,
  inventario_linea_nueva_id  -- nullable, para no-serializado
)
```

---

## UI

- **Modal de devolución** desde el detalle de venta:
  - Selección de series (chips) o cantidad (input) por ítem
  - Motivo de devolución
  - Medios de devolución (efectivo, transferencia, etc.)
- **Comprobante imprimible** al finalizar
- **Sección colapsable "Devoluciones (n)"** en el modal si ya existen devoluciones previas

### Estado `devuelta`

Al finalizar `procesarDevolucion`:
- Suma todas las devoluciones de la venta
- Si `totalDevuelto >= venta.total` → `UPDATE ventas SET estado='devuelta'`
- Badge naranja "Devuelta" en historial
- Botón "Devolver" ya no aparece

### Rollback de seguridad

Si cualquier operación falla después del INSERT del header `devoluciones`:
- DELETE automático del header para evitar registros huérfanos con 0 ítems

---

## Notas de Crédito electrónicas (pendiente)

Para ventas facturadas con AFIP, la devolución requiere NC electrónica.  
Pendiente extender la tabla `devoluciones`:
```sql
nc_cae TEXT
nc_vencimiento_cae DATE
nc_numero_comprobante TEXT
factura_vinculada_id FK ventas(id)
```

---

## Links relacionados

- [[wiki/features/ventas-pos]]
- [[wiki/features/inventario-stock]]
- [[wiki/features/facturacion-afip]]
- [[wiki/features/caja]]
