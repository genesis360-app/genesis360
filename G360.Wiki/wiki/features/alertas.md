---
title: Alertas
category: features
tags: [alertas, stock-minimo, lpn-vencidos, reservas, categorias, sucursal]
sources: [CLAUDE.md]
updated: 2026-05-28
---

# Alertas

**Página:** `src/pages/AlertasPage.tsx` (`/alertas`)  
**Hook:** `src/hooks/useAlertas.ts`  
**Acceso:** Todos los roles

---

## Secciones de AlertasPage

AlertasPage muestra **4 categorías** de alertas. El badge del sidebar suma todas.

### 1. Alertas de stock (tabla `alertas`)
- Creadas por trigger `check_stock_minimo` AFTER UPDATE en productos
- Trigger usa SECURITY DEFINER para bypasear RLS en contexto de trigger
- Se marcan como "resueltas" manualmente
- Botón **"Resolver"** bloqueado si `stock_actual <= stock_minimo` (el problema sigue existiendo)
- Complementado por trigger `auto_resolver_alerta_stock` (migration 042)

### 2. Reservas viejas (> 5 días)
- Query: ventas en estado `reservada` con `created_at < now() - 5 days`
- Mismo criterio que el monitoring diario y el badge del dashboard
- Botón **"Ver venta"** → navega a `/ventas?id=xxx`

### 3. Productos sin categoría
- Query: `productos WHERE activo=true AND categoria_id IS NULL`
- Sección naranja con icono `Tag`
- Link a `/productos/:id/editar` para asignar categoría

### 4. Clientes con saldo pendiente
- Agrupa ventas por cliente, muestra saldo acumulado y cantidad de ventas
- Botón **"Ver ficha"** → `/clientes?id=xxx`

---

## LPNs vencidos (migration 051)

Desde v0.84.0:
- `fecha_vencimiento < hoy` excluye líneas en ventas (4 puntos de validación)
- Sección roja en AlertasPage con botón "Ver LPN" → `/inventario?search=LPN-XXX`
- Badge `useAlertas` incluye el conteo
- InventarioPage lee `?search=` al montar y pre-filtra

---

## Badge del sidebar vs totalAlertas

| Contexto | Incluye |
|---------|---------|
| Badge sidebar + Dashboard card | alertas DB + reservas_viejas |
| AlertasPage `totalAlertas` | alertas DB + reservas_viejas + sinCategoria + clientesConDeuda + LPN vencidos |

> [!NOTE] La diferencia es intencional: sidebar/dashboard muestran alertas **urgentes**, AlertasPage muestra **todo el detalle**.

---

## Diferencia: Stock Crítico vs Alertas

- **Dashboard "Stock Crítico"** (card) = tiempo real (`stock_actual <= stock_minimo`)
- **AlertasPage sección stock** = tabla `alertas` (trigger-based)

Pueden diferir: el trigger crea la alerta cuando el stock baja, pero no la resuelve automáticamente cuando se repone. Resolución manual requerida.

---

## OC vencidas sin pagar — v1.6.0

Nueva sección **roja** en AlertasPage:
- Query: `ordenes_compra WHERE fecha_vencimiento_pago < hoy AND estado_pago NOT IN ('pagada')`
- Muestra días de mora por cada OC
- Botón **"Regularizar"** → navega a `/gastos` (tab Órdenes de Compra)

## OC próximas a vencer — v1.6.0

Nueva sección **ámbar** en AlertasPage:
- Query: `ordenes_compra WHERE fecha_vencimiento_pago BETWEEN hoy AND hoy+3d`
- Muestra días restantes
- Botón **"Pagar ahora"** → navega a `/gastos`

> [!NOTE] El badge del sidebar ahora incluye el conteo de OC vencidas + próximas a vencer (v1.6.0).

---

## Badge del sidebar vs totalAlertas — mode-aware (v1.67.0)

Desde **v1.67.0** el badge del sidebar (`useAlertas`) y `AlertasPage.totalAlertas` cuentan **las mismas fuentes** y se **gatean por modo de operación** (`useModoOperacion().avanzado`). Antes, el badge sumaba fuentes de WMS/compras que la página no mostraba en básico → aparecía un "1" fantasma sin nada visible.

| Fuente | Básico | Avanzado |
|--------|:------:|:--------:|
| Stock bajo mínimo (tabla `alertas`) | ✅ | ✅ |
| Reservas viejas (>3d) | ✅ | ✅ |
| Productos sin categoría | ✅ | ✅ |
| Clientes con deuda CC | ✅ | ✅ |
| **LPN vencidos** (vencimiento de lote, WMS) | — | ✅ |
| **OC vencidas / próximas ≤3d** (compras) | — | ✅ |
| Inventario sin ubicación / sin proveedor (WMS) | — | ✅ |

> [!IMPORTANT] Si tocás una de las fuentes avanzado-only, gateála en **ambos** lados (hook + página) o el badge vuelve a desincronizarse. Ver memoria `reference_alertas_badge_mode_aware`.

---

## Monitoring diario

La EF `monitoring-check` incluye stock crítico y reservas viejas en el email diario a las 9 AM AR. Ver [[wiki/development/supabase-dev-vs-prod]].

---

---

## Filtrado por sucursal (v1.8.19 · 2026-05-13)

`AlertasPage` ahora usa `useSucursalFilter` y aplica `applyFilter` a las queries que tienen `sucursal_id`:

| Query | Filtro |
|---|---|
| Reservas viejas (`ventas`) | ✅ `applyFilter` |
| LPNs sin ubicación (`inventario_lineas`) | ✅ `applyFilter` |
| LPNs sin proveedor (`inventario_lineas`) | ✅ `applyFilter` |
| OCs vencidas (`ordenes_compra`) | ✅ `applyFilter` |
| OCs próximas a vencer (`ordenes_compra`) | ✅ `applyFilter` |
| LPNs vencidos (`inventario_lineas`) | ✅ `applyFilter` |
| Clientes con deuda (`ventas`) | ✅ `applyFilter` |
| Alertas de stock (`alertas`) | ✅ Cruce client-side por sucursal (ISS-080) |
| Productos sin categoría (`productos`) | ✅ Cruce client-side por sucursal (ISS-080) |

### ISS-080 — Filtrado por sucursal de tablas sin `sucursal_id` (2026-05-28)

Las tablas `alertas` y `productos` no tienen `sucursal_id` (alertas viene del trigger global, productos es catálogo del tenant). Cuando hay sucursal activa, `AlertasPage` ahora:

- **Stock mínimo**: para cada alerta, suma `inventario_lineas.cantidad` del producto en la sucursal activa (JOIN a `ubicaciones.sucursal_id`) y compara con `producto_stock_minimo_sucursal` (PSMSS — override por sucursal, mig 052) o con `productos.stock_minimo` como fallback. La alerta solo aparece si el stock en esa sucursal está al o bajo el mínimo.
- **Sin categoría**: filtra los productos sin categoría que tengan al menos una `inventario_lineas` activa con cantidad > 0 en la sucursal activa.

Si no hay sucursal seleccionada (vista global con `puede_ver_todas`), se muestran todas las alertas como antes.

> [!NOTE] Esto evita el ruido de ver alertas de stock crítico de otra sucursal. Como solución pragmática sin schema change. Pendiente futuro: agregar `sucursal_id` a `alertas` + reescribir trigger `check_stock_minimo` para disparar por sucursal+producto.

---

## Links relacionados

- [[wiki/features/inventario-stock]]
- [[wiki/features/ventas-pos]]
- [[wiki/features/clientes-proveedores]]
- [[wiki/features/gastos]]
- [[wiki/features/multi-sucursal]]
