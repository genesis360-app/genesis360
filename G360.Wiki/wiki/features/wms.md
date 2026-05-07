---
title: WMS — Almacenaje Dirigido y Picking
category: features
tags: [wms, lpn, kits, picking, almacenaje, ubicaciones]
sources: [CLAUDE.md, ROADMAP.md]
updated: 2026-04-30
---

# WMS — Warehouse Management System

Visión: el sistema sugiere dónde almacenar cada SKU en base a dimensiones/peso, y genera listas de picking con tareas dirigidas.

---

## Estado de fases

```
Fase 1 ✅ (producto_estructuras)
  → Fase 2 ✅ (ubicaciones con dimensiones)
    → Fase 2.5 ✅ (KITs / Kitting)
    → Fase 3 🔵 (tareas WMS + picking — pendiente)
      → Fase 4 🔵 (surtido + cross-docking — largo plazo)
```

---

## Fase 1 — Estructura de producto (migration 031, v0.57.0) ✅

**Tabla `producto_estructuras`:**
- Niveles: `unidad` / `caja` / `pallet`
- Por nivel: peso (kg) + dimensiones alto/ancho/largo (cm)
- Conversiones: `unidades_por_caja`, `cajas_por_pallet`
- Mínimo 2 niveles activos al crear
- Un único default por SKU: `UNIQUE INDEX WHERE is_default = true`
- Default reasignado automáticamente al eliminar el default actual

**UI ProductosPage — Tab Estructura:**
- CRUD completo con buscador/dropdown de producto
- Modal `EstrModal` con toggle por nivel (`NivelSection`)
- Tarjeta `EstrCard` con detalle por nivel
- Panel expandible en tab Productos: muestra estructura default; link "Agregar estructura" si no tiene

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

## Fase 3 — Tareas WMS y Listas de Picking (pendiente)

**Nueva tabla `wms_tareas`:**
```sql
tipo ENUM: putaway | picking | replenishment | conteo
estado ENUM: pendiente | en_curso | completada | cancelada
usuario_asignado_id
prioridad INT
fecha_limite
FK: inventario_lineas, ubicaciones (origen/destino), ventas
```

**Listas de picking:**
- Agrupan tareas `picking` por pedido/despacho
- Ruta óptima dentro del depósito (prioridad de ubicaciones)
- Cada tarea: SKU · LPN · N/S o lote · ubicación origen · cantidad · destino
- Respeta regla FIFO/FEFO/serie para selección exacta
- Interface en InventarioPage o nueva página WMS dedicada

---

## Fase 4 — Surtido y Cross-docking (largo plazo)

- **Reposición automática**: stock en zona picking < umbral → tarea `replenishment` desde bulk
- **Cross-docking**: mercadería entrante → tarea putaway directo a zona despacho
- **KPIs WMS**: tasa de error picking, tiempo promedio por tarea, utilización de ubicaciones

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

## Links relacionados

- [[wiki/features/inventario-stock]]
- [[wiki/features/clientes-proveedores]]
- [[wiki/database/schema-overview]]
