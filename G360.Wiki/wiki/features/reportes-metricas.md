---
title: Reportes y Métricas
category: features
tags: [reportes, metricas, kpi, dashboard, excel, pdf, insights]
sources: [CLAUDE.md]
updated: 2026-05-20
---

# Reportes y Métricas

**Páginas:**
- `src/pages/DashboardPage.tsx` — 10 áreas (Todo + 9 módulos) × 5 sub-pestañas (Insights/Métricas/Rentabilidad/Recomendaciones/Gráficos), v1.92.0
- `src/components/dashAreaSection.ts` — tipo `DashSection` (insights|metricas|graficos) que gatea los `DashXArea`
- `src/pages/ReportesPage.tsx` (`/reportes`) — exportación Excel/PDF
- `src/pages/MetricasPage.tsx` — KPIs históricos
- `src/pages/RentabilidadPage.tsx` — análisis de margen
- `src/pages/RecomendacionesPage.tsx` — insights automáticos

**Acceso por plan:**
- Free: Dashboard básico (tab General)
- Básico+: Reportes, Historial, Métricas
- Pro+: Importar, RRHH, Aging, Marketplace

---

## Dashboard — Tab General (Design System Sprint 3, v0.69.0)

### FilterBar
Controla período/moneda/IVA de KPIs y gráficos:
- Período: Hoy / 7D / 30D / Mes / Trimestre / Año / Custom (date pickers)
- Moneda: ARS / USD (via `useCotizacion`)
- Modo IVA: con IVA / sin IVA

### 4 KPIs principales
| KPI | Cálculo |
|-----|---------|
| **Ingreso Neto** | `caja_movimientos` ingreso − egreso del período |
| **Margen Contribución** | `(ventasNeto - costo) / costo × 100` |
| **Burn Rate diario** | `gastos / días del período` |
| **Posición IVA** | `SUM(venta_items.iva_monto)` del período |

Badges comparativas automáticas vs período anterior equivalente.

### Gráficos
- **La Balanza** (`VentasVsGastosChart`): AreaChart — ventas (área violeta) + gastos (línea roja) por día
- **El Mix de Caja** (`MixCajaChart`): Donut por método de pago con colores de DB (`metodos_pago.color`)

### Insights automáticos
Top 4 de `useRecomendaciones` en grid con `InsightCard`.

### Tabla Fugas y Movimientos
Top 8 gastos + ventas del período ordenados por monto.

---

## Dashboard — Tab Insights

Score de salud completo con barras por dimensión:
- Rotación / Rentabilidad / Reservas / Crecimiento / Datos

Lista completa de recomendaciones con descripción expandida + CTA.

**11 reglas de `useRecomendaciones`:**
- Cobertura crítica (< 3 días de stock al ritmo actual)
- Margen realizado bajo (< 15% del período)
- Día de semana flojo (< 50% del promedio con ≥ 4 semanas de datos)
- Cumpleaños del mes (empleados con fecha_nacimiento)
- + 7 reglas base del sistema

---

## Dashboard — Tab Métricas

- KPIs por período seleccionable
- **margenProductos**: usa `iva_monto` de `venta_items` para obtener neto histórico
- **gananciaNeta**: `totalVentasNeto - ivaVentasPeriodo - costoVentas - gastosTotal`
- **insightsMargen**: usa `alicuota_iva` del producto. Solo aparece si hay productos con margen_objetivo
- Filtro por categoría de producto

> [!WARNING] El precio en DB incluye IVA. Fórmula de margen correcta:
> `precio_neto = precio_venta / (1 + iva/100)` → `markup% = (neto - costo) / costo × 100`

---

## Dashboard — Tab Rentabilidad

- Análisis de margen por producto
- Comparativa precio_venta_neto vs precio_costo
- Productos con margen_objetivo: indicador ▲/▼ real vs objetivo

---

## Dashboard — Tab Recomendaciones

Lista completa de insights con acciones sugeridas.

---

## Proyección de cobertura

En tab General — sección colapsable:
- **Semáforo**: rojo ≤ 7 días / ámbar ≤ 14 días / verde > 14 días
- `diasCobertura = floor(stock_actual / (vendido30d/30))`

---

## Sugerencia de pedido

```
prodsCriticos = prods.filter(stock_actual <= stock_minimo)
diasCobertura = floor(stock_actual / (vendido30d/30))
sugerido = vendido30d > 0
  ? ceil(vendido30d * 1.2) - stock_actual
  : stock_minimo * 2 - stock_actual
```

---

## ReportesPage — Exportación

**Acceso:** Plan Básico+

Reportes disponibles:
- **Stock actual**: agrupa por producto, incluye N° Lote + Vencimiento + expande series
- **Ventas**: parsea JSON de medio_pago, breakdown por método
- **Estados**: exporta correctamente (sin filtro activo)

Formatos: **Excel** (XLSX) · **PDF** (jsPDF + jspdf-autotable)

---

## Historial de actividad

`src/pages/HistorialPage.tsx` (`/historial`) — **Acceso:** Plan Básico+

- Log de `actividad_log` (audit trail completo)
- Filtros: fecha / entidad / **transacción (tipo WMS)** / acción / usuario / nombre
- Filas clickeables → modal detalle (entidad, ID, acción, valor anterior/nuevo, usuario)
- Paginación: selector 20/50/75/100 + primera/última página

### Trazabilidad-extendida — hub de recall (mig 155)

Objetivo (pedido GO 2026-05-30): que `/historial` sea el **hub único de trazabilidad grado WMS** (Manhattan / Blue Yonder). La tabla `actividad_log` pasó de log plano a **ledger trazable** con 7 columnas nuevas: `transaccion_id`, `tipo_transaccion`, `producto_id`, `lpn`, `nro_serie`, `lote`, `sucursal_id` (todas snapshot, retrocompatible — filas legacy quedan con `transaccion_id = NULL`).

**1. Consolidación por transacción** — una acción del usuario que toca N campos (ej: editar un LPN cambiando lote + vencimiento + ubicación) genera N filas que comparten `transaccion_id`. `/historial` las agrupa en **una sola tarjeta** ("Editó LPN X — 3 cambios: lote, vencimiento, ubicación"), expandible en el modal con el detalle campo por campo (cabecera + detalle). Antes eran N eventos sueltos. Helper `nuevaTransaccion()` en `actividadLog.ts` genera el id; los call-sites (`LpnAccionesModal`, `InventarioPage`, `VentasPage`) lo pasan a cada `logActividad()` de la misma acción.

**2. Trazabilidad por unidad (recall)** — filtro "Trazá una unidad" por **producto (nombre/SKU), LPN o N° de serie**. Reconstruye la historia completa de esa unidad cruzando `actividad_log` (ingresos, traslados, ediciones, eliminaciones, **devoluciones**) con `venta_item_despachos` (de qué LPN/ubicación se despachó en cada venta). El filtro por producto resuelve nombre/SKU → `producto_id` y cruza tanto los snapshots `producto_id` del ledger como las filas legacy por nombre. En este modo se muestra todo sin paginar, ordenado cronológicamente.

**Devoluciones en el historial (v1.11.3)** — la devolución de una venta antes no se registraba en `/historial`. Ahora cada ítem reintegrado genera una fila `tipo_transaccion='devolucion'` (agrupadas en 1 transacción por devolución) con `producto_id` + LPN de la nueva línea → aparece en el recall de la unidad. La transición **reserva→despacho** y **venta→devuelta** quedan clasificadas (`tipo_transaccion` `venta`/`devolucion`).

**3. Export completo** — el botón Excel exporta el **set filtrado completo** (no solo la página visible, hasta 10.000 filas) con las columnas del ledger (Tipo, LPN, Serie, Lote, Transacción).

`tipo_transaccion`: `ingreso` · `rebaje` · `traslado` · `ajuste` · `edicion` · `venta` · `devolucion` · `eliminacion`.

### ISS-075 — Movimientos de stock en el Historial (mig 153)

- Los **ingresos y rebajes manuales** de `MovimientosPage` ahora se vuelcan al `actividad_log` con dos acciones nuevas: `ingreso_stock` ("Ingresó") y `rebaje_stock` ("Rebajó").
  - **Ingreso** registra el destino: `campo` = cantidad + unidad, `valor_nuevo` = ubicación · LPN, `valor_anterior` = motivo.
  - **Rebaje** registra el origen: `valor_anterior` = ubicación · LPN de la línea rebajada, `valor_nuevo` = motivo.
- El **traslado** de LPN (`LpnAccionesModal`) ahora incluye la **ubicación de origen** en el diff (`ubicación origen · LPN → ubicación destino · LPN nuevo`), no solo el LPN.
- Para ventas, el detalle de **qué LPN/ubicación se despachó cada ítem** vive en `venta_item_despachos` y se muestra en el modal de detalle de venta (ver [[ventas-pos]]).

---

## Dashboard — Coherencia de números

| Número | Fuente |
|--------|--------|
| "Alertas activas" sidebar badge | `alertas DB + reservas_viejas` |
| "Stock Crítico" card | `stock_actual <= stock_minimo` tiempo real |
| "Deuda pendiente" | `SUM(total - monto_pagado)` ventas pendiente/reservada |
| "Total productos activos" | query separada + count inactivos |

---

## Dashboard tab Todo — filtro por sucursal (v1.8.28-dev)

Todas las queries del tab General/Todo incluyen `sucursalId` en el `queryKey` y filtran por sucursal donde la tabla lo soporta:

| Query | Tablas filtradas |
|-------|-----------------|
| `dashboard-stats` | ventas, movimientos_stock, gastos |
| `movimientos-recientes` | movimientos_stock |
| `top-productos` | ventas |
| `dash-kpis` | gastos ✅ · caja_sesiones (2-step via cajas) ✅ · venta_items ❌ (sin columna) |
| `dash-fugas` | ventas, gastos |
| `stock-inmovilizado` | inventario_lineas |

Las 9 áreas del sub-nav (`DashVentasArea`, etc.) usan `useSucursalFilter` internamente.

### Filtro de sucursal en áreas Inventario y Productos (v1.8.38)

**Bug histórico resuelto:** VentasPage no incluía `sucursal_id` al insertar en `movimientos_stock` → rebajes de ventas quedaban con `sucursal_id = NULL` → filtro estricto los excluía → rotación/runway mostraban 0.

**Comportamiento actual:**
- `dashFilter` usa `.or('sucursal_id.eq.X,sucursal_id.is.null')` (filtro inclusivo) para cubrir registros anteriores al fix
- VentasPage y LpnAccionesModal ahora incluyen `sucursal_id` en todos los inserts de `movimientos_stock`

**Banner de aviso (v1.8.38):** cuando el usuario tiene una sucursal seleccionada en el header (el selector no es visible en /dashboard), aparece un chip amber explicando que los datos están filtrados. El DUEÑO ve botón "Ver todo" para limpiar el filtro.

### Bug categoria FK resuelto (v1.8.38)

La columna `categoria TEXT` en `productos` fue migrada a `categoria_id UUID FK` → `categorias(nombre)`. Los componentes `DashProductosArea` y `DashInventarioArea` seguían seleccionando `categoria` → 400 de PostgREST → `data = null` → **todos los KPIs en $0**.

Fix: queries usan `categorias(nombre)` en el join embedded. El filtro por categoría en DashProductosArea fue eliminado ya que `.eq('joined_table.col', val)` no funciona en PostgREST (gotcha conocido).

---

## Dashboard General — 9 áreas analíticas (v1.8.9–v1.8.14)

Sub-navegación en la pestaña "General". Cada área tiene filtros, KPIs, gráficos e insights propios:

| Área | Componente | Contenido destacado |
|------|-----------|-------------------|
| Ventas | `DashVentasArea` | Funnel 3 etapas, heatmap días×horas, pie canales |
| Gastos | `DashGastosArea` | Burn rate, rigidez del gasto, barras mensuales, top 5 destinos |
| Productos | `DashProductosArea` | Scatter cuadrante mágico, Pareto 80/20, tijera de precios |
| Inventario | `DashInventarioArea` | Gauge "Salud del depósito", aging capital, treemap combos |
| Clientes | `DashClientesArea` | RFM, cohort retención, origen, aging CC |
| Proveedores | `DashProveedoresArea` | Donut proveedores, aging OC, evolución gastos |
| Facturación | `DashFacturacionArea` | IVA, alícuotas, topes monotributo (legales/estimativos) |
| Envíos | `DashEnviosArea` | Funnel, courier, scatter subsidio/ganancia |
| Marketing | `DashMarketingArea` | POAS real, evolución, donut canal, radar campañas |

**Tab "Gráficos":** placeholder "Próximamente".

> [!WARNING] Recharts v3: `Treemap content={<Comp/>}` crashea. Usar divs custom o función render.

---

## SQL Runner en ReportesPage — v1.8.19 (migration 105)

**Acceso:** DUEÑO y SUPER_USUARIO únicamente (con plan Básico+)

**Función DB:** `tenant_sql_query(TEXT)` — SECURITY INVOKER, solo `SELECT`/`WITH`, 500 filas, timeout 10s.

**UI:**
- Editor monospace con syntax mínimo
- Atajo `Ctrl+Enter` para ejecutar
- Tabla dinámica con columnas auto-detectadas
- Export a Excel y PDF
- Solo consultas de lectura — el backend valida y rechaza cualquier escritura

---

## Aging profiles — procesar individualmente — v1.8.19 (migration 106)

**Función DB:** `process_aging_profile_single(p_profile_id UUID)` — misma lógica que el proceso general pero filtrado a un perfil.

**UI en ConfigPage → tab Progresión de Estados:**
- Botón "Procesar" por perfil de aging
- Spinner independiente por perfil (`processingAgingId` por ID)
- Útil para re-procesar un perfil específico sin correr todos

---

## Dashboard — 5 sub-pestañas uniformes por área (v1.92.0)

> **v1.92.0** completó el Dashboard: **las 5 sub-pestañas funcionan en TODAS las áreas** (antes solo en "Todo"; las áreas de módulo mostraban "Próximamente"). Se eliminó el `subTab='overview'` oculto; el landing por defecto pasó a **Insights**. **🛑 REGLA #0:** este cambio es **puro display** — no toca ningún cálculo de plata/fiscal (la base ya quedó auditada en v1.91.0); solo reorganiza *qué bloque ya calculado se muestra*.

Dos filas de navegación:

```
Row 1 — Area tabs (pills):
[Todo] [Ventas] [Gastos] [Productos] [Inventario] [Clientes]
[Proveedores] [Facturación] [Envíos] [Marketing]

Row 2 — Sub-tabs (underline) + Filtros (derecha, solo "Todo"):
[Insights] [Métricas] [Rentabilidad] [Recomendaciones] [Gráficos]     [🎚 Filtros]
```

### Area tabs (Row 1)
- Estilo pill/badge. Area "Todo" = vista general; las otras 9 = mini-dashboard del módulo.
- Cambiar de área **conserva** la sub-pestaña activa (default inicial = Insights). `Envíos` se oculta en modo básico.

### Sub-tabs (Row 2)
- Las 5 son **idénticas en todas las áreas**. Candado de plan en "Métricas" = solo para la `MetricasPage` global de "Todo" (los mini-dashboards de módulo son base, sin gate).

### Cómo se nutre cada sub-pestaña

- **Áreas de módulo** (Ventas/Gastos/Productos/Inventario/Clientes/Proveedores/Facturación/Envíos/Marketing):
  - **Insights / Métricas / Gráficos** → el componente `DashXArea` con la prop `section` (`insights|metricas|graficos`) que gatea sus 3 bloques ya existentes (insights / KPIs / charts). Tipo en `src/components/dashAreaSection.ts`. El wrapper `AreaModulo` mantiene montado el componente al cambiar entre estas 3 (preserva sus filtros internos).
  - **Rentabilidad** → `RentabilidadPage hideHeader` (consolidada del negocio; muestra una nota salvo en Ventas/Productos, donde es el ajuste natural).
  - **Recomendaciones** → `RecomendacionesPage hideHeader categoria={AREA_RECO_CAT[area]}` — recomendaciones del motor filtradas por categoría del área (ventas→`ventas`, inventario→`stock`, clientes→`clientes`, etc.); oculta el selector de categoría y el Score global.
  - 🟠 *Rentabilidad/Recomendaciones por módulo reusan vistas globales (real, honesto). Desglose propio por módulo = construir cálculos nuevos (revisión REGLA #0).*
- **Área "Todo"** (su antiguo overview, distribuido en las 5):

| Sub-tab | Contenido |
|---------|-----------|
| Insights | Score de salud, "Lo que necesitás saber", stock inmovilizado, productos sin movimiento, sugerencia de pedido, proyección de cobertura, lista completa de recomendaciones |
| Métricas | 4 KPIs ejecutivos (Ingreso Neto / Margen Contribución / Burn Rate / Posición IVA) + Fugas y Movimientos + Top productos + Movimientos recientes + `MetricasPage` (plan-gated) |
| Gráficos | La Balanza (`VentasVsGastosChart`) + El Mix de Caja (`MixCajaChart`) |
| Rentabilidad | `RentabilidadPage` (margen por producto) |
| Recomendaciones | `RecomendacionesPage` completa |

`AREA_COMPONENTS`, `AREA_RECO_CAT` y `AreaModulo` viven en `DashboardPage.tsx`.

---

## Links relacionados

- [[wiki/features/inventario-stock]]
- [[wiki/features/ventas-pos]]
- [[wiki/features/gastos]]
- [[wiki/features/rrhh]]
