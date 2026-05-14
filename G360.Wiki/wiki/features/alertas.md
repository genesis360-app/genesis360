---
title: Alertas
category: features
tags: [alertas, stock-minimo, lpn-vencidos, reservas, categorias, sucursal]
sources: [CLAUDE.md]
updated: 2026-05-13
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

## Badge del sidebar vs totalAlertas — actualizado v1.6.0

| Contexto | Incluye |
|---------|---------|
| Badge sidebar | alertas DB + reservas_viejas + OC vencidas + OC próximas ≤3d |
| AlertasPage `totalAlertas` | Todo lo anterior + sinCategoria + clientesConDeuda + LPN vencidos |

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
| Alertas de stock (`alertas`) | ⚠️ Sin `sucursal_id` — tabla creada sin esa columna, pendiente migration |
| Productos sin categoría (`productos`) | — Catálogo global, no aplica filtro |

> [!NOTE] La tabla `alertas` (stock mínimo) no tiene `sucursal_id` — se ve en todas las vistas. Requiere migration para agregar la columna y actualizar el trigger `check_stock_minimo`.

---

## Links relacionados

- [[wiki/features/inventario-stock]]
- [[wiki/features/ventas-pos]]
- [[wiki/features/clientes-proveedores]]
- [[wiki/features/gastos]]
- [[wiki/features/multi-sucursal]]
