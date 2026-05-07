---
title: Reportes y Métricas
category: features
tags: [reportes, metricas, kpi, dashboard, excel, pdf, insights]
sources: [CLAUDE.md]
updated: 2026-04-30
---

# Reportes y Métricas

**Páginas:**
- `src/pages/DashboardPage.tsx` — tabs: General / Insights / Métricas / Rentabilidad / Recomendaciones
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
- Filtros: fecha / categoría / tipo / motivo
- Filas clickeables → modal detalle (entidad, ID, acción, valor anterior/nuevo, usuario)
- Paginación: selector 20/50/75/100 + primera/última página

---

## Dashboard — Coherencia de números

| Número | Fuente |
|--------|--------|
| "Alertas activas" sidebar badge | `alertas DB + reservas_viejas` |
| "Stock Crítico" card | `stock_actual <= stock_minimo` tiempo real |
| "Deuda pendiente" | `SUM(total - monto_pagado)` ventas pendiente/reservada |
| "Total productos activos" | query separada + count inactivos |

---

## Links relacionados

- [[wiki/features/inventario-stock]]
- [[wiki/features/ventas-pos]]
- [[wiki/features/gastos]]
- [[wiki/features/rrhh]]
