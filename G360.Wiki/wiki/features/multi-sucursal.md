---
title: Multi-Sucursal
category: features
tags: [sucursales, multi-sucursal, filtros, selector, roles, stock-por-sucursal]
sources: [CLAUDE.md]
updated: 2026-05-30
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
| InventarioPage | ✅ filtra | — (incluye tab Historial de movimientos + Agregar/Quitar stock) |
| ~~MovimientosPage~~ | 🗑️ eliminada v1.11.1 | Era huérfana (`/movimientos` redirige a `/inventario`). La UI vive en InventarioPage |
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
- **Mobile (ISS-108, 2026-05-28)**: ícono `Building2` + nombre truncado (max 90px) siempre visible. Si el usuario `puedeVerTodas`, se superpone un `<select>` transparente que permite cambiar de sucursal con un tap. Antes el bloque era `hidden sm:flex` y desaparecía por completo en celular.

---

## SucursalesPage (v1.8.38 — consolidada)

- Ruta: `/sucursales`
- Acceso: OWNER-only (`ownerOnly: true`)
- CRUD completo de sucursales con todos los campos en un solo modal de edición
- Tras mutación llama `loadUserData()` para sincronizar el selector del header

### Campos del formulario de edición

| Campo | DB | Notas |
|-------|-----|-------|
| Nombre | `sucursales.nombre` | Obligatorio |
| Dirección | `sucursales.direccion` | Obligatoria para calcular distancias de envío |
| Teléfono | `sucursales.telefono` | |
| Costo por km | `sucursales.costo_km_envio` | Sobreescribe el global de Config → Envíos |
| Código ticket | `sucursales.codigo` | Prefijo del # de venta (ej: "S1" → "S1-0001") |
| Código postal | `sucursales.codigo_postal` | |
| Email | `sucursales.email` | Email de la sucursal |
| Horario apertura | `sucursales.horario_apertura TIME` | |
| Horario cierre | `sucursales.horario_cierre TIME` | |
| Punto de venta AFIP | `sucursales.punto_venta_afip INTEGER` | Para facturación electrónica |

Panel expandible "Couriers": edición inline de tarifas por courier (tabla `courier_tarifas`).

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

> ⚠ Es un movimiento instantáneo de bajo nivel (sin documento ni confirmación). Para el **proceso formal** usar Traslados (abajo).

## Traslados entre sucursales — proceso formal con tránsito (migration 205 · v1.53.0)

Auditoría de procesos 2026-06-11, ítem #4. Tab **Traslados** en Inventario (`TrasladosPanel.tsx`):

- **Despachar** (DEPOSITO/SUPERVISOR/ADMIN/DUEÑO, desde la sucursal origen activa): destino + líneas/LPN — lote, vencimiento, costo y **series viajan con la línea**. El stock sale del origen (re-chequeo fresco contra carreras + guard de conteo wall-to-wall) y queda **en tránsito** (no está en ninguna sucursal).
- **Confirmar recepción** (solo usuarios de la sucursal destino, o quien `puedeVerTodas`): entra con el **mismo LPN/lote/series** a la ubicación elegida. Si llegó menos → faltante **auditado** (`recibido_parcial` + acción `faltante_traslado` en Historial); series no recibidas quedan inactivas.
- **Cancelar en tránsito** → reingreso completo al origen.
- Ledger: `movimientos_stock` tipo `traslado` en ambas puntas. Tablas `traslados` (correlativo por tenant, `envio_id` reservado para el link logístico futuro) + `traslado_items` (snapshot completo). Lógica pura en `src/lib/trasladoLogic.ts` (22 tests).
- Decisiones relevadas con GO: tránsito + confirmación · por LPN/línea · DEPOSITO+ crea, destino confirma · recepción parcial auditada.

### Bugfix — ubicaciones GLOBALES no aparecían en "Confirmar recepción" (2026-07-18)

La query de `ubicacionesDestino` en `TrasladosPanel` filtraba con `.eq('sucursal_id', destino)` —
un `.eq()` estricto en Postgres/PostgREST nunca matchea `sucursal_id IS NULL`, así que una
sucursal que solo tiene ubicaciones GLOBALES (sin ninguna propia) veía el selector vacío ("Sin
ubicación" únicamente). Fix: `.or('sucursal_id.eq.X,sucursal_id.is.null')`, igual que el resto de
la app. Regresión: `30_traslado_sucursal_mutante` (UAT §35).

### "Mover" del LPN hacia otra sucursal genera un traslado real, no reubica directo (2026-07-18)

El tab "Mover" de `LpnAccionesModal` (movimiento parcial de un LPN) permite elegir cualquier
sucursal como destino además de reubicar dentro de la misma. Hasta esta fecha, elegir OTRA
sucursal ahí reubicaba el stock **directo y de inmediato** en destino — sin pasar por
`traslados`/`traslado_items`, saltándose el mecanismo de tránsito+confirmación de arriba. Fix:
`esMovimientoCrossSucursal()` (`src/lib/trasladoLogic.ts`) detecta el cruce y, si aplica,
`moverStock` despacha un traslado real (`en_transito`, mismos guards que `TrasladosPanel.
despachar`: `puedeCrearTraslado` + conteo bloqueante) en vez de crear la línea en destino. El
selector "Ubicación destino" también pasó a filtrar por la sucursal **elegida** (antes mostraba
las de la sucursal activa del usuario, sin importar a dónde se estuviera moviendo) y se limpia al
cambiar de sucursal.

La ubicación elegida al despachar desde acá se guarda en `traslado_items.ubicacion_sugerida_id`
(**mig 276**, nullable) y precarga el selector de "Confirmar recepción" cuando aplica (todos los
ítems del traslado sugieren la misma — siempre el caso para un traslado de 1 ítem armado desde el
LPN); el destino puede cambiarla igual, no es vinculante. Traslados armados desde el tab Traslados
no la usan (columna queda NULL, selector arranca vacío como siempre).

Validado end-to-end con **dos usuarios reales de sucursales distintas** (no el owner simulando
ambos lados): `30/92/93` en `tests/e2e/`, detalle en UAT §36.

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

## Aislamiento por sucursal — enforcement (v1.11.2-dev · 2026-05-30)

**Requerimiento (GO):** un usuario que trabaja en una sola sucursal (CAJERO y cualquier rol con `puede_ver_todas = false`) **nunca** debe poder ver ni operar datos de otra sucursal. Alternar / ver "Todas" es facultad solo del **DUEÑO** y de los roles que el dueño habilite explícitamente (`puede_ver_todas = true`).

### Triple blindaje (cliente)

1. **Fijado al cargar** (`authStore.loadUserData`): `effectiveSucursalId = puedeVerTodas ? validSucursalId : (userData.sucursal_id ?? null)`. Un usuario sin vista global **ignora el localStorage** y queda en su sucursal asignada.
2. **Selector oculto** (`AppLayout`): el control de sucursal del header solo se muestra/habilita con `puedeVerTodas`. Los demás ven un label fijo de solo lectura.
3. **`setSucursal` guard** (v1.11.2): `if (!get().puedeVerTodas) return` — ignora cualquier intento de cambio aunque se invoque por código. Es la tercera capa.

### Display "Agregar Stock / Rebaje" (v1.11.2)

- Con sucursal activa (o destino elegido en vista global) → **"Stock en sucursal: X"** (valor de esa sucursal, query reactiva `stockEnSucursal`).
- En vista global "Todas" → **"Stock total (todas las sucursales): X"** (rótulo explícito para no confundir el global con el de la sucursal). Solo lo ven roles con `puedeVerTodas`.

### 🔒 RLS por sucursal a nivel servidor (v1.75.0 — migs 216-217-218) ✅

Hasta v1.74.1 el triple blindaje era **solo del lado del cliente** y la RLS de la DB filtraba solo por `tenant_id` → un usuario con credenciales podía leer otra sucursal del mismo tenant por API directa. **Desde v1.75.0 el aislamiento por sucursal está a nivel servidor en 23 tablas.**

**Helpers (mig 216, STABLE SECURITY DEFINER, `search_path=public`):**
- `auth_ve_todas_sucursales()` — espeja EXACTAMENTE `authStore.puedeVerTodas` (`src/store/authStore.ts`): `DUEÑO` siempre; `SUPERVISOR`/`SUPER_USUARIO`/`VIEWER` global salvo `puede_ver_todas=false` explícito; el resto solo si `puede_ver_todas=true`. **Debe replicar el front** o un usuario global con `sucursal_id` NULL quedaría sin datos.
- `auth_user_sucursal()` — la sucursal asignada al usuario.

**Patrón** (reemplaza la policy `*_tenant` de cada tabla):
```sql
USING (
  tenant_id = get_user_tenant_id()
  AND ( auth_ve_todas_sucursales() OR sucursal_id IS NULL OR sucursal_id = auth_user_sucursal() )
)
WITH CHECK ( tenant_id = get_user_tenant_id() )   -- tenant-only: no rompe traslados/triggers cross-sucursal
```
- **Filas `sucursal_id` NULL → visibles para todos** (invariante histórica: bóveda/Caja Fuerte es tenant-wide; legacy ya backfilleado).
- **mig 216 core:** ventas, caja_sesiones, gastos, inventario_lineas, movimientos_stock (SELECT). **mig 217 operativas:** envios, ordenes_compra, recepciones, recursos, cajas, inventario_conteos. **mig 218 hijas** sin `sucursal_id` propia → scopean vía el padre con `EXISTS`/`IN` de 1 salto (venta_items/series/despachos/auditoria, devoluciones-SELECT, caja_movimientos, caja_arqueos, envio_items, inventario_series, orden_compra_items, recepcion_items, inventario_conteo_items).
- **Dejadas tenant-only a propósito:** catálogo/config (clientes, proveedores, combos, credenciales, ubicaciones, puntos_venta_afip), finanzas/tesorería (cheques, CC, devoluciones_proveedor, courier_*), integración, y las que cruzan sucursales por diseño (caja_traspasos doble sesión, traslado_items origen+destino).

> ⚠️ **Gotcha operativo:** todo usuario **activo** con `puede_ver_todas=false` **y `sucursal_id` NULL** queda **sin acceso** bajo esta RLS (solo ve filas NULL, y la data operativa tiene sucursal). Antes de aplicar las migs en cada tenant hay que chequear/backfillear esos usuarios (en PROD se asignó sucursal a un cajero activo así configurado). Ver [[wiki/architecture/multi-tenant-rls]] y `feedback_aislamiento_sucursal` (memoria).

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

### Extensión a movimientos de venta (v1.11.1 · ISS-075)

Los movimientos generados por una **venta** (`registrarVenta` Fase 3 + transición reserva→despacho) ahora registran `stock_antes/despues` con el **stock vendible de la sucursal de la venta** (`stockVendibleSucursal`: líneas activas con estado `es_disponible_venta` + ubicación pickeable en esa sucursal), no el total global del producto. Además se removió el update manual de `productos.stock_actual` en esos flujos: lo maneja el trigger `lineas_recalcular_stock` (`stock_actual = SUM líneas activas`) — el update manual peleaba con el trigger y desincronizaba/doble-restaba. Ver `project_pendientes.md` → BUG-RACE.

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

## Sucursal por defecto al crear negocio (migration 114 · v1.8.28-dev)

### Seed automático
El trigger `trg_seed_tenant_defaults` (SECURITY DEFINER en `tenants`) crea al registrar un negocio nuevo:
- **Sucursal 1** — sucursal inicial del negocio
- **Caja Principal** — asignada a Sucursal 1
- 11 motivos de movimiento + 2 estados de inventario

### authStore — auto-selección de sucursal
`loadUserData` resuelve `sucursalId` con esta prioridad:
1. `'__global__'` en localStorage → null (vista global explícita)
2. UUID válido en localStorage → usa ese UUID
3. **Sin preferencia guardada (null) o UUID inválido** → auto-selecciona la primera sucursal (ordenada por `created_at` ASC)

Esto garantiza que todo lo que crea un usuario nuevo va a Sucursal 1 automáticamente.

---

## Backfill sucursal_id — limpieza completa (migrations 114–117)

Todos los registros operativos sin `sucursal_id` fueron asignados a la sucursal más antigua del tenant.

| Tabla | Migration | NULL intencional preservado |
|-------|-----------|----------------------------|
| `cajas` (operativas) | 114 | Caja Fuerte → NULL (tenant-wide) |
| `ventas` | 115 | — |
| `gastos` | 115 | — |
| `envios` | 115 | — |
| `recepciones` | 116 | — |
| `ordenes_compra` | 116 | — |
| `movimientos_stock` | 116 | — |
| `inventario_lineas` | 117 | — |
| `inventario_conteos` | 117 | — |
| `caja_sesiones` | 117 | Sesiones de Caja Fuerte → NULL |
| `recursos` | 117 | — |
| `puntos_venta_afip` | 117 | — |

**NULL intencional preservado (no backfillado):**
- `clientes`, `proveedores` → globales por diseño (ISS-102, compartidos entre sucursales)
- `users.sucursal_id` → roles globales (DUEÑO, SUPERVISOR) tienen NULL
- `ubicaciones`, `combos` → pueden ser globales (NULL = disponible a todas las sucursales)

---

## Filtros estrictos — eliminación del workaround OR IS NULL (v1.8.28-dev)

Con el backfill completo, se eliminó el workaround `OR sucursal_id IS NULL` de:
- `VentasPage` — historial de ventas
- `DashVentasArea`, `DashGastosArea`, `DashProductosArea`, `DashInventarioArea`, `DashClientesArea`, `DashProveedoresArea`, `DashFacturacionArea`, `DashEnviosArea`, `DashMarketingArea`

> [!NOTE] `ConfigPage` ubicaciones y combos conservan `OR sucursal_id IS NULL` — diseño intencional: pueden ser globales.

---

## cajas.sucursal_id (migration 111)

- `cajas.sucursal_id UUID` FK a `sucursales` (nullable)
- **Caja Fuerte/Bóveda:** siempre `sucursal_id = NULL` (compartida a nivel tenant)
- **Cajas operativas:** asignadas a su sucursal
- **CajaPage query:** cuando hay sucursal activa → `.or('sucursal_id.eq.X,es_caja_fuerte.eq.true')`
- **Tab Configuración:** selector de sucursal por caja (visible con ≥2 sucursales) para reasignar cajas existentes
- **Crear caja:** recibe `sucursal_id` de la sucursal activa en el header

---

## Ubicación predeterminada por sucursal (migration 121 · v1.8.31-dev)

```sql
producto_ubicacion_sucursal(
  producto_id UUID,
  sucursal_id UUID,
  ubicacion_id UUID,
  UNIQUE(producto_id, sucursal_id)
)
```

**Comportamiento en ProductoFormPage:**

| Contexto | Select muestra | Guarda en |
|----------|---------------|-----------|
| Con sucursal activa en header | Ubicaciones de esa sucursal + globales | `producto_ubicacion_sucursal` (upsert) |
| Sin sucursal activa (vista global) | Todas las ubicaciones | `productos.ubicacion_id` (fallback global) |

**Resolución al ingresar stock:**
1. Busca en `producto_ubicacion_sucursal` por `(producto_id, sucursal_id)` activa
2. Fallback: `productos.ubicacion_id` global

Patrón idéntico a `producto_stock_minimo_sucursal` (migration 052).

---

## Filtros OC y Facturación por sucursal (v1.8.28-dev)

| Módulo | Cambio |
|--------|--------|
| ProveedoresPage tab OC | `applyFilter` aplicado al listado de OCs + `sucursalId` en queryKey |
| FacturacionPage — ventas sin CAE | Filtro por sucursal activa |
| FacturacionPage — facturas emitidas | Filtro por sucursal activa |
| OC desde ProductosPage | Busca borrador OC de la misma sucursal activa + crea OC con `sucursal_id` correcto |

---

## Links relacionados

- [[wiki/architecture/estado-global]]
- [[wiki/architecture/multi-tenant-rls]]
- [[wiki/features/inventario-stock]]
- [[wiki/features/productos]]
- [[wiki/features/caja]]
- [[wiki/support/supabase-db-rescue]]
- [[wiki/integrations/tienda-nube]]
