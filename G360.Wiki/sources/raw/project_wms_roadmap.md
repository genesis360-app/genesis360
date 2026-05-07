---
name: project_wms_roadmap
description: Visión WMS del usuario — almacenaje dirigido y picking inteligente (Fases 1–4)
type: project
originSessionId: 7ac12f69-1217-41e2-b6e5-3547bd561e43
---
El usuario tiene una visión de WMS completo a futuro. Las Fases 1, 2 y 2.5 ya están implementadas.

**Why:** El usuario compartió esta visión para que las decisiones de schema de hoy no bloqueen las fases futuras.
**How to apply:** Al diseñar tablas relacionadas con ubicaciones, inventario o movimientos, verificar compatibilidad con este roadmap.

## Fase 1 ✅ — Estructura de producto (v0.57.0, migration 031)

Tabla `producto_estructuras`: N estructuras por SKU, niveles unidad/caja/pallet con peso y dimensiones. WMS-ready desde el inicio.

## Fase 2 ✅ — Dimensiones en ubicaciones (v0.59.0, migration 032)

Campos opcionales en `ubicaciones`: `alto_cm`, `ancho_cm`, `largo_cm`, `peso_max_kg`, `tipo_ubicacion` (picking/bulk/estiba/camara/cross_dock), `capacidad_pallets`. UI colapsable en ConfigPage.

## Fase 2.5 ✅ — KITs / Kitting (v0.65.0–v0.67.0, migrations 040+041)

`kit_recetas` + `kitting_log` (armado/desarmado). `productos.es_kit`. Tipos `kitting`/`des_kitting` en `movimientos_stock`. Tab Kits en InventarioPage. Clonar recetas.

## Fase 3 — Tareas WMS y listas de picking (pendiente)

Nueva tabla `wms_tareas`: tipo (putaway/picking/replenishment/conteo), estado (pendiente/en_curso/completada/cancelada), FK a `inventario_lineas`, `ubicaciones` (origen+destino), `ventas`.
Las listas de picking usan regla de inventario del SKU y prioridad de ubicaciones para ruta óptima.

## Fase 4 — Surtido y cross-docking (largo plazo)

Reposición automática bulk→picking, cross-docking, KPIs de eficiencia WMS.

## Invariante de arquitectura

El schema actual es compatible con todas las fases. `inventario_lineas` ya tiene `ubicacion_id`, `lpn`, `nro_lote`, `fecha_vencimiento`, series. Al llegar a Fase 3 solo se agrega tabla `wms_tareas`.
