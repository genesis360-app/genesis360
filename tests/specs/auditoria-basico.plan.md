# Plan de auditoría exhaustiva — Modo Básico (end-to-end, sin trazabilidad LPN)

> **Objetivo (GO, 2026-06-15):** dejar el **modo básico funcionando al 100%** de punta a punta con
> todo lo que tiene y se usa: **Caja · Ventas · Gastos · Inventario · Productos · Clientes ·
> Proveedores y Servicios · Facturación**. Encontrar y reparar cualquier bug **antes** que lo
> encuentre un cliente.
>
> Básico = mostrador simple: **el stock NO tiene `ubicacion_id` ni `estado_id`** (ambos NULL),
> no hay LPN/lotes/series/vencimientos ni OC/WMS. Ver `reference_basico_stock_null_ubicacion_estado`.

---

## 0. Método (3 capas)

| Capa | Qué valida | Herramienta |
|---|---|---|
| **A. Traza estática** | Cada query/flujo es *mode-aware*: no filtra por columnas WMS (ubicacion/estado) en básico | Grep + lectura de código (este pase) |
| **B. e2e mutante** | El flujo de dinero/stock muta de verdad (no solo lee) | Playwright (`tests/e2e/19..23`) |
| **C. Click-through manual** | UX/runtime con un tenant **básico nuevo** real | Manual (GO) — tenant "Kiosco Buildi" en DEV |

**Clase de bug #1 (la más cara, ya costó v1.59.1/v1.59.2):** *mode-awareness del stock*. En básico
`inventario_lineas.ubicacion_id` **y** `estado_id` son **NULL**. Cualquier query de
stock/venta/disponibilidad que filtre `.in('estado_id', ...)`, `.eq('estado_id', ...)` o
`.not('ubicacion_id','is',null)` **sin gatear por `modoAvanzado`** lee **0 stock** o **bloquea el
flujo**. Patrón de fix: `const ids = modoAvanzado ? [...] : []` + aplicar el filtro solo si
`ids.length > 0` (o `if (modoAvanzado) q = q.not('ubicacion_id', ...)`).

---

## 1. Bugs encontrados y reparados en este pase (capa A) — v1.68.0

| # | Módulo | Archivo | Síntoma en básico | Fix |
|---|--------|---------|-------------------|-----|
| 🔴 1 | Ventas | `VentasPage.tsx` (`vendibleIdsCambio`, flujo reserva→despachada) | El `movimientos_stock` del despacho guardaba `stock_antes/despues = 0` (filtraba `estado_id IN vendibles` contra estado NULL) | Gatear `vendibleIdsCambio = modoAvanzado ? ... : []` |
| 🔴 2 | Productos | `ProductosPage.tsx` (`stockDisponibleMap`) | **Todos los productos mostraban "0 disponible"** en la lista (filtraba `estado_id IN vendibles`) | Gatear `evIds` por modo + no filtrar si vacío |
| 🔴 3 | Inventario | `MasivoModal.tsx` (rebaje masivo, 2 queries) | El **rebaje masivo no encontraba stock** (filtraba `.not('ubicacion_id')`) | `if (modoAvanzado) q = q.not('ubicacion_id', ...)` |
| 🔴 4 | Ventas | `VentasPage.tsx` (devolución) | **Devolución totalmente bloqueada**: exigía ubicación + estado `es_devolucion` que el seed no crea y que básico no puede configurar (tabs ocultos) | Gatear el requisito por modo; en básico reingresar con `ubicacion_id/estado_id = NULL` |
| 🔴 5 | Ventas (v1.69.0) | `VentasPage.tsx` (anular venta despachada) | **Anular una venta despachada/facturada devolvía la plata pero NO el stock** (ambos modos) → pérdida fantasma de inventario | Reingreso al anular (espejo de Devolver): series reactivadas, no-series → nueva línea + movimiento; mode-aware (básico sin ubicación/estado). Decisión GO: "Anular restaura el stock" |

> Nota seed: `112_seed_tenant_defaults.sql` crea solo 2 estados ('Disponible', 'Bloqueado'),
> **ninguno `es_devolucion`**, y **0 ubicaciones**. Por eso #4 bloqueaba.

---

## 2. Checklist por módulo (capa A + C)

Leyenda: 🔴 mueve plata/stock · 🟡 governance/visibilidad · 🟢 cosmético. ✅ = auditado este pase.

### 2.1 Productos
- 🔴 ✅ Stock **disponible** vs total en la lista (BUG #2). Verificar en click-through.
- 🟢 Alta con solo `nombre` (categoría opcional); 🟡 `es_kit`/mayoristas/Estructura gateados a avanzado.
- ⬜ Editar producto, baja (activo=false), import — verificar que no asuman ubicación/estado.

### 2.2 Inventario
- 🔴 ✅ **Agregar stock → Ingreso** crea `inventario_lineas` con ubicacion/estado NULL (auto-FIFO al vender).
- 🔴 ✅ **Quitar stock → Masivo (rebaje)** encuentra stock (BUG #3). ⬜ Rebaje simple (no masivo) — re-verificar.
- 🔴 **Agregar stock → Masivo inline** (que agregué en v1.66.0): confirmar que ingresa sin ubicación.
- 🟡 Historial de movimientos: `stock_antes/despues` correctos (relacionado BUG #1).
- 🟡 Conteos: que el conteo en básico no exija ubicación.

### 2.3 Ventas (POS)
- 🔴 ✅ Buscar → agregar al carrito: **stock disponible correcto** (no 0).
- 🔴 ✅ **Venta directa** efectivo → auto-FIFO (sin picker LPN) → rebaja stock + movimiento de caja (e2e #19).
- 🔴 ✅ **Reserva → despacho**: snapshot de movimiento correcto (BUG #1).
- 🔴 ✅ **Devolución** (BUG #4) → reingreso + egreso caja + NC.
- 🔴 Fiado/CC, medios de pago mixtos, seña; 🟡 descuentos bloqueados por rol (CAJERO).

### 2.4 Caja
- 🔴 ✅ Abrir / arqueo parcial / cerrar con conteo (e2e #20).
- 🔴 Venta efectivo → `ingreso`; medio no-efectivo → `ingreso_informativo` + cuenta origen.
- 🔴 Cobranza CC → ingreso de caja (3 vías: ficha/POS/Caja). Gasto efectivo → egreso.
- 🟡 Bóveda (se deja en básico), traspaso entre cajas.

### 2.5 Gastos
- 🔴 Alta gasto + pago efectivo → egreso de caja. Gasto fijo.
- 🟡 Categorías de gasto seedeadas; OC/Reportes-compras/Recursos ocultos en básico.

### 2.6 Clientes
- 🔴 Alta (DNI/tel obligatorios), fiado (CC), cobranza, saldo/deuda, ficha.
- 🟡 Aislamiento por sucursal (single-sucursal en básico → trivial).

### 2.7 Proveedores y Servicios
- 🔴 Alta proveedor; servicios; **servicio recurrente vencido → genera gasto** (sweep lazy).
- 🟡 Tab OC + "comparar presupuestos" ocultos en básico.

### 2.8 Facturación
- 🔴 Emitir factura desde venta (AFIP homologación) → CAE (e2e #21). Factura C (monotributo).
- 🟡 Libros IVA; el módulo solo aparece si `facturacion_habilitada`.

---

## 3. Costuras cross-module (las de mayor riesgo)

| Costura | Qué verificar | Estado |
|---|---|---|
| Venta → trigger rebaja stock → `movimientos_stock` → caja `ingreso` | Atómico; stock_antes/despues reales | ✅ e2e #19 + BUG #1 |
| Cobranza CC → caja `ingreso` (ficha/POS/Caja) | `movimientoCajaCobranza` (unit ✓) | ✅ unit |
| Gasto efectivo → caja `egreso` | Sesión imputable | ✅ auditado — efectivo exige caja + valida saldo, OK |
| Devolución → reingreso stock + caja `egreso` + NC | Reingreso correcto en básico | ✅ BUG #4 |
| Factura → venta (auto-facturada) | `ventas.facturada` | ✅ e2e #21 |
| **Anular venta despachada → revierte stock** + cancela envíos | Restaurar stock al anular | ✅ **BUG #5** (no restauraba stock; ahora reingresa, mode-aware) |
| Servicio recurrente vencido → gasto | sweep lazy en Proveedores | ✅ auditado — genera gasto no pagado + avanza vencimiento, OK |

---

## 4. Cobertura e2e mutante (capa B)

| Spec | Flujo | Estado |
|---|---|---|
| `19_flujo_venta_mutante` | Venta directa efectivo (POS→cobro→despacho) | ✅ |
| `20_caja_apertura_cierre` | Abrir + arqueo + cerrar | ✅ |
| `21_facturacion_mutante` | Venta → Factura C → CAE AFIP | ✅ |
| `22_devolucion_mutante` | Venta → devolución (reingreso + egreso) | ✅ NUEVO (defensivo: skip si no hay venta cobrada) |
| `23_inventario_ingreso_mutante` | Ingreso de stock (Inventario → Agregar) | ✅ NUEVO |
| ⬜ `gasto`, `cobranza CC`, `anular venta` | Egreso/ingreso de caja | pendiente |

> **Limitación:** el tenant DEV de e2e está en **avanzado**. Los mutantes se auto-omiten o degradan
> donde el flujo difiere; la validación **definitiva de básico** es el click-through (capa C) con un
> tenant básico nuevo. Candidato futuro: tenant + usuario básico dedicado en DEV para correr la suite
> mutante en modo básico.

---

## 5. Próximos pasos del pase de auditoría
1. ⬜ Click-through manual (GO) del recorrido básico con los 4 fixes aplicados.
2. ⬜ Auditar las costuras ⬜ de §3 (gasto→caja, anular venta, servicio recurrente).
3. ⬜ Extraer a `src/lib` la decisión "estados/ubicaciones vendibles según modo" para unit-testarla (hoy vive inline en las páginas).
4. ⬜ Considerar seedear en básico (o tolerar la ausencia de) estado/ubicación `es_devolucion` — el fix #4 ya tolera la ausencia.
