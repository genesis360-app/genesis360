---
title: Multi-Sucursal
category: features
tags: [sucursales, multi-sucursal, filtros, selector, roles, stock-por-sucursal]
sources: [CLAUDE.md]
updated: 2026-05-13
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

## useSucursalFilter (hook)

```typescript
applyFilter(query)
// Con sucursal activa: .eq('sucursal_id', sucursalId)  ← filtro estricto ✅
// Sin sucursal (vista global) → sin filtro (todo visible, incluye NULL)
```

`sucursalId` siempre incluido en `queryKey` → invalidación automática al cambiar sucursal.

**Filtros aplicados en:**
- Lectura: inventario_lineas, movimientos_stock, ventas, gastos, clientes
- Escritura: `sucursal_id: sucursalId || null` en inserts de movimientos, ventas, gastos, clientes, caja_sesiones

---

## Plan: Filtrado estricto por sucursal (implementado 2026-05-07)

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

**Cambios implementados (2026-05-07):**

1. **`useSucursalFilter.applyFilter`**: filtro estricto `.eq('sucursal_id', sucursalId)` cuando hay sucursal activa. Sin sucursal → sin filtro (todo visible, incluye NULL).

2. **`SucursalSelector` en AppLayout**: opción "Todas las sucursales" al inicio del select (`value=''` → `setSucursal(null)`).

3. **`authStore` — persistencia "Vista global"**: sentinel `'__global__'` en localStorage. `setSucursal(null)` guarda `'__global__'` en lugar de borrar la key. El auto-select del header no sobreescribe una elección explícita de vista global.

4. **Datos históricos `sucursal_id = NULL`**: visibles únicamente en vista global. No migrar — comportamiento esperado.

---

## Plan: Expandir filtro de sucursal a todos los módulos operativos (pendiente)

**Regla general** (aprobada 2026-05-08):
- **Global** (sin filtro): productos, categorías, proveedores (catálogo base)
- **Por sucursal** (filtro estricto): todo lo operativo

| Módulo/página | Estado | Acción requerida |
|---|---|---|
| InventarioPage | ✅ filtra | — |
| MovimientosPage | ✅ filtra | — |
| VentasPage | ✅ filtra | — |
| GastosPage | ✅ filtra | — |
| CajaPage | ✅ filtra | — |
| EnviosPage — listado | ✅ filtra | — |
| RecursosPage — listado | ✅ filtra | — |
| ProductosPage — stock crítico | ✅ filtra | `applyFilter` aplicado al query de `inventario_lineas` (v1.8.5) |
| RecepcionesPage — listado | ✅ filtra | `applyFilter` aplicado al query del listado (v1.8.5) |
| Notificaciones (campana) | — | Alertas de stock y CC se generan a nivel tenant. Evaluar si las de stock deben ser por sucursal. |
| RRHH | — | Verificar si el módulo existe y si empleados tienen `sucursal_id`. |

---

## SucursalSelector (header)

- `<select>` en el header de AppLayout
- Visible solo cuando `sucursales.length > 0`
- Primera opción: "Todas las sucursales" (value `''` → sucursalId `null`)
- `useEffect` auto-selecciona la primera sucursal solo si no hay preferencia guardada en localStorage
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

## Bug fixes multi-sucursal (v1.8.8)

### Fix A — `inventario_lineas` INSERT omitía `sucursal_id` (v1.8.8)

**Síntoma:** LPNs creados desde InventarioPage nunca tenían `sucursal_id`. Al filtrar por sucursal → 0 unidades. Solo `movimientos_stock` recibía `sucursal_id`.

**Fix:** `ingresoMutation` en InventarioPage ahora incluye `sucursal_id: sucursalId ?? ingresoSucursalId ?? null` en el INSERT de `inventario_lineas`. `MasivoModal` ya lo tenía correcto.

**Selector para OWNER en vista global:** cuando `sucursalId = null` y `puedeVerTodas = true`, se muestra un selector de sucursal en el form de ingreso (resaltado en ámbar) para que OWNER asigne explícitamente la sucursal del stock.

**Usuarios normales:** su `sucursalId` está fijo en authStore → siempre correcto automáticamente.

### Fix B — LpnAccionesModal: bug value/state en selector de sucursal (v1.8.8)

**Síntoma:** `sucursalDestino` se inicializaba a `''` cuando `linea.sucursal_id = null`. El `<select value="">` renderizaba la primera sucursal visualmente pero el estado era `''`. Al hacer traslado, el nuevo LPN heredaba sucursal null. El usuario veía "Sucursal A seleccionada" pero el LPN quedaba sin sucursal.

**Fix:**
- `sucursalDestino` es ahora `string | null` (null = sin sucursal, string = UUID de sucursal)
- `<select value={sucursalDestino ?? ''}>` - conversión explícita para el DOM
- Primera opción: `<option value="">Sin sucursal asignada (actual)</option>` cuando LPN no tiene sucursal
- `onChange`: `setSucursalDestino(e.target.value || null)` - vacío → null
- `sucursalFinal = sucursalDestino ?? linea.sucursal_id ?? null` (usa `??` en vez de `||`)

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

---

## Roles y puedeVerTodas (v1.8.18 — 2026-05-13)

### authStore — lógica de puedeVerTodas

```typescript
// Solo DUEÑO es siempre global — hardcoded, no se puede restringir
const ROLES_SIEMPRE_GLOBALES = ['DUEÑO']

// Estos son globales por defecto pero restringibles con puede_ver_todas=false en DB
const ROLES_GLOBAL_POR_DEFECTO = ['SUPERVISOR', 'SUPER_USUARIO']

const puedeVerTodas =
  ROLES_SIEMPRE_GLOBALES.includes(rol) ||                           // DUEÑO: siempre
  (ROLES_GLOBAL_POR_DEFECTO.includes(rol) && puede_ver_todas !== false) ||  // SUP/SUPER: default true
  !!puede_ver_todas                                                  // otros: solo si explícito en DB
```

| Rol | `puede_ver_todas` DB | Resultado |
|---|---|---|
| DUEÑO | — (ignorado) | Siempre global |
| SUPERVISOR | null o true | Global por defecto |
| SUPERVISOR | false | Restringido a `sucursal_id` |
| SUPER_USUARIO | null o true | Global por defecto |
| SUPER_USUARIO | false | Restringido a `sucursal_id` |
| CAJERO / DEPOSITO / RRHH / CONTADOR | null o false | Restringido a `sucursal_id` |

---

## Selector de sucursal por módulo (v1.8.18 — 2026-05-13)

El header muestra distinto control según la ruta activa:

### RUTAS_CON_TODAS — dropdown "Todas las sucursales" + cada sucursal
`/dashboard` · `/productos` · `/inventario` · `/clientes` · `/facturacion`  
`/proveedores` · `/recursos` · `/biblioteca` · `/rrhh` · `/historial` · `/reportes` · `/configuracion`

### RUTAS_SOLO_SUCURSAL — dropdown solo sucursales (sin "Todas")
`/ventas` · `/gastos` · `/caja` · `/recepciones` · `/alertas`

> Auto-select: si el usuario con `puedeVerTodas` navega a una ruta solo-sucursal en vista global, se auto-selecciona la primera sucursal disponible.

### Sin selector
`/sucursales` · `/usuarios`

### Todos los demás roles (sin puedeVerTodas)
Label fijo de solo lectura con la sucursal asignada. Sin opción de cambiar.

---

## Stock por sucursal — fix integral (v1.8.17-18 — 2026-05-13)

### Problema original
`movimientos_stock.stock_antes` y `stock_despues` se calculaban con `productos.stock_actual` (global — suma de todas las sucursales), no con el stock de la sucursal activa.

### Helper `getStockAntesSucursal`

```typescript
// En InventarioPage — clausura sobre tenant y sucursalId del store
async function getStockAntesSucursal(productoId: string, efectivaSucId: string | null): Promise<number> {
  if (efectivaSucId) {
    const { data } = await supabase.from('inventario_lineas').select('cantidad')
      .eq('tenant_id', tenant.id).eq('producto_id', productoId)
      .eq('sucursal_id', efectivaSucId).eq('activo', true)
    return (data ?? []).reduce((s, l) => s + (Number(l.cantidad) || 0), 0)
  }
  const { data } = await supabase.from('productos').select('stock_actual').eq('id', productoId).single()
  return data?.stock_actual ?? 0
}
```

**Corregido en:** ingreso, rebaje, masivo inline, conteo, autorizaciones (ajuste/serie/LPN), kitting, des-kitting.

**`sucursal_id` ahora se guarda en** todos los inserts de `movimientos_stock` e `inventario_lineas` (kitting, des-kitting, autorizaciones, masivo inline).

**Display en formularios:** "Stock en sucursal: X" cuando hay sucursal activa (reactivo, `staleTime: 0`). Columnas "Stock prev./Stock nuevo" ocultadas en tabs Agregar/Quitar — solo visibles en Historial.

---

## Filtros por sucursal por módulo (2026-05-13)

Módulos donde se aplicó `applyFilter` / `.eq('sucursal_id')`:

| Módulo / Query | Estado |
|---|---|
| InventarioPage — movimientos historial | ✅ |
| InventarioPage — rebaje (lineas-producto) | ✅ fix v1.8.18 |
| InventarioPage — kits (stock y reserva de componentes) | ✅ fix v1.8.18 |
| InventarioPage — conteos (historial + carga de líneas) | ✅ fix v1.8.18 |
| AlertasPage — reservas, lineas sin ubic/prov, OCs, LPNs, deuda | ✅ fix v1.8.19 |
| ConfigPage — ubicaciones y combos | ✅ (selector en header activo en /configuracion) |
| RecursosPage — listado | ✅ |

---

## Ubicaciones — asignación por sucursal (2026-05-13)

- `ubicaciones.sucursal_id` existe desde migration 101
- `saveUbicacion` en ConfigPage ahora guarda `sucursal_id`
- Formulario de edición: selector "Global / Sucursal X"
- Lista: badge azul con nombre de sucursal o badge gris "Global" (null)
- Filtro en Config: muestra ubicaciones de la sucursal activa + las globales (`sucursal_id IS NULL`)
- Nuevas ubicaciones creadas con sucursal activa se asignan automáticamente

---

## Bulk Edit de LPNs (migration 103 — 2026-05-13)

Cambio masivo de atributos en múltiples LPNs desde InventarioPage:

**Campos editables en bulk:** sucursal, proveedor, nro_lote, fecha_vencimiento

**Flujo:**
1. Seleccionar LPNs (checkbox por fila)
2. Botón "Editar atributos" (barra de acciones)
3. Modal: tildar campos a cambiar + preview antes de confirmar
4. DEPOSITO → genera `autorizaciones_inventario` tipo `bulk_edit` (pendiente de aprobación)
5. Otros roles → aplica directamente `.update().in('id', ids)`

**Migration 103:** `linea_id` nullable en `autorizaciones_inventario` + nuevo tipo `bulk_edit` en CHECK constraint.

---

## LPN — sucursal en tab Editar (2026-05-13)

`LpnAccionesModal` tab Editar: nuevo selector `sucursal_id` para reasignar el LPN completo a otra sucursal sin usar el flujo de traslado. Guarda con logActividad.

---

## Links relacionados

- [[wiki/architecture/estado-global]]
- [[wiki/architecture/multi-tenant-rls]]
- [[wiki/features/inventario-stock]]
- [[wiki/support/supabase-db-rescue]]
- [[wiki/integrations/tienda-nube]]
