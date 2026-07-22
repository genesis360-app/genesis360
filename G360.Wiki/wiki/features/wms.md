---
title: WMS — Almacenaje Dirigido y Picking
category: features
tags: [wms, lpn, kits, picking, almacenaje, ubicaciones, zonas, reabastecimiento]
sources: [CLAUDE.md, ROADMAP.md, migrations 289, 290, src/pages/PickingPage.tsx]
updated: 2026-07-22
---

# WMS — Warehouse Management System

Visión: el sistema sugiere dónde almacenar cada SKU en base a dimensiones/peso, y genera listas de picking con tareas dirigidas.

---

## Estado de fases

```
Fase 1 ✅ (producto_estructuras — rediseñada con niveles dinámicos por UdM en v1.137, migs 282-283)
  → Fase 2 ✅ (ubicaciones con dimensiones)
    → Fase 2.5 ✅ (KITs / Kitting)
    → Fase 3 ✅ (tareas WMS + picking — v1.143.0, migs 289-290, EN DEV sin deploy a PROD)
      → Fase 4 🔵 (reposición automática ✅ v1.143.0 — cross-docking real sigue pendiente)
```

---

## Fase 1 — Estructura de producto (migration 031 → rediseñada en 282, v1.137.0) ✅

> **Modelo actual (migs 282-283): niveles DINÁMICOS por Unidad de Medida** — estilo pack
> structure/footprint de Blue Yonder. Cada estructura tiene N niveles, cada nivel apunta a una
> UdM del tenant (`producto_estructura_niveles`), con factor contra el nivel anterior y
> `unidades_base` calculada server-side (RPC `fn_estructura_guardar_niveles`). Los 3 niveles
> fijos unidad/caja/pallet de la mig 031 quedaron deprecados.
> **Detalle completo + roadmap de fases 2-5 (operar por UdM, zonas + reglas de almacenaje,
> picking por UdM, reabastecimiento): [[wiki/features/estructuras-udm]].** Fases 3-5 (Zonas,
> Tareas WMS/picking, Reabastecimiento) ✅ **v1.143.0**, ver más abajo. Solo queda pendiente la
> Fase 2 (operar por UdM al ingresar stock).

- Varias estructuras por SKU, un único default (`UNIQUE INDEX WHERE is_default = true`),
  default reasignado automáticamente al eliminar el actual
- UI ProductosPage → Tab Estructura: buscador de producto, cards con cadena de conversión,
  modal de niveles dinámicos; panel expandible en tab Productos muestra la default

---

## Fase 2 — Dimensiones en ubicaciones (migration 032, v0.59.0) ✅

**Nuevos campos en `ubicaciones`** (todos opcionales):
```sql
tipo_ubicacion TEXT CHECK IN ('picking','bulk','estiba','camara','cross_dock')
alto_cm      DECIMAL(8,2)
ancho_cm     DECIMAL(8,2)
largo_cm     DECIMAL(8,2)
peso_max_kg  DECIMAL(8,2)
capacidad_pallets INT
```

**UI ConfigPage → Ubicaciones:**
- Sección colapsable "Dimensiones WMS (opcional)"
- Auto-abre si la ubicación ya tiene datos
- Badge tipo violeta + indicador `📏 alto×ancho×largo cm`

**Almacenaje dirigido (futuro):** Al ingresar stock, el sistema sugerirá ubicación óptima comparando dimensiones del producto vs disponibilidad. Prioridad: tipo adecuado → capacidad suficiente → menor prioridad ocupada.

---

## Fase 2.5 — KITs / Kitting (migrations 040+041, v0.65.0–v0.67.0) ✅

### Schema

```sql
kit_recetas(kit_producto_id, comp_producto_id, cantidad)
kitting_log(tipo 'armado'|'desarmado', estado, componentes_reservados JSONB)
productos.es_kit BOOLEAN
movimientos_stock.tipo: + 'kitting' + 'des_kitting'
```

### Armado en 2 fases (migration 041+052 v0.85.0)

1. **"Iniciar armado"** → incrementa `cantidad_reservada` en líneas de componentes + crea `kitting_log{estado='en_armado'}`
2. Sección "En Armado" muestra armados activos:
   - **Confirmar** → rebaja componentes + ingresa KIT + `estado='completado'`
   - **Cancelar** → libera reservas + `estado='cancelado'`

### Desarmado inverso (v0.67.0)

- Botón "Desarmar" en tab Kits
- Modal con preview de componentes
- Valida stock del KIT disponible
- Rebaja KIT + ingresa componentes al stock
- Movimiento tipo `des_kitting`

### UI InventarioPage — Tab Kits

- CRUD recetas por KIT
- Preview "puede armar: N" según stock mínimo de componentes
- Modal ejecutar kitting con consumo en tiempo real
- Botón Clonar: copia receta a otro KIT
- Badge "KIT" naranja en dropdown de búsqueda de VentasPage
- KIT como producto vendible (precio/stock igual que cualquier SKU)

---

## Fase 3 — Tareas WMS y Listas de Picking (✅ v1.143.0, migs 289-290 — EN DEV, sin deploy a PROD)

**Decisión de arquitectura clave** (confirmada con GO en el chat): el picking es una capa de
**logística pura** — nunca decide qué LPN consume una venta ni cuándo se rebaja stock. El motor de
ventas (`VentasPage.tsx`, `rebajeSort.ts`) no se tocó. Las tareas de picking leen la decisión YA
TOMADA por la venta (`venta_item_despachos` si el envío ya está despachado, `venta_items.lpn_plan`
si es una reserva pendiente) y guían al depósito hacia esos LPNs concretos. Con esto queda cerrada
la pregunta abierta que había dejado v1.137.0 ("¿picking solo envíos o también mostrador?" → solo
envíos/despachos).

**`zonas`** (catálogo nuevo, RLS tenant-only como `ubicaciones`): agrupa ubicaciones —
`ubicaciones.zona_id` columna nueva.

**`reglas_almacenaje`** (catálogo): sugiere una zona destino por Unidad de Medida al ingresar stock
— la sugerencia es editable, **nunca bloquea** (decisión ya tomada por GO en el relevamiento de
v1.137.0).

**`wms_tareas`** (operativa, RLS **por sucursal** — mismo patrón que `inventario_lineas`/`envios`),
bastante fiel al sketch original de esta página. Diferencia real vs. el sketch: se agregaron
`envio_id` y `tarea_precedente_id` (necesarias para el encadenamiento real reabastecimiento→picking,
no estaban previstas en el diseño original):
```sql
wms_tareas
  tipo        ENUM: picking | replenishment | putaway | conteo
  estado      ENUM: pendiente | en_curso | completada | cancelada
  prioridad   INT
  producto_id, cantidad (SIEMPRE en unidades base)
  ubicacion_origen_id, ubicacion_destino_id
  envio_id            → envios (de qué envío nace la tarea de picking)
  tarea_precedente_id → wms_tareas (encadena reabastecimiento → picking; una
                         tarea de picking con precedente pendiente NO se puede completar)
  origen ENUM: envio | manual | umbral
```

**RPCs (mig 290), todas SECURITY INVOKER:**
- `fn_generar_tareas_picking_envio(envio_id)` — genera las tareas de picking de un envío; por cada
  LPN que la venta ya decidió consumir, si el LPN vive fuera de una zona de picking, **encadena**
  automáticamente una tarea `replenishment` precedente (con `FOR UPDATE SKIP LOCKED` para evitar
  carreras entre dos generaciones concurrentes — mejora sumada por el subagente `migration-reviewer`
  antes de aplicar).
- `fn_completar_tarea_picking(tarea_id)` — **solo bookkeeping**: marca la tarea `completada`, nunca
  toca `inventario_lineas`/`movimientos_stock`. Bloqueada (error) si su `tarea_precedente_id` no
  está `completada`.
- Helpers `fn_wms_elegir_ubicacion_picking` (resuelve a qué ubicación de picking corresponde
  reponer/pickear un producto) y `fn_wms_describir_cantidad` (traduce la cantidad en unidades base a
  una descripción legible por UdM, ej. "2 cajas" — cierra el objetivo original de esta fase de
  "sugerir '2 cajas' en vez de '24 unidades'").

**UI:**
- Ruta nueva **`/picking`** (`src/pages/PickingPage.tsx`) — mobile-first, con escaneo de código de
  barras (reusa el componente `BarcodeScanner` ya existente) para completar tareas parado en el
  depósito.
- Tab **"Tareas WMS"** nuevo en `InventarioPage` — vista de escritorio para el DUEÑO, con link
  directo a `/picking`.
- Gating: `modoAvanzado` + rol **DEPOSITO** (nav en `AppLayout.tsx` + redirect guard + ruta en
  `App.tsx`), mismo patrón que "Recepciones".

**Verificación:** revisado por el subagente `migration-reviewer` antes de aplicar. Smoke test manual
contra DEV con datos reales (producto + ubicaciones picking/bulk + venta despachada + envío →
generar tareas → completar reabastecimiento → verificar stock movido sin pérdida ni duplicación →
completar picking) — encontró y corrigió 2 bugs reales antes del e2e (un error de sintaxis PL/pgSQL,
un cast numeric→integer faltante). Verde: tsc · build · **1177 tests unitarios** · regresión e2e (13
specs) · **e2e nuevo 106** (mutante, verificación real en DB). `APP_VERSION` = v1.143.0, commit
`547ef330` en `dev`. **Solo DEV — sin deploy a PROD**, decisión explícita (feature sobre movimiento
real de stock, el deploy queda para cuando GO lo pida).

Detalle completo del roadmap de las 5 fases: [[wiki/features/estructuras-udm]] → "Roadmap del plan".

---

## Fase 4 — Surtido y Cross-docking (largo plazo) — reposición automática ✅ v1.143.0, cross-docking pendiente

- **Reposición automática** ✅ v1.143.0 (migs 289-290) — stock en zona picking bajo el mínimo
  configurado (`producto_ubicacion_umbrales`, mín/máx por producto+ubicación) genera una tarea
  `replenishment` desde bulk, por 2 caminos independientes (habilitables por separado, ambos o
  ninguno):
  - **On-demand** (`tenants.wms_reabastecimiento_on_demand`, default ON): encadenada
    automáticamente al generar tareas de picking de un envío (`fn_generar_tareas_picking_envio`)
    cuando el LPN reservado por la venta vive fuera de una zona de picking.
  - **Por umbral** (`tenants.wms_reabastecimiento_umbral`, default OFF): sweep on-demand
    `fn_generar_tareas_reabastecimiento_umbral(tenant_id)` — sin `pg_cron` (no está habilitado en el
    proyecto), mismo patrón "Procesar ahora" ya usado por Aging Profiles.
  - `fn_completar_tarea_reabastecimiento(tarea_id)` mueve el stock **DE VERDAD** ejecutando la misma
    operación que ya existía en `LpnAccionesModal` → tab Mover (reduce el LPN origen, crea uno
    nuevo en destino) — no se inventó un mecanismo nuevo de movimiento de stock.
  - Bug propio encontrado y corregido en la misma sesión: el sweep por umbral podía elegir la misma
    ubicación como origen y destino de la reposición.
- **Cross-docking** (mercadería entrante → tarea putaway directo a zona despacho): **sin
  implementar**, sigue pendiente.
- **KPIs WMS** (tasa de error picking, tiempo promedio por tarea, utilización de ubicaciones): sin
  implementar, sigue pendiente.

---

## Módulo Recepciones / ASN (migration 059, v0.88.0) ✅

Relacionado con WMS: recepción física de mercadería desde proveedores.

**Tablas (migration 050+059):**
```sql
recepciones(tenant_id, numero AUTO, oc_id nullable, proveedor_id, estado, sucursal_id)
recepcion_items(recepcion_id, producto_id, oc_item_id nullable, 
                cantidad_esperada, cantidad_recibida, estado_id, 
                ubicacion_id, nro_lote, fecha_vencimiento, lpn, 
                series_txt, inventario_linea_id)
```

**Flujo:**
- Opcional: vincular a una OC confirmada → pre-popula ítems
- Al confirmar: genera `inventario_lineas` + `movimientos_stock`
- Actualiza estado OC a `recibida_parcial` o `recibida`
- Roles: OWNER · SUPERVISOR · DEPOSITO

**UI:** `RecepcionesPage.tsx` (`/recepciones`)

### Escaneo de ticket en RecepcionesPage (v1.8.38)

Botón **"📷 Escanear ticket"** en la sección "Productos a recibir" del formulario de recepción.

1. Usuario selecciona foto del ticket de supermercado (comprimida a JPEG 1200px en el browser)
2. EF `scan-ticket` (Claude Sonnet 4.6 vision) extrae `[{barcode, nombre, cantidad, precio_unitario}]`
3. Modal muestra tabla con matching contra DB:
   - ✅ Encontrado en catálogo (por SKU/barcode exacto o nombre fuzzy 2 palabras)
   - ❌ No encontrado — no se carga al formulario
4. Cantidad y precio unitario editables
5. "Cargar N productos al formulario" → pre-popula `FormItem[]` con el `precio_costo` del ticket

El `precio_costo` del ticket se usa como `precio_costo_snapshot` en `inventario_lineas`.

Ver detalle técnico: [[wiki/features/escaneo-barcode]]

---

## Conteo de inventario (migration 050, v0.83.0) ✅

**Tablas:**
```sql
inventario_conteos(estado 'borrador'|'finalizado')
inventario_conteo_items(cantidad_esperada, cantidad_contada, ajuste_aplicado)
```

**UI Tab "Conteo" en InventarioPage:**
- Toggle tipo: Por ubicación / Por producto
- Tabla editable por LPN con color de diferencias (verde/ámbar/rojo)
- Guardar borrador (no afecta stock)
- Finalizar y ajustar: `ajuste_ingreso` o `ajuste_rebaje` automático

---

## Mono-SKU en ubicaciones (migration 052) ✅

`ubicaciones.mono_sku BOOLEAN DEFAULT FALSE` — una sola SKU por ubicación.  
Validación en `ingresoMutation`: si hay otro producto distinto con stock > 0 → error.

---

## Traslados entre sucursales (migration 205, v1.53.0) ✅

Proceso formal de movimiento de stock entre sucursales con estado **en tránsito** y
confirmación del destino (mismo LPN/lote/series = identidad trazable; faltantes auditados).
Detalle completo en [[wiki/features/multi-sucursal]] → "Traslados entre sucursales".

---

## Links relacionados

- [[wiki/features/estructuras-udm]] — estructuras con niveles dinámicos por UdM (footprints) + roadmap picking/almacenaje/reabastecimiento por UdM (Fases 3-5 ✅ v1.143.0)
- [[wiki/features/modo-basico-avanzado]] — desde v1.55.0 las superficies WMS solo se muestran en modo de operación **Avanzado** (toggle por tenant, plan Pro+); el modo gatea UI, nunca datos
- [[wiki/features/inventario-stock]] — tab "Tareas WMS" (v1.143.0)
- [[wiki/features/configuracion]] — sección "Zonas y picking" en Config → Inventario (v1.143.0)
- [[wiki/features/multi-sucursal]]
- [[wiki/features/clientes-proveedores]]
- [[wiki/database/migraciones]] — migs 289, 290
- [[wiki/database/schema-overview]]
