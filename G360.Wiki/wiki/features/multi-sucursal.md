---
title: Multi-Sucursal
category: features
tags: [sucursales, multi-sucursal, filtros, selector]
sources: [CLAUDE.md]
updated: 2026-05-07
---

# Multi-Sucursal

Soporte para negocios con múltiples branches. Implementado en v0.42.0 (migration 025).

---

## Schema

```sql
-- Tabla sucursales
sucursales(tenant_id, nombre, dirección, teléfono, activo)

-- sucursal_id nullable en 6 tablas operativas:
inventario_lineas.sucursal_id
movimientos_stock.sucursal_id
ventas.sucursal_id
caja_sesiones.sucursal_id
gastos.sucursal_id
clientes.sucursal_id
```

**Invariante:** datos con `sucursal_id = NULL` (pre-multi-sucursal) siempre visibles en vista global.

---

## authStore

```typescript
sucursales: Sucursal[]      // cargadas en loadUserData()
sucursalId: string | null   // selección actual, persiste en localStorage
setSucursal(id)             // persiste en localStorage
```

`loadUserData` valida que el `sucursalId` guardado en localStorage sigue siendo válido. Se resetea si la sucursal fue eliminada.

---

## useSucursalFilter (hook) — estado actual (PENDIENTE MEJORAR)

```typescript
applyFilter(query)
// Con sucursal activa (comportamiento actual — A CAMBIAR):
//   .or('sucursal_id.eq.{id},sucursal_id.is.null')
//   — mezcla datos de la sucursal + datos globales NULL
// Sin sucursal → sin filtro (vista global)
```

> ⚠ **Plan aprobado (2026-05-07)**: cambiar a filtrado estricto. Ver sección abajo.

`sucursalId` siempre incluido en `queryKey` → invalidación automática al cambiar sucursal.

**Filtros aplicados en:**
- Lectura: inventario_lineas, movimientos_stock, ventas, gastos, clientes
- Escritura: `sucursal_id: sucursalId || null` en inserts de movimientos, ventas, gastos, clientes, caja_sesiones

---

## Plan: Filtrado estricto por sucursal (aprobado, pendiente implementar)

**Decisiones de diseño confirmadas (2026-05-07):**

| Entidad | Comportamiento |
|---------|---------------|
| Productos (catálogo) | **Global** — mismo catálogo en todas las sucursales. Sin filtro. |
| Inventario / LPNs | **Por sucursal** — stock físico separado por local |
| Movimientos de stock | **Por sucursal** |
| Ventas | **Por sucursal** |
| Gastos | **Por sucursal** |
| Caja | **Por sucursal** |
| Clientes | **Global** — con `sucursal_id` en cada venta/devolución como trazabilidad |
| Proveedores | **Global** |

**Cambios a implementar:**

1. **`useSucursalFilter.applyFilter`**: cambiar `.or(eq+null)` → strict `.eq('sucursal_id', sucursalId)` cuando hay sucursal activa. Sin sucursal → sin filtro (todo visible).

2. **`SucursalSelector` en AppLayout**: agregar opción "🌐 Vista global (todas)" al inicio del select. `setSucursal(null)` cuando se selecciona.

3. **Datos históricos `sucursal_id = NULL`**: visibles únicamente en vista global. No migrar — es el comportamiento esperado.

4. **Auto-selección**: si el tenant tiene sucursales, al cargar se selecciona la primera (ya implementado). La opción global queda disponible para ver todo.

---

## SucursalSelector (header) — estado actual

- `<select>` en el header de AppLayout
- Visible solo cuando `sucursales.length > 0`
- **Sin opción "Vista global"** — pendiente agregar (ver plan arriba)
- `useEffect` en AppLayout auto-selecciona la primera si `sucursalId` es null
- En mobile: `hidden sm:flex`

---

## SucursalesPage

- Ruta: `/sucursales`
- Acceso: OWNER-only (`ownerOnly: true`)
- CRUD completo de sucursales
- Tras mutación llama `loadUserData()` para sincronizar el selector del header

---

## Header — nombre contextual

El header muestra la sucursal activa en lugar del nombre de la app:
- Sucursal seleccionada → nombre de la sucursal
- Vista global → nombre del tenant
- Fallback (datos no cargados) → `BRAND.name`

---

## Mover LPN entre sucursales (migration 051)

Desde v0.84.0 (Sprint A):
- Selector de sucursal destino en tab Mover de `LpnAccionesModal`
- Visible solo con ≥ 2 sucursales configuradas
- El nuevo LPN hereda `sucursal_id` seleccionada

---

## Stock mínimo por sucursal (migration 052)

```sql
producto_stock_minimo_sucursal(
  tenant_id, producto_id, sucursal_id, stock_minimo
  UNIQUE(tenant_id, producto_id, sucursal_id)
)
```

UI en ProductoFormPage: visible cuando `isEditing && sucursales.length > 0`.  
Fallback al stock mínimo global si no hay override por sucursal.

---

## Integraciones y sucursales

Cada integración (TiendaNube, MercadoPago, MercadoLibre) tiene credenciales **por sucursal**:
- `tiendanube_credentials.UNIQUE(tenant_id, sucursal_id)`
- `mercadopago_credentials.UNIQUE(tenant_id, sucursal_id)`
- `meli_credentials.UNIQUE(tenant_id, sucursal_id)`

Un tenant puede tener cada marketplace conectado en distintas sucursales independientemente.

---

## Links relacionados

- [[wiki/architecture/estado-global]]
- [[wiki/architecture/multi-tenant-rls]]
- [[wiki/features/inventario-stock]]
- [[wiki/integrations/tienda-nube]]
